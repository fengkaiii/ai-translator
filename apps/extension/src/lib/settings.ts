export type ExtensionProvider = 'deepseek' | 'cursor'
export type PageMode = 'bilingual' | 'replace'
/** 全量=一次翻完全页配额；渐进=视口预取带 + 滚动续翻 */
export type TranslateScope = 'full' | 'partial'
export type TargetLang = 'zh' | 'en'

export type ExtensionSettings = {
  provider: ExtensionProvider
  deepseek: { baseUrl: string; apiKey: string; model: string }
  pageMode: PageMode
  translateScope: TranslateScope
  /** 页面右下角浮动按钮；可在设置中关闭 */
  showFloatingButton: boolean
  targetLang?: TargetLang
}

const DEFAULTS: ExtensionSettings = {
  provider: 'deepseek',
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-flash'
  },
  pageMode: 'bilingual',
  translateScope: 'partial',
  showFloatingButton: true
}

async function readStore(): Promise<Partial<ExtensionSettings>> {
  try {
    return (await chrome.storage.sync.get(null)) as Partial<ExtensionSettings>
  } catch {
    return (await chrome.storage.local.get(null)) as Partial<ExtensionSettings>
  }
}

async function writeStore(value: ExtensionSettings): Promise<void> {
  try {
    await chrome.storage.sync.set(value)
  } catch {
    await chrome.storage.local.set(value)
  }
}

export async function getExtensionSettings(): Promise<ExtensionSettings> {
  const raw = await readStore()
  return {
    provider: raw.provider === 'cursor' ? 'cursor' : 'deepseek',
    deepseek: {
      baseUrl: raw.deepseek?.baseUrl?.trim() || DEFAULTS.deepseek.baseUrl,
      apiKey: raw.deepseek?.apiKey ?? '',
      model: raw.deepseek?.model?.trim() || DEFAULTS.deepseek.model
    },
    pageMode: raw.pageMode === 'replace' ? 'replace' : 'bilingual',
    translateScope: raw.translateScope === 'full' ? 'full' : 'partial',
    showFloatingButton: raw.showFloatingButton !== false,
    targetLang: raw.targetLang === 'zh' || raw.targetLang === 'en' ? raw.targetLang : undefined
  }
}

export async function saveExtensionSettings(
  partial: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await getExtensionSettings()
  const next: ExtensionSettings = {
    ...current,
    ...partial,
    deepseek: { ...current.deepseek, ...(partial.deepseek ?? {}) }
  }
  await writeStore(next)
  return next
}
