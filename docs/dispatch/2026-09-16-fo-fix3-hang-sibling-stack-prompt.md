# FO-FIX3 外派任务书：同挂点行多空间同级叠坐标

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-FIX3**（P0 布局回归）。**前置：FO-FIX2 已验收 `4e56671`。**  
> 用户裁定：`.mm.md` **文件里已有多个同级**；成框态只见「一个」/文字发厚 → **布局堆叠**，不是 Enter 语义。

## 你的角色

工程执行 agent。修「同一挂点大纲行下多个空间同级」的落点碰撞；TDD；显式路径提交；不 push。

## 现象（用户 + 主控复现）

1. 成框后对**空间层**节点（挂出层）多次 Enter → 文件里多个同级「新节点」。  
2. 成框态：看起来只有一个，或文字发厚（多份文本同坐标叠画）。  
3. **拆框后**同级正常错开 → 数据层正确，问题在框岛挂点布局。

主控复现（depth=1，挂点行下 3 个空间同级）：

```
hangOrigins:  (307.5, 37) × 3   ← 完全相同
最终盒:       (378.5, -4) × 3   ← 同 x / 同 y
```

## 主控取证（已核代码，按此修）

### 根因 — `hangOriginOf` 对同挂点行的每个孩子给出同一中心点

`packages/kernel/src/layout/frameLayout.ts` · `layoutFrameIsland`：

```ts
for (const hang of part.hangRoots) {
  const row = boxes.get(hang.outlineNodeId);
  // …
  hangOrigins.set(
    hang.spatialRoot.id,
    hangOriginOf(shell, row, measure(hang.spatialRoot), direction),
  );
}
```

`hangOriginOf` 只看 **壳缘 + 挂点行中线**，**不区分**同一 `outlineNodeId` 下第几个孩子。

随后 `expandOne` 把这些同 `pos` 的中心交给 `layoutForest`：

- `forest.ts`：`if (item.spec.pos) { origins.push(item.spec.pos); … }` —— **有 pos 则原样用**，不做同坐标错开。  
⇒ 多岛叠在同一世界点 → 用户所见「堆叠 / 发厚」。

**不是**：

- Enter 编辑态只提交不建节点（文件已有多个 → 已排除）  
- 框内大纲层同级堆叠（`layoutFrameIsland` 行 `cursorY` 已错开；框内多行竖排正常）

触发路径（典型）：

- 框 `depth=1`：挂点行 = 框根第一层；其子 = 空间层 → Enter 建同级 = 同挂点多 spatial  
- 或 `depth=2`：在挂点行（d=2）的某个孩子上 Enter → 同上

## 口径（已裁定）

| 做 | 不做 |
|----|------|
| 同一 `outlineNodeId` 下 **≥2 个** hang 根 → 沿生长轴**垂直**方向（right/left → 沿 Y；up/down → 沿 X）错开中心，使展开后**盒互不重叠** | 不改 Enter 语义（不在此批做「编辑态 Enter 链式建同级」） |
| 保留 FIX1：挂点相对**壳缘**净空；`spatial.links` 仍合并 | 不重开 C2.1（壳含挂出整包络）——本批只修同挂点多同级 |
| 单测锁死「同挂点 ≥2 spatial → 盒不相交」 | 不新 `type`；不动 OutlinePanel / graph-engine |

推荐实现（择一，优先 A）：

- **A（首选）**：在 `layoutFrameIsland` 写 `hangOrigins` 时，按 `hangRoots` 顺序对同 `outlineNodeId` 分组，组内按子树高度（或 `measure` 高）+ gap 沿跨轴偏移中心。公式仍相对壳缘起算（FIX1 净空不变）。  
- **B**：`layoutForest` 对相同 `pos` 自动错开 —— **仅当**能证明不破坏既有「显式 pos 中心」契约；否则勿动 forest，优先 A。

挂点边（大纲行 → 各 spatial 根）仍各画一条；错开后边可从同一行扇出，属预期。

## 必读

1. `packages/kernel/src/layout/frameLayout.ts` · `hangOriginOf` / `layoutFrameIsland` hangOrigins 循环 / `expandOne` centers  
2. `packages/kernel/src/layout/framePartition.ts` · `hangRoots`（同挂点行多孩子 = 多条）  
3. `packages/kernel/src/layout/forest.ts` · 有 `pos` 时不自动错开（约 L160–163）  
4. FIX1 测：`packages/kernel/tests/frame-hang-links.test.ts`（勿回归丢线/净空）

## 范围

**修改（预期）**

- `packages/kernel/src/layout/frameLayout.ts` — 同挂点多 hang 根错开  
- `packages/kernel/tests/frame-hang-links.test.ts` 或新 `frame-hang-siblings.test.ts` — 红钉叠坐标  
- 可选薄测：`packages/react/tests/frame-layout-wiring.test.ts` 真管线 `layoutDemo` 断言两 spatial 盒不相交  

**禁止**

- 改 OverlayEditor Enter=提交纪律；改 `addSibling` 语义  
- C2.1 大壳；`git add -A`；push；graph-engine  

## 必须交付的测试（先红后绿）

```ts
// 结构：frame depth=1 → hangRow → s1, s2, s3（三个空间同级，无更深）
// expandFrameIslands / layoutDemo 后：
const b1 = boxOf(layout, s1.id);
const b2 = boxOf(layout, s2.id);
const b3 = boxOf(layout, s3.id);
// ★ 今日必红（修前三者中心或盒完全重合）
expect(boxesOverlap(b1, b2)).toBe(false);
expect(boxesOverlap(b1, b3)).toBe(false);
expect(boxesOverlap(b2, b3)).toBe(false);
// 仍相对壳缘有净空（FIX1 不回归）
expect(Math.min(b1.x, b2.x, b3.x)).toBeGreaterThanOrEqual(shellRight + MIN_CLEAR);
// 挂点边仍在
expect(links).toContain(hangRow → s1);
expect(links).toContain(hangRow → s2);
```

`boxesOverlap` 可用轴对齐矩形相交（含边界贴合算 overlap 或按仓库既有 helper）。

## 步骤

1. 写失败测（同挂点 3 同级盒重叠）→ 红  
2. 实现同挂点组内错开 → 绿  
3. 跑 FIX1 / frame-layout / frame-collision 相关测，确认净空与 links 不回归  
4. 显式路径提交（建议 1 个 fix commit）

```bash
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/frame-hang-links.test.ts tests/frame-layout.test.ts tests/frame-collision.test.ts
# 若新建测文件一并带上
corepack pnpm --filter @mindcanvas/react exec vitest run tests/frame-layout-wiring.test.ts
```

建议 commit：`fix(kernel): fan out hang origins for sibling spatial roots on same outline row`

## 停止条款

- 错开后同挂点边交叉严重且无法用最小 gap 缓解 → 停报并附图/坐标表，请主控裁「是否改挂点边扇出策略」  
- 发现叠坐标发生在**大纲行**（非 spatial）→ 停报（与主控复现矛盾，需重裁）  

## 回执格式

1. commits + `--stat`  
2. 红→绿原文  
3. 错开公式位置（file:line）；选 A 或 B  
4. 声明：未改 Enter 语义；FIX1 links/净空未回退  
5. 偏差  

## 验收对照（主控用）

- [ ] 同挂点行 ≥2 个空间同级 → 成框态盒互不重叠（不再发厚叠字）  
- [ ] 挂点边仍存在；FIX1 壳缘净空不回归  
- [ ] 框内大纲层多同级竖排仍正常  
- [ ] 未改编辑态 Enter=提交；未 push  
