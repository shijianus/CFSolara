# UI Batch 1 — 主题令牌与可读性复测

分支：`fix/ui-batch-1`  
基线标签：`before-batch-1`

## 截图状态

- `light-perf`：浅色主题 + 性能优先模式（关闭 blur/阴影，保留主题实色底）
- `dark`：深色主题 + 标准模式
- 视口：1440×900、820×700、844×390、390×844
- 页面：settings、search、downloads、home、lyrics
- 共 40 张，`report.json` 内含关键元素计算色值/字号

## 重点截图

- 设置页浅色性能模式：`shots/settings-1440x900-light-perf.png`
- 设置页深色：`shots/settings-1440x900-dark.png`
- 下载列表浅色性能模式：`shots/downloads-1440x900-light-perf.png`
- 下载列表深色：`shots/downloads-1440x900-dark.png`
- 播放器歌词浅色性能模式：`shots/lyrics-1440x900-light-perf.png`
- 播放器歌词深色：`shots/lyrics-1440x900-dark.png`
- 移动首页浅色（UI-057 未复现）：`shots/home-390x844-light-perf.png`
- 移动首页深色：`shots/home-390x844-dark.png`

## 验证数据

- 性能模式：浅色下 `.glass-card` 实色底 `rgb(244, 248, 255)`，GlassSelect 文字 `rgba(9, 23, 44, 0.92)`。
- 歌词：固定深色衬底 `rgba(4, 12, 24, 0.72)`；已唱/当前行前景近白，未唱歌词为 68% 白。
  在最亮封面叠白底的最坏情况下，对比度约 7.88:1 / 4.68:1。
- 热搜热度值：`text-primary/70`、11px；浅色性能模式下对 `#f4f8ff` 的对比度约 5.39:1。
- UI-057：移动首页 `.section-title` / `.playlist-name` 当前已使用 `var(--glass-text-primary)`，
  浅色实测为 `rgba(9, 23, 44, 0.92)`，深色为 `rgba(239, 246, 255, 0.94)`，未复现白字。
  复测同时发现 `.playlist-name` 仅 9.075px，已将字号补到 11px（颜色未改）。

截图使用本地 Vite 服务与无头 Chrome，通过 DevTools 协议生成；接口数据为本地 mock，仅用于视觉复测。
