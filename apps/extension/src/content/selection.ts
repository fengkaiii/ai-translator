import { requestTranslate } from '../lib/translate-client'
import { getExtensionSettings, type TargetLang } from '../lib/settings'

const HOST_ID = 'ai-translator-selection-host'
/** 比桌面 32px 更小，减少挡字与误点 */
const ICON_SIZE = 22
/** 图标出现后短时间内忽略点击，避免松手 click 落在图标上直接开窗 */
const ICON_CLICK_GUARD_MS = 400

type UiPhase = 'icon' | 'panel'

type SelectionState = {
  text: string
  result: string
  targetLang: TargetLang | undefined
  loading: boolean
  phase: UiPhase
  status: string
  error: string
  anchor: { top: number; left: number }
}

let state: SelectionState | null = null
let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
/** 图标可点击的最早时间戳 */
let iconClickEnabledAt = 0
/** 关闭后短暂忽略 mouseup，避免选区仍在时立刻又弹出图标 */
let suppressShowUntil = 0
/** 面板是否置顶：失焦不关闭，可继续划词后点图标复用当前窗 */
let panelPinned = false
/** 置顶面板打开时，新划词暂存在图标侧，点图标后再写入面板 */
let iconDraft: { text: string; anchor: { top: number; left: number } } | null = null
/** 面板拖动中：避免 render 把位置重置，并忽略拖动手势触发的外部 mousedown 关闭 */
let panelDragging = false
let dragOffsetX = 0
let dragOffsetY = 0

const FONT =
  '"Helvetica Neue","Avenir Next","Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif'

function guessLang(text: string): TargetLang {
  const zh = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const en = (text.match(/[a-zA-Z]/g) ?? []).length
  return zh >= en ? 'zh' : 'en'
}

function ensureHost(): ShadowRoot {
  if (host && shadow) return shadow
  host = document.createElement('div')
  host.id = HOST_ID
  // 零尺寸 + 不接事件：避免盖住整页导致关不掉 / 点不到页面
  host.style.cssText =
    'all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none;'
  document.documentElement.appendChild(host)
  shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }

      .icon-btn {
        position: fixed;
        width: ${ICON_SIZE}px;
        height: ${ICON_SIZE}px;
        border: none;
        border-radius: 6px;
        padding: 0;
        background: transparent;
        cursor: pointer;
        box-shadow: none;
        z-index: 1;
        pointer-events: auto;
      }
      .icon-btn img {
        display: block;
        width: ${ICON_SIZE}px;
        height: ${ICON_SIZE}px;
        border-radius: 6px;
        pointer-events: none;
      }
      .icon-btn .fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        width: ${ICON_SIZE}px;
        height: ${ICON_SIZE}px;
        border-radius: 6px;
        background: #1a5cff;
        color: #fff;
        font: 600 11px/1 ${FONT};
      }
      .icon-btn:hover { filter: brightness(1.06); }

      .panel {
        position: fixed;
        width: 360px;
        max-width: calc(100vw - 16px);
        max-height: min(280px, calc(100vh - 16px));
        display: flex;
        flex-direction: column;
        padding: 14px 16px 16px;
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,.18);
        font: 14px/1.5 ${FONT};
        overflow: hidden;
        z-index: 2;
        pointer-events: auto;
        color-scheme: light;
        background: #ffffff;
        color: #141822;
      }
      .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
        flex-shrink: 0;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .panel.dragging .status-row { cursor: grabbing; }
      .panel.dragging { user-select: none; }
      .status {
        color: #667085;
        font-size: 12px;
        font-weight: 500;
        min-width: 0;
        flex: 1;
      }
      .status-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .link {
        border: 0;
        background: transparent;
        color: #2f6fed;
        padding: 0;
        margin: 0;
        font: 600 12px/1.2 ${FONT};
        letter-spacing: .02em;
        cursor: pointer;
        flex-shrink: 0;
      }
      .link:hover { opacity: .8; text-decoration: underline; }
      .link:disabled { opacity: .45; cursor: not-allowed; text-decoration: none; }
      .pin-btn {
        border: 0;
        background: transparent;
        padding: 2px;
        margin: 0;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        cursor: pointer;
        color: #667085;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }
      .pin-btn:hover { background: rgba(0,0,0,.06); color: #141822; }
      .pin-btn[aria-pressed='true'] {
        color: #006890;
        background: rgba(0, 104, 144, 0.12);
      }
      .pin-btn svg {
        width: 14px;
        height: 14px;
        display: block;
        pointer-events: none;
      }
      .text {
        white-space: pre-wrap;
        word-break: break-word;
        flex: 1;
        min-height: 2.4em;
        min-width: 0;
        overflow: auto;
      }
      .text.err { color: #c44; }
      .actions {
        margin-top: 18px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      .btn {
        border: 0;
        border-radius: 999px;
        padding: 8px 18px;
        cursor: pointer;
        font: 600 13px/1.2 ${FONT};
        letter-spacing: .01em;
        transition: transform .12s ease, opacity .12s ease, background .15s ease;
      }
      .btn:active:not(:disabled) { transform: scale(.97); }
      .btn:disabled { opacity: .42; cursor: not-allowed; }
      .btn.primary {
        color: #2a3a52;
        background: #e8eef8;
        box-shadow: 0 1px 2px rgba(0,0,0,.06);
      }
      .btn.primary:hover:not(:disabled) { background: #dde6f4; }
      .btn.soft {
        background: rgba(47,111,237,.08);
        color: #141822;
        font-weight: 500;
      }
      .btn.soft:hover:not(:disabled) { background: rgba(47,111,237,.14); }
      .btn.ghost {
        margin-left: auto;
        background: transparent;
        color: #667085;
        font-weight: 500;
        padding: 8px 8px;
      }
      .btn.ghost:hover:not(:disabled) { color: #141822; }

      @media (prefers-color-scheme: dark) {
        .panel {
          color-scheme: dark;
          background: #12151c;
          color: #f0f3f8;
          box-shadow: 0 12px 40px rgba(0,0,0,.45);
        }
        .status { color: #8b93a7; }
        .link { color: #4d8dff; }
        .pin-btn { color: #8b93a7; }
        .pin-btn:hover { background: rgba(255,255,255,.08); color: #f0f3f8; }
        .pin-btn[aria-pressed='true'] {
          color: #5ec4e8;
          background: rgba(0, 104, 144, 0.28);
        }
        .text.err { color: #f88; }
        .btn.primary {
          color: #e8eef5;
          background: #3a4556;
        }
        .btn.primary:hover:not(:disabled) { background: #455264; }
        .btn.soft {
          background: rgba(255,255,255,.08);
          color: #f0f3f8;
        }
        .btn.soft:hover:not(:disabled) { background: rgba(255,255,255,.12); }
        .btn.ghost { color: #8b93a7; }
        .btn.ghost:hover:not(:disabled) { color: #f0f3f8; }
      }
    </style>
    <button class="icon-btn" type="button" title="AI Translator" hidden>
      <span class="fallback">译</span>
    </button>
    <div class="panel" hidden>
      <div class="status-row">
        <div class="status"></div>
        <div class="status-actions">
          <button type="button" class="link" data-act="swap" hidden>→中文</button>
          <button type="button" class="pin-btn" data-act="pin" title="置顶" aria-label="置顶" aria-pressed="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
          </button>
        </div>
      </div>
      <div class="text"></div>
      <div class="actions">
        <button type="button" class="btn primary" data-act="copy">复制</button>
        <button type="button" class="btn soft" data-act="polish">润色</button>
        <button type="button" class="btn ghost" data-act="close">关闭</button>
      </div>
    </div>
  `

  const iconBtn = shadow.querySelector('.icon-btn') as HTMLButtonElement
  const logoUrl = chrome.runtime.getURL('icons/icon-128.png')
  const img = document.createElement('img')
  img.src = logoUrl
  img.width = ICON_SIZE
  img.height = ICON_SIZE
  img.alt = '译'
  img.draggable = false
  img.addEventListener('load', () => {
    iconBtn.querySelector('.fallback')?.remove()
    if (!iconBtn.contains(img)) iconBtn.appendChild(img)
  })
  img.addEventListener('error', () => {
    img.remove()
  })
  iconBtn.appendChild(img)

  iconBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  iconBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    // 松手选区后的残留 click 会落在刚出现的图标上，需忽略
    if (Date.now() < iconClickEnabledAt) return
    void onIconClick()
  })

  const panel = shadow.querySelector('.panel') as HTMLElement
  panel.addEventListener('mousedown', (e) => e.stopPropagation())
  panel.addEventListener('click', (e) => {
    void onPanelClick(e)
  })

  const statusRow = shadow.querySelector('.status-row') as HTMLElement
  statusRow.addEventListener('mousedown', onPanelDragStart)

  return shadow
}

function clampPanelPos(
  top: number,
  left: number,
  panel: HTMLElement
): { top: number; left: number } {
  const w = panel.offsetWidth || 360
  const h = panel.offsetHeight || 80
  return {
    top: Math.min(window.innerHeight - Math.min(h, 48), Math.max(8, top)),
    left: Math.min(window.innerWidth - w - 8, Math.max(8, left))
  }
}

function onPanelDragStart(e: MouseEvent): void {
  if (e.button !== 0 || !state || state.phase !== 'panel') return
  // 点语言切换等按钮不进入拖动
  if ((e.target as HTMLElement).closest('button')) return
  const panel = ensureHost().querySelector('.panel') as HTMLElement
  const rect = panel.getBoundingClientRect()
  panelDragging = true
  dragOffsetX = e.clientX - rect.left
  dragOffsetY = e.clientY - rect.top
  panel.classList.add('dragging')
  e.preventDefault()
  e.stopPropagation()
  document.addEventListener('mousemove', onPanelDragMove, true)
  document.addEventListener('mouseup', onPanelDragEnd, true)
}

function onPanelDragMove(e: MouseEvent): void {
  if (!panelDragging || !state) return
  const panel = ensureHost().querySelector('.panel') as HTMLElement
  const pos = clampPanelPos(e.clientY - dragOffsetY, e.clientX - dragOffsetX, panel)
  panel.style.top = `${pos.top}px`
  panel.style.left = `${pos.left}px`
  state.anchor = pos
}

function onPanelDragEnd(e: MouseEvent): void {
  if (!panelDragging) return
  panelDragging = false
  const panel = shadow?.querySelector('.panel') as HTMLElement | null
  panel?.classList.remove('dragging')
  document.removeEventListener('mousemove', onPanelDragMove, true)
  document.removeEventListener('mouseup', onPanelDragEnd, true)
  e.stopPropagation()
}

function hideIconOnly(): void {
  iconDraft = null
  if (!shadow) return
  ;(shadow.querySelector('.icon-btn') as HTMLElement).hidden = true
}

function hideAll(): void {
  if (panelDragging) {
    panelDragging = false
    document.removeEventListener('mousemove', onPanelDragMove, true)
    document.removeEventListener('mouseup', onPanelDragEnd, true)
  }
  panelPinned = false
  iconDraft = null
  state = null
  suppressShowUntil = Date.now() + 300
  if (!shadow) return
  const panel = shadow.querySelector('.panel') as HTMLElement
  panel.classList.remove('dragging')
  panel.hidden = true
  ;(shadow.querySelector('.icon-btn') as HTMLElement).hidden = true
}

function placeFixed(el: HTMLElement, top: number, left: number, widthHint: number): void {
  const t = Math.min(window.innerHeight - 40, Math.max(8, top))
  const l = Math.min(window.innerWidth - widthHint - 8, Math.max(8, left))
  el.style.top = `${t}px`
  el.style.left = `${l}px`
}

/** 仅展示划词图标；keepPanel 时不关已打开的置顶面板 */
function showIcon(opts?: { keepPanel?: boolean }): void {
  const draft = iconDraft
  if (!draft && !state) return
  const root = ensureHost()
  const icon = root.querySelector('.icon-btn') as HTMLElement
  const panel = root.querySelector('.panel') as HTMLElement
  const anchor = draft?.anchor ?? state!.anchor

  if (!opts?.keepPanel) {
    panel.hidden = true
    if (state) state.phase = 'icon'
  }

  placeFixed(icon, anchor.top, anchor.left, ICON_SIZE)
  iconClickEnabledAt = Date.now() + ICON_CLICK_GUARD_MS
  icon.hidden = false
}

function syncPinButton(root: ShadowRoot): void {
  const pin = root.querySelector('[data-act="pin"]') as HTMLButtonElement
  pin.setAttribute('aria-pressed', panelPinned ? 'true' : 'false')
  pin.title = panelPinned ? '取消置顶' : '置顶'
  pin.setAttribute('aria-label', pin.title)
}

function renderPanel(): void {
  if (!state || state.phase !== 'panel') return
  const root = ensureHost()
  const panel = root.querySelector('.panel') as HTMLElement
  const status = root.querySelector('.status') as HTMLElement
  const textEl = root.querySelector('.text') as HTMLElement
  const swap = root.querySelector('[data-act="swap"]') as HTMLButtonElement
  const polish = root.querySelector('[data-act="polish"]') as HTMLButtonElement
  const copy = root.querySelector('[data-act="copy"]') as HTMLButtonElement

  status.textContent = state.status
  syncPinButton(root)

  const hasResult = Boolean(state.result)
  if (hasResult) {
    const lang = state.targetLang ?? guessLang(state.result || state.text)
    swap.hidden = false
    swap.textContent = lang === 'zh' ? '→英文' : '→中文'
    swap.disabled = state.loading
  } else {
    swap.hidden = true
  }

  polish.disabled = !state.result || state.loading
  copy.disabled = !state.result || state.loading

  if (state.error) {
    textEl.className = 'text err'
    textEl.textContent = state.error
  } else {
    textEl.className = 'text'
    textEl.textContent = state.result
  }

  if (!panelDragging) {
    placeFixed(panel, state.anchor.top, state.anchor.left, 360)
  }
  panel.hidden = false
}

async function runTranslate(targetLang?: TargetLang): Promise<void> {
  if (!state) return
  state.loading = true
  state.error = ''
  state.status = state.status === '切换中…' ? '切换中…' : '翻译中…'
  renderPanel()
  try {
    const result = await requestTranslate({
      text: state.text,
      mode: 'translate',
      targetLang: targetLang ?? state.targetLang
    })
    if (!state) return
    state.result = result
    state.targetLang = targetLang ?? state.targetLang ?? guessLang(result)
    state.loading = false
    state.status = '翻译结果'
    renderPanel()
  } catch (err) {
    if (!state) return
    state.loading = false
    state.status = '翻译失败'
    state.error = err instanceof Error ? err.message : String(err)
    renderPanel()
  }
}

async function openPanelAndTranslate(): Promise<void> {
  if (!state || state.phase === 'panel') return
  const root = ensureHost()
  ;(root.querySelector('.icon-btn') as HTMLElement).hidden = true
  iconDraft = null
  state.phase = 'panel'
  state.result = ''
  state.error = ''
  state.loading = true
  state.status = '翻译中…'
  // 打开面板时再读设置（图标阶段不阻塞）
  try {
    const settings = await getExtensionSettings()
    if (state && state.targetLang === undefined) {
      state.targetLang = settings.targetLang
    }
  } catch {
    /* 忽略，沿用已有 targetLang */
  }
  renderPanel()
  await runTranslate()
}

/** 置顶面板已开：用新划词复用当前窗口（位置/置顶状态不变） */
async function reusePanelWithDraft(): Promise<void> {
  if (!state || state.phase !== 'panel' || !iconDraft) return
  const text = iconDraft.text
  hideIconOnly()
  suppressShowUntil = Date.now() + 300
  state.text = text
  state.result = ''
  state.error = ''
  state.targetLang = undefined
  state.loading = true
  state.status = '翻译中…'
  try {
    const settings = await getExtensionSettings()
    if (state) state.targetLang = settings.targetLang
  } catch {
    /* ignore */
  }
  renderPanel()
  await runTranslate()
}

async function onIconClick(): Promise<void> {
  // 置顶小窗仍在：点划词图标复用当前面板
  if (state?.phase === 'panel' && panelPinned && iconDraft) {
    await reusePanelWithDraft()
    return
  }
  await openPanelAndTranslate()
}

function resolveLanguageSwap(
  source: string,
  currentTarget: TargetLang | undefined,
  translation: string
): { next: TargetLang; showSource: boolean } {
  const sourceLang = guessLang(source)
  const current =
    currentTarget ??
    (translation ? guessLang(translation) : sourceLang === 'zh' ? 'en' : 'zh')
  const next: TargetLang = current === 'zh' ? 'en' : 'zh'
  return { next, showSource: next === sourceLang }
}

async function onPanelClick(ev: Event): Promise<void> {
  const btn = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null
  if (!btn || !state) return
  const act = btn.dataset.act
  if (act === 'close') {
    hideAll()
    return
  }
  if (act === 'pin') {
    panelPinned = !panelPinned
    syncPinButton(ensureHost())
    return
  }
  if (act === 'copy') {
    if (state.result) await navigator.clipboard.writeText(state.result)
    return
  }
  if (act === 'polish') {
    if (!state.result || state.loading) return
    state.loading = true
    state.error = ''
    state.status = '润色中…'
    renderPanel()
    try {
      const result = await requestTranslate({
        text: state.text,
        mode: 'polish',
        previousTranslation: state.result,
        targetLang: state.targetLang
      })
      if (!state) return
      state.result = result
      state.loading = false
      state.status = '润色结果'
      renderPanel()
    } catch (err) {
      if (!state) return
      state.loading = false
      state.status = '润色失败'
      state.error = err instanceof Error ? err.message : String(err)
      renderPanel()
    }
    return
  }
  if (act === 'swap') {
    if (!state.result || state.loading) return
    const { next, showSource } = resolveLanguageSwap(
      state.text,
      state.targetLang,
      state.result
    )
    if (showSource) {
      state.targetLang = next
      state.result = state.text
      state.error = ''
      state.status = '翻译结果'
      renderPanel()
      return
    }
    state.status = '切换中…'
    await runTranslate(next)
  }
}

function selectionAnchor(): { top: number; left: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  // 放在选区右下外侧，减少落在松手光标正下方
  return {
    top: rect.bottom + 6,
    left: Math.min(rect.right + 6, window.innerWidth - ICON_SIZE - 8)
  }
}

function onMouseUp(): void {
  if (Date.now() < suppressShowUntil) return

  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''

  // 置顶面板打开：允许继续划词出图标，点图标复用当前窗
  if (state?.phase === 'panel') {
    if (!panelPinned) return
    if (!text) {
      hideIconOnly()
      return
    }
    const anchor = selectionAnchor()
    if (!anchor) return
    if (iconDraft?.text === text) {
      placeFixed(
        ensureHost().querySelector('.icon-btn') as HTMLElement,
        anchor.top,
        anchor.left,
        ICON_SIZE
      )
      iconDraft.anchor = anchor
      return
    }
    iconDraft = { text, anchor }
    showIcon({ keepPanel: true })
    return
  }

  if (!text) {
    if (state?.phase === 'icon') hideAll()
    return
  }

  const anchor = selectionAnchor()
  if (!anchor) return

  // 同一选区重复 mouseup（如点图标被 guard 掉）不重置 guard
  if (state?.phase === 'icon' && state.text === text) {
    placeFixed(
      ensureHost().querySelector('.icon-btn') as HTMLElement,
      anchor.top,
      anchor.left,
      ICON_SIZE
    )
    state.anchor = anchor
    return
  }

  iconDraft = null
  state = {
    text,
    result: '',
    targetLang: undefined,
    loading: false,
    phase: 'icon',
    status: '',
    error: '',
    anchor
  }
  showIcon()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') hideAll()
}

function onDocMouseDown(e: MouseEvent): void {
  if (!host || !state) return
  if (panelDragging) return
  const path = e.composedPath()
  if (path.includes(host)) return
  // 置顶：失焦 / 点页面其它处不关闭
  if (panelPinned && state.phase === 'panel') return
  hideAll()
}

// 用 click 之后的时机展示图标，避免与「松手 click」抢同一手势
document.addEventListener('mouseup', () => {
  window.setTimeout(() => onMouseUp(), 0)
})
document.addEventListener('keydown', onKeyDown)
document.addEventListener('mousedown', onDocMouseDown, true)

console.debug('[ai-translator] selection content script ready')
