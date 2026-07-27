# AI Translator

DeepSeek / Cursor 驱动的中英互译工具：桌面端划词翻译 + 浏览器扩展整页翻译。

## 软件架构（简）

| 部分 | 作用 |
|------|------|
| 桌面端（Electron） | 系统划词浮标与翻译小窗、全局快捷键、Cursor 本地运行时 |
| 浏览器扩展（MV3） | 页内划词与整页翻译；DeepSeek 直连，Cursor 经桌面代理 |
| translate-core | 桌面与扩展共享的翻译请求类型、prompt 与分块逻辑 |

开发、打包与发版说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 功能概览

- 中英互译（自动判断方向）、润色
- 可选翻译厂商：DeepSeek 或 Cursor
- 桌面划词：选中文字后浮标 → 翻译小窗（复制 / 润色 / 切换方向）
- 划词范围：全部应用 / 仅白名单应用
- 可自定义全局快捷键（默认 macOS `⌘⇧T`，Windows/Linux `Ctrl+Shift+T`）
- 主题：浅色 / 深色 / 跟随系统
- 浏览器扩展：页内划词与整页翻译

## 下载与安装

从 [GitHub Releases](https://github.com/fengkaiii/ai-translator/releases) 下载对应平台安装包：

| 平台 | 文件 |
|------|------|
| macOS Apple Silicon（M 系列） | `AI Translator-*-arm64.dmg` |
| macOS Intel | `AI Translator-*-x64.dmg` |
| Windows | `.exe` |
| Linux | `.deb` |
| 浏览器扩展 | `ai-translator-extension-<版本>.zip` |

### macOS 安装与打开

当前 Release 中的 `.dmg` **未做 Apple 开发者签名与公证**。从浏览器下载后，双击可能提示「已损坏，无法打开」——这是 Gatekeeper 隔离标记，不是安装包损坏。

1. 打开 `.dmg`，将 `AI Translator.app` 拖到「应用程序」
2. 在终端执行：

```bash
xattr -cr "/Applications/AI Translator.app"
open "/Applications/AI Translator.app"
```

也可在「系统设置 → 隐私与安全性」中允许仍要打开。

### 浏览器扩展

1. 解压 `ai-translator-extension-*.zip`
2. Chrome / Edge → 扩展程序 → 开发者模式 → 加载已解压的扩展程序 → 选择解压目录
3. 若使用 Cursor 厂商，需先安装并运行桌面端

## 快速使用

1. 打开桌面端「设置」，选择厂商并填写 API Key（DeepSeek 可按需改 baseUrl / 模型）
2. 在「翻译」页输入文字，点击「翻译」或「润色」
3. 需要划词时打开「划词翻译」；若只想在部分应用生效，切到「已选中的应用」并添加应用
4. 可用全局快捷键唤起主窗口并翻译当前选中文字

### macOS 辅助功能

首次使用划词时，请在 **系统设置 → 隐私与安全性 → 辅助功能** 中授权 **AI Translator**。
