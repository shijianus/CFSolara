# 🎶 CFSolara 开放音乐 API 平台规范 (API Platform Documentation)

> CFSolara 现已升级为**平台化音乐服务**，将原有的单体音乐播放器解耦为细粒度的微服务 API，并通过 **Epomail OAuth 2.0** 作为统一接入鉴权体系，有效防止接口被滥用，同时允许第三方独立项目（如个人博客、静态站点、桌面与移动端应用）通过安全的 API Key 连结接入。

---

## 🔐 鉴权体系：Epomail OAuth 2.0 与 API Key

为了防止曲库 API 被恶意爬取与高频滥用，平台提供两级安全机制：

1. **Epomail OAuth 唯一登录**：
   - 授权端点：`GET /api/auth/login` （自动重定向至 Epomail 官方授权中心）
   - 回调端点：`GET /api/auth/callback?code=...`
   - 用户信息：`GET /api/auth/user`
2. **专案连结 API Key**：
   - 登录 Epomail 后即可自动获得专案 API Key（格式如 `solara_live_...`）。
   - 在第三方专案发起请求时，只需在 HTTP 请求头添加：
     ```http
     X-CFSolara-Key: solara_live_xxxxxxxx
     # 或
     Authorization: Bearer solara_live_xxxxxxxx
     ```
   - 拥有 API Key 的专案可享受高频配额（120 次/分钟）与无损 FLAC / 320Kbps 音频流直传。

---

## 📡 细粒度模块化 API 接口列表

所有接口均已配置全域 CORS (`Access-Control-Allow-Origin: *`)，前端或后端服务均可直接调用。

### 1. 跨站曲库搜索 (`GET /api/music/search`)
- **请求参数**：
  - `q`: 搜索关键词（歌曲名、歌手名或专辑名，必填）
  - `source`: 音源，支持 `netease`（网易云）、`kuwo`（酷我）、`qq`（QQ音乐），默认 `netease`
  - `count`: 返回数量，默认 `20`（最大 `50`）
  - `page`: 分页页码，默认 `1`
- **响应示例**：
  ```json
  {
    "ok": true,
    "query": "周杰伦",
    "source": "netease",
    "page": 1,
    "count": 20,
    "tracks": [
      {
        "id": "186016",
        "name": "晴天",
        "artist": "周杰伦",
        "album": "叶惠美",
        "source": "netease",
        "picId": "109951165507304128",
        "lyricId": "186016",
        "coverUrl": "https://..."
      }
    ]
  }
  ```

### 2. 音频流代理与解析 (`GET /api/music/stream`)
- **请求参数**：
  - `id`: 歌曲 ID（必填）
  - `source`: 音源，默认 `netease`
  - `quality`: 音质比特率，支持 `128`、`192`、`320`、`flac`，默认 `320`
- **特性**：
  - 自动透明代理音频二进制流，支持 HTTP `Range` 请求头（快进、快退、分段缓冲）。
  - 返回标准音频 MIME 类型（`audio/mpeg` 或 `audio/flac`）。

### 3. 高精度多协议歌词服务 (`GET /api/lyric` & `GET /api/music/lyric`)
- **端点**：
  - `/api/lyric`（轻量独立端点，推荐）
  - `/api/music/lyric`（模块化端点，兼容旧版）
- **跨域支持**：全域 CORS (`Access-Control-Allow-Origin: *`)，支持直接前端 `fetch` 或第三方无缝集成。
- **请求参数**：
  - `id`: 歌词 ID 或歌曲 ID（必填）
  - `source`: 音源，支持 `netease`、`qq`、`kuwo`、`kugou`、`local`，默认 `netease`
- **数据契约规范**：
  - `syncType`: `"word"`（逐字级精准对齐）或 `"line"`（行级平滑降级）。
  - `offset`: 全局时间偏置（毫秒）。
  - `lines`: 结构化时间轴数组。当 `syncType === "word"` 时，包含每个字的物理绝对时间戳 `words` 数组；当仅有普通 LRC 时，降级为行级模式，严禁伪造不准确的字时间戳。
- **响应示例 (逐字模式 Word-Level Sync)**：
  ```json
  {
    "ok": true,
    "id": "863046037",
    "source": "local",
    "syncType": "word",
    "offset": 0,
    "lines": [
      {
        "time": 280,
        "timeSec": 0.28,
        "duration": 2080,
        "text": "멈춘 시간 속",
        "words": [
          { "text": "멈춘 ", "start": 280, "startSec": 0.28, "end": 960, "endSec": 0.96, "duration": 680 },
          { "text": "시간 ", "start": 960, "startSec": 0.96, "end": 1580, "endSec": 1.58, "duration": 620 },
          { "text": "속", "start": 1580, "startSec": 1.58, "end": 2300, "endSec": 2.30, "duration": 720 }
        ]
      }
    ],
    "lineCount": 42
  }
  ```
- **响应示例 (行级模式 Line-Level Sync)**：
  ```json
  {
    "ok": true,
    "id": "186016",
    "source": "netease",
    "syncType": "line",
    "offset": 0,
    "lines": [
      { "time": 28530, "timeSec": 28.53, "duration": 3870, "text": "故事的小黄花" },
      { "time": 32400, "timeSec": 32.40, "duration": 3500, "text": "从出生那年就飘着" }
    ],
    "lineCount": 42
  }
  ```

### 4. 随机推荐曲库 (`GET /api/music/random`)
- **请求参数**：
  - `count`: 随机获取数量，默认 `10`（最大 `30`）
  - `genre`: 随机风格分类（如 `流行`、`民谣`、`摇滚`、`轻音乐`、`ACG`）
- **响应示例**：
  ```json
  {
    "ok": true,
    "count": 6,
    "genre": "轻音乐",
    "tracks": [ ... ]
  }
  ```

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

---

## 💻 外部专案接入示范 (JavaScript / TypeScript)

```typescript
// 外部专案客户端示例
const API_BASE = 'https://solara.epocanvas.com/api'; // 或自建 CFSolara 域名
const API_KEY = 'solara_live_xxxxxxxx';

// 1. 点歌搜索
async function searchSong(keyword: string) {
  const res = await fetch(`${API_BASE}/music/search?q=${encodeURIComponent(keyword)}&source=netease&count=10`, {
    headers: {
      'X-CFSolara-Key': API_KEY,
    }
  });
  return await res.json();
}

// 2. 播放音频流
function getAudioStreamUrl(songId: string, source = 'netease') {
  return `${API_BASE}/music/stream?id=${encodeURIComponent(songId)}&source=${source}&quality=320&key=${API_KEY}`;
}

// 3. 同步歌词
async function getSongLyrics(songId: string, source = 'netease') {
  const res = await fetch(`${API_BASE}/music/lyric?id=${encodeURIComponent(songId)}&source=${source}`, {
    headers: {
      'X-CFSolara-Key': API_KEY,
    }
  });
  return await res.json();
}
```

---

## 🛡️ 架构独立性与多专案协作准则
- CFSolara 作为一个**独立的 Cloudflare Pages / Workers 服务**运行，完全独立于任何特定博客或网站。
- 外部专案（如 `shijianus-blog`）仅通过 HTTP RESTful API 与 CFSolara 交互，保证了微服务架构的高内聚、低耦合与分散式部署。
