# FO-A2 外派任务书：相对深度与嵌套校验

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-A2**（Batch A · Task 2）。**前置：FO-A1 已验收合入。** 完成后停，勿做 A3。

## 你的角色

工程执行 agent。在已有 `frame.ts` 上增加：相对深度、子树最大相对深度、成框许可、depth clamp。TDD。不 push。

## 必读

1. 设计稿 §3.2（D1 深度）+ §3.3（嵌套：大纲层拒、挂载层允许）
2. 计划 Task 2（含测试草稿）
3. 已合入的 `packages/kernel/src/protocol/frame.ts`
4. `packages/kernel/src/tree/treeOps.ts` — 可用 `getNode` / `findNode`；**禁止**用 `depthOf` 充当框相对深度（`depthOf` 从文档根计且 root=1）

## 范围

**修改**

- `packages/kernel/src/protocol/frame.ts`
- `packages/kernel/tests/frame.test.ts`（追加用例）
- 若需导出：`packages/kernel/src/index.ts`

**禁止**：react/canvas；partition；菜单；改 A1 已稳定的 `frameOf` 合法读语义（除非测出 bug 并在回执写明）。

## 必须交付的 API

```ts
export function relativeDepth(frameRoot: EditableNode, nodeId: string): number | null
// 框根 = 0；后代 = 路径边数；不在子树内 = null

export function subtreeMaxRelativeDepth(frameRoot: EditableNode): number

export type FrameDenyReason = 'not-found' | 'inside-ancestor-outline'

export function canCreateFrame(
  root: EditableNode,
  nodeId: string,
): { ok: true } | { ok: false; reason: FrameDenyReason }

export function clampFrameDepth(requested: number, maxRel: number): number
// max(1, min(requested, max(1, maxRel), 8))  — 上限 8 与规格 UI 一致
```

**嵌套算法要点**：沿 `nodeId` 祖先链（不含自身）查找带合法 `frameOf(note)` 的最近祖先；计算候选相对该祖先的 `d`；若 `1 ≤ d ≤ ancestor.depth` → `inside-ancestor-outline`；若 `d > depth` 或无此类祖先 → ok。

## 步骤

1. 追加失败测试（计划 Task 2 代码；树用 `makeTextNode` 拼好再 `setFrame`）  
2. 实现 → 绿  
3. 提交

```bash
corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame.test.ts
```

建议 commit：

```
feat(kernel): frame nesting guard by outline vs hanging depth
```

## 停止条款

- 发现 A1 `frameOf` 行为与本阶段冲突 → 停，回执说明，勿 silently 改语义硬拧  
- 引入文档级 `depthOf` 混用且测试仍绿但语义错 → 验收会打回

## 回执格式

1. commit hash + `--stat`  
2. 测试原文  
3. 嵌套用例：大纲层拒绝 / 挂载层允许 各至少一条的断言名  
4. 确认未调用 `depthOf` 做相对深度（可贴 rg 或自证）  
5. 偏差

## 验收对照（主控用）

- [ ] `relativeDepth(root,root)===0`  
- [ ] `depth=1` 时子在大纲层拒、孙在挂载层允许  
- [ ] `clampFrameDepth` 尊重上限 8 与 `maxRel`  
- [ ] 无 react 改动
