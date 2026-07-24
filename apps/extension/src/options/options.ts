import {
  getExtensionSettings,
  saveExtensionSettings,
  type ExtensionProvider,
  type PageMode
} from '../lib/settings'

const providerEl = document.getElementById('provider') as HTMLSelectElement
const baseUrlEl = document.getElementById('baseUrl') as HTMLInputElement
const apiKeyEl = document.getElementById('apiKey') as HTMLInputElement
const modelEl = document.getElementById('model') as HTMLInputElement
const pageModeEl = document.getElementById('pageMode') as HTMLSelectElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const saveBtn = document.getElementById('save') as HTMLButtonElement

async function load(): Promise<void> {
  const s = await getExtensionSettings()
  providerEl.value = s.provider
  baseUrlEl.value = s.deepseek.baseUrl
  apiKeyEl.value = s.deepseek.apiKey
  modelEl.value = s.deepseek.model
  pageModeEl.value = s.pageMode
}

saveBtn.addEventListener('click', async () => {
  statusEl.textContent = '保存中…'
  try {
    await saveExtensionSettings({
      provider: providerEl.value as ExtensionProvider,
      deepseek: {
        baseUrl: baseUrlEl.value.trim(),
        apiKey: apiKeyEl.value,
        model: modelEl.value.trim()
      },
      pageMode: pageModeEl.value as PageMode
    })
    statusEl.textContent = '已保存'
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err)
  }
})

void load()
