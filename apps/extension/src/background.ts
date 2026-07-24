import { callDeepSeek, type TranslateRequest } from '@ai-translator/translate-core'
import { getExtensionSettings } from './lib/settings'
import { nativeRequest } from './lib/native'
import type { TranslateMessage, TranslateResponse } from './lib/translate-client'

chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Translator extension installed')
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Options「桌面状态」：ping 可达性，再 get-status 取 ready/model
  if (msg?.type === 'desktop-status') {
    void (async () => {
      const ping = await nativeRequest('ping')
      if (!ping.ok) {
        sendResponse(ping)
        return
      }
      sendResponse(await nativeRequest('get-status'))
    })()
    return true
  }

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
      const res = await nativeRequest('translate', request)
      if (!res.ok || typeof res.result !== 'string') {
        return {
          ok: false,
          error: res.error || '请打开 AI Translator 桌面端以使用 Cursor'
        }
      }
      return { ok: true, result: res.result }
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
