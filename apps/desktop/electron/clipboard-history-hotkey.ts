import { globalShortcut } from 'electron'
import { getSettings } from './settings'

let currentAccelerator = ''

export function registerClipboardHistoryHotkey(onTrigger: () => void): void {
  unregisterClipboardHistoryHotkey()
  const { clipboardHistoryEnabled, clipboardHistoryHotkey } = getSettings()
  if (!clipboardHistoryEnabled || !clipboardHistoryHotkey?.trim()) return
  const ok = globalShortcut.register(clipboardHistoryHotkey, onTrigger)
  if (ok) currentAccelerator = clipboardHistoryHotkey
  else {
    console.warn(`Failed to register clipboard history hotkey: ${clipboardHistoryHotkey}`)
    currentAccelerator = ''
  }
}

export function unregisterClipboardHistoryHotkey(): void {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = ''
  }
}
