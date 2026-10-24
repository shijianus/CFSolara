# i18n 缺失键扫描报告（批次 4）

扫描时间：2026-10-24
分支：`fix/ui-batch-4`（基线 tag：`before-batch-4`）

## 1. 三语键位对齐

| 语言 | 基线键数 | 当前键数 | 本批新增 |
| --- | ---: | ---: | ---: |
| zh | 388 | 557 | 169 |
| en | 388 | 557 | 169 |
| ja | 383 | 557 | 174 |

结论：zh / en / ja 三份语言包当前均为 **557** 个叶子键，**互相缺失 0 个**。

## 2. 代码引用键扫描

- 静态扫描 `t('...')` / `$t('...')` / `labelKey` / `titleKey` / `descKey`：**481** 个键。
- 未定义键：**0**。
- 唯一报告项 `mvList.categories.` 为动态拼接 `t('mvList.categories.' + categoryKey)` 的扫描误报，四个实际分类键均存在。
- 动态键 `quality.${level}`、`player.playbackError.${kind}`、`components.settings.themeOptions.${theme}` 所需分支均已定义。

## 3. en / ja 全站页面扫描

用生产构建 + 本地 mock API，在 1440×900 与 390×844 两个视口逐页读取 `document.body.innerText`，覆盖：

`/`、`/settings`、`/downloads`、`/song/186016`、`/not-found`、`/local-music`、`/playlist/501`、`/mv-list`、`/recent`

| 检查项 | 结果 |
| --- | --- |
| `[missing:key]` 原始标记 | 0 |
| 原始 i18n key（`components.*` / `home.*` 等） | 0 |
| en 下连续 4 字以上中文 | 0 |
| ja 下中文界面词命中（下载列表 / 暂无 / 播放全部 / 歌单 / 评论 / 未知歌手 / 取消 / 清空 / 正在播放 / 搜索 / 设置 / 本地音乐 / 分享 / 收藏 / 加载中 / 确认删除 / 音质） | 0 |

说明：

- 语言选择器中的“中文 / 日本語”是各语言的自我名称，保留原文，不计为缺失翻译。
- ja 文本本身包含汉字，扫描只针对中文界面词，不把日文汉字误判为中文残留。

## 4. 缺失回退行为

`src/languages/index.ts` 已配置 vue-i18n `missing` 回调：

- 开发环境：`console.error("[i18n] missing message ...")`，并返回 `[missing:key]`，便于开发期立即发现问题。
- 生产环境：返回 key 本身，避免显示调试标记。

## 5. 原始数据

- `i18n-sweep.json`：逐语言、逐视口、逐页面的扫描结果。
- `typecheck.log`、`build.log`、`lint.log`：本批验证日志。
