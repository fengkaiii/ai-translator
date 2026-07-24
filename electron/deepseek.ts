import type { AppSettings } from './settings'

export type TranslateMode = 'translate' | 'polish'

export type TranslateRequest = {
  text: string
  mode: TranslateMode
  previousTranslation?: string
}

const TRANSLATE_SYSTEM = `你是一名专业翻译。只做中英互译：
- 输入主要是中文时，翻译成自然流畅的英文
- 输入主要是英文时，翻译成自然流畅的中文
只输出译文，不要解释、不要加引号或前缀。`

const POLISH_SYSTEM = `你是一名专业翻译润色助手。用户会提供原文和一版译文。
请在保留原意的前提下，把译文改得更通顺、自然；仍遵循中英互译方向。
只输出润色后的译文，不要解释。`

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
            content: req.mode === 'polish' ? POLISH_SYSTEM : TRANSLATE_SYSTEM
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
