# IO-1 外派任务书：岛级远观总览 PROBE（语义缩放）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**IO-1**（Island Overview PROBE）。设计权威：`docs/specs/2026-09-17-island-overview-design.md`。  
> 摩擦：远观节点/Section 字糊掉，无法做 project-graph 式全局探索；岛数据已齐，缺「一岛一卡」渲染档。  
> 读者：工程执行 agent（零业务上下文）。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| `k < 0.35` 且文档有中心岛 → 岛总览档 | 不改协议；不写 `collapsedIds`；不改 `layoutForest` |
| 每岛一卡：标题（Section 优先否则中心字）+ member 角标 + 可选 nested 角标；色条 | 子孙岛 **不出** 独立卡（只角标）；不做 IO-2/3 |
| 卡 bounds = Section AABB 或 `containedMemberIds` 并集外扩；标题 **屏稳**（×`1/k`） | 不改 freeEdges zoom 审美重路由（①）；不改 Nest-align；不动 free-canvas 包 |
| 藏岛内 NodeG + 岛内树边；**保留** `boundaryLinks` | 不 `git add -A`；不 push |
| 选中 / 标题拖 = 既有中心拖；至少一种 `fitBounds` 聚焦 | 不另起 Canvas2D PG 引擎 |

成功标准：见设计 §8；回执含未提交 `git diff --stat` 或 commit hash。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-17-island-overview-design.md`（全文，尤其 §3 D1–D11、§4、§5）  
3. `packages/react/src/render/geometry.ts` · `lodFor` / `LodLevel`  
4. `packages/react/src/render/fixedNotePanels.ts` · `NOTE_LOD_BADGE_K = 0.35`（阈值对齐）  
5. `packages/react/src/render/sectionFrames.ts` + `SectionLayer.tsx`（标题/色/ghost `1/k`）  
6. `packages/react/src/render/islandNesting.ts` · `containedMemberIds`  
7. `packages/react/src/render/MapView.tsx` · LOD 冻结（B-P3）、NodeG 绘制、`boundaryLinks`、Section 接线  
8. `packages/react/src/demo/pipeline.ts` · `buildIslandView` 返回值

---

## 2. 实现要点（权威）

### 2.1 纯函数

新建 `packages/react/src/render/islandOverview.ts`：

```ts
export const K_OVERVIEW = 0.35;

export function overviewActive(k: number, hasIslands: boolean): boolean;

export function buildIslandOverviewCards(input: {
  centerIds: ReadonlySet<string>;
  membersByRoot: ReadonlyMap<string, readonly string[]>;
  nestedCenterIdsByRoot?: ReadonlyMap<string, readonly string[]>;
  /** rootId → Section 标题/色；无则缺省 */
  sectionByRootId?: ReadonlyMap<string, { title: string; color?: string }>;
  titleOf: (id: string) => string;
  boxOf: (id: string) => { x: number; y: number; w: number; h: number } | undefined;
}): readonly {
  rootId: string;
  title: string;
  color?: string;
  memberCount: number;
  nestedCount: number;
  bounds: { x: number; y: number; w: number; h: number };
}[];
```

- 成员清单用 `containedMemberIds`（有 nested 表时）再并集取盒。  
- 外扩可复用 Section padding 常量（从 `sectionFrames` 导入），避免魔法数分叉。  
- `hasIslands` = `centerIds.size > 0`（或 `membersByRoot.size > 0`，二者择一写清并测死）。

导出：按仓库惯例挂 `packages/react/src/index.ts`（纯函数）。

### 2.2 图层

新建 `IslandOverviewLayer.tsx`（或同文件内聚）：

- props：`cards`、`k`、`selectedRootId?`、`onSelect?`、`onTitlePointerDown?`、`onFocus?`（双击聚焦）  
- 标题 `fontSize = clamp(13/k, …)` 或「屏幕目标 px / k」；卡最小高度屏稳。  
- 根节点：`data-island-overview={rootId}` 便于测试查询。

### 2.3 MapView

- `overviewActive = overviewActive(effectiveK, hasIslands)`；`effectiveK` 在缩放冻结期用冻结值（与 lod 冻结同一开关）。  
- `overviewActive`：  
  - 渲染 `IslandOverviewLayer`  
  - 跳过：成员 NodeG（id ∈ 任一岛 contained 成员集）、岛内树边  
  - **不**跳过：`boundaryLinks`、自由边（PROBE 端点可仍用原盒）  
  - SectionLayer：避免与总览卡双标题——有卡的 root **隐藏**对应 Section 标题栏或整框（设计 D10；推荐：overview 时不画该 root 的 Section chrome，由总览卡承接）  
- 聚焦：双击卡 → `viewport.fitBounds(card.bounds, { padding })`（若 API 名不同，用现有 fit 同类方法）。  
- 拖：`onTitlePointerDown` 复用 Section 标题拖 / center 拖同一入口。

### 2.4 Stage

优先零改。若 `islandMembers` / `nestedCenterIdsByRoot` / `centerIds` 已传入则足够。

### 2.5 测试（TDD）

| 文件 | 断言 |
|---|---|
| `packages/react/tests/island-overview.test.ts` | 阈值；无岛 inactive；标题优先级；member/nested 计数；bounds 罩住 nested 盒 |
| 可选 `mapview-island-overview.test.tsx` | overview 下无成员 node；有 `data-island-overview`；放大后恢复 |

---

## 3. 工作树提示

- 工作区可能叠有 NEST-CONTAIN / PROMOTE-SEED / freeEdges 未提交改动：**只改本任务文件**；勿 `git add -A`。  
- 半成品对照本任务书 diff；勿推倒 nest-contain。  
- **禁止**「顺手」改 `lodFor` 阈值表（总览用独立 `K_OVERVIEW`，可与 skeleton 并存）。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/island-overview.test.ts
# 若有集成测：
# npx vitest run tests/mapview-island-overview.test.tsx
```

---

## 5. 回执格式（交主控）

```text
## 回执 · IO-1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] k<0.35 + 有岛 → 总览卡可读（屏稳字）
- [ ] 岛内 NodeG/树边隐藏；boundaryLinks 仍在
- [ ] 嵌套不出子卡；角标计数正确
- [ ] 未写 collapsed；零协议改动
- [ ] 拖卡=中心拖；至少一种聚焦
### 未做 / 风险
```

**禁止**：push；改① freeEdges zoom；改 Nest-align / `projectIslands` / `layoutForest`；做嵌套迷你卡或 IO-2。
