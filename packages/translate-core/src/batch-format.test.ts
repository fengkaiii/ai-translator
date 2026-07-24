import { describe, it, expect } from 'vitest'
import { packBatchUnits, parseBatchResult } from './batch-format'

describe('packBatchUnits', () => {
  it('includes instruction and marked blocks', () => {
    const packed = packBatchUnits([
      { id: 't0', text: 'Hello world' },
      { id: 't1', text: 'Click here' }
    ])
    expect(packed).toContain('<<<t0>>>\nHello world')
    expect(packed).toContain('<<<t1>>>\nClick here')
    expect(packed).toContain('只输出带标记的译文')
  })
})

describe('parseBatchResult', () => {
  it('parses multiple blocks in order', () => {
    const raw = `<<<t0>>>
你好世界

<<<t1>>>
点这里`
    const map = parseBatchResult(raw, ['t0', 't1'])
    expect(map.get('t0')).toBe('你好世界')
    expect(map.get('t1')).toBe('点这里')
  })

  it('parses out-of-order ids', () => {
    const raw = `<<<t1>>>
二

<<<t0>>>
一`
    const map = parseBatchResult(raw, ['t0', 't1'])
    expect(map.get('t0')).toBe('一')
    expect(map.get('t1')).toBe('二')
  })

  it('omits missing and empty ids', () => {
    const raw = `<<<t0>>>
有

<<<t1>>>

<<<t2>>>
也有`
    const map = parseBatchResult(raw, ['t0', 't1', 't2', 't3'])
    expect(map.get('t0')).toBe('有')
    expect(map.has('t1')).toBe(false)
    expect(map.get('t2')).toBe('也有')
    expect(map.has('t3')).toBe(false)
  })

  it('ignores unknown markers', () => {
    const raw = `<<<x>>>
噪

<<<t0>>>
正`
    const map = parseBatchResult(raw, ['t0'])
    expect(map.size).toBe(1)
    expect(map.get('t0')).toBe('正')
  })
})
