import { globalShortcut } from 'electron'
import { getSettings } from './settings'
import { registerLinuxEvdevHotkey } from './linux-evdev-hotkey'
import { isWaylandSession } from './linux-input-hook'

let currentAccelerator = ''
let stopLinuxFallback: (() => void) | null = null

function clearLinuxFallback(): void {
  if (stopLinuxFallback) {
    stopLinuxFallback()
    stopLinuxFallback = null
  }
}

export function registerClipboardHistoryHotkey(onTrigger: () => void): void {
  unregisterClipboardHistoryHotkey()
  const { clipboardHistoryEnabled, clipboardHistoryHotkey } = getSettings()
  if (!clipboardHistoryEnabled || !clipboardHistoryHotkey?.trim()) return

  // Linux：优先 evdev（蓝牙键盘在 libinput debug-events 里键码为 -1）
  if (process.platform === 'linux') {
    stopLinuxFallback = registerLinuxEvdevHotkey(clipboardHistoryHotkey, onTrigger)
    console.info(`[hotkey] clipboard history evdev: ${clipboardHistoryHotkey}`)
    // X11 上再挂一份 globalShortcut 作为补充
    if (!isWaylandSession()) {
      const ok = globalShortcut.register(clipboardHistoryHotkey, onTrigger)
      if (ok) currentAccelerator = clipboardHistoryHotkey
    }
    return
  }

  const ok = globalShortcut.register(clipboardHistoryHotkey, onTrigger)
  if (ok) currentAccelerator = clipboardHistoryHotkey
  else console.warn(`Failed to register clipboard history hotkey: ${clipboardHistoryHotkey}`)
}

export function unregisterClipboardHistoryHotkey(): void {
  clearLinuxFallback()
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = ''
  }
}
