# UI Batch 1 — 硬编码白色清单与分类

扫描命令：`grep -RInE "text-white|#fff|#ffffff|rgba(255[[:space:]]*,[[:space:]]*255[[:space:]]*,[[:space:]]*255" player/src`

共 **211** 个命中行。分类口径：**A 合法**（位于封面/图片遮罩、固定深色弹层、品牌/强调渐变上的白色前景）；**B 待处理**（位于随主题变化的背景上，且为文字/占位文字，存在可读性风险）；**C 装饰/结构**（背景、边框、阴影、高光、令牌定义等，不是本批文字可读性问题）。

- A 合法前景：117
- B 待处理（非本批范围）：13
- C 装饰/结构：81

> 本批修复目标中位于 B 类的 6 组问题已在提交 `UI-001/002/003/004/048/057` 中处理；上表 B 类是扫描时额外发现的同源问题，按“不扩大范围”要求未在本批修改，列入待确认/后续批次。

## 与主题变量的关系

- A 类依靠固定深色/图片黑色渐变/彩色强调按钮保证对比，无需改成主题令牌。
- B 类在浅色主题下会与背景混同，应改为 `text-primary` / `text-primary/70` / `placeholder:text-primary/*` 等主题令牌；不能在深色与浅色同时使用单一白色。
- C 类中 `GlassSelect` 的 `border-white/10` 在浅色主题也偏弱，但属于描边而非文字可读性；本批保留原样，避免扩大视觉差异。

## B 类待处理明细

- `player/src/components/SongList.vue`：L391、L399、L408、L417、L425 — 歌曲行默认“⋯”和悬停操作图标在浅色行背景上会消失；建议主题令牌化。
- `player/src/components/Auth/LoginDialog.vue`：L249、L256、L275 — 占位文字 `placeholder:text-white/30` 在浅色玻璃卡上几乎不可见；建议 `placeholder:text-primary/40`。
- `player/src/layout/footer.vue`：L871、L875 — 底栏时间使用 `text-white/80`，浅色主题下与浅色 Dock 对比不足；建议 `text-primary/70`。
- `player/src/pages/search.vue`：L309、L350 — 清空按钮与历史 chip 的 `hover:text-white` 在浅色背景上失效；建议 `hover:text-primary`。
- `player/src/components/Background/ShadowBlingSettingsPanel.vue`：L139 — 预览块文字 `text-white/50` 随用户选择的预览背景变化，浅色预览下偏低；建议加深色遮罩或主题化。

## 完整扫描附录

### `player/src/components/Auth/LoginDialog.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 192 | A 合法前景 | `<span class="icon-[mdi--account-circle] h-6 w-6 text-white" />` |
| 249 | **B 待处理** | `class="text-primary w-full bg-transparent text-sm outline-none placeholder:text-white/30"` |
| 256 | **B 待处理** | `class="text-primary w-full bg-transparent text-sm outline-none placeholder:text-white/30"` |
| 275 | **B 待处理** | `class="text-primary w-full bg-transparent text-sm outline-none placeholder:text-white/30"` |

### `player/src/components/Background/ShadowBling.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 18 | C 装饰/结构 | `bgColors: () => ['#000000', '#ffffff', '#808080'],` |

### `player/src/components/Background/ShadowBlingSettingsPanel.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 12 | C 装饰/结构 | `color2: settings.shadowBling.bgColors[1] || '#ffffff',` |
| 139 | **B 待处理** | `<div class="flex h-full items-center justify-center text-white/50">` |

### `player/src/components/Comments/SongCommentsDialog.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 132 | A 合法前景 | `<span class="icon-[mdi--comment-text-multiple] h-6 w-6 text-white" />` |
| 182 | A 合法前景 | `<span class="icon-[mdi--account] h-5 w-5 text-white" />` |
| 234 | A 合法前景 | `<span class="icon-[mdi--account] h-3 w-3 text-white" />` |

### `player/src/components/Dialog/DownloadQualityDialog.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 288 | A 合法前景 | `class="text-[18px] font-semibold text-white/95 leading-tight tracking-tight"` |
| 294 | A 合法前景 | `class="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 …` |
| 319 | A 合法前景 | `<div v-else class="h-full w-full flex items-center justify-center bg-white/5 text-white/40" style="width: 48px; height: 48px;">` |
| 327 | A 合法前景 | `class="truncate text-[15px] font-semibold text-white/95"` |
| 331 | A 合法前景 | `<p class="mt-0.5 truncate text-[13px] text-white/70 font-medium">` |
| 370 | A 合法前景 | `<div class="text-[15px] font-semibold text-white/95 leading-snug">` |
| 379 | A 合法前景 | `<span class="icon-[mdi--information-outline] h-3.5 w-3.5 shrink-0 text-white/55"></span>` |
| 380 | A 合法前景 | `<span class="text-[13px] font-normal text-white/55 truncate">` |
| 385 | A 合法前景 | `<span class="text-[13px] font-medium text-white/60 truncate">` |
| 398 | A 合法前景 | `<span class="text-[14px] font-medium font-mono text-white/80 tabular-nums">` |
| 403 | A 合法前景 | `<span class="text-[14px] font-medium font-mono text-white/40 tabular-nums">` |
| 428 | A 合法前景 | `<p class="mt-3.5 mb-4 text-[13px] text-white/60 font-medium text-left">` |
| 445 | A 合法前景 | `class="h-[40px] px-4 text-[14px] font-semibold text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer outline-none focus-visible:ring-2 foc…` |
| 454 | A 合法前景 | `class="download-btn-gradient h-[40px] px-5 rounded-xl text-[14px] font-semibold text-white shadow-md transition-all outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"` |
| 483 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.12);` |
| 502 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.08);` |
| 506 | A 合法前景 | `background-color: rgba(255, 255, 255, 0.04);` |
| 507 | A 合法前景 | `border-color: rgba(255, 255, 255, 0.15);` |
| 511 | A 合法前景 | `background-color: rgba(255, 255, 255, 0.08);` |
| 512 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.28);` |
| 517 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.06);` |

### `player/src/components/Mobile/PlayerDrawerMobile.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 690 | A 合法前景 | `class="pointer-events-none absolute top-2 right-2 flex h-4 min-w-4 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-sky-500 px-1 text-[0.6rem] font-b…` |
| 798 | C 装饰/结构 | `inset 0 0 0 1px rgba(255, 255, 255, 0.05);` |
| 808 | C 装饰/结构 | `rgba(255, 255, 255, 0.04) 0px,` |
| 809 | C 装饰/结构 | `rgba(255, 255, 255, 0.04) 1px,` |
| 821 | C 装饰/结构 | `background: radial-gradient(ellipse at 30% 20%, rgba(255, 255, 255, 0.15) 0%, transparent 50%);` |
| 827 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.1);` |
| 965 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.1);` |
| 1005 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.1);` |

### `player/src/components/Mobile/PlaylistInfoPopover.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 73 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.1);` |
| 81 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.2);` |
| 88 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.1);` |

### `player/src/components/Player/VinylDisc.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 283 | C 装饰/结构 | `conic-gradient(from 20deg, transparent 0 8%, rgba(255, 255, 255, 0.16) 12%, transparent 18% 50%, rgba(255, 255, 255, 0.12) 62%, transparent 68%),` |
| 287 | C 装饰/结构 | `0 0 0 1px rgba(255, 255, 255, 0.12),` |
| 288 | C 装饰/结构 | `inset 0 0 0 1px rgba(255, 255, 255, 0.1);` |
| 298 | C 装饰/结构 | `rgba(255, 255, 255, 0.05) 0px,` |
| 299 | C 装饰/结构 | `rgba(255, 255, 255, 0.05) 1px,` |
| 311 | C 装饰/结构 | `background: radial-gradient(ellipse at 30% 20%, rgba(255, 255, 255, 0.18) 0%, transparent 50%);` |
| 317 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.15);` |

### `player/src/components/PlayerDrawer.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 965 | A 合法前景 | `<span class="text-lg text-white/40 tabular-nums">{{` |
| 1003 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.06);` |
| 1005 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.08);` |
| 1008 | C 装饰/结构 | `inset 0 1px 0 rgba(255, 255, 255, 0.05);` |
| 1016 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.08);` |
| 1183 | C 装饰/结构 | `inset 0 1px 0 rgba(255, 255, 255, 0.06);` |

### `player/src/components/Search/SearchMVs.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 79 | A 合法前景 | `class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white backdrop-blur-sm"` |
| 85 | A 合法前景 | `class="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm"` |
| 93 | A 合法前景 | `<span class="icon-[mdi--play] h-7 w-7 text-white" />` |
| 98 | A 合法前景 | `class="truncate text-sm font-medium text-white transition-colors group-hover:text-sky-300"` |
| 102 | A 合法前景 | `<p class="mt-0.5 truncate text-[11px] text-white/70">{{ mv.artist }}</p>` |

### `player/src/components/Search/SearchPlaylists.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 76 | A 合法前景 | `class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white backdrop-blur-sm"` |
| 82 | A 合法前景 | `<p class="line-clamp-2 text-xs leading-tight font-medium text-white">{{ pl.name }}</p>` |
| 83 | A 合法前景 | `<div class="mt-1.5 flex items-center gap-1.5 text-[10px] text-white/70">` |

### `player/src/components/Settings/LocalMusicSettings.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 94 | A 合法前景 | `<span class="icon-[mdi--folder-music-outline] h-6 w-6 text-white" />` |

### `player/src/components/SongList.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 391 | **B 待处理** | `<div class="flex items-center justify-center text-white/50 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">` |
| 399 | **B 待处理** | `class="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-sky-400 hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 …` |
| 408 | **B 待处理** | `class="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-blue-300 hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2…` |
| 417 | **B 待处理** | `class="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 fo…` |
| 425 | **B 待处理** | `class="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-sky-400 hover:bg-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 …` |

### `player/src/components/Ui/ArtistCard.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 181 | A 合法前景 | `class="icon-[mdi--play] h-6 w-6 scale-50 text-white transition-transform group-hover:scale-100"` |

### `player/src/components/Ui/Button.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 158 | A 合法前景 | `return 'bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-600 hover:shadow-xl hover:shadow-sky-500/30'` |
| 284 | A 合法前景 | `@apply flex items-center justify-center rounded-full text-white shadow-2xl transition-all duration-300;` |
| 286 | C 装饰/结构 | `box-shadow: 0 10px 30px -6px rgba(37,99,235, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.4);` |
| 291 | C 装饰/结构 | `box-shadow: 0 14px 40px -4px rgba(37,99,235, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.5);` |

### `player/src/components/Ui/HeroCard.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 51 | C 装饰/结构 | `rgba(255, 255, 255, 0) 0%,` |
| 52 | C 装饰/结构 | `rgba(255, 255, 255, 0) 50%,` |
| 53 | C 装饰/结构 | `rgba(255, 255, 255, ${tiltConfig.glareMax}) 100%` |
| 124 | A 合法前景 | `${props.subtitle ? `<p style="margin-top: 8px; font-size: 14px; color: rgba(255,255,255,0.7);">${props.subtitle}</p>` : ''}` |
| 247 | C 装饰/结构 | `glareRef.value.style.background = `linear-gradient(${angle}deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, ${tiltConfig.glareMax * intensity}) 100%)`` |
| 308 | A 合法前景 | `class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white backdrop-blur-sm"` |
| 316 | A 合法前景 | `<p class="line-clamp-2 text-xs leading-tight font-medium text-white">` |
| 319 | A 合法前景 | `<div v-if="trackCount" class="mt-1.5 flex items-center gap-1.5 text-[10px] text-white/70">` |
| 330 | A 合法前景 | `class="flex h-12 w-12 scale-75 items-center justify-center rounded-full bg-gradient-to-br from-[#2563eb] to-[#38bdf8] text-white shadow-[0_10px_30px_rgba(37,99,235,0.6)] transit…` |
| 332 | A 合法前景 | `<span class="icon-[mdi--play] h-6 w-6 text-white" />` |

### `player/src/components/Ui/InfiniteScroll.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 162 | A 合法前景 | `class="group relative inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-gradient-to-r from-blue-600/20 to-sky-600/20 px-5 py-2 text-xs font-medium text-sky…` |
| 167 | A 合法前景 | `<span class="inline-flex items-center rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300 group-hover:text-white">` |

### `player/src/components/Ui/LazyImage.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 168 | A 合法前景 | `<span v-if="initialChar" class="text-sm font-bold text-white/90 drop-shadow-sm font-sans select-none">` |
| 171 | A 合法前景 | `<span v-else class="icon-[mdi--music-note] text-white/50 h-5 w-5"></span>` |

### `player/src/components/Ui/MVCard.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 49 | C 装饰/结构 | `rgba(255, 255, 255, 0) 0%,` |
| 50 | C 装饰/结构 | `rgba(255, 255, 255, 0) 50%,` |
| 51 | C 装饰/结构 | `rgba(255, 255, 255, ${tiltConfig.glareMax}) 100%` |
| 98 | C 装饰/结构 | `glareRef.value.style.background = `linear-gradient(${angle}deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, ${tiltConfig.glareMax * intensity}) 100%)`` |
| 223 | C 装饰/结构 | `background: rgba(255,255,255,0.2);` |
| 249 | A 合法前景 | `color: rgba(255,255,255,0.7);` |
| 339 | A 合法前景 | `class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white backdrop-blur-sm"` |
| 351 | A 合法前景 | `class="play-button flex h-14 w-14 scale-80 items-center justify-center rounded-full bg-gradient-to-br from-[#2563eb] to-[#38bdf8] text-white opacity-0 shadow-[0_10px_30px_rgba(3…` |
| 353 | A 合法前景 | `<span class="play-icon icon-[mdi--play] h-7 w-7 text-white" />` |
| 359 | A 合法前景 | `<p class="truncate text-sm font-medium text-white">{{ name }}</p>` |
| 360 | A 合法前景 | `<p class="mt-0.5 truncate text-[11px] text-white/70">{{ artist }}</p>` |
| 368 | C 装饰/结构 | `mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);` |

### `player/src/components/Ui/MusicProgress.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 164 | A 合法前景 | `class="time-preview absolute bottom-full mb-2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1.5 text-xs whitespace-nowrap text-white shadow-lg backdrop-blur-sm"` |

### `player/src/components/Ui/Pagination.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 75 | A 合法前景 | `? 'bg-linear-to-br from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/25'` |

### `player/src/components/Ui/PlaylistBubble.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 198 | A 合法前景 | `<span class="icon-[mdi--playlist-music] h-6 w-6 text-white"></span>` |
| 303 | A 合法前景 | `<span class="icon-[mdi--music-note] h-6 w-6 text-white/70"></span>` |
| 315 | A 合法前景 | `<span v-else class="icon-[mdi--pause] h-6 w-6 text-white"></span>` |

### `player/src/components/Ui/SongCard.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 199 | A 合法前景 | `? 'bg-gradient-to-br from-[#2563eb] via-[#38bdf8] to-[#3b82f6] text-white shadow-[0_0_12px_rgba(37,99,235,0.55)]'` |
| 217 | A 合法前景 | `<span class="icon-[mdi--play] h-5 w-5 text-white" />` |

### `player/src/components/Ui/TabGroup.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 51 | A 合法前景 | `: 'bg-linear-to-r from-sky-500/80 to-blue-500/80 text-white shadow-sm font-medium'` |
| 65 | A 合法前景 | `: 'bg-white/20 text-white'` |

### `player/src/components/Ui/VolumeControl.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 143 | A 合法前景 | `class="volume-preview absolute bottom-full mb-2 -translate-x-1/2 rounded-lg bg-black/80 px-2 py-1 text-xs whitespace-nowrap text-white shadow-lg backdrop-blur-sm"` |

### `player/src/composables/useSharedElement.ts`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 302 | A 合法前景 | `color: string = 'rgba(255, 255, 255, 0.3)'` |

### `player/src/directives/animations.ts`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 370 | C 装饰/结构 | `rgba(255, 255, 255, 0) 0%,` |
| 371 | C 装饰/结构 | `rgba(255, 255, 255, 0) 50%,` |
| 372 | C 装饰/结构 | `rgba(255, 255, 255, ${glareMax}) 100%` |
| 403 | C 装饰/结构 | `glareEl.style.background = `linear-gradient(${angle}deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, ${glareMax * Math.sqrt(mouseX ** 2 + mouseY ** 2)}) 100%)`` |
| 524 | C 装饰/结构 | `color = 'rgba(255, 255, 255, 0.08)',` |

### `player/src/layout/aside.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 181 | C 装饰/结构 | `<span class="h-2 w-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] animate-pulse"></span>` |
| 188 | A 合法前景 | `<span class="rounded bg-linear-to-r from-[#2563eb]/30 to-[#38bdf8]/30 px-1 py-0.2 text-[8px] font-bold text-white/90 border border-white/20">{{ BRAND_STUDIO }}</span>` |
| 321 | A 合法前景 | `background-color: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.08));` |
| 322 | C 装饰/结构 | `border: 1px solid light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.12));` |
| 341 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.05);` |

### `player/src/layout/footer.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 772 | A 合法前景 | `<span id="quality-menu-title" class="text-[11px] font-semibold text-white/90 tracking-wider">音频规格</span>` |
| 799 | A 合法前景 | `: 'border border-transparent text-white/85 hover:bg-white/10 hover:text-white cursor-pointer'` |
| 810 | A 合法前景 | `:class="effectiveQualityLevel === q.level && q.isAvailable ? 'text-sky-200 font-bold' : 'text-white/90 font-medium'"` |
| 827 | A 合法前景 | `? 'text-[13px] text-white/65 font-normal font-sans'` |
| 830 | A 合法前景 | `: 'text-xs text-white/65 group-hover:text-white/85 font-mono'` |
| 871 | **B 待处理** | `<span class="text-white/80 text-xs font-medium font-mono tabular-nums select-none">{{` |
| 875 | **B 待处理** | `<span class="text-white/80 text-xs font-medium font-mono tabular-nums select-none">{{ formattedDuration }}</span>` |
| 982 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.14);` |
| 985 | C 装饰/结构 | `inset 0 1px 1px 0 rgba(255, 255, 255, 0.12);` |

### `player/src/pages/artist.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 170 | A 合法前景 | `icon-class="h-8 w-8 text-white"` |
| 316 | A 合法前景 | `<span class="icon-[mdi--play-circle] h-12 w-12 text-white"></span>` |
| 379 | A 合法前景 | `color: rgba(255, 255, 255, 0.15);` |

### `player/src/pages/index.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 152 | A 合法前景 | `<h3 class="line-clamp-1 text-sm font-semibold tracking-tight text-white/95 drop-shadow-md lg:text-base">` |
| 158 | A 合法前景 | `class="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-medium tracking-wide text-white/95 shadow-sm backdrop-blur-md"` |
| 175 | A 合法前景 | `<span class="icon-[mdi--playlist-star] h-5 w-5 text-white"></span>` |
| 203 | A 合法前景 | `<span class="icon-[mdi--account-music] h-5 w-5 text-white"></span>` |
| 237 | A 合法前景 | `<span class="icon-[mdi--music-note-plus] h-5 w-5 text-white"></span>` |
| 272 | A 合法前景 | `<span class="icon-[mdi--video] h-5 w-5 text-white"></span>` |

### `player/src/pages/likes.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 172 | C 装饰/结构 | `rgba(255, 255, 255, 0.06),` |
| 173 | C 装饰/结构 | `rgba(255, 255, 255, 0.02) 30%,` |
| 174 | C 装饰/结构 | `rgba(255, 255, 255, 0.06)` |

### `player/src/pages/local-music.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 24 | A 合法前景 | `<span class="icon-[mdi--folder-music-outline] h-7 w-7 text-white" />` |

### `player/src/pages/mobile/artist.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 282 | C 装饰/结构 | `border: 3px solid rgba(255, 255, 255, 0.2);` |

### `player/src/pages/mobile/downloads.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 168 | A 合法前景 | `<span class="icon-[mdi--tray-arrow-down] h-6 w-6 text-white"></span>` |
| 186 | A 合法前景 | `class="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-sky-500/30 active:scale-95 tr…` |
| 209 | A 合法前景 | `:class="selectedQuality === 'all' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"` |
| 216 | A 合法前景 | `:class="selectedQuality === 'lossless' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"` |
| 223 | A 合法前景 | `:class="selectedQuality === 'exhigh' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"` |
| 230 | A 合法前景 | `:class="selectedQuality === 'standard' ? 'bg-sky-500 text-white font-bold' : 'bg-white/5 text-primary/60'"` |
| 331 | A 合法前景 | `class="mt-4 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-2 text-xs font-bold text-white shadow-md shadow-sky-500/25 active:scale-95 transition-all"` |

### `player/src/pages/mobile/index.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 130 | A 合法前景 | `class="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white/95 backdrop-blur-md shadow-sm"` |
| 293 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.4);` |

### `player/src/pages/mobile/recent.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 220 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.2);` |

### `player/src/pages/mobile/search.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 356 | A 合法前景 | `class="search-btn text-white flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-medium transition-all active:scale-95"` |
| 432 | A 合法前景 | `class="play-all-button text-white flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium shadow-lg transition-all duration-200 active:scale-95"` |

### `player/src/pages/mv-list.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 175 | A 合法前景 | `class="flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/90 text-white shadow-2xl backdrop-blur-sm"` |
| 181 | A 合法前景 | `class="absolute right-3 bottom-3 rounded-lg bg-black/70 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm"` |
| 186 | A 合法前景 | `class="absolute top-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1 text-xs text-white/90 backdrop-blur-sm"` |

### `player/src/pages/mv-player.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 236 | A 合法前景 | `class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-blue-500 text-sm font-medium text-white"` |
| 301 | A 合法前景 | `<span class="icon-[mdi--play] h-8 w-8 text-white"></span>` |
| 304 | A 合法前景 | `class="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white backdrop-blur-sm"` |

### `player/src/pages/new-albums.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 121 | A 合法前景 | `<span class="icon-[mdi--play-circle] h-12 w-12 text-white" />` |

### `player/src/pages/playlist.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 312 | A 合法前景 | `class="flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-r from-sky-500 to-blue-600 text-white shadow-2xl transition-transform hover:scale-110"` |
| 342 | A 合法前景 | `class="glass-button accent-gradient px-4 py-1.5 text-xs font-medium text-white"` |
| 460 | A 合法前景 | `class="accent-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-md"` |
| 503 | A 合法前景 | `class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br text-sm font-semibold text-white"` |
| 615 | A 合法前景 | `<span class="icon-[mdi--play] h-7 w-7 text-white"></span>` |
| 620 | A 合法前景 | `class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md"` |

### `player/src/pages/recent.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 102 | A 合法前景 | `color: rgba(255, 255, 255, 0.15);` |

### `player/src/pages/search.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 167 | A 合法前景 | `<span class="icon-[mdi--magnify] h-5 w-5 text-white"></span>` |
| 309 | **B 待处理** | `class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-white/10 hover:text-white"` |
| 317 | A 合法前景 | `class="search-btn flex h-9 shrink-0 items-center gap-1.5 rounded-full px-5 text-xs font-semibold text-white transition-all duration-300 active:scale-95"` |
| 350 | **B 待处理** | `<span class="text-primary/80 group-hover:text-white transition-colors">{{ keyword }}</span>` |
| 388 | A 合法前景 | `? 'bg-gradient-to-br from-sky-500 to-blue-600 text-white'` |
| 390 | A 合法前景 | `? 'bg-gradient-to-br from-sky-400 to-blue-600 text-white'` |

### `player/src/pages/settings.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 129 | A 合法前景 | `<span class="icon-[mdi--palette-outline] h-5 w-5 text-white" />` |
| 146 | A 合法前景 | `<span class="icon-[mdi--translate] h-5 w-5 text-white" />` |
| 163 | A 合法前景 | `<span class="icon-[mdi--image-filter-hdr] h-5 w-5 text-white" />` |
| 186 | A 合法前景 | `<span class="icon-[mdi--music-circle] h-5 w-5 text-white" />` |
| 203 | A 合法前景 | `<span class="icon-[mdi--subtitles-outline] h-5 w-5 text-white" />` |
| 241 | A 合法前景 | `<span class="icon-[mdi--waveform] h-5 w-5 text-white" />` |
| 291 | A 合法前景 | `<span class="icon-[mdi--speedometer] h-5 w-5 text-white" />` |

### `player/src/pages/song.vue`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 125 | A 合法前景 | `class="flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/90 text-white shadow-lg transition-transform hover:scale-110"` |
| 162 | A 合法前景 | `class="inline-flex items-center gap-2 rounded-full bg-sky-500 px-6 py-3 font-medium text-white shadow-lg transition-all hover:bg-sky-600 hover:shadow-xl"` |

### `player/src/stores/modules/settings.ts`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 153 | C 装饰/结构 | `bgColors: ['#000000', '#ffffff', '#808080'],` |
| 250 | C 装饰/结构 | `bgColors: ['#000000', '#ffffff', '#808080'],` |

### `player/src/style/glass.css`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 44 | C 装饰/结构 | `--glass-text-contrast: light-dark(rgba(7, 16, 31, 0.98), rgba(255, 255, 255, 0.98));` |
| 45 | C 装饰/结构 | `--glass-text-accent: rgba(255, 255, 255, 0.98);` |
| 57 | C 装饰/结构 | `--glass-interactive-text-hover: light-dark(rgba(17, 24, 39, 1), rgba(255, 255, 255, 1));` |
| 66 | C 装饰/结构 | `inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);` |
| 135 | C 装饰/结构 | `rgba(255, 255, 255, 0.55) 0%,` |
| 136 | C 装饰/结构 | `rgba(255, 255, 255, 0.3) 100%` |
| 167 | C 装饰/结构 | `box-shadow: 0 1px 0 rgba(255, 255, 255, 0.16) inset, 0 20px 50px rgba(0, 0, 0, 0.35);` |
| 173 | C 装饰/结构 | `box-shadow: 0 1px 0 rgba(255, 255, 255, 0.20) inset, 0 24px 60px rgba(0, 0, 0, 0.45);` |
| 193 | C 装饰/结构 | `background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.01) 100%);` |
| 197 | C 装饰/结构 | `inset 0 1px 1px 0 light-dark(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.22)),` |
| 206 | C 装饰/结构 | `background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.01) 100%);` |
| 210 | C 装饰/结构 | `inset 0 1px 0 0 light-dark(rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.16)),` |
| 218 | C 装饰/结构 | `background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%);` |
| 222 | C 装饰/结构 | `inset 0 1px 0 0 light-dark(rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.12)),` |
| 228 | A 合法前景 | `border-color: light-dark(rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.22));` |
| 230 | C 装饰/结构 | `inset 0 1px 0 0 light-dark(rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.18)),` |
| 236 | C 装饰/结构 | `border: 1px solid rgba(255, 255, 255, 0.4) !important;` |
| 239 | C 装饰/结构 | `inset 0 1px 1px rgba(255, 255, 255, 0.6) !important;` |
| 247 | C 装饰/结构 | `inset 0 1px 2px rgba(255, 255, 255, 0.8) !important;` |
| 275 | C 装饰/结构 | `inset 0 1px 0 rgba(255, 255, 255, 0.2);` |
| 308 | C 装饰/结构 | `background: rgba(255, 255, 255, 0.5);` |
| 489 | C 装饰/结构 | `background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);` |
| 504 | C 装饰/结构 | `conic-gradient(from 20deg, transparent 0 8%, rgba(255, 255, 255, 0.16) 12%, transparent 18% 50%, rgba(255, 255, 255, 0.12) 62%, transparent 68%),` |

### `player/src/utils/imageUrl.ts`

| 行 | 类型 | 代码片段 |
|---:|---|---|
| 7 | C 装饰/结构 | `"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25'…` |

