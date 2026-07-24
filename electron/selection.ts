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
import { getSelectedText, getFrontmostAppName, isAppExcluded } from './selection-text'
import { callDeepSeek } from './deepseek'
import { requestAccessibility } from './accessibility'
import { getLogoDataUrl } from './logo'

let getMainWindow: (() => BrowserWindow | null) | null = null

let iconWin: BrowserWindow | null = null
let popupWin: BrowserWindow | null = null
let lastText = ''
let popupSource = ''
let popupTranslation = ''
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

function popupHtml(text: string, status: string, options?: { showPolish?: boolean }): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const polishBtn = options?.showPolish ? `<button id="polish">润色</button>` : ''
  const theme = resolvePopupTheme()
  const isDark = theme === 'dark'
  const bg = isDark ? '#171d25' : '#ffffff'
  const textColor = isDark ? '#e8eef5' : '#1a2332'
  const muted = isDark ? '#8b9bb0' : '#667789'
  const btnBg = isDark ? '#2a3441' : '#e8edf4'
  const accent = isDark ? '#3d8bfd' : '#2f6fed'
  return `<!doctype html>
<html data-theme="${theme}"><head><meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;background:${bg};color:${textColor};font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color-scheme:${theme}}
  .wrap{padding:12px 14px;min-height:100vh}
  .status{color:${muted};font-size:12px;margin-bottom:8px}
  .text{white-space:pre-wrap;word-break:break-word}
  .actions{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
  button{border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:${btnBg};color:${textColor}}
  button.primary{background:${accent};color:#fff}
  button:disabled{opacity:.5;cursor:not-allowed}
</style></head>
<body>
  <div class="wrap">
    <div class="status" id="status">${status}</div>
    <div class="text" id="text">${escaped}</div>
    <div class="actions">
      <button class="primary" id="copy">复制</button>
      ${polishBtn}
      <button id="close">关闭</button>
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
        document.getElementById('status').textContent = '润色中…'
        try {
          await window.translatorSelection?.polishSelection()
        } finally {
          polish.disabled = false
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

function loadPopupContent(text: string, status: string, showPolish: boolean): void {
  if (!popupWin || popupWin.isDestroyed()) return
  popupWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      popupHtml(text, status, { showPolish })
    )}`
  )
}

async function openPopupWithTranslation(source: string): Promise<void> {
  // 从图标切到小窗：不要在 hideIcon 时 app.hide()
  const wasBackground = auxFromBackground || !appHasFocus()
  hideIcon({ handoffToPopup: true })
  auxFromBackground = wasBackground

  popupSource = source
  popupTranslation = ''
  if (popupWin && !popupWin.isDestroyed()) {
    popupWin.destroy()
    popupWin = null
  }

  const point = screen.getCursorScreenPoint()
  const bg = resolvePopupTheme() === 'dark' ? '#171d25' : '#ffffff'
  popupWin = new BrowserWindow({
    width: 380,
    height: 280,
    x: point.x + 12,
    y: point.y + 12,
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
    restorePreviousAppAfterAux()
  })

  const showPopup = (): void => {
    if (!popupWin || popupWin.isDestroyed()) return
    popupWin.showInactive()
    setTimeout(() => demoteMainIfStolen(), 40)
  }
  popupWin.once('ready-to-show', showPopup)
  loadPopupContent('…', '翻译中…', false)
  showPopup()

  try {
    const result = await callDeepSeek(getSettings(), { text: source, mode: 'translate' })
    popupTranslation = result
    loadPopupContent(result, '翻译结果', true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '翻译失败'
    loadPopupContent(msg, '出错', false)
  }
}

async function polishPopupTranslation(): Promise<void> {
  if (!popupSource || !popupTranslation) return
  if (!popupWin || popupWin.isDestroyed()) return
  loadPopupContent(popupTranslation, '润色中…', false)
  try {
    const result = await callDeepSeek(getSettings(), {
      text: popupSource,
      mode: 'polish',
      previousTranslation: popupTranslation
    })
    popupTranslation = result
    loadPopupContent(result, '润色结果', true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '润色失败'
    loadPopupContent(msg, '出错', Boolean(popupTranslation))
  }
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
    if (isAppExcluded(front, getSettings().excludedApps)) {
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
}

export function isAuxWindow(win: BrowserWindow): boolean {
  return win === iconWin || win === popupWin
}
