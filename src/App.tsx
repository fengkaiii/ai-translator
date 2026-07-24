import { useEffect, useRef, useState } from 'react'
import TranslatePage from './pages/TranslatePage'
import SettingsPage from './pages/SettingsPage'
import { applyTheme, watchSystemTheme } from './lib/theme'
import type { ThemeMode } from './vite-env'
import logoUrl from './assets/logo.png'

type Tab = 'translate' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('translate')
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeMode>('system')
  const themeRef = useRef<ThemeMode>('system')

  useEffect(() => {
    if (!window.translator) return
    void window.translator.getSettings().then((s) => {
      setTheme(s.theme)
      themeRef.current = s.theme
      applyTheme(s.theme)
    })
    const offFill = window.translator.onFillAndTranslate((text) => {
      setTab('translate')
      setPendingText(text)
    })
    const offSettings = window.translator.onSettingsChanged((s) => {
      setTheme(s.theme)
      themeRef.current = s.theme
      applyTheme(s.theme)
    })
    return () => {
      offFill()
      offSettings()
    }
  }, [])

  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(theme)
  }, [theme])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} width={28} height={28} alt="" />
          <span>AI Translator</span>
        </div>
        <nav className="tabs">
          <button
            className={tab === 'translate' ? 'tab active' : 'tab'}
            onClick={() => setTab('translate')}
          >
            翻译
          </button>
          <button
            className={tab === 'settings' ? 'tab active' : 'tab'}
            onClick={() => setTab('settings')}
          >
            设置
          </button>
        </nav>
      </header>
      <main className="main">
        {tab === 'translate' ? (
          <TranslatePage
            pendingText={pendingText}
            onPendingConsumed={() => setPendingText(null)}
          />
        ) : (
          <SettingsPage
            theme={theme}
            onThemeChange={(next) => {
              setTheme(next)
              themeRef.current = next
              applyTheme(next)
            }}
          />
        )}
      </main>
    </div>
  )
}
