/** 内置厂商与模型目录（OpenAI 兼容 Chat Completions） */

export type ProviderId = 'deepseek' | 'cursor'

export type ProviderModel = {
  id: string
  label: string
}

export type ProviderDef = {
  id: ProviderId
  name: string
  /** 默认 Base URL（不含尾斜杠）；Cursor 多为自建/代理网关，可再改 */
  baseUrl: string
  defaultModel: string
  models: ProviderModel[]
  /** API Key 占位提示 */
  apiKeyHint: string
  /** 设置页说明 */
  hint: string
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    apiKeyHint: 'sk-…',
    hint: '官方 DeepSeek Chat Completions（/v1/chat/completions）',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    baseUrl: 'https://api.cursor.com',
    defaultModel: 'auto',
    apiKeyHint: 'crsr_…（Dashboard → API Keys）',
    hint: '官方 @cursor/sdk 本地运行时（本机 agent 循环，模型仍走 Cursor 云端）。请填 API Key 后点「刷新模型」',
    models: [{ id: 'auto', label: '账号自动选择（auto）' }]
  }
]

export function getProvider(id: ProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

export function isProviderId(value: unknown): value is ProviderId {
  return value === 'deepseek' || value === 'cursor'
}

/** 根据已有 baseUrl / model 推断厂商（迁移旧配置） */
export function inferProvider(baseUrl: string, model: string): ProviderId {
  const url = baseUrl.toLowerCase()
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('api.cursor.com') || url.includes('cursor.com')) return 'cursor'
  const inDeepseek = getProvider('deepseek').models.some((m) => m.id === model)
  if (inDeepseek) return 'deepseek'
  const inCursor = getProvider('cursor').models.some((m) => m.id === model)
  if (inCursor) return 'cursor'
  return 'deepseek'
}

export function resolveModelForProvider(provider: ProviderId, model: string): string {
  const def = getProvider(provider)
  if (provider === 'cursor') {
    // Cursor 模型来自账号动态列表；旧 default 迁到 auto
    if (!model || model === 'default') return def.defaultModel
    return model
  }
  if (def.models.some((m) => m.id === model)) return model
  return def.defaultModel
}
