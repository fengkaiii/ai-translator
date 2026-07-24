#!/usr/bin/env bash
# 提交推送当前分支 → 创建 PR 到 main（默认不合并）
set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
COMMIT_MSG="${1:-}"
PR_TITLE="${2:-}"
PR_BODY="${3:-}"

ORIGINAL_BRANCH="$(git branch --show-current)"

if [[ "$ORIGINAL_BRANCH" == "$BASE_BRANCH" ]]; then
  echo "错误: 当前已在 ${BASE_BRANCH} 分支，请先切到功能分支"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "错误: 未找到 gh CLI，请先安装并登录 (gh auth login)"
  exit 1
fi

echo "==> 原分支: ${ORIGINAL_BRANCH}"

# 有改动则提交
has_changes=false
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  has_changes=true
fi

if $has_changes; then
  if [[ -z "$COMMIT_MSG" ]]; then
    echo "错误: 存在未提交改动，请提供 commit message"
    echo "用法: $0 \"fix(模块): 描述\" \"PR title\" \"PR body\""
    exit 1
  fi
  git add -A
  git commit -m "$COMMIT_MSG"
  echo "==> 已提交"
else
  echo "==> 无未提交改动，跳过 commit"
fi

echo "==> 同步 ${BASE_BRANCH} 到当前分支"
git fetch "$REMOTE" "$BASE_BRANCH"
if ! git merge "${REMOTE}/${BASE_BRANCH}" -m "chore(merge): 从 ${BASE_BRANCH} 同步到 ${ORIGINAL_BRANCH}"; then
  echo ""
  echo "错误: 合并 ${BASE_BRANCH} 冲突，请手动解决后执行:"
  echo "  git merge --continue"
  echo "  或 git merge --abort"
  exit 1
fi

echo "==> 推送 ${ORIGINAL_BRANCH}"
git push -u "$REMOTE" "$ORIGINAL_BRANCH"

echo "==> 检测异常 commit（禁止合并自 test / staging）"
git fetch "$REMOTE" "$BASE_BRANCH"
BASE_REF="${REMOTE}/${BASE_BRANCH}"
# 尽量拉取集成分支，供祖先检测（不存在则跳过该分支）
git fetch "$REMOTE" test staging 2>/dev/null || true

ABNORMAL_HITS=()

# 1) merge commit 的 message：合并自 test / staging（仅检查 merge commits，避免误伤普通说明）
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  ABNORMAL_HITS+=("message: ${line}")
done < <(
  git log --merges "${BASE_REF}"..HEAD --format='%h %s' \
    | grep -Ei \
      -e "Merge (branch|remote-tracking branch) ['\"]?(origin/)?(test|staging)(['\"]|/| |$)" \
      -e "merge:.*from ['\"]?(origin/)?(test|staging)(['\"]| |$)" \
      -e "从 ['\"]?(origin/)?(test|staging)['\"]? (同步|合并)" \
      -e "合并(了)?(分支 |remote-tracking branch )?['\"]?(origin/)?(test|staging)(['\"]| |$)" \
    || true
)

# 2) merge commit 第二父提交落在 test/staging 且不在 main 上
while IFS= read -r merge_sha; do
  [[ -z "$merge_sha" ]] && continue
  second_parent="$(git rev-parse "${merge_sha}^2" 2>/dev/null || true)"
  [[ -z "$second_parent" ]] && continue
  short="$(git rev-parse --short "$merge_sha")"
  subject="$(git log -1 --format='%s' "$merge_sha")"
  for forbidden in test staging; do
    if git rev-parse --verify "${REMOTE}/${forbidden}" >/dev/null 2>&1; then
      if git merge-base --is-ancestor "$second_parent" "${REMOTE}/${forbidden}" \
        && ! git merge-base --is-ancestor "$second_parent" "${BASE_REF}"; then
        ABNORMAL_HITS+=("merge-parent: ${short} ${subject} (^2 ⊆ origin/${forbidden})")
      fi
    fi
  done
done < <(git rev-list --merges "${BASE_REF}"..HEAD)

if ((${#ABNORMAL_HITS[@]} > 0)); then
  echo ""
  echo "错误: 检测到异常 commit，已禁止创建 PR（疑似合并了 test 或 staging）"
  echo "当前分支: ${ORIGINAL_BRANCH}"
  echo "对比基线: ${BASE_REF}"
  echo "命中项:"
  for hit in "${ABNORMAL_HITS[@]}"; do
    echo "  - ${hit}"
  done
  echo "请从功能分支移除对 test/staging 的合并后再重试"
  exit 1
fi

echo "==> 异常 commit 检测通过"

# 查找已有 open PR
EXISTING_PR="$(gh pr list --head "$ORIGINAL_BRANCH" --base "$BASE_BRANCH" --state open --json number,url -q '.[0].number // empty')"

if [[ -n "$EXISTING_PR" ]]; then
  echo "==> 已有 open PR #${EXISTING_PR}"
  PR_NUM="$EXISTING_PR"
else
  if [[ -z "$PR_TITLE" ]]; then
    PR_TITLE="${COMMIT_MSG:-Merge ${ORIGINAL_BRANCH} into ${BASE_BRANCH}}"
  fi
  if [[ -z "$PR_BODY" ]]; then
    PR_BODY="$(cat <<EOF
## Summary
- ${PR_TITLE}

## Test plan
- [ ] 本地验证通过
EOF
)"
  elif [[ -f "$PR_BODY" ]]; then
    PR_BODY="$(cat "$PR_BODY")"
  fi

  echo "==> 创建 PR → ${BASE_BRANCH}"
  gh pr create \
    --base "$BASE_BRANCH" \
    --head "$ORIGINAL_BRANCH" \
    --title "$PR_TITLE" \
    --body "$PR_BODY"
  PR_NUM="$(gh pr list --head "$ORIGINAL_BRANCH" --base "$BASE_BRANCH" --state open --json number -q '.[0].number')"
fi

PR_URL="$(gh pr view "$PR_NUM" --json url -q '.url')"
echo "==> PR 已创建: ${PR_URL}"
echo "==> 当前分支: ${ORIGINAL_BRANCH}（未自动合并，需合并请手动执行 gh pr merge ${PR_NUM}）"
git status -sb
