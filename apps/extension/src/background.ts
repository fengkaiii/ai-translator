import { callDeepSeek, type TranslateRequest } from '@ai-translator/translate-core'
import { getExtensionSettings } from './lib/settings'
import type { TranslateMessage, TranslateResponse } from './lib/translate-client'

chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Translator extension installed')
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'translate') return false

  void (async () => {
    const response = await handleTranslate(msg as TranslateMessage)
    sendResponse(response)
  })()

  return true
})

async function handleTranslate(msg: TranslateMessage): Promise<TranslateResponse> {
  try {
    const settings = await getExtensionSettings()
    const request = msg.request as TranslateRequest

    if (settings.provider === 'cursor') {
      return {
        ok: false,
        error: '请打开 AI Translator 桌面端以使用 Cursor（即将接入 Native Messaging）'
      }
    }

    const result = await callDeepSeek(settings.deepseek, request)
    return { ok: true, result }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
