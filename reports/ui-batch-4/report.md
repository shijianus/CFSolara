# UI 批次 4 验收报告：一致性、国际化、动效

- 分支：`fix/ui-batch-4`
- 回滚点：`before-batch-4`（指向批次 3 HEAD `2761359`）
- 构建：`player/pnpm build` 通过
- 截图：`reports/ui-batch-4/screenshots/`，共 80 张
- 验证页：`/`、`/settings`、`/downloads`、`/song/:id`、404、`/local-music`、`/playlist/:id`、`/mv-list`、`/recent`
- 视口：1440×900、820×700、844×390、390×844；浅色 / 深色

> 说明：部分问题共享同一组件文件（如 `aside.vue`、`settings.vue`、`HeroCard.vue`）。为保证每个提交可独立构建、可回滚，提交按文件域合并，commit message 中列出该提交覆盖的 UI 编号。

## 验收表

| 问题编号 | 修改文件 | 修复方式 | 验证结果 |
| --- | --- | --- | --- |
| UI-039 / UI-040 / UI-054 | `src/languages/**`、`src/utils/time.ts`、`transformers.ts`、`qualityProbe.ts`、`blobMetadataParser.ts`、`useLyrics.ts`、`layout/footer.vue`、`SongList.vue`、`PlaylistBubble.vue`、`routers/index.ts`、`song.vue`、`not-found.vue` 等 | 三语补齐 169/169/174 个键；vue-i18n 增加 `missing` 回调（开发期 `console.error` + `[missing:key]`）；日期/数字改用 `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat` 并跟随语言；音质菜单、下载弹窗、歌曲页、404、性能模式等硬编码文案全部走 i18n | 通过 |
| UI-032 | `Dialog/DownloadQualityDialog.vue`、`downloads.vue`、`mobile/downloads.vue` | 下载弹窗改为 `--glass-*` 主题令牌；移动端删除从原生 `confirm()` 改为与桌面一致的自定义 `role=dialog` 弹窗（`useDialogA11y`、Esc/遮罩关闭、焦点还原） | 通过；见 `download-dialog-*`、`download-delete-390x844-dark.png` |
| UI-026 | `stores/modules/audio.ts`、`useAudio.ts`、`Ui/SongCard.vue` | 新增 `playAfterCurrent`：保留现有队列，把目标曲目移到当前曲之后并播放；首页 SongCard 不再 `setPlaylist([song])`；卡片增加 `aria-current`、当前播放封面遮罩/频谱标记和标题高亮 | 通过；队列实测 6 首 → 6 首、当前曲切到 Neon River、索引 1（`queue-test.json`） |
| UI-034 | `layout/aside.vue`、`layout/mobile/Header.vue` | 主题按钮补 i18n 文案 tooltip、`aria-label`、`aria-pressed`；移动端按钮显示当前模式文字（浅色/暗黑/跟随系统） | 通过；见移动端截图顶部“暗黑模式” |
| UI-035 | `layout/aside.vue`、`layout/mobile/Header.vue` | 基于 `window.history.state.back/forward` 计算可用性，禁用不可用前进/后退按钮，并在路由变化、`popstate` 时同步 | 通过 |
| UI-036 | `layout/aside.vue`、`layout/mobile/TabBar.vue` | 侧边栏“最近播放”改指向 `/recent`；移动 Tab 与桌面统一使用“最近播放”；当前代码中未发现 `userPlaylists` 假数据，无需删除 | 通过（假数据项：现状不存在） |
| UI-038 / UI-063 | `Ui/HeroCard.vue`、`MVCard.vue`、`ArtistCard.vue`、`directives/animations.ts`、`utils/motion.ts`、`useSharedElement.ts`、`pages/index.vue`、`pages/mobile/index.vue`、`pages/mobile/recent.vue` | 卡片转场压缩到 ≤250ms；动画期间再次点击直接忽略，不再重复 `router.push`；GSAP 指令/共享元素/卡片悬浮在 `prefers-reduced-motion` 下关闭；Swiper 关闭自动轮播和过渡；首页/移动首页轮播增加暂停按钮，hover/focus 暂停；`v-scroll-in` 增加 2 秒强制显示兜底 | 通过；reduced-motion 下 `autoplayRunning=false`、隐藏 stagger 元素 0、activeIndex 不变；hover 暂停/离开恢复均为 true |
| UI-030 | `pages/index.vue`、`Ui/HeroCard.vue` | 推荐歌单网格改为 `xl:grid-cols-6`；卡片 `min-width: 140px`；标题保持 12px、统计保持 ≥11px | 通过；1440 六列、820 三列且卡片宽度 ≥140px |
| UI-045 | `pages/settings.vue`、`pages/mobile/settings.vue` | 超过 2 种歌词语言时 toast 提示并拒绝；取消最后一种时自动关闭底部歌词并提示至少保留一种 | 通过（代码路径 + Toast 组件） |
| UI-046 | `pages/mobile/settings.vue` | 背景选项 3 列改 2 列；新增音频可视化（底部/抽屉开关 + 类型）；底部歌词开关原已存在，保留 | 通过；见 `settings-390x844-*`、`settings-privacy-390x844-dark.png` |
| UI-050 | `pages/playlist.vue`、`pages/mv-player.vue`、`pages/mv-list.vue` | 分享 URL 统一 `router.resolve({ name, params }).href` + `new URL(..., location.origin)`；MV 列表分享从 `console.log` 改为 Web Share / 剪贴板 + Toast | 通过（代码审查） |
| UI-051 | `layout/footer.vue`、`SongList.vue`、`MobileSongList.vue`、`downloads.vue`、`DownloadQualityDialog.vue` | 移除按字符数 `slice(...)` 的硬截断，统一 CSS `line-clamp-1`；通过 `title` 提供全文 | 通过 |
| UI-052 | `pages/downloads.vue`、`SongList.vue` | 表头补透明边框对齐数据行；下载表重排为 `1/4/2/2/1/2` 的 12 列，解决 820px 下专辑/音质/大小列重叠；大小列 `whitespace-nowrap` | 通过；见 820×700 下载页截图 |
| UI-053 | `pages/mv-list.vue` | 分类为“全部”时不再渲染每张卡片的“全部”徽章 | 通过 |
| UI-055 | 无代码改动 | 复查品牌区、卡片播放量/曲目统计均为 11px 或以上；全库无 8/9/10px 文本 | 通过（现状已满足） |
| UI-056 | `components/Settings/PrivacyDataSection.vue`、`settings.vue`、`mobile/settings.vue`、`utils/indexedDB.ts` | 新增“隐私与本地数据”区块，说明 localStorage / IndexedDB 保存内容；提供“清除全部本地数据”按钮，自定义确认弹窗后清理 localStorage、sessionStorage、IndexedDB 并重载 | 通过；见 `settings-privacy-*.png` |
| UI-060 | `components/Settings/LocalMusicSettings.vue` | 导入后展示成功数量，并列出被跳过/失败的文件及原因（非音频、重复文件、读取失败） | 通过（代码路径 + 构建；未自动化导入真实音频） |
| UI-062 | `SongCommentsDialog.vue`、`Mobile/PlaylistCommentsPopup.vue` | 评论 `user` 全部改为可选链；无头像显示默认图标；无昵称回退到 `comments.user` | 通过 |
| UI-025 | `components/Auth/LoginDialog.vue`、`stores/modules/user.ts` | 本期不做账号，删除未被引用的登录弹窗与用户 Store | 通过；构建/类型检查无残留引用 |

## i18n 验收

- 三语键位：557 / 557 / 557，互相缺失 0。
- en / ja 全站 9 条路由 × 2 视口扫描：原始 key 0、`[missing:]` 0；en 无连续中文；ja 无中文界面词残留。
- 详细结果见 `i18n-scan.md`、`i18n-sweep.json`。

## 动效验收

- `prefers-reduced-motion: reduce`：
  - 首页轮播 `autoplay.running = false`；
  - 5.2 秒后 activeIndex 仍为 0；
  - 2.4 秒后 `v-scroll-in` 兜底生效，隐藏 stagger 元素数量 0；
  - 轮播暂停按钮存在。
- 普通模式：鼠标进入轮播区暂停（`pausedOnHover=true`），离开后恢复（`runningAfterLeave=true`）。

## 工程验证

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `cd player && pnpm build` | 通过（约 35s） |
| 类型检查 | `cd player && pnpm exec vue-tsc --noEmit` | 未通过：43 个既有错误（`build/plugins.ts`、`three` 类型、`http.ts`、`useLyrics.ts` 等），本批修改文件无新增错误；详见 `typecheck.log` |
| Lint | `cd player && pnpm lint` | 无法执行：仓库仍是 `.eslintrc.cjs`，ESLint 9 默认查找 flat config；`ESLINT_USE_FLAT_CONFIG=false` 下又缺少 `eslint-plugin-vue` 的 legacy 配置。详见 `lint.log` |

## 截图清单

- 72 张矩阵截图：9 条路由 × 4 视口 × 2 主题。
- 8 张状态截图：下载音质弹窗（浅/深）、移动删除确认、桌面/移动隐私区块、首页热门歌曲与当前播放状态。
- 路径：`reports/ui-batch-4/screenshots/`。

## 待确认清单

1. **820px 歌曲详情页**：封面固定 288px + 右侧信息导致播放/评论按钮横向溢出。该布局问题在本批开始前已存在，且不在本批 UI 清单内，未修改；建议单列一个响应式修复项。
2. **`/my-music` 路由**：侧边栏改指 `/recent` 后，`/my-music` 仍保留但无主导航入口。是否删除或重定向到 `/recent` 属产品决策，本批未处理。
3. **ESLint 配置**：需迁移到 `eslint.config.js`，否则 lint 无法在 CI 运行。
4. **既有类型错误 43 个**：主要集中在 Three.js 类型、HTTP 泛型、旧歌词合并类型和未使用变量，建议独立清理批次。
5. **UI-036 假数据**：当前仓库未找到 `userPlaylists` 相关假数据；如果审计基于旧版本，可视为已被移除。
6. **UI-055**：当前代码已满足 ≥11px，无实际改动。

## 提交记录

```
ad7a59c chore: 保留批次 3 未提交的稳定性改动
5ea26c1 fix(UI-039/040/054): 补齐 i18n 键、Intl 日期数字与全站文案
868a956 fix(UI-032/051/052): 下载弹窗主题化、移动删除确认与列表对齐
51191a4 fix(UI-026): 歌曲点击保留队列并显示当前播放标记
dfe5531 fix(UI-034/035/036): 主题与历史导航状态、最近播放命名统一
a7728e9 fix(UI-030/038/063): 卡片尺寸、转场时长与动效降级
07f2cd6 fix(UI-045/046/056): 歌词语言上限、移动设置补全与隐私数据区块
da56f88 fix(UI-050/053): 分享链接使用 router.resolve 并隐藏冗余全部徽章
b34f235 fix(UI-060/062): 本地导入失败清单与评论用户兜底
d5eb9bc fix(UI-025): 移除未使用的登录弹窗与用户 Store
c703929 fix(UI-026): 播放标记颜色改用主题令牌
```
