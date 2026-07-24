/** Apply theme to documentElement. theme: dark | light | system */
export function applyTheme(theme: 'dark' | 'light' | 'system'): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  document.documentElement.dataset.theme = resolved
}

export function watchSystemTheme(theme: 'dark' | 'light' | 'system'): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => {
    if (theme === 'system') applyTheme('system')
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
