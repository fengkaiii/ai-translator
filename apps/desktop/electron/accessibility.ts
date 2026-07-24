import { app, systemPreferences, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export type AccessibilityStatus = {
  platform: NodeJS.Platform
  trusted: boolean
  /** 开发模式下需要手动添加到辅助功能的 Electron.app 路径 */
  electronAppPath: string | null
  hint: string
}

function resolveElectronAppPath(): string | null {
  // 打包后是 AI Translator.app；开发时是 node_modules 里的 Electron.app
  if (app.isPackaged) {
    return process.execPath.includes('.app/')
      ? process.execPath.slice(0, process.execPath.indexOf('.app/') + 4)
      : null
  }
  const candidate = join(
    app.getAppPath(),
    'node_modules',
    'electron',
    'dist',
    'Electron.app'
  )
  if (existsSync(candidate)) return candidate

  // electron-vite 下 getAppPath 可能指向 out/，回退到项目根
  const fromCwd = join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app')
  if (existsSync(fromCwd)) return fromCwd

  return null
}

export function getAccessibilityStatus(): AccessibilityStatus {
  if (process.platform !== 'darwin') {
    return {
      platform: process.platform,
      trusted: true,
      electronAppPath: null,
      hint: '当前系统无需 macOS 辅助功能授权'
    }
  }

  const trusted = systemPreferences.isTrustedAccessibilityClient(false)
  const electronAppPath = resolveElectronAppPath()

  return {
    platform: 'darwin',
    trusted,
    electronAppPath,
    hint: trusted
      ? '辅助功能已授权'
      : '开发模式下列表不会自动出现「AI Translator」。请点击下方按钮，用「+」添加 Electron.app，名称显示为 Electron。'
  }
}

/** 触发系统授权弹窗，并打开辅助功能设置页 */
export function requestAccessibility(): AccessibilityStatus {
  if (process.platform === 'darwin') {
    systemPreferences.isTrustedAccessibilityClient(true)
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
  }
  return getAccessibilityStatus()
}

/** 在 Finder 中显示 Electron.app，方便拖到辅助功能列表 */
export function revealElectronApp(): { ok: boolean; path: string | null } {
  const p = resolveElectronAppPath()
  if (!p) return { ok: false, path: null }
  shell.showItemInFolder(p)
  return { ok: true, path: p }
}
