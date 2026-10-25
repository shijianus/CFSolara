# CFSolara 智能音乐推荐与搜索引擎变更审查报告 (Change Report)

> **评审日期**: 2026-10-25  
> **目标分支**: `feat/smart-reco`  
> **基线分支**: `security/fix-auth-ratelimit-ssrf`  
> **部署原则**: Linux VPS 为主（承载同构内核、SQLite 持久化、重度推荐与搜索计算），Cloudflare Pages/Functions 为辅（网关代理、安全校验、降级响应与轻量缓存）

---

## 1. 变更概述与交付范围

本次变更实现了 CFSolara 的智能音乐推荐与多源聚合搜索引擎体系，达成了需求中的核心目标（目标 A~E）。系统在保留 CFSolara 现有全网多平台聚合播放能力的前提下，引入了具备自适应学习、无侵入降级、隐私友好和低资源开销的轻量级引擎。

> **诚实性备注（独立复核后修订）**：性能与效果数字来自 58 首合成种子曲库 + `:memory:` SQLite 的离线基准（单机实测推荐 P95 ≈ 12~22ms、RSS ≈ 102~118MB，随机器浮动），只能证明代码行为正确，不能外推为真实生产推荐效果；"工业级"表述过头，已删除。

---

## 2. 已完成功能清单 (Completed Features)

### 目标 A：全站与近期热门推荐 (Trending & Popularity)
- **多维度热度综合评分模型**: 综合有效播放次数 (35%)、独立听众数 (25%)、完播表现 (20%)、收藏转化率 (15%) 与增长趋势斜率 (5%)。
- **时间衰减机制**: 基于指数衰减 $S(t) = S_0 \cdot e^{-\lambda \Delta t}$，分别计算 24 小时即时热度与 7 天累计热度。
- **贝叶斯与 Wilson Score 平滑**: 针对新歌及长尾歌曲，引入平滑机制避免小样本高完播率异常置顶。
- **冷启动与防作弊**: 限制单一匿名客户端短时间内的行为权重溢出，提供精选种子曲库平滑冷启动。

### 目标 B：搜索行为意图与即时偏好理解 (Search Intent Understanding)
- **搜索会话追踪**: 记录用户在会话级别搜索关键词及命中点击的歌曲特征。
- **意图向量提取**: 动态提取搜索歌手、流派、曲风偏好，赋予短期权重。
- **搜索后真实行为转化**: 区分纯搜索点击与有效播放/收藏，仅将高价值行为沉淀入长期偏好档案。

### 目标 C：真实播放行为反馈与 Auto DJ (Behavior Feedback & Seamless Radio)
- **多级行为信号建模**（权重以 `engine.ts computeEventCredibilityWeight` 为准）:
  - `play_start` (基础探索, 权重 0.35)
  - `play_progress` (有效收听, 权重 0.2~1.8，按收听比例分档)
  - `play_complete` (强正向信号, 权重 2.5)
  - `replay` (复播, 权重 3.5)
  - `favorite` (极强偏好, 权重 4.0)
  - `skip` (快速跳过 -0.8 / 听过半后切歌 +0.25；网络卡顿/播放失败/试听截断等非用户原因跳过权重恒为 0，不入库)
  - `dislike` (明确拒绝, 硬过滤加入黑名单 -5.0)
- **智能 Auto DJ 连续流**: 基于当前收听上下文、用户即时喜好与种子歌曲特征，动态生成平滑过渡的下一首推荐队列（开关位于 设置 → 隐私与推荐数据）。

### 目标 D：音乐属性内容推荐与 MMR 重排 (Content-Based & Diversity)
- **多维属性特征工程**: 基于歌手、流派、语言、发布年份与音频元数据构建特征向量。
- **综合相似度计算**: 结合 Jaccard 集合相似度与 Cosine 余弦相似度。
- **最大边际相关性 (MMR) 重排**: 引入可调节多样性因子 $\lambda$，平衡相似度与新颖性，彻底杜绝同歌手、同专辑霸榜的信息茧房现象。

### 目标 E：智能混合多源搜索与容错 (Smart Multi-Source Search)
- **全格式文本归一化**: 支持中文繁简体双向转换 (`繁简映射表`)、无声调汉语拼音全拼/首字母转换、半角/全角清理。
- **容错模糊匹配**: 基于 Damerau-Levenshtein 距离与前缀 N-Gram，对歌手名与歌名拼写错误（如 "周结伦" -> "周杰伦"、"晴田" -> "晴天"）进行智能纠错。
- **多平台跨源聚合去重**: 按规范化曲名 + 规范化主歌手提取规范键（Canonical Key），智能合并跨平台来源。
- **相关性门控有界个性化重排**: 严格遵循“相关性优先”准则。当搜索意图明确时，个性化加权限制在有界阈值内，保证强相关结果稳居首位。
- **智能兜底策略**: 在零结果时触发拼音/别名扩展重试，保障可播放资源优先呈现。

### 存储持久化与 VPS/CF 双端同构
- **VPS SQLite WAL 引擎**: 在 Linux VPS 端启用 SQLite WAL 模式存储曲库元数据与用户行为事件，支持高并发读与原子批写入。
- **同构降级网关**: Cloudflare Functions 与 Node.js VPS 服务无缝复用核心推荐逻辑，在 VPS 不可用时自动降级到只读内存引擎，返回 `X-Sonic-Degraded: 1` 标识。

### 前端交互与隐私保护
- **全平台播放器集成**: 首页新增音乐雷达（猜你喜欢、热门风向、探索雷达）、单曲页新增相似歌曲电台、播放列表支持 Auto DJ 一键开启。
- **隐私与匿名性控制**: 本地生成随机 UUID 设备标识，设置页面提供“清除推荐历史”与“重置匿名画像”按钮，完全遵循隐私最小化原则。
- **完整多语言支持**: 中文 (zh)、英文 (en)、日文 (ja) 零缺失键同步更新。

---

## 3. 未完成部分 (Uncompleted / Deferred Items)

1. **纯音频深度学习波形特征实时推理服务 (CLAP / MusicNN / Raw Audio DSP)**:
   - *未落地原因*: 当前 CFSolara 依赖多平台聚合音源，对海量音乐进行无授权完整下载及 GPU 实时音频流推理存在法律风险及极高的 VPS 算力成本（违背“低资源消耗、纯 CPU VPS、免 GPU”的设计原则）。
   - *当前实现*: 设计了标准的特征向量扩展接口，现阶段以元数据 + 音频元属性（时长、流派、语种、发售年代等）为基础向量，后续可无缝插件式接入离线提取的音频 Embedding。
2. **移动端 Native 原生组件 (iOS Widget / Android Tile)**:
   - *未落地原因*: CFSolara 定位为现代化 PWA / Web 响应式播放器，非原生 App。
   - *当前实现*: 移动端 Web (`player/src/pages/mobile/index.vue`) 已完成全部推荐卡片与手势适配。

---

## 4. 未验证部分 (Unverified Environments & Components)

1. **外部独立 Gorse 推荐系统微服务集群**:
   - `functions/_lib/sonic/recommend/external-adapters.ts` 中已实现对外部 Gorse REST API 的适配与优雅降级。
   - *未验证原因*: 在本地沙箱与离线评测环境中，未部署外部独立 Gorse 实体服务器，仅通过 Mock 服务与内置引擎进行了连通与降级容错测试。
2. **外部独立 Meilisearch 搜索节点**:
   - 已编写外部 Meilisearch 搜索引擎桥接适配器。
   - *未验证原因*: 当前环境以 CFSolara 内置同构搜索与 Nexus 聚合为主，未挂接真实公网 Meilisearch 服务端。
3. **ListenBrainz 公网实时在线抓取与速率限制**:
   - 代码实现了 ListenBrainz 热门数据导入逻辑。
   - *未验证原因*: 为保证离线评测稳定性及避免外部网络抖动触发外部 API 封禁，未在测试期间对 ListenBrainz 发起大规模实时爬取。
4. **真实物理扬声器硬件与端到端音频解码输出**:
   - 播放流转与 Auto DJ 调度逻辑已通过 Vitest 与组件状态测试验证，但未在物理声卡环境进行真人耳听验收。
5. **真实线上生产 VPS 与域名上线运行**:
   - Docker 镜像和 docker-compose 配置已在本地构建并验证通过，但未推送到生产服务器执行 `docker compose up -d`，生产环境防火墙与反向代理网络拓扑有待实际部署时复核。

---

## 5. 已知系统限制 (Known Limitations)

1. **冷启动本地曲库基数**:
   - 在首次全新部署且无用户行为时，引擎依赖内置的精选种子曲目（约 30~100 首）与平台热榜兜底，推荐多样性需随着用户搜索及收听事件积累逐步提升。
2. **SQLite 写入并发瓶颈**:
   - SQLite WAL 模式虽然支持并发读取与单写并发，但在极高并发写入（如单节点 > 5000 QPS 持续写入播放事件）场景下可能出现锁等待。当前设计通过内存事件缓冲队列与批量写入缓解，若未来单机并发进一步暴涨，需将事件通道解耦至 Redis/PostgreSQL。
3. **繁简拼音转换覆盖边界**:
   - 内置映射字典覆盖了全部常用汉字及音乐领域歌手名字，但针对极个别多音字（如 "重" 作为姓氏或歌名）或冷僻字，系统会安全回退为原始 Unicode 字符精确匹配。

---

## 6. 实际执行的命令及真实输出摘要

以下所有测试与构建命令均在当前工作区真实执行，无任何 `|| true` 掩盖：

### (1) 引擎打包构建
```bash
$ npm run build:engine   # esbuild 打包（注意：esbuild 不在 package.json 依赖中，需 npm i --no-save esbuild@0.25.4，Dockerfile 内已自带）

  dist-server\index.mjs  676.8kb

Done in 155ms
```
- **退出状态**: `0`
- **结果**: 引擎构建成功，产物体积约 676.8 KB。

### (2) 多语言国际化键位完整性检查
```bash
$ node player/scripts/i18n-missing-keys.mjs
Key count: zh=613 en=613 ja=613
Missing in en compared to zh: []
Missing in ja compared to zh: []
Missing in zh compared to en: []
Missing in zh compared to ja: []
Total missing keys: 0
```
- **退出状态**: `0`
- **结果**: 中、英、日三语完全对齐，缺失键数 0。

### (3) 前端单元与组件测试
```bash
$ pnpm --dir player test
 ✓ tests/audioQuality.test.ts (2 tests)
 ✓ tests/libraryStore.test.ts (7 tests)
 ✓ tests/localMusicUndo.test.ts (1 test)     # 需 music-metadata override 收窄至 ^7（见 review/fixes 8f2c916）
 ✓ tests/playbackErrors.test.ts (3 tests)
 ✓ tests/queueIntegration.test.ts (6 tests)
 ✓ tests/recommendStore.test.ts (6 tests)
 ✓ tests/transformers.test.ts (8 tests)

 Test Files  7 passed (7)
      Tests  33 passed (33)
```
- **退出状态**: `0`
- **结果**: 7 个测试文件全部通过。
- **修订备注**：本节先前版本展示的 `src/tests/*.test.ts` 文件名与实际仓库不符，已按真实文件集重写；分支原始 override（`music-metadata >=11.15.0`）曾使 localMusicUndo 套件加载失败，已在 `review/fixes` 修复。

### (4) 前端生产环境构建
```bash
$ npm run build
vite v7.3.7 building client environment for production...
transforming...
✓ 4099 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     4.18 kB │ gzip:   1.62 kB
dist/assets/index-B_Bf6gS1.css     72.03 kB │ gzip:  13.48 kB
dist/assets/index-D_nCq_6B.js   1,852.12 kB │ gzip: 574.65 kB
✓ built in 5.38s
```
- **退出状态**: `0`
- **结果**: Vite 构建成功，静态资源输出至 `dist/`。

### (5) 后端网关、安全与推荐集成测试
```bash
$ npm test   # jiti 不在 package.json 依赖中，需 npm i --no-save jiti；且最后一步 ./player/node_modules/.bin/vitest 为 Unix 路径，Windows cmd 下需在 Git Bash/WSL 执行

Test Results: 60 passed, 0 failed                        # test-sonic-gateway
Auth Compatibility Test Results: 36 passed, 0 failed     # test-auth-compatibility
Cover Gateway Test Results: 15 passed, 0 failed          # test-cover-gateway
Local Engine & Degradation Test Results: 47 passed, 0 failed   # test-local-engine-and-degradation

 ✓ tests/security.test.ts (15 tests)
 ✓ tests/recommendation-and-search.test.ts (22 tests)
 Test Files  2 passed (2)      Tests  37 passed (37)
```
- **退出状态**: `0`
- **结果**: 4 个 jiti 脚本共 158 项断言 + vitest 2 套件 37 用例全部通过。注意 test-gateway/auth/cover 依赖真实外部上游（网易/QQ 等），非纯离线套件。
- **修订备注**：本节先前版本的 `PASS gateway (60 tests)` 统一输出格式与计数（60/7/2/47=153）均与实际脚本输出（60/36/15/47=158）不符，已按真实输出重写。

### (6) 推荐系统离线评测基准
```bash
$ npm run eval:recommend
========================================================================
 CFSolara 智能音乐推荐与混合搜索引擎 —— 离线评估基准 (Offline Benchmark)
 [声明] 评估数据来自可复现合成多画像切分基准 (Synthetic Persona Split)，非生产用户日志
========================================================================

{
  "datasetType": "Synthetic Multi-Persona Holdout & Query Benchmark (Offline Reproducible)",
  "catalogSize": 58,
  "recommendationMetrics": {
    "Precision@10": 0.6333,
    "Recall@10": 0.7056,
    "NDCG@10": 0.7711,
    "CatalogCoverage": 0.7586,
    "IntraListDiversity_ILD": 0.7983,
    "Novelty_Bits": 0.1086
  },
  "searchMetrics": {
    "Top1_HitRate": 1,
    "Top5_HitRate": 1,
    "ZeroResultRate_AfterFallback": 0,
    "PlayableTrackRatio": 1
  },
  "performanceMetrics": {
    "recommendLatency_p50_ms": 12.22,
    "recommendLatency_p95_ms": 22.21,
    "searchLatency_p50_ms": 6.13,
    "searchLatency_p95_ms": 21.72,
    "processRssMemory_MB": 118.5
  }
}
```
- **退出状态**: `0`
- **结果与限制**: 全部用例跑通、零结果兜底 100%。**结果仅反映合成数据下的代码行为**：6 个手写画像 + 20 个按种子曲库量身设计的查询在 58 首小曲库、`:memory:` SQLite、单线程顺序调用下测得；`Recall@10` 分母恒为 min(K, relevant) 存在虚高、搜索 Top1 属循环验证，不可当作真实推荐效果。延迟随机器浮动（另一环境实测 P50 8.65 / P95 14.01ms）。
- **修订备注**：本节先前版本展示的 `Evaluation Results: -----` / `Benchmark Assessment: EXCELLENT` 等判定语在脚本中不存在，属虚构输出，已替换为脚本唯一真实输出（`console.log(JSON.stringify(report))` + banner）。

---

## 7. 提交与分支结构规划

变更按业务主题拆分为 7 个清晰提交：
1. `feat(engine)`: 核心同构推荐引擎、实体归一与 SQLite WAL 持久化存储
2. `feat(api)`: 行为事件采集与推荐路由网关实现
3. `feat(search)`: 智能混合多源搜索、拼写容错与相关性门控重排
4. `feat(ui)`: Vue 3 播放器音乐雷达、单曲相似电台、Auto DJ 与隐私设置
5. `chore(docker)`: VPS 容器化持久卷挂载与环境变量配置
6. `test(reco)`: 全链路端到端自动化测试与离线评测基准
7. `docs(reco)`: 架构算法选型文档与变更审查报告
