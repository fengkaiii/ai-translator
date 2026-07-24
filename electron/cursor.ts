import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  Agent,
  Cursor,
  CursorAgentError,
  type ModelSelection
} from '@cursor/sdk'
import type { AppSettings } from './settings'
import type { TranslateRequest, TargetLang } from './deepseek'

/**
 * Cursor 本地 SDK（@cursor/sdk）
 * https://cursor.com/docs/sdk/typescript
 *
 * 智能体循环在本机 Node 进程内运行；模型推理仍走 Cursor 托管后端。
 * 比 Cloud Agents API 少一层云端 VM 冷启动。
 */
export type CursorModelOption = {
  id: string
  label: string
  params?: Array<{ id: string; value: string }>
}

const TRANSLATE_SYSTEM_AUTO = `你是一名专业翻译。只做中英互译，严格按下列规则判定方向：
- 输入是纯中文（或几乎全是中文）时，翻译成自然流畅的英文
- 输入是纯英文（或几乎全是英文）时，翻译成自然流畅的中文
- 输入是中英混合时，必须翻译成自然流畅的中文，绝不能翻译成英文；专有名词、品牌名、代码标识符等可保留原文
只输出译文，不要解释、不要加引号或前缀，不要使用任何工具，不要读文件或写文件，不要执行 shell。`

const TRANSLATE_SYSTEM_ZH = `你是一名专业翻译。将用户输入翻译成自然流畅的中文。
专有名词、品牌名、代码标识符等可保留原文。只输出译文，不要解释、不要加引号或前缀，不要使用任何工具，不要读文件或写文件，不要执行 shell。`

const TRANSLATE_SYSTEM_EN = `你是一名专业翻译。将用户输入翻译成自然流畅的英文。
只输出译文，不要解释、不要加引号或前缀，不要使用任何工具，不要读文件或写文件，不要执行 shell。`

const POLISH_SYSTEM_AUTO = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然；仍遵循中英互译方向。
若原文是中英混合，润色结果必须保持为中文，绝不能改成英文。
只输出润色后的译文，不要解释，不要使用任何工具，不要读文件或写文件，不要执行 shell。`

const POLISH_SYSTEM_ZH = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然，且结果必须是中文。
只输出润色后的译文，不要解释，不要使用任何工具，不要读文件或写文件，不要执行 shell。`

const POLISH_SYSTEM_EN = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然，且结果必须是英文。
只输出润色后的译文，不要解释，不要使用任何工具，不要读文件或写文件，不要执行 shell。`

function systemPrompt(mode: TranslateRequest['mode'], targetLang?: TargetLang): string {
  if (mode === 'polish') {
    if (targetLang === 'zh') return POLISH_SYSTEM_ZH
    if (targetLang === 'en') return POLISH_SYSTEM_EN
    return POLISH_SYSTEM_AUTO
  }
  if (targetLang === 'zh') return TRANSLATE_SYSTEM_ZH
  if (targetLang === 'en') return TRANSLATE_SYSTEM_EN
  return TRANSLATE_SYSTEM_AUTO
}

/** 翻译用的空工作目录，避免 Agent 碰到真实仓库 */
function workspaceDir(): string {
  const base = app.isReady() ? app.getPath('userData') : process.cwd()
  const dir = join(base, 'cursor-local-workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 刷新模型时缓存默认 params */
const modelParamsCache = new Map<string, Array<{ id: string; value: string }>>()

function mapSdkError(err: unknown): Error {
  if (err instanceof CursorAgentError) {
    const code = err.code ? `（${err.code}）` : ''
    if (/auth|unauthorized|api.?key|401/i.test(err.message + (err.code ?? ''))) {
      return new Error('Cursor API Key 无效或未授权')
    }
    if (/storage|Privacy Mode \(Legacy\)|feature_unavailable/i.test(err.message)) {
      return new Error(
        'Cursor Agent 需要开启存储（非 Legacy 隐私模式）。请到 Cursor Dashboard 调整隐私设置后再试。'
      )
    }
    return new Error(`Cursor SDK 失败${code}：${err.message}`)
  }
  if (err instanceof Error) return err
  return new Error(String(err))
}

export async function listCursorModels(apiKey: string): Promise<CursorModelOption[]> {
  const key = apiKey.trim()
  if (!key) throw new Error('请先填写 Cursor API Key')

  try {
    const items = await Cursor.models.list({ apiKey: key })
    const out: CursorModelOption[] = [{ id: 'auto', label: '账号自动选择（auto）' }]
    modelParamsCache.clear()
    for (const item of items) {
      if (!item.id) continue
      const defVariant =
        item.variants?.find((v) => v.isDefault) ?? item.variants?.[0]
      const params = defVariant?.params
      if (params?.length) modelParamsCache.set(item.id, params)
      out.push({
        id: item.id,
        label: item.displayName || item.id,
        params
      })
    }
    return out
  } catch (err) {
    throw mapSdkError(err)
  }
}

/** 本地 Agent 必须传 model；未选或旧 default → auto */
function modelSelectionFromSettings(preferred: string): ModelSelection {
  if (!preferred || preferred === 'default' || preferred === 'auto') {
    return { id: 'auto' }
  }
  if (preferred === 'composer-2' || preferred === 'composer-2:fast') {
    return { id: 'composer-2', params: [{ id: 'fast', value: 'true' }] }
  }
  if (preferred === 'composer-2:standard') {
    return { id: 'composer-2', params: [{ id: 'fast', value: 'false' }] }
  }
  const cached = modelParamsCache.get(preferred)
  return cached?.length ? { id: preferred, params: cached } : { id: preferred }
}

export async function callCursorAgent(
  settings: AppSettings,
  req: TranslateRequest
): Promise<string> {
  const text = req.text.trim()
  if (!text) throw new Error('请输入要翻译的文字')
  if (!settings.apiKey.trim()) {
    throw new Error('请先在设置中填写 Cursor API Key')
  }

  const apiKey = settings.apiKey.trim()
  const userContent =
    req.mode === 'polish'
      ? `原文：\n${text}\n\n当前译文：\n${req.previousTranslation ?? ''}\n\n请润色译文。`
      : text

  const promptText = `${systemPrompt(req.mode, req.targetLang)}\n\n用户输入：\n${userContent}`
  let model = modelSelectionFromSettings(settings.model)
  const cwd = workspaceDir()

  const runOnce = async (selection: ModelSelection) => {
    console.log('[cursor] local Agent.prompt model=%s cwd=%s', selection.id, cwd)
    const started = Date.now()
    const result = await Agent.prompt(promptText, {
      apiKey,
      name: 'AI Translator',
      model: selection,
      local: {
        cwd,
        // 不加载本机 Cursor IDE 的 user/project 设置，避免副作用
        settingSources: [],
        sandboxOptions: { enabled: false }
      }
    })
    console.log(
      '[cursor] local done status=%s durationMs=%s wall=%sms',
      result.status,
      result.durationMs ?? '-',
      Date.now() - started
    )
    return result
  }

  try {
    let result
    try {
      result = await runOnce(model)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // 所选模型不可用时回退 auto
      if (model.id !== 'auto' && /model|invalid_model|not available/i.test(msg)) {
        console.warn('[cursor] model failed, fallback to auto:', msg)
        model = { id: 'auto' }
        result = await runOnce(model)
      } else {
        throw err
      }
    }

    if (result.status === 'error') {
      throw new Error(
        `Cursor 运行失败：${result.error?.message ?? result.error?.code ?? 'unknown'}`
      )
    }
    if (result.status === 'cancelled') {
      throw new Error('Cursor 运行已取消')
    }

    const out = result.result?.trim()
    if (!out) {
      throw new Error('Cursor 未返回译文（result 为空）')
    }
    return out
  } catch (err) {
    throw mapSdkError(err)
  }
}
