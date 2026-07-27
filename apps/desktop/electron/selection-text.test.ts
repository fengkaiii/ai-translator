import { describe, it, expect } from 'vitest'
import { shouldSkipSelection } from './selection-text'

describe('shouldSkipSelection', () => {
  it('always skips self app', () => {
    expect(shouldSkipSelection('Electron', 'all', [], [])).toBe(true)
    expect(shouldSkipSelection('AI Translator', 'selected', [{ name: 'AI Translator', enabled: true }], [])).toBe(
      true
    )
  })

  it('all + empty blacklist allows other apps', () => {
    expect(shouldSkipSelection('Safari', 'all', [], [])).toBe(false)
  })

  it('all + blacklist skips listed apps', () => {
    expect(shouldSkipSelection('Safari', 'all', [], [{ name: 'Safari', enabled: true }])).toBe(true)
    expect(shouldSkipSelection('Notes', 'all', [], [{ name: 'Safari', enabled: true }])).toBe(false)
  })

  it('selected uses allowlist only (ignores blacklist)', () => {
    const allow = [{ name: 'Cursor', enabled: true }]
    const deny = [{ name: 'Safari', enabled: true }]
    expect(shouldSkipSelection('Cursor', 'selected', allow, deny)).toBe(false)
    expect(shouldSkipSelection('Safari', 'selected', allow, deny)).toBe(true)
    expect(shouldSkipSelection('Notes', 'selected', allow, deny)).toBe(true)
  })

  it('empty app name does not skip', () => {
    expect(shouldSkipSelection('  ', 'all', [], [{ name: 'Safari', enabled: true }])).toBe(false)
  })
})
