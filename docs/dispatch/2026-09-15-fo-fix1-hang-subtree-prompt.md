# FO-FIX1 外派任务书：框挂出子树丢连线 / 贴边重叠

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-FIX1**（P0 回归修复）。**前置：FO-C2 已合入。**  
> 用户实测：**严重 · 子树异常**（挂出支在框右侧贴边/重叠，子孙节点漂浮且**无连线**）。

## 你的角色

工程执行 agent。按主控取证修挂出空间层；TDD；显式路径提交；不 push。

## 用户现象（截图已确认）

1. 框右侧有挂出「新节点」，**几乎贴住/压进框壳右缘**。  
2. 再外侧的子孙「新节点」**位置错乱且看不见父子连线**（像漂浮）。  
3. 出框连线看起来像从**框壳竖边中点**拉出（挂点行若在框中部时也会像这样；但丢线与贴边是硬伤）。

## 主控取证（已核代码，按此修）

### 根因 A（高置信 · 丢连线）— `expandOne` 未合并空间层 links

`packages/kernel/src/layout/frameLayout.ts` · `expandOne`：

- 调用 `layoutForest(...)` 得到 `spatial.nodes` **与** `spatial.links`；
- 只把「挂点行 → 空间根」的边 `push` 进 `ctx.links`；
- **`spatial.links` 从未并入 `ctx.links`**。

而 `MapView` 树边渲染走 **`layout.links`**（`filterVisibleLinks(layout.links, …)`），**不会**从 `LayoutNode.children` 临时补树边。

⇒ 挂出子树内部边全部丢失 → 截图「漂浮无连线」。  
现有 `frame-layout.test.ts` 只断言挂点边 `c→g`，**未覆盖** `g→孙`，故漏网。

### 根因 B（中置信 · 贴边）— 壳缘净空不足或挂点参照不一致

挂点：`hangOriginOf`（`FRAME_HANG_GAP=48`）相对**大纲行右缘**；壳右缘 ≈ 行右缘 + `FRAME_SHELL_PAD`(12)。  
理论净空 ≈ 36px，密节点卡仍可能「看起来压边」。C2 明确壳**不含**挂出外包络 → 挂出根与壳的分离**没有**走 separate。

FIX1 **必须**做 A；B 做最低限度：断言「空间根左缘 ≥ 壳右缘 + 最小净空」，若红则加大挂出净空（相对**壳右缘**计 gap，或提高 `FRAME_HANG_GAP`），并加单测锁死。

## 必读

1. `packages/kernel/src/layout/frameLayout.ts` · `expandOne`（约 360–438）  
2. `packages/react/src/render/MapView.tsx` · `visibleLinks = filterVisibleLinks(layout.links, …)`  
3. `packages/kernel/src/layout/forest.ts` · `shiftIsland` / 产出 `links`  
4. 本文件根因说明

## 范围

**修改**

- `packages/kernel/src/layout/frameLayout.ts` — 合并 `spatial.links`；必要时修正挂点相对壳缘净空  
- `packages/kernel/tests/frame-layout.test.ts`（或新 `frame-hang-links.test.ts`）— 红钉丢线 + 净空  
- 若改常量/挂点公式：更新相关注释；react 真管线可加一条薄测（可选）

**禁止**

- 重开 C2 大方案（改 separate 内核、壳含挂出整包络）——除非净空公式无法用小改修到验收线，停报  
- 新 `type`；graph-engine；`git add -A`；push  
- 放宽既有阈值；回退 C1 换行

## 必须交付的测试（先红后绿）

```ts
// 结构：frame depth=1 → hangRow → spatialRoot → childA, childB
// 展开后：
expect(links).toContainEqual(hangRow → spatialRoot)           // 已有
expect(links).toContainEqual(spatialRoot → childA)            // ★ 今日必红
expect(links).toContainEqual(spatialRoot → childB)            // ★ 今日必红
// 净空：
expect(spatialRoot.box.x).toBeGreaterThanOrEqual(shellRight + MIN_CLEAR)  // ★ 建议 MIN_CLEAR ≥ 24
```

实现要点：

```ts
// expandOne 在 layoutForest 之后：
for (const l of spatial.links) ctx.links.push(l);
// 再写挂点边（或先挂点后 spatial，勿丢任一端）
```

注意：`spatial.links` 已是世界坐标（forest 已 shift）；不要二次平移。嵌套框递归 `expandOne` 仍走原路径。

## 步骤

1. 写失败测（丢线 + 净空）→ 红  
2. 合并 `spatial.links` → 丢线绿  
3. 若净空红 → 调挂点/常量 → 绿  
4. kernel 相关测 + 既有 frame-* 全绿；必要时 canvas/react 定向  
5. 提交（建议 1 个 fix commit）

```bash
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/frame-layout.test.ts
# 若新建文件则带上
corepack pnpm --filter @mindcanvas/kernel test -- --run
```

建议 commit：`fix(kernel): merge spatial hang-subtree links into frame island layout`

## 停止条款

- 合并 links 后出现双线/错线且无法用去重解释 → 停报并贴 fromId/toId 列表  
- 必须改 MapView「从 children 重建树边」才能绿 → 停（应修 kernel links，保持单一事实源）

## 回执格式

1. commits + `--stat`  
2. 红→绿原文（含新增断言名）  
3. `spatial.links` 合并位置（file:line）  
4. 净空公式/常量是否改动  
5. 偏差  

## 验收对照（主控用）

- [ ] 挂出子树内部边出现在 `layout.links`  
- [ ] MapView 无需改也能画挂出子孙连线  
- [ ] 空间根相对壳右缘有稳定净空  
- [ ] C1/C2 既有测未红  
