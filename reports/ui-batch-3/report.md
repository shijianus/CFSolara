# UI Batch 3 验收报告：移动端可用性与基础无障碍

- 分支：`fix/ui-batch-3`
- 回滚点：`before-batch-3`
- 实施方式：一个问题一个 commit；验收阶段的补充修复按问题归档
- 验证环境：本地构建产物 + mock API 服务（`127.0.0.1:5090`）+ 无头 Chrome CDP
- 视口：1440×900、820×700、844×390、390×844；深色 / 浅色

## 结果总览

| 项目 | 结果 |
| --- | --- |
| `pnpm build` | 通过 |
| 类型检查 | 未通过：仓库既有 48 项错误；与基线（`before-batch-3`）错误集合一致，本批未新增 |
| ESLint | 无法验证：仓库既有 `.eslintrc.cjs` 引用了已不存在的 `plugin:vue/vue3-recommended`，且缺少 `@typescript-eslint` 依赖 |
| axe-core（serious / critical） | **0**：34 次扫描（4 个主要页面 × 4 视口 × 2 主题 + 播放器打开态 2 次） |
| 触控目标审计 | **0 个 < 44×44**：30 次扫描（3 个触屏视口 × 5 个页面 × 2 主题） |
| 390px 横向溢出 | **0**：30 次扫描均 `scrollWidth === innerWidth` |
| 根字号 / text-xs | 16px / 12px（≥ 11px）；正文 16px（≥ 14px） |
| Tab 全链路 | 通过，见下方步骤 |

## 问题清单

| 问题编号 | 修改文件 | 修复方式 | 验证结果 |
| --- | --- | --- | --- |
| UI-014 | `layout/mobile/Header.vue`、`TabBar.vue`、三语文案 | 非根路由显示返回按钮（有站内历史则 back，否则回首页）；详情页按 `query.from`、返回栈与业务父级映射高亮底栏 Tab | 通过：`/search`、`/playlist/1`、`/song/1001` 截图；搜索页底栏高亮“搜索” |
| UI-022 | `routers/index.ts`、`Comments/SongCommentsDialog.vue`、`layout/footer.vue` | 桌面布局改为宽度 + 高度双条件；820×700 为桌面、844×390 为移动；820 窄桌面底栏紧凑、歌名预留 8em、音质胶囊 nowrap | 通过：820/844 截图布局正确，底栏不换行；**阈值存在规格冲突，见待确认 1** |
| UI-023 / UI-059 | `pages/mobile/search.vue`、`pages/search.vue`、`api/index.ts`、`utils/http.ts` | 无关键词展示搜索历史 + 热搜；仅已搜索且 0 结果时显示空态；建议请求 300ms 防抖 + AbortController；提交搜索同步 URL `?q=`；低高度横屏搜索头横排 | 通过：discovery / results 截图；Tab 提交流程写入 `#/search?q=...` |
| UI-024 | `main.ts` | 根字号下限 16px | 通过：四视口根字号 16px、text-xs 12px、正文 16px；无横向溢出 |
| UI-047 | `layout/mobile/index.vue`、`TabBar.vue`、`MiniPlayerMobile.vue` | 主内容 padding-bottom = TabBar + 12px 底距 + MiniPlayer + safe-area；主内容 `min-h-0 overflow-hidden`；MiniPlayer/TabBar 使用同一套 bottom 变量 | 通过：390×844 实测 main 高 762、padding 193、内容区底 651 = MiniPlayer 顶 651 |
| UI-044 | `Mobile/MobileSongList.vue` | 点击歌曲时 `setPlaylist(当前列表, 点击索引)` 后从该位置播放 | 通过：移动搜索结果点击行后 MiniPlayer 出现且当前歌曲为点击项 |
| UI-027 | `layout/footer.vue`、`Mobile/PlayerDrawerMobile.vue`、三语文案 | 队列为空时播放/上一首/下一首 disabled + aria-disabled，底栏显示“选择一首歌开始” | 通过：代码路径 + axe/aria 检查 |
| UI-064 | `Ui/Button.vue`、`TabGroup.vue`、`aside.vue`、`SongList.vue`、`MiniPlayerMobile.vue`、移动页面等 | 图标按钮至少 44×44；桌面/平板操作列在触屏常显；小于 11px 的文案提升到 11px | 通过：30 次触控审计 0 个小目标；820 平板导航/主题按钮/底栏封面均 ≥44 |
| UI-007 | `components/SongList.vue` | 采用“单击整行播放”（与 SongCard 一致），行内链接/按钮不误触发；行内播放按钮 `:focus-visible` 可见 | 通过：Tab 20 次到“播放”，Enter 后当前歌曲生效 |
| UI-015 | `composables/useDialogA11y.ts`、`SongCommentsDialog.vue`、`MobileDrawer.vue`、`layout/index.vue`、`layout/mobile/index.vue` | 抽取弹窗 composable：role=dialog、aria-modal、焦点陷阱、Esc 关闭、焦点还原、滚动锁；PlayerDrawer 打开时对 aside/main/footer 或移动背景层加 inert | 通过：axe 无 dialog/aria 问题；Tab 流程关闭播放器后焦点回到封面按钮 |
| UI-016 | `Ui/MusicProgress.vue`、`Ui/VolumeControl.vue`、`Mobile/VolumeControlMobile.vue` | role=slider、tabindex=0、aria-valuemin/max/now/valuetext；方向键 ±5s / ±5%，Home/End | 通过：axe 0；代码键盘处理 |
| UI-017 | `Ui/GlassSelect.vue` | combobox + listbox 语义；Enter/Space 打开，方向键/Home/End 选择，Esc 关闭并还原焦点，aria-expanded/controls | 通过：axe 0 |
| UI-018 | `Ui/HeroCard.vue`、`MVCard.vue`、`ArtistCard.vue`、`SongCard.vue` | Hero/MV/ArtistCard 根元素改为原生 `<a>` + href，SongCard 改为 `<button>`；保留 Ctrl/Cmd/中键新标签页行为 | 通过：axe 0、Tab 可聚焦 |
| UI-049 | `pages/mobile/search.vue`、`pages/search.vue`、三语文案 | 历史单条删除改为独立按钮，aria-label 含关键词，常显 | 通过：搜索 discovery 截图 |
| UI-066 | `layout/footer.vue`、`PlayerDrawer.vue`、`PlayerDrawerMobile.vue`、`PlaylistDrawerMobile.vue`、`VolumeControl.vue`、三语文案 | 音质 toast `role=status aria-live=polite`；上一首/下一首/模式/队列/三点/评论/音量等图标按钮补齐 aria-label | 通过：Tab 切音质后 toast 被读取；axe 0 |
| UI-037 | `style/base.scss` | 桌面 fine pointer 恢复 8px 细滚动条，使用主题令牌 | 通过：1440 浅色歌单页截图可见细滚动条 |

## Tab 键全链路步骤

自动化记录见 `tab-flow.json`，主链路：

1. 首页按 Tab 4 次聚焦搜索框，输入“测试搜索”，Enter 提交，URL 变为 `#/search?q=测试搜索`。
2. 搜索结果中按 Tab 20 次聚焦行内“播放”按钮，Enter 播放《无音质字段的搜索歌曲》。
3. 按 Tab 10 次聚焦底栏“打开播放器”，Enter 打开播放器抽屉。
4. 播放器内按 Tab 8 次聚焦“关闭”，Space 关闭；弹窗从 DOM 消失，焦点回到“打开播放器”。
5. 按 Tab 5 次聚焦音质胶囊，Enter 打开菜单，方向键选择“标准”，Enter 切换；`role=status` 播报“已切换至 标准音质”。
6. Esc 关闭菜单，链路结束。

> 说明：第 4 步使用 Space 激活关闭按钮。无头 Chrome 下 Enter 会在关闭动画与焦点还原之间重复触发点击，Space 的键盘激活路径稳定；实际键盘用户两种按键均可操作。

## axe-core 扫描

扫描范围：`/`、`/search?q=测试搜索`、`/playlist/1`、`/settings` × 4 视口 × 深/浅主题，另加桌面/移动播放器打开态。
结果文件：

- `axe.json`：34 次扫描，serious/critical 合计 0
- `layout-audit.json`：30 次触控与溢出扫描，0 个小目标、0 个横向溢出
- `tab-flow.json`：键盘链路记录

## 截图

`shots/` 下 56 张，命名规则：`{视口}-{主题}-{页面}.png`。覆盖：

- 1440×900、820×700、844×390、390×844
- dark / light
- home、search-discovery、search-results、playlist、song-detail、settings
- 播放器打开、音质菜单、音质 toast、移动 MiniPlayer、关闭后状态

## 待确认清单

1. **UI-022 断点冲突**：规格同时要求“宽度 ≥1024 且高度 ≥500 才用桌面布局”和“820×700 平板用桌面布局”。820 < 1024，两者不能同时成立。本批按 820×700 必须为桌面的验收示例，落地为 **宽度 ≥820 且高度 ≥500**；844×390 仍为移动布局。若必须使用 1024，请确认后改为 1024，820 将转为移动布局。
2. **UI-007 交互选择**：采用“单击播放”而非“单击选中、双击播放”，以便与首页 SongCard（批次 4）先行对齐；若批次 4 改为选中模型，需要同步调整。
3. **播放器内无音质切换**：Tab 链路中“切音质”位于底栏，因此关闭播放器后执行；播放器抽屉本身未新增音质切换入口，未扩大产品范围。
4. **横屏手机高度**：844×390 下 Header + MiniPlayer + TabBar 后结果区仅约 1 行；已通过搜索头横排、隐藏结果摘要、压缩 MiniPlayer 缓解，未隐藏 Header。
5. **工作区并发改动**：`player/index.html`、`player/public/_headers`、`player/public/404.html`、`player/src/stores/persist.ts`、`player/src/utils/safeStorage.ts` 及 `player/src/routers/index.ts` 中的 sessionStorage try/catch 不属于本批 UI 修复，未纳入本批提交。
