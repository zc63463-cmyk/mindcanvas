# S2G 派遣计划：保存侧同步守卫（防「画布树不属于该文档」的误写）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 S2G 保存侧同步守卫派遣计划`），然后再动代码。
> 来源：S2F 复核收尾决策（2026-09-15，用户裁定「做守卫」）。本批**不 push**。

## §0 基线（开工先核对，不符先报告）

- 起点 HEAD = `b4967b3`（S2F 收口；未推送状态按现状继续，**不代执行 push**）。
- 三包：kernel **523** / react **1266** / canvas **203** = 1992 全绿；depcruise **439/1250** 零违规；lint **1468+46**；budget 持平（bigFiles 3/4）。
- 未跟踪保留物：`_tmp_93540_*`、`tmp-v7-s1/s2.diff`（来源未识别，**不动**、报告列出）；`tmp-r2-src.diff` / `tmp-r2-test.diff`（复核者残留，**本批可清**，若仍在）；`tools/graph-engine/`（**禁区**）。
- 本批只改 `apps/canvas` → **无需重建 dist**（报告注明）。

## §1 背景（守卫要防什么；为什么必须是「簿记」而不是随手一行）

- S2F 已修**根因**（启动页出口「首挂不同源」）。其数据风险面是：错位窗口内 `useAutoSave` 会把 controller 树**以目标文档身份** `docHost.save({ ...doc, source })` 落盘 = **覆盖用户文档**。
- 守卫 = 第二道闸，防"将来再出现同类错位"。**复核已论证两个直觉判据不可用**：
  - `doc.source` vs `controller.serialize()`：E 批口径下 `doc.source` 不随编辑更新 → 正常保存时恒不等 → 全误报；
  - `controller.root === editable`：编辑走不可变更新，`root` 每步换对象 → 同样恒不等 → 全误报。
  ⇒ 必须维护一条**同步标记**：`syncedSourceRef: RefObject<string | null>` =「controller 的树所对应的 `doc.source`」。
- **判定**：`canWriteDoc(syncedSourceRef.current, doc.source)`（精确等值）。**只在"确定同步"的时刻置位**。

## §2 任务

### S2G-1 · 基建 + 三写点 + 两读点

a. 新模块 `apps/canvas/src/hooks/saveGuard.ts`：`canWriteDoc(synced, docSource)`（`===` 谓词）+ `SAVE_BLOCKED_NOTICE` 文案常量（两处通知同源）。
   推荐文案：`已阻止保存：当前画布内容与文档不同步（防误写）。改动未丢失——请用「另存为」保存到新文件，然后重新打开原文档。`

b. **写点（置位，恰 3 处）**：
   1. `apps/canvas/src/MindmapStage.tsx` controller 创建处（`controllerRef.current === null && editable` 分支内）→ `syncedSourceRef.current = doc.source`；
   2. `apps/canvas/src/hooks/useDocumentSwitch.ts` **skip 分支**（`isFirst && controllerRef.current?.root === editable` 成立、return 前）→ 置位（幂等）；
   3. `useDocumentSwitch.ts` **reset 分支**（`controllerRef.current?.reset(editable)` 之后）→ 置位。
   - `if (!editable) return;` 早退**不置位**（解析失败时标记保持旧值 → 后续写盘被拦，正确方向）。

c. **读点（拦截，恰 2 处；第 3 个写盘点 `handleSaveAs` 不拦）**：
   1. `apps/canvas/src/hooks/useAutoSave.ts`：**定时器回调内、`serialize()` 之前**检查；不同步 → 不写、不 `markSaved`、`dirty` 保持；通知**每 `doc.source` 一次**（ref 防刷屏）；拦截后不自动重试（依赖下一次 dirty 边沿或手动动作，报告说明）。
   2. `apps/canvas/src/hooks/useDocumentActions.ts` `handleSave`：`runSave` 任务开头检查；不同步 → 不写、不改 `savedSource`/不 `markSaved`；通知**每次**（用户手势触发，无刷屏问题）。
   - `handleSaveAs` **放行**（逃生口：把改动救到新文件）。已接受边界：用户在系统选择器里自行覆盖原文件属知情操作——报告注明。

d. **接线**：两个 hook 新增 `onBlockedSave?: (msg: string) => void`；StageContent 接线 `setCommandNotice`（既有 4s 消退通道）。`StageInner → StageContent` 新增 `syncedSourceRef` prop（同 `controllerRef` 先例）。`useDocumentSwitch` 新增 `syncedSourceRef` option。

### S2G-2 · 判别钉（先红）

- `apps/canvas/tests/useDocumentSwitch.test.tsx`：**t5 置位钉** —— reset 后 `ref === doc.source`；首挂不同源（S2F t3 场景）reset 后同样置位；`editable=null` 早退**不置位**。
- `apps/canvas/tests/useAutoSave.test.tsx`（既有文件）：① 不同步 + dirty → **不写** + 通知恰一次 + 再触发不重复通知；② 置位后 → 写盘恢复；③ **既有用例全绿**（误伤率钉，mock 按需补 `syncedSourceRef` 字段——同 S2F mock 先例，缺省同源 = 现行为）。
- `apps/canvas/tests/useDocumentActions.test.tsx`（既有文件）：① `handleSave` 不同步 → 不写 + 通知 + `savedSource`/标记不动；② 同步 → 照常（现行为钉）；③ `handleSaveAs` 在"不同步"下**放行**。
- **红证据**：测试先行 → 当前实现红（守卫未实现：写盘照发 / 通知未发）→ 贴原文。

### S2G-3 · 收口

- **阴性对照（自证）**：临时把 `canWriteDoc` 改成恒 `true` → 新钉转红（贴原文）→ 回退。
- CHANGELOG 新段 **[1.8.20]**（触发/设计/边界：saveAs 逃生口与"拦截后不自动重试"）。
- 报告 `outputs/2026-09-15-s2g-save-guard-report.md`：红/绿原文、置位/读点设计表、误伤率说明（既有 save 用例全绿证据）、边界清单。
- 门禁：tsc×3 = 0；三包（kernel 523 不动 / react 1266 不动 / canvas 203+Δ）全绿；depcruise 零违规；lint **≤1468+46**；budget 持平。
- 定向清理：本批自产 `tmp-*` + `tmp-r2-src.diff` / `tmp-r2-test.diff`（若仍在）；保留 `_tmp_93540_*`、`tmp-v7-s1/s2.diff`、`tools/graph-engine/`。

### 提交计划（每任务一条，禁 `git add -A`/`git add .`）

1. `docs: 追加 S2G 保存侧同步守卫派遣计划`
2. `feat(canvas): 保存侧同步守卫（syncedSourceRef 三写两读；拒写通知 + saveAs 逃生口）`（含全部新钉；报告记录先红后绿）
3. `docs: S2G 收口（CHANGELOG [1.8.20] + 报告）`

## §3 决策点（已给推荐，按推荐执行，不要停下问）

- **D1 守卫键** = `doc.source` 字符串（与 switch effect deps 同钥匙）。边界已接受并需报告注明：**两份内容逐字相同的文档互切** → 视为同步（沿 E 批"source 不变 = 不重建"语义）。
- **D2 通知策略** = 自动保存每 source 一次 / 手动保存每次。
- **D3 `handleSaveAs` 放行**、不做"另存后清标记"（会话仍是原文档身份，**保持拦截是正确的**——报告说明）。
- **D4 模块形态** = `saveGuard.ts` 小模块（谓词 + 文案单点）。若执行中认为过度抽象 → 可内联，但**两处通知文案必须同源**，报告给理由。
- **D5 版本** = `[1.8.20]`。

## §4 停止条款

- 若发现除 3 个写盘点外还有其它 `docHost.save(` 路径（复核已核 3 处）→ 停。
- 若**任一既有正常路径被判不同步**（误伤）→ **停并修判据**（不许放宽断言绕过；守卫原则 = 只在"确定不同步"时拦）。
- 若需放宽任何既有测试 → 停。
- lint 上升 / budget 超限 / depcruise 违规 → 停。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + 红/绿断言原文 + 新增用例数。
- S2G-1：`saveGuard.ts` + 三写两读的 diff 原文。
- S2G-2：新钉红 → 绿原文；既有 save 用例全绿证据（文件/用例数）。
- S2G-3：阴性对照原文 + 门禁原样 + `git status --short` 原文 + 清理结果 + 边界清单。
- 偏差与原因；然后停，等复核（**不 push**）。

## §6 冻结纪律

阈值/契约测试不得放宽；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`；`CULL_MARGIN` 不动；不改 git config；四动作/`remember`/effect deps（`[doc.source]`）与 S2F 判据逐字不动；报告必须含红/绿原文，不许"已修复"式无证据陈述。
