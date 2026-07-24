import type { AppSettings } from './settings'
import type { TranslateRequest, TargetLang } from './deepseek'

/**
 * Cursor Cloud Agents API
 * https://cursor.com/cn/docs/cloud-agent/api/endpoints
 *
 * 流程（对齐官方文档）：
 * 1. POST /v1/agents → 拿到 agent.id + run.id
 * 2. 轮询 GET /v1/agents/{id}/runs/{runId}（Get A Run）直到终态
 * 3. FINISHED 时取 result 作为译文
 * 4. DELETE 清理临时 agent（不阻塞返回）
 */
const CURSOR_API = 'https://api.cursor.com'
/** 创建有时会因云端排队较慢；本机 curl 通常很快，超时多半是服务端未及时回包 */
const CREATE_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 2_000
const POLL_OVERALL_MS = 180_000
const SINGLE_GET_TIMEOUT_MS = 30_000

export type CursorModelOption = {
  id: string
  label: string
  params?: Array<{ id: string; value: string }>
}

const TRANSLATE_SYSTEM_AUTO = `你是一名专业翻译。只做中英互译，严格按下列规则判定方向：
- 输入是纯中文（或几乎全是中文）时，翻译成自然流畅的英文
- 输入是纯英文（或几乎全是英文）时，翻译成自然流畅的中文
- 输入是中英混合时，必须翻译成自然流畅的中文，绝不能翻译成英文；专有名词、品牌名、代码标识符等可保留原文
只输出译文，不要解释、不要加引号或前缀，不要使用任何工具，不要改仓库或写文件。`

const TRANSLATE_SYSTEM_ZH = `你是一名专业翻译。将用户输入翻译成自然流畅的中文。
专有名词、品牌名、代码标识符等可保留原文。只输出译文，不要解释、不要加引号或前缀，不要使用任何工具，不要改仓库或写文件。`

const TRANSLATE_SYSTEM_EN = `你是一名专业翻译。将用户输入翻译成自然流畅的英文。
只输出译文，不要解释、不要加引号或前缀，不要使用任何工具，不要改仓库或写文件。`

const POLISH_SYSTEM_AUTO = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然；仍遵循中英互译方向。
若原文是中英混合，润色结果必须保持为中文，绝不能改成英文。
只输出润色后的译文，不要解释，不要使用任何工具，不要改仓库或写文件。`

const POLISH_SYSTEM_ZH = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然，且结果必须是中文。
只输出润色后的译文，不要解释，不要使用任何工具，不要改仓库或写文件。`

const POLISH_SYSTEM_EN = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然，且结果必须是英文。
只输出润色后的译文，不要解释，不要使用任何工具，不要改仓库或写文件。`

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

/** 官方示例用 Basic `-u API_KEY:`；Bearer 等价，这里跟 curl 一致 */
function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
  }
}

function parseCursorApiError(status: number, body: string, action: string): Error {
  if (status === 401) {
    return new Error('Cursor API Key 无效或未授权（401）')
  }
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; message?: string }
    }
    const code = parsed.error?.code ?? ''
    const message = parsed.error?.message ?? ''
    if (
      code === 'feature_unavailable' ||
      /storage mode is disabled/i.test(message) ||
      /Privacy Mode \(Legacy\)/i.test(message)
    ) {
      return new Error(
        'Cursor Cloud Agents 需要开启存储（非 Legacy 隐私模式）。请到 Cursor Dashboard → Cloud Agents 关闭 Privacy Mode (Legacy)，改用 Privacy Mode 后再试。'
      )
    }
    if (code === 'invalid_model') {
      return new Error(
        `Cursor 模型不可用：${message || '请点「刷新模型」或选择「账号默认」'}`
      )
    }
    if (message) {
      return new Error(`Cursor ${action}失败（${status}）：${message}`)
    }
  } catch {
    // ignore
  }
  return new Error(
    `Cursor ${action}失败（${status}）${body ? `: ${body.slice(0, 200)}` : ''}`
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 使用 Node 全局 fetch（与 curl 同网络栈）。
 * 之前 Electron net.fetch 在 POST /v1/agents 上出现 60s 无回包。
 */
async function cursorFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label = '请求'
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    console.log(
      '[cursor] %s %s → %s (%sms)',
      init.method ?? 'GET',
      label,
      res.status,
      Date.now() - started
    )
    return { ok: res.ok, status: res.status, text }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Cursor ${label}超时（${Math.round(timeoutMs / 1000)}s）。若本机 curl 正常，多半是云端创建排队，请稍后重试`
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

type CreateAgentResponse = {
  agent?: { id?: string; latestRunId?: string }
  run?: { id?: string; status?: string }
}

type RunResponse = {
  id?: string
  agentId?: string
  status?: string
  result?: string
  durationMs?: number
}

type ModelsApiResponse = {
  items?: Array<{
    id?: string
    displayName?: string
    variants?: Array<{
      params?: Array<{ id: string; value: string }>
      displayName?: string
      isDefault?: boolean
    }>
  }>
}

const TERMINAL = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'])

/** 刷新模型时缓存默认 params，创建 agent 时带上 */
const modelParamsCache = new Map<string, Array<{ id: string; value: string }>>()

export async function listCursorModels(apiKey: string): Promise<CursorModelOption[]> {
  const key = apiKey.trim()
  if (!key) throw new Error('请先填写 Cursor API Key')

  const res = await cursorFetch(
    `${CURSOR_API}/v1/models`,
    { method: 'GET', headers: authHeaders(key) },
    20_000,
    '拉取模型'
  )
  if (!res.ok) {
    throw parseCursorApiError(res.status, res.text, '拉取模型')
  }

  const data = JSON.parse(res.text) as ModelsApiResponse
  const out: CursorModelOption[] = [{ id: 'default', label: '账号默认模型' }]
  modelParamsCache.clear()
  for (const item of data.items ?? []) {
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
}

type ModelPayload = { id: string; params?: Array<{ id: string; value: string }> }

function modelPayloadFromSettings(preferred: string): ModelPayload | undefined {
  if (!preferred || preferred === 'default') return undefined
  if (preferred === 'composer-2' || preferred === 'composer-2:fast') {
    return { id: 'composer-2', params: [{ id: 'fast', value: 'true' }] }
  }
  if (preferred === 'composer-2:standard') {
    return { id: 'composer-2', params: [{ id: 'fast', value: 'false' }] }
  }
  const cached = modelParamsCache.get(preferred)
  return cached?.length ? { id: preferred, params: cached } : { id: preferred }
}

/**
 * POST /v1/agents
 * 省略 repos 与 env → 无仓库智能体
 */
async function createAgent(
  apiKey: string,
  promptText: string,
  model?: ModelPayload
): Promise<{ agentId: string; runId: string }> {
  const body: Record<string, unknown> = {
    prompt: { text: promptText },
    name: 'AI Translator'
  }
  if (model) body.model = model

  const payload = {
    method: 'POST' as const,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(apiKey)
    },
    body: JSON.stringify(body)
  }

  let createRes: { ok: boolean; status: number; text: string }
  try {
    createRes = await cursorFetch(
      `${CURSOR_API}/v1/agents`,
      payload,
      CREATE_TIMEOUT_MS,
      '创建 agent'
    )
  } catch (err) {
    // 偶发排队超时：再试一次
    const msg = err instanceof Error ? err.message : ''
    if (!/超时/.test(msg)) throw err
    console.warn('[cursor] create timed out, retrying once…')
    await sleep(1_500)
    createRes = await cursorFetch(
      `${CURSOR_API}/v1/agents`,
      payload,
      CREATE_TIMEOUT_MS,
      '创建 agent(重试)'
    )
  }

  if (!createRes.ok) {
    throw parseCursorApiError(createRes.status, createRes.text, '创建 agent')
  }

  const created = JSON.parse(createRes.text) as CreateAgentResponse
  const agentId = created.agent?.id ?? ''
  // 文档响应：agent + run；run.id 为初始运行
  const runId = created.run?.id ?? created.agent?.latestRunId ?? ''
  if (!agentId || !runId) {
    throw new Error(
      `Cursor 未返回有效的 agent/run id：${createRes.text.slice(0, 300)}`
    )
  }
  console.log('[cursor] created agent=%s run=%s status=%s', agentId, runId, created.run?.status)
  return { agentId, runId }
}

/**
 * GET /v1/agents/{id}/runs/{runId} — Get A Run
 * 终态后 result 为最终助手回复文本
 */
async function getRun(
  apiKey: string,
  agentId: string,
  runId: string
): Promise<RunResponse> {
  const url = `${CURSOR_API}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`
  const runRes = await cursorFetch(
    url,
    { method: 'GET', headers: authHeaders(apiKey) },
    SINGLE_GET_TIMEOUT_MS,
    'Get A Run'
  )
  if (!runRes.ok) {
    throw parseCursorApiError(runRes.status, runRes.text, '获取 run')
  }
  return JSON.parse(runRes.text) as RunResponse
}

async function cancelRun(apiKey: string, agentId: string, runId: string): Promise<void> {
  try {
    await cursorFetch(
      `${CURSOR_API}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST', headers: authHeaders(apiKey) },
      10_000,
      'cancel run'
    )
  } catch {
    // ignore
  }
}

async function deleteAgent(apiKey: string, agentId: string): Promise<void> {
  try {
    await cursorFetch(
      `${CURSOR_API}/v1/agents/${encodeURIComponent(agentId)}`,
      { method: 'DELETE', headers: authHeaders(apiKey) },
      10_000,
      'delete agent'
    )
  } catch {
    // ignore
  }
}

/** 后台清理，不阻塞把译文返回给 UI */
function cleanupAgent(
  apiKey: string,
  agentId: string,
  runId: string,
  opts: { cancel: boolean }
): void {
  void (async () => {
    try {
      if (opts.cancel && runId) await cancelRun(apiKey, agentId, runId)
      await deleteAgent(apiKey, agentId)
    } catch (err) {
      console.warn('[cursor] cleanup failed', err)
    }
  })()
}

/** 按官方 Get A Run 轮询直到终态 */
async function waitViaGetRun(
  apiKey: string,
  agentId: string,
  runId: string
): Promise<string> {
  const deadline = Date.now() + POLL_OVERALL_MS
  let lastStatus = 'UNKNOWN'
  let attempt = 0

  while (Date.now() < deadline) {
    attempt += 1
    const run = await getRun(apiKey, agentId, runId)
    lastStatus = (run.status ?? 'UNKNOWN').toUpperCase()
    console.log('[cursor] get run #%d status=%s', attempt, lastStatus)

    if (lastStatus === 'FINISHED') {
      const result = run.result?.trim()
      if (!result) {
        throw new Error('Cursor run 已结束但 result 为空')
      }
      return result
    }

    if (lastStatus === 'ERROR' || lastStatus === 'CANCELLED' || lastStatus === 'EXPIRED') {
      throw new Error(`Cursor agent 结束状态：${lastStatus}`)
    }

    // CREATING / RUNNING 等非终态继续等
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(
    `Cursor 等待超时（最后状态：${lastStatus}）。云端 agent 启动较慢，请稍后重试或改用 DeepSeek`
  )
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
  let modelPayload = modelPayloadFromSettings(settings.model)

  let agentId = ''
  let runId = ''
  try {
    try {
      const created = await createAgent(apiKey, promptText, modelPayload)
      agentId = created.agentId
      runId = created.runId
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (modelPayload && /模型不可用|invalid_model/i.test(msg)) {
        modelPayload = undefined
        const created = await createAgent(apiKey, promptText, undefined)
        agentId = created.agentId
        runId = created.runId
      } else {
        throw err
      }
    }

    const result = await waitViaGetRun(apiKey, agentId, runId)
    // 已拿到结果：只删除 agent，不 cancel（避免拖住返回）
    cleanupAgent(apiKey, agentId, runId, { cancel: false })
    return result
  } catch (err) {
    if (agentId) {
      cleanupAgent(apiKey, agentId, runId, { cancel: true })
    }
    if (err instanceof TypeError) {
      throw new Error('网络错误，请检查与 api.cursor.com 的连接')
    }
    throw err
  }
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL.has(status.toUpperCase())
}
