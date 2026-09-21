# FE-FRAME · 成框 Section 自由边贴框锚设计

> 状态：主控设计稿，供评审 / 外派。日期：2026-09-17。  
> 动机：跨岛自由边目前锚定**叶子节点盒**，线会穿过 Section 框「扎进」内部节点；成框后岛是视觉单元，线应落在**框身**上。远观总览卡（IO-1/2）是同一问题的加强版（成员卡被藏，端点更偏）。  
> 关联：IO-2b「自由边端点改卡盒」；**不**改 `routeAesthetic` 内核（① 禁令）；零协议改动。

---

## 1. 问题

| 现状 | 观感 |
|---|---|
| `edgeBoxOf(id)` = 节点 `renderBoxOf` | 自由边从框外穿入，扎到框内某叶 |
| 总览档成员 NodeG 隐藏，端点仍用原叶盒 | 线穿入总览卡内部「空洞」位置（R1） |
| `boundaryLinks`（跨岛父子虚线）另轨 | **本设计不改**树边 / parent_link |

用户期望：**成框的中心 Section，自由边连到该岛时落在框身上**，线不再穿心。

---

## 2. 目标与非目标

**目标**

1. 跨框自由边的端点，若落在某 **Section 成员集**内 → 取盒改为该 Section 的 **frame bounds**（与 `buildSectionViews` 同形）。  
2. 总览档：端点落在总览卡（含一级迷你卡）覆盖集内 → 取盒改为**卡 bounds**（与 IO-2b 合并为同一 `edgeBoxOf` 管道）。  
3. 同框内两端 → **仍用节点盒**（框内精细关系保留）。  
4. 不改 `.mm.md`；不改 `routeAesthetic` / 避障内核；折叠上溯语义保留（先 frame 提升，再既有 resolver）。

**非目标**

- ① zoom 触发审美重路由策略  
- Canvas 后端画自由边（仍 SVG；R2 边界不变）  
- 把 `boundaryLinks` 也改贴框（另议；树边语义不同）  
- 协议新增 `edge.attach: frame|node`

---

## 3. 口径（建议拍板 · 禁止再议后外派）

| # | 裁决 |
|---|---|
| **F1 谁提升** | 自由边一端解析到的 **有效节点 id**（折叠上溯之后）若属于某 Section 的成员清单（与 Section AABB 同源：`containedMemberIds` / 岛成员 / 子树兜底），则该端取盒 = **该 Section 的 frame.bounds**。 |
| **F2 同框不提升** | 若两端提升后落在**同一** `sectionId`（或同一总览卡 rootId）→ 两端**回退节点盒**（避免框内边变成零长/贴边自环）。 |
| **F3 多框重叠** | 一点可属于嵌套 Section（父岛框 ⊃ 子岛框）。取 **最深（面积最小 / 嵌套层最深）** 的成框 Section；无嵌套表时取 member 集包含该点且 bounds 面积最小者。切断岛有独立框则用自己的框。 |
| **F4 无 Section 的中心岛** | **不**提升到「隐形岛 AABB」（避免无视觉框却改锚）。仅 **已标记 Section**（或总览卡可见时）才贴框/贴卡。 |
| **F5 总览优先** | `overviewActive` 时：先查端点所属**总览卡 / 迷你卡**（`islandOverviewMemberIdsOf` + nestedCards）→ 用卡 bounds（迷你用 clamp 后几何若图层有 placed 缓存则用之，否则 VM bounds）；无卡再走 F1。与 F2 同卡不提升。 |
| **F6 接入点** | **只改** MapView `edgeBoxOf`（或包一层 `frameAwareBoxOf` 再注入 FreeEdgeLayer）。`collectFreeEdges` / `freeEdgeEndpoints` / `routeAesthetic` **不改签名语义**（仍吃 `boxOf`）。 |
| **F7 障碍物** | 总览档：障碍表本就可空或仅可见物；贴框后端点盒变大，避障自然绕框——可接受。近景贴框：障碍仍含框内节点，线从框边出发可能仍绕内部卡——可接受；若难看，后续再加「同 Section 成员不进障碍」开关（本批不做）。 |
| **F8 命中/编辑** | 边的命中与菜单仍绑定 **edge 身份**（from/to 锚不变）；只改**几何取盒**。不改「点边选中哪条边」。 |

> **已拍板（2026-09-17）**：F1–F8 全部生效。外派 **FE-FRAME-1 = 近景贴框 + 远观贴卡（原 1b 同批）**；不含 FE-FRAME-2。  
> 开工令：`docs/dispatch/2026-09-17-free-edge-frame-anchor-dispatch-prompt.md`。

---

## 4. 架构

```
freeEdgeEndpoints(edge, boxOf, …)
         ▲
         │ boxOf = frameAwareBoxOf
         │
frameAwareBoxOf(id):
  1. base = renderBoxOf(node)           // 既有
  2. if overview: card = owningOverviewCard(id) → return card.bounds
  3. sec = owningSectionFrame(id)       // 最深成框
  4. peer = other endpoint's owning sec/card（路由层需两端，见下）
  5. if same sec/card as peer → return base
  6. return sec.bounds
```

**两端同框判定**：`freeEdgeEndpoints` 今日对两端**分别**调 `boxOf(id)`，单次 `boxOf` 看不到对端。两种接法：

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A（推荐）** | `frameAwareBoxOf` 做成闭包，持有「当前边」上下文；FreeEdgeLayer 在每边路由前 `setEdgeContext(edge)`，或提供 `boxOfForEdge(edge)` | 改动面小，语义准 |
| **B** | 预计算 `Map<nodeId, sectionId>` + 在 `freeEdgeEndpoints` 增加可选 `promote?: (id, peerId) => Box` | 动 freeEdges.ts API |

**推荐 A**：不改 `freeEdges.ts` 核心；MapView 提供：

```ts
boxOfForFreeEdge(edge: FreeEdge): (id: string) => Box | undefined
```

Layer 对每边用该闭包（或 resolver 工厂按边生成）。

纯函数抽出（可单测）：

```ts
// packages/react/src/render/freeEdgeFrameAnchor.ts
owningSectionId(nodeId, sectionMemberIndex): string | undefined
promoteEndpointBox(nodeId, peerId, index, boxOfNode, frameBoundsOf): Box | undefined
owningOverviewCardId(nodeId, cards): { rootId, bounds } | undefined
```

---

## 5. 与 IO / 总览关系

| 模式 | 贴什么 |
|---|---|
| 近景 + 有 Section | Section frame.bounds（F1–F3） |
| 远观 overview | 总览卡 / 迷你卡 bounds（F5）；无 Section 的岛若有总览卡也可贴卡（总览卡不依赖 Section） |
| 无框无总览 | 节点盒（今日行为） |

IO-2b 原「仅 overview 贴卡」⊂ 本设计；建议 **IO-2b 扩大为本 FE-FRAME**，一次外派做完「近景贴框 + 远观贴卡」。

---

## 6. 分期建议

| 阶段 | 内容 |
|---|---|
| **FE-FRAME-1**（本外派） | 纯函数索引 + `refineEndpoints` 接线；近景贴 Section 框；远观贴总览卡/迷你卡；同框不提升；测例 |
| **FE-FRAME-2** | 同 Section 成员踢出障碍表；boundaryLinks 是否贴框（产品另裁） |

开工令：`docs/dispatch/2026-09-17-free-edge-frame-anchor-dispatch-prompt.md`。

---

## 7. 测试计划（FE-FRAME-1）

| 测 | 断言 |
|---|---|
| 纯函数 | A∈SecP，B∉SecP → A 端盒 = frame(P)；B 端 = 节点盒 |
| 纯函数 | A、B 同属 SecP → 两端仍为节点盒 |
| 纯函数 | 嵌套 SecP⊃SecC，点在 C 成员 → 提升到 C 框（最深） |
| 集成 | 两岛各一 Section，跨岛边 path 端点落在框边附近（几何抽样 / bbox 相交框轮廓） |
| 回归 | 无 sections 文档自由边与改前一致 |

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 框很大，线都钉在框外接矩形中点，多条边重叠 | 既有 `routeAesthetic` 侧向分离；可后续按边 hash 在框边上取不同锚点（本批不强制） |
| 拖 Section 预览时框动、线未跟 | `frame.bounds` 须走与 Section 相同的 `renderBoxOf` / centerPreview 管线 |
| 路由缓存键含盒坐标 | 盒变 → 自然 miss；勿手改 cache gen 语义 |
| 与「精确连到某叶」产品预期冲突 | 成框 = 岛级关系；框内精细用同框不提升保留 |

---

## 9. 成功标准

1. 跨 Section 自由边视觉上从**框缘**进出，不再穿心扎叶。  
2. 同 Section 内自由边行为与今日一致。  
3. 总览下跨岛边贴卡缘（若 1b 同批）。  
4. 相关 vitest 绿；未改 `routeAesthetic`；零协议改动。

---

## 10. 主控一句话

**成框即岛级锚：跨框自由边贴 Section（远观贴总览卡）；同框仍贴节点；只改取盒管道，不改路由内核与协议。**

---

## 11. FE-FRAME-1.1（已拍板 · 跟进）

主控认可执行方自建议 **分层 memo + 测护航**；**暂缓** placed 几何对齐。

| 做 | 不做 |
|---|---|
| `sectionData` 拆：成员清单 memo（无 anim）↔ 取盒建帧（跟 anim/preview） | 迷你卡 placed 与锚点像素对齐 |
| `refineFreeEdgeEndpoints` 不变式测 + 迷你×自由边集成测 | nodeId→sectionId 预表；改 routeAesthetic / ghost |

开工令：`docs/dispatch/2026-09-17-free-edge-frame-1.1-dispatch-prompt.md`。
