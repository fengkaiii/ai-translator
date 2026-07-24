---
name: feature-code-map
description: lx-music-mobile 功能列表与代码目录对照表，将中文功能名（如「搜索」「歌单」「排行榜」「自定义音源」「桌面歌词」「播放器」「同步」）映射到对应的页面组件、core 业务逻辑与 store 状态位置。当用户提到某个 App 功能、问「XX功能在哪里」「XX代码位置」，或需要按功能描述定位代码块时使用。
---

# lx-music-mobile 功能代码对照表

React Native 音乐播放器（Android 为主）。按功能名快速定位代码位置；同一功能通常横跨三层：

- **UI 页面**：`src/screens/`
- **业务逻辑**：`src/core/`
- **状态**：`src/store/`（state/action/hook 三件套）

## 页面功能

| 功能 | UI 位置 | 业务逻辑 / 状态 |
|------|---------|----------------|
| 首页框架（横竖屏布局、抽屉导航） | `src/screens/Home/`（`Horizontal/`、`Vertical/`） | `src/navigation/` |
| 搜索（歌曲/歌单搜索、热搜、搜索历史） | `src/screens/Home/Views/Search/` | `src/core/search/`、`src/core/hotSearch.ts`、`src/store/search/`、`src/store/hotSearch/` |
| 搜索结果顺序/随机播放 | `src/screens/Home/Views/Search/MusicList.tsx` + `listAction.ts` | 复用临时列表播放（见「播放列表」） |
| 歌单广场（在线歌单浏览、分类标签） | `src/screens/Home/Views/SongList/` | `src/core/songlist.ts`、`src/store/songlist/` |
| 歌单详情（在线歌单打开后的页面） | `src/screens/SonglistDetail/` | 同上 |
| 排行榜 | `src/screens/Home/Views/Leaderboard/` | `src/core/leaderboard.ts`、`src/store/leaderboard/` |
| 我的列表（本地收藏列表管理） | `src/screens/Home/Views/Mylist/` | `src/core/list.ts`、`src/store/list/`、`src/utils/listManage.ts` |
| 播放详情页（全屏播放界面、歌词页） | `src/screens/PlayDetail/` | 播放状态见「播放器」 |
| 评论页 | `src/screens/Comment/` | — |
| 下载 | `src/screens/Home/Views/Download/`（占位） | `src/core/music/download.ts` |
| 设置页入口 | `src/screens/Home/Views/Setting/` | 设置项见下表 |
| 底部播放条 | `src/components/player/PlayerBar/` | — |

## 设置页子模块（`src/screens/Home/Views/Setting/settings/`）

| 功能 | 位置 |
|------|------|
| 基本设置（语言、字体、音源选择、启动行为） | `Basic/` |
| 自定义音源管理弹窗（导入/编辑/删除源） | `Basic/UserApiEditModal/` |
| 播放设置（音质、缓存、蓝牙歌词、繁简转换） | `Player/` |
| 歌词/桌面歌词设置 | `LyricDesktop/` |
| 备份与恢复（列表导入导出） | `Backup/` |
| 主题设置 | `Theme/` |
| 同步设置 | `Sync/` |
| 列表设置 | `List/` |
| 搜索设置 | `Search/` |
| 关于页 | `About.tsx` |
| 版本更新 | `Version.tsx` + `src/core/version.ts`、`src/navigation/components/VersionModal.tsx` |

## 核心业务（无独立页面）

| 功能 | 位置 |
|------|------|
| 播放器（播放/暂停/切歌/播放模式） | `src/core/player/player.ts`、`src/store/player/`；原生桥接 `src/plugins/player/`（react-native-track-player） |
| 播放列表 / 临时播放列表 | `src/core/player/tempPlayList.ts`、`playedList.ts`；写入临时列表用 `setTempList`（`src/core/list.ts`）+ `playList(LIST_IDS.TEMP)` |
| 获取播放链接 / 音质选择 | `src/core/music/online.ts`、`utils.ts` |
| 本地音乐 | `src/core/music/local.ts`、`src/utils/localMediaMetadata.ts` |
| 歌词（在线获取、解析、翻译） | `src/core/lyric.ts`、`src/plugins/lyric.ts`、`src/utils/lrcTools.ts` |
| 桌面歌词（悬浮窗） | `src/core/desktopLyric.ts`、`src/utils/nativeModules/lyricDesktop.ts` |
| 自定义音源（user api 脚本加载、请求转发、内置默认源） | `src/core/init/userApi/index.ts`、`src/core/userApi.ts`、`src/core/apiSource.ts`、`src/store/userApi/`、`src/utils/nativeModules/userApi.ts` |
| 内置音源 SDK（kw/kg/tx/wy/mg 各平台接口） | `src/utils/musicSdk/`（按平台分目录） |
| 多设备同步 | `src/core/sync.ts`、`src/plugins/sync/`、`src/store/sync/` |
| 不喜欢列表 | `src/core/dislikeList.ts`、`src/store/dislikeList/`、`src/utils/dislikeManage.ts` |
| 定时退出 | `src/core/player/timeoutExit.ts`、`src/components/TimeoutExitEditModal.tsx` |
| 主题系统 | `src/core/theme.ts`、`src/store/theme/`、`src/theme/themes/` |
| 应用初始化流程 | `src/core/init/index.ts`（依次：setting → theme → i18n → userApi → apiSource → player → data → sync） |

## 基础设施

| 模块 | 位置 |
|------|------|
| 设置默认值 / 存储 key 常量 | `src/config/defaultSetting.ts`、`src/config/constant.ts`（`storageDataPrefix`） |
| 设置读写与合并 | `src/config/setting.ts`、`src/core/common.ts`（`updateSetting`） |
| AsyncStorage 封装（分片存储） | `src/plugins/storage.ts`；业务数据读写 `src/utils/data.ts` |
| 国际化 | `src/lang/`（`zh-cn.json` / `zh-tw.json` / `en-us.json`） |
| 导航（react-native-navigation） | `src/navigation/`；全局弹窗 `src/navigation/components/` |
| 原生模块桥接 | `src/utils/nativeModules/` |
| 事件总线 | `src/event/`（`global.state_event` / `global.app_event`） |
| 通用 UI 组件 | `src/components/common/`（Button、Text、Icon 等） |
| GitHub 依赖构建脚本（postinstall） | `scripts/build-github-deps.js` |

## 使用提示

- 改功能时先看 `screens` 里的 UI，交互动作通常在同目录 `listAction.ts` 或 `action.ts`
- store 三件套：`state.ts`（数据）、`action.ts`（修改）、`hook.ts`（组件订阅）
- 全局单例挂在 `global.lx`（定义见 `src/config/globalData.ts`），如 `global.lx.apis`、`global.lx.qualityList`
