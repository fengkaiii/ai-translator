# 需求

兼容cursor 本地sdk调用

## 分支信息

- 分支: feat/cursor-local-sdk
- 创建时间: 2026-07-24T09:11:09Z
- 初始版本: 1.0.3

## Commits

- Electron 升级到 39.8.0（Node 22.22），满足 `@cursor/sdk` engines
- Cursor 翻译从 Cloud Agents REST 改为本地 `Agent.prompt` + `Cursor.models.list`
- 打包 `asarUnpack` 包含 `@cursor/sdk` 原生二进制
