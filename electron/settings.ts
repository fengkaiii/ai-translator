import Store from 'electron-store'

export type ThemeMode = 'dark' | 'light' | 'system'

export type ExcludedAppEntry = {
  /** 系统进程名，如 Cursor */
  name: string
  /** 勾选后才真正排除划词 */
  enabled: boolean
}

export type AppSettings = {
  baseUrl: string
  apiKey: string
  model: string
  selectionEnabled: boolean
  hotkey: string
  theme: ThemeMode
  excludedApps: ExcludedAppEntry[]
}

const defaults: AppSettings = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-v4-flash',
  selectionEnabled: false,
  hotkey: process.platform === 'darwin' ? 'Command+Shift+T' : 'Control+Shift+T',
  theme: 'system',
  excludedApps: []
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
    let enabled = true
    if (typeof raw === 'string') {
      // 兼容旧版 string[]
      name = raw.trim()
      enabled = true
    } else if (raw && typeof raw === 'object' && 'name' in raw) {
      const item = raw as { name?: unknown; enabled?: unknown }
      name = String(item.name ?? '').trim()
      enabled = item.enabled !== false
    }
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, enabled })
  }
  return out
}

export function getSettings(): AppSettings {
  return {
    baseUrl: store.get('baseUrl'),
    apiKey: store.get('apiKey'),
    model: store.get('model'),
    selectionEnabled: store.get('selectionEnabled'),
    hotkey: store.get('hotkey'),
    theme: store.get('theme') ?? 'system',
    excludedApps: normalizeExcludedApps(store.get('excludedApps') ?? [])
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...partial }
  if (partial.excludedApps !== undefined) {
    next.excludedApps = normalizeExcludedApps(partial.excludedApps)
  }
  store.set(next)
  return next
}
