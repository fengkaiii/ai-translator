import { app, clipboard, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  ClipboardHistoryService,
  type ClipboardHistoryHost
} from '@ai-translator/clipboard-history'
import { getSettings } from './settings'
import {
  registerClipboardHistoryHotkey,
  unregisterClipboardHistoryHotkey
} from './clipboard-history-hotkey'
import { clipboardStealDepth } from './selection-text'

const execFileAsync = promisify(execFile)

const DEFAULT_DIR_NAME = 'clipboard-history'
const FILE_NAME = 'history.json'
const PANEL_WIDTH = 720
const PANEL_HEIGHT = 520
const CLIPBOARD_POLL_MS = 500

let service: ClipboardHistoryService | null = null
let panelWin: BrowserWindow | null = null
let resolvedStorage: { dir: string; usedFallback: boolean } | null = null
let lastClipboardText = ''
let unsubChange: (() => void) | null = null
let ipcRegistered = false
let startInFlight: Promise<void> | null = null
let syncChain: Promise<void> = Promise.resolve()
let dragOffset: { x: number; y: number } | null = null
let dragTimer: ReturnType<typeof setInterval> | null = null
/** show 后短延迟内忽略 blur，避免刚打开就因焦点抖动关闭 */
let ignoreBlurUntil = 0

function stopPanelDrag(): void {
  dragOffset = null
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
}

/** 标题栏拖拽：不用 -webkit-app-region（hide/show 后常失效） */
function startPanelDrag(): void {
  if (!panelWin || panelWin.isDestroyed()) return
  stopPanelDrag()
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = panelWin.getPosition()
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
  dragTimer = setInterval(() => {
    if (!dragOffset || !panelWin || panelWin.isDestroyed()) {
      stopPanelDrag()
      return
    }
    const p = screen.getCursorScreenPoint()
    panelWin.setPosition(Math.round(p.x - dragOffset.x), Math.round(p.y - dragOffset.y))
  }, 16)
}

function defaultStorageDir(): string {
  return join(app.getPath('userData'), DEFAULT_DIR_NAME)
}

async function resolveStorageDir(): Promise<{ dir: string; usedFallback: boolean }> {
  const custom = getSettings().clipboardHistoryStorageDir.trim()
  const preferred = custom || defaultStorageDir()
  try {
    await fs.mkdir(preferred, { recursive: true })
    const probe = join(preferred, '.write-test')
    await fs.writeFile(probe, 'ok')
    await fs.unlink(probe)
    return { dir: preferred, usedFallback: false }
  } catch {
    const fallback = defaultStorageDir()
    await fs.mkdir(fallback, { recursive: true })
    return { dir: fallback, usedFallback: custom.length > 0 }
  }
}

async function renameHistoryToBackup(filePath: string): Promise<void> {
  try {
    await fs.rename(filePath, `${filePath}.bak`)
  } catch {
    // ignore rename failure
  }
}

async function readHistoryJson(dir: string): Promise<string | null> {
  const filePath = join(dir, FILE_NAME)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    try {
      JSON.parse(raw)
    } catch {
      await renameHistoryToBackup(filePath)
      return null
    }
    return raw
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    await renameHistoryToBackup(filePath)
    return null
  }
}

async function writeHistoryJson(dir: string, raw: string): Promise<void> {
  await fs.writeFile(join(dir, FILE_NAME), raw, 'utf-8')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 写剪贴板后模拟 Cmd/Ctrl+V 到前台应用 */
async function simulatePasteKey(): Promise<{ ok: boolean; error?: string }> {
  await sleep(80)
  try {
    if (process.platform === 'darwin') {
      await execFileAsync(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "v" using command down'],
        { timeout: 600 }
      )
      return { ok: true }
    }
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
        ],
        { timeout: 600 }
      )
      return { ok: true }
    }
    try {
      await execFileAsync('xdotool', ['key', 'ctrl+v'], { timeout: 600 })
      return { ok: true }
    } catch {
      return { ok: false, error: 'xdotool not available' }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 开发 / 生产加载剪贴板面板 renderer 入口 */
function loadPanelPage(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/clipboard-history.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/clipboard-history.html'))
  }
}

/** 按光标所在屏居中偏上定位（多屏跟随当前使用屏幕） */
function panelBoundsOnActiveDisplay(): { x: number; y: number; width: number; height: number } {
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const { x: ax, y: ay, width: screenW, height: screenH } = display.workArea
  return {
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    x: Math.round(ax + (screenW - PANEL_WIDTH) / 2),
    y: Math.round(ay + screenH * 0.12)
  }
}

function ensurePanelWindow(): BrowserWindow {
  if (panelWin && !panelWin.isDestroyed()) return panelWin

  const bounds = panelBoundsOnActiveDisplay()

  const winOpts: Electron.BrowserWindowConstructorOptions = {
    ...bounds,
    frame: false,
    // 不用 type:panel：与 vibrancy / 拖拽在 hide/show 后冲突
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
  if (process.platform === 'darwin') {
    winOpts.vibrancy = 'popover'
    winOpts.visualEffectState = 'active'
  }

  panelWin = new BrowserWindow(winOpts)
  panelWin.setAlwaysOnTop(true, 'floating')
  panelWin.on('closed', () => {
    stopPanelDrag()
    panelWin = null
  })
  // 点击窗口外失焦即关闭（DevTools 打开时除外，避免调试误关）
  panelWin.on('blur', () => {
    if (Date.now() < ignoreBlurUntil) return
    if (!panelWin || panelWin.isDestroyed() || !panelWin.isVisible()) return
    if (panelWin.webContents.isDevToolsOpened()) return
    stopPanelDrag()
    panelWin.hide()
  })
  loadPanelPage(panelWin)
  return panelWin
}

function createHost(dir: string): ClipboardHistoryHost {
  return {
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (text: string) => {
      clipboard.writeText(text)
      lastClipboardText = text
    },
    onClipboardChange: (cb) => {
      lastClipboardText = clipboard.readText()
      const timer = setInterval(() => {
        if (clipboardStealDepth > 0) return
        const text = clipboard.readText()
        if (text !== lastClipboardText) {
          lastClipboardText = text
          cb(text)
        }
      }, CLIPBOARD_POLL_MS)
      return () => clearInterval(timer)
    },
    pasteText: async (text: string) => {
      clipboard.writeText(text)
      lastClipboardText = text
      return simulatePasteKey()
    },
    readHistoryJson: () => readHistoryJson(dir),
    writeHistoryJson: (raw: string) => writeHistoryJson(dir, raw),
    showPanel: () => {
      const win = ensurePanelWindow()
      // 每次打开都按当前光标所在屏重新定位
      win.setBounds(panelBoundsOnActiveDisplay())
      ignoreBlurUntil = Date.now() + 250
      win.show()
      win.focus()
      win.webContents.send('clipboard-history:changed', service?.list() ?? [])
    },
    hidePanel: () => {
      stopPanelDrag()
      if (panelWin && !panelWin.isDestroyed()) {
        panelWin.blur()
        panelWin.hide()
      }
    }
  }
}

function registerIpcOnce(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('clipboard-history:list', () => service?.list() ?? [])
  ipcMain.handle('clipboard-history:copy', (_e, id: string) => service?.copy(id))
  ipcMain.handle('clipboard-history:paste', (_e, id: string) => service?.paste(id))
  ipcMain.handle('clipboard-history:hide', () => {
    stopPanelDrag()
    if (panelWin && !panelWin.isDestroyed()) {
      panelWin.blur()
      panelWin.hide()
    }
  })
  ipcMain.on('clipboard-history:drag-start', () => {
    startPanelDrag()
  })
  ipcMain.on('clipboard-history:drag-end', () => {
    stopPanelDrag()
  })
  ipcMain.handle('clipboard-history:pick-dir', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })
  ipcMain.handle('clipboard-history:resolved-dir', async () => {
    if (resolvedStorage) {
      return { ...resolvedStorage, defaultDir: defaultStorageDir() }
    }
    const result = await resolveStorageDir()
    return { ...result, defaultDir: defaultStorageDir() }
  })
}

async function ensureStarted(): Promise<void> {
  if (service) return
  if (startInFlight) return startInFlight

  startInFlight = (async () => {
    const result = await resolveStorageDir()
    resolvedStorage = result
    const host = createHost(result.dir)
    service = new ClipboardHistoryService(host)
    await service.activate()
    unsubChange = service.onChange((entries) => {
      if (panelWin && !panelWin.isDestroyed()) {
        panelWin.webContents.send('clipboard-history:changed', entries)
      }
    })
    registerClipboardHistoryHotkey(() => host.showPanel())
  })()

  try {
    await startInFlight
  } finally {
    startInFlight = null
  }
}

async function syncClipboardHistoryFromSettingsImpl(): Promise<void> {
  const enabled = getSettings().clipboardHistoryEnabled
  if (!enabled) {
    stopClipboardHistory()
    return
  }
  if (service) {
    unregisterClipboardHistoryHotkey()
    unsubChange?.()
    unsubChange = null
    service.deactivate()
    service = null
    resolvedStorage = null
  }
  await ensureStarted()
}

export function syncClipboardHistoryFromSettings(): void {
  syncChain = syncChain.then(() => syncClipboardHistoryFromSettingsImpl())
}

export function stopClipboardHistory(): void {
  stopPanelDrag()
  unregisterClipboardHistoryHotkey()
  unsubChange?.()
  unsubChange = null
  service?.deactivate()
  service = null
  resolvedStorage = null
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.hide()
    panelWin.destroy()
    panelWin = null
  }
}

export function isClipboardHistoryWindow(win: BrowserWindow): boolean {
  return panelWin !== null && !panelWin.isDestroyed() && win === panelWin
}

// 设置页 IPC 需在功能未启用时也可用；服务相关 handler 对 null service 已容错
registerIpcOnce()
