# 需求

Linux Wayland 下桌面端划词翻译、全局快捷键与 Dock/任务栏闪烁问题。当前进度已暂存；**闪烁问题尚未彻底解决**。

## 分支信息

- 分支: fix/linux-wayland-selection
- 创建时间: 2026-07-28T15:20:00Z
- 初始版本: 2.0.13

## 进度（2026-07-28）

### 已完成

1. **开发启动**
   - 增加 `dev:linux`（`ELECTRON_DISABLE_SANDBOX=1`），规避 Linux sandbox 权限问题。
2. **划词依赖**
   - deb 依赖：`wl-clipboard | xclip`、`libinput-tools`、`xdotool | ydotool`。
   - `after-install.sh`：sandbox `4755`、AppArmor、图标缓存。
   - 设置页 Linux 依赖就绪提示 + `getSelectionRuntimeStatus`。
3. **Wayland 鼠标钩子**
   - `uiohook` 收不到全局鼠标 → `linux-input-hook.ts`（`libinput debug-events`）。
4. **Wayland 全局快捷键**
   - `globalShortcut` 常「注册成功但不触发」→ `linux-evdev-hotkey.ts`（读 `/dev/input/event*`）。
   - 划词热键与剪贴板历史热键均走 evdev。
5. **划词 UX（Linux）**
   - 仅拖选 / 双击触发（取消长按，避免误弹）。
   - 图标点击由主进程开小窗（透明窗收不到点击）。
   - 图标不可聚焦；跳过 `demoteMain` hide 主窗（减少闪烁）。
   - Chrome Wayland 常不写主键 → 鼠标路径 `skipPrimary` + `ydotool` Ctrl+C。
   - 偷剪贴板用 `wl-copy`/`wl-paste`，并 suppress 进剪贴板历史。
6. **剪贴板面板**
   - Linux 面板底色加实；blur 误关与定位调整。
7. **打包图标**
   - Linux 多尺寸图标目录 `apps/desktop/build/icons/`。

### 未解决 / 已知问题

1. **Dock/任务栏闪烁仍在**（用户反馈：单击也会闪；划词图标出现与否都可能闪）。
   - 已排除/尝试过：主窗 `demoteMain` hide、图标 `focusable`、禁鼠标 Ctrl+C、去掉每次点击 `wl-paste`、Electron `clipboard.writeText` 改 `wl-copy`。
   - 仍可疑：`showInactive` 浮窗、`ydotool` 注入、Electron Wayland 进程被合成器标为 urgency、创建 `BrowserWindow` 本身。
2. **Chrome 划词**依赖 Ctrl+C 兜底；与「不闪、不污染剪贴板历史」仍有张力。
3. **开发注意**：勿与已安装的 `/opt/AI Translator` 同时跑；需用户在 `input` 组；`ydotoold` 需可用。

### 关键文件

| 路径 | 作用 |
|------|------|
| `apps/desktop/electron/linux-input-hook.ts` | Wayland 鼠标（libinput） |
| `apps/desktop/electron/linux-evdev-hotkey.ts` | Wayland 快捷键（evdev） |
| `apps/desktop/electron/linux-libinput-hotkey.ts` | 早期 libinput 键盘兜底（已被 evdev 取代为主路径） |
| `apps/desktop/electron/selection.ts` | 划词图标 / 触发规则 |
| `apps/desktop/electron/selection-text.ts` | 取词、主键、Ctrl+C、历史 suppress |
| `apps/desktop/electron/hotkey.ts` / `clipboard-history-hotkey.ts` | Linux → evdev |
| `apps/desktop/build/linux/after-install.sh` | deb 安装后处理 |
| `docs/superpowers/specs/2026-07-28-linux-selection-deps-design.md` | 早期依赖方案设计 |

### 本地验证

```bash
yarn dev:linux
```

验证点：Chrome 拖选是否出图标；单击是否仍闪 Dock；`Alt+Z` / 划词热键是否触发。

### 下一步建议

1. 用日志区分「纯单击」「拖选出图标」「Ctrl+C 偷取」三种闪烁来源。
2. 评估不用 `BrowserWindow` 浮标（如 Tray / 面板内提示），或独立 helper 进程取词以免激活主应用。
3. 确认 GNOME 下 `ydotool` 是否导致 shell urgency。

## Commits

- 2026-07-28 fix(selection): 暂存 Linux Wayland 划词与快捷键进度（闪烁未解）
- 2026-07-28 chore(branch): 初始化分支 fix/linux-wayland-selection（v2.0.13）
