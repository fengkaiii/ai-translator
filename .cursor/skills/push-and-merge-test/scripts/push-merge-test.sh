#!/usr/bin/env bash
# 提交当前分支 → 推送 → 合并到 test → 推送 test → 切回原分支
set -euo pipefail

TARGET_BRANCH="${TARGET_BRANCH:-test}"
REMOTE="${REMOTE:-origin}"
COMMIT_MSG="${1:-}"

ORIGINAL_BRANCH="$(git branch --show-current)"

if [[ "$ORIGINAL_BRANCH" == "$TARGET_BRANCH" ]]; then
  echo "错误: 当前已在 ${TARGET_BRANCH} 分支，请先切到功能分支"
  exit 1
fi

echo "==> 原分支: ${ORIGINAL_BRANCH}"

# 有改动则提交
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  if [[ -z "$COMMIT_MSG" ]]; then
    echo "错误: 存在未提交改动，请提供 commit message"
    echo "用法: $0 \"fix(模块): 描述\""
    exit 1
  fi
  git add -A
  git commit -m "$COMMIT_MSG"
  echo "==> 已提交"
else
  echo "==> 无未提交改动，跳过 commit"
fi

echo "==> 推送 ${ORIGINAL_BRANCH}"
git push -u "$REMOTE" "$ORIGINAL_BRANCH"

echo "==> 合并到 ${TARGET_BRANCH}"
git fetch "$REMOTE" "$TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git pull "$REMOTE" "$TARGET_BRANCH"

if ! git merge "$ORIGINAL_BRANCH" -m "merge: ${ORIGINAL_BRANCH} into ${TARGET_BRANCH}"; then
  echo ""
  echo "错误: 合并冲突，请手动解决后执行:"
  echo "  git merge --continue && git push ${REMOTE} ${TARGET_BRANCH} && git checkout ${ORIGINAL_BRANCH}"
  exit 1
fi

git push "$REMOTE" "$TARGET_BRANCH"
echo "==> 已推送 ${TARGET_BRANCH}"

git checkout "$ORIGINAL_BRANCH"
echo "==> 已切回 ${ORIGINAL_BRANCH}"
git status -sb
