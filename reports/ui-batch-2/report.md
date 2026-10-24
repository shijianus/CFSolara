# UI Batch 2 — 消除“假功能”和静默失败

- 分支：`fix/ui-batch-2`
- 基线与回滚标签：`before-batch-2`（指向 `e1ae74e`）
- 本批提交：`before-batch-2..HEAD` 共 25 个提交（24 个代码/测试 + 1 个报告提交）；55 个代码/配置/测试文件，含报告截图共 119 个文件
- 验证环境：本地构建产物 + 本地 mock API/音频（`harness/mock-server.mjs`），无头 Chrome CDP，四个视口 × 深/浅主题

## 结果总表

| 问题编号 | 修改文件 | 修复方式 | 验证结果 |
|---|---|---|---|
| UI-005 | `player/src/pages/playlist.vue`、`player/src/pages/mobile/playlist.vue`、三语 i18n | 歌曲按 `limit/offset` 分页追加；Tab 歌曲数改用详情 `songCount`；播放全部/随机前循环补齐完整列表；失败时提示仅播放已加载部分。 | 通过：初始 100 首，点击播放全部后队列长度 130；加载更多后显示 `130 / 130`。 |
| UI-029 | `player/src/pages/artist.vue`、`player/src/pages/mobile/artist.vue`、`player/src/api/index.ts`、`functions/_lib/sonic/upstream.ts`、三语 i18n | 歌曲/专辑加载更多；新增 `/artist/songs` 转发并让 `/artist/album` 支持 offset；隐藏无入口的 MV 统计。 | 通过：歌手页 50 → 100 首可继续加载；专辑 12 张可继续加载；头部不再显示 MV 数。 |
| UI-010 | `player/src/utils/transformers.ts`、`player/src/pages/song.vue`、`player/src/pages/album.vue`、`player/src/pages/mobile/song.vue`、`player/src/pages/mobile/album.vue`、`player/tests/transformers.test.ts` | `transformSong` 统一输出毫秒；其余详情/专辑入口补 `normalizeDurationMs`；formatDuration 调用点统一按毫秒。 | 通过：单测覆盖 `dt` 毫秒与 `duration` 秒；搜索页 185/221 秒显示 `3:05`/`3:41`。 |
| UI-021 | `player/src/components/Search/SearchSongs.vue`、`player/src/pages/mobile/search.vue`、`player/src/utils/transformers.ts`、`functions/_lib/sonic/upstream.ts`、`player/tests/transformers.test.ts` | 删除缺失音质默认 `SQ` 和缺失时长默认 200 秒；不再伪造 `qualities`；后端 nexus 搜索兜底也不再补 200 秒。 | 通过：无音质字段的搜索歌曲不显示徽章；移动歌单不再满屏假 `SQ 无损`；单测断言缺失音质为空。 |
| UI-041 | `player/src/pages/playlist.vue` | 评论 Tab 使用接口 `total`；切换歌单先重置评论数组/分页/总数，并用请求序号丢弃旧响应。 | 通过：评论 Tab 显示 42（接口 total），不再显示已加载的 20；切歌单重置逻辑已实现。 |
| UI-006 | `player/src/components/Search/SearchSongs.vue`、`player/src/pages/mobile/search.vue`、`player/src/components/SongList.vue` | 保留真实 `artistId`；无 ID 时渲染纯文本，不再生成 `id=0` 链接。 | 通过：搜索 mock 无 artistId 的歌曲显示纯文本；有 ID 时保留 `/artist/:id`。 |
| UI-011 | `player/src/stores/modules/library.ts`、`player/src/stores/persist.ts`、`player/src/layout/aside.vue`、`player/src/pages/likes.vue`、`player/src/pages/mobile/likes.vue`、`player/src/pages/mobile/recent.vue`、`player/src/components/SongList.vue`、`player/src/pages/{artist,mobile/artist,playlist,mobile/playlist,mobile/album,mobile/song}.vue`、`player/tests/libraryStore.test.ts`、三语 i18n | 新建 Pinia + localStorage `library` store：喜欢歌曲、收藏歌单、关注歌手、MV 点赞、收藏专辑；所有相关按钮读写 store；喜欢页读 store；侧边栏和移动“我的音乐”加入入口。 | 通过：喜欢/收藏/关注/MV 点赞后刷新仍保留；喜欢页显示 1 首歌、1 个歌单、1 个 MV；侧边栏出现收藏歌单。 |
| UI-012 | `player/src/pages/playlist.vue`、`player/src/pages/mv-player.vue`、`player/src/components/Mobile/PlaylistCommentsPopup.vue`、`player/src/components/Comments/SongCommentsDialog.vue` | 删除发布框；评论点赞/回复改为只读展示；无处理函数的按钮全部移除。 | 通过：评论页无 textarea、无发布/回复按钮、无点赞按钮；仍显示评论总数与点赞数。 |
| UI-043 | `player/src/pages/mv-player.vue`、`player/src/pages/mv-list.vue`、`player/src/pages/mobile/mv-player.vue` | MV 点赞接入 library store；移动 MV 详情补点赞；点赞状态跨刷新保留。 | 通过：桌面列表/详情、移动详情点赞均写入 store；喜欢页出现 MV 条目；刷新后保留。 |
| UI-061 | `player/src/stores/modules/audio.ts`、三语 i18n | 恢复当前歌曲时检测 `blob:` URL，从下载库/本地音乐库重建；取不到则移除队列项、清空当前歌曲并 toast。队列中后续点到的失效 blob 同样处理。 | 通过：seed `restore-1` + 失效 blob，刷新后 audio.src 变为新 blob URL；seed `missing-1`，刷新后 currentSong 清空并提示“本地文件已不可用”。 |
| UI-008 | `player/src/stores/modules/audio.ts`、`player/src/stores/modules/toast.ts`、`player/src/components/Ui/GlobalToast.vue`、`player/src/App.vue`、三语 i18n、`player/tests/playbackErrors.test.ts` | 新增全局 Toast；播放错误归因 network/source/copyright，toast 提供“重试/下一首”；同一歌曲同类错误 10 秒节流；恢复历史歌曲不再自动 load 误报。 | 通过：音源 404 时出现“音源不可用”toast，含重试/下一首；三类归因单测通过。 |
| UI-009 | `player/src/stores/modules/audio.ts`、`player/src/layout/footer.vue`、三语 i18n、`player/tests/audioQuality.test.ts` | `switchQuality` 先验证新源 ready/play 成功再提交 URL/徽章；失败回滚旧源并抛错；底栏成功后才关菜单/提示，失败保留菜单并弹错误。 | 通过：失败场景 URL 仍为 `br=128`、徽章未变、toast“音质切换失败”、菜单保持打开；两个单测覆盖成功提交与失败回滚。 |
| UI-013 | `player/src/pages/song.vue`、`player/src/pages/mobile/song.vue` | 当前歌曲播放中点击播放按钮调用 pause；暂停后点击 resume；同步图标与 aria-label。 | 通过：桌面/移动均验证 `audio.paused` 由 false 变 true，按钮由“暂停”变“播放”。 |
| UI-019/020 | `player/src/composables/useAudio.ts`、`player/src/stores/modules/audio.ts`、队列清空入口、`player/src/stores/modules/localMusic.ts`、`player/src/components/Settings/LocalMusicSettings.vue`、三语 i18n、`player/tests/localMusicUndo.test.ts` | 清空队列改为“立即执行 + 5 秒撤销”，恢复队列/当前歌曲；删除本地音乐同样撤销回填 IndexedDB 与原位置。 | 通过：清空后出现撤销 toast，撤销后队列恢复为 1；本地删除回填单测通过。 |
| UI-031 | `player/src/stores/modules/download.ts`、`player/src/components/Dialog/DownloadQualityDialog.vue`、三语 i18n | XHR 下载进度、取消、完成提示；同曲同音质下载先查库并弹覆盖确认；失去用户手势时持久提示“手动保存”。 | 通过：进度条显示 83%（4.2/5.0 MB）并可取消；同音质二次下载出现覆盖确认；完成 toast 提供手动保存；IndexedDB 计数 1。 |
| UI-042 | `player/src/pages/mv-player.vue`、`player/src/pages/mobile/mv-player.vue`、三语 i18n | 无 URL 或 Artplayer error 时展示错误文案和重试按钮；重试重新拉取 URL 并重建播放器。 | 通过：桌面/移动均显示“暂无可播放的 MV 地址 + 重试”，不再无限转圈。 |
| UI-058 | `player/src/components/Ui/InfiniteScroll.vue`、`artists.vue`、`new-albums.vue`、`mv-list.vue`、`playlist.vue`、三语 i18n | 区分空结果与加载失败：空结果显示“暂无结果 + 重置筛选”；失败显示“加载失败 + 重新加载”；初始请求失败也进入错误态。 | 通过：歌手页 Z 首字母显示空态与重置；韩国筛选 500 显示加载失败与重试；重置后恢复列表。 |

## 验收证据

- 播放全部完整队列：`queue = 130`，页面显示 `已加载 130 / 130 首`。
- 评论：Tab 显示 `评论 42`，只读；无 textarea、无回复/点赞按钮。
- 歌手：`130 歌曲 / 15 专辑`，无 MV 统计；50 首初始后“加载更多”到 100。
- 搜索：无音质字段的歌曲无徽章；`185` 秒 → `3:05`，`221` 秒 → `3:41`。
- 喜欢：刷新后 `library` 中 `likedSongs=1`、`collectedPlaylists=1`、`followedArtists=1`、`likedMvs=1`。
- 音质失败：toast“音质切换失败，已恢复原音质”；当前歌曲 URL 仍为原 `br=128`，菜单仍打开。
- 下载：进度 83% / 取消 toast / 覆盖确认 / 完成或手动保存提示均出现；IndexedDB 已写入 1 条。
- Blob 恢复：成功时 `audio.src` 为新 `blob:` URL；失败时 currentSong 清空、队列项移除并提示。
- 无限滚动：空态和错误态均可重置/重试。

## 验证命令

| 检查 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `cd player && pnpm test` | **通过**：5 个测试文件、21 个测试全部通过 |
| 类型检查 | `cd player && pnpm exec vue-tsc --noEmit` | 未完全通过：**48 个仓库既有错误**（基线 `before-batch-2` 为 69 个，本批净减少 21 个；剩余集中在 http/useLyrics/localMusic 等既有代码，本批新增逻辑无错误） |
| Lint（仓库脚本） | `cd player && pnpm lint` | **无法验证**：仓库使用 ESLint 9 但只有 `.eslintrc.cjs`，且引用了不存在的 `plugin:vue/vue3-recommended`；属既有配置问题 |
| Lint（本批变更文件） | 临时 flat config + `eslint` 仅检查 `before-batch-2..HEAD` 的 `.vue/.ts` | **0 errors**（724 条既有模板风格 warning，未自动 fix 避免扩大 diff） |
| 构建 | `cd player && pnpm build` | **通过**：`✓ built in 14.65s` |
| 截图 | 本地 mock + 无头 Chrome CDP | 4 视口 × 深/浅主题核心页面 40 张 + 关键状态 20+ 张；文件尺寸已校验为 1440×900 / 820×700 / 844×390 / 390×844 |

## 截图与前后对比

- 桌面前后对比拼图：[acceptance-desktop-before-after.png](./acceptance-desktop-before-after.png)
- 移动前后对比拼图：[acceptance-mobile-before-after.png](./acceptance-mobile-before-after.png)
- 关键状态拼图：[acceptance-states.png](./acceptance-states.png)
- 本批全部原图（当前版本）：[shots](./shots)
- 基线 `before-batch-2` 原图：[before](./before)
- 复现用 mock 服务与截图脚本：[harness](./harness)
- 原始日志：[logs](./logs)

## 待确认清单

1. **844×390 仍走桌面布局**：路由断点固定为 `max-width: 768px`，844 宽会被视为桌面端；首屏只显示歌单头部，操作与列表需滚动。本批未改全局断点，以免影响所有页面。
2. **浅色主题歌单分类徽章对比度偏低**：`playlist.vue` 沿用既有 `text-white` + `accent-gradient`，在浅色主题下“华语”徽章发白；属既有样式，本批未改。
3. **同曲不同音质会覆盖单条下载记录**：IndexedDB `downloaded_music` 以歌曲 id 为主键，UI-031 只对“同曲同音质”询问覆盖；不同音质仍会替换旧记录。需要时再调整复合主键/多版本存储。
4. **ESLint 9 配置迁移**：官方 `pnpm lint` 仍不可用，本批用临时 flat config 验证变更文件；建议单独开 chore 修复配置。
5. **本地音乐删除撤销的 UI 自动化**：无头浏览器不支持文件选择，无法通过真实上传路径造数据；已用 `localMusicUndo.test.ts` 覆盖删除 → 回填 IndexedDB → 恢复原位置逻辑。
6. **艺术家 MV 入口**：按默认方案隐藏 MV 统计；后续若增加 MV Tab/入口，再从 `artistMv` 恢复统计。
7. **评论写接口**：当前按产品决策只读；若后续接入评论发布，需要后端写接口、登录态与审核策略。
8. **`formatDate` 中文日期后缀**：喜欢页时间在 en/ja 下仍可能出现“月日”中文格式，属既有 i18n 问题，未在本批处理。
