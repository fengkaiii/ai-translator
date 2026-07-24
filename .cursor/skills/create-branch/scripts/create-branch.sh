#!/usr/bin/env bash
# 创建功能分支 → 初始化 docs/README.md（顶部为需求描述）→ 自增 package.json 修订号 → 提交
# 用法: create-branch.sh "<branch-name>" ["<requirement>"]
# 中文需求 → 英文分支名由调用方（Agent）完成后再传入。
set -euo pipefail

BRANCH_NAME="${1:-}"
REQUIREMENT="${2:-}"

if [[ -z "$BRANCH_NAME" ]]; then
  echo "错误: 请提供分支名"
  echo "用法: $0 \"<branch-name>\" [\"<requirement>\"]"
  exit 1
fi

BRANCH_NAME="$(echo "$BRANCH_NAME" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
REQUIREMENT="$(echo "$REQUIREMENT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [[ -z "$BRANCH_NAME" ]]; then
  echo "错误: 分支名不能为空"
  exit 1
fi

if [[ -z "$REQUIREMENT" ]]; then
  REQUIREMENT="$BRANCH_NAME"
fi

# git 分支名基本校验
if [[ "$BRANCH_NAME" =~ [[:space:]] ]] || [[ "$BRANCH_NAME" =~ [\~^\:?*\[\]\\] ]]; then
  echo "错误: 分支名含非法字符: ${BRANCH_NAME}"
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
  echo "错误: 本地已存在分支 ${BRANCH_NAME}"
  exit 1
fi

if git ls-remote --heads origin "$BRANCH_NAME" | grep -q .; then
  echo "错误: 远程已存在分支 ${BRANCH_NAME}"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "错误: 工作区有未提交改动，请先 stash 或提交"
  git status -sb
  exit 1
fi

BASE_BRANCH="main"
REMOTE="${REMOTE:-origin}"
ORIGINAL_BRANCH="$(git branch --show-current)"

echo "==> 当前分支: ${ORIGINAL_BRANCH}"
echo "==> 基于分支: ${BASE_BRANCH}"
echo "==> 创建分支: ${BRANCH_NAME}"
echo "==> 需求描述: ${REQUIREMENT}"

git fetch "$REMOTE" "$BASE_BRANCH"
git checkout "$BASE_BRANCH"
git pull --ff-only "$REMOTE" "$BASE_BRANCH"
git checkout -b "$BRANCH_NAME"

DOCS_DIR="docs/${BRANCH_NAME}"
mkdir -p "${DOCS_DIR}"

OLD_VERSION="$(node -p "require('./package.json').version")"
NEW_VERSION="$(node -e "
const fs = require('fs');
const p = 'package.json';
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
const parts = pkg.version.split('.').map(Number);
if (parts.length !== 3 || parts.some(isNaN)) {
  console.error('version 格式须为 x.y.z');
  process.exit(1);
}
parts[2] += 1;
pkg.version = parts.join('.');
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log(pkg.version);
")"

CREATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# README：顶部为需求描述；REQUIREMENT 可能含特殊字符，用 Node 安全写入
node -e "
const fs = require('fs');
const path = process.argv[1];
const branch = process.argv[2];
const requirement = process.argv[3];
const createdAt = process.argv[4];
const version = process.argv[5];
const body = [
  '# 需求',
  '',
  requirement,
  '',
  '## 分支信息',
  '',
  '- 分支: ' + branch,
  '- 创建时间: ' + createdAt,
  '- 初始版本: ' + version,
  '',
  '## Commits',
  '',
].join('\n');
fs.writeFileSync(path, body, 'utf8');
" "${DOCS_DIR}/README.md" "$BRANCH_NAME" "$REQUIREMENT" "$CREATED_AT" "$NEW_VERSION"

git add package.json "${DOCS_DIR}/README.md"
git commit -m "chore: init branch ${BRANCH_NAME} (v${NEW_VERSION})"

echo "==> 版本: ${OLD_VERSION} → ${NEW_VERSION}"
echo "==> docs 入口: ${DOCS_DIR}/README.md（顶部为需求描述）"
echo "==> 当前分支: $(git branch --show-current)"
git log -1 --oneline
