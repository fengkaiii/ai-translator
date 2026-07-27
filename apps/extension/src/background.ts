import { callDeepSeek, type TranslateRequest } from '@ai-translator/translate-core'
import { getExtensionSettings, saveExtensionSettings, type PageMode } from './lib/settings'
import { nativeRequest } from './lib/native'
import type { TranslateMessage, TranslateResponse } from './lib/translate-client'

const MENU_PARENT = 'ai-translator-page'
const MENU_BILINGUAL = 'ai-translator-bilingual'
const MENU_REPLACE = 'ai-translator-replace'

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension):/i.test(url)
}

function isNoReceiverError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /Receiving end does not exist|Could not establish connection/i.test(msg)
}

async function injectPageTranslate(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/page-translate.js']
  })
}

async function sendToPage<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch (err) {
    if (!isNoReceiverError(err)) throw err
    await injectPageTranslate(tabId)
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  }
}

function createContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PARENT,
      title: 'AI Translator',
      contexts: ['page', 'selection', 'editable']
    })
    chrome.contextMenus.create({
      id: MENU_BILINGUAL,
      parentId: MENU_PARENT,
      title: '双语对照翻译',
      contexts: ['page', 'selection', 'editable']
    })
    chrome.contextMenus.create({
      id: MENU_REPLACE,
      parentId: MENU_PARENT,
      title: '原文替换翻译',
      contexts: ['page', 'selection', 'editable']
    })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Translator extension installed')
  createContextMenus()
})

// SW 唤醒后也确保菜单存在（removeAll 后再建，避免重复）
createContextMenus()

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || isRestrictedUrl(tab.url)) return
  const mode: PageMode | null =
    info.menuItemId === MENU_BILINGUAL
      ? 'bilingual'
      : info.menuItemId === MENU_REPLACE
        ? 'replace'
        : null
  if (!mode) return

  void (async () => {
    await saveExtensionSettings({ pageMode: mode })
    const settings = await getExtensionSettings()
    await sendToPage(tab.id!, {
      type: 'page-translate-run',
      pageMode: mode,
      translateScope: settings.translateScope
    })
  })()
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

    // 扩展侧独立文案（与桌面「设置中填写」区分）
    if (!settings.deepseek.apiKey.trim()) {
      return {
        ok: false,
        error: '请先在扩展设置中填写 DeepSeek API Key'
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
