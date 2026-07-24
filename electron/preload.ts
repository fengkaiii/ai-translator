import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  TranslateRequest,
  TranslateResponse,
  AccessibilityStatus
} from '../src/vite-env'

contextBridge.exposeInMainWorld('translator', {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', partial),
  translate: (req: TranslateRequest): Promise<TranslateResponse> =>
    ipcRenderer.invoke('translate', req),
  getAccessibilityStatus: (): Promise<AccessibilityStatus> =>
    ipcRenderer.invoke('accessibility:status'),
  requestAccessibility: (): Promise<AccessibilityStatus> =>
    ipcRenderer.invoke('accessibility:request'),
  revealElectronApp: (): Promise<{ ok: boolean; path: string | null }> =>
    ipcRenderer.invoke('accessibility:reveal'),
  getFrontmostAppName: (): Promise<string> => ipcRenderer.invoke('app:frontmost'),
  listApps: (mode: 'running' | 'all' = 'all'): Promise<string[]> =>
    ipcRenderer.invoke('app:list', mode),
  onFillAndTranslate: (callback: (text: string) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, text: string): void => {
      callback(text)
    }
    ipcRenderer.on('fill-and-translate', listener)
    return () => ipcRenderer.removeListener('fill-and-translate', listener)
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, settings: AppSettings): void => {
      callback(settings)
    }
    ipcRenderer.on('settings-changed', listener)
    return () => ipcRenderer.removeListener('settings-changed', listener)
  }
})

contextBridge.exposeInMainWorld('translatorSelection', {
  translateSelection: (): Promise<void> => ipcRenderer.invoke('selection:translate'),
  polishSelection: (): Promise<void> => ipcRenderer.invoke('selection:polish'),
  swapSelectionLanguage: (): Promise<void> => ipcRenderer.invoke('selection:swap-language')
})
