#!/usr/bin/env bash
# 提交当前分支 → 推送到远程
set -euo pipefail

REMOTE="${REMOTE:-origin}"
COMMIT_MSG="${1:-}"

ORIGINAL_BRANCH="$(git branch --show-current)"

if [[ "$ORIGINAL_BRANCH" == "test" || "$ORIGINAL_BRANCH" == "main" ]]; then
  echo "错误: 当前在 ${ORIGINAL_BRANCH} 分支，请先确认是否应直接在集成分支上操作"
  exit 1
fi

echo "==> 当前分支: ${ORIGINAL_BRANCH}"

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

echo "==> 推送完成"
git status -sb
