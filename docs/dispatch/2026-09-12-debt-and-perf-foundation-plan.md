# 债务腾挪 + 性能地基 · 派遣计划（2026-09-12）

> **执行状态：待启动**（本文件为外派执行稿；全部事实已于 2026-09-12 只读实测取证，见 §1）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两个**可独立合并**的批次——
**A 债务腾挪**：腾出债务预算余量（`bigFiles 4/4 → 3/4`）+ 根治「IDE webview 静默吞掉原生对话框」的存量三处。
**B 性能地基**：pan/zoom 不再重建节点子树、裁剪与命中走空间索引、每帧父壳重渲降载——为后续 ③④ 环延伸与「自由画布」方向打底座。

**Architecture:**
- A 批是**纯搬迁 / 纯替换**（行为语义不变），每处替换同步从白名单删一行（`no-native-dialogs.test.ts` 的硬规则：修一处删一处）。
- B 批是**四步渐进**：先建立**可对照、可自动断言的度量**（P0）→ 空间索引（P1，kernel 纯函数 + 契约等价）→ memo 化（P2，机制指标 = pan 期节点 DOM 重建次数）→ 降载（P3）→ **复测后再决定是否做 transform-only DOM 路径（P5 是条件项，未达标才做）**。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19 / dependency-cruiser / Playwright（真浏览器，脚本放 `tools/`）

---

## 0. 基线与交付闸门

| 项 | 2026-09-12 实测 |
|---|---|
| 测试 | kernel **465** + react **966** + canvas **101** = **1532 全绿** |
| 债务预算 | any 0 / tsIgnore 0 / **bang 90（上限 90）** / **asCast 31（31）** / console 4（4）/ todo 1（1）/ defaultExport 2（2）/ **bigFiles 4（4）** → **全部零余量** |
| 门禁 | `pnpm gate` = typecheck && test && depcruise && lint && budget；`pnpm gate:fast` = 前者的去测试版 |
| 贴阈值文件 | `FileManager.tsx`(598) · `radialPreview.tsx`(592) · `useRadialStage.tsx`(570) · `packages/react/src/index.ts`(570) —— **再加十几行就会顶破 `bigFiles`** |

**每任务的完成定义（DoD）**：`tsc`（kernel/react/canvas 三包）绿 + `tsc -p packages/react/tsconfig.build.json` 重建 dist（canvas 经 project reference 消费 dist 类型）+ `depcruise` 0 + `biome lint` 绿 + `budget` 持平 + 相关分包测试绿 + **一条 commit**。

> ⚠️ 测试命令：`pnpm -r test` 在本机会 SIGTERM，**分包单跑**：
> `cd packages/react; node ../../node_modules/.pnpm/vitest@4.1.11_jsdom@30.0.1_vite@8.2.2/node_modules/vitest/vitest.mjs run [文件…]`
> （kernel / apps/canvas 同构；改源码后首次冷启动可能挂起 → 先单跑一个小文件预热）

---

## 1. 实现前必读（2026-09-12 只读取证结论，带 file:line）

**渲染与视口**
1. 视口状态**不在 React state**：`render/viewport.ts:20-26`（`Transform{k,x,y}`）、`:61-64`（`ViewportController` 类字段）、`:82,290,293-296`（`epoch` + `frame.request` 单帧合批）。唯一 React 出口：`render/MapView.tsx:599` 的 `useSyncExternalStore`。
2. **一次 pan = 整个 MapView 渲染体重算**：`MapView.tsx:746-754`（`visibleNodes` filter+map，**无 memo**）→ `:1490-1580` 逐节点重建 `<NodeG>`；`packages/react/src` 全仓**没有任何 `React.memo`**（`MapView.tsx:22-34` 未导入 memo，`NodeG.tsx:68` 是普通函数组件）。
3. 投影唯一入口：`MapView.tsx:1299` 的 `<g transform={translate(x y) scale(k)}>`（x/y/k 在 `:1174-1179` 做过有限性自愈）；Canvas 后端等价于 `canvasBackend.tsx:136-157`（`ctx.setTransform` 在 `:151`）。
4. **每帧还有一次父壳重渲**：`MapView.tsx:983-1001` 每 epoch 调 `onStats(新对象)` → `apps/canvas/src/MindmapStage.tsx:154,1408` setState → 2000+ 行主壳重渲（`PerfPanel` 常显，`:1607`）。**这是最便宜的高收益项**。
5. `CULL_MARGIN = 128`（`MapView.tsx:266-267`）是**双重应用**：`view = worldRect(128)`（`:441`）再 `isBoxInView(..., 128)`（`:747`）→ 实际 ≈256px；判定共 6 处（`:441,747,759,761,801-805,835-839`），section 用 `margin 0`（`:1305`）。**本批不动 margin**（文档/脚本把它当事实口径，且 `tests/mapview-section-drag.test.tsx:27-33` 靠它撑开 jsdom 1×1 视口）。
6. **`viewport.transform` 是原地 mutate 的稳定引用**——放进 `useMemo` deps 等于「永不失效」。正确写法样例：`MapView.tsx:819,844`（用 `view.x/y/w/h` primitive）；**可疑样例**：`:412-435`（`noteTargets` deps=`viewport.transform` → pan 后坐标可能陈旧）、`:448-459`（`fixedNotePanels` deps 用 `view` 对象 → 每渲染必重算全量索引，`fixedNotePanels.ts:86-87`）。

**LOD**
7. LOD 判据**已经是「zoom 为主 + 节点数修饰」**（不是纯按总节点数）：`render/geometry.ts:288-303`（`LodLevel` / `LOD_AUTO_NODES=5000` / `lodFor(k, nodeCount)`）。消费方：`MapView.tsx:635,1525,1608,1648,1371,288-295,1487`；note 另有第二套档位 `fixedNotePanels.ts:14-32`（0.65/0.35）。**平移不改 k → LOD 天然不变**；真正需要「冻结」的是**缩放手势跨越阈值期间**（现无冻结逻辑，唯一冻结是拖岛期禁滚轮 `MapView.tsx:1107`）。

**命中与 O(N) 遍历**
8. 节点点击/悬停 = **几何遍历**：`useMapGestures.ts:81-103` `hitNodeAt(visible, w, skip?)`（**自后向前** + 6px 容差）；调用点 `:180`（pointerdown）、`:256`（拖拽悬停目标）、`:287`（**每次 pointermove 一次**）、`:352`（pointerup）；另 `MapView.tsx:1262,1268`（右键/双击）。DOM 原生命中只覆盖局部元素（折叠三角 `NodeG.tsx:221-241`、自由边 `FreeEdgeLayer.tsx:310-312,413-451`、Section `SectionLayer.tsx:69,75,114,175`、连接手柄 `MapView.tsx:1746-1762`）。
   ⚠️ `MapView.tsx:1277` 注释里的 `nodeHitTest` 是**陈旧注释**（全仓 0 命中），别被误导。
9. 其余 O(N) 消费方（索引化时的候选点）：11 处 `layout.nodes.find`（`MapView.tsx:416,532,876,877,1014,1026,1034,1047,1666,1708,1714`）、`nodeDrag.ts:62,80,103`（每次拖拽 pointermove）、`overlays.tsx:131,186`、**`SearchPanel.tsx:20` 在渲染体内直接 `search(query)`**（`search.ts:46-69` 全树 walk，无 memo）、`OutlinePanel.tsx:82-95,136-143`（递归渲染整树）、`fixedNotePanels.ts:86-87`；kernel 侧 `getNode` 是 DFS（`kernel/src/tree/treeOps.ts:79-82`）。
10. **pan 每帧还会重算全部自由边路由（O(E×N)）**：`MapView.tsx:829-844`（`visibleFreeEdges` deps 含 `view.x/y/w/h`，产出**新数组 identity**）→ 击穿 `FreeEdgeLayer.tsx:139-175` 的 `routes` useMemo → 每条边 `freeEdgeEndpoints`（`freeEdges.ts:341,367` 各调一次 `collapsedAncestors`，后者是 O(N) DFS：`reveal.ts:8-27`）+ 每边对全量 obstacles `filter+map`（`FreeEdgeLayer.tsx:155-157`）。
    ⚠️ `FreeEdgeLayer.tsx:136-138` 的注释声称「pan/zoom 不触发重算」——**注释与实现不符**；现有回归只守护「identity 稳定时不重复回调」（`tests/free-edges.test.tsx:1196-1225`），**不守护 pan**。

**数据结构与可复用工具**
11. `LayoutNode { node; box; side; depth; parentId; children }`，`layout.nodes` = **前序遍历数组**（非空间序）：`kernel/src/layout/mindmap.ts:24-39`。MapView 侧派生 `derived.boxes: Map<id,Box>`（`MapView.tsx:614-624`，查 id O(1) 但无空间序）；障碍集 `edgeObstaclesOf` → `{id,box}[]`（`:288-295`）。全仓**无四叉树/网格桶/`.sort(`**（0 命中）。
    可复用盒/相交工具（均已导出）：`kernel/src/layout/cull.ts:15-28,47-60`（`worldViewportRect` / `isBoxInView` / `filterVisibleLinks`）、`separate.ts:80-88`（`overlapXOf/overlapYOf/boxesIntersect`）、`linkClear.ts:92-108`、`render/dropSensing.ts:73-90`。

**预算与既有性能门禁**
12. `scripts/check-code-budget.mjs:21-30` 逐项预算 + `:32` `BIG_FILE_LIMIT = 600`；**只统计 `.ts/.tsx`**（`:40`），排除 `tests|*.test.*|*.config.*`（`:50-56`）→ **`scripts/**/*.mjs`、`apps/canvas/scripts/**`、`tools/**` 不计入预算**（基准脚本放这里最安全）。
13. 会被本批触碰的既有性能门禁（**不得放宽**）：`packages/react/tests/perf.test.ts:83`（layoutMs<250）、`:85`（viewMs<12）、`perf-scale.test.tsx:40-57`（首帧 <5000ms）、`edit-perf.test.ts:82`（<100ms）、kernel `benchmark-layout.test.ts:67,78,80`、`layout-incremental.test.ts:178`（增量 < 全量×0.3）。
14. 契约类测试（改 API 前先读）：`acceptance-10k.test.tsx:40-45`（measure/collapsed **必须复用同一引用**，否则 LayoutCache 永不命中）、`mapview-nodebox.test.tsx:39-58`（`api.nodeBox` → `{x,y,w,h,k}`、未知 id → `null`；`subtreeBoxes` → 含自身 / 未知 → `[]`）、`mapview-section-drag.test.tsx:27-33`（jsdom 视口 1×1）。

**层级与脚本坑**
15. kernel 是纯层（受 depcruise 守护，`.githooks/pre-commit:31-45`），可被 react 与 node 脚本复用；`apps/canvas/scripts/*.mjs` 直引 `.ts` 源码时 **`node scripts/x.mjs` 别名可能跑不起来**（既有记录：需 `npx vite-node`，见 `docs/2026-09-02-next-steps.md:159-161`）。真浏览器脚本用 `tools/` 下的 Playwright 形态（先例：`tools/verify-delete-subring.mjs`，含 playwright-core 的绝对路径引法与 `addInitScript` 记账，按本机实际路径复制）。

---

## 批次 A · 债务腾挪（预计 0.5 天）

### A-D1: EdgeEditor 拆分（`bigFiles 4 → 3`）

**Files:**
- Create: `packages/react/src/chrome/edgeEditorShared.tsx`
- Modify: `packages/react/src/chrome/EdgeEditor.tsx`（808 行 → 目标 <520）
- 不动测试：`packages/react/tests/edge-editor.test.tsx`（该文件通过 `EdgeEditor.tsx` 的导出消费纯函数）

**现状结构（LSP documentSymbol 实测）**：纯逻辑与样式在 **1–320**（`REL_TEMPLATES` / `TreeEdgeAnn` / `NodeChoice` / `collectNodeChoices` / `appendEdge` / `patchEdgeAt` / `mergeStyleAt` / `findDuplicateEdge` / `removeEdgeAt` / `edgesOf` / `POP_WIDTH` / `popStyle` / `inputStyle` / `headRow` / `closeBtn` / `DirToggle` / `RoutingSideToggle` / `StyleRow` / `EDGE_STYLE_PRESETS` / `clampPos`）；组件在 **325–808**（`EdgeEditor`、`TreeEdgeEditor`、`LinkCreator`）。

**Interfaces:** 搬迁后 `EdgeEditor.tsx` 必须 **re-export** 上述全部公开符号（`export * from './edgeEditorShared.js'` 或显式具名 re-export——**用显式具名**，与仓库 `index.ts` 的显式出口风格一致），保证既有 import 路径与测试零改动。

- [ ] **Step 1: 搬迁（纯移动，不改一行逻辑）** —— 把 1–320 整块搬进 `edgeEditorShared.tsx`，`EdgeEditor.tsx` 顶部 import 回来 + 底部显式 re-export。
- [ ] **Step 2: 跑绿**：`cd packages/react; node <vitest> run tests/edge-editor.test.tsx` → 全绿（**这是「纯搬迁」的证明**）。
- [ ] **Step 3: 量行数 + 预算**：`node scripts/check-code-budget.mjs` → `bigFiles` 必须从 `4` 降到 `3`（`EdgeEditor.tsx` < 600 且新文件 < 600）。
- [ ] **Step 4: 提交** `refactor(react): 抽出 edgeEditorShared（纯函数/样式/小组件）——bigFiles 4→3`

### A-D2: 导出失败提示 `alert` → 宿主通知（白名单 −1）

**Files:**
- Modify: `apps/canvas/src/hooks/useExportActions.ts:68-69`
- Modify: 调用方（`MindmapStage` 内 `useExportActions({...})` 处，传 `onNotice: setCommandNotice`）
- Modify: `apps/canvas/tests/no-native-dialogs.test.ts:22`（**删白名单一行**）
- Test: `apps/canvas/tests/useExportActions.test.tsx`（若无则新建；先 `ls apps/canvas/tests` 核实）

**Interfaces:** `ExportActionsOptions` 增 `onNotice?: (message: string) => void`（缺省 `undefined` → 静默降级，不再弹窗）。两条文案原样保留：`'画布含外部图片，无法导出 PNG，已改为导出 SVG。'` / `'当前环境不支持导出 PNG，已改为导出 SVG。'`。

- [ ] **Step 1: 写失败测试**：mock `exportPng` 返回 `{ok:false, reason:'tainted'}` → 断言 `onNotice` 收到「含外部图片」文案；`reason:'unsupported'` → 收到「当前环境不支持」；两例都断言**没有** `window.alert`（把 `window.alert` 换成会抛错的 spy）。
- [ ] **Step 2: 跑红** → **Step 3: 实现**（`alert(…)` → `onNotice?.(…)`）→ **Step 4: 跑绿**。
- [ ] **Step 5: 删白名单 + 自检**：`hooks/useExportActions.ts` 从 `ALLOW` 移除；`node <vitest> run tests/no-native-dialogs.test.ts` 仍绿（该文件两条用例：非白名单零命中 + 白名单文件仍存在）。
- [ ] **Step 6: 提交** `fix(canvas): PNG 导出降级提示改宿主通知（去原生 alert，白名单 −1）`

### A-D3: FileManager 的 `confirm`/`prompt` → 内联确认条 + 内联命名

**Files:**
- Modify: `apps/canvas/src/FileManager.tsx`（`window.confirm` 在 `:186`；`window.prompt` 在 `:412`（顶栏「新建文件夹」）与 `:578`（右键菜单「新建文件夹」））
- Modify: `apps/canvas/tests/no-native-dialogs.test.ts`（删 `FileManager.tsx` 白名单行）
- Test: 新建 `apps/canvas/tests/file-manager-dialogs.test.tsx`（**现有 `file-manager-tree.test.tsx` 只覆盖树渲染，别往里塞交互**；新文件沿用其 host mock 写法）

**先例（照抄，不要新造交互）**：同文件的**内联重命名**已经是目标形态——`renamingKey` state（`:105`）、`commitRename`（`:202-208`，Enter 提交 / Esc 取消 / blur 提交）、内联 `<input>`（`:309-316`）。

**Interfaces:** 新增两个局部状态，语义与系统对话框一一对应：
- `pendingDelete: { node: TreeNode } | null` —— 渲染**内联确认条**（`data-fm-confirm`）：「删除 文件夹「X」及其全部内容？」+「删除」/「取消」；点「删除」才调用既有 `removeNode` 的删除主体（**把 `removeNode` 拆成 `confirmTarget()` 与 `doRemove(node)` 两半，删除逻辑零改动**）。
- `namingTarget: { parentPath: string; node?: TreeNode } | null` —— 渲染**内联命名输入**（`data-fm-name`，`defaultValue='新文件夹'` 全选），Enter 提交 → 既有 `createDirIn(parentPath, name)`；Esc 取消。`:412` 与 `:578` 两个入口都改成 `setNamingTarget({ parentPath })`。

⚠️ **行数红线**：该文件当前 **598 行**，任何净增都会让 `bigFiles 4 → 5` 顶破预算。规则：**先做完替换，再量行数**；若 ≥600，把左侧树（`:280-340` 一带的 `TreeNode` 递归渲染 + 行组件）抽到 `apps/canvas/src/FileManagerTree.tsx`（保持 props 形状，`data-doc-row` 等 DOM 属性不变）直到本文件 < 560。

- [ ] **Step 1: 写失败测试**（组件测试，仿 `apps/canvas/tests` 既有 FileManager 用例的 host mock 形态）
  - 「点删除 → 出确认条且**未调用** `removeFile/removeDir`；点「取消」→ 确认条消失、仍**未调用**」
  - 「点确认条『删除』→ 调用一次删除」（workspace 与 library 两条路径各一例）
  - 「顶栏『新建文件夹』→ 出内联输入；输入名 + Enter → `createDir` 收到该名；Esc → 不创建」
  - 「右键菜单『新建文件夹』→ 同一内联输入（同一 `namingTarget`）」
- [ ] **Step 2: 跑红** → **Step 3: 实现**（拆 `removeNode` / 两处 prompt 换内联 / 必要时抽 `FileManagerTree.tsx`）→ **Step 4: 跑绿**。
- [ ] **Step 5: 删白名单 + 自检** + **Step 6: 行数复核**（`budget` 的 `bigFiles` 必须仍为 3）。
- [ ] **Step 7: 提交** `fix(canvas): FileManager 删除/命名改内联交互（去原生 confirm/prompt，白名单 −1）`

### A-D4: 未保存切换确认 `confirm` → 自定义模态（白名单 −1）

**Files:**
- Create: `apps/canvas/src/UnsavedPrompt.tsx`（玻璃模态，两按钮）
- Modify: `apps/canvas/src/hooks/useDocumentActions.ts:71-88`（`applyDoc` 里的 `window.confirm`）
- Modify: 宿主接线（`MindmapStage` 渲染 `UnsavedPrompt` + 组装 `asker`）
- Modify: `apps/canvas/tests/no-native-dialogs.test.ts`（删 `hooks/useDocumentActions.ts` 白名单行）
- Test: `apps/canvas/tests/useDocumentActions.test.tsx`（已存在，扩展）

**决策 A1（默认按推荐执行，勿等确认）**：**做成「语义等价替换」——两按钮「放弃修改并切换」/「取消」**，不引入「保存后再切换」第三条路径（那会改数据流语义，属另一批次）。理由：本轮目标是「webview 下不再假死」，同等语义的 UI 替换零风险。

**Interfaces:**
- `DocumentActionsOptions` 增 `confirmDiscard?: () => Promise<boolean>`（缺省 undefined → **保守策略：视为 false（不切换）**，绝不静默丢数据）。
- `UnsavedPrompt({ open, onSettle })`：Enter = 确认 / Esc = 取消（与仓库既有气泡/模态键盘语义一致，参照 `useRadialStage` 的 confirm 气泡与 `LenBubble`）。
- `applyDoc` 改为：`if (controller.dirty && !(await confirmDiscard?.() ?? false)) return false;`（**唯一行为变化：由同步变异步**——调用方已 `await applyDoc(...)`，需逐处核实调用签名，见 Step 3）。

- [ ] **Step 1: 写失败测试**：① dirty + asker 返回 false → `applyDoc` 返回 false 且 `setDoc` 未被调用；② dirty + asker 返回 true → 切换成功；③ 未注入 asker → 返回 false（保守）；④ 不 dirty → 不调用 asker，直接切换。每例都断言未触碰 `window.confirm`。
- [ ] **Step 2: 跑红** → **Step 3: 实现**（含**逐处核实 `applyDoc` 调用方是否 await**：`grep -n "applyDoc(" apps/canvas/src`）→ **Step 4: 跑绿**。
- [ ] **Step 5: 模态渲染测试**（`UnsavedPrompt`：点确认/取消分别 settle true/false；Esc/Enter 语义）。
- [ ] **Step 6: 删白名单 + 自检**。
- [ ] **Step 7: 提交** `fix(canvas): 未保存切换确认改自定义模态（去原生 confirm，白名单清空）`

### A-D5: 批次 A 收尾

- [ ] `apps/canvas/tests/no-native-dialogs.test.ts`：`ALLOW` 清空为 `new Set()` 并**保留两条用例**（决策 A2：保留空集 + 自检，防将来回潮）。
- [ ] `pnpm gate`（或等价：tsc ×3 + 三包套件 + depcruise + lint + budget）全绿。
- [ ] 文档：CHANGELOG 追加「债务腾挪」一行；若 `FileManagerTree.tsx` 新增，记入结构说明。
- [ ] 提交 `docs: 债务腾挪批次收口（白名单清空 / bigFiles 4→3）`

---

## 批次 B · 性能地基（预计 1.5–2 天；P5 为条件项）

> 目标语义（写进验收，避免各说各话）：
> ① **pan 期间不重建节点 DOM**（机制指标）；② **裁剪与命中查询与节点总数解耦**（规模指标）；③ **每帧不再把父壳拖下水**；④ 既有性能门禁与契约测试**一条都不放宽**。

### B-P0: 建立可对照的度量（先做，别跳过）

**Files:**
- Create: `tools/bench-interaction.mjs`（Playwright；引法与 `tools/verify-delete-subring.mjs` 同构，`addInitScript` 注入计数器）
- Modify: `docs/preview/perf-baseline.md`（追加「交互基线」小节：日期 / 命令 / 数字）
- 复用：`scripts/bench-scale.mjs`（已存在，输出 `nodes,fullLayoutMs,cullMs,linkBuildMs,firstFrameMs,fpsBound,incEditMs,incVsFullPct`，需先 `pnpm -r build`）

**度量设计（两条，都能自动断言）:**
1. **机制指标——`nodeMutations`**：在页面里对画布容器挂 `MutationObserver({subtree:true, childList:true, attributes:true})`，统计 **`g[data-node-id]` 子树**的变更次数；脚本驱动 `page.mouse.move` 做 20 步拖拽平移（不缩放），输出 `nodeMutations` 与 `frameGapMsP50/P95`（`rAF` 间隔采样）。
2. **规模指标——`cullMs` / `linkBuildMs`**：跑 `scripts/bench-scale.mjs`，把数字抄进 `perf-baseline.md`。

- [ ] **Step 1: 侦察（15 分钟）**：读 `tools/verify-delete-subring.mjs` 的引法与 `apps/canvas/src` 的启动流程，确认「打开即有大图」是否可达；**不可达就退化**：在 25 节点 demo 上跑机制指标（P2 验证的是「pan 是否重挂节点」，小图同样能测出真/假——**不要为此先造大图夹具**）。
- [ ] **Step 2: 写脚本 + 跑基线**：把当天数字落档（含 `nodeMutations` 现状值，**预期 > 0**）。
- [ ] **Step 3: 提交** `test(tools): 交互性能基线脚本（pan 期节点 DOM 变更数 + 帧间隔）与基线落档`

### B-P1: 空间索引（kernel 纯函数 + MapView/手势接入）

**Files:**
- Create: `packages/kernel/src/layout/spatialIndex.ts`
- Test: `packages/kernel/tests/spatial-index.test.ts`（新建）
- Modify: `packages/react/src/render/MapView.tsx`（`:746-754` 可见节点过滤；`layout` 变化时建索引、`view` 变化时查询）
- Modify: `packages/react/src/render/useMapGestures.ts:81-103`（`hitNodeAt` 换索引粗筛）

**Interfaces（决策 B1：放 kernel —— 纯函数、可被 diag/bench 复用、不依赖 DOM）:**
```ts
export interface BoxIndex { /* 网格桶：cell 边长 + Map<cellKey, number[]> */ }
/** 决策 B2：cellSize 默认 512 世界单位；节点数 < 1000 时调用方仍走线性（见 INDEX_MIN_NODES） */
export function buildBoxIndex(boxes: ReadonlyArray<{x;y;w;h}>, cellSize?: number): BoxIndex;
export function queryBoxIndex(idx: BoxIndex, rect: {x;y;w;h}): number[];   // 粗筛（可能含未命中的桶内盒）
```
- `INDEX_MIN_NODES = 1000`（react 侧常量）：低于阈值走**原线性路径**（小图零回归 + 现有 jsdom 夹具不受影响）。
- `hitNodeAt` 的**语义必须逐字节保持**：自后向前取「最后一个命中」+ `skip` 过滤 + 6px pad（`worldHitPad`）→ 索引只做粗筛，**精判仍用原函数**，并且按 `visible` 原索引倒序取最大者。

- [ ] **Step 1: 写 kernel 纯函数测试**：① **等价性**——随机 200 组盒 + 20 个查询矩形，`queryBoxIndex` 的粗筛结果**包含**线性精确过滤的全部命中；② 退化：空集 / 单盒 / `cellSize` 过大（1 桶）/ 过小（每盒 1 桶）；③ 边界：盒恰在 cell 边界上（**必须只归一个桶**，避免重复计数）。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 跑绿**
- [ ] **Step 5: react 接入 + 等价性回归**：`tests/mapview-nodebox.test.tsx`、`tests/perf.test.ts`、`tests/acceptance-10k.test.tsx`、`tests/mapview-section-drag.test.tsx` 全绿；新增 `tests/hit-node-index.test.ts`（**同一 `visible` 数组下，索引版与线性版 `hitNodeAt` 结果一致**，含 skip 过滤与 pad 边界）。
- [ ] **Step 6: 量**：`bench-scale.mjs` 的 `cullMs` 与基线比 → 目标 **↓≥50%**（未达标不阻塞合并，但必须记录数字与原因）。
- [ ] **Step 7: 提交** `feat(kernel,react): 视口裁剪与节点命中走网格索引（>1000 节点启用）`

### B-P2: memo 化与元素重建抑制（机制指标 → 0）

**Files:**
- Modify: `packages/react/src/render/NodeG.tsx`（**决策 B3：包 `memo`**）
- Modify: `packages/react/src/render/MapView.tsx`（`:1529-1533` 的内联 lambda `onToggleCollapse` → `useCallback` + 传 `id`；`:746-754` 的 `visibleNodes` → `useMemo`）
- Test: `packages/react/tests/mapview-pan-memo.test.tsx`（新建）

**Interfaces:** `NodeG` 的 props 必须**引用稳定**：所有回调由 MapView 侧 `useCallback` 提供（或统一收进一个稳定的 `handlers` ref 对象）；`visibleNodes` 的 `useMemo` deps 只允许 primitive（`view.x/y/w/h`）+ `layout` 引用 + `lod`。

- [ ] **Step 1: 写失败测试（机制断言，jsdom 可测）**：render `<MapView>` → 挂 `MutationObserver` 到容器 → 用 `viewport` API 或注入的 `apiRef` 触发两次纯平移（不缩放、不换布局）→ 断言 **`data-node-id` 元素的 childList 变更数为 0**（现状会 > 0 → 先红）。
- [ ] **Step 2: 跑红 → Step 3: 实现（memo + 稳定 props + useMemo）→ Step 4: 跑绿**
- [ ] **Step 5: 既有性能门禁复核**：`perf.test.ts:83,85`（layoutMs<250 / viewMs<12）不得劣化；`perf-scale.test.tsx` 首帧不得劣化超过 10%。
- [ ] **Step 6: 真浏览器复测**：`tools/bench-interaction.mjs` → `nodeMutations` 预期从 P0 的基线值降到 **0**（或「仅首帧的一次」）。
- [ ] **Step 7: 提交** `perf(react): NodeG memo + 可见集/回调稳定化——pan 期不再重建节点 DOM`

### B-P3: 每帧父壳重渲降载 + 缩放手势期 LOD 冻结

**Files:**
- Modify: `packages/react/src/render/MapView.tsx:983-1001`（`onStats` 节流 + 值变化才回调）
- Modify: `packages/react/src/render/MapView.tsx:635`（LOD 取值处）+ `useMapGestures.ts`（暴露「缩放中」状态）
- Test: `packages/react/tests/mapview-stats-throttle.test.tsx`（新建）

**Interfaces:**
- `onStats` 节流：**≥200ms 且 payload 实质变化**才回调；`epoch` 从 payload 移除或单独低频（`PerfPanel` 的「帧 epoch」行可改为显示节流后的值——面板是诊断用，允许语义微调）。
- **LOD 冻结**：`useMapGestures` 增 `onGestureActive?: (active: boolean) => void`（pinch/wheel 缩放手势起止各一次；**平移不触发**——平移不改 k，LOD 天然稳定，见 §1 第 7 条）；MapView 在 `active` 期间**锁定上一帧 lod 值**，手势结束再按 `lodFor(k, nodeCount)` 重算一次。

- [ ] **Step 1: 写失败测试**：① 连续 10 次 epoch 变更 → `onStats` 只被调用 1 次（假定时器推进 200ms）；② payload 不变 → 不重复回调；③ 缩放手势期跨越 0.5 阈值 → `lod` 保持手势前的值，手势结束后才切换。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 跑绿**
- [ ] **Step 5: 复核**：`PerfPanel` 在 `apps/canvas` 仍可读（`MindmapStage.tsx:154,1408,1607` 接线不改）；`pnpm gate` 绿。
- [ ] **Step 6: 提交** `perf(react): stats 上报节流 + 缩放手势期冻结 LOD（父壳不再每帧重渲）`

### B-P4: 复测与决策点（**是否做 P5**）

- [ ] 跑 `tools/bench-interaction.mjs` + `scripts/bench-scale.mjs`，把 P0 基线 / P1 / P2 / P3 四列数字并列写进 `docs/preview/perf-baseline.md`。
- [ ] **决策 B4（默认规则，不需等确认）**：若 ①`nodeMutations == 0` 且 ②`cullMs` 相对基线 ↓≥50% 且 ③既有门禁无劣化 → **P5 不做**（在 CHANGELOG 写明「transform-only 经实测不必要」）；否则执行 P5。
- [ ] 提交 `docs: 性能地基复测（基线/P1/P2/P3 对照）`

### B-P5（条件项）: transform-only DOM 路径

> ⚠️ 本任务**只在 B-P4 判定未达标时执行**；它是本批唯一有视觉回归风险的任务，必须带开关与回滚。

**Files:**
- Modify: `packages/react/src/render/MapView.tsx`（投影 `<g>` 改 `ref` 直写 `setAttribute('transform', …)`；渲染体去 `view.x/y` 依赖，仅保留 `k` 档位）
- Modify: `packages/react/src/render/viewport.ts`（新增「只订阅 transform」的订阅通道，避免 epoch 触发 React 渲染）
- Test: `packages/react/tests/mapview-transform-only.test.tsx`（新建）

**设计要点**：culling 仍需视口 → 采用**分段重算**：视口变化累计超过半屏（或停止移动 120ms）才重算可见集并重渲；期间靠 `transform` 位移，**外扩 margin 吸收**未挂载节点（`CULL_MARGIN` 不动，靠「重算阈值」而非加大 margin）。
**开关**：`TRANSFORM_DOM_PATH`（模块常量，默认 `false`）；开关两态都有测试。

- [ ] Step 1: 写失败测试（transform 变化而 React 不重渲：断言渲染计数 0 且 `<g>` 的 transform 属性已更新）→ Step 2: 红 → Step 3: 实现 → Step 4: 绿
- [ ] Step 5: **视觉回归**：`tools/verify-delete-subring.mjs` 六查 + 人工看四向节点/自由边/Section/note 面板在平移中不抖不闪
- [ ] Step 6: 提交 `perf(react): pan/zoom 走 transform-only DOM 路径（开关默认关，达标后开启）`

### B-P6（可选，仅在有富余时）: 搜索面板的全树 walk

- [ ] `apps/canvas/src` → `packages/react/src/chrome/SearchPanel.tsx:20`：`search(query)` 由「渲染体内直算」改 `useMemo([query, root])`；顺带核实 `OutlinePanel` 是否重复 walk。
- [ ] 提交 `perf(react): 搜索面板检索结果 memo 化（渲染体内全树 walk → 键控）`
- ❌ 不做：大纲虚拟化（另立批次，涉及 DOM 结构变更）

### B-P7: 批次 B 收尾

- [ ] `pnpm gate` 全绿（**1532 例基线 + 本批新增用例**；不许放宽任何既有阈值）。
- [ ] `docs/preview/perf-baseline.md` 落最终对照表；CHANGELOG 一行（含「P5 做/不做」的结论与依据）。
- [ ] 提交 `docs: 性能地基批次收口`

---

## 2. 决策点汇总（默认按「推荐」执行，执行者不必等确认）

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| A1 | 未保存切换模态的按钮语义 | 两按钮（放弃/取消） / 三按钮（含「保存并切换」） | **两按钮**（语义等价替换，零数据流风险；三按钮另批） |
| A2 | 白名单清空后的守卫 | 删掉 ALLOW / 保留空集 + 两条自检用例 | **保留空集 + 自检**（防回潮） |
| A3 | FileManager 超 600 行的处理 | 拆 `FileManagerTree.tsx` / 压缩其它部分 | **拆**（树是天然边界，`data-*` 属性不变即零测试影响） |
| B1 | 空间索引放哪 | kernel 纯函数 / react render | **kernel**（可被 diag/bench 复用，不受 DOM 约束） |
| B2 | 索引启用阈值与格子尺寸 | —— | **`INDEX_MIN_NODES = 1000`**；`cellSize = 512`（先固定，P4 复测后再调） |
| B3 | `NodeG` 是否 memo | memo / 不 memo | **memo**（配合稳定 props；这是 pan 期零重建的前提） |
| B4 | 是否做 transform-only（P5） | 做 / 不做 | **由 P4 实测决定**（机制指标 0 + cullMs ↓≥50% → 不做） |

---

## 3. 风险与明确不做

**风险（按严重度）**
1. **`hitNodeAt` 语义漂移**（最严重：会改点击/拖拽行为）→ 用「索引版 vs 线性版」逐字节等价测试钉死（含 `skip`、pad、自后向前顺序）。
2. **jsdom 夹具脆弱**：`mapview-section-drag.test.tsx` 靠 `CULL_MARGIN` 撑开 1×1 视口；`acceptance-10k.test.tsx` 要求 measure/collapsed 引用稳定 → 本批**不动 margin、不动 measure 契约**。
3. **`visibleFreeEdges` 每帧重算（O(E×N)）**：§1 第 10 条已记录（注释与实现不符）。本批**只记录、不修**（修它属于自由边避障批次）；若 P4 复测显示 pan 帧耗时仍超线，再单独立项。
4. **`FileManager.tsx` 逼近 600 行**：A-D3 的 Step 6 是硬闸门。
5. **测试夹具与本机环境**：真浏览器脚本依赖本机 Playwright 绝对路径（照抄 `tools/verify-delete-subring.mjs`）；`pnpm -r test` 会 SIGTERM（分包单跑）。

**明确不做（本批）**
- ❌ 换 Canvas/WebGL 渲染器（阈值未到：可见 DOM 数千 / 总节点 >20000）
- ❌ 修 `CULL_MARGIN` 双重应用（口径变更，会影响 6 处判定与文档/脚本基线；单独立项）
- ❌ 自由边路由重算治理、大纲虚拟化、协作、AI 生成
- ❌ 放宽任何既有性能阈值（`perf.test.ts:83,85` 等）

---

## 4. 交付流程

```
批次 A（可独立合并）  A-D1 → A-D2 → A-D3 → A-D4 → A-D5
批次 B（可独立合并）  B-P0 → B-P1 → B-P2 → B-P3 → B-P4（决策）→[B-P5 条件] → B-P6（可选）→ B-P7
```
- 每任务一条 commit（中文描述，`类型(范围): 摘要`）；**禁用 `git add -A`**，逐条精确路径（`docs/collab/parallel-agent-discipline.md` §1.1）。
- 每任务完成即跑 DoD（§0）；**批次内不留半绿状态**。
- 报告纪律：每个任务回帖给「命令 + 实测数字 + 结论」，**不许用「应该」「大概」**（本项目既有教训：文档状态描述必须 grep/实测核实）。
