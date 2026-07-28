import { openSync, readSync, closeSync, readdirSync, readFileSync, constants } from 'fs'
import { join } from 'path'

type HotkeyHandler = () => void

type ParsedHotkey = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

/** Linux input.h 常用键码 */
const KEY = {
  LEFTCTRL: 29,
  RIGHTCTRL: 97,
  LEFTSHIFT: 42,
  RIGHTSHIFT: 54,
  LEFTALT: 56,
  RIGHTALT: 100,
  LEFTMETA: 125,
  RIGHTMETA: 126,
  Z: 44,
  T: 20,
  V: 47,
  C: 46,
  A: 30,
  S: 31,
  X: 45,
  SPACE: 57
} as const

const CODE_TO_NAME: Record<number, string> = {
  [KEY.LEFTCTRL]: 'control',
  [KEY.RIGHTCTRL]: 'control',
  [KEY.LEFTSHIFT]: 'shift',
  [KEY.RIGHTSHIFT]: 'shift',
  [KEY.LEFTALT]: 'alt',
  [KEY.RIGHTALT]: 'alt',
  [KEY.LEFTMETA]: 'meta',
  [KEY.RIGHTMETA]: 'meta',
  [KEY.Z]: 'z',
  [KEY.T]: 't',
  [KEY.V]: 'v',
  [KEY.C]: 'c',
  [KEY.A]: 'a',
  [KEY.S]: 's',
  [KEY.X]: 'x',
  [KEY.SPACE]: 'space'
}

/** 字母键 a-z → keycode（KEY_A=30 … KEY_Z=44，非连续，用表） */
const LETTER_CODES: Record<string, number> = {
  a: 30,
  b: 48,
  c: 46,
  d: 32,
  e: 18,
  f: 33,
  g: 34,
  h: 35,
  i: 23,
  j: 36,
  k: 37,
  l: 38,
  m: 50,
  n: 49,
  o: 24,
  p: 25,
  q: 16,
  r: 19,
  s: 31,
  t: 20,
  u: 22,
  v: 47,
  w: 17,
  x: 45,
  y: 21,
  z: 44
}

for (const [ch, code] of Object.entries(LETTER_CODES)) {
  CODE_TO_NAME[code] = ch
}

function parseAccelerator(accel: string): ParsedHotkey | null {
  const parts = accel
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return null
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
    else key = low
  }
  if (!key) return null
  return { ctrl, alt, shift, meta, key }
}

type Registration = { parsed: ParsedHotkey; handler: HotkeyHandler }

/** 从 /proc/bus/input/devices 找出带按键能力的 event 节点 */
function listKeyEventDevices(): string[] {
  let raw = ''
  try {
    raw = readFileSync('/proc/bus/input/devices', 'utf8')
  } catch {
    return readdirSync('/dev/input')
      .filter((n) => n.startsWith('event'))
      .map((n) => join('/dev/input', n))
  }

  const out: string[] = []
  const blocks = raw.split('\n\n')
  for (const block of blocks) {
    const handlers = block.match(/H: Handlers=([^\n]+)/)
    if (!handlers) continue
    // 只要带 kbd 的设备（含蓝牙键盘）
    if (!/\bkbd\b/.test(handlers[1])) continue
    const m = handlers[1].match(/\bevent(\d+)\b/)
    if (!m) continue
    out.push(join('/dev/input', `event${m[1]}`))
  }
  return [...new Set(out)]
}

/**
 * 直接读 evdev 键码。
 * 罗技等蓝牙键盘在 libinput debug-events 里会变成 *** (-1)，必须走这条路径。
 * 仅 Linux 使用，不影响 macOS。
 */
class LinuxEvdevHotkeyBus {
  private regs = new Map<string, Registration>()
  private pressed = new Set<string>()
  private fds: number[] = []
  private timer: NodeJS.Timeout | null = null
  private lastFireAt = 0
  private buf = Buffer.alloc(24 * 16)
  private debugLeft = 30

  register(accel: string, handler: HotkeyHandler): () => void {
    const parsed = parseAccelerator(accel)
    if (!parsed) {
      console.warn('[hotkey] invalid accelerator:', accel)
      return () => undefined
    }
    // 确保主键能映射到 keycode
    if (!(parsed.key in LETTER_CODES) && !['space', 'tab', 'enter'].includes(parsed.key)) {
      console.warn('[hotkey] unsupported key for evdev:', parsed.key)
    }
    const id = `${accel}#${Math.random().toString(36).slice(2)}`
    this.regs.set(id, { parsed, handler })
    this.ensureStarted()
    console.info('[hotkey] evdev registered', parsed)
    return () => {
      this.regs.delete(id)
      if (this.regs.size === 0) this.stop()
    }
  }

  private ensureStarted(): void {
    if (this.timer) return
    const devices = listKeyEventDevices()
    for (const path of devices) {
      try {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
        this.fds.push(fd)
      } catch (err) {
        console.warn('[hotkey] cannot open', path, err)
      }
    }
    if (this.fds.length === 0) {
      console.error('[hotkey] no evdev keyboard devices opened (need input group)')
      return
    }
    console.info(`[hotkey] evdev listening on ${this.fds.length} devices`)
    // 非阻塞轮询：Electron 主进程里避免依赖外部 select binding
    this.timer = setInterval(() => this.poll(), 16)
    // 不要让 timer 拖住退出
    this.timer.unref?.()
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const fd of this.fds) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
    this.fds = []
    this.pressed.clear()
  }

  private poll(): void {
    // input_event: timeval(16 on 64-bit) + type(u16) + code(u16) + value(i32) = 24
    const EV_KEY = 1
    for (const fd of this.fds) {
      for (;;) {
        let n = 0
        try {
          n = readSync(fd, this.buf, 0, this.buf.length, null)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'EAGAIN' || code === 'EWOULDBLOCK') break
          break
        }
        if (!n) break
        for (let off = 0; off + 24 <= n; off += 24) {
          const type = this.buf.readUInt16LE(off + 16)
          const code = this.buf.readUInt16LE(off + 18)
          const value = this.buf.readInt32LE(off + 20)
          if (type !== EV_KEY) continue
          if (value === 2) continue // repeat
          const name = CODE_TO_NAME[code]
          if (!name) continue
          const pressed = value === 1
          if (this.debugLeft > 0) {
            this.debugLeft -= 1
            console.info('[hotkey] evdev', name, pressed ? 'down' : 'up', 'code=', code)
          }
          if (pressed) {
            this.pressed.add(name)
            this.tryFire(name)
          } else {
            this.pressed.delete(name)
          }
        }
      }
    }
  }

  private tryFire(mainKey: string): void {
    const now = Date.now()
    if (now - this.lastFireAt < 600) return
    for (const reg of this.regs.values()) {
      const p = reg.parsed
      if (p.key !== mainKey) continue
      if (p.ctrl !== this.pressed.has('control')) continue
      if (p.alt !== this.pressed.has('alt')) continue
      if (p.shift !== this.pressed.has('shift')) continue
      if (p.meta !== this.pressed.has('meta')) continue
      this.lastFireAt = now
      // 消费本次按下，避免多设备重复上报连发
      this.pressed.delete(mainKey)
      console.info('[hotkey] evdev fire', p)
      try {
        reg.handler()
      } catch (err) {
        console.warn('[hotkey] handler failed', err)
      }
      return
    }
  }
}

const bus = new LinuxEvdevHotkeyBus()

export function registerLinuxEvdevHotkey(accel: string, handler: HotkeyHandler): () => void {
  return bus.register(accel, handler)
}
