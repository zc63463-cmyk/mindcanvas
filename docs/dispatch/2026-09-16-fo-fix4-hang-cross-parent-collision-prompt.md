# FO-FIX4 外派任务书：不同挂点父亲的挂出子树互相压叠（无推挤）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-FIX4**（P0 布局回归）。**前置：FO-FIX3 已验收 `766584b`。**  
> 用户截图：框右侧两个不同「父亲」各自的下层「新节点」**纵向叠在一起**；下方父亲自身仍可能发厚。用户原话：**没有碰撞推挤：框的两个不同父亲的下层子节点**。

## 你的角色

工程执行 agent。修「不同挂点行 / 不同空间根」之间挂出子树 AABB 碰撞；TDD；显式路径提交；不 push。

## 现象（截图已确认）

左 = 框壳；中 = 两个空间层父亲「新节点」；右 = 各自的下层孩子。

1. **上父亲**的孩子与 **下父亲**的孩子在右侧**纵向重叠**（文字发厚 / 边框叠画）。  
2. 下方父亲本体也有叠层感（可能同挂点多同级残留，或子树压进父亲盒——本批以「跨父亲子树不相交」为主验收）。  
3. 拆框后常规布局会推开 → 数据层有多个节点；问题在**框岛空间层岛间无分离**。

## 主控取证（已核代码）

### 与 FIX3 的边界（勿误修）

| | FIX3（已合） | FIX4（本批） |
|--|-------------|-------------|
| 对象 | **同一** `outlineNodeId` 下多个 spatial 根 | **不同**挂点父亲（不同 hang 行，或同框内多个 hang 岛）的**整棵**挂出子树 |
| 手段 | `layoutFrameIsland` 写 `hangOrigins` 时组内跨轴扇出 | 岛展开后（或写 origins 时）做**跨岛**推挤 |
| 仍缺 | 组与组之间仍锚定各自行中线 | 行距 ≪ 子树高 → 两岛孩子必撞 |

大纲行高约 22px + `FRAME_ROW_GAP`，两挂点行中线往往只隔 ~26px；每个空间父亲带 3 个孩子时跨轴展开 ≫ 行距 → **必然压叠**。

### 根因

1. `layoutFrameIsland`（FIX3）只在**同一挂点行组内**扇出；**不同 `outlineNodeId`** 的 hang 原点仍落在各自**行中线**。  
2. `expandOne` → `layoutForest(centers with pos)`：`forest.ts` 对**有 `pos` 的中心原样落点**，只在无 `pos` 时横向自动错开——**不做纵向跨岛分离**。  
3. 框壳碰撞（C2）只管基座邻节点 vs 壳；**不含**挂出子树外包络（C2.1 债）。同框内两挂出岛之间**没有任何推挤通道**。

## 口径（已裁定）

| 做 | 不做 |
|----|------|
| 同一框内、按 `hangRoots` 顺序：各挂出子树（空间根 + 其 layoutForest 岛内全部节点）的 AABB **沿跨轴互不重叠**（含间隙） | 不重开完整 C2.1（壳体积含挂出 → 推基座邻居）；可在偏差声明「仍属 C2.1」 |
| 主侧相对壳缘净空（FIX1）不回退；同挂点行组内扇出（FIX3）不回退 | 不改 Enter 语义；不改 `separateTree` 全局内核（除非证明最小改可复用且无回归） |
| 推挤后重建/平移该岛 links（与 `shiftIsland` 同纪律：path 含绝对坐标） | 不动 OutlinePanel / graph-engine |

推荐实现（择一，优先 A）：

- **A（首选）**：`expandOne` 在 `layoutForest` 之后，按 `hangRoots` 顺序取各岛 AABB；若与已占用跨轴区间重叠，则将该岛（根中心 + 整岛）沿跨轴平移至紧贴占用区 + gap（`V_GAP`/`H_GAP` 或 `FRAME_HANG_SIBLING_GAP`），并平移/重建该岛 links。  
- **B**：扩展 FIX3：写 `hangOrigins` 时对**全部** hang 根做全局跨轴占位（不限于同行），行中线仅作弱偏好——须证明 n=1 且矮子树时仍贴行；否则优先 A。

禁止用「放大 FRAME_HANG_GAP」假装修好跨父亲碰撞。

## 必读

1. `packages/kernel/src/layout/frameLayout.ts` · FIX3 hangOrigins 分组；`expandOne` centers → `layoutForest`  
2. `packages/kernel/src/layout/forest.ts` · 有 `pos` 不自动错开（约 L160–163）；`shiftIsland`  
3. `packages/kernel/tests/frame-hang-links.test.ts` · FIX1/FIX3（勿回归）  
4. 用户截图语义：两父亲各自下层孩子相交

## 范围

**修改（预期）**

- `packages/kernel/src/layout/frameLayout.ts` — 跨挂出岛推挤（A）或全局 hangOrigins（B）  
- `packages/kernel/tests/frame-hang-links.test.ts`（或新 `frame-hang-collision.test.ts`）— 红钉跨父亲孩子相交  
- 可选：`packages/react/tests/frame-layout-wiring.test.ts` 真管线薄测  

**禁止**

- 仅改 UI / 不改几何；`git add -A`；push；graph-engine；新 `type`  

## 必须交付的测试（先红后绿）

```ts
// depth=1：两挂点行各挂一个空间父亲，各带 ≥2 个孩子
// f → hangA → pA → [a1, a2] ； hangB → pB → [b1, b2]
// 修前：a2 与 b1（或整岛 AABB）相交 → 红
for (const a of [a1, a2]) for (const b of [b1, b2]) {
  expect(boxesIntersect(boxOf(a), boxOf(b))).toBe(false);
}
// 同岛内父子边仍在；挂点边 hangA→pA、hangB→pB 仍在
// FIX1：pA/pB 相对壳缘净空不回归
// FIX3：若再加「同行三同级」夹具，盒仍两两不相交
```

夹具注意：两挂点行在大纲里相邻（默认行距），孩子数足够大以使修前必红。

## 步骤

1. 写失败测（跨父亲孩子相交）→ 红  
2. 实现 A 或 B → 绿  
3. 跑 `frame-hang-links` / `frame-layout` / `frame-collision` + 可选 react 接线测  
4. 显式路径提交  

```bash
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/frame-hang-links.test.ts tests/frame-layout.test.ts tests/frame-collision.test.ts
corepack pnpm --filter @mindcanvas/react exec vitest run tests/frame-layout-wiring.test.ts
```

建议 commit：`fix(kernel): separate overlapping hang subtrees from different outline rows`

## 停止条款

- 推挤导致挂点边严重交叉且无法用最小 gap 缓解 → 停报并贴 AABB/坐标表  
- 发现叠层仅来自 SVG+HTML 双绘而非盒相交 → 停报（改渲染让位，非本批）  

## 回执格式

1. commits + `--stat`  
2. 红→绿原文  
3. 推挤位置（file:line）；选 A 或 B  
4. 声明：FIX1/FIX3 不回归；未改 Enter；未做完整 C2.1  
5. 偏差  

## 验收对照（主控用）

- [ ] 两不同挂点父亲的下层孩子成框态互不重叠  
- [ ] 挂点边 / 子树内边仍在；FIX1 净空、FIX3 同行扇出不回归  
- [ ] 未 push；未动 graph-engine  
