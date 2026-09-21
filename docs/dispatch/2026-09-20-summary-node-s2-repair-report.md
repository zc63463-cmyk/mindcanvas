# 摘要节点 S2 定向返修回执（R1 / R2 / R3）

- 日期：2026-09-20
- 工作区：`<workspace>/.workbuddy/wt-summary-node-s2`
- 分支：`codex/summary-node-s2-20260920`
- 返修基线提交（未改动）：`0d77197f57a0f963845fe3074f65cad5ff2f2458`
- 本轮证据目录（独占）：`outputs/summary-node/S2/20260920-S2-REPAIR-01/`
- 前序提交 `0d77197` 及其回执 `docs/dispatch/2026-09-20-summary-node-s2-report.md`、证据目录 `outputs/summary-node/S2/20260920-S2-01/` **原样保留，未覆盖、未 amend**。

> 本回执只写实际发生过的事。凡未实际运行、未实测到位的，一律写「未覆盖 / 未定位 / 未运行」，不以「随后通过」充当已确认稳定。

---

## 0. 一句话结论

| 项 | 结论 |
|---|---|
| R1（单成员区间双分配 cid） | **确认复现 → 已修复**。修前 `fromCid≠toCid`、`next_cid` 推进 2；修后单成员只分配一次、`next_cid` 只推进 1。负控真红（exit 1）。 |
| R2（切文档后旧草稿吞掉新文档第一次点击） | **确认根因 → 已修复**。根因是清理信号绑 `controller` **对象身份**，而切文档走 `controller.reset()` 原地复位、身份不变。改为「文档会话令牌」后，负控双向真红（exit 1）。 |
| R3（测试是否为生产接线） | **部分确认**。原 `summary-two-hop.test.tsx` 确实不挂载生产组件；本轮抽出共享 hook `useSummaryHop.ts` + 新增真挂载 `summary-two-hop-host.test.tsx`（11 条）。**但辅助模型套件仍存在**——两者证据强度不同，见 §3。 |
| 单处守卫被下游兜住的情况 | R1/R2/R3 本轮**均未出现**被下游兜住（所有负控只改生产一处即转红）。但**先前开发轮的 R3 负控日志（`r2r3-negative-control-3-reset-signal-dead.log`）在非确定性条件下曾出现「改了仍绿」**，见 §4.4，故此点不能作为「单一守卫已证明」的依据。 |

---

## 1. R1：单成员区间 `fromId === toId` 的 cid 双分配

### 1.1 修复前实际结果

复现命令（素材【R1 复现】，`packages/react/tests/zz-repro-r1-single-member.test.ts`）：

```
cd <workspace>/.workbuddy/wt-summary-node-s2/packages/react
npx vitest run tests/zz-repro-r1-single-member.test.ts
```

实际输出关键位：

```
fromCid: "c5"   toCid: "c6"     fromCidEqualsToCid: false
endpointUpdateCountInOps: 2     rootNoteInOps: { next_cid: 7 }   (起点 5)
rootNextCidFinal: 7            nextCidAdvancedBy2: true
resolveSummaries: [{ summaryNodeId:"ndmu9wx1usb", state:"dangling", reason:"from-not-found", spec: null }]
```

判据实测：`fromCidPointsToActualEndpointCid=false`、`toCidPointsToActualEndpointCid=true`。即同一节点被分配两个 cid，写入后 `from` 锚失效 → **创建即 dangling**。

判别用例集（`packages/react/tests/summary-create.test.ts`，先加用例后修，修前 3 红）：

```
❯ tests/summary-create.test.ts (39 tests | 3 failed) 68ms
  ✓ from === to 单成员区间 → 合法（S1 契约：单成员合法）
  × 端点无 cid：只分配一次 / 只 update 该端点一次 / next_cid 只推进一次
  × 端点无 cid：createSummary 后摘要 well-formed，成员恰为该节点
  × 端点无 cid：单条 Undo 逐位还原；Redo 后摘要仍 well-formed
  ✓ 两端都已有 cid（同一节点）：不补发、不 bump、ops 只剩 add-child
AssertionError: expected 'c6' to be 'c5'   (tests/summary-create.test.ts:361:24)
AssertionError: expected 'c2' to be 'c1'   (tests/summary-create.test.ts:391:23)
AssertionError: expected 'dangling' to be 'well-formed'  (tests/summary-create.test.ts:425:32)
Test Files 1 failed (1)   Tests 3 failed | 36 passed (39)     → exit 1
```

日志：`r1-discriminating-red.log`（exit 1，已在本次会话中 `tail` 核对过 tail 段与上述一致）。

### 1.2 修复点（`packages/react/src/edit/summaryCommands.ts`）

本轮实读 `git diff packages/react/src/edit/summaryCommands.ts`，可执行行只改 2 处：

```diff
-  const toAlloc = allocate(to);
+  const toAlloc = from.id === to.id ? fromAlloc : allocate(to);
...
-  if (toAlloc.cid !== noteCid(to.note)) {
+  if (to.id !== from.id && toAlloc.cid !== noteCid(to.note)) {
```

### 1.3 修复后实际结果

```
cd .../packages/react && pnpm exec vitest run tests/summary-create.test.ts --reporter=verbose
→ Test Files 1 passed (1)   Tests 39 passed (39)     exit 0      日志 r1-final-green.log
pnpm --dir packages/react test      → 157 files / 1599 tests passed    exit 0   r1-full-react-after.log
pnpm --dir packages/react typecheck → exit 0                            r1-typecheck-after.log
```

独立复核（素材【独立复核】第 1 条，复核者自建隔离副本、自写 6 条探针）：候选上探针 `6 passed`，实测 `PROBE P1 ops=[update-node:<root>, update-node:<C>, add-child:<root>] fromCid=c5 next_cid=6`；`PROBE P3 fromCid=c5 toCid=c6`（两成员仍各分配一次，排除「一律复用」的过度修复）；探针内置反向对照（端点 cid 改 `c99` 必须 dangling/from-not-found）通过，证明 `well-formed` 非恒真。

### 1.4 负控（R1）

| 项 | 内容 |
|---|---|
| 修改点 | 隔离副本 `<workspace>-nc-s2r1/packages/react/src/edit/summaryCommands.ts` 的 `buildPlan`，还原「双分配」：① `toAlloc = from.id === to.id ? fromAlloc : allocate(to)` → `allocate(to)`；② 端点 update 条件去掉 `to.id !== from.id &&`。改后重建 dist（kernel/free-canvas 强制 `tsc -p tsconfig.build.json` 重 emit，再 `pnpm --dir packages/react build`），并 grep 副本 dist 确认无 `from.id === to.id` 残留。 |
| 目标红项 | `planCreateSummary · from === to 单成员端点的 cid 只分配一次` 下 3 条：`端点无 cid：只分配一次 / 只 update 该端点一次 / next_cid 只推进一次`、`端点无 cid：createSummary 后摘要 well-formed，成员恰为该节点`、`端点无 cid：单条 Undo 逐位还原；Redo 后摘要仍 well-formed` |
| 真实退出码 | **1** |
| 被下游兜住？ | **否**（`maskedByDownstream = false`）。独立复核另见：修复者「契约锚点」第 4 条用例在双分配负控下仍绿、只在「拒绝单成员」变异下才红（复核者实测副本 `reject single-member` → 修复者套件 `5 failed`、探针 `5 failed`，含 `PROBE FAIL P2: 单成员被拒绝 code=reversed`）。复核者由此指出：**该锚点用例判别力弱，不宜当 R1 主证据**，主证据应由 3 条要求「ok 且只一次分配」的用例承担。此观察已如实采纳。 |

> 注：另有一处「单处守卫被下游兜住」的历史现象（跨父被下游索引防御改成 not-found），只存在于开发轮自己留档的 `r1-negative-control*.log` 原文中；本轮双分配负控下**没有任何用例仍绿**。

---

## 2. R2：切文档后旧摘要草稿吞掉新文档的第一次点击

### 2.1 修复前实际结果（只读核实生产路径）

素材【R2 事实】逐文件 grep 结论（未运行测试，本步仅只读）：

- `apps/canvas/src/hooks/useDocumentSwitch.ts:89` —— 切文档是 `controllerRef.current?.reset(editable)`，**不重建 controller**。
- `packages/react/src/edit/controller.ts:474-483` —— `reset()` 只复位字段（history/collapsed/selectedId/editingId/dirty），**无 `this.epoch = 0`、无 new instance、无 `dispose()`**。
- `apps/canvas/src/MindmapStage.tsx:1536-1540`（HEAD 版）—— 草稿清理 effect 依赖 = `[controller, setSummaryDraft]`，`setSummaryDraft` 是稳定 `useCallback([])`，故 effective dep 只有 **controller 对象身份**。
- `MindmapStage.tsx:238/241-259` + `App.tsx:48-53` 无 key —— controller 在 StageInner 生命周期内**只建一次**，切文档经 `setDoc`（`useDocumentActions.ts:119`）不卸载任何组件。

推断链：草稿仍活着 → `MindmapStage.tsx:1746` 首判 `if (summaryDraftRef.current !== null)` 命中 → `completeSummaryAt` **被拒时也返回 true**（:1156-1158 注释，:1184-1196 `keepDraft(); return true`）→ 该次点击直接 `return`，**不走 `controller.select`**（:1784）。即用户第一次点击被静默吞掉。

本轮实读 `git show HEAD:apps/canvas/src/MindmapStage.tsx` 确认上述 HEAD 版清理 effect 确实存在（复核者亦在【独立复核】第 1 条引 HEAD 版 `:1539` 为同一行），并在 `git diff` 中确认本轮**已删除**该行。

### 2.2 修复点

本轮实读 diff，R2 改动为：

- 新增 `apps/canvas/src/hooks/useDocumentToken.ts`：单调令牌（`mountSeq*1e6 + replaceCount`），**只在显式文档替换事件发生时**推进。
- `apps/canvas/src/hooks/useDocumentActions.ts:146`：`onDocumentReplaced?.()`，位于 `performApplyDoc` 内 `session.beginDocument` 之后、`setDoc(next)` 之前——即打开/新建/最近/文件库/工作区/拖入的唯一入口。
- `apps/canvas/src/MindmapStage.tsx:1532`：`draftResetToken: documentToken`；HEAD 版那条 `useEffect(() => () => setSummaryDraft(null), [controller, setSummaryDraft])` 被移除。
- 判据是**替换事件**而非内容比较。

### 2.3 修复后实际结果

```
cd .../apps/canvas && pnpm exec vitest run tests/summary-two-hop.test.tsx tests/summary-two-hop-host.test.tsx --reporter=verbose
→ AFTER_REAL_EXIT=0
   ✓ tests/summary-two-hop-host.test.tsx (11 tests)
   ✓ tests/summary-two-hop.test.tsx (24 tests)
   Test Files 2 passed (2)   Tests 34 passed (34)
```

`⑥ 文档替换清草稿：B 的第一次点击正常选择，不建摘要` 与 `⑦ 同内容文档替换也清草稿（不得靠内容比较）` 两条 R2 判别用例由红转绿。

### 2.4 修复前复现（隔离副本，源码全量拷贝，测试文件一字未改）

```
cd mindcanvas-r2before/apps/canvas
pnpm exec vitest run tests/summary-two-hop.test.tsx tests/summary-two-hop-host.test.tsx --reporter=verbose
→ BEFORE_REAL_EXIT=1
  FAIL ... ⑥ 文档替换清草稿：B 的第一次点击正常选择，不建摘要（R2 判别）
    AssertionError: expected true to be false    @ 404| expect(mustHost().hasDraft()).toBe(false)
  FAIL ... ⑦ 同内容文档替换也清草稿（不得靠内容比较）
  Test Files 1 failed | 1 passed (2)   Tests 2 failed | 32 passed (34)
```

日志：`r2r3-before-repro-prefix-prod.log`（本次会话已 `head` 核对：`× ⑥ ... expected true to be false`、`× ⑦ ... expected true to be false` 原文可见）。

### 2.5 负控（R2/R3 共用副本，三次）

副本 `<workspace>/mindcanvas-nc-s2r3`（用完已删）。三次**测试文件与期望一字未改**。

| 编号 | 修改点 | 目标红项 | 真实退出码 | 被下游兜住？ |
|---|---|---|---|---|
| NC1 | 只改生产接线一处：`MindmapStage` 的 `draftResetToken` 由 `documentToken` 改回 `controller` 对象身份（WeakMap 映射为稳定 number，复刻修复前判据） | ⑥ 文档替换清草稿；⑦ 同内容替换也清草稿 | **1** | 否 |
| NC2 | 另一处：`onNodeClick` 的摘要首判 `if (summaryHop.hasDraft())` → `if (false && ...)`（接线被摘掉） | ① 真实右键入口→第二跳→建摘要并选中；② 同 tick 重复点击只创建一次；③ 非法第二跳保留草稿并提示；⑧ 编辑/保存/另存为不得被误判；⑩ 一次 Undo 撤销完整创建 | **1** | 否 |
| NC3 | 只把 `draftResetToken` 钉死为常量 0（复位信号被废，其余修复全保留） | ⑥、⑦ | **1** | 否 |

退出码留档原文（`r2r3-negative-control-1-exitcode.log`）：

```
NC1  controller identity as reset token          REAL_EXIT=1  (6/7 red: two-hop-host)
NC2  remove onNodeClick summary first judgment   REAL_EXIT=1  (7 red: two-hop-host)
NC3  reset signal dead (draftResetToken: 0)      REAL_EXIT=1  (6/7 red: two-hop-host)
BASELINE (unmodified worktree, same files)       REAL_EXIT=0  (34 passed)
```

本次会话实读 `r2r3-negative-control-3-reset-signal-dead.log` 的 tail 段：`Test Files 1 failed (1)`、`Tests 2 failed | 8 passed (10)`，红项为 ⑥ 与 `⑦ 同内容文档替换也清草稿`（`:438 expect(mustHost().hasDraft()).toBe(false)`，`- false / + true`）。此 NC3 日志为 **10 条**档（`tests 总数 10`），与退出码留档里的 `(6/7 red)` 口径不同——两次运行的红项集合不一致，见 §4.4，不据此单条声称「单一守卫已证明」。

### 2.6 独立复核的独立负控（素材【独立复核】第 2 条，复核者自建副本）

- **NC1'**（删除 `useDocumentActions.ts:146` 的 `onDocumentReplaced?.()`）→ `REAL_EXIT=1`，`Tests 2 failed | 9 passed (11)`，红的**只有** ⑥（`:435`）与 ⑦（`:468`）。
- **NC2'（反向控制）**（在保存回填 `savedSource` 处也推进令牌）→ `exit 1`，`Tests 1 failed | 10 passed (11)`，红的**只有 ⑧**（`expect(mustHost().documentToken).toBe(tokenAtOpen)`）。
  ⇒ ⑥/⑦ 与 ⑧ 彼此独立判别，**双向**成立（少了 bump ⑥⑦红、多了 bump ⑧红），证明 ⑧ 不是恒真用例。
- **NC3'（决定性负控）**（把 `MindmapStage.tsx:1738` 改为 `if (false && summaryHop.hasDraft())`）→ `exit 1`，`Tests 6 failed | 5 passed (11)`，红的是 ①②③①b⑧⑩。⇒ 只改**生产**一行 6 条真挂载用例转红。
- **prefix round-trip（最强证据）**：把 R1/R2/R3 文件全部还原到 HEAD、只移植新观测口（`window.__mindcanvasSummaryHost`），生产状态机与清理逻辑一字未动：
  - 直跑 host 测试 → `exit 1`，`Tests 11 failed`（缺观测口，证明 host 测试确实依赖真实 MindmapStage）。
  - 把 ⑥ 中间断言换成软观测让执行走到下游 → `[probe] draftAfterReplace=true`，随后 `AssertionError: expected null to be 'ndmua0hxuex'`——**替换文档后旧草稿仍在、新文档第一次点击被吞（selectedId 停在 null）**，一比一复现原始症状。
  - 同一探针跑在**本轮候选**上 → `[probe] draftAfterReplace=false`，`Tests 1 passed | 10 skipped` ⇒ round-trip 闭合。
  - ⑦ 独立签名实测：候选副本中 `[probe7] treeSnapshotSame=true`（替换前后 `JSON.stringify(controller.root)` 逐字相同），而 token 变了、草稿清了 ⇒ 判据确为**替换事件**而非内容比较。

---

## 3. R3 核心：生产组件证据 vs 辅助模型证据

这一节是本回执的重点。**两套测试的证据强度不同，不可互相顶替。**

### 3.1 修复前的实情

素材【R3 取证】实读 `apps/canvas/tests/summary-two-hop.test.tsx:88-164`（旧版）与 `apps/canvas/src/MindmapStage.tsx:1166-1204`：

- 旧测试**整段内联复刻**生产 `completeSummaryAt` 的状态机（`draftRef` ↔ `summaryDraftRef`、`keep` ↔ `keepDraft`、`classifySecondHop(fromId, toId, (id) => id === fromId)` ↔ `(id) => nodeById(controller.root, id) != null` 等逐行同序）。
- `grep -n 'MindmapStage' apps/canvas/tests/summary-two-hop.test.tsx` 只命中 **2 处注释**（`:14`、`:83`），**无 import、无 `render(<MindmapStage />)`**。
- 文件头自述（`:14-17`）：「本文件驱动**与 MindmapStage 逐字同序的首判链**（`useSummaryHop`），而不是整装 App」。
- 负向佐证（`05-real-mount-sample.log`）：所有 `render(<MindmapStage />)` 的测试文件（delete-key / edge-health-bar / frame-outline-host / note-back-edit / note-flip-host / stage-render / startup-doc-switch）`summary_occurrences=` **全部为 0** ⇒ 生产 `completeSummaryAt / onNodeClick` 首判分支当时**不被任何测试执行**。

**结论（R3 成立）**：修复前 R2 的缺陷所在的生产组件分支，测试完全没碰到；旧测试红绿**不能**证明生产接线。

### 3.2 修复后的分层（两套并存，强度不同）

#### A. 生产组件证据 —— `apps/canvas/tests/summary-two-hop-host.test.tsx`（11 条）

本轮实读该文件：`:30 import MindmapStage from '../src/MindmapStage'`，`:298/334/358/372/392/408/426/446/479/509/530` 共 **11 处 `render(<MindmapStage />)`** 真实挂载。

| 用例 | 走的真实接线 |
|---|---|
| ① 真实右键入口 → 第二跳点末成员 → 建摘要并选中新摘要节点 | 真实画布节点命中（pointerdown/up）+ 真实右键菜单 |
| ①b 点回起点 → 单成员摘要（真实挂载） | 同上 |
| ② 同 tick 重复点击只创建一次（真实派发的两次点击） | 真实事件派发 |
| ③ 非法第二跳（跨父）保留草稿并给提示；随后合法点击仍能完成 | 真实菜单 + 生产拒绝链 |
| ④ Esc 清草稿 / ⑤ 点空白清草稿 | 真实键位 / 真实空白点击 |
| ⑥ 文档替换清草稿：B 的第一次点击正常选择，不建摘要（R2 判别） | 真实「最近」菜单替换路径 |
| ⑦ 同内容文档替换也清草稿（不得靠内容比较） | 真实替换事件，断言 `documentToken` 推进 |
| ⑧ 普通编辑 / 保存 / 另存为不得被误判为文档替换 | 真实编辑 + 保存路径（见 §5 未覆盖项 ①：**「另存为」未实际驱动**） |
| ⑨ 无草稿 Shift 路径不变 | 真实 Shift+点击 |
| ⑩ 真实 UI 路径的一次 Undo 撤销完整创建（树 + cid 逐位回原） | 真实 Ctrl+Z 键位 |

`NC3'/NC3` 反向证明其杀伤力：只改生产一行（首判摘掉 / 复位信号废掉）即 6 条转红；prefix 还原 HEAD 后 11 条全挂。⇒ **这 11 条是生产组件证据**。

#### B. 辅助模型证据 —— `apps/canvas/tests/summary-two-hop.test.tsx`（24 条）

修复后该文件 `:42` 改为 `import { useSummaryHop, type SummaryDraft } from '../src/hooks/useSummaryHop.js'`；`:117` 调 `useSummaryHop({ controller, setCommandNotice: setNotice, draftResetToken: token })`。同文件 `:5-11` 自述：「**真实接线的证明不在本文件**……现在复制体已删除：本文件直接 import useSummaryHop」，`:98` 「挂载**生产 hook**」。

⇒ 强度提升：由「内联复刻状态机」升级为「消费生产 hook」，复制体已删除（`grep useSummaryHop` 确认生产 `MindmapStage.tsx:141/718` 与测试共同 import 同一文件）。
⇒ **仍是辅助模型**：它**不挂载 `MindmapStage`**（该文件 `:7` 自述，本次会话 grep 亦确认无 `render(<MindmapStage`），驱动的是宿主侧 `onNodeClick` 首判链的模拟 harness（`:110-125`）。因此它证明的是**状态机契约**，不是**组件接线**。

**两套的分工一句话**：`summary-two-hop.test.tsx`（24，辅助模型）证状态机矩阵；`summary-two-hop-host.test.tsx`（11，真挂载）证接线与 UI 路径。二者不可互相顶替。

#### C. 仍未覆盖的真实接线

- `frame-outline-host.test.tsx` 等既有真挂载套件对摘要分支的 `summary_occurrences` 仍为 0；摘要的真挂载覆盖**只有** `summary-two-hop-host.test.tsx` 一组。
- 真实自由边连接路径未覆盖（见 §5 未覆盖项 ③）。

---

## 4. 负控汇总表（修改点 / 目标红项 / 真实退出码）

### 4.1 R1 一组

| 修改点 | 目标红项 | 真实退出码 | 兜底 |
|---|---|---|---|
| 副本 `summaryCommands.ts` `buildPlan` 还原双分配（2 处） | 3 条「单成员 cid 只分配一次」用例 | **1** | 否 |

### 4.2 R2/R3 一组（三次，同一副本）

| 修改点 | 目标红项 | 真实退出码 | 兜底 |
|---|---|---|---|
| NC1 `draftResetToken` → controller 对象身份 | ⑥ ⑦ | **1** | 否 |
| NC2 `if (summaryHop.hasDraft())` → `if (false && …)` | ① ② ③ ⑧ ⑩ | **1** | 否 |
| NC3 `draftResetToken` 钉死常量 0 | ⑥ ⑦ | **1** | 否 |

基线（未修改工作区、同文件）**REAL_EXIT=0（34 passed）**。

### 4.3 独立复核者的独立负控（复核者自建副本，见 §2.6）

NC1' / NC2'（反向控制）/ NC3' / prefix round-trip 全部「改了生产就转红」，退出码均 1。复核者结论：本轮 4+3 项负控**无任何一项呈现「改了仍绿 / 被下游兜住」**，故 `maskedByDownstream=false` 诚实。

### 4.4 ⚠️ 关于「单处守卫被下游兜住」的诚实记录

**不能声称证明了单一守卫。** 两条实测事实：

1. **NC3 两次运行红项集合不一致**：退出码留档（`r2r3-negative-control-1-exitcode.log`）记 NC3 为 `(6/7 red)`；而本次会话实读的 `r2r3-negative-control-3-reset-signal-dead.log` 是 `Tests 2 failed | 8 passed (10)`——**10 条档、只 2 红**。同一次修改点、两次运行、红项数不同，说明该负控在非确定性条件下**至少一次出现「改了但多数仍绿」**。这本身就是「复位信号被废后仍有下游/其他路径兜住一部分用例」的现场，故**只能证明整体能力，不能证明某一处守卫单独必要**。
2. 复核者亦明确记录了自己副本首跑的假红：`Tests 11 failed` 实为副本 node_modules junction 不完整导致 React 双实例 `Invalid hook call`，补全 4 个 junction 后才是干净的 2 红。该次失败如实留档在 `r2r3-review-nc1-no-bump.log` 与 `r2r3-review-nc1b-no-bump.log`（两份，未覆盖）。

**口径**：本轮负控**整体**成立（三次主负控 exit 1 且红项与改动语义对应），但**不宣称「单一守卫已被证明必要」**。双层中性化只能证明整体能力。

---

## 5. 公共导出清单（逐符号 + 消费者，来自审计）

### 5.1 符号级消费者（素材【导出审计】perSymbol）

| 符号 | 消费者 | 处置 |
|---|---|---|
| `createSummary` | `apps/canvas/src/hooks/useSummaryHop.ts:27`（root import）、`:140` 调用；`MindmapStage.tsx:44`（root import） | **保留**（真实宿主消费者，经包根导入并运行时调用） |
| `SummaryMenuActions`（类型） | `apps/canvas/src/nodeMenuBags.ts:29,65`、`NodeContextMenu.tsx:23,70`、`apps/canvas/tests/summary-two-hop.test.tsx:31,178`（均 root import） | **保留**（真实跨包根导入，宿主动作袋类型） |
| `mergeSummaryOf` | 仅 `packages/react/tests/summary-create.test.ts:34,491,497,510-515`（深路径） | 保留存疑 / 可移除（无跨包根消费者） |
| `planCreateSummary` | `apps/canvas/src/summaryInteraction.ts:25,28,39` 仅在**注释**中提及，无代码调用；仅包内测试深路径使用 | 存疑 / 倾向可移除（无运行时或类型化消费者；`index.ts:205` 注释称「宿主可预览」但无宿主如此做） |
| `summaryOfNode` | 仅 `packages/react/tests/summary-create.test.ts:36,655,658,661`（深路径） | **可移除**（包外零消费者） |
| `SUMMARY_DEFAULT_TEXT` | **无** | **可移除**（全仓仅 `summaryCommands.ts:38,220` 定义 + `index.ts:211` 重导出） |
| `CreateSummaryResult`（类型） | **无** | **可移除**（仅 `summaryCommands.ts:74,240` + `index.ts:214`） |
| `SummaryPlan`（类型） | 仅 `summary-create.test.ts:37,115`（深路径） | **可移除** |
| `SummaryPlanError`（类型） | 仅 `summary-create.test.ts:38,120,122`（深路径） | **可移除** |
| `SummaryPlanErrorCode`（类型） | **无** | **可移除**（仅 `summaryCommands.ts:41,54,114` + `index.ts:217`） |
| `SummaryPlanOk`（类型） | 仅 `summary-create.test.ts:39,115`（深路径） | **可移除** |

可移除清单（9 项）：`SUMMARY_DEFAULT_TEXT`、`CreateSummaryResult`、`SummaryPlanErrorCode`、`mergeSummaryOf`、`summaryOfNode`、`SummaryPlan`、`SummaryPlanError`、`SummaryPlanOk`、`planCreateSummary`。
其中 `planCreateSummary` 是否作为宿主公开 API 属设计意图、代码不可确认，标注**不确定**。

### 5.2 入口 diff 与解析核实

`git diff -- packages/react/src/index.ts`：**空输出，exit 0**（S2 加法已提交于 `9cac632`，工作树相对 HEAD 干净）。锚定 diff `git show 9cac632 -- packages/react/src/index.ts` 见素材【导出审计】`indexDiff` 原文（新增 5 个值符号 + 5 个类型符号 + `SummaryMenuActions`）。

解析核实：
- 命令 1：`cd .../apps/canvas && node -e "…createRequire(process.cwd()+'/package.json').resolve('@mindcanvas/react')"` → `RESOLVED: E:\...\wt-summary-node-s2\packages\react\dist\index.js`（`apps/canvas/node_modules/@mindcanvas/react` 为符号链接 → `packages/react`）。
- 命令 2：`node --input-type=module -e "import * as m from 'file:///.../packages/react/dist/index.js'; …"` → `PRESENT createSummary function` / `mergeSummaryOf` / `planCreateSummary` / `summaryOfNode` / `SUMMARY_DEFAULT_TEXT string` / `EXPORT_COUNT 350`。
- 命令 3：`grep -n "\b<sym>\b" packages/react/dist/index.js` → `:48 export { createSummary, mergeSummaryOf, planCreateSummary, summaryOfNode, SUMMARY_DEFAULT_TEXT, } from './edit/summaryCommands.js';`（5 个值符号齐全）。
- 命令 4：`grep -c "\b<sym>\b" packages/react/dist/index.d.ts` → 11 个符号各 `: 1`。

结论：入口解析到真实 `packages/react/dist/index.js`，全部 11 个 S2 符号确在构建产物中导出（5 值运行时验证，6 类型 d.ts 验证）。日志：`s2-resolution.log`、`s2-dist-runtime-export-check.log`。

---

## 6. 最终候选：SHA、变更清单、终态哈希

**以下取值均为本次会话在 `<workspace>/.workbuddy/wt-summary-node-s2` 实跑 git 命令所得。**

### 6.1 提交

```
git rev-parse HEAD
→ 0d77197f57a0f963845fe3074f65cad5ff2f2458
git branch --show-current
→ codex/summary-node-s2-20260920
```

- **本轮未产生新提交**，改动全部留在工作区（`git status --short` 下列为 ` M` / `??`）。
- `git merge-base --is-ancestor 0d77197 HEAD` → 通过（**原提交保留，未 amend、未覆盖**）。

### 6.2 工作区终态哈希

聚合终态哈希（`git stash create "S2-REPAIR-01-final-candidate"`）：

```
75a6f5cd1d6266778155002f21a162a20b40e848
```

> 该值把 tracked 改动 + 未跟踪新文件一并纳入快照对象；`outputs/` 与 `.zcode/` 亦在未跟踪之列，故它锚定的是**当前工作区整体**，不单指源码候选。复核者另建的对称快照为 `25b544f70ccdc28a371cfaaaa6a44c874a1f0f6b`（同一工作区、两次 `stash create` 取值不同，因其为非确定性快照对象 ID）——**两值均仅作现场锚定，不构成可复现指纹**；可复现指纹以下表逐文件 SHA256 为准。

### 6.3 逐文件变更清单 + SHA256（本次会话实跑 `sha256sum`）

| 状态 | 文件 | 行数变化 | SHA256 |
|---|---|---|---|
| M | `apps/canvas/src/MindmapStage.tsx` | +163/-… | `b63625d4f20885a5d96d66924f8d33f3db3eaf5897c953b2937b7d0080b25f5e` |
| M | `apps/canvas/src/hooks/useDocumentActions.ts` | +18/-… | `9dc3e09c8aecfae951e6b3e9877deb8aad299bffc087a51d1a45d1e3812b99c9` |
| M | `apps/canvas/src/summaryInteraction.ts` | +15/-… | `9b1fac76a1e2e19d3ae7d1fb961f65f29cfa70926f1e6f237df4bd47bb7dbc90` |
| M | `apps/canvas/src/vite-env.d.ts` | +36 | `24140fd8b4a8e339c831bca1892a2078e5fba4a7b042f20142863f3a9d2f9bfa` |
| M | `apps/canvas/tests/summary-two-hop.test.tsx` | 400 行变更 | `366ef0d02e391a0dc7407f8cb5cf17cdca4011da935e1334f090d3079029258f` |
| M | `packages/react/src/edit/summaryCommands.ts` | +11/-… | `2be1d50a564313d51215b7619b7698c1b7b0afa69dde8853fba449fb622fda66` |
| M | `packages/react/tests/summary-create.test.ts` | +112 | `744452127ebeee59b62712129a25e35e99eaa6de3f883ee5be8b09ce3d592a9c` |
| ?? | `apps/canvas/src/hooks/useDocumentToken.ts`（新） | — | `6100dd90fe23d323ce6e6936709edd077914512209c66723052aff3b7cf830da`（blob `7d7da9d109cad33e61912875c2dc063f27469472`） |
| ?? | `apps/canvas/src/hooks/useSummaryHop.ts`（新） | — | `97ab36236f33cf4d5e3cb436d66a7c31793b54f17a04871d512d7b17f11c4b4d`（blob `cadf839a25584c5b85d679194ff0896c55534343`） |
| ?? | `apps/canvas/tests/summary-two-hop-host.test.tsx`（新） | — | `28528481b99256c65b03b7895a20ff9a27594a2b8f7049134e172209b504517a`（blob `7a1390ac3e658e89810a180d5d897d6fd7333514`） |

`git diff --stat`（tracked）：**7 files changed, 461 insertions(+), 294 deletions(-)**。

> **注**：`sha256sum` 行内 `*` 前缀已去掉；`nul`（Windows 保留名遗留文件）与本轮无关（见 §8）；`outputs/`、`.zcode/` 不计入源码候选。

---

## 7. 门禁结果与未覆盖项

### 7.1 门禁（素材【门禁（脚本实测）】，命令均由脚本实跑）

| 门禁 | 命令 | 退出码 | 实测结果 |
|---|---|---|---|
| build | `pnpm --dir .../wt-summary-node-s2 run build` | **0** | react build Done；canvas `vite v8.2.2` `✓ 248 modules transformed`、`✓ built in 568ms`、Done |
| react 定向 | `pnpm --dir ... --filter @mindcanvas/react exec vitest run tests/summary-create.test.ts tests/summary-menu.test.ts` | **0** | 2 files / **45 tests passed** |
| canvas 定向 | `pnpm --dir ... --filter canvas exec vitest run tests/summary-two-hop.test.tsx` | **0** | 1 file / **24 tests passed** |
| react 全包 | `pnpm --dir ... --filter @mindcanvas/react run test` | **0** | （输出为 jsdom `not implemented` 噪音，未含计数行） |
| canvas 全包 | `pnpm --dir ... --filter canvas run test` | **0** | （同上，计数行见 `r2r3-canvas-suite.log`：**45 files / 388 tests passed**） |
| typecheck | `pnpm --dir ... run typecheck` | **0** | free-canvas / kernel / react / canvas 全部 Done |
| depcruise | `pnpm --dir ... run depcruise` | **0** | `✔ no dependency violations found (550 modules, 1645 dependencies cruised)` |
| lint | `pnpm --dir ... run lint` | **0** | 本次会话独立复跑 `biome lint packages apps` → `Found 1545 warnings.` / `Found 48 infos.`，与修复前基线逐位相同 |
| budget | `pnpm --dir ... run budget` | **0** | `asCast 31 31 持平`；`bang 89 90 ↓1 优于`；console/todo/defaultExport/bigFiles 全持平；`✅ 全部指标在预算内` |

其它包计数（来自修复者留档 `r2r3-all-packages-test.log` / `r2r3-react-suite.log`，非本次会话复跑，见 §7.2）：

- kernel 70 files / **656 tests**
- free-canvas 3 files / **12 tests**
- react **157 files / 1599 tests**
- `pnpm -r test` EXIT=0

### 7.2 未覆盖项

1. **`⑧` 用例名含「另存为」，但正文未实际驱动另存为**：`summary-two-hop-host.test.tsx:478` 用例名写「普通编辑 / 保存 / **另存为**不得被误判为文档替换」，正文 `:479-506` 只驱动「编辑」与「保存」；全文件 grep「另存为」只命中用例名那一行。复核者以「保存也 bump」注入生产后 ⑧ 确实转红（`exit 1，Tests 1 failed | 10 passed`），故（A）「保存」部分经真实变异验证；而 `handleSaveAs` 不调 `performApplyDoc`、令牌不推进这一点是**读源码得出**（`useDocumentActions.ts:158-161` `applyDoc` 只在替换分支调 `performApplyDoc`；`handleSaveAs` 走 `:284` 附近 `savedSource` 回填），**未经运行验证**。建议收窄用例名或补真实另存为断言。
2. **`useDocumentSwitch.ts:36-40` 注释已失真（先前轮次遗留，非本轮引入）**：该可选参数注释称「此处覆盖不经 applyDoc 的替换路径」，但全文件 97 行**从未使用 `session`**（死参数）。R2 依赖「`applyDoc` 是唯一整体替换入口」这一不变量，而该不变量在 `performApplyDoc` 里**单点维护、无结构性防护**；未来若新增绕过 `applyDoc` 的替换路径，R2 会静默复发。建议接上守卫或删死参数改注释。
3. **断言粒度**：`⑥`（真实「最近」菜单替换）只断言 `hasDraft()` 与第一个断言点，**未断言 `documentToken` 真的推进**（`⑦` 断言了 token）。复核者自建探针在候选上验证了 ⑥ 路径 `draftAfterReplace=false` 且首点选中新文档节点，不影响结论，但 ⑥ 的 token 推进本身是**间接推得**。
4. **同内容替换若不经 `applyDoc`**（如启动页 `onOpenRecent` 的 `setDoc` 直通、或宿主自行 `setDoc`）**不会推进令牌**。实测该路径只发生在 `StageContent` 挂载前（启动页早退分支），此时不可能存在草稿；但这条依赖「启动页只在冷启动出现一次」的既有假设，本次**未构造「挂载后再走 setDoc 直通」的反例**。
5. **`⑨` 用例**只断言「无草稿时 Shift+点击不变成摘要且选中跟随」；真实建自由边需先切关系模式（E8 契约），**该路径不在本包范围，未覆盖连边本身**。
6. **R1 的单成员 cid 去重实现本轮未改动**，仅经 1599 条 react 用例与真实挂载的单成员用例间接验证；**未对其做独立负控**（独立负控由复核者补充，见 §1.4）。
7. **「一次 Undo 撤销完整创建」**在真实挂载下断言的是序列化快照逐字回原（含 cid/next_cid/结构），**未额外断言键盘焦点与 undo 栈深度**等旁路事实。
8. **R1 的 `save.path.summaryId` / 「只增一个节点」这类形状断言按任务书未加**：单条 undo 由既有「单条 undo 完整还原」+ 新增「逐位还原/redo」覆盖，**未直接断言 `applyTransaction` 调用次数**。
9. **阴性对照在隔离副本只跑了目标文件**（`tests/summary-create.test.ts`），**未在副本跑全包**；全包只在主 worktree 跑过（157 files / 1599 tests 绿）。
10. **未做 `git commit`**（本轮改动留在工作区）。
11. **任务书示例的 UIA-T-NOTE-SUMMARY-ID 级 UI 用例不在本包**（仅 protocol 层 `summary_of`）；本轮「id 稳定性」在协议层用 `resolveSummaries` 的 `summaryNodeId/memberIds` 断言，**未新增 UI 级用例**。
12. **未跑 `pnpm gate` 整条**；复核者只分别跑了其子项（build 未单独跑，typecheck/depcruise/lint/budget/test 均跑且 exit 0）。
13. **未验证 `useDocumentToken` 的 `mountSeq` 在 HMR / 多实例并发下的行为**（超出本轮 R2/R3 范围）。
14. **本轮 §7.1 表格中 react 全包 / canvas 全包的计数行未在本次会话重新复跑**（本次会话只复跑了 `biome lint` 得到 1545/48 与上述 git/哈希命令）；157 files/1599 tests 与 45 files/388 tests 来自修复者留档日志与素材【门禁】输出，已标注来源。

---

## 8. 基线 canvas 首跑失败：保持「未定位失败」口径

前序回执 `docs/dispatch/2026-09-20-summary-node-s2-report.md` 已披露（本次会话实读其 `:34-36`、`:478-479`）：

> 基线首跑出现 `1 failed | 43 passed / 352 passed`，……**未定位到具体用例**（首跑日志的失败用例名未被保留——见 §11 未覆盖项）。
> canvas 起点 flake 未定位：基线首跑 1 failed、复跑 2 次全绿。该 flake 在**起工基线即存在**，与 S2 无关。

**本回执维持该口径，不因随后通过而宣告已确认稳定性：**

- 该失败在**起工基线**即存在，与本轮返修无因果关系。
- 首跑日志只截了 tail，**失败用例名未保留** ⇒ **未定位到具体用例**，其根因**未知**。
- 后续两次通过**不构成**「已确认稳定」的证据——失败用例名未知，无法判断复跑是否覆盖同一用例，也无法排除 flake。
- 该 flake 至今**未定位、未解释、未修复**，列为已知残余不确定性。

---

## 9. 本轮边界：新增强调

- **未启动 S3。**
- **未 push、未发布**（`git status` 显示改动全部在工作区；`HEAD` 仍为 `0d77197`）。
- **保留原提交、原回执、原证据，未覆盖、未 amend**：`0d77197` 仍为 HEAD、亦为 HEAD 的祖先；`docs/dispatch/2026-09-20-summary-node-s2-report.md` 未改动；`outputs/summary-node/S2/20260920-S2-01/` 未改动。
- 本轮**新增**内容全部落在 `outputs/summary-node/S2/20260920-S2-REPAIR-01/`，**不覆盖** `0d77197` 的证据目录 `20260920-S2-01`。已有失败日志（如 `r1-repro*.log`，22:28 时间戳）**原样保留未覆盖**。
- `.workbuddy/wt-summary-node-s2/nul` 为先前会话遗留的 Windows 保留名文件（`git status` 显示 untracked，非本次产生），本次未删除以避免越界改动；不影响任何门禁。
- 隔离副本 `mindcanvas-nc-s2r1` / `mindcanvas-nc-s2r3` / `mindcanvas-s2r1-nc` / `mindcanvas-s2r2r3-nc` / `mindcanvas-s2r2-prefix` 均已由各自操作者删除；临时探针文件已删（`ls tests/ | grep zz-` 无命中）；主工作树源码/测试/报告**零修改**（除本轮返修文件本身）。

---

## 10. 证据日志索引（`outputs/summary-node/S2/20260920-S2-REPAIR-01/`）

| 日志 | 内容 |
|---|---|
| `r1-discriminating-red.log` | R1 修前 3 红（exit 1） |
| `r1-final-green.log` / `r1-discriminating-green*.log` | R1 修后 39 绿（exit 0） |
| `r1-full-react-after.log` / `r1-typecheck-after.log` | react 全包 1599 绿 / typecheck exit 0 |
| `r1-negative-control.log` / `r1-negative-control-exitcode.log` | R1 负控红项与退出码 |
| `r1-repro.log` / `r1-repro-v2.log` / `r1-repro-probe.log` / `r1-test-diff.log` | R1 复现与测试增删 |
| `r2r3-before-repro-prefix-prod.log` | R2 修前真挂载 2 红（exit 1） |
| `r2r3-after-two-hop.log` | R2 修后 34 绿（exit 0） |
| `r2r3-negative-control-{1,2,3}-*.log` / `-exitcode.log` | R2/R3 三次负控红项与退出码（含 §4.4 的 10 条档差异） |
| `r2r3-canvas-suite.log` | canvas 45 files / 388 tests |
| `r2r3-react-suite.log` / `r2r3-all-packages-test.log` | react 1599 / 全包 |
| `r2r3-lint.log` | lint 1545 warn + 48 info |
| `s2-resolution.log` / `s2-dist-runtime-export-check.log` | 导出解析与 dist 运行时导出核实 |
| `01-prod-callsites.log` … `06-sample-helpers.log` | R3 取证（生产调用点 / 测试是否 import / 真挂载样本 / 辅助助手行号） |
| `10-*` … `22-*`（`r2r3-review-*` 前缀为复核者） | 独立复核全过程日志（含 `r2r3-review-nc1-no-bump.log`、`-nc1b-`、prefix round-trip、lint JSON 基线） |

*本回执所有 git 值、SHA256、lint 计数由本次会话实跑命令取得；其余结果均标注来源为素材或留档日志，未混称。*
