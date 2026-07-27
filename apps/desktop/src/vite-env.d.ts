/// <reference types="vite/client" />

export type ThemeMode = 'dark' | 'light' | 'system'

export type ProviderId = 'deepseek' | 'cursor'

export type SelectionAppMode = 'all' | 'selected'

export type ExcludedAppEntry = {
  name: string
  enabled: boolean
}

export type AppSettings = {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  providerApiKeys: Partial<Record<ProviderId, string>>
  selectionEnabled: boolean
  selectionAppMode: SelectionAppMode
  hotkey: string
  theme: ThemeMode
  excludedApps: ExcludedAppEntry[]
  blacklistedApps: ExcludedAppEntry[]
}

export type TranslateRequest = {
  text: string
  mode: 'translate' | 'polish'
  previousTranslation?: string
  /** 强制目标语言；不传则自动判定 */
  targetLang?: 'zh' | 'en'
}

export type TranslateResponse = {
  text: string
}

export type AccessibilityStatus = {
  platform: string
  trusted: boolean
  electronAppPath: string | null
  hint: string
}

export type TranslatorApi = {
  getSettings: () => Promise<AppSettings>
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  translate: (req: TranslateRequest) => Promise<TranslateResponse>
  getAccessibilityStatus: () => Promise<AccessibilityStatus>
  requestAccessibility: () => Promise<AccessibilityStatus>
  revealElectronApp: () => Promise<{ ok: boolean; path: string | null }>
  getFrontmostAppName: () => Promise<string>
  listApps: (mode?: 'running' | 'all') => Promise<string[]>
  listModels: (opts?: {
    apiKey?: string
    provider?: 'deepseek' | 'cursor'
  }) => Promise<Array<{ id: string; label: string }>>
  onFillAndTranslate: (callback: (text: string) => void) => () => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
}

declare global {
  interface Window {
    translator: TranslatorApi
  }
}

export {}
