# FO-FIX2 外派任务书：去掉框内旁侧「注释」冗余预览

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-FIX2**（UX 冗余）。**前置：FO-FIX1 已验收。**  
> 用户原话：幕布注释是可显示的，此时旁侧注释预览没有意义，重复显示、冗余显示。

## 你的角色

工程执行 agent。删掉框内行旁侧 `注释 …` chip；正文折行宽度不再为 chip 预留列；幕布注释仍由既有 DescBlock/附属区显示与编辑。TDD。显式路径提交。不 push。

## 现象（截图已确认）

同一框内行同时出现：

1. **旁侧 chip**：`注释 简单测试`（`FrameOutline` · `data-frame-comment`）  
2. **幕布注释正文**：行下 `| 简单测试`（`DescBlock` / 附属区，高度由 `rowAuxH` → `estimateDescHeight` 预留）

二者内容同源（`note.desc`），重复。

## 口径（已裁定）

| 做 | 不做 |
|----|------|
| **删除**框内行旁侧「注释 …」预览 UI | 不删幕布注释显示（DescBlock 仍画在行下） |
| 折行宽**不再**扣除 `FRAME_OUTLINE_DESC_CHIP_W`（无 chip 则不必留列） | 不改 `note.desc` 协议；不新 WYSIWYG |
| 保留 Shift+Enter → `onDescEdit`（与全局幕布编辑同入口） | 不要求点击 chip（chip 已无） |

## 必读

1. `packages/react/src/chrome/FrameOutline.tsx`（chip 约 L305+；`onDescEdit` / Shift+Enter）  
2. `packages/kernel/src/layout/frameMeasure.ts` · `hasFrameDescChip` / `frameRowTextWidth` / `FRAME_OUTLINE_DESC_CHIP_W`  
3. `packages/react/src/demo/pipeline.ts` · `createFrameRowAuxH`（desc 高度仍预留）  
4. 相关测：`frame-outline.test.tsx`、`frame-layout.test.ts`（若断言 chip 列宽）

## 范围

**修改（预期）**

- `FrameOutline.tsx`：去掉 `data-frame-comment` 渲染块；清理仅服务于 chip 的样式/文案；头注释改「注释由幕布 DescBlock 显示」  
- `frameMeasure.ts`：`frameRowTextWidth` **不再**因 desc 扣 chip 宽（可删 `hasFrameDescChip` 或使其恒不影响宽）；常量 `FRAME_OUTLINE_DESC_CHIP_W` 若无引用则删除或标 deprecated  
- 更新断言 chip 存在/列宽扣除的测试；改为断言「有 desc 时无 `data-frame-comment`」+ 折行宽 = 整行内宽  
- 若导出面受影响：`packages/kernel/src/index.ts`

**禁止**

- 关掉 DescBlock / 取消 `rowAuxH` 的 desc 高度（那会弄没用户要的幕布注释）  
- 改 OutlinePanel；graph-engine；`git add -A`；push  

## 步骤

1. 红测：成框行带 `note.desc` → 布局后 **没有** `[data-frame-comment]`；`frameRowTextWidth` 有 desc / 无 desc 在同文案下可用宽一致（或有 desc 不再更窄）  
2. 删 chip + 取消列宽扣除 → 绿  
3. 确认 Shift+Enter 仍触发 `onDescEdit`（既有测或补一条）  
4. kernel/react 定向测 + 提交  

```bash
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/frame-layout.test.ts
corepack pnpm --filter @mindcanvas/react exec vitest run tests/frame-outline.test.tsx
```

建议 commit：`fix(react): drop redundant frame-row desc chip beside mubu annotation`

## 停止条款

- 发现框内行根本不渲染 DescBlock（只有 chip）→ 停报（与用户截图矛盾，需主控重裁）  
- 为去冗余而隐藏幕布注释 → 验收打回  

## 回执格式

1. commits + `--stat`  
2. 红→绿原文  
3. chip 删除位置；列宽公式变更（file:line）  
4. 声明：DescBlock/rowAuxH 仍在；Shift+Enter 仍可用  
5. 偏差  

## 验收对照（主控用）

- [ ] 有 `note.desc` 的框内行无旁侧「注释 …」  
- [ ] 行下幕布注释仍可见  
- [ ] 折行不再为幽灵 chip 列变窄  
- [ ] Shift+Enter 仍进 desc 编辑  
