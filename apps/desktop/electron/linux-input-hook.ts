import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { screen } from 'electron'

export type LinuxMouseEvent = { button: number; x: number; y: number }

type Handlers = {
  onMouseDown: (e: LinuxMouseEvent) => void
  onMouseUp: (e: LinuxMouseEvent) => void
}

/** 当前是否为 Wayland 会话（uiohook 在此基本收不到全局鼠标） */
export function isWaylandSession(): boolean {
  return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland'
}

/** 是否 Linux（不含 macOS/Windows），便于平台分流 */
export function isLinuxPlatform(): boolean {
  return process.platform !== 'darwin' && process.platform !== 'win32'
}

/**
 * 用 libinput debug-events 监听全局左键。
 * 需要用户在 input 组，且已安装 libinput-tools。
 */
export function startLibinputMouseHook(handlers: Handlers): () => void {
  let child: ChildProcessWithoutNullStreams | null = null
  let buf = ''
  let stopped = false

  try {
    child = spawn('libinput', ['debug-events'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    console.error('[selection] failed to spawn libinput', err)
    return () => undefined
  }

  child.on('error', (err) => {
    console.error('[selection] libinput hook error', err)
  })

  child.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim()
    if (msg) console.warn('[selection] libinput:', msg)
  })

  child.stdout.on('data', (chunk: Buffer) => {
    if (stopped) return
    buf += chunk.toString('utf8')
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      // event6  POINTER_BUTTON  +1.352s  BTN_LEFT (272) pressed, seat count: 1
      if (!line.includes('POINTER_BUTTON') || !line.includes('BTN_LEFT')) continue
      const pressed = line.includes(' pressed')
      const released = line.includes(' released')
      if (!pressed && !released) continue
      const point = screen.getCursorScreenPoint()
      // 与 uiohook-napi 一致：左键 button === 1
      const e: LinuxMouseEvent = { button: 1, x: point.x, y: point.y }
      if (pressed) handlers.onMouseDown(e)
      else handlers.onMouseUp(e)
    }
  })

  child.on('exit', (code, signal) => {
    if (!stopped) {
      console.warn('[selection] libinput exited unexpectedly', { code, signal })
    }
  })

  return () => {
    stopped = true
    if (!child) return
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    child = null
  }
}
