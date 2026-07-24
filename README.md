# AI Translator

DeepSeek 驱动的中英互译桌面应用（Electron + React + Vite）。

## 功能清单

### 翻译

- 中英互译，自动判断方向（中→英 / 英→中）
- 对接 DeepSeek Chat Completions（可改 baseUrl / model，兼容同类接口）
- **翻译**：根据原文生成译文
- **润色**：在保留原意的前提下，把当前译文改得更通顺

### 划词翻译

- 选中文字后在光标附近显示应用 Logo 浮标，点击弹出翻译小窗
- 小窗支持 **复制**、**润色**、关闭
- 支持拖选、双击/三击选词
- 优先用辅助功能读取选区，必要时才模拟复制（降低对剪贴板的干扰）
- 可按应用排除：从「运行中」或「全部应用」选择加入列表，勾选后才真正排除
- 在排除的应用内（如 Cursor）不弹出划词浮标

### 系统快捷键

- 可自定义全局快捷键（默认 macOS `⌘⇧T`，Windows/Linux `Ctrl+Shift+T`）
- 有选中文字时：唤起主窗口、填入原文并自动翻译
- 无选中文字时：仅唤起/聚焦主窗口

### 设置与界面

- API：`baseUrl`、`api_key`、`model`
- 主题：浅色 / 深色 / 跟随系统（主界面与划词小窗均适配）
- 划词开关、快捷键录制、排除列表管理
- macOS 辅助功能授权引导（开发模式需添加 `Electron.app`）

### 打包与平台

- 桌面端：macOS `.dmg`、Windows `.exe`、Linux `.deb`
- 应用图标与划词浮标使用统一 Logo

## 开发

```bash
npm install
npm run dev
```

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

## 快速使用

1. 打开「设置」，填写 DeepSeek API Key（可按需修改 baseUrl / model）
2. 在「翻译」页输入文字，点击「翻译」或「润色」
3. 需要划词时打开「划词翻译」；若编辑器内不想弹浮标，把对应应用加入排除列表并勾选启用
4. 可用全局快捷键快速唤起并翻译选中文字
