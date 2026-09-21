# FO-HYG1 外派任务书：框编辑系列工程卫生收尾

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-HYG1**（文档 + 注释收口）。**前置：FO-UI1.1 已验收 `f3cedf3`，用户确认深度气泡已修复。**  
> 本批**只做卫生**：入库 FO 相关 docs、编号注释对齐、总览标「系列冻结」。**不 push**（push/PR 留给主控另令）。

## 你的角色

工程执行 agent。显式路径 `git add` + 少提交；禁 `git add -A`；禁 push；不动产品逻辑与布局几何（除注释字符串替换）。

## 目标

1. 把仍散落未跟踪的 **FO 派发/修正案** 入库。  
2. 更新总览：全系列已验收、**功能外派冻结**。  
3. 源码注释里误写的 **「FO-FIX5」→「FO-UI1」**（UI1.1 相关可写 FO-UI1.1）。  
4. 回执给出建议 PR 标题/摘要（**不要**自己 `gh pr create` / `git push`）。

## 必读

1. `docs/dispatch/2026-09-15-fo-dispatch-overview.md`（当前状态表）  
2. 本文件「允许提交清单」——**只加清单内路径**  
3. 仓库纪律：不碰 `tools/graph-engine/`、`.codebase-memory/`、`.cursor/`、`_tmp_*`

## 允许提交清单（显式路径）

### A. 文档（优先一个 docs commit）

**已修改（纳入）**

- `docs/dispatch/2026-09-15-fo-dispatch-overview.md`  
- `docs/dispatch/2026-09-15-subtree-frame-outline-plan.md`（若 diff 属 FO；无关改动则**勿**纳入并回执说明）

**未跟踪 · 必须入库（FO 派发）**

- `docs/dispatch/2026-09-15-fo-c1-compact-wrap-prompt.md`  
- `docs/dispatch/2026-09-15-fo-c2-shell-collision-prompt.md`  
- `docs/dispatch/2026-09-15-fo-fix1-hang-subtree-prompt.md`  
- `docs/dispatch/2026-09-16-fo-c2.1-hang-envelope-shell-prompt.md`  
- `docs/dispatch/2026-09-16-fo-fix2-drop-desc-chip-prompt.md`  
- `docs/dispatch/2026-09-16-fo-fix3-hang-sibling-stack-prompt.md`  
- `docs/dispatch/2026-09-16-fo-fix4-hang-cross-parent-collision-prompt.md`  
- `docs/dispatch/2026-09-16-fo-ui1-frame-depth-stepper-prompt.md`  
- `docs/dispatch/2026-09-16-fo-ui1.1-depth-bubble-focus-prompt.md`  
- `docs/dispatch/2026-09-16-fo-hyg1-series-hygiene-prompt.md`（本文件）  
- `docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md`

**不要入库（本批）**

- `docs/dispatch/2026-09-15-h1-hygiene-plan.md`（另一条 H1 卫生线，非 FO）  
- `docs/research/2026-09-15-free-canvas-advanced-design-brief.md`（自由画布研究，非 FO）  
- `.codebase-memory/`、`.cursor/`、`tools/graph-engine/`、任意 `tmp` / `_tmp_*`

`outputs/*frame*` 若已在 git 中且 C2.1 报告已提交（`82ebfd8`）→ 本批无需再动；若有未提交 FO 报告 diff，仅显式加入 FO 相关 outputs。

### B. 注释对齐（可选第二 commit）

将下列路径中的 **`FO-FIX5` 改为 `FO-UI1`**（UI1.1 焦点修复相关句可写 `FO-UI1.1`，保持可读即可）：

- `apps/canvas/src/FrameDepthBubble.tsx`  
- `apps/canvas/src/MindmapStage.tsx`  
- `apps/canvas/src/NodeContextMenu.tsx`  
- `apps/canvas/tests/frame-depth-bubble.test.tsx`  
- `apps/canvas/tests/frame-outline-host.test.tsx`  
- `packages/react/src/edit/contextMenuItems.ts`  
- `packages/react/src/edit/frameCommands.ts`  
- `packages/react/src/edit/menuActionTypes.ts`（若有）  
- `packages/react/src/index.ts`  
- `packages/react/tests/frame-commands.test.ts`

**只改注释/字符串标签，不改行为。** 改完跑：

```bash
corepack pnpm --filter canvas exec vitest run tests/frame-depth-bubble.test.tsx tests/no-native-dialogs.test.ts
corepack pnpm --filter @mindcanvas/react exec vitest run tests/frame-commands.test.ts
```

## 总览文档须改内容

在 `2026-09-15-fo-dispatch-overview.md`：

1. 确认 UI1 / UI1.1 为 **已验收**（若尚未写上 `f3cedf3` 则补上）。  
2. 文首或文末增加 **「系列状态：功能外派冻结（FO-HYG1 收口后）」**。  
3. 可选债列表（一行即可）：UI2 框内右键菜单 / 成框选深 / 跨深度拖拽视觉 / 编辑态 Enter 链式 —— **标记为未开、不外派**。  
4. 本行加入 HYG1：**已验收** + 本 commit hash（回执填）。

## 提交计划（建议 2 个；禁 amend 除非主控要求）

```bash
# 1) 文档
git add \
  docs/dispatch/2026-09-15-fo-dispatch-overview.md \
  docs/dispatch/2026-09-15-subtree-frame-outline-plan.md \
  docs/dispatch/2026-09-15-fo-c1-compact-wrap-prompt.md \
  docs/dispatch/2026-09-15-fo-c2-shell-collision-prompt.md \
  docs/dispatch/2026-09-15-fo-fix1-hang-subtree-prompt.md \
  docs/dispatch/2026-09-16-fo-c2.1-hang-envelope-shell-prompt.md \
  docs/dispatch/2026-09-16-fo-fix2-drop-desc-chip-prompt.md \
  docs/dispatch/2026-09-16-fo-fix3-hang-sibling-stack-prompt.md \
  docs/dispatch/2026-09-16-fo-fix4-hang-cross-parent-collision-prompt.md \
  docs/dispatch/2026-09-16-fo-ui1-frame-depth-stepper-prompt.md \
  docs/dispatch/2026-09-16-fo-ui1.1-depth-bubble-focus-prompt.md \
  docs/dispatch/2026-09-16-fo-hyg1-series-hygiene-prompt.md \
  docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md
# （plan 若无关则从 add 列表去掉）

git commit -m "$(cat <<'EOF'
docs(fo): archive FO dispatch prompts and freeze series overview

EOF
)"

# 2) 注释（若有 FO-FIX5）
git add <上列源码/测试显式路径>
git commit -m "$(cat <<'EOF'
chore: rename FO-FIX5 comments to FO-UI1

EOF
)"
```

Windows PowerShell 若无 HEREDOC：用 `git commit -m "docs(fo): ..."` 单行等价即可。

## 禁止

- `git push` / `gh pr create` / `--force`  
- `git add -A` / `git add .`  
- 改 `frameLayout` / 产品行为 / CHANGELOG 大段（除非主控另令发版）  
- 提交 H1 计划、free-canvas research、graph-engine、codebase-memory  

## 回执格式

1. commits + `--stat`（每个）  
2. `git status -sb`：确认 FO docs 已跟踪；列出**仍 untracked 但故意未加**的路径  
3. FO-FIX5 替换处数量（rg 计数：仓内 FO 相关路径应为 0）  
4. 建议 PR（仅文案，不执行）：

```
标题：feat: subtree frame outline (1.10.0) + hang fixes + depth bubble
摘要：
- Batch A/B 框编辑 MVP
- C1/C2/C2.1 紧凑行 + 壳碰撞 + 挂出占位
- FIX1–4 挂出连线/扇出/跨岛推挤
- UI1/UI1.1 改框深度气泡与键位
测试计划：成框/拆框/改深度气泡 Enter 与 ±；挂出不叠、邻树被推开
```

5. 声明：未 push；未动 graph-engine  

## 验收对照（主控用）

- [ ] FO 派发 prompt + amendment + overview 已在 git 中  
- [ ] overview 标明系列冻结；HYG1 已验收  
- [ ] 源码无残留 `FO-FIX5`（或回执说明仅测试历史字符串）  
- [ ] 未 push；status 无误加敏感/无关目录  
