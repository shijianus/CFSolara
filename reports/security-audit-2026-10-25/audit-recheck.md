# CFSolara 定向复核报告（audit-recheck）

> 复核对象：`shijianus/CFSolara`，任务指定分支 `origin/feat/full-stream-priority`
> 复核日期：2026-10-25
> 方式：全新临时目录从零克隆 + 本地实际运行/测试；未 push、未使用任何真实凭据；攻击性输入只对本地启动的实例执行；线上只读 GET 共 3 次。
> 本报告不含任何密钥内容；测试用签名密钥由 `openssl rand -hex 32` 现场生成，未打印。

---

## 0. 结论（TL;DR）

**按任务指定的 `origin/feat/full-stream-priority` 复核：不能合并。** 该远程分支的最新提交仍是上一轮的 `82cfbefbce233a8d9a42affac06751e8b343acbe`，相对 `82cfbef` **新增提交为 0 个**，代码与上一轮审计对象完全相同；上一轮的全部问题在该分支上均未交付。

本轮声称的 9 个修复提交只存在于开发者工作区的本地 bundle（`cfsolara-audit-fixes.bundle`）和本地分支 `feat/full-stream-priority`，tip 为 `f34285f2800e78188277792d346424d9c16bb272`，**从未推送到 origin**。另有两条并行 security 分支承载了不同修复：`origin/security/fix-auth-ratelimit-ssrf`（`bc86f4a`，7 个提交）与 `origin/security/fix-v2`（`7030de2`，最新推送，包含更强的 auth/SSRF 实现但不含 MP3/流判定修复）。

对 `f34285f` 的定向复核结论是：**上一轮的主要阻塞项已实质修复，但仍不能直接合并上线。** 已修复的核心项包括 API Key 伪造/篡改/过期、`X-Sonic-Client-IP` 限流绕过、`/api/sonic/forward` 与 `/proxy` 的开放转发、超长 URL 500、全新环境 `npm test` 失败、20 首统计数据与文档矛盾、`lint:theme` 5 处违规。仍存在的合并阻塞项包括：

1. **两个高危 SSRF 未覆盖**：`/api/music/cover?url=` 完全无主机白名单且回传响应体；`/palette?url=` 的 `isBlockedSsrfHost` 可被 `localhost.`（尾点）、`localhost.localdomain`、IPv4-mapped IPv6、100.64/10、198.18/15、IP-echo 域名等绕过，且 `/palette` 无速率限制。两者均在 `f34285f` 上本地复现。
2. **客户端可控的 `duration` 可把 30 秒试听判成 full 并写入共享缓存**（缓存键不含 `duration`）；函数级已复现，端到端缓存污染为代码路径推断。
3. **MP3 帧头方案仍有系统性误判**：VBR（首帧 64k、均值 50.6k 的完整 60 秒文件被判 trial）、ID3 标签 >64KB（100KB 标签的 60/90 秒完整流被判 trial）、非 MP3/AAC（在 1122 字节处误识别出 256k MP3 帧头，confidence=high，被判 trial）均未覆盖；随机缓冲 fuzz 中 392/50007 被误认为 MP3 帧头。
4. **鉴权 key 格式仍有缺陷**：base64url 字母表包含 `_`，与分隔符冲突；合法邮箱 `ab?@example.test` 的签名 key 被拆成 4 段而拒绝；非 ASCII 邮箱 `btoa` 直接抛错；1 字符 secret 仍可签发/验证；无上限的未来过期时间被接受；key 缓存无界且可用标准 base64/空白变体膨胀。
5. **文档/证据存在过度声明**：20 首 JSON 的 80 个结果中 `X-Sonic-Stream-Type` 出现 0 次，measure 脚本仍用旧字节比公式，生产 `/api` 仍无顶层 `brand`——该表测量的是 main 生产而不是修复分支，不能验证新算法；`AUDIT_HANDOFF` 的“60~90 秒不再误判”仅在 duration 元数据存在时成立。
6. **交付流程问题**：修复未推送、三条分支分叉且本地分支名与远程 tip 不一致；直接合并任何单条分支都会丢功能或引入回归。

**建议**：不要合并当前 `origin/feat/full-stream-priority`；以 `f34285f` 的 stream/deps/docs 修复为基础，移植 `origin/security/fix-v2` 的 `net-guard`/`secrets`/OAuth 修复，修完下列 P0/P1 后推送并重跑全部测试。

---

## 1. 克隆、分支与提交

### 1.1 克隆与检出

```bash
TMPROOT="/c/Users/Smart Kevin/AppData/Local/Temp/cfsolara-recheck-1792914068"
git clone --no-local https://github.com/shijianus/CFSolara.git "$TMPROOT/CFSolara"
cd "$TMPROOT/CFSolara"
git checkout feat/full-stream-priority
git log -1 --format='%H %ci %s'
```

实际输出：

```text
82cfbefbce233a8d9a42affac06751e8b343acbe 2026-10-24 19:08:03 -0800 docs(audit): add audit handoff specification and honest known issues documentation
```

`git log --oneline 82cfbef..HEAD` 输出为空。**任务指定的 origin 分支没有任何新增提交。**

### 1.2 分支拓扑（同一基点的三条线）

| 引用 | 实际 tip | 时间 | 相对 82cfbef | 说明 |
| :--- | :--- | :--- | ---: | :--- |
| `origin/feat/full-stream-priority` | `82cfbefbce233a8d9a42affac06751e8b343acbe` | 2026-10-24 19:08 -0800 | **0** | 上一轮审计对象，未更新 |
| 本地 `feat/full-stream-priority` / bundle | `f34285f2800e78188277792d346424d9c16bb272` | 2026-10-25 14:28 +0800 | **9** | 修复报告声称的 tip；**未推送** |
| `origin/security/fix-auth-ratelimit-ssrf` | `bc86f4a0806f8e4bfbe199ab9c4648aebce3b3c1` | 2026-10-24 20:29 -0800 | 7 | 并行 security 实现 |
| `origin/security/fix-v2` | `7030de2` | 2026-10-25 13:23 +0800 | 15（含 main/brand 提交） | 最新推送；与工作区本地 `security/fix-auth-ratelimit-ssrf` tip 相同 |

工作区状态存在命名错位：本地分支 `security/fix-auth-ratelimit-ssrf` 指向 `7030de2`（即 `origin/security/fix-v2`），而远程同名分支是 `bc86f4a`；本地 `feat/full-stream-priority` 指向 bundle 的 `f34285f`（`git log` 可验证），但远程同名分支仍是 `82cfbef`。`git bundle verify` 显示 bundle 完整、依赖 `82cfbef`。

### 1.3 `82cfbef..f34285f` 的 9 个修复提交

| 提交 | 主题 |
| :--- | :--- |
| `b72ccc3` | `fix(auth): enforce HMAC-SHA256 signed API keys with expiry and fail closed on missing secrets` |
| `7c409a4` | `fix(security): rate-limit trust chain — X-Sonic-Client-IP only for authenticated engine hops` |
| `9bd6ce1` | `fix(stream): duration-based trial detection from real MP3 frame header + player misjudgment guard` |
| `c3f1350` | `chore(deps): declare devDependencies, add lockfile, split offline vs live test suites` |
| `19212dd` | `fix(security): media-host allowlists + per-hop redirect re-validation for proxied fetches` |
| `dc3bd02` | `fix(http): reject oversized request URLs with 414 instead of surfacing a 500` |
| `072d6b5` | `test: drain event loop instead of process.exit in mock-server suites` |
| `881f77e` | `chore(docker): tolerate ncm-api sidecar first-boot xeapi key race` |
| `f34285f` | `fix(evidence): strict 20-song matching + single-source stats; correct docs against audit evidence` |

### 1.4 并行 security 分支的提交（对照用）

`origin/security/fix-auth-ratelimit-ssrf`（7 个）：

`a6f73c6` HMAC API keys / 移除硬编码 secret；`0aae117` OAuth state+PKCE；`ec0010e` 限流 IP 信任 + KV；`6187aaa` SSRF 三重校验 + safe fetch；`5267f6f` 引擎鉴权/错误脱敏；`f462e07` 根 LICENSE + 依赖 overrides；`bc86f4a` vitest 安全套件。

`origin/security/fix-v2`（相对 82cfbef 的 15 个，其中后 11 个为安全修复，前 4 个为 main/brand 线）：

`edfcb01`、`9647197`、`6f11ed7`、`a5e7695`、`e8c4596`、`00c8358`、`9355ae0`、`a439dc4`、`5a59e5d`、`3cb75b9`、`c34239b`、`fe73634`、`8eb336a`、`2314191`、`7030de2`。

> 本报告的详细行为测试以 `f34285f` 为主（它对应修复报告的 9 项声明），并对 `origin/security/fix-v2` 做静态对照，原因是两条线的能力互补且存在冲突。

### 1.5 两条修复线的能力分布（静态对照）

| 能力 | `f34285f`（bundle，未推送） | `origin/security/fix-v2`（7030de2，已推送） |
| :--- | :--- | :--- |
| HMAC 签名 key + 过期 | ✅ | ✅（另有 `v1.<payload>.<sig>` 格式、最小 32 字符、`SONIC_SECRET_PREV` 轮换） |
| `?key=`/`?api_key=` | ✅ 完全移除 | ⚠️ 默认关闭，可通过 `SONIC_ALLOW_QUERY_KEY` 开启 |
| 限流 IP 信任链 | ✅ | ✅（另有可选 KV 计数） |
| MP3 帧头 / 试听判定 | ✅（本轮发现 VBR/大 ID3/AAC 缺陷） | ❌ 无此修复 |
| forward/stream/legacy proxy 防护 | ✅（`isAllowedMediaHost` + 逐跳 guard） | ✅（`net-guard` + `safeFetch`，更强） |
| `/api/music/cover`、`/palette` 私网 SSRF | ❌ 未覆盖 | ✅ `validateOutboundUrl`/`safeFetch`；Linux 引擎有 `dns-guard`；但仍允许公网 HTTPS 代理，`/palette` 无限流 |
| OAuth state / PKCE / 固定跳转 origin / HTTPS 基址 | ❌ | ✅ |
| 根 LICENSE | ❌ | ✅ |
| 全新环境 `npm install && npm test` 离线 | ✅ 195/195 | ❌ `test` 仍包含 live 套件，且依赖 player 的 vitest |
| 20 首证据/文档订正 | ✅ | ❌ `reports/raw_20_songs_probe_results.json`、`measure-20-sample-songs-raw.mjs` 等被删除 |
| `isBlockedSsrfHost` 的 localdomain/映射 IPv6/CGNAT/IP-echo | ❌（仅基础段） | ✅ |
| URL 长度 414 | ✅ | 未在本次静态对照中确认 |

**结论**：不能二选一。正确做法是把 security/fix-v2 的 `net-guard`/`dns-guard`/`secrets`/OAuth 修复与 f34285f 的 stream/deps/docs 修复合并，再统一 auth 格式与测试入口。

---

## 2. 上一轮发现逐项复核

状态列说明：以 `f34285f`（开发者声称的修复 tip）为复核对象；`origin/feat` 列为任务指定分支的实际交付状态。

| # | 上一轮发现 | `origin/feat` 82cfbef | `f34285f` 复核状态 | 关键证据 |
| :---: | :--- | :--- | :--- | :--- |
| 1 | API Key 不验签，任意 `sonic_live_` 可伪造 | 未修复 | **已修复（核心）** | 伪造/篡改邮箱/篡改过期/过期/缺 secret/旧 2 段格式全部 false；合法签名 true。新增边界问题见 4.8–4.11 |
| 2 | 伪造 `X-Sonic-Client-IP` 绕过限流 | 未修复 | **已修复** | 伪造 key + 轮换 `X-Sonic-Client-IP` 11 次：前 10 次 400、第 11 次 429；轮换 `X-Forwarded-For` 同样 429；引擎密钥可转发终端 IP |
| 3 | measure 脚本仍回退 `tracks[0]` | 未修复 | **已修复（证据脚本）** | `scripts/measure-20-sample-songs-raw.mjs` 已无 `tracks[0]`，严格匹配失败记 `not_found`；历史脚本 `test-20-sample-songs.mjs` 仍用 `tracks[0]`，但文档已明确标注为历史对照、不产统计 |
| 4 | KNOWN_ISSUES 统计与 JSON 矛盾 | 未修复 | **已修复（数字）** | 独立聚合与文档/`raw_20_songs_summary.json` 完全一致；8 首/6 首口径已删除。证据方法有缺口，见 4.14 |
| 5 | 60–90s 完整 128k、flac 实际 320k、181,522 假流误判 | 未修复 | **部分修复** | 有 duration 时 60/90s full、flac 实际 320k full、181,522 有帧头 unavailable、206 无 Content-Range unavailable；无 duration 的 60/90s、无帧头的 181,522、VBR、大 ID3、AAC 仍误判 |
| 6 | API Key 可经 `?key=`/`?api_key=` 传入 | 未修复 | **已修复** | `extractAuthCredentials` 只读 header；`?key=`/`?api_key=` 单独请求均 false；仓库内无其他端点读取 query key |
| 7 | 酷我直连分支不做物理探测，≥350KB 即 full | 未修复 | **未修复** | `resolveKuwoSingleStream` 仍只校验总字节 ≥350,000，`resolvePlayableStream` 的 kuwo 直连分支直接 `streamType:'full'` |
| 8 | 流代理 `redirect: follow`、探测不校验 Content-Type | 未修复 | **部分修复** | forward/stream/legacy proxy 已用逐跳 `fetchWithRedirectGuard`（本地独立重定向测试通过）；probe 仍不校验 Content-Type；`/palette`、`/api/music/cover` 仍 `redirect: follow` 且无主机白名单 |
| 9 | 根 `package.json` 零依赖，全新 `npm test` 必失败 | 未修复 | **已修复** | 全新克隆 `npm install && npm test` → 195/195，EXIT=0；decks：`jiti/esbuild` + `package-lock.json`。对比 82cfbef 仍 `'jiti' is not recognized`，EXIT=1 |
| 10 | `/api/sonic/forward` 对任意公网 URL 开放 | 未修复 | **已修复（该端点）** | `url=http://example.com/`、127.0.0.1、169.254、file://、userinfo、后缀拼接全部 400；8KB URL 414。同类 `/api/music/cover`、`/palette` 仍有开放面（新发现 4.1/4.2） |
| 11 | 仓库无 LICENSE 文件 | 未修复 | **未修复** | `f34285f` 根目录无 LICENSE；`origin/security/fix-v2` 有 LICENSE（对照） |
| 12 | 回滚脚本硬依赖 jq 且无前置检查 | 未修复 | **未修复** | `f34285f` 的 `scripts/rollback-production.sh` 仍直接 `jq`，无 `command -v jq` |
| 13 | 限流器/熔断器为进程内存态 | 未修复 | **未修复（平台限制）** | 文档已如实注明每 isolate；`origin/security/fix-v2` 增加可选 KV，但 `f34285f` 没有 |
| 14 | `lint:theme` 5 violations 与文档矛盾 | 未修复 | **已修复** | `npm run lint:theme` 通过；基线共 435 条，其中 App.vue 1 + AddToPlaylistDialog 4 = 5 处；文档已改为“5 处已收录、绿色” |
| 15 | 生产 `/api` 顶层 `brand` 缺失（修复未部署） | 未修复/未部署 | **未修复/未部署** | 线上 `GET /api` 200 仍无 `brand`；两域 engine health 均 401（3 次只读 GET） |
| 16.1 | 硬编码示例 realIP | 未修复 | **未修复（非安全问题）** | 仍为 NeteaseCloudMusicApi 社区示例 IP；文档已说明可覆盖 |
| 16.2 | 播放器 HEAD 探测翻倍；试听头缺失时静默跳歌；单曲循环试听直接 return | 未修复 | **部分修复** | 新增 `resolveTrialEnd` 在播完时撤销误判 trial；HEAD 探测仍在（每曲多一次请求）；`streamType` 为空时仍未提示，30–45 秒完整短曲仍可能弹“试听结束” |
| 16.3 | ncm-api 侧车首启竞态 | 未修复 | **已修复（Dockerfile）** | `Dockerfile.ncm` healthcheck start-period 15s→120s、retries 3→5；VPS compose 未验证 |
| 16.4 | `cfg.gdstudioUrl` 属性名 bug | 未修复 | **已修复** | `functions/proxy.ts` 已改用 `cfg.upstreamGdstudio` |
| 16.5 | 8KB target URL 返回 500 | 未修复 | **已修复** | stream/forward/proxy 均 414（本地实测） |
| 16.6 | CORS/安全头 | 未修复 | **未变（提示）** | 仍 `Access-Control-Allow-Origin: *`、无 Allow-Credentials；HSTS/CSP 未加 |
| 16.7 | 测试套件直连真实上游 | 未修复 | **已修复** | `npm test` 拆为 8 个离线套件；用全局 fetch 阻断器验证 195/195 通过、0 次外部请求；`test:live` 未运行（平台预算） |
| 16.8 | 跨源兜底出完整流未复现 | 未修复 | **未确认（文档已如实）** | 新 JSON 的 `crossSourceUpgrades` 为 0，文档标“未确认” |

---

## 3. 逐项复现命令与实际输出

### 3.1 API Key 伪造、篡改、过期、缺失 secret、查询参数

复核使用独立的 HMAC 计算脚本（不调用 `createSession`），对 `verifyAuth` 直接断言；另在本地引擎上做 HTTP 级验证。测试邮箱为 `audit@example.test`，测试密钥现场随机生成。

```text
TRUE  valid signed key
FALSE forged signature
FALSE tampered email, original sig
FALSE tampered expiry, original sig
FALSE expired signed key
FALSE valid key, no secret configured
FALSE valid key, different secret
FALSE query ?key= only
FALSE query ?api_key= only
FALSE legacy 2-part key
TRUE  solara_live_ signed key
TRUE  uppercase signature hex
FALSE valid signed key for underscore-email
TRUE  standard-base64 key variant accepted?
TRUE  far-future signed expiry accepted?
TRUE  1-char secret accepted for signing?
THREW: Invalid character   unicode email createSession
FALSE 8KB garbage key
```

结论：

- 上一轮的伪造 `sonic_live_<b64(email)>_<deadbeef>` 已无法通过；篡改邮箱/过期时间、已过期、缺 secret、不同 secret、旧 2 段格式、`?key=`/`?api_key=` 全部被拒。**核心问题已修复。**
- 但新增/遗留边界问题：
  - **合法邮箱 `ab?@example.test` 的签名 key 被拒**：`b64url('ab?@example.test')` = `YWI_QGV4YW1wbGUudGVzdA`，包含 `_`；`verifyAuth` 按 `_` 分割得到 4 段，直接失败。base64url 字母表本身包含 `_`，与分隔符冲突。任何 base64url 编码含 `_` 的邮箱（例如某些位置含 `?` 的合法地址）都无法登录后使用 API Key。
  - **非 ASCII 邮箱**：`createSession({email:'用户@example.test'})` 抛 `Invalid character`（`btoa` 只接受 Latin-1），登录流程会 500。
  - **弱 secret**：`createSession({SONIC_SECRET:'x'})` 成功，`verifyAuth` 返回 true；运行时代码没有最小长度检查（`origin/security/fix-v2` 的 `secrets.ts` 要求 ≥32，可对照）。
  - **无上限过期**：用测试 secret 签一个 `+275760-09-13T00:00:00.000Z` 的 key，`verifyAuth` 仍 true；`createSession` 虽固定 30 天，但验证层不限制最大 TTL。
  - **base64 变体**：标准 base64（含 `+`/`/`/`=`）或加空白后的等价 key 仍通过验签；同一身份可有无限多种 key 字符串。与无界缓存结合会放大内存占用（见 4.10）。
  - **8KB 垃圾 key** 快速返回 false，无崩溃。

### 3.2 限流 IP 伪造

本地引擎以随机测试 secret 启动（`PORT=18081`），为便于触发把匿名/密钥档配置为下限（匿名 10、密钥 30）：

```text
A: forged key + rotating X-Sonic-Client-IP, 11 req (anon limit 10)
400 400 400 400 400 400 400 400 400 400 429

B: valid key + rotating X-Sonic-Client-IP, 31 req (auth limit 30)
400 × 30, then 429

C: forged key + rotating X-Forwarded-For, 11 req (anon limit 10)
400 400 400 400 400 400 400 400 400 400 429

D: valid engine key + rotating X-Sonic-Client-IP, 11 req (engine tier 600)
400 × 11

E: wrong engine key + rotating X-Sonic-Client-IP, 11 req
400 × 10, then 429

F1: same CF-Connecting-IP, 11 req
400 × 10, then 429

F2: rotating CF-Connecting-IP, 11 req (local spoof)
400 × 11
```

直接函数验证：

```text
engine key + X-Sonic-Client-IP 203.0.113.9: 203.0.113.9
wrong engine key + X-Sonic-Client-IP (falls to CF): 198.51.100.1
no engine key + XFF only (fallback): fallback:no-terminal-ip
engine secret unconfigured + X-Sonic-Client-IP (fallback): fallback:no-terminal-ip
valid engine secret?: true
```

结论：`X-Sonic-Client-IP` 只在引擎密钥验签通过时被信任；`X-Forwarded-For` 完全忽略；伪造轮换不再绕过。**上一轮发现 2 的核心问题已修复。**

残留：

- `CF-Connecting-IP` 仍然无条件信任。本地 F2 用不同 `CF-Connecting-IP` 可绕过，是因为本地不在 Cloudflare 后面；生产由 CF 覆盖该头，前提是引擎/边缘只经 CF 暴露。若 VPS origin 可直连，或反向代理透传客户端 `CF-Connecting-IP`，仍可绕过。上线检查必须确认。
- 每 isolate 内存计数、多 isolate 配额放大仍是平台限制，文档已注明。

### 3.3 流判定 38 项与新增反例

仓库自带 `scripts/test-stream-detection.mjs` 34/34 通过。审计员另用 ffmpeg 生成真实 CBR/VBR/AAC/大 ID3 文件，直接调用 `evaluateStreamQuality` 和本地 HTTP `probeStreamPhysicalQuality`：

```text
cbr60: bytes=960931 header=128k/44100Hz off=44
cbr90: bytes=1441166 header=128k/44100Hz off=44
vbr60: bytes=379258 header=64k/44100Hz off=44
aac60: bytes=971567 header=256k/44100Hz off=1122
id3big: bytes=1060941 header=null

CBR60 128k expected60: type=full ratio=1.001 method=mp3-frame-header conf=high br=128 est=60.1
CBR60 128k expected undefined: type=trial ratio=0.25 method=mp3-frame-header conf=medium br=128 est=60.1
CBR60 128k expected0: type=trial ratio=0.25 method=mp3-frame-header conf=medium br=128 est=60.1
CBR90 128k expected90: type=full ratio=1.001 method=mp3-frame-header conf=high br=128 est=90.1
CBR90 128k expected undefined: type=trial ratio=0.375 method=mp3-frame-header conf=medium br=128 est=90.1
VBR60 expected60: type=trial ratio=0.79 method=mp3-frame-header conf=high br=64 est=47.4
AAC60 expected60: type=trial ratio=0.506 method=mp3-frame-header conf=high br=256 est=30.4
ID3-100KB 60 expected60: type=trial ratio=0.804 method=byte-ratio-fallback conf=low br=- est=-
ID3-100KB 90 expected90: type=trial ratio=0.536 method=byte-ratio-fallback conf=low br=- est=-
320k full 240s under flac request: type=full ratio=1 method=mp3-frame-header conf=high br=320 est=240.0
48k full 270s: type=full ratio=1 method=mp3-frame-header conf=high br=48 est=270.0
181521 exact head128: type=unavailable ratio=0 method=fake-clip-signature conf=high br=- est=-
181522 head128: type=unavailable ratio=0 method=mp3-frame-header conf=high br=128 est=11.3
181522 no head (fallback): type=trial ratio=0.034 method=byte-ratio-fallback conf=low br=- est=-
99999 head128: type=trial ratio=0.026 method=mp3-frame-header conf=high br=128 est=6.2
300001 head128: type=trial ratio=0.078 method=mp3-frame-header conf=high br=128 est=18.8
30s trial 481115 expected1 (poison): type=full ratio=30.07 method=mp3-frame-header conf=high br=128 est=30.1
30s trial 481115 expected30: type=full ratio=1.002 method=mp3-frame-header conf=high br=128 est=30.1
30s trial 481115 expected240: type=trial ratio=0.125 method=mp3-frame-header conf=high br=128 est=30.1

--- probeStreamPhysicalQuality end-to-end ---
probe CBR60 expected60: type=full total=960931 ratio=1.001 method=mp3-frame-header conf=high br=128 est=60.1
probe VBR60 expected60: type=trial total=379258 ratio=0.79 method=mp3-frame-header conf=high br=64 est=47.4
probe AAC60 expected60: type=trial total=971567 ratio=0.506 method=mp3-frame-header conf=high br=256 est=30.4
probe ID3-100KB expected60: type=trial total=1060941 ratio=0.804 method=byte-ratio-fallback conf=low br=- est=-
probe 181522 expected240: type=unavailable total=181522 ratio=0 method=mp3-frame-header conf=high br=128 est=11.3
probe 206 no Content-Range: type=unavailable total=0 ratio=0 method=undefined conf=low br=- est=-
probe CL181522 empty body: type=trial total=181522 ratio=0.034 method=byte-ratio-fallback conf=low br=- est=-
probe text/html 3.84MB with MP3 header: type=full total=3840000 ratio=1 method=mp3-frame-header conf=high br=128 est=240.0
probe dribble 4 bytes CL960000: type=trial total=960000 ratio=0.727 method=byte-ratio-fallback conf=low br=- est=-
```

对上一轮 38 项反例的逐项回答：

- **60~90 秒完整 128k、带 duration 元数据**：✅ 已修复（full，ratio≈1.001）。
- **60~90 秒完整 128k、duration 缺失/为 0**：❌ 仍判 trial（60s→0.25，90s→0.375），只是 confidence=medium。文档称“时长缺失回退 240s”属实，但“60~90 秒不再误判”的表述过宽。
- **请求 flac 实际 320k MP3（240s）**：✅ 已修复（full）。
- **48kbps 完整 270s**：✅ 已修复（full）。
- **181,522 字节假流、有可解析 MP3 帧头**：✅ 已修复（unavailable，11.3s < 15s）。
- **181,522 字节、无可读帧头（空 body / 4 字节块）**：❌ 回退路径仍判 trial（0.034），且 99,999 字节/300,001 字节在字节范围外也判 trial。
- **206 无 Content-Range**：✅ 已修复（unavailable）。
- **VBR**：❌ 新反例，完整 60s VBR 判 trial（首帧 64k，均值 50.6k），测试套件未覆盖。
- **大 ID3（>64KB）**：❌ 新反例，100KB 标签的 60/90s 完整 CBR 判 trial（probe 只读 64KB，找不到帧头）。
- **非 MP3/AAC**：❌ 新反例，AAC 文件中在 1122 字节处误识别出 256k MP3 帧头，method=mp3-frame-header、confidence=high，判 trial；与文档“非 MP3 回退 low confidence”不符。
- **客户端 duration 污染**：❌ 30s 试听 481,115 字节，传 duration=1 或 30 即判 full（30.07/1.002）；传 240 才 trial。服务端信任该参数，且缓存键不含 duration（见 4.3）。

### 3.4 开放转发、代理与超长 URL

本地引擎实测（`CF-Connecting-IP` 用测试段地址，避免触发限流）：

```text
/api/sonic/forward?url=http://example.com/                          400  INVALID_TARGET
/api/sonic/forward?url=http://127.0.0.1:18081/api                   400  INVALID_TARGET
/api/sonic/forward?url=http://169.254.169.254/latest/meta-data/     400  INVALID_TARGET
/api/sonic/forward?url=file:///C:/Windows/win.ini                   400  INVALID_TARGET
/api/sonic/forward?url=http://music.126.net@127.0.0.1:18081/api     400  INVALID_TARGET
/api/sonic/forward?url=http://127.0.0.1.music.126.net/              400  INVALID_TARGET
/api/sonic/forward?url=http://[::ffff:127.0.0.1]/                   400  INVALID_TARGET
/api/sonic/forward?url=https://evil-music.126.net/                  400  INVALID_TARGET
/api/sonic/forward?url=https://music.126.net.evil.com/              400  INVALID_TARGET
/api/sonic/forward?url=<8000 chars>                                 414  URI_TOO_LONG
/api/music/stream?target=http://example.com/                        400  Invalid target URL
/api/music/stream?target=http://127.0.0.1:18081/api                 400  Invalid target URL
/api/music/stream?target=<8000 chars>                               414  Request URL too long
/proxy?target=http://example.com/                                   400  Invalid target
/proxy?target=http://127.0.0.1:18081/api                            400  Invalid target
/proxy?target=<8000 chars>                                          414  Request URL too long
```

逐跳重定向独立测试（两个本地 HTTP 服务）：

```text
BLOCKED: FETCH_TARGET_BLOCKED: http://127.0.0.1
ALLOWED redirect status: 200 body: SECRET
```

结论：`/api/sonic/forward` 的开放转发已收敛为媒体域名白名单，逐跳重定向重校验生效，8KB URL 返回 414。**上一轮发现 8/10/16.5 的目标端点已修复。**

但同类端点仍有开放面：`/api/music/cover?url=` 无任何主机白名单，`/palette?url=` 的 blocklist 可绕过（见第 4 节）。因此“SSRF 已修复”不能作为整体结论。

### 3.5 全新环境安装与离线测试

**任务指定分支 82cfbef：**

```text
$ npm install
up to date, audited 1 package
$ npm test
> jiti scripts/test-sonic-gateway.mjs && ...
'jiti' is not recognized as an internal or external command
EXIT=1
```

**修复 tip f34285f：**

```text
$ npm install
added 3 packages, and audited 4 packages in 13s
found 0 vulnerabilities
$ npm test
Auth Signature Test Results: 21 passed, 0 failed
Auth Compatibility Test Results: 43 passed, 0 failed
Rate Limit Trust Test Results: 10 passed, 0 failed
==== stream detection tests: 34 passed, 0 failed ====
==== fetch guard tests: 16 passed, 0 failed ====
==== URL length tests: 4 passed, 0 failed ====
Test Results: 20 passed, 0 failed
Local Engine & Degradation Test Results: 47 passed, 0 failed
EXIT=0
```

合计 195/195。未手工安装 jiti；`package-lock.json` 已入库。

**离线证明**：用 `NODE_OPTIONS=--require C:/audit-tmp/block-fetch.cjs` 把全局 `fetch` 对非本地主机（仅放行 127.0.0.1/localhost/::1）改为抛错并记录：

```text
EXIT=0
总计数仍为 21+43+10+34+16+4+20+47 = 195/195
[OFFLINE-BLOCK] 日志 0 条
```

离线套件内的 `node:http` 仅用于本地 mock server；`test-fetch-guard` 对 169.254 的尝试在 guard 层被拒，未发出网络请求。结论：**`npm test` 不访问外部平台**。

### 3.6 抽样脚本、JSON 与文档数字

独立聚合脚本（不调用 `summarize-20-songs.mjs`，直接读 raw JSON）：

```json
{
  "netease": {"full":4,"trial":10,"not_found":3,"fake_clip_blocked":0,"fail":3,"missing":0},
  "qq":      {"full":0,"trial":1, "not_found":2,"fake_clip_blocked":0,"fail":17,"missing":0},
  "kugou":   {"full":0,"trial":0, "not_found":1,"fake_clip_blocked":0,"fail":19,"missing":0},
  "kuwo":    {"full":0,"trial":5, "not_found":5,"fake_clip_blocked":0,"fail":10,"missing":0}
}
```

与 `reports/raw_20_songs_summary.json` 及 `docs/KNOWN_ISSUES.md` 表完全一致（4/10/3/3、0/1/2/17、0/0/1/19、0/5/5/10，fake/missing 全 0）。`crossSourceUpgrades` 0 条，`upgraded` 0 条，与文档“0 例”一致。

网易 4 首完整流的字节数与文档（十进制 MB）一致：

```text
起风了   13,037,236 bytes = 13.04 MB
南山南   13,005,889 bytes = 13.01 MB
安和桥   10,007,031 bytes = 10.01 MB
理想三旬  8,435,505 bytes =  8.44 MB
```

`KNOWN_ISSUES` 的《晴天》《稻香》《残酷な天使のテーゼ》not_found 与 raw 一致；《理想三旬》陈鸿宇 8.44MB 与 raw 一致。**上一轮发现 3/4 的数字部分已修复。**

但证据方法有缺口（见 4.14）：80 个结果中 `X-Sonic-Stream-Type` 出现 **0 次**，measure 脚本第 227 行仍用旧的 `evaluateRelativeBytes`，所以这张表测的是 main 生产，不能验证新的 MP3 帧头算法。

### 3.7 lint:theme

```text
$ npm run lint:theme
✓ lint:theme passed: 435 existing hardcoded white occurrence(s) are covered by the baseline.
EXIT=0
```

基线文件共 435 条；其中上一轮点名的 5 处：

```text
player/src/App.vue                                      1  (border-white/15)
player/src/components/Dialog/AddToPlaylistDialog.vue    4  (border-white/10 ×3, text-white ×1)
```

文档 `KNOWN_ISSUES §6` 写“5 处收录、清理 65 条过期条目、现为绿色”，与实测一致。**上一轮发现 14 已修复**（属于基线更新，不是代码迁移；文档已如实说明这 5 处仍是技术债）。

---

## 4. 新发现

> 标注“已验证”= 本轮实际复现；“推断”= 基于代码路径、未做端到端复现。高危项均给出本地命令/输出。

### 4.1【高】`f34285f` 的 `/api/music/cover?url=` 是无主机白名单、回传响应体的 SSRF

- 位置：`functions/api/music/cover.ts:49-61`（`proxyImage`）、`:101-118`（`url`/`target` 直接进入 `proxyImage`；`id` 以 `http` 开头也进入）。
- 问题：只检查 `http:`/`https:`，**不调用** `isBlockedSsrfHost`、没有媒体白名单、`redirect: 'follow'`，并把上游响应体（Content-Type 含 `image/` 时）原样返回给调用方。无鉴权，只有 240rpm 限流。
- 复现（本地引擎 + 本地图片服务 127.0.0.1:19010）：

```text
url=127.0.0.1:19010 image        HTTP=200 bytes=225 content-type: image/jpeg
url=localhost.:19010 image       HTTP=200 bytes=225 content-type: image/jpeg
id=http://127.0.0.1:19010/x      HTTP=200 bytes=225 content-type: image/jpeg
url=file:///...                  HTTP=200 bytes=567 content-type: image/svg+xml（协议拒绝后的兜底）
```

- 影响：可读取/探测内网 HTTP 服务（若返回 image/* 即完整回传）、云 metadata（盲 SSRF）、内网管理页；也是开放图片代理，可被用于带宽/匿名转发。该代码在 main 已存在，**不是 f34285f 新引入，但 f34285f 的“媒体白名单”修复没有覆盖它**。
- 对照：`origin/security/fix-v2` 的 `proxyImage` 已使用 `validateOutboundUrl` + `safeFetch`（逐跳、私网/映射 IPv6/本地域名拦截、超时/大小上限、剥离凭据），可移植。
- 置信度：已验证（本地行为级）。

### 4.2【高】`f34285f` 的 `/palette?url=` SSRF：blocklist 可绕过且无速率限制

- 位置：`functions/palette.ts:378-430`（`image`/`url` 参数直接 fetch）、`functions/_lib/sonic/security.ts:206-260`（`isBlockedSsrfHost`）。
- 问题：只依赖 `isBlockedSsrfHost`，没有域名白名单；`fetch` 默认跟随重定向且无 timeout/大小上限；`/palette` 没有 `evaluateGatewayRateLimit`（只有 `checkEngineAccess`）。
- blocklist 实测（直接调用）：

```text
ALLOW localhost.
ALLOW localhost.localdomain
ALLOW ::ffff:127.0.0.1
ALLOW ::ffff:169.254.169.254
ALLOW 100.100.100.200        # 阿里云 metadata 所在 CGNAT 段
ALLOW 100.64.0.1
ALLOW 198.18.0.1
ALLOW foo.localdomain
BLOCK 127.0.0.1
BLOCK 169.254.169.254
BLOCK localhost
BLOCK foo.local
```

- HTTP 复现（本地图片服务 19010、重定向服务 19011）：

```text
palette url=127.0.0.1:19010/x           HTTP=400  (被 blocklist 拦住)
palette url=localhost.:19010/x          HTTP=200  baseColor=#fe0000 ...   # 尾点绕过
palette url=http://localhost.:19011/redir HTTP=200 baseColor=#fe0000 ...   # 302→127.0.0.1 被跟随
```

- 影响：可对 VPS 内网/云 metadata 发起 GET（盲 SSRF，状态/耗时侧信道）；无速率限制，可放大为 DoS；`fetch` 无超时（本地 Node 引擎）可被慢响应拖住。
- 对照：`origin/security/fix-v2` 的 `net-guard` 会 normalize 尾点、拦截 localdomain/mapped IPv6/CGNAT/198.18/IP-echo，并在 Linux 引擎用 `dns-guard` 解析 DNS；`/palette` 仍允许任意公网 HTTPS 图片（开放代理），但私网 SSRF 被挡住。
- 置信度：blocklist 决策与 `localhost.`/重定向绕过已验证；`100.100.100.200` 未实际请求（避免触碰云 metadata），属代码级允许。

### 4.3【高/中】客户端可控的 `duration` 污染 full/trial 与共享缓存

- 位置：`functions/api/music/stream.ts:80-81,97` 读取客户端 `duration`；`functions/api/sonic/resolve/stream.ts:29-30,48` 同样；`functions/_lib/sonic/native-protocols.ts:1143,1172` 把 `opts.durationSec` 直接传给 probe；`:991` 的缓存键不含 duration：

```ts
const cacheId = `${cleanSource}:${cleanId}:${quality}:${normalizeTitle(title)}:${normalizeArtist(artist)}`;
```

- 问题：对 QQ/酷狗分支，`probe.streamType === 'full'` 即 `isFull=true`，随后把 `isTrial:false, streamType:'full'` 写入 `stream-url-v1` 缓存。调用方只要传 `duration=1`（或传试听片段本身的 30），一个 30 秒试听（481,115 字节）就会被判 full：

```text
30s trial 481115 expected1  -> full  ratio=30.07
30s trial 481115 expected30 -> full  ratio=1.002
30s trial 481115 expected240-> trial ratio=0.125
```

- 影响：缓存键不含 duration，后续同 id/quality/title/artist 的正常请求会命中被污染的 full 条目，播放器不再按试听截停，UI 显示“完整流”；这不是获取完整音频，但破坏了项目“绝不把试听冒充全曲”的核心承诺。端到端需要 QQ/酷狗上游配合，未在本轮复现；缓存路径为静态代码确认。
- 建议：服务端不要信任客户端 duration；用曲目元数据并做合理范围校验；必须使用时把 duration 纳入缓存键并在命中后重新探测；对 `duration <= 0` 或明显短于试听长度的输入拒绝。
- 置信度：函数级已验证；端到端缓存污染为推断（代码路径明确）。

### 4.4【中】VBR 完整流被误判 trial（新方案未覆盖）

- 位置：`native-protocols.ts:759-800`（`parseMp3FrameHeader`）、`:798-840`（`evaluateStreamQuality`）。
- 问题：只读首帧 bitrate，把 VBR 首帧码率当作整首平均码率。ffmpeg 生成的 60 秒 VBR（`-q:a 2`）总字节 379,258，首帧 64kbps，ffprobe 平均 50.567kbps：

```text
VBR60 expected60: trial ratio=0.79 br=64 est=47.4
```

- 影响：完整 VBR 曲目被判 trial；若首帧为 320k、平均 190k，ratio 会更低（约 0.4），误判更严重。现有 34 项测试没有 VBR 用例。
- 建议：解析 Xing/Info/VBRI 的帧数/时长；无 VBR 头时不要用首帧码率做高置信度判定，改用容器/上游 duration 或放宽阈值并标 low。
- 置信度：已验证（真实 ffmpeg 文件 + 函数/probe 双路径）。

### 4.5【中】ID3 标签 >64KB 导致帧头解析失效

- 位置：`native-protocols.ts:846`（`PROBE_HEAD_RANGE_BYTES = 65_535`）、`:759-800`（解析从 `10+size` 开始）。
- 问题：probe 只取 64KB；ID3 标签（常见专辑封面）超过约 64KB 时，音频首帧在读取窗口之外，`parseMp3FrameHeader` 返回 null，走旧字节比 fallback。
- 复现：给 60 秒 128k CBR 前置 100,000 字节 ID3v2 标签（总 1,060,941 字节）：

```text
ID3-100KB 60 expected60: trial ratio=0.804 method=byte-ratio-fallback conf=low
ID3-100KB 90 expected90: trial ratio=0.536 method=byte-ratio-fallback conf=low
probe ID3-100KB expected60: trial total=1060941 ratio=0.804 ...
```

- 影响：带大封面的完整曲目被判 trial；这是比文档承认的“非 MP3 fallback”更常见的场景（ID3 封面很常见）。
- 建议：先读 10 字节 ID3 头拿到 tag size，再按 `10+size` 发第二个小 Range 取首帧；或把 head 上限提升到 512KB–1MB，并对超大标签失败时明确标 unavailable/unknown 而不是 trial。
- 置信度：已验证。

### 4.6【中】非 MP3/AAC 被误识别为 MP3 帧头，且 confidence=high

- 位置：`native-protocols.ts:759-796`（只校验 4 字节同步/版本/层/码率/采样率，未校验容器、未校验下一帧）。
- 复现：ffmpeg 生成 60 秒 AAC（m4a，971,567 字节），在偏移 1122 处被识别为 256kbps MP3：

```text
aac60: bytes=971567 header=256k/44100Hz off=1122
AAC60 expected60: trial ratio=0.506 method=mp3-frame-header conf=high br=256 est=30.4
```

- 随机 fuzz：50,007 个随机/畸形缓冲，392 个被解析为“有效”MP3 头（约 0.78%），0 次抛异常（说明无越界崩溃，但也说明误报率高）。
- 影响：非 MP3 容器可能被高置信度判 trial 甚至 full；文档“非 MP3 回退低置信度”不成立。一个 AAC 文件若首个假帧是 64k、总字节足够，可能被判 full（需构造）。
- 建议：校验 `Content-Type` 与容器 magic（`fLaC`/`ftyp`/ID3/ADTS）；解析到候选帧后计算帧长并验证下一帧同步；对非 MP3 使用容器时长解析或保守 fallback。
- 置信度：已验证（真实 AAC + fuzz）。

### 4.7【中】181,522 假流在“无可读帧头”时仍判 trial；字节范围两端有缺口

- 位置：`native-protocols.ts:784-840`（fake-clip 规则只在解析到帧头时生效）、`:678-712`（fallback 只精确匹配 181,521）。
- 复现：

```text
181522 head128: unavailable
181522 no head (fallback): trial ratio=0.034
probe CL181522 empty body: trial total=181522 ratio=0.034
99999 head128: trial ratio=0.026
300001 head128: trial ratio=0.078
```

- 影响：假流上游若返回空 body/4 字节块/不可读响应，±1 字节修复失效；99,999/300,001 字节的假流也落在范围外。前者是探测失败时的保守回退问题，后者是启发式边界。
- 建议：在 fallback 路径也应用 100KB–300KB × 短时长规则（或直接把 100KB–300KB 且无可读头判 unavailable）；把范围缺口写进测试。
- 置信度：已验证。

### 4.8【中】Auth key 的 base64url `_` 与分隔符冲突，合法邮箱无法验签

- 位置：`auth.ts:33-40`（b64url）、`:208-212`（按 `_` split 且要求正好 3 段）。
- 复现：

```text
b64url('ab?@example.test') = YWI_QGV4YW1wbGUudGVzdA   # 含 _
valid signed key for underscore-email = FALSE          # 被拆成 4 段
createSession('用户@example.test') -> THREW: Invalid character
```

- 影响：邮箱 base64url 编码含 `_`（base64url 字母表本身含 `_`，例如 `?` 位于 3 的倍数位置时）的用户登录后拿到的 key 永远无法通过；非 ASCII 邮箱直接 500。属于新格式的可用性/正确性缺陷，不是伪造绕过。
- 建议：用 base64url 字母表之外的 `.` 作为分隔符（security/fix-v2 的 `v1.<payload>.<sig>` 已这么做），或使用长度前缀；用 UTF-8 编码（TextEncoder/Buffer）替代 `btoa`；对邮箱做完整校验。
- 置信度：已验证。

### 4.9【中】签名 secret 无最小长度，1 字符仍可签发/验证

- 位置：`auth.ts:12-15`（`getSigningSecret` 只 trim，不校验长度）。
- 复现：

```text
createSession({SONIC_SECRET:'x'}) -> 成功
verifyAuth(key, {SONIC_SECRET:'x'}) -> TRUE
```

- 影响：若生产环境把 `SONIC_SECRET` 配成短字符串（或误配空/空白以外的弱值），持有任意一个合法 key 的攻击者可离线暴力破解 HMAC 密钥并伪造任意邮箱/过期时间。`origin/security/fix-v2` 的 `secrets.ts` 要求 ≥32 字符，建议采用。
- 置信度：已验证；实际生产配置未知。

### 4.10【中/低】已验签 key 缓存无界 + key 字符串可无限变体

- 位置：`auth.ts:132-134,206-243`（`memoryKeyToSession` 无上限；验签通过后按原始字符串写入）。
- 复现：标准 base64（含 `+`/`/`/`=`）变体通过验签（见 3.1）；`atob` 还忽略空白，理论上同一 payload 可构造大量不同字符串。`evaluateGatewayRateLimit` 在限流判断前调用 `verifyAuth`，429 也会先写入缓存。
- 影响：持有一个合法 key 的用户可制造大量等价 key 字符串，增长 `memoryKeyToSession`；在长驻的 VPS 引擎上可能造成内存压力。未做端到端压测，属代码级推断。
- 建议：验签前规范化 key（只接受一种编码），缓存按规范化 payload 去重并设上限；把 auth 缓存放在限流之后或对无效/超限请求短路。
- 置信度：变体验签已验证；内存增长为推断。

### 4.11【低】过期时间无上限；无 TTL 上限校验

- 位置：`auth.ts:215-222`。
- 复现：用测试 secret 签 `+275760-09-13T00:00:00.000Z`，`verifyAuth` 返回 true（`Date.getTime()` 仍是有限数，不触发 NaN 拒绝）。
- 影响：只有持有 secret 的一方能签发，因此不是直接伪造；但验证层无法防止误签/泄露后的超长有效期 key，也说明“过期校验”只有下界没有上界。建议校验 `expiresAtMs - now <= MAX_TTL`，并拒绝非规范 ISO。
- 置信度：已验证（用测试 secret 自签）。

### 4.12【中/低】探测不校验 Content-Type，HTML 200 可被判 full

- 位置：`native-protocols.ts:891-925`（probe 只读 status/Content-Range/Content-Length）。
- 复现：本地服务返回 `Content-Type: text/html`、3.84MB、开头放一个 128k MP3 头：

```text
probe text/html 3.84MB with MP3 header: full total=3840000 ratio=1 conf=high
```

- 影响：上游错误页/反盗链页若返回 200 + 大 Content-Length 且含假同步，会被当成完整音频；真实 CDN 错误页通常不满足，但这是纵深防御缺口。建议 probe 要求 `content-type` 以 `audio/` 开头（或明确允许的容器类型），否则 unavailable。
- 置信度：已验证（构造场景）。

### 4.13【低】`readHeadBytes` 只读 4 个 chunk，慢速小块响应会误判

- 位置：`native-protocols.ts:860-889`（`if (chunks.length >= 4) break`）。
- 复现：本地服务以 4 个 1 字节 chunk 返回、Content-Length 960,000：

```text
probe dribble 4 bytes CL960000: trial total=960000 ratio=0.727 conf=low
```

- 影响：CDN 若以极小块传输（或反盗链限速），头部解析失败并回退 trial。建议按累计字节数而非 chunk 数停止，或在 4 个 chunk 后继续读到 maxBytes/超时。
- 置信度：已验证（构造场景）。

### 4.14【中】文档/证据过度声明，20 首表不能验证新算法

- 位置：`docs/KNOWN_ISSUES.md:25-36`、`docs/AUDIT_HANDOFF.md:115`、`scripts/measure-20-sample-songs-raw.mjs:227`、`reports/raw_20_songs_probe_results.json`。
- 事实：
  - 80 个来源结果中 `X-Sonic-Stream-Type` 出现 **0 次**；首个样本只有 `x-sonic-provider`/`x-sonic-via`/`x-sonic-circuit`。
  - measure 脚本第 227 行仍调用 `evaluateRelativeBytes(...)`（旧的 176kbps 字节比），没有调用 `evaluateStreamQuality`；`judgment` 由该旧公式生成。
  - 线上 `GET /api` 仍无顶层 `brand`，两域 engine health 401；生产仍是 main 行为。
  - 因此：统计数字本身与 raw/summary/文档完全一致（4/10/3/3 等），但它是 main 生产的观测，不是 f34285f 新算法的验证。
  - `AUDIT_HANDOFF` 的“60~90 秒完整 128k 等审计反例均不再误判”只在 duration 元数据存在时成立；VBR/大 ID3/AAC/无 duration 仍误判。
  - `KNOWN_ISSUES` 的“非 MP3/无法解析回退 low confidence”与 AAC 实测（high confidence、假帧头）不符。
- 建议：在修复分支部署后用新 classifier 重跑 20 首，并记录 `X-Sonic-Stream-Type`；把 VBR/大 ID3/AAC/无 duration 纳入测试；把“不再误判”改为“在 duration 元数据存在且为 CBR MP3 时不再误判”。
- 置信度：raw 字段统计、脚本代码、线上响应均已验证；因果解释为推断。

### 4.15【中】f34285f 未修复 OAuth state/origin 与 key 交付面（security/fix-v2 已修）

- 位置：`functions/api/auth/login.ts:10-12`（`state` 来自客户端 query，默认 `sonic_login`）；`functions/api/auth/callback.ts:17-58`（不校验 state；token exchange 和成功跳转都用 `url.origin`；apiKey 放 URL fragment）。
- 问题：
  - 没有服务端随机 state/cookie，callback 不比对 state → 登录 CSRF。
  - 成功跳转 `new URL('/', url.origin)` 使用请求 origin；若应用可经非预期 Host/代理访问，刚签发的 API Key 会被跳到该 origin 的 fragment。`EPOMAIL_BASE_URL` 也不强制 HTTPS。
  - `origin/security/fix-v2` 已实现随机 state cookie、PKCE、固定/白名单 origin、HTTPS 基址（提交 `9355ae0`/`2314191`/`7030de2`）；`f34285f` 没有。
- 影响：登录 CSRF；在特定 Host/代理配置下可能泄露新 key；不是上一轮的已列项，但属于本轮安全审查的新发现（代码在 main 已存在，f34285f 未覆盖）。
- 建议：移植 security/fix-v2 的 state/PKCE/origin 逻辑；API Key 不要放 URL fragment，改用一次性的服务端交换或安全存储。
- 置信度：代码级已验证；实际 Host 攻击面依赖部署。

### 4.16【低】LICENSE、jq、E2E puppeteer 依赖仍未落实

- `f34285f` 根目录无 LICENSE（上一轮发现 11 未修复）；`origin/security/fix-v2` 有 LICENSE。
- `scripts/rollback-production.sh` 仍直接调用 `jq`，无 `command -v jq` 前置检查（上一轮发现 12 未修复）。
- `scripts/verify-preview-e2e.mjs` 仍 `import puppeteer from 'puppeteer'`，但 `package.json` devDependencies 只有 `jiti`/`esbuild`；文档 `AUDIT_HANDOFF` 仍指导运行该 E2E，fresh clone 会 `ERR_MODULE_NOT_FOUND`（上一轮发现 9 的残留）。
- 建议：补 LICENSE（区分代码/内容许可）、加 jq 检查、把 puppeteer 作为可选依赖或从文档移除该验证命令。
- 置信度：已验证（文件存在性/import/package.json）。

### 4.17【低】`/api/sonic/forward` 白名单包含网关自身域，存在自递归放大面

- `isAllowedMediaHost` 允许 `epocanvas.tech`，其中包含 `sonic.epocanvas.tech`；forward 可以请求自己的 `/api/sonic/forward?url=...`，形成嵌套转发。URL 长度 2048 限制嵌套深度，但每层都会消耗一次限流额度和上游请求。代码级推断，未做端到端递归测试。
- 建议：forward/cover/palette 的白名单排除网关自身 host，或对目标路径做限制；对同源目标直接拒绝。

### 4.18【低】错误信息仍可能回显上游细节

- `functions/api/music/stream.ts` 的 catch 返回 `err.message`；`functions/api/sonic/forward.ts` 的 `FORWARD_ERROR` 同样；`callback.ts` 返回 OAuth provider 的 `errorText`。可能包含上游 URL/签名参数/内部错误。`origin/security/fix-v2` 有 `sanitizeErrorForClient`。建议统一脱敏。
- 置信度：代码级；未构造实际泄露。

---

## 5. 安全审查细节

### 5.1 `auth.ts` 新密钥方案

**已验证正确的部分：**

- HMAC-SHA256，消息 `${email}|${expiresAtISO}`，截断 128 位；`timingSafeEqualStr` 逐字节 XOR，长度不同提前返回（只泄露长度）。
- 过期检查 `expiresAtMs <= Date.now()`；`Number.isFinite` 拒绝 NaN；`Date` 解析失败返回未认证。
- 无 secret 时 `verifyAuth` 直接 false（fail-closed），`createSession` 抛错；运行时代码无默认 secret；`DEFAULT_CLIENT_ID`/`DEFAULT_EPOMAIL_BASE` 不是密钥。
- `?key=`/`?api_key=` 已移除；只接受 `X-Sonic-Key`/`X-CFSolara-Key`/`X-Api-Key`/`Authorization: Bearer`。
- 旧 2 段无签名 key 被拒；`solara_live_` 前缀同样验签；签名大小写不敏感（lowercase 后比较）。
- 缓存中的 session 也必须重新验签；未配置 secret 时缓存不生效。
- 时间戳溢出：`+275760-09-13` 是 JS Date 的有限上界（8.64e15），不会触发 NaN/溢出崩溃；更大的年份返回 NaN 被拒。**未发现溢出导致的绕过**，但缺少最大 TTL 校验（4.11）。

**已验证的缺陷/边界：**

- base64url `_` 与分隔符冲突（4.8）——合法 key 被拒。
- 非 ASCII 邮箱 `btoa` 抛错（4.8）。
- 无最小 secret 长度（4.9）。
- 无最大 TTL（4.11）。
- 标准 base64/空白变体被接受（4.10），缓存无界。
- `buildAuthorizeUrl` 默认 state `sonic_auth`；`login.ts` 允许客户端传 state；callback 不校验（4.15）。

**推断：** `memoryKeyToSession` 的无限增长需要持有合法 key 并发送大量变体；未做内存压测，但代码没有上限，风险成立。

### 5.2 MP3 帧头解析

**正确的部分：**

- MPEG1/2/2.5 的 Layer I/II/III 码率表与采样率表基本正确（MPEG1 L3 32–320、MPEG2 L23 8–160、MPEG2 L1 32–256、MPEG2.5 采样率 11025/12000/8000）。
- ID3v2 10 字节头 + syncsafe size + footer flag 处理；从 tag 结束位置开始扫描；扫描上限 `start+4096`，`end = min(len-3, ...)`，`i+2` 不越界。
- 畸形/截断输入：50,007 个 fuzz 输入 0 次抛异常；短 ID3、size 全 1、`0xff 0xfb` 2 字节等均安全返回 null。
- 181,521 精确签名 + 100KB–300KB × 派生时长 <15s 规则在有帧头时有效。

**缺陷/边界：**

- 不校验容器/Content-Type，随机/非 MP3 数据可误报（4.6）。
- 只校验单帧头，不校验下一帧同步/帧长；误报率高（392/50,007）。
- 只读首帧码率，VBR 误判（4.4）。
- head 上限 64KB，大 ID3 失效（4.5）。
- fallback 只在精确 181,521 时 unavailable，181,522 无可读头仍 trial（4.7）。
- 无 Content-Type 校验，HTML 可 full（4.12）。
- `readHeadBytes` 4 chunk 限制（4.13）。
- 无时长元数据时 60/90s 完整流仍 trial（3.3）；`duration` 客户端可控（4.3）。
- **超大 Range / 超大字节数**：`probeStreamPhysicalQuality` 的请求 Range 固定为 `bytes=0-65535`，不会因客户端 Range 放大；`evaluateStreamQuality(Number.MAX_SAFE_INTEGER, 240, validHead)` 返回 `full`（ratio≈2.3e9）但不抛异常/不溢出。真正原样转发客户端 `Range` 的是 stream 代理，未对 Range 上限做限制（带宽面，非解析崩溃）。
- 酷我直连分支仍无 probe（上一轮发现 7 未修复）。

### 5.3 白名单/重定向/SSRF

**f34285f 已做对的部分：**

- `isAllowedMediaHost` 后缀匹配（不是 `includes`）：`example.com`、`evil-music.126.net`、`music.126.net.evil.com` 均拒绝；`127.0.0.1.music.126.net` 被 `isBlockedSsrfHost` 的 `^127\.` 拦住。
- `fetchWithRedirectGuard`：先验证初始 URL，再 `redirect:'manual'` 逐跳验证 Location，最多 4 跳，拒绝环；本地独立测试 `localhost`→`127.0.0.1` 被 `FETCH_TARGET_BLOCKED`。
- `/api/sonic/forward`、`/api/music/stream`、`/proxy` 都接入了 guard；stream target 还有 kuwo/126.net/163.com/qq.com/kugou 后缀白名单。
- `/api/sonic/forward` 不再直通 `example.com`；8KB URL 414。

**缺口：**

- `isBlockedSsrfHost` 的 blocklist 不完整：`localhost.`、`localhost.localdomain`、`::ffff:127.0.0.1`、`::ffff:169.254.169.254`、`100.100.100.200`、`100.64/10`、`198.18/15`、`foo.localdomain` 全部 ALLOW（4.2）。
- 不解析 DNS：公网域名解析到私网（DNS rebinding）可绕过；`f34285f` 没有 `origin/security/fix-v2` 的 `dns-guard`/IP-echo 拦截。
- `/api/music/cover` 完全没用上述 guard（4.1）；`/palette` 只用了不完整的 blocklist 且无速率限制（4.2）。
- `isAllowedMediaHost` 包含 `epocanvas.tech`（网关自身域），存在自递归/自身 API 代理面（4.17）。
- probe 不校验 Content-Type（4.12）。
- 端口未限制：白名单主机可指定任意端口（`music.126.net:22` 等）；虽不构成私网 SSRF，但属纵深防御缺口。

**对照 `origin/security/fix-v2`：** 该分支的 `functions/_lib/sonic/net-guard.ts` 已覆盖尾点 normalize、`.localdomain`、IPv4-mapped/translated、NAT64、Teredo/6to4、CGNAT、198.18/15、IP-echo 域名、协议/端口/userinfo、逐跳重定向、超时/大小上限、剥离凭据；Linux 引擎另有 `server/dns-guard.ts` 解析 DNS 并拒绝私网结果。**这是本轮最值得移植的部分。** 但它仍允许 `cover`/`palette` 代理任意公网 HTTPS，且 `/palette` 未见速率限制；建议加媒体域名白名单/限流。

### 5.4 限流信任链

- `extractClientIp`：引擎密钥验签通过 → `X-Sonic-Client-IP`；否则 `CF-Connecting-IP`；否则固定 `fallback:no-terminal-ip`；完全忽略 `X-Forwarded-For`。本地/函数级均已验证。
- `evaluateGatewayRateLimit`：engine tier、api-key tier、anonymous tier；伪造 key 落匿名桶，合法 key 落 user 桶；429 带 `Retry-After`/`X-RateLimit-*`。
- 残留：`CF-Connecting-IP` 默认信任，依赖“生产只在 Cloudflare 后面”；VPS 直连/反向代理透传可绕过（3.2 F2）。每 isolate 内存计数，非全局；`origin/security/fix-v2` 有可选 KV，`f34285f` 没有。
- 速率桶 Map 有 4096 上限清理，但 key 缓存 Map 没有（4.10）。

### 5.5 其他

- `/api/sonic/forward`、`/api/music/stream`、`/proxy` 的 414 逻辑在 URL 解析后、目标解析前，8KB 输入实测 414。
- `Dockerfile.ncm` 120s/5 retries 缓解首启竞态；VPS compose 未验证。
- `player/src/utils/trialGuard.ts` 的 `resolveTrialEnd` 逻辑对 60/90s 误判 full 有缓解（播完时 `currentTime > cap` 则撤销 trial），但 30–45s 的完整短曲仍可能弹“试听结束”；HEAD 探测仍在，`streamType` 为空时仍无提示。它是 UI 层缓解，不替代服务端正确判定。
- CORS 仍 `*`、无 Allow-Credentials；API Key 走 header，没有 cookie 凭据，风险可接受；HSTS/CSP 仍未加（非本轮重点）。

---

## 6. 测试记录

| 命令/测试 | 结果 | 备注 |
| :--- | :--- | :--- |
| 全新克隆 + `git checkout feat/full-stream-priority` | tip `82cfbef`，`82cfbef..HEAD` 0 提交 | 任务指定分支未更新 |
| 82cfbef `npm install && npm test` | ❌ EXIT=1，`'jiti' is not recognized` | 零依赖问题在原分支仍存在 |
| f34285f `npm install` | ✅ 3 packages，0 vulnerabilities | 未手工装 jiti |
| f34285f `npm test` | ✅ 195/195（21+43+10+34+16+4+20+47） | EXIT=0 |
| 同上 + 全局 fetch 阻断（仅本地） | ✅ 195/195，0 条外部请求日志 | 证明离线 |
| `pnpm --dir player install` | ✅ | |
| `pnpm --dir player test` | ✅ 7 文件 32/32 | EXIT=0 |
| `node player/scripts/i18n-missing-keys.mjs` | ✅ zh/en/ja 577 键；引用 476；缺失 0 | |
| `pnpm --dir player build` | ✅ EXIT=0 | `dist/index.html` + `dist/static/` 结构正常；gzip 日志打印绝对路径属噪声 |
| `npm run build:engine` | ✅ 410.9kb，EXIT=0 | esbuild 0.25.4 |
| `npm run lint:theme` | ✅ 435 条基线，5 处目标用法，EXIT=0 | 文档 5 处一致 |
| `npm run test:live` | 未运行 | 避免平台请求预算 |
| Docker compose / VPS | 未运行 | 无 Docker 守护进程/SSH |
| `node scripts/verify-preview-e2e.mjs` | 未运行（会缺 puppeteer） | 静态确认 import；devDeps 未声明 |
| 线上只读 GET | 3 次 | `/api` 200 无 brand；两域 engine health 401 |
| 本地引擎攻击测试 | 全部 127.0.0.1:18081 | 随机测试 secret，未用真实凭据 |

本地引擎关键行为输出见 3.1–3.4 与 4.1–4.2；未在报告中打印任何 key/secret。

---

## 7. 文档与证据一致性

| 文档声明 | 实测 | 结论 |
| :--- | :--- | :--- |
| `npm test` 195 passed | 195/195 | ✅ 一致 |
| `pnpm --dir player test` 32 passed | 32/32 | ✅ 一致 |
| `lint:theme` 绿色；5 处已收录、65 条过期清理 | 绿色；435 基线；App.vue 1 + AddToPlaylistDialog 4 | ✅ 一致 |
| 20 首 netease 4/10/3/3；qq 0/1/2/17；kugou 0/0/1/19；kuwo 0/5/5/10 | 独立聚合完全一致 | ✅ 一致 |
| 4 首网易完整流 13.04/13.01/10.01/8.44MB | 十进制 MB 一致 | ✅ 一致 |
| 跨源升格 0 例 | summary 0 | ✅ 一致 |
| “60~90 秒完整 128k 不再误判” | 有 duration 时 full；无 duration 时 trial；VBR/大 ID3/AAC 仍 trial | ⚠️ 过度声明 |
| “非 MP3 回退 low confidence” | AAC 被误识别为 MP3，confidence=high | ❌ 与实测不符 |
| 20 首数据来自生产网关、作为唯一统计源 | 80/80 无 `X-Sonic-Stream-Type`，脚本用旧公式；生产 `/api` 无 brand | ⚠️ 数字对，但不能验证新算法 |
| measure 脚本严格匹配、不回退 Top1 | measure 无 `tracks[0]`；严格 title + artist；无匹配 not_found | ✅ 一致（历史脚本仍 Top1，已披露） |
| `npm install && npm test` 开箱可跑 | f34285f ✅；82cfbef ❌ | ✅ 仅对 f34285f 成立 |
| E2E 可用 | `verify-preview-e2e.mjs` import puppeteer，devDeps 无 puppeteer | ❌ 文档指导会失败 |
| LICENSE | f34285f 无 LICENSE | ❌ 上一轮发现 11 未修 |
| 回滚脚本 jq | 无前置检查 | ❌ 上一轮发现 12 未修 |

---

## 8. 上线前检查清单

### P0（合并/上线阻塞）

- [ ] **不要合并当前 `origin/feat/full-stream-priority`**（0 提交）；先把修复推送到该分支或明确改用 `security/fix-v2`。
- [ ] **合并策略**：以 `f34285f` 的 stream/deps/docs 为基础，移植 `origin/security/fix-v2` 的 `net-guard`/`dns-guard`/`secrets`/OAuth state/PKCE/HTTPS/redirect-origin 修复；不要直接合并两条分叉。
- [ ] **修 `/api/music/cover` SSRF**：媒体域名白名单 + `validateOutboundUrl`/`safeFetch`（逐跳、HTTPS、无 userinfo、端口限制、私网/映射 IPv6/localdomain/CGNAT/IP-echo 拦截、超时/大小上限、剥离凭据）；非 image/* 拒绝；回传前再次校验。
- [ ] **修 `/palette` SSRF**：同上；加速率限制；禁止任意公网 URL 或至少限制媒体/图片域名；替换不完整的 `isBlockedSsrfHost`。
- [ ] **修 duration 污染**：服务端只用可信 duration；校验范围；把 duration 纳入缓存键并在命中后重新探测；拒绝 `duration<=0` 或明显短于试听长度。
- [ ] **修 MP3 判定**：VBR（Xing/Info/VBRI）、大 ID3（按 tag size 取首帧）、非 MP3 容器（Content-Type/magic/双帧校验）、181,522 无头 fallback、99,999/300,001 边界；加回归测试。
- [ ] **修 auth 边界**：分隔符改为 `.` 或长度前缀；UTF-8 编码；邮箱校验；secret 最小 32；最大 TTL；规范化 key + 缓存上限；拒绝非规范 base64。
- [ ] **OAuth**：随机 state cookie + 校验、PKCE、固定/白名单 callback origin、HTTPS Epomail base；API Key 不放 URL fragment。

### P1（上线前强烈建议）

- [ ] 酷我直连分支补物理探测（上一轮发现 7）。
- [ ] probe 校验 Content-Type；`readHeadBytes` 按字节而非 chunk 停止。
- [ ] `isAllowedMediaHost` 排除网关自身域，防自递归；端口限制。
- [ ] 补根 LICENSE；rollback 脚本加 `command -v jq`；puppeteer 作为可选依赖或删 E2E 文档命令。
- [ ] 用修复分支重新跑 20 首探针，记录 `X-Sonic-Stream-Type`，重生成 summary；修正“不再误判”和“非 MP3 low confidence”的表述。
- [ ] 把 VBR/大 ID3/AAC/无 duration/181522 无头/HTML 200/4-chunk 慢响应加入 `test-stream-detection.mjs`；把 cover/palette SSRF 加入 `test-fetch-guard.mjs`；把 duration 污染加入 auth/stream 测试。
- [ ] 错误信息统一脱敏（stream/forward/callback）。

### P2（部署/运维）

- [ ] 确认引擎只经 Cloudflare 暴露；在反向代理层剥离客户端 `CF-Connecting-IP`；否则限流仍可绕过。
- [ ] `SONIC_SECRET` ≥32 字符并轮换；`EPOMAIL_CLIENT_SECRET` 必配；`EPOMAIL_BASE_URL` 必须 HTTPS；旧 key 全部失效并通知持有者。
- [ ] `SONIC_ENABLE_GDSTUDIO/LYRIVA/UNBLOCK=0`；`SONIC_ENGINE_SECRET` Pages/VPS 双侧一致。
- [ ] 部署顺序：先 VPS 引擎 health 200，再 Pages；上线后验证 `/api` 顶层 brand、双域匿名 401、Range 206、`X-Sonic-Stream-Type`/`X-Sonic-Trial-Duration`。
- [ ] 若需要全局限流，接入 KV/Redis；否则在文档持续注明 per-isolate。
- [ ] 评估私有接口的平台 ToS 风险（提示，非判决）。

### 上线前验收命令（建议）

```bash
# 1) 干净克隆 + 修复分支
npm install && npm test                 # 期望 195/195, 离线
pnpm --dir player test                  # 期望 32/32
node player/scripts/i18n-missing-keys.mjs
pnpm --dir player build
npm run build:engine
npm run lint:theme

# 2) 本地引擎回归（随机测试 secret）
#    auth: forged/tampered/expired/query → 401；valid → 200；email 含 _ → 200
#    rate: 11 次匿名 → 第 11 次 429；伪造 X-Sonic/XFF 轮换 → 429；引擎 key 转发 IP
#    stream: 60/90s CBR full；VBR/ID3/AAC 反例；181522；206 no CR；duration=1 不得 full
#    ssrf: cover/palette 对 127.0.0.1/localhost./映射 IPv6/CGNAT/redirect → 400
#    forward/proxy: example.com/127.0.0.1/169.254 → 400；8KB URL → 414

# 3) 线上只读
#    GET /api → brand 存在；两域 engine health → 401
#    GET /api/music/stream?id=<free>&quality=320 with Range → 206 + 正确 headers
```

---

## 9. 披露与限制

1. **线上请求**：本轮对线上域名共 3 次只读 GET（`sonic.epocanvas.tech/api`、`sonic.epocanvas.tech/api/sonic/engine/health`、`engine-sonic.epocanvas.tech/api/sonic/engine/health`），未做绕过/压测/攻击。上限 10 次，未超。
2. **意外上游请求（如实披露）**：在限流测试早期，误用了 `/api/sonic/forward?q=test` 6 次；该端点执行了 Nexus 搜索，可能向第三方平台发起上游请求。请求对象是本机实例，不是直接从审计机访问平台域名；具体平台请求数未能精确统计。发现后立即停止，后续只用无参数的 `/api/music/stream` 做限流测试。这是本轮唯一超出“仅本地攻击测试”精神的操作，特此披露。
3. **未执行**：`npm run test:live`（平台预算）、`docker compose up`（无守护进程/SSH）、`verify-preview-e2e.mjs`（puppeteer 未声明）、`rollback-production.sh --execute`（禁止）、任何 push（禁止）、真实凭据（未使用）。
4. **20 首 JSON**：未重新运行 measure（会访问生产/平台）；只对开发者已重生成的 raw JSON 做独立聚合与一致性核对。任务中“重新生成的 JSON”指仓库现有新 JSON，本轮验证其数字与文档一致，但无法验证其运行时刻的网关代码版本（证据显示为 main）。
5. **环境**：Windows 10.0.26200 + Git Bash，Node v24.14.0，npm 11.9.0，pnpm 10.34.5，ffmpeg/ffprobe N-121335。随机测试 secret 由 `openssl rand -hex 32` 生成，未打印。
6. **分支来源**：`f34285f` 来自工作区 bundle（`git bundle verify` OK，依赖 `82cfbef`），不是 origin；`origin/security/fix-v2` 仅做静态对照，未对其进行完整行为测试。合并前必须由维护者确认这三条线的最终取舍。

---

## 10. 附录：关键原始输出索引

- 3.1：auth 矩阵（TRUE/FALSE 列表）。
- 3.2：限流数组 A–F2。
- 3.3：CBR/VBR/AAC/大 ID3/181522/duration/206/HTML/dribble 输出。
- 3.4：forward/stream/proxy 的 400/414 与逐跳重定向输出。
- 3.5：82cfbef 与 f34285f 的安装/测试输出、离线阻断结果。
- 3.6：独立聚合 JSON 与 4 首完整流字节数。
- 3.7：lint 435/5 输出。
- 4.1/4.2：cover/palette 的 200/400 与 blocklist ALLOW 列表。
- 4.14：80/80 无 `X-Sonic-Stream-Type`、measure 第 227 行旧公式、线上 `/api` 无 brand。
- 4.9/4.11：弱 secret、远期过期、标准 base64 变体的 TRUE 输出。

**报告结束。**
