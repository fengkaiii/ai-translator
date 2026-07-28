import { useCallback, useEffect, useState } from 'react'
import type { HistoryEntry } from '../types'
import './panel.css'

export type PanelProps = {
  entries: HistoryEntry[]
  onCopy: (id: string) => void | Promise<void>
  onPaste: (id: string) => Promise<{ ok: boolean; error?: string }>
  onHide: () => void | Promise<void>
}

function CopyIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M4 11V4.5C4 3.67 4.67 3 5.5 3H11"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 剪贴板历史浮动面板：无搜索，复制图标 / 双击粘贴 */
export function Panel({ entries, onCopy, onPaste, onHide }: PanelProps): JSX.Element {
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    const timer = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void onHide()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onHide])

  const handleRowDoubleClick = async (id: string): Promise<void> => {
    const result = await onPaste(id)
    if (!result.ok) {
      showToast('已复制，请手动粘贴')
    }
  }

  return (
    <div className="ch-panel">
      <div className="ch-shell">
        <header
          className="ch-header"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            window.clipboardHistory.beginDrag()
          }}
          onPointerUp={(e) => {
            try {
              e.currentTarget.releasePointerCapture(e.pointerId)
            } catch {
              // already released
            }
            window.clipboardHistory.endDrag()
          }}
          onPointerCancel={() => {
            window.clipboardHistory.endDrag()
          }}
        >
          <h1 className="ch-title">剪贴板历史</h1>
        </header>
        {entries.length === 0 ? (
          <p className="ch-empty">暂无历史记录</p>
        ) : (
          <ul className="ch-list" role="list">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="ch-row"
                onDoubleClick={() => void handleRowDoubleClick(entry.id)}
                title="双击粘贴"
              >
                <span className="ch-preview">{entry.text.replace(/\s+/g, ' ').trim()}</span>
                <button
                  type="button"
                  className="ch-copy-btn"
                  aria-label="复制"
                  title="复制"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onCopy(entry.id)
                  }}
                >
                  <CopyIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {toast ? <div className="ch-toast">{toast}</div> : null}
    </div>
  )
}
