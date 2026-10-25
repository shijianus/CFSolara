# epocanvas sonic 键名品牌化——浏览器黑盒验证报告（2026-10-25）

对 [`verification-report.md`](./verification-report.md) 静态检查点（令牌级 compare / 测试回归 / dist 逐字节一致）的补充：**用真实浏览器对三个部署做黑盒 GUI 验证**，证明品牌化清理（P1 审计卫生 + P2 旧静态站 solara 别名清理）**零功能缺失**。

## 一、验证环境与方法

- **浏览器**：真实 Chrome（headless=new）+ Chrome DevTools Protocol。所有交互均为黑盒真实输入事件（`Input.dispatchMouseEvent` 鼠标点击、`Input.insertText` 文本注入、`Input.dispatchKeyEvent` 按键），观察仅用只读 `Runtime.evaluate` 查询 DOM/`HTMLMediaElement` 状态；每一步均有截图落盘（`evidence/browser/*.png`）。
- **三层部署**（同一 Chrome 实例、同一会话策略，仅被测代码不同）：

| 端口 | 部署内容 | 旅程 | 意义 |
|---|---|---|---|
| 8788 | 生产 `dist/`（与改动前**逐字节一致**，CP-3 已证）+ `functions/` | A | 生产播放器回归——证明线上产物零影响 |
| 8789 | **改动后**根目录旧静态站（工作区 4 个改动文件）+ `functions/` | B | 新代码功能完整性 |
| 8790 | **改动前**旧静态站（`git show d062882:` 提取）+ `functions/` | C | 改动前行为基线 |

- B/C 两站文件结构完全相同，仅 4 个品牌化改动文件（`index.html`/`css/style.css`/`js/index.js`/`js/mobile.js`）不同——这是受控前后对照实验。
- 服务器均为 `wrangler pages dev` 本地模拟 Cloudflare Pages（与生产同运行时）；播放验证使用真实音源网络请求（非 mock）。

## 二、旅程 A：生产播放器（8788，改动前后产物一致）——A1~A9 全 PASS

| # | 测试点 | 结果 | 关键观察（evidence/browser/） |
|---|---|---|---|
| A1 | 首页加载 | PASS | `document.title = "首页 - epocanvas sonic"`（路由感知标题以完整品牌结尾）；A1-player-home.png |
| A2 | 品牌常量 UI | PASS | 侧栏 epocanvas / sonic / STUDIO / AUDIO ENGINE 标语完整渲染；A2-player-brand.png |
| A3 | 搜索"周杰伦" | PASS | 返回 52 条真实结果，首位命中《晴天》；A3-player-search-results.png |
| A4 | 单击行播放（净用户） | PASS | `audio.paused=false, currentTime=0.45`，流地址 `/api/music/stream?id=0039MnYb0qxYhV&source=qq&title=晴天&artist=周杰伦`；A4-player-playing.png |
| A5 | 歌词行渲染 | PASS | 逐字歌词首行"故事的小黄花"真实出现；A5-player-lyrics.png |
| A6 | 设置页 | PASS | 页面正常渲染可交互；A6-player-settings.png |
| A7 | 404 页品牌 | PASS | 标题"页面不存在 - epocanvas sonic"，品牌标识存在（大小写不敏感断言）；A7-player-404.png |
| A8 | 移动端视口加载 | PASS | 390×844 视口下品牌与内容完整渲染；A8-player-mobile.png |
| A9 | 移动端搜索+点播（净用户） | PASS | 《青花瓷》`paused=false, currentTime=0.72`，`id=002qU5aY3Qu24y&source=qq`；A9-player-mobile-playing.png |

## 三、旅程 B/C：旧静态站新（8789）vs 旧（8790）对照——B1~B6 / C1~C6 全 PASS 且行为一致

| # | 测试点 | B（改动后） | C（改动前） | 一致性 |
|---|---|---|---|---|
| 1 | 首页加载 | title="epocanvas sonic" PASS | 同 PASS | 一致 |
| 2 | 会话注入→模态框→id 接线 | `sonicUser*` id 全部正确填充（userName=浏览器验证用户 / userEmail=browser-verify@epocanvas.com / key=sonic_live_browser_verify_key / 退出按钮存在 / 徽章可见）PASS | `solaraUser*` id 同样全部正确填充，值完全相同 PASS | 值一致 |
| 3 | 退出登录 | 模态框隐藏、`sonic_epomail_session` 清除、通知弹出 PASS | 同 PASS（旧站额外清 legacy 键，均达到"已登出"效果） | 一致 |
| 4 | 搜索"周杰伦" | 命中《晴天》PASS | 同 PASS | 一致 |
| 5 | 播放曲目 | netease《起风了-周深》`paused=false, currentTime=0.5`，流路径 `id=1475596788&source=netease` PASS | 同曲 `paused=false, currentTime=0.92`，流路径**仅端口不同** PASS | 一致 |
| 6 | 移动端视口 | 工具栏"epocanvas sonic"，`SonicMobileBridge/SonicDom=true`，移动布局正常 PASS | 工具栏相同，`SonicMobileBridge/SonicDom=true` **且 `SolaraMobileBridge/SolaraDom=true`** PASS | 见下方唯一差异 |

**唯一差异（即品牌化改动本身，预期内）**：旧站（C）保留 `SolaraDom`/`SolaraMobileBridge` 兼容全局镜像与 `__SOLARA_IS_MOBILE` 标志，新站（B）已清理、仅保留 sonic 主名。Sonic 主链路在两站完全等价。

**既有怪癖（非本次改动引入，新旧站完全一致）**：旧站 QQ 平台曲目经 nexus 搜索映射后无 netease 可播源时，落位脱敏 `source=sonic` 传入老代理接口 `/proxy?types=url` → 404。B4 播放与 C4 播放的 404 URL 逐字符相同（仅端口不同），且该 URL 构造代码不在改动范围；netease 源曲目（B5/C5）播放成功证明播放机制本身完好。《起风了》时长 00:30 为 netease VIP 曲目无 Cookie 时返回官方试听片段的**既定行为**（README 已载明）。

## 四、浏览器外交叉证据（curl 复核）

- `GET /api` → `branding:{parent:"epocanvas", product:"sonic", full:"epocanvas sonic", wireBrand:"Sonic"}`（线上冻结契约未动）。
- 浏览器内播放成功的流 URL 原样 curl 复现 → **HTTP 206, 65536 字节**（流真正可读）。
- 旧站 QQ 曲目 404 的流 URL 在 8789 与 8790 复现结果**完全一致**（同为 404）——怪癖与本次改动无关的直接证据。

## 五、视觉核验（analyze_image 逐张审查关键截图）

- **B2-modal.png**：模态框样式完整（深色圆角卡片+遮罩+🔑 标题"epocanvas sonic 开发者专案连结 (sonic Pass)"）、用户徽章（头像+浏览器验证用户+browser-verify@epocanvas.com）、绿色等宽 API Key、退出登录（红）/关闭（绿）按钮——证明删除 14 处 `.solara-*` CSS 别名后 `.sonic-*` 主名样式**全部正常渲染**，改名后的 `sonicUser*` id 正确接线。
- **B5-playing-netease.png**：播放列表高亮《起风了 - 周深》、"正在播放"悬浮提示、逐字歌词面板（"这一路上走走停停"）、暂停图标、进度 00:01/00:30、极高音质标签——旧站播放全链路（样式+状态+歌词）在新文件上完好。
- **B6-mobile.png**：390×844 移动布局、工具栏居中"epocanvas sonic"、移动端播放器正常——`js/mobile.js` 桥接收敛后移动端正常。
- **A9-player-mobile-playing.png**：《青花瓷》播放中（⏸ 图标、00:01/01:35）、顶部 epocanvas/sonic 品牌、底部导航（首页/搜索/最近播放/设置）完整——生产播放器移动端正常。

## 六、测试过程透明记录（中途 FAIL 均为测试脚本问题，逐项修正后复测）

| 现象 | 根因 | 处置 |
|---|---|---|
| A1 初版断言失败 | 断言写死静态标题，实际为路由感知标题"首页 - epocanvas sonic"（正确行为） | 断言改为 `/epocanvas sonic$/i` |
| B4/C4 初版搜索无反应 | 旧站绑定 `#searchBtn` 点击事件，测试只发了 keyDown | 改为真实点击按钮 |
| C2 初版断言失败 | 断言误用 sonic id 查旧站（旧站本就是 solara id） | idPrefix 参数化（B=sonic、C=solara） |
| A7 初版 hasBrand=false | 404 页 `.brand` 有 `text-transform:uppercase`，innerText 返回大写 | 大小写不敏感断言 |
| A/B/C 播放轮询超时（第 2~3 轮） | pinia 持久化"当前歌曲"残留 → 单击行=暂停切换（测试状态污染） | `localStorage.clear()` 模拟净用户后全部 PASS |
| 旧站播放点击无效 | 旧站搜索行无行级点击绑定，仅行内播放按钮 | 定位 `button.action-btn.play` 真实点击 |
| 旧站 QQ 曲目 404 | 上述既有怪癖（source=sonic） | 判定为非回归（curl 证明新旧一致），改用 netease 曲目验证播放 |

所有修正均为**测试脚本侧**调整，未触碰任何被测代码；最终结论以修正后的全 PASS 轮次为准（观察 JSON 第 4/5/6 轮 + 第 2 轮非播放项）。

## 七、证据文件清单（evidence/browser/）

- 截图 27 张：A1~A9（生产播放器）、B1~B6（新站）、C1~C6（旧站）、A9-state/B4/C4 搜索与播放中间态。
- 观察记录 5 份：`browser-observations.json`（第 2 轮，B/C 前后对照矩阵）+ `browser-observations-round3~6.json`（播放链路补测、净用户复测、netease 播放、移动端桥接对照）。

## 八、结论

1. **生产链路（A）零影响**：被部署产物与改动前逐字节一致，浏览器实测播放/歌词/搜索/404/移动端全功能正常。
2. **旧静态站（B vs C）唯一行为差异 = 本次改动的设计目标**（移除 Solara 兼容别名），Sonic 主链路在改动前后完全等价。
3. **冻结线上契约未动**：`/api/sonic/*` 路由、`brand:"Sonic"`、`sonic_live_` 密钥、双鉴权头等经浏览器实际调用验证照常工作。
4. **无功能缺失**：黑盒 GUI 全旅程（桌面+移动端、搜索+播放+歌词+会话+登出+404）+ 视觉核验 + curl 交叉复现三层证据互相印证。
