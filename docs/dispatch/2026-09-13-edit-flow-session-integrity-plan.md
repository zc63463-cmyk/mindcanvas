# 派遣计划：编辑流保全（保存不打断会话）— 批次 E

> 日期：2026-09-13 · 基线 HEAD：`a10fc59`（关系线 R4 收口）
> 起因：用户实测反馈——**每次编辑提交或新建节点后，页面"回正刷新"，选中与正在编辑的内容丢失，必须重新点节点**。
> 本计划已把因果链完整定位到 file:line（§1），修复目标是**切断「保存 → 文档重建」回读环**，并给两端各留一条判别性守卫。

---

## §0 基线与 DoD

### 起点基线（当前实测，执行前必须逐项复核）
| 项 | 值 |
|---|---|
| HEAD | `a10fc59`（工作树干净；仅 `tools/graph-engine/` 未跟踪——**Python venv 残留，勿动勿提交**） |
| 三包套件 | kernel **480** / react **1093** / canvas **170** = **1743** |
| 门禁 | tsc ×3 = 0；`tsc -p packages/react/tsconfig.build.json` = 0；depcruise = 0（402 模块）；biome lint = 0（1481 warnings + 46 infos，**水位不得上升**） |
| budget | 全持平：any 0 / tsIgnore 0 / bang **89/90** / asCast **31/31** / console 4/4 / todo 1/1 / defaultExport 2/2 / **bigFiles 3/4** |
| 超 600 行 | `MindmapStage.tsx` **2269** / `edgeRouting.ts` 1213 / `MapView.tsx` 2088（新文件一律 <600 行） |

### DoD（批次完成时）
1. 三包套件全绿，且新增用例全部为**判别性**（红→绿有据）。
2. **两条阴性对照**由执行方自跑并贴证据（§2 附录）：
   - 把 `useAutoSave` 的补丁改回 `source` → `useAutoSave` 判别用例必红；
   - 把 `useDocumentSwitch` 的 deps 改成对象身份 `[doc]` → 其判别用例必红。
3. `doc.source` 的全部读取点完成口径核对（§1.4 的 7 处清单逐条签字，证据 = `git grep` 原始输出）。
4. 预算持平（bigFiles 仍 **3/4**；`MindmapStage.tsx` 行数应**下降**）；阈值/契约测试**零放宽**；`CULL_MARGIN` 不动。
5. CHANGELOG 追加 `[1.8.8]` 段。

---

## §1 实现前必读（本轮取证，全部带 file:line）

### 1.1 因果链（"页面回正刷新"的真身）
```
① 编辑提交 / 新建节点 → controller.dirty = true
        ↓ 300ms debounce（MindmapStage.tsx:445-471；deps=[controller.dirty, doc.saved, doc.id] 见 :471）
② autosave：serialize() → docHost.save() → setDoc((d)=>({ ...d, source, handle, ts }))   ← ★ 病根
        ↓                                                                  （MindmapStage.tsx:456-461）
③ doc.source 变化 → 数据管线重解析：buildEditable(doc.source)（:190，每次解析都重新生成节点 id）
        ↓
④ 文档重建 effect（:374-395，deps=[doc.source] 见 :395）：
      controllerRef.current?.reset(editable)   // :390  ← 全清
      setEntities(buildEntities(...))           // :391
      setExpandedQaId(null)                     // :392
      apiRef.current?.fit()                     // :393  ← 「页面回正」的真身
```
`apiRef.current?.fit()` = `viewport.fitBoundsAnimated(layout.bounds)`（`MapView.tsx:1152`）。

### 1.2 `controller.reset()` 清了什么（`packages/react/src/edit/controller.ts:462-470`）
```ts
reset(initial: EditableNode): void {
  this.history.reset(initial);   // ← Undo 历史清空（编辑后 300ms，Ctrl+Z 就废了）
  this.collapsed = new Set();    // ← 折叠态清空（画布跟着重排）
  this.storage?.save([]);        // ← 连 localStorage 里的折叠持久化也一并抹掉
  this.selectedId = null;        // ← 选中丢失（用户"要重新点节点"）
  this.editingId = null;         // ← 正在编辑的内容丢失
  this.dirty = false;
  this.notify();
}
```
**四类损失**：选中 / 编辑中（`editingId`、`descEditingId`）/ Undo 历史 / 折叠态；外加视口回正、以及每次保存一次全量重解析（大文档白付 parse + 全树重建）。

### 1.3 触发条件（决定了测试夹具怎么写）
- autosave 早退条件：`!controller.dirty || !doc.saved || !doc.handle`（`:446`）→ **只有"绑定过文件句柄"的文档**会触发。
- 手动 Ctrl+S / 另存为走同一写回：`setDoc((d)=>({ ...d, source, ... }))`（`useDocumentActions.ts:142` 与 `:155-161`）→ **无句柄文档手动保存后同样中招**。
- 手动保存前会取消 pending autosave（`useDocumentActions.ts:122-125`）——这是既有正确行为，别动。

### 1.4 `doc.source` 的全部读取点（全仓 grep 实测，共 7 处）——本批口径核对清单
| # | 位置 | 用途 | 本批处理 |
|---|---|---|---|
| 1 | `MindmapStage.tsx:190` | 解析输入 `buildEditable(doc.source)` | **不动**——它就该只认「打开时内容」 |
| 2 | `MindmapStage.tsx:395` | 重建 effect deps `[doc.source]` | **不动**——同上（本批让它永不被保存路径击穿） |
| 3 | `MindmapStage.tsx:788-796` | `library.upsert({ source: doc.source })`（最近文档**内容快照**）+ deps `:796` | **改口径** → `doc.savedSource ?? doc.source`，deps 加 `doc.savedSource` |
| 4 | `document.ts:115,119` | `save()` 写盘用**调用方传入**的 source | 不动（调用方传新内容） |
| 5 | `document.ts:143` | `remember()` → `library.upsert({ source: doc.source })`，**契约 = 「传入即内容」** | **不动**（见下方坑 1） |
| 6 | `docLibrary.ts:152` | `DocEntry.source`（内容快照，供「最近文档」恢复） | 不动 |
| 7 | `FileManagerModal.tsx:87` / `StartupScreen.tsx:46` | 从 DocLibrary 快照打开 / 计数 | 不动 |

> **关键设计**：`source` 的语义收敛为「**本次会话打开/新建时的内容**（= 解析输入）」；新增 `savedSource` 承担「**最近一次成功保存的内容快照**」。两者拆开后，保存路径不再改变任何 effect 的输入 → 重建只在**真正的文档切换**发生。

### 1.5 实现前必须知道的坑
1. **不要顺手改 `remember()`**：调用方（`useDocumentActions.ts:144`）传的是 `{ ...doc, source: 新内容 }`；若把 `remember` 内部改成读 `doc.savedSource`，spread 会保留**旧** `savedSource` → 最近文档存旧内容。它的契约就是"传入即内容"。
2. **`reset()` 的 `storage.save([])`（`controller.ts:465`）会抹掉折叠持久化**——本批**不拆 reset 语义**（E-A3）：切断回读环后不存在误触路径，拆它只会扩大改动面。
3. 新增字段的消费点必须写 `doc.savedSource ?? doc.source`：新建文档在首次保存前只有 `source`。
4. 抽 hook 是**纯搬迁**：deps 数组（`[controller.dirty, doc.saved, doc.id]`）与 `// eslint-disable-next-line react-hooks/exhaustive-deps` 注释**原样保留**，否则 lint 水位或行为会漂。
5. `saving` 指示（`setSaving`）与 `markSaved()` 的时序是 FA1-T1 既有行为，不得改。
6. 判别测试夹具（照抄 `apps/canvas/tests/useDocumentActions.test.tsx:20-25` 的 fake controller 写法）：
   - fake controller：`{ dirty: true, serialize: () => 'SRC', markSaved: vi.fn() }`
   - fake docHost：`{ save: vi.fn(async () => ({ result: 'fs', handle: HANDLE })) }`
   - `doc` 必须同时满足 `saved: true` 且带 `handle`，否则进不了 autosave（`:446`）
   - 假定时器用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(300)`
7. **真浏览器验证不可行（E-A5）**：autosave 需要真实 `FileSystemFileHandle`，无头脚本无法 seed；**不要写 verify-*.mjs**，判据由 hook 级判别测试承担。

---

## §2 任务（逐任务 TDD：先红 → 实现 → 绿 → 一条 commit）

### E-1 `MindDoc.savedSource` + 抽 `useAutoSave` + autosave 改口径
**Files**
- Modify: `packages/react/src/edit/document.ts`（`MindDoc` 加 `savedSource?: string` + 语义注释）
- New: `apps/canvas/src/hooks/useAutoSave.ts`（纯搬迁 `MindmapStage.tsx:445-471`；签名与 `useDocumentActions` 同风格）
- Modify: `apps/canvas/src/MindmapStage.tsx`（删 445-471，改为调用 hook；`:433-443` 的接线顺序注释保留）
- New: `apps/canvas/tests/useAutoSave.test.tsx`

**TDD 步骤**
1. 先加 `MindDoc.savedSource?: string`（纯类型，无行为；打上「最近一次成功保存的内容快照；解析输入请用 source」注释）。
2. 写 `useAutoSave.test.tsx`（判别 + 早退），**预期两段红**：
   - 第一段：`Cannot find module '../src/hooks/useAutoSave'`（红①）
   - 抽 hook（搬迁时**故意保留旧口径 `source`**）→ 再跑：`savedSource` 断言失败（红②，证明测试有判别力）
3. 改口径为 `savedSource` → 全绿。

**断言清单（最终应全绿）**
- a) `dirty=true` + `saved=true` + 有 handle → 推进 300ms → `docHost.save` 收到新内容；`setDoc` 的 updater 传入 `{...doc, source: 'OLD'}` 时返回 `savedSource === 'SRC'` 且 **`source === 'OLD'`（未被改写）**；`markSaved` 恰一次；`saving` true→false。
- b) `dirty=false` → 不排定时器（save 零调用）。
- c) 无 `handle` → 不排。
- d) `doc.saved=false` → 不排。
- e) unmount → 清理定时器（`clearTimeout` 被调）。

**Commit**：`fix(canvas): 自动保存改写 savedSource 而非 source（切断保存→重建环）`

### E-2 手动保存同口径（`useDocumentActions` 两处补丁）
**Files**
- Modify: `apps/canvas/src/hooks/useDocumentActions.ts`（`:142` handleSave、`:155-161` handleSaveAs 的 setDoc 补丁 → `savedSource: source`，**不再写 `source`**）
- Modify: `apps/canvas/tests/useDocumentActions.test.tsx`（+2 例；既有 24 例应**原样全绿**——现有断言只看 `docHost.save`/`remember`/`markSaved`，未检查 setDoc 补丁内容）

**TDD**：先写 2 例（断言 setDoc updater 产出 `savedSource === 'NEW-SRC'` 且 `source` 保持旧值；`remember` 仍收 `source: 'NEW-SRC'` 作回归钉）→ 红 → 改实现 → 绿。
**Commit**：`fix(canvas): 手动保存/另存为不改写 doc.source（同口径）`

### E-3 抽 `useDocumentSwitch` + 判别测试（消费端守卫）
**Files**
- New: `apps/canvas/src/hooks/useDocumentSwitch.ts`（纯搬迁 `MindmapStage.tsx:371-395`）
- Modify: `apps/canvas/src/MindmapStage.tsx`（改为调用 hook）
- New: `apps/canvas/tests/useDocumentSwitch.test.tsx`

**搬迁纪律（逐条保持）**
- `firstDocEffectRef` 首挂跳过；首挂**仍要**执行 `entityHost.remember(...)`（`:378-388`），只跳过其后 4 个动作；
- 动作顺序不变：`reset → setEntities → setExpandedQaId(null) → fit`；
- deps 保持 `[doc.source]` + `eslint-disable` 注释。

**判别测试（先红）**
- t1：rerender 传**新 doc 对象**（`source` 相同、仅 `savedSource`/`ts`/`handle` 变）→ `reset` / `setEntities` / `setExpandedQaId` / `fit` **零调用**（若实现误用对象身份或把 savedSource 放进 deps → 红）。
- t2：rerender 传 `source` 变化的新 doc → 四个动作各恰一次（回归钉，防"顺手删掉重建"）。
**Commit**：`refactor(canvas): 抽出 useDocumentSwitch（文档切换语义单点化）+ 守卫测试`

### E-4 连带口径核对 + 防回潮注释
**Files**
- Modify: `MindmapStage.tsx:788-796`（`source: doc.savedSource ?? doc.source`；deps 加 `doc.savedSource`）
- Modify: `useAutoSave.ts` / `useDocumentSwitch.ts` / `MindmapStage.tsx` 重建 effect 处：加一行注释「**保存路径不得改写 `doc.source`**——见 docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md」

**DoD（核对代替测试，理由：现状无可复现红）**：把 §1.4 的 7 处清单 + `git grep -n "doc.source" apps/canvas/src packages/react/src` 原始输出贴进报告，逐条标「动/不动 + 理由」。
**Commit**：`fix(canvas): 最近文档快照改读 savedSource（连带口径）+ 防回潮注释`

### E-5 收口
- gate 全跑（tsc ×3 + dist 重建 + 三包套件 + depcruise + lint + budget），贴实测数字。
- CHANGELOG 追加 `[1.8.8] — 2026-09-13 · 编辑流保全（保存不再打断会话）`：写明因果链、四类损失、两条守卫、以及"`source` 语义收敛 / `savedSource` 新增"的契约说明。
- **Commit**：`docs: 编辑流保全收口（CHANGELOG 1.8.8）`

---

## §3 决策点（已给推荐值 → 按推荐执行，不要停下来问）

| 编号 | 决策 | 推荐 | 理由 |
|---|---|---|---|
| E-A1 | 新字段命名 | **`savedSource`** | 与 `saved` 前缀家族一致；备选 `lastSavedSource` 不必 |
| E-A2 | `remember()` 是否改读新字段 | **不改** | 契约 = 「传入即内容」；改它会读到 spread 残留的旧值（§1.5 坑 1） |
| E-A3 | 是否拆 `reset()` 语义 | **不拆** | 切断回读环后无误触路径；拆它扩大改动面 |
| E-A4 | 是否"编辑中推迟 autosave" | **不做** | 根因已解，纯防御项无收益 |
| E-A5 | 是否写真浏览器验证脚本 | **不做** | autosave 需真实 FS 句柄，无法 seed（§1.5 坑 7） |
| E-A6 | 抽 hook 纪律 | **纯搬迁** | deps / eslint-disable 注释 / 动作顺序逐字保留 |

---

## §4 风险与不做项

**风险**
1. 漏改某个 `doc.source` 读取点 → 最近文档回落旧内容（E-4 清单兜住）。
2. 抽 hook 时 deps 漂移 → E-3 判别测试 + lint 水位兜住。
3. `source` 冻结后，"同一文件被外部修改再打开"必须仍能重建——`applyDoc` 会带新 source，天然满足；E-3 t2 覆盖。

**明确不做**（本批范围外，记录在案）
- `OutlinePanel` 虚拟化、`CULL_MARGIN` 双重应用、`reset()` 语义拆分、编辑中推迟保存、真浏览器脚本。

---

## §5 交付流程与报告格式

### 流程
1. **先单独一条 `docs: 追加编辑流保全派遣计划` 提交本文件**（执行方开始前做）。
2. 每任务 TDD（先红贴证据 → 实现 → 绿）+ 一条 commit（中文，`类型(范围): 摘要`）。
3. **禁 `git add -A` / `git add .`**（逐条精确路径）；不 push；不改 git config；不动 `.codebuddy/`；`tools/graph-engine/` 勿动。
4. 新文件一律 <600 行；预算零余量项不得新增（any/tsIgnore/asCast/bang/console/todo/defaultExport）。
5. 环境：`pnpm` 可能不在 PATH → gate 逐项直跑（tsc 用 `.pnpm/typescript@5.9.3/...` 全路径；`npx --no-install depcruise`；biome 用全路径 exe；`node scripts/check-code-budget.mjs`）；套件分包单跑（vitest 直调；**react 改源后先 `tsc -p packages/react/tsconfig.build.json` 重建 dist**）；长任务重定向到 `tmp-*.log` 再用文件读取工具看；**tmp 日志不提交、收尾删**。
6. **PowerShell 注意**：批量删 `tmp-*.log` 可能被沙箱安全删除守则拦截（含既有 `tmp-preview.log`）→ 不要重试整批删除；只定向删自己新建的文件。

### 报告格式
- 逐任务：commit hash + 改动文件 + 分包测试数（实测）+ 新增用例数；**E-1 必须给两段红证据**（import 红 + 语义红）。
- §2 附录两条阴性对照的原始报错。
- §1.4 七处口径核对表（动/不动 + 理由）+ `git grep` 原始输出。
- 门禁与预算实测（数字**贴工具原样输出**，不得转写）。
- 偏差与原因；然后停，等放行。
