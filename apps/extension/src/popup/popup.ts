import { getExtensionSettings } from '../lib/settings'

const status = document.getElementById('status') as HTMLParagraphElement
const openOptions = document.getElementById('open-options') as HTMLButtonElement
const translatePage = document.getElementById('translate-page') as HTMLButtonElement
const clearPage = document.getElementById('clear-page') as HTMLButtonElement

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

translatePage.addEventListener('click', async () => {
  status.textContent = '翻译中…'
  try {
    const tabId = await activeTabId()
    if (tabId == null) throw new Error('找不到当前标签页')
    const settings = await getExtensionSettings()
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: 'page-translate-run',
      pageMode: settings.pageMode
    })) as { ok: boolean; truncated?: boolean; failed?: number; error?: string }

    if (!res?.ok) throw new Error(res?.error || '翻译失败')
    const parts = ['完成']
    if (res.truncated) parts.push('页面过大，仅翻译了前 N 个文本块')
    if (res.failed) parts.push(`${res.failed} 段失败，已保留原文`)
    status.textContent = parts.join('\n')
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err)
  }
})

clearPage.addEventListener('click', async () => {
  try {
    const tabId = await activeTabId()
    if (tabId == null) throw new Error('找不到当前标签页')
    await chrome.tabs.sendMessage(tabId, { type: 'page-translate-clear' })
    status.textContent = '已清除译文 / 还原原文'
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err)
  }
})

void getExtensionSettings().then((s) => {
  status.textContent = `Provider: ${s.provider} · 整页: ${s.pageMode === 'replace' ? '替换' : '双语'}`
})
