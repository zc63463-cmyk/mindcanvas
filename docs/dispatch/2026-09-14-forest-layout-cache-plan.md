# F 批派遣计划：森林布局缓存（多中心增量布局）

- **日期**：2026-09-14
- **起点 HEAD**：`4decf73`（L 批 L3 收口附近；开工前自行复核）
- **出处**：C5 取证（`scripts/bench-islands-matrix.mjs`，commit `634ef9b`）**触发条款命中**（N≈3280 多中心 22–33ms 同时越过 1.5× 与 16ms）→ 判定"立项缓存批"；本稿即该批的计划。
- **批次代号**：F1 … F4

## §0 基线（开工前实测并报告；数字不符先报告再动手）

| 项 | 参考值（2026-09-14 复核时点） |
|---|---|
| 三包测试 | kernel **483** / react **≥1193** / canvas **195**（**L 批刚提交 L2/L3，数字会变——以你开工实测为准**） |
| 门禁 | tsc ×3 = 0；react dist 重建 = 0；depcruise 零违规（参考 427 模块 / 1203 deps）；lint **1468 + 46**（不得上升） |
| 预算 | bang **89/90**、asCast **31/31**、bigFiles **3/4**（超 600 行：`MindmapStage` / `edgeRouting` / `MapView`） |
| 冻结纪律 | 阈值/契约测试不得放宽；禁 `git add -A`；不 push；不动 `.codebuddy/` 与 `tools/graph-engine/`；`CULL_MARGIN` 不动 |

**并行纪律（重要）**：L 批（文本链接）可能仍在收尾——其文件面为 `packages/react/src/chrome/TextLinkSpans.tsx`（曾见未提交）、`edit/cutAttach.ts`、`edit/textLinks.ts`、`chrome/{DescBlock,NotePopover,NoteGrowthPanel}.tsx`。**本批与它们零重叠，一行都不要碰**；`CHANGELOG.md` 号位按开工时顶部实际号顺延。

**DoD**：① TDD 红→绿且**红证据贴原文**；② 每任务一条 commit；③ **性能类改动的第一判据是"逐位等价"**（等价之后才谈快慢）；④ 报告数字贴工具原样输出；⑤ 做完停下。

## §1 取证（file:line，写稿时逐条核过）

### 1.1 森林路径为什么不缓存（代码自认）

- `packages/react/src/demo/pipeline.ts:184-185` 注释：
  > ⚠️ 森林路径**不走 LayoutCache**：layoutLogic / layoutOrg 不支持缓存，故多中心模式每次全量重算。**先做对，性能待实测后再优化。**
- `packages/react/src/demo/pipeline.ts:197-200`：`useForest ? layoutForest(centers, measure, collapsedIds)` —— **不传 cache**。
- `packages/kernel/src/layout/forest.ts:74-79`：`layoutForest(..., opts: { gap?: number })` —— opts 里**没有 cache**。
- `packages/kernel/src/layout/forest.ts:87-95`：每岛 → `layoutMindmapBranched(spec.node, measure, collapsedIds, { islandDir, fallback: LAYOUT_BY_DIR[spec.dir], dirSink })` —— **无 cache**。
- `packages/kernel/src/layout/islands.ts:18`（注释）：「不渲染 boundaryLinks（由渲染层画），也**不接管 LayoutCache（森林路径不走缓存）**」；`:285` → `layoutForest(centers, measure, collapsedIds, { gap })`。
- `packages/kernel/src/layout/layouts.ts:262-266`：分支入口的 opts 有 `cache` / `measureKey`，但注释写明「**透传 layoutMindmap 回退路径；分支路径为全量，忽略缓存命中**」。

### 1.2 单树路径的缓存契约与增量原语（F3 的样板）

- `LayoutCache`（`packages/kernel/src/layout/mindmap.ts:65-89`）：`heights`（EditableNode→子树高）/ `nodes`（EditableNode→LayoutNode）/ `stamps`（LayoutNode→放置参数）/ `collects` / `bounds`。
- 有效性（`:112-121`）：`cache.collapsedKey === collapsedIds`（**身份比较**）且 `cache.measureKey === opts.measureKey`，否则 `reset()` + 全量。
- 增量原语（照抄对象）：
  - `:148-172` **节点复用**：`cache.nodes` 命中条件 = `side` / `depth` / `parentId` 三项相同 → 复用同一 `LayoutNode` 实例（含 children 数组）。
  - `:208-214` + `:278-290` **放置戳**：`placeSubtreeIncremental(ln, side, top, xEdge, cache)` —— 放置参数与上次一致 → 整棵跳过；不一致 → 递归重放并**使该子树 collects/bounds 失效**。
  - `:231-249` `collectCached` / `:251-272` `boundsOf`：收集与包围盒的子树级复用。

### 1.3 性能事实（本批的"为什么"）

- C5 矩阵（`634ef9b`）：N≈3280 多中心 = **21.7–33.3ms**（单树无缓存 4.5–6.1ms）→ 三格命中双阈值；N≤1093 绝对值 <16ms（无感）。
- 独立实验（复核时实测，单树 N=3280，编辑一个深层叶子、度量键稳定）：

  | 场景 | 耗时 |
  |---|---|
  | 无缓存 · 全量 | 8.18 ms |
  | 有缓存 · 无改动 | 0.085 ms |
  | **有缓存 · 编辑深层叶子** | **0.28 ms** |
  | 无缓存 · 同一编辑 | 7.57 ms |

  → **同一次编辑 27×**。**推论**：① 只做"岛级缓存"省的是未编辑岛的份额（编辑落在根岛时收益有限）；② **27× 那一档要靠"岛内分支缓存"**（F3）→ 故任务分 F2/F3 两档。

### 1.4 为什么"岛根身份"是可靠的代次键

投影**复用未变节点壳**（`islands.ts:17`："投影只新建副本（可复用未变节点壳，children 变更才浅拷贝）"）+ 不可变编辑只重建**到编辑点为止的祖先链** ⇒ 编辑岛 I 内任一节点 → **I 的岛根对象身份改变**、其它岛岛根身份不变。故岛级缓存键 = `岛根身份 + dir + measureKey + collapsedKey 身份`，正确且 O(1)。

### 1.5 等价性方法论先例（仓库已有）

G-P3 的"两条路径结果**逐位等价**"（`freeedge-equivalence.test.ts`）。本批沿用：**缓存开 == 缓存关**，`nodes / links / bounds` 全字段逐位一致。

### 1.6 七个坑

1. **③ 平移是原地累加 —— 缓存复用会让几何逐次漂移（本批最关键）**：`forest.ts:138-141` 直接 `n.box.x += dx` 改写**局部结果里的 LayoutNode 盒**。今天每次调用都新建 `res` 所以无害；**一旦缓存复用 `res`，第二次平移会基于已平移的盒再加 dx**。→ F2 必须改成**非破坏式**（局部结果保持"未平移"形态，合并时产出平移副本；或给平移加 stamp 守卫，比照 `placeSubtreeIncremental`）。**判别测试 = 幂等性**：同一文档连续 3 次 `layoutForest`（缓存开）→ 输出逐位相同。
2. **折叠/度量变化必须整体失效**：沿用 `mindmap.ts:112-121` 契约（`collapsedKey`/`measureKey` **身份**比较 → 不匹配即 `reset()`）；**不许**用内容深比较替代。
3. **不许新建第二套缓存对象**：复用宿主既有 `layoutCacheRef.current`（`MindmapStage.tsx:865` 已传给 `layoutDemo`）——两套失效纪律必然漂移。
4. **`dirSink` 也是岛级产物**：它由岛内布局回填、③ 重建连线要用（`forest.ts:89/99/143`）——缓存 `res` 时必须**连 `dirSink` 一起缓存**，否则连线线型漂移。
5. **等价性判据必须覆盖"编辑序列"**：单次快照等价不足以证明（坑 1 只在连续调用下暴露）→ F1/F3 都要有"连续 N 次编辑 + 每步逐位对比"。
6. **Canvas/导出等下游不受影响**：森林结果被 `layoutDemo` 出口消费，本批不得改 `DemoLayout` 的公开形状（加法字段也要慎重）。
7. **报告数字贴工具原样输出**；tmp 日志定向清理（批量删 `tmp-*.log` 会被沙箱安全删除守则拦截——**不要重试整批**）。

## §2 任务

### F1 · 缓存通道打通 + 逐位等价基线（不改行为）

- `layoutForest` / `layoutIslands` 的 opts 增 `cache?: LayoutCache` / `measureKey?: string`（kernel **加法**），由 `layoutDemo` 透传；每岛调用 `layoutMindmapBranched({ ..., cache, measureKey })`（**此时分支路径仍忽略 cache**——只让通道就位）。
- **判别测试（先红）**：① 通道存在（传 cache 后 kernel 侧确实收到 —— spy 或等价断言）；② **逐位等价**：同一森林文档"传 cache vs 不传" → `nodes/links/bounds` 逐位相同（k∈{1,3,8} × N∈{364,1093,3280} 复用 C5 夹具）。
- **阴性对照**：故意把透传的 `measureKey` 写错 → 等价测试必须红（证明判据有效）。
- commit：`feat(kernel,react): 森林布局缓存通道（layoutDemo→layoutForest→岛内，逐位等价基线）`

### F2 · 岛级缓存（未编辑岛不重算）

- `layoutForest` 内按岛缓存 `{ res, dirSink, root }`，键 = `岛根身份 + dir + measureKey + collapsedKey 身份`（§1.4）；**同时按坑 1 改成非破坏式平移**。
- **判别测试**：① 编辑岛 I 的一个叶子 → **其它岛的 `res` 对象身份复用**（引用相等）+ 全树 `nodes/links/bounds` 与"无缓存"逐位一致；② I 岛重算（引用变）；③ **幂等性**（坑 1：连续 3 次 layout，缓存开，输出逐位相同）；④ 折叠变化 / measureKey 变化 → 全部重算且逐位等价。
- **阴性对照**：岛键漏掉"岛根身份"（只留 dir）→ 编辑后用例必红。
- commit：`perf(kernel): 岛级布局缓存（未编辑岛零重算；非破坏式平移；幂等性钉死）`

### F3 · 岛内分支缓存（27× 那一档；带停止条款）

- 让"岛内布局"复用 `LayoutCache` 增量原语（照 §1.2 样板）：范围 = `layoutMindmapBranched` 的分支路径 + `LAYOUT_BY_DIR` 四向经典布局（`pipeline.ts:184` 点名"layoutLogic / layoutOrg 不支持缓存"）。
- **判别测试**：① **编辑序列逐位等价**（连续 20 次编辑，每步缓存开/关对比）；② 编辑深层叶子 → 该岛未受影响分支的 `LayoutNode` **引用复用**；③ 性能对照（F4 脚本）。
- **停止条款（硬）**：若四向经典布局的构造方式与 `cache.nodes` 的"`side`/`depth`/`parentId` 命中"语义冲突（例如节点被重排/重建而无法安全复用），**停止 F3、保留 F1+F2 的收益**，把冲突点写进报告并降级为另立批——**不许为"做完"而放宽等价性判据**。
- commit：`perf(kernel): 岛内分支布局接 LayoutCache（编辑局部化；编辑序列逐位等价）` 或（触发停止条款时）`docs: F3 停止报告（冲突点与降级方案）`

### F4 · 基准正式化 + 收口

- 新 `scripts/bench-layout-cache.mjs`：① C5 矩阵复测（森林 vs 单树）；② **编辑型对照**（§1.3 的四行场景：N=3280 编辑深层叶子 × 缓存开/关 × 森林/单树）→ 产出**改前/改后数字对照表**。
- `CHANGELOG.md`（顺延号位）+ 报告 `outputs/2026-09-14-forest-layout-cache-report.md`；**然后停下**。
- commit：`perf+docs: 森林布局缓存收口（基准脚本入库 + 前后对照 + CHANGELOG）`

## §3 决策点（按推荐执行）

| # | 决策点 | 推荐 |
|---|---|---|
| **F-A1** | 粒度顺序 | **先岛级（F2）后岛内（F3）**；F3 带停止条款 |
| **F-A2** | 失效键 | `measureKey` + `collapsedKey`（身份）+ 岛根身份 + `dir`；**不许**内容深比较 |
| **F-A3** | 缓存对象归属 | 复用宿主 `layoutCacheRef.current`（不新建第二套） |
| **F-A4** | 等价判据 | **逐位**（`nodes/links/bounds` 全字段）+ **编辑序列**，不是单次快照 |
| **F-A5** | 投影是否缓存 | **不做**（`buildIslandView` ≈0.54ms，非瓶颈） |
| **F-A6** | 真浏览器验证 | 可选：多中心 3000 级文档编辑"无掉帧"体感（**不要用 >50K，会降级 Canvas 绕开本路径**）；性能主判据 = F4 基准数字 |
| **F-A7** | 目标线 | 编辑类操作（§1.3 场景）从 22–33ms 降到 **<16ms**（岛级）→ 争取 **<5ms**（岛内） |

## §4 风险

1. **静默陈旧几何**（本族：`stableByKeys` 跨文档误复用 / `selEdge` 跨边复用 同族）→ 等价性 + 编辑序列 + 阴性对照三件套兜住；**它是本批唯一能伤到用户的失效模式**。
2. **坑 1 的原地平移**：不在 F2 里改非破坏式就必然漂移（幂等性测试会红）。
3. **F3 规模不确定**：四向经典布局改造可能超预期 → 停止条款已写，**降级不是失败**。
4. **测试时长**：编辑序列 × 多规模 × 逐位比较可能变慢 → 规模矩阵用 C5 的小档（364/1093）跑序列，3280 只跑单步。
5. **与 L 批并行的 CHANGELOG 冲突** → 顺延号位即可。

## §5 交付与报告格式

- 逐任务：commit hash + 改动文件 + 分包测试数（实测）+ 新增用例数 + **红证据原文**。
- F1/F2/F3：**等价性证据**（逐位比较的断言原文或 diff 为空）+ 阴性对照原文；F2 附**幂等性**证据。
- F4：基准**前后对照表**（工具原样输出）+ 目标线（F-A7）达成判定。
- 门禁与预算实测；F3 若触发停止条款 → 单列冲突点与降级方案；然后停。

## §6 明确不做（本批）

跨会话/持久化缓存；WebWorker 并行布局；Canvas 侧布局；`buildIslandView` 投影缓存；折叠"局部化"（折叠仍按契约整体 reset——那是另一条独立的题）；`members`/`collapsed` 协议字段。
