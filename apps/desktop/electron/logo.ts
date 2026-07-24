import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app, nativeImage, type NativeImage } from 'electron'

function candidatePaths(files: string[]): string[] {
  const roots: string[] = []
  try {
    if (process.resourcesPath) roots.push(process.resourcesPath)
  } catch {
    // ignore
  }
  try {
    roots.push(join(app.getAppPath(), 'resources'))
  } catch {
    // ignore
  }
  roots.push(join(__dirname, '../../resources'))
  roots.push(join(process.cwd(), 'resources'))

  const out: string[] = []
  for (const root of roots) {
    for (const file of files) {
      out.push(join(root, file))
    }
  }
  return out
}

function firstExisting(files: string[]): string | null {
  for (const p of candidatePaths(files)) {
    if (existsSync(p)) return p
  }
  return null
}

export function resolveLogoPath(): string | null {
  return firstExisting(['icon.png', 'icon-512.png', 'icon-128.png'])
}

let cachedDataUrl: string | null | undefined
let cachedNative: NativeImage | null | undefined

/** 划词浮标用（优先小图） */
export function getLogoDataUrl(): string | null {
  if (cachedDataUrl !== undefined) return cachedDataUrl
  const path = firstExisting(['icon-128.png', 'icon-512.png', 'icon.png'])
  if (!path) {
    cachedDataUrl = null
    return null
  }
  try {
    const buf = readFileSync(path)
    cachedDataUrl = `data:image/png;base64,${buf.toString('base64')}`
    return cachedDataUrl
  } catch {
    cachedDataUrl = null
    return null
  }
}

/** 窗口 / Dock 图标 */
export function getAppNativeImage(): NativeImage | undefined {
  if (cachedNative !== undefined) return cachedNative ?? undefined
  const path = resolveLogoPath()
  if (!path) {
    cachedNative = null
    return undefined
  }
  const img = nativeImage.createFromPath(path)
  cachedNative = img.isEmpty() ? null : img
  return cachedNative ?? undefined
}
