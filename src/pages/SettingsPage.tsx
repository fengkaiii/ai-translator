import { useEffect, useState, type KeyboardEvent } from 'react'
import type { AccessibilityStatus, AppSettings, ExcludedAppEntry, ThemeMode } from '../vite-env'

const empty: AppSettings = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  selectionEnabled: false,
  hotkey: 'Command+Shift+T',
  theme: 'system',
  excludedApps: []
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

  useEffect(() => {
    void window.translator.getSettings().then((s) => {
      setForm({ ...s, excludedApps: s.excludedApps ?? [] })
      onThemeChange(s.theme)
    })
    void window.translator.getAccessibilityStatus().then(setAccess)
    void refreshAppList('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

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
      setForm({ ...next, excludedApps: next.excludedApps ?? [] })
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
      setError(err instanceof Error ? err.message : '保存排除列表失败')
    }
  }

  function addExcluded(name: string, enabled = false): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    if (lower === 'electron' || lower === 'ai translator') {
      setError('不能排除本应用自身')
      return
    }
    if (form.excludedApps.some((a) => a.name.toLowerCase() === lower)) {
      setError('该应用已在列表中，请勾选「启用排除」')
      return
    }
    setError('')
    // 默认不勾选：加入列表后需用户勾选才真正排除
    void persistExcluded([...form.excludedApps, { name: trimmed, enabled }])
  }

  function toggleExcluded(name: string, enabled: boolean): void {
    void persistExcluded(
      form.excludedApps.map((a) => (a.name === name ? { ...a, enabled } : a))
    )
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
        <label htmlFor="baseUrl">Base URL</label>
        <input
          id="baseUrl"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder="https://api.deepseek.com"
        />
      </div>

      <div className="field">
        <label htmlFor="apiKey">API Key</label>
        <input
          id="apiKey"
          type="password"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          placeholder="sk-…"
        />
      </div>

      <div className="field">
        <label htmlFor="model">模型</label>
        <input
          id="model"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
          placeholder="deepseek-chat"
        />
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
        <label>划词排除应用</label>
        <p className="hint">
          左侧选择数据来源，右侧选择应用后添加。加入列表后需勾选「启用排除」才会生效。
        </p>
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
            onClick={() => addExcluded(pickedApp, false)}
          >
            添加
          </button>
          <button type="button" className="btn" onClick={() => void refreshAppList()}>
            刷新
          </button>
        </div>
        {form.excludedApps.length > 0 ? (
          <ul className="exclude-list">
            {form.excludedApps.map((item) => (
              <li key={item.name}>
                <label className="exclude-item">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => toggleExcluded(item.name, e.target.checked)}
                  />
                  <span>{item.name}</span>
                  <span className="hint">{item.enabled ? '已排除' : '未启用'}</span>
                </label>
                <button type="button" className="btn" onClick={() => removeExcluded(item.name)}>
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">暂无排除项。例如选择 Cursor 添加后，勾选即可在编辑器内关闭划词弹窗。</p>
        )}
      </div>

      {isMac ? (
        <div className="field access-box">
          <label>macOS 辅助功能授权</label>
          {/* <p className="hint">
            开发模式下列表里<strong>不会</strong>出现「AI Translator」，要找的是{' '}
            <strong>Electron</strong>。若没有，点「在 Finder 中显示」后，到系统设置里用「+」手动添加。
          </p> */}
          <p className={`access-status ${access?.trusted ? 'ok' : 'warn'}`}>
            {access ? (access.trusted ? '已授权' : '未授权') : '检测中…'}
            {access?.electronAppPath ? ` · ${access.electronAppPath}` : ''}
          </p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void onRequestAccess()}>
              打开辅助功能设置
            </button>
            <button type="button" className="btn" onClick={() => void onRevealElectron()}>
              在 Finder 中显示 Electron.app
            </button>
          </div>
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
      </div>
    </div>
  )
}

function processPlatformIsMac(): boolean {
  return navigator.platform.toLowerCase().includes('mac')
}
