# 需求

适配浏览器插件

## 分支信息

- 分支: feat/browser-extension
- 创建时间: 2026-07-24T09:33:39Z
- 初始版本: 1.1.1

## Commits
- 2026-07-24 docs(browser-extension): 完善手测清单与错误文案对齐

- 2026-07-24 fix(native-messaging): 修复开发态 native-host 路径解析
- 2026-07-24 fix(extension): 修复整页替换还原与截断提示文案
- 2026-07-24 fix(extension): 修复扩展构建后 popup/options 资源路径
- 2026-07-24 docs(browser-extension): 补充扩展使用说明与错误文案打磨

- 2026-07-24 feat(native-messaging): Cursor 经桌面代理供扩展调用
- 2026-07-24 feat(extension): 整页双语与替换翻译
- 2026-07-24 feat(extension): 页内划词翻译气泡
- 2026-07-24 feat(extension): Options 配置与 DeepSeek 直连翻译
- 2026-07-24 feat(extension): 搭建 Chromium MV3 扩展脚手架
- 2026-07-24 feat(translate-core): 增加整页文本分块与上限逻辑
- 2026-07-24 refactor(desktop): 迁入 apps/desktop 并改用 translate-core
- 2026-07-24 feat(translate-core): 抽出 DeepSeek client 与 prompts
- 2026-07-24 chore(monorepo): 初始化 workspaces 与 translate-core 骨架
- 2026-07-24 docs(browser-extension): 写入浏览器插件与 monorepo 设计规格

## 本地加载扩展

1. `npm install && npm run build -w ai-translator-extension`
2. **Chrome**：扩展程序 → 加载已解压的扩展程序 → 选择 `apps/extension/dist`
3. **Edge**：扩展 → 管理扩展 → 加载解压缩的扩展 → 同一 `apps/extension/dist`（Chromium only）
4. 启动桌面端：`npm run dev`（会安装 Native Messaging Host；Chrome / Edge 各写一份 host 清单目录）
5. 扩展 Options 可独立配置 DeepSeek；选 Cursor 时需桌面端在线

## 错误文案（手测对照）

| 场景 | 文案 |
|------|------|
| 无 DeepSeek key | 请先在扩展设置中填写 DeepSeek API Key |
| Cursor 桌面离线 | 请打开 AI Translator 桌面端以使用 Cursor |
| 整页截断 | 页面过大，仅翻译了前 N 个文本块 |
| 单块失败 | 该段保留原文 |

## 手测清单

- [ ] 桌面：`npm run dev` 划词 + DeepSeek + Cursor 回归
- [ ] 扩展 DeepSeek 划词（含无 key 提示）
- [ ] 扩展整页双语 / 替换 / 清除 / 还原
- [ ] 扩展 Cursor + 桌面在线
- [ ] 扩展 Cursor + 桌面离线提示
- [ ] Chrome 与 Edge 各 Load unpacked 一次（host 清单两个目录）
