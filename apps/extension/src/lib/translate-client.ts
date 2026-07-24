import type { TranslateRequest } from '@ai-translator/translate-core'

export type TranslateMessage = {
  type: 'translate'
  request: TranslateRequest
}

export type TranslateResponse =
  | { ok: true; result: string }
  | { ok: false; error: string }

export async function requestTranslate(request: TranslateRequest): Promise<string> {
  const res = (await chrome.runtime.sendMessage({
    type: 'translate',
    request
  } satisfies TranslateMessage)) as TranslateResponse

  if (!res?.ok) {
    throw new Error(res?.error || '翻译失败')
  }
  return res.result
}
