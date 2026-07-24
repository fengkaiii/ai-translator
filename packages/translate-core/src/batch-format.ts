import type { TextUnit } from './chunk'

const MARK_RE = /<<<([a-zA-Z0-9_-]+)>>>/g

/** 多节点合并为一次请求的用户消息 */
export function packBatchUnits(units: TextUnit[]): string {
  const blocks = units.map((u) => `<<<${u.id}>>>\n${u.text}`).join('\n\n')
  return (
    '按下列块分别翻译。每块以 <<<id>>> 开头，译文也必须以相同 <<<id>>> 开头，块之间不要合并或省略。只输出带标记的译文。\n\n' +
    blocks
  )
}

/**
 * 从模型输出解析各 id 译文；缺 id / 空译文不进 Map（调用方记失败）。
 * 乱序 id 仍可按标记切分。
 */
export function parseBatchResult(raw: string, ids: string[]): Map<string, string> {
  const wanted = new Set(ids)
  const out = new Map<string, string>()
  const text = raw.trim()
  if (!text || wanted.size === 0) return out

  const matches = [...text.matchAll(MARK_RE)]
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1]
    if (!wanted.has(id)) continue
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const translated = text.slice(start, end).trim()
    if (translated) out.set(id, translated)
  }
  return out
}
