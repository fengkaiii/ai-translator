import { callDeepSeek, type TranslateRequest } from '@ai-translator/translate-core'
import type { AppSettings } from './settings'
import { callCursorAgent } from './cursor'

/** 按当前厂商分流：DeepSeek → Chat Completions；Cursor → 本地 @cursor/sdk */
export async function translateText(
  settings: AppSettings,
  req: TranslateRequest
): Promise<string> {
  if (settings.provider === 'cursor') {
    return callCursorAgent(settings, req)
  }
  return callDeepSeek(
    { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
    req
  )
}

export type { TranslateRequest }
