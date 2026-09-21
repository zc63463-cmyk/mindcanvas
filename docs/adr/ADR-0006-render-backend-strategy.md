# ADR-0006 · 渲染后端策略（SVG 为主，Canvas 为实验性降级）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-01 |
| 决策人 | 蒋指导、WorkBuddy（工程执笔） |
| 状态 | 已接受（SVG 为默认与唯一可信后端；Canvas 维持实验性，不对外承诺） |
| 上游 | ADR-0001（库优先）· ADR-0005（依赖方向守护）· 2026-09-01 架构深度分析报告 |

## 背景

渲染层存在**两套同构后端**，但成熟度差异巨大：

- `SvgBackend`（`packages/react/src/render/backend.tsx:115-166`）：`render()` → `sceneToSvg`（`:169`），生产可用；
- `CanvasBackend`（`canvasBackend.tsx:161-223`）：`render()` → `<CanvasSurface>`，`drawScene` 在 `:45-99`。

`CanvasBackend` 源码自述（`canvasBackend.tsx:6-9`）明确列出**四项未补齐的边界**：

1. 未接入主渲染循环；
2. 文本 `family` 取默认值（不随主题/节点样式变化）；
3. `image` 图元绘制直接跳过；
4. `tracePath`（`:114-120`）只处理 `M` 指令（复杂路径指令未支持）。

触发条件：`forceBackend='canvas'` 或节点数 `> CANVAS_AUTO_NODES(50000)`（`sceneBuilder.ts:14`、`MapView.tsx:369`）。

问题在于：**外部无法从接口层面判断 Canvas 后端当前是否可信**。若不写清边界，容易被误当作等价能力对外承诺。

## 决策

**1. SVG 是默认后端，也是当前唯一可信后端。**

所有对外承诺的能力（导出 SVG/PNG、节点卡片样式、连线几何、文本排版、图元渲染）以 **SVG 后端**为基准。PNG 导出复用 SVG 路径（`chrome/exportSvg.ts` / `exportPng.ts`），不经过 Canvas 后端。

**2. Canvas 定位为「实验性 / 大图降级路径」，在边界补齐前不对外承诺。**

允许继续保留与演进，但需满足：

- 代码内保留 `canvasBackend.tsx:6-9` 的自述边界注释，任何一项被补齐时**同步更新该注释**；
- 不写入 README / 文档的能力清单；
- 不在默认路径启用（仅 `forceBackend` 显式指定或超 5 万节点自动降级时生效）。

**3. 双后端必须保持「同一份 ScenePrimitive，两种绘制实现」的同构契约。**

- `ScenePrimitive` 判别联合（`backend.tsx:13-51`）：`group | rect | path | text | image`
- `RenderBackend` 契约（`backend.tsx:98-112`）：`nodeCard / text / link / image / group / render`

新增图元类型时，**必须同时实现两个后端**，或在未实现的后端显式标注跳过（如当前 `image`），不允许静默丢失。

**4. LOD 与视口裁剪优先于切换后端。**

性能问题优先用现有四层机制解决（LayoutCache 增量 + `cull.ts` 视口裁剪 + LOD + FrameScheduler 单帧合批），**不把「切 Canvas」当作性能手段**。只有上述手段在 5 万节点以上确实不足时，才启用 Canvas 降级。

## 理由

1. **诚实边界优于虚假等价**——Canvas 后端自述的四项缺口是客观事实，写进 ADR 比让人踩坑更负责。
2. **SVG 与导出链路同源**——导出 SVG/PNG 复用同一 `ScenePrimitive`，保证「所见即所得」；若改用 Canvas 渲染，导出链路需重写且无法保证一致。
3. **同构契约防止后端漂移**——强制同时实现，避免 SVG 演进后 Canvas 静默落后。
4. **性能问题不靠换后端解决**——现有四层机制已覆盖绝大多数场景，换后端引入的复杂度与风险远高于收益。

## 边界补齐的验收标准（Canvas 转正式的门槛）

Canvas 后端要升级为「可信后端」，须同时满足：

- [ ] 接入主渲染循环（与 SVG 后端同等调度）
- [ ] 文本 `family` 跟随主题/节点样式
- [ ] `image` 图元可绘制
- [ ] `tracePath` 支持完整路径指令（M/L/C/Q/A/Z 等）
- [ ] 与 SVG 后端输出做像素级/结构级对比验证
- [ ] 导出链路（PNG）可基于 Canvas 后端并保证一致性

满足后另开 ADR 修订本决策。

## 不做什么（明确排除）

- ❌ 不删除 Canvas 后端（保留演进空间，但标注实验性）
- ❌ 不在默认路径启用 Canvas
- ❌ 不把 Canvas 写进对外能力清单
- ❌ 不为 Canvas 单独建测试矩阵（当前只验证 SVG 后端）

## 影响

- 新增文件：`docs/adr/ADR-0006-render-backend-strategy.md`
- 无需改代码（本 ADR 是对既有事实的确认与约束，**不改变当前行为**）
- 后续新增图元类型时，须遵守「双后端同构」契约（决策 3）
