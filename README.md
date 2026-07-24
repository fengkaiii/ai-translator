# AI Translator

DeepSeek 驱动的中英互译桌面应用（Electron + React + Vite）。

## 功能清单

### 翻译

- 中英互译，自动判断方向（中→英 / 英→中）
- 对接 DeepSeek Chat Completions；Cursor 官方 `@cursor/sdk` 本地运行时
- 厂商可切换；模型列表随厂商变化
- **翻译**：根据原文生成译文
- **润色**：在保留原意的前提下，把当前译文改得更通顺

### 划词翻译

- 选中文字后在光标附近显示应用 Logo 浮标，点击弹出翻译小窗
- 小窗支持 **复制**、**润色**、关闭；状态栏右侧显示可切换到的方向（当前为中文则显示 **→英文**）
- 支持拖选、双击/三击选词
- 优先用辅助功能读取选区，必要时才模拟复制（降低对剪贴板的干扰）
- 划词应用范围可切换：**全部应用** / **已选中的应用**（默认全部）
- 「已选中」模式下：仅白名单中的应用会弹出浮标（添加即生效）

### 系统快捷键

- 可自定义全局快捷键（默认 macOS `⌘⇧T`，Windows/Linux `Ctrl+Shift+T`）
- 有选中文字时：唤起主窗口、填入原文并自动翻译
- 无选中文字时：仅唤起/聚焦主窗口

### 设置与界面

- 厂商：DeepSeek / Cursor（切换自动带出默认配置与模型列表）
- DeepSeek：`baseUrl` + API Key + 模型；Cursor：Dashboard API Key + `@cursor/sdk` 本地 Agent
- 主题：浅色 / 深色 / 跟随系统（主界面与划词小窗均适配）
- 划词开关、快捷键录制、划词应用范围（全部 / 已选中）
- macOS 辅助功能授权引导（开发模式需添加 `Electron.app`）

### 打包与平台

- 桌面端：macOS `.dmg`、Windows `.exe`、Linux `.deb`
- 应用图标与划词浮标使用统一 Logo

## 开发

```bash
npm install
npm run dev   # apps/desktop（Electron）
```

Monorepo：`apps/desktop`（桌面端）、`apps/extension`（浏览器扩展）、`packages/translate-core`（共享翻译逻辑）。

首次使用划词翻译时，macOS 需在 **系统设置 → 隐私与安全性 → 辅助功能** 中授权。

开发模式请添加：

`node_modules/electron/dist/Electron.app`

可在设置页点击「在 Finder 中显示 Electron.app」快速定位。

## 打包

```bash
npm run dist        # 当前平台
npm run dist:mac    # .dmg
npm run dist:win    # .exe
npm run dist:linux  # .deb
```

产物在 `release/`。

## 发布到 GitHub Releases

仓库：https://github.com/fengkaiii/ai-translator

### 用 Actions（推荐）

```bash
# 先把代码推到 master，再打 tag
git tag v1.0.0
git push origin v1.0.0
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会分别在 macOS / Windows / Linux 打包，并上传到 [Releases](https://github.com/fengkaiii/ai-translator/releases)。

打开对应版本页即可下载安装包（`.dmg` / `.exe` / `.deb`）。若页面上没有任何 Assets，说明上传被跳过（常见原因：该 tag 已有一个空的已发布 Release，与草稿类型冲突）——删掉该 Release 后重新推 tag 即可。

### 安装与打开（macOS）

当前 Release 中的 `.dmg` **未做 Apple 开发者签名与公证**。从浏览器下载后，双击可能提示「已损坏，无法打开」——这是 Gatekeeper 隔离标记，不是安装包损坏。

1. 打开 `.dmg`，将 `AI Translator.app` 拖到「应用程序」
2. 在终端执行（清除隔离标记）：

```bash
xattr -cr "/Applications/AI Translator.app"
open "/Applications/AI Translator.app"
```

也可在「系统设置 → 隐私与安全性」中允许仍要打开。正式对外分发需配置 Developer ID 签名 + 公证后，才可正常双击打开。

### 本地发布（当前平台）

```bash
export GH_TOKEN=你的_GitHub_PAT   # 需要 repo 权限
npm run release
```

## 快速使用

1. 打开「设置」，填写 DeepSeek API Key（可按需修改 baseUrl / model）
2. 在「翻译」页输入文字，点击「翻译」或「润色」
3. 需要划词时打开「划词翻译」；若只想在部分应用生效，切到「已选中的应用」并添加对应应用
4. 可用全局快捷键快速唤起并翻译选中文字
