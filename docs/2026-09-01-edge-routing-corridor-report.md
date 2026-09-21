# 连线路由：净空罚分（侧边优先）+ 源码损坏修复 + trunk/A* 清理

日期：2026-09-01
范围：`packages/react/src/render/edgeRouting.ts`、`apps/canvas/vite.config.ts`、诊断脚本

---

## 一、完成情况总览

| 项 | 状态 | 说明 |
|---|---|---|
| A. 净空罚分（侧边优先，根本修复） | ✅ 完成并验证 | 中心带占比 19.5% → 0.0% |
| B. routingSide UI（一键选侧） | ✅ 此前已完成 | `RoutingSideToggle` + 写回链路 |
| 源码文件损坏修复 | ✅ 完成 | 3722 行 → 1638 行，结构完整 |
| 类型检查 | ✅ 全绿 | react + app 双包 `tsc --noEmit` 均无错 |
| 测试 | ✅ 90/90 | edge-routing 43/43、free-edges 47/47 |
| 陈旧 dist 隐患 | ✅ 已消除 | vite alias 指向源码 |
| #5 清理 trunk/A\* | ✅ 完成 | 1638 → 707 行；测试 43 → 16（不变量已迁移） |
| #6 调参验收（HITL） | ⏸ 待你目视 | 权重/阈值已量化，见第四节 |

---

## 二、事故与修复：`edgeRouting.ts` 被写入思考过程

一次编辑操作误把推理文字写进了源码，文件从约 1900 行膨胀到 **3722 行**，真正的评分代码被覆盖丢失，文件无法编译。

**难点**：仓库 `git log` 为空（无任何提交），无法用 git 回滚。

**修复方式**：写脚本按行切片重建 ——

```
保留 1..1423  →  保留 1431..1511  →  插入重写后的评分块  →  保留 3702..3722
```

重建后 1638 行，`tsc` 通过。

**顺带暴露的两个隐藏 Bug**（都是原先就存在、只是被损坏掩盖的）：

1. **`AestheticWeights.corridor` 字段被吞进注释** —— 第 745 行的 `/**` 缺少配对的 `*/`，导致紧随其后的 `corridor?: number` 变成注释内容，报 TS2353/TS2339。补上 `*/` 即修复。
2. **`preferStraight` 参数声明了却没有实现** —— 其逻辑原本就位于被覆盖的区域中。已重建为快路径（见下）。

---

## 三、核心功能：净空罚分（A 项）

### 问题

评分函数原先只有两项：

- `crossing` —— 与已路由边相交；
- `inward` —— 朝障碍质心方向鼓（内凸）。

两者都抓不到「**不碰任何卡片、却从节点群中间的缝隙挤过去**」的形态：这条线交叉数为 0，也不朝质心鼓，于是评分认为它很好 —— 这正是你截图里「又走中心了」的样子。

### 解法：从「是否相交」升级到「离得多远」

第一版做的是「走廊穿越占比」（沿弦的窄带内采样点占比），能解决缝隙很窄的情况，但**缝隙一宽就失效** —— 占比照样很低，评分仍然认为穿过去的线没问题。

改用路径规划里的标准做法：**净空成本（clearance）**。直接量每个采样点离最近卡片有多远，低于目标净空就罚分。这样「绕到节点群外侧」天然优于「从缝里穿过」，且与节点间距同尺度。

```ts
clearTarget = max(80, 平均节点高 × 3)          // 目标净空，可调
tightRatio  = 采样点中「离最近卡片 < clearTarget」的占比
score = 12·crossings + 8·inward + 14·tightRatio + 2.5·|c| + 0.5·(chord / straightLen)
```

### 「贴缝」判定：直线通畅 ≠ 该走直线

`preferStraight` 快路径原来只判「直线会不会撞上卡片」。但**从节点缝里穿过也是一种"走中心"**，必须交给评分权衡。改为：直线离任一卡片不足 `clearTarget` 时，不走快路径。

（中间踩过一次坑：曾用「走廊集非空 = 附近有节点」来判定，导致直线本已通畅的边也被硬撑出大弧，见第五节。）

### 验证（诊断场景：左右两端点 + 中间障碍簇，簇中留 188px 缝隙）

| | 路径 | 曲率 | mid.y | 中心带占比 |
|---|---|---|---|---|
| 旧（clearance=0） | 直穿缝隙 | c = 0 | 313 | **19.5%** |
| 新（clearance=14） | 绕到整簇上方 | c = −1.0 | −3.8 | **0.0%** |

---

## 四、顺带修掉的两个正确性问题

### 1. 大弧「看似绕开、实则穿障」

曲率大时曲线会鼓到两端点包围盒之外，粗筛看不到外侧的障碍，于是产出穿过远处卡片的大弧。

改为两级检查：粗筛快速否决 + **全量障碍复核**。80 例随机性质测试中穿障数从 7 降到通过阈值（≤4）。

### 2. `preferStraight` 快路径重建

直线离所有卡片都足够远（≥ `clearTarget`）时直接直连，不做无谓弯曲。两处不启用：

- `forceSide` 已指定 —— 用户明确要求绕行方向，直线不满足；
- 直线贴着某些卡片走（不足 `clearTarget`）—— 交给净空罚分权衡"直穿"还是"绕外侧"。

---

## 五、重大排查陷阱：`@mindcanvas/react` 解析到陈旧构建产物

`@mindcanvas/react` 按 `package.json` 的 `exports` 解析到 `packages/react/dist/index.js` —— **所有 `apps/canvas/scripts/diag-*.mjs` 一直在测旧代码**，只有 vitest（走 `src`）的结果可信。这次排查被它坑掉了约 20 次工具调用：诊断脚本反复显示「罚分没生效」，而源码其实是对的。

已做两处修正：

1. **`apps/canvas/vite.config.ts` 加 alias** —— 开发与构建统一指向 `packages/{kernel,react}/src/index.ts`，HMR 实时生效，彻底不再依赖手动 `npm run build`。

   > 注：未使用 `node:url`（本仓库没有装 `@types/node`），改用
   > `new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')`
   > 去掉 Windows 下 pathname 的前导斜杠。

2. **诊断脚本全部改为直接 import 源码相对路径** `../../packages/react/src/render/edgeRouting.ts`。

另：`RouteObstacle` 是扁平的 `{x, y, w, h}`（`extends Box`），不是 `{id, box}` —— 写诊断脚本时极易写错，一旦写错所有障碍被静默忽略（命中 0）。

---

## 六、性能（`diag-aesthetic-bench.mjs`，含跨边交叉协调）

| 节点数 | 边数 | 均摊 |
|---|---|---|
| 50 | 30 | 6.40 ms/边 |
| 100 | 60 | 5.38 ms/边 |
| 200 | 100 | 7.48 ms/边 |
| 400 | 150 | 9.01 ms/边 |
| 800 | 200 | 7.18 ms/边 |

`FreeEdgeLayer` 的路由结果已 `useMemo`（依赖 `[edges, boxOf, root, collapsed, obstacles]`），不是每帧重算；配合视口裁剪与 LOD，实际每帧只处理可见边。若 100+ 条边同屏仍觉得卡，下一步可上障碍空间索引（网格），把全量复核从 O(samples × N) 降到 O(samples × k)。

---

## 六之二、Issue #5：清理 trunk/A\*（已完成）

`routeAesthetic` 上线后，旧的「网格 A\* + trunk 折线」路由器在 `src` 中已零引用，
但连同其专属工具函数仍有约 930 行留在模块里。本次整体移除。

**删除的东西**（`edgeRouting.ts` **1638 → 707 行**）

| 类别 | 符号 |
|---|---|
| 旧路由器主体 | `routeEdge` / `routeWithGrid` / `fallbackPath` |
| 网格与 A\* | `RoutingGrid` / `buildGrid` / `MinHeap` / `octile` / `SideBias` / `astar` / `MAX_GRID_CELLS` |
| 折线简化与平滑 | `dropCollinear` / `stringPull` / `toSmoothPath` / `toRoundedPath` / `anchorTowardPath` |
| 仅服务于旧链路的几何工具 | `trySimpleDetour` / `obstaclesNear` / `borderPointOf` / `polylineLength` / `polylineMidNormal` / `pointInRect` |
| 常量与类型 | `RouteOptions` / `DEFAULT_GRID_RATIO` / `DEFAULT_NODE_PADDING` / `DEFAULT_TURN_PENALTY` / `DEFAULT_CORNER_RADIUS` / `DEFAULT_MAX_WIDEN` |

**保留**：`routeAesthetic` 及其真实依赖（`corridorObstacles`、`segmentIntersectsRect`、`polylineHitsObstacle`、`sampleCubic`、`edgeAnchorCandidates`、`bezierFromAnchors`、`segmentsCross`、`findCrossings`、`segIntersectPoint`、`pathWithJumps`、`AestheticWeights`、`EdgeCrossing`、`DEFAULT_CURVATURE_STEPS`、`DEFAULT_BLOCK_PADDING`、`DEFAULT_CORRIDOR_MARGIN`）。

**同时清理**：4 个引用旧路由器的一次性诊断脚本
（`diag-anchor-side` / `diag-detour-compare` / `diag-route-bench` / `diag-visual`）。

**测试：不是删掉，而是把不变量迁移过去**（`edge-routing.test.ts` 705 → 301 行，43 → 16 用例）

旧用例里真正有价值的是两项不变量，已迁到 `routeAesthetic` 上继续守护：

- **不穿障性质测试**：80 例 → **200 例**（阈值同步放宽到 ≤10，仍是 5%）
- **性能护栏**：改为 routeAesthetic 版（200 节点 / 100 边，阈值 2500ms）

其余保留：`segmentIntersectsRect` 5 例、`corridorObstacles` 1 例、`routeAesthetic` 10 例。

**验证**：react 全量 **429 tests / 63 files 全绿**。451 → 424 的差值 **27 恰好等于删除的旧用例数**，
说明没有误伤其它用例；随后新增 5 条回归守卫 → 429。react + app 双包 `tsc` 0 错，`dist` 已重建。

**新增的 5 条回归守卫**（`tests/edge-routing.test.ts`），把本轮修复的缺陷锁死：

| 守卫 | 守住什么 |
|---|---|
| 净空罚分把「从缝里穿过」的连线推到外侧 | Bug #5（布尔量抓不到擦边而过） |
| clearance 是活旋钮（调权重会改变结果） | 死旋钮现象 |
| bend 是净空项的有效制衡（调大 bend → 弧不更夸张） | Bug #2（bend 与净空项差一个数量级） |
| 弧高不超过弦长（60 例随机） | Bug #6（曲率无上限） |
| 直线离卡片足够远才走快路径 | Bug #1（贴缝判定） |

**补齐 Issue #1 / #4 漏掉的验收用例**（+6，共 27 条）：

- **Line jumps 此前零测试覆盖**（Issue #4 验收标准明确要求，旧文件里根本没有，非本次删漏）：
  交点计算、上下关系随绘制次序稳定、平行不相交、`pathWithJumps` 无跳线点退化折线 /
  有跳线点插入拱形弧 / 跳线点远离路径时忽略。
- **退化输入不产出 NaN**（零尺寸盒、盒子重合、1×1 微盒、零尺寸盒同点 chord=0）。

### 关于守卫强度的说明（诚实版）

我对新守卫做了变异测试，结果分两类，如实记录：

- **已验证**：弧高守卫、净空守卫、贴缝守卫都锚定在实测差异上（修复前后数值确实变了）。
- **属"安全网"而非变异验证**：退化输入守卫。我试过移除 `chord` 与 `len` 两处除零保护，
  测试依然通过 —— 因为**退化输入被 `preferStraight` 快路径挡住了，根本走不到贝塞尔计算**。
  这其实是好消息（多一层保护），但该守卫拦不住这两个具体改动，只能兜住未来其它路径的 NaN。
- 顺带修正：早停那条守卫**守不住** Bug #3。变异测试显示早停是在整个曲率档循环结束后才检查
  `best`，无法在档位间架空评分；Bug #3 的真实危害是"锁定第一个锚点对"，不是"架空评分"。

> 两个操作上的坑：① 仓库无 git 提交，删除前先 `cp` 备份（后来确实靠备份恢复了被误删的
> `EdgeCrossing` 区段注释）；② 删除区间端点必须打印首末行内容核对 —— 按估算写会多削一行。

---

## 六之三、调参对照页暴露的 6 个真 Bug

为做 #6 调参验收，先生成了一张「同一张导图 × 4 组参数」的对照页
（`docs/preview/routing-tuning.html`）。**结果四组参数输出完全一样** ——
这个"旋钮全死"的现象反而暴露出 5 个此前没发现的真 Bug，加上弧高失控共 6 个：

| # | 问题 | 现象 | 修法 |
|---|---|---|---|
| 1 | 「附近有节点」被当成「路被挡」 | 直线本已通畅的边也被硬撑大弧 | 拆成走廊集（粗筛）与贴缝集（判定），贴缝 = 净空不足 `clearTarget` |
| 2 | `bend` 与净空项差一个数量级 | 曲率成本 0.8 分，净空收益 5~13 分 → 曲率拉满 | `bend` 0.4 → **2.5**，与净空项同量级 |
| 3 | 早停判据用净空占比，导致**永远锁定第一个锚点对** | 只要首个锚点对的最佳候选净空达标就收工，其它 143 个锚点对根本不看 | 改用 `\|c\| ≤ 0.45` 上界：命中的是"就近那条平缓弧"，否则继续找其它锚点对 |
| 4 | 质心掺入远离路径的旁支节点 | "往哪边绕"判断反向：绕开真障碍的一侧反被罚分 | 质心只取贴着路径的障碍 |
| 5 | 「走廊占比」抓不到宽缝隙 | 缝隙一宽占比照样低，评分认为穿过去的线没问题 | 换成**净空成本**：直接量离最近卡片多远 |
| 6 | 曲率档位到 ±2.0 无上限 | 弧高 150% 弦长，"甩出去绕一大圈"而非连线 | 加几何硬约束：弧高 ≤ 弦长，即 `\|c\| ≤ 1.33` |

**修复前后对照**（同一张 8 条关系线的导图）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 最大弧高 / 弦长 | 150% | **75%** |
| 穿障边数 | 0 | 0 |
| 与树线交叉 | 7 | 6 |
| 四组参数是否有区别 | **完全没有** | A/B/C 明显分开 |
| 路由耗时（800 节点） | 7.18 ms/边 | **5.59 ms/边** |

> 性能反而变好：弧高上限砍掉了 ±1.5 / ±2.0 两档极端曲率，候选项更少、早停更早命中。

### 关于「旋钮全死」的真实机理（修正）

第一版归因写的是「早停架空了评分」。**变异测试证明这个说法不准确**：早停判据是在整个曲率档
循环结束后才检查 `best` 的，此时 `best` 已是该锚点对内评分最优者 —— 早停无法在档位之间架空评分。

真实机理是**可行性与早停的双重挤压**：

1. 在挤压严重的图里，每个锚点对往往只有**唯一**一个可行曲率（其余全撞障碍）→ 评分无从选择；
2. 旧早停又因为净空占比达标而**停在第一个锚点对**，其余 143 个锚点对提供的可能性根本没被看到。

两者叠加 => 权重无法影响结果。这解释了为什么它是**场景相关**的：开阔布局里可选方案多，
权重本来就分得开（对照页上 A / B / C 的差别正是来自那些有选择余地的边）。

### 一个诚实的边界

对照页里 B（clearance=14）和 D（clearance=24）结果仍然相同。查下来是**场景本身的性质**：
那几条边的 0.70 已是不撞障碍的最大可行曲率，约束来自可行性而非权重 —— 再加大惩罚也没用。
在更开阔的布局里两者才会分开。这说明"把权重调大"并非万能，遇到挤压严重的图仍需要 `forceSide` 手动定向。

---

## 六之四、运行时测试抓到的既有性能 Bug（顺带修掉）

给 Opp 的 3 层回调补**运行时**测试（不只是类型与纯单测）时，一条「重渲染不应触发回调」的用例红了：
重渲染 5 次 → 回调触发 5 次。追下去是 `FreeEdgeLayer` 路由 `useMemo` 的**依赖每次渲染都变**：

| 元凶 | 问题 |
|---|---|
| `collapsed={collapsedIds ?? new Set()}` | 未提供 `collapsedIds` 时，每次渲染造一个新 Set |
| `visibleFreeEdges` 未 memo | `.filter()` 每次产出新数组 |

**这个 Bug 在我加回调之前就存在**，只是没暴露：

1. **性能**：任何 MapView 重渲染（hover / 选中 / 面板开关）都会把**全部边重算路由** ——
   100 条边约 0.5s。（源码注释原本声称「pan/zoom 不触发重算」，与实际不符）
2. **死循环**：新加的 `onRoutesChange` 会形成「回调 → setState → 重渲染 → 新依赖 → 再回调」无限循环。

### 修复（两层）

- **上游治本**：`EMPTY_COLLAPSED` 空集单例；`visibleFreeEdges` 用 `useMemo` 包住，
  依赖取 `view.x / view.y / view.w / view.h` 原始值（`view = viewport.worldRect()` 每次新建对象，不能作依赖）
- **下游防御**：MindmapStage **只存选中边的 `d`（字符串）而非整个 routes Map** ——
  存 Map 是引用、路由一重算就变，无法判断内容是否真变；存 `d` 可**值比较**短路，
  内容不变就不 setState，从源头掐断自我触发。上游将来若被改坏，这一层仍能防住。

### 教训

- **跨层「渲染结果回调」这类管线必须补运行时重渲染测试** —— 类型检查和纯单测都测不出依赖引用不稳定。
  本次正是这条用例同时暴露了既有性能 Bug 与新引入的死循环风险。
- **`?? new Set()` / `?? []` 兜底写进 JSX props 是隐患**：每次渲染新对象，会让下游所有 `useMemo` 失效。
  应用模块级常量。
- **`useMemo` 依赖不要放「每次新建的对象」**，应拆成原始数值字段。

---

## 六之五、10K 门禁抖动：根因不是「阈值太紧」，是测量坏了

`acceptance-10k.test.tsx` 的 `incMs < layoutMs * 0.5` 偶发抖动（pass→fail→pass）。
调查后发现问题比"阈值余量不足"严重得多 —— **这个测试从来没测到增量**。

### 根因

循环里每次都新建 `createNodeMeasure(char, new Map())` 与 `new Set()`。
二者都是 `LayoutCache` 的键组成部分，**每轮换新引用 → 缓存 100% 不命中**。

实测对照（诊断脚本 `diag-10k-layout-perf.mjs`）：

| collapsed 处理 | 增量中位 |
|---|---|
| 每次 `new Set()` | **25.1ms**（≈全量，缓存未命中） |
| 引用稳定 | **0.1ms**（命中） |

**相差 250 倍。** 于是 `incMs` 测的一直是"全量布局"，却拿去和**冷启动全量**比：
比例约 39%、阈值 50%，余量只剩 **1.05x** —— 单次测量噪声就能翻盘。

顺带纠正一处过时注释：原文称"实测 ~18% 全量"，实测（未命中时）是 ~105%。

### 修复

把 `measure` / `collapsed` 提到循环外复用同一引用；阈值从 50% **收紧**到 5%
（实测 0.14%，余量约 35x）。

> 注意这里是**收紧**而非放宽。若当初只把 50% 放宽到 70%，抖动会缓解，
> 但这条门禁将永远测不到真东西 —— 缓存彻底退化也照样通过。

修复后 `incEditMs`：27ms → **0.06~0.15ms**，连跑 5 次全过。

### 方法论

1. **先量化再动手**：写诊断脚本把冷/热、命中/未命中的差异测出来，不凭猜测调阈值。
2. **找权威参照**：对照 kernel T6（`layout-incremental.test.ts`，比率 **1.2%**）确认"增量本应很快"，
   才意识到问题出在 acceptance 侧的调用方式，而不是布局实现。

### 教训

- **缓存键的组成部分必须是稳定引用。** 循环内 `new Set()` / 新建 measure 传入带 cache 的函数，
  会让缓存完全不命中 —— 症状是"性能差"而非"报错"，极难察觉。
- **抖动的性能门禁，先查测量方法再动阈值。**
- **`?? new Set()` / 循环内新建对象对下游 `useMemo` 与 cache 是同一类隐患**（与六之四同源）。

### 顺带：同类隐患全仓排查（结论：关键路径已干净）

同一模式在本项目已出现三次，故做了一次系统性扫描：

| 检查项 | 结果 |
|---|---|
| `React.memo` 组件 | **项目完全没有使用** —— 风险集中在依赖数组与带 cache 的函数调用 |
| `?? new Set()/new Map()/[]/{}` | 剩余 12 处**全是本地变量**（`const cur = x ?? {}` 等），安全 |
| `useMemo`/`useCallback`/`useEffect` 依赖数组含内联创建 | **0 处** |
| 带 cache 的 `layoutMindmap` 调用 | 生产路径引用稳定；kernel 测试均复用稳定引用 |
| `visibleNodes` 未 memo | 有影响但小（每次渲染多一次 filter，10K 节点约 0.1~0.5ms，远低于路由重算），
  且下游非 memo 组件、内部也无 useMemo，不会放大 —— 暂不改动 |

排查工具保留为 `apps/canvas/scripts/diag-10k-layout-perf.mjs`。

---

## 七、待办

1. **#6 调参验收（需要你目视）** —— 打开 `docs/preview/routing-tuning.html` 切 Tab 即可对比。当前值：
   `clearance 14 / bend 2.5 / crossing 12 / inward 8 / length 0.5`、`clearTarget = max(80, 平均高 × 3)`、弧高上限 `|c| ≤ 1.33`。

   两个主要旋钮：`clearance` 调大 → 更坚持绕外侧（弧更大）；`clearTarget` 调大 → 要求更宽的"个人空间"。
   另有 B 项的 `routingSide`（↰ / ↱）可手动定向，挤压严重的图上比调权重更有效。
2. ~~**#5 清理 trunk/A\***~~ —— **已完成**，见上节。
3. ~~**10K 验收门禁偶发抖动**~~ —— **已修复**，见下节。
4. **Issues 落盘** —— `git remote` 为空，`docs/dispatch/2026-09-01-edge-routing-peripheral-issues.md` 已落本地。

---

## 八、验证命令

```bash
cd packages/react && npx tsc --noEmit -p tsconfig.json          # 类型检查
cd packages/react && npx vitest run tests/edge-routing.test.ts  # 33 passed
cd packages/react && npx vitest run --maxWorkers=1               # 443 passed / 63 files
cd packages/react && npx vitest run tests/free-edges.test.tsx   # 47 passed
cd apps/canvas && npx vite-node scripts/diag-corridor.mjs       # 净空罚分 A/B
cd apps/canvas && npx vite-node scripts/gen-routing-tuning.mjs  # 生成调参对照页
cd apps/canvas && npx vite-node scripts/diag-aesthetic-bench.mjs# 性能基准
```

**开发服务器**：http://localhost:5201/（走源码，改动即时生效）
