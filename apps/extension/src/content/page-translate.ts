import {
  PAGE_MAX_CHARS,
  PAGE_MAX_NODES,
  batchTextUnits,
  limitPageUnits,
  packBatchUnits,
  parseBatchResult,
  type TextUnit
} from '@ai-translator/translate-core'
import { requestTranslate } from '../lib/translate-client'
import {
  getExtensionSettings,
  saveExtensionSettings,
  type PageMode,
  type TranslateScope
} from '../lib/settings'
import {
  mountFloatingButton,
  setFloatingPageMode,
  setFloatingProgress,
  setFloatingTranslateScope,
  unmountFloatingButton
} from './floating-button'

const SKIP_SELECTOR =
  'script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-ai-translator],[data-ai-translator-original]'

/** 批间并发，避免打爆限流又明显缩短墙钟时间 */
const PAGE_TRANSLATE_CONCURRENCY = 4

/** 单元标记：原文 / 译文都挂在同一 wrapper 上，切模式优先读属性 */
const ATTR_ORIGINAL = 'data-ai-translator-original'
const ATTR_TRANSLATED = 'data-ai-translator-translated'
const ATTR_MODE = 'data-ai-translator-mode'

/**
 * 首屏：仅当前视口（略扩一点），尽快出字。
 * 预取：下方 2 屏 + 上方 1 屏；首屏返回后后台立刻续翻，不等人滚动。
 */
const VIEWPORT_MARGIN_SCREENS = 0.15
const PREFETCH_AHEAD_SCREENS = 2
const PREFETCH_BEHIND_SCREENS = 1

type NodeMap = Map<string, Text>
type BandKind = 'viewport' | 'prefetch'

/** 会话：clear / 新一轮翻译时 bump，作废进行中的请求回调 */
let runId = 0
let activeMode: PageMode = 'bilingual'
let prefetchEnabled = false
let bandBusy = false
let bandPending = false
let scrollRaf = 0
/** 有未消化的滚动/续跑信号时唤醒后台循环 */
let prefetchWaiters: Array<() => void> = []

/** 浮动按钮进度：本波 done/total */
let progressDone = 0
let progressTotal = 0
let progressActive = false

function reportProgress(partial?: { done?: number; total?: number; message?: string }): void {
  if (partial?.total != null) progressTotal = partial.total
  if (partial?.done != null) progressDone = partial.done
  if (!progressActive) return
  setFloatingProgress({
    phase: 'translating',
    done: progressDone,
    total: progressTotal,
    message: partial?.message
  })
}

function beginProgress(total: number): void {
  progressActive = true
  progressDone = 0
  progressTotal = total
  reportProgress({ done: 0, total })
}

function bumpProgress(n = 1): void {
  progressDone += n
  reportProgress()
}

function endProgress(ok: boolean, message?: string): void {
  progressActive = false
  setFloatingProgress({
    phase: ok ? 'done' : 'error',
    done: progressDone,
    total: progressTotal || progressDone,
    message
  })
}

function wakePrefetchWaiters(): void {
  const list = prefetchWaiters
  prefetchWaiters = []
  for (const w of list) w()
}

function waitPrefetchSignal(id: number): Promise<void> {
  return new Promise((resolve) => {
    if (id !== runId || !prefetchEnabled) {
      resolve()
      return
    }
    prefetchWaiters.push(resolve)
  })
}

function isSkipped(node: Node): boolean {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  while (el) {
    if (el.matches?.(SKIP_SELECTOR)) return true
    if (el.getAttribute?.(ATTR_ORIGINAL)) return true
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

/** viewport=当前屏；prefetch=当前屏 + 下 2 屏 + 上 1 屏 */
function isInBand(node: Text, kind: BandKind): boolean {
  const el = node.parentElement
  if (!el) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const vh = window.innerHeight || 1
  if (kind === 'viewport') {
    const m = vh * VIEWPORT_MARGIN_SCREENS
    return r.bottom >= -m && r.top <= vh + m
  }
  const top = -vh * PREFETCH_BEHIND_SCREENS
  const bottom = vh * (1 + PREFETCH_AHEAD_SCREENS)
  return r.bottom >= top && r.top <= bottom
}

function nodeTop(node: Text): number {
  return node.parentElement?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
}

function cachedUnitCount(): number {
  return document.querySelectorAll(`[${ATTR_ORIGINAL}]`).length
}

/** 按缓存属性渲染展示（不改原文/译文属性） */
function renderCachedUnit(el: Element, mode: PageMode): void {
  const original = el.getAttribute(ATTR_ORIGINAL)
  const translated = el.getAttribute(ATTR_TRANSLATED)
  if (original == null || translated == null) return

  el.setAttribute(ATTR_MODE, mode)
  el.replaceChildren()

  if (mode === 'replace') {
    el.textContent = translated
    return
  }

  // 双语：原文 + 译文行（译文行用 data-ai-translator 标记，便于 SKIP / 旧清理）
  el.appendChild(document.createTextNode(original))
  const line = document.createElement('span')
  line.setAttribute('data-ai-translator', 'bilingual')
  line.style.display = 'inline-block'
  line.style.opacity = '0.85'
  line.style.marginTop = '0.15em'
  line.textContent = translated
  el.appendChild(line)
}

/** 已翻译单元：切换 bilingual / replace，不请求 API */
function applyModeFromCache(mode: PageMode): number {
  const nodes = document.querySelectorAll(`[${ATTR_ORIGINAL}][${ATTR_TRANSLATED}]`)
  nodes.forEach((el) => renderCachedUnit(el, mode))
  return nodes.length
}

function stopPrefetch(): void {
  prefetchEnabled = false
  runId += 1
  bandPending = false
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf)
    scrollRaf = 0
  }
  wakePrefetchWaiters()
  // capture：嵌套 overflow 容器滚动也能收到（scroll 不冒泡）
  document.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
}

function startPrefetch(mode: PageMode): void {
  activeMode = mode
  prefetchEnabled = true
  document.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true })
  window.addEventListener('resize', onScrollOrResize, { passive: true })
}

function onScrollOrResize(): void {
  if (!prefetchEnabled) return
  bandPending = true
  wakePrefetchWaiters()
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    void pumpPrefetchBand(activeMode, runId, 'prefetch')
  })
}

/** 还原原文并卸掉缓存标记 */
function clearTranslation(): void {
  stopPrefetch()
  progressActive = false
  // 新结构：带原文属性的 wrapper 一律还原
  document.querySelectorAll(`[${ATTR_ORIGINAL}]`).forEach((el) => {
    const original = el.getAttribute(ATTR_ORIGINAL)
    if (original == null) return
    el.replaceWith(document.createTextNode(original))
  })
  // 兼容旧版：仅插入的双语 span（无 wrapper）
  document.querySelectorAll('[data-ai-translator="bilingual"]').forEach((el) => el.remove())
  document.querySelectorAll('[data-ai-translator-error]').forEach((el) => {
    el.removeAttribute('data-ai-translator-error')
  })
  setFloatingProgress({ phase: 'idle', done: 0, total: 0, message: '已还原原文' })
}

/** 写入原文+译文缓存，并按模式渲染 */
function applyUnit(mode: PageMode, node: Text, translated: string): void {
  const original = node.nodeValue ?? ''
  const wrap = document.createElement('span')
  wrap.setAttribute(ATTR_ORIGINAL, original)
  wrap.setAttribute(ATTR_TRANSLATED, translated)
  renderCachedUnit(wrap, mode)
  node.parentNode?.replaceChild(wrap, node)
}

function markFailed(node: Text | undefined): void {
  node?.parentElement?.setAttribute('data-ai-translator-error', '1')
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
  mode: PageMode,
  id: number
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
    if (!node || !node.isConnected) {
      bumpProgress(1)
      return 0
    }
    if (id !== runId) return 0
    try {
      const result = await requestTranslate({ text: unit.text, mode: 'translate' })
      if (id !== runId || !node.isConnected) return 0
      applyUnit(mode, node, result)
    } catch {
      if (id === runId) {
        markFailed(node)
        failed += 1
      }
    }
    if (id === runId) bumpProgress(1)
    return failed
  }

  try {
    const raw = await requestTranslate({
      text: packBatchUnits(batch),
      mode: 'translate'
    })
    if (id !== runId) return 0
    const parsed = parseBatchResult(
      raw,
      batch.map((u) => u.id)
    )
    for (const unit of batch) {
      const node = map.get(unit.id)
      if (!node || !node.isConnected) {
        bumpProgress(1)
        continue
      }
      const translated = parsed.get(unit.id)
      if (!translated) {
        markFailed(node)
        failed += 1
        bumpProgress(1)
        continue
      }
      applyUnit(mode, node, translated)
      bumpProgress(1)
    }
  } catch {
    if (id !== runId) return 0
    const n = markBatchFailed()
    bumpProgress(batch.length)
    return n
  }

  return failed
}

type BandResult = {
  truncated: boolean
  failed: number
  nodeCount: number
  /** 本波实际新请求的段数 */
  translated: number
}

/** 翻译指定带内未译节点；按距视口顶部排序，先近后远 */
async function translateBandOnce(
  mode: PageMode,
  id: number,
  kind: BandKind
): Promise<BandResult> {
  const empty: BandResult = { truncated: false, failed: 0, nodeCount: 0, translated: 0 }
  if (id !== runId) return empty

  const already = cachedUnitCount()
  const nodeRoom = PAGE_MAX_NODES - already
  if (nodeRoom <= 0) {
    return { truncated: true, failed: 0, nodeCount: 0, translated: 0 }
  }

  const { units, map } = collectTextNodes()
  const inBand = units
    .filter((u) => {
      const node = map.get(u.id)
      return node != null && isInBand(node, kind)
    })
    .sort((a, b) => nodeTop(map.get(a.id)!) - nodeTop(map.get(b.id)!))

  const limited = limitPageUnits(inBand, nodeRoom, PAGE_MAX_CHARS)
  if (limited.units.length === 0) {
    return { truncated: limited.truncated, failed: 0, nodeCount: 0, translated: 0 }
  }

  // 本波目标段数；预取续跑时累加 total，避免进度条回退
  if (progressActive) {
    reportProgress({ total: progressDone + limited.units.length })
  } else {
    beginProgress(limited.units.length)
  }

  const batches = batchTextUnits(limited.units)
  let failed = 0

  await mapPool(batches, PAGE_TRANSLATE_CONCURRENCY, async (batch) => {
    if (id !== runId) return
    const n = await translateBatch(batch, map, mode, id)
    failed += n
  })

  if (id !== runId) return empty

  return {
    truncated: limited.truncated || already + limited.units.length >= PAGE_MAX_NODES,
    failed,
    nodeCount: limited.units.length,
    translated: limited.units.length
  }
}

/** 串行泵：滚动密集时合并为「结束后再跑一波」 */
async function pumpPrefetchBand(
  mode: PageMode,
  id: number,
  kind: BandKind
): Promise<BandResult> {
  const empty: BandResult = { truncated: false, failed: 0, nodeCount: 0, translated: 0 }
  if (!prefetchEnabled || id !== runId) return empty

  if (bandBusy) {
    bandPending = true
    return empty
  }

  bandBusy = true
  let last = empty
  try {
    do {
      bandPending = false
      if (id !== runId || !prefetchEnabled) break
      last = await translateBandOnce(mode, id, kind)
    } while (bandPending && id === runId && prefetchEnabled)
  } finally {
    bandBusy = false
  }
  return last
}

/**
 * 后台预取：带内还有未译就连续翻；空了则等滚动/resize 再醒。
 * 实现「读一屏、后台翻后面几屏」，不等人滚到才开始请求。
 */
async function runPrefetchLoop(mode: PageMode, id: number): Promise<void> {
  while (prefetchEnabled && id === runId) {
    const r = await pumpPrefetchBand(mode, id, 'prefetch')
    if (id !== runId || !prefetchEnabled) return
    if (r.truncated) return
    if (r.translated > 0) continue
    await waitPrefetchSignal(id)
  }
}

/** 全量：按文档顺序翻完剩余配额，不挂滚动预取 */
async function translateFullOnce(mode: PageMode, id: number): Promise<BandResult> {
  const empty: BandResult = { truncated: false, failed: 0, nodeCount: 0, translated: 0 }
  if (id !== runId) return empty

  const already = cachedUnitCount()
  const nodeRoom = PAGE_MAX_NODES - already
  if (nodeRoom <= 0) {
    return { truncated: true, failed: 0, nodeCount: 0, translated: 0 }
  }

  const { units, map } = collectTextNodes()
  const limited = limitPageUnits(units, nodeRoom, PAGE_MAX_CHARS)
  if (limited.units.length === 0) {
    return { truncated: limited.truncated, failed: 0, nodeCount: 0, translated: 0 }
  }

  beginProgress(limited.units.length)

  const batches = batchTextUnits(limited.units)
  let failed = 0

  await mapPool(batches, PAGE_TRANSLATE_CONCURRENCY, async (batch) => {
    if (id !== runId) return
    const n = await translateBatch(batch, map, mode, id)
    failed += n
  })

  if (id !== runId) return empty

  return {
    truncated: limited.truncated,
    failed,
    nodeCount: limited.units.length,
    translated: limited.units.length
  }
}

async function translatePage(
  mode: PageMode,
  scope: TranslateScope
): Promise<{
  truncated: boolean
  failed: number
  nodeCount: number
  cacheHits: number
  /** 仍有未译文本时后台会继续预取（仅渐进模式） */
  background: boolean
  scope: TranslateScope
}> {
  stopPrefetch()
  const id = runId
  activeMode = mode
  setFloatingPageMode(mode)

  // 已有缓存的单元先切模式，避免重复打 API
  const cacheHits = applyModeFromCache(mode)

  try {
    if (scope === 'full') {
      const full = await translateFullOnce(mode, id)
      if (id === runId) {
        endProgress(
          true,
          full.failed
            ? `完成（${full.failed} 段失败）`
            : full.truncated
              ? '已达上限'
              : '全量完成'
        )
      }
      return {
        truncated: full.truncated,
        failed: full.failed,
        nodeCount: cacheHits + full.nodeCount,
        cacheHits,
        background: false,
        scope: 'full'
      }
    }

    startPrefetch(mode)
    // 1) 只等当前视口 → 快速出字
    const viewport = await pumpPrefetchBand(mode, id, 'viewport')
    // 2) 立刻后台预取后几屏（不阻塞 popup）；进度条继续跟到后台结束前
    void (async () => {
      await runPrefetchLoop(mode, id)
      if (id === runId && progressActive) {
        endProgress(
          true,
          viewport.failed ? `首屏就绪（${viewport.failed} 段失败）` : '翻译完成'
        )
      }
    })()

    let background = false
    if (prefetchEnabled && id === runId) {
      const { units, map } = collectTextNodes()
      background = units.some((u) => {
        const node = map.get(u.id)
        return node != null && node.isConnected
      })
    }

    // 无后台任务时立刻收尾；有后台则保持 translating
    if (!background && id === runId) {
      endProgress(
        true,
        viewport.failed ? `完成（${viewport.failed} 段失败）` : '首屏就绪'
      )
    } else if (id === runId) {
      reportProgress({ message: '后台预译中…' })
    }

    return {
      truncated: viewport.truncated,
      failed: viewport.failed,
      nodeCount: cacheHits + viewport.nodeCount,
      cacheHits,
      background,
      scope: 'partial'
    }
  } catch (err) {
    if (id === runId) {
      endProgress(false, err instanceof Error ? err.message : String(err))
    }
    throw err
  }
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
        const scope =
          (msg.translateScope as TranslateScope | undefined) ?? settings.translateScope
        const result = await translatePage(mode, scope)
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

  // 仅切展示模式：有缓存则立刻应用，无缓存则 no-op
  if (msg?.type === 'page-translate-apply-mode') {
    void (async () => {
      try {
        const settings = await getExtensionSettings()
        const mode = (msg.pageMode as PageMode | undefined) ?? settings.pageMode
        activeMode = mode
        setFloatingPageMode(mode)
        const cacheHits = applyModeFromCache(mode)
        sendResponse({ ok: true, cacheHits })
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

async function runFromFab(mode: PageMode): Promise<void> {
  const settings = await saveExtensionSettings({ pageMode: mode })
  setFloatingPageMode(mode)
  await translatePage(mode, settings.translateScope)
}

async function setScopeFromFab(scope: TranslateScope): Promise<void> {
  await saveExtensionSettings({ translateScope: scope })
  setFloatingTranslateScope(scope)
}

async function initFloatingButtonUi(): Promise<void> {
  const settings = await getExtensionSettings()
  activeMode = settings.pageMode

  if (!settings.showFloatingButton) {
    unmountFloatingButton()
    return
  }

  setFloatingPageMode(settings.pageMode)
  setFloatingTranslateScope(settings.translateScope)
  mountFloatingButton({
    onPageMode: (mode) => {
      void runFromFab(mode)
    },
    onTranslateScope: (scope) => {
      void setScopeFromFab(scope)
    },
    onClear: () => {
      clearTranslation()
    },
    onPrimary: () => {
      void (async () => {
        const s = await getExtensionSettings()
        await translatePage(s.pageMode, s.translateScope)
      })()
    }
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' && area !== 'local') return
  if (changes.showFloatingButton) {
    const show = changes.showFloatingButton.newValue !== false
    if (show) {
      void initFloatingButtonUi()
    } else {
      unmountFloatingButton()
    }
  }
  if (changes.pageMode?.newValue === 'bilingual' || changes.pageMode?.newValue === 'replace') {
    activeMode = changes.pageMode.newValue
    setFloatingPageMode(changes.pageMode.newValue)
  }
  if (changes.translateScope?.newValue === 'full' || changes.translateScope?.newValue === 'partial') {
    setFloatingTranslateScope(changes.translateScope.newValue)
  }
})

void initFloatingButtonUi()

console.debug('[ai-translator] page-translate content script ready')
