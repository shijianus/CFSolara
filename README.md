# 🎶 Sonic 多源聚合音乐云平台 & 网关 (v2.2.0 Linux 本地引擎版)

> 🌐 采用 **Linux VPS 本地协议解析引擎为主 + Cloudflare Pages Functions 边缘缓存与优雅降级为辅** 的双层架构，配套现代化网页音乐播放器与 **Sonic 多源聚合网关**。具备本地原生加密协议解析（网易云 `linuxapi`/`eapi`/`ncm-api`、QQ `musicu.fcg`、酷狗 `KRC`、酷我原生检索）、三级熔断降级状态机与多语言毫秒级真逐字歌词。
> 
> 🟢 **当前线上主域名：[https://sonic.epocanvas.tech](https://sonic.epocanvas.tech)**（备用域：`https://sonic.epocanvas.com`）。

---

## ⚡ Sonic 多源聚合网关 (Sonic Gateway)

Sonic 开放服务统一采用 `Sonic` 品牌前缀、顶层标准响应格式与 `sonic:` 缓存前缀。

### 统一响应结构
所有 `/api/sonic/*` 接口遵循一致的顶层契约：
```json
{
  "brand": "Sonic",
  "data": { ... },
  "meta": {
    "cached": false,
    "cacheLevel": "none",
    "latencyMs": 142,
    "provider": "nexus",
    "attempts": [
      { "provider": "netease", "ok": true, "ms": 95 },
      { "provider": "amll", "ok": false, "ms": 47, "error": "Not found" }
    ]
  }
}
```

---

## 📡 API 路由清单 (Sonic Routes)

### 1. 歌词网关 (`/api/sonic/lyrics/*`)

| 方法 | 路径 | 说明 | 优先级 / 行为 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/sonic/lyrics/nexus` | **全网聚合主入口（前端默认）** | ①平台原生 → ②AMLL TTML → ③多源KRC/Richsync → ④LRCLIB/行级插值 |
| `GET` | `/api/sonic/lyrics/netease` | 网易云原生歌词 | 优先原生 YRC 逐字，降级 LRC |
| `GET` | `/api/sonic/lyrics/qq` | QQ音乐原生歌词 | 优先原生 QRC 逐字，降级 LRC |
| `GET` | `/api/sonic/lyrics/kugou` | 酷狗音乐 KRC 歌词 | 自动 XOR 解密 + Deflate 解压真逐字 |
| `GET` | `/api/sonic/lyrics/amll` | AMLL TTML 歌词库 | 精准 Timed Text XML 字级时间轴 |
| `GET` | `/api/sonic/lyrics/lrclib` | LRCLIB 全球同步歌词 | 权威纯音乐预检与高质量行级同步 |
| `GET` | `/api/sonic/lyrics/apple` | Apple Music（可选适配） | 未配置密钥返回 `501 Not Implemented` + disabled |
| `GET` | `/api/sonic/lyrics/ytmusic` | YouTube Music（可选适配） | 未配置密钥返回 `501 Not Implemented` + disabled |
| `GET` | `/api/sonic/lyrics/lyriva` | Lyriva 第三方兜底（默认关闭） | 默认返回 `meta.disabled: true`；需显式开启 `SONIC_ENABLE_LYRIVA=1` |
| `GET` | `/api/sonic/lyrics/sync` | 外部组件多格式同步歌词 | 支持 `format=sonic\|lrc\|ttml\|json` |
| `GET` | `/api/sonic/lyrics` | **向后兼容端点** | 内部透明代理至 `/api/sonic/lyrics/nexus` |

### 2. 搜索、流解析与引擎网关 (`/api/sonic/*`)

| 方法 | 路径 | 说明 | 行为 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/sonic/search/nexus` | **全网多源并行搜索（前端默认）** | 优先调用 Linux 本地引擎；降级时 `Promise.allSettled` 边缘直连，归一化合并 `sources[]` |
| `GET` | `/api/sonic/search/netease` | 网易云单源搜索 | 原生 `ncm-api` / `linuxapi` 检索，返回统一 Track 结构 |
| `GET` | `/api/sonic/search/qq` | QQ音乐单源搜索 | 原生 `u.y.qq.com` 检索，返回统一 Track 结构 |
| `GET` | `/api/sonic/search/kugou` | 酷狗音乐单源搜索 | 原生检索，返回统一 Track 结构 |
| `GET` | `/api/sonic/search/kuwo` | 酷我音乐单源搜索 | 原生检索（含 181KB 版权提示音假流过滤） |
| `GET` | `/api/sonic/search/gdstudio` | GDStudio 第三方兜底（默认关闭） | 默认返回 `meta.disabled: true`；仅当 `SONIC_ENABLE_GDSTUDIO=1` 时启用 |
| `GET` | `/api/sonic/search/{platform}` | 动态单源搜索 | 支持任意已接入音源 |
| `GET` | `/api/sonic/forward` | 统一聚合与防盗链资源转发 | 支持搜索、歌词与受 SSRF 保护的媒体资源代理 |
| `GET` | `/api/sonic/resolve/stream` | 本地引擎流直链解析（内部鉴权） | 强制校验 `X-Sonic-Engine-Key`，供边缘网关缓存直链元数据 |
| `GET` | `/api/sonic/engine/health` | 本地引擎健康与熔断诊断（内部鉴权） | 强制校验 `X-Sonic-Engine-Key`，匿名访问返回 `401` |

#### 统一 Track 契约（`/api/sonic/search/nexus` 聚合响应）
```json
{
  "id": "1357375695",
  "title": "海阔天空",
  "name": "海阔天空",
  "artist": "Beyond",
  "album": "华纳廿三周年纪念精选系列",
  "duration": 324,
  "cover": "https://...",
  "coverUrl": "https://...",
  "platform": "sonic",
  "platformId": "1357375695",
  "sources": [
    { "platform": "netease", "platformId": "1357375695", "duration": 324 },
    { "platform": "qq", "platformId": "001yS0N33yPm1B", "duration": 324 },
    { "platform": "kugou", "platformId": "c41e80a18d1448fa47086372999c7f43", "duration": 324 }
  ]
}
```
> 注：单平台路由（如 `/api/sonic/search/netease`）返回的顶层 `platform` 为对应源名（如 `"netease"`）；聚合路由 `/api/sonic/search/nexus` 顶层 `platform` 统一为 `"sonic"`，并在 `sources[]` 中如实保留各平台原始 `platform` 与 `platformId`。

---

## ⚙️ 环境变量配置 (`.env.example` / Cloudflare Pages)

所有 Sonic 开关与外链均使用 `SONIC_` 前缀，第三方免费聚合上游与 VIP 解灰**默认全部关闭**：

```ini
# 服务间通信与鉴权（Cloudflare Pages -> Linux VPS 本地引擎）
SONIC_LOCAL_ENGINE_URL="https://engine-sonic.epocanvas.tech"
SONIC_ENGINE_SECRET="<your_strong_random_secret>"

# 本地原生音源启用开关（1/true 启用，0/false 禁用）
SONIC_ENABLE_NETEASE="1"
SONIC_ENABLE_QQ="1"
SONIC_ENABLE_KUGOU="1"
SONIC_ENABLE_KUWO="1"
SONIC_ENABLE_AMLL="1"
SONIC_ENABLE_LRCLIB="1"

# 第三方免费聚合上游与 VIP 解灰（默认严格关闭）
SONIC_ENABLE_GDSTUDIO="0"
SONIC_ENABLE_LYRIVA="0"
SONIC_ENABLE_UNBLOCK="0"

# 可选商业流媒体歌词适配（未配置密钥则返回 501 disabled）
SONIC_ENABLE_APPLE="0"
SONIC_ENABLE_YTMUSIC="0"

# 超时与熔断配置（毫秒，默认单源 8000ms，Pages->Engine 4500ms，熔断冷却 30000ms）
SONIC_TIMEOUT_MS="8000"
SONIC_ENGINE_TIMEOUT_MS="4500"
SONIC_CB_FAILURE_THRESHOLD="3"
SONIC_CB_COOLDOWN_MS="30000"
```

---

## 🧪 验收与验证 Curl 示例

```bash
# 1. 搜索聚合：多源并行检索、去重与合并 sources[]
curl -s "http://localhost/api/sonic/search/nexus?q=海阔天空&count=5"

# 2. 歌词聚合（透传 platform + platformId，优先平台原生逐字 YRC）
curl -s "http://localhost/api/sonic/lyrics/nexus?title=年少有为&artist=李荣浩&platform=netease&platformId=1293886117"

# 3. 歌词聚合（仅歌名/歌手，走 AMLL / LRCLIB 假逐字插值兜底）
curl -s "http://localhost/api/sonic/lyrics/nexus?title=Shape%20of%20You&artist=Ed%20Sheeran"

# 4. 单源歌词路由（网易云）
curl -s "http://localhost/api/sonic/lyrics/netease?title=年少有为&platformId=1293886117"

# 5. 单源歌词路由（未配置密钥的 Apple Music，返回 501 + disabled 说明）
curl -s "http://localhost/api/sonic/lyrics/apple?title=Hello&artist=Adele"

# 6. 单源搜索路由（GDStudio）
curl -s "http://localhost/api/sonic/search/gdstudio?q=海阔天空&count=3"

# 7. 旧端点向后兼容（/api/sonic/lyrics 内部直接转至 nexus）
curl -s "http://localhost/api/sonic/lyrics?title=年少有为&platformId=1293886117"
```

---

## 💖 致谢与开源协议参考 (Credits)

本专案的 Sonic 多源聚合网关借鉴并致谢以下优秀的开源专案与协议实现：

- **Meting**：https://github.com/metowolf/Meting
- **Meting-API-Serverless**：https://github.com/Warma10032/Meting-API-Serverless
- **ourcraft-music-api**：https://github.com/Yuncan050115/ourcraft-music-api
- **music-lib**：https://github.com/guohuiyuan/music-lib
- **go-music-api**：https://github.com/guohuiyuan/go-music-api
- **NeteaseCloudMusicApi**：https://github.com/Binaryify/NeteaseCloudMusicApi
- **QQMusicApi**：https://github.com/jsososo/QQMusicApi
- **AMLL (Timed Text XML API)**：https://github.com/amll-dev/amll-ttml-api
- **LRCLIB (Synced Lyrics)**：https://lrclib.net/docs
- **GDStudio Music API**：https://music-api.gdstudio.xyz/api.php
- **Linux.do 社区**：牛就是牛 @ufoo 大佬灵感提供

---

## 📄 许可证与版权 (Copyright & License)
Copyright © 2026 EpoCanvas. All rights reserved.  
本项目采用 CC BY-NC-SA 协议，禁止商业化转售行为，任何衍生项目必须保留本项目地址并以相同协议开源。
