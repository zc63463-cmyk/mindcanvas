# FE-FRAME-1 外派任务书：成框 Section / 总览卡 · 自由边贴框锚

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FE-FRAME-1**（含原 IO-2b 远观贴卡，同批）。  
> 设计权威：`docs/specs/2026-09-17-free-edge-frame-anchor-design.md`（F1–F8 **已拍板**）。  
> 摩擦：跨岛自由边锚定叶子盒 → 线穿 Section / 总览卡「扎心」；成框后应贴**框身 / 卡身**。  
> 前置：IO-1/IO-2 总览卡已在工作树（`islandOverview*`）；Section 帧已有。  
> 读者：工程执行 agent（零业务上下文）。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| 跨 Section 自由边：端点属某成框成员集 → 取盒 = **最深** Section `frame.bounds` | 不改 `routeAesthetic` / 避障内核（①）；不改协议 |
| 同 Section（或同总览卡）两端 → **回退节点盒** | 不改 `boundaryLinks` / parent_link；不做 FE-FRAME-2 障碍剔除 |
| 总览档：端点属总览卡/一级迷你卡 → 取盒 = **卡 bounds**（优先于 Section） | 无 Section 且非总览 → 不提升「隐形岛 AABB」（F4） |
| 只改**几何取盒**；边身份 / 命中 / 菜单不变 | 不 `git add -A`；不 push；不改 Canvas 画自由边 |
| 折叠上溯之后再提升（用 `eps.fromId` / `toId`） | 不做多边框上锚点散列（本批） |

成功标准：设计 §9；回执含「未提交 + `git diff --stat`」或 commit hash。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-17-free-edge-frame-anchor-design.md`（全文，尤其 §3 F1–F8、§4）  
3. `packages/react/src/render/freeEdges.ts` · `freeEdgeEndpoints` / `edgeResolverOf`（**尽量不改**；见 §2.2）  
4. `packages/react/src/render/FreeEdgeLayer.tsx` · 路由循环（`freeEdgeEndpoints` → `routeAesthetic`）  
5. `packages/react/src/render/MapView.tsx` · `edgeBoxOf`、`sectionViews`、`islandCards` / `overview`、`FreeEdgeLayer` 接线  
6. `packages/react/src/render/sectionFrames.ts` · `SectionFrame.bounds` / 成员口径  
7. `packages/react/src/render/islandOverview.ts` · `islandOverviewMemberIdsOf` / `IslandOverviewCard`（含 `nestedCards`）  
8. 既有自由边测：`tests/free-edges-*.ts*` / `freeedge-equivalence.test.ts`（回归必须绿）

---

## 2. 实现要点（权威）

### 2.1 接线策略（相对设计 §4 的工程细化）

**不要**对每边重建 `edgeResolverOf`（O(E×N)）。

采用 **解析后提升**：

1. 仍用全局 `boxOf` = 今日 `edgeBoxOf`（节点 `renderBoxOf`）跑 `edgeResolverOf` + `freeEdgeEndpoints`。  
2. 对得到的 `eps`，用纯函数按 F1–F5 **改写** `eps.from` / `eps.to`（盒），`fromId`/`toId` **不变**。  
3. 再把改写后的 `eps` 交给 `routeAesthetic`。

接入面二选一（优先改动更小者）：

- **P1**：`FreeEdgeLayer` 新增可选 `refineEndpoints?: (edge, eps) => eps`；MapView 注入。  
- **P2**：仅 MapView 包一层自定义 Layer 包装——不推荐。  

**禁止**改 `routeAesthetic` 文件。

### 2.2 纯函数模块

新建 `packages/react/src/render/freeEdgeFrameAnchor.ts`：

```ts
/** sectionId → 成员 id 集（与画 Section 框的 memberIdsOf 同源） */
export type SectionMemberIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** sectionId → frame.bounds（须含 centerPreview 后的盒，与屏幕框一致） */
export type SectionBoundsIndex = ReadonlyMap<string, Box>;

/** 总览卡（顶层 + 展平后的一级迷你） */
export type OverviewCardIndex = readonly {
  rootId: string;
  bounds: Box;
  memberIds: ReadonlySet<string>;
}[];

export function buildSectionMemberIndex(...): SectionMemberIndex;
export function owningSectionId(nodeId: string, index: SectionMemberIndex, bounds: SectionBoundsIndex): string | undefined;
// F3：含该点的 section 中取面积最小者（嵌套最深代理）

export function owningOverviewCard(
  nodeId: string,
  cards: OverviewCardIndex,
): { rootId: string; bounds: Box } | undefined;
// 迷你优先于父卡：先匹配 nested 展平项（member 集更小），再顶层

export function refineFreeEdgeEndpoints(
  eps: EdgeEndpoints, // 与 freeEdgeEndpoints 返回值同形；可 import type
  opts: {
    overview: boolean;
    overviewCards?: OverviewCardIndex;
    sectionMembers: SectionMemberIndex;
    sectionBounds: SectionBoundsIndex;
    /** 未提升时的节点盒（已在 eps 内；同框回退用） */
  },
): EdgeEndpoints;
```

`refineFreeEdgeEndpoints` 逻辑：

1. 若 `!eps.renderable` → 原样返回。  
2. `overview && overviewCards`：  
   - `cFrom = owningOverviewCard(fromId)`，`cTo = owningOverviewCard(toId)`  
   - 若两者 `rootId` 相同且均非空 → **不提升**（F2）  
   - 否则各自有卡则 `eps.from/to = card.bounds`  
3. 非总览（或总览未命中卡）：  
   - `sFrom = owningSectionId(fromId)`，`sTo = owningSectionId(toId)`  
   - 同 `sectionId` → 不提升  
   - 否则用 `sectionBounds.get` 替换对应端盒  
4. 缺 bounds → 该端保持原盒。

从 `@mindcanvas/react` `index.ts` 导出纯函数（按仓库惯例）。

### 2.3 MapView 装配

在已有 `sectionViews` / `islandCards` / `overview` 旁：

1. 从 `sectionViews.frames`（或等价）建 `sectionMembers` + `sectionBounds`  
   - 成员集必须与画框时 `memberIdsOf` **同一公式**（含 nest-contain `containedMemberIds`）  
   - bounds = 帧上已算好的 `frame.bounds`（已跟 preview）  
2. `overview === true` 时建 `OverviewCardIndex`：  
   - 每个顶层 card：`memberIds = islandOverviewMemberIdsOf(...)`  
   - 每个 `nestedCards[]`：同样；**先注册迷你再注册父**（或 matching 时迷你优先）  
3. `refineEndpoints = (edge, eps) => refineFreeEdgeEndpoints(eps, { overview, ... })`  
4. 传给 `FreeEdgeLayer`。

`edgeBoxOf` 本身可保持节点盒（给裁剪 / 其他用）；**提升只发生在 refine 步**。

### 2.4 FreeEdgeLayer

- 新增可选 `refineEndpoints?`。  
- 在 `const eps = freeEdgeEndpoints(...)` 之后：`const eps2 = refineEndpoints?.(edge, eps) ?? eps`；后续路由 / 缓存 key 用 `eps2`。  
- **缓存键**必须反映提升后的盒（今日 key 已含 eps 几何则自然成立；若只含 id，需把盒哈希进 key——查 `routeCacheKey` 并补测）。  
- 无 `refineEndpoints` 时行为与改前**逐位一致**（等价性测）。

### 2.5 测试（TDD）

| 文件 | 断言 |
|---|---|
| `tests/free-edge-frame-anchor.test.ts` | 跨 Section → 端盒 = frame；同 Section → 仍节点盒；嵌套取最深（面积最小）；overview 贴卡 / 同卡不提升；迷你优先于父卡 |
| `tests/mapview-free-edge-frame.test.tsx`（或易接集成） | 两 Section 岛 + 跨岛 edge：路由后端点落在框外接附近（或 path 与 frame 边相交）；缩进总览后贴卡 |
| 既有 | `freeedge-equivalence` / free-edges-* 全绿 |

Canvas 退让（R2）测钉：**可选**同批——`forceBackend='canvas'` 时无总览、自由边本就不画；有则补一行断言即可。

R6（overview 跳过布局动画）：**本批不做**（禁令外可选，默认跳过）。

---

## 3. 工作树提示

- 叠加 NEST-CONTAIN / PROMOTE-SEED / IO-1/2 / freeEdges cid：**只改本任务文件**；勿 `git add -A`。  
- 半成品以本任务书为权威。  
- **禁止**「顺手」改 zoom 重路由、改 `K_OVERVIEW`、改 `projectIslands`。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/free-edge-frame-anchor.test.ts
# 若有集成测一并列入
npx vitest run tests/freeedge-equivalence.test.ts tests/free-edges-anchor-state.test.ts
npx tsc -b tsconfig.json
```

---

## 5. 回执格式（交主控）

```text
## 回执 · FE-FRAME-1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] 跨 Section 贴框；同 Section 不提升
- [ ] 嵌套取最深（面积最小）
- [ ] 总览贴卡（含迷你优先）；同卡不提升
- [ ] 未改 routeAesthetic；零协议；边身份不变
- [ ] 无 refine 时 FreeEdgeLayer 行为不变
### 未做 / 风险
```

**禁止**：push；① zoom 路由内核；boundaryLinks 贴框；FE-FRAME-2 障碍表剔除；递归改协议。
