import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { clipboard } from 'electron'

const execFileAsync = promisify(execFile)

/** 划词 Cmd+C 偷取剪贴板期间 >0；历史轮询应跳过 */
export let clipboardStealDepth = 0

export function beginClipboardSteal(): void {
  clipboardStealDepth += 1
}

export function endClipboardSteal(): void {
  if (clipboardStealDepth > 0) clipboardStealDepth -= 1
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
  try {
    const previous = clipboard.readText()
    const marker = `__AI_TRANSLATOR_MARK_${Date.now()}__`
    clipboard.writeText(marker)

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
        clipboard.writeText(previous)
        return ''
      }

      await sleep(120)
      const text = clipboard.readText()
      clipboard.writeText(previous)

      if (!text || text === marker) return ''
      return text.trim()
    } catch {
      try {
        clipboard.writeText(previous)
      } catch {
        // ignore
      }
      return ''
    }
  } finally {
    endClipboardSteal()
  }
}

export type GetSelectedTextOptions = {
  /** 默认 false：只走 AX / 系统选区，不模拟复制 */
  allowClipboardSteal?: boolean
}

/** 防止连续 mouseup 叠多个 osascript / Cmd+C */
let inflight: Promise<string> | null = null

export async function getSelectedText(options?: GetSelectedTextOptions): Promise<string> {
  if (inflight) {
    // 已有取词在进行：直接跳过，避免堆积变卡
    return ''
  }

  const allowCopy = options?.allowClipboardSteal === true

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

    // Linux：主键选区，不模拟 Ctrl+C
    try {
      const { stdout } = await execFileAsync('xclip', ['-o', '-selection', 'primary'], {
        timeout: 300
      })
      if (stdout.trim()) return stdout.trim()
    } catch {
      // ignore
    }
    try {
      const { stdout } = await execFileAsync('wl-paste', ['--primary', '--no-newline'], {
        timeout: 300
      })
      if (stdout.trim()) return stdout.trim()
    } catch {
      // ignore
    }
    return ''
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
