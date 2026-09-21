# 给资产功能执行 agent 的纠偏简报（1.0.1 已修根因，请复验）

> 发出方：主线（mindcanvas 内核维护侧）· 日期：2026-08-29 · 优先级：**高**
> 适用：正在/曾经执行资产功能（AssetPanel / @img / @draw）开发任务的 agent

## 一、结论先行

你在 T6 中把「**@draw 缩略图不可辨识**」归因于「SVG 图形元素太简单」并据此增补了 `board.svg` 的图形内容——**这个归因不成立**。真实根因是：

> **布局引擎（`displayMetrics`）完全不知道资产存在，节点高度只由文本行数决定，导致图片被压进约 26px 高的条带并被压扁，同时文字叠加在图片之上。**

这不是内容问题，是**布局与渲染两层对节点高度的认知不一致**——属于设计缺陷，不是资产内容不够丰富。

## 二、证据（可在源码中逐条核对）

**证据 1 · 高度公式不含任何资产项**
```ts
// packages/kernel/src/layout/nodeLayout.ts（修复前）
const h = Math.max(MIN_H, lines.length * LINE_H + 12)  // ← 仅文本行数
```

**证据 2 · 内核侧无任何资产高度概念**
```
grep -rn "assetH" packages/kernel/src   →  零命中
```

**证据 3 · 渲染侧却把图片塞进文本高度**
```tsx
// packages/react/src/render/NodeG.tsx（修复前）
<image href={assetHref} x={4} y={4}
       width={b.w - 8} height={bodyH - 8}   // ← bodyH 即上面那个「文本高度」
       preserveAspectRatio="xMidYMid meet" />
```

**推算**：单行实体节点 `h = max(34, 16+12) = 34px` → 图片可用高度 `34-8 = 26px`。任意正常宽高比的图都会被 `meet` 压成 26px 高的细带。且 SVG 中 `text` 在 `image` 之后绘制（层叠顺序在上），**文字直接压在图上**。

**结论**：你看到的「缩略图不可辨识」是**压扁 + 遮挡**的合效果。增补图形元素无法改变这一点——图再复杂，压进 26px 还是不可辨识。

## 三、主线已完成的修复（1.0.1 · commit `4e542b6`）

| 项 | 修复 |
|---|---|
| **P0 布局高度** | `displayMetrics` 对 `img`/`draw` kind 追加可选 `assetH`（96px）并纳入高度公式；`NodeG` 改为**卡片式布局**：图片占顶部独立区（高度由内核预留），文本区下移，二者垂直分离不再重叠 |
| **P0 glass 连线对比度** | `linkStroke` `#3a3f4d` → `#646b7d`（对底色对比度 2.3:1 → 3.4:1） |
| **P1 展开态注释区几何** | 全圆角 `rect` → `path`（上半直角连体、下半圆角），消除三线叠加的粗横线 |
| **P2 加载失败降级** | `<image onError>` 隐藏图片区，纯文本呈现 |

回归测试：`packages/kernel/tests/wrap.test.ts` 新增 2 例（资产节点预留高度 + `issue.assetH === 0` 锁定非破坏性）。

## 四、请你执行三个动作

### 1. 拉取并复验
```bash
git pull origin main          # 拉到 4e542b6（1.0.1）
pnpm install && pnpm -r build && pnpm -r test
```
然后在浏览器打开 localhost:5180，检查 `@img` / `@draw` 节点是否已呈现**「上方图片 + 下方文件名」的卡片式布局**，图片是否不再被压扁、文字是否不再压在图上。

### 2. 停止「加图形元素」方向的优化
- 若你计划继续让 `board.svg` 更复杂以期改善可辨识度——**停下**，那是治标不治本
- 已增补的图形元素**可以保留**（无害，且让 demo 资产更有辨识度），但不要再投入

### 3. 回执
复验后在 `docs/dispatch/` 追加一份简短回执（现象是否消失 / 是否仍有问题 / 截图对比），主线据此判断是否还有残余问题。

## 五、如果你发现了其他资产相关问题

请在回执中**描述现象 + 给出源码位置**，不要直接改内核——`1.0.0` 起接口已冻结（ADR-0004）：
- `DisplayMetrics` 加**可选**字段 = minor（合规）
- 改既有公开签名 = **major，须先写 ADR**

## 六、本轮同步：提交纪律（多 agent 并行）

本次主线 `git add -A` 误将你的临时截图（`dogfood-output/` 165KB）卷入提交，已 `git rm --cached` 并加入 `.gitignore` 清理。请同步遵守：

1. **禁用 `git add -A`**，改为精确路径提交（`git add packages/react/src/...`）
2. 临时产物目录（`dogfood-output/`、`out/`、`*.log` 等）**创建后第一时间进 `.gitignore`**
3. 提交前 `git status --short` 逐行确认，发现不属于自己的文件**不要提交**
4. commit message 沿用 `类型(范围): 描述` 格式，涉及资产标注 `assets`

完整约定见 `docs/collab/parallel-agent-discipline.md`。
