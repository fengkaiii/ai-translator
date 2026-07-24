import { globalShortcut, BrowserWindow } from 'electron'
import { getSettings } from './settings'
import { getSelectedText } from './selection-text'

type HotkeyHandlers = {
  getMainWindow: () => BrowserWindow | null
  fillAndTranslate: (text: string) => void
}

let currentAccelerator = ''

export function registerHotkey(handlers: HotkeyHandlers): void {
  const { hotkey } = getSettings()
  unregisterHotkey()
  if (!hotkey?.trim()) return

  const ok = globalShortcut.register(hotkey, async () => {
    try {
      // 快捷键：用户明确要翻译，先 AX，再允许 Cmd+C 兜底
      const text = await getSelectedText({ allowClipboardSteal: true })
      const win = handlers.getMainWindow()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      if (text) {
        handlers.fillAndTranslate(text)
      }
    } catch {
      const win = handlers.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.show()
        win.focus()
      }
    }
  })

  if (ok) {
    currentAccelerator = hotkey
  } else {
    console.warn(`Failed to register hotkey: ${hotkey}`)
    currentAccelerator = ''
  }
}

export function unregisterHotkey(): void {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = ''
  }
  globalShortcut.unregisterAll()
}
