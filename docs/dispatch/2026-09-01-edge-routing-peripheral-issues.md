# 连线路由重设计 — Issues 拆解

> 日期：2026-09-01
> 父方案：`docs/research/2026-09-01-edge-routing-peripheral-redesign.md`
> 状态：**待 publish 到远端**（`git remote` 当前为空，I1 记录远端未建）
> 远端建好后按依赖顺序用 `gh issue create` 补录，并回填真实 issue 编号

| # | 切片 | 类型 | Blocked by |
|---|---|---|---|
| 1 | 曲率自适应路由核心（纯函数） | AFK | None |
| 2 | FreeEdgeLayer 接入 + 跨边交叉协调 | AFK | #1 |
| 3 | 手动覆盖（用户调整即停用自动优化） | AFK | #2 |
| 4 | Line jumps 跳线（交叉可读） | AFK | #2 |
| 5 | 移除 trunk / A\* 折线路径 | AFK | #2 |
| 6 | 参数调优与视觉验收 | **HITL** | #3, #4 |

---

## Issue 1 — 曲率自适应路由核心（纯函数）

**Type**: AFK · **Blocked by**: None — can start immediately

### What to build

在 `packages/react/src/render/edgeRouting.ts` 新增 `routeAesthetic()`：
对「锚点对 × 曲率档位」的组合空间做枚举与美学评分，输出**单条三次贝塞尔曲线**，
替代当前以最短路径为目标的 trunk / A\*。

端到端行为：给定源盒、靶盒与障碍集，返回一条不穿节点（或按 7.1 直穿降级）、
优先向外鼓、尽量少交叉的平滑曲线，并给出标签锚点（中点 + 法向）。

### Acceptance criteria

- [ ] `edgeAnchorCandidates(box, n)`：沿四边均匀取锚点（每边 3 个采样，共 12 个），返回世界坐标
- [ ] 曲率档位 `c ∈ {-1.0, -0.7, -0.45, -0.25, 0, 0.25, 0.45, 0.7, 1.0}`，负值 / 正值分别朝法向两侧鼓
- [ ] `scorePath()` 实现评分：
  - [ ] 穿节点 → 淘汰（不参与评分）
  - [ ] 曲线朝布局中心凸 → 罚分（鼓励外绕）
  - [ ] 与已有边相交 → 罚分
  - [ ] 曲率绝对值大 → 轻罚
  - [ ] 路径长 → 轻罚（末位）
- [ ] 组合枚举按锚点距离排序 + 早停剪枝，控制帧预算
- [ ] **直穿降级**：全部组合均穿障时，返回满足 SBGN「crossing boundary only twice」的直线解，不得返回"乱绕"路径
- [ ] 单测：不穿障 / 外绕优先 / 左右对称 / 直穿降级生效 / 边界（零尺寸盒、重合端点）

---

## Issue 2 — FreeEdgeLayer 接入 + 跨边交叉协调

**Type**: AFK · **Blocked by**: #1

### What to build

`FreeEdgeLayer` 从 trunk/A\* 切到 `routeAesthetic()`，并把**已路由的边**传给后续边以供交叉罚分，
使多条关系线彼此错开、不重叠。

### Acceptance criteria

- [ ] `FreeEdgeLayer` 调用 `routeAesthetic()`，保留现有 LOD 门控与缓存
- [ ] 按边序渐进协调：先路由的边作为后续边的「已有边」参与交叉罚分
- [ ] 路由缓存 key 加入「边集版本」，避免因跨边协调导致结果陈旧
- [ ] 集成测试：同一画布多条关系线互不重叠、各自不穿节点
- [ ] 性能护栏：2000 节点 / 300 边全量路由在既有预算内（回归脚本 `diag-route-bench.mjs`）

---

## Issue 3 — 手动覆盖（用户调整即停用自动优化）

**Type**: AFK · **Blocked by**: #2

### What to build

遵循 XMind / MindManager / Miro 一致的交互契约：用户手动调整某条连线后，
该线的自动优化**立即停用**，需显式操作才恢复。状态需持久化。

### Acceptance criteria

- [ ] 边数据新增「人工锁定」字段（透传键，符合 spec 未知键透传纪律），重载后保持
- [ ] 提供端点拖拽 / bend 控制点（曲线曲率）交互
- [ ] 一旦手动改动 → 自动路由不再覆盖该边
- [ ] 提供「恢复自动优化」入口（对应 MindManager 的 Auto-Adjust 重新勾选）
- [ ] 单测：锁定状态持久化与恢复；集成测试：手动调整后不被自动优化覆盖

---

## Issue 4 — Line jumps 跳线（交叉可读）

**Type**: AFK · **Blocked by**: #2

### What to build

交叉无法避免时，让交叉**可读**而不是强行消除：在被跨越的线上绘制小弧（跳线），
明确哪条在上、哪条在下。Miro 的 line jumps 仅支持 straight / orthogonal，曲线需自绘。

### Acceptance criteria

- [ ] 交叉检测：找出所有边-边交点及上/下关系（按绘制顺序或稳定次序）
- [ ] 渲染跳线弧：在**下方**那条线上，于交点处绘制跨越小弧
- [ ] 支持曲线线型（自绘弧，不依赖正交线型）
- [ ] 保留折线退路：若自绘弧在曲线上效果不佳，可退化为折线段 + 跳线
- [ ] 单测：交叉点计算正确性、上下关系稳定；集成测试：交叉处视觉可辨

---

## Issue 5 — 移除 trunk / A\* 折线路径

**Type**: AFK · **Blocked by**: #2（可与 #3 / #4 并行）

### What to build

新路由上线后，清理已不再作为主路径的折线绕行实现，减少包体积与维护负担。

### Acceptance criteria

- [ ] 删除 `astar` / `buildGrid` / `MinHeap` / `SideBias` / `corridorObstacles` / `trySimpleDetour` / `routeWithGrid`
- [ ] 删除对应单测；全部既有测试仍绿（react 406 + kernel 306）
- [ ] 清理不再使用的常量（`DEFAULT_GRID_RATIO` / `DEFAULT_CORRIDOR_MARGIN` / `DEFAULT_TURN_PENALTY` / `MAX_GRID_CELLS` / `DIRS`）
- [ ] 包体积下降，构建无死代码残留

---

## Issue 6 — 参数调优与视觉验收

**Type**: **HITL**（需蒋指导目视验收）· **Blocked by**: #3, #4

### What to build

曲率档位密度与各项罚分权重需看真实效果调整，并锁定为常量。

### Acceptance criteria

- [ ] demo 场景目视验收：连线走外围、少交叉、不穿节点
- [ ] 调优曲率档位与「外绕 / 交叉 / 弯曲 / 长度」权重并固化为常量
- [ ] 补充截图 / 对比图到 `docs/preview/`
