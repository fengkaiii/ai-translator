import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  TranslateRequest,
  TranslateResponse,
  AccessibilityStatus,
  HistoryEntry,
  SelectionRuntimeStatus
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
  getSelectionRuntimeStatus: (): Promise<SelectionRuntimeStatus> =>
    ipcRenderer.invoke('selection:runtime-status'),
  getFrontmostAppName: (): Promise<string> => ipcRenderer.invoke('app:frontmost'),
  listApps: (mode: 'running' | 'all' = 'all'): Promise<string[]> =>
    ipcRenderer.invoke('app:list', mode),
  listModels: (opts?: {
    apiKey?: string
    provider?: 'deepseek' | 'cursor'
  }): Promise<Array<{ id: string; label: string }>> => ipcRenderer.invoke('models:list', opts),
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

contextBridge.exposeInMainWorld('clipboardHistory', {
  platform: process.platform,
  list: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('clipboard-history:list'),
  copy: (id: string): Promise<void> => ipcRenderer.invoke('clipboard-history:copy', id),
  paste: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('clipboard-history:paste', id),
  hide: (): Promise<void> => ipcRenderer.invoke('clipboard-history:hide'),
  beginDrag: (): void => {
    ipcRenderer.send('clipboard-history:drag-start')
  },
  endDrag: (): void => {
    ipcRenderer.send('clipboard-history:drag-end')
  },
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('clipboard-history:pick-dir'),
  resolvedDir: (): Promise<{ dir: string; usedFallback: boolean; defaultDir: string }> =>
    ipcRenderer.invoke('clipboard-history:resolved-dir'),
  onChanged: (callback: (entries: HistoryEntry[]) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, entries: HistoryEntry[]): void => {
      callback(entries)
    }
    ipcRenderer.on('clipboard-history:changed', listener)
    return () => ipcRenderer.removeListener('clipboard-history:changed', listener)
  }
})
