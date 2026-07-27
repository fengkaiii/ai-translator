import type { PageMode, TranslateScope } from '../lib/settings'

const HOST_ID = 'ai-translator-fab-host'
/** 与桌面端 --accent 一致 */
const ACCENT = '#006890'
const ACCENT_HOVER = '#005678'
const ACCENT_SOFT = 'rgba(0, 104, 144, 0.18)'
const ACCENT_SHADOW = 'rgba(0, 104, 144, 0.38)'
const FAB_SIZE = 48
const DRAG_THRESHOLD_PX = 5
const POS_KEY = 'ai-translator-fab-pos'
const FONT =
  '"Helvetica Neue","Avenir Next","Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif'

export type FabPhase = 'idle' | 'translating' | 'done' | 'error'

export type FabProgress = {
  phase: FabPhase
  /** 本波已完成段数 */
  done: number
  /** 本波目标段数；0 表示不确定 */
  total: number
  message?: string
}

export type FabHandlers = {
  onPageMode: (mode: PageMode) => void
  onTranslateScope: (scope: TranslateScope) => void
  onClear: () => void
  onPrimary: () => void
}

/** 浮动按钮左上角坐标（不含菜单，避免显隐导致跳动） */
type FabPos = { left: number; top: number }

let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let progress: FabProgress = { phase: 'idle', done: 0, total: 0 }
let pageMode: PageMode = 'bilingual'
let translateScope: TranslateScope = 'partial'
let handlers: FabHandlers | null = null
let hideTimer = 0
let menuCloseTimer = 0
let fabPos: FabPos | null = loadPos()

const MENU_CLOSE_DELAY_MS = 280

let dragging = false
let dragMoved = false
let pointerId: number | null = null
let dragOffsetX = 0
let dragOffsetY = 0
let dragStartX = 0
let dragStartY = 0

function iconUrl(): string {
  try {
    return chrome.runtime.getURL('icons/icon-128.png')
  } catch {
    return ''
  }
}

function loadPos(): FabPos | null {
  try {
    const raw = sessionStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as FabPos
    if (typeof p.left !== 'number' || typeof p.top !== 'number') return null
    return clampPos(p.left, p.top)
  } catch {
    return null
  }
}

function savePos(pos: FabPos): void {
  fabPos = pos
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch {
    // ignore quota / private mode
  }
}

function clampPos(left: number, top: number): FabPos {
  const margin = 8
  const maxL = Math.max(margin, window.innerWidth - FAB_SIZE - margin)
  const maxT = Math.max(margin, window.innerHeight - FAB_SIZE - margin)
  return {
    left: Math.min(maxL, Math.max(margin, left)),
    top: Math.min(maxT, Math.max(margin, top))
  }
}

/** 默认右下角 → 换成 left/top，后续拖动只改这两个值 */
function defaultPos(): FabPos {
  return clampPos(window.innerWidth - FAB_SIZE - 20, window.innerHeight - FAB_SIZE - 24)
}

function applyFabPosition(): void {
  if (!shadow) return
  const wrap = shadow.querySelector('.wrap') as HTMLElement
  const pos = fabPos ?? defaultPos()
  wrap.style.left = `${pos.left}px`
  wrap.style.top = `${pos.top}px`
  wrap.style.right = 'auto'
  wrap.style.bottom = 'auto'
}

function ensureDom(): ShadowRoot {
  if (host && shadow) return shadow

  host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText =
    'all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483645;pointer-events:none;'
  document.documentElement.appendChild(host)
  shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }

      /* 固定为按钮尺寸；菜单绝对定位，不参与布局，避免拖动乱跳 */
      .wrap {
        position: fixed;
        width: ${FAB_SIZE}px;
        height: ${FAB_SIZE}px;
        pointer-events: auto;
        font-family: ${FONT};
        z-index: 1;
        touch-action: none;
      }
      .wrap.dragging .menu,
      .wrap.dragging.menu-open .menu { display: none !important; }
      .wrap.dragging .fab { cursor: grabbing; }

      .menu {
        display: none;
        position: absolute;
        right: 0;
        /* 贴住按钮上沿；空隙用 ::after 桥接，慢移也不会断 hover */
        bottom: 100%;
        flex-direction: column;
        min-width: 156px;
        padding: 6px;
        margin-bottom: 8px;
        border-radius: 10px;
        background: #fff;
        color: #141822;
        box-shadow: 0 10px 28px rgba(0,0,0,.18);
        border: 1px solid rgba(0,0,0,.06);
      }
      /* 透明热区：盖住菜单与按钮之间的空隙 */
      .menu::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 100%;
        height: 14px;
      }
      .wrap:not(.dragging).menu-open .menu,
      .wrap:not(.dragging):focus-within .menu {
        display: flex;
      }
      .menu .section {
        font-size: 11px;
        color: #667085;
        padding: 4px 8px 2px;
      }
      .menu button {
        appearance: none;
        border: none;
        background: transparent;
        text-align: left;
        padding: 8px 10px;
        border-radius: 7px;
        font: 500 13px/1.3 ${FONT};
        color: #141822;
        cursor: pointer;
        white-space: nowrap;
      }
      .menu button:hover { background: #f2f4f7; }
      .menu button[aria-pressed='true'] {
        background: ${ACCENT_SOFT};
        color: ${ACCENT};
      }
      .menu .sep {
        height: 1px;
        margin: 4px 6px;
        background: #e5e7eb;
      }

      .fab {
        position: relative;
        width: ${FAB_SIZE}px;
        height: ${FAB_SIZE}px;
        border: none;
        border-radius: 50%;
        padding: 0;
        cursor: grab;
        background: ${ACCENT};
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.12),
          0 8px 20px ${ACCENT_SHADOW};
        color: #fff;
        display: grid;
        place-items: center;
        user-select: none;
      }
      .fab:hover { background: ${ACCENT_HOVER}; }
      .fab img {
        width: 34px;
        height: 34px;
        /* 圆形裁切，去掉方图标硬边框感 */
        border-radius: 50%;
        display: block;
        pointer-events: none;
        /* 轻阴影，避免描边感过重 */
        filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.18));
        opacity: 0.92;
      }
      .fab .fallback {
        font: 700 15px/1 ${FONT};
        pointer-events: none;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
      }

      .ring {
        position: absolute;
        inset: -3px;
        border-radius: 50%;
        pointer-events: none;
      }
      .badge {
        position: absolute;
        right: -4px;
        bottom: -2px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 9px;
        background: #0b0d12;
        color: #fff;
        font: 600 10px/18px ${FONT};
        text-align: center;
        pointer-events: none;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      }
      .spin {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 2px solid transparent;
        border-top-color: #fff;
        animation: spin .8s linear infinite;
        opacity: .9;
        pointer-events: none;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
    <div class="wrap" part="wrap">
      <div class="menu" role="menu" aria-label="翻译快捷菜单">
        <div class="section">展示模式</div>
        <button type="button" data-page-mode="bilingual" role="menuitemradio" aria-pressed="false">双语对照</button>
        <button type="button" data-page-mode="replace" role="menuitemradio" aria-pressed="false">原文替换</button>
        <div class="sep"></div>
        <div class="section">翻译模式</div>
        <button type="button" data-scope="partial" role="menuitemradio" aria-pressed="false">渐进</button>
        <button type="button" data-scope="full" role="menuitemradio" aria-pressed="false">全量</button>
        <div class="sep"></div>
        <button type="button" data-action="clear" role="menuitem">清除 / 还原</button>
      </div>
      <button type="button" class="fab" aria-label="AI Translator">
        <svg class="ring" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
          <circle cx="27" cy="27" r="25" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"></circle>
          <circle class="progress-arc" cx="27" cy="27" r="25" fill="none" stroke="#fff" stroke-width="3"
            stroke-linecap="round" stroke-dasharray="157" stroke-dashoffset="157"
            transform="rotate(-90 27 27)"></circle>
        </svg>
        <span class="spin" hidden></span>
        <img alt="" hidden />
        <span class="fallback">译</span>
        <span class="badge" hidden></span>
      </button>
    </div>
  `

  const wrap = shadow.querySelector('.wrap') as HTMLElement
  const fab = shadow.querySelector('.fab') as HTMLButtonElement
  const img = fab.querySelector('img') as HTMLImageElement
  const url = iconUrl()
  if (url) {
    img.src = url
    img.hidden = false
    ;(fab.querySelector('.fallback') as HTMLElement).hidden = true
    img.onerror = () => {
      img.hidden = true
      ;(fab.querySelector('.fallback') as HTMLElement).hidden = false
    }
  }

  const openMenu = (): void => {
    if (menuCloseTimer) {
      window.clearTimeout(menuCloseTimer)
      menuCloseTimer = 0
    }
    wrap.classList.add('menu-open')
  }
  const scheduleCloseMenu = (): void => {
    if (menuCloseTimer) window.clearTimeout(menuCloseTimer)
    menuCloseTimer = window.setTimeout(() => {
      wrap.classList.remove('menu-open')
      menuCloseTimer = 0
    }, MENU_CLOSE_DELAY_MS)
  }
  wrap.addEventListener('pointerenter', openMenu)
  wrap.addEventListener('pointerleave', scheduleCloseMenu)

  fab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    // 只用按钮矩形算偏移；wrap 已固定为按钮尺寸
    const rect = fab.getBoundingClientRect()
    dragging = true
    dragMoved = false
    pointerId = e.pointerId
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragOffsetX = e.clientX - rect.left
    dragOffsetY = e.clientY - rect.top
    wrap.classList.add('dragging')
    fab.setPointerCapture(e.pointerId)
  })

  fab.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return
    if (!dragMoved) {
      if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < DRAG_THRESHOLD_PX) {
        return
      }
      dragMoved = true
      // 首次进入拖动：固化为 left/top，避免仍用默认 right/bottom
      if (!fabPos) fabPos = defaultPos()
    }
    fabPos = clampPos(e.clientX - dragOffsetX, e.clientY - dragOffsetY)
    applyFabPosition()
  })

  const endDrag = (e: PointerEvent) => {
    if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return
    dragging = false
    pointerId = null
    wrap.classList.remove('dragging')
    try {
      fab.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    if (dragMoved && fabPos) {
      savePos(clampPos(fabPos.left, fabPos.top))
      applyFabPosition()
      return
    }
    handlers?.onPrimary()
  }

  fab.addEventListener('pointerup', endDrag)
  fab.addEventListener('pointercancel', endDrag)

  shadow.querySelectorAll<HTMLButtonElement>('[data-page-mode]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handlers?.onPageMode(btn.dataset.pageMode as PageMode)
    })
  })

  shadow.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handlers?.onTranslateScope(btn.dataset.scope as TranslateScope)
    })
  })

  shadow.querySelector('[data-action="clear"]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers?.onClear()
  })

  window.addEventListener('resize', onResize)
  applyFabPosition()
  return shadow
}

function onResize(): void {
  if (fabPos) fabPos = clampPos(fabPos.left, fabPos.top)
  applyFabPosition()
}

function render(): void {
  if (!shadow) return
  const fab = shadow.querySelector('.fab') as HTMLButtonElement
  const spin = shadow.querySelector('.spin') as HTMLElement
  const badge = shadow.querySelector('.badge') as HTMLElement
  const arc = shadow.querySelector('.progress-arc') as SVGCircleElement
  const circ = 2 * Math.PI * 25

  shadow.querySelectorAll<HTMLButtonElement>('[data-page-mode]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.pageMode === pageMode ? 'true' : 'false')
  })
  shadow.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.scope === translateScope ? 'true' : 'false')
  })

  const translating = progress.phase === 'translating'
  spin.hidden = !(translating && progress.total <= 0)

  if (translating && progress.total > 0) {
    const ratio = Math.min(1, progress.done / progress.total)
    arc.setAttribute('stroke-dashoffset', String(circ * (1 - ratio)))
    badge.hidden = false
    badge.textContent =
      progress.total >= 100
        ? `${Math.round(ratio * 100)}%`
        : `${progress.done}/${progress.total}`
  } else if (translating) {
    arc.setAttribute('stroke-dashoffset', String(circ))
    badge.hidden = false
    badge.textContent = progress.done > 0 ? String(progress.done) : '…'
  } else if (progress.phase === 'done') {
    arc.setAttribute('stroke-dashoffset', '0')
    badge.hidden = false
    badge.textContent = '✓'
  } else if (progress.phase === 'error') {
    arc.setAttribute('stroke-dashoffset', String(circ))
    badge.hidden = false
    badge.textContent = '!'
  } else {
    arc.setAttribute('stroke-dashoffset', String(circ))
    badge.hidden = true
  }

  fab.title =
    progress.message ||
    (translating
      ? '翻译中…'
      : progress.phase === 'done'
        ? '翻译完成'
        : progress.phase === 'error'
          ? '翻译失败'
          : '拖动可移动 · 点击翻译此页')
  fab.setAttribute('aria-busy', translating ? 'true' : 'false')
}

export function mountFloatingButton(next: FabHandlers): void {
  handlers = next
  ensureDom()
  render()
}

export function unmountFloatingButton(): void {
  if (hideTimer) {
    window.clearTimeout(hideTimer)
    hideTimer = 0
  }
  if (menuCloseTimer) {
    window.clearTimeout(menuCloseTimer)
    menuCloseTimer = 0
  }
  window.removeEventListener('resize', onResize)
  handlers = null
  host?.remove()
  host = null
  shadow = null
  dragging = false
  pointerId = null
}

export function setFloatingVisible(visible: boolean): void {
  if (!visible) {
    unmountFloatingButton()
    return
  }
  if (!handlers) return
  ensureDom()
  render()
}

export function setFloatingPageMode(mode: PageMode): void {
  pageMode = mode
  render()
}

export function setFloatingTranslateScope(scope: TranslateScope): void {
  translateScope = scope
  render()
}

export function setFloatingProgress(next: FabProgress): void {
  progress = next
  if (hideTimer) {
    window.clearTimeout(hideTimer)
    hideTimer = 0
  }
  // 完成态短暂展示后回到 idle
  if (next.phase === 'done' || next.phase === 'error') {
    hideTimer = window.setTimeout(() => {
      progress = { phase: 'idle', done: 0, total: 0 }
      render()
      hideTimer = 0
    }, 2400)
  }
  render()
}
