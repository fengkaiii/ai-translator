import { PAGE_MAX_NODES } from '@ai-translator/translate-core'
import {
  getExtensionSettings,
  saveExtensionSettings,
  type PageMode,
  type TranslateScope
} from '../lib/settings'

const status = document.getElementById('status') as HTMLParagraphElement
const openOptions = document.getElementById('open-options') as HTMLButtonElement
const translatePage = document.getElementById('translate-page') as HTMLButtonElement
const clearPage = document.getElementById('clear-page') as HTMLButtonElement
const modeBilingual = document.getElementById('mode-bilingual') as HTMLButtonElement
const modeReplace = document.getElementById('mode-replace') as HTMLButtonElement
const scopePartial = document.getElementById('scope-partial') as HTMLButtonElement
const scopeFull = document.getElementById('scope-full') as HTMLButtonElement

/** 面板当前选中的展示 / 翻译范围（与 storage 同步） */
let pageMode: PageMode = 'bilingual'
let translateScope: TranslateScope = 'partial'

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

function syncModeUi(mode: PageMode): void {
  pageMode = mode
  modeBilingual.setAttribute('aria-pressed', mode === 'bilingual' ? 'true' : 'false')
  modeReplace.setAttribute('aria-pressed', mode === 'replace' ? 'true' : 'false')
}

function syncScopeUi(scope: TranslateScope): void {
  translateScope = scope
  scopePartial.setAttribute('aria-pressed', scope === 'partial' ? 'true' : 'false')
  scopeFull.setAttribute('aria-pressed', scope === 'full' ? 'true' : 'false')
}

async function setPageMode(mode: PageMode): Promise<void> {
  syncModeUi(mode)
  await saveExtensionSettings({ pageMode: mode })
  // 当前页若已有 DOM 缓存，立刻切展示，不重翻
  try {
    const tab = await activeTab()
    if (isRestrictedUrl(tab.url)) return
    const res = await sendToPage<{ ok: boolean; cacheHits?: number }>(tab.id!, {
      type: 'page-translate-apply-mode',
      pageMode: mode
    })
    if (res?.ok && res.cacheHits) {
      status.textContent = `已切换展示（缓存 ${res.cacheHits} 段）`
    }
  } catch {
    // 未注入 / 非网页：仅保存偏好即可
  }
}

async function setTranslateScope(scope: TranslateScope): Promise<void> {
  syncScopeUi(scope)
  await saveExtensionSettings({ translateScope: scope })
  status.textContent = scope === 'full' ? '翻译模式：全量' : '翻译模式：渐进（滚动预取）'
}

modeBilingual.addEventListener('click', () => {
  void setPageMode('bilingual')
})
modeReplace.addEventListener('click', () => {
  void setPageMode('replace')
})
scopePartial.addEventListener('click', () => {
  void setTranslateScope('partial')
})
scopeFull.addEventListener('click', () => {
  void setTranslateScope('full')
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
      cacheHits?: number
      background?: boolean
      scope?: TranslateScope
      error?: string
    }>(tab.id!, {
      type: 'page-translate-run',
      pageMode,
      translateScope
    })

    if (!res?.ok) throw new Error(res?.error || '翻译失败')
    const parts = [res.scope === 'full' ? '全量完成' : '首屏就绪']
    if (res.cacheHits) parts.push(`缓存命中 ${res.cacheHits} 段`)
    if (res.background) parts.push('后台预译后续内容中')
    if (res.truncated) {
      const n = res.nodeCount ?? PAGE_MAX_NODES
      parts.push(`已达上限（约 ${n} 段），停止继续翻译`)
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
  syncScopeUi(s.translateScope)
  status.textContent = `Provider: ${s.provider}`
})
