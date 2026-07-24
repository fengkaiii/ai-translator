import {
  batchTextUnits,
  limitPageUnits,
  type TextUnit
} from '@ai-translator/translate-core'
import { requestTranslate } from '../lib/translate-client'
import { getExtensionSettings, type PageMode } from '../lib/settings'

const SKIP_SELECTOR =
  'script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-ai-translator],[data-ai-translator-original]'

type NodeMap = Map<string, Text>

function isSkipped(node: Node): boolean {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  while (el) {
    if (el.matches?.(SKIP_SELECTOR)) return true
    if (el.getAttribute?.('data-ai-translator')) return true
    el = el.parentElement
  }
  return false
}

function collectTextNodes(root: ParentNode = document.body): { units: TextUnit[]; map: NodeMap } {
  const map: NodeMap = new Map()
  const units: TextUnit[] = []
  if (!root) return { units, map }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      if (isSkipped(node)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  let i = 0
  let current = walker.nextNode()
  while (current) {
    const text = current.nodeValue?.trim() ?? ''
    if (text) {
      const id = `t${i++}`
      map.set(id, current as Text)
      units.push({ id, text })
    }
    current = walker.nextNode()
  }
  return { units, map }
}

function clearTranslation(): void {
  document.querySelectorAll('[data-ai-translator="bilingual"]').forEach((el) => el.remove())
  document.querySelectorAll('[data-ai-translator-original]').forEach((el) => {
    const original = el.getAttribute('data-ai-translator-original')
    if (original != null && el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) {
      el.firstChild.nodeValue = original
    }
    el.removeAttribute('data-ai-translator-original')
    el.removeAttribute('data-ai-translator-error')
  })
}

function applyBilingual(node: Text, translated: string): void {
  const span = document.createElement('span')
  span.setAttribute('data-ai-translator', 'bilingual')
  span.style.display = 'block'
  span.style.opacity = '0.85'
  span.style.marginTop = '0.15em'
  span.textContent = translated
  const parent = node.parentNode
  if (!parent) return
  if (node.nextSibling) parent.insertBefore(span, node.nextSibling)
  else parent.appendChild(span)
}

function applyReplace(node: Text, translated: string): void {
  const parent = node.parentElement
  if (parent && !parent.getAttribute('data-ai-translator-original')) {
    parent.setAttribute('data-ai-translator-original', node.nodeValue ?? '')
  }
  node.nodeValue = translated
}

async function translatePage(mode: PageMode): Promise<{ truncated: boolean; failed: number }> {
  clearTranslation()
  const { units, map } = collectTextNodes()
  const limited = limitPageUnits(units)
  const batches = batchTextUnits(limited.units)
  let failed = 0

  for (const batch of batches) {
    // 批次内串行，避免打爆限流；块与块之间也串行
    for (const unit of batch) {
      const node = map.get(unit.id)
      if (!node || !node.isConnected) continue
      try {
        const result = await requestTranslate({
          text: unit.text,
          mode: 'translate'
        })
        if (mode === 'bilingual') applyBilingual(node, result)
        else applyReplace(node, result)
      } catch {
        failed += 1
        const parent = node.parentElement
        parent?.setAttribute('data-ai-translator-error', '1')
      }
    }
  }

  return { truncated: limited.truncated, failed }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'page-translate-ping') {
    sendResponse({ ok: true })
    return true
  }

  if (msg?.type === 'page-translate-run') {
    void (async () => {
      try {
        const settings = await getExtensionSettings()
        const mode = (msg.pageMode as PageMode | undefined) ?? settings.pageMode
        const result = await translatePage(mode)
        sendResponse({ ok: true, ...result })
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })()
    return true
  }

  if (msg?.type === 'page-translate-clear') {
    clearTranslation()
    sendResponse({ ok: true })
    return true
  }

  return false
})

console.debug('[ai-translator] page-translate content script ready')
