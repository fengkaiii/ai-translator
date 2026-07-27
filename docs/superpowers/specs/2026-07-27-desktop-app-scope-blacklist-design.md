# 桌面端划词应用范围（黑名单）+ 翻译小窗底部固定

日期：2026-07-27  
分支：`feat/desktop-app-scope-blacklist`  
状态：已确认

## 背景

桌面端设置里「划词应用范围」现为两种模式：

- `all`（全部应用）：任意应用可划词（本应用除外），无排除列表
- `selected`（UI 文案为「已选中的应用」）：仅白名单 `excludedApps` 内应用可划词

用户需要在「全部应用」下也能排除部分应用（黑名单），且与「指定应用」白名单列表 UI 一致；两份列表切换模式时各自保留。另需将翻译小窗底部按钮行为对齐插件端：长文时正文滚动、按钮固定在窗口底部。

## 目标

1. 模式文案：「已选中的应用」→「指定应用」；行为与现白名单逻辑不变。
2. 「全部应用」下增加黑名单列表（选择器 + chip，样式与指定应用一致）；名单内应用禁用划词。
3. 白名单与黑名单独立存储；切模式不互相覆盖。
4. 黑名单为空时行为等同于当前「全部应用」（除本应用外均可划词）。
5. 桌面翻译小窗底部「复制 / 润色 / 关闭」在长译文时固定贴底，译文区滚动（对齐插件）。

## 非目标

- 重命名历史字段 `excludedApps`（仍作白名单）
- 统一两份列表为单一存储结构
- 改扩展端划词范围或小窗逻辑
- 改小窗窗口默认尺寸（仍为约 380×280）或按钮文案/交互

## 决策摘要

| 议题 | 选择 |
|------|------|
| 实现方案 | 新增独立字段 `blacklistedApps`，保留 `excludedApps` 作白名单 |
| 列表独立性 | 白名单 / 黑名单分开存；切模式只改判定读哪份 |
| 空黑名单 | 等同现有 `all` 行为 |
| 小窗贴底 | 仅改桌面 `popupHtml` 内联 CSS，对齐插件 flex + 滚动 |

## 数据与判定

### 存储（`AppSettings`）

- `selectionAppMode`: `'all' | 'selected'`（不变）
- `excludedApps: ExcludedAppEntry[]`：指定应用白名单（不变，不迁移）
- 新增 `blacklistedApps: ExcludedAppEntry[]`，默认 `[]`，条目结构与白名单相同（`{ name, enabled }`；列表内即生效，`enabled` 仅兼容）

读写时对 `blacklistedApps` 使用与 `normalizeExcludedApps` 相同的归一化规则（可复用该函数）。

### `shouldSkipSelection`

1. 本应用（Electron / AI Translator）→ 始终跳过  
2. `selected` → 不在 `excludedApps` 则跳过（现逻辑）  
3. `all` → 命中 `blacklistedApps` 则跳过；名单为空则不跳过  

调用处（`selection.ts`）传入当前设置中的白名单与黑名单（或按 mode 传入对应列表）。两份列表在判定上互不影响。

## 设置页 UI / 文案

### 模式切换

- 按钮：`全部应用` / `指定应用`
- 提示：
  - 全部应用：`可在任意应用中划词（本应用除外）；下方黑名单中的应用将被排除。`
  - 指定应用：`仅在下方白名单中的应用可划词；添加即生效。`

### 列表区域

- **指定应用**：现有选择器 + chip 白名单，读写 `excludedApps`，行为不变
- **全部应用**：同一套 UI（来源下拉 / 应用下拉 / 添加 / 刷新 + chip），读写 `blacklistedApps`
- 空黑名单提示：`暂无黑名单应用。添加后将在这些应用中禁用划词。`
- 重复添加：`该应用已在黑名单中`（白名单侧保留「已在白名单中」）
- 仍禁止添加本应用自身

实现上尽量抽共用「应用列表编辑」片段，避免两套几乎相同的 JSX；沿用现有视觉 class（如 `allowlist-chips`），不单独改 CSS 主题。

## 翻译小窗底部固定

文件：`apps/desktop/electron/selection.ts` 内 `popupHtml` 样式。

对齐插件端 panel：

- `.wrap`：`height: 100vh; overflow: hidden`（填满窗口、禁止整体滚动）
- `.status-row`：`flex-shrink: 0`
- `.text`：`flex: 1; min-height: 0; overflow: auto`
- `.actions`：`flex-shrink: 0`（保留现有 `margin-top`）

不改窗口创建参数、按钮集合与 IPC 行为。

## 改动文件

| 文件 | 变更 |
|------|------|
| `apps/desktop/electron/settings.ts` | `blacklistedApps` 默认值、读写、归一化 |
| `apps/desktop/electron/selection-text.ts` | `shouldSkipSelection` 支持 `all` + 黑名单 |
| `apps/desktop/electron/selection.ts` | 调用传参；`popupHtml` CSS 贴底 |
| `apps/desktop/src/pages/SettingsPage.tsx` | 文案 + 全部应用下黑名单 UI |
| `apps/desktop/src/vite-env.d.ts` | 类型同步 |

## 验证

- 单元测 `shouldSkipSelection`：`all` 空黑名单 / 命中黑名单 / `selected` 白名单 / 本应用
- 手动：切模式后两份列表各自保留；全部应用下加入黑名单后对应应用不出现划词图标
- 手动：桌面小窗长译文时底部按钮可见且固定，正文可滚动

## 验收标准

1. 「指定应用」与改名前白名单行为一致，仅文案变更。  
2. 「全部应用」+ 空黑名单 = 现有全部应用行为。  
3. 「全部应用」+ 非空黑名单 = 除名单与本应用外均可划词。  
4. 切模式不丢失另一侧列表内容。  
5. 桌面翻译小窗长文时按钮贴底，与插件端体验一致。
