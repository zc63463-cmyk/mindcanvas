# markvault-js MindFlow 连线逻辑深度解析

> 日期：2026-09-01
> 源码：`markvault-js/src/mindflow/`（edge-router.ts 407 行 / svg-connector.ts 682 行 / mindflow-connections.ts 958 行 / connection-edit.ts 179 行）

---

## 一、架构分层

```
┌─ 数据层  store.getRelations / addRelation / invalidateRelation / restoreRelation
│
├─ 视图层  mindflow-connections.ts
│   ├─ renderRelationEdgesFn()      —— 【关系边】annotation↔annotation（虚线彩色，可失效/恢复）
│   └─ renderConnectionEdgesFn()    —— 【自主连线】用户手动创建（紫色粗虚线）
│
├─ 路由层  edge-router.ts（公共绕障）
│   ├─ detectObstacles()     采样贝塞尔 → 找出挡路节点
│   ├─ chooseSide()          数左右障碍数，少的一侧胜出
│   ├─ routeSide()           生成 4 点 trunk + 通道校验 + 重试
│   ├─ computeRoutedPath()   主入口（含直连回退）
│   └─ waypointsToSVGPath()  折线 → 圆角 path
│
├─ 渲染层  svg-connector.ts
│   ├─ computePath()                树边贝塞尔（按 layout 分 org / tree-left / fishbone / timeline / radial
│   ├─ rectBoundaryIntersection()   边界射线求交（锚定）
│   ├─ findNodePosition()           含折叠回退（DOM → 全树 → 最近祖先）
│   └─ ensureArrowMarkers()         箭头 marker（幂等）
│
└─ 交互层  connection-edit.ts
    └─ ConnectionEditModal —— label / note / **routingSide** / color
```

---

## 二、两套连线并存（重要设计）

| | 关系边 relation | 自主连线 connection |
|---|---|---|
| 来源 | annotation 之间（数据驱动） | 用户手动创建 |
| 线宽 | 1.5 | **2.5** |
| dasharray | `2 6`（细点线） | `10 4`（粗虚线） |
| opacity | 0.55 | 0.65 |
| 默认色 | 按 relationType 映射 | `CONN_COLOR = #8B5CF6`（紫）
| 生命周期 | 可 invalidate / restore | 可编辑 / 删除

→ **印证**：「语义关系」与「用户自由连线」是两种东西，不应混为一谈。

---

## 三、核心算法（edge-router.ts）

### 3.1 `detectObstacles` — 找挡路节点
```
采样直连贝塞尔 24 点（samples=24，collisionPadding=4）
遍历 visibleNodes，凡矩形包含任一样本点 → 视为障碍
```
关键：**只检测"真正挡住直连"的节点（不含源/靶自身）

### 3.2 `chooseSide` — 选绕行侧
```
rightThreshold = max(from.right, to.right)
leftThreshold  = min(from.left,  to.left)
对每个障碍（y 落在 [minCy-20, maxCy+20] 内：
  若 o.right > rightThreshold → rightBlockers++
  若 o.left  < leftThreshold  → leftBlockers++
rightBlockers < leftBlockers → goRight = true
leftBlockers < rightBlockers → goRight = false
平手 → fromCenterX <= toCenterX（源在左则右绕）
```

### 3.3 `routeSide` — 4 点 trunk
```
参数：obstaclePadding=12, endpointOffset=8, maxRetries=5, retryIncrement=6
```
每轮 retry（offset = 8 + retry×6）：
```
channelX = goRight ? max(from.right, to.right, ...障碍.right) + 12 + offset
                   : min(from.left,  to.left,  ...障碍.left)  - 12 - offset

waypoints（goRight）:
  [from.right + offset, fromCy]   —— 出（右侧 stub）
  [channelX,            fromCy]   —— 横移到通道
  [channelX,            toCy]     —— 沿通道纵移
  [to.right + offset,   toCy]     —— 回到靶（右侧 stub）

校验：isVerticalChannelClear(channelX, fromCy, toCy) —— 通道垂直段不穿任何障碍
通过 → mergeShortSegments(waypoints, 20)（合并 <20px 的碎段）
```

### 3.4 `computeRoutedPath` — 主入口
```
p1 = rectBoundaryIntersection(fromRect, to.center)     // 锚定到边界
p2 = rectBoundaryIntersection(toRect,   from.center)

① 布局不在 {tree-right, tree-left, logic-right} → 直接贝塞尔，routed=false
② 无障碍 → 直接贝塞尔，routed=false
③ 有障碍 → routeSide → 成功则 routed=true，返回 waypoints + bounds
④ routeSide 全部重试失败 → 回退直接贝塞尔，routed=false
```

### 3.5 直连曲率
- `computeDirectBezier(p1, p2, curvature = 0.4)` —— **默认 0.4**
- 自主连线显式传 **0.3**（`renderConnectionEdgesFn` 中 `computeDirectBezier(fallbackP1, fallbackP2, 0.3)`）
  注释写明「R1修复: 自主连线原曲率为 0.3，computeDirectBezier 默认 0.4，此处显式传 0.3 保持一致」

---

## 四、关键渲染细节

### 4.1 双 path（hitArea + visible）
每条边渲染两个 `<path>`：
- `hitArea`：透明、`stroke-width=14`、`pointer-events: stroke`（扩大点击热区）
- `path`：可见、`pointer-events: none`
- DOM 顺序：`hitArea → path → label`（label 在最上层）

### 4.2 `rectBoundaryIntersection` 锚定
```
从中心向目标点投射射线，求与矩形边界交点，取中点并归一化 → [0-1, 0-1]
```
与 tldraw 思路一致（归一化锚点，形状缩放后保持相对位置）

### 4.3 `findNodePosition` 折叠回退链
```
① DOM (nodeElements → getNodeCenter)
② 全树搜索 node.layout
③ 节点在折叠子树内无 layout → 向上找最近祖先的 layout
④ null

### 4.4 `waypointsToSVGPath` 圆角
```
cornerRadius = 5（按相邻段长 clamp）
每个拐点：L(角前) + Q(控制点=拐点, 角后)
→ 圆角折线

### 4.5 绕障 bounds
```
累积所有 routeResult.bounds → 用于 SVG resize（绕行路径可能超出原视口）

---

## 五、用户可覆盖（routingSide）

`connection-edit.ts` 暴露 `绕行方位 (routing side)` 下拉：`left | right`
存于 `conn.routingSide` → 传给 `computeRoutedPath` 的 `{ forceSide: conn.routingSide }`
→ `routeSide` 中 `goRight = options?.forceSide ? options.forceSide === 'right' : chooseSide(...)`

**这是"自动路由 + 人工覆盖"契约的落地**（与 XMind/MindManager/Miro 一致）。

---

## 六、与我的实现（routeAesthetic）的对比

| 维度 | markvault-js trunk | 我的曲率自适应贝塞尔 |
|---|---|---|
| 路径形态 | **4 点折线 + 圆角**（出→横移→纵移→回） | **单条三次贝塞尔** |
| 优化目标 | 绕到一侧的垂直通道 | 外围绕行（评分驱动） |
| 选侧 | 数左右障碍数 | 评分：交叉 > 内凸 > 弯曲 > 长度 |
| 避障机制 | 横移到节点群外侧的通道 | 调曲率向外鼓 |
| 曲率 | 直连 0.3 / 0.4 | 枚举 ±{0…2.0} |
| 失败降级 | 回退直接贝塞尔 | 直线直穿（SBGN crossing×2） |
| 人工覆盖 | `routingSide`（left/right） | `manual`（归一化锚点 + 曲率） |
| 多线协调 | 无 | 交叉罚分（#2 已实现） |

### 关键洞察：两者其实是同一思路的不同实现

**markvault-js 的 trunk 与用户诉求「从外部连线」是一致的**：它把连线引到节点群**外侧的垂直通道**，而不是在节点之间钻缝。

我的曲率自适应贝塞尔做的是同一件事（向外鼓），只是：
- trunk 用**折线**明确"出→绕→回"三段
- 贝塞尔用**一条弧线**一鼓而过

### 各自的适用边界

| 场景 | trunk 更优 | 贝塞尔更优 |
|---|---|---|
| 障碍撑出两端、有明显外侧空间 | ✅ 路径明确 | ✅ 更平滑 |
| 障碍夹在两节点之间（如 demo e0） | ❌ 通道被塞死 | ❌ 同样几何无解（已穷举验证 0/1872 可绕） |
| 节点稀疏、无障碍 | ⚠️ 会走折线（不必要） | ✅ 直连（routed=false） |
| 视觉观感 | 结构化 / 工程感 | 有机 / XMind 感 |

---

## 七、可借鉴之处（对 mindcanvas）

1. **`forceSide` 用户覆盖** —— 我已实现 `manual`，但可考虑再加一个轻量的"绕左/绕右"一键切换（比拖 bend 更快）
2. **双 path hitArea**（`stroke-width=14` 透明描边）—— mindcanvas 已有类似（FreeEdgeLayer 的 `stroke-width=12` 透明命中区 ✓ 已有）
3. **累积 bounds 用于 SVG resize** —— 绕行路径超出原视口时需要
4. **两套连线的视觉区分**（关系边细点线 vs 自主连线粗虚线）—— mindcanvas 已有 rel 驱动的样式区分
5. **折叠节点的位置回退链**（DOM → 全树 → 最近祖先）—— mindcanvas 有 `collapsedAncestors` 机制

### 最值得学的一点

**markvault-js 的 `detectObstacles` 理念**：只把"真正挡住直连"的节点作为绕障目标。我此前踩过同一个坑（trunk 用全部节点算 channelX，导致绕到画布边缘，见 memory「blockers 语义修正」）。

两者都验证了同一条原则：**绕障的目标集合必须是"挡路的"，而不是"全部的"**。

---

## 八、结论

markvault-js 的 trunk 路线与我的曲率自适应路线**本质同源**（都主张绕过节点群而非穿缝），差别只在折线 vs 曲线。它相对我的优势是**路径形态更明确**；我相对它的优势是**视觉更平滑（符合 XMind/Miro 观感）+ 有多线交叉协调。**

若要"在他的基础上"再进一步，最值得做的是：**给曲率自适应也加一个 `forceSide` 快捷切换**，让用户不必拖 bend 就能一键选"绕左/绕右"。
