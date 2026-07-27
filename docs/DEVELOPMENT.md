# 开发与发布

面向贡献者 / 维护者。最终用户请看根目录 [README.md](../README.md)。

## Monorepo 结构

- `apps/desktop` — Electron 桌面端（系统划词、Cursor `@cursor/sdk`）
- `apps/extension` — Chromium MV3（页内划词 + 整页翻译；DeepSeek 直连，Cursor 经桌面 Native Messaging 代理）
- `packages/translate-core` — 共享类型、prompt、DeepSeek client、整页分块

## 本地开发

```bash
npm install
npm run dev                 # 桌面端 Electron
npm run build:extension     # 浏览器扩展 → apps/extension/dist
npm test                    # translate-core 单测
```

扩展加载：Chrome / Edge → 扩展程序 → 加载已解压的扩展程序 → 选 `apps/extension/dist`。使用 Cursor 厂商前请先 `npm run dev` 启动桌面端。

### macOS 开发态辅助功能

划词依赖辅助功能。开发模式请在 **系统设置 → 隐私与安全性 → 辅助功能** 中添加：

`node_modules/electron/dist/Electron.app`

可在设置页点击「在 Finder 中显示 Electron.app」快速定位。

## 本地打包

```bash
npm run dist        # 当前平台
npm run dist:mac    # 同时产出 arm64 + x64 两个 .dmg（Apple Silicon 上交叉编译 Intel）
npm run dist:win    # .exe
npm run dist:linux  # .deb
```

产物目录：仓库根下 `release/`。

macOS 期望文件名示例：

- `AI Translator-<version>-arm64.dmg`
- `AI Translator-<version>-x64.dmg`

`apps/desktop` 的 `build.npmRebuild` 为 `false`，依赖预编译原生二进制；`@cursor/sdk` 的平台 optional 包需在目标架构齐全（CI 会在 mac job 用 `npm install --force @cursor/sdk-darwin-x64` 交叉拉取，避免 arm64 runner 上的 EBADPLATFORM）。

## GitHub Actions 发布

仓库：https://github.com/fengkaiii/ai-translator

```bash
# 代码已在默认分支后打 tag
git tag vX.Y.Z
git push origin vX.Y.Z
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会：

1. **macOS**（`macos-latest`）：`electron-builder --mac --x64 --arm64` → 两个 DMG
2. **Windows**（`windows-2022`）：`.exe`
3. **Linux**（`ubuntu-latest`）：`.deb`
4. **扩展**（Ubuntu，独立 job）：`ai-translator-extension-<version>.zip`

上述产物上传到同一 GitHub Release。

### 交叉编译回退

若 mac 交叉编译因原生模块失败，将 release workflow 的 mac matrix 改为两行（并去掉单行双 arch args）：

| os | args |
|----|------|
| `macos-latest` | `--mac --arm64` |
| `macos-13` | `--mac --x64` |

上传步骤仍匹配 `release/*.dmg`，扩展 job 无需改动。

### 排障：Release 没有 Assets

常见原因：该 tag 已有一个空的已发布 Release，与草稿类型冲突。删除该 Release 后重新推 tag（或手动重跑 workflow）即可。

### 本地发布（当前平台）

```bash
export GH_TOKEN=你的_GitHub_PAT   # 需要 repo 权限
npm run release
```

注意：本地 `release` 脚本不会自动打双架构；双架构请用 `npm run dist:mac` 或依赖 Actions。
