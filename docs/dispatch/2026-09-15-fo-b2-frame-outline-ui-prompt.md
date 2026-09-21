# FO-B2 外派任务书：FrameOutline 框内大纲 UI

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-B2**（Batch B · Task 5）。**前置：FO-B1 已验收。** 完成后停，勿做 B3（e2e 收口可留给 B3，本阶段以组件+接线单测为主）。

## 你的角色

工程执行 agent。交付画布上的框壳 + `FrameOutline`：单击选中、双击编辑 text、image/entity 占位、Tab/Enter/indent 映射现有 controller；跨 depth 的 indent/outdent no-op。幕布注释一期优先复用既有入口，框内可只读展示。

## 必读

1. 设计稿 §4.3–4.5、§6  
2. 计划 Task 5  
3. `packages/react/src/chrome/OutlinePanel.tsx`（只读大纲视觉参考；**不可**把可写逻辑塞进它）  
4. `packages/react/src/edit/OverlayEditor.tsx` / `controller.startEdit`  
5. B1 已合入的布局盒 / 挂点数据如何从 MapView 取得（取证）

## 范围

**创建**

- `packages/react/src/chrome/FrameOutline.tsx`
- `packages/react/tests/frame-outline.test.tsx`

**修改**：MapView / Stage / chrome 导出等接线（回执列全路径）；必要时极小 CSS/主题 token。

**禁止**：改 Ctrl+D `OutlinePanel` 为可写；框内翻 `note.md`；框内编自由边；大纲内改 image url / entity ref；框内 ▸ 折叠落盘；大纲层嵌套成框。

## 行为清单（验收按此打勾）

| 行为 | 要求 |
|------|------|
| 渲染 | 成框节点显示框壳；大纲行 = partition 的 outline 层 |
| 选中 | 单击行 → 选中对应节点 id |
| 编辑 | 双击 text → 既有编辑态；失焦/提交纪律对齐现有节点 |
| 占位 | image/entity 行只读占位，点击选中 |
| 结构键 | Tab/Enter/indent/outdent → controller；越 depth 边界 no-op + 单测 |
| 注释 | 至少只读提示或复用菜单/Shift+Enter；勿新 WYSIWYG |
| 全局大纲 | OutlinePanel 仍只读 |

## 步骤

1. 组件单测红（渲染两行 + click onSelect）→ 实现 → 绿  
2. 画布接线：有 `note.frame` 走框壳+Outline；深层空间节点仍节点盒  
3. 跨 depth indent 测一条  
4. 提交；若改 react 源：**重建 react dist** 并写进回执  

```bash
corepack pnpm --filter @mindcanvas/react test -- --run tests/frame-outline.test.ts
# 或 .tsx；以实际文件名为准
```

建议 commit：`feat(react): FrameOutline editor shell for framed subtrees`

## 停止条款

- 无法在不破坏 NotePopover/翻卡的前提下接线 → 停报  
- 行数触 budget 上限 → 拆文件，勿超线硬塞  
- 把可写逻辑合并进 `OutlinePanel.tsx` → 验收打回

## 回执格式

1. commits + stat  
2. 测试原文  
3. 接线文件 file:line  
4. 注释策略（只读 / 复用哪条入口）  
5. dist 是否重建  
6. 偏差

## 验收对照（主控用）

- [ ] OutlinePanel 无写路径污染  
- [ ] 行为表逐项有测或 e2e 留 B3 的明确列表  
- [ ] 跨 depth 结构键 no-op  
- [ ] 非目标未做
