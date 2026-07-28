import { globalShortcut, BrowserWindow } from 'electron'
import { getSettings } from './settings'
import { getSelectedText } from './selection-text'
import { registerLinuxEvdevHotkey } from './linux-evdev-hotkey'
import { isWaylandSession } from './linux-input-hook'

type HotkeyHandlers = {
  getMainWindow: () => BrowserWindow | null
  fillAndTranslate: (text: string) => void
}

let currentAccelerator = ''
let stopLinuxFallback: (() => void) | null = null

function clearLinuxFallback(): void {
  if (stopLinuxFallback) {
    stopLinuxFallback()
    stopLinuxFallback = null
  }
}

async function onHotkey(handlers: HotkeyHandlers): Promise<void> {
  try {
    const text = await getSelectedText({ allowClipboardSteal: true })
    const win = handlers.getMainWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    if (text) handlers.fillAndTranslate(text)
  } catch {
    const win = handlers.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  }
}

export function registerHotkey(handlers: HotkeyHandlers): void {
  const { hotkey } = getSettings()
  unregisterHotkey()
  if (!hotkey?.trim()) return

  const fire = (): void => {
    void onHotkey(handlers)
  }

  if (process.platform === 'linux') {
    stopLinuxFallback = registerLinuxEvdevHotkey(hotkey, fire)
    console.info(`[hotkey] translate evdev: ${hotkey}`)
    if (!isWaylandSession()) {
      const ok = globalShortcut.register(hotkey, fire)
      if (ok) currentAccelerator = hotkey
    }
    return
  }

  const ok = globalShortcut.register(hotkey, fire)
  if (ok) currentAccelerator = hotkey
  else console.warn(`Failed to register hotkey: ${hotkey}`)
}

export function unregisterHotkey(): void {
  clearLinuxFallback()
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = ''
  }
}
