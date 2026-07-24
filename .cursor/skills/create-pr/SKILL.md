---
name: create-pr
description: >-
  从 main 同步代码、提交推送当前分支、创建指向 main 的 PR。Use when the user
  invokes /create-pr, asks to create a PR, open pull request, or
  says 创建PR、提PR. 用户明确要求合并时再执行 gh pr merge.
disable-model-invocation: true
---
# 创建 PR

将当前分支与 `main` 同步后提交推送，在 GitHub 创建指向 `main` 的 PR。**默认只创建 PR，不自动合并**；用户明确要求「合并 PR」「合并到 main」时再执行 `gh pr merge`。

## 前置检查

并行执行：

```bash
git branch --show-current
git status
git diff
git diff --cached
git log main..HEAD --oneline
git remote -v
git status -sb
```

确认：

- 当前分支不是 `main`（在 `main` 上先询问用户）
- 远程为 `origin`，目标分支为 `main`
- 已安装并登录 `gh`（`gh auth status`）
- 工作区改动符合用户预期
- 创建 PR 前须通过异常 commit 检测（不得含合并自 `test` / `staging` 的提交）

## 工作流

```
当前分支 (feature)
  → commit（如有改动）
  → fetch & merge origin/main
  → push origin feature
  → 检测异常 commit（禁止合并自 test/staging）
  → gh pr create --base main
  → 保持当前分支（不自动 merge）
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

### Step 2: 从 main 同步到当前分支

创建 PR 前**必须先**将 `main` 最新代码合并到当前分支：

```bash
git fetch origin main
git merge origin/main -m "chore(merge): 从 main 同步到 $ORIGINAL_BRANCH"
```

- merge 冲突：**停止**，不要擅自解决；报告冲突文件与 `git status` 摘要
- 告知用户解决后执行 `git merge --continue` 或 `git merge --abort`，再重新执行本 skill

### Step 3: 推送当前分支

```bash
git push -u origin "$ORIGINAL_BRANCH"
```

push 失败时 **不要** force push；先 `git pull --rebase origin "$ORIGINAL_BRANCH"`，解决冲突后再 push。

### Step 4: 异常 commit 检测（创建 PR 前必做）

基于 `origin/main..HEAD` 检测是否误把 `test` / `staging` 合进功能分支。**任一命中则禁止创建 PR**（已有 open PR 时同样禁止继续合并）。

```bash
git fetch origin main
git fetch origin test staging 2>/dev/null || true
BASE_REF=origin/main
```

检测项：

1. **merge commit message**：subject 像合并自 `test` / `staging`（含 `origin/test`、`origin/staging`）；**只扫 `--merges`**，避免误伤普通说明性 commit
2. **merge 第二父提交**：`merge^2` 是 `origin/test` 或 `origin/staging` 的祖先，且**不是** `origin/main` 的祖先

示例命令（Agent / 脚本需实际执行）：

```bash
# 仅检查 merge commits 的 message，命中则拦截
git log --merges origin/main..HEAD --format='%h %s' \
  | grep -Ei \
    -e "Merge (branch|remote-tracking branch) ['\"]?(origin/)?(test|staging)(['\"]|/| |$)" \
    -e "merge:.*from ['\"]?(origin/)?(test|staging)(['\"]| |$)" \
    -e "从 ['\"]?(origin/)?(test|staging)['\"]? (同步|合并)" \
    -e "合并(了)?(分支 |remote-tracking branch )?['\"]?(origin/)?(test|staging)(['\"]| |$)" \
  && echo "BLOCKED"

# merge 第二父落在 test/staging
git rev-list --merges origin/main..HEAD | while read -r m; do
  p2=$(git rev-parse "$m^2")
  for f in test staging; do
    if git rev-parse --verify "origin/$f" >/dev/null 2>&1 \
      && git merge-base --is-ancestor "$p2" "origin/$f" \
      && ! git merge-base --is-ancestor "$p2" origin/main; then
      echo "BLOCKED $m (^2 ⊆ origin/$f)"
    fi
  done
done
```

命中时：**停止**，列出命中 commit，提示先去掉对 `test`/`staging` 的合并后再重试。不要创建 PR、不要合并。

### Step 5: 创建 PR

先检查是否已有 open PR：

```bash
gh pr list --head "$ORIGINAL_BRANCH" --base main --state open
```

**已有 PR**：记录 PR 编号/URL，跳到完成报告（仍须已通过 Step 4）。

**无 PR**：根据 `git log main..HEAD` 和 diff 起草 title 与 body，然后创建：

```bash
gh pr create --base main --head "$ORIGINAL_BRANCH" --title "<title>" --body "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] ...
EOF
)"
```

PR title 优先用最新 commit message 或概括本次改动。

### Step 6: 合并 PR（仅用户明确要求时）

**默认不执行本步骤。** 仅当用户明确说「合并 PR」「合并到 main」等时才执行：

```bash
gh pr merge --merge
```

- 默认使用 **merge commit**（与仓库 `Merge pull request #N` 历史一致）
- 用户明确要求 squash 时用 `gh pr merge --squash`
- **不要** `--delete-branch`，保留功能分支

若 CI 未通过或 branch protection 阻止合并：**停止**，报告 `gh pr checks` 结果，不要强行合并。

### Step 7: 同步本地信息（可选）

创建 PR 后留在原分支，可选更新远程引用：

```bash
git fetch origin main
git status -sb
```

## 一键脚本（可选）

PR title/body 与 commit message 已确认时：

```bash
bash .cursor/skills/create-pr/scripts/create-pr.sh \
  "<commit message>" \
  "<pr title>" \
  "<pr body file or -> heredoc>"
```

无改动需提交时，commit message 传空字符串 `""`。

脚本在 `gh pr create` 前会执行与 Step 4 相同的异常 commit 检测；命中则直接退出。

## 冲突与异常

| 情况 | 处理 |
|------|------|
| 合并 main 冲突 | 停止，报告冲突文件；用户解决后 `git merge --continue` 再重试 |
| 异常 commit（合并了 test/staging） | 停止，列出命中项；去掉错误合并后再重试 |
| PR 合并冲突 | 停止，报告 `gh pr view`，让用户在 GitHub 或本地 rebase 后重试（仅用户要求合并时） |
| 已有 merged PR | 告知已合并，无需重复创建 |
| `gh` 未登录 | 提示运行 `gh auth login` |
| push 被拒 | rebase 后重推，禁止 force push |

## 安全规则

- **禁止** `git push --force` / `--force-with-lease`（除非用户明确要求）
- **禁止** `git reset --hard`、`git clean -fdx` 等破坏性命令
- **禁止** 修改 git config
- 不要跳过 pre-commit hook（`--no-verify`）
- diff 含无关文件时先询问用户
- 远端 CI / branch protection 仍可能阻止合并，需按检查结果处理（仅用户要求合并时）
- **禁止**在检测到合并自 `test` / `staging` 的异常 commit 时创建 PR

## 完成报告

简要汇报：

- 原分支名、commit SHA（如有）
- 是否已从 `main` 同步
- 异常 commit 检测结果
- PR URL
- 当前所在分支
- 若用户要求合并：合并方式、合并结果
