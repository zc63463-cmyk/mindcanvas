# FO-A3 外派任务书：partition + 成框命令 + 右键菜单

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-A3**（Batch A · Task 3 / Batch A 收口）。**前置：FO-A2 已验收。** 完成后 Batch A 结束，等验收；**勿开 Batch B**。

## 你的角色

工程执行 agent。交付：`partitionFrameSubtree`；`createFrame` / `removeFrame` / `setFrameDepth`；右键「结构」菜单入口。数据可测；**不要求**框视觉布局/FrameOutline（属 B1/B2）。

## 必读

1. 设计稿 §4.1–4.2、§5.1（挂点语义，便于 partition 命名正确）
2. 计划 Task 3（测试与命令伪代码）
3. `packages/react/src/edit/contextMenuItems.ts`（结构分区 `SEC.structure`）
4. `packages/react/src/edit/controller.ts` · `updateNote`（`undefined` 删键）
5. 参考测试构造：`packages/react/tests/growdir-growth.test.ts`

## 范围

**创建**

- `packages/kernel/src/layout/framePartition.ts`
- `packages/kernel/tests/frame-partition.test.ts`
- `packages/react/src/edit/frameCommands.ts`
- `packages/react/tests/frame-commands.test.ts`

**修改**

- `packages/kernel/src/index.ts`
- `packages/react/src/edit/contextMenuItems.ts`
- `packages/react/src/edit/index.ts`（若需导出 frameCommands）

**禁止**：MapView 布局岛；FrameOutline 组件；改 sections；改 graph-engine；实现完整深度步进器 UI（默认 depth=2 即可；改深度可用 `prompt`）。

## 必须交付的 API

**kernel**

```ts
export interface FrameHangRoot {
  outlineNodeId: string;
  spatialRoot: EditableNode;
}
export interface FramePartition {
  outlineIds: string[];
  hangRoots: FrameHangRoot[];
}
export function partitionFrameSubtree(frameRoot: EditableNode, depth: number): FramePartition
```

规则：`outlineIds` = 相对深度 ∈ `[0, depth]`；对每个 `d===depth` 的节点，其每个孩子各一条 `hangRoots`。

**react**

```ts
createFrame(controller, id, depth): boolean
removeFrame(controller, id): boolean
setFrameDepth(controller, id, depth): boolean
```

- 成框前 `canCreateFrame`；depth 经 `clampFrameDepth(..., subtreeMaxRelativeDepth(node))`  
- 写盘：`controller.updateNote(id, { frame: { version: 1, depth: d } })` 或 `{ frame: undefined }`  
- 菜单：无 frame 且可成框 →「成框编辑…」（默认 depth 2）；有 frame →「改框深度…」+「拆框」

## 步骤

1. partition 测试红 → 实现 → 绿  
2. frameCommands 测试红 → 实现 → 绿（含 undo 一条）  
3. 菜单接线 + 必要单测（至少 commands 测覆盖成框失败路径）  
4. 提交（可 1～2 个 commit，勿混无关文件）

```bash
corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame.test.ts tests/frame-partition.test.ts
corepack pnpm --filter @mindcanvas/react test -- --run tests/frame-commands.test.ts
```

建议 commits：

```
feat(kernel): partition framed subtree into outline and hang roots
feat(react): create/remove/set frame commands and context menu
```

## 停止条款

- `updateNote` 无法删 `frame` 键 → 停报（预期 `undefined` 已支持）  
- 菜单文件行数爆 budget → 提取小函数，勿无声超线  
- 开始改 MapView 布局 → 超出范围，停

## 回执格式

1. commit hash(es) + stat  
2. kernel / react 测试原文  
3. 菜单项 label 列表（成框/拆框/改深度）  
4. 声明：无 FrameOutline、无布局岛接线  
5. 偏差

## 验收对照（主控用）

- [ ] partition：depth=1 / depth=2 用例与计划一致  
- [ ] 成框失败（大纲层）不写 note；成功可 undo  
- [ ] 右键可见入口；默认 depth 2  
- [ ] Batch A 无画布布局大改  
- [ ] `git status` 无把 `.codebase-memory` / graph-engine 打进提交
