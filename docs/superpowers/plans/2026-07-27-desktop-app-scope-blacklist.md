# 桌面端划词黑名单 + 小窗贴底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端「全部应用」支持独立黑名单；「指定应用」仅改名；翻译小窗底部按钮固定贴底对齐插件。

**Architecture:** 新增 `blacklistedApps` 与现有白名单 `excludedApps` 分存；`shouldSkipSelection` 按 `selectionAppMode` 读对应列表。设置页两种模式共用同一套应用列表编辑 UI。小窗仅改 `popupHtml` 内联 flex/overflow CSS。

**Tech Stack:** Electron、electron-store、React、TypeScript、vitest（桌面端新增）

**Spec:** `docs/superpowers/specs/2026-07-27-desktop-app-scope-blacklist-design.md`

## Global Constraints

- 不重命名 `excludedApps`（继续作白名单）
- 白名单 / 黑名单独立；切模式不互相覆盖
- 空黑名单 = 现有「全部应用」行为
- 不改扩展端、不改小窗默认尺寸 / 按钮文案与 IPC
- Commit message：`type(scope): 中文描述`；提交前同步 `docs/feat/desktop-app-scope-blacklist/README.md` 的 `## Commits`

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/desktop/electron/selection-text.ts` | `shouldSkipSelection` 支持 all+黑名单 |
| `apps/desktop/electron/selection-text.test.ts` | 新建：判定逻辑单元测试 |
| `apps/desktop/package.json` | 增加 `vitest` 与 `test` 脚本 |
| `apps/desktop/electron/settings.ts` | `blacklistedApps` 存储 / 归一化 |
| `apps/desktop/src/vite-env.d.ts` | 渲染进程 `AppSettings` 类型 |
| `apps/desktop/electron/selection.ts` | 调用传黑名单；`popupHtml` CSS 贴底 |
| `apps/desktop/src/pages/SettingsPage.tsx` | 文案 + 双模式列表 UI |

---

### Task 1: `shouldSkipSelection` 黑名单判定（TDD）

**Files:**
- Create: `apps/desktop/electron/selection-text.test.ts`
- Modify: `apps/desktop/electron/selection-text.ts`（约 162–202 行）
- Modify: `apps/desktop/package.json`（devDependencies + scripts）

**Interfaces:**
- Consumes: 现有 `isAppAllowlisted`、`isSelfApp`、`ExcludedAppLike`
- Produces:

```ts
export type SelectionAppModeLike = 'all' | 'selected'

export function shouldSkipSelection(
  appName: string,
  mode: SelectionAppModeLike,
  allowlist: ExcludedAppLike[],
  blacklist?: ExcludedAppLike[]
): boolean
```

- 第四参可选，默认 `[]`，避免旧调用瞬间崩；本计划随后任务会传齐。

- [ ] **Step 1: 为 desktop 增加 vitest**

在 `apps/desktop/package.json` 的 `scripts` 增加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

在 `devDependencies` 增加（与 translate-core 对齐）：

```json
"vitest": "^3.0.0"
```

在仓库根执行：

```bash
npm install -w ai-translator-desktop
```

Expected: 安装成功，`node_modules/vitest` 可用。

- [ ] **Step 2: 写失败测试**

创建 `apps/desktop/electron/selection-text.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { shouldSkipSelection } from './selection-text'

describe('shouldSkipSelection', () => {
  it('always skips self app', () => {
    expect(shouldSkipSelection('Electron', 'all', [], [])).toBe(true)
    expect(shouldSkipSelection('AI Translator', 'selected', [{ name: 'AI Translator', enabled: true }], [])).toBe(
      true
    )
  })

  it('all + empty blacklist allows other apps', () => {
    expect(shouldSkipSelection('Safari', 'all', [], [])).toBe(false)
  })

  it('all + blacklist skips listed apps', () => {
    expect(shouldSkipSelection('Safari', 'all', [], [{ name: 'Safari', enabled: true }])).toBe(true)
    expect(shouldSkipSelection('Notes', 'all', [], [{ name: 'Safari', enabled: true }])).toBe(false)
  })

  it('selected uses allowlist only (ignores blacklist)', () => {
    const allow = [{ name: 'Cursor', enabled: true }]
    const deny = [{ name: 'Safari', enabled: true }]
    expect(shouldSkipSelection('Cursor', 'selected', allow, deny)).toBe(false)
    expect(shouldSkipSelection('Safari', 'selected', allow, deny)).toBe(true)
    expect(shouldSkipSelection('Notes', 'selected', allow, deny)).toBe(true)
  })

  it('empty app name does not skip', () => {
    expect(shouldSkipSelection('  ', 'all', [], [{ name: 'Safari', enabled: true }])).toBe(false)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npm run test -w ai-translator-desktop
```

Expected: FAIL（当前 `shouldSkipSelection` 仅三参，且 `all` 不会因黑名单跳过；或 arity / 行为不符）。

- [ ] **Step 4: 实现最小改动**

将 `apps/desktop/electron/selection-text.ts` 中：

```ts
export type SelectionAppModeLike = 'all' | 'selected'

/**
 * 是否应跳过划词。
 * - 始终跳过本应用
 * - all：其它应用都允许
 * - selected：仅白名单中的应用允许
 */
export function shouldSkipSelection(
  appName: string,
  mode: SelectionAppModeLike,
  apps: ExcludedAppLike[]
): boolean {
  const name = appName.trim()
  if (!name) return false
  if (isSelfApp(name)) return true
  if (mode !== 'selected') return false
  return !isAppAllowlisted(name, apps)
}
```

改为：

```ts
export type SelectionAppModeLike = 'all' | 'selected'

/**
 * 是否应跳过划词。
 * - 始终跳过本应用
 * - all：命中黑名单则跳过；名单空则允许
 * - selected：仅白名单中的应用允许（忽略黑名单）
 */
export function shouldSkipSelection(
  appName: string,
  mode: SelectionAppModeLike,
  allowlist: ExcludedAppLike[],
  blacklist: ExcludedAppLike[] = []
): boolean {
  const name = appName.trim()
  if (!name) return false
  if (isSelfApp(name)) return true
  if (mode === 'selected') return !isAppAllowlisted(name, allowlist)
  // all：黑名单命中则跳过
  return isAppAllowlisted(name, blacklist)
}
```

注释更新为上述语义。`isAppAllowlisted` 复用做「是否在名单中」匹配（不重命名，避免无关改动）。

- [ ] **Step 5: 跑测试确认通过**

```bash
npm run test -w ai-translator-desktop
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
# 同步 docs/feat/desktop-app-scope-blacklist/README.md ## Commits 后再 commit
git add apps/desktop/package.json package-lock.json \
  apps/desktop/electron/selection-text.ts \
  apps/desktop/electron/selection-text.test.ts \
  docs/feat/desktop-app-scope-blacklist/README.md
git commit -m "$(cat <<'EOF'
feat(selection): 全部应用模式支持黑名单判定

EOF
)"
```

---

### Task 2: 设置存储与类型增加 `blacklistedApps`

**Files:**
- Modify: `apps/desktop/electron/settings.ts`
- Modify: `apps/desktop/src/vite-env.d.ts`

**Interfaces:**
- Consumes: `normalizeExcludedApps`、`ExcludedAppEntry`
- Produces: `AppSettings.blacklistedApps: ExcludedAppEntry[]`（默认 `[]`）；`getSettings` / `saveSettings` 归一化读写

- [ ] **Step 1: 扩展 `AppSettings`（settings.ts）**

在 `AppSettings` 中 `excludedApps` 旁增加：

```ts
  /** 「全部应用」模式下的黑名单；名单内禁用划词 */
  blacklistedApps: ExcludedAppEntry[]
```

`defaults` 增加：

```ts
  blacklistedApps: []
```

`getSettings` 返回值增加：

```ts
    blacklistedApps: normalizeExcludedApps(store.get('blacklistedApps') ?? [])
```

`saveSettings` 在 `excludedApps` 归一化旁增加：

```ts
  if (partial.blacklistedApps !== undefined) {
    next.blacklistedApps = normalizeExcludedApps(partial.blacklistedApps)
  }
```

更新文件顶部注释：白名单 / 黑名单语义写清。`ExcludedAppEntry` 类型不变。

- [ ] **Step 2: 同步渲染进程类型**

在 `apps/desktop/src/vite-env.d.ts` 的 `AppSettings` 中增加：

```ts
  blacklistedApps: ExcludedAppEntry[]
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc -p apps/desktop/tsconfig.json --noEmit
```

若项目无独立 `tsconfig` 指向 electron，可改用：

```bash
npm run build -w ai-translator-desktop
```

Expected: 无因缺字段导致的类型错误（SettingsPage 可能仍缺字段，若 build 失败则在本任务给 `empty` / load 路径先补 `blacklistedApps: []` 最小默认，UI 完整改动留给 Task 4）。

若 build 因 SettingsPage 缺字段失败，在 `empty`、`getSettings` then、`save` then 三处先加 `blacklistedApps: s.blacklistedApps ?? []`（或 `[]`），不改 UI。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/settings.ts apps/desktop/src/vite-env.d.ts \
  apps/desktop/src/pages/SettingsPage.tsx \
  docs/feat/desktop-app-scope-blacklist/README.md
git commit -m "$(cat <<'EOF'
feat(settings): 增加划词黑名单字段 blacklistedApps

EOF
)"
```

（若 Step 3 未改 SettingsPage，则不要 `git add` 该文件。）

---

### Task 3: 划词入口传入黑名单

**Files:**
- Modify: `apps/desktop/electron/selection.ts`（约 599 行）

**Interfaces:**
- Consumes: `shouldSkipSelection(app, mode, allowlist, blacklist)`；`getSettings().blacklistedApps`
- Produces: 运行时 `all` 模式尊重黑名单

- [ ] **Step 1: 更新调用**

将：

```ts
    if (shouldSkipSelection(front, s.selectionAppMode, s.excludedApps)) {
```

改为：

```ts
    if (shouldSkipSelection(front, s.selectionAppMode, s.excludedApps, s.blacklistedApps)) {
```

- [ ] **Step 2: 确认无其它旧调用**

```bash
rg "shouldSkipSelection\(" apps/desktop
```

Expected: 仅测试文件 + `selection.ts` 一处生产调用，均带齐参数（测试为四参；生产为四参）。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/selection.ts docs/feat/desktop-app-scope-blacklist/README.md
git commit -m "$(cat <<'EOF'
fix(selection): 划词入口传入黑名单列表

EOF
)"
```

---

### Task 4: 设置页文案与黑名单 UI

**Files:**
- Modify: `apps/desktop/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `AppSettings.blacklistedApps`、`saveSettings({ blacklistedApps })`
- Produces: 双模式独立列表编辑；文案「指定应用」

- [ ] **Step 1: 表单默认值与加载带上黑名单**

`empty` 增加 `blacklistedApps: []`。

所有从 `getSettings` / `saveSettings` 回填 `setForm` 处增加：

```ts
blacklistedApps: next.blacklistedApps ?? []
```

（`s` / `next` 按上下文替换。）

- [ ] **Step 2: 通用持久化 / 增删**

将仅服务白名单的逻辑泛化为按模式写入。推荐实现（可贴入文件，替换 `persistExcluded` / `addExcluded` / `removeExcluded`）：

```ts
  function activeAppList(f: AppSettings): ExcludedAppEntry[] {
    return f.selectionAppMode === 'selected' ? f.excludedApps : f.blacklistedApps
  }

  async function persistAppList(apps: ExcludedAppEntry[]): Promise<void> {
    const mode = form.selectionAppMode
    if (mode === 'selected') {
      setForm((f) => ({ ...f, excludedApps: apps }))
      try {
        const next = await window.translator.saveSettings({ excludedApps: apps })
        setForm((f) => ({ ...f, excludedApps: next.excludedApps ?? apps }))
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存应用列表失败')
      }
      return
    }
    setForm((f) => ({ ...f, blacklistedApps: apps }))
    try {
      const next = await window.translator.saveSettings({ blacklistedApps: apps })
      setForm((f) => ({ ...f, blacklistedApps: next.blacklistedApps ?? apps }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存应用列表失败')
    }
  }

  function addAppToActiveList(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    if (lower === 'electron' || lower === 'ai translator') {
      setError('不能添加本应用自身')
      return
    }
    const list = activeAppList(form)
    if (list.some((a) => a.name.toLowerCase() === lower)) {
      setError(form.selectionAppMode === 'selected' ? '该应用已在白名单中' : '该应用已在黑名单中')
      return
    }
    setError('')
    void persistAppList([...list, { name: trimmed, enabled: true }])
  }

  function removeAppFromActiveList(name: string): void {
    void persistAppList(activeAppList(form).filter((a) => a.name !== name))
  }
```

删除旧的 `persistExcluded` / `addExcluded` / `removeExcluded`（若仍被引用则改为调用上述函数）。

- [ ] **Step 3: 改模式按钮文案与 hint**

将模式选项改为：

```tsx
              ['all', '全部应用'],
              ['selected', '指定应用']
```

hint 改为：

```tsx
        <p className="hint">
          {form.selectionAppMode === 'all'
            ? '可在任意应用中划词（本应用除外）；下方黑名单中的应用将被排除。'
            : '仅在下方白名单中的应用可划词；添加即生效。'}
        </p>
```

- [ ] **Step 4: 两种模式都渲染列表编辑区**

将原先 `form.selectionAppMode === 'selected' ? ( ... ) : null` 改为**始终**渲染选择器 + chips（`all` 与 `selected` 都显示）。

绑定改为：

- 添加按钮：`onClick={() => addAppToActiveList(pickedApp)}`
- chips：`activeAppList(form).map(...)`
- 移除：`removeAppFromActiveList(item.name)`
- `aria-label`：selected 用「划词白名单」，all 用「划词黑名单」
- 空列表 hint：

```tsx
            ) : (
              <p className="hint">
                {form.selectionAppMode === 'selected'
                  ? '暂无白名单应用。添加后即可在对应应用中划词。'
                  : '暂无黑名单应用。添加后将在这些应用中禁用划词。'}
              </p>
            )}
```

下拉「全部应用」（应用来源）文案保持不变，避免与模式名混淆。

- [ ] **Step 5: 构建校验**

```bash
npm run build -w ai-translator-desktop
```

Expected: build 成功。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/pages/SettingsPage.tsx docs/feat/desktop-app-scope-blacklist/README.md
git commit -m "$(cat <<'EOF'
feat(Settings): 划词范围支持指定应用文案与全部应用黑名单

EOF
)"
```

---

### Task 5: 翻译小窗底部按钮固定

**Files:**
- Modify: `apps/desktop/electron/selection.ts`（`popupHtml` 内联 `<style>`，约 185–213 行）

**Interfaces:**
- Consumes: 现有 `.wrap` / `.text` / `.actions` 结构（HTML 结构不变）
- Produces: 长文时正文滚动、按钮贴窗底（对齐插件）

- [ ] **Step 1: 更新 CSS**

将 `popupHtml` 中相关规则替换为：

```css
  .wrap{padding:14px 16px 16px;height:100vh;overflow:hidden;display:flex;flex-direction:column}
  .status-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-shrink:0}
  .text{white-space:pre-wrap;word-break:break-word;flex:1;min-height:0;overflow:auto}
  .actions{margin-top:18px;display:flex;align-items:center;gap:10px;flex-shrink:0}
```

其余 `.link` / `.btn*` / 颜色变量保持不动。不要改 `BrowserWindow` 的 `width`/`height`。

- [ ] **Step 2: 静态确认片段存在**

```bash
rg -n "height:100vh|min-height:0|flex-shrink:0" apps/desktop/electron/selection.ts
```

Expected: `.wrap` 含 `height:100vh`；`.text` 含 `min-height:0` 与 `overflow:auto`；`.status-row` 与 `.actions` 含 `flex-shrink:0`。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/selection.ts docs/feat/desktop-app-scope-blacklist/README.md
git commit -m "$(cat <<'EOF'
fix(selection): 翻译小窗底部按钮固定贴底

EOF
)"
```

---

### Task 6: 回归核对

**Files:** 无新文件（验证用）

- [ ] **Step 1: 跑单元测试**

```bash
npm run test -w ai-translator-desktop
```

Expected: PASS。

- [ ] **Step 2: 再 build**

```bash
npm run build -w ai-translator-desktop
```

Expected: 成功。

- [ ] **Step 3: 手动清单（开发者本地 `npm run dev`）**

1. 设置 → 划词应用范围显示「全部应用 / 指定应用」
2. 全部应用下添加黑名单应用 A → 在 A 中划词不出现图标；在其它应用出现
3. 切到指定应用，白名单为空 → 任意应用不出现；添加 B → 仅 B 出现
4. 再切回全部应用 → 黑名单仍含 A（未丢）
5. 打开翻译小窗，粘贴很长译文 → 底部复制/润色/关闭仍可见，正文可滚

（若当前环境无法手动点 UI，在 commit message / PR 说明中标注「手动项待验」。）

- [ ] **Step 4: 若有遗漏修复则单独 commit；否则无需空提交**

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| `blacklistedApps` 独立字段 | Task 2 |
| `shouldSkipSelection` all+黑名单 / selected 白名单 | Task 1、3 |
| 「指定应用」文案 | Task 4 |
| 全部应用下黑名单 UI 同款 | Task 4 |
| 列表独立保留 | Task 2+4 |
| 空黑名单 = 旧 all | Task 1 测试 |
| 小窗按钮贴底 | Task 5 |
| 单元测 + 手动验 | Task 1、6 |
