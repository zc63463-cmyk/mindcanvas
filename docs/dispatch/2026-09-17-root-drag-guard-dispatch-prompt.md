# ROOT-DRAG-1 外派任务书：根节点拖拽禁写 center 条目（静默升格后门修复）

本文件即开工令。工作目录 = mindcanvas 仓库根。
阶段：缺陷修复（**预存 bug**，非 FE-FRAME 批次引入；2026-09-17 目视核查发现并已取证）。
级别：数据污染级 —— 正常手势即可写坏文档，且状态不可逆（UI 无「根降格」入口）。
主控裁决：**已立项**（2026-09-17）。读者：工程执行 agent。做完停下交回执；**不 push**。

---

## 0. 现象与证据链（已核实，禁止重新论证「是否存在」）

**现象**：含岛文档中，拖动**文档根节点本体**、或拖动**锚定根节点的 Section 标题栏**，
松手后 `root.note.centers` 被写入「根」的 center 条目 —— 根被静默升格为中心，
等价于绕过 `planPromoteCenter` 的 `is-root` 守卫（该守卫明确「文档根不可升格为中心」）。

**复现记录**（夹具 `_tmp_fe-frame-visual.mm.md`：岛 ×3 + 嵌套迷你 + 一条锚定根的 Section「根区」）：

| 时点 | 总览「根区」卡 |
|---|---|
| 拖前（干净态） | 成员 **2** / 无 ⊞ 角标（只罩 根 + other） |
| 拖后 | 成员 **9** / **⊞4**（根包容 P/C/E/D 四岛 → 单根卡 + 4 枚迷你） |

**代码链（三处，均已读核）**：

1. `apps/canvas/src/MindmapStage.tsx`：`centerIds = new Set(centerSpecs.map(c => c.node.id))`，
   `centerSpecs = islandView.specs` —— **刻意含「虚拟根岛」**（注释：布局忽略的中心不得进入
   手势；与布局同源）。该集合既是布局岛根集合，也被当作「可拖中心」集合使用。
2. `apps/canvas/src/MindmapStage.tsx · handleCenterMove`：`centers.find(c => c.nodeId === id)`
   对根返回 undefined，但 `at = anchorOfNode(root, id)` 命中 `'node:根'` →
   `upsertCenter(note, at, { x, y })` **新建条目** → `controller.updateNote(root.id, { centers })` 落库。
3. `packages/react/src/render/MapView.tsx`：`handleSectionTitlePointerDown` 守卫
   `if (!centerIds?.has(rootId)) return;`（根通过）；节点本体路径经
   `useMapGestures` 的 `isCenter` 谓词同源放行（`if (isCenter?.(nd.nodeId))` → onCenterMove）。

---

## 1. 口径（裁定）

**做**：

- 拖起侧收紧：**「虚拟根岛」不得进入 center 拖拽管线**（Section 标题栏与节点本体两条入口同源收紧）；
- 提交侧兜底：`handleCenterMove` 对「无既有 center 条目」的 id **直接跳过**（零写入、零 onCenterMove）；
- 预览侧取舍须显式写明（见 2.3）：预览跟手可保留（纯会话态）或一并收紧，二选一并在注释/回执说明理由。

**不做**：

- 不改 `planPromoteCenter` 的 `is-root` 守卫本身；
- 不动 `islandView.specs` / 布局口径（虚拟根岛必须继续参与布局、裁剪与命中）；
- 不裁决「手写 YAML 把 Section 锚在根上」的合法性（D1 灰区，另议）；
- 不动 FE-FRAME / 贴框 / 总览 / routeAesthetic 任何口径；不做 placed 对齐。

---

## 2. 实现要点（权威）

### 2.1 「真实中心条目」判据（单一出口）

宿主已有 `collectCenters(controller.root)`。建议 MindmapStage 新增稳定集合
`centerEntryIds`（`useMemo`：**well-formed 且非根** 的 center nodeId 集合）传给 MapView，
或传引用稳定的 `isRealCenter(id)` 谓词。命名/注释必须写清与 `centerIds` 的区别：

- `centerIds` = 布局岛根集合（**含虚拟根岛**，供布局/命中/总览口径）；
- `centerEntryIds` = 可拖中心集合（**有 center 条目**，供拖起守卫与提交校验）。

### 2.2 MapView 收紧

- `handleSectionTitlePointerDown`：守卫改判 `centerEntryIds`（或等价谓词）；
- `useMapGestures({ isCenter })`：改传同一判据（两条入口同源，防漂移）；
- 若选择「预览一并收紧」：`handleSectionTitlePointerDown` 早退即天然覆盖；
  若选择「保留预览、仅提交跳过」：须在 `centerPreview` 处注释说明取舍与理由。

### 2.3 `handleCenterMove` 兜底

- `const cur = centers.find(...); if (cur === undefined) continue;` —— **删除 `at` 兜底 upsert 分支**；
- 嵌套跟移（`islandView.nestedCenterIdsByRoot`）与坐标基准（`cur.pos ?? ln.box 中心`）不变；
- 保持「一次拖拽提交只调用一次 `controller.updateNote`」的既有语义。

### 2.4 回归口径（硬约束）

- 真中心拖拽逐位不变：整岛预览跟手、Section 标题 ≡ 中心拖、嵌套父岛跟移、单次 undo；
- 虚拟根岛在**布局/命中/总览**中的参与度不变（只是不再可拖、不再可写）。

---

## 3. 验证命令（先红后绿）

**先红（提交前必须看到新测失败）** —— 新集成测（`packages/react/tests/` 或 `apps/canvas/tests/`，jsdom + MapView）：

- (a) 含岛文档 + 锚定根的 Section：拖「根区」标题 → `onCenterMove` 零调用、centers 不变；
- (b) 拖根节点本体 → 同上；
- (c) 对照：拖真中心 → 坐标更新恰一次（语义不变）。

**回归**：

```bash
cd packages/react
npx vitest run tests/mapview-center-drag.test.tsx tests/mapview-section-drag.test.tsx tests/mapview-center-nested-drag.test.tsx
npx tsc -b tsconfig.json
cd ../../apps/canvas && npx tsc -b tsconfig.json
```

**人工复核（有 dev 环境时）**：夹具 `_tmp_fe-frame-visual.mm.md` 拖入 → 拖根区标题 →
总览「根区」卡保持 2 / 无 ⊞。

---

## 4. 回执格式（交主控）

```md
## 回执 · ROOT-DRAG-1
### commits（或「未提交」+ git diff --stat）
### 测试原文（先红 → 后绿）
### 口径自检
- [ ] 拖根（标题 / 本体）零写入、零 onCenterMove
- [ ] 真中心拖拽语义逐位不变（既有测全绿）
- [ ] 未改 is-root 守卫 / specs 布局口径 / FE-FRAME 口径
- [ ] 预览侧取舍已在注释与回执中写明
### 未做 / 风险
```

---

## 5. 禁止

push；`git add -A`；顺手做 placed 对齐；改产品语义（D1 / Section 命中 / 岛语义）；
扩大范围到「根能否成为 Section」的产品裁决。

---

## 6. 收口记录（2026-09-17）

状态：**已收口**（主控裁决：可正式收口）。

| 项 | 结果 |
|---|---|
| 修复提交 | `6239036` fix(react)：centerEntryIds 判据（拖起 / 手势 / 预览同源）；`2582beb` fix(canvas)：提交层兜底（无条目零写入 + 零副作用早退） |
| 先红 → 后绿 | `packages/react/tests/mapview-root-drag-guard.test.tsx`：修前 2 failed / 2 passed（拖根标题、拖根本体各回调 onCenterMove 1 次）→ 修后 4 passed |
| 回归 | packages/react 150 files / 1463 tests 全绿 · `tsc` 0；apps/canvas 35 files / 245 tests 全绿 · `tsc` 0；pre-commit 双钩子绿（dependency-cruiser 0 违规 / biome 通过） |
| 人工复核 | 主控裁决收口（2026-09-17） |
| 存量修复 | canvas 既有 `tsc` 错误（`note` possibly undefined）随本批清除——守卫使该路径可达运行态，属必需加固（`touched` 早退 + `note?.centers`） |
| 未决（另议） | D1 灰区：手写 YAML 的「根锚 Section」合法性；虚拟根岛继续参与布局 / 命中 / 总览，仅不可拖、不写 note |
