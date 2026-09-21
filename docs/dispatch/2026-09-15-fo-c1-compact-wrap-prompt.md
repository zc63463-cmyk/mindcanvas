# FO-C1 外派任务书：框内紧凑大纲行 + 自动换行

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-C1**（产品修正批）。**前置：FO 系列 B3 已验收（`90fcc16` / `[1.10.0]`）。**  
> 完成后停，等验收；**勿做 FO-C2（碰撞占位）**。

## 你的角色

工程执行 agent。修正框内呈现：text 行紧凑、固定列宽自动换行、编辑态同宽换行；去掉单行 ellipsis 裁切。TDD。显式路径提交。不 push。

## 必读（按序）

1. `docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md`（本批口径）
2. `packages/react/src/chrome/FrameOutline.tsx`（现状：`whiteSpace: nowrap` + ellipsis，约 L269–280）
3. `packages/kernel/src/layout/frameLayout.ts` · `layoutFrameIsland`（行盒现用 `measure(node)` = 节点卡尺寸）
4. `packages/kernel/src/layout/wrap.ts` + `nodeLayout.ts` 的 `wrapText` / `LINE_H`（换行事实源，优先复用）
5. `packages/react/src/edit/OverlayEditor.tsx`（现编辑态；框内需换行 textarea 或等价，勿再「lineHeight = 单行盒高」）

## 用户原话（验收对照）

> 内部还是有节点类型，文本框类型的话，编辑等等紧凑一些，且文本内容不用被裁剪，会自动换行。

## 范围

**预期修改**

- `packages/kernel/src/layout/frameLayout.ts`（及必要时新建 `frameMeasure.ts`）：框内大纲行**专用度量**，禁止对 text 大纲行直接用画布节点卡 `measure`
- `packages/react/src/chrome/FrameOutline.tsx`：紧凑行 UI + 换行展示
- 编辑态：框内 text 双击 → 多行/自动增高编辑（可新小组件或扩展 OverlayEditor 模式）；失焦/提交纪律对齐既有节点编辑
- 测试：`packages/kernel/tests/frame-layout.test.ts` 追加；`packages/react/tests/frame-outline.test.tsx` 追加；必要时 mapview 定向测

**禁止**

- FO-C2：框壳写入 `separate` / 外层占位碰撞（可预留 `outlineHeight`/`shell` 尺寸字段供 C2，但本阶段不接线 separate）
- 改 `OutlinePanel` 为可写；新 `type`；动 `tools/graph-engine/`；`git add -A`；push
- 放宽既有阈值测试；大改升格 `islands.ts`

## 必须交付的行为

### 度量（kernel）

- 常量例如：`FRAME_OUTLINE_CONTENT_W`（建议 200–240，与 `TITLE_MAX_TEXT` 解耦并在文件头注释写死取值理由）
- text 大纲行：`w = CONTENT_W - indent(rel)`（或整列同宽、缩进只影响 x）；`h = pad + LINE_H * lines.length`（`wrapText` 按内容宽折行）；**明显小于**同节点画布卡默认高（单测：同文案 `frameRowMeasure.h < measure(node).h` 或 `h` 接近 `LINE_H * n`）
- image/entity 大纲行：扁占位高（常量，如 1–2 行高），不跑资产大预览高
- `layoutFrameIsland` 用上述度量排行；`outlineHeight` 随换行增高

### 渲染（FrameOutline）

- text：`whiteSpace: normal` / 等价；**禁止** `nowrap` + `ellipsis` 作为正文默认
- 长文完整可见（在行盒内换行），不裁切中段
- 视觉：弱化「节点卡」感（少圆角底/大 padding；选中可用细 inset，勿整卡阴影）
- image/entity：保留 `data-frame-placeholder`；更扁

### 编辑

- text 双击：编辑面宽度 ≈ 行内容宽；自动换行；高度随内容（或最小多行）
- 提交后行盒与展示一致（同 wrap 口径）
- entity 仍不可双击改 url/ref

## 步骤建议

1. 写失败测：长字符串在框内度量产生 `lines.length >= 2` 且最终盒高 ≥ `2 * LINE_H`；渲染侧无 ellipsis 样式或快照断言无 `textOverflow: ellipsis` 于正文  
2. 实现 frame 行度量 + `layoutFrameIsland` 改用  
3. FrameOutline 换行 UI  
4. 编辑态换行  
5. 跑相关测 + 重建 react dist  
6. 提交（1–2 个 commit）

```bash
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/frame-layout.test.ts
corepack pnpm --filter @mindcanvas/react exec vitest run tests/frame-outline.test.tsx tests/mapview-frame-outline.test.tsx
```

建议 commit：`fix(react): compact wrapping rows inside frame outline`

## 停止条款

- 换行必须复制一套与 `wrapText` 不一致的折行算法且无法对齐 → 停，优先复用 kernel `wrapText`  
- 发现必须先做 C2 碰撞才能量行宽 → 停报（本批列宽用常量即可）  
- 改 separate / 基座 measure 通道 → 属 C2，停

## 回执格式

1. commits + `--stat`  
2. 测试红→绿原文  
3. `FRAME_OUTLINE_CONTENT_W` 最终取值  
4. 编辑态如何实现（文件:line）  
5. 声明：未做碰撞/separate；未改 OutlinePanel  
6. 偏差

## 验收对照（主控用）

- [ ] text 框内不再单行裁切；有换行增高证据  
- [ ] 行高/观感明显紧凑于节点卡  
- [ ] 编辑态可换行提交  
- [ ] 无 C2 碰撞接线
