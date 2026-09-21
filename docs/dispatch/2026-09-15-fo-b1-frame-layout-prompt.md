# FO-B1 外派任务书：框布局岛与挂点

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-B1**（Batch B · Task 4）。**前置：整批 FO-A（A1–A3）已验收。**  
> 本阶段**必须先取证再改代码**。完成后停，勿做 B2。

## 你的角色

工程执行 agent。把 `frameOf` 节点收成布局岛：大纲区排 `d≤depth`，`d=depth` 行出挂点，更深子树从挂点用**现有子树布局**继续排。跨 depth 拖拽改层级一期 no-op。

## 必读

1. 设计稿 §5（布局与挂点）全文  
2. 计划 Task 4  
3. `packages/kernel/src/layout/framePartition.ts`（已有切分）  
4. `packages/kernel/src/layout/forest.ts` / `mindmap.ts` / `islands.ts`（**只读理解**；升格岛 ≠ 框岛，勿混改语义）  
5. react 侧谁消费布局结果（MapView / Stage）— 自己 rg 取证

## 范围

**预期创建**

- `packages/kernel/src/layout/frameLayout.ts`（名称可微调，回执写准）
- `packages/kernel/tests/frame-layout.test.ts`

**修改**：布局编排 + 至多 **2 个** 消费侧文件（取证后钉名）。超过 2 个编排文件 → **停报**，拆派遣。

**禁止**：FrameOutline 完整编辑 UI（B2）；改 `projectIslands` 升格语义硬拧；新 `type`；graph-engine。

## 建议 API（可微调，须在回执写最终签名）

```ts
layoutFrameIsland(args: {
  frameRoot: EditableNode;
  depth: number;
  measure: MeasureFn;
  origin: { x: number; y: number };
  direction: GrowDir;
}): {
  boxes: Map<string, { x: number; y: number; w: number; h: number }>;
  outlineHeight: number;
  hangOrigins: Map<string, { x: number; y: number }>; // key = spatialRoot.id
}
```

## 步骤（强制顺序）

1. **取证段写入回执**：当前节点盒坐标产出函数 file:line；成框节点今日如何参与森林布局；拟改的 ≤2 个接线文件。  
2. 单测红：depth=1 三层树 → 大纲 id 有盒；spatialRoot.x > 大纲行右缘。  
3. 最小实现 + 接线。  
4. DnD/缩进跨 depth 边界 → no-op（至少一条测）。  
5. 提交。

```bash
corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame-layout.test.ts
# 若改了 react，追加对应包测试与重建 dist（回执注明）
```

建议 commit：`feat(kernel): layout frame islands with hang anchors`（react 接线可第二提交）。

## 停止条款

- 必须大改 `islands.ts` 升格语义才能成立 → **停并报告**，勿硬拧  
- 取证后发现接线面 >2 文件 → 停，请主控拆 prompt  
- 开始写 FrameOutline 编辑器 → 留给 B2

## 回执格式

1. **取证**（file:line 必填）  
2. commits + stat  
3. 测试原文  
4. 最终 API 签名  
5. 跨 depth 守卫如何做  
6. 偏差 / 是否触发停止条款

## 验收对照（主控用）

- [ ] 取证充分，改动面受控  
- [ ] partition 与 layout 一致使用相对深度  
- [ ] 挂出子树非「再实现一套布局算法」（应复用现有）  
- [ ] 无完整框内大纲编辑器  
- [ ] 升格 islands 语义无无关破坏（相关单测仍绿）
