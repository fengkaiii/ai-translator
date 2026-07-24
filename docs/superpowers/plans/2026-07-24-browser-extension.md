# Browser Extension + Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将仓库迁为轻量 monorepo，抽出可共享的 `translate-core`，新增 Chromium MV3 扩展（页内划词 + 整页双语/替换，DeepSeek 直连），并通过 Native Messaging 把 Cursor 请求代理到现有 Electron 桌面端。

**Architecture:** `apps/desktop` 保留系统划词与 `@cursor/sdk`；`apps/extension` 负责 DOM；`packages/translate-core` 持有 `TranslateRequest`、prompt、DeepSeek `fetch` 与整页分块纯逻辑。DeepSeek 在扩展 background 直连；Cursor 经 thin native host → 本机 HTTP → Electron `translateText`。

**Tech Stack:** npm workspaces、TypeScript、electron-vite、Electron 39、Vite 5、React 18、Vitest、Chrome MV3、Native Messaging

## Global Constraints

- 规格文件：`docs/superpowers/specs/2026-07-24-browser-extension-design.md`（冲突以规格为准）
- v1 仅 Chromium（Chrome / Edge）
- **不在插件内跑 `@cursor/sdk`**
- DeepSeek：插件 Options 独立配置；桌面未开也可用
- Cursor：仅 Native Messaging → 桌面；离线须明确提示
- 整页默认模式：双语对照；可切换替换原文；均可清除/还原
- v1 不做桌面 ↔ 插件设置同步；不做 Firefox/Safari
- Commit message：`type(scope): 中文描述`；同步 `docs/feat/browser-extension/README.md` 的 `## Commits`
- 未获用户明确要求前不要 `git push`

## File Structure

```text
package.json                          # workspaces root
packages/translate-core/
  package.json
  tsconfig.json
  src/
    types.ts                          # TranslateRequest, TargetLang, TranslateMode
    prompts.ts                        # system prompts
    deepseek.ts                       # callDeepSeek(settings, req)
    chunk.ts                          # chunkTextNodes / limits
    index.ts
  src/chunk.test.ts
apps/desktop/                         # 现有 Electron 迁入后的根
  package.json
  electron.vite.config.ts
  electron/
    main.ts
    translate.ts                      # 改用 @ai-translator/translate-core
    deepseek.ts                       # 薄封装或删除，改 core
    cursor.ts
    native-bridge.ts                  # 本机 HTTP 服务（供 host 调用）
    native-host-install.ts            # 写入 Chromium host 清单
  native-host/
    host.mjs                          # stdin/stdout ↔ localhost bridge
    com.aitranslator.native.json      # host manifest 模板
  src/ ...
apps/extension/
  package.json
  vite.config.ts
  manifest.json
  src/
    background.ts                     # 路由 deepseek | cursor
    content/
      selection.ts                    # 划词气泡
      page-translate.ts               # 整页抽取/写回
    options/
      options.html / options.ts
    popup/
      popup.html / popup.ts
    lib/
      settings.ts                     # chrome.storage
      translate-client.ts             # 调 background
      native.ts                       # chrome.runtime.connectNative
```

---

### Task 1: Root workspaces + `translate-core` 骨架

**Files:**
- Create: `packages/translate-core/package.json`, `packages/translate-core/tsconfig.json`, `packages/translate-core/src/types.ts`, `packages/translate-core/src/index.ts`
- Modify: 根 `package.json`（加 `workspaces`，保留临时脚本或改为委派）

**Interfaces:**
- Produces:
  ```ts
  export type TranslateMode = 'translate' | 'polish'
  export type TargetLang = 'zh' | 'en'
  export type TranslateRequest = {
    text: string
    mode: TranslateMode
    previousTranslation?: string
    targetLang?: TargetLang
  }
  ```

- [ ] **Step 1: 创建 core package 清单**

`packages/translate-core/package.json`:

```json
{
  "name": "@ai-translator/translate-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

`packages/translate-core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
```

- [ ] **Step 2: 写入 types + 空 export**

`packages/translate-core/src/types.ts` — 使用上方 Interfaces 中的类型定义。

`packages/translate-core/src/index.ts`:

```ts
export type { TranslateMode, TargetLang, TranslateRequest } from './types'
```

- [ ] **Step 3: 根 package 启用 workspaces**

在根 `package.json` 增加：

```json
"workspaces": [
  "packages/*",
  "apps/*"
]
```

暂不移动 `apps/desktop`（下一任务）。先建占位 `apps/.gitkeep` 或直接进入 Task 2。

- [ ] **Step 4: 安装依赖**

Run: `npm install`
Expected: lockfile 更新，workspace 识别 `@ai-translator/translate-core`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/translate-core
# 同步 docs/feat/browser-extension/README.md ## Commits
git commit -m "$(cat <<'EOF'
chore(monorepo): 初始化 workspaces 与 translate-core 骨架

EOF
)"
```

---

### Task 2: 抽出 prompts + DeepSeek client 到 core

**Files:**
- Create: `packages/translate-core/src/prompts.ts`, `packages/translate-core/src/deepseek.ts`, `packages/translate-core/src/deepseek.test.ts`
- Modify: `packages/translate-core/src/index.ts`
- 暂不改 `electron/deepseek.ts`（Task 3 再接线）

**Interfaces:**
- Produces:
  ```ts
  export type DeepSeekSettings = {
    baseUrl: string
    apiKey: string
    model: string
  }
  export function buildSystemPrompt(mode: TranslateMode, targetLang?: TargetLang): string
  export async function callDeepSeek(settings: DeepSeekSettings, req: TranslateRequest): Promise<string>
  ```
- 行为与现有 `electron/deepseek.ts` 对齐（超时 60s、401 文案、polish userContent 格式）

- [ ] **Step 1: 写失败测试（空输入 / 缺 key）**

`packages/translate-core/src/deepseek.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { callDeepSeek } from './deepseek'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callDeepSeek', () => {
  it('rejects empty text', async () => {
    await expect(
      callDeepSeek(
        { baseUrl: 'https://api.deepseek.com', apiKey: 'sk', model: 'deepseek-v4-flash' },
        { text: '  ', mode: 'translate' }
      )
    ).rejects.toThrow('请输入要翻译的文字')
  })

  it('rejects missing api key', async () => {
    await expect(
      callDeepSeek(
        { baseUrl: 'https://api.deepseek.com', apiKey: '  ', model: 'deepseek-v4-flash' },
        { text: 'hello', mode: 'translate' }
      )
    ).rejects.toThrow('请先在设置中填写 API Key')
  })

  it('posts chat completions and returns content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '你好' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await callDeepSeek(
      { baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-test', model: 'deepseek-v4-flash' },
      { text: 'hello', mode: 'translate', targetLang: 'zh' }
    )
    expect(out).toBe('你好')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -w @ai-translator/translate-core`
Expected: FAIL（模块/函数不存在）

- [ ] **Step 3: 实现 prompts + callDeepSeek**

从 `electron/deepseek.ts` 原样搬移 system prompt 字符串到 `prompts.ts` 的 `buildSystemPrompt`；`deepseek.ts` 实现与现网一致（注意 `baseUrl` 去尾斜杠、AbortController 60s）。

`index.ts` 导出 `buildSystemPrompt`、`callDeepSeek`、`DeepSeekSettings`。

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test -w @ai-translator/translate-core`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(translate-core): 抽出 DeepSeek client 与 prompts

EOF
)"
```

---

### Task 3: 迁入 `apps/desktop` 并改用 core

**Files:**
- Move: 现有 Electron 相关文件 → `apps/desktop/`（`electron/`、`src/`、`index.html`、`electron.vite.config.ts`、`tsconfig.json`、`resources/`、builder 配置）
- Modify: 根与 `apps/desktop/package.json`；`apps/desktop/electron/deepseek.ts` 或删除后改 `translate.ts` import core
- Modify: `electron/cursor.ts` 的 prompt — **可暂时保留本地副本**；可选后续再共用 `buildSystemPrompt`（Cursor 版 prompt 含「不要使用工具」后缀，勿盲目替换）

**Interfaces:**
- Consumes: `callDeepSeek`, `TranslateRequest` from `@ai-translator/translate-core`
- `translateText` 签名不变

- [ ] **Step 1: 物理迁移**

```bash
mkdir -p apps/desktop
git mv electron apps/desktop/electron
git mv src apps/desktop/src
git mv index.html electron.vite.config.ts tsconfig.json apps/desktop/
git mv resources apps/desktop/resources
# 将 package.json 的 dependencies / build / scripts 下沉到 apps/desktop/package.json
# 根 package.json 仅保留 workspaces + 便捷脚本：
#   "dev": "npm run dev -w ai-translator-desktop"
#   "build": "npm run build -w ai-translator-desktop"
```

`apps/desktop/package.json` name 建议：`ai-translator-desktop`；依赖加 `"@ai-translator/translate-core": "*"`。

修正 `electron.vite.config.ts` 内 `__dirname` 路径（仍指向本包内 `electron/`、`index.html`）。

修正 `build.files` / `extraResources` 相对路径。

- [ ] **Step 2: 接线 DeepSeek**

`apps/desktop/electron/translate.ts`:

```ts
import { callDeepSeek, type TranslateRequest } from '@ai-translator/translate-core'
import type { AppSettings } from './settings'
import { callCursorAgent } from './cursor'

export async function translateText(
  settings: AppSettings,
  req: TranslateRequest
): Promise<string> {
  if (settings.provider === 'cursor') {
    return callCursorAgent(settings, req)
  }
  return callDeepSeek(
    { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
    req
  )
}

export type { TranslateRequest }
```

删除或将 `apps/desktop/electron/deepseek.ts` 改为 re-export（若别处仍 import 类型，改为从 core 引入）。更新 `cursor.ts` 的 `TranslateRequest` import 路径。

- [ ] **Step 3: 安装并回归桌面**

Run: `npm install && npm run dev`
Expected: 主窗口可开；设置页 DeepSeek 翻译仍可用；划词仍可用

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(desktop): 迁入 apps/desktop 并改用 translate-core

EOF
)"
```

---

### Task 4: 整页分块纯逻辑（core）

**Files:**
- Create: `packages/translate-core/src/chunk.ts`, `packages/translate-core/src/chunk.test.ts`
- Modify: `packages/translate-core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PAGE_MAX_NODES = 400
  export const PAGE_MAX_CHARS = 80_000
  export const CHUNK_MAX_CHARS = 1200

  export type TextUnit = { id: string; text: string }

  /** 按字符上限把 units 合并为请求批次（不合并会超限的单条则单独成批） */
  export function batchTextUnits(units: TextUnit[], maxChars?: number): TextUnit[][]

  /** 截断超大页：返回 { units, truncated: boolean } */
  export function limitPageUnits(units: TextUnit[], maxNodes?: number, maxChars?: number): {
    units: TextUnit[]
    truncated: boolean
  }
  ```

- [ ] **Step 1: 写测试**

覆盖：空数组、单段超长单独成批、多段合并、节点数截断。

- [ ] **Step 2: Run — FAIL → 实现 → PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(translate-core): 增加整页文本分块与上限逻辑

EOF
)"
```

---

### Task 5: 扩展脚手架（MV3 + Vite）

**Files:**
- Create: `apps/extension/package.json`, `apps/extension/vite.config.ts`, `apps/extension/tsconfig.json`, `apps/extension/manifest.json`, `apps/extension/src/background.ts`, `apps/extension/src/popup/popup.html`, `apps/extension/src/popup/popup.ts`, `apps/extension/src/options/options.html`, `apps/extension/src/options/options.ts`, `apps/extension/public/`（如需图标可复用 desktop resources 拷贝）

**Interfaces:**
- Manifest MV3：`background.service_worker`、`permissions`: `storage`, `activeTab`, `scripting`；`host_permissions`: `https://api.deepseek.com/*`（及用户可改 baseUrl 时用 `<all_urls>` 需谨慎——v1 可用 `https://*/*` 或在 Options 说明自定义 baseUrl 需自行改 manifest；**建议 v1 host_permissions 含 `https://api.deepseek.com/*`，自定义 baseUrl 后续再加 optional_host_permissions**）
- `content_scripts` 先空或占位 `matches: ["<all_urls>"]`，下一任务再挂选择脚本

- [ ] **Step 1: package + vite 多入口**

`apps/extension/package.json` name: `ai-translator-extension`；依赖 `@ai-translator/translate-core`；devDeps: `vite`, `typescript`, `@types/chrome`。

Vite 配置打出：`background.js`、`content/selection.js`、`content/page-translate.js`、`popup`、`options`；构建后把 `manifest.json` copy 到 `dist/`。

- [ ] **Step 2: 最小 background**

```ts
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Translator extension installed')
})
```

- [ ] **Step 3: 构建并 Load unpacked**

Run: `npm run build -w ai-translator-extension`
Expected: `apps/extension/dist/manifest.json` 存在；Chrome → 扩展程序 → 加载已解压的扩展包 → 无报错

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(extension): 搭建 Chromium MV3 扩展脚手架

EOF
)"
```

---

### Task 6: 扩展 Settings（Options）+ DeepSeek 直连翻译 API

**Files:**
- Create: `apps/extension/src/lib/settings.ts`, `apps/extension/src/lib/translate-client.ts`
- Modify: `apps/extension/src/options/*`, `apps/extension/src/background.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ExtensionSettings = {
    provider: 'deepseek' | 'cursor'
    deepseek: { baseUrl: string; apiKey: string; model: string }
    pageMode: 'bilingual' | 'replace'  // 默认 bilingual
    targetLang?: 'zh' | 'en'
  }

  export async function getExtensionSettings(): Promise<ExtensionSettings>
  export async function saveExtensionSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings>
  ```
- Background message:
  ```ts
  // req
  { type: 'translate'; request: TranslateRequest }
  // res
  { ok: true, result: string } | { ok: false, error: string }
  ```
- `provider === 'deepseek'` → `callDeepSeek`；`cursor` → 先返回明确错误「桌面端未接通」（Task 9 再实现）

- [ ] **Step 1: settings 存 chrome.storage.sync（失败则 local）**

默认：`provider: 'deepseek'`，`baseUrl: 'https://api.deepseek.com'`，`model: 'deepseek-v4-flash'`，`pageMode: 'bilingual'`。

- [ ] **Step 2: Options 表单**

字段：provider 单选、DeepSeek 三字段、pageMode 单选；保存按钮写 storage。

- [ ] **Step 3: background 处理 translate**

```ts
import { callDeepSeek } from '@ai-translator/translate-core'
// provider deepseek → callDeepSeek(settings.deepseek, request)
// provider cursor → { ok:false, error: 'Cursor 需桌面端（即将接入）' }
```

- [ ] **Step 4: 手测**

Options 填真实 key → 在扩展 service worker 控制台或临时 popup 按钮发一条 `translate` → 返回中文/英文译文

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(extension): Options 配置与 DeepSeek 直连翻译

EOF
)"
```

---

### Task 7: 页内划词气泡

**Files:**
- Create: `apps/extension/src/content/selection.ts`（及必要 css，可用 shadow DOM）
- Modify: `manifest.json` content_scripts；`background.ts` 若需

**Interfaces:**
- Consumes: background `translate` message
- UI 动作：`translate` | `polish` | `swap-language` | `copy`（对齐桌面语义）
- `targetLang` 在 zh/en 间切换；polish 需带 `previousTranslation`

- [ ] **Step 1: 选区监听**

`mouseup` 后读 `window.getSelection()`；无文本则隐藏；有文本则在选区右侧显示气泡宿主（`position: fixed`，坐标用 `getBoundingClientRect`）。

- [ ] **Step 2: 气泡操作**

点击翻译 → `chrome.runtime.sendMessage` → 展示结果；润色用上一次结果；复制写 `navigator.clipboard.writeText`。

- [ ] **Step 3: 点击页面空白 / Esc 关闭**

- [ ] **Step 4: 手测**

任意网页选中英文 → 译成中文；润色；换语言；复制

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(extension): 页内划词翻译气泡

EOF
)"
```

---

### Task 8: 整页翻译（双语 + 替换）

**Files:**
- Create: `apps/extension/src/content/page-translate.ts`
- Modify: `apps/extension/src/popup/*`，`background.ts`（可增加 `translate-batch` 或循环单条）

**Interfaces:**
- Consumes: `batchTextUnits`, `limitPageUnits` from core
- Popup 按钮：`翻译此页` / `清除译文` / `还原原文`；显示当前 `pageMode`
- 跳过节点：`script, style, noscript, code, pre, textarea, input, [contenteditable], [data-ai-translator]`
- 双语：在文本节点后插入 `<span data-ai-translator="bilingual">…</span>`
- 替换：`data-ai-translator-original` 存原文，文本替换为译文
- 失败块：保留原文，可选 `data-ai-translator-error`

- [ ] **Step 1: 抽取可见文本节点 → TextUnit[]**

为每个节点生成稳定 `id`（可用递增 + WeakMap 映射回 Node）。

- [ ] **Step 2: limit + batch → 逐批 translate**

串行批次（避免打爆 rate limit）；进度可 `sendMessage` 回 popup。

- [ ] **Step 3: 按 pageMode 写回 DOM**

实现 `clearTranslation()`：移除 bilingual 节点或从 `data-ai-translator-original` 还原。

- [ ] **Step 4: Popup 接线**

`chrome.tabs.sendMessage` 触发 content script；超大页 truncated 时 popup 提示「仅翻译前 N 段」。

- [ ] **Step 5: 手测**

静态文章页双语；切换替换再译；清除/还原；故意断网看失败块

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(extension): 整页双语与替换翻译

EOF
)"
```

---

### Task 9: Desktop 本机桥 + Native Messaging Host

**Files:**
- Create: `apps/desktop/electron/native-bridge.ts`, `apps/desktop/electron/native-host-install.ts`, `apps/desktop/native-host/host.mjs`, `apps/desktop/native-host/com.aitranslator.native.json`
- Modify: `apps/desktop/electron/main.ts`（启动 bridge + install host）
- Modify: `apps/extension/src/lib/native.ts`, `apps/extension/src/background.ts`, Options Cursor 状态

**Interfaces:**
- Bridge HTTP（仅 `127.0.0.1`）：
  - `GET /health` → `{ ok: true, version: string }`
  - `POST /translate` body `TranslateRequest` → `{ ok: true, result }`（**强制 Cursor 路径**：调用 `callCursorAgent`，忽略桌面 UI 当前是否选 DeepSeek——与规格「插件指定 cursor 时只走 Cursor」一致；若桌面无 Cursor key 则返回错误）
  - `GET /status` → `{ ready, model }`
- Native host 协议（长度前缀 uint32 LE + UTF-8 JSON，Chrome 标准）：
  - 消息类型同规格：`ping` | `translate` | `get-status`
- Host 清单 name：`com.aitranslator.native`
- 扩展：`permissions` 增加 `"nativeMessaging"`；`chrome.runtime.connectNative('com.aitranslator.native')`

- [ ] **Step 1: Electron 启动 localhost bridge**

在 `app.whenReady` 后 `createServer` 监听 `127.0.0.1:0`，把 port 写到 `app.getPath('userData')/native-bridge-port`。

- [ ] **Step 2: host.mjs**

读 port 文件 → 将 stdin 消息转发为 HTTP → 写回 stdout。处理 Chrome 的 4-byte length prefix。

- [ ] **Step 3: 安装 host 清单**

`native-host-install.ts`：写入

- macOS Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.aitranslator.native.json`
- macOS Edge: `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.aitranslator.native.json`

JSON `path` 指向打包后/开发态的 `host.mjs`（开发可用绝对路径；生产用 `process.resourcesPath`）。`allowed_origins`: `chrome-extension://<EXT_ID>/`。

开发期：在 `apps/extension` 用固定 `key` 字段生成稳定 extension id，并把该 id 写入清单。

- [ ] **Step 4: 扩展 background 接 Cursor**

`provider === 'cursor'` → native `translate`；失败映射为「请打开 AI Translator 桌面端」。

Options 增加「桌面状态」：打开页时 `ping`/`get-status`。

- [ ] **Step 5: 手测**

1. 启动 desktop → 确认 port 文件与 host json 已写  
2. 扩展 provider=cursor → 划词翻译成功  
3. 退出 desktop → 应看到离线提示；切 DeepSeek 仍可用

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(native-messaging): Cursor 经桌面代理供扩展调用

EOF
)"
```

---

### Task 10: 打磨与手测清单（M4）

**Files:**
- Modify: popup/options 文案与错误提示；可选 README 使用说明
- Modify: `docs/feat/browser-extension/README.md` 补充「如何 Load unpacked / 如何开桌面」

- [ ] **Step 1: 错误文案统一**

| 场景 | 文案 |
|------|------|
| 无 DeepSeek key | 请先在扩展设置中填写 DeepSeek API Key |
| Cursor 桌面离线 | 请打开 AI Translator 桌面端以使用 Cursor |
| 整页截断 | 页面过大，仅翻译了前 N 个文本块 |
| 单块失败 | 该段保留原文 |

- [ ] **Step 2: 手测清单全部勾过**

- [ ] 桌面：`npm run dev` 划词 + DeepSeek + Cursor 回归  
- [ ] 扩展 DeepSeek 划词  
- [ ] 扩展整页双语 / 替换 / 清除 / 还原  
- [ ] 扩展 Cursor + 桌面在线  
- [ ] 扩展 Cursor + 桌面离线提示  
- [ ] Chrome 与 Edge 各 Load 一次（host 清单两个目录）

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(browser-extension): 补充扩展使用说明与错误文案打磨

EOF
)"
```

---

## Spec coverage (self-review)

| 规格项 | 任务 |
|--------|------|
| Monorepo `apps/desktop` + `apps/extension` + `packages/translate-core` | T1–T3, T5 |
| DeepSeek 插件直连 + 独立 Options | T6 |
| Cursor 仅 Native Messaging，不在插件跑 SDK | T9；全局约束 |
| 页内划词 | T7 |
| 整页双语默认 + 替换 | T8 |
| 分块上限 / 失败块 | T4, T8, T10 |
| Chromium only | T5 manifest / T9 host 路径 |
| 不做设置同步 / Firefox / 插件内 SDK | 全局约束；无对应实现任务 |

## Placeholder / consistency check

- 类型名统一：`TranslateRequest`、`ExtensionSettings.pageMode: 'bilingual' | 'replace'`
- Native 消息：`ping` / `translate` / `get-status`
- Host 名：`com.aitranslator.native`
- Cursor 桌面强制路径与规格一致
