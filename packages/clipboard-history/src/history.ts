import type { ClipboardHistoryHost } from './host'
import { HISTORY_LIMIT, type HistoryEntry } from './types'

export { HISTORY_LIMIT } from './types'
export type { HistoryEntry } from './types'

/** 自身写入剪贴板后忽略变更的毫秒数，避免 copy/paste 污染历史栈 */
const IGNORE_CLIPBOARD_MS = 800

type StoredHistory = {
  version: 1
  entries: HistoryEntry[]
}

function newEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class ClipboardHistoryService {
  private entries: HistoryEntry[] = []
  private unsubClipboard: (() => void) | null = null
  private changeCallbacks: Array<(entries: HistoryEntry[]) => void> = []
  private ignoreClipboardUntil = 0
  /** 串行化磁盘写入，避免并发 persist 乱序覆盖 */
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private host: ClipboardHistoryHost) {}

  async activate(): Promise<void> {
    // 幂等：重复 activate 不叠加订阅
    if (this.unsubClipboard) return
    await this.loadHistory()
    this.unsubClipboard = this.host.onClipboardChange((text) => {
      this.handleClipboardChange(text)
    })
  }

  deactivate(): void {
    this.unsubClipboard?.()
    this.unsubClipboard = null
    this.changeCallbacks = []
  }

  list(): HistoryEntry[] {
    return [...this.entries]
  }

  async copy(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return
    this.ignoreClipboardUntil = Date.now() + IGNORE_CLIPBOARD_MS
    this.host.writeClipboardText(entry.text)
  }

  async paste(id: string): Promise<{ ok: boolean; error?: string }> {
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: 'not found' }
    this.ignoreClipboardUntil = Date.now() + IGNORE_CLIPBOARD_MS
    // 先隐藏面板让焦点回到前台应用，再模拟粘贴
    this.host.hidePanel()
    return this.host.pasteText(entry.text)
  }

  onChange(cb: (entries: HistoryEntry[]) => void): () => void {
    this.changeCallbacks.push(cb)
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter((x) => x !== cb)
    }
  }

  private async loadHistory(): Promise<void> {
    const raw = await this.host.readHistoryJson()
    if (!raw) {
      this.entries = []
      return
    }
    try {
      const parsed = JSON.parse(raw) as StoredHistory
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        this.entries = parsed.entries
      } else {
        this.entries = []
      }
    } catch {
      // 损坏 JSON：宿主负责 .bak；服务侧容错为空列表
      this.entries = []
    }
  }

  private handleClipboardChange(text: string): void {
    if (Date.now() < this.ignoreClipboardUntil) return
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed === this.entries[0]?.text) return
    this.push(trimmed)
  }

  private push(text: string): void {
    const entry: HistoryEntry = {
      id: newEntryId(),
      text,
      createdAt: Date.now()
    }
    this.entries = [entry, ...this.entries].slice(0, HISTORY_LIMIT)
    this.persistChain = this.persistChain.then(() => this.persist())
    this.notifyChange()
  }

  private async persist(): Promise<void> {
    const payload: StoredHistory = { version: 1, entries: this.entries }
    await this.host.writeHistoryJson(JSON.stringify(payload))
  }

  private notifyChange(): void {
    const snapshot = this.list()
    for (const cb of this.changeCallbacks) {
      cb(snapshot)
    }
  }
}
