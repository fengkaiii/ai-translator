# Browser Extension + Monorepo Design

## Goal

在保留现有 Electron 桌面端（系统级划词、热键、Cursor SDK）的同时，新增 Chromium 浏览器扩展，提供：

1. **页内划词翻译**（气泡：翻译 / 润色 / 换语言 / 复制）
2. **网页整页翻译**（双语对照与替换原文两种模式，设置可切换）

## Decisions

| 项 | 决定 |
|----|------|
| 产品形态 | 双端并存：桌面 = 任意 App 划词 + Cursor；插件 = 网页划词 + 整页 |
| 仓库 | 轻量 monorepo（workspaces） |
| 浏览器 v1 | 仅 Chromium（Chrome / Edge） |
| DeepSeek | 插件内 HTTP 直连；Options 独立配置（桌面未开也可用） |
| Cursor | **仅**经 Native Messaging 代理到桌面；**不在插件内跑 `@cursor/sdk`** |
| 整页默认模式 | 双语对照；用户可切换为替换原文（均可还原/清除） |
| 设置同步 | v1 不做桌面 ↔ 插件双向同步 |
| 非目标 | Firefox / Safari；插件内 Cursor SDK；无桌面时的 Cursor |

## Architecture

```text
apps/desktop/              # 现有 Electron（迁入）
apps/extension/            # MV3：background / content / options / popup
packages/translate-core/   # TranslateRequest、prompt、DeepSeek fetch、整页分块纯逻辑
```

### Call paths

```text
页内划词 / 整页
  ├─ provider=deepseek → extension background → DeepSeek HTTP（插件 Options）
  └─ provider=cursor   → Native Messaging → Electron → 现有 callCursorAgent
```

### Constraints

- `@cursor/sdk`、桌面侧密钥只留在 `apps/desktop`
- `translate-core` 不含 Node / Electron / Chrome API
- 插件启动探测桌面端；Cursor 且离线时提示打开 AI Translator（可引导改用 DeepSeek）

## Native Messaging

### Host

- 名称示例：`com.aitranslator.native`
- Electron 安装/启动时写入 Chromium Native Messaging Host 清单  
  （macOS Chrome：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`；Edge 对应目录）
- `allowed_origins`：扩展 ID（开发用固定 key 生成稳定 ID；上架后用商店 ID）

### Protocol (JSON request/response)

```text
→ { id, type: "ping" }
← { id, ok: true, version }

→ { id, type: "translate", payload: TranslateRequest }
← { id, ok: true, result: string } | { id, ok: false, error }

→ { id, type: "get-status" }
← { id, ok: true, provider: "cursor", model, ready: boolean }
```

### Desktop behavior

- Native host 入口校验来源后调用现有翻译管线；插件指定 cursor 时**只走 Cursor 路径**
- 不向插件回传 API Key
- 连接失败 → 插件 UI 提示打开应用

### Explicitly out of native scope (v1)

- 不代理 DeepSeek
- 不同步设置
- 不做 Firefox/Safari host

## Extension features

### In-page selection

- content script 监听选区；松手后在选区旁显示气泡
- 动作对齐桌面：翻译 / 润色 / 换目标语言 / 复制
- 请求经 background 分发（DeepSeek 直连或 Cursor native）

### Full-page translation

- Popup / 工具栏：「翻译此页」+ 模式（默认双语；可切换替换）
- 抽取可见文本节点（跳过 `script` / `style` / `code` / `pre` / `input` 等）
- 按块分片，串行或小并发翻译后写回
- **双语**：旁侧插入带 `data-ai-translator` 标记的译文节点，可一键清除
- **替换**：保存原文以便还原，译文写入原节点
- SPA：v1 可采用「手动再点翻译」；MutationObserver 增量为可选增强
- 失败块保留原文并标记；超大页设节点/字符上限并提示

### Options page

- DeepSeek：`baseUrl` / `apiKey` / `model`
- 默认 provider：`deepseek` | `cursor`
- 整页默认模式：双语 | 替换
- Cursor：只读状态（桌面是否在线），无密钥表单

## Build & release

- workspaces：`apps/*` + `packages/*`
- desktop：沿用 electron-vite + electron-builder；安装包附带 native host 注册
- extension：Vite 打 MV3 → `apps/extension/dist`，可 Load unpacked
- 版本：desktop 与 extension **可独立版本号**；协议带 `version` 做兼容
- 扩展 v1：本地/解压安装；稳定后上 Chrome Web Store

## Milestones

1. **M0** — 迁 monorepo + 抽出 `translate-core`；桌面回归划词/翻译仍可用
2. **M1** — 扩展骨架：Options（DeepSeek）+ 页内划词 + DeepSeek 直连
3. **M2** — 整页翻译：双语默认 + 替换/还原
4. **M3** — Native Messaging：Cursor 路径 + 离线提示
5. **M4** — 打磨：分块上限、失败块、入口体验、手测清单

## Why not Cursor SDK inside the extension

`@cursor/sdk` 依赖本机 Node、平台原生包与 `local.cwd` 工作区，无法在 MV3 Service Worker / content script 中运行。插件内跑 SDK 不是协议增量，而是换运行时；故明确不做，统一走桌面代理。
