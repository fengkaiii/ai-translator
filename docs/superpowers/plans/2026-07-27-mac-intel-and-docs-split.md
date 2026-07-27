# Mac Intel 双 DMG + README 拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release 同时产出 macOS arm64 / x64 两个独立 DMG，并更新 Actions；把根 README 拆成使用手册与 `docs/DEVELOPMENT.md` 技术文档。

**Architecture:** 在 electron-builder 的 `mac.target` 显式声明 `dmg`×`x64`+`arm64`；CI 单 `macos-latest` job 用 `--mac --x64 --arm64` 交叉编译（失败再回退双 runner，本计划首版只写注释/文档不启用）。文档按读者拆分：README 面向下载用户，DEVELOPMENT 面向开发者。

**Tech Stack:** electron-builder 25、Electron 39.8.0、GitHub Actions、npm workspaces

**Spec:** `docs/superpowers/specs/2026-07-27-mac-intel-and-docs-split-design.md`

## Global Constraints

- 产物：两个独立 DMG（`*-arm64.dmg` + `*-x64.dmg`），不要 Universal
- CI 首版：仅 `macos-latest` + `--mac --x64 --arm64`；不提前加 `macos-13` job
- 保持 `npmRebuild: false`
- 不改 Windows / Linux 打包目标与扩展 zip 流程
- 不做 Apple 签名 / 公证
- Commit message：`type(scope): 中文描述`；提交前同步 `docs/feat/mac-intel-support/README.md` 的 `## Commits`

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/desktop/package.json` | `dist:mac` 双架构参数；`build.mac.target` 显式 arch |
| `.github/workflows/release.yml` | mac matrix args；可选安装 `@cursor/sdk-darwin-x64`；回退说明注释 |
| `docs/DEVELOPMENT.md` | 新建：开发 / 打包 / CI / 发版排障 |
| `README.md` | 精简为简介 + 短架构 + 使用/安装手册 |

---

### Task 1: electron-builder 双架构配置

**Files:**
- Modify: `apps/desktop/package.json`（`scripts.dist:mac` 与 `build.mac`）

**Interfaces:**
- Consumes: 现有 `electron-builder` / `build.directories.output` → `../../release`
- Produces: `npm run dist:mac -w ai-translator-desktop` 一次产出 arm64 + x64 两个 dmg

- [ ] **Step 1: 修改 `dist:mac` 脚本**

将 `apps/desktop/package.json` 中：

```json
"dist:mac": "npm run build && electron-builder --mac",
```

改为：

```json
"dist:mac": "npm run build && electron-builder --mac --x64 --arm64",
```

根 `package.json` 的 `"dist:mac": "npm run dist:mac -w ai-translator-desktop"` **不要改**（已转发）。

- [ ] **Step 2: 修改 `build.mac.target`**

将同一文件中：

```json
"mac": {
  "target": [
    "dmg"
  ],
  "icon": "resources/icon.png",
  "category": "public.app-category.productivity"
},
```

改为：

```json
"mac": {
  "target": [
    {
      "target": "dmg",
      "arch": ["x64", "arm64"]
    }
  ],
  "icon": "resources/icon.png",
  "category": "public.app-category.productivity"
},
```

确认 `"npmRebuild": false` 仍在 `build` 下，不要改动。

- [ ] **Step 3: 校验 JSON 可解析**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/desktop/package.json','utf8')); const p=require('./apps/desktop/package.json'); const t=p.build.mac.target; if(!Array.isArray(t)||!t[0].arch||t[0].arch.join(',')!=='x64,arm64') process.exit(1); if(!p.scripts['dist:mac'].includes('--x64')||!p.scripts['dist:mac'].includes('--arm64')) process.exit(2); console.log('ok')"
```

Expected: 打印 `ok`，exit 0。

- [ ] **Step 4: Commit**

同步 `docs/feat/mac-intel-support/README.md` 的 `## Commits` 追加一行（日期当天、subject 与 commit 第一行一致），然后：

```bash
git add apps/desktop/package.json docs/feat/mac-intel-support/README.md
git commit -m "$(cat <<'EOF'
feat(desktop): mac 打包同时产出 arm64 与 x64 DMG

EOF
)"
```

---

### Task 2: GitHub Actions 双架构 mac 打包

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 1 的 `build.mac` / `--mac --x64 --arm64` 语义
- Produces: tag `v*` 时 mac job 上传两个 `.dmg`

- [ ] **Step 1: 更新 matrix mac 项**

将 `.github/workflows/release.yml` 中：

```yaml
          - os: macos-latest
            args: --mac
```

改为：

```yaml
          # 交叉编译 arm64+x64；若原生依赖失败，回退为：
          # - macos-latest + --mac --arm64
          # - macos-13 + --mac --x64
          - os: macos-latest
            args: --mac --x64 --arm64
```

- [ ] **Step 2: 在 mac 上补齐 `@cursor/sdk-darwin-x64`**

在「Install dependencies」（`npm ci`）之后、「Materialize translate-core…」之前，插入：

```yaml
      # arm64 runner 上 npm 通常只装 host optional；Intel 包需要 darwin-x64 预编译
      - name: Ensure Cursor SDK darwin-x64 optional
        if: runner.os == 'macOS'
        run: npm install --no-save --no-package-lock @cursor/sdk-darwin-x64@1.0.24
```

版本 `1.0.24` 须与当前 `apps/desktop` 依赖的 `@cursor/sdk` 一致（若日后升级 SDK，同步改此版本号）。

- [ ] **Step 3: 静态检查 workflow 含双架构参数**

Run:

```bash
grep -n 'args: --mac --x64 --arm64' .github/workflows/release.yml
grep -n 'sdk-darwin-x64@1.0.24' .github/workflows/release.yml
grep -n 'macos-13' .github/workflows/release.yml
```

Expected: 前两条各至少一行命中；第三条仅出现在注释里（`# - macos-13`），**不要**出现未注释的 `os: macos-13`。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml docs/feat/mac-intel-support/README.md
# 先在 docs/feat/mac-intel-support/README.md ## Commits 下追加当天条目
git commit -m "$(cat <<'EOF'
ci(release): mac 单 job 交叉编译 arm64 与 x64 DMG

EOF
)"
```

---

### Task 3: 拆分 README / 新建 DEVELOPMENT.md

**Files:**
- Create: `docs/DEVELOPMENT.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1–2 的双 DMG 与 CI 行为（文档需写准）
- Produces: 用户向 README + 开发向 DEVELOPMENT，互相链接

- [ ] **Step 1: 创建 `docs/DEVELOPMENT.md`**

写入完整内容（可直接用下面文本；实现时写成真实文件，勿保留外层围栏）：

````markdown
# 开发与发布

面向贡献者 / 维护者。最终用户请看根目录 [README.md](../README.md)。

## Monorepo 结构

- `apps/desktop` — Electron 桌面端（系统划词、Cursor `@cursor/sdk`）
- `apps/extension` — Chromium MV3（页内划词 + 整页翻译；DeepSeek 直连，Cursor 经桌面 Native Messaging 代理）
- `packages/translate-core` — 共享类型、prompt、DeepSeek client、整页分块

## 本地开发

```bash
npm install
npm run dev                 # 桌面端 Electron
npm run build:extension     # 浏览器扩展 → apps/extension/dist
npm test                    # translate-core 单测
```

扩展加载：Chrome / Edge → 扩展程序 → 加载已解压的扩展程序 → 选 `apps/extension/dist`。使用 Cursor 厂商前请先 `npm run dev` 启动桌面端。

### macOS 开发态辅助功能

划词依赖辅助功能。开发模式请在 **系统设置 → 隐私与安全性 → 辅助功能** 中添加：

`node_modules/electron/dist/Electron.app`

可在设置页点击「在 Finder 中显示 Electron.app」快速定位。

## 本地打包

```bash
npm run dist        # 当前平台
npm run dist:mac    # 同时产出 arm64 + x64 两个 .dmg（Apple Silicon 上交叉编译 Intel）
npm run dist:win    # .exe
npm run dist:linux  # .deb
```

产物目录：仓库根下 `release/`。

macOS 期望文件名示例：

- `AI Translator-<version>-arm64.dmg`
- `AI Translator-<version>-x64.dmg`

`apps/desktop` 的 `build.npmRebuild` 为 `false`，依赖预编译原生二进制；`@cursor/sdk` 的平台 optional 包需在目标架构齐全（CI 会在 mac job 显式安装 `@cursor/sdk-darwin-x64`）。

## GitHub Actions 发布

仓库：https://github.com/fengkaiii/ai-translator

```bash
# 代码已在默认分支后打 tag
git tag vX.Y.Z
git push origin vX.Y.Z
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会：

1. **macOS**（`macos-latest`）：`electron-builder --mac --x64 --arm64` → 两个 DMG
2. **Windows**（`windows-2022`）：`.exe`
3. **Linux**（`ubuntu-latest`）：`.deb`
4. **扩展**（Ubuntu，独立 job）：`ai-translator-extension-<version>.zip`

上述产物上传到同一 GitHub Release。

### 交叉编译回退

若 mac 交叉编译因原生模块失败，将 release workflow 的 mac matrix 改为两行（并去掉单行双 arch args）：

| os | args |
|----|------|
| `macos-latest` | `--mac --arm64` |
| `macos-13` | `--mac --x64` |

上传步骤仍匹配 `release/*.dmg`，扩展 job 无需改动。

### 排障：Release 没有 Assets

常见原因：该 tag 已有一个空的已发布 Release，与草稿类型冲突。删除该 Release 后重新推 tag（或手动重跑 workflow）即可。

### 本地发布（当前平台）

```bash
export GH_TOKEN=你的_GitHub_PAT   # 需要 repo 权限
npm run release
```

注意：本地 `release` 脚本不会自动打双架构；双架构请用 `npm run dist:mac` 或依赖 Actions。
````

- [ ] **Step 2: 重写根 `README.md`**

替换为面向用户的手册（保留项目名与仓库链接；去掉开发/dist/Actions 细节）：

````markdown
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
````

- [ ] **Step 3: 抽查文档交叉链接与双 DMG 说明**

Run:

```bash
grep -n 'DEVELOPMENT.md' README.md
grep -n 'README.md' docs/DEVELOPMENT.md
grep -n 'arm64' README.md docs/DEVELOPMENT.md
grep -n 'x64' README.md docs/DEVELOPMENT.md
grep -n 'macos-13' docs/DEVELOPMENT.md
test ! -n "$(grep -E 'npm run dist|npm run dev|Actions' README.md || true)" || grep -E 'npm run dist|npm run dev|\.github/workflows' README.md && echo 'WARN: tech commands still in README' || echo 'README user-facing ok'
```

Expected: README 与 DEVELOPMENT 互相引用；两边都提到 arm64/x64；DEVELOPMENT 含回退 `macos-13`；README **不应**再出现 `npm run dist` / `npm run dev` / workflow 路径（若 `grep` 打出 WARN，删掉残留技术段）。

- [ ] **Step 4: Commit**

```bash
git add README.md docs/DEVELOPMENT.md docs/feat/mac-intel-support/README.md
git commit -m "$(cat <<'EOF'
docs(readme): 拆分使用手册与开发发布文档

EOF
)"
```

---

### Task 4: 本地验证双 DMG（可选但推荐）

**Files:** 无代码改动；验证 Task 1 产物

**说明:** 完整 `dist:mac` 较慢且下载 Electron 双架构二进制。若本机是 macOS 且有时间，执行本任务；否则在 PR 说明中写明「依赖下一次 `v*` tag 的 Actions 验证」，并跳过 Step 1–2，直接做 Step 3 的配置回归检查。

- [ ] **Step 1（可选）: 运行双架构打包**

Run:

```bash
npm run dist:mac
```

Expected: 命令成功结束（exit 0）。

- [ ] **Step 2（可选）: 确认产物**

Run:

```bash
ls -la release/*.dmg
node -e "const fs=require('fs');const v=require('./apps/desktop/package.json').version;const a=\`release/AI Translator-\${v}-arm64.dmg\`;const x=\`release/AI Translator-\${v}-x64.dmg\`;for (const f of [a,x]){if(!fs.existsSync(f)){console.error('missing',f);process.exit(1)}} console.log('both dmgs ok')"
```

Expected: 两个 dmg 均存在；打印 `both dmgs ok`。

- [ ] **Step 3: 配置回归（必做）**

Run:

```bash
node -e "const p=require('./apps/desktop/package.json'); console.log(p.scripts['dist:mac']); console.log(JSON.stringify(p.build.mac.target))"
grep 'args: --mac --x64 --arm64' .github/workflows/release.yml
test -f docs/DEVELOPMENT.md && test -f README.md && echo docs_ok
```

Expected: 脚本含 `--x64 --arm64`；target JSON 含两 arch；workflow 命中；`docs_ok`。

- [ ] **Step 4: 若 Task 4 无新文件改动则无需 commit**；若本地打包产生了 `release/` 产物，**不要**把 `release/*.dmg` 提交进 git。

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 双独立 DMG arm64+x64 | Task 1, 4 |
| Actions 上传双 DMG | Task 2 |
| CI 首版交叉编译 + 文档回退 | Task 2 注释 + Task 3 DEVELOPMENT |
| 保持 npmRebuild false | Task 1 |
| README 使用向 + DEVELOPMENT 技术向 | Task 3 |
| 不做 Universal / 签名 / 改 WinLinux | 全任务未涉及 |

## Placeholder scan

无 TBD/TODO；步骤含具体 JSON/YAML/Markdown 与命令。
