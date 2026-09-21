# 摘要节点 S2 最终独立复核报告

- **日期**：2026-09-21
- **性质**：S2 最终**独立复核**（只验证、只报告；不修复、不合并、不 push、不启动 S3）
- **复核人**：独立复核会话（本报告作者）——未参与 S2 施工
- **已验收 S1 基线**：`905c053fe396d1fbbc4d663bf4247b0853bffcec`
- **S2 代码候选**：`4867386978e0f768aa6a31b8e34d1bc4e446e7d7`（tree `7e1dd605844acf1549f7ce3de2d5a07e26ee7c72`）
- **含回执候选**：`b2dff2b7a2af5c4139bb80375ad7d0eb8747f092`（tree `3cb9f4b931ed4c7630b76270bc8f91480de52699`）
- **回执**：`docs/dispatch/2026-09-21-summary-node-s2-closeout-report.md`（位于候选内，已核）
- **独立复核 worktree**：`<local-path>`（detached `b2dff2b`，从完整 SHA 创建，主树之外）
- **本轮复核证据**：`outputs/summary-node/S2/20260921-S2FINALREV-01/`（路径先前不存在，未覆盖任何旧文件）
- **结论**：**ACCEPT**

---

## 一、Findings（先列结论）

### F-1【阻断】无

整个 S2（含三轮返修）**未发现阻断性源码缺陷**。

### F-2【非阻断 · 观测量】测试观测口「按实例归属」在镜像卸载顺序下不精确

- **位置**：`apps/canvas/src/MindmapStage.tsx` 的观测口注册/清理块（`IS_TEST_BUILD` 分支）。
- **回执原声明**（回执 §2.3 / F-2）：「多实例并存（测试里先后 render 两个 Stage）时，
  先卸载的实例不会误删后挂载实例的入口」。
- **复核实测**：
  - 回执**命名的那个顺序成立**：两个实例都已注册后，**先卸载先挂载的实例**，
    后挂载实例的入口**保留**（`present=true, is B's=true`）→ 回执声明本身**为真**。
  - **镜像顺序不精确**：**先卸载后挂载的实例**时，全局值是**已卸载实例的陈旧句柄**
    （`present=true` 但 `isA=false && isB=false`），存活实例的句柄不再是全局值。
- **影响面**：仅限 `IS_TEST_BUILD` 测试专用块；生产构建中该全局名出现 **0 次**（已实测，
  见 §五），故**无生产影响**。且**无任何 S2 验收项依赖多实例观测口**。
- **判定**：**非阻断观测**。建议 S3 开工时顺手加固（清理时只在「本实例句柄**仍是**全局值」
  之外，还应处理「全局值属于已卸载实例」的情形），**不作为 S2 返修条件**。

### F-3【非阻断 · 观测量】渲染期 `useSummaryHop` 令牌复位存在「同一同步批」窗口

- **位置**：`apps/canvas/src/hooks/useSummaryHop.ts` 的渲染期派生（`derivedToken` / `lastTokenRef`）。
- **现象**：若「文档替换推进令牌」与「第二跳点击」被压进**同一个同步任务**（两者之间没有
  React 渲染），该点击仍读到旧草稿并被当作第二跳消费（实测 `consumed=true, summaries=1`）。
- **为何不是源码缺陷**：该条件要求两次动作同一同步任务内完成。生产上二者**恒为不同浏览器任务**
  （`applyDoc` 由点击处理 / 异步打开流程触发；第二跳是画布 `pointerup`，在后续任务派发），
  React 会在让出任务前先冲刷替换引起的状态更新。复核以「生产形态顺序」实测（替换 = 一次真实
  DOM 事件，点击 = 更晚的一次真实 DOM 事件）→ **普通选择、不建摘要**，安全。
- **判定**：**非阻断稳健性观测**。仅由「在一个批里同步调用 hook 内部」触发，生产无此调用点。

### F-4【记账】相对已验收 S1 仍有 **+1** 条 lint 告警（未达「零新增」）

- **位置**：`packages/react/tests/summary-create.test.ts:115` —— `lint/correctness/noUnusedVariables`。
- **内容**：新增测试内的**死辅助函数** `function okPlan(plan: SummaryPlan): SummaryPlanOk`
  （全文件仅此一处出现，**零调用**）。
- **量化**（同一工具 `npx biome lint packages apps`，逐文件/逐规则/逐位置归因）：
  | 树 | warnings | infos |
  |---|---|---|
  | `905c053`（已验收 S1） | **1541** | 48 |
  | `0d77197`（返修起点） | **1544** | 48 |
  | `4867386`（最终候选） | **1542** | 48 |
  - 相对返修起点：**−2**（回执所报 1544→1542 **属实**）。
  - 相对已验收 S1：**+1**。全部落在 `summary-create.test.ts` 这一新建文件；
    `MindmapStage.tsx` 为 23→25→**23**（回到 S1 水平），其余 S2 触碰文件均为 0。
  - **无任何「以删除其它旧告警抵消本包新增」**：候选相对 S1 只有 1 处新增、0 处删除。
- **判定**：违反「本包不新增告警」的原约束，但**性质为死代码、非产品缺陷**，
  修复为删除一个未被调用的辅助函数（最小返修范围 = 1 个函数删除，或其唯一调用点补齐）。
  **不构成 S2 阻断**，但**如实记录为未达原约束**。

### F-5【记账】回执的两处「不得冒充」口径，经核**成立**

- 回执 §5 明确区分 `observe`（只读）与 `actions`（`undo`/`redo`/`replaceDoc`，走真实生产路径），
  并明说 `replaceDoc` 经 `applyDoc`。复核确认：用例 ⑥⑦ **确实经 `actions.replaceDoc`**
  （回执未把它冒充为「原生打开文件旅程」），且回执 §8.4/§8.5 主动披露
  「原生选择器未覆盖」「⑬ 只覆盖边数 +1」。**如实，无夸大**。

---

## 二、冻结与来源核对（全部实测通过）

### 2.1 提交 / tree / 祖先关系

| 项 | 实测 |
|---|---|
| `4867386^{tree}` | `7e1dd605844acf1549f7ce3de2d5a07e26ee7c72` ✓ 与任务书一致 |
| `b2dff2b^{tree}` | `3cb9f4b931ed4c7630b76270bc8f91480de52699` ✓ 与任务书一致 |
| `4867386` 的 parent | `0d77197f57a0f963845fe3074f65cad5ff2f2458` ✓ |
| `b2dff2b` 的 parent | `4867386978e0f768aa6a31b8e34d1bc4e446e7d7` ✓ |
| `905c053` 是 `0d77197` 的祖先 | YES |
| `905c053` 是 `b2dff2b` 的祖先 | YES |
| `905c053..4867386` 提交链 | `9cac632` → `0d77197` → `4867386`（三轮，无 amend） |

### 2.2 `b2dff2b` 相对 `4867386` 只新增收口回执

`git diff --name-status 4867386 b2dff2b` = **仅 1 行**：
`A docs/dispatch/2026-09-21-summary-node-s2-closeout-report.md`（402 insertions, 0 deletions）。
**零代码改动**，与任务书「只新增收口回执」一致。

### 2.3 代码候选相对 `0d77197` 的 15 文件差异

`git diff --numstat 0d77197 4867386` = **15 files**，与回执 §1.1 清单**逐条一致**：

```
M MindmapStage.tsx  M useDocumentActions.ts  A useDocumentToken.ts  A useSummaryHop.ts
M summaryInteraction.ts  A testBuild.ts  M vite-env.d.ts
A summary-two-hop-host.test.tsx  M summary-two-hop.test.tsx  M vite.config.ts  M vitest.config.ts
A docs/dispatch/2026-09-20-summary-node-s2-repair-report.md
M summaryCommands.ts  M index.ts  M summary-create.test.ts
```

### 2.4 累计 S2 相对 S1（不只看最后一轮）

`git diff --name-status 905c053 4867386` = **21 files**，全部属 S2 范围
（`summary*` / `contextMenuItems` / `menuActionTypes` / `testBuild` / `vite-env` / 两份 dispatch 文档）。
**`packages/kernel` 与 `packages/free-canvas` 零改动**（实测 `git diff --name-only 905c053 4867386 -- packages/kernel packages/free-canvas` 为空）→ 无越界。

### 2.5 新增 hook / testBuild / 宿主测试均在提交内

`git cat-file -e 4867386:<path>` 全部命中：`useSummaryHop.ts`(`3231502`)、
`useDocumentToken.ts`(`7d7da9d`)、`testBuild.ts`(`756e94d`)、
`summary-two-hop-host.test.tsx`(`9434a66`)、`summary-create.test.ts`(`6abfccc`)、
`summary-menu.test.ts`(`c94c00c`)、`summaryCommands.ts`(`241e10e`)。**新检出即可获得全部实现与测试**。

### 2.6 未混入 outputs / .zcode / nul / 无关改动

- 候选树内**无** `.zcode/` 目录；**无** 任何 `nul`（大小写不敏感、含扩展名）路径。
- `outputs/` 仅含**仓库既有已跟踪**历史文件；本包证据目录**未入库**（正确）。
- 全树零字节文件只有 1 个既存的 `docs/2026-09-08-graph-engine-fix-list.md`，与 S2 无关。

### 2.7 工作树字节 vs git blob（行尾差异不误判为漂移）

回执 `candidate-files.sha256` 的 15 条 sha256 与**施工工作树字节逐条吻合**
（`MATCH` ×15）；其中只有 `core.autocrlf=true`、无 `.gitattributes`，
故**纯 LF 文件**与 git blob 字节相同，**CRLF 文件**的 git blob sha256 不同——
这是**行尾规范化**，**不是源码漂移**。回执 §1.2 的 10/10 漂移核对经复核**成立**。

### 2.8 旧证据开工 / 结束只读核验（保证未改写）

- 开工快照：`20260920-S2-01`、`20260920-S2-REPAIR-01`、`20260920-S2-CLOSEOUT-01`
  共 **114 个文件** sha256。
- 结束复算：**diff 为空（0 differences）**；S2 worktree 内旧 dispatch 报告（5 份）同样**未变**。
- 另：本轮复核**未向施工 worktree 写入任何文件**，且**未启动 S3**。

---

## 三、定向正确性复核

### R1 创建事务 —— **成立**

核验点与结论（源码 + 用例 + 独立负控三方一致）：

| 核验点 | 结论 | 依据 |
|---|---|---|
| 单成员缺 cid：只分配一次 / 只更新端点一次 / `next_cid` 只推进一次 / 创建后 well-formed | ✓ | `buildPlan` 的 `from.id === to.id ? fromAlloc : allocate(to)` + 端点去重推送；用例 3 项；**NC-1 复现** |
| 单成员已有 cid：不补发 | ✓ | `allocate` 对已有 cid 直接返回；用例「两端都已有 cid：不补发、不 bump、ops 只剩 add-child」 |
| 双成员缺 cid：各分配一次、不被过度复用 | ✓ | `allocate(from)` / `allocate(to)` 各一次，`rootNote` 同遍推进 → **单条** root 更新 |
| 单次 Undo 全树恢复；Redo 后锚仍合法 | ✓ | 用例「单条 undo 完整还原树 + cid（逐位）」「undo 后 redo 可重放」；宿主用例 ⑩ 走真实 Ctrl+Z |
| 跨父 / 根 / 倒序 / 不存在节点失败时无部分写入 | ✓ | `planCreateSummary` 首失败即返回（`not-found`→`is-root`→`summary-in-range`→`not-same-parent`→`reversed`）；`applyTransaction` 整批校验；用例「非法范围 → 不提交，树与选择状态零变化」「ops 合法但 add-child 目标父消失时整批拒绝」 |

**额外核验**：`mergeSummaryOf` 用**合并**语义保留 `summary_of` 内本模块不认识的扩展键
（对应 S1 复核 N-3 的 S2 义务），与 `upsertSummaryOf` 的整体重建形成对照；用例 4 项覆盖。
新建摘要自身写**最小** `{from,to}`（新节点无历史扩展键，无损）。

### R2 草稿归属 —— **成立**

| 核验点 | 结论 | 依据 |
|---|---|---|
| 不同内容**及同内容**文档替换均清旧草稿 | ✓ | 判据是**替换事件令牌**而非内容比较；用例 ⑥（不同内容）⑦（**同内容**，`toEqual` 逐字相同仍清） |
| 新文档第一次点击正常选择 | ✓ | 用例 ⑥ 断言 B 的第一次点击走选择、不建摘要 |
| 文档 ID 重用时不沿用旧草稿 | ✓ | 用例「替换后点击旧起点的同 id 节点也不建摘要」；复核探针 P4 独立复现 PASS |
| 先起草稿 → 编辑 / 提交 / 保存 / 另存为：草稿保持、令牌不变、第二跳完成**原范围** | ✓ | 宿主用例 ⑧（三者均不推进）⑪（编辑+保存）⑫（另存为）；⑫ 用真实选择器替身 + **写入内容断言** |
| 保存取消 / 失败 / 文档离开取消**不得伪装为成功替换** | ✓ | 令牌**只**在 `performApplyDoc` 推进；`handleSave`/`handleSaveAs` 的 `commit` **不调用** `onDocumentReplaced`；取消/过期静默（`documentLifecycle` 口径）|
| 令牌推进到组件重渲染之间是否存在**旧回调窗口** | 见 F-3 | 生产形态顺序**安全**（R1 探针 PASS）；仅「同一同步批」可触发，生产无此调用点 → **不计源码发现** |

**令牌纪律复核**：`useDocumentToken` 的 `bump` 只在「文档被整体替换」处调用
（`useDocumentActions.performApplyDoc`，覆盖打开/新建/最近/文件库/工作区/拖入）；
保存路径只回填 `savedSource`/`handle`/`saved`/`ts`，**不改文档身份**。与注释所述一致。

### R3 生产接线 —— **成立**

| 核验点 | 结论 | 依据 |
|---|---|---|
| **测试真实挂载 `MindmapStage`** | ✓ | `summary-two-hop-host.test.tsx` 15 处 `render(<MindmapStage />)`；类型 `import MindmapStage from '../src/MindmapStage'` |
| 右键入口 / 第二跳 / 重复点击 / Esc / 空白 / 单成员创建 / 选中 / **真实键盘 Undo** | ✓ | 用例 ①（右键+第二跳+选中）②（同 tick 重复点击只建一次）③（非法第二跳）④（Esc）⑤（空白）①b（单成员）⑩（真实 Ctrl+Z Undo）|
| **未以复制状态机代替生产实现** | ✓ | 宿主测试与 hook 测试**都 `import { useSummaryHop }`**；`MindmapStage` 亦 import 同一 hook（实测 `summaryInteraction.ts` 无第二份判定实现，`classifySecondHop` 仅 1 处生产调用点）|
| Shift 回归检查**真实关系模式**下生成预期源/目标的边 | ⚠ **部分** | 用例 ⑬ 真实点 `data-relation-mode`、真实普通点击选中源、真实 Shift 点击目标；但**只断言 `[data-free-edge]` 计数 +1**，**未断言端点/源/目标具体值**（回执 §8.5 已如实披露此局限）|
| 观测口 `actions` 与真正 UI 事件分别标注；`replaceDoc` 不冒充原生打开 | ✓ | `vite-env.d.ts` 注释明确 `observe`（只读）/`actions`（改状态但走真实路径）；回执 §5 明说 ⑥⑦ 经 `applyDoc`；**未**把 `actions.replaceDoc` 称为原生文件旅程 |

**第二跳首判链**（生产 `onNodeClick`）：草稿闸门在 Shift 连线 / note 固定 / 选择**之前**
（`MindmapStage.tsx` `if (summaryHop.hasDraft()) { … if (done) return; }`），
闸门读 hook 的**同步真理源** `draftRef`，同一事件循环内第二次点击不会重复建摘要。

---

## 四、测试观测口与公共导出

1. **Vite 生产常量为 false、Vitest 为 true** ✓
   `vite.config.ts` `define.__MINDCANVAS_TEST_BUILD__: 'false'`；
   `vitest.config.ts` 经 `mergeConfig` 覆盖为 `'true'`（后者生效，已实测）。
2. **正常构建产物中测试入口被移除** ✓
   生产 `apps/canvas/dist/assets/*.js` 三个 chunk 中 `mindcanvasSummaryHost` 命中均为 **0**
   （`main-*` / `radial-*` / `radialSurface-*`），`MINDCANVAS_TEST_BUILD` 亦 0 命中。
3. **注册/清理的实例归属；若声称多实例验证必须有实跑用例** ⚠ 见 F-2
   - 回执声称「多实例并存（测试里先后 render 两个 Stage）」，但**候选树内无任何多实例用例**
     （全树 `installedHandleRef` 仅出现在 `MindmapStage.tsx`；宿主测试每个用例单挂一个 Stage，
     且 `afterEach(cleanup)`）。
   - 复核自行补测：**回执命名的顺序成立**（先卸载先挂载者 → 后者的入口保留，PASS）；
     **镜像顺序不精确**（全局残留已卸载实例的陈旧句柄）。**生产无影响**（构建期消除）。
4. **render 阶段派生草稿状态有无循环 / 串实例副作用 / 旧回调污染** ✓（3 项探针 PASS）
   - 无渲染循环、无 `console.error/warn`（P3）；
   - 令牌变化**同步清 ref + 清 state**（P1），无「串实例」副作用（hook 状态为实例私有
     `useState`/`useRef`；跨实例只经显式 `draftResetToken` 传参）；
   - 旧回调污染：仅 F-3 的「同一同步批」窗口，生产不可达。
5. **公共根入口仅保留有实际消费者的 S2 导出；无跨包 src 深路径** ✓
   - `packages/react/src/index.ts` 收敛为 `export { createSummary }`；**运行时实测**：
     `createSummary` = `function`，而 `planCreateSummary` / `mergeSummaryOf` / `summaryOfNode` /
     `SUMMARY_DEFAULT_TEXT` **全部 `undefined`**（已从包根移出）；
   - 全仓 grep `@mindcanvas/react/src` / `@mindcanvas/kernel/src` = **0 命中**，无深路径依赖。
6. **不把 `observe.root` 的类型/命名当成运行时不可变保证** ✓
   注释与 `vite-env.d.ts` 明确「`root` **只读**使用；改树必须走 `actions` 或 UI」，
   未宣称运行时不可变（无 `Object.freeze`、无类型只读修饰被当作保证）。
   复核确认测试**只读**用它（`resolveSummaries` / `serializeSnapshot` / `textOf`），无就地修改。

---

## 五、独立验证与负控

### 5.1 独立安装 + 构建自身 dist + 包解析路径

从完整 SHA `b2dff2b` 新建 **detached worktree**（主树之外），独立
`pnpm install --frozen-lockfile` + `pnpm -r build`（**不复用施工树构建产物**）。
从**消费方 `apps/canvas`** 实测解析：

```
@mindcanvas/react  -> <local-path>
@mindcanvas/kernel -> <local-path>
react  dist/index.js sha256 = 04cba3096a85e66553187adb2fde7857d2b2598f370bea39467bd4a7cc230fd3
kernel dist/index.js sha256 = 3cd978a749f616adb248c89c1127e099d2602e70ea15d15ecdb733418eb7be96
```

**两个 dist 指纹与回执 §6.1 逐位相同** → 构建可复现，且**指向本 worktree 自身**。

### 5.2 门禁实测（全部在同一终态、先重建 dist）

| 门禁 | 实测 | 参考数 | 判定 |
|---|---|---|---|
| `summary-create` + `summary-menu` | **39 + 6 = 45 passed** | 39 | ✓ |
| `summary-two-hop`（生产 hook） | **24 passed / 1 file** | 24 | ✓ |
| `summary-two-hop-host`（真实挂载） | **14 passed / 1 file** | 14 | ✓ |
| `packages/react` 全包 | **1599 passed / 157 files** | 1599 | ✓ |
| `apps/canvas` 全包 | **391 passed / 45 files** | 391 | ✓ |
| typecheck | **exit 0**（4 包，含 canvas `tsconfig.test.json`） | — | ✓ |
| build | **exit 0** | — | ✓ |
| depcruise | **551 modules / 1644 deps / 0 violations**，exit 0 | — | ✓ |
| lint | **1542 warnings + 48 infos**，exit 0 | — | ✓（但见 F-4） |
| budget | any 0 / tsIgnore 0 / bang 89(90) / asCast **31(31)** / console 4 / todo 1 / defaultExport 2 / bigFiles **4(4)**，exit 0 | — | ✓ |

**实际测试集合与结果与参考数完全一致**；未为匹配数字修改任何断言。

### 5.3 隔离副本负控（四组，固定终态 + 明确测试集合）

从固定终态 `b2dff2b` 新建隔离 detached 副本（`<local-path>`，主树之外），
先验证**正常副本全绿**（`summary-create` 39 passed；hook+host 38 passed），
随后**逐组中性化 → 重建 dist → 跑同一测试**。**副本用后已删除**。

| # | 中性化点 | 源文件 sha256（NC / 候选） | 测试集合 | 目标红项 | 退出码 |
|---|---|---|---|---|---|
| NC-1 | R1 恢复**单成员双分配**（`summaryCommands.ts`） | `28a71b41…` / `2be1d50a…` | `summary-create.test.ts` | **3 项** | **1** |
| NC-2 | 文档替换**不推进令牌**（`useDocumentActions.ts`） | `39033a18…` / `9dc3e09c…` | `summary-two-hop-host.test.tsx` | **2 项**（⑥⑦） | **1** |
| NC-3 | 保存回填**错误推进**令牌 | `c34823bf…` / `9dc3e09c…` | `summary-two-hop-host.test.tsx` | **2 项**（⑧⑪） | **1** |
| NC-4 | 摘掉摘要**点击首判**（仅改生产接线） | `a0e8ff9f…` / `5f536143…` | `summary-two-hop-host.test.tsx` | **8 项** | **1** |

**关键红证据（原文）**

```
NC-1  AssertionError: expected 'c6' to be 'c5'          AssertionError: expected 'c2' to be 'c1'
      AssertionError: expected 'dangling' to be 'well-formed'
      FAIL 端点无 cid：只分配一次 / 只 update 该端点一次 / next_cid 只推进一次
      FAIL 端点无 cid：createSummary 后摘要 well-formed，成员恰为该节点
      FAIL 端点无 cid：单条 Undo 逐位还原；Redo 后摘要仍 well-formed
NC-2  AssertionError: expected true to be false
      AssertionError: expected 8000000 not to be 8000000
      FAIL ⑥ 文档替换清草稿：B 的第一次点击正常选择，不建摘要（R2 判别）
      FAIL ⑦ 同内容文档替换也清草稿（不得靠内容比较）
NC-3  AssertionError: expected 9000002 to be 9000001
      AssertionError: expected 12000002 to be 12000001
      FAIL ⑧ 普通编辑 / 保存 / 另存为不得被误判为文档替换
      FAIL ⑪ 编辑 + 保存：令牌不推进、草稿仍有效、第二跳能完成原范围
NC-4  AssertionError: expected [] to have a length of 1 but got +0
      AssertionError: expected '⚠ 点选范围末成员（需同一父级；Esc 取消）' to contain '创建摘要未完成'
      AssertionError: expected +0 to be 1
      FAIL ① ①b ② ③ ⑧ ⑩ ⑪ ⑫（共 8 项）
```

**四组均与回执 §6.3 的目标红项数（3 / 2 / 2 / 8）逐项吻合**；均为**目标断言**转红，
**测试期望一字未改**。四份日志逐一 grep `Invalid hook call` / `React is not defined`
等环境错误 → **均无命中**，故四组均计入**行为负控成功**，无「编译/模块解析/Invalid hook call
冒充行为负控」的情形。NC-4 只改**生产接线**，符合「集成负控只改生产」要求。

### 5.4 复核独立探针（超出施工自证，另附）

复核另写 10 组探针（**用后删除，未留在候选树**）验证观测口与令牌边界，结论见 F-2 / F-3。
其中 3 项有意义 PASS：令牌变化**同步清 ref+state**、渲染期派生**无告警无循环**、
替换后**同 id 节点不沿用旧草稿**；并以「生产形态顺序」实测 R2 安全。

---

## 六、lint 同口径对比（按文件 / 规则 / 位置归因）

同一工具同一命令：`npx biome lint packages apps`（`--reporter=json --max-diagnostics=none`
取结构化结果，逐文件 / 逐规则 / 逐位置归因，**不只比汇总数**）。
三棵树均为**独立 detached 检出 + 独立安装**：

| 树 | warnings | infos | exit |
|---|---|---|---|
| `905c053`（S1，已验收基线） | **1541** | 48 | 0 |
| `0d77197`（原 S2） | **1544** | 48 | 0 |
| `4867386`（最终 S2） | **1542** | 48 | 0 |

**逐文件归因**（仅 2 个文件有差异）：

| 文件 | S1 | 0d77197 | 4867386 | Δvs S1 | Δvs 0d77197 |
|---|---|---|---|---|---|
| `packages/react/tests/summary-create.test.ts` | 0 | 1 | **1** | **+1** | 0 |
| `apps/canvas/src/MindmapStage.tsx` | 23 | 25 | 23 | 0 | −2 |

**逐规则归因**：唯一变化规则为 `lint/correctness/noUnusedVariables`（24 → 26 → 25，Δvs S1 **+1**）。
`noNonNullAssertion` 等其余 13 条规则三棵树**完全持平**。

**新增告警的具体条目**（候选相对 S1 的**唯一**新增位置）：

```
packages/react/tests/summary-create.test.ts:115:10
  lint/correctness/noUnusedVariables
  "This function okPlan is unused."   —— 死辅助函数：function okPlan(plan: SummaryPlan): SummaryPlanOk
```

**结论**：
- **1544→1542 只能说明相对返修起点减少**（与任务书判断一致，回执亦如实如此表述）。
- **相对 S1 仍有 S2 新增告警 1 条**（F-4），**未达**原「不新增告警」约束。
- **未提高阈值**（`asCast` 31/31、`bigFiles` 4/4 均未放宽）；
  **未以删除其它旧告警抵消**（相对 S1 新增 1、删除 0，见上表）。
- 位置核验使用 `file|rule|line:col` 与 `file|rule|message` 两种键分别归因，
  避免 `MindmapStage.tsx` 行号平移导致的假新增误判。

---

## 七、验证证据与限制

### 7.1 本轮复核证据（`outputs/summary-node/S2/20260921-S2FINALREV-01/`）

```
logs/00-dist-resolution.log          dist 解析路径 + 运行时导出面 + dist 指纹
logs/t1-create-menu.log              summary-create 39 + summary-menu 6
logs/t2-two-hop-hook.log             summary-two-hop 24
logs/t3-two-hop-host.log             summary-two-hop-host 14
logs/t4-react-full.log               react 全包 1599 / 157 files
logs/t5-canvas-full.log              canvas 全包 391 / 45 files
logs/t6-typecheck.log                typecheck exit 0
logs/t7-depcruise.log                depcruise 551/1644/0 exit 0
logs/t8-budget.log                   budget 全指标在预算内
logs/t9-lint-candidate.log           lint 1542/48 exit 0
negs/nc1-*.{log,txt}                 NC-1 源指纹 / 重建 / 红项 / 退出码
negs/nc2-*.{log,txt}                 NC-2 同上
negs/nc3-*.{log,txt}                 NC-3 同上
negs/nc4-*.{log,txt}                 NC-4 同上
evidence/testbuild-isolation.log     生产 dist 观测口 0 命中 + 两处 define 配置原文
evidence/lint-s1.json                S1 结构化 lint
evidence/lint-0d77197.json           原 S2 结构化 lint
evidence/lint-candidate.json         最终 S2 结构化 lint
evidence/lint-comparison-attributed.txt  逐文件/逐位置归因
evidence/lint-comparison-rules.txt       逐规则/逐消息归因（位置无关）
evidence/reviewer-probe-all.log      复核独立探针原始日志
evidence/reviewer-probe-README.txt   探针设计与判读（含无效探针的更正说明）
```

### 7.2 限制（如实）

1. **旧证据只读**：`20260920-S2-01` / `-REPAIR-01` / `-CLOSEOUT-01` 共 114 文件
   开工与结束 sha256 **逐位一致**，未被改写；施工 worktree 本轮**零写入**。
2. **kernel / free-canvas 未重跑全包**：S2 相对 S1 对二者**零改动**（实测），按其影响面未机械重跑。
3. **F-2 / F-3 均为观测口径**，判定为**非阻断**；前者生产构建期消除，后者生产不可达。
4. **F-4（+1 lint 告警）为记账项**，非产品缺陷；如实列出，**留待是否返修由任务方裁决**。
5. **Shift 边端点未断言**（⑬ 只证边数 +1），与回执 §8.5 披露一致，**未扩大为新增要求**。
6. **`start-gone` 分支无任何用例**：复核确认 `classifySecondHop` 的 `start-gone`
   在 hook 与宿主两套测试中**均无覆盖**（`grep -c start-gone` = 0/0），
   与回执 §8.6 披露一致。
7. **原生文件选择器未覆盖**：⑫ 使用测试替身（真实 `saveMarkdown` 路径 + 真实
   `session.submit` 承诺链，但选择器本身为替身）；**真实浏览器原生对话框交互未覆盖**，
   与回执 §8.4 一致，**不在本 S2 复核范围**，S5 处理。
8. **S3（布局卫星）、S4（括线渲染）、S5（收尾）未启动、未审查**；
   本报告**未合并、未 push、未发布**。

---

## 八、结论

**ACCEPT。**

- 整个 S2（`9cac632` → `0d77197` → `4867386`）**无阻断源码缺陷**；
  R1 创建事务、R2 草稿归属、R3 生产接线**均成立**，且各有**独立负控**证明其断言有判别力。
- 候选**完整**：新检出即可获得全部实现与测试；`b2dff2b` 相对 `4867386` **只新增收口回执**；
  祖先关系、tree、15 文件差异、累计 21 文件范围**全部核对一致**；无 outputs / .zcode / `nul` 混入。
- 门禁**符合原约束**：测试数（1599 / 391 / 14 / 24）与参考数**逐项一致**，
  build / typecheck / depcruise / budget 全绿，测试观测口在生产构建中 **0 命中**。
- **四个记账项如实列出**：F-2（观测口镜像顺序不精确，生产无影响）、
  F-3（同同步批令牌窗口，生产不可达）、**F-4（相对 S1 仍有 +1 lint 告警，未达原约束）**、
  F-5（回执披露口径如实、无夸大）。**均不阻断 S2 作为 S3 基础**。

**可作为 S3 基础。**

> 复核完成后停止：未修复、未合并、未 push、未发布、未启动 S3。
