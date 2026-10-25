# CFSolara 审计修复报告(feat/full-stream-priority)

> 基于 `82cfbef` 之后追加 9 个提交;每个问题均"先写复现测试 → 修复 → 测试通过"。
> 全部通过:`npm test` **195/195**(8 个纯离线套件,3 连跑稳定)、`pnpm --dir player test` **32/32**、`npm run build:engine`、`pnpm --dir player build`。
> **推送未完成**:本会话环境无法非交互完成 GitHub 认证(GCM 弹窗被自动取消,机器上无 gh CLI/凭据缓存/令牌环境变量)。提交已安全转移到你的工作区仓库本地分支 `feat/full-stream-priority`(tip `f34285f`),工作区当前工作树未做任何改动;另有备份 bundle `cfsolara-audit-fixes.bundle`。执行推送(见文末)。
> 未打印、未使用任何令牌。

---

## 1. 提交清单(哈希 + 主题)

| 哈希 | 主题 | 对应问题 |
| --- | --- | --- |
| `b72ccc3` | fix(auth): enforce HMAC-SHA256 signed API keys with expiry and fail closed on missing secrets | 必修 1 |
| `7c409a4` | fix(security): rate-limit trust chain — X-Sonic-Client-IP only for authenticated engine hops | 必修 2 |
| `9bd6ce1` | fix(stream): duration-based trial detection from real MP3 frame header + player misjudgment guard | 必修 3 |
| `c3f1350` | chore(deps): declare devDependencies, add lockfile, split offline vs live test suites | 应修 5 |
| `19212dd` | fix(security): media-host allowlists + per-hop redirect re-validation for proxied fetches | 应修 6 |
| `dc3bd02` | fix(http): reject oversized request URLs with 414 instead of surfacing a 500 | 应修 7 |
| `072d6b5` | test: drain event loop instead of process.exit in mock-server suites | 测试基建(Windows libuv 退出断言) |
| `881f77e` | chore(docker): tolerate ncm-api sidecar first-boot xeapi key race | 应修 8(代码部分) |
| `f34285f` | fix(evidence): strict 20-song matching + single-source stats; correct docs against audit evidence | 必修 4 |

另有工作区未跟踪文件:`cfsolara-audit-fixes.bundle`(推送备份)、本报告。

---

## 2. 各问题修复前后证据(git blame 归属 + 复现/验证)

### 必修 1 · API Key 不验签 — **blame:main 已有**(`2f8e819b` 2026-09-19 引入,非本分支)
- **修复前(实测复现)**:伪造键 `sonic_live_<b64(邮箱)>_deadbeef…` 通过 `verifyAuth` 得 HTTP 200;新套件在旧代码上 **13/21 失败**(垃圾签名、篡改邮箱、过期、篡改过期时间、缺 secret 全部放行)。
- **修复后**:`sonic_live_<b64url(email)>_<b64url(expiresAtISO)>_<HMAC-SHA256(secret,"email|expiresAt")[0:32]>`;常量时间比较 + 过期检查 + 内存缓存命中也重新验签;无 `SONIC_SECRET`/`SOLARA_SECRET` 时验证一律未认证、签发抛错;删除 `DEFAULT_CLIENT_SECRET`/`DEFAULT_SIGNING_SECRET`,`EPOMAIL_CLIENT_SECRET` 缺失时 OAuth 兑换明确报错;`?key=`/`?api_key=` 移除。
- **验证**:`test-auth-signature.mjs` 21/21(含指定 7 类用例);`test-auth-compatibility.mjs` 43/43(旧格式键断言反转为拒绝);引擎 bundle 构建通过。
- **文档**:API.md 密钥格式与 `&key=` 示例已更新;`.env.example` 标注两项必配。

### 必修 2 · 限流绕过 — **blame:main 已有**(`c1c9bac4`)
- **修复前(实测复现)**:250 连发触发 429 后,轮换伪造 `X-Sonic-Client-IP` 6 连发全部放行;`X-Forwarded-For` 同样可换桶。新套件旧代码 **7/10 失败**。
- **修复后**:`extractClientIp(request, env)` 信任链 = 引擎密钥验证通过才接受 `X-Sonic-Client-IP` → 否则 `CF-Connecting-IP` → 都没有落入固定兜底桶(`fallback:no-terminal-ip`)并一次性告警日志;完全不信任 `X-Forwarded-For`。边缘与引擎调用点(`evaluateGatewayRateLimit`、`local-engine.ts`)均已传 env。
- **验证**:`test-rate-limit-trust.mjs` 10/10(伪造 IP/XFF 轮换不再绕过;引擎调用方可转发终端 IP;兜底桶共享)。
- **文档**:API.md 如实注明限流为**每 isolate 进程内存、非全局限流**。

### 必修 3 · 试听/完整流误判 — **blame:本分支引入**(`f1c0974` 的相对阈值)
- **修复前(审计实测)**:60~90s 完整 128k(ratio 0.727)、请求 flac 实际 320k(0.727)被误判 trial;181,522 字节绕过假流精确匹配;206 无 Content-Range(CL:1)被判 trial。
- **修复后**:`evaluateStreamQuality()` 解析 MP3 帧头(跳过 ID3v2)得**真实码率**,`实际时长=总字节×8/真实码率`,≥90% 预期时长判 full;`confidence` 三级标注(high/medium/low,非 MP3 走保守字节比回退);假流 = 181,521 精确快速通道 + 字节范围(100k~300k)×派生时长<15s;`probeStreamPhysicalQuality` 改取 64KB 头部 Range(有界读取),206 无 Content-Range 一律 unavailable;播放器 `resolveTrialEnd()`:探针未取到头不按试听截停,实际播放超过试听上限(用 `audio.currentTime`,暂停免疫)撤销误判的 trial 状态并恢复正常连播。
- **验证**:`test-stream-detection.mjs` 34/34(含全部指定反例 + 本地受控服务器);网关 Test 12 重写,套件 20/20;`player/tests/trialGuard.test.ts` 5 例,播放器 32/32;`pnpm --dir player build` 通过。
- **说明**:48kbps 完整长度从"故意判 trial"(KNOWN_ISSUES 旧§2)改为正确判 full(真实码率下时长吻合);文档已同步改写。

### 必修 4 · 文档与证据一致性 — **blame:measure 脚本与 KNOWN_ISSUES 为本分支引入**(`f1c0974`/`82cfbef`);lint 违规行 main 已有
- **修复前(实测)**:measure 脚本仅歌手子串匹配 + 回退 `tracks[0]`;旧 JSON 中《晴天》命中 Lucky小爱、《稻香》命中"周杰伦./街道办GDC";文档"宽松 8 首/严苛 6 首"与 JSON 至少 3 处矛盾(残酷天使 9.36MB 完整流 vs JSON 失败;稻香 9.26MB vs 4.8MB;理想三旬 谢春花 7.58MB vs 陈鸿宇 8.44MB)。
- **修复后**:
  - 严格匹配(标题归一化相等 + 歌手归一化包含/分片相等),无匹配记 `not_found` 绝不回退 Top1(离线用例 5/5 验证:拒绝两个翻唱、接受冯沁苑/DAOKO× 合法变体);
  - **重新实测 20 首**(2026-10-25,生产网关):`reports/raw_20_songs_probe_results.json` 重生成(入库前脱敏扫描:无 IP/令牌/Cookie/签名 URL);新 `scripts/summarize-20-songs.mjs` 生成唯一统计表 `reports/raw_20_songs_summary.json`:**netease 4 完整/10 试听/3 not_found/3 失败;qq 0/1/2/17;kugou 0/0/1/19;kuwo 0/5/5/10;跨源升格 0 例**;
  - KNOWN_ISSUES:删除"8 首/6 首"不可复现口径,改为引用生成的表;《晴天》《稻香》《残酷天使》记 not_found;跨源兜底出完整流标记为**未确认**(本轮 0 例);旧阈值公式章节替换为时长比公式;
  - lint:theme:实测 5 处违规系 main 既有(App.vue:42、AddToPlaylistDialog.vue:94/96/150/156)+ 基线漂移 65 条;按工具机制重生成基线,现绿色;KNOWN_ISSUES 第六节如实记录;
  - AUDIT_HANDOFF:测试预期更新为 195/32/绿色,交付项 3/4 措辞与证据对齐。

### 应修 5 · 依赖与测试拆分 — **blame:main 已有**(零依赖清单早于本分支)
- 修复前:新克隆 `npm test` → `'jiti' is not recognized`(实测复现)。
- 修复后:devDependencies(jiti ^2.7.0、esbuild 0.25.4)+ `package-lock.json` 入库;`npm test` = 8 个纯离线套件(195 例,不访问外网);联网测试拆至 `npm run test:live`(test-sonic-gateway-live + test-cover-gateway);degradation 套件 cfEnv 补 `SONIC_ENABLE_KUWO:'0'` 保证离线。
- **验证**:删除 node_modules 后全新 `npm install && npm test` → 195/195。

### 应修 6 · forward/proxy 开放代理与重定向 — **blame:main 已有**(forward.ts 未在本分支改动)
- **修复前(实测)**:`/api/sonic/forward?url=http://example.com/` 200 直通(任意公网 URL);三处 fetch 均 `redirect:'follow'` 仅校验初始主机。
- **修复后**:`isAllowedMediaHost()` 后缀白名单(网易/QQ/酷狗/酷我 CDN、gtimg.cn、lrclib、amll、epocanvas 域)作用于初始 URL 与**每一跳重定向**;`fetchWithRedirectGuard()`(redirect:'manual' + 逐跳 re-validate + 上限 4 跳)应用于 forward、stream 代理、legacy /proxy;顺带修复 `cfg.gdstudioUrl` 属性名潜伏 bug。
- **验证**:`test-fetch-guard.mjs` 16/16(私网重定向被逐跳拦截、合法重定向跟随、环终止)。

### 应修 7 · 超长 URL 500 — **blame:main 已有**
- 修复前:8KB target URL → 500(实测)。修复后:三端点 `>2048` 字符一律 **414**。`test-url-length.mjs` 4/4。

### 应修 8 · Docker 验证与侧车竞态 — **blame:Dockerfile.ncm 为 main 已有**(`adbbb8d`)
- **代码**:Dockerfile.ncm healthcheck start-period 15s→120s、retries 3→5,容忍首启 xeapi 公钥竞态崩溃-重启循环(本地实测复现:第一次启动 `xeapi public key is missing` 退出,第二次启动成功,密钥持久于容器 FS)。
- **VPS compose 全新目录验证:未执行,状态未确认** —— 本会话无 SSH 访问权限(且审计约束禁止 SSH),请你按 KNOWN_ISSUES §8 的命令序列执行(独立 `-p` 项目名 + `SONIC_BIND_PORT` 换端口,不影响生产容器)。
- **本地 Docker:守护进程无法启动**(Docker Desktop backend 拉起但 engine npipe 不可用,多次尝试);替代完成:`docker compose --project-name audit-verify config` 校验通过(端口 127.0.0.1→8080、service_healthy 依赖解析正常)。引擎与侧车已以同版本 Node 进程等价验证过健康检查/匿名 401/Range 206(见审计报告)。

---

## 3. 需要你在 Cloudflare(及 VPS)检查或轮换的环境变量名(不含值)

| 变量名 | 动作 |
| --- | --- |
| `SONIC_SECRET` | **必配 + 建议轮换**(新签名密钥;配置后所有历史无签名 `sonic_live_`/`solara_live_` 键自动失效) |
| `SOLARA_SECRET` | 如曾单独使用,确认与 `SONIC_SECRET` 策略一致 |
| `EPOMAIL_CLIENT_SECRET` | **必配确认**(缺失时登录明确报错,不再有默认值) |
| `SONIC_ENGINE_SECRET` | 确认 Pages 与 VPS 双侧一致(语义未变,不强制轮换) |
| `SONIC_ENABLE_GDSTUDIO` / `SONIC_ENABLE_LYRIVA` / `SONIC_ENABLE_UNBLOCK` | 确认生产为 `0` |
| `SONIC_REAL_IP` | 可选;仍默认 NeteaseCloudMusicApi 社区文档示例 IP |

另请知悉:所有已签发给第三方/前端的旧 API Key 会在部署后立即失效,持有者需重新登录获取(登录流程本身要求 `EPOMAIL_CLIENT_SECRET` 已配置)。

---

## 4. 剩余已知问题(如实)

1. **FLAC/非 MP3 容器**不走帧头解析,回退字节比启发式(confidence=low),仍可能保守误判(KNOWN_ISSUES §2 已记录)。
2. **kuwo 直连解析分支**仍无物理探测,≥350KB 即标 full(审计发现 7,本次任务范围未要求,未修)。
3. **跨源兜底出完整流**在本轮 20 首重测中 0 例升格,能力真实存在但效果**未确认**;旧文档的喜帖街 >3MB 案例未复现。
4. **限流为每 isolate 内存计数**,多隔离下全局配额放大(API.md 已如实注明)。
5. **`npm run test:live` 拆分后未运行**(其内容与原通过用例相同、仅移动;避免再次消耗平台请求预算)。
6. **生产仍运行 main 分支代码**:线上 `/api` 顶层 `brand` 缺失;合并并按 KNOWN_ISSUES §8 顺序部署(先引擎后 Pages)后恢复。
7. **并行分支提醒**:`origin/security/fix-auth-ratelimit-ssrf`(7 个提交,基于同一基点)与本批修复高度重叠,合并前请二选一,直接合并会产生冲突。
8. 试听徽章/`streamType` 展示与真实码率 UI 联动(用 `realBitrateKbps` 覆盖音质徽标)仍是待办(KNOWN_ISSUES §4)。

## 5. 推送(需要你在有凭据的终端执行,二选一)

```bash
# 方式 A:工作区仓库(已建好本地分支 feat/full-stream-priority,tip f34285f)
cd "D:\Users\Smart Kevin\OneDrive\Desktop\sonic"
git push origin feat/full-stream-priority

# 方式 B:从 bundle 恢复到任意克隆后推送
git fetch "D:\Users\Smart Kevin\OneDrive\Desktop\sonic\cfsolara-audit-fixes.bundle" feat/full-stream-priority:refs/heads/feat/full-stream-priority
git push origin feat/full-stream-priority
```

普通 fast-forward 推送(基于 `82cfbef`),未强推、未推标签、未动 main、未建 PR。
