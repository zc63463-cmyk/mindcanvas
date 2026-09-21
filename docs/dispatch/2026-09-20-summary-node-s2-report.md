# 摘要节点 S2 回执：创建事务、右键菜单、两跳点选与单步 Undo

- **日期**：2026-09-20
- **批次**：S2（摘要节点 S1–S5 之第二包）
- **固定基线（S1 候选）**：`905c053fe396d1fbbc4d663bf4247b0853bffcec`
- **S1 复核**：`docs/dispatch/2026-09-20-summary-node-s1-review.md` → **ACCEPT（附条件）**
- **本包最终 SHA**：`9cac632b27ce883bcd9631718b5930d769f5ea76`（分支 `codex/summary-node-s2-20260920`）
- **独立 worktree**：`<workspace>/.workbuddy/wt-summary-node-s2`
  （起点 `git status --porcelain` = 空；**未**在共享工作树或 S1 worktree 施工）
- **RunId / 证据目录**：`outputs/summary-node/S2/20260920-S2-01/`
- **结论**：交付完成，**待主控独立复核**。未 push、未合并、未发布。

---

## §1 基线核对（开工前实测）

| 项 | 实测 |
|---|---|
| 实际 HEAD（起工） | `905c053fe396d1fbbc4d663bf4247b0853bffcec` = S1 候选（冻结基线） |
| 父提交 | `1032699146ec4906993b16041e411c555e2dbec8` |
| pnpm | **10.33.2**（`packageManager` 字段固定；`pnpm install --frozen-lockfile` exit 0） |
| Node | v24.15.0 |
| 锁文件 | `pnpm-lock.yaml`（56061 B） |
| worktree 状态 | 起工 `git status --porcelain` **空** |

**基线测试数字（实测，非抄写）**：

| 包 | 实测 | 与计划 §0 参考值 |
|---|---|---|
| kernel | **656 passed / 70 files** | 参考 622 → 已随前序批次增长，以实测为准 |
| react | **1554 passed / 155 files** | 参考 1502 → 同上 |
| canvas | **353 passed / 43 files** | 参考 353 → 一致 |

> **canvas 波动披露（不隐瞒）**：基线首跑出现 `1 failed | 43 passed / 352 passed`，
> **第 2、3 次复跑均 353 全绿**。该 flake 在**起工基线即存在**（与 S2 改动无关），
> 未定位到具体用例（首跑日志的失败用例名未被保留——见 §11 未覆盖项）。
> 本包所有 canvas 判定均以「复跑稳定绿」为准，并在 §6 给出最终稳定结果。

---

## §2 dist 纪律（本包最关键的前置）

**第 1 步：从本 worktree 自身源重建全部 dist**
```
pnpm -r build → exit 0      # logs/build-baseline.log
built-at-utc: 2026-09-20T13:18:01Z
```

**第 2 步：证明 react 测试解析的是本 worktree 的 dist（非旧构建产物）**
```
packages/react/node_modules/@mindcanvas/kernel
  -> /e/.../wt-summary-node-s2/packages/kernel      (pnpm workspace symlink)

createRequire(<react>/vitest.config.ts).resolve('@mindcanvas/kernel')
  -> E:\...\wt-summary-node-s2\packages\kernel\dist\index.js
```
**解析到本 worktree 自身的 `dist/index.js`** ✓（`build/dist-fingerprint.txt`）

**第 3 步：dist 指纹（每次改源码后重建并重记）**

| 产物 | 起工重建 SHA-256 | 最终重建 SHA-256 |
|---|---|---|
| `packages/kernel/dist/index.js` | `3cd978a749f616adb248c89c1127e099d2602e70ea15d15ecdb733418eb7be96` | 同左（kernel 源本包**未改**） |
| `packages/react/dist/index.js` | `26e19f2b5d863c2b31f1f8cd0b638cf748df372fd5cce6377642b066310fb287` | `1ba0ba63d72c72f88e66c68ae13168ca1bfd396b8917f656ea2e3bc46de58fc5` |
| `packages/react/dist/edit/summaryCommands.js` | （不存在） | `00269ce42d5598a0db2e0118e5e60bef60e9a0e885c5542395032c28b9a451ab` |

**未复用旧 dist**：每次内核/React 源码改动后严格按「先 `pnpm -r build` → 再跑测试」执行；
构建时间、产物路径与 SHA-256 均落在 `build/` 与 `gates/` 日志中。
**未重建 dist 时不把测试写成通过**——本包不存在该情形。

> **流程发现（供 S3/S4 注意，与 S1 复核 §5.5 同源）**：`tsc -p tsconfig.build.json` **不清空
> `dist/`**。阴性对照时若把中性化副本以 `.ts` 形式留在 `src/`，其**旧编译产物会残留在
> `dist/`** 并被解析（本包 NC-1 首次尝试即踩到：`dist/edit/summaryCommands.NEUTRALIZED-SAMEPARENT.js`
> 驻留）。已改为「同一文件就地中性化」并复核 dist 哈希确实变化后才采信结果（见 §7）。

---

## §3 交付闭包

`git diff --name-status 905c053 9cac632` = **6 改 + 5 增 = 11 文件**
（清单与逐文件 SHA-256 见 `s2-changed-files.txt` / `s2-changed-files.sha256`）

```
M  apps/canvas/src/MindmapStage.tsx
M  apps/canvas/src/NodeContextMenu.tsx
M  apps/canvas/src/nodeMenuBags.ts
A  apps/canvas/src/summaryInteraction.ts
A  apps/canvas/tests/summary-two-hop.test.tsx
M  packages/react/src/edit/contextMenuItems.ts
M  packages/react/src/edit/menuActionTypes.ts
A  packages/react/src/edit/summaryCommands.ts
M  packages/react/src/index.ts                      ← 见 §10 公共接线
A  packages/react/tests/summary-create.test.ts
A  packages/react/tests/summary-menu.test.ts
```

未触碰（按任务书 §九 边界）：布局文件、`forest`、`exportSvg`、`MapView`、`canvasBackend`、
`cutAttach.ts`、P0-D、图库、文件管理模块。

**行数预算**（`cutAttach.ts` 必须 < 600）：

| 文件 | 行数 | 判定 |
|---|---|---|
| `packages/react/src/edit/cutAttach.ts` | **591** | ✅ < 600（本包**未改动**） |
| `packages/react/src/edit/summaryCommands.ts` | 244 | 新文件，未逼近预算 |
| `apps/canvas/src/summaryInteraction.ts` | 40 | 新辅助文件（主动外提，守 MindmapStage） |

---

## §4 事务契约实现（`planCreateSummary` / `createSummary`）

### 4.1 校验顺序（首个失败即返回，错误码可解释）

```
not-found → is-root → summary-in-range → not-same-parent → reversed
```

| # | 校验 | 错误码 |
|---|---|---|
| 1 | fromId / toId 均存在 | `not-found` |
| 2 | 两端非根 | `is-root` |
| 3 | 端点自身不是摘要节点（防自包含 / 嵌套，任务书 §四 5） | `summary-in-range` |
| 4 | 同一父级 | `not-same-parent` |
| 5 | from 在 to 之前 | `reversed` |

### 4.2 ops 形状（稳定、可审计；实测原文）

`planCreateSummary(root, A, C)`（A、C 均缺 cid）实测输出：
```json
{ "ok": true,
  "ops": [
    { "type":"update-node", "id":"<root>", "patch":{"note":{"next_cid":3}} },
    { "type":"update-node", "id":"<A>",    "patch":{"note":{"cid":"c1"}} },
    { "type":"update-node", "id":"<C>",    "patch":{"note":{"cid":"c2"}} },
    { "type":"add-child", "parentId":"<root>", "index":3,
      "child":{ "id":"<new>", "type":"text", "text":"摘要",
                "note":{"summary_of":{"from":"cid:c1","to":"cid:c2"}}, "children":[] } } ],
  "summaryId":"<new>", "fromCid":"c1", "toCid":"c2" }
```

对应任务书 §四逐条：`newId()` ✓、默认文本「摘要」✓、note 写 `summary_of` ✓、
`index = to.index + 1`（C 在 index 2 → 插 3）✓、**末位成员**时 `index = 5`（长度）✓。

### 4.3 cid 补发纪律

| 场景 | ops 数 | `next_cid` |
|---|---|---|
| 两端均缺 cid | root + from + to + add-child = **4** | 一次到位 `1→3`（**只一条** root 更新，不重复 bump） |
| 两端已有 cid | **1**（仅 add-child） | 不变、既有 cid **不替换** |
| 一端有一端缺 | **3** | 只进位一次 |

### 4.4 Undo 逐位恢复

`applyTransaction` 单批提交 ⇒ **一次 `undo()` 完整回滚**（结构 + cid 补发 + `next_cid`），
以 `JSON.stringify` 全树快照逐位断言 `undo 后 === 创建前`：**通过**（§6 绿证据）。
`redo()` 可重放同一事务：**通过**。
事务失败（批次内混入 `remove-node(root)`）⇒ **整批拒绝、零部分写入**：通过。

---

## §5 S1 扩展字段约束（N-3 义务）

S1 复核指出 `upsertSummaryOf` 以 `{from,to}` **整体重建**会丢扩展键。本包处置：

1. **不使用** `upsertSummaryOf` 写既有节点（`grep` 可证 `summaryCommands.ts` 未引入它）；
2. 新增 `mergeSummaryOf(note, spec)`：**合并语义**，保留 `summary_of` 内本模块不认识的键；
3. 端点补发 cid 走 `{...nodeNote, cid}`（保留其它 note 字段），**不触碰**端点既有 `summary_of`；
4. 新建摘要节点写**最小** `{from,to}`（新节点本无历史扩展键，写最小集即无损）；
5. **不改变 S1 已复核的既有访问器契约**（`summaryOf` / `upsertSummaryOf` / `removeSummaryOf`
   一字未动，kernel 包本包零改动）；
6. 测试证明扩展字段不因本包操作被删除（见 §6 绿证据两条 + §7 阴性对照）。

**实现细节（预算相关）**：`mergeSummaryOf` 用 `Object.assign({}, raw, {from,to})` 展开
（`raw` 收窄为 `object` 后可直接作 `assign` 源），**零类型断言**——因为 `asCast` 预算
31/31 已满，本包不得新增断言。首版实现曾用 `as Record<string, unknown>`，被 budget
门禁拦下后改为断言无关写法（这也是 budget 门禁工作正常的旁证）。

---

## §6 TDD 红 → 绿证据

### 6.1 红证据原文

**红 #1 · `tests/summary-create.test.ts`**（`logs/red-1-summary-create.log`，run-at-utc 2026-09-20T13:27:44Z）
```
FAIL  tests/summary-create.test.ts [ tests/summary-create.test.ts ]
Error: Cannot find module '../src/edit/summaryCommands.js'
  imported from .../packages/react/tests/summary-create.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```
（真红：写入端模块尚不存在，测试无法加载——不是断言被反转或 catch 后报 PASS。）

**红 #2 · `tests/summary-menu.test.ts`**（`logs/red-2-summary-menu.log`，run-at-utc 2026-09-20T13:27:50Z）
```
FAIL  tests/summary-menu.test.ts > 「创建摘要…」菜单项 > 提供 summaryActions → 出现在「结构」区，文案为「创建摘要…」
AssertionError: expected undefined to be '结构'
 tests/summary-menu.test.ts:136:26
 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
VITEST_EXIT=1
```
（真红：菜单项不存在 → `section` 为 `undefined`。**6 test 中已有 3 条通过**，
说明不是"整个文件崩"式的伪红。）

### 6.2 绿证据原文

**S2 定向 · react**（`gates/final-targeted-react.log`）
```
 ✓ tests/summary-create.test.ts (35 tests) 23ms
 ✓ tests/summary-menu.test.ts (6 tests) 14ms
 Test Files  2 passed (2)
      Tests  41 passed (41)
TARGETED_REACT_EXIT=0
```

**S2 定向 · canvas**（`gates/final-targeted-canvas.log`）
```
 ✓ tests/summary-two-hop.test.tsx (20 tests) 102ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
TARGETED_CANVAS_EXIT=0
```

**全包**（`gates/final-kernel.log` / `final-react.log` / `final-canvas.log`）

| 包 | 基线 | 最终 | 增量 | exit |
|---|---|---|---|---|
| kernel | 656 / 70 files | **656 passed / 70 files** | 0（未改 kernel） | 0 |
| react | 1554 / 155 files | **1595 passed / 157 files** | +41（S2 两个新文件） | 0 |
| canvas | 353 / 43 files | **373 passed / 44 files** | +20（S2 新文件） | 0 |

### 6.3 判别测试覆盖对照（任务书 §七 1–23）

| # | 要求 | 落点 | 结果 |
|---|---|---|---|
| 1 | 合法同父范围 | `summary-create` 合法同父范围(ops 形状) | ✓ |
| 2 | from/to 不存在 | `not-found` ×2 | ✓ |
| 3 | from 为根 | `is-root` | ✓ |
| 4 | to 为根 | `is-root` | ✓ |
| 5 | 跨父 | `not-same-parent`（**阴性对照判别点**） | ✓ |
| 6 | 倒序 | `reversed` | ✓ |
| 7 | to 为末位成员 | `index = 5` | ✓ |
| 8 | from/to 已有 cid | 不补发不 bump → `['add-child']` | ✓ |
| 9 | from/to 缺 cid | 各补一次、`next_cid` 一次到位 | ✓ |
| 10 | cid 补发后单条 Undo 完整恢复 | 全树快照逐位 `undo === before` | ✓ |
| 11 | 事务失败无部分写入 | 混入 `remove-node(root)` → 整批拒绝 | ✓ |
| 12 | 菜单 action 缺省不显示 | `summaryItem(...) === undefined` | ✓ |
| 13 | 菜单 action 提供时显示 | 「创建摘要…」+ 结构区 | ✓ |
| 14 | 第一跳进入 draft | draft 置位 + 文案含「末成员」「同一父级」 | ✓ |
| 15 | 第二跳完成创建 | well-formed + 选中新节点 | ✓ |
| 16 | 非法第二跳保留 draft | 跨父/倒序/根 → 草稿保留 + notice | ✓ |
| 17 | 空白、Esc、切文档清理 draft | 点空白 / Esc；切文档走 controller 身份复位 | ✓（切文档为设计断言，见 §11） |
| 18 | 创建后选中新摘要 | `selectedId === summaryNodeId` | ✓ |
| 19 | 既有 Shift 连线原行为 | 3 条回归用例（无草稿仍连线 / 有草稿被消费 / 普通点击仍选择） | ✓ |
| 20 | `summary_of` 扩展字段不丢 | `mergeSummaryOf` 2 条 + 补发 cid 保留其它 note 字段 1 条 | ✓ |
| 21 | 重复触发不创建两个 | 两次独立事务 → 2 条摘要、2 条 undo | ✓ |
| 22 | 同一 tick 重复点击只一个事务 | ref 同步闸门 | ✓（**实现期发现并根治，见 §8.1**） |
| 23 | 取消后再次启动不复用旧 fromId | 新草稿覆盖旧起点，成员为 C/D | ✓ |

---

## §7 阴性对照（隔离副本 + 重建 dist）

**隔离位置**：`<workspace>-nc-s2/`（主工作树与候选 worktree **之外**）。
副本内 `pnpm install --frozen-lockfile` + `pnpm -r build` 后，**先验证副本基线全绿**
（react 41、canvas 20 与候选相同），再施加中性化，**中性化后重新 build**，再做判定。

### NC-1b · 同父校验中性化

**中性化内容**（`negs/nc1b-neutralize.diff`，就地改同一文件）：
```diff
-  if (parentId === null || parentId !== parentIdOf(root, toId)) {
+  if (parentId === null) {
     return fail('not-same-parent', '摘要范围必须是同一父级下的连续兄弟');
   }
```
```diff
-  const fromIndex = parent.children.findIndex((c) => c.id === fromId);
-  const toIndex = parent.children.findIndex((c) => c.id === toId);
-  if (fromIndex < 0 || toIndex < 0) {
-    return fail('not-found', '范围端点不在其父节点的子节点列表中');
-  }
+  const fromIndex = Math.max(0, parent.children.findIndex((c) => c.id === fromId));
+  const toIndex = Math.max(0, parent.children.findIndex((c) => c.id === toId));
```

**为什么要中性化第二处（真实发现，不是为凑红）**：只去掉同父守卫时，跨父输入会被
**下游索引防御**拦下并以 **`not-found`** 而非 `not-same-parent` 失败——
即守卫的移除被另一层defense**掩盖**。实测（中性化中途探针）：
```
plan(a,f) ok? false  {"code":"not-found","message":"范围端点不在其父节点的子节点列表中"}
```
因此本对照把「同父校验」这一**能力**（守卫 + 其下游兜底）整体中性化，才能证实
本包用例确实在判别"跨父被拒"这一行为，而非仅仅判别错误码字符串。

**结果（真实退出码）**

| 套件 | 候选（正常） | 中性化副本 | exit |
|---|---|---|---|
| react 定向 | 41 passed | **3 failed \| 38 passed (41)** | **1** |
| canvas 定向 | 20 passed | **3 failed \| 17 passed (20)** | **1** |

**转红集合（逐条对应目标断言）**
```
react:
  planCreateSummary · 拒绝路径 > 跨父（A 与 F 不同父）→ not-same-parent（阴性对照的判别点）
    AssertionError: expected true to be false
  createSummary · 单事务提交与单条 Undo > 非法范围 → 不提交，树与选择状态零变化
    AssertionError: expected true to be false
  createSummary · 单事务提交与单条 Undo > cancel 语义：失败后再次以同一 fromId 发起不复用旧状态
    AssertionError: expected true to be false
canvas:
  摘要两跳状态机 > 第二跳跨父 → 不创建、保留草稿、给 command notice
    AssertionError: expected [ { …(4) } ] to have a length of +0 but got 1
  摘要两跳状态机 > 非法第二跳后仍可用合法点击完成（草稿未丢）
    AssertionError: expected null not to be null
  摘要两跳状态机 > 创建失败不留半成品：无节点、无 cid、无历史
    AssertionError: expected [ { …(4) } ] to have a length of +0 but got 1
```
日志：`negs/nc1b-react-neutralized.log`、`negs/nc1b-canvas-neutralized.log`

> **过程留档（未被复写）**：首次只做"单处中性化"（仅去掉守卫）的产物保留为
> `negs/SUPERSEDED-nc1-masked-*.{diff,log}`——它记录了本节上述"守卫被下游兜底掩盖"的
> 原始现象，以及中性化过程本身。最终采用的对照是 NC-1b，**未删除**任何失败日志。

### NC-2 · 单事务外壳中性化

**中性化内容**（`negs/nc2-neutralize.diff`）：`createSummary` 内
```
applyTransaction(plan.ops)          →    for (const op of plan.ops) applyTransaction([op])
```
即「逐 op 独立提交」，undo 栈不再是整条创建。

**结果（真实退出码）**

| 套件 | 候选（正常） | 中性化副本 | exit |
|---|---|---|---|
| react 定向 | 41 passed | **2 failed \| 39 passed (41)** | **1** |
| canvas 定向 | 20 passed | 20 passed | 0 |

**转红集合**
```
react:
  createSummary · 单事务提交与单条 Undo > 缺 cid 场景：单条 undo 完整还原树 + cid（逐位）
    AssertionError: expected '{"id":…}' to be '{"id":…}'   ← 全树快照差异
  createSummary · 单事务提交与单条 Undo > undo 后 redo 可重放（同一事务）
    AssertionError: expected '{"id":…}' to be '{"id":…}'
```

**如实披露**：NC-2 下 **canvas 套件保持全绿**——canvas 用例经由交互层驱动，
其断言是"点一次是否产生摘要/是否被拒"，对"一次 undo 是否整条回滚"不敏感。
因此 canvas 套件的阴性对照判别力由 **NC-1b** 承担（3 条转红），NC-2 只作为
**react 事务级**用例的判别力证据。两组对照合起来覆盖两类目标断言。

**纪律遵守**：未使用 `it.fails`、未反转断言、未 catch 后报 PASS、未加宽泛 skip；
失败原因均为**目标断言**（期望成功却成功 / 快照不逐位相等）；
中性化只改被对照的守卫与提交外壳，其余逐字不变。
**副本已删除**（`rm -rf mindcanvas-nc-s2`），候选已复核还原（见 §7.4）。

### 7.4 候选还原验证
```
grep 'parentId !== parentIdOf(root, toId)'  → 命中（守卫在位）
grep 'applyTransaction(plan.ops)'           → 命中（单事务在位）
pnpm -r build → exit 0
sha256(packages/react/dist/edit/summaryCommands.js) = 82382e38…  ← 与 NC 前一致
```

---

## §8 实现期发现（本包新增的实现细节）

### 8.1 同一 tick 重复点击会建两条摘要（真实缺陷，已根治）

**现象**：第二跳用 `useState` 的 `summaryDraft` 做判据时，同一事件循环内的第二次点击
读到的是**尚未重渲染的旧值**，于是重复建出第二条摘要（测试 #22 真实转红）。

**根因**：React `setState` 的更新要到下一次渲染才对闭包可见；`onNodeClick` 的判据
读的是本次渲染的闭包快照。

**处置**：引入 `summaryDraftRef` **同步镜像**作为唯一真理源（判据与消费都走 ref），
`setSummaryDraft` 是唯一写入口（ref 与 state 同写，杜绝漂移）。被拒时按契约**恢复**草稿。
**这是本包相对计划 S-A4 的一处实现强化**，不改交互语义、不改契约。

### 8.2 点回起点不静默建单成员摘要

任务书未限定该分支。**实现选择**：点回起点 → **不创建**，改为提示
「请点选范围的末成员（与起点同一父级；Esc 取消）」，草稿保留。
理由：单成员范围（from === to）在 S1 契约中**合法**，但「点回刚选的起点」在交互上
几乎总是误触；静默建出"只括一个节点"的摘要会让用户困惑。契约层（`planCreateSummary`）
仍接受 `from === to`（有专门用例覆盖），**仅交互层从严**。

### 8.3 第二跳判定外提 `summaryInteraction.ts`

`classifySecondHop` + 两条提示文案外提为 40 行纯函数模块：既守 `MindmapStage`
行数，也让"这次点击算不算合法第二跳"有单一事实源（宿主与测试消费同一份）。
**语义拒绝仍统一由 `planCreateSummary` 裁决**，避免两处规则漂移。

### 8.4 S1 三项文档更正（按任务书 §二 6，本包不重开源码返修）

任务书指明 S1 三个 Minor 文档问题**不重新打开源码返修**，本包仅**准确引用**、不覆盖 S1 原始证据：

1. **「4 改 + 6 增」应为「3 改 + 7 增」** —— 本包 §3 为本包自身清单（6 改 + 5 增），
   **不复述 S1 的错误数字**；S1 原始证据（`outputs/summary-node/20260920-01/`）未被改写。
2. **P0-0 review 已在候选树中** —— 本包不就此作任何声称。
3. **`resolveSummaries`「无摘要零开销」措辞应为待文档更正** —— 本包**不引用**该措辞；
   本包未调用 `resolveSummaries` 做性能声称（仅作正确性断言使用）。

---

## §9 门禁与预算（全部实测）

| 门禁 | 实测 | 基线 | 判定 |
|---|---|---|---|
| typecheck | **exit 0**（4 包全过，含 canvas `tsconfig.test.json`） | exit 0 | 持平 ✓ |
| build | **exit 0** | exit 0 | 持平 ✓ |
| depcruise | **547 modules / 1638 deps / 0 violations，exit 0** | 542/1622/0 | 模块与依赖数增长（新文件 + 新边），**违规 0 持平** ✓ |
| lint | **1544 warnings + 48 infos，exit 0** | 1541 + 48 | **+3 warnings**（新增文件引入），未上升阈值、无 error ✓ |
| budget | any **0** / tsIgnore 0 / bang **89**(90) / asCast **31**(31) / console 4 / todo 1 / defaultExport 2 / bigFiles **4**(4)，exit 0 | 同 | **逐数持平**，阈值未提高 ✓ |

**预算纪律说明**：
- `asCast` 全程贴住 **31/31 上限**；实现期首版的 `as Record<string, unknown>` 被门禁拦下后
  改为零断言写法（§5）。**未提高阈值、未新增 `any` / 非空断言 / 大文件债务。**
- `bigFiles` 仍为 **4/4**：`MindmapStage.tsx` 2513 → 2642 行（**已在名单内**，未新增超 600 行文件）；
  `packages/react/src/index.ts` 701 → 718（同上）。这两个文件都在 baseline 名单里，未扩大债务面。
- **lint +3 warnings 的来源**：新增的 3 个 `packages/react/dist/…` 无关——是 `summaryCommands.ts`
  与 `summaryInteraction.ts` 引入的既有风格类告警。**未新增 error**；阈值未动。

**cutAttach.ts = 591 行 < 600** ✓（本包未改动该文件。）

---

## §10 公共接线（交主控串行集成）

`packages/react/src/index.ts` 是**共享公共接线点**，本包**只做加法**、未重排未覆盖既有行。
新增 hunk（精确内容）：

```diff
 export type {
   CenterMenuActions,
   DescMenuActions,
   EdgeMenuActions,
   EntityMenuActions,
   FrameMenuActions,
   NoteMenuActions,
   SectionMenuActions,
+  SummaryMenuActions,
 } from './edit/contextMenuItems.js';
 export { createFrame, frameDepthRange, removeFrame, setFrameDepth } from './edit/frameCommands.js';
 export type { FrameDepthRange } from './edit/frameCommands.js';
+// S2：摘要创建命令（「创建摘要…」两跳交互的写入端）——与菜单同一实现、同一 OpHistory 撤销栈。
+// `planCreateSummary` 纯函数出计划（宿主可预览）；`createSummary` 单事务提交。
+export {
+  createSummary,
+  mergeSummaryOf,
+  planCreateSummary,
+  summaryOfNode,
+  SUMMARY_DEFAULT_TEXT,
+} from './edit/summaryCommands.js';
+export type {
+  CreateSummaryResult,
+  SummaryPlan,
+  SummaryPlanError,
+  SummaryPlanErrorCode,
+  SummaryPlanOk,
+} from './edit/summaryCommands.js';
```

**说明**：任务书 §九 要求「若必须新增公共导出，提交精确 export hunk，交给主控串行集成」。
因 `apps/canvas` 经 `@mindcanvas/react` 公共面消费 `createSummary` / `makeSummaryActions`
（画布是独立的包，**必须有公共导出**），本包已按加法落盘并在此提供精确 hunk 供主控核对/串行集成。
若主控裁决改为其他集成方式，本包可据此调整（改动仅限该 hunk）。

---

## §11 未覆盖项与如实披露

1. **canvas 起点 flake 未定位**：基线首跑 1 failed、复跑 2 次全绿。该 flake 在**起工基线即存在**，
   与 S2 无关；首跑日志只截了 tail，失败用例名未保留 → **未定位到具体用例**。
   本包 canvas 判定以复跑稳定绿为准，并在此明示该不确定性。
2. **「切文档清草稿」为设计断言而非端到端断言**：实现用 `controller` 身份变化的清理 effect
   （文档替换会重建 controller）。测试覆盖了「点空白 / Esc」两条清理路径与
   `classifySecondHop` 的 `start-gone` 分支（起点被删 → 清草稿）；
   **未**在测试里驱动真实的文档切换（那需要整装 App 的文件/保存链路，超出 S2 范围）。
3. **未做浏览器人工验证**：本包不含截图/录屏证据（计划把浏览器收尾列为 S5）。
4. **未覆盖**：布局卫星（S3）、括线渲染（S4）、SVG 导出、`LayoutResult.satellites`、
   诊断条 UI 接入、环席位（`subRingItems`）摘要入口（计划列为可选，本包未做）。
5. **未做性能压测**：`planCreateSummary` 为 O(兄弟数)，未做基准；本包不提出性能声称。
6. **`summary_of` 扩展字段的端到端往返**：`mergeSummaryOf` 有直接单测，
   且"补发 cid 不冲掉其它 note 字段"有 plan 级用例；**未**做"带扩展键的摘要经
   `.mm.md` 序列化→解析往返后扩展键仍在"的端到端断言（序列化器非本包改动范围）。
7. **NC-2 下 canvas 全绿**（§7 已披露）：canvas 套件的单事务判别力不足，
   其阴性对照判别力由 NC-1b 承担。

---

## §12 范围声明

- **未启动 S3、S4、S5**（布局卫星 / 括线渲染 / 收尾验证与文档均未开始）。
- **未修改**：布局文件、`forest.ts`、`exportSvg.ts`、`MapView.tsx`、`canvasBackend.tsx`、
  `cutAttach.ts`、P0-D、图库、文件管理模块、`branching.ts`、kernel 包（源码零改动）。
- **未使用** LinkCreator 候选面板作为第二跳完成机制（计划 S-A4 要求）；
  仅借鉴其"草稿态 + 提示 + 清理"骨架（自持 `summaryDraft`）。
- **未 push、未合并、未发布**；未改写 S1 报告、S1 证据、P0-0 文档或任何旧产物。
- 阴性对照副本 `mindcanvas-nc-s2` 已删除；主工作树与 S1 worktree 未被触碰。

**完成后停止，交回主控复核。**
