import type { AppSettings } from './settings'
import { callDeepSeek, type TranslateRequest } from './deepseek'
import { callCursorAgent } from './cursor'

/** 按当前厂商分流：DeepSeek → Chat Completions；Cursor → 本地 @cursor/sdk */
export async function translateText(
  settings: AppSettings,
  req: TranslateRequest
): Promise<string> {
  if (settings.provider === 'cursor') {
    return callCursorAgent(settings, req)
  }
  return callDeepSeek(settings, req)
}

export type { TranslateRequest }
