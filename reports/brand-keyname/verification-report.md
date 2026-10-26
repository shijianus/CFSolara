# epocanvas sonic 键名品牌化——交付验证报告（2026-10-25）

> 分支 `brand/keyname-cleanup`（基于 main `d062882`）。本次目标：在**功能链路完全不变**的前提下完成键名品牌化收尾。
> 品牌规范：总品牌 `epocanvas`，分品牌 `sonic`，完整品牌 `epocanvas sonic`。

## 一、只读审计结论（改动前状态）

1. **展示层已完全统一为 epocanvas sonic**：双端 `brand.ts` 九常量一致（`BRAND_PARENT='epocanvas'` / `BRAND_PRODUCT='sonic'` / `BRAND_FULL='epocanvas sonic'`…），player/index.html 标题与 OG 元数据、404 页、侧栏/移动端 UI、路由 document.title、`/api` 索引 `branding:{parent,product,full,wireBrand}` 均已合规。
2. **线上功能键名已全部采用 sonic 分品牌命名并被上一轮品牌化冻结**（`/api/sonic/*`、`brand:"Sonic"`、`SONIC_*`、`X-Sonic-*`、`sonic_live_`、`SonicMusicPlayerDB`、`sonic:*` 缓存、`sonic-local-engine` 容器等）。按用户决策：**冻结契约本次零改动**（改名必然破坏线上客户端与老用户数据兼容）。
3. 旧品牌（solara/cfsolara/shijianus）残留分布四类：冻结兼容 shim（活代码）、部署基础设施名、**死代码**（根目录旧静态站）、历史证据。经证实：旧静态站（根 index.html + css/ + js/）**不进构建产物**（build 仅拷贝 player/dist），functions/ 零引用。
4. 卫生盲区：`.deploy/`、`.wrangler/` 未显式忽略（实测在审计扫描范围均为 0 文件，属防御性固化）；`scripts/final_delivery_verification_results.json` 为过时证据（残留错误大小写 `EpoCanvas` 期望值）。

## 二、改动清单（git 改动面 = 计划清单，无意外文件）

| 提交 | 内容 |
| :--- | :--- |
| `edfcb01` P1 卫生加固 | `.gitignore` 显式加 `.deploy/`；brand-audit.mjs EXCLUDE_PREFIXES 加 `.deploy/`、`.wrangler/`；过时证据 JSON 归档至 `reports/archived/`（R100 纯移动，对应 `.mjs` 重跑时在 scripts/ 原位再生成，脚本不动） |
| `9647197` P2 步骤一 | 旧静态站 4 文件清理 solara 别名：index.html 删 13 处 `solara-*` 类别名、5 个 DOM id 重命名 `solara*`→`sonic*`（原无 sonic 孪生 id）、删 `__SOLARA_IS_MOBILE`；style.css 删 14 处别名选择器；js/index.js 删 `SolaraDom`/`SolaraMobileBridge` 镜像与 `solara_epomail_session` 双写/迁移（保留 `sonic_epomail_session` 单键）；js/mobile.js 回退链收敛 Sonic 单名 |
| 本次 P2 步骤二 | brand-audit.mjs 两条受保护模式收敛（`legacy-session-key` 仅 `sonic_epomail_session`；`legacy-sonic-globals` 仅 `SonicDom|SonicMobileBridge`，id 不变以保持与旧基线可比）；`test_puppeteer_init.js` 探针 `hasSolaraDom`→`hasSonicDom`（VPS 手动诊断脚本，仅 log 不断言） |

**明确未动**（功能不变承诺）：functions/、server/、player/src、docker-compose、.env.example、README/API.md 冻结契约声明、全部冻结键名（含 CORS 中 `X-Shijianus-Device-Id`——虽全仓零发送方，但移除属对外行为变化，按"功能必须不变"保留）、基础设施标识（`cfsolara` 项目名、pages.dev URL、VPS 路径）。

## 三、检查点前后对比（核心证据，明细见 evidence/）

### CP-0 改动前基线
- 契约快照：347 文件 / **909 受保护令牌** / 517 展示品牌条目
- 测试：网关 51 + 鉴权兼容 41 + 封面 15 + 本地引擎 47 = **154 全绿**；player vitest **27 全绿**
- 产物：连续两次构建 **dist 279 文件逐字节一致**（构建确定性已证明，前后对比有效）

### CP-1 契约不漂移（brand-audit --compare vs 改动前基线）
每步差异与预测**逐项吻合、零意外漂移**，终版全量差异仅 4 组且全部可解释：
| 差异组 | 内容 | 解释 |
| :--- | :--- | :--- |
| api-sonic-route | scripts→reports/archived 4↔4 | 证据归档纯移动 |
| cfsolara-project | scripts→reports/archived 18↔18 | 同上 |
| legacy-sonic-globals | js/index.js −3、js/mobile.js −3 | 死代码别名删除（同行双匹配已核对） |
| legacy-session-key | js/index.js −1 | `solara_epomail_session` 旧迁移键删除 |

令牌总数 909→902（−8 = globals −7[含 test_puppeteer_init 探针 −1] + session-key −1），逐颗核对无遗漏。post 基线自比对 PASS。

### CP-2/CP-4 功能回归（每步及终版均跑）
- 4 件套 **154/154 全绿**（含 `test-auth-compatibility.mjs` 新旧鉴权矩阵 41 案例：X-Sonic-Key/X-CFSolara-Key/solara_live_/SOLARA_SECRET 一个不差）
- player vitest **27/27 全绿**

### CP-3 产物逐字节一致（每步及终版均重建对比）
- dist/ 279 文件 SHA-256（含 .gz 双哈希）与基线**完全一致**——本次改动零线上影响的直接物证

### CP-Z 终验
- `brand-audit --verify` **PASSED**（常量/元数据/语言包/展示面完整）
- 键名矩阵前后差值（行口径，逐文件）：仅 8 项变化，全部为计划内（归档移动 18↔18、旧静态站 42→0、审计规则 6→4、探针 1→0），**其余 29 个含 solara 文件计数逐一不变**
- 驼峰 `EpoCanvas` 错误大小写：scripts/ 活动目录清零（仅剩归档证据 16 + 审计正则 1，均合法）
- git 改动面 = 预期清单（8 个修改/重命名 + reports/brand-keyname 证据）

### CP-B 浏览器黑盒验证（真实 Chrome + CDP，详见 [browser-verification-report.md](./browser-verification-report.md)）
- 三层部署对照：8788 生产 dist（与改动前逐字节一致）/ 8789 改动后旧静态站 / 8790 改动前旧静态站（git 提取）
- 旅程 A（生产播放器 A1~A9）、B（新站 B1~B6）、C（旧站 C1~C6）**全部 PASS**；B/C 唯一行为差异 = Solara 兼容全局已清理（即改动设计目标），Sonic 主链路前后完全等价
- 证据：27 张交互截图 + 5 份观察 JSON + 视觉核验 + curl 交叉复现（详见 `evidence/browser/`）

## 四、白名单残留（改后仍存在的旧品牌标识及其合法性）

| 类别 | 位置 | 保留原因 |
| :--- | :--- | :--- |
| 冻结兼容 shim | functions/_lib/auth.ts、types.ts、http.ts、route-helpers.ts、security.ts、api/index.ts、api/auth/key.ts | 线上老客户端兼容面（SOLARA_SECRET 回退、X-CFSolara-Key、solara_live_ 前缀），改动即破坏功能链路 |
| 兼容回归测试 | scripts/test-auth-compatibility.mjs（35 行） | 专门验证上述新旧鉴权矩阵，是冻结契约的守护测试 |
| 审计保护规则 | scripts/brand-audit.mjs（4 行） | solara_live_/X-CFSolara-Key/SOLARA_SECRET/cfsolara 四条受保护模式本身 |
| 部署基础设施 | package.json deploy 默认值 `cfsolara`、各 verify/audit 脚本中的 pages.dev URL 与 VPS 路径、rollback-production.sh | 真实已部署资源名与路径，改动会断部署/运维链路 |
| 个人旧品牌头 | `X-Shijianus-Device-Id`（http.ts CORS + API.md 说明） | 全仓零发送方，但移除属对外行为变化，按用户"功能必须不变"决策保留 |
| 文档兼容说明 | README.md、API.md | 冻结契约的历史陈述，与代码现状一致 |
| 历史证据归档 | reports/archived/、reports/ 各批 JSON | 只读存档，不参与任何运行链路 |

## 五、观察项（仅记录，不在本次处理）

1. **版本号三处不同步**：player 2.1.0 / 根与 /api 2.2.0 / SONIC_UA "Sonic/2.0"——非品牌项。
2. **auth.ts 验证路径未真正校验 HMAC 签名**：签发侧 keySig 计算在验证路径是死代码（任意 `sonic_live_<base64邮箱>_任意串` 可通过）。属安全问题，但修复会改变线上鉴权行为（拒绝此前被接受的密钥），与"功能不变"冲突，建议单独立项处理。
3. `.wrangler/cache/pages.json` 含 account_id，虽已 gitignore，但已存在于 git 历史——建议后续评估历史清理或账号信息轮换（运维决策）。
4. `solara.epocanvas.com` 旧域名仅在 API.md 兼容说明中被文字提及，无代码引用。

## 六、回滚方式

每步独立提交（edfcb01 → 9647197 → 本次），`git revert` 单步或整段回滚均可；改动前基线快照与全部证据落盘于 `reports/brand-keyname/evidence/` 与 `temp_brand_baseline/`（后者按仓库惯例 gitignored）。

## 七、结论

**PASS**。键名品牌化收尾完成：展示层维持 epocanvas sonic 全合规，死代码中的旧品牌键名（solara 系 42 行 + 探针 1 处）全部收敛至 sonic 主名，审计盲区消除，错误大小写残留清零；冻结契约（功能链路）经令牌级对比、测试回归、产物逐字节哈希三重检查点证明**零改动、零影响**；另经真实浏览器黑盒 GUI 三部署对照验证（[browser-verification-report.md](./browser-verification-report.md)）确认**无任何功能缺失**。
