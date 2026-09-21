# 子树框编辑（局部大纲 · 按深度挂载）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现设计稿 `docs/specs/2026-09-15-subtree-frame-outline-design.md`：节点持久成框（`note.frame`）、按 depth 切分大纲层与空间挂载层、框内可写大纲（内容 + 幕布注释）、成框/拆框/改深度进入撤销栈。

**Architecture:** 框不是新 `type`。kernel 提供 `Note.frame` 类型、`frameOf` / `setFrame` / `clearFrame`、相对深度与嵌套校验、以及「大纲层 vs 挂点」切分纯函数。react 在布局层把成框节点收成布局岛（大纲区 + 挂点出边），框内 UI 编辑同一棵 `EditableNode`；命令经 `controller.updateNote` 写 `frame`，与现有 undo 同路。

**Tech Stack:** TypeScript · `@mindcanvas/kernel` · `@mindcanvas/react` · Vitest · 现有 `EditorController` / `contextMenuItemsFor` / 森林布局

## Global Constraints

- 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md`（已认可）逐字为准
- **不新增** `EditableNode.type`；不采用方案 Y（子树搬进载荷）
- **不动** `tools/graph-engine/`；禁 `git add -A` / `git add .`；本系列默认 **不 push**
- 相对深度：框根 `d = 0`（**不要**误用 `depthOf`——后者文档根起算且 root=1）
- 嵌套：祖先框大纲层内（`1 ≤ d ≤ D`）拒绝成框；空间挂载层（`d > D`）允许
- `frame` **不进** `ANCHOR_NOTE_KEYS`（无锚字段）
- 与 `note.sections` 互不生成；Ctrl+D `OutlinePanel` 仍只读
- 一期不做：大纲内嵌套框、框内 ▸ 落盘、跨 depth 拖拽改层级、大纲内改 image/entity 资源字段、框内翻 `note.md` / 编自由边
- TDD：每任务先红后绿；门禁随包：相关 `pnpm` filter test + 触及包 tsc

---

## File Structure

| 文件 | 职责 |
|------|------|
| `packages/kernel/src/protocol/types.ts` | 增加 `FrameSpec` / `Note.frame?` |
| `packages/kernel/src/protocol/frame.ts` | **新建**：读写、校验 depth、嵌套策略 |
| `packages/kernel/src/layout/framePartition.ts` | **新建**：按 depth 切分 outlineRows / hangRoots（纯函数） |
| `packages/kernel/src/index.ts` | 导出上述 API |
| `packages/kernel/tests/frame.test.ts` | **新建**：协议与嵌套 |
| `packages/kernel/tests/frame-partition.test.ts` | **新建**：切分 |
| `docs/specs/2026-09-02-mm-md-protocol.md` | 登记 `frame` 字段 |
| `packages/react/src/edit/frameCommands.ts` | **新建**：成框/拆框/改深度（调 controller） |
| `packages/react/src/edit/contextMenuItems.ts` | 结构区增加成框/拆框/改深度入口 |
| `packages/react/src/edit/menuActionTypes.ts` | 可选 FrameMenuActions（若需宿主注入步进器） |
| `packages/react/tests/frame-commands.test.ts` | **新建** |
| `packages/react/src/chrome/FrameOutline.tsx` | **新建**：框内大纲 UI（后续任务） |
| `packages/react/src/render/…` + layout 接线 | 布局岛与挂点（后续任务；具体文件在 Task 4 钉死后改） |

**本计划分两批发派：**

- **Batch A（本文件 Tasks 1–3）**：协议 + 切分 + 成框/拆框/改深度命令（可无完整框视觉，但数据与菜单可用）
- **Batch B（Tasks 4–6，可另开派遣补布局细节）**：布局岛 + FrameOutline UI + e2e/门禁收口

Batch A 单独可测、可提交；Batch B 依赖 A。

---

### Task 1: `Note.frame` 类型 + `frame.ts` 访问器

**Files:**
- Create: `packages/kernel/src/protocol/frame.ts`
- Modify: `packages/kernel/src/protocol/types.ts`（在 `Note` 上增加 `frame?`；导出 `FrameSpec`）
- Modify: `packages/kernel/src/index.ts`（导出）
- Test: `packages/kernel/tests/frame.test.ts`
- Docs（本任务末步）: `docs/specs/2026-09-02-mm-md-protocol.md` 表增一行 `frame`

**Interfaces:**
- Produces:
  - `export interface FrameSpec { version: 1; depth: number }`
  - `export function frameOf(note: Note | undefined | null): FrameSpec | undefined`
  - `export function normalizeFrameDepth(raw: unknown): number | undefined` — 合法则返回整数 ≥1；否则 `undefined`
  - `export function setFrame(note: Note | undefined, depth: number): Note` — 写入 `{ version: 1, depth }`；depth 非法抛错或返回原 note（**选：非法 throw `Error('invalid frame depth')`**，命令层先校验）
  - `export function clearFrame(note: Note | undefined): Note | undefined` — 删 `frame` 键；若 note 变空对象可仍返回 `{}`

- [ ] **Step 1: Write the failing test**

```ts
// packages/kernel/tests/frame.test.ts
import { describe, expect, it } from 'vitest';
import { clearFrame, frameOf, normalizeFrameDepth, setFrame } from '../src/protocol/frame.js';

describe('frameOf / setFrame / clearFrame', () => {
  it('缺省无 frame', () => {
    expect(frameOf(undefined)).toBeUndefined();
    expect(frameOf({})).toBeUndefined();
  });

  it('读合法 frame', () => {
    expect(frameOf({ frame: { version: 1, depth: 2 } })).toEqual({ version: 1, depth: 2 });
  });

  it('非法 depth / version 读侧忽略', () => {
    expect(frameOf({ frame: { version: 1, depth: 0 } })).toBeUndefined();
    expect(frameOf({ frame: { version: 2, depth: 2 } })).toBeUndefined();
    expect(frameOf({ frame: { version: 1, depth: 1.5 } })).toBeUndefined();
    expect(frameOf({ frame: 'x' })).toBeUndefined();
  });

  it('setFrame 写入；clearFrame 删除', () => {
    const n = setFrame({ desc: 'keep' }, 3);
    expect(n.frame).toEqual({ version: 1, depth: 3 });
    expect(n.desc).toBe('keep');
    const cleared = clearFrame(n)!;
    expect(cleared.frame).toBeUndefined();
    expect(cleared.desc).toBe('keep');
  });

  it('normalizeFrameDepth', () => {
    expect(normalizeFrameDepth(2)).toBe(2);
    expect(normalizeFrameDepth(0)).toBeUndefined();
    expect(normalizeFrameDepth(-1)).toBeUndefined();
    expect(normalizeFrameDepth(1.2)).toBeUndefined();
    expect(normalizeFrameDepth('2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

在 `types.ts` 的 `Note` 中增加：

```ts
export interface FrameSpec {
  version: 1;
  depth: number;
}

// inside Note:
/** 子树框编辑（v1.x）：持久框模式；见 protocol/frame.ts */
frame?: FrameSpec;
```

`frame.ts` 实现 `frameOf`（version 必须严格 `=== 1`，depth 为有限整数 ≥1）、`normalizeFrameDepth`、`setFrame`、`clearFrame`。从 `index.ts` 导出。

- [ ] **Step 4: Run tests — expect PASS**

Run: `corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame.test.ts`

- [ ] **Step 5: Protocol doc line**

在 `docs/specs/2026-09-02-mm-md-protocol.md` 节点 note 字段表增加：

`| frame | {version:1, depth:number} | 子树框编辑（持久）；depth≥1，从框根起算前 depth 层进大纲 |`

修订历史加一行。不必改 parser（透传已支持 mapping）。

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/protocol/types.ts packages/kernel/src/protocol/frame.ts packages/kernel/src/index.ts packages/kernel/tests/frame.test.ts docs/specs/2026-09-02-mm-md-protocol.md
git commit -m "$(cat <<'EOF'
feat(kernel): add note.frame accessors for subtree outline frames

EOF
)"
```

---

### Task 2: 相对深度 + 嵌套校验 + 子树高度

**Files:**
- Modify: `packages/kernel/src/protocol/frame.ts`
- Test: `packages/kernel/tests/frame.test.ts`（追加）

**Interfaces:**
- Consumes: `EditableNode`, `getNode`, `findNode` from `treeOps`
- Produces:
  - `export function relativeDepth(frameRoot: EditableNode, nodeId: string): number | null`  
    — 框根自身 `0`；后代为路径边数；非框根子树内返回 `null`
  - `export function subtreeMaxRelativeDepth(frameRoot: EditableNode): number`  
    — 框根仅自身为 `0`；有孩子则取最深后代相对深度
  - `export type FrameDenyReason = 'not-found' | 'inside-ancestor-outline'`
  - `export function canCreateFrame(root: EditableNode, nodeId: string): { ok: true } | { ok: false; reason: FrameDenyReason }`  
    — 沿祖先链找最近 `frameOf(ancestor.note)`；若存在且 `relativeDepth(ancestor, nodeId) !== null` 且 `1 <= d && d <= ancestor.frame.depth` → deny `inside-ancestor-outline`；`d > depth` 或无祖先框 → ok（节点不存在 → `not-found`）
  - `export function clampFrameDepth(requested: number, maxRel: number): number`  
    — `max(1, min(requested, max(1, maxRel)))` 且不超过设计上限 `8`（与规格默认 UI 上限一致）

- [ ] **Step 1: Write the failing tests**

```ts
import { makeTextNode } from '../src/tree/treeOps.js';
import { canCreateFrame, relativeDepth, setFrame, subtreeMaxRelativeDepth } from '../src/protocol/frame.js';

describe('relativeDepth / nesting', () => {
  const leaf = makeTextNode('leaf');
  const mid = makeTextNode('mid', [leaf]);
  const side = makeTextNode('side');
  const root = makeTextNode('root', [mid, side]);

  it('relativeDepth from frame root', () => {
    expect(relativeDepth(root, root.id)).toBe(0);
    expect(relativeDepth(root, mid.id)).toBe(1);
    expect(relativeDepth(root, leaf.id)).toBe(2);
    expect(relativeDepth(mid, root.id)).toBeNull();
  });

  it('subtreeMaxRelativeDepth', () => {
    expect(subtreeMaxRelativeDepth(root)).toBe(2);
    expect(subtreeMaxRelativeDepth(side)).toBe(0);
  });

  it('deny create inside ancestor outline layer; allow hanging layer', () => {
    const framed = { ...root, note: setFrame(root.note, 1) }; // depth=1 → mid 在大纲层，leaf 在挂载层
    // 重新挂树：framed 为文档根
    const doc = { ...framed, children: [{ ...mid, children: [leaf] }, side] };
    expect(canCreateFrame(doc, mid.id)).toEqual({ ok: false, reason: 'inside-ancestor-outline' });
    expect(canCreateFrame(doc, leaf.id)).toEqual({ ok: true });
    expect(canCreateFrame(doc, side.id)).toEqual({ ok: true });
  });
});
```

（构造时注意 `makeTextNode` 赋新 id；测试里用变量引用同一节点对象。）

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** in `frame.ts`（DFS / 祖先链；祖先查找：从 `findNode` 得 parent 链，或自写 `ancestorsOf`）

实现提示：`canCreateFrame` 不要用 `depthOf`。对每个成框祖先计算 `relativeDepth(ancestorNode, nodeId)`。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/protocol/frame.ts packages/kernel/tests/frame.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): frame nesting guard by outline vs hanging depth

EOF
)"
```

---

### Task 3: `partitionFrameSubtree` + 成框命令 + 右键菜单

**Files:**
- Create: `packages/kernel/src/layout/framePartition.ts`
- Create: `packages/kernel/tests/frame-partition.test.ts`
- Create: `packages/react/src/edit/frameCommands.ts`
- Create: `packages/react/tests/frame-commands.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Modify: `packages/react/src/edit/contextMenuItems.ts`（「结构」区）
- Modify: `packages/react/src/edit/index.ts`（若需导出）

**Interfaces:**
- Produces (kernel):
  - `export interface FrameHangRoot { outlineNodeId: string; spatialRoot: EditableNode }`  
    — `outlineNodeId` 为 `d === depth` 的节点；`spatialRoot` 为其某个 `d === depth+1` 的孩子（该孩子整棵子树为空间层）
  - `export interface FramePartition { outlineIds: string[]; /** 含框根与 1..depth */ hangRoots: FrameHangRoot[] }`
  - `export function partitionFrameSubtree(frameRoot: EditableNode, depth: number): FramePartition`
- Produces (react):
  - `export function createFrame(controller: EditorController, id: string, depth: number): boolean`
  - `export function removeFrame(controller: EditorController, id: string): boolean`
  - `export function setFrameDepth(controller: EditorController, id: string, depth: number): boolean`  
    — 均：校验 → `updateNote`；失败 return false（不 toast；菜单可先 `window.alert` 或注入，一期允许 `console`/`alert` 极简，报告注明）

**partition 规则：**  
`outlineIds` = 所有 `relativeDepth ∈ [0, depth]` 的节点 id。  
对每个 `d === depth` 的节点，其每个孩子（相对 depth+1）各产生一条 `hangRoots` 项。

- [ ] **Step 1: Failing partition tests**

```ts
// frame-partition.test.ts
import { describe, expect, it } from 'vitest';
import { partitionFrameSubtree } from '../src/layout/framePartition.js';
import { makeTextNode } from '../src/tree/treeOps.js';

describe('partitionFrameSubtree', () => {
  it('depth=1: children are hang roots; grandchildren spatial under them', () => {
    const g = makeTextNode('g');
    const c = makeTextNode('c', [g]);
    const root = makeTextNode('r', [c]);
    const p = partitionFrameSubtree(root, 1);
    expect(p.outlineIds.sort()).toEqual([root.id, c.id].sort());
    expect(p.hangRoots).toHaveLength(1);
    expect(p.hangRoots[0]!.outlineNodeId).toBe(c.id);
    expect(p.hangRoots[0]!.spatialRoot.id).toBe(g.id);
  });

  it('depth=2: hang at grandchildren', () => {
    const g = makeTextNode('g');
    const c = makeTextNode('c', [g]);
    const root = makeTextNode('r', [c]);
    const p = partitionFrameSubtree(root, 2);
    expect(p.outlineIds).toContain(g.id);
    expect(p.hangRoots).toHaveLength(0); // g 无孩子
  });
});
```

- [ ] **Step 2: Implement partition + export; tests PASS**

- [ ] **Step 3: Failing frameCommands tests**

用现有测试里 `EditorController` 构造方式（参考 `packages/react/tests/growdir-growth.test.ts`）：成框后 `frameOf(node.note)` 有值；`canCreateFrame` 失败时 root 不变；拆框删键；`updateNote` 进 undo（`undo()` 后 frame 消失）。

- [ ] **Step 4: Implement `frameCommands.ts`**

```ts
export function createFrame(controller: EditorController, id: string, depth: number): boolean {
  const check = canCreateFrame(controller.root, id);
  if (!check.ok) return false;
  const node = getNode(controller.root, id);
  if (!node) return false;
  const maxRel = subtreeMaxRelativeDepth(node);
  const d = clampFrameDepth(depth, maxRel);
  controller.updateNote(id, { frame: { version: 1, depth: d } });
  return true;
}
export function removeFrame(controller: EditorController, id: string): boolean {
  const node = getNode(controller.root, id);
  if (!node || !frameOf(node.note)) return false;
  controller.updateNote(id, { frame: undefined });
  return true;
}
export function setFrameDepth(controller: EditorController, id: string, depth: number): boolean {
  const node = getNode(controller.root, id);
  if (!node || !frameOf(node.note)) return false;
  const d = clampFrameDepth(depth, subtreeMaxRelativeDepth(node));
  controller.updateNote(id, { frame: { version: 1, depth: d } });
  return true;
}
```

- [ ] **Step 5: Menu items**

在 `contextMenuItemsFor` 的「结构」分区：

- 若节点无 frame 且 `canCreateFrame` ok → 「成框编辑…」→ 默认 `createFrame(c, id, 2)`（一期无步进器弹窗；深度固定默认 2，可随后 Task 加 prompt；**规格允许默认 2**）
- 若已有 frame → 「改框深度…」（一期 `window.prompt` 数字，非法则 no-op）+ 「拆框」

- [ ] **Step 6: Run kernel + react tests for new files — PASS**

```bash
corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame.test.ts tests/frame-partition.test.ts
corepack pnpm --filter @mindcanvas/react test -- --run tests/frame-commands.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/layout/framePartition.ts packages/kernel/tests/frame-partition.test.ts packages/kernel/src/index.ts packages/react/src/edit/frameCommands.ts packages/react/tests/frame-commands.test.ts packages/react/src/edit/contextMenuItems.ts packages/react/src/edit/index.ts
git commit -m "$(cat <<'EOF'
feat: frame partition helpers and create/remove frame commands

EOF
)"
```

---

### Task 4: 布局岛（Batch B · 骨架）

**Files:**（开工前先用 codebase-memory / 阅读钉死唯一接线文件）
- 预期 Create: `packages/kernel/src/layout/frameLayout.ts`（或 react 侧测量后回调 kernel 纯函数）
- Modify: 现有布局管道（`layoutForest` / `MapView` 消费点——**以取证为准，本步不得猜改超过 2 个编排文件**）
- Test: `packages/kernel/tests/frame-layout.test.ts`

**Interfaces:**
- Consumes: `partitionFrameSubtree`, `frameOf`
- Produces（建议）:
  - `export function layoutFrameIsland(args: { frameRoot: EditableNode; depth: number; measure: MeasureFn; origin: {x,y}; direction: GrowDir }): { boxes: Map<string,{x,y,w,h}>; outlineHeight: number; hangOrigins: Map<string,{x,y}> }`
  - 大纲行：固定行高启发式（可用 `measure` 测 text）；挂点 = 行右侧中点；对每个 `hangRoots.spatialRoot` 调用现有单子树布局并平移到挂点

- [ ] **Step 1: 取证** — 在报告中写下：当前节点盒位置从哪条函数产出（file:line）；成框节点今日如何参与森林布局。
- [ ] **Step 2: 最小单测** — 给定 `depth=1` 的三层树，断言：大纲 id 有盒；hang spatialRoot 的 x 大于 outline 行右缘。
- [ ] **Step 3: 接线** — 仅当 `frameOf(node.note)` 存在时走岛布局；拆框回旧路径。
- [ ] **Step 4: 跨 depth 拖拽 — 若现有 DnD 会跨层，加守卫 no-op（测一条）。
- [ ] **Step 5: Commit** `feat(kernel): layout frame islands with hang anchors`

**停止条款：** 若发现必须大改 `islands.ts` 升格语义才能成立 → **停并报告**，另立派遣，不在本任务硬拧。

---

### Task 5: `FrameOutline` UI（Batch B）

**Files:**
- Create: `packages/react/src/chrome/FrameOutline.tsx`
- Create: `packages/react/tests/frame-outline.test.tsx`
- Modify: `MapView.tsx` 或 Stage 渲染成框外壳（取证后钉路径）

**行为（规格 §4）：**
- 渲染 `outlineIds` 缩进列表；单击选中；双击编辑 text（复用 `OverlayEditor` / 现有 startEdit）
- 幕布注释：一期副行只读展示 `desc` 首行 + 「编辑注释」调既有 note/desc 入口（避免重做编辑器）；若时间紧，注释编辑可只靠既有 Shift+Enter / 菜单，框内仅显示有无标记
- image/entity：占位行，点击选中，不内联改 url/ref
- Tab/Enter：在框聚焦且未在 input 内时，映射 `controller.addChild` / `addSibling` / `indent`/`outdent`（与 keys 对齐）；**禁止**跨 depth 边界的 indent/outdent（`relativeDepth` 越界则 no-op + 测一条）

- [ ] **Step 1: 组件单测** — 渲染两行；click 调用 onSelect
- [ ] **Step 2: 接线画布** — 成框节点显示框壳 + FrameOutline；深层节点仍走节点盒渲染
- [ ] **Step 3: Commit** `feat(react): FrameOutline editor shell for framed subtrees`

---

### Task 6: 收口（文档 · e2e · 门禁）

**Files:**
- Modify: `CHANGELOG.md`（新版本段，版本号按当时 HEAD 递增）
- Create: `outputs/2026-09-15-subtree-frame-outline-report.md`
- Create: `apps/canvas/tests/frame-outline-host.test.tsx`（真 Stage：成框 → serialize 含 frame → 拆框键消失；挂载层再成框成功；大纲层成框失败）

- [ ] **Step 1: e2e 红 → 实现缺口补齐 → 绿**
- [ ] **Step 2: 门禁** — `tsc` 相关包 0；三包测试不下降；depcruise 零新环；budget 不超；**react 改源重建 dist**
- [ ] **Step 3: 报告** — 红/绿原文、嵌套用例、与 sections 无回归说明、`git status`（保留 `tools/graph-engine/`）
- [ ] **Step 4: 提交设计+计划若尚未入库**

```bash
git add docs/specs/2026-09-15-subtree-frame-outline-design.md docs/superpowers/plans/2026-09-15-subtree-frame-outline.md docs/dispatch/2026-09-15-subtree-frame-outline-plan.md CHANGELOG.md outputs/2026-09-15-subtree-frame-outline-report.md
git commit -m "$(cat <<'EOF'
docs: subtree frame outline design, plan, and delivery report

EOF
)"
```

（若设计/计划已提前单独提交，本步只交报告+CHANGELOG。）

---

## Spec coverage (self-review)

| 规格条目 | 任务 |
|----------|------|
| `note.frame` 协议 / 无新 type | T1 |
| 全保真、children 不搬 | T1–T3（只写元数据） |
| D1 深度切分 | T2–T4 |
| 嵌套：大纲禁、挂载允许 | T2、T6 e2e |
| 持久 P1 成框拆框改深度 | T3 |
| 布局挂点 | T4 |
| 框内大纲 UI + 幕布范围 | T5 |
| 非目标（新 type/Y/大纲嵌套/…） | Global Constraints；无任务实现它们 |
| 与 sections / OutlinePanel 边界 | Global + T5/T6 阴性说明 |

**开放事项（规格 §11）本期默认：** 无新快捷键；注释优先复用既有入口；`frame` 不进 ANCHOR；挂点朝向随当前生长方向（T4 取证后写死一条）。

---

## Execution notes

1. 先单独提交本计划与已认可设计稿（若仍未跟踪）。
2. **先跑 Batch A（T1–T3）** 再开 Batch B；Batch B 布局接线以取证为准。
3. 每任务结束可独立复核；不要跨任务攒一大提交。
