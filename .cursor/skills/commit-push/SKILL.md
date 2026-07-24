---
name: commit-push
description: >-
  提交当前分支代码并推送到远程。Use when the user invokes /commit-push, asks to
  commit and push current branch, push current branch, 提交并推送、提交当前分支、推送当前分支.
disable-model-invocation: true
---
# 提交并推送当前分支

将当前分支的改动提交并推送到远程，不执行合并到 `test` 或 `main`。

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

- 当前分支不是 `test` / `main`（若在这些集成分支上，先询问用户是否继续）
- 工作区改动符合用户预期
- 远程名默认为 `origin`

## 工作流

```
当前分支 (feature)
  → commit（如有改动）
  → push origin feature
  → 保持当前分支
```

### Step 1: 记录原分支并提交

```bash
ORIGINAL_BRANCH=$(git branch --show-current)
```

若有未提交改动：

1. 根据 `git diff` 起草 commit message，遵循仓库风格（如 `fix(模块): 描述`）
2. 展示 message 给用户确认；用户已给出 message 则直接用
3. 暂存并提交：

```bash
git add -A
git commit -m "$(cat <<'EOF'
<commit message>
EOF
)"
```

若无改动可提交，则跳过 commit，直接执行 push。

### Step 2: 推送当前分支

```bash
git push -u origin "$ORIGINAL_BRANCH"
```

若远程已有更新导致 push 失败，**不要** force push；先 `git pull --rebase origin "$ORIGINAL_BRANCH"`，解决冲突后再 push。

### Step 3: 检查结果

```bash
git status
```

## 一键脚本（可选）

message 已确认时，可直接执行：

```bash
bash .cursor/skills/commit-push/scripts/commit-push.sh "<commit message>"
```

无改动需提交时可省略 message：

```bash
bash .cursor/skills/commit-push/scripts/commit-push.sh
```

## 冲突处理

- rebase / push 冲突：**停止**，不要擅自解决
- 报告冲突文件，给出 `git status` 摘要
- 告知用户解决后继续 `git rebase --continue` 或 `git rebase --abort`

## 安全规则

- **禁止** `git push --force` / `--force-with-lease`（除非用户明确要求）
- **禁止** `git reset --hard`、`git clean -fdx` 等破坏性命令
- **禁止** 修改 git config
- 不要跳过 pre-commit hook（`--no-verify`）
- 仅提交当前任务相关改动；若 diff 含无关文件，先询问用户

## 完成报告

简要汇报：

- 原分支名、commit SHA（如有）
- push 是否成功
- 当前所在分支
