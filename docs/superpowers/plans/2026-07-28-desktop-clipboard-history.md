# 桌面端剪贴板历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以桌面为宿主，通过独立包提供纯文本剪贴板历史：启用后快捷键打开 Spotlight 风格浮动面板，可复制、双击粘贴，落盘最多 100 条。

**Architecture:** `packages/clipboard-history` 提供 `ClipboardHistoryHost` 接口与 `ClipboardHistoryService`（去重/上限/持久化/忽略自身写入）及 React 面板 UI；`apps/desktop` 的 bridge 实现 Host（剪贴板轮询、osascript 粘贴、history.json、BrowserWindow），设置折叠区控制启停与快捷键/存储路径。不做动态插件加载。

**Tech Stack:** Electron 39、electron-vite、React 18、TypeScript、vitest、electron-store、uiohook 仅既有划词用；粘贴用 osascript / 等价平台命令（与现有 Cmd+C 偷取同模式）

**Spec:** `docs/superpowers/specs/2026-07-28-desktop-clipboard-history-design.md`

## Global Constraints

- 包内禁止 `import 'electron'`
- 仅纯文本；无搜索；落盘上限 **100**
- 默认关闭：`clipboardHistoryEnabled: false`；启用才注册快捷键与监听
- 自定义存储目录不可写 → **回退默认** `userData/clipboard-history` 并提示；换路径不迁移旧文件
- 翻译热键与剪贴板热键分离；修复 `unregisterHotkey` 的 `unregisterAll`（否则会清掉另一套快捷键）
- **实现过程不自动 git commit**；步骤中的「提交」改为「暂不提交，待审核」
- 若人工提交：`type(scope): 中文描述`，并同步 `docs/feat/desktop-clipboard-history/README.md` 的 `## Commits`

---

## File map

| 文件 | 职责 |
|------|------|
| `packages/clipboard-history/package.json` | workspace 包 `@ai-translator/clipboard-history` |
| `packages/clipboard-history/src/host.ts` | `ClipboardHistoryHost` 类型 |
| `packages/clipboard-history/src/types.ts` | `HistoryEntry` 等 |
| `packages/clipboard-history/src/history.ts` | `ClipboardHistoryService` |
| `packages/clipboard-history/src/history.test.ts` | 服务单测 |
| `packages/clipboard-history/src/ui/Panel.tsx` | 浮动面板 UI（无搜索） |
| `packages/clipboard-history/src/ui/panel.css` | Spotlight 风格样式 |
| `packages/clipboard-history/src/index.ts` | 导出 |
| `apps/desktop/electron/settings.ts` | 三字段读写 |
| `apps/desktop/src/vite-env.d.ts` | 渲染类型 + `clipboardHistory` API |
| `apps/desktop/electron/hotkey.ts` | 去掉 `unregisterAll`；只卸本键 |
| `apps/desktop/electron/clipboard-history-hotkey.ts` | 剪贴板历史快捷键注册/注销 |
| `apps/desktop/electron/clipboard-history-bridge.ts` | Host 实现、窗口、IPC、启停 |
| `apps/desktop/electron/preload.ts` | `window.clipboardHistory` |
| `apps/desktop/clipboard-history.html` | 面板 HTML 入口 |
| `apps/desktop/src/clipboard-panel/main.tsx` | 挂载包内 Panel |
| `apps/desktop/electron.vite.config.ts` | bundle 包；第二 renderer 入口 |
| `apps/desktop/package.json` | 依赖 `@ai-translator/clipboard-history` |
| `apps/desktop/src/pages/SettingsPage.tsx` | 折叠「剪贴板历史」区 |
| `apps/desktop/electron/main.ts` | 接线启停 / aux 窗 / will-quit |
| `apps/desktop/electron/selection.ts` | `isAuxWindow` 含历史面板窗 |
| `package.json`（根） | `test` 可含 clipboard-history workspace |

---

### Task 1: `ClipboardHistoryService`（TDD）

**Files:**
- Create: `packages/clipboard-history/package.json`
- Create: `packages/clipboard-history/src/types.ts`
- Create: `packages/clipboard-history/src/host.ts`
- Create: `packages/clipboard-history/src/history.ts`
- Create: `packages/clipboard-history/src/history.test.ts`
- Create: `packages/clipboard-history/src/index.ts`
- Modify: 根 `package.json` scripts.test（可选追加 workspace）

**Interfaces:**
- Produces:

```ts
// types.ts
export type HistoryEntry = {
  id: string
  text: string
  createdAt: number
}

export const HISTORY_LIMIT = 100

// host.ts
export type ClipboardHistoryHost = {
  readClipboardText: () => string
  writeClipboardText: (text: string) => void
  onClipboardChange: (cb: (text: string) => void) => () => void
  pasteText: (text: string) => Promise<{ ok: boolean; error?: string }>
  readHistoryJson: () => Promise<string | null>
  writeHistoryJson: (raw: string) => Promise<void>
  showPanel: () => void
  hidePanel: () => void
}

// history.ts
export class ClipboardHistoryService {
  constructor(host: ClipboardHistoryHost)
  activate(): Promise<void>
  deactivate(): void
  list(): HistoryEntry[]
  copy(id: string): Promise<void>
  paste(id: string): Promise<{ ok: boolean; error?: string }>
  onChange(cb: (entries: HistoryEntry[]) => void): () => void
}
```

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@ai-translator/clipboard-history",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./ui": "./src/ui/Panel.tsx"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "react": "^18.3.1",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 写失败测试** `history.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClipboardHistoryService, HISTORY_LIMIT } from './history'
import type { ClipboardHistoryHost } from './host'

function createFakeHost(overrides: Partial<ClipboardHistoryHost> = {}): ClipboardHistoryHost & {
  clipboard: string
  stored: string | null
  changes: Array<(t: string) => void>
} {
  const state = {
    clipboard: '',
    stored: null as string | null,
    changes: [] as Array<(t: string) => void>
  }
  const host: ClipboardHistoryHost & typeof state = {
    ...state,
    readClipboardText: () => state.clipboard,
    writeClipboardText: (t) => {
      state.clipboard = t
    },
    onClipboardChange: (cb) => {
      state.changes.push(cb)
      return () => {
        state.changes = state.changes.filter((x) => x !== cb)
      }
    },
    pasteText: vi.fn(async () => ({ ok: true })),
    readHistoryJson: async () => state.stored,
    writeHistoryJson: async (raw) => {
      state.stored = raw
    },
    showPanel: vi.fn(),
    hidePanel: vi.fn(),
    ...overrides
  }
  return host
}

describe('ClipboardHistoryService', () => {
  it('ignores empty and duplicate-of-top', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('hello')
    host.changes[0]!('')
    host.changes[0]!('hello')
    expect(svc.list()).toHaveLength(1)
    expect(svc.list()[0]!.text).toBe('hello')
  })

  it('caps at HISTORY_LIMIT and drops oldest', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      host.changes[0]!(`t-${i}`)
    }
    expect(svc.list()).toHaveLength(HISTORY_LIMIT)
    expect(svc.list()[0]!.text).toBe(`t-${HISTORY_LIMIT + 4}`)
    expect(svc.list().at(-1)!.text).toBe('t-5')
  })

  it('persists and reloads', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('a')
    expect(host.stored).toBeTruthy()
    const svc2 = new ClipboardHistoryService(host)
    await svc2.activate()
    expect(svc2.list()[0]!.text).toBe('a')
  })

  it('copy writes clipboard but does not re-push same text', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('x')
    const id = svc.list()[0]!.id
    await svc.copy(id)
    expect(host.clipboard).toBe('x')
    expect(svc.list()).toHaveLength(1)
  })

  it('paste hides panel and calls host.pasteText', async () => {
    const host = createFakeHost()
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    host.changes[0]!('paste-me')
    const id = svc.list()[0]!.id
    const r = await svc.paste(id)
    expect(r.ok).toBe(true)
    expect(host.hidePanel).toHaveBeenCalled()
    expect(host.pasteText).toHaveBeenCalledWith('paste-me')
  })

  it('recovers from corrupt json', async () => {
    const host = createFakeHost()
    host.stored = '{not-json'
    const svc = new ClipboardHistoryService(host)
    await svc.activate()
    expect(svc.list()).toEqual([])
  })
})
```

- [ ] **Step 3: 跑测确认失败**

```bash
cd /Users/fengkai/Documents/ai/translater && npm install && npm run test -w @ai-translator/clipboard-history
```

Expected: FAIL（模块不存在或未导出）

- [ ] **Step 4: 实现 types / host / history / index**

`history.ts` 要点：

- `activate`：`readHistoryJson` → JSON.parse；失败则当空列表（宿主负责 `.bak`，服务侧容错为空）
- 订阅 `onClipboardChange`：trim 后空跳过；`text === list[0]?.text` 跳过；若 `ignoreClipboardUntil > Date.now()` 跳过
- `push`：生成 `id`（`crypto.randomUUID()` 或 `${Date.now()}-${rand}`）、插顶部、`slice(0, HISTORY_LIMIT)`、`writeHistoryJson(JSON.stringify({ version: 1, entries }))`、通知 `onChange`
- `copy`：设 ignore 窗口（如 800ms）→ `writeClipboardText`
- `paste`：`hidePanel` → ignore → `pasteText(text)`（`pasteText` 内部会写剪贴板）
- `deactivate`：取消订阅、清空回调

- [ ] **Step 5: 跑测确认通过**

```bash
npm run test -w @ai-translator/clipboard-history
```

Expected: PASS

- [ ] **Step 6: 暂不提交**（待审核）

---

### Task 2: AppSettings 三字段

**Files:**
- Modify: `apps/desktop/electron/settings.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`

**Interfaces:**
- Produces on `AppSettings`:

```ts
clipboardHistoryEnabled: boolean
clipboardHistoryHotkey: string
clipboardHistoryStorageDir: string // '' = default
```

- [ ] **Step 1: 扩展 `AppSettings` 与 defaults**

在 `settings.ts`：

```ts
clipboardHistoryEnabled: false,
clipboardHistoryHotkey:
  process.platform === 'darwin' ? 'Command+Shift+V' : 'Control+Shift+V',
clipboardHistoryStorageDir: ''
```

`getSettings` / `saveSettings` 读写出这三个字段；`storageDir` 用 `String(...).trim()`。

- [ ] **Step 2: 同步 `vite-env.d.ts` 的 `AppSettings`**

- [ ] **Step 3: 手工确认** 设置页暂未 UI 时，`getSettings()` 已含默认值（可在后续 Task 用 devtools；本步仅类型编译）

```bash
npm run build -w ai-translator-desktop
```

若整包 build 过重，至少保证 `tsc`/IDE 无类型错误。

- [ ] **Step 4: 暂不提交**

---

### Task 3: 修复翻译热键 `unregisterAll` + 剪贴板热键模块

**Files:**
- Modify: `apps/desktop/electron/hotkey.ts`
- Create: `apps/desktop/electron/clipboard-history-hotkey.ts`

**Interfaces:**
- Consumes: `getSettings().clipboardHistoryHotkey` / `clipboardHistoryEnabled`
- Produces: `registerClipboardHistoryHotkey(onTrigger)` / `unregisterClipboardHistoryHotkey()`

- [ ] **Step 1: 改 `unregisterHotkey`**

删除 `globalShortcut.unregisterAll()`。仅：

```ts
export function unregisterHotkey(): void {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = ''
  }
}
```

- [ ] **Step 2: 新建 `clipboard-history-hotkey.ts`**

镜像 `hotkey.ts` 结构，独立 `currentAccelerator`：

```ts
import { globalShortcut } from 'electron'
import { getSettings } from './settings'

let currentAccelerator = ''

export function registerClipboardHistoryHotkey(onTrigger: () => void): void {
  unregisterClipboardHistoryHotkey()
  const { clipboardHistoryEnabled, clipboardHistoryHotkey } = getSettings()
  if (!clipboardHistoryEnabled || !clipboardHistoryHotkey?.trim()) return
  const ok = globalShortcut.register(clipboardHistoryHotkey, onTrigger)
  if (ok) currentAccelerator = clipboardHistoryHotkey
  else {
    console.warn(`Failed to register clipboard history hotkey: ${clipboardHistoryHotkey}`)
    currentAccelerator = ''
  }
}

export function unregisterClipboardHistoryHotkey(): void {
  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = ''
  }
}
```

- [ ] **Step 3: 暂不接线 main**（Task 5 接线）；确认翻译热键文件改动无 `unregisterAll`

- [ ] **Step 4: 暂不提交**

---

### Task 4: Bridge — Host、存储、粘贴、窗口骨架

**Files:**
- Create: `apps/desktop/electron/clipboard-history-bridge.ts`
- Modify: `apps/desktop/package.json`（dependencies 加 `"@ai-translator/clipboard-history": "*"`）
- Modify: `apps/desktop/electron.vite.config.ts`（`exclude` 增加包名）

**Interfaces:**
- Consumes: `ClipboardHistoryService`, `ClipboardHistoryHost`, `getSettings`
- Produces:

```ts
export function syncClipboardHistoryFromSettings(): void
export function stopClipboardHistory(): void
export function isClipboardHistoryWindow(win: BrowserWindow): boolean
```

- [ ] **Step 1: electron-vite 打包 workspace 包**

`externalizeDepsPlugin({ exclude: ['@ai-translator/translate-core', '@ai-translator/clipboard-history'] })`

- [ ] **Step 2: 实现路径解析与 JSON 读写**

```ts
import { app, clipboard, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import {
  ClipboardHistoryService,
  type ClipboardHistoryHost
} from '@ai-translator/clipboard-history'
import { getSettings } from './settings'

const DEFAULT_DIR_NAME = 'clipboard-history'
const FILE_NAME = 'history.json'

function defaultStorageDir(): string {
  return join(app.getPath('userData'), DEFAULT_DIR_NAME)
}

async function resolveStorageDir(): Promise<{ dir: string; usedFallback: boolean }> {
  const custom = getSettings().clipboardHistoryStorageDir.trim()
  const preferred = custom || defaultStorageDir()
  try {
    await fs.mkdir(preferred, { recursive: true })
    const probe = join(preferred, '.write-test')
    await fs.writeFile(probe, 'ok')
    await fs.unlink(probe)
    return { dir: preferred, usedFallback: false }
  } catch {
    const fallback = defaultStorageDir()
    await fs.mkdir(fallback, { recursive: true })
    return { dir: fallback, usedFallback: custom.length > 0 }
  }
}
```

`readHistoryJson`：读文件；`ENOENT` → `null`；其它损坏：尝试 `rename` 为 `.bak` 后返回 `null`。  
`writeHistoryJson`：写入 `join(dir, FILE_NAME)`。

- [ ] **Step 3: 剪贴板轮询 + Host**

每 500ms `clipboard.readText()`；与上次不同则回调。  
`pasteText`：

1. `clipboard.writeText(text)`
2. `hidePanel` 已由 service 调用；bridge 的 `hidePanel` 先 blur/hide 窗
3. 短暂 `setTimeout(50~100)` 后执行粘贴键：
   - darwin: `osascript -e 'tell application "System Events" to keystroke "v" using command down'`（同 `selection-text` 的 execFile 模式）
   - win32: 可用 PowerShell `Add-Type` SendKeys `^v` 或等价；失败返回 `{ ok: false, error }`
   - linux: `xdotool key ctrl+v` 若存在，否则 `{ ok: false }`

- [ ] **Step 4: BrowserWindow 骨架**

- frameless、transparent、`alwaysOnTop: true`、约 `560×420`、居中偏上
- `vibrancy: 'popover'`（darwin 可用时）
- preload 同主应用；`show: false` 创建，`showPanel` 时 show+focus
- load：`clipboard-history.html`（Task 5 才有完整 UI；本步可先 load 空页或 data URL 占位）
- 导出 `isClipboardHistoryWindow`

- [ ] **Step 5: `syncClipboardHistoryFromSettings`**

```ts
let service: ClipboardHistoryService | null = null

export function syncClipboardHistoryFromSettings(): void {
  const enabled = getSettings().clipboardHistoryEnabled
  if (!enabled) {
    stopClipboardHistory()
    return
  }
  // 若已 active：可 deactivate 再 activate 以刷新 storageDir；或仅重注册热键
  void ensureStarted()
}

export function stopClipboardHistory(): void {
  unregisterClipboardHistoryHotkey()
  service?.deactivate()
  service = null
  // hide + 可选 destroy 窗
}
```

`ensureStarted`：建 Host → `new ClipboardHistoryService(host)` → `activate` → `registerClipboardHistoryHotkey(() => host.showPanel())`。

- [ ] **Step 6: IPC（面板用）**

```ts
ipcMain.handle('clipboard-history:list', () => service?.list() ?? [])
ipcMain.handle('clipboard-history:copy', (_e, id: string) => service?.copy(id))
ipcMain.handle('clipboard-history:paste', (_e, id: string) => service?.paste(id))
ipcMain.handle('clipboard-history:hide', () => { host.hidePanel() })
// 可选：选择目录 dialog，给设置页
ipcMain.handle('clipboard-history:pick-dir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return r.filePaths[0]
})
ipcMain.handle('clipboard-history:resolved-dir', async () => {
  const { dir, usedFallback } = await resolveStorageDir()
  return { dir, usedFallback, defaultDir: defaultStorageDir() }
})
```

列表变更时 `panelWin.webContents.send('clipboard-history:changed', entries)`。

- [ ] **Step 7: 暂不提交**

---

### Task 5: Preload + 面板 UI + vite 第二入口

**Files:**
- Create: `packages/clipboard-history/src/ui/Panel.tsx`
- Create: `packages/clipboard-history/src/ui/panel.css`
- Create: `apps/desktop/clipboard-history.html`
- Create: `apps/desktop/src/clipboard-panel/main.tsx`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/electron.vite.config.ts` renderer `input`
- Modify: `apps/desktop/electron/clipboard-history-bridge.ts`（load 正式页面）

**Interfaces:**
- Produces `window.clipboardHistory`:

```ts
type ClipboardHistoryApi = {
  list: () => Promise<HistoryEntry[]>
  copy: (id: string) => Promise<void>
  paste: (id: string) => Promise<{ ok: boolean; error?: string }>
  hide: () => Promise<void>
  onChanged: (cb: (entries: HistoryEntry[]) => void) => () => void
}
```

- [ ] **Step 1: preload 暴露 API**（`contextBridge.exposeInMainWorld('clipboardHistory', ...)`）

- [ ] **Step 2: Panel UI**

- 无搜索；顶部可仅品牌/标题细条或留白分隔（参考 Spotlight 分区线，**不要**放大镜搜索框）
- 列表新→旧；每行文本预览（单行 ellipsis）+ 右侧复制按钮
- 复制按钮 `stopPropagation` + `copy(id)`
- 行 `onDoubleClick` → `paste(id)`；若 `!ok` 可 `alert`/`内联提示`「已复制，请手动粘贴」
- `Escape` → `hide()`
- 样式：圆角大、半透明背景、`backdrop-filter: blur(20px)`、细边框；深浅色可用 `prefers-color-scheme`

- [ ] **Step 3: HTML + main.tsx**

`clipboard-history.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>剪贴板历史</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/clipboard-panel/main.tsx"></script>
  </body>
</html>
```

`main.tsx`：`createRoot` 挂载 `@ai-translator/clipboard-history/ui` 的 Panel；`useEffect` 拉 `list` + `onChanged`。

- [ ] **Step 4: electron.vite.config renderer input**

```ts
input: {
  index: resolve(__dirname, 'index.html'),
  'clipboard-history': resolve(__dirname, 'clipboard-history.html')
}
```

bridge `loadFile` / dev `loadURL` 指向对应入口（dev 可用 `ELECTRON_RENDERER_URL` + `/clipboard-history.html`）。

- [ ] **Step 5: 手工打开面板看样式与双击/复制**（需 Task 6 接线后；本步完成构建产物）

- [ ] **Step 6: 暂不提交**

---

### Task 6: 设置页折叠区 + main 接线

**Files:**
- Modify: `apps/desktop/src/pages/SettingsPage.tsx`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/selection.ts`（`isAuxWindow`）
- Modify: `apps/desktop/electron/preload.ts`（若设置页要 `pickDir` / `resolvedDir`，可挂在 `translator` 或 `clipboardHistory`）

**Interfaces:**
- Consumes: `syncClipboardHistoryFromSettings`, `stopClipboardHistory`, `isClipboardHistoryWindow`
- Settings 表单字段与 `saveSettings` 部分更新

- [ ] **Step 1: Settings UI**

在设置页**底部或独立于翻译区块**增加默认折叠的 `<details class="settings-fold">`（或等价）：

```tsx
<details className="settings-section-fold">
  <summary>剪贴板历史</summary>
  <label>
    <input
      type="checkbox"
      checked={form.clipboardHistoryEnabled}
      onChange={(e) => setForm({ ...form, clipboardHistoryEnabled: e.target.checked })}
    />
    启用剪贴板历史
  </label>
  {/* 快捷键录制：复用翻译热键 recording 交互，写入 clipboardHistoryHotkey */}
  {/* 存储目录：只读展示 resolved；按钮「选择文件夹」→ pickDir；「恢复默认」→ '' */}
  {storageHint /* usedFallback 时红字：自定义目录不可写，已回退默认 */}
</details>
```

保存时走现有 `saveSettings`；`empty` 初始状态补上三字段默认值。

- [ ] **Step 2: `settings:save` 与启动调用 `syncClipboardHistoryFromSettings`**

在 `main.ts` 的 `settings:save` 回调、`app.whenReady`、`will-quit` / `window-all-closed` 中对称调用 `stopClipboardHistory` / sync。

- [ ] **Step 3: `isAuxWindow`**

```ts
import { isClipboardHistoryWindow } from './clipboard-history-bridge'

export function isAuxWindow(win: BrowserWindow): boolean {
  return win === iconWin || win === popupWin || isClipboardHistoryWindow(win)
}
```

（若循环依赖，把 `isClipboardHistoryWindow` 放到小文件或在 `isAuxWindow` 内联检查 `panelWin` 导出。）

- [ ] **Step 4: 失焦关面板**

`panelWin.on('blur', () => hide)`（注意开发时点 DevTools 别误关；可 `if (!isDev)` 或短延迟）。

- [ ] **Step 5: 端到端手工验收清单**

1. 默认关闭：快捷键无效、无监听  
2. 启用并保存：复制若干文本到别的 App → 快捷键开面板 → 见列表（≤100）  
3. 点复制图标：剪贴板更新、列表不因自身写入翻倍  
4. 双击：面板关、前台可粘贴（需辅助功能权限）  
5. 改存储目录到不可写路径：提示回退默认  
6. 关闭启用：快捷键失效；文件仍在  
7. 翻译热键与剪贴板热键互不注销  

- [ ] **Step 6: 跑测**

```bash
npm run test -w @ai-translator/clipboard-history
npm run test -w ai-translator-desktop
```

- [ ] **Step 7: 暂不提交**（全部改动留给审核者一次或分次提交）

---

## Self-review vs spec

| Spec 要求 | Task |
|-----------|------|
| 独立包 + Host，无 electron | Task 1 |
| 桌面 bridge / 快捷键 / 窗 | Task 3–4 |
| Spotlight 风格、无搜索、平铺 | Task 5 |
| 复制图标 / 双击粘贴 | Task 1+5 |
| 落盘 100 | Task 1 |
| 设置开关、热键、自定义目录、折叠 | Task 2+6 |
| 不可写回退默认 | Task 4 |
| 不自动 commit | 各 Task Step「暂不提交」 |
| 忽略自身写入 / 划词偷取噪声 | Task 1 ignore 窗口；bridge 轮询可再与 `selection-text` 偷取时段对齐（实现时若偷取仍入栈，在 steal 函数外包一层 `markClipboardSteal` 供 bridge 跳过） |

若划词偷取仍污染历史：在 `selection-text.ts` 偷取前后设置模块级 `clipboardStealDepth`，bridge 轮询时 `if (clipboardStealDepth > 0) skip`——作为 Task 4 的补丁步骤一并做。
