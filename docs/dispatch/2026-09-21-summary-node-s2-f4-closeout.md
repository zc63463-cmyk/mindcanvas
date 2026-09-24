# 摘要节点 S2-F4 最小收口回执

- **日期**：2026-09-21
- **性质**：S2 最终独立复核 **F-4 记账项**的**最小收口**（只删死代码；不启动 S3）
- **固定基线（父提交）**：`b2dff2b7a2af5c4139bb80375ad7d0eb8747f092`
  （tree `3cb9f4b931ed4c7630b76270bc8f91480de52699`）
- **S1 已验收基线**：`905c053fe396d1fbbc4d663bf4247b0853bffcec`
- **本轮修复提交**：`e187fa9064c3c7554626005c2e43fcd735c76ecf`
- **修复提交 tree**：`3874987ec7f2205e182b8337aee30db8bab0c89e`
- **修复 worktree**：`<local-path>`（detached `b2dff2b`，主树之外）
- **本轮证据目录**：`outputs/summary-node/S2/20260921-S2F4-01/`
- **结论**：**收口完成**。相对 S1 的**唯一新增告警已消除**，**未新增任何告警**；
  定向测试与 react 全包不受影响。未 push、未合并、未发布。

> **保留声明**：本轮**未 amend、未覆盖**任何旧提交。`9cac632` / `0d77197` / `4867386` / `b2dff2b`
> 原样保留（逐条已核，见 §6）；旧证据目录（`20260920-S2-01`、`20260920-S2-REPAIR-01`、
> `20260920-S2-CLOSEOUT-01`、`20260921-S2FINALREV-01`）**一字未改**。

---

## §1 问题（来自最终独立复核 F-4）

相对已验收 S1 基线 `905c053`（**1541** warnings），最终 S2 候选（`4867386` / `b2dff2b`）
为 **1542** —— 多 **1** 条：

```
packages/react/tests/summary-create.test.ts:115:10
lint/correctness/noUnusedVariables   "This function okPlan is unused."
```

`okPlan` 是测试文件内的类型收窄小工具，**全文件零调用**（死代码）：

```ts
/**
 * 类型收窄小工具（替代 `throw` 后继续用变量——TS 不会因 throw 收窄外层变量）。
 * 失败即抛，语义与内联 throw 相同，但返回值带窄化后的类型。
 */
function okPlan(plan: SummaryPlan): SummaryPlanOk {
  if (!plan.ok) throw new Error(`expected ok plan, got ${plan.error.code}`);
  return plan;
}
```

---

## §2 处置（最小范围）

### 2.1 删除内容

1. `function okPlan(...)` 函数体**及其中文文档注释**；
2. import 中的 **`type SummaryPlan`** 与 **`type SummaryPlanOk`**。

### 2.2 为什么必须一并删掉两个类型导入（否则「以新增抵消新增」）

实测两类型在**全文件**的出现次数：

| 符号 | 出现位置 | 除 `okPlan` 外是否还有用 |
|---|---|---|
| `SummaryPlan` | import(37) + `okPlan`(115) | **否** |
| `SummaryPlanOk` | import(39) + `okPlan`(115) | **否** |
| `SummaryPlanError` | import(38) + `widened`(120,122) | **是**（保留） |

若只删函数而保留导入，会立刻产生 **2 条新的 `noUnusedImports` 告警** —— 等于把 1 条问题
换成 2 条，属「以新增抵消新增」，违反原约束。故同一提交内一并删除。
`type SummaryPlanError` **保留**（`widened()` 仍在使用）。

### 2.3 完整改动

```
packages/react/tests/summary-create.test.ts | 11 -----------
1 file changed, 11 deletions(-)
```

```
@@ -34,9 +34,7 @@ import {
   mergeSummaryOf,
   planCreateSummary,
   summaryOfNode,
-  type SummaryPlan,
   type SummaryPlanError,
-  type SummaryPlanOk,
 } from '../src/edit/summaryCommands.js';
@@ -108,15 +106,6 @@ function snapshot(root: EditableNode): string {
   return JSON.stringify(root, (_k, v) => (v === undefined ? '__undef__' : v));
 }
 
-/**
- * 类型收窄小工具（替代 `throw` 后继续用变量——TS 不会因 throw 收窄外层变量）。
- * 失败即抛，语义与内联 throw 相同，但返回值带窄化后的类型。
- */
-function okPlan(plan: SummaryPlan): SummaryPlanOk {
-  if (!plan.ok) throw new Error(`expected ok plan, got ${plan.error.code}`);
-  return plan;
-}
-
 function widened(plan: { ok: boolean }): { ok: false; error: SummaryPlanError } {
```

### 2.4 边界遵守（逐项自查）

| 约束 | 遵守 |
|---|---|
| 只删该死辅助函数及必要空行 | ✓ 另含**仅供其使用**的 2 个类型导入（理由见 §2.2） |
| 不改产品逻辑 | ✓ 唯一改动文件是 `packages/react/tests/**`，无 `src/**` 改动 |
| 不改测试断言 | ✓ 仅删**未被调用**的辅助函数；无任何 `expect`/`it`/`describe` 变化 |
| 不改导出 | ✓ `packages/react/src/index.ts` 与候选**逐位相同**（§6） |
| 不改协议 | ✓ 无 kernel / 序列化 / 类型契约改动 |
| 保留旧提交与旧证据 | ✓ 见 §6 |

---

## §3 验证（同工具、同命令、逐文件 / 逐规则 / 逐位置）

**同一命令**：`npx biome lint packages apps`（JSON 结构化输出，`--max-diagnostics=none`）。
三棵树均为**独立 detached 检出 + 独立 `pnpm install`**：

| 树 | 检出 | warnings | infos | errors |
|---|---|---|---|---|
| S1 | `905c053`（`<local-path>`） | **1541** | 48 | 0 |
| 修复前 | `b2dff2b`（`<local-path>`） | **1542** | 48 | 0 |
| **修复后** | `e187fa9`（同 worktree，提交后复跑） | **1541** | 48 | 0 |

```
FIXED - BASE = -1
FIXED - S1   =  0      ← 回到已验收 S1 水平
```

### 3.1 目标告警确实消失

| 树 | `summary-create.test.ts` 的 `noUnusedVariables` |
|---|---|
| S1 | 0 |
| 修复前 | **1**（`@115:10` "This function okPlan is unused."） |
| 修复后 | **0** |

### 3.2 未新增其它告警（两种键各证一遍）

- **位置无关键**（`file|rule|message`，抗行号平移）：
  - `BASE → FIXED`：**新增 0 种 / 0 命中**；删除 1 种 / 1 命中（即 `okPlan`）。
  - `S1 → FIXED`：**新增 0 种 / 0 命中**；删除 0 种 / 0 命中。
- **逐文件**（三树对比，只有 1 个文件有差异）：

  | 文件 | S1 | 修复前 | 修复后 |
  |---|---|---|---|
  | `packages/react/tests/summary-create.test.ts` | 0 | 1 | **0** |

- **逐规则**（三树对比，只有 1 条规则有差异）：

  | 规则 | S1 | 修复前 | 修复后 |
  |---|---|---|---|
  | `lint/correctness/noUnusedVariables` | 24 | 25 | **24** |

  其余 13 条规则三棵树**完全持平**；`infos` 三树恒为 **48**。

> **方法学说明（如实记录一处比对假象）**：以 `file|rule|line:col` 为键比对 `S1 → FIXED` 时，
> 会报出 `apps/canvas/src/MindmapStage.tsx` 的 13 个「新位置」。这是**行号平移假象**，不是新增告警：
> 该文件在 S2 期间被合法改动，行号相对 S1 位移；而本轮修复**完全未触碰**该文件
> （`git diff --name-only b2dff2b HEAD` 只有 1 个文件，见 §2.3）。
> 用抗平移的 `file|rule|message` 键复算，新增为 **0**；逐文件与逐规则汇总也各自独立对上 S1。
> 两种键的完整输出均留档：`lint-comparison.txt`（含假象）与
> `lint-comparison-positionfree.txt`（权威判定）。

### 3.3 未提高阈值、未抵消其它旧告警

- 阈值未动：`budget` 实测 `asCast` **31(31)**、`bigFiles` **4(4)**，与 S1 一致（§4）。
- 相对 S1：新增 **0**、删除 **0**，不存在「删旧警抵新警」。
- 相对修复前：删除 **1**（目标项）、新增 **0**。

---

## §4 门禁实测（修复后终态）

| 门禁 | 命令 | 实测 | 判定 |
|---|---|---|---|
| 定向测试（summary-create） | `npx vitest run tests/summary-create.test.ts` | **39 passed / 1 file** | ✓ exit 0 |
| react 全包 | `npx vitest run`（packages/react） | **1599 passed / 157 files** | ✓ exit 0 |
| typecheck | `pnpm -r typecheck` | 4 包全 Done | ✓ exit 0 |
| lint | `npx biome lint packages apps` | **1541 warnings + 48 infos** | ✓ exit 0 |
| budget | `node scripts/check-code-budget.mjs` | 全指标在预算内 | ✓ exit 0 |

```
budget 明细：any 0 / tsIgnore 0 / bang 89(90) / asCast 31(31) / console 4
             / todo 1 / defaultExport 2 / bigFiles 4(4)
```

**测试数未变**（39 / 1599 与复核期一致）——因为改动只删除**未被调用**的测试辅助函数，
不涉及任何断言。

**提交时 pre-commit 钩子**亦自动复跑：`depcruise`（551 modules / 1644 deps / 0 violations）
与 `biome lint`（1541 warnings）均通过。

---

## §5 提交锚定

```
fix commit SHA : e187fa9064c3c7554626005c2e43fcd735c76ecf
fix commit tree: 3874987ec7f2205e182b8337aee30db8bab0c89e
parent         : b2dff2b7a2af5c4139bb80375ad7d0eb8747f092
subject        : fix(react): S2-F4 收口 —— 删除零调用死辅助函数 okPlan（消除相对 S1 的唯一新增告警）

diffstat       : 1 file changed, 11 deletions(-)
files changed  : packages/react/tests/summary-create.test.ts

git diff --name-status b2dff2b HEAD
    M  packages/react/tests/summary-create.test.ts
```

**逐文件清单（修复树相关文件 sha256，git blob 字节）** 见 `evidence/f4-files.sha256`。
唯一改动文件的字节指纹：

| 时点 | sha256 |
|---|---|
| 修复前（`b2dff2b`） | `744452127ebeee59b62712129a25e35e99eaa6de3f883ee5be8b09ce3d592a9c` |
| 修复后（`e187fa9`） | `70da5ab38a738d70828c636ff3ad832f5b7f76f4104ba8d444bad143c58f8a1a` |

**未 amend 旧提交**：`e187fa9` 是 `b2dff2b` 之上的**新提交**，父指针即冻结基线。

### 5.1 修复仅为测试代码，产品产物不变（已实测）

从消费方 `apps/canvas` 实测解析与指纹：

```
@mindcanvas/react  -> <local-path>
  index.js sha256 = 04cba3096a85e66553187adb2fde7857d2b2598f370bea39467bd4a7cc230fd3
@mindcanvas/kernel -> <local-path>
  index.js sha256 = 3cd978a749f616adb248c89c1127e099d2602e70ea15d15ecdb733418eb7be96
```

两指纹与 `b2dff2b`、以及复核期 `4867386` **逐位相同** —— 与「本轮只动测试文件」一致，
**产品行为零变化**。

---

## §6 旧提交与旧证据保留核对

### 6.1 旧提交仍在（逐条实测）

```
9cac632  9cac632b27ce883bcd9631718b5930d769f5ea76  feat(react+canvas): 摘要创建事务与两跳交互（S2）
0d77197  0d77197f57a0f963845fe3074f65cad5ff2f2458  docs(dispatch): 摘要 S2 回执（…）
4867386  4867386978e0f768aa6a31b8e34d1bc4e446e7d7  fix(react+canvas): S2 定向返修收口（…）
b2dff2b  b2dff2b7a2af5c4139bb80375ad7d0eb8747f092  docs(dispatch): S2 返修后交付收口回执（…）
905c053  905c053fe396d1fbbc4d663bf4247b0853bffcec  feat(react): summary_of 锚迁移登记（…）
```

分支引用未变：`codex/summary-node-s2-20260920` 仍指向 **`b2dff2b`**（**未**把修复提交挂到该分支）。

### 6.2 旧证据未改写

四个旧证据目录（`20260920-S2-01`、`20260920-S2-REPAIR-01`、`20260920-S2-CLOSEOUT-01`、
`20260921-S2FINALREV-01`）共 **153 个文件** sha256 快照留档；
本轮**只新增** `20260921-S2F4-01/` 目录，**未写入**其它任何目录。
S2 施工 worktree 内新增内容仅 `outputs/summary-node/S2/20260921-S2F4-01/`（本包证据）
与 `docs/dispatch/2026-09-21-summary-node-s2-f4-closeout.md`（本回执）。

### 6.3 产品文件与冻结基线逐位相同

对 S2 全部产品文件抽查 `git rev-parse b2dff2b:<path>` 与 `HEAD:<path>`：
`MindmapStage.tsx` / `useSummaryHop.ts` / `useDocumentToken.ts` / `testBuild.ts` /
`packages/react/src/index.ts` / `summaryCommands.ts` / `summary-two-hop-host.test.tsx`
**全部 IDENTICAL**。

---

## §7 未覆盖 / 限制（如实）

1. 本轮**只**处理 F-4 记账项。最终复核报告的其它观测项
   （F-2 观测口镜像卸载顺序、F-3 同同步批令牌窗口）**未处理**——二者均为非阻断、
   生产不可达/构建期消除，**不在本轮授权范围**。
2. 未做浏览器人工验证；未覆盖原生文件选择器交互（S5 范围）。
3. 未启动 S3（布局卫星）/ S4（括线渲染）/ S5（收尾）。
4. 临时核对用的 S1 lint 基线 worktree 与 F-4 修复 worktree 均为**主树之外**；
   S1 基线 worktree 已在核对后删除。修复 worktree 保留供复核者独立复算。
5. 本轮**未 push、未合并、未发布**。

---

## §8 证据清单

`outputs/summary-node/S2/20260921-S2F4-01/`

```
logs/t1-summary-create.log           定向：summary-create 39 passed
logs/t2-react-full.log               react 全包 1599 / 157 files
logs/t3-typecheck.log                typecheck exit 0
logs/t4-lint.log                     lint 1541 warnings / 48 infos, exit 0
logs/t5-budget.log                   budget 全指标在预算内
evidence/f4-anchor.txt               提交 SHA / tree / parent / 字节指纹
evidence/f4-changed-files.txt        git diff --name-status b2dff2b HEAD
evidence/f4-files.sha256             修复树相关文件逐文件 sha256
evidence/lint-905c053.json           S1 结构化 lint
evidence/lint-b2dff2b.json           修复前结构化 lint
evidence/lint-fixed.json             修复后结构化 lint
evidence/lint-compare.mjs            行敏感比对（含行号平移假象的原始证据）
evidence/lint-comparison.txt         上述输出
evidence/lint-compare-positionfree.mjs  抗平移比对（权威判定）
evidence/lint-comparison-positionfree.txt  上述输出
evidence/lint-comparison-README.txt  比对方法与假象说明
evidence/pre-fix-fingerprint.txt     修复前文件 sha256
evidence/post-fix-fingerprint.txt    修复后文件 sha256
evidence/dist-resolution.log         dist 解析路径 + 两个 dist 指纹
```

**结论限于：F-4 最小收口完成，可提交独立复核。** 未 push、未发布、未启动 S3；完成后停止。
