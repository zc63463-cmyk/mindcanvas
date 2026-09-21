# 环形菜单 ① 幽灵预览（画布版）实现计划

> **执行状态：T1–T5 全部完成（2026-09-11）** —— react 928 / canvas 79 全绿，tsc ×3 / lint / 预算全绿。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 环内高亮「新建子节点」显示生长方向虚线幽灵节点（落点与 addChild 同源）；高亮「删除节点」把节点+可见子树红色虚线描边。

**Architecture:** 三个纯增量——(a) `MapViewApi` 补两个只读逆变换 API（`nodeBox` 含缩放 k / `subtreeBoxes`）；(b) 新增纯函数 `ghostBoxOf`（四向偏移 + 视口内收，决策 A1=内收）；(c) `RadialStageOverlay` 增可选 `ghost`/`dangerBoxes` props + 样式，`MindmapStage` 用 `useMemo` 从环高亮派生预览规格（方向推断与 addChild 命令**同源**）。不改状态机、不改环几何、不改 v1.8.0 冻结交互。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19

---

## 实现前必读

- 设计：`docs/specs/2026-09-11-radial-phase3-design.md` §1（决策点 A1 取推荐=内收）
- 上游：v1.8.0 Phase 1+2（`7ca1ea7`）；`nodeCorner` 逆变换先例 `packages/react/src/render/MapView.tsx:1019`
- 约定：中文 JSDoc；每任务一 commit；测试 `tests/{模块}-{场景}.test.ts(x)`；改完跑**等价门禁**（vitest 直连 + tsc + biome + budget）

---

### Task 1: MapViewApi 两个只读 API（nodeBox / subtreeBoxes）

**Files:**
- Modify: `packages/react/src/render/MapView.tsx`（接口 ~L247；实现紧随 `nodeCorner`）
- Test: `packages/react/tests/mapview-nodebox.test.tsx`（新建）

**Interfaces:**
- Produces:
  - `nodeBox(id): { x; y; w; h; k } | null` —— 节点盒客户端坐标 + 当前缩放 k（幽灵间距折算用）
  - `subtreeBoxes(id): Array<{ id; x; y; w; h }>` —— 可见子树（含自身，`ln.children` 遍历）；未知 id → `[]`

- [ ] **Step 1: 写失败测试**（仿 `mapview.test.tsx` 的 `smallLayout()` 夹具）

```tsx
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { MapViewApi } from '../src/render/MapView.js';
// …smallLayout 同 mapview.test.tsx（makeTextNode/astToEditable/createCharMeasure/createNodeMeasure/layoutMindmap）

it('nodeBox/subtreeBoxes：客户端坐标 + 缩放 + 子树遍历', () => {
  const { layout, char } = smallLayout();
  const apiRef: { current: MapViewApi | null } = { current: null };
  render(<MapView layout={layout} entities={new Map()} char={char} apiRef={apiRef} />);
  const api = apiRef.current!;
  const rootId = layout.nodes.find((n) => n.parentId === null)!.node.id;
  const nb = api.nodeBox(rootId)!;
  expect(nb.w).toBeGreaterThan(0);
  expect(nb.k).toBeGreaterThan(0);
  expect(api.nodeBox('不存在')).toBeNull();
  const sub = api.subtreeBoxes(rootId);
  expect(sub.length).toBe(layout.nodes.length); // smallLayout 全展开
  expect(api.subtreeBoxes('不存在')).toEqual([]);
});
```

- [ ] **Step 2: 跑红**：`node <vitest> run tests/mapview-nodebox.test.tsx --root packages/react` → FAIL（方法不存在）
- [ ] **Step 3: 实现**（接口 + 实现，`nodeCorner` 同款逆变换 `screen = world * k + t`）
- [ ] **Step 4: 跑绿**
- [ ] **Step 5: 提交** `feat(react): MapViewApi 补 nodeBox/subtreeBoxes（幽灵预览只读逆变换）`

---

### Task 2: 纯函数 ghostBoxOf（四向落点 + 视口内收）

**Files:**
- Create: `apps/canvas/src/radialGhost.ts`
- Test: `apps/canvas/tests/radial-ghost.test.ts`（新建）

**Interfaces:**
- Produces: `ghostBoxOf(node: { x; y; w; h; k }, dir: GrowDir, vw: number, vh: number): { x; y; w; h }`
  - 水平隔 `H_GAP`（64 世界单位）× k；垂直隔 `V_GAP`（14）× k；盒尺寸 = 节点盒尺寸
  - 视口内收：`clamp(_, EDGE_PAD, vw - w - EDGE_PAD)`（决策 A1；视口过小时尽力）

- [ ] **Step 1: 写失败测试**

```ts
import { ghostBoxOf } from '../src/radialGhost';
const nb = { x: 400, y: 300, w: 120, h: 30, k: 1 };
it('右/下：按 H_GAP / V_GAP 落点', () => {
  expect(ghostBoxOf(nb, 'right', 1024, 768).x).toBe(400 + 120 + 64);
  expect(ghostBoxOf(nb, 'down', 1024, 768).y).toBe(300 + 30 + 14);
  expect(ghostBoxOf(nb, 'left', 1024, 768).x).toBe(400 - 120 - 64);
  expect(ghostBoxOf(nb, 'up', 1024, 768).y).toBe(300 - 30 - 14);
});
it('贴视口边缘向内收', () => {
  const g = ghostBoxOf({ ...nb, x: 990, y: -20 }, 'right', 1024, 768);
  expect(g.x + g.w).toBeLessThanOrEqual(1024 - 8);
  expect(g.y).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现** → **Step 4: 跑绿**
- [ ] **Step 5: 提交** `feat(canvas): ghostBoxOf 幽灵落点纯函数（四向 + 视口内收）`

---

### Task 3: 覆盖层 props + 样式

**Files:**
- Modify: `apps/canvas/src/hooks/useRadialStage.tsx`（`RadialStageOverlay` props/渲染）
- Modify: `packages/react/src/chrome/radialSurface.tsx`（`RADIAL_SURFACE_CSS` 增 `.ghost-node`/`.danger-box`，镜像预览页样式）
- Test: `apps/canvas/tests/radial-stage.test.tsx`（追加渲染用例）

**Interfaces:**
- `RadialStageOverlay({ radial, ghost = null, dangerBoxes = [] })`：
  - `ghost?: { x; y; w; h; label: string } | null`（z-index 59，环 60 之下）
  - `dangerBoxes?: ReadonlyArray<{ x; y; w; h }>`

- [ ] **Step 1: 写失败测试**（渲染零/有时）

```tsx
it('ghost/danger 渲染：缺省零渲染；传入即显', () => {
  const mk = (): RadialStage => ({ state: RADIAL_IDLE, charge: 0, inDead: false, confirm: null, settleConfirm: () => {}, handleKey: () => false });
  const { container, rerender } = render(<RadialStageOverlay radial={mk()} />);
  expect(container.querySelector('.ghost-node')).toBeNull();
  rerender(<RadialStageOverlay radial={mk()} ghost={{ x: 10, y: 20, w: 120, h: 30, label: '新节点' }} dangerBoxes={[{ x: 1, y: 2, w: 30, h: 10 }]} />);
  expect(container.querySelector('.ghost-node')?.textContent).toContain('新节点');
  expect(container.querySelectorAll('.danger-box')).toHaveLength(1);
});
```

- [ ] **Step 2: 跑红** → **Step 3: 实现** → **Step 4: 跑绿**
- [ ] **Step 5: 提交** `feat(canvas,react): RadialStageOverlay 幽灵/删除预告层`

---

### Task 4: MindmapStage 接线（单一动作源）

**Files:**
- Modify: `apps/canvas/src/MindmapStage.tsx`

**Interfaces:**
- Consumes: `apiRef.current.nodeBox/subtreeBoxes`（T1）、`ghostBoxOf`（T2）、`itemAt/RADIAL_ITEMS_V1`、既有 `preDirsRef/getNode/inferChildDir`
- 逻辑：`useMemo([radial.state.phase, radial.state.highlight, controller.selectedId])`
  - phase==='ring' 且高亮项 id==='add-child' → `ghost = { ...ghostBoxOf(nodeBox, dir, innerWidth, innerHeight), label: '新节点' }`；`dir` 与 addChild 命令同源
  - 高亮项 id==='delete' → `dangerBoxes = api.subtreeBoxes(sel)`
  - 其余 → 零渲染

- [ ] **Step 1: 接线 + `tsc` 过**（视觉层不做单测，由 T2/T3 纯函数与渲染测试覆盖）
- [ ] **Step 2: 手工清单**（页面）：四向节点各试一次「新建」幽灵落点 / 「删除」子树描边 / 贴边内收 / 提交后消失 / 无高亮零渲染
- [ ] **Step 3: 提交** `feat(canvas): 环内高亮联动幽灵预览与删除预告`

---

### Task 5: 收尾验证

- [ ] canvas + react 全量套件绿；`tsc`（canvas/react/kernel）绿；`biome lint` 绿；`budget` 绿
- [ ] CHANGELOG 记 ① 行；设计文档状态更新为「① 已实现（A1=内收）」
- [ ] 提交 `docs: ① 幽灵预览设计/计划与 CHANGELOG`
