import { describe, it, expect } from 'vitest'
import { batchTextUnits, limitPageUnits, CHUNK_MAX_CHARS } from './chunk'

describe('batchTextUnits', () => {
  it('returns empty for empty input', () => {
    expect(batchTextUnits([])).toEqual([])
  })

  it('keeps oversized single unit as its own batch', () => {
    const big = { id: '1', text: 'x'.repeat(CHUNK_MAX_CHARS + 50) }
    expect(batchTextUnits([big])).toEqual([[big]])
  })

  it('merges small units until maxChars', () => {
    const units = [
      { id: 'a', text: 'aa' },
      { id: 'b', text: 'bb' },
      { id: 'c', text: 'cc' }
    ]
    expect(batchTextUnits(units, 5)).toEqual([
      [
        { id: 'a', text: 'aa' },
        { id: 'b', text: 'bb' }
      ],
      [{ id: 'c', text: 'cc' }]
    ])
  })
})

describe('limitPageUnits', () => {
  it('truncates by max nodes', () => {
    const units = [
      { id: '1', text: 'a' },
      { id: '2', text: 'b' },
      { id: '3', text: 'c' }
    ]
    const out = limitPageUnits(units, 2, 10_000)
    expect(out.units).toHaveLength(2)
    expect(out.truncated).toBe(true)
  })

  it('truncates by max chars', () => {
    const units = [
      { id: '1', text: 'hello' },
      { id: '2', text: 'world' }
    ]
    const out = limitPageUnits(units, 100, 7)
    expect(out.units).toEqual([{ id: '1', text: 'hello' }])
    expect(out.truncated).toBe(true)
  })
})
