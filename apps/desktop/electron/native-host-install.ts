import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app } from 'electron'

/** 与 apps/extension/manifest.json 的 key 对应的稳定扩展 ID */
export const EXTENSION_ID = 'facimohbibpamgdkbigdabhomohndbla'
export const NATIVE_HOST_NAME = 'com.aitranslator.native'

/** 解析 native-host 脚本路径（开发态 getAppPath 可能指向 out/） */
function hostScriptCandidates(file: string): string[] {
  // 打包：extraResources → resources/native-host/
  if (app.isPackaged) {
    return [join(process.resourcesPath, 'native-host', file)]
  }

  // 开发：依次尝试 getAppPath → cwd(apps/desktop|repo root) → __dirname 相对
  const out: string[] = []
  try {
    out.push(join(app.getAppPath(), 'native-host', file))
  } catch {
    // ignore
  }
  out.push(join(process.cwd(), 'native-host', file))
  out.push(join(process.cwd(), 'apps/desktop/native-host', file))
  // electron-vite main 编译到 out/main，上两级即 apps/desktop
  out.push(join(__dirname, '../../native-host', file))
  return out
}

function hostScriptPath(): string {
  const file = process.platform === 'win32' ? 'host.mjs' : 'run-host.sh'
  const candidates = hostScriptCandidates(file)
  let raw = candidates[0] ?? join(process.cwd(), 'native-host', file)
  for (const p of candidates) {
    if (existsSync(p)) {
      raw = p
      break
    }
  }
  // Chrome 要求 path 为绝对路径
  try {
    return realpathSync(raw)
  } catch {
    return raw
  }
}

function hostDirs(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [
      join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
      join(home, 'Library/Application Support/Chromium/NativeMessagingHosts')
    ]
  }
  if (process.platform === 'win32') {
    // Windows 还需写注册表；v1 先写用户级 JSON 路径，并在 README 注明
    return [join(home, 'AppData/Local/AI Translator/NativeMessagingHosts')]
  }
  return [
    join(home, '.config/google-chrome/NativeMessagingHosts'),
    join(home, '.config/microsoft-edge/NativeMessagingHosts'),
    join(home, '.config/chromium/NativeMessagingHosts')
  ]
}

/** 安装/更新 Chromium Native Messaging Host 清单 */
export function installNativeHostManifest(): { ok: boolean; path: string; error?: string } {
  const hostPath = hostScriptPath()
  if (!existsSync(hostPath)) {
    return { ok: false, path: hostPath, error: 'host.mjs not found' }
  }

  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'AI Translator native host for Cursor proxy',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  }

  const dirs = hostDirs()
  let lastPath = ''
  try {
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true })
      lastPath = join(dir, `${NATIVE_HOST_NAME}.json`)
      writeFileSync(lastPath, JSON.stringify(manifest, null, 2), 'utf8')
    }
    // 同时把 port 文件路径提示写到 userData，供 host 读取
    return { ok: true, path: lastPath }
  } catch (err) {
    return {
      ok: false,
      path: lastPath,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
