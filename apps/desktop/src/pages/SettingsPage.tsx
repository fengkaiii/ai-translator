import { useEffect, useState, type KeyboardEvent } from 'react'
import type {
  AccessibilityStatus,
  AppSettings,
  ExcludedAppEntry,
  ProviderId,
  SelectionAppMode,
  ThemeMode
} from '../vite-env'
import { PROVIDERS, getProvider } from '../lib/providers'

const empty: AppSettings = {
  provider: 'deepseek',
  baseUrl: getProvider('deepseek').baseUrl,
  apiKey: '',
  model: getProvider('deepseek').defaultModel,
  providerApiKeys: {},
  selectionEnabled: false,
  selectionAppMode: 'all',
  hotkey: 'Command+Shift+T',
  theme: 'system',
  excludedApps: [],
  blacklistedApps: []
}

type Props = {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
}

export default function SettingsPage({ theme, onThemeChange }: Props) {
  const [form, setForm] = useState<AppSettings>(empty)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [access, setAccess] = useState<AccessibilityStatus | null>(null)
  const [runningApps, setRunningApps] = useState<string[]>([])
  const [pickedApp, setPickedApp] = useState('')
  const [appSource, setAppSource] = useState<'running' | 'all'>('all')
  const [cursorModels, setCursorModels] = useState<Array<{ id: string; label: string }>>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  useEffect(() => {
    void window.translator.getSettings().then((s) => {
      setForm({
        ...s,
        provider: s.provider ?? 'deepseek',
        providerApiKeys: s.providerApiKeys ?? {},
        selectionAppMode: s.selectionAppMode ?? 'all',
        excludedApps: s.excludedApps ?? [],
        blacklistedApps: s.blacklistedApps ?? []
      })
      onThemeChange(s.theme)
      if (s.provider === 'cursor' && s.apiKey.trim()) {
        void loadCursorModels(s.apiKey)
      }
    })
    void window.translator.getAccessibilityStatus().then(setAccess)
    void refreshAppList('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  const activeProvider = getProvider(form.provider ?? 'deepseek')
  const modelOptions =
    form.provider === 'cursor' && cursorModels.length > 0
      ? cursorModels
      : activeProvider.models

  async function loadCursorModels(apiKey = form.apiKey): Promise<void> {
    if (!apiKey.trim()) {
      setError('请先填写 Cursor API Key，再刷新模型')
      return
    }
    setModelsLoading(true)
    setError('')
    try {
      const list = await window.translator.listModels({
        apiKey: apiKey.trim(),
        provider: 'cursor'
      })
      setCursorModels(list)
      setForm((f) => {
        if (list.some((m) => m.id === f.model)) return f
        return { ...f, model: list[0]?.id ?? 'default' }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取模型失败')
    } finally {
      setModelsLoading(false)
    }
  }

  function switchProvider(next: ProviderId): void {
    if (next === form.provider) return
    const def = getProvider(next)
    const keys = {
      ...(form.providerApiKeys ?? {}),
      [form.provider]: form.apiKey
    }
    const nextKey = keys[next] ?? ''
    setForm({
      ...form,
      provider: next,
      baseUrl: def.baseUrl,
      model: def.defaultModel,
      apiKey: nextKey,
      providerApiKeys: keys
    })
    if (next === 'cursor') {
      setCursorModels(def.models)
      if (nextKey.trim()) void loadCursorModels(nextKey)
    } else {
      setCursorModels([])
    }
  }

  async function refreshAppList(mode: 'running' | 'all' = appSource): Promise<void> {
    const apps = await window.translator.listApps(mode)
    setRunningApps(apps)
    setPickedApp((prev) => {
      if (prev && apps.includes(prev)) return prev
      const preferred = apps.find((a) => a.toLowerCase() === 'cursor')
      return preferred ?? apps[0] ?? ''
    })
  }

  async function save(): Promise<void> {
    setError('')
    setSaved(false)
    try {
      const next = await window.translator.saveSettings({ ...form, theme })
      setForm({
        ...next,
        provider: next.provider ?? 'deepseek',
        providerApiKeys: next.providerApiKeys ?? {},
        selectionAppMode: next.selectionAppMode ?? 'all',
        excludedApps: next.excludedApps ?? [],
        blacklistedApps: next.blacklistedApps ?? []
      })
      onThemeChange(next.theme)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      const status = await window.translator.getAccessibilityStatus()
      setAccess(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function setThemeAndPersist(next: ThemeMode): Promise<void> {
    onThemeChange(next)
    setForm((f) => ({ ...f, theme: next }))
    try {
      await window.translator.saveSettings({ theme: next })
    } catch {
      // ignore
    }
  }

  async function persistExcluded(apps: ExcludedAppEntry[]): Promise<void> {
    setForm((f) => ({ ...f, excludedApps: apps }))
    try {
      const next = await window.translator.saveSettings({ excludedApps: apps })
      setForm((f) => ({ ...f, excludedApps: next.excludedApps ?? apps }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存应用列表失败')
    }
  }

  async function persistSelectionAppMode(mode: SelectionAppMode): Promise<void> {
    setForm((f) => ({ ...f, selectionAppMode: mode }))
    try {
      const next = await window.translator.saveSettings({ selectionAppMode: mode })
      setForm((f) => ({
        ...f,
        selectionAppMode: next.selectionAppMode ?? mode
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存划词范围失败')
    }
  }

  function addExcluded(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    if (lower === 'electron' || lower === 'ai translator') {
      setError('不能添加本应用自身')
      return
    }
    if (form.excludedApps.some((a) => a.name.toLowerCase() === lower)) {
      setError('该应用已在白名单中')
      return
    }
    setError('')
    // 加入列表即白名单
    void persistExcluded([...form.excludedApps, { name: trimmed, enabled: true }])
  }

  function removeExcluded(name: string): void {
    void persistExcluded(form.excludedApps.filter((a) => a.name !== name))
  }

  async function onRequestAccess(): Promise<void> {
    const status = await window.translator.requestAccessibility()
    setAccess(status)
  }

  async function onRevealElectron(): Promise<void> {
    await window.translator.revealElectronApp()
  }

  function onHotkeyKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()

    const parts: string[] = []
    if (e.metaKey || e.ctrlKey) {
      parts.push(processPlatformIsMac() ? 'Command' : 'Control')
    }
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    const key = e.key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return

    const mapped = key.length === 1 ? key.toUpperCase() : key
    parts.push(mapped)
    setForm((f) => ({ ...f, hotkey: parts.join('+') }))
    setRecording(false)
  }

  const isMac = processPlatformIsMac()
  const selectableApps = runningApps.filter((name) => {
    const lower = name.toLowerCase()
    return lower !== 'electron' && lower !== 'ai translator'
  })

  return (
    <div className="panel settings">
      <div className="field">
        <label>主题</label>
        <div className="theme-options">
          {(
            [
              ['light', '浅色'],
              ['dark', '深色'],
              ['system', '跟随系统']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={theme === value ? 'btn active' : 'btn'}
              onClick={() => void setThemeAndPersist(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>厂商</label>
        <div className="theme-options">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={form.provider === p.id ? 'btn active' : 'btn'}
              onClick={() => switchProvider(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="hint">{activeProvider.hint}</p>
      </div>

      <div className="field">
        <label htmlFor="model">模型</label>
        <div className="hotkey-row">
          <select
            id="model"
            className="model-select"
            value={
              modelOptions.some((m) => m.id === form.model)
                ? form.model
                : (modelOptions[0]?.id ?? form.model)
            }
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {form.provider === 'cursor' ? (
            <button
              type="button"
              className="btn"
              disabled={modelsLoading || !form.apiKey.trim()}
              onClick={() => void loadCursorModels()}
            >
              {modelsLoading ? '拉取中…' : '刷新模型'}
            </button>
          ) : null}
        </div>
        {form.provider === 'cursor' ? (
          <p className="hint">模型以账号 `Cursor.models.list` 为准；选「auto」最稳妥。</p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="apiKey">API Key</label>
        <input
          id="apiKey"
          type="password"
          value={form.apiKey}
          onChange={(e) =>
            setForm({
              ...form,
              apiKey: e.target.value,
              providerApiKeys: {
                ...(form.providerApiKeys ?? {}),
                [form.provider]: e.target.value
              }
            })
          }
          placeholder={activeProvider.apiKeyHint}
        />
      </div>

      <div className="field">
        <label htmlFor="baseUrl">Base URL</label>
        <input
          id="baseUrl"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder={activeProvider.baseUrl}
          disabled={form.provider === 'cursor'}
          readOnly={form.provider === 'cursor'}
        />
        <p className="hint">
          {form.provider === 'cursor'
            ? 'Cursor 使用本地 @cursor/sdk，地址仅作标识。'
            : '切换厂商会填入默认地址，仍可按需修改。'}
        </p>
      </div>

      <div className="field row">
        <label htmlFor="selection">划词翻译</label>
        <input
          id="selection"
          type="checkbox"
          checked={form.selectionEnabled}
          onChange={(e) => setForm({ ...form, selectionEnabled: e.target.checked })}
        />
        <span className="hint">开启后，松开鼠标选中文字时显示翻译图标。</span>
      </div>

      <div className="field">
        <label>划词应用范围</label>
        <div className="theme-options">
          {(
            [
              ['all', '全部应用'],
              ['selected', '已选中的应用']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn ${form.selectionAppMode === value ? 'active' : ''}`}
              onClick={() => void persistSelectionAppMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          {form.selectionAppMode === 'all'
            ? '当前可在任意应用中划词（本应用除外）。'
            : '仅在下方白名单中的应用可划词；添加即生效。'}
        </p>

        {form.selectionAppMode === 'selected' ? (
          <>
            <div className="hotkey-row exclude-pick-row">
              <select
                className="exclude-source"
                value={appSource}
                onChange={(e) => {
                  const mode = e.target.value as 'running' | 'all'
                  setAppSource(mode)
                  void refreshAppList(mode)
                }}
                aria-label="应用来源"
              >
                <option value="running">运行中的应用</option>
                <option value="all">全部应用</option>
              </select>
              <select
                value={pickedApp}
                onChange={(e) => setPickedApp(e.target.value)}
                disabled={selectableApps.length === 0}
                aria-label="选择应用"
              >
                {selectableApps.length === 0 ? (
                  <option value="">暂无可用应用</option>
                ) : (
                  selectableApps.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="btn primary"
                disabled={!pickedApp}
                onClick={() => addExcluded(pickedApp)}
              >
                添加
              </button>
              <button type="button" className="btn" onClick={() => void refreshAppList()}>
                刷新
              </button>
            </div>
            {form.excludedApps.length > 0 ? (
              <div className="allowlist-chips" role="list" aria-label="划词白名单">
                {form.excludedApps.map((item) => (
                  <span key={item.name} className="allowlist-chip" role="listitem">
                    <span className="allowlist-chip-name" title={item.name}>
                      {item.name}
                    </span>
                    <button
                      type="button"
                      className="allowlist-chip-remove"
                      aria-label={`移除 ${item.name}`}
                      onClick={() => removeExcluded(item.name)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="hint">暂无白名单应用。添加后即可在对应应用中划词。</p>
            )}
          </>
        ) : null}
      </div>

      {access && access.platform === 'darwin' ? (
        <div className="field access-box">
          <label>辅助功能权限</label>
          <p className="hint">
            划词翻译需要授权辅助功能。开发模式下请添加{' '}
            <strong>Electron</strong>。若没有，点「在 Finder 中显示」后，到系统设置里用「+」手动添加。
          </p>
          <div className={`access-status ${access.trusted ? 'ok' : 'warn'}`}>
            {access.trusted ? '已授权' : '未授权'}
            {access.electronAppPath ? ` · ${access.electronAppPath}` : ''}
          </div>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void onRequestAccess()}>
              打开系统设置
            </button>
            <button type="button" className="btn" onClick={() => void onRevealElectron()}>
              在 Finder 中显示
            </button>
          </div>
          <p className="hint">{access.hint}</p>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="hotkey">系统快捷键</label>
        <div className="hotkey-row">
          <input
            id="hotkey"
            value={form.hotkey}
            readOnly
            onKeyDown={onHotkeyKeyDown}
            placeholder="点击录制后按下组合键"
          />
          <button
            type="button"
            className={recording ? 'btn primary' : 'btn'}
            onClick={() => setRecording((v) => !v)}
          >
            {recording ? '录制中…' : '录制'}
          </button>
        </div>
        <p className="hint">选中文字后按快捷键：填入并自动翻译；未选中则仅唤起窗口。</p>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {saved ? <div className="ok">已保存</div> : null}

      <div className="actions">
        <button className="btn primary" onClick={() => void save()}>
          保存设置
        </button>
        {isMac ? <span className="hint">macOS 首次使用全局快捷键可能需要辅助功能权限。</span> : null}
      </div>
    </div>
  )
}

function processPlatformIsMac(): boolean {
  return window.navigator.platform.toLowerCase().includes('mac')
}
