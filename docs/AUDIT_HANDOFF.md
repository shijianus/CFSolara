# CFSolara 交付审计与技术交接文档 (Audit & Handoff Specification)

> **文档性质**：公开代码仓库审计交接文档  
> **保密级别**：无敏感信息（所有令牌、IP、密钥、私有凭据均已脱敏/排除）  
> **遵循协议**：CC BY-NC-SA 4.0 国际非商业共享协议  

---

## 一、项目简介与双层同构架构

CFSolara 是一个基于现代化 Web 技术栈构建的高性能无广告多源音乐聚合流媒体平台。系统由 **Cloudflare Pages 边缘服务网关** 与 **Linux VPS 本地解析引擎** 组成双层同构混合架构：

```
               [ 客户端浏览器 (Vue 3 SPA) ]
                            │
               HTTPS /api/* │ (边缘路由与轻量协议)
                            ▼
     [ Cloudflare Pages Functions (Edge Gateway) ]
       ├── 边缘内存缓存 (Cache API / KV)
       ├── 速率限制器 (Tiered Rate Limiting)
       ├── 跨源智能兜底与物理探测 (Quality Probing)
       └── 熔断器状态机 (CLOSED -> OPEN -> HALF_OPEN)
                            │
              Cloudflare Tunnel (mTLS 加密传输)
              强制校验 X-Sonic-Engine-Key
                            ▼
          [ Linux VPS (Host Engine & Sidecars) ]
       ├── sonic-engine (Node.js 22 本地解析引擎, port 8080)
       │     └── 原生协议逆向 (NetEase LinuxAPI/EAPI, Kuwo antiserver, Kugou)
       ├── ncm-api (网易云逆向解析侧车容器, port 3000)
       └── cloudflared (Cloudflare Tunnel 守护进程)
```

1. **边缘计算层 (Cloudflare Pages)**：
   - 托管于 Cloudflare Pages 全球边缘节点；
   - 负责处理静态前端资产分发、CORS 响应头、轻量公网接口代理、鉴权兼容性（`sonic_live_` API Key）、多级缓存与平滑降级（Degradation State Machine）。
2. **本地引擎层 (Linux VPS Engine)**：
   - 部署在受保护内网，通过 Cloudflare Tunnel 发布为 `engine-sonic.epocanvas.tech`；
   - 强制使用常量时间比对（`crypto.timingSafeEqual`）校验 `X-Sonic-Engine-Key`，对未授权匿名请求统一返回 `401 Unauthorized`；
   - 负责运行复杂的高算力原生协议逆向解析（AES-128-ECB、LinuxAPI 密文构造）及侧车容器调用。

---

## 二、Git 分支与关键提交哈希对照表

| 分支名 | 提交哈希 (Commit SHA) | 相对基准角色 | 包含核心内容 |
| :--- | :--- | :--- | :--- |
| `origin/main` | `d062882b7ec274ff9e1bbdf23bdcc7cc1d7b8bd9` | 上游生产主分支基线 | 品牌化收尾、CI 白名单、基础播放器组件 |
| `origin/chore/integrate-final-scripts` | `059ff747237175474c263a58e89d784c75f8663d` | 远端待合并整合分支 | 非破坏性合并回滚脚本、20 首抽样脚本、根索引 brand/branding 契约兼容 |
| `feat/full-stream-priority` (本地) | 动态更新（当前提交） | 功能开发与终验分支 | 试听流透明标识、试听播完不跳歌、相对阈值防误判判定、跨源优先兜底、无头 E2E 测试 |

---

## 三、系统关键文件路径清单

| 模块类别 | 文件绝对/相对路径 | 职责与技术说明 |
| :--- | :--- | :--- |
| **原生协议解析** | `functions/_lib/sonic/native-protocols.ts` | 网易、QQ、酷狗、酷我协议逆向、跨源匹配与动态相对阈值音质探测 |
| **加密算法实现** | `functions/_lib/sonic/crypto.ts` | 纯 TypeScript 实现的 MD5 与 AES-128-ECB，在 Workers 边缘与 Node 运行时保持双向同构 |
| **本地引擎通信** | `functions/_lib/sonic/local-engine.ts` | 边缘节点对 VPS 本地引擎的 Tunnel 调用封装、超时熔断与缓存降级状态机 |
| **网关安全防护** | `functions/_lib/sonic/security.ts` | SSRF 白名单校验、私有 IP/云厂商元数据封禁、分级令牌桶限流器 |
| **Node 服务入口** | `server/index.ts` | VPS 端本地引擎服务入口，实现 Linux 原生 HTTP 监听与鉴权中间件 |
| **流媒体边缘网关** | `functions/api/music/stream.ts` | 取流核心入口，支持 Range 206 续传、`X-Sonic-Stream-Type` 标头透传与 302 重定向 |
| **系统索引契约** | `functions/api/index.ts` | 兼容旧版客户端的根索引，同时输出顶层 `brand: "Sonic"` 与 `branding` 契约结构 |
| **播放器音频核心** | `player/src/stores/modules/audio.ts` | Pinia 音频状态管理、试听结束事件拦截、错误恢复与跨源加载 |
| **试听 UI 组件** | `player/src/layout/footer.vue`<br>`player/src/components/Mobile/MiniPlayerMobile.vue`<br>`player/src/components/SongList.vue` | 桌面/移动端播放栏试听徽标（amber 令牌规范）与曲目状态指示 |
| **自动化测试套件** | `scripts/test-sonic-gateway.mjs`<br>`scripts/test-auth-compatibility.mjs`<br>`scripts/test-cover-gateway.mjs`<br>`scripts/test-local-engine-and-degradation.mjs` | 网关接口、身份鉴权、封面代理、本地引擎及降级熔断测试套件 |
| **E2E 验证脚本** | `scripts/verify-preview-e2e.mjs` | 基于 Puppeteer 的无头 Chrome 前端交互自动化回归脚本 |
| **容器部署编排** | `docker-compose.yml`<br>`Dockerfile`<br>`Dockerfile.ncm` | VPS 本地引擎、Node.js 运行时与网易云侧车容器的生产 Docker 编排配置 |
| **生产回滚预案** | `scripts/rollback-production.sh` | 支持非破坏性合并恢复 Cloudflare Tunnel 与 DNS CNAME 的容灾脚本 |

---

## 四、本地测试运行指南及预期结果

### 1. 核心网关与本地引擎测试套件
```bash
npm test
```
- **预期结果**：
  - `test-sonic-gateway.mjs`: 60 passed, 0 failed（涵盖 relative threshold 9 项断言）；
  - `test-auth-compatibility.mjs`: 41 passed, 0 failed；
  - `test-cover-gateway.mjs`: 15 passed, 0 failed；
  - `test-local-engine-and-degradation.mjs`: 47 passed, 0 failed；
  - **总计**：163 passed, 0 failed。

### 2. 前端单元测试套件
```bash
pnpm --dir player test
```
- **预期结果**：
  - 6 个测试文件（`libraryStore`, `transformers`, `playbackErrors`, `audioQuality`, `queueIntegration`, `localMusicUndo`）全过；
  - **总计**：27 passed, 0 failed。

### 3. 主题与设计令牌 Lint
```bash
npm run lint:theme
```
- **预期结果**：0 violations。

---

## 五、本次交付“声称完成”的功能清单及验证方法

| 序号 | 交付功能项 | 功能设计意图 | 可复现的验证方法 |
| :---: | :--- | :--- | :--- |
| **1** | **试听流透明标识** | 当接口判定曲目为 30~45 秒试听切片时，在桌面与移动端底栏显示琥珀色“试听”标签 | 运行 `node scripts/verify-preview-e2e.mjs`，断言 DOM 出现 `border-amber-500/30 text-amber-500` 节点 |
| **2** | **试听播完不静默跳歌** | 试听片段播放至末尾触发 `ended` 时，播放器停止播放，不跳至下一曲，居中弹出提示 Toast | 运行 `node scripts/verify-preview-e2e.mjs`，断言 `audioStore.audio.isPlaying === false` 且 currentIndex 未累加 |
| **3** | **动态相对阈值试听判定** | 摒弃固定 1MB 阈值，依据时长与最低可用码率比值动态判定，彻底防止 320k 试听流被误判为完整流 | 运行 `npm run test:gateway`，断言 Test 12 中 320k 45s (1.8MB) 在 240s 与 150s 歌曲下均被判定为 `trial` |
| **4** | **跨源完整流兜底提升** | 主源仅有试听流时，在限时预算内并发探测备选源（如酷我），若匹配到物理完整流则优先下发 | 运行 `curl -sI "https://preview-full-stream.cfsolara-dho.pages.dev/api/music/stream?id=netease:308299&source=netease&title=喜帖街&artist=谢安琪"`，断言返回 `X-Sonic-Stream-Type: full`，大小 > 3MB |
| **5** | **多语言国际化完备性** | 试听徽标 Tooltip 及播完 Toast 文案在 zh-CN、en-US、ja-JP 下均有对应翻译 | 检查 `player/src/languages/modules/*.ts` 中的 `player.trialBadge` 与 `player.trialEnded` 键 |
| **6** | **非破坏性合并回滚机制** | 灾备回滚时自动读取远端当前配置，以 Map 方式合并入站路由，确保 `engine-sonic` 入口不被覆盖删除 | 执行 `./scripts/rollback-production.sh --dry-run`，检查输出中包含 `engine-sonic.epocanvas.tech` 与 `sonic.epocanvas.tech` 双入口 |

---

## 六、开源非商业合规与许可证声明

- **主许可证**：本项目采用 **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)** 许可证。
- **开源非商业准则**：
  1. 系统不包含任何形式的商业收费接口、付费 API 购买中继或盈利性功能；
  2. 系统不包含任何打赏、赞助弹窗、会员充值或强制广告展示逻辑；
  3. 生产环境默认禁用所有需要商业授权或第三方不可控抓取的中转服务（GDStudio、Lyriva 等默认 `false`）；
  4. 原生解析代码仅用于个人学习交流与网络协议研究，所有音频流均直接来自上游公开 CDN 的试听或公共开放接口。
