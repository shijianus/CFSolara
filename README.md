# 🎶 Solara（光域）& Sonic 多源聚合网关

> 🌐 基于 Cloudflare Pages Functions 打造的现代化网页音乐播放器与 **Sonic 多源聚合网关**。具备品牌化路由、并行多上游检索去重、毫秒级逐字歌词与自适应插值兜底。

---

## ⚡ Sonic 多源聚合网关 (Sonic Gateway)

Solara 现已全面接入 **Sonic 网关协议**。所有开放服务统一采用 `Sonic` 品牌前缀、顶层标准响应格式与 `sonic:` 缓存前缀。

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
| `GET` | `/api/sonic/lyrics` | **向后兼容端点** | 内部透明代理至 `/api/sonic/lyrics/nexus` |

### 2. 搜索网关 (`/api/sonic/search/*`)

| 方法 | 路径 | 说明 | 行为 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/sonic/search/nexus` | **全网多源并行搜索（前端默认）** | `Promise.allSettled` 并行检索，单源超时隔离，归一化去重合并多 `platformId` |
| `GET` | `/api/sonic/search/netease` | 网易云单源搜索 | 返回统一 Track 结构 |
| `GET` | `/api/sonic/search/qq` | QQ音乐单源搜索 | 返回统一 Track 结构 |
| `GET` | `/api/sonic/search/kugou` | 酷狗音乐单源搜索 | 返回统一 Track 结构 |
| `GET` | `/api/sonic/search/gdstudio` | GDStudio / Meting 单源搜索 | 支持网易云/酷我/JOOX多源切换 |
| `GET` | `/api/sonic/search/{platform}` | 动态单源搜索 | 支持任意已接入音源 |

#### 统一 Track 契约
```json
{
  "id": "netease:1357375695",
  "title": "海阔天空",
  "name": "海阔天空",
  "artist": "Beyond",
  "album": "华纳廿三周年纪念精选系列",
  "duration": 324,
  "cover": "https://...",
  "coverUrl": "https://...",
  "platform": "netease",
  "platformId": "1357375695",
  "sources": [
    { "platform": "netease", "platformId": "1357375695", "duration": 324 },
    { "platform": "kugou", "platformId": "c41e80a18d1448fa47086372999c7f43", "duration": 324 }
  ]
}
```

---

## ⚙️ 环境变量配置 (`wrangler.toml` / Cloudflare Pages)

所有 Sonic 开关与外链均使用 `SONIC_` 前缀，支持故障熔断与单源开关：

```toml
[vars]
# 上游外链地址配置（支持自建镜像与代理）
SONIC_UPSTREAM_GDSTUDIO = "https://music-api.gdstudio.xyz/api.php"
SONIC_UPSTREAM_AMLL = "https://api.amll.dev"
SONIC_UPSTREAM_LRCLIB = "https://lrclib.net"
# SONIC_UPSTREAM_METING = "https://your-meting-instance.example.com"

# 音源启用开关（1/true 启用，0/false 禁用）
SONIC_ENABLE_NETEASE = "1"
SONIC_ENABLE_QQ = "1"
SONIC_ENABLE_KUGOU = "1"
SONIC_ENABLE_AMLL = "1"
SONIC_ENABLE_LRCLIB = "1"
SONIC_ENABLE_GDSTUDIO = "1"

# 可选服务（默认未配置则返回 501 disabled）
SONIC_ENABLE_APPLE = "0"
SONIC_ENABLE_YTMUSIC = "0"
# SONIC_APPLE_MUSIC_TOKEN = "your_token_here"
# SONIC_YOUTUBE_API_KEY = "your_key_here"

# 单源超时阈值（毫秒，默认 3500ms，杜绝任何外部单点阻塞整体响应）
SONIC_TIMEOUT_MS = "3500"
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

## 📄 许可证
本项目采用 CC BY-NC-SA 协议，禁止商业化行为，任何衍生项目必须保留本项目地址并以相同协议开源。
