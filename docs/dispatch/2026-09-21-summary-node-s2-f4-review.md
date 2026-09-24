# S2-F4 最小收口 —— 独立复核报告

- 复核日期：2026-09-21
- 复核 RunId：`20260921-F4-review`
- 证据目录：`outputs/summary-node/S2/20260921-F4-review/`
- 对象（固定）：S1 `905c053` / 修复前 `b2dff2b` / 修复后 `e187fa9` / Tree `3874987`
- 范围：**只复核 F4 收口**。未修复、未合并、未 push、未启动 S3。

---

## 结论

**ACCEPT** —— F4 收口通过，可把 `e187fa9` 作为 S3 基线。

三条阻断级主张（“只删死代码” / “告警回到 S1 且无新增种类” / “全门禁通过”）均在独立复核下逐条复现，未发现任何偏差。

---

## 1. 对象与工作树

四个固定对象全部存在且类型正确：

| 对象 | SHA | 类型 | Tree |
|---|---|---|---|
| S1 | `905c053fe396d1fbbc4d663bf4247b0853bffcec` | commit | `9e3f98e45d537a0a5064df0cd37d769f75b68282` |
| 修复前 | `b2dff2b7a2af5c4139bb80375ad7d0eb8747f092` | commit | `3cb9f4b931ed4c7630b76270bc8f91480de52699` |
| 修复后 | `e187fa9064c3c7554626005c2e43fcd735c76ecf` | commit | `3874987ec7f2205e182b8337aee30db8bab0c89e` |
| Tree | `3874987ec7f2205e182b8337aee30db8bab0c89e` | tree | — |

- `e187fa9^{tree}` 实测 = `3874987...`，与声明一致（CONFIRMED）。
- `e187fa9^` 实测 = `b2dff2b`，且 `git merge-base --is-ancestor b2dff2b e187fa9` 为真，父提交关系成立。
- 复核使用三棵**干净**工作树：`<local-path>`（detached，`e187fa9`）、`.../.workbuddy/wt-summary-node-s1`（`905c053`）、`<local-path>`（`b2dff2b`）。
- 复核结束后 `e187fa9` 工作树仍为 0 改动；复核仅新增本次证据目录。

> 说明：任务书第 1 条要求“从 `e187fa9` 创建 detached worktree”。该 worktree 已存在且处于 detached HEAD=`e187fa9`、`symbolic-ref` 无引用、工作树干净，满足全部要求，故直接复用而非另建（避免对同一提交的重复检出）。

## 2. 相对 `b2dff2b` 只有 `packages/react/tests/summary-create.test.ts`

```
git diff --numstat b2dff2b e187fa9
0       11      packages/react/tests/summary-create.test.ts
```

变更文件数 = **1**，与声明完全一致。改动为 **0 insertions / 11 deletions**，即**纯粹删减**（复核确认 diff 中 `+` 内容行 = 0）。

## 3. 仅删除 `okPlan` 及其两个只被该函数使用的类型导入

删除内容（`cat -A` 逐行确认，无重排、无重缩进）：

- 2 行类型导入：`type SummaryPlan`、`type SummaryPlanOk`
- 4 行 JSDoc 注释（描述 `okPlan`）
- 3 行函数体 `function okPlan(plan: SummaryPlan): SummaryPlanOk { ... }`
- 1 行尾部空行

「死」与「只被该函数使用」两条均经独立取证，而非采信报告：

| 取证 | 结果 |
|---|---|
| `okPlan` 在 `b2dff2b` 全树出现次数 | **1** —— 其自身定义（`summary-create.test.ts:115`），**零调用点** ⇒ 确为死代码 |
| `SummaryPlan` / `SummaryPlanOk` 在 `b2dff2b` 测试中的使用 | 仅导入行（:37/:39）与 `okPlan` 签名（:115） |
| `SummaryPlanError` 是否误删 | **否**，正确保留 —— `widened` 仍在 :120/:122 使用 |
| `okPlan` 在 `e187fa9` 全树残留 | **0** |
| 产品是否仍导出这两个类型 | **是**，`summaryCommands.ts:59/71` 的 `export` 未动；删的是**测试的冗余导入**，非库的导出 |

`summary-create.test.ts` 测试声明数 39 → 39（724 → 713 行，恰为 −11），无测试丢失。

## 4. 产品源码 / 导出 / 协议 / 旧提交 / 旧证据未变

| 检查 | 命令 | 结果 |
|---|---|---|
| 任何生产文件被改？ | `git diff --name-only b2dff2b e187fa9`（排除 `*.test.*`、`docs/`） | **空** |
| 产品 `src/` 被改？ | `git diff --stat b2dff2b e187fa9 -- 'apps/*/src/*' 'packages/*/src/*'` | **空** |
| 导出面被改？ | `git diff b2dff2b e187fa9 -- packages/react/src/index.ts` | **空** |
| 协议/模式/存储被改？ | diff 限定 `*protocol* *schema* *storage* *persist* *migrat*` | **空** |
| 关键产品 blob 一致？ | 逐文件 `git rev-parse` 比对 | `summaryCommands.ts` / `index.ts` / `contextMenuItems.ts` / `menuActionTypes.ts` / `MindmapStage.tsx` 全部 **SAME** |
| 旧提交仍稳固？ | ref 与 reflog | `codex/summary-node-s1-*`=`905c053`、`codex/summary-node-s2-*`=`b2dff2b`，reflog 线性**无改写** |
| 旧证据未变？ | 91 个既有证据文件 sha256 全量指纹 + mtime | 全部 **02:50**（早于本次复核 02:58），指纹留档 `prior-evidence.sha256` |

唯一 blob 变化：`summary-create.test.ts` 由 `6abfccc` → `2473e17`，符合预期。

## 5. Biome 复算（同一命令，逐树）

命令（三棵树完全一致）：`npx biome lint packages apps`，Biome **2.5.11**。

| 树 | 检出点 | warnings | infos | errors | 文件数 |
|---|---|---|---|---|---|
| S1 | `E:/.workbuddy/wt-summary-node-s1` | **1541** | **48** | 0 | 549 |
| 修复前 | `E:/outputs/mindcanvas-s2-final-review` | **1542** | **48** | 0 | 558 |
| 修复后 | `E:/outputs/mindcanvas-s2-f4` | **1541** | **48** | 0 | 558 |

三组数字与任务书要求（1541/48、1542/48、1541/48）**逐一命中**。文件数 549 vs 558 的差值为 S2 新增文件所致，与告警口径无关。

## 6. 抗行号平移的 `file|rule|message` 键比较

复核**自行编写**比较脚本 `review-compare-positionfree.mjs`，直接读取本次重采的原始 Biome JSON，键取 `file|rule|message`（**剔除 line/column**），未使用作者脚本作为判定依据。

```
=== position-free (file|rule|message): S1 -> AFTER ===
  ADDED (0 kinds, 0 hits):   NONE
  REMOVED (0 kinds, 0 hits): NONE

=== position-free (file|rule|message): BEFORE -> AFTER ===
  ADDED (0 kinds, 0 hits):   NONE
  REMOVED (1 kinds, 1 hits):
    -1  [BEFORE=1 AFTER=0]  packages/react/tests/summary-create.test.ts
        |lint/correctness/noUnusedVariables|This function okPlan is unused.

RULE TOTALS  S1=24  BEFORE=25  AFTER=24   lint/correctness/noUnusedVariables
FILE TOTALS  S1=0   BEFORE=1   AFTER=0    packages/react/tests/summary-create.test.ts
```

- **S1 → 修复后新增种类 = 0** ✓
- **修复前 → 修复后目标告警减少 1** ✓（且恰为该一条，无任何新增种类）

补充交叉验证：将**作者留档的 JSON** 与**复核重采的 JSON** 做位置无关种类集合比对，三棵树全部 `IDENTICAL`（S1 243/243、修复前 244/244、修复后 243/243，对称差为 0）——说明作者的证据可被独立复现，且修复确已落入 `e187fa9`。

## 7. 门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| summary-create | `npx vitest run tests/summary-create.test.ts` | **39 passed**，exit 0 |
| react 全包 | `npx vitest run` | **1599 passed / 157 files**，exit 0 |
| typecheck | `npx tsc -b tsconfig.json` | 无输出，exit 0 |
| lint | `npx biome lint packages apps` | exit 0（1541 warnings / 48 infos） |
| budget | `node scripts/check-code-budget.mjs` | 全部指标在预算内，exit 0 |

**覆盖率守恒对照**：对**修复前**树同样重跑 react 全包，亦为 **1599 passed / 157 files**。被测总数前后一致，证明被删的 `okPlan` 确未被任何测试使用，修复未削减任何覆盖。

## 8. 约束遵守（不改阈值 / 不改期望 / 不宽泛 skip）

- **阈值**：diff 内无任何 `*config*` / `*.json` / `*budget*` / `*threshold*` 文件。
- **测试期望**：diff 中 `expect(` / `toBe` / `toEqual` / `assert` 等断言行**增删均为 0**；测试数 39 → 39。
- **skip**：未新增 `.skip` / `.only` / `.todo` / `xit(` / `xdescribe(`。
- 复核行为本身：未改任何阈值、未改任何测试期望、未使用 skip；三棵工作树在复核后保持干净。

---

## 附：证据索引

`outputs/summary-node/S2/20260921-F4-review/`

```
README.txt                              本次复核说明与总表
logs/t1-summary-create.log              39 passed
logs/t2-react-full.log                  修复后全包 1599 passed
logs/t2b-react-full-before.log          修复前全包 1599 passed（覆盖守恒对照）
logs/t3-typecheck.log                   tsc -b
logs/t4-lint.log                        规范 lint（修复后）
logs/t4-lint-s1.log                     lint @ S1
logs/t4-lint-before.log                 lint @ 修复前
logs/t4-lint-fixed.log                  lint @ 修复后（独立工作树）
logs/t5-budget.log                      预算
evidence/review-anchor.txt              冻结 SHA / tree / parent
evidence/review-fingerprints.txt        blob 指纹；产品 blob 全 SAME
evidence/lint-{s1,before,after}.json    复核重采的原始 Biome JSON
evidence/review-compare-positionfree.mjs    复核自著比较脚本
evidence/review-comparison-positionfree.txt 其输出
evidence/review-crosscheck-author-vs-mine.mjs 作者证据 vs 复核证据
evidence/review-crosscheck.txt          其输出（三树全 IDENTICAL）
evidence/prior-evidence.sha256          91 个既有证据文件指纹
```

**动作边界**：未修复、未合并、未 push，S3 未启动。复核对冻结对象均为只读。
