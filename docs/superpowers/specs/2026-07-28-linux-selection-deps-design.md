# Linux / Windows 划词依赖体验

## 目标

正式用户安装 `.deb` 后划词开箱可用；开发环境缺依赖时在设置页可见可操作提示。Windows 无需系统包，设置页说明取词方式。

## 方案

1. **deb `Depends`**：在默认 Electron 依赖外增加 `wl-clipboard | xclip`。
2. **`getSelectionRuntimeStatus` IPC**：Linux 检测 `xclip`/`wl-paste`；Windows 恒为 ready 并提示 Ctrl+C 取词；macOS 指向辅助功能。
3. **设置页**：非 macOS 在「划词翻译」下展示就绪状态；Linux 缺依赖时提供「复制安装命令」。

## 非目标

不改为 Linux Ctrl+C 兜底；不改 Windows 取词实现本身。
