---
name: create-branch
description: >-
  根据中文需求描述自动生成分支名（或直接使用已给分支名），创建功能分支、
  初始化 docs/<branch>/README.md（顶部为需求描述）并自增 package.json 版本号。
  Use when the user invokes /create-branch, asks to create a new branch,
  创建分支、新建分支、开分支.
disable-model-invocation: true
---

# 创建分支

用户通过 `/create-branch $message` 创建分支。`$message` 可以是：

1. **中文需求描述** → 自动生成英文 kebab-case 分支名
2. **已是合法分支名** → 直接使用，不再改写

完成后自动：

1. 解析 `$message` → 得到 `BRANCH_NAME` + `REQUIREMENT`（需求描述）
2. 基于 `main` 创建并切换到新分支
3. 写入 `docs/<分支名>/README.md`（**文件顶部为需求描述**）
4. 根目录与 `apps/desktop`、`apps/extension`（含 `manifest.json`）的 `version` 修订号同步 +1，并提交

## 解析 $message

去除首尾空白后判断：

| 判定为「分支名」 | 判定为「需求描述」 |
|---|---|
| 仅含 `[A-Za-z0-9._/-]`，无空格、无中文 | 含中文、空格、或明显是一句话 |
| 例：`feat/receipt-notice`、`fix/login-bug` | 例：`优化入账通知列表筛选` |

### 分支名 → 直接创建

```text
BRANCH_NAME = $message
REQUIREMENT = $message   # 无额外描述时，用分支名作为占位需求
```

### 需求描述 → 自动生成分支名

由 Agent 根据语义生成，规则：

- 前缀：功能用 `feat/`，修复用 `fix/`，重构用 `refactor/`，文档/杂项用 `chore/`；不确定时默认 `feat/`
- 主体：英文 kebab-case，简短（建议 ≤ 40 字符，不含前缀）
- 全小写；单词用 `-` 连接；不要拼音堆砌过长句子
- 生成后向用户**简要确认**分支名（一行即可）；用户已明确说「直接创建」或 message 本身已是分支名时，可跳过确认

示例：

| 输入 | 生成分支名 |
|---|---|
| 优化入账通知列表筛选 | `feat/receipt-notice-filter` |
| 修复登录页白屏 | `fix/login-blank-screen` |
| feat/foo-bar | `feat/foo-bar`（直接用） |

```text
BRANCH_NAME = <生成结果>
REQUIREMENT = <原始 $message 全文>
```

## 前置检查

并行执行：

```bash
git branch --show-current
git status
git diff
git diff --cached
git log -5 --oneline
node -p "require('./package.json').version"
```

确认：

- `$message` 非空
- `BRANCH_NAME` 符合 git 规范（无空格、`~^:?*[\` 等非法字符）
- 本地不存在同名分支（`git show-ref --verify --quiet refs/heads/<branch>` 应失败）
- 远程不存在同名分支（`git ls-remote --heads origin <branch>` 应无输出）
- 新分支**始终基于 `main`** 创建，与当前所在分支无关
- 工作区无未提交改动；若有，先 stash 或提交，不要带着脏工作区切分支

## 工作流

```
任意当前分支
  → 解析 $message（分支名 or 中文描述）
  → fetch & checkout main（拉取最新）
  → git checkout -b <branch>
  → 写入 docs/<branch>/README.md（顶部=需求描述）
  → 根 / desktop / extension（含 manifest）version 同步修订号 +1
  → commit 版本与 docs 初始化
```

### Step 1: 同步 main 并创建分支

```bash
ORIGINAL_BRANCH="$(git branch --show-current)"

git fetch origin main
git checkout main
git pull --ff-only origin main
git checkout -b "$BRANCH_NAME"
```

### Step 2: 初始化 docs 目录

**生成规范**：分支文档入口固定为：

```text
docs/<分支名>/README.md
```

```bash
mkdir -p "docs/${BRANCH_NAME}"
```

`docs/<branch>/README.md` 模板（**顶部为需求描述**；必须含 `## Commits`）：

```markdown
# 需求

<REQUIREMENT>

## 分支信息

- 分支: <BRANCH_NAME>
- 创建时间: <ISO 日期>
- 初始版本: <新版本号>

## Commits

```

说明：

- `# 需求` 下方第一段写完整需求描述（用户原始中文或分支名占位）
- 不要把需求描述塞进 `## Commits`
- `## Commits` 留给后续 commit 同步规则写入

### Step 3: 自增 package.json version

同步修改以下文件的 `version` 字段：修订号（第三段）+1（以根目录当前版本为准）：

- `package.json`
- `apps/desktop/package.json`
- `apps/extension/package.json`
- `apps/extension/manifest.json`

示例：`0.0.26` → `0.0.27`

```bash
NEW_VERSION=$(node -e "
const fs = require('fs');
const paths = [
  'package.json',
  'apps/desktop/package.json',
  'apps/extension/package.json',
  'apps/extension/manifest.json'
];
let next = null;
for (const p of paths) {
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!pkg.version) continue;
  const parts = String(pkg.version).split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    console.error('version 格式须为 x.y.z: ' + p);
    process.exit(1);
  }
  if (next == null) {
    parts[2] += 1;
    next = parts.join('.');
  }
  pkg.version = next;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(next);
")
```

### Step 4: 提交初始化改动

```bash
git add package.json apps/desktop/package.json apps/extension/package.json apps/extension/manifest.json "docs/${BRANCH_NAME}/"
git commit -m "$(cat <<EOF
chore: init branch ${BRANCH_NAME} (v${NEW_VERSION})
EOF
)"
```

## 一键脚本

`BRANCH_NAME` 与 `REQUIREMENT` 已确认后，在项目根目录执行：

```bash
bash .cursor/skills/create-branch/scripts/create-branch.sh "<branch-name>" "<requirement>"
```

第二个参数为需求描述；省略时用分支名作为需求占位。

中文 → 英文分支名由 Agent 完成后再调用脚本，**不要**指望脚本翻译中文。

## 冲突与异常

- `main` 拉取 fast-forward 失败：**停止**，不要 force pull；报告 `git status` 摘要，请用户先处理 `main`
- 创建分支后保持在**新分支**上，不自动切回 `ORIGINAL_BRANCH`
- 生成的分支名与已有分支冲突：在主体后追加短后缀（如 `-2`）或请用户改名，不要覆盖

## 安全规则

- **禁止** `git push --force` / `--force-with-lease`（除非用户明确要求）
- **禁止** `git reset --hard`、`git clean -fdx` 等破坏性命令
- **禁止** 修改 git config
- 不要跳过 pre-commit hook（`--no-verify`）
- 同步修改根目录、`apps/desktop`、`apps/extension` 的 `package.json` 与扩展 `manifest.json` 的 `version`
- 不要修改用户未要求的其他文件

## 完成报告

简要汇报：

- 输入类型（需求描述 / 分支名）、最终分支名
- 基于 `main` 创建（创建前自 `origin/main` 拉取最新）
- `docs/<branch>/README.md` 是否已写入需求描述
- 版本变更（旧 → 新）与 commit SHA
- 当前所在分支
