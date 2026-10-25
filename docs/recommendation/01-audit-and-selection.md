# CFSolara 智能音乐推荐与搜索引擎：现状审计与开源技术选型报告（阶段 1 & 阶段 2）

> **文档状态**：基于工作区真实代码与公开仓库核验完成  
> **核验日期**：2026-10-24  
> **适用仓库**：`shijianus/CFSolara`（当前分支 `security/fix-auth-ratelimit-ssrf`）

---

## 第一部分：现状审计报告（Phase 1 Audit）

### 1.1 当前真实架构与请求链路

CFSolara（对外网关技术契约 `Sonic` / `epocanvas sonic`）采用 **Linux VPS 本地解析引擎为主 + Cloudflare Pages Functions 边缘网关为辅** 的双层同构架构：

1. **同构代码复用**：
   - `functions/` 存放 Cloudflare Pages Functions 路由及 `functions/_lib/sonic/` 核心逻辑（纯 TypeScript，基于 Web Standard `Request`/`Response`/`crypto.subtle`）。
   - `server/index.ts` 使用 Node.js 22 原生 `http.createServer` 将请求转换为 Web `Request` 并直接复用 `functions/` 中的全部路由处理器，通过 `esbuild` 打包为单文件 `dist-server/index.mjs` 运行于 `node:22-alpine` 容器中。
2. **VPS 与 Cloudflare 通信及安全边界**：
   - 公网请求先进入 Cloudflare Pages Functions，经 `evaluateGatewayRateLimit` 分级滑动窗口限流（匿名默认 `240 rpm`，持签名 API Key `600 rpm`）。
   - 缓存未命中且三态熔断器（`CLOSED` / `OPEN` / `HALF_OPEN`）闭合时，边缘通过 `callLocalEngineJson`（携带常量时间校验头 `X-Sonic-Engine-Key` 及真实 `X-Sonic-Client-IP`）经 Cloudflare Tunnel 转发至 VPS `sonic-engine`（内部联动 `ncm-api` Sidecar 容器与纯 TS 原生加密协议）。
   - 音频流（`/api/music/stream`）支持 `Range: bytes=...`（`206 Partial Content`）与动态相对字节阈值试听判定（`full` / `trial` / `unavailable`），由 Cloudflare 边缘直拉上游音乐 CDN，零 VPS 音频带宽消耗。
   - 当 VPS 离线或 Tunnel 返回 `530`/`52x` 时，熔断器 `0ms` 瞬时打开（`OPEN`），自动降级至 Cloudflare 边缘直连（QQ/酷狗搜索、AMLL/LRCLIB 歌词、Stale 缓存）并返回 `X-Sonic-Degraded: 1`。
3. **前端真实入口**：
   - **生产主力前端**位于 `player/`（Vue 3.5 + Vite 7 + Pinia 3 + Tailwind CSS 4），构建产物输出至 `dist/`。
   - 根目录 `index.html`、`js/index.js`、`css/` 为早期历史遗留静态版本，不参与 `npm run build` 生产产物打包。

### 1.2 现有搜索、推荐、身份与存储能力核验

| 维度 | 真实代码现状 | 关键代码位置 | 审计结论 |
| :--- | :--- | :--- | :--- |
| **多源聚合搜索** | 已实现并行拉取网易云、QQ、酷狗（另注册有酷我单源），计算 `computeSongSha`、清洗括号标签并按时长差 `<=6s` 聚类合并 `sources[]`，按精确/前缀/跨源共识/音质打分 | `functions/_lib/sonic/nexus-search.ts` | **基础扎实，可直接复用并增强**；尚缺繁简转换、拼音检索、歌手中英别名、拼写纠错、版本精细区分（翻唱/Live vs 原版）与个性化微调 |
| **随机音乐接口** | `getRandomTracks()` 仅从 8 个硬编码流派词随机抽一个词调用普通搜索后 `Math.random()` 洗牌 | `functions/_lib/music.ts`、`functions/api/music/random.ts` | **伪随机包装器**，无热度、无偏好理解 |
| **首页/榜单/相似歌曲** | `/api/top/*`、`/api/personalized/*`、`/api/toplist/detail` 均为网易云公开接口代理与品牌词脱敏；歌曲详情页 `song.vue` 的“相似歌曲”只是用歌手名调用 `/api/search` | `functions/_lib/sonic/upstream.ts`、`player/src/pages/song.vue:88` | **无站内真实热度、无内容相似度计算、无探索雷达**（旧版 `js/index.js` 的探索雷达只是固定拉取热歌榜 `3778678`） |
| **用户身份体系** | 已实现 Epomail OAuth 2.0 PKCE 登录与全量 HMAC-SHA256 无状态签名密钥 `sonic_live_v1.<payload>.<sig>`（含 `SONIC_SECRET_PREV` 轮换）；未登录访客无会话标识 | `functions/_lib/auth.ts` | **已有轻量安全身份机制**；需补充未登录用户的“透明可选本地匿名会话（可随时关闭/清空）”与无追踪公共模式 |
| **播放器事件与收藏** | 前端 `audio.ts` 精确区分 `loadstart`、`playing`（真实发声）、`waiting`（网络缓冲）、`timeupdate`、`ended`、`error`（含 503 降级与试听结束拦截）；`library.ts` 持久化 `likedSongs`、`followedArtists`、`userPlaylists` 至 `localStorage` | `player/src/stores/modules/audio.ts`、`library.ts` | **客户端事件钩子完备**，但完全未向服务端上报，也未区分“搜索点击转化”、“有效完播”、“手动快速跳过”与“明确不喜欢” |
| **服务端持久化与曲目库** | 服务端仅内存 `Map` LRU 与可选 CF Cache/KV，无 SQLite / D1 / PostgreSQL，无长期曲目索引 | `functions/_lib/sonic/cache.ts`、`docker-compose.yml` | **核心缺口**：VPS 重启即丢失全部运行态数据，无增量曲目库与行为存储 |
| **音频声学特征** | 上游仅返回歌名、歌手、专辑、时长、封面、音质档位、试听状态及歌词，**无任何 BPM / Energy / Danceability / 梅尔频谱特征** | `functions/_lib/sonic/providers/*` | 严禁伪造音频特征；第一阶段应诚实使用多维元数据、跨源标签、收听共现与行为序列 |

### 1.3 现有风险与技术债务记录

1. **同构构建边界**：`functions/` 下的代码会被 Cloudflare Pages Functions 直接编译到 V8 Isolate，严禁静态 `import` 任何仅限 Node.js 的模块（如 `node:sqlite`、`node:fs`）。VPS 专有持久化必须放在 `server/` 并通过依赖注入传入 `AppEnv`。
2. **`callLocalEngineJson` 仅写死 `GET`**：`functions/_lib/sonic/local-engine.ts:188` 目前固定使用 `method: 'GET'` 且未转发用户鉴权/匿名偏好头，需安全扩展以支持 `POST / DELETE /api/sonic/events` 及个性化请求回源。
3. **缓存串号风险**：现有网关缓存默认使用 `Cache-Control: public, max-age=3600` 写入 `caches.default`。个性化接口必须严格使用 `Cache-Control: private, no-store` 与 `Vary` 隔离，绝不能把甲用户的推荐缓存给乙用户。
4. **存量主题 Lint 债务**：基线运行 `npm run lint:theme` 发现当前分支已有 5 处存量硬编码白色（位于 `player/src/App.vue` 与 `AddToPlaylistDialog.vue`）。本次所有新增与修改前端代码必须严格使用 `--glass-*`、`text-primary`、`border-glass` 令牌，保持 **0 新增违规**。

---

## 第二部分：21 个候选开源项目全面技术选型评估（Phase 2 Selection）

> **核验原则说明**：
> - 对全部 21 个候选项目核对了代码架构、许可证、依赖栈、数据来源及对中文流媒体聚合场景的适配性。
> - 对于未公开索引或缺少明确开源许可证的仓库，如实标注状态，绝不编造参数。
> - 特别核实了一个关键行业事实：**Spotify 已于 2024 年 11 月 27 日正式废弃并封锁第三方新应用访问 `GET /v1/audio-features`、`GET /v1/audio-analysis`、`GET /v1/recommendations` 与 `related-artists`（返回 `403 Forbidden`）**。因此所有强依赖 Spotify 实时或静态 Audio Features CSV 的项目在中文曲库与持续增量更新上均存在根本性断源风险。

### 2.1 全量候选项目多维对比矩阵

| # | 项目名称与地址 | 算法类型 | 工程成熟度 | 可复用形态 | 独立数据库 | 资源需求估算 (CPU/RAM/Disk) | 外部服务/数据集/GPU 依赖 | 中文音乐适配 | 歌曲级推荐 | 整合难度 | 维护活跃度 | 许可证与合规限制 | 选型结论 |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :-: | :-: | :-: | :-: | :--- | :---: |
| **1** | **reZonance**<br/>`github.com/radioactive11/rezonance` | 基于内容过滤 (Content-Based) + 余弦相似度 | 原型/作品集级 (Flask + Pandas/Sklearn) | 仅算法思路可参考 | 静态约 16 万首特征表 | 1 vCPU / 512MB–1GB RAM（全表驻留 Pandas） | 依赖预构建英文/国际流媒体特征表，无 GPU 需求 | 差（华语曲库覆盖极低，无跨源 ID） | 是 | 中高（跨语言 Python + 静态表断源） | 低（早期项目，近年几乎停滞） | 仓库未附标准宽松许可文件 / 关联组件含 GPL 风险（严禁复制代码） | **借鉴思路**（仅参考 Seed 余弦相似度思路，不引代码与数据） |
| **2** | **Vibe Recommender**<br/>`github.com/jessicabat/vibe-recommender` | 加权特征余弦相似度 + 多样性重排 + 温度探索 | 演示级 Streamlit Demo（**注：该精确路径在公开索引中未检出公开 Release，按公开 Streamlit 同类架构与描述核验标注为部分未验证**） | 算法策略借鉴 | 无（内存 CSV/DataFrame） | 1 vCPU / 256–512MB RAM | 依赖预设情绪/音频特征列，无 GPU | 差（特征集偏向 Spotify 英文曲目） | 是 | 低（若仅在 TS 中重现数学策略） | 未验证 / 个人 Demo | 未验证公开许可证（按默认保留版权对待，**严禁复制源码**） | **借鉴策略**（自主在 TS 实现 MMR 多样性重排、温度探索与可解释标签） |
| **3** | **Resonance**<br/>`github.com/nauqh/resonance` | Content-Based KNN + 偏好统计 | 中等（FastAPI + Pydantic + Docker） | 独立 Python 微服务 | **需要 PostgreSQL** | 1–2 vCPU / 1–2GB RAM / 5GB+ Disk | 强依赖 **Spotify Million Playlist Dataset** 静态集 | 差（MPD 数据集几乎无国内平台曲目与最新华语歌） | 是 | 高（需额外部署 PG + FastAPI + 解决 Spotify ID 断层） | 一般（个人工程项目） | **GPL-3.0**（强传染性 Copyleft） | **排除部署**（数据源不适配中文曲库 + PG 重依赖 + GPL-3.0） |
| **4** | **Gorse**<br/>`github.com/gorse-io/gorse` | 协同过滤 (ALS/BPR) + Item-to-Item + 标签/向量混合召回 + AutoML | **生产级成熟开源引擎**（Go 编写，REST API 完整） | 独立容器服务（REST API） | **需要 MySQL/PG/Mongo + Redis** | 2 vCPU / 1.5–4GB+ RAM / 10GB+ Disk | 无外部 API 依赖，无需 GPU | 好（ID 无关，支持任意标签与中文分类） | 是 | 中（REST 契约清晰，但需额外维护 3 个容器：Gorse + Redis + DB） | **高**（社区活跃，持续发版） | **Apache-2.0**（商业/开源高度友好） | **二期可选扩展引擎**（代码内置可插拔 `GorseAdapter`，一期不强制常驻以免耗尽小型 VPS 内存） |
| **5** | **Music Recom**<br/>`github.com/YIZHE12/music_recom` | 矩阵分解 + Word2Vec + 混合召回排序 | 实验/教学级（Colab Notebook + 脚本） | 仅冷启动与分阶段流水线思路 | 无（离线文件） | 离线运行 1–2GB RAM | 依赖离线竞赛/公开数据集 | 一般 | 是 | 高（非在线低延迟服务代码） | 低（静态研究仓库） | 未明确标准许可证（仅阅读公开算法思想） | **借鉴思路**（召回→排序两阶段漏斗与冷启动回退） |
| **6** | **Music Recommender**<br/>`github.com/KieranSatheesan/Music_Recommender` | Content KNN + K-Means + ALS + Item2Vec 可调权混合 | 原型/实验级（Python + Streamlit） | 混合融合与离线评测指标设计参考 | 无（内存矩阵） | 1–2 vCPU / 1–2GB RAM | 依赖离线交互与 Spotify 特征集 | 一般 | 是 | 高（非生产 API 服务） | 低 | 个人学术/作品集仓库（仅借鉴多路加权与评测方法） | **借鉴思路**（内容+序列共现+可调权重融合及 Precision/NDCG 评测框架） |
| **7** | **Acai**<br/>`github.com/BerryAI/Acai` | 记忆协同过滤 + CNN 深度学习研究 | 研究原型级 | 无生产可复用模块 | 无 | 训练需较高 CPU/GPU 与数 GB 内存 | 依赖研究音频/评分数据集，CNN 推理重 | 差 | 是 | 极高 | 低（多年未活跃维护） | 研究代码仓库 | **排除**（偏学术实验，无工程服务化价值） |
| **8** | **MakingL Music Recommendation**<br/>`github.com/MakingL/music_recommendation` | 协同过滤 + 深度学习检索 + Web 演示 | 课程/毕业设计级中文项目（含 Docker） | 仅中文业务分层参考 | 需关系型数据库 | 1–2 vCPU / 1–2GB RAM | 依赖离线爬虫/固定华语数据集 | 好（面向中文场景） | 是 | 高（前后端耦合，非网关中间件） | 低 | 未附清晰现代工程测试保障 | **排除直接集成**（工程质量与高并发健壮性不及 CFSolara 现有网关标准） |
| **9** | **PulseFlow AI Offline Music Recommender**<br/>`github.com/Philippe-Guerrier/pulseflow-ai-offline-music-recommender` | CLAP (HTSAT-Tiny) 音频嵌入 + Essentia/MusicNN + Dejavu 指纹 + FAISS + Ollama | 桌面/本地离线套件级 | 未来离线声学向量路线参考 | 本地文件 + FAISS 索引 | **重**（2–4+ vCPU / 4–8GB+ RAM，有 GPU 更佳） | **需完整本地音频文件解码**；可选本地 Ollama LLM | 语言无关（纯声学） | 是 | 极高（CFSolara 不落盘全量 MP3，拉流解码违背零带宽与合规约束） | 近期个人项目 | **无明确开源 LICENSE 文件**（默认保留所有权利，严禁复用代码） | **排除现阶段引入**（无许可证 + 必须下载全曲音频提取特征，留作三期本地自有曲库可选研究） |
| **10** | **Music Rec System**<br/>`github.com/Philippe-Guerrier/music_rec_system` | 音频嵌入 + 音频指纹 + 相似检索（**注：经核验与 #9 同属 Philippe-Guerrier 同源演进项目**） | 同 #9 | 同 #9 | 本地特征库 + FAISS | 2–4+ vCPU / 4GB+ RAM | 需本地完整音频文件输入 | 语言无关 | 是 | 极高 | 同 #9 | **无明确 LICENSE 文件** | **排除**（与 #9 同源，受限于全量音频解码成本与无许可证） |
| **11** | **Soundalike**<br/>`github.com/yassinsolim/soundalike` | 大规模音频特征向量检索 + 语言过滤 + **版本去重** + 盲测评估框架 | 较成熟的垂直工具 | **版本去重、同歌手抑制、盲测评估思路极佳** | 向量/特征存储 | 1–2 vCPU / 1–4GB RAM | 绑定预计算的数十万曲目特征与 Spicetify 生态 | 一般（含严格语言过滤机制） | 是 | 中高（预计算特征无法直接覆盖国内多源新歌） | 较活跃 | **MIT License**（宽松友好） | **重点借鉴算法机制**（采纳其版本去重 Studio vs Live/Cover、语言一致性约束与离线对比评测思想） |
| **12** | **Spotify Song Recommender**<br/>`github.com/memgraph/spotify-song-recommender` | 图数据库（歌曲-歌单二部图共现 PageRank / 邻居游走） | 官方展示 Demo（Memgraph） | 二部图共现数学思想 | **需要 Memgraph 图数据库容器** | 2 vCPU / 2–4GB+ RAM（内存图引擎） | 示例依赖 Spotify 歌单图数据 | 语言无关 | 是 | 高（为几万首歌单独运维内存图库性价比极低） | Demo 性质 | **MIT License** | **排除 Memgraph 容器，借鉴共现算法**（在 SQLite 内用轻量 `track_cooccurrence` 共现表实现等效二部图邻居召回，零额外内存开销） |
| **13** | **Meilisearch**<br/>`github.com/meilisearch/meilisearch` | 倒排索引 + 前缀自动补全 + 拼写容错 + `charabia` 原生中日韩分词 | **生产级成熟搜索引擎**（Rust + LMDB 内存映射） | 独立容器服务（REST API） | 自带 LMDB 磁盘映射存储 | 1 vCPU / **256MB–1GB RAM** / 1–5GB Disk | 无外部依赖，无需 GPU | **极佳**（内置 `charabia` 原生支持中文/日文分词） | 支持曲目检索与自定义排序 | 低（HTTP JSON API 极简） | **极高** | **MIT License**（CE 社区版完全 MIT） | **首选外部搜索扩展候选**（一期使用零容器 Node 22 内置 SQLite FTS5 + 自研繁简/拼音/别名引擎即可 `<2ms` 满足增量曲库；同时内置可选 `MeilisearchAdapter` 供百万级曲库平滑开启） |
| **14** | **Typesense**<br/>`github.com/typesense/typesense` | 内存倒排索引 + Fuzzy Search + 多字段排序 | **生产级成熟搜索引擎**（C++） | 独立容器服务 | 自带快照，但**全量索引常驻 RAM** | 1–2 vCPU / **全量索引体积 2~3 倍 RAM** | 无外部依赖 | 一般（CJK 分词需额外 locale 配置，不如 Meilisearch 开箱即用） | 支持曲目检索 | 中低 | **高** | **GPL-3.0**（服务端强传染，SDK Apache-2.0） | **排除**（全内存索引在小内存 VPS 上易 OOM，且中文开箱体验与许可证均不如 MIT 的 Meilisearch） |
| **15** | **ListenBrainz Troi**<br/>`github.com/metabrainz/troi-recommendation-playground` | Pipeline Patch 架构（听歌历史 + 标签 + 协同相似歌手 → 自动生成歌单/电台） | 成熟社区生产工具（Python） | **流水线（Patch）化推荐编排与多样性过滤思想** | 无自带库（强耦合 ListenBrainz / MusicBrainz API） | 1 vCPU / 256–512MB RAM | **强依赖 MusicBrainz MBID 体系**与 ListenBrainz API | 一般（MBID 对国内独家新歌、网络热歌映射缺失率高） | 是 | 高（CFSolara 曲目主键为国内四平台 ID 而非 MBID） | 高（MetaBrainz 官方维护） | **GPL-2.0** | **排除直接集成，借鉴架构**（借鉴其可组合 Pipeline 召回/过滤/混排算子设计，不复制 GPL 代码，不强绑 MBID） |
| **16** | **Lightweight Music Server (LMS)**<br/>`github.com/epoupon/lms` | 本地音频标签聚类 + AcousticBrainz / MusicNN 声学相似度 + 连续电台 | 成熟自托管 C++ 媒体服 | 电台续播（Auto Radio）产品交互参考 | SQLite | 1–2 vCPU / 512MB–2GB RAM | 扫描本地磁盘音频文件 | 一般 | 是 | 极高（C++ 单体本地曲库服，非流媒体网关） | 高 | **GPL-3.0** | **排除部署，参考交互**（参考其无缝连续电台续播体验） |
| **17** | **Aurral**<br/>`aurral.org` / `github.com/lklynet/aurral` | 基于收听历史、Last.fm / ListenBrainz 标签与相似歌手的发现流与智能歌单 | 较活跃的自托管音乐发现应用 | **发现页信息架构（为你推荐/近期趋势/风格探索）参考** | 自带轻量持久化 | 1 vCPU / 256–512MB RAM | 侧重对接 Lidarr / Navidrome / Last.fm | 一般 | 偏歌手/专辑发现与歌单流 | 中高（定位为本地媒体库伴侣） | 活跃 | **MIT License** | **借鉴产品与发现策略**（参考其清晰的发现流分层与解释性文案设计） |
| **18** | **Soundsible**<br/>`github.com/Arzuparreta/soundsible` | 在线检索 + 本地化私密收听追踪 + 无 LLM 原生规则推荐与 Auto DJ 续播 | 活跃的新兴自托管流媒体应用（Python） | **无大模型轻量本地历史推荐 + Auto DJ 自动续播队列机制** | 本地轻量存储 | 1 vCPU / 512MB–1GB RAM | 底层依赖 `yt-dlp` / Deezer 获取音源（此部分不符合 CFSolara 合规边界） | 一般 | 是 | 中（音源层不可用，但其推荐与 Auto DJ 状态机贴合 CFSolara） | 活跃 | **MIT License** | **重点借鉴交互与状态机**（采纳其零 LLM 轻量偏好追踪与播放队列末尾 Auto DJ 智能续播设计；坚决不引入 `yt-dlp`） |
| **19** | **Navidrome**<br/>`github.com/navidrome/navidrome` | OpenSubsonic 本地音乐服（播放计数、最近播放、星标收藏时间、智能列表规则） | **极高成熟度**（Go + SQLite） | 用户音乐行为表结构（播放次数、最近收听、收藏时间戳）设计参考 | **SQLite**（单文件高性能） | 极低（1 vCPU / 128–256MB RAM） | 本地音频文件 | 好 | 仅基础规则列表 | 不适用直接部署（纯本地文件服） | **极高** | **GPL-3.0** | **借鉴数据管理经验**（验证了单机 SQLite WAL 管理十万级曲目与播放行为在低配 CPU VPS 上的极高可靠性） |
| **20** | **Digarr**<br/>`github.com/iuliandita/digarr` | 收听历史聚合 + 相似歌手/专辑发现 + 可选 AI 推荐（面向 `*arr` 自动下载栈） | 中等活跃容器工具 | 多源外部信号融合与冷启动探索配额参考 | 轻量本地库 | 1 vCPU / 256–512MB RAM | 面向 Lidarr/Soulseek，可选外部 LLM API | 一般 | **偏歌手与专辑级**（非单曲流实时排序） | 高（业务目标是触发下载器而非在线秒播） | 活跃 | **MIT License** | **排除部署，局部借鉴**（不引入媒体下载栈与付费 AI API；仅参考其多信号融合探索思路） |
| **21** | **ListenBrainz API**<br/>`listenbrainz.org` / `listenbrainz.readthedocs.io` | 开放音乐统计与听歌记录平台（全站热门录音、热门歌手、歌手热门曲目） | **生产级公共开放数据服务** | 作为**可选辅助外部趋势与发现信号源**（通过名称/歌手映射至 CFSolara 曲库） | 远程公共 REST API | 零本地算力消耗 | 公共免费 API，**严格限频 `1 req/sec`**（通过 `X-RateLimit-*` 控制），数据遵循 CC0 / 开放许可 | 欧美/日韩覆盖好，华语主流歌手（周杰伦、陈奕迅、邓紫棋等）有覆盖但独立新歌较少 | 是（Recording 级） | 低（仅需带 6 小时缓存的轻量 HTTP 适配器，默认可选开启） | **极高** | 公共开放 API（CC0 数据，严格遵守 User-Agent 与 `1 req/s` 限流） | **采用为可选辅助外部数据源**（通过环境变量 `SONIC_ENABLE_LISTENBRAINZ` 控制，绝不阻塞主链路） |

---

### 2.2 四种架构路线深度对比与最终决策

| 评估维度 | 方案 A：纯轻量原生方案 | 方案 B：完整重型服务栈 (Sonic + Gorse + Meilisearch + Redis + PG) | 方案 C：Python 内容推荐微服务 | **方案 D：分阶段模块化混合架构（最终选定）** |
| :--- | :--- | :--- | :--- | :--- |
| **常驻容器数量** | 2 个（现有 `sonic-engine` + `ncm-api`） | **6 个**（+ `gorse-all` + `redis` + `postgres` + `meilisearch`） | 3~4 个（+ `python-fastapi` + 可选 DB） | **一期仍为 2 个现有容器**；二/三期通过环境变量热插拔外部引擎 |
| **VPS 内存占用** | **~180–260 MB 总计**（增量 `< 45 MB`） | **2.5 GB – 5 GB+**（1C1G/2C2G 小型 VPS 极易 OOM） | ~600 MB – 1.2 GB（Python 科学计算栈常驻内存较高） | **一期 ~200–280 MB**（直接复用 Node 22 内置 `node:sqlite` WAL + FTS5） |
| **初期推荐效果（用户数 < 1000）** | 好（内容+热度稳健） | **反而较差**（交互矩阵极度稀疏，ALS/BPR 协同过滤易产生噪声推荐，仍退化回热门榜） | 受限于静态特征集覆盖率 | **最优**（精准结合真实元数据、跨源共识、站内贝叶斯热度、实时搜索/播放序列共现与 MMR 多样性） |
| **中文搜索增强能力** | 若仅改内存排序则无持久索引 | Meilisearch `charabia` 强，但需双写同步 | 不解决搜索问题 | **极强**：Node 22 原生 SQLite FTS5 + 自研繁简归一 + `Intl.Collator` 拼音/首字母 + 中英歌手别名库 + 编辑距离容错 |
| **同构与容灾能力** | 高 | 外部组件挂掉时故障面大 | 跨语言序列化与健康检查增加复杂度 | **电信级容灾**：VPS SQLite 故障自动退化内存库；VPS 整机离线由 CF 边缘自动降级至公共热榜+上下文轻量推荐 |
| **长期演进上限** | 大规模协同过滤受限 | 高 | 中 | **无上限**：内置标准 `RecommendStore` 与 `ExternalEngineAdapter`（已实现可选 Gorse / Meilisearch / ListenBrainz HTTP 适配器） |

#### 最终技术决策总结

1. **首选落地架构**：**方案 D（分阶段模块化混合架构）**，第一阶段直接在现有 Node.js 22 `sonic-engine` 内通过 **Node 22 原生内置 `node:sqlite`（WAL 模式 + FTS5 全文检索引擎）** 实现零额外容器、零 C++ 编译依赖的持久化推荐与智能搜索引擎；在 `functions/_lib/sonic/recommend/` 中以 100% 纯 TypeScript 实现九层模块化推荐与智能搜索核心，保持 Cloudflare Pages Functions 与 Linux VPS 双向同构。
2. **备选与平滑升级方案**：当未来日活用户超过 `1,000+`、累计真实交互事件超过 `100,000+` 或本地增量曲目索引超过 `500,000+` 首时，无需修改前端或路由契约，仅需在 VPS 启动可选的 `Gorse`（Apache-2.0）或 `Meilisearch`（MIT）容器并填入 `SONIC_GORSE_URL` / `SONIC_MEILISEARCH_URL` 环境变量，即可激活大规模矩阵分解协同过滤与外部全文检索引擎。
3. **明确排除项与合规红线**：
   - **不引入**任何强依赖已废弃 Spotify Audio Features API 的静态数据集冒充真实声学特征；
   - **不引入**需要无授权批量下载全曲 MP3 做实时 FFT/CLAP 推理的重型音频分析器（规避带宽爆炸、CPU 跑满与版权合规风险）；
   - **不复制**任何 GPL-2.0 / GPL-3.0（如 `Resonance`、`Typesense`、`Troi`、`LMS`、`Navidrome`）或无许可证（`PulseFlow`）项目的源代码，所有算法模块均基于公开数学原理以原生 TypeScript 洁净室实现。
