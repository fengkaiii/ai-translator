---
name: create-tag
description: >-
  根据 package.json 版本在默认分支打 v* tag 并推送到 origin，触发 GitHub Release。
  Use when the user invokes /create-tag, asks to create/push a release tag,
  发tag、打tag、发布 tag、推送 tag、发版 tag.
disable-model-invocation: true
---

# 创建并推送 Release Tag

在默认分支上，用当前 `package.json` 版本打 `vX.Y.Z` tag 并推送；推送后由 `.github/workflows/release.yml` 自动构建并上传 GitHub Release。

**不做**：改版本号、写 release commit、本地打包。版本号由 `/create-branch` 等流程预先 bump。

## 前置检查

并行执行：

```bash
git branch --show-current
git status -sb
git log -5 --oneline
node -p "require('./package.json').version"
git describe --tags --abbrev=0 2>/dev/null
git tag -l 'v*' --sort=-v:refname | head -10
```

确认：

- 工作区干净（无未提交改动）；有脏改动则**停止**并询问
- 当前在默认分支（本仓库为 `master`；若默认分支是 `main` 则以实际为准）
- 本地与 `origin/<默认分支>` 一致（`git status -sb` 无 ahead/behind）；不一致则先 pull/push，不要在落后提交上打 tag
- 根目录 `package.json` 的 `version` 为合法 `x.y.z`
- 建议同步核对 `apps/desktop`、`apps/extension` 的 `package.json`（及扩展 `manifest.json`）版本一致；不一致则**停止**并报告

## 确定 Tag 名

```text
VERSION = package.json 的 version（如 2.0.10）
TAG = v${VERSION}（如 v2.0.10）
```

若用户显式给出 tag（如 `v2.1.0`）：

- 必须匹配 `v` + semver
- 且与当前 `package.json` version 一致；不一致则**停止**，请用户先改版本或改 tag，不要擅自 bump

确认远程/本地均无同名 tag：

```bash
git rev-parse -q --verify "refs/tags/${TAG}" && echo "local exists"
git ls-remote --tags origin "refs/tags/${TAG}"
```

任一已存在则**停止**，不要覆盖、不要 delete 后重推（除非用户明确要求删重建）。

## 工作流

```
默认分支（干净且与 origin 同步）
  → 读取 version → TAG=vX.Y.Z
  → 确认 tag 不存在
  → git tag TAG
  → git push origin TAG
```

### Step 1: 打 tag

轻量 tag（与仓库既有 `v*` 一致）：

```bash
git tag "$TAG"
```

### Step 2: 推送 tag

```bash
git push origin "$TAG"
```

推送成功即触发 Release workflow（mac 双 DMG / Win / Linux / 扩展 zip）。详见 `docs/DEVELOPMENT.md`「GitHub Actions 发布」。

## 安全规则

- **禁止** `git push --force` / 删除并重建远程 tag（除非用户明确要求）
- **禁止** `git reset --hard`、`git clean -fdx` 等破坏性命令
- **禁止** 修改 git config
- **禁止** 在本流程中改 `package.json` / 版本号 / 打 release commit（用户只要「发 tag」）
- 不要在功能分支上擅自打 release tag；若不在默认分支，先询问是否仍要对当前 HEAD 打 tag

## 完成报告

简要汇报：

- Tag 名与指向的 commit SHA（短）
- 是否已推送到 `origin`
- 提醒：可在 GitHub Actions / Releases 查看构建产物
