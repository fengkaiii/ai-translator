# AI Translator Design

## Goal

Desktop AI translation app (Electron) that uses DeepSeek to translate between Chinese and English, with polish, selection popup, and a global hotkey.

## Decisions

- Language: fixed CN ↔ EN, auto-detect direction
- Stack: Electron + React + Vite
- API: DeepSeek via OpenAI-compatible Chat Completions; settings prefilled with DeepSeek defaults but editable
- Debug: Electron app only (no separate web build)
- Packaging: electron-builder → `.dmg`, `.deb`, `.exe`

## Architecture

- **Renderer**: React UI — Translate page + Settings page
- **Main**: settings store, DeepSeek client, globalShortcut, selection watcher, popup windows
- **IPC**: renderer never holds secrets in logs; API calls go through main

## UI

### Translate

- Input textarea
- Result area
- Translate button
- Polish button (refine previous translation for fluency, keep meaning)

### Settings

- `baseUrl` default `https://api.deepseek.com`
- `api_key`
- `model` default `deepseek-chat`
- Selection translation toggle (default on)
- System hotkey (record/edit; applies immediately)

## Behaviors

### Hotkey

1. Selected text present → show main window, fill input, auto-translate
2. No selection → show/focus main window only

### Selection icon

- When enabled and text is selected elsewhere, show icon near cursor
- Click → small popup with translation
- Esc / click outside → close
- Web not applicable; Linux best-effort

## Data flow

1. `translate({ text, mode: 'translate' | 'polish', previousTranslation? })`
2. Main loads settings → `POST {baseUrl}/v1/chat/completions`
3. System role: translator; CN↔EN auto; polish mode improves prior translation
4. Surface readable errors (missing key, network, 401, timeout)

## Packaging / Dev

- `npm run dev` — Electron + Vite HMR
- `npm run dist` — platform installers via electron-builder
