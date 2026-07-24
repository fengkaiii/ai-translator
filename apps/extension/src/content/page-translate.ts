import {
  batchTextUnits,
  limitPageUnits,
  packBatchUnits,
  parseBatchResult,
  type TextUnit
} from '@ai-translator/translate-core'
import { requestTranslate } from '../lib/translate-client'
import { getExtensionSettings, type PageMode } from '../lib/settings'

const SKIP_SELECTOR =
  'script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-ai-translator],[data-ai-translator-original]'

/** 批间并发，避免打爆限流又明显缩短墙钟时间 */
const PAGE_TRANSLATE_CONCURRENCY = 4

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

/** 还原替换模式：每个译文包在带原文属性的 wrapper 上，与混合 inline DOM 无关 */
function clearTranslation(): void {
  document.querySelectorAll('[data-ai-translator="bilingual"]').forEach((el) => el.remove())
  document.querySelectorAll('[data-ai-translator-original]').forEach((el) => {
    const original = el.getAttribute('data-ai-translator-original')
    // 有原文才 unwrap；绝不先删属性再丢原文
    if (original == null) return
    el.replaceWith(document.createTextNode(original))
  })
  document.querySelectorAll('[data-ai-translator-error]').forEach((el) => {
    el.removeAttribute('data-ai-translator-error')
  })
}

function applyBilingual(node: Text, translated: string): void {
  const span = document.createElement('span')
  span.setAttribute('data-ai-translator', 'bilingual')
  // inline-block：避免在 inline 父节点上 display:block 撑破布局
  span.style.display = 'inline-block'
  span.style.opacity = '0.85'
  span.style.marginTop = '0.15em'
  span.textContent = translated
  const parent = node.parentNode
  if (!parent) return
  if (node.nextSibling) parent.insertBefore(span, node.nextSibling)
  else parent.appendChild(span)
}

/** 按文本节点包一层 marker，避免把原文挂在有多个子节点的 parent 上 */
function applyReplace(node: Text, translated: string): void {
  const original = node.nodeValue ?? ''
  const wrap = document.createElement('span')
  wrap.setAttribute('data-ai-translator-original', original)
  wrap.textContent = translated
  node.parentNode?.replaceChild(wrap, node)
}

function markFailed(node: Text | undefined): void {
  node?.parentElement?.setAttribute('data-ai-translator-error', '1')
}

function applyUnit(mode: PageMode, node: Text, translated: string): void {
  if (mode === 'bilingual') applyBilingual(node, translated)
  else applyReplace(node, translated)
}

/** 固定并发池：完成一条立刻取下一条 */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const n = Math.max(1, Math.min(concurrency, items.length))
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        await fn(items[i])
      }
    })
  )
}

async function translateBatch(
  batch: TextUnit[],
  map: NodeMap,
  mode: PageMode
): Promise<number> {
  let failed = 0

  const markBatchFailed = (): number => {
    for (const unit of batch) {
      markFailed(map.get(unit.id))
      failed += 1
    }
    return failed
  }

  // 单节点：走普通单条路径，避免无意义的分隔符开销
  if (batch.length === 1) {
    const unit = batch[0]
    const node = map.get(unit.id)
    if (!node || !node.isConnected) return 0
    try {
      const result = await requestTranslate({ text: unit.text, mode: 'translate' })
      applyUnit(mode, node, result)
    } catch {
      markFailed(node)
      failed += 1
    }
    return failed
  }

  try {
    const raw = await requestTranslate({
      text: packBatchUnits(batch),
      mode: 'translate'
    })
    const parsed = parseBatchResult(
      raw,
      batch.map((u) => u.id)
    )
    for (const unit of batch) {
      const node = map.get(unit.id)
      if (!node || !node.isConnected) continue
      const translated = parsed.get(unit.id)
      if (!translated) {
        markFailed(node)
        failed += 1
        continue
      }
      applyUnit(mode, node, translated)
    }
  } catch {
    return markBatchFailed()
  }

  return failed
}

async function translatePage(
  mode: PageMode
): Promise<{ truncated: boolean; failed: number; nodeCount: number }> {
  clearTranslation()
  const { units, map } = collectTextNodes()
  const limited = limitPageUnits(units)
  const batches = batchTextUnits(limited.units)
  let failed = 0

  // 批内合并为一次请求；批间小并发（先 await 再累加，避免 += await 丢计数）
  await mapPool(batches, PAGE_TRANSLATE_CONCURRENCY, async (batch) => {
    const n = await translateBatch(batch, map, mode)
    failed += n
  })

  return { truncated: limited.truncated, failed, nodeCount: limited.units.length }
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
