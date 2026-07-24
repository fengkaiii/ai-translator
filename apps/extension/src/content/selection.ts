import { requestTranslate } from '../lib/translate-client'
import { getExtensionSettings, type TargetLang } from '../lib/settings'

type BubbleState = {
  text: string
  result: string
  targetLang: TargetLang | undefined
  loading: boolean
}

const HOST_ID = 'ai-translator-selection-host'

let state: BubbleState | null = null
let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null

function ensureHost(): ShadowRoot {
  if (host && shadow) return shadow
  host = document.createElement('div')
  host.id = HOST_ID
  host.style.all = 'initial'
  host.style.position = 'fixed'
  host.style.zIndex = '2147483646'
  host.style.top = '0'
  host.style.left = '0'
  document.documentElement.appendChild(host)
  shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bubble {
        position: fixed;
        min-width: 220px;
        max-width: 360px;
        background: #111;
        color: #f5f5f5;
        border-radius: 10px;
        box-shadow: 0 8px 28px rgba(0,0,0,.35);
        font: 13px/1.45 system-ui, sans-serif;
        padding: 10px;
      }
      .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
      button {
        border: 0;
        border-radius: 6px;
        padding: 4px 8px;
        background: #2a2a2a;
        color: #fff;
        cursor: pointer;
      }
      button:hover { background: #3a3a3a; }
      button:disabled { opacity: .5; cursor: default; }
      .result {
        white-space: pre-wrap;
        word-break: break-word;
        min-height: 1.2em;
        color: #ddd;
      }
      .err { color: #f88; }
    </style>
    <div class="bubble" part="bubble" hidden>
      <div class="actions">
        <button data-act="translate" type="button">翻译</button>
        <button data-act="polish" type="button">润色</button>
        <button data-act="swap" type="button">→中文</button>
        <button data-act="copy" type="button">复制</button>
        <button data-act="close" type="button">关闭</button>
      </div>
      <div class="result"></div>
    </div>
  `
  shadow.querySelector('.bubble')!.addEventListener('mousedown', (e) => e.stopPropagation())
  shadow.querySelector('.actions')!.addEventListener('click', onActionClick)
  return shadow
}

function hideBubble(): void {
  state = null
  const root = ensureHost()
  const bubble = root.querySelector('.bubble') as HTMLElement
  bubble.hidden = true
}

function render(): void {
  if (!state) return
  const root = ensureHost()
  const bubble = root.querySelector('.bubble') as HTMLElement
  const result = root.querySelector('.result') as HTMLElement
  const swap = root.querySelector('[data-act="swap"]') as HTMLButtonElement
  const polish = root.querySelector('[data-act="polish"]') as HTMLButtonElement

  swap.textContent =
    !state.targetLang || state.targetLang === 'en' ? '→中文' : '→英文'
  polish.disabled = !state.result || state.loading
  result.className = 'result'
  result.textContent = state.loading ? '翻译中…' : state.result || '选中文字后点击翻译'
  bubble.hidden = false
}

function placeNearSelection(): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !state) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  const root = ensureHost()
  const bubble = root.querySelector('.bubble') as HTMLElement
  const top = Math.min(window.innerHeight - 20, Math.max(8, rect.bottom + 8))
  const left = Math.min(window.innerWidth - 240, Math.max(8, rect.left))
  bubble.style.top = `${top}px`
  bubble.style.left = `${left}px`
}

async function onActionClick(ev: Event): Promise<void> {
  const btn = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null
  if (!btn || !state) return
  const act = btn.dataset.act
  if (act === 'close') {
    hideBubble()
    return
  }
  if (act === 'copy') {
    if (state.result) await navigator.clipboard.writeText(state.result)
    return
  }
  if (act === 'swap') {
    if (!state.targetLang || state.targetLang === 'en') state.targetLang = 'zh'
    else state.targetLang = 'en'
    render()
    return
  }
  if (act === 'translate' || act === 'polish') {
    state.loading = true
    render()
    try {
      const result = await requestTranslate({
        text: state.text,
        mode: act === 'polish' ? 'polish' : 'translate',
        previousTranslation: act === 'polish' ? state.result : undefined,
        targetLang: state.targetLang
      })
      state.result = result
    } catch (err) {
      const root = ensureHost()
      const resultEl = root.querySelector('.result') as HTMLElement
      resultEl.className = 'result err'
      resultEl.textContent = err instanceof Error ? err.message : String(err)
      state.loading = false
      return
    }
    state.loading = false
    render()
  }
}

async function onMouseUp(): Promise<void> {
  // 延迟一帧，避免点击气泡本身时误判
  await new Promise((r) => setTimeout(r, 10))
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!text) return

  const settings = await getExtensionSettings()
  state = {
    text,
    result: '',
    targetLang: settings.targetLang,
    loading: false
  }
  render()
  placeNearSelection()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') hideBubble()
}

function onDocMouseDown(e: MouseEvent): void {
  if (!host) return
  const path = e.composedPath()
  if (path.includes(host)) return
  hideBubble()
}

document.addEventListener('mouseup', () => {
  void onMouseUp()
})
document.addEventListener('keydown', onKeyDown)
document.addEventListener('mousedown', onDocMouseDown)

console.debug('[ai-translator] selection content script ready')
