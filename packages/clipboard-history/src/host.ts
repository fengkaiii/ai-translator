export type ClipboardHistoryHost = {
  readClipboardText: () => string
  writeClipboardText: (text: string) => void
  onClipboardChange: (cb: (text: string) => void) => () => void
  pasteText: (text: string) => Promise<{ ok: boolean; error?: string }>
  readHistoryJson: () => Promise<string | null>
  writeHistoryJson: (raw: string) => Promise<void>
  showPanel: () => void
  hidePanel: () => void
}
