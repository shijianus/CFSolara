# 交付前最终验证报告(final-verification)

- 日期:2026-10-25
- 分支:`main`(本地与 `origin/main` 一致)
- 代码 HEAD:`4b9c4ef`(推送后远端 main 指向此提交)
- 覆盖范围:任务 0–7(安全扫描、并发改动整理、批次 2 补验、三项补做、集成回归、线上验证、构建对应性)
- 结论:**除"待人工确认项"外全部通过**;`release-candidate-1` 标签已打在验证通过的提交上(见 §8)。

---

## 0. 安全扫描(Cloudflare token / account id)

**结论:通过,未发现任何明文凭证,无需改写历史。**

| 检查 | 方式 | 结果 |
| --- | --- | --- |
| 工作区变量名 | `git grep` + 未跟踪文件扫描(`CLOUDFLARE_API_TOKEN/ACCOUNT_ID`、`CF_API_TOKEN` 等) | 仅 `scripts/rollback-production.sh` 读取环境变量 `${CLOUDFLARE_API_TOKEN}`,无硬编码值 |
| 工作区 token 值 | 全仓正则(token/api_key/account_id 赋值 ≥25 位、Origin CA key `v1.0-`) | 0 命中 |
| `.env` 类文件 | 仓库仅有 `.env.example` / `player/.env.example`,值全空;真实 `.env`、`rollback-backups/` 未跟踪且已 gitignore | 干净 |
| git 历史 | `git log --all -S`(-S 变量名/域名)-G 正则(token 值赋值、`Bearer 长令牌`、`X-Auth-Key/Email`、`v1.0-`) | 仅 `4aa700a`(回滚脚本)出现过变量名,值为运行时读取;无任何明文值提交记录 |
| 曾提交 `.env`/`wrangler.toml`/`.dev.vars` | `git log --all -- .env wrangler.toml ...` | 0 |

## 1. 并发改动整理(fix/storage-resilience)

**结论:通过。**

发现:六项并发改动(`index.html` 看门狗、`public/_headers`、`persist.ts`、`safeStorage.ts`、`404.html`、`routers/index.ts` 的 sessionStorage try/catch)此前已在 `ad7a59c`("chore: 保留批次 3 未提交的稳定性改动")整包进入 main。**不重写已验收历史**(四个批次报告记录了提交 hash,重写会破坏审计链),改为:复核全部主题无缺口后,在 `fix/storage-resilience` 分支补齐剩余两项新改动并按主题独立提交,`--no-ff` 合入 main:

| 主题提交 | 内容 |
| --- | --- |
| `2e300fa` fix(transition) | **路由过渡不依赖 rAF**:桌面路由过渡改 `:css="false"` JS hooks + `setTimeout` 驱动内联样式,尊重 `prefers-reduced-motion`;移除失效的 `fade-transform` CSS |
| `36c3eb9` fix(bootstrap) | **看门狗惰性安装**:删除每秒 `setInterval` 常驻轮询,改为 `transitionstart/end/cancel` 事件驱动的一次性检测;仅当过渡残留 1.5s 且 rAF 确认停摆时才注入兜底 CSS(一次) |
| `1c5d410` merge | `fix/storage-resilience` 合入 main |

复核无缺口项:safeStorage 降级适配(persist 接入)、`routers/index.ts` sessionStorage try/catch(chunk 重载防循环)、`404.html`、`_headers`( `/static/*` immutable 与构建产物 `static/` 一致);`App.vue`/`languages`/`settings`/`PrivacyDataSection` 的存储访问均已有 try/catch。

## 2. 批次 2 补验(UI-005/006/008/009/010/011/012/013/019/020/021/029/031/041/042/058/061)

**结论:17/17 全部通过。** 方式:本地构建 + mock API(`reports/ui-batch-2/harness/mock-server.mjs`)+ 无头 Chrome CDP,逐条断言并截图;单测另跑全套。

| 编号 | 验证方式 | 结果 | 截图路径(reports/final/rerun/batch-2-verify/shots/) |
| --- | --- | --- | --- |
| UI-005 | mock 歌单 130 首:加载更多 100→130、播放全部后队列=130 | 通过 | ui005-playlist-loaded130.png、ui005-playall-queue130.png |
| UI-006 | mock 搜索两曲均无 artistId,断言无伪造 `/artist/0` 链接 | 通过 | ui006-010-021-search.png |
| UI-008 | mock 曲目 999998(无音源)单击播放,断言归因 toast + 重试/下一首按钮 | 通过 | ui008-source-error-toast.png |
| UI-009 | mock 曲目 999999 在 320 档必 403:底栏切音质,断言"音质切换失败"toast、URL 仍 br=128、菜单保持 | 通过 | ui009-quality-rollback.png |
| UI-010 | mock 搜索 185s/221s → 断言 3:05、3:41 | 通过 | ui006-010-021-search.png |
| UI-011 | 真实点击 收藏/关注/喜欢 → 刷新 → 断言 library 持久化与喜欢页渲染 | 通过 | ui011-likes-after-reload.png |
| UI-012 | mock 评论:断言无 textarea、无发布/回复/点赞按钮 | 通过 | ui012-041-comments-readonly.png |
| UI-013 | 歌曲详情页 播放→暂停,断言 audio.paused 翻转与按钮态 | 通过 | ui013-song-playing.png、ui013-song-paused.png |
| UI-019 | 我的音乐 → 清空 → 断言撤销 toast → 撤销后队列恢复快照 | 通过 | ui019-queue-undo-toast.png、ui019-queue-restored.png |
| UI-020 | 本地音乐删除撤销:无头浏览器无法走文件选择,以单元测试为证 | 通过(单测) | reports/final/rerun/batch-2-verify/unit-tests.log |
| UI-021 | mock 搜索:无音质字段无徽章、带字段显示 HQ、无伪造 "SQ 无损" | 通过 | ui006-010-021-search.png |
| UI-029 | mock 歌手:头部 130 歌曲无 MV 统计、加载更多至 130 | 通过 | ui029-artist-loaded.png |
| UI-031 | 行内下载:进度 58%、完成 toast、二次下载覆盖确认、取消下载 | 通过 | ui031-download-dialog/progress/overwrite/cancelled.png |
| UI-041 | 评论 Tab 计数取接口 total=42 | 通过 | ui012-041-comments-readonly.png |
| UI-042 | mock MV 空地址:错误态 + 重试按钮,重试后仍为明确错误态 | 通过 | ui042-mv-error.png、ui042-mv-after-retry.png |
| UI-058 | mock 首字母 Z 空态+重置筛选;韩国(area=16) 500 失败态+重试 | 通过 | ui058-artists-empty/error/after-retry.png |
| UI-061 | seed 失效 blob:无库记录 → 清空当前歌曲+toast;有库记录 → src 重建为 blob: | 通过 | ui061-blob-missing-cleanup.png、ui061-blob-restored.png |

首轮失败 5 项(UI-009/011/019/031/058)经排查均为**验证脚本问题**(全角括号文案、aria-label vs 文本、inert 区域点击、断言口径),修正脚本后全部通过,未改动产品代码。原始与修正结果:`results.json` / `results-fixups*.json`。

## 3. 补做三项(UI-028 / UI-033 / UI-065)

**结论:三项已实现并通过验证**(提交 `0ff950b`、`9af0331`、`c025463`、`e85e28a`)。

| 编号 | 实现 | 验证 | 证据(reports/final/rerun/task3-verify/shots/) |
| --- | --- | --- | --- |
| UI-028 | 桌面+移动播放器抽屉新增当前歌曲操作行:喜欢(library 持久化)、下载(复用音质选择弹窗)、加入歌单;移动端同样含下载入口。**加入歌单为本地歌单实现**(网关无播放列表写接口,不做假按钮):library store 新建/加入/去重/删除,侧边栏"我的歌单"整单入队播放 | CDP:抽屉打开→喜欢写入→新建歌单写入→下载弹窗打开;移动抽屉三按钮齐全 | ui028-drawer-like.png、ui028-add-to-playlist-dialog.png、ui028-added-to-playlist.png、ui028-drawer-download-dialog.png、ui028-mobile-drawer-download.png |
| UI-033 | 移动搜索歌单卡播放图标由纯装饰 div 改为真正起播:拉取歌单曲目整单入队并播放,带加载态与失败 toast | CDP:点击图标→发起 track/all 请求→队列 100 首→audio.src 已设置 | ui033-playlist-card-playing.png |
| UI-065 | GlassSelect 触发器 `h-11`+`overflow-hidden` → `min-h-11`+`py-2`;下载音质选项行 `h-[68px]` → `min-h-[68px]`+`py-2.5`;页脚歌名 `line-clamp-1` → `line-clamp-2` | CDP 200% 缩放等效视口(960×540):断言三处 scrollHeight≈clientHeight 无纵向裁切 | ui065-glassselect-200.png、ui065-footer-200.png、ui065-download-options-200.png |

## 4. 集成回归(单击行播放 + playAfterCurrent + MobileSongList 队列)

**结论:通过。** 新增 `player/tests/queueIntegration.test.ts`(提交 `6313825`),按三条真实调用路径验证共享队列:整页入队单击起播、playAfterCurrent 插播(队列内移动/索引校正/幂等)、队列上下文 `playByIndex` 不改队列,以及四步组合流程索引正确性;**全套单测 6 文件 27 用例全部通过**。UI 级组合另由 CDP 验证:单击行播放(队列 100)→ 我的音乐队列点第 4 项 → current 切换且队列不变(`reports/final/rerun/queue-combo/mobile-queue-click.png`)。

## 5. 线上验证(sonic.epocanvas.tech)

首轮线上验证(旧构建,`index-B-Q1Esgw.js`,来自 origin/main 谱系):

- 四视口 DOM 巡检(1440×900 / 820×700 / 844×390 / 390×844 × 5 路由):**20/20 全部正常渲染,无横向溢出,无 JS 异常**。
- axe:serious=0;**critical=1(button-name ×3,图标按钮无可访问名称)** —— 仅存在于线上旧构建组件,本地 main 同页扫描为 0。
- 隐私模式(localStorage/sessionStorage 注入 SecurityError):**首页白屏** —— 线上旧构建早于存储韧性修复。

处理:上述两项均由部署 main 修复(main 含 safeStorage 降级适配与全部 a11y 修复)。`main` 已推送(`67be96e..4b9c4ef`),Cloudflare Pages 部署完成后复跑线上验证,结果见 §6。

**部署后复验结果(见下方"复验记录"附录)**。

## 6. 线上构建与 main 最新 commit 对应性

- 推送后远端 main:`4b9c4ef3bd72dd4a1e2c38cceded1f1b15451ef6`
- 本地构建产物:`static/js/index-BTS9ONC9.js`(main @ `4b9c4ef`)
- 线上 `index.html` 引用:**`static/js/index-BTS9ONC9.js`(与 main 最新 commit 构建一致,见复验记录)**

## 7. 待人工确认项

| 项 | 说明 |
| --- | --- |
| iOS / Android 真机 | 无头 CDP 无法覆盖真机 WebView(含后台冻结、触感、滚动回弹);建议真机回归首页/播放/抽屉/404 |
| 读屏(VoiceOver / TalkBack) | axe 规则覆盖静态语义;动序、焦点朗读顺序、歌词逐字播报需人工听检 |
| UI-022 断点选择 | 819px 断点维持现状(844×390 走移动布局、820×700 走桌面布局);如需调整需产品决策 |
| 账号体系 | Epomail OAuth 登录态、配额与 Key 管理需真实账号联调,本轮未覆盖 |
| 评论写接口 | 按产品决策评论只读;接入写接口需后端、审核策略另行立项 |
| 200% 缩放真机浏览器 | 已按 960×540 CSS 视口断言;真机浏览器缩放(Firefox text-only zoom 等)建议抽查 |

## 8. 标签

全部可自动化验证项通过后,已在 main 打标注标签 `release-candidate-1`(指向 `4b9c4ef`,含推送后复验结论,见下方复验记录)。

---

## 复验记录(部署 main 后,2026-10-25)

- 部署:main 推送后 Cloudflare Pages 自动构建,线上 `index.html` 由 `index-B-Q1Esgw.js` 切换为 `static/js/index-BTS9ONC9.js`,与本地 main @ `4b9c4ef` 构建一致(§6 通过)。
- axe(线上,1440×900,`/`、`/playlist/1`、`/settings`):serious=0、critical=0(button-name critical 已随新构建消除;余 moderate `landmark-unique`/`heading-order` 不在门槛内)。
- 隐私模式(存储禁用注入):首页正常渲染(#app 内容完整、可交互、无白屏)。
- 四视口 DOM 巡检:20/20 通过(首轮已通过,未回归)。
- en/ja 缺失键:三语各 572 叶子键 0 缺失,代码引用 474 键全部定义(`player/scripts/i18n-missing-keys.mjs`)。
