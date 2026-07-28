# 桌面端剪贴板历史（宿主 + 独立包）

日期：2026-07-28  
分支：`feat/desktop-clipboard-history`  
状态：已确认（实现阶段不自动提交，由人工审核后提交）

## 背景

桌面端为 Electron 单体（`apps/desktop`），功能以 `electron/*.ts` 平铺接入，尚无插件加载器。需要内置剪贴板历史：快捷键打开浮动面板、展示历史、可复制与粘贴；同时希望业务与桌面端拆开，桌面仅作载体，为后续插件生态预留 Host 接口（首版不做动态加载）。

## 目标

1. 独立 workspace 包 `packages/clipboard-history`：历史监听、去重、落盘、面板 UI；不依赖 `electron`。
2. 桌面薄宿主：实现 Host、注册/注销快捷键、创建浮动 `BrowserWindow`、注入存储路径与剪贴板/粘贴能力。
3. 快捷键打开 Spotlight / 系统剪贴板历史风格的浮动面板（毛玻璃、圆角）；**无搜索**，纯文本历史平铺。
4. 交互：右侧复制图标仅写入剪贴板；**双击**写入剪贴板并尽量自动粘贴到前台 App，然后关闭面板。
5. 落盘最多 **100** 条，重启保留；默认目录在 `userData`，设置可自定义。
6. 设置：可开关启用；启用后才注册快捷键；「剪贴板历史」折叠区块，不与翻译设置平铺混在一起。

## 非目标

- 搜索、图片/文件等非纯文本类型
- 动态插件加载、第三方安装、manifest 运行时
- 历史加密、跨设备同步、自动迁移旧存储目录文件
- 改浏览器扩展或 `translate-core`
- 首版自动提交 git（由审核者提交）

## 决策摘要

| 议题 | 选择 |
|------|------|
| 包结构 | 方案 1：单包 `packages/clipboard-history` + 桌面 bridge |
| UI | 独立浮动面板（非主窗口 Tab）；风格参考 Spotlight，无搜索 |
| 选中行为 | 复制图标 = 仅复制；双击 = 复制 + 自动粘贴 + 关面板 |
| 内容类型 | 仅纯文本 |
| 容量 | 落盘上限 100，超出丢最旧 |
| 启用模型 | `clipboardHistoryEnabled`；启用才 `activate` + 注册快捷键 |
| 存储路径 | 默认可写 `userData/clipboard-history`；设置可改；换路径不自动迁移 |
| 设置 UI | 「剪贴板历史」折叠区，与翻译相关分区隔离 |
| 插件生态 | 接口先行（Host）；不做 loader |

## 架构

```
apps/desktop（宿主）
  settings: clipboardHistoryEnabled / Hotkey / StorageDir
  electron/clipboard-history-bridge.ts
    → 实现 Host、快捷键、BrowserWindow、设置变更启停
  SettingsPage: 「剪贴板历史」折叠面板

packages/clipboard-history（业务）
  host.ts       Host 接口
  history.ts    去重、上限 100、持久化
  activate.ts   activate(host) / deactivate()
  ui/           浮动面板 React UI
```

### Host 接口（包定义，桌面实现）

调用方只需依赖下列能力（名称可在实现时微调，语义固定）：

| 能力 | 用途 |
|------|------|
| `readClipboardText()` / `writeClipboardText(text)` | 读剪贴板、复制 |
| `onClipboardChange(cb)` / 对应 unsubscribe | 宿主轮询或事件；包内入栈 |
| `pasteText(text)` | 双击：写剪贴板 → 还焦点 → 模拟 Cmd/Ctrl+V |
| `readHistoryJson()` / `writeHistoryJson(raw)` | 宿主按 resolved 目录读写 `history.json`（包不直接碰路径，便于假 Host 测试） |
| `showPanel()` / `hidePanel()` | 窗口由宿主管；包提供 UI 内容 |

包内 **禁止** `import 'electron'`。桌面 bridge 是唯一 Electron 适配器。

### 启停

- `clipboardHistoryEnabled === true` → `activate(host)` + `globalShortcut.register(hotkey)`
- `false` → 注销快捷键 + `deactivate()`（停监听）；**不删除**已落盘文件
- 改快捷键：仅在启用时重新注册；冲突则提示并保留旧键（与现有翻译热键体验对齐）

## 数据与持久化

### `AppSettings` 新增字段

| 字段 | 类型 | 默认 |
|------|------|------|
| `clipboardHistoryEnabled` | `boolean` | `false` |
| `clipboardHistoryHotkey` | `string` | macOS `Command+Shift+V`，其它 `Control+Shift+V` |
| `clipboardHistoryStorageDir` | `string` | `''`（空 = 使用默认 `userData/clipboard-history`） |

翻译用 `hotkey` 与剪贴板热键分离，互不影响。

### 历史文件

- 由宿主解析目录并经 `readHistoryJson` / `writeHistoryJson` 读写；物理文件为 `{resolvedStorageDir}/history.json`
- 条目：`{ id, text, createdAt }`（纯文本；实现可加 `hash` 便于去重）
- 上限：100；新条目插顶部；满则删最旧
- 入栈规则：空串忽略；与栈顶文本相同则跳过
- 自身写入（复制按钮 / pasteText 写回）短冷却忽略，避免污染；并尽量避开划词「剪贴板偷取」造成的瞬时噪声

### 换存储目录

下次读写使用新路径；**不**自动搬运旧文件。自定义目录不可写时：**回退默认** `userData/clipboard-history`，设置页展示错误提示；运行时仍可继续落盘到默认目录。

### 损坏文件

将坏文件重命名为 `.bak`（若可写），从空列表重建。

## 面板 UI 与交互

- 独立 `BrowserWindow`：frameless、居中偏上、alwaysOnTop、vibrancy/毛玻璃（平台能力允许时）
- 列表：新→旧平铺，无搜索框
- 每行：文本预览 + 右侧复制图标
- **单击复制图标**：`writeClipboardText`，面板可保持打开
- **双击行**：`pasteText` → 隐藏面板 → 焦点回前台 → 模拟粘贴
- Esc / 失焦：关闭面板
- 粘贴模拟失败：剪贴板已写入；提示「已复制，请手动粘贴」
- macOS 辅助功能未授权：与划词一致，引导开启权限

## 设置页 UI

结构示意：

```
设置
├─ 翻译 / 厂商 / 划词 / 主题…（现有区块，本需求不强制改折叠）
└─ ▶ 剪贴板历史（默认折叠）
     ├─ 启用开关
     ├─ 快捷键录制（启用后注册才生效）
     └─ 存储目录（展示解析后路径 +「选择文件夹」；清空/默认按钮可选）
```

不与翻译 API / 划词范围等控件平铺混排在同一视觉组。

## 与现有模块的 seam

| 现有 | 用法 |
|------|------|
| `hotkey.ts` | 可抽「多快捷键注册」或并列第二套 register；勿抢占翻译热键 |
| `selection.ts` / `isAuxWindow` | 浮动窗纳入 aux 生命周期，避免误关主窗 / 误退出 |
| `selection-text.ts` | 剪贴板读写模式参考；历史监听需忽略偷取窗口期 |
| `settings.ts` + `SettingsPage` | 新字段 + 折叠区 |
| `preload.ts` | 可选 `clipboardHistory` 命名空间，仅面板 renderer 使用 |

## 测试

- `history.ts`：去重、上限 100、忽略自身写入、持久化 round-trip（假 FS）
- 内存假 Host：`activate` / 复制 / 双击粘贴的调用顺序
- Bridge / 窗口：手工验证快捷键、折叠设置、换路径

## 实现约束

- 动工与联调过程中 **不自动 git commit**；由审核者确认后再提交。
- 提交时遵循仓库 commit 规范（中文 subject + `docs/<branch>/README.md` Commits 同步）。
