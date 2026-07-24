import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { getSettings, saveSettings } from './settings'
import { callDeepSeek } from './deepseek'
import type { TranslateRequest } from './deepseek'
import { registerHotkey, unregisterHotkey } from './hotkey'
import {
  initSelectionWindows,
  registerSelectionIpc,
  syncSelectionWatcherFromSettings,
  stopSelectionWatcher,
  isAuxWindow
} from './selection'
import {
  getAccessibilityStatus,
  requestAccessibility,
  revealElectronApp
} from './accessibility'
import { getFrontmostAppName, listSelectableAppNames } from './selection-text'
import { getAppNativeImage } from './logo'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const icon = getAppNativeImage()
  mainWindow = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: 'AI Translator',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function fillAndTranslate(text: string): void {
  showMainWindow()
  if (!mainWindow) return
  mainWindow.webContents.send('fill-and-translate', text)
}

function setupIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial: Partial<ReturnType<typeof getSettings>>) => {
    const next = saveSettings(partial)
    registerHotkey({
      getMainWindow: () => mainWindow,
      fillAndTranslate
    })
    syncSelectionWatcherFromSettings()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed', next)
    }
    return next
  })
  ipcMain.handle('translate', async (_e, req: TranslateRequest) => {
    const text = await callDeepSeek(getSettings(), req)
    return { text }
  })
  ipcMain.handle('accessibility:status', () => getAccessibilityStatus())
  ipcMain.handle('accessibility:request', () => requestAccessibility())
  ipcMain.handle('accessibility:reveal', () => revealElectronApp())
  ipcMain.handle('app:frontmost', () => getFrontmostAppName())
  ipcMain.handle('app:list', (_e, mode: 'running' | 'all' = 'all') =>
    listSelectableAppNames(mode === 'running' ? 'running' : 'all')
  )
  registerSelectionIpc()
}

app.whenReady().then(() => {
  app.setName('AI Translator')
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.translater.ai')
  }
  const dockIcon = getAppNativeImage()
  if (process.platform === 'darwin' && dockIcon && app.dock) {
    app.dock.setIcon(dockIcon)
  }

  initSelectionWindows({
    getMainWindow: () => mainWindow
  })

  setupIpc()
  createWindow()
  registerHotkey({
    getMainWindow: () => mainWindow,
    fillAndTranslate
  })
  syncSelectionWatcherFromSettings()

  // 只在「没有可见窗口」时恢复主窗（例如 Dock 点击且窗口被 hide）。
  // 不要在每次 activate 时都 show 主窗，否则关划词小窗会把主窗拉出来。
  app.on('activate', (_event, hasVisibleWindows) => {
    if (!hasVisibleWindows) {
      showMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  const onlyAuxLeft = BrowserWindow.getAllWindows().every((w) => isAuxWindow(w))
  if (onlyAuxLeft) {
    stopSelectionWatcher()
  }
  if (process.platform !== 'darwin') {
    stopSelectionWatcher()
    unregisterHotkey()
    app.quit()
  } else if (BrowserWindow.getAllWindows().length === 0) {
    stopSelectionWatcher()
  }
})

app.on('will-quit', () => {
  stopSelectionWatcher()
  unregisterHotkey()
})
