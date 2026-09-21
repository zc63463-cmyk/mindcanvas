# 自由边路由重算治理 · 派遣计划（2026-09-12）

> **执行状态：待启动**（外派执行稿；§1 全部事实为 2026-09-12 在 `5936e05` 上只读取证，带 file:line）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 **pan/zoom 不再逐帧重算全部自由边路由**，并把「每边重算成本」从 O(全量节点) 降下来——这是批次 B 复测后唯一还留在台面上的每帧成本（`perf-baseline.md §7` 已记录为「本批记录但未修」）。

**Architecture:** 三层治理，**逐层独立可合并、逐层可回退**：
- **G-P1 内容键 identity 稳定化**（零语义变化）：`visibleFreeEdges` 内容不变时复用上一次数组引用 → 击穿 `FreeEdgeLayer` 路由 memo 的元凶消失。
- **G-P2 量化裁剪窗口**（语义超集，独立一档）：裁剪矩形量化到 256 世界单位网格 → 成员变化频率从「每帧可能变」降到「每 256px 至多一次」。
- **G-P3 每边成本**：(a) 折叠祖先解析预计算（等价性可证）；(b) 障碍集粗筛（**条件子任务**，先侦察 `edgeRouting.ts` 的搜索范围常量，能给保守界才做）——复用批次 B 的 kernel 网格索引。
- **G-P6（条件项）**：仅当 G-P5 复测未达标时才做路由缓存 / 全量路由 + 渲染期裁剪。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19 / Playwright（真浏览器）/ kernel `spatialIndex`（B-P1 产物）

---

## 0. 基线与交付闸门（本轮起点实测）

| 项 | 2026-09-12 实测（`5936e05`） |
|---|---|
| 测试 | kernel **478** + react **981** + canvas **120** = **1579 全绿** |
| 债务预算 | 全部持平、零余量：any 0 / tsIgnore 0 / **bang 90=90** / **asCast 31=31** / console 4=4 / todo 1=1 / defaultExport 2=2；**bigFiles 3/4** |
| 超 600 行 | `MindmapStage.tsx` 2212 / `edgeRouting.ts` 1152 / `MapView.tsx` 2067 —— **新逻辑不许再堆进 MapView**（放 `render/` 新模块，且新文件 <600） |
| 工作树 | 干净（仅 `tools/graph-engine/` 未跟踪，勿动）；未 push |
| 上游记录 | `perf-baseline.md §7`：`visibleFreeEdges` 每帧重算（O(E×N)）「属自由边避障批次」；P4 复测显示 25 节点 demo 规模下不可观测（pan 帧间隔 17ms）——**风险在规模** |

**每任务 DoD**：三包 `tsc --noEmit` 绿 + `tsc -p packages/react/tsconfig.build.json` 重建 dist（react 改动必须）+ `depcruise` 0 + `biome lint` 绿 + `node scripts/check-code-budget.mjs` 持平 + 相关分包测试绿 + **一条 commit**。

> 环境备忘（上一批踩过，直接用）：
> - `pnpm` 可能不在 PATH → gate 逐项直跑：tsc 用 `node node_modules\.pnpm\typescript@5.9.3\node_modules\typescript\bin\tsc …`；depcruise 用 `npx --no-install depcruise packages apps --config .dependency-cruiser.js`；lint 用 `node_modules\.pnpm\@biomejs+cli-win32-x64@2.5.11\node_modules\@biomejs\cli-win32-x64\biome.exe lint packages apps`；budget 用 `node scripts/check-code-budget.mjs`
> - 套件分包单跑（**别用 `pnpm -r test`**）：`cd packages/react; node ../../node_modules/.pnpm/vitest@4.1.11_jsdom@30.0.1_vite@8.2.2/node_modules/vitest/vitest.mjs run [文件…]`（canvas ~15s / kernel ~11s / react ~2-3min）
> - PowerShell 输出偶被吞 / `Get-Content` 无编码会被守则拦 → 统一「重定向到 tmp-*.log + 用文件读取工具看」；tmp 日志不提交、收尾删除

---

## 1. 实现前必读（只读取证 · 依赖链已闭合）

### 1.1 重算是怎么发生的（元凶链）

1. `MapView.tsx:925-940`：`visibleFreeEdges` 的 deps = `[freeEdges, derived, view.x, view.y, view.w, view.h]` —— **取 view 原始数值是刻意的**（`:924` 注释：view 对象每次新建），但 pan 时这些数值**每帧都变** → **每帧产出新数组**（即使成员完全没变）。
2. `FreeEdgeLayer.tsx:139-175`：`routes` useMemo 的 deps = `[edges, boxOf, root, collapsed, obstacles, fastRouting]` —— `edges` 即上面的新数组 → **每帧整表重算**。逐边成本见 1.2。
3. **两处注释与实现不符**（本计划 G-P4 要修）：
   - `FreeEdgeLayer.tsx:136-138`：「pan/zoom 不触发——路由在世界坐标系，且 boxOf 与 obstacles 已在 MapView 侧稳定化」——后半句**成立**（`edgeBoxOf` = `MapView.tsx:740-747` `useCallback([derived, animBoxes])` ✓；`edgeObstacles` = `:709-712` `useMemo([layout, lod, animating])` ✓；`collapsed` = `collapsedIds ?? EMPTY_COLLAPSED` ✓ B-P2 已稳），**但它自己的第一个 dep `edges` 不稳 → 结论不成立**。
   - `MapView.tsx:737-739`：「非动画期间 identity 不变 → pan/zoom 不触发重算」——同一处失真。
4. 量级参照（仓内既有记载，`MapView.tsx:921-923`）：「若不 memo … 导致**全部边重算路由（100 条边 ≈ 0.5s）**」→ 60fps pan 下若逐帧重算，100 边场景是灾难级；25 节点 demo（1-2 条边）不可见——**这正是它长期没被发现的原因**。

### 1.2 逐边成本（重算一次要付什么）

5. `freeEdgeEndpoints`（`freeEdges.ts:323-397`）：对源、靶**各调一次** `collapsedAncestors`（`edit/reveal.ts:8-…`，从 root DFS 的 O(N) 祖先查找；调用点 `freeEdges.ts:341` 与经 `route()` 的 `:367`）。
6. `FreeEdgeLayer.tsx:155-157`：**每条边**都 `obstacles.filter(...).map(...)` —— O(障碍数) 的两次全量遍历 + 新数组分配。
7. `routeAesthetic`（`FreeEdgeLayer.tsx:162`）：曲率自适应贝塞尔（`edgeRouting.ts` 内注释自述成本 O(E×锚点×曲率×采样×障碍)）。
8. `applyLineJumps`（`FreeEdgeLayer.tsx:174`）：每次重算最后跑一次 O(E²×P²) 跳线（仅 `fastRouting`（动画期）跳过）→ **修好 1.1 后它也随之从「每帧」降到「每 256px」**，本批**不单独优化**（Q1 观察项）。

### 1.3 现状守卫与可复用件

9. **现有守卫不覆盖 pan**：`free-edges.test.tsx:1196-1225` 只守「layout/entities 引用稳定时重渲染不重复触发回调」（identity 稳定场景），**pan 场景零守卫**。
10. kernel 网格索引已就绪（B-P1 产物）：`packages/kernel/src/layout/spatialIndex.ts` —— `buildBoxIndex` / `queryBoxIndex`（契约：**超集 + 下标升序 + 无重复**；查询按 1 格膨胀）。障碍集粗筛若做（G-P3b）复用它；阈值沿用 `INDEX_MIN_NODES = 1000`（`MapView.tsx:274`）。
11. 真浏览器脚本先例：`tools/verify-delete-subring.mjs`（playwright-core 绝对路径引法 + `addInitScript` 记账 + 截图落 `verify-shots/`（已 gitignore））；`tools/bench-interaction.mjs`（B-P0 产物，pan 机制探针）。
12. 测试夹具先例：`free-edges.test.tsx:937-996`（`FreeEdgeLayer` 独立渲染 + `samplePathOf` 采样验「不穿中间节点」）；`mapview-pan-memo.test.tsx:57-64`（真实指针路径驱动 pan：`pointerDown/Move/Up` 于空白起点，`flushFrames` 等 rAF）。

---

## 2. 任务

### G-P0：度量基线（**必做先行**，先红后修）

**Files:**
- Create: `packages/react/tests/freeedge-pan-reroute.test.tsx`（机制指标·判别用例）
- Create: `scripts/bench-freeedge.mjs`（规模指标；若直引 dist 失败则退化为 `packages/react/tests/freeedge-bench.test.ts`，见 Step 3）
- Modify: `docs/preview/perf-baseline.md`（新增 §8「自由边路由治理」基线表）

**机制指标（判别用例设计）**：
- `vi.mock('../src/render/edgeRouting.js', …)` 保留 `...actual`，仅把 `routeAesthetic` 包一层计数；或对 `freeEdges.js` 的 `freeEdgeEndpoints` 计数（二选一，推荐前者：直接对应「重算一次整表」）。
- 场景：一棵 5-7 节点树 + 2 条自由边（注意：**LOD 必须为 full 才会走避障路由**，即节点数 < LOD 阈值、k 正常）；渲染 `<MapView>`，`flushFrames` 稳定后清零计数。
- 驱动：按 `mapview-pan-memo.test.tsx:57-64` 的手法做 **2 次小步纯平移**（40px 级，保证可见集成员不变——25 节点 demo 的 margin 足够）。
- 断言（先红）：平移**生效**（投影 `transform` 变化）且 `routeAesthetic` 调用次数 **= 0**；现状预期 = 每次平移 × 每条可见边 ≥ 2 次（贴红证据）。

**规模指标**：`scripts/bench-freeedge.mjs` 直引 `packages/react/dist/render/{freeEdges,edgeRouting}.js`（纯几何模块；**先 `tsc -p packages/react/tsconfig.build.json`**），输出 E ∈ {1, 10, 50, 100} × 障碍 ∈ {1K, 10K} 的 `routeTotalMs`（median of 5）。表头含 `obstacles,E,routeTotalMs,perEdgeMs`，为 G-P3 预留 `routeIndexMs` 列。

- [ ] **Step 1: 写判别用例 → 跑红**（贴「平移生效 + 重算次数 > 0」两段证据）
- [ ] **Step 2: 写规模脚本 → 跑基线**（若 dist 直引被模块图牵入 React/DOM 而失败 → 按退化方案改 vitest 计时用例并在 §8 标注口径）
- [ ] **Step 3: 落档 §8**（含「G-P1 前」列；表内注明 25 节点 demo 不可观测、风险在规模，与 §7 口径一致）
- [ ] **Step 4: 提交** `test(react,tools): 自由边路由重算机制判别 + 规模基线（pan 期逐帧重算先红）`

### G-P1：内容键 identity 稳定化（零语义变化）

**Files:**
- Create: `packages/react/src/render/stableArray.ts`（小工具，<60 行：`stableByKeys<T>(prev, next, keyOf): readonly T[]` —— 长度与逐项 key 相同 → 返回 `prev` 引用）
- Modify: `packages/react/src/render/MapView.tsx`（`visibleFreeEdges` 的 memo 出口套 `stableByKeys`，用 `edge.key`；**不新增 MapView 逻辑体量**，只接线）
- Test: `packages/react/tests/stable-array.test.ts`（纯函数单测：同键不同对象 → 复用 prev；键序列变化 → 返回 next；空数组路径）

**Interfaces:**
```ts
/** 内容键相同的两个数组 → 返回前一个引用（React memo 友好）；否则返回 next */
export function stableByKeys<T>(prev: readonly T[] | null, next: readonly T[], keyOf: (t: T) => string): readonly T[];
```
- 关键：比较用「长度 + 逐项 key」，**不做内容深比较**（成本 O(E)，可忽略）。
- ⚠️ 语义守护：只有**成员完全一致**才复用引用；成员变了一定换引用（否则会渲染陈旧边）。

- [ ] **Step 1: 写 `stable-array` 单测 → 红 → 实现 → 绿**
- [ ] **Step 2: MapView 接线 + G-P0 判别用例转绿**（成员不变的小步平移 → 重算 0 次）
- [ ] **Step 3: 回归**：`free-edges.test.tsx`（含 `:1196` 死循环守卫）、`mapview-nodebox`、`mapview-pan-memo`、`mapview-section-drag` 全绿；`perf.test.ts` 不劣化
- [ ] **Step 4: 量规模**：跑 G-P0 脚本（此时为「成员不变」理想态基线；成员变化态留给 G-P2 量化后）
- [ ] **Step 5: 提交** `perf(react): 自由边可见集按内容键稳定 identity——pan 期不再逐帧重算路由`

### G-P2：量化裁剪窗口（语义超集，**独立一档可回退**）

**Files:**
- Modify: `packages/react/src/render/MapView.tsx`（`visibleFreeEdges` 内用于裁剪的 view 矩形改为量化值）
- Modify: `../../` 无（`CULL_MARGIN` **不许动**）
- Test: 扩展 G-P0 判别用例（长距离平移：重算次数 ≤ ⌈Δ/256⌉+2）
- Create: `tools/verify-freeedge-pan.mjs`（真浏览器：pan 前后截图 + 采样所有 `path[d]` 非空/无 `NaN`；产物落 `verify-shots/`）

**Interfaces:** 新增模块常量 `const CULL_QUANT = 256;`（世界单位，与 `CULL_MARGIN` 同量级）+ 纯函数 `quantizeRect(rect, q)`（在 `stableArray.ts` 同文件或 `render/viewportQuant.ts`，可单测）。

- [ ] **Step 1: 纯函数单测**（量化：向内/向外取整方向明确；rect 尺寸取量化后的**外扩超集**；q ≤ 0 防护）
- [ ] **Step 2: 接线 + 判别用例扩展**（先红：现状长距平移重算 ≈ 步数×E；后绿：≤ ⌈Δ/256⌉+2）
- [ ] **Step 3: 记录副作用**：可见边数 E 变化（量化后超集，§8 记「E 基线 → 量化后」）；`applyLineJumps` 输入集变大 → **视觉必须真浏览器验**
- [ ] **Step 4: 真浏览器视觉检查**：跑 `tools/verify-freeedge-pan.mjs`；人工比对截图（边不丢、不抖、不穿越中间节点——复用 `samplePathOf` 思路在截图页采样 d）
- [ ] **Step 5: 提交** `perf(react): 自由边裁剪窗口量化到 256——pan 期重算频率从每帧降到每 256px（可独立回退）`

### G-P3：每边成本下降（a 必做；b 条件）

**Files:**
- Modify: `packages/react/src/render/freeEdges.ts`（`freeEdgeEndpoints` 新增**可选** `resolve?: (id: string) => { id: string; box: Box } | null`；缺省走原 `collapsedAncestors` 路径——**零破坏**）
- Modify: `packages/react/src/render/FreeEdgeLayer.tsx`（构造一次 `resolve`（`useMemo([root, collapsed, boxOf])`）并对所有边复用；obstacles 的 `filter+map` 改为**预构建 boxes 数组 + 端点下标集合**排除，避免每条边 O(N) 重建）
- （G-P3b 条件项）Modify: `FreeEdgeLayer.tsx`（obstacles 粗筛用 `queryBoxIndex`——**仅在 Step 5 侦察通过后**）
- Test: `packages/react/tests/freeedge-equivalence.test.ts`（等价性守护，见下）

**等价性测试（本任务的头号验收）**：
- `freeEdgeEndpoints`：随机树（含折叠子树）× 随机折叠集 × 随机边（含 ghost/自关联/零盒）→ 新旧两路径返回 **逐字段相等**（含 `renderable`）。
- `routeAesthetic`：随机场景（10-40 障碍，含端点自身、贴边盒、重叠盒）→ **`RouteResult` 逐位相等**（`d` 字符串、`mid/nx/ny` 全等）。**顺序敏感**：障碍输入顺序不得变（B-P1 索引契约②保证升序，但仍要断言全等）。

**G-P3b 侦察门槛（不给证明就不做）**：`routeAesthetic` 的绕行搜索范围若能用「端点包围盒外扩 R」保守界定（需要读 `edgeRouting.ts` 的采样/曲率常量并给出推导），才引入索引粗筛；否则**只做 (a) 与「预构建数组」优化**，把 b 记为结论（§8 一行）。

- [ ] **Step 1: 等价性测试先写（对现状，必绿）→ 再改实现 → 仍绿**（这是「先立标准再动刀」的顺序，反了就等于没测）
- [ ] **Step 2: (a) resolve 预计算接线** + 规模脚本跑 `perfEdgeMs` 对照
- [ ] **Step 3: 预构建 obstacles**（分配优化）+ 全套件绿
- [ ] **Step 4: (b) 侦察**：读 `edgeRouting.ts` 给保守界 → 给不出就在 §8 写结论、跳过 Step 5
- [ ] **Step 5:（条件）索引粗筛** + 等价性测试仍绿 + 规模对照
- [ ] **Step 6: 提交**（(a)+(预构建) 一条；b 单独一条）

### G-P4：注释对齐（两处失真正文）

- [ ] 改 `FreeEdgeLayer.tsx:136-138` 与 `MapView.tsx:737-739`：把「pan/zoom 不触发」改成事实表述（「`edges` 身份由内容键稳定（G-P1）+ 裁剪窗口量化（G-P2）→ pan 期重算频率 ≈ 每 256px 一次」），并指向本计划。
- [ ] 提交 `docs(react): 自由边路由注释与实现对齐（pan 期重算的真实条件）`

### G-P5：复测与决策（**是否做 G-P6**）

- [ ] 跑 G-P0 的判别用例与规模脚本，§8 补四列对照（基线 / G-P1 / G-P2 / G-P3）。
- [ ] **决策 G-A4（默认规则，不必等确认）**：若「E=100 × 障碍 10K」单次全量重算 **> 16ms** 且 pan 每 256px 仍触发 → 做 G-P6；否则写「经实测不需要」并跳到 G-P7。
- [ ] 提交 `docs: 自由边路由治理复测（基线/G-P1/G-P2/G-P3 对照）`

### G-P6（条件项）：路由结果缓存 / 全量路由 + 渲染期裁剪

> 只在 G-P5 判定未达标时执行；本任务视觉风险最高，必须带开关与回滚。
- 方案 A：`routes` 上方加 LRU 缓存，key = `edge.key + 端点盒 + collapsed 版本 + 动画帧序号`。
- 方案 B：路由输入改为**全量自由边**（引用稳定）+ 渲染期按可见 id 过滤。
  ⚠️ 方案 B 改变 `routeAesthetic` 的跨边协调输入集 → 视觉可能变化，需截图验证。
- 开关：`const FREEEDGE_ROUTE_CACHE = false`（默认关），两态均有测试。
- 提交 `perf(react): 自由边路由结果缓存（开关默认关，达标后开启）`

### G-P7：收口

- [ ] `pnpm gate` 等价全套（tsc ×3 + 三包套件 + depcruise + lint + budget），贴实测（起点：478/981/120；bigFiles 3/4）。
- [ ] `docs/preview/perf-baseline.md §8` 终稿（含 G-P6 做/不做的结论与依据）；CHANGELOG 追加一行（版本段按仓库当前版本递增）。
- [ ] 提交 `docs: 自由边路由治理收口`

---

## 3. 决策点汇总（默认按推荐执行，不必等确认）

| # | 决策点 | 推荐 |
|---|---|---|
| G-A1 | G-P1 形态 | 独立小工具 `stableByKeys`（可单测）+ MapView 仅接线（**别把逻辑堆进 2067 行的 MapView**） |
| G-A2 | 量化尺寸 | `CULL_QUANT = 256`（与 CULL_MARGIN 同量级）；**不动 CULL_MARGIN** |
| G-A3 | G-P2 合并方式 | **独立一条 commit**（语义超集变更，可单独回退） |
| G-A4 | G-P6 是否做 | 由 G-P5 实测决定（默认不做） |
| G-A5 | G-P0 规模脚本位置 | 先试 `scripts/bench-freeedge.mjs`（直引 dist）；失败则 vitest 计时用例（`scripts/`、`tools/`、tests 均不计入预算） |

**风险与明确不做**
1. **视觉回归是头号风险**：G-P2（超集）会改变跨边协调/跳线输入集 → 必须真浏览器截图 + 采样验证；G-P3 用逐位等价测试钉死。
2. 不得放宽任何既有阈值/契约测试（`perf.test.ts`、`free-edges.test.tsx:1196`、`mapview-*` 契约、B 批全部机制守卫）。
3. 新文件一律 <600 行；`MapView.tsx` / `edgeRouting.ts` 已超 600 是既定事实，**别让它们继续膨胀**（G-P1 只接线、G-P3 的 resolve 构造放 FreeEdgeLayer 内部）。
4. 不做：换路由算法/评分、改 `CULL_MARGIN`、动 `applyLineJumps` 的 O(E²P²) 本身、Canvas/WebGL、任何缓存（除非 G-P5 判定）。
5. 报告纪律：命令 + 实测数字 + 结论；**数字贴工具原样输出**（上一批有过转写错位）。每任务 TDD 红→绿，红证据必贴。
