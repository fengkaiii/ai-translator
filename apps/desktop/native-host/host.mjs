#!/usr/bin/env node
/**
 * Chrome Native Messaging host → 本机 Electron HTTP bridge
 * Protocol: uint32 LE length prefix + UTF-8 JSON
 */
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PORT_CANDIDATES = [
  process.env.AI_TRANSLATOR_BRIDGE_PORT_FILE,
  // 主发现路径（Electron bridge 写入）
  join(homedir(), '.ai-translator', 'native-bridge-port'),
  // 兼容 Electron userData（macOS / Linux 常见路径）
  join(homedir(), 'Library/Application Support/AI Translator/native-bridge-port'),
  join(homedir(), '.config/AI Translator/native-bridge-port')
].filter(Boolean)

function findPort() {
  for (const p of PORT_CANDIDATES) {
    if (p && existsSync(p)) {
      const n = Number(readFileSync(p, 'utf8').trim())
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  throw new Error('桌面端未运行或未写入 native-bridge-port')
}

function sendMessage(msg) {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(json.length, 0)
  process.stdout.write(header)
  process.stdout.write(json)
}

async function bridge(type, payload) {
  const port = findPort()
  if (type === 'ping') {
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const data = await res.json()
    return data
  }
  if (type === 'get-status') {
    const res = await fetch(`http://127.0.0.1:${port}/status`)
    return await res.json()
  }
  if (type === 'translate') {
    const res = await fetch(`http://127.0.0.1:${port}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {})
    })
    return await res.json()
  }
  return { ok: false, error: `unknown type: ${type}` }
}

async function handle(msg) {
  const id = msg?.id
  try {
    const data = await bridge(msg?.type, msg?.payload)
    sendMessage({ id, ...data })
  } catch (err) {
    sendMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

// Chrome 用裸 stdin 二进制帧；用手动缓冲而非 readline
let buf = Buffer.alloc(0)
process.stdin.on('readable', () => {
  let chunk
  while ((chunk = process.stdin.read()) !== null) {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0)
      if (buf.length < 4 + len) break
      const json = buf.subarray(4, 4 + len).toString('utf8')
      buf = buf.subarray(4 + len)
      try {
        void handle(JSON.parse(json))
      } catch (err) {
        sendMessage({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }
})

process.stdin.on('end', () => process.exit(0))
