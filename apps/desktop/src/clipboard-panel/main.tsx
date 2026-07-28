import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel } from '@ai-translator/clipboard-history/ui'
import type { HistoryEntry } from '@ai-translator/clipboard-history'

function ClipboardPanelApp(): JSX.Element | null {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const api = window.clipboardHistory

  useEffect(() => {
    // Linux 面板用更高不透明度（见 panel.css data-platform）
    document.documentElement.dataset.platform = api?.platform ?? 'unknown'
  }, [api])

  useEffect(() => {
    if (!api) return
    void api.list().then(setEntries)
    return api.onChanged(setEntries)
  }, [api])

  if (!api) return null

  return (
    <Panel
      entries={entries}
      onCopy={(id) => api.copy(id)}
      onPaste={(id) => api.paste(id)}
      onHide={() => api.hide()}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClipboardPanelApp />
  </StrictMode>
)
