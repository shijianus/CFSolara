# 🎶 epocanvas sonic 开放音乐 API 平台规范 (API Platform Documentation)

> **epocanvas sonic** 现已升级为**双层分布式平台化音乐服务**，将原有的单体音乐播放器解耦为细粒度的微服务 API，并通过 **Epomail OAuth 2.0** 与 **HMAC-SHA256 API Key** 作为统一接入鉴权体系，有效防止接口被滥用，同时允许第三方独立项目（如个人博客、静态站点、桌面与移动端应用）通过安全的 API Key 连结接入。
>
> **兼容说明**：`CFSolara`、`solara_live_`、`X-CFSolara-Key`、`solara.epocanvas.com` 等旧命名仍作为历史兼容标识保留；新接入请使用 `sonic_live_`、`X-Sonic-Key` 与 `sonic.epocanvas.com`。

---

## 🌐 域名拓扑与服务分工

| 域名 | 角色 / 网络位置 | 鉴权要求 | 说明 |
| :--- | :--- | :--- | :--- |
| **`https://sonic.epocanvas.tech`** | **公网主接入点 (Cloudflare Pages)** | 公开访问 / API Key 高配额 | 托管前端 Web UI、全网聚合网关、Edge 缓存与平滑降级 |
| **`https://sonic.epocanvas.com`** | 备用公网接入点 (Pages 自定义域) | 同上 | 作为容灾与主域名的同等备用接入点 |
| **`https://engine-sonic.epocanvas.tech`** | **内部本地引擎入口 (Cloudflare Tunnel)** | **强制要求 `X-Sonic-Engine-Key`** | 仅供 Pages Functions 内部调用；匿名或错密钥请求一律返回 `401` |

---

## 🔐 鉴权体系：Epomail OAuth 2.0 与 API Key

为了防止曲库 API 被恶意爬取与高频滥用，平台提供两级安全机制：

1. **Epomail OAuth 唯一登录**：
   - 授权端点：`GET /api/auth/login` （自动重定向至 Epomail 官方授权中心）
   - 回调端点：`GET /api/auth/callback?code=...`
   - 用户信息：`GET /api/auth/user`
2. **专案连结 API Key 与分级限流**：
   - 登录 Epomail 后即可自动获得专案 API Key。签发格式为带签名的
     `sonic_live_<base64url(邮箱)>_<base64url(过期时间)>_<HMAC-SHA256 签名>`（服务端以 `SONIC_SECRET` 验签并校验过期，常量时间比较）；`solara_live_` 前缀同样接受验签。**历史无签名格式的 `sonic_live_...`/`solara_live_...` 旧密钥已全部失效**，需重新登录获取。
   - 在第三方专案发起请求时，仅支持请求头传递凭证（**不支持查询参数**，URL 中的密钥会泄漏到访问日志与缓存键）：
     ```http
     X-Sonic-Key: sonic_live_xxxxxxxx
     # 或历史兼容请求头 / Bearer：
     X-CFSolara-Key: sonic_live_xxxxxxxx
     Authorization: Bearer sonic_live_xxxxxxxx
     ```
   - 网关内置滑动窗口分级限流（响应头携带 `X-RateLimit-Tier`、`X-RateLimit-Limit`、`X-RateLimit-Remaining`）：
     - **限流实现如实说明**：计数保存在每个边缘 isolate 的进程内存中（`Map`），**不是全局限流**——多 isolate 并发时实际配额会按隔离数放大；引擎侧单进程无此问题。
     - **终端 IP 信任链**：限流分桶只信任 ① 经 `X-Sonic-Engine-Key` 鉴权的内部调用方随请求转发的 `X-Sonic-Client-IP`，或 ② Cloudflare 边缘注入的 `CF-Connecting-IP`；两者皆无时落入固定兜底桶并输出一次告警日志。**从不信任客户端可伪造的 `X-Forwarded-For` 或未鉴权的 `X-Sonic-Client-IP`**（审计发现 #2 的绕过路径已封堵）。
     - 匿名前端访客（`anonymous`）：默认 `240` 次/分钟（可通过 `SONIC_REQUIRE_AUTH=1` 关闭匿名访问）；
     - 持有效 API Key 专案（`api-key`）：默认 `600` 次/分钟高配额；
     - 内部引擎入口（`engine-sonic.epocanvas.tech`）：**强制要求 `X-Sonic-Engine-Key` 服务间密钥头**，匿名访问一律返回 `401 ENGINE_UNAUTHORIZED`。

---

## 🚦 网关响应头与降级状态契约

网关在每个请求的响应头中如实透传系统健康与降级状态：

| 响应头 | 取值示例 | 说明 |
| :--- | :--- | :--- |
| `X-Sonic-Degraded` | `1` | 标记当前响应处于边缘降级模式（仅在降级生效时出现） |
| `X-Sonic-Circuit` | `CLOSED` / `OPEN` / `HALF_OPEN` | 当前三态熔断器的实时状态 |
| `X-Sonic-Provider` | `local-netease` / `local-kugou` / `cf-direct` | 当前解析命中的真实音源后端 |
| `Content-Range` | `bytes 0-65535/13037236` | 标准 HTTP Range 分段响应头（HTTP `206 Partial Content`） |

### 错误状态码契约
- **HTTP `200 OK`**：请求成功（降级时搜索与歌词亦返回 200，并在 `meta.degraded: true` 明确提示）；
- **HTTP `206 Partial Content`**：音频流分段取流成功；
- **HTTP `302 Found`**：当使用 `?mode=redirect` 时重定向至安全直链；
- **HTTP `401 ENGINE_UNAUTHORIZED`**：未携带或携带无效 `X-Sonic-Engine-Key` 访问内部引擎；
- **HTTP `404 STREAM_NOT_FOUND`**：正常态下单曲无版权或无法匹配音源；
- **HTTP `429 RATE_LIMITED`**：请求超出限流阈值；
- **HTTP `503 STREAM_UNAVAILABLE_DEGRADED`**：**本地引擎离线且边缘无缓存时的明确降级错误**（与常规 404 严格区分，便于前端展示友好提示并停止跳歌）。

---

## 📡 细粒度模块化 API 接口列表

所有接口均已配置全域 CORS (`Access-Control-Allow-Origin: *`)，前端或后端服务均可直接调用。特别说明：根索引接口 `GET /api` 同时输出顶层兼容字段 `brand: "Sonic"` 以及结构化品牌信息 `branding`（含 `wireBrand: "Sonic"`），保证历史存量监控与新版品牌契约双向兼容。

### 1. 跨站曲库搜索 (`GET /api/sonic/search/nexus` & `GET /api/music/search`)
- **端点**：
  - `/api/sonic/search/nexus`（推荐，全网多源聚合去重检索，返回带 `sources[]` 的规范响应）
  - `/api/music/search`（兼容旧版单源搜索）
- **请求参数**：
  - `q`: 搜索关键词（歌曲名、歌手名或专辑名，必填）
  - `count`: 返回数量，默认 `20`（最大 `50`）
  - `page`: 分页页码，默认 `1`
  - `nocache`: 传入 `1` 强制绕过边缘缓存实时检索
- **响应示例 (`/api/sonic/search/nexus`)**：
  ```json
  {
    "brand": "Sonic",
    "data": {
      "tracks": [
        {
          "id": "186016",
          "name": "晴天",
          "title": "晴天",
          "artist": "周杰伦",
          "album": "叶惠美",
          "duration": 269,
          "cover": "https://...",
          "coverUrl": "https://...",
          "platform": "sonic",
          "platformId": "186016",
          "sources": [
            { "platform": "netease", "platformId": "186016", "duration": 269 },
            { "platform": "qq", "platformId": "003aAPGv1I6t8A", "duration": 269 },
            { "platform": "kugou", "platformId": "9b...", "duration": 269 }
          ]
        }
      ]
    },
    "meta": {
      "cached": false,
      "cacheLevel": "none",
      "latencyMs": 1420,
      "provider": "nexus",
      "degraded": false,
      "circuitState": "CLOSED",
      "attempts": [
        { "provider": "local-engine", "via": "local-engine", "source": "local-engine", "ok": true, "ms": 1418 }
      ]
    }
  }
  ```

### 2. 音频流分段代理与直链 (`GET /api/music/stream`)
- **请求参数**：
  - `id`: 歌曲 ID（必填）
  - `source`: 音源，支持 `netease`、`kugou`、`kuwo`、`qq`，默认 `netease`
  - `quality`: 音质比特率，支持 `128`、`192`、`320`、`flac`，默认 `320`
  - `mode`: 取流模式，可选 `proxy`（默认，边缘代理透传 `Range` 并补齐防盗链与 CORS，零 VPS 带宽消耗）或 `redirect`（直接 `302 Found` 跳转至音乐 CDN）
- **特性**：
  - 支持标准 HTTP `Range: bytes=start-end` 请求头，完美支持快进、拖动缓冲与零流量音质探测（`Range: bytes=0-0`）；
  - 自动注入 `Access-Control-Allow-Origin: *` 与 `Access-Control-Expose-Headers: Content-Range, Accept-Ranges`。

### 3. 高精度多协议逐字歌词 (`GET /api/sonic/lyrics/nexus` & `GET /api/lyric`)
- **端点**：
  - `/api/sonic/lyrics/nexus`（推荐，全网高精度聚合主入口）
  - `/api/lyric`（轻量兼容端点）
- **请求参数**：
  - `title` / `name`: 歌曲名（必填其一）
  - `artist` / `singer`: 歌手名
  - `platform` / `source`: 音源偏好（`netease` / `qq` / `kugou` / `amll` / `lrclib`）
  - `platformId` / `id`: 对应音源平台的单曲 ID（传入可直接命中原生 YRC/QRC/KRC）
  - `nocache`: 传入 `1` 强制实时检索
- **数据契约规范**：
  - `level`: `"word"`（逐字级精准对齐）或 `"line"`（行级平滑降级）；
  - `syncedLyrics`: 结构化时间轴数组。包含 `time`（毫秒），当 `level === "word"` 时包含每个字的精准时间轴 `words: [{ word, start, end }]`。

### 4. 专辑封面智能代理 (`GET /api/music/cover`)
- **请求参数**：
  - `id`: 歌曲 ID
  - `source`: 音源平台
- **特性**：
  - 自动解析官方高清封面原图；
  - 若解析失败或无原图，平滑降级返回高质感的品牌 SVG 矢量占位图，绝不返回破碎红叉或 404。

### 5. 专辑封面智能取色 (`GET /api/music/palette`)
- **请求参数**：
  - `url`: 封面图片 URL
- **响应示例**：
  ```json
  {
    "baseColor": "#1e293b",
    "accentColor": "#425aef",
    "gradients": {
      "light": { "gradient": "linear-gradient(...)" },
      "dark": { "gradient": "linear-gradient(...)" }
    }
  }
  ```

### 6. 随机推荐曲库 (`GET /api/music/random`)
- **请求参数**：
  - `count`: 随机获取数量，默认 `10`（最大 `30`）
  - `genre`: 随机风格分类（如 `流行`、`民谣`、`摇滚`、`轻音乐`、`ACG`）

---

## 💻 外部专案接入示范 (JavaScript / TypeScript)

```typescript
// 外部专案客户端示例
const API_BASE = 'https://sonic.epocanvas.tech/api'; // epocanvas sonic 线上主域名（备用域 https://sonic.epocanvas.com/api）
const API_KEY = 'sonic_live_xxxxxxxx'; // 亦兼容历史 solara_live_xxxxxxxx

// 1. 点歌搜索 (优先使用 Sonic Nexus 聚合检索)
async function searchSong(keyword: string) {
  const res = await fetch(`${API_BASE}/sonic/search/nexus?q=${encodeURIComponent(keyword)}&count=10`, {
    headers: {
      'X-Sonic-Key': API_KEY,
    }
  });
  return await res.json();
}

// 2. 播放音频流 (默认支持 Range 206 分段拉流;密钥只经请求头传递,不要拼进 URL)
async function fetchAudioStream(songId: string, source = 'netease', quality = '320') {
  const res = await fetch(`${API_BASE}/music/stream?id=${encodeURIComponent(songId)}&source=${source}&quality=${quality}`, {
    headers: {
      'X-Sonic-Key': API_KEY,
    },
  });
  return res.body; // 音频流不支持也不需要 302 直链场景下的 key 传参
}

// 3. 高精度逐字同步歌词
async function getSongLyrics(title: string, artist = '', platform = 'netease', platformId = '') {
  const params = new URLSearchParams({ title, artist, platform, platformId });
  const res = await fetch(`${API_BASE}/sonic/lyrics/nexus?${params.toString()}`, {
    headers: {
      'X-Sonic-Key': API_KEY,
    }
  });
  return await res.json();
}
```

---

## 🔄 生产环境双轨回滚预案 (Production Rollback)
当需要将生产域名与 Tunnel 路由恢复至变更前状态时，可执行仓库内置的双轨回滚脚本：
```bash
# 干跑验证备份文件完整性并预览将发送的 API 请求 (默认安全模式)
./scripts/rollback-production.sh --dry-run

# 真实执行回滚 (恢复 Tunnel Ingress 映射与 DNS CNAME 记录)
./scripts/rollback-production.sh --execute
```

---

## 🛡️ 架构独立性与多专案协作准则
- epocanvas sonic 作为一个**独立的 Cloudflare Pages + Linux 本地解析引擎服务**运行，完全独立于任何特定博客或网站。
- 外部专案（如 `shijianus-blog`）仅通过 HTTP RESTful API 与 epocanvas sonic 交互，保证了微服务架构的高内聚、低耦合与分布式弹性部署。
- 本项目采用 CC BY-NC-SA 协议，禁止商业化转售行为。
