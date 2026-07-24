/// <reference types="vite/client" />

export type ThemeMode = 'dark' | 'light' | 'system'

export type ExcludedAppEntry = {
  name: string
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

export type TranslateRequest = {
  text: string
  mode: 'translate' | 'polish'
  previousTranslation?: string
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
  onFillAndTranslate: (callback: (text: string) => void) => () => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
}

declare global {
  interface Window {
    translator: TranslatorApi
  }
}

export {}
