---
name: push-and-merge-test
description: >-
  提交当前分支、推送到远程、合并到 test 并推送，最后切回原分支。Use when the user asks
  to commit and push current branch, merge to test, deploy to test, or says
  提交推送合并test、推到test、合并到test.
---
# 提交推送并合并到 test

将当前功能分支的改动提交推送，合并到 `test` 分支并推送，最后切回原分支。

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

- 当前分支不是 `test` / `main`（若在 `test`，先询问用户是否继续）
- 工作区改动符合用户预期
- 远程名默认为 `origin`，目标集成分支为 `test`

## 工作流

```
当前分支 (feature)
  → commit（如有改动）
  → push origin feature
  → checkout test
  → pull origin test
  → merge feature
  → push origin test
  → checkout feature
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

若无改动可提交，跳过 commit，继续 push / merge。

### Step 2: 推送当前分支

```bash
git push -u origin "$ORIGINAL_BRANCH"
```

若远程已有更新导致 push 失败，**不要** force push；先 `git pull --rebase origin "$ORIGINAL_BRANCH"`，解决冲突后再 push。

### Step 3: 合并到 test 并推送

```bash
git fetch origin test
git checkout test
git pull origin test
git merge "$ORIGINAL_BRANCH" -m "merge: $ORIGINAL_BRANCH into test"
git push origin test
```

### Step 4: 切回原分支

```bash
git checkout "$ORIGINAL_BRANCH"
git status
```

## 一键脚本（可选）

message 已确认时，可直接执行：

```bash
bash ~/.cursor/skills/push-and-merge-test/scripts/push-merge-test.sh "<commit message>"
```

无改动需提交时省略 message：

```bash
bash ~/.cursor/skills/push-and-merge-test/scripts/push-merge-test.sh
```

## 冲突处理

- merge 冲突：**停止**，不要擅自解决
- 报告冲突文件，给出 `git status` 摘要
- 告知用户解决后执行 `git merge --continue` 或 `git merge --abort`
- 若已 abort，切回 `$ORIGINAL_BRANCH`

## 安全规则

- **禁止** `git push --force` / `--force-with-lease`（除非用户明确要求）
- **禁止** `git reset --hard`、`git clean -fdx` 等破坏性命令
- **禁止** 修改 git config
- 不要跳过 pre-commit hook（`--no-verify`）
- 仅提交当前任务相关改动；若 diff 含无关文件，先询问用户

## 完成报告

简要汇报：

- 原分支名、commit SHA（如有）
- test 合并结果、push 是否成功
- 当前所在分支
