import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

type HotkeyHandler = () => void

type ParsedHotkey = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

/** Linux keycode → 规范化名（libinput 有时只给数字 / ***） */
const KEYCODE_NAME: Record<number, string> = {
  29: 'control',
  97: 'control', // KEY_RIGHTCTRL
  42: 'shift',
  54: 'shift', // KEY_RIGHTSHIFT
  56: 'alt',
  100: 'alt', // KEY_RIGHTALT
  125: 'meta',
  126: 'meta',
  44: 'z',
  20: 't',
  47: 'v',
  46: 'c',
  57: 'space'
}

/** Electron accelerator → 规范化按键名 */
function parseAccelerator(accel: string): ParsedHotkey | null {
  const parts = accel
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  let ctrl = false
  let alt = false
  let shift = false
  let meta = false
  let key = ''

  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'control' || low === 'ctrl' || low === 'cmdorctrl') ctrl = true
    else if (low === 'alt' || low === 'option') alt = true
    else if (low === 'shift') shift = true
    else if (low === 'super' || low === 'meta' || low === 'command' || low === 'cmd') meta = true
    else key = low.length === 1 ? low : low
  }
  if (!key) return null
  return { ctrl, alt, shift, meta, key }
}

function normalizeLibinputKey(raw: string): string {
  const name = raw.replace(/^KEY_/, '').toLowerCase()
  const map: Record<string, string> = {
    leftctrl: 'control',
    rightctrl: 'control',
    leftalt: 'alt',
    rightalt: 'alt',
    leftshift: 'shift',
    rightshift: 'shift',
    leftmeta: 'meta',
    rightmeta: 'meta'
  }
  return map[name] ?? name
}

type Registration = {
  parsed: ParsedHotkey
  handler: HotkeyHandler
}

/**
 * Wayland 下 Electron globalShortcut 常失败。
 * 用 libinput 监听键盘，仅在 Linux 使用；与 macOS 无关。
 */
class LinuxLibinputHotkeyBus {
  private child: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private pressed = new Set<string>()
  private regs = new Map<string, Registration>()
  private refCount = 0
  private lastFireAt = 0
  private debugLeft = 40

  register(accel: string, handler: HotkeyHandler): () => void {
    const parsed = parseAccelerator(accel)
    if (!parsed) {
      console.warn('[hotkey] invalid accelerator for libinput:', accel)
      return () => undefined
    }
    const id = `${accel}#${Math.random().toString(36).slice(2)}`
    this.regs.set(id, { parsed, handler })
    this.refCount += 1
    this.ensureStarted()
    console.info('[hotkey] libinput registered', parsed)
    return () => {
      this.regs.delete(id)
      this.refCount -= 1
      if (this.refCount <= 0) this.stop()
    }
  }

  private ensureStarted(): void {
    if (this.child) return
    try {
      this.child = spawn('libinput', ['debug-events'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      console.error('[hotkey] failed to spawn libinput', err)
      return
    }

    this.child.on('error', (err) => console.error('[hotkey] libinput error', err))
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (msg) console.warn('[hotkey] libinput stderr:', msg)
    })
    this.child.on('exit', (code, signal) => {
      this.child = null
      console.warn('[hotkey] libinput exited', { code, signal })
      if (this.refCount > 0) {
        setTimeout(() => {
          if (this.refCount > 0 && !this.child) this.ensureStarted()
        }, 500)
      }
    })
    console.info('[hotkey] libinput keyboard hook started')
  }

  private stop(): void {
    const c = this.child
    this.child = null
    this.pressed.clear()
    this.buf = ''
    if (!c) return
    try {
      c.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('utf8')
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.includes('KEYBOARD_KEY')) continue
      const parsed = this.parseKeyLine(line)
      if (!parsed) {
        if (this.debugLeft > 0) {
          this.debugLeft -= 1
          console.info('[hotkey] unparsed key line:', line.trim())
        }
        continue
      }
      const { key, pressed } = parsed
      if (this.debugLeft > 0 && (key === 'alt' || key === 'z' || key === 'control' || key === 't')) {
        this.debugLeft -= 1
        console.info('[hotkey] key', key, pressed ? 'down' : 'up', 'pressed=', [...this.pressed])
      }
      if (pressed) {
        this.pressed.add(key)
        this.tryFire(key)
      } else {
        this.pressed.delete(key)
      }
    }
  }

  private parseKeyLine(line: string): { key: string; pressed: boolean } | null {
    // event3  KEYBOARD_KEY  +1.23s  KEY_LEFTALT (56) pressed
    const named = line.match(/KEY_([A-Z0-9_]+)\s+\((-?\d+)\)\s+(pressed|released)/)
    if (named) {
      return {
        key: normalizeLibinputKey(named[1]),
        pressed: named[3] === 'pressed'
      }
    }
    // event13  KEYBOARD_KEY  +0.000s  *** (-1) pressed  或仅有键码
    const coded = line.match(/\((-?\d+)\)\s+(pressed|released)/)
    if (coded) {
      const code = Number(coded[1])
      const key = KEYCODE_NAME[code]
      if (!key) return null
      return { key, pressed: coded[2] === 'pressed' }
    }
    return null
  }

  private tryFire(mainKey: string): void {
    const now = Date.now()
    if (now - this.lastFireAt < 400) return

    for (const reg of this.regs.values()) {
      const p = reg.parsed
      if (p.key !== mainKey) continue
      if (p.ctrl !== this.pressed.has('control')) continue
      if (p.alt !== this.pressed.has('alt')) continue
      if (p.shift !== this.pressed.has('shift')) continue
      if (p.meta !== this.pressed.has('meta')) continue
      this.lastFireAt = now
      console.info('[hotkey] libinput fire', p)
      try {
        reg.handler()
      } catch (err) {
        console.warn('[hotkey] handler failed', err)
      }
      return
    }
  }
}

const bus = new LinuxLibinputHotkeyBus()

/** 注册 Linux libinput 全局快捷键；返回取消函数 */
export function registerLinuxLibinputHotkey(accel: string, handler: HotkeyHandler): () => void {
  return bus.register(accel, handler)
}
