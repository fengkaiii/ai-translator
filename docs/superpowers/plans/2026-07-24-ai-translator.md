# AI Translator Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Electron + React + Vite desktop translator using DeepSeek (CN↔EN), with polish, selection popup, global hotkey, and dmg/deb/exe packaging.

**Architecture:** Main process owns settings, DeepSeek HTTP, shortcuts, and selection UI windows. Renderer owns Translate + Settings pages. Vite builds renderer; electron-builder packages.

**Tech Stack:** Electron 33+, React 18, TypeScript, Vite, electron-store, electron-builder

## Global Constraints

- No separate web debug build — Electron only
- DeepSeek Chat Completions at `{baseUrl}/v1/chat/completions`
- Defaults: baseUrl `https://api.deepseek.com`, model `deepseek-chat`
- CN↔EN auto-detect only
- Do not commit unless user asks

## File Structure

```
package.json
electron.vite.config.ts
electron-builder.yml
tsconfig.json
tsconfig.node.json
index.html
electron/main.ts
electron/preload.ts
electron/settings.ts
electron/deepseek.ts
electron/selection.ts
electron/hotkey.ts
src/main.tsx
src/App.tsx
src/styles.css
src/pages/TranslatePage.tsx
src/pages/SettingsPage.tsx
src/lib/ipc.ts
src/vite-env.d.ts
```

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `electron-builder.yml`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/vite-env.d.ts`, `electron/main.ts`, `electron/preload.ts`

- [ ] **Step 1:** Create package.json with scripts `dev`, `build`, `dist` and dependencies (electron, react, electron-store, electron-vite, electron-builder, typescript)

- [ ] **Step 2:** Wire electron-vite config: main `electron/main.ts`, preload `electron/preload.ts`, renderer `src`

- [ ] **Step 3:** Minimal BrowserWindow loads renderer; `npm install` then `npm run dev` opens empty window

---

### Task 2: Settings store + IPC

**Files:**
- Create: `electron/settings.ts`, `src/lib/ipc.ts`, `src/pages/SettingsPage.tsx`
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`

**Interfaces:**
- `Settings = { baseUrl, apiKey, model, selectionEnabled, hotkey }`
- `getSettings(): Promise<Settings>`
- `saveSettings(partial): Promise<Settings>`

- [ ] **Step 1:** Implement electron-store backed settings with DeepSeek defaults
- [ ] **Step 2:** Expose via preload contextBridge
- [ ] **Step 3:** Settings page form saves and reloads values

---

### Task 3: DeepSeek translate + Translate page

**Files:**
- Create: `electron/deepseek.ts`, `src/pages/TranslatePage.tsx`
- Modify: `electron/main.ts`, `electron/preload.ts`

**Interfaces:**
- `translate(req: { text: string; mode: 'translate' | 'polish'; previousTranslation?: string }): Promise<{ text: string }>`

- [ ] **Step 1:** deepseek client with translate/polish system prompts
- [ ] **Step 2:** Translate page with input, result, Translate, Polish buttons
- [ ] **Step 3:** Show loading and error strings

---

### Task 4: Global hotkey

**Files:**
- Create: `electron/hotkey.ts`
- Modify: `electron/main.ts`, `electron/settings.ts`, Settings UI

- [ ] **Step 1:** Register/unregister `globalShortcut` from settings
- [ ] **Step 2:** On trigger: get selection → fill + translate or just show window
- [ ] **Step 3:** Re-register when hotkey setting changes

---

### Task 5: Selection icon + popup

**Files:**
- Create: `electron/selection.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1:** Poll selection text (platform helpers)
- [ ] **Step 2:** Icon window near cursor; click opens result popup
- [ ] **Step 3:** Respect `selectionEnabled`; Esc/blur closes

---

### Task 6: Packaging

**Files:**
- Modify: `electron-builder.yml`, `package.json`

- [ ] **Step 1:** Configure dmg / nsis / deb targets
- [ ] **Step 2:** `npm run build` succeeds
- [ ] **Step 3:** Document `npm run dist` for installers

---

### Task 7: Verify

- [ ] **Step 1:** App launches via `npm run dev`
- [ ] **Step 2:** Settings save persists across restart
- [ ] **Step 3:** Translate/polish work with a real api_key when provided
