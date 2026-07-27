# Mac Intel 双架构打包 + README 拆分

日期：2026-07-27  
分支：`feat/mac-intel-support`  
状态：已确认

## 背景

当前桌面端用 electron-builder 打 macOS `.dmg`，`mac.target` 未声明架构；GitHub Actions 在 `macos-latest`（多为 arm64）上执行 `--mac`，Release 基本只有 Apple Silicon 包。Intel Mac 用户缺少可用安装包。

同时根目录 `README.md` 混杂功能说明、开发、打包、发布与使用步骤，不利于「下载即用」的读者，也让技术细节淹没在使用手册里。

## 目标

1. Release 同时产出两个独立 macOS DMG：
   - `AI Translator-<ver>-arm64.dmg`（Apple Silicon）
   - `AI Translator-<ver>-x64.dmg`（Intel）
2. 更新 GitHub Actions，使推送 `v*` tag 时自动上传上述两个 DMG（Win/Linux/扩展逻辑不变）。
3. 将根 `README.md` 拆成「使用向」与「技术向」两份文档。

## 非目标

- Universal 单一 DMG
- Apple 开发者签名 / 公证
- 改动 Windows / Linux 打包目标
- 提前引入 `macos-13` job（仅作为交叉编译失败时的回退）

## 决策摘要

| 议题 | 选择 |
|------|------|
| 产物形态 | 两个独立 DMG（arm64 + x64），文件名带架构后缀 |
| CI 首版 | 单 job：`macos-latest` + `electron-builder --mac --x64 --arm64` |
| CI 回退 | 交叉编译因原生依赖失败时，再拆 `macos-latest`→arm64 + `macos-13`→x64 |
| `npmRebuild` | 保持 `false`；优先依赖预编译二进制 + 显式补齐 optional 平台包 |
| 文档 | `README.md` = 简介 + 架构一览 + 使用手册；技术细节迁到 `docs/DEVELOPMENT.md` |

## 架构 / 改动面

```text
apps/desktop/package.json     # mac.target 显式 x64 + arm64；dist:mac 双架构
.github/workflows/release.yml # mac args: --mac --x64 --arm64；必要时装 sdk-darwin-x64
README.md                     # 精简为使用手册 + 简短架构
docs/DEVELOPMENT.md           # 新建：开发 / 打包 / CI / 发布排障
```

### 1. electron-builder（桌面）

将 `build.mac.target` 从裸 `"dmg"` 改为显式双架构，例如：

```json
"mac": {
  "target": [
    { "target": "dmg", "arch": ["x64", "arm64"] }
  ],
  "icon": "resources/icon.png",
  "category": "public.app-category.productivity"
}
```

脚本：

- `dist:mac` → `npm run build && electron-builder --mac --x64 --arm64`
- 根 `package.json` 的 `dist:mac` 继续转发到 desktop workspace

产物目录仍为仓库根下 `release/`（现有 `directories.output`）。

### 2. 原生依赖（交叉编译风险）

相关依赖：

- `uiohook-napi`：带 prebuild；`npmRebuild: false` 时依赖已装好的二进制
- `@cursor/sdk`：通过 optional `@cursor/sdk-darwin-arm64` / `@cursor/sdk-darwin-x64` 提供原生包；在 arm64 runner 上 `npm ci` 通常只装 host optional

缓解（首版）：

- CI「Build desktop」前，在 mac job 显式安装缺失的 `@cursor/sdk-darwin-x64`（版本与 lockfile 中 `@cursor/sdk` 对齐）
- 保持 `asarUnpack` 对 `uiohook-napi` / `@cursor/sdk*` 的现有规则
- **不**默认打开 `npmRebuild`

回退（方案 C）：

若构建失败或产物缺 x64 原生模块，将 matrix 改为两行：

| os | args |
|----|------|
| `macos-latest` | `--mac --arm64` |
| `macos-13` | `--mac --x64` |

上传步骤继续匹配 `release/*.dmg`，无需改扩展 job。

### 3. GitHub Actions

修改 `.github/workflows/release.yml` 中 mac 矩阵项：

```yaml
- os: macos-latest
  args: --mac --x64 --arm64
```

其余（Windows 钉 `windows-2022`、Linux deb、translate-core 实体化、扩展 zip）保持不变。

上传已使用 `release/*.dmg`，一次 job 产出的两个 DMG 都会进入同一 Release。

在 workflow 或 `docs/DEVELOPMENT.md` 中简短注明：交叉编译失败时的回退 matrix（见上），避免后人重复踩坑。

### 4. 文档拆分

#### `README.md`（使用手册为主）

保留 / 改写为面向下载与日常使用的读者：

1. 一句话介绍 + **简短软件架构**（desktop / extension / translate-core 各一行，指向 `docs/DEVELOPMENT.md`）
2. 功能概览（用户能感知的能力，去掉 `@cursor/sdk` 等实现细节堆砌）
3. 下载与安装
   - 按平台选产物：mac 说明选 `*-arm64.dmg` 或 `*-x64.dmg`
   - macOS Gatekeeper / `xattr` 打开步骤（从现 README 迁入）
   - 扩展 zip 加载方式（用户视角）
4. 快速使用（设置 Key、翻译/润色、划词、快捷键）
5. macOS 辅助功能授权（最终用户视角；开发态 `Electron.app` 说明挪到技术文档）
6. 链到 `docs/DEVELOPMENT.md`（开发、打包、发版）

不在 README 展开：`npm run dist*` 细节、Actions 排障、monorepo 脚本矩阵。

#### `docs/DEVELOPMENT.md`（技术文档）

从现 README「开发 / 打包 / 发布」迁入并补全：

- Monorepo 结构与职责
- 本地开发命令（`dev` / `build:extension` / `test`）
- 开发态 macOS 辅助功能与 `Electron.app` 路径
- 本地打包：`dist` / `dist:mac`（双架构）/ `dist:win` / `dist:linux`
- GitHub Actions Release 流程（`v*` tag）、产物清单（含双 DMG）
- 交叉编译说明与回退到 `macos-13` 的条件
- 本地 `npm run release` + `GH_TOKEN`
- Release 无 Assets 时的排障（空 Release / 草稿冲突）

## 验收标准

1. 本地或 CI 执行 mac 双架构打包后，`release/` 同时存在 `*-arm64.dmg` 与 `*-x64.dmg`。
2. 推送 `v*` tag 后，对应 GitHub Release 的 Assets 含上述两个 DMG，且 Win/Linux/扩展 zip 行为与现在一致。
3. 根 `README.md` 以使用说明为主，仅含简短架构；开发/打包/CI 在 `docs/DEVELOPMENT.md`，且两边互相链接。
4. 未引入 Universal 包、未改签名/公证、未默认启用 `npmRebuild`。

## 实现顺序（供后续 plan）

1. 更新 desktop `build.mac` + `dist:mac` 脚本  
2. 更新 `release.yml` mac args + 可选 sdk-darwin-x64 安装步骤  
3. 新建 `docs/DEVELOPMENT.md`，精简 `README.md`  
4. 用 tag / 或本地 `dist:mac` 验证双 DMG 产物名  
```
