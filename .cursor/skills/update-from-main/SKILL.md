---
name: update-from-main
description: >-
  将 main 分支最新代码合并到当前分支。Use when the user asks to update current
  branch from main, merge main into current branch, 同步main、从main更新当前分支、合并main到当前分支.
disable-model-invocation: true
---
# 从 main 更新当前分支

将 `main` 的最新代码合并到当前分支，用于同步主干更新，不推送到远程。

## 前置检查

并行执行：

```bash
git branch --show-current
git status
git diff
git diff --cached
git log -5 --oneline
```

确认：

- 当前分支不是 `main`
- 工作区改动符合用户预期
- 远程名默认为 `origin`，源分支为 `main`

## 工作流

```
当前分支 (feature)
  → fetch origin main
  → merge origin/main
  → 保持当前分支
```

### Step 1: 记录当前分支

```bash
ORIGINAL_BRANCH=$(git branch --show-current)
```

若当前就在 `main`，先询问用户是否仍要继续。

### Step 2: 拉取 main 最新引用并合并

```bash
git fetch origin main
git merge origin/main
```

若仓库习惯要求显式 merge message，可使用：

```bash
git merge origin/main -m "merge: update $ORIGINAL_BRANCH from main"
```

### Step 3: 检查结果

```bash
git status
git log --oneline -5
```

## 一键脚本（可选）

可直接执行：

```bash
bash ~/.cursor/skills/update-from-main/scripts/update-from-main.sh
```

该脚本只负责从 `main` 同步到当前分支，不会自动 push。

## 冲突处理

- merge 冲突：**停止**，不要擅自解决
- 报告冲突文件，给出 `git status` 摘要
- 告知用户解决后执行 `git merge --continue` 或 `git merge --abort`
- `merge --abort` 后保持在原分支

## 安全规则

- **禁止** `git push --force` / `--force-with-lease`（除非用户明确要求）
- **禁止** `git reset --hard`、`git clean -fdx` 等破坏性命令
- **禁止** 修改 git config
- 不要跳过 pre-commit hook（`--no-verify`）
- diff 含无关文件时先询问用户

## 完成报告

简要汇报：

- 当前分支名
- 是否成功合并 `origin/main`
- 当前工作区状态
