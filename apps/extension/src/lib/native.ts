const HOST_NAME = 'com.aitranslator.native'

export type NativeResponse = {
  id?: string
  ok?: boolean
  result?: string
  error?: string
  ready?: boolean
  model?: string
  version?: string
  provider?: string
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** 通过 Native Messaging 与桌面端通信 */
export function nativeRequest(
  type: 'ping' | 'translate' | 'get-status',
  payload?: unknown
): Promise<NativeResponse> {
  return new Promise((resolve) => {
    let settled = false
    const id = nextId()
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connectNative(HOST_NAME)
    } catch (err) {
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : '无法连接桌面端 Native Host'
      })
      return
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        port.disconnect()
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: '请打开 AI Translator 桌面端以使用 Cursor' })
    }, 20_000)

    port.onMessage.addListener((msg: NativeResponse) => {
      if (settled) return
      if (msg?.id && msg.id !== id) return
      settled = true
      clearTimeout(timer)
      try {
        port.disconnect()
      } catch {
        /* ignore */
      }
      resolve(msg)
    })

    port.onDisconnect.addListener(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const err = chrome.runtime.lastError?.message
      resolve({
        ok: false,
        error: err || '请打开 AI Translator 桌面端以使用 Cursor'
      })
    })

    port.postMessage({ id, type, payload })
  })
}
