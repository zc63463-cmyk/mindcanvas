# IO-2 外派任务书：岛总览 · 嵌套迷你卡（子岛地标）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**IO-2**（Island Overview · Nested Mini-cards）。  
> 设计权威：`docs/specs/2026-09-17-island-overview-design.md` **§9**（并保留 IO-1 §3 D6：子孙仍不出**顶层**卡）。  
> 摩擦：远观只有父卡 + `⊞ N`，子岛空间关系不可见；用户要父卡内的「田」块式地标。  
> 前置：**IO-1 已验收**（`islandOverview.ts` / `IslandOverviewLayer.tsx` / MapView 总览分支已在工作树）。  
> 读者：工程执行 agent（零业务上下文）。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| 顶层总览卡内画**直接**子孙的一级迷你卡（标题+成员角标+色条，屏稳） | 迷你卡内再递归画迷你（更深只 `⊞`）；不做 IO-2b 自由边卡盒锚 |
| 子孙**仍不**出现在顶层卡集合（D6 保留） | 不改协议；不写 `collapsedIds`；不改 `K_OVERVIEW` / `lodFor` |
| 迷你 bounds = 子岛自身成员并集外扩，**钳在父卡内** | 不改 `layoutForest` / `projectIslands` / Nest-align / ① freeEdges zoom |
| 点选/双击聚焦/标题拖 = **子**中心（拖子父不动）；事件不冒泡到父 | 不 `git add -A`；不 push |
| 父卡 `⊞ nestedCount` 保留 | 不扩大到 IO-3 |

成功标准：设计 §9.3；回执含「未提交 + `git diff --stat`」或 commit hash。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-17-island-overview-design.md` **§9**（N1–N8）+ 快速扫 IO-1 §3 D6  
3. `packages/react/src/render/islandOverview.ts`（建卡、nested 剔除、`islandOverviewMemberIdsOf` / `overviewBoundsOf`）  
4. `packages/react/src/render/IslandOverviewLayer.tsx`（屏稳尺寸、选中/拖/聚焦）  
5. `packages/react/src/render/MapView.tsx` 总览分支（隐藏集、`IslandOverviewLayer` 接线、`fitTransform` 聚焦）  
6. `packages/react/src/render/islandNesting.ts` · `nestedCenterIdsByRoot` / `containedMemberIds`  
7. 既有测：`tests/island-overview.test.ts`、`tests/mapview-island-overview.test.tsx`（回归必须绿）

---

## 2. 实现要点（权威）

### 2.1 纯函数 · 扩展卡 VM

在 `islandOverview.ts`（推荐）为顶层卡增加：

```ts
nestedCards?: readonly IslandOverviewCard[]; // 直接子孙迷你；迷你自身 nestedCards 不填或恒 []
```

建卡逻辑：

1. **顶层根集合**：保持 IO-1（`centerIds ∪ membersByRoot.keys()` − 所有 nested value）。  
2. 对每个顶层 `rootId`：读取 `nestedCenterIdsByRoot.get(rootId) ?? []`，对每个 `childId`：  
   - `memberIds = islandOverviewMemberIdsOf(childId, …)`  
   - `bounds = overviewBoundsOf(memberIds, boxOf)`；无盒则跳过  
   - 标题 / 色 / `memberCount` / `nestedCount`（子的更深嵌套数）同顶层规则  
   - **钳制**：`clampBoundsInside(parentBounds, childBounds, insetPx/k)`——迷你不得画出父卡内容区（建议 inset ≈ 屏稳 8px）  
3. 填入 `card.nestedCards`；顶层 `nestedCount` 仍为直接子孙个数（可与 `nestedCards.length` 不一致仅当部分无盒跳过——测中允许 `nestedCards.length ≤ nestedCount`）。

导出新纯函数若抽出（如 `buildNestedMiniCards` / `clampBoundsInside`）；挂 `index.ts` 若对外可测。

### 2.2 IslandOverviewLayer

- 父 `CardView` 内渲染 `card.nestedCards`：  
  - 根：`data-island-overview-nested={child.rootId}` + `data-parent-island={parent.rootId}`  
  - 屏稳下限更小（建议 `MIN_NESTED_W_PX=72`、`MIN_NESTED_H_PX=28`、标题字 ~11px）  
  - 单击 / 双击 / 标题 `pointerdown`：调用同一 `onSelect` / `onFocus` / `onTitlePointerDown`，参数为 **child.rootId**；**必须 `stopPropagation`**  
- 父卡标题带拖仍传 parent；点父卡 body（非迷你）选父。

### 2.3 MapView

- 隐藏集**不必因迷你卡扩大**（子成员已在父 contained 隐藏集）。  
- 确认 `selectedOverviewRootId`（或现会话选中态）可持有子 id；Esc 清除照旧。  
- `onTitlePointerDown` / `onFocus` 已按 rootId 分发——传入 child 即可；回归：拖父仍跟移子孙。  
- Canvas 后端总览仍不激活（IO-1 边界保持）。

### 2.4 测试（TDD · 先红后绿）

| 文件 | 断言 |
|---|---|
| `tests/island-overview.test.ts` | 父 P 嵌套 C：顶层卡仅 P；`P.nestedCards` 含 C（标题/计数）；顶层无 C 卡 |
| 同上 | 迷你 bounds 在钳制后落在父 bounds 内（含屏稳撑大情形） |
| 同上 | 更深 D（C→D）：C 迷你有 `nestedCount≥1`，**无** D 迷你卡嵌在 C 内（N1） |
| `tests/mapview-island-overview.test.tsx`（或新文件） | 远观出现 `data-island-overview-nested`；拖迷你标题 → `onCenterMove` 首参为**子** id；双击迷你 → k 上升 / 总览退出 |

IO-1 既有 19 测必须保持绿。

---

## 3. 工作树提示

- 工作区可能叠 NEST-CONTAIN / PROMOTE-SEED / IO-1 / freeEdges：**只改本任务相关文件**；勿 `git add -A`。  
- **在 IO-1 上增量**，不要重写总览主干。  
- 半成品以本任务书为权威做 diff 对照。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/island-overview.test.ts tests/mapview-island-overview.test.tsx
# 若新增测文件，一并列入回执
```

建议顺手：`npx tsc -b tsconfig.json`（退出码 0）。

---

## 5. 回执格式（交主控）

```text
## 回执 · IO-2
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] 父卡内一级迷你卡可见；顶层无子孙大卡
- [ ] 迷你钳在父内；更深只 ⊞
- [ ] 拖迷你=拖子（父不动）；双击聚焦
- [ ] 未写 collapsed；零协议；未做自由边卡盒锚
### 未做 / 风险
```

**禁止**：push；IO-2b 自由边端点；递归多层迷你；改① / Nest-align / `projectIslands` / `layoutForest`。
