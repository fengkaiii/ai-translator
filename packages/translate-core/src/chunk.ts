export const PAGE_MAX_NODES = 400
export const PAGE_MAX_CHARS = 80_000
export const CHUNK_MAX_CHARS = 1200

export type TextUnit = { id: string; text: string }

/** 按字符上限把 units 合并为请求批次（单条超限则单独成批） */
export function batchTextUnits(
  units: TextUnit[],
  maxChars: number = CHUNK_MAX_CHARS
): TextUnit[][] {
  if (units.length === 0) return []

  const batches: TextUnit[][] = []
  let current: TextUnit[] = []
  let currentChars = 0

  for (const unit of units) {
    const len = unit.text.length
    if (current.length === 0) {
      current.push(unit)
      currentChars = len
      continue
    }
    if (currentChars + len > maxChars) {
      batches.push(current)
      current = [unit]
      currentChars = len
    } else {
      current.push(unit)
      currentChars += len
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** 截断超大页 */
export function limitPageUnits(
  units: TextUnit[],
  maxNodes: number = PAGE_MAX_NODES,
  maxChars: number = PAGE_MAX_CHARS
): { units: TextUnit[]; truncated: boolean } {
  const limited: TextUnit[] = []
  let chars = 0
  for (const unit of units) {
    if (limited.length >= maxNodes) {
      return { units: limited, truncated: true }
    }
    if (chars + unit.text.length > maxChars) {
      return { units: limited, truncated: limited.length < units.length }
    }
    limited.push(unit)
    chars += unit.text.length
  }
  return { units: limited, truncated: false }
}
