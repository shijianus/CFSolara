# CFSolara 已知问题与技术局限清单 (Known Issues & Technical Limitations)

> **文档性质**：公开代码仓库已知问题诚实披露清单  
> **更新时间**：2026-10-25（含独立审计修复后的全面订正；所有统计数字唯一来源为 `reports/raw_20_songs_summary.json`）  
> **编写原则**：客观坦诚、不隐瞒技术局限、不美化未完成项  

---

## 一、20 首抽样脚本的检索匹配口径（已修复并重新实测）

### 1. 早期缺陷与本轮修复
- **早期缺陷**：早期脚本 `scripts/test-20-sample-songs.mjs` 搜索请求仅拼接 `q = song.name` 且直接取 `tracks[0]`，导致《晴天》《稻香》命中 Lucky小爱 / 街道办GDC 翻唱。该脚本作为**历史对照基准保留原样**，不再用于产生统计数字。
- **本轮修复（2026-10-25）**：`scripts/measure-20-sample-songs-raw.mjs` 现要求**标题归一化后完全相等**且**歌手归一化后包含查询歌手（或存在相等的歌手分片）**；无匹配一律记录 `judgment: "not_found"`，**绝不回退 tracks[0]**。此前版本文档声称该脚本"已修复歌手过滤"与实际代码不符（旧代码只有歌手子串匹配 + Top1 回退），已订正。
- **旧版 `reports/raw_20_songs_probe_results.json`（含翻唱命中）已由严格口径的新一轮实测数据替换**，并由 `scripts/summarize-20-songs.mjs` 生成唯一统计表 `reports/raw_20_songs_summary.json`。

### 2. 本轮重测说明
- 数据对准生产网关 `https://sonic.epocanvas.tech`，运行时间 2026-10-25。
- 网易云《打上花火》《夜に駆ける》《Shape of You》三首在该轮出现上游超时（`fail`），与当刻网关/上游状态有关，不代表稳态能力。

---

## 二、试听判定：已由"相对字节阈值"改为"真实码率时长比"

### 1. 现行公式（自 2026-10-25 起）
旧版公式（`effBitrate = max(96, nominal × 0.55)` 字节比阈值）依赖**请求标称码率**，存在两类误判：48kbps 完整流被误判为试听；60~90 秒完整 128kbps 曲目、以及"请求无损但实际下发 320k MP3"被误判为试听。

现行判定改为**读取 MP3 帧头得到真实码率**：

$$\text{realDuration} = \frac{\text{totalBytes} \times 8}{\text{realBitrate}}，\quad \frac{\text{realDuration}}{\text{expectedDuration}} \ge 0.9 \Rightarrow \text{full}$$

- 结果附带 `confidence`：`high`（解析到帧头且有时长元数据）、`medium`（时长元数据缺失，回退 240s 基线）、`low`（非 MP3/无法解析帧头，保守回退旧字节比启发式）。
- 酷我假流拦截：保留 181,521 字节精确签名快速通道，另加"字节范围（100KB~300KB）× 派生时长 < 15s"双重规则——±1 字节变体不再漏网。

### 2. 覆盖验证与剩余局限
- 已覆盖（单元测试 `scripts/test-stream-detection.mjs`）：60~90 秒完整 128k、请求 flac 实际 320k MP3、48kbps 完整长度、30~45 秒 128k/320k 试听、时长缺失/为 0、206 无 Content-Range、假流 ±1 字节。
- **剩余局限**：FLAC/AAC 等非 MP3 容器不走帧头解析，回退字节比启发式（confidence=low），仍可能对"请求无损但上游降级"的场景产生保守误判；这是当前已知的最主要误判面。

---

## 三、20 首探针统计（唯一口径，由脚本生成）

> **下表由 `scripts/summarize-20-songs.mjs` 从 `reports/raw_20_songs_probe_results.json` 自动生成（`reports/raw_20_songs_summary.json`），请勿手改。历史文档中的"宽松口径 8 首 / 严苛口径 6 首"清单无法由现行脚本与数据复现（存在混用两次不同运行、曲目/歌手/大小互矛盾的问题），已删除。**

**2026-10-25 实测（生产网关，严格标题+歌手匹配）**：

| 音源 | 完整流 full | 试听 trial | 无严格匹配 not_found | 失败 fail |
| :--- | ---: | ---: | ---: | ---: |
| netease | 4 | 10 | 3 | 3 |
| qq | 0 | 1 | 2 | 17 |
| kugou | 0 | 0 | 1 | 19 |
| kuwo | 0 | 5 | 5 | 10 |

- 网易云 4 首完整流：《起风了》(13.04MB)、《南山南》(13.01MB)、《安和桥》(10.01MB)、《理想三旬》(8.44MB，原唱陈鸿宇——旧文档误记为谢春花 7.58MB，已订正)。
- 《晴天》《稻香》《残酷な天使のテーゼ》在网易云记为 `not_found`：严格匹配下无原唱可用结果（原版 VIP 曲目不返回可直接取流的条目，翻唱一律不再命中）。
- 本轮 **跨源升格（主源试听 → 聚合兜底交付完整流）为 0 例**；`meta.attempts` 如实记录了 free-match 尝试与失败原因。旧文档描述的"喜帖街经跨源兜底取得 >3MB 完整流"在本次审计与本次重测中均未复现，属**未确认**能力，请以 `summary.crossSourceUpgrades` 的后续实测为准。

---

## 四、酷狗等低码率完整流的音质展示问题

- **问题现象**：前端播放器界面的音质切换器（如 Standard / High / Lossless）目前仅反映了当前歌曲请求的查询参数与上游返回的标称档位。
- **技术局限**：在上游部分源（如酷狗 free-match、酷我）返回降级音频时，即便网关成功获取到了完整音频流，其实际物理码率可能被上游悄悄降至 48kbps ~ 96kbps。此时前端界面依然显示 128k 或 320k 徽标，导致用户视觉感知与实际听觉体验存在偏差。
- **已改进**：网关侧 `X-Sonic-Stream-Type` 判定现在基于真实码率（见第二节），且探测结果含 `realBitrateKbps`，前端可据此覆盖展示（尚未接入 UI，仍属待办）。

---

## 五、交付报告中仍未经实测、只属推断的内容诚实说明

1. **注入个人合法 VIP Cookie 后的取流表现**：
   - 报告中提到的"注入 VIP Cookie 后付费曲目可出 320k 完整流"系基于逆向协议标准规范的理论推断。由于本项目恪守开源合规与非商业准则，在生产和测试环境中从未集成或硬编码任何个人真实 VIP Cookie，故未在真实线上环境中进行带有个人凭据的流提取测试。
2. **极端网络丢包下的单次重试收益模型**：
   - 取流链路重试方案（`maxRetries=1, timeout=2200ms`）目前仅作为架构优化建议提出，代码中仍维持零重试以防止放大上游压力。该方案的延迟改善与成功率数据属于理论分析，尚未经过大规模线上流量验证。

---

## 六、主题 Lint 基线漂移的订正与状态

- 交接文档曾声称 `npm run lint:theme` 为 "0 violations"。2026-10-25 实测为 **5 处超基线的硬编码白色**（`player/src/App.vue:42`、`player/src/components/Dialog/AddToPlaylistDialog.vue:94/96/150/156`），经 `git blame` 确认均系 main 分支既有代码、本分支未引入；基线本身存在漂移（65 条已不存在的过期条目）。
- **处置**：按 lint 工具的既定机制重新生成 `scripts/theme-lint-baseline.json`（收录上述 5 处既有用法、清理 65 条过期条目），`lint:theme` 现为绿色；这 5 处仍属待迁移到主题令牌的技术债，已在本节如实记录。

---

## 七、安全修复带来的部署要求（2026-10-25 独立审计后）

1. **API Key 全量失效与轮换**：`sonic_live_`/`solara_live_` 密钥改为 HMAC-SHA256 签名 + 内嵌过期时间，**历史无签名密钥一律失效**。部署本分支前必须在 Cloudflare/VPS 环境变量中配置 `SONIC_SECRET`（或 `SOLARA_SECRET`），并确认 `EPOMAIL_CLIENT_SECRET` 已设置——二者缺失时登录与密钥签发会**明确报错**（fail-closed），不再有任何源码默认值。
2. **密钥只走请求头**：`?key=`/`?api_key=` 查询参数支持已移除，第三方接入方需改用 `X-Sonic-Key` 等请求头。
3. **限流信任链**：`X-Sonic-Client-IP` 仅在携带有效引擎密钥时被信任；边缘匿名分桶使用 `CF-Connecting-IP`，两者皆无落入固定兜底桶。限流计数为**每 isolate 进程内存**，非全局限流。
4. **侧车首启竞态**：`ncm-api` 容器首次启动可能因 xeapi 公钥获取竞态崩溃一次，重启即恢复；Dockerfile 已将 healthcheck start-period 放宽到 120s/5 次，避免阻塞 `depends_on: service_healthy`。

---

## 八、上线时 Pages 与 VPS 引擎版本协同部署注意事项

1. **同构契约依赖**：
   - Functions 边缘网关与 VPS 上的 `sonic-engine` 必须协同发布。若只更新 Pages 边缘代码而不更新 VPS 容器，会导致新增的 `X-Sonic-Stream-Type` 标头、跨源探测参数无法在引擎侧正确识别。
2. **部署顺序建议**：
   - 第一步：先在 VPS 上构建并重启本地引擎容器（`docker compose build engine && docker compose up -d`），确认健康端点返回 `200`；
   - 第二步：部署 Cloudflare Pages 前端与 Functions 网关（`npx wrangler pages deploy dist`）。
3. **VPS 全新目录 compose 验证**（独立项目名 + 独立端口，不影响生产容器）应由持有 VPS 访问权限的维护者执行；本次审计会话无 SSH 权限，该步骤**未执行、状态未确认**。建议命令序列：克隆 → `docker compose -p sonic-verify -f docker-compose.yml up -d --build`（以 `SONIC_BIND_PORT=18080` 等覆盖端口）→ 验证健康检查/匿名 401/一次 Range 206 → `docker compose -p sonic-verify down`。
