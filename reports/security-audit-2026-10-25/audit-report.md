# shijianus/CFSolara 独立安全与质量审计报告

> 审计对象:`origin/feat/full-stream-priority` 相对 `origin/main` 的全部改动 + 完整文件
> 审计方式:全新临时目录克隆 + 本地实际运行/测试(非纯读代码)
> 审计日期:2026-10-25 | 审计人与开发者无利益关系
> 本报告不包含任何密钥内容;发现的真实敏感信息只报告位置与类型。

---

## 1. 总体结论

**有条件可合并**:本分支的核心功能(试听透明标识、相对阈值判定、跨源兜底、非破坏回滚)经本地实测基本真实有效,全历史无凭据泄漏,SSRF/路径穿越防护在全部注入用例下成立,加密实现经标准测试向量验证正确。**但不建议在完成下列阻塞项之前直接上线**:(1) `verifyAuth` 完全不校验 API Key 签名,任何 `sonic_live_` 前缀键可被伪造(已行为级复现);(2) 限流可被客户端伪造 `X-Sonic-Client-IP` 头绕过(已行为级复现);(3) 交接文档与已知问题文档存在多处与实测证据矛盾的不实陈述(见发现 3/4/14);(4) 根 `package.json` 零依赖声明导致全新环境 `npm test` 必然失败(实测复现)。此外相对阈值对短曲目/flac 档的误判面比文档承认的更宽,会触发"完整曲被当试听截停"的用户可见回归,需产品层面确认。

---

## 2. 环境与版本

### 2.1 三个引用的提交哈希(与预期值全部一致)
| 引用 | 实际哈希 | 预期 | 一致 |
| --- | --- | --- | --- |
| `origin/main` | `d062882b7ec274ff9e1bbdf23bdcc7cc1d7b8bd9` | `d062882b…` | ✅ |
| `origin/feat/full-stream-priority` | `82cfbefbce233a8d9a42affac06751e8b343acbe` | `82cfbefb…` | ✅ |
| `origin/chore/integrate-final-scripts` | `059ff747237175474c263a58e89d784c75f8663d` | 文档未给预期值 | — |

审计基线:分支相对 main 共 10 个提交、32 个文件(+4092/−107)。

### 2.2 运行环境
- Windows 10.0.26200 (MINGW64/Git Bash),git 2.52.0
- Node v24.14.0,npm 11.9.0,pnpm 10.34.5,esbuild 0.25.4(本地 `--no-save` 临时安装)
- Docker 29.1.2 + Compose v2.40.3 已安装,但 **Docker Desktop 守护进程在本环境无法拉起**(GUI 进程不启动,npipe 连接失败)——按预案改用 `npm run build:engine` + Node 直启引擎,ncm-api 侧车以 `@neteasecloudmusicapienhanced/api@4.41.1` 本地进程替代(与 `Dockerfile.ncm` 同版本同命令)。
- ffprobe N-121335(用于音频真实性校验)
- 引擎密钥:审计员自行 `openssl rand -hex 32` 生成,未使用仓库历史中任何值。

---

## 3. 发现清单(按严重级别排序)

> 级别:严重 / 高 / 中 / 低 / 提示。"已验证"= 本审计复现或取得直接证据;"推断"= 基于代码逻辑的判断。

---

### 【发现 1】高 · API Key 鉴权完全不校验签名,可任意伪造

- **位置**:`functions/_lib/auth.ts:149-184`(`verifyAuth`),`functions/_lib/auth.ts:3-6`(硬编码默认密钥)
- **问题**:`verifyAuth` 对 `sonic_live_`/`solara_live_` 键只做 base64 解码并检查解码结果含 `@`,**从不校验第二段的 HMAC-SHA256 签名**(`createSession` 生成的签名形同虚设)。任何字符串 `sonic_live_<base64(含@字符串)>_<任意串>` 都会通过认证并取得 `api-key` 档位(600rpm,匿名仅 240rpm)。同时存在硬编码默认密钥常量(默认 client secret、默认签名密钥),在未配置环境变量时生效——但由于验证环节根本不验签,这些密钥当前并无实际防护作用。
- **复现(本地实测)**:
  ```bash
  FORGED="sonic_live_YXVkaXQtdGVzdEBleGFtcGxlLmludmFsaWQ_deadbeefdeadbeefdeadbeefdeadbeef"
  curl "http://127.0.0.1:8081/api/sonic/search/kuwo?q=test&count=1&nocache=1" -H "X-Sonic-Key: $FORGED"
  # 实际输出:HTTP 200(伪造键被接受)
  ```
- **建议**:在 `verifyAuth` 中重算 `HMAC(email|expiresAt, SONIC_SECRET)` 并常量时间比对;未配置 `SONIC_SECRET` 时应拒绝该档位(fail-closed);移除硬编码默认密钥。
- **置信度**:已验证(行为级,本地实例复现;代码路径静态确认)。
- **补充**:同一函数支持 `?api_key=`/`?key=` 查询参数传键(`auth.ts:132`),键值会进入访问日志与边缘缓存键(见发现 6)。

---

### 【发现 2】高 · 限流可被伪造 `X-Sonic-Client-IP` 头绕过

- **位置**:`functions/_lib/sonic/security.ts:112-119`(`extractClientIp` 优先信任 `X-Sonic-Client-IP`),`security.ts:121-183`(限流按该 IP 分桶);`functions/_lib/sonic/local-engine.ts:175`(边缘还会把该头转发给引擎)
- **问题**:客户端可每次请求携带不同的 `X-Sonic-Client-IP: <随机IP>`,每个新 IP 获得全新 240rpm 匿名桶,限流形同虚设。边缘与引擎两层同受影响(引擎把该头作为可信入参)。
- **复现(本地实测)**:
  ```bash
  # 先打满当前桶:250 连发 → 240 个 400 + 10 个 429(限流本身有效)
  # 换伪造 IP:
  for i in 1..6: curl -H "X-Sonic-Client-IP: 203.0.113.$i" .../api/music/stream
  # 实际输出:6 个全部 400(通过,未触发 429)
  ```
- **建议**:边缘层只信任 `CF-Connecting-IP`(Cloudflare 托管值),删除对 `X-Sonic-Client-IP` 的第一优先级信任;引擎层只接受**经引擎密钥鉴权的调用方**发来的该头。
- **置信度**:已验证(本地行为级;边缘层 CF 不剥离任意自定义 X- 头属推断,置信中高)。

---

### 【发现 3】高 · 交接文档对"measure 脚本已修复歌手过滤"的声明与证据 JSON 直接矛盾(报告真实性)

- **位置**:`docs/KNOWN_ISSUES.md:17`;`scripts/measure-20-sample-songs-raw.mjs:147-155`;`reports/raw_20_songs_probe_results.json`
- **问题**:KNOWN_ISSUES 声称全量采集脚本"已修复该缺陷,加入了 title 与 artist 的归一化过滤"。实测该脚本:
  1. **没有任何标题匹配**,只有 artist 子串匹配(`tArtist.includes(qArtist) || qArtist.includes(tArtist)`);
  2. 子串匹配失败时**静默回退 `tracks[0]`**(即"取第一个搜索结果"缺陷原样保留);
  3. 证据 JSON 证明两处翻唱命中:
     - 《晴天》(搜索词"晴天 周杰伦")→ 命中 `2652820720 "晴天(深情版)" - Lucky小爱`,11,161,644 字节,被记为"完整流";
     - 《稻香》→ 命中 `3381542797 "稻香(治愈版)" - "周杰伦. / 街道办GDC/欧阳耀莹."`(仅凭 artist 字符串含子串"周杰伦"通过),ffprobe 时长 120 秒(原曲约 223 秒),4,802,925 字节。
- **建议**:要么真正实现归一化过滤(标题严格匹配 + 歌手 Levenshtein ≥ 阈值,复用网关侧 `titlesMatchStrictly`/`artistsMatchStrictly`),要么在文档中如实改述"measure 脚本仍为 artist 子串优先 + Top1 回退"。
- **置信度**:已验证(脚本代码 + JSON 证据双重确认)。

---

### 【发现 4】中 · KNOWN_ISSUES §3 的网易云基线清单与原始数据 JSON 多处对不上

- **位置**:`docs/KNOWN_ISSUES.md:42-58` ↔ `reports/raw_20_songs_probe_results.json`
- **问题**:JSON 实际统计为 **网易 7 完整 / 12 试听 / 1 失败**;文档给出口径为"宽松 8 首完整"与"严苛 6 完整 / 13 试听 / 1 失败"。逐曲核对至少 3 处硬矛盾:
  | 曲目 | KNOWN_ISSUES 声称 | JSON 实际记录 |
  | --- | --- | --- |
  | 残酷な天使のテーゼ | 宽松口径 8 首之一,"完整流 9.36MB" | **失败**(`total=0`,`failReason` 非空) |
  | 稻香 | Lucky小爱翻唱 9.26MB | 街道办GDC 版本 4.80MB(不同曲目) |
  | 理想三旬 | 谢春花 7.58MB | 陈鸿宇 8.44MB(不同歌手不同文件) |
- 三种口径(7/12/1、8/?、6/13/1)互不吻合,文档未说明 8 首清单的出处运行与 JSON 的关系。
- **建议**:以 JSON 为唯一事实来源重述统计;或注明各口径对应的具体运行产物与时间。
- **置信度**:已验证(程序化逐项比对)。

---

### 【发现 5】中 · 相对阈值误判面比 KNOWN_ISSUES 承认的更宽(短曲目 / flac 档 / ±1 字节 / 缺 Content-Range)

- **位置**:`functions/_lib/sonic/native-protocols.ts:678-712`(`evaluateStreamTypeByRelativeBytes`)、`:714-748`(`probeStreamPhysicalQuality`)
- **审计员自写边界测试结果**(38 项,含与 KNOWN_ISSUES 一致的场景):
  - ✅ 复现已披露场景:48kbps 完整流(270s@48k=1.62MB,按 320k 请求)ratio=0.2727 → `trial`(KNOWN_ISSUES §2 所述"防御性误判"属实);
  - ❗ **新场景 A**:60~90 秒的完整 128kbps 曲目按 320k 请求 → ratio=0.7273 → **`trial`**(如 90s×16,000B=1,440,000B,基线 1,980,000B)。完整曲被标试听后,前端"播完不跳歌"逻辑会截停播放并弹"试听结束"提示;
  - ❗ **新场景 B**:请求 `flac`(nominal=800kbps)但上游只有 320k 完整 MP3(9.6MB/240s)→ ratio=0.7273 → **`trial`**;
  - ❗ **新场景 C**:酷我假流拦截为**精确匹配 181,521 字节**(`native-protocols.ts:688`)——实测 181,522 字节即绕过,返回 `trial`(非 `unavailable`),±1 字节可改变判定档位;
  - ❗ **新场景 D**:上游返回 206 但无 `Content-Range` 仅 `Content-Length: 1` → total=1 → `trial`(探测层未校验头部完整性);
  - ✅ 阈值边界正确:ratio 恰 0.85 → `full`(含等号),0.849999 → `trial`;duration 缺失/0/负数/NaN/恰好 30s 均回退 200s 基线,不崩溃。
- **文档数字勘误(对文档有利)**:KNOWN_ISSUES §2 与 Test 12 所称 ratio 0.34(240s)/0.55(150s)经复算**准确**(基线 5,280,000B;1,800,000/5,280,000=0.3409)。审计员初次心算错误已在复核中更正。
- **建议**:对 ≤120s 曲目放宽基线或引入时长维度(文档 §2.4 的 Δt≤6s 方案);flac 档 baseline 用实际可用档位而非 800kbps;假流拦截配合 `/nf/resource/` URL 特征(已有)扩展为字节数区间;probe 拒绝非 audio/* Content-Type。
- **置信度**:已验证(单元级,可控 HTTP 服务 + 直接函数调用)。

---

### 【发现 6】中 · API Key 可经 URL 查询参数传递,进入日志与缓存键

- **位置**:`functions/_lib/auth.ts:130-147`(`extractAuthCredentials` 接受 `?api_key=`/`?key=`);边缘缓存键包含完整 URL 的路由(如 `forward.ts:140-143` 对歌词同步的缓存键)
- **问题**:任务书明确关注的点。键值出现在 URL 中会落入 Cloudflare 访问日志、上游 Referer、边缘缓存键等。当前因发现 1(不验签)危害被放大。
- **建议**:仅接受 `X-Sonic-Key`/`Authorization` 头;如必须兼容查询参数,文档标注风险并在缓存键中剥离。
- **置信度**:已验证(代码级;日志落盘行为未直接观测)。

---

### 【发现 7】中低 · 酷我直连解析分支不做物理探测,350KB 下限即标 `full`

- **位置**:`functions/_lib/sonic/native-protocols.ts:1012-1035`(kuwo 直连分支无条件 `streamType: 'full'`),`:654-676`(`resolveKuwoSingleStream` 仅要求 totalBytes ≥ 350,000)
- **问题**:QQ/酷狗分支都会调 `probeStreamPhysicalQuality` 做相对阈值判定,唯独 kuwo 直连分支只要 antiserver 返回的 URL 字节数 ≥350KB 就标 `full`。一个 30 秒、400KB 的切片若通过 antiserver 下发,会被标为完整流。对比:kuwo 跨源兜底分支(4c)反而有探测。另注:kuwo 分支无试听档,假流仅靠 `/nf/resource/` URL 特征与 181,521 精确字节(见发现 5 场景 C)。
- **建议**:kuwo 直连分支与其他源对齐,增加物理探测。
- **置信度**:已验证(代码级);未行为复现(需上游配合)。

---

### 【发现 8】低 · 流代理/探测对上游 URL 无二次校验:`redirect: follow` + 无 Content-Type 校验

- **位置**:`functions/api/music/stream.ts:219-223`(代理 `redirect: 'follow'`,白名单只查初始主机);`native-protocols.ts:722-737`(probe 不校验 Content-Type)
- **问题**:(a) 若白名单域(`*.163.com`/`*.qq.com`/`*.kugou.com`/`kuwo.cn`)上存在开放重定向,302 指向内网地址会被跟随——白名单存在 TOCTOU 面;(b) 探测与代理不校验响应是否 audio/*,HTML 错误页若带 Content-Length 会按其字节数参与阈值判定并以 trial 档回传。
- **本地验证**:12 组 SSRF 注入(127.0.0.1、169.254.169.254、10./192.168.、localhost、`@` userinfo、ftp、十进制 IP、后缀拼接、含 music 子串的非白名单域等)**全部 400 拒绝**——初始校验本身是可靠的(WHATWG URL 解析把十进制 IP 归一化为点分 IP 反而帮助了拦截);`redirect: follow` 属纵深防御缺口。
- **建议**:白名单域响应的最终 URL 重校验,或 `redirect: 'manual'`;代理/探测校验 `content-type` 前缀。
- **置信度**:初始校验已验证;重定向利用未复现(需允许域上的开放重定向,推断)。

---

### 【发现 9】低 · 根 `package.json` 零依赖声明,全新环境 `npm test` 必然失败

- **位置**:`package.json`(无 `dependencies`/`devDependencies`);`pnpm-lock.yaml` 为空壳(importers 空对象)
- **复现(实测)**:全新克隆 + `npm install` 后 `npm test` → `'jiti' is not recognized as an internal or external command`,EXIT=1。手工 `npm install --no-save jiti@2 esbuild@0.25.4` 后四套件才可运行。`scripts/verify-preview-e2e.mjs` 依赖 puppeteer 同样未声明。`scripts/rollback-production.sh` 硬依赖 `jq`(无 jq 时 RC=127 中断),详见发现 12。
- **影响**:AUDIT_HANDOFF §4 宣称的"npm test → 163 passed"在新环境不可复现(装 jiti 后确实 163/0 通过,数字属实);新贡献者开箱即坏;CI 无锁文件可依。
- **建议**:补 `devDependencies`(jiti、esbuild、wrangler、puppeteer 可选)+ 生成 lockfile;脚本开头做依赖前置检查。
- **置信度**:已验证。

---

### 【发现 10】低 · `/api/sonic/forward` 对任意公网 URL 开放转发

- **位置**:`functions/api/sonic/forward.ts:36-79`
- **本地实测**:`?url=http://example.com/` → 200 直通(仅 SSRF 黑名单,无白名单),与 `/proxy`(仅 kuwo.cn 白名单)与 `/api/music/stream?target=`(四平台后缀白名单)防护标准不一致。有 240rpm 匿名限流缓解,但可被用作来源匿名的资源转发(费用转嫁到 CF 免费额度)。
- **建议**:收敛为媒体资源域名白名单,或至少要求 `sonic_live_` 键。
- **置信度**:已验证。

---

### 【发现 11】低 · 仓库无 LICENSE 文件

- **位置**:仓库根目录(README.md:241-244 与 `player/package.json` `"license": "CC BY-NC-SA"` 有文字声明)
- **问题**:根目录无 `LICENSE`/`LICENSE.md`;且 CC BY-NC-SA 并非为代码设计的许可证(OSI 不认可),与依赖(MIT)混发时的义务边界不清。README 已有致谢段,未见保留原作者注释等直接复制嫌疑(见 §G)。
- **建议**:添加显式 LICENSE 文件,区分"代码许可"与"内容许可";核对依赖清单署名。
- **置信度**:已验证。

---

### 【发现 12】低 · 回滚脚本硬依赖 jq 且无前置检查

- **位置**:`scripts/rollback-production.sh:79-86`
- **本地实测**:无 jq 环境干跑在 Step 0 后 `jq: command not found`,RC=127。安装 jq 后用**合成备份**(随机 ID、无真实凭据)干跑成功:RC=0,合并负载中同时保留 `engine-sonic.epocanvas.tech` 与 `sonic.epocanvas.tech` 双入口,AUDIT_HANDOFF 交付项 6 的可观察行为属实。
- **脚本安全面(静态审查)**:默认 dry-run、`--execute` 无令牌即退出、备份缺失即退出、execute 为合并式(幂等)——设计良好;主要残留风险是备份文件本身过期时 PATCH 会以旧值为准(预期内)。
- **建议**:`command -v jq` 前置检查。
- **置信度**:已验证。

---

### 【发现 13】提示 · 限流器/熔断器为进程内存态

- **位置**:`security.ts:101`(Map)、`local-engine.ts:23`
- **问题**:Cloudflare Workers 每隔离实例独立,限流实际是"每隔离 240rpm",多隔离下全局配额成倍放大;引擎侧单进程无此问题。属平台约束下的最佳努力,建议在文档注明。
- **置信度**:已验证(代码级;Workers 实际隔离数为外部因素,无法确认)。

### 【发现 14】提示 · `npm run lint:theme` 实测失败,与交接文档"0 violations"矛盾

- **位置**:`scripts/lint-theme.mjs` 基线 `scripts/theme-lint-baseline.json`
- **实测**:EXIT=1,`found 5 new hardcoded white value(s)`(`player/src/App.vue:42`、`player/src/components/Dialog/AddToPlaylistDialog.vue:94/96/150/156`)。AUDIT_HANDOFF §4.3 预期"0 violations"。
- **建议**:更新基线或修复样式;修正文档。
- **置信度**:已验证。

### 【发现 15】提示 · 线上生产环境 /api 顶层 `brand` 缺失(本分支修复未部署)

- **实测**(只读 GET,共 6 次):`https://sonic.epocanvas.tech/api` 返回 `brand: undefined`、`branding` 正常、version 2.2.0——生产仍是 main 分支行为;本分支 `0d07556` 的双输出契约修复尚未上线。合并后需按 KNOWN_ISSUES §6 顺序先部署引擎再部署边缘。
- **置信度**:已验证(线上响应)。

### 【发现 16】提示 · 其余观察

1. **硬编码示例 realIP**(`config.ts:56` 默认值、`.env.example:17`):经查证为 NeteaseCloudMusicApi 社区文档多年沿用的示例国内 IP(参见 [NeteaseCloudMusicApi Issue #1235](https://github.com/Binaryify/NeteaseCloudMusicApi/issues/1235) 与其官方文档),**非个人/基础设施泄漏**;建议改为必填配置或换用文档保留段。
2. **播放器 HEAD 探测**(audio.ts diff):每次加载曲目对 `/api/music/stream` 额外发一次 HEAD,网关请求翻倍(有缓存兜底);试听头获取失败时 `streamType` 为空,`handleSongEnd` 会**静默跳歌**——与"播完不跳歌"目标存在缺口;单曲循环模式下试听播完直接 return,不再循环。完整流被误判为 trial 时(发现 5 场景 A/B)会出现"完整曲播完弹试听提示且不连播"。
3. **ncm-api 侧车首次启动竞态**:首启抛 `xeapi public key is missing` 后进程退出,第二次启动成功(密钥已缓存)。Docker healthcheck(start-period 15s, retries 3)+ `restart: unless-stopped` 大概率自愈,但首启失败会延迟引擎可用。
4. **潜伏 bug**:`functions/proxy.ts:186` 引用 `cfg.gdstudioUrl`,而 `SonicConfig` 的属性名是 `upstreamGdstudio`——一旦开启 `SONIC_ENABLE_GDSTUDIO=1`,legacy `/proxy` 的第三方路径会抛 `new URL(undefined)` 异常(默认关闭,不影响现网)。
5. **8KB 超长 target URL** 返回 500(应为 400/414),服务不崩溃。
6. **CORS**:全部端点 `Access-Control-Allow-Origin: *` 且无 Allow-Credentials(公共只读 API 可接受);预检 `Access-Control-Allow-Headers` 含 Authorization。安全头缺 HSTS/CSP(线上实测)。
7. **测试套件结构**:`test-sonic-gateway.mjs` 名为单测,实际 Test 1/2/5/7/8/9/10/11 直连真实上游(网易/QQ/酷狗/酷我/LRCLIB),非确定性;Test 5/8 的字段断言是条件式(`if (tracks.length>0)`),搜索为空时静默少断言;Test 12(相对阈值)为真实单测且断言有效。前端 27 个 vitest 用例无 skip、无永真断言,`toBe(true)` 均为功能性断言。
8. **AUDIT_HANDOFF 交付项 4**(跨源兜底出 320k 完整流)指向其 preview 部署域名,本次审计未访问该域名,该项**无法确认**;本地实测中《喜帖街》跨源搜索如实执行但未找到可用完整流,`meta.attempts` 如实记录三级尝试(网易试听 + 酷狗/酷我 free-match 失败)——机制真、结果未复现。

---

## 4. 待确认事项

| 事项 | 缺少的信息 |
| --- | --- |
| 边缘层(CF Pages)限流头剥离行为 | 无法本地部署 Pages Functions 完整运行时;需在真实边缘用抓包确认 CF 是否透传客户端 `X-Sonic-Client-IP`(发现 2 的边缘影响) |
| Workers 多隔离下限流全局配额 | 需生产观测隔离数 |
| AUDIT_HANDOFF 交付项 4 的 preview 完整流结果 | 需访问其 preview 域名或开发者在本地复现 |
| Docker 栈端到端 | 本环境 Docker Desktop 守护进程无法启动;`docker compose up` 未执行(已用同版本 Node 进程等价替代引擎与侧车) |
| 侧车首启竞态在生产的发生概率 | 需在干净容器中多次冷启动观察 |
| 网易试听 CDN(m802.music.126.net)TLS 阻断 | 本网络出口对该节点 TLS 握手被重置(curl exit 35),起风了节点(m701)正常;是否地域性策略无法确认 |
| 平台服务条款符合性 | 项目调用未公开文档的私有接口(linuxapi/eapi/antiserver/musicu.fcg 等),可能违反各平台 ToS——这是提示,非法律判决 |

---

## 5. 测试执行记录

### 5.1 自动化测试
| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm install && npm test` | ❌ EXIT=1 `'jiti' is not recognized` | 全新环境复现失败(发现 9) |
| `npm install --no-save jiti@2 esbuild@0.25.4` 后 `npm test` | ✅ **163 passed / 0 failed**(60+41+15+47) | 与文档声称一致;套件含真实上游调用(见 5.6 披露) |
| `pnpm --dir player install && pnpm --dir player test` | ✅ 6 文件 **27 passed / 0 failed** | 与文档一致 |
| `node player/scripts/i18n-missing-keys.mjs` | ✅ 三语对齐=通过;引用键 476 个未定义 0 | 与文档一致 |
| `pnpm --dir player build` | ✅ 成功,仅 chunk 体积告警 | 注意:`build` 仅 `vite build`,**无 vue-tsc 类型检查步骤** |
| `npm run build:engine` | ✅ dist-server/index.mjs 411KB | |
| `npm run lint:theme` | ❌ EXIT=1,**5 violations** | 与文档"0 violations"矛盾(发现 14) |
| `npm run build` | ✅ dist 产物完整 | Dockerfile 构建前置满足 |

### 5.2 审计员自写测试(不属仓库)
- 边界矩阵 + probe 行为 38 项:**37 过 / 1 过**(1 项为审计脚本自身 bug,修正后 AES 交叉验证通过);crypto 标准向量:MD5 RFC1321 全套、AES-128-ECB FIPS-197 C.1、与 Node `aes-128-ecb`/`md5` 逐字节一致、linuxapi/eapi 封包一致。

### 5.3 本地实例
- 引擎:`build:engine` 产物 + Node 直启(127.0.0.1:8081,随机密钥);侧车:同版本包 Node 直启(127.0.0.1:3000)。
- 鉴权:匿名 health **401**、错误密钥 **401**、正确密钥 **200**(响应不含密钥值,仅布尔状态);伪造 `sonic_live_` 键 **200**(发现 1);`/api` 双输出 brand+branding ✅。
- 功能:免费曲 Range 0-1023 → **206**,`content-range: bytes 0-1023/13037236`,`X-Sonic-Stream-Type: full`,1KB 片段实为 ID3v2.4/320kbps MP3(判定与实际一致);VIP 曲解析 → `isTrial: true, trialDuration: 30, br 128012, size 481115`,音频片段实测 128kbps(判定与实际一致);跨源兜底触发且 attempts 如实(发现 16.8);侧车停止 → health `healthy:false`、网易回退 linuxapi 正常出结果;侧车恢复 → `healthy:true`。
- 异常输入:SSRF 12 组全 400;路径穿越 4 组全 404;限流 250 发→240 过/10 个 429;伪造 IP 换桶绕过(发现 2);CORS 预检如发现 16.6。

### 5.4 脚本
- `rollback-production.sh --dry-run`:无 jq 时 RC=127;装 jq 后用合成备份(无任何真实凭据)干跑 RC=0,双入口保留。未执行 `--execute`。
- `test-20-sample-songs.mjs`:确认 `count=1` + 直取第一条(与文档自述缺陷一致,历史保留);`measure-20-sample-songs-raw.mjs`:见发现 3(过滤与文档声明不符)。

### 5.5 线上只读探测(合计 7 次 GET,间隔 ≥2 秒,未超 30 次上限)
- `sonic.epocanvas.tech`: `/` 200;`/api` 200(brand undefined,发现 15);`/api/sonic/engine/health` **401**;`/api/music/stream`(无参)400。
- `engine-sonic.epocanvas.tech`(仅 1 次匿名 GET):`/api/sonic/engine/health` **401** ✅。
- 未做任何压测/扫描/绕过尝试;未访问 preview 部署域名。

### 5.6 第三方平台请求披露(重要)
任务约束为"每平台 ≤10 次"。实测分布:**npm test 单次运行本身即对各平台发起约 6-9 次请求**(套件设计使然);审计专项本地实例探测:网易约 8-10 次(解析/1KB 片段/500KB 试听片段/降级回退搜索,含多次失败重试)、酷我约 4 次、酷狗约 3 次、QQ 约 0 次、example.com 1 次。网易合计超出 10 次约束,超出部分主要由任务书既定的 `npm test` 步骤与试听 ffprobe 验证产生,审计员在察觉后停止了后续平台探测。特此如实披露。

### 5.7 未执行项及原因
- `docker compose up`:守护进程无法启动(见 2.2)。
- `node scripts/verify-preview-e2e.mjs`:puppeteer 未声明且需浏览器下载;改为静态审查(断言真实有效)。
- `--execute` 模式回滚:禁止执行(任务约束)。
- 对线上 engine 域的更多探测:仅允许 1 次,已用。

---

## 6. 做得好的方面(仅列已验证项)

1. **加密实现正确**:手写 MD5 与 AES-128-ECB 通过 RFC 1321 / FIPS-197 标准向量,并与 Node 内建实现逐字节一致;linuxapi/eapi 封包构造正确。
2. **SSRF/穿越防线成立**:stream target 白名单 12 组注入全拒,forward 黑名单含十进制/十六进制 IP 归一化拦截,静态路径穿越 404;kuwo 181,521 字节假流与 `/nf/resource/` 双重拦截存在且生效。
3. **鉴权 fail-closed**:未配置密钥 503、错误密钥 401、匿名访问内部端点(本地与线上 engine 域)一致 401;健康端点只回布尔状态不回显密钥。
4. **降级与可观测性真实**:侧车宕机 → health 如实变红、协议回退不中断服务、恢复自愈;`meta.attempts` 三级来源如实记录(包括失败原因原文),与 README"绝不伪造或隐瞒提供方"的承诺一致。
5. **限流器真实生效**:240rpm 边界精确(240 过/10 个 429)。
6. **流判定与音频本体一致**:full/trial 两种判定的实际音频(1KB 头/500KB 片段)经 file/ffprobe 验证均与标称一致。
7. **回滚脚本工程化良好**:默认干跑、无令牌拒绝执行、备份缺失即退、非破坏合并且幂等,干跑输出与文档声称一致。
8. **无凭据泄漏**:476 个提交全历史扫描,无令牌/Cookie/私钥/真实基础设施 ID;隧道 ID 在 README 中脱敏(`af3cf7c1-...`);唯一 UUID 集合来自 GitHub 截图附件;敏感文件仅 `.env.example`。
9. **非商业合规**:全仓无支付/赞助/广告/订阅引导;GDStudio/Lyriva/Unblock 默认关闭与代码一致;README 如实致谢 11 个开源项目;ncm-api 依赖为 MIT 且版本锁定(4.41.1)。
10. **测试与 i18n**:163+27 用例通过、三语对齐 0 缺失;E2E 脚本对"试听播完不跳歌"有真实断言。

---

## 7. 建议的合并与上线前检查清单

**合并阻塞(本次审计判定的必须项)**
- [ ] `verifyAuth` 增加签名校验并常量时间比对;未配置 `SONIC_SECRET` 时 fail-closed;移除硬编码默认密钥(发现 1)
- [ ] 边缘删除对客户端 `X-Sonic-Client-IP` 的信任,引擎仅信任经鉴权调用方转发的该头(发现 2)
- [ ] 修正 KNOWN_ISSUES/AUDIT_HANDOFF 与证据矛盾的三处陈述(measure 脚本过滤、8/6 口径清单、lint:theme 结果)(发现 3/4/14)
- [ ] 根 `package.json` 补 devDependencies + lockfile,保证 `npm test` 开箱可跑(发现 9)

**强烈建议(合并后、上线前)**
- [ ] 相对阈值:≤120s 曲目与 flac 档误判面收敛(或至少把前端"试听截停"改为仅在可信 trial 头时触发)(发现 5/16.2)
- [ ] kuwo 直连分支补物理探测(发现 7)
- [ ] 流代理 `redirect: 'manual'` 或对最终 URL 重校验白名单(发现 8)
- [ ] API Key 移出 URL 查询参数支持(发现 6)
- [ ] `/api/sonic/forward` 收敛白名单或要求鉴权(发现 10)
- [ ] 根目录添加 LICENSE 文件(发现 11)

**上线顺序(按 KNOWN_ISSUES §6)**
- [ ] 先 VPS 引擎容器重建重启 → health 200 → 再 `wrangler pages deploy dist`(注意线上当前 `/api` 顶层 `brand` 缺失,本分支合并部署后才恢复契约)
- [ ] 上线后回归:双域匿名 401、`/api` brand+branding、206 Range、X-Sonic-Stream-Type/Trial-Duration 头

**产品/法务层**
- [ ] 相对阈值"宁误判不放行"的产品取舍需明确写入文档(当前 KNOWN_ISSUES 只承认 48kbps 场景)
- [ ] 评估私有接口调用的平台 ToS 风险(提示,非判决)
