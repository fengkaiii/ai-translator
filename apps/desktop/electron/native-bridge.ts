import { createServer, type Server } from 'http'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { getSettings } from './settings'
import { callCursorAgent } from './cursor'
import type { TranslateRequest } from '@ai-translator/translate-core'

const PROTOCOL_VERSION = '1'

let server: Server | null = null
let port = 0

export function getNativeBridgePort(): number {
  return port
}

/** 固定路径，供 native host 发现（不依赖 Electron userData 目录名） */
export function nativeBridgePortFile(): string {
  return join(homedir(), '.ai-translator', 'native-bridge-port')
}

function writePortFile(p: number): void {
  const file = nativeBridgePortFile()
  mkdirSync(join(homedir(), '.ai-translator'), { recursive: true })
  writeFileSync(file, String(p), 'utf8')
  // 同步一份到 userData，便于排查
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(join(app.getPath('userData'), 'native-bridge-port'), String(p), 'utf8')
  } catch {
    /* ignore */
  }
}

/** 只取 Cursor 的 key，绝不回落到 DeepSeek key */
function resolveCursorApiKey(s: ReturnType<typeof getSettings>): string {
  const fromMap = (s.providerApiKeys?.cursor ?? '').trim()
  if (fromMap) return fromMap
  if (s.provider === 'cursor') return s.apiKey.trim()
  return ''
}

function readJson(req: import('http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(
  res: import('http').ServerResponse,
  status: number,
  body: Record<string, unknown>
): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  })
  res.end(data)
}

/** 本机 HTTP 桥：仅供 Native Messaging host 调用，强制走 Cursor */
export async function startNativeBridge(): Promise<number> {
  if (server) return port

  server = createServer((req, res) => {
    const url = req.url ?? '/'
    void (async () => {
      try {
        if (req.method === 'GET' && url === '/health') {
          sendJson(res, 200, { ok: true, version: PROTOCOL_VERSION })
          return
        }
        if (req.method === 'GET' && url === '/status') {
          const s = getSettings()
          const cursorKey = resolveCursorApiKey(s)
          sendJson(res, 200, {
            ok: true,
            ready: Boolean(cursorKey),
            model: s.provider === 'cursor' ? s.model : 'auto',
            provider: 'cursor'
          })
          return
        }
        if (req.method === 'POST' && url === '/translate') {
          const body = (await readJson(req)) as TranslateRequest
          const s = getSettings()
          const cursorKey = resolveCursorApiKey(s)
          if (!cursorKey) {
            sendJson(res, 400, {
              ok: false,
              error: '请先在桌面端设置中填写 Cursor API Key'
            })
            return
          }
          // 强制 Cursor：忽略桌面 UI 当前是否选 DeepSeek
          const result = await callCursorAgent(
            {
              ...s,
              provider: 'cursor',
              apiKey: cursorKey,
              model: s.provider === 'cursor' ? s.model : 'auto'
            },
            body
          )
          sendJson(res, 200, { ok: true, result })
          return
        }
        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('native bridge listen failed'))
        return
      }
      port = addr.port
      writePortFile(port)
      resolve()
    })
  })

  return port
}

export function stopNativeBridge(): void {
  if (!server) return
  server.close()
  server = null
  port = 0
}
