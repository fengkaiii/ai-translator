import { describe, it, expect, vi } from 'vitest'
import { ClipboardHistoryService, HISTORY_LIMIT } from './history'
import type { ClipboardHistoryHost } from './host'

function createFakeHost(overrides: Partial<ClipboardHistoryHost> = {}): ClipboardHistoryHost & {
  clipboard: string
  stored: string | null
  changes: Array<(t: string) => void>
} {
  const state = {
    clipboard: '',
    stored: null as string | null,
    changes: [] as Array<(t: string) => void>
  }
  // Object.assign 使 host 与 state 同一对象，便于断言 host.stored / host.clipboard
  const host = Object.assign(state, {
    readClipboardText: () => state.clipboard,
    writeClipboardText: (t) => {
      state.clipboard = t
    },
    onClipboardChange: (cb) => {
      state.changes.push(cb)
      return () => {
        state.changes = state.changes.filter((x) => x !== cb)
      }
    },
    pasteText: vi.fn(async () => ({ ok: true })),
    readHistoryJson: async () => state.stored,
    writeHistoryJson: async (raw) => {
      state.stored = raw
    },
    showPanel: vi.fn(),
    hidePanel: vi.fn(),
    ...overrides
  }) as ClipboardHistoryHost & typeof state
  return host
}

describe('ClipboardHistoryService', () => {
  it('ignores empty and duplicate-of-top', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('hello')
    host.changes[0]!('')
    host.changes[0]!('hello')
    expect(svc.list()).toHaveLength(1)
    expect(svc.list()[0]!.text).toBe('hello')
  })

  it('caps at HISTORY_LIMIT and drops oldest', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      host.changes[0]!(`t-${i}`)
    }
    expect(svc.list()).toHaveLength(HISTORY_LIMIT)
    expect(svc.list()[0]!.text).toBe(`t-${HISTORY_LIMIT + 4}`)
    expect(svc.list().at(-1)!.text).toBe('t-5')
  })

  it('persists and reloads', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('a')
    await new Promise((resolve) => setImmediate(resolve))
    expect(host.stored).toBeTruthy()
    const svc2 = new ClipboardHistoryService(host)
    await svc2.activate()
    expect(svc2.list()[0]!.text).toBe('a')
  })

  it('copy writes clipboard but does not re-push same text', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('x')
    const id = svc.list()[0]!.id
    await svc.copy(id)
    expect(host.clipboard).toBe('x')
    expect(svc.list()).toHaveLength(1)
  })

  it('paste hides panel before pasteText on success', async () => {
    const callOrder: string[] = []
    const host = createFakeHost({
      hidePanel: vi.fn(() => {
        callOrder.push('hidePanel')
      }),
      pasteText: vi.fn(async () => {
        callOrder.push('pasteText')
        return { ok: true }
      })
    })
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('paste-me')
    const id = svc.list()[0]!.id
    const r = await svc.paste(id)
    expect(r.ok).toBe(true)
    expect(host.pasteText).toHaveBeenCalledWith('paste-me')
    expect(host.hidePanel).toHaveBeenCalled()
    expect(callOrder).toEqual(['hidePanel', 'pasteText'])
  })

  it('paste hides panel even when pasteText fails', async () => {
    const host = createFakeHost({
      pasteText: vi.fn(async () => ({ ok: false, error: 'denied' }))
    })
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('paste-me')
    const id = svc.list()[0]!.id
    const r = await svc.paste(id)
    expect(r.ok).toBe(false)
    expect(host.pasteText).toHaveBeenCalledWith('paste-me')
    expect(host.hidePanel).toHaveBeenCalled()
  })

  it('activate is idempotent', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    await svc.activate()
    expect(host.changes).toHaveLength(1)
  })

  it('recovers from corrupt json', async () => {
    const host = createFakeHost()
    host.stored = '{not-json'
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    expect(svc.list()).toEqual([])
  })
})
