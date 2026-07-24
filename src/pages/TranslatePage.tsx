import { useEffect, useState } from 'react'

type Props = {
  pendingText: string | null
  onPendingConsumed: () => void
}

export default function TranslatePage({ pendingText, onPendingConsumed }: Props) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function run(mode: 'translate' | 'polish'): Promise<void> {
    setLoading(true)
    setError('')
    try {
      const res = await window.translator.translate({
        text: input,
        mode,
        previousTranslation: mode === 'polish' ? result : undefined
      })
      setResult(res.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : '翻译失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (pendingText == null) return
    setInput(pendingText)
    onPendingConsumed()
    setLoading(true)
    setError('')
    void window.translator
      .translate({ text: pendingText, mode: 'translate' })
      .then((res) => setResult(res.text))
      .catch((err) => setError(err instanceof Error ? err.message : '翻译失败'))
      .finally(() => setLoading(false))
  }, [pendingText, onPendingConsumed])

  return (
    <div className="panel translate">
      <label className="label" htmlFor="source">
        原文
      </label>
      <textarea
        id="source"
        className="textarea"
        placeholder="输入中文或英文…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // Enter 翻译；Shift+Enter 换行
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!loading && input.trim()) void run('translate')
          }
        }}
        rows={6}
      />

      <div className="actions">
        <button
          className="btn primary"
          disabled={loading || !input.trim()}
          onClick={() => void run('translate')}
        >
          {loading ? '翻译中…' : '翻译'}
        </button>
        <button
          className="btn"
          disabled={loading || !input.trim() || !result.trim()}
          onClick={() => void run('polish')}
        >
          润色
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <label className="label" htmlFor="result">
        译文
      </label>
      <textarea
        id="result"
        className="textarea result"
        readOnly
        value={result}
        placeholder="翻译结果会显示在这里"
        rows={6}
      />
    </div>
  )
}
