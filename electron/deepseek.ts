import type { AppSettings } from './settings'

export type TranslateMode = 'translate' | 'polish'

/** 强制目标语言；不传则自动判定 */
export type TargetLang = 'zh' | 'en'

export type TranslateRequest = {
  text: string
  mode: TranslateMode
  previousTranslation?: string
  targetLang?: TargetLang
}

const TRANSLATE_SYSTEM_AUTO = `你是一名专业翻译。只做中英互译，严格按下列规则判定方向：
- 输入是纯中文（或几乎全是中文）时，翻译成自然流畅的英文
- 输入是纯英文（或几乎全是英文）时，翻译成自然流畅的中文
- 输入是中英混合时，必须翻译成自然流畅的中文，绝不能翻译成英文；专有名词、品牌名、代码标识符等可保留原文
只输出译文，不要解释、不要加引号或前缀。`

const TRANSLATE_SYSTEM_ZH = `你是一名专业翻译。将用户输入翻译成自然流畅的中文。
专有名词、品牌名、代码标识符等可保留原文。只输出译文，不要解释、不要加引号或前缀。`

const TRANSLATE_SYSTEM_EN = `你是一名专业翻译。将用户输入翻译成自然流畅的英文。
只输出译文，不要解释、不要加引号或前缀。`

const POLISH_SYSTEM_AUTO = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然；仍遵循中英互译方向。
若原文是中英混合，润色结果必须保持为中文，绝不能改成英文。
只输出润色后的译文，不要解释。`

const POLISH_SYSTEM_ZH = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然，且结果必须是中文。
只输出润色后的译文，不要解释。`

const POLISH_SYSTEM_EN = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然，且结果必须是英文。
只输出润色后的译文，不要解释。`

function systemPrompt(mode: TranslateMode, targetLang?: TargetLang): string {
  if (mode === 'polish') {
    if (targetLang === 'zh') return POLISH_SYSTEM_ZH
    if (targetLang === 'en') return POLISH_SYSTEM_EN
    return POLISH_SYSTEM_AUTO
  }
  if (targetLang === 'zh') return TRANSLATE_SYSTEM_ZH
  if (targetLang === 'en') return TRANSLATE_SYSTEM_EN
  return TRANSLATE_SYSTEM_AUTO
}

export async function callDeepSeek(
  settings: AppSettings,
  req: TranslateRequest
): Promise<string> {
  const text = req.text.trim()
  if (!text) {
    throw new Error('请输入要翻译的文字')
  }
  if (!settings.apiKey.trim()) {
    throw new Error('请先在设置中填写 API Key')
  }

  const base = settings.baseUrl.replace(/\/+$/, '')
  const url = `${base}/v1/chat/completions`

  const userContent =
    req.mode === 'polish'
      ? `原文：\n${text}\n\n当前译文：\n${req.previousTranslation ?? ''}\n\n请润色译文。`
      : text

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model || 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: systemPrompt(req.mode, req.targetLang)
          },
          { role: 'user', content: userContent }
        ],
        temperature: req.mode === 'polish' ? 0.4 : 0.2
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401) {
        throw new Error('API Key 无效或未授权（401）')
      }
      throw new Error(`请求失败（${res.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('模型未返回有效译文')
    }
    return content
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试')
    }
    if (err instanceof TypeError) {
      throw new Error('网络错误，请检查 baseUrl 与网络连接')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
