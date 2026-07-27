import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  systemPreferences,
  nativeTheme
} from 'electron'
import { join } from 'path'
import { getSettings } from './settings'
import { getSelectedText, getFrontmostAppName, shouldSkipSelection } from './selection-text'
import { translateText } from './translate'
import type { TargetLang } from './deepseek'
import { requestAccessibility } from './accessibility'
import { getLogoDataUrl } from './logo'

let getMainWindow: (() => BrowserWindow | null) | null = null

let iconWin: BrowserWindow | null = null
let popupWin: BrowserWindow | null = null
let lastText = ''
let popupSource = ''
let popupTranslation = ''
/** 当前小窗译文目标语言；null 表示上次为自动判定 */
let popupTargetLang: TargetLang | null = null
let running = false
let handling = false
let hideTimer: NodeJS.Timeout | null = null
let mouseHook: { start: () => void; stop: () => void; on: Function; off?: Function } | null =
  null
let mouseupHandler: ((e: { button: number; x: number; y: number }) => void) | null = null
let mousedownHandler: ((e: { button: number; x: number; y: number }) => void) | null = null
let downPos: { x: number; y: number } | null = null
let dismissedOnDown = false
let downAt = 0
let lastClickAt = 0
let clickCount = 0
/** 合并双击：等选区稳定后再取词，避免第二次 mouseup 被 handling 丢掉 */
let selectionDebounce: NodeJS.Timeout | null = null
let selectionSeq = 0
const ICON_SIZE = 32
const ICON_OFFSET = 4

/**
 * 划词发起时本应用并未持有焦点（用户在别的 App 里选字）。
 * 关闭小窗后应把焦点还给系统，不能留下主窗口挡在前面。
 */
let auxFromBackground = false
let mainHiddenByAux = false

export function initSelectionWindows(deps: {
  getMainWindow: () => BrowserWindow | null
}): void {
  getMainWindow = deps.getMainWindow
}

function resolvePopupTheme(): 'dark' | 'light' {
  const theme = getSettings().theme
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function isPointOnIcon(x: number, y: number): boolean {
  if (!iconWin || iconWin.isDestroyed() || !iconWin.isVisible()) return false
  const [ix, iy] = iconWin.getPosition()
  const [iw, ih] = iconWin.getSize()
  return x >= ix && x <= ix + iw && y >= iy && y <= iy + ih
}

function isIconVisible(): boolean {
  return !!iconWin && !iconWin.isDestroyed() && iconWin.isVisible()
}

/** 当前是否由本应用任一窗口持有焦点 */
function appHasFocus(): boolean {
  return BrowserWindow.getFocusedWindow() != null
}

/**
 * 划词场景下若主窗口被系统误拉到前台，先藏起来。
 * 小窗关闭后再 app.hide()，把前台还给用户原来的 App。
 */
function demoteMainIfStolen(): void {
  if (!auxFromBackground) return
  const main = getMainWindow?.() ?? null
  if (!main || main.isDestroyed()) return
  if (main.isFocused()) {
    main.hide()
    mainHiddenByAux = true
  }
}

function restorePreviousAppAfterAux(): void {
  if (!auxFromBackground) return
  auxFromBackground = false
  mainHiddenByAux = false
  if (process.platform === 'darwin') {
    // 关闭小窗后系统会聚焦主窗；hide 整应用以交还前台
    setTimeout(() => {
      app.hide()
    }, 30)
  }
}

function iconHtml(): string {
  const logo = getLogoDataUrl()
  const s = ICON_SIZE
  const inner = logo
    ? `<img src="${logo}" width="${s}" height="${s}" alt="译" draggable="false" />`
    : `<span class="fallback">译</span>`
  return `<!doctype html>
<html><head><meta charset="UTF-8"/>
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%}
  button{
    width:${s}px;height:${s}px;border:none;border-radius:8px;padding:0;
    background:transparent;cursor:pointer;box-shadow:none;
  }
  button img{display:block;width:${s}px;height:${s}px;border-radius:8px;pointer-events:none}
  button .fallback{
    display:flex;align-items:center;justify-content:center;
    width:${s}px;height:${s}px;border-radius:8px;
    background:#1a5cff;color:#fff;font-size:12px;font-weight:600;
  }
  button:hover{filter:brightness(1.06)}
</style></head>
<body>
  <button id="btn" title="AI Translator">${inner}</button>
  <script>
    document.getElementById('btn').onclick = () => {
      window.translatorSelection?.translateSelection()
    }
  </script>
</body></html>`
}

/** 粗判文本主语言，用于切换时翻到另一边 */
function guessLang(text: string): TargetLang {
  const zh = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const en = (text.match(/[a-zA-Z]/g) ?? []).length
  return zh >= en ? 'zh' : 'en'
}

function popupHtml(
  text: string,
  status: string,
  options?: { showActions?: boolean; targetLang?: TargetLang | null }
): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const showActions = Boolean(options?.showActions)
  const dirLabel =
    options?.targetLang === 'zh'
      ? '→英文'
      : options?.targetLang === 'en'
        ? '→中文'
        : ''
  const polishBtn = showActions
    ? `<button type="button" class="btn soft" id="polish">润色</button>`
    : ''
  const swapBtn =
    showActions && dirLabel
      ? `<button type="button" class="link" id="swap" title="切换为${dirLabel.slice(1)}">${dirLabel}</button>`
      : ''
  const theme = resolvePopupTheme()
  const isDark = theme === 'dark'
  const bg = isDark ? '#12151c' : '#ffffff'
  const textColor = isDark ? '#f0f3f8' : '#141822'
  const muted = isDark ? '#8b93a7' : '#667085'
  // 按钮主题色对齐图标青绿；主按钮与设置页选中态同款（淡底+强调字）
  const softBg = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,104,144,.12)'
  const softHover = isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,104,144,.18)'
  const accent = '#006890'
  const btnBg = isDark ? '#1c212c' : '#e8ecf3'
  const primaryBg = `color-mix(in srgb, ${accent} 22%, ${btnBg})`
  const primaryFg = accent
  const primaryHover = `color-mix(in srgb, ${accent} 32%, ${btnBg})`
  const primaryEdge = 'rgba(0,104,144,.55)'
  const font =
    '"Helvetica Neue","Avenir Next","Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif'
  return `<!doctype html>
<html data-theme="${theme}"><head><meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;background:${bg};color:${textColor};font:14px/1.5 ${font};color-scheme:${theme}}
  .wrap{padding:14px 16px 16px;height:100vh;overflow:hidden;display:flex;flex-direction:column}
  .status-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-shrink:0}
  .status{color:${muted};font-size:12px;font-weight:500;min-width:0}
  .link{border:0;background:transparent;color:${accent};padding:0;margin:0;font:12px/1.2 ${font};font-weight:600;letter-spacing:.02em;cursor:pointer;flex-shrink:0}
  .link:hover{opacity:.8;text-decoration:underline}
  .link:disabled{opacity:.45;cursor:not-allowed;text-decoration:none}
  .text{white-space:pre-wrap;word-break:break-word;flex:1;min-height:0;overflow:auto}
  .actions{margin-top:18px;display:flex;align-items:center;gap:10px;flex-shrink:0}
  .btn{
    border:0;border-radius:999px;padding:8px 18px;cursor:pointer;
    font:13px/1.2 ${font};font-weight:600;letter-spacing:.01em;
    transition:transform .12s ease,opacity .12s ease,background .15s ease,box-shadow .15s ease
  }
  .btn:active:not(:disabled){transform:scale(.97)}
  .btn:disabled{opacity:.42;cursor:not-allowed}
  .btn.primary{
    color:${primaryFg};background:${primaryBg};
    border:1px solid ${primaryEdge};
    box-shadow:0 1px 2px rgba(0,0,0,.06)
  }
  .btn.primary:hover:not(:disabled){background:${primaryHover}}
  .btn.soft{background:${softBg};color:${textColor};font-weight:500}
  .btn.soft:hover:not(:disabled){background:${softHover}}
  .btn.ghost{
    margin-left:auto;background:transparent;color:${muted};font-weight:500;padding:8px 8px
  }
  .btn.ghost:hover:not(:disabled){color:${textColor}}
</style></head>
<body>
  <div class="wrap">
    <div class="status-row">
      <div class="status" id="status">${status}</div>
      ${swapBtn}
    </div>
    <div class="text" id="text">${escaped}</div>
    <div class="actions">
      <button type="button" class="btn primary" id="copy">复制</button>
      ${polishBtn}
      <button type="button" class="btn ghost" id="close">关闭</button>
    </div>
  </div>
  <script>
    document.getElementById('copy').onclick = () => {
      navigator.clipboard.writeText(document.getElementById('text').innerText)
    }
    document.getElementById('close').onclick = () => window.close()
    const polish = document.getElementById('polish')
    if (polish) {
      polish.onclick = async () => {
        polish.disabled = true
        const swap = document.getElementById('swap')
        if (swap) swap.disabled = true
        document.getElementById('status').textContent = '润色中…'
        try {
          await window.translatorSelection?.polishSelection()
        } finally {
          polish.disabled = false
          if (swap) swap.disabled = false
        }
      }
    }
    const swap = document.getElementById('swap')
    if (swap) {
      swap.onclick = async () => {
        swap.disabled = true
        const polishBtn = document.getElementById('polish')
        if (polishBtn) polishBtn.disabled = true
        document.getElementById('status').textContent = '切换中…'
        try {
          if (!window.translatorSelection?.swapSelectionLanguage) {
            throw new Error('切换功能未就绪，请重启应用')
          }
          await window.translatorSelection.swapSelectionLanguage()
        } catch (err) {
          document.getElementById('status').textContent =
            err instanceof Error ? err.message : '切换失败'
          swap.disabled = false
          if (polishBtn) polishBtn.disabled = false
        }
      }
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
  </script>
</body></html>`
}

function ensureIconWindow(): BrowserWindow {
  if (iconWin && !iconWin.isDestroyed()) {
    const [w, h] = iconWin.getSize()
    if (w !== ICON_SIZE || h !== ICON_SIZE) {
      iconWin.destroy()
      iconWin = null
    } else {
      return iconWin
    }
  }

  iconWin = new BrowserWindow({
    width: ICON_SIZE,
    height: ICON_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    hasShadow: false,
    fullscreenable: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  iconWin.setAlwaysOnTop(true, 'floating')
  iconWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  if (process.platform === 'darwin') {
    try {
      iconWin.setHasShadow(false)
    } catch {
      // ignore
    }
  }
  iconWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(iconHtml())}`)
  return iconWin
}

function showIconNearCursor(text: string): void {
  lastText = text
  if (!appHasFocus()) {
    auxFromBackground = true
  }
  const point = screen.getCursorScreenPoint()
  const win = ensureIconWindow()
  const display = screen.getDisplayNearestPoint(point)
  // 紧贴光标/选区右下一点，避免离文字太远
  const x = Math.min(
    point.x + ICON_OFFSET,
    display.workArea.x + display.workArea.width - ICON_SIZE - 2
  )
  const y = Math.min(
    point.y + ICON_OFFSET,
    display.workArea.y + display.workArea.height - ICON_SIZE - 2
  )
  win.setPosition(Math.max(display.workArea.x, x), Math.max(display.workArea.y, y))
  win.showInactive()
  setTimeout(() => demoteMainIfStolen(), 40)

  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => hideIcon(), 15000)
}

function hideIcon(options?: { handoffToPopup?: boolean }): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  lastText = ''
  if (iconWin && !iconWin.isDestroyed()) iconWin.hide()
  // 图标消失且没有接着打开小窗时，交还前台
  if (
    !options?.handoffToPopup &&
    auxFromBackground &&
    (!popupWin || popupWin.isDestroyed())
  ) {
    restorePreviousAppAfterAux()
  }
}

function destroyAuxWindows(): void {
  hideIcon()
  if (iconWin && !iconWin.isDestroyed()) {
    iconWin.destroy()
    iconWin = null
  }
  if (popupWin && !popupWin.isDestroyed()) {
    popupWin.destroy()
    popupWin = null
  }
}

function loadPopupContent(
  text: string,
  status: string,
  options?: { showActions?: boolean; targetLang?: TargetLang | null }
): void {
  if (!popupWin || popupWin.isDestroyed()) return
  popupWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(popupHtml(text, status, options))}`
  )
}

function statusLabel(kind: 'result' | 'polish'): string {
  return kind === 'polish' ? '润色结果' : '翻译结果'
}

async function openPopupWithTranslation(
  source: string,
  targetLang?: TargetLang,
  options?: { keepPosition?: boolean }
): Promise<void> {
  // 从图标切到小窗：不要在 hideIcon 时 app.hide()
  const wasBackground = auxFromBackground || !appHasFocus()
  hideIcon({ handoffToPopup: true })
  auxFromBackground = wasBackground

  popupSource = source
  popupTranslation = ''
  popupTargetLang = targetLang ?? null

  const point = screen.getCursorScreenPoint()
  const bg = resolvePopupTheme() === 'dark' ? '#12151c' : '#ffffff'
  const x = point.x + 12
  const y = point.y + 12

  // 小窗已打开时复用，避免 destroy→closed→app.hide() 把新内容也关掉
  if (!popupWin || popupWin.isDestroyed()) {
    popupWin = new BrowserWindow({
      width: 380,
      height: 280,
      x,
      y,
      frame: true,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      show: false,
      title: 'AI Translator',
      backgroundColor: bg,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    popupWin.setAlwaysOnTop(true, 'floating')
    popupWin.on('closed', () => {
      popupWin = null
      popupSource = ''
      popupTranslation = ''
      popupTargetLang = null
      restorePreviousAppAfterAux()
    })
  } else {
    popupWin.setBackgroundColor(bg)
    if (!options?.keepPosition) {
      popupWin.setPosition(x, y)
    }
  }

  const showPopup = (): void => {
    if (!popupWin || popupWin.isDestroyed()) return
    popupWin.showInactive()
    setTimeout(() => demoteMainIfStolen(), 40)
  }
  if (!popupWin.isVisible()) {
    popupWin.once('ready-to-show', showPopup)
  }
  const loadingLabel =
    targetLang === 'zh' ? '译为中文…' : targetLang === 'en' ? '译为英文…' : '翻译中…'
  loadPopupContent('…', loadingLabel)
  showPopup()

  try {
    const result = await translateText(getSettings(), {
      text: source,
      mode: 'translate',
      targetLang
    })
    // 期间若又发起了新翻译，丢弃过期结果
    if (popupSource !== source) return
    popupTranslation = result
    // 自动模式下根据译文粗判方向，便于下次「切换」
    popupTargetLang = targetLang ?? guessLang(result)
    loadPopupContent(result, statusLabel('result'), {
      showActions: true,
      targetLang: popupTargetLang
    })
  } catch (err) {
    if (popupSource !== source) return
    const msg = err instanceof Error ? err.message : '翻译失败'
    loadPopupContent(msg, '出错')
  }
}

async function polishPopupTranslation(): Promise<void> {
  if (!popupSource || !popupTranslation) return
  if (!popupWin || popupWin.isDestroyed()) return
  loadPopupContent(popupTranslation, '润色中…')
  try {
    const result = await translateText(getSettings(), {
      text: popupSource,
      mode: 'polish',
      previousTranslation: popupTranslation,
      targetLang: popupTargetLang ?? undefined
    })
    popupTranslation = result
    loadPopupContent(result, statusLabel('polish'), {
      showActions: true,
      targetLang: popupTargetLang
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '润色失败'
    loadPopupContent(msg, '出错', {
      showActions: Boolean(popupTranslation),
      targetLang: popupTargetLang
    })
  }
}

/**
 * 计算语言切换：翻到另一边。
 * 若目标语种与原文相同，应直接展示原文（避免中译中/英译英看起来没切换）。
 */
function resolveLanguageSwap(
  source: string,
  currentTarget: TargetLang | null,
  translation: string
): { next: TargetLang; showSource: boolean } {
  const sourceLang = guessLang(source)
  const current =
    currentTarget ??
    (translation ? guessLang(translation) : sourceLang === 'zh' ? 'en' : 'zh')
  const next: TargetLang = current === 'zh' ? 'en' : 'zh'
  return { next, showSource: next === sourceLang }
}

/** 强制翻到另一边（中↔英） */
async function swapPopupLanguage(): Promise<void> {
  if (!popupSource) return
  if (!popupWin || popupWin.isDestroyed()) return

  const { next, showSource } = resolveLanguageSwap(
    popupSource,
    popupTargetLang,
    popupTranslation
  )

  // 目标与原文同语种：对调即展示原文
  if (showSource) {
    popupTargetLang = next
    popupTranslation = popupSource
    loadPopupContent(popupSource, statusLabel('result'), {
      showActions: true,
      targetLang: next
    })
    return
  }

  await openPopupWithTranslation(popupSource, next, { keepPosition: true })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function onMouseUp(e: { x: number; y: number }): Promise<void> {
  if (!running || !getSettings().selectionEnabled) return

  const start = downPos
  const pressedAt = downAt
  downPos = null
  downAt = 0

  const now = Date.now()
  const dragged =
    !!start && (Math.abs(e.x - start.x) > 3 || Math.abs(e.y - start.y) > 3)
  const holdMs = pressedAt ? now - pressedAt : 0

  // 双击/三击选词
  if (now - lastClickAt < 450) clickCount += 1
  else clickCount = 1
  lastClickAt = now
  const multiClick = clickCount >= 2

  if (dismissedOnDown && !dragged && !multiClick) {
    dismissedOnDown = false
    return
  }
  dismissedOnDown = false

  if (isPointOnIcon(e.x, e.y)) return

  // 拖选立刻处理；单击先等是否双击，避免第一次 mouseup 占住 handling 导致双击失效
  const waitMs = dragged ? 60 : multiClick ? 120 : 320
  if (selectionDebounce) clearTimeout(selectionDebounce)
  const seq = ++selectionSeq
  const allowCopy = dragged || multiClick || holdMs >= 280
  const cursor = { x: e.x, y: e.y }

  selectionDebounce = setTimeout(() => {
    void finalizeSelection(seq, allowCopy || clickCount >= 2, cursor)
  }, waitMs)
}

async function finalizeSelection(
  seq: number,
  allowCopy: boolean,
  cursor: { x: number; y: number }
): Promise<void> {
  if (seq !== selectionSeq) return
  if (!running || !getSettings().selectionEnabled) return

  try {
    const front = await getFrontmostAppName()
    if (seq !== selectionSeq) return
    const s = getSettings()
    if (shouldSkipSelection(front, s.selectionAppMode, s.excludedApps, s.blacklistedApps)) {
      hideIcon()
      return
    }
  } catch {
    // ignore
  }

  handling = true
  try {
    // 双击选词后系统选区可能稍晚就绪，再多等一点
    if (allowCopy) await sleep(80)
    if (seq !== selectionSeq) return
    const text = await getSelectedText({ allowClipboardSteal: allowCopy })
    if (seq !== selectionSeq) return
    if (!text || text.length < 1 || text.length > 2000 || !/\S/.test(text)) {
      hideIcon()
      return
    }
    // 用最终鼠标位置附近展示
    const point = screen.getCursorScreenPoint()
    showIconNearCursor(text)
    // 若光标已移走，仍以传入坐标微调
    if (iconWin && !iconWin.isDestroyed()) {
      const display = screen.getDisplayNearestPoint(point)
      const x = Math.min(
        cursor.x + ICON_OFFSET,
        display.workArea.x + display.workArea.width - ICON_SIZE - 2
      )
      const y = Math.min(
        cursor.y + ICON_OFFSET,
        display.workArea.y + display.workArea.height - ICON_SIZE - 2
      )
      iconWin.setPosition(Math.max(display.workArea.x, x), Math.max(display.workArea.y, y))
    }
  } catch (err) {
    console.warn('[selection] finalize failed', err)
  } finally {
    handling = false
  }
}

function ensureAccessibility(): void {
  if (process.platform !== 'darwin') return
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    requestAccessibility()
  }
}

function loadMouseHook(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('uiohook-napi') as {
      uIOhook: { start: () => void; stop: () => void; on: Function; removeListener?: Function }
    }
    mouseHook = mod.uIOhook
    return true
  } catch (err) {
    console.error('[selection] failed to load uiohook-napi', err)
    mouseHook = null
    return false
  }
}

export function startSelectionWatcher(): void {
  if (running) return
  running = true
  ensureAccessibility()

  if (!loadMouseHook() || !mouseHook) {
    console.error('[selection] mouse hook unavailable; selection icon disabled')
    running = false
    return
  }

  mouseupHandler = (e: { button: number; x: number; y: number }): void => {
    if (e.button !== 1) return
    void onMouseUp(e)
  }
  mousedownHandler = (e: { button: number; x: number; y: number }): void => {
    if (e.button !== 1) return
    downPos = { x: e.x, y: e.y }
    downAt = Date.now()
    dismissedOnDown = false
    if (isIconVisible() && !isPointOnIcon(e.x, e.y)) {
      hideIcon()
      dismissedOnDown = true
    }
  }
  mouseHook.on('mousedown', mousedownHandler)
  mouseHook.on('mouseup', mouseupHandler)
  mouseHook.start()
}

export function stopSelectionWatcher(): void {
  running = false
  handling = false
  if (selectionDebounce) {
    clearTimeout(selectionDebounce)
    selectionDebounce = null
  }
  selectionSeq += 1
  if (mouseHook && (mouseupHandler || mousedownHandler)) {
    try {
      const remove = (event: string, handler: Function | null): void => {
        if (!handler || !mouseHook) return
        if (typeof mouseHook.off === 'function') mouseHook.off(event, handler)
        else if (typeof (mouseHook as { removeListener?: Function }).removeListener === 'function') {
          ;(mouseHook as { removeListener: Function }).removeListener(event, handler)
        }
      }
      remove('mouseup', mouseupHandler)
      remove('mousedown', mousedownHandler)
      mouseHook.stop()
    } catch {
      // ignore
    }
  }
  mouseupHandler = null
  mousedownHandler = null
  downPos = null
  downAt = 0
  lastClickAt = 0
  clickCount = 0
  dismissedOnDown = false
  destroyAuxWindows()
}

export function syncSelectionWatcherFromSettings(): void {
  if (getSettings().selectionEnabled) {
    startSelectionWatcher()
  } else {
    stopSelectionWatcher()
  }
}

export function registerSelectionIpc(): void {
  ipcMain.handle('selection:translate', async () => {
    const text = lastText || (await getSelectedText({ allowClipboardSteal: true }))
    if (!text) return
    await openPopupWithTranslation(text)
  })
  ipcMain.handle('selection:polish', async () => {
    await polishPopupTranslation()
  })
  ipcMain.handle('selection:swap-language', async () => {
    await swapPopupLanguage()
  })
}

export function isAuxWindow(win: BrowserWindow): boolean {
  return win === iconWin || win === popupWin
}
