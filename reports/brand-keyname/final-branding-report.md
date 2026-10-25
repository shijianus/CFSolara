# epocanvas sonic 品牌化打磨——最终报告

- 日期：2026-10-25
- 分支：`brand/epocanvas-sonic-final`（基于 `security/fix-auth-ratelimit-ssrf` / `7030de2`）
- 状态：改动已落盘，**尚未提交**，便于逐项复核与回滚
- 品牌规范：总品牌 `epocanvas` / 分品牌 `sonic` / 完整品牌 `epocanvas sonic`

## 1. 执行摘要

本轮完成三组改动，全部为**展示文案、注释、日志前缀、文档、审计工具**层面；运行时契约（API 路由、wire brand、请求头、环境变量、密钥格式、存储键、缓存键、容器名）零改动。

| 项目 | 结果 |
| :--- | :--- |
| 品牌审计 | `--verify` 从 **FAIL 7 项 → PASS** |
| 受保护键名对比 | `--compare-tokens` **PASS**（路由/wire brand/鉴权/存储/缓存/部署标识零差异） |
| 受保护文件差异审计 | 18 文件、58 行改动：41 注释 + 14 日志 + 2 行内注释 + 1 个死类型字段；**0 违规** |
| 根测试 | **261 / 261 PASS**（网关 51 + 鉴权 66 + 封面 15 + 本地引擎 59 + 安全 70） |
| 前端测试 | **27 / 27 PASS**（6 个测试文件） |
| TypeScript | `tsc --noEmit` PASS |
| 生产构建 | 连续两次 **267 文件逐字节一致** |
| 产物品牌扫描 | `solara/cfsolara/shijianus/EpoCanvas/EpoMail` 精确大小写 **0 命中**；`epocanvas sonic` 14 处；旧日志前缀 `[Sonic ` 0 处 |
| 浏览器回归 | 桌面/移动端 7 个旅程 **7/7 PASS**；标题全部以 `epocanvas sonic` 结尾 |
| 旧静态站 | `EpoMail` 2→0，`Epomail` 0→2；弹窗品牌完整 |
| API 契约 | `/api` 深比较一致（忽略本地 origin）；引擎健康、CORS、音乐搜索、Nexus 搜索 schema/首条结果一致 |

## 2. 改动清单（50 个已跟踪文件）

| 类别 | 文件数 | 内容 |
| :--- | :--- | :--- |
| `functions/` 运行时注释/日志 | 35 | `// Sonic Gateway` → `// epocanvas sonic Gateway`；`[Sonic ...]` → `[epocanvas sonic ...]`；`types.ts` 删除无引用的 `SOLARA_ALLOWED_ORIGINS` |
| `player/src` 注释/日志 | 6 | 搜索/歌词/布局模块的注释与 `console.warn` 前缀；无逻辑变化 |
| `server/index.ts` | 1 | 日志前缀、注释、未挂载静态站时的纯文本提示 |
| `scripts/brand-audit.mjs` | 1 | 排除 `reports/`、新增 `--compare-tokens`、增加错误大小写检查、补充 `login.ts` 白名单 |
| 展示/文档/卫生 | 7 | 根 `index.html`/`js/index.js` 的 `EpoMail`→`Epomail`；README/API/.env 的基础设施名注释；logo.svg 注释；`.gitignore` 忽略 `*.bundle` |

两处诊断性文本同步品牌化：`ENGINE_UNAUTHORIZED` 的 `message` 改为 `...the epocanvas sonic local engine`（错误码/状态码不变）；本地引擎未挂载静态站时的纯文本提示改为 `epocanvas sonic Local Engine is running...`。除此之外无任何响应字段、状态码或业务逻辑变化。

新增证据目录：
- `reports/brand-keyname/evidence/pre/`：改前基线
- `reports/brand-keyname/evidence/post/`：改后证据
- `reports/brand-keyname/evidence/browser/`：浏览器旅程、截图、前后对比
- `reports/brand-keyname/evidence/api/`：API fixture 与前后对比
- `reports/security-audit-2026-10-25/`：原根目录 3 份安全审计报告归档
- `reports/archived/cfsolara-audit-fixes.bundle`：原根目录临时 bundle 归档

## 3. 检查点与证据

### CP-0 改动前基线

| 项目 | 基线值 | 证据 |
| :--- | :--- | :--- |
| 品牌快照 | 365 文件 / 958 受保护令牌 / 598 展示条目 | `evidence/pre/brand-verify-pre.txt`、`temp_brand_baseline/pre-brand-final-2026-10-25.json` |
| 品牌审计 | FAIL 7 项（3 份根目录报告 + 4 个安全分支新文件） | `evidence/pre/brand-verify-pre.txt` |
| 根测试 | 261 / 261 PASS | `evidence/pre/tests-root-pre.txt` |
| 前端测试 | 27 / 27 PASS | `evidence/pre/tests-player-pre.txt` |
| TypeScript | PASS | `evidence/pre/typecheck-pre.txt` |
| 构建 | 267 文件，两次逐字节一致 | `evidence/pre/dist-pre-1.sha256`、`dist-pre-2.sha256` |
| 浏览器 | 桌面/移动端 7 旅程全 PASS | `evidence/browser/pre/` |

### CP-1 审计转绿

- `node scripts/brand-audit.mjs --verify` → **PASS**
  - 证据：`evidence/post/final-brand-verify.txt`
- `node scripts/brand-audit.mjs --compare-tokens temp_brand_baseline/pre-brand-final-2026-10-25.json` → **PASS**
  - 证据：`evidence/post/final-brand-compare-tokens.txt`
- 严格 `--compare` 仅剩受保护文件哈希差异（18 项），经逐行审计确认全部为注释/日志/死类型字段：
  - 证据：`evidence/post/final-brand-compare-strict.txt`
  - `evidence/post/protected-file-diff-audit.json`：18 文件、58 行改动、0 违规
  - 明细：41 行注释 + 14 行日志 + 2 行内注释 + 1 个死类型字段
- **无任何受保护令牌漂移**：`/api/sonic/*`、`brand: "Sonic"`、`SONIC_*`、`X-Sonic-*`、`sonic_live_`、存储键、缓存键、路由文件、客户端路由全部一致。

### CP-2 展示完整性

| 展示面 | 改前 | 改后 |
| :--- | :--- | :--- |
| 播放器标题 | `epocanvas sonic - Cloud Music Platform` | 不变 |
| 首页路由标题 | `首页 - epocanvas sonic` | 不变 |
| 搜索页标题 | `搜索：周杰伦 - epocanvas sonic` | 不变 |
| 设置页标题 | `系统设置 - epocanvas sonic` | 不变 |
| 404 标题 | `页面不存在 - epocanvas sonic` | 不变 |
| 侧栏 | `epocanvas` / `sonic` / `STUDIO` / `AUDIO ENGINE` | 不变 |
| 移动头部 | `epocanvas` / `sonic` | 不变 |
| 移动设置 | `epocanvas sonic` | 不变 |
| 旧静态站 | `EpoMail` ×2 | `Epomail` ×2，`EpoMail` 0 |
| 开发者弹窗 | `EpoMail` ×2 | `Epomail` ×2，`EpoMail` 0 |
| API `/api` | `branding.parent/product/full` 完整 | 不变 |
| 构建产物 | 标题/OG/404 完整 | 不变 |

- 浏览器前后对比：`evidence/browser/browser-pre-vs-post.json`
  - `allPostStepsPassed=true`
  - `allTitlesEndWithFullBrand=true`
  - `noLegacyDisplayBrand=true`
  - `allBrandTextStable=true`
  - `allStorageKeysStable=true`
- 旧静态站前后对比：`evidence/browser/legacy/pre/` vs `legacy/post/`

### CP-3 键名冻结与兼容性

| 键名类别 | 结果 |
| :--- | :--- |
| `/api/sonic/*` 路由 | 0 差异 |
| `brand: "Sonic"` / `branding.wireBrand` | 0 差异 |
| `SONIC_*` 环境变量 | 0 差异 |
| `X-Sonic-*` 请求/响应头 | 0 差异 |
| `X-CFSolara-Key` / `X-Shijianus-Device-Id` | 保留，CORS 前后完全一致 |
| `solara_live_*` 拒绝逻辑 | 保留，鉴权 66/66 PASS |
| `SOLARA_SECRET` 回退 | 保留，鉴权矩阵 PASS |
| `sonic_live_` Key 格式 | 0 差异 |
| `SonicMusicPlayerDB` / `sonic-perf-mode` / `sonic_chunk_reload` / `sonic_epomail_session` | 浏览器 localStorage 键前后一致 |
| `sonic:*` 缓存 / `sonic-cache.internal` | 0 差异 |
| `sonic-ncm-api` / `sonic-local-engine` / `sonic-internal` | 0 差异 |

### CP-4 API 行为

对比文件：`evidence/api/api-pre-vs-post.json`（`pass=true`）

| 端点 | 结果 |
| :--- | :--- |
| `GET /api` | 200→200；JSON 深比较一致（仅本地 origin 协议/端口归一化）；`branding` 完整 |
| `OPTIONS /api/sonic/search/nexus` | 204→204；CORS 头集合完全一致 |
| `GET /api/sonic/engine/health`（无密钥） | 503→503；错误体完全一致 |
| `GET /api/music/search` | 200→200；source/query/count/tracks/首条结果一致 |
| `GET /api/sonic/search/nexus` | 200→200；`brand=Sonic`、data/meta/track 键集合一致；首条均为「晴天 / 周杰伦 / platform=sonic」 |

说明：连续压测外部搜索源时出现过短暂空结果（netease/kugou/qq 均超时或限流），属外部网络波动；最终 fixture 与浏览器搜索均成功，且路由代码差异仅为注释/日志。

唯一两处非契约的运行时文本变化：`ENGINE_UNAUTHORIZED` 的 `message` 品牌文案，以及本地引擎未挂载静态站时的纯文本提示；错误码、状态码、响应字段均不变。逐行证据：`evidence/post/runtime-text-changes.txt`。

### CP-5 功能回归

| 测试 | 结果 | 证据 |
| :--- | :--- | :--- |
| `npm run typecheck` | PASS | `evidence/post/final-typecheck.txt` |
| `npm test` | 261 / 261 PASS | `evidence/post/final-tests-root.txt` |
| `cd player && npm test` | 27 / 27 PASS | `evidence/post/final-tests-player.txt` |
| 浏览器桌面首页/搜索/播放/设置/404 | 5/5 PASS | `evidence/browser/post/` |
| 浏览器移动首页/搜索+播放 | 2/2 PASS | `evidence/browser/post/mobile-*.png` |

播放证据：桌面与移动端均等到 `audio.currentTime > 0.3`，非仅 `paused=false`。

### CP-6 构建与产物

- 两次构建：`evidence/post/final-dist-1.sha256`、`final-dist-2.sha256`，`diff` 为空（267 文件逐字节一致）。
- `evidence/post/final-dist-brand-scan.txt`：
  - 精确大小写旧品牌 `solara|cfsolara|CFSolara|shijianus|Shijianus|EpoCanvas|EpoMail`：**NONE**
  - 旧日志前缀 `[Sonic `：**0**
  - 新日志前缀 `[epocanvas sonic `：**3**
  - `epocanvas sonic`：**14 处**
  - 标题/OG/description/404 均为完整品牌。

### CP-7 终验

- 品牌审计 PASS；受保护令牌对比 PASS；受保护文件差异审计 0 违规。
- `git diff --stat`：50 个已跟踪文件，129 insertions / 106 deletions。
  - 证据：`evidence/post/final-git-diff-stat.txt`、`final-git-diff-files.txt`
- 所有新增证据位于 `reports/`，已被品牌审计排除，不会污染后续契约扫描。

## 4. 残留白名单（有意保留）

| 类别 | 位置 | 原因 |
| :--- | :--- | :--- |
| 兼容鉴权头 `X-CFSolara-Key` | `functions/_lib/auth.ts`、`http.ts`、`sonic/route-helpers.ts`、`sonic/security.ts`、`api/index.ts`、`api/auth/key.ts` | 老客户端兼容，移除会改变鉴权行为 |
| 旧 Key 拒绝 `solara_live_` | `functions/_lib/auth.ts` | 显式拒绝旧格式，安全行为 |
| 旧密钥回退 `SOLARA_SECRET` | `functions/_lib/secrets.ts`、`functions/_lib/types.ts` | 部署兼容，只读回退 |
| 个人旧品牌头 `X-Shijianus-Device-Id` | `functions/_lib/http.ts` | 全仓零发送方，但移除属对外 CORS 行为变化；按“功能不变”保留 |
| Cloudflare Pages 项目名 `cfsolara` | `package.json`、`.env.example`、README 部署命令、scripts 中的 pages.dev URL | 真实已部署资源名；改名需独立运维双轨迁移 |
| 旧 VPS 路径 `/data/workspace/CFSolara` | README | 现网历史路径，已标注为历史基础设施标识 |
| 文档兼容说明 | README、API.md | 说明旧 Key/旧头的兼容状态 |
| 历史证据 | `reports/`、`reports/security-audit-2026-10-25/` | 只读存档，不参与运行链路 |
| 外部服务品牌 `Epomail` | `EPOMAIL_*`、文档、根静态站 | 登录服务品牌，非本专案品牌；已统一大小写 |
| 技术 UA `Sonic/2.x` | `SONIC_UA`、`functions/_lib/music.ts`、`sonic/native-protocols.ts` | 出站标识，改动可能影响上游识别；按“功能不变”保留 |

## 5. 复现与验证操作

```bash
# 1) 品牌审计
node scripts/brand-audit.mjs --verify
node scripts/brand-audit.mjs --compare-tokens temp_brand_baseline/pre-brand-final-2026-10-25.json

# 2) 类型与单元/集成测试
npm run typecheck
npm test
cd player && npm test

# 3) 构建确定性
npm run build
find dist -type f -print0 | sort -z | xargs -0 sha256sum > /tmp/dist-1.sha256
npm run build
find dist -type f -print0 | sort -z | xargs -0 sha256sum > /tmp/dist-2.sha256
diff -u /tmp/dist-1.sha256 /tmp/dist-2.sha256

# 4) 浏览器回归（真实 Chrome Headless + CDP）
npx wrangler pages dev dist --port 8795 --local-protocol=http --compatibility-date=2025-10-01
BASE_URL=http://127.0.0.1:8795 node reports/brand-keyname/evidence/browser/journey.mjs post
node reports/brand-keyname/evidence/browser/compare.mjs

# 5) 旧静态站品牌检查
python -m http.server 8792 --bind 127.0.0.1
node reports/brand-keyname/evidence/browser/legacy-static.mjs post

# 6) 产物品牌扫描
rg -o 'solara|cfsolara|CFSolara|shijianus|Shijianus|EpoCanvas|EpoMail' dist || echo NONE
rg -o '\[Sonic ' dist | wc -l
rg -o '\[epocanvas sonic ' dist | wc -l
```

> 说明：本轮首选内置浏览器，但其 guest 未就绪（webview not ready）；因此改用真实 Chrome Headless + CDP 黑盒验证，与仓库既有验证方式一致。所有交互均为真实 DOM 点击/输入，截图与观察 JSON 已落盘。

## 6. 回滚

本轮**未创建提交**，全部改动位于 `brand/epocanvas-sonic-final` 工作区：

```bash
# 撤销所有已跟踪文件改动（保留证据目录）
git restore -- .

# 如不需要证据，可另行删除未跟踪的 reports/brand-keyname/evidence 与 reports/security-audit-2026-10-25
```

如需保留改动再回滚，可先提交，然后 `git revert <commit>`。

## 7. 结论

**PASS**。本轮完成了 `epocanvas sonic` 的展示层收口、内部注释/日志品牌化、审计工具增强与完整证据链；所有受保护键名、API 路由、鉴权、存储、缓存、容器与部署标识保持原值，261 + 27 项测试全绿，构建产物确定且无旧品牌残留，浏览器桌面/移动端与旧静态站验证均通过。未发现对现有功能链路的实际影响。
