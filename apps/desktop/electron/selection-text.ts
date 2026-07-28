import { execFile, execFileSync, spawn } from 'child_process'
import { promisify } from 'util'
import { readdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { clipboard } from 'electron'
import { isWaylandSession } from './linux-input-hook'

const execFileAsync = promisify(execFile)

/** Linux：用 wl-copy 写剪贴板，避免 Electron clipboard API 抢所有权导致 Dock 闪烁 */
function linuxClipboardWrite(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('wl-copy', [], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: process.env
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`wl-copy exited ${code}`))
    })
    child.stdin.end(text, 'utf8')
  })
}

async function linuxClipboardRead(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('wl-paste', ['--no-newline'], {
      timeout: 400,
      env: process.env
    })
    return stdout
  } catch {
    return ''
  }
}

const LINUX_INSTALL_CMD = 'sudo apt install wl-clipboard xclip libinput-tools'

/** Linux 划词依赖是否已提示过（避免 mouseup 刷屏） */
let linuxSelectionDepsWarned = false

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export type SelectionRuntimeStatus = {
  platform: NodeJS.Platform
  /** 当前环境是否具备划词取词条件 */
  ready: boolean
  /** Linux 缺依赖时的安装命令；其他平台为 null */
  installCommand: string | null
  hasXclip: boolean
  hasWlPaste: boolean
  hint: string
}

/** 各平台划词运行时依赖状态（供设置页提示） */
export function getSelectionRuntimeStatus(): SelectionRuntimeStatus {
  if (process.platform === 'darwin') {
    return {
      platform: 'darwin',
      ready: true,
      installCommand: null,
      hasXclip: false,
      hasWlPaste: false,
      hint: 'macOS 划词依赖辅助功能权限，请在下方确认授权状态。'
    }
  }

  if (process.platform === 'win32') {
    return {
      platform: 'win32',
      ready: true,
      installCommand: null,
      hasXclip: false,
      hasWlPaste: false,
      hint: 'Windows 无需额外安装。划词时会短暂模拟 Ctrl+C 读取选区，随后自动恢复剪贴板。'
    }
  }

  const hasXclip = commandExists('xclip')
  const hasWlPaste = commandExists('wl-paste')
  const hasLibinput = commandExists('libinput')
  const ready = (hasXclip || hasWlPaste) && hasLibinput
  const missing: string[] = []
  if (!hasXclip && !hasWlPaste) missing.push('wl-clipboard 或 xclip')
  if (!hasLibinput) missing.push('libinput-tools')
  return {
    platform: process.platform,
    ready,
    installCommand: ready ? null : `sudo apt install ${['wl-clipboard', 'xclip', 'libinput-tools'].join(' ')}`,
    hasXclip,
    hasWlPaste,
    hint: ready
      ? `已检测到取词与鼠标监听工具（${[
          hasXclip && 'xclip',
          hasWlPaste && 'wl-paste',
          hasLibinput && 'libinput'
        ]
          .filter(Boolean)
          .join('、')}）。Wayland 下使用 libinput 监听划词。`
      : `Linux 划词缺少：${missing.join('、')}。请安装后重新登录（需加入 input 组）并重启应用：sudo apt install wl-clipboard xclip libinput-tools`
  }
}

/** Linux：检查主键选区工具；缺依赖时打一次日志 */
export function warnLinuxSelectionDepsOnce(): void {
  if (process.platform === 'darwin' || process.platform === 'win32') return
  if (linuxSelectionDepsWarned) return
  linuxSelectionDepsWarned = true
  const status = getSelectionRuntimeStatus()
  if (status.ready) return
  console.error(`[selection] ${status.hint}`)
}

/** 划词 Cmd+C 偷取剪贴板期间 >0；历史轮询应跳过 */
export let clipboardStealDepth = 0
/** 偷取结束后的宽限，覆盖 Wayland 上 Ctrl+C 延迟写入 */
let clipboardStealGraceUntil = 0
/** 本次偷取得到的文本，避免延迟写入被记入剪贴板历史 */
const suppressedClipboardTexts = new Set<string>()

export function beginClipboardSteal(): void {
  clipboardStealDepth += 1
}

export function endClipboardSteal(): void {
  if (clipboardStealDepth > 0) clipboardStealDepth -= 1
  // Wayland 合成器可能在我们恢复剪贴板之后才应用 Ctrl+C
  if (clipboardStealDepth === 0) {
    clipboardStealGraceUntil = Date.now() + 1500
  }
}

/** 剪贴板历史轮询：偷取中 / 宽限中 / 偷取结果文本均应忽略 */
export function shouldIgnoreClipboardForHistory(text: string): boolean {
  if (clipboardStealDepth > 0) return true
  if (Date.now() < clipboardStealGraceUntil) return true
  if (text.startsWith('__AI_TRANSLATOR_MARK_')) return true
  if (suppressedClipboardTexts.has(text)) return true
  return false
}

function suppressStolenClipboardText(text: string): void {
  if (!text) return
  suppressedClipboardTexts.add(text)
  setTimeout(() => suppressedClipboardTexts.delete(text), 3000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runOsascript(script: string, timeout = 500): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    timeout,
    maxBuffer: 1024 * 64
  })
  return stdout.trim()
}

/** 当前前台应用进程名（macOS: Cursor / Google Chrome；Windows: 进程名） */
export async function getFrontmostAppName(): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      return await runOsascript(
        `tell application "System Events" to get name of first application process whose frontmost is true`,
        400
      )
    } catch {
      return ''
    }
  }

  if (process.platform === 'win32') {
    try {
      const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [FgWin]::GetForegroundWindow()
$pid = [uint32]0
[void][FgWin]::GetWindowThreadProcessId($h, [ref]$pid)
(Get-Process -Id $pid -ErrorAction Stop).ProcessName
`
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], {
        timeout: 1000
      })
      return stdout.trim()
    } catch {
      return ''
    }
  }

  return ''
}

/** 扫描目录下的 .app 名称（去掉 .app 后缀，通常等于进程名） */
function listAppsInDirectory(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.app'))
      .map((name) => basename(name, '.app'))
      .filter(Boolean)
  } catch {
    return []
  }
}

async function listRunningAppNamesOnly(): Promise<string[]> {
  if (process.platform === 'darwin') {
    try {
      const raw = await runOsascript(
        `tell application "System Events" to get name of every application process whose background only is false`,
        1200
      )
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  if (process.platform === 'win32') {
    try {
      const ps = `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty ProcessName -Unique | Sort-Object`
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], {
        timeout: 2000
      })
      return stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  return []
}

/**
 * 可选排除应用列表
 * - running：仅当前运行中的应用
 * - all：已安装应用（macOS 扫描应用程序文件夹）并合并运行中的应用
 */
export type AppListMode = 'running' | 'all'

export async function listSelectableAppNames(mode: AppListMode = 'all'): Promise<string[]> {
  const names = new Set<string>()

  if (mode === 'all' && process.platform === 'darwin') {
    const dirs = [
      '/Applications',
      join(homedir(), 'Applications'),
      '/System/Applications'
    ]
    for (const dir of dirs) {
      for (const name of listAppsInDirectory(dir)) {
        names.add(name)
      }
      if (existsSync(dir)) {
        try {
          for (const entry of readdirSync(dir)) {
            if (entry.endsWith('.app')) continue
            const sub = join(dir, entry)
            for (const name of listAppsInDirectory(sub)) {
              names.add(name)
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  for (const name of await listRunningAppNamesOnly()) {
    if (mode === 'running' || mode === 'all') {
      names.add(name)
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** 兼容旧调用：默认返回全部 */
export async function listRunningAppNames(): Promise<string[]> {
  return listSelectableAppNames('all')
}

export type ExcludedAppLike = { name: string; enabled: boolean } | string

export type SelectionAppModeLike = 'all' | 'selected'

function appNameMatches(appName: string, entryName: string): boolean {
  const lower = appName.trim().toLowerCase()
  const e = entryName.trim().toLowerCase()
  if (!lower || !e) return false
  return lower === e || lower.includes(e) || e.includes(lower)
}

function isSelfApp(appName: string): boolean {
  const lower = appName.trim().toLowerCase()
  return lower === 'electron' || lower === 'ai translator'
}

/** 应用是否在白名单中（列表内即生效） */
export function isAppAllowlisted(appName: string, apps: ExcludedAppLike[]): boolean {
  const name = appName.trim()
  if (!name || isSelfApp(name)) return false
  return apps.some((item) => {
    const entryName = typeof item === 'string' ? item : item.name
    return appNameMatches(name, entryName)
  })
}

/**
 * 是否应跳过划词。
 * - 始终跳过本应用
 * - all：命中黑名单则跳过；名单空则允许
 * - selected：仅白名单中的应用允许（忽略黑名单）
 */
export function shouldSkipSelection(
  appName: string,
  mode: SelectionAppModeLike,
  allowlist: ExcludedAppLike[],
  blacklist: ExcludedAppLike[] = []
): boolean {
  const name = appName.trim()
  if (!name) return false
  if (isSelfApp(name)) return true
  if (mode === 'selected') return !isAppAllowlisted(name, allowlist)
  // all：黑名单命中则跳过
  return isAppAllowlisted(name, blacklist)
}

/**
 * Accessibility 读选区（不碰剪贴板）。
 * 覆盖 focused 元素，并再试窗口内常见文本控件。
 */
async function getMacSelectedViaAX(): Promise<string> {
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      set appName to name of frontApp
      if appName is "Electron" or appName is "AI Translator" then return ""
      tell frontApp
        try
          set focusedEl to focused UI element
          set t to value of attribute "AXSelectedText" of focusedEl
          if t is not missing value and (t as text) is not "" then return t as text
        end try
        try
          set t to value of attribute "AXSelectedText" of text area 1 of window 1
          if t is not missing value and (t as text) is not "" then return t as text
        end try
        try
          set t to value of attribute "AXSelectedText" of text field 1 of window 1
          if t is not missing value and (t as text) is not "" then return t as text
        end try
        return ""
      end tell
    end tell
  `
  return runOsascript(script, 450)
}

/**
 * 模拟 Cmd/Ctrl+C（带 marker，避免与原剪贴板相同导致误判）。
 * 仅应作为 AX 失败后的兜底。
 */
async function copySelectionViaShortcut(): Promise<string> {
  beginClipboardSteal()
  const useLinuxWl = process.platform !== 'darwin' && process.platform !== 'win32'
  try {
    const previous = useLinuxWl ? await linuxClipboardRead() : clipboard.readText()
    const marker = `__AI_TRANSLATOR_MARK_${Date.now()}__`
    // Linux：禁止用 Electron clipboard.writeText（会抢 Wayland 数据设备所有权 → Dock 闪）
    if (useLinuxWl) {
      try {
        await linuxClipboardWrite(marker)
      } catch {
        // wl-copy 不可用时退回 Electron API
        clipboard.writeText(marker)
      }
    } else {
      clipboard.writeText(marker)
    }

    const restorePrevious = async (): Promise<void> => {
      if (useLinuxWl) {
        try {
          await linuxClipboardWrite(previous)
          return
        } catch {
          // fall through
        }
      }
      try {
        clipboard.writeText(previous)
      } catch {
        // ignore
      }
    }

    try {
      if (process.platform === 'darwin') {
        await runOsascript(
          'tell application "System Events" to keystroke "c" using command down',
          400
        )
      } else if (process.platform === 'win32') {
        await execFileAsync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"
          ],
          { timeout: 600 }
        )
      } else {
        // Linux：Wayland 优先 ydotool（避免 xdotool 激活 XWayland 远程桌面）
        let sent = false
        const tryYdotool = async (): Promise<boolean> => {
          try {
            await execFileAsync('ydotool', ['key', '29:1', '46:1', '46:0', '29:0'], {
              timeout: 600,
              env: process.env
            })
            return true
          } catch {
            return false
          }
        }
        const tryXdotool = async (): Promise<boolean> => {
          try {
            await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+c'], {
              timeout: 600
            })
            return true
          } catch {
            return false
          }
        }
        if (isWaylandSession()) {
          sent = (await tryYdotool()) || (await tryXdotool())
        } else {
          sent = (await tryXdotool()) || (await tryYdotool())
        }
        if (!sent) {
          await restorePrevious()
          return ''
        }
      }

      await sleep(150)
      const text = useLinuxWl ? await linuxClipboardRead() : clipboard.readText()
      await restorePrevious()
      // Wayland 上 Ctrl+C 结果可能晚于恢复写入，再补一次恢复
      if (useLinuxWl) {
        setTimeout(() => {
          beginClipboardSteal()
          void restorePrevious().finally(() => endClipboardSteal())
        }, 400)
      }

      if (!text || text === marker) return ''
      const trimmed = text.trim()
      // 避免偷取结果（或延迟到达）进入剪贴板历史
      suppressStolenClipboardText(trimmed)
      suppressStolenClipboardText(marker)
      return trimmed
    } catch {
      await restorePrevious()
      return ''
    }
  } finally {
    endClipboardSteal()
  }
}

/** 同步读取 Linux 主键选区（mousedown 快照用） */
export function readLinuxPrimaryTextSync(): string {
  if (process.platform === 'darwin' || process.platform === 'win32') return ''
  try {
    return execFileSync('wl-paste', ['--primary', '--no-newline'], {
      timeout: 200,
      encoding: 'utf8'
    }).trim()
  } catch {
    // ignore
  }
  try {
    return execFileSync('xclip', ['-o', '-selection', 'primary'], {
      timeout: 200,
      encoding: 'utf8'
    }).trim()
  } catch {
    // ignore
  }
  return ''
}

export type GetSelectedTextOptions = {
  /** 默认 false：只走 AX / 系统选区，不模拟复制 */
  allowClipboardSteal?: boolean
  /**
   * Linux：mousedown 时的主键快照。
   * 若取词结果与快照相同，视为无新选区（避免点击误弹）。
   */
  primarySnapshot?: string
  /**
   * Linux：跳过主键，直接走 Ctrl+C。
   * Chrome Wayland 常不写主键；鼠标路径用此避免每次点击 spawn wl-paste。
   */
  skipPrimary?: boolean
}

/** 防止连续 mouseup 叠多个 osascript / Cmd+C */
let inflight: Promise<string> | null = null

export async function getSelectedText(options?: GetSelectedTextOptions): Promise<string> {
  if (inflight) {
    // 已有取词在进行：直接跳过，避免堆积变卡
    return ''
  }

  const allowCopy = options?.allowClipboardSteal === true
  const primarySnapshot = options?.primarySnapshot
  const skipPrimary = options?.skipPrimary === true

  inflight = (async () => {
    if (process.platform === 'darwin') {
      try {
        const ax = await getMacSelectedViaAX()
        if (ax) return ax
      } catch {
        // Accessibility denied or timeout
      }
      if (allowCopy) return copySelectionViaShortcut()
      return ''
    }

    if (process.platform === 'win32') {
      if (allowCopy) return copySelectionViaShortcut()
      return ''
    }

    // Linux：鼠标路径可跳过主键（Chrome Wayland 常不更新）
    if (!skipPrimary) {
      const snapshot = primarySnapshot ?? ''
      const readPrimary = async (): Promise<string> => {
        try {
          const { stdout } = await execFileAsync('wl-paste', ['--primary', '--no-newline'], {
            timeout: 300
          })
          const t = stdout.trim()
          if (t) return t
        } catch {
          // ignore
        }
        try {
          const { stdout } = await execFileAsync('xclip', ['-o', '-selection', 'primary'], {
            timeout: 300
          })
          return stdout.trim()
        } catch {
          return ''
        }
      }

      let primary = await readPrimary()
      if (primary && primary !== snapshot) return primary

      // 双击/拖选后主键可能稍晚才写入，再读一次
      await sleep(140)
      primary = await readPrimary()
      if (primary && primary !== snapshot) return primary
    }

    if (!allowCopy) return ''
    return copySelectionViaShortcut()
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
