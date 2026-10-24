# 硬编码白色扫描与分类（UI Batch 1）

扫描范围：`player/src/**/*.{vue,css,scss,ts,js,json}`
扫描命令（与 `scripts/lint-theme.mjs` 同规则）：

```bash
rg -n "text-white|#[fF]{3,6}\b|rgba?\(\s*255\s*,\s*255\s*,\s*255" player/src
```

- 扫描前：68 个文件、520 个白色 token。
- 本批修复后：514 个白色 token 被基线覆盖，新增用法由 `pnpm lint:theme` 拦截。

## A 类：位于始终深色 / 媒体背景上，保留（合法）

这些白色不依赖主题，背景为黑色媒体、封面暗渐变、黑色遮罩、品牌渐变或纯装饰高光：

- 播放器/封面媒体：`Player/VinylDisc.vue`、`PlayerDrawer.vue` 的封面控制栏与拖动预览（`bg-black/85`）、`Mobile/PlayerDrawerMobile.vue` 的黑胶高光。
- 始终深色弹层：`Dialog/DownloadQualityDialog.vue`、`pages/downloads.vue` 的删除确认弹窗、`layout/footer.vue` 的音质弹层（`#0a1f3d`）。
- 封面图暗渐变上的文字：`Search/SearchPlaylists.vue`、`Search/SearchMVs.vue`、`Ui/HeroCard.vue`、`Ui/MVCard.vue`。
- 品牌渐变按钮/徽章上的文字与图标：`Ui/Button.vue`、`Ui/Pagination.vue`、`Ui/SongCard.vue`、`Ui/TabGroup.vue`、`layout/aside.vue`、`pages/index.vue`、`pages/playlist.vue`、`pages/mv-list.vue`、`pages/mv-player.vue` 等。
- 装饰与效果：`directives/animations.ts`、`composables/useSharedElement.ts` 的 glare、`style/glass.css` 的阴影/高光/vinyl grooves、`config/shadowBlingPresets.json` 的预设色。

## B 类：位于随主题变化的背景上，本批已修复

| 文件 | 主要问题 | 处理 |
| --- | --- | --- |
| `style/glass.css` | 性能模式强制深色底；歌词缺少固定衬底令牌 | 改用 `--glass-bg-solid`；新增 `--glass-lyrics-*` |
| `components/PlayerDrawer.vue` | 歌词 `#fff` / `rgba(255,255,255,.38)`；歌词行仍用 `text-primary/40` | 固定深色衬底 + 语义前景；移除主题文字类 |
| `components/Mobile/PlayerDrawerMobile.vue` | 同上 | 同上 |
| `utils/lyricsWordSync.ts` | 逐字渐变回退白色 | 改用歌词语义变量 |
| `pages/downloads.vue` | 标题、表头、行、输入、按钮大量 `text-white/*` | 改为 `text-primary/*`、`border-glass`、`bg-button-glass` |
| `pages/mobile/downloads.vue` | 当前行标题/音质徽章用 `text-sky-300` 等浅色 | 改主题文字令牌并补 11px |
| `components/Ui/GlassSelect.vue` | 触发器与箭头 `text-white/90`、`/60` | `text-primary`、`text-primary/70` |
| `pages/mobile/index.vue` | 白字未复现；`.playlist-name` 仅 9.075px | 色彩保持令牌，字号补到 11px |
| `pages/search.vue` | 热度值 `text-primary/15` + 10px | `text-primary/70` + 11px |

## B 类：同类问题但超出本批目标，未修改（待后续批次）

- `components/Auth/LoginDialog.vue`：3 处 `placeholder:text-white/30` 位于主题玻璃输入框。
- `components/SongList.vue`：行内操作图标 `text-white/50`、`text-white/70`、`hover:text-white` 位于主题列表。
- `pages/search.vue`：清除按钮与搜索历史 `hover:text-white`（本批只修热度值）。
- `layout/aside.vue`、`components/Search/*` 的少量 `bg-white/*`/`border-white/*` 装饰面仍留在基线中，未影响本批文字可读性。

以上未修改项已登记在 `scripts/theme-lint-baseline.json`，任何新增同类用法会导致 `pnpm lint:theme` 失败。
