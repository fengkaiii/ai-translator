import { PAGE_MAX_NODES } from '@ai-translator/translate-core'
import {
  getExtensionSettings,
  saveExtensionSettings,
  type PageMode
} from '../lib/settings'

const status = document.getElementById('status') as HTMLParagraphElement
const openOptions = document.getElementById('open-options') as HTMLButtonElement
const translatePage = document.getElementById('translate-page') as HTMLButtonElement
const clearPage = document.getElementById('clear-page') as HTMLButtonElement
const modeBilingual = document.getElementById('mode-bilingual') as HTMLButtonElement
const modeReplace = document.getElementById('mode-replace') as HTMLButtonElement

/** 面板当前选中的整页模式（与 storage 同步） */
let pageMode: PageMode = 'bilingual'

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

function syncModeUi(mode: PageMode): void {
  pageMode = mode
  modeBilingual.setAttribute('aria-pressed', mode === 'bilingual' ? 'true' : 'false')
  modeReplace.setAttribute('aria-pressed', mode === 'replace' ? 'true' : 'false')
}

async function setPageMode(mode: PageMode): Promise<void> {
  syncModeUi(mode)
  await saveExtensionSettings({ pageMode: mode })
}

modeBilingual.addEventListener('click', () => {
  void setPageMode('bilingual')
})
modeReplace.addEventListener('click', () => {
  void setPageMode('replace')
})

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('找不到当前标签页')
  return tab
}

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension):/i.test(url)
}

/** 内容脚本未注入时（扩展更新后未刷新页）会报 Receiving end does not exist */
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
    // 已打开的标签页不会自动注入 content script：点扩展图标后用 scripting 补注入
    await injectPageTranslate(tabId)
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  }
}

translatePage.addEventListener('click', async () => {
  status.textContent = '翻译中…'
  try {
    const tab = await activeTab()
    if (isRestrictedUrl(tab.url)) {
      throw new Error('当前页面无法注入脚本（请换普通网页，勿用 chrome:// / 扩展页）')
    }
    const res = await sendToPage<{
      ok: boolean
      truncated?: boolean
      failed?: number
      nodeCount?: number
      error?: string
    }>(tab.id!, {
      type: 'page-translate-run',
      pageMode
    })

    if (!res?.ok) throw new Error(res?.error || '翻译失败')
    const parts = ['完成']
    if (res.truncated) {
      const n = res.nodeCount ?? PAGE_MAX_NODES
      parts.push(`页面过大，仅翻译了前 ${n} 个文本块`)
    }
    // 与手测/规格表「单块失败 → 该段保留原文」对齐
    if (res.failed) parts.push(`${res.failed} 段失败，该段保留原文`)
    status.textContent = parts.join('\n')
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err)
  }
})

clearPage.addEventListener('click', async () => {
  try {
    const tab = await activeTab()
    if (isRestrictedUrl(tab.url)) {
      throw new Error('当前页面无法注入脚本（请换普通网页，勿用 chrome:// / 扩展页）')
    }
    await sendToPage(tab.id!, { type: 'page-translate-clear' })
    status.textContent = '已清除译文 / 还原原文'
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err)
  }
})

void getExtensionSettings().then((s) => {
  syncModeUi(s.pageMode)
  status.textContent = `Provider: ${s.provider}`
})
