import Store from 'electron-store'
import {
  getProvider,
  inferProvider,
  isProviderId,
  resolveModelForProvider,
  type ProviderId
} from '../src/lib/providers'

/** 划词应用范围：all = 全部应用（可用 blacklistedApps 排除）；selected = 仅 excludedApps 白名单内 */

export type ThemeMode = 'dark' | 'light' | 'system'

export type SelectionAppMode = 'all' | 'selected'

export type ExcludedAppEntry = {
  /** 系统进程名，如 Cursor */
  name: string
  /** 兼容旧字段；加入列表即白名单，不再依赖勾选 */
  enabled: boolean
}

export type AppSettings = {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  /** 切换厂商时保留各自 API Key */
  providerApiKeys: Partial<Record<ProviderId, string>>
  selectionEnabled: boolean
  /** 划词应用范围，默认全部 */
  selectionAppMode: SelectionAppMode
  hotkey: string
  theme: ThemeMode
  /** 「已选中」模式下的应用白名单（字段名沿用，避免迁移） */
  excludedApps: ExcludedAppEntry[]
  /** 「全部应用」模式下的黑名单；名单内禁用划词 */
  blacklistedApps: ExcludedAppEntry[]
  clipboardHistoryEnabled: boolean
  clipboardHistoryHotkey: string
  /** 空字符串表示使用默认存储目录 */
  clipboardHistoryStorageDir: string
  /** 开机自启，默认关闭 */
  launchAtLogin: boolean
}

const defaults: AppSettings = {
  provider: 'deepseek',
  baseUrl: getProvider('deepseek').baseUrl,
  apiKey: '',
  model: getProvider('deepseek').defaultModel,
  providerApiKeys: {},
  selectionEnabled: false,
  selectionAppMode: 'all',
  hotkey: process.platform === 'darwin' ? 'Command+Shift+T' : 'Control+Shift+T',
  theme: 'system',
  excludedApps: [],
  blacklistedApps: [],
  clipboardHistoryEnabled: false,
  clipboardHistoryHotkey:
    process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V',
  clipboardHistoryStorageDir: '',
  launchAtLogin: false
}

const store = new Store<AppSettings>({
  name: 'settings',
  defaults
})

export function normalizeExcludedApps(apps: unknown): ExcludedAppEntry[] {
  if (!Array.isArray(apps)) return []
  const seen = new Set<string>()
  const out: ExcludedAppEntry[] = []
  for (const raw of apps) {
    let name = ''
    if (typeof raw === 'string') {
      name = raw.trim()
    } else if (raw && typeof raw === 'object' && 'name' in raw) {
      const item = raw as { name?: unknown }
      name = String(item.name ?? '').trim()
    }
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // 列表内即白名单；enabled 仅兼容旧存储
    out.push({ name, enabled: true })
  }
  return out
}

function normalizeSelectionAppMode(raw: unknown): SelectionAppMode {
  return raw === 'selected' ? 'selected' : 'all'
}

function normalizeProviderApiKeys(raw: unknown): Partial<Record<ProviderId, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const out: Partial<Record<ProviderId, string>> = {}
  if (typeof obj.deepseek === 'string') out.deepseek = obj.deepseek
  if (typeof obj.cursor === 'string') out.cursor = obj.cursor
  return out
}

export function getSettings(): AppSettings {
  const baseUrl = store.get('baseUrl')
  const model = store.get('model')
  const storedProvider = store.get('provider')
  const provider = isProviderId(storedProvider)
    ? storedProvider
    : inferProvider(baseUrl, model)
  const providerApiKeys = normalizeProviderApiKeys(store.get('providerApiKeys') ?? {})
  const apiKey = store.get('apiKey') || providerApiKeys[provider] || ''

  return {
    provider,
    baseUrl,
    apiKey,
    model: resolveModelForProvider(provider, model),
    providerApiKeys: {
      ...providerApiKeys,
      [provider]: apiKey
    },
    selectionEnabled: store.get('selectionEnabled'),
    selectionAppMode: normalizeSelectionAppMode(store.get('selectionAppMode')),
    hotkey: store.get('hotkey'),
    theme: store.get('theme') ?? 'system',
    excludedApps: normalizeExcludedApps(store.get('excludedApps') ?? []),
    blacklistedApps: normalizeExcludedApps(store.get('blacklistedApps') ?? []),
    clipboardHistoryEnabled: store.get('clipboardHistoryEnabled') ?? false,
    clipboardHistoryHotkey: store.get('clipboardHistoryHotkey') ?? defaults.clipboardHistoryHotkey,
    clipboardHistoryStorageDir: String(store.get('clipboardHistoryStorageDir') ?? '').trim(),
    launchAtLogin: store.get('launchAtLogin') ?? false
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next: AppSettings = { ...current, ...partial }

  if (partial.excludedApps !== undefined) {
    next.excludedApps = normalizeExcludedApps(partial.excludedApps)
  }
  if (partial.blacklistedApps !== undefined) {
    next.blacklistedApps = normalizeExcludedApps(partial.blacklistedApps)
  }
  if (partial.selectionAppMode !== undefined) {
    next.selectionAppMode = normalizeSelectionAppMode(partial.selectionAppMode)
  }
  if (partial.clipboardHistoryStorageDir !== undefined) {
    next.clipboardHistoryStorageDir = String(partial.clipboardHistoryStorageDir).trim()
  }

  if (partial.provider !== undefined && isProviderId(partial.provider)) {
    next.provider = partial.provider
  } else if (!isProviderId(next.provider)) {
    next.provider = inferProvider(next.baseUrl, next.model)
  }

  // 切换厂商：写入默认 baseUrl/model，并恢复该厂商已保存的 key
  if (partial.provider !== undefined && partial.provider !== current.provider) {
    const def = getProvider(next.provider)
    if (partial.baseUrl === undefined) next.baseUrl = def.baseUrl
    if (partial.model === undefined) next.model = def.defaultModel
    const keys = { ...current.providerApiKeys, [current.provider]: current.apiKey }
    if (partial.apiKey === undefined) {
      next.apiKey = keys[next.provider] ?? ''
    }
    next.providerApiKeys = {
      ...keys,
      [next.provider]: next.apiKey
    }
  } else {
    next.providerApiKeys = {
      ...current.providerApiKeys,
      ...(partial.providerApiKeys ?? {}),
      [next.provider]: next.apiKey
    }
  }

  next.model = resolveModelForProvider(next.provider, next.model)
  store.set(next)
  return next
}

export type { ProviderId }
