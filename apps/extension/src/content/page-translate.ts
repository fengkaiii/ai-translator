// 整页翻译（Task 8 实现）
console.debug('[ai-translator] page-translate content script loaded')

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'page-translate-ping') {
    sendResponse({ ok: true })
    return true
  }
  return false
})
