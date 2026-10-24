# UI Batch 1 — 主题令牌绕过修复报告

- 分支：`fix/ui-batch-1`
- 基线与回滚标签：`before-batch-1`（annotated，指向 `4cea613`）
- 提交：
  - `2b86a2c` fix(UI-001): 性能模式保留主题底色避免浅色主题黑底黑字
  - `9393264` fix(UI-002): 播放器歌词增加固定深色衬底与高对比度前景令牌
  - `eb652a4` fix(UI-003): 下载列表改用主题文字与玻璃语义令牌
  - `1d6116e` fix(UI-004): GlassSelect 触发器与箭头改用主题文字令牌
  - `2795fab` fix(UI-048): 热搜热度值提升对比度与最小字号
  - `f5b61a3` chore(theme): 新增硬编码白色扫描与基线校验
  - `0c14748` fix(UI-057): 移动首页歌单名提升到 11px 并保持主题文字色
- 说明：上述提交在本轮开始时已经存在于当前分支；本轮完成了逐项复核、补充验证、截图复测与报告整理，没有重复提交。工作区另有大量与本批无关的未提交品牌色改动，未提交、未回滚。

## 问题与结果

| 问题编号 | 修改文件 | 修复方式 | 验证结果 |
|---|---|---|---|
| UI-001 | `player/src/style/glass.css` | 性能模式不再写死 `rgba(18,18,22,.96)`；改写为 `var(--glass-bg-solid)`，并清除背景图与阴影；同时覆盖 `.glass-container-strong`、`.glass-nav`、`.section-container`。 | 通过 |
| UI-002 | `player/src/components/PlayerDrawer.vue`、`player/src/components/Mobile/PlayerDrawerMobile.vue`、`player/src/style/glass.css`、`player/src/utils/lyricsWordSync.ts` | 歌词容器增加固定深色衬底 `--glass-lyrics-scrim`；已唱/未唱改用 `--glass-lyrics-active` / `--glass-lyrics-inactive`；移除 `#ffffff` / `rgba(255,255,255,.38)` 及模板中的 `text-primary/40`。 | 通过 |
| UI-003 | `player/src/pages/downloads.vue`、`player/src/pages/mobile/downloads.vue` | 标题、副标题、表头、歌曲行、搜索、筛选、排序与操作按钮改用 `text-primary*`、`border-glass`、`bg-button-glass` 等令牌；固定深色删除确认框内的白色保留。 | 通过 |
| UI-004 | `player/src/components/Ui/GlassSelect.vue` | 触发器、当前值与箭头改为 `text-primary` / `text-primary/70`。 | 通过 |
| UI-057 | `player/src/pages/mobile/index.vue` | `.playlist-name` 补到 11px 并保持 `var(--glass-text-primary)`。`.section-title` 与 `.playlist-name` 在基线代码中已经使用主题变量，审计中的“浅色主题下为白色”在当前代码中未复现；实际缺口是字号不足 11px。 | 通过（行号已漂移/部分已预先修复） |
| UI-048 | `player/src/pages/search.vue` | 热度值由 `text-primary/15` + 10px 改为 `text-primary/70` + 11px。 | 通过 |

## 对比度与计算样式

- 性能模式浅色卡片：`background-color: rgb(244,248,255)`，`background-image: none`，`box-shadow: none`；标题对比度 **16.84:1**。
- 性能模式深色卡片：`background-color: rgb(7,16,31)`；标题对比度 **17.50:1**。
- `text-primary/70`（浅色/深色）：约 **5.39:1 / 7.89:1**。
- 歌词最差情况（纯白封面 + 72% 深色衬底）：已唱 **7.66:1**、未唱 **4.68:1**，满足要求的 ≥4.5 / ≥3。
- 移动首页歌单名：11px，`rgba(9,23,44,.92)` + 0.8 opacity，浅色背景约 **7.38:1**；深色主题使用对应浅色令牌。
- 热搜热度值：11px，浅色/深色约 **5.39:1 / 7.89:1**。

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 主题扫描 | `npm run lint:theme` | 通过，514 个既有命中由 baseline 覆盖 |
| 扫描器自测 | 临时新增 `text-white` 探针后运行 `npm run lint:theme` | 按预期失败并定位到探针；移除后恢复通过 |
| 类型检查 | `cd player && pnpm exec vue-tsc --noEmit` | 未通过：69 个既有错误。将本批 9 个代码文件还原到 `before-batch-1` 后仍为完全相同的 69 个错误，未新增类型错误 |
| Lint | `cd player && pnpm lint` | 无法验证：ESLint 9 找不到 `eslint.config.*`；旧 `.eslintrc.cjs` 还引用了未安装插件，属仓库既有配置问题 |
| 构建 | `npm run build` | 通过（exit 0，Vite built in 17.41s） |
| 视觉 | 无头 Chrome + 本地静态服务 + 模拟 API/IndexedDB | 30 张截图，覆盖 1440×900、820×700、844×390、390×844 与深/浅主题 |

## 截图

- 浅色验收拼图：[acceptance-light.png](./acceptance-light.png)
- 深色验收拼图：[acceptance-dark.png](./acceptance-dark.png)
- 四视口原图：[screenshots](./screenshots)
- 计算样式与对比度原始数据：[measurements.json](./measurements.json)
- 硬编码白色完整清单与分类：[white-inventory.md](./white-inventory.md)

## 待确认清单

1. **ESLint 9 配置迁移**：当前 lint 脚本不可用，需要新增 `eslint.config.*` 或补齐旧配置插件；本批未改，以免扩大范围。
2. **性能模式的启动恢复**：`sonic-perf-mode` 会被设置页读取，但刷新后没有在应用启动时重新把 `.perf-mode` 加到 `<html>`；本轮截图在测试环境中直接加类验证样式。是否纳入后续 UI 批次待确认。
3. **13 处同源硬编码白色**：扫描发现但不在本批目标内，未修改，明细见 `white-inventory.md` 的 B 类：`SongList` 行操作、登录框占位文字、底栏时间、搜索历史 hover、ShadowBling 预览文字。
4. **820px 下载表格列拥挤**：既有布局问题（专辑名与音质标签在窄桌面宽度下相互挤压），不是本批颜色改动引入；未处理。
5. 工作区存在未提交的品牌色改动（101 个状态项），本批提交不包含这些改动。

> 视觉矩阵中 844×390 及 820×700 的下载列表受高度/宽度限制只能看到部分行；可用 1440×900 与 390×844 原图核对完整列表。
