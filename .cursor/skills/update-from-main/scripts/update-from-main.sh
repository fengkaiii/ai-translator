#!/usr/bin/env bash
# 拉取 main 最新代码 → 合并到当前分支
set -euo pipefail

SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
REMOTE="${REMOTE:-origin}"

ORIGINAL_BRANCH="$(git branch --show-current)"

if [[ "$ORIGINAL_BRANCH" == "$SOURCE_BRANCH" ]]; then
  echo "错误: 当前已在 ${SOURCE_BRANCH} 分支，无需将 ${SOURCE_BRANCH} 合并到自己"
  exit 1
fi

echo "==> 当前分支: ${ORIGINAL_BRANCH}"
echo "==> 从 ${REMOTE}/${SOURCE_BRANCH} 更新"

git fetch "$REMOTE" "$SOURCE_BRANCH"

if ! git merge "${REMOTE}/${SOURCE_BRANCH}"; then
  echo ""
  echo "错误: 合并冲突，请手动解决后执行:"
  echo "  git merge --continue"
  echo "或回退:"
  echo "  git merge --abort"
  exit 1
fi

echo "==> 已合并 ${REMOTE}/${SOURCE_BRANCH}"
git status -sb
