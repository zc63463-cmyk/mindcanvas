# BASE-INTEGRATE 综合开发基线冻结与验证 · 交付回执

- 日期：2026-09-20
- 主仓库（只读来源）：`<workspace>`
- 候选工作树（独占）：`<workspace>-base-integrate`
- 候选分支：`codex/base-integrate-frozen-20260920`
- **候选提交：`069144603d56eee730725f848b0c2d69b0995187`**（父 `a2ce72bf122574815bf1b9134253a7bd0349c038`）
- **提交树：`3b0540354ddda4366f4911faac2d86bba9e68b57`**（881 条目）
- 独占证据：`outputs/base-integrate/20260920-01/`
- 本回执自身在候选**之后**写入，属候选外追加文档（先例：`2026-09-19-delivery-close-final-acceptance.md`）；候选内容以提交 SHA 为准。

---

## 0. 结论

**综合基线候选可复核。**

- 已验收保存生命周期 / 模式守卫（含于 DELIVERY-CLOSE 808 候选）、交付收尾 808 候选与 P0-0 固定提交（`3cdcdc3d`）已合入**同一综合候选**；`packages/react/src/index.ts` 公共接线按 P0-0 报告 §4.2 补齐，并新增**公共包入口消费验证**。
- 在同一候选上完成：工具链核验、完整 `pnpm gate`（**GATE_EXIT=0，无超时收束**）、`build`、`analyze`、四包全量测试（**2532**）、P0-0 三套定向（9/29/51）、NC-1…NC-7 隔离复算（**8/8 非零**）、NC-5 三入口（**0/1/0/1**）、保存生命周期 / 模式守卫 / 交付收尾浏览器验收（**PASS / PASS / 53-53 PASS** + 一个行为负控判别力成立）。
- **无阻断项**；未覆盖项与一处环境性技术观察如实列出（§7、§8）。本结论不构成发布、推送或合并批准；**不启动 N0 / S1–S5 / P0-D / 图库实施**。

---

## 1. 来源核对与隔离（只读盘点）

### 1.1 四来源与验收范围

| 来源 | 回执 / 裁决 | 验收范围 | 本次纳入形态 |
|---|---|---|---|
| **A** DELIVERY-CLOSE 808 | `outputs/delivery-close-finish/20260919-04/candidate.json`（808 项）+ `docs/dispatch/2026-09-19-delivery-close-final-acceptance.md`（主控最终验收） | 808 工作区候选（`746 tracked + 62 untracked`，0 删除）整体验收为"下一阶段起点" | **801 件**按验收指纹纳入；7 件漂移转 B/C（见 §1.2） |
| **B** P0-0 | 固定提交 `3cdcdc3d39b243adc0a2485d0ccdab302613ff60` + `docs/dispatch/2026-09-20-P0-0-review.md`（**ACCEPT**） | 恰 13 文件白名单（6 M + 7 A） | **13 件**（其中 6 件覆盖 A 中旧版） |
| **C** `index.ts` 接线 | P0-0 报告 §4.2（待裁定 hunk，路径 A） | 集成修改（不属原候选） | **1 件**：808 版 + §4.2 块 |
| **D** 验收链文档 | 交付收尾 / P0-0 / G0 / FILE-ASSETS 回执链 | 来源可追溯（详见 §2.1-D） | **25 件** |
| **E** 勘误 | 本包新建 | 口径更正 | **1 件**：`docs/dispatch/2026-09-20-P0-0-budget-erratum.md` |

> 保存生命周期（含三轮返修，`save-lifecycle-report` §8 / `save-lifecycle-review` 第三轮放行）与模式守卫（含四轮复核，`mode-guard-review` 第四轮放行）的成果均在 A 的 808 候选中：808 复算 `missing=0`，且其验收放行文档要求"包 3 的兼容性基线是**当前经复核工作区**"。

### 1.2 指纹差异表（808 验收指纹 vs 当前主工作树）

复算命令：`node tools/lib/releaseAcceptance.mjs verify-candidate --file=outputs/delivery-close-finish/20260919-04/candidate.json`（只读）。
证据：`audit/drift-808-vs-worktree.json`、`audit/audit-drift.log`。

```
declared=808  recomputed=844  missing=0  mismatched=7  extra=36
```

**7 件 mismatched（漂移）逐件归因**：

| 文件 | 处置 | 依据 |
|---|---|---|
| `packages/react/package.json` | → P0-0 版本（来源 B） | P0-0 白名单；blob 口径与 `3cdcdc3d` 相等 |
| `packages/react/src/edit/directoryHost.ts` | → P0-0 版本 | 同上 |
| `packages/react/src/edit/directoryTypes.ts` | → P0-0 版本 | 同上 |
| `packages/react/src/edit/handleStore.ts` | → P0-0 版本 | 同上 |
| `packages/react/tests/directory-host.test.ts` | → P0-0 版本 | 同上 |
| `packages/react/tests/handle-store.test.ts` | → P0-0 版本 | 同上 |
| `packages/react/src/index.ts` | → 集成版（来源 C） | 见下 |

**P0-0 来源一致性（双重验证，blob 口径 `git hash-object --path=<p> <p>`）**：

- 工作树 13/13 == `3cdcdc3d`（`audit/p0-0-sourcing.json`）；
- **候选提交内 13/13** == `3cdcdc3d`（提交后 `git rev-parse HEAD:<p>` vs `3cdcdc3d:<p>`，实测 13/13）。

**index.ts 精确验证**（`audit/index-ts-delta.json`，脚本内锚定 §4.2 块逐字删除一次）：

```
工作树 index.ts − P0-0 §4.2 块 == 808 验收字节（sha256 85ed6301…）  → true
§4.2 块在工作树中出现次数 = 1
```

**36 件 extra 分类**：

- 7 件 = P0-0 新增（`workspaceScope.ts` / `scopeIdentity.ts` / `workspace-scope.test.ts` / `helpers/memoryIdb.ts` / `helpers/registryConcurrency.ts` / `counterexamples/nc5-legacy-snapshot.counterexample.ts` / `vitest.counterexamples.config.ts`）→ 纳入（来源 B）；
- 25 件 = 验收链文档 → 纳入（来源 D，清单见 §2.1）；
- 4 件 = 后续批次规划文档 → **明确排除**（§2.2）。

**清单外改动核对（为零）**：工作树 in-scope 改动 153 项 = 候选内 149 + 排除集 4，**无未归属项**（`audit/scope-coverage.json`、`audit/candidate-set.log`）。`outputs/**`、`tools/graph-engine/`、`.cursor/`、`.codebase-memory/`、`_tmp*` 按既有 scope 规则不在候选面内。

### 1.3 隔离声明

- 主工作树**未修改任何既有文件**；新增仅：① 勘误文件（纳入候选）② 本回执（候选外）③ `outputs/base-integrate/20260920-01/` 独占证据。
- **未修改**：P0-0 提交 `3cdcdc3d`、其 tree 与 13 文件字节；旧冻结候选分支；旧清单（808 candidate.json / P0-0 manifest.sha256 / inputs.sha256）；`outputs/file-assets/P0-0/20260920-01/`（只读引用）；`outputs/delivery-close-*/`（只读）；P0-0 复核 worktree `mindcanvas-p0-0-review`（未触碰）。
- 候选构造于**独占工作树**（新分支），构造方式 = 新 worktree 检出基线 → 按候选集精确复制 841 件 → `git add -A` → 提交；**未使用 `git add -A` 于主工作树**。

---

## 2. 最小集成

### 2.1 纳入清单（841 件 = A 808 ∪ B 13 ∪ C 1 ∪ D 25 ∪ E 1，去重）

- **A（808）**：`outputs/delivery-close-finish/20260919-04/candidate.json` 全部路径；其中 801 件与验收指纹逐字节一致，7 件按 §1.2 处置。
- **B（13）**：P0-0 白名单 13 文件（6 件覆盖 A 中旧版；内容以 `3cdcdc3d` 为准）。
- **C（1）**：`packages/react/src/index.ts` = 808 版 + P0-0 §4.2 导出块（**新增集成修改**，见 §2.3）。
- **D（25）验收链文档**（全部来源可追溯，纳入理由 = 构成四来源的验收依据链/交接上下文）：
  - 交付收尾：`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md`
  - P0-0 / G0 / FILE-ASSETS：`docs/dispatch/2026-09-{19-file-assets-contract-close-start, 19-file-assets-design-dispatch, 19-file-assets-design-start, 20-file-assets-contract-close-review, 20-file-assets-contract-close-review2, 20-file-assets-contract-close-review3, 20-file-assets-foundation-dispatch, 20-file-assets-foundation-progress, 20-g0-report, 20-P0-0-report, 20-P0-0-review}.md`
  - 契约/设计（`docs/specs/2026-09-19-file-assets-contract-close/` ×5、`docs/specs/2026-09-19-file-assets-design/` ×7）
  - 计划：`docs/superpowers/plans/2026-09-19-file-assets-contract-close.md`
- **E（1）**：`docs/dispatch/2026-09-20-P0-0-budget-erratum.md`（新建，勘误见 §2.5）。

完整逐件清单与 sha256：`audit/candidate-set.txt` / `audit/candidate-set.json`（841 件，**补入 4 件排除文档之外的全部候选路径**）。

### 2.2 排除清单（明确不纳入，列最小待裁定）

| 文件 | 排除理由 |
|---|---|
| `docs/2026-09-20-摘要节点-设计与实施规划.md` | 后续批次（S1–S5）规划，**未验收**，与四来源无关 |
| `docs/2026-09-20-节点富文本渲染-设计与实施规划.md` | 同上（后续批次规划） |
| `docs/2026-09-20-微调扩展设计讨论.md` | 讨论稿，未验收 |
| `docs/dispatch/2026-09-20-summary-node-plan.md` | 未开工的实施计划（起点 HEAD 为占位） |

> 排除≠删除：4 件仍留在主工作树，未纳入候选提交；如需后续交接，由上层另行裁定（§8 待裁定清单）。

### 2.3 `index.ts` 接线（集成修改声明）

- 内容 = **808 验收版 + P0-0 §4.2 块（1 处连续块，29 行）**，插入点与内容与 P0-0 报告 §4.2 逐字一致（锚点 `export type { PermissionAware } …` 之后）。
- 该文件**不属于**原 P0-0 冻结候选（原候选有意排除），**不再声称与原候选完全相同**；已单列为"集成修改"并单独验证（§1.2 精确删除验证 + 消费验证 §2.4）。
- `scopeIdentity.ts` 的包内工具（`BROWSER_SCOPE` / `applyIdentity` / `markDormant`）**未**扩大为公共 API（与 §4.2 说明一致）。
- 公共导出补齐结果（经包入口实测，§2.4）：`workspaceScope` 9 值 + 5 类型、`handleStore` 3 值 + 3 类型。

### 2.4 公共包入口消费验证（新增，不能仅以 src 深路径证明接线）

脚本：`check/consume-react-entry.mjs`（证据侧，**不改动候选**；解析基准 = 候选树 `packages/react`，经 `createRequire` 走包名 `@mindcanvas/react` self-reference → 候选树 `dist/index.js`；**未新增跨包 src 深路径依赖**）。

```
consume-react-entry exit=0 → 39/39
  - 包名解析：@mindcanvas/react → E:/…/mindcanvas-base-integrate/packages/react/dist/index.js
  - 12 个 P0-0 值导出存在且类型正确
  - 纯函数面：newScopeId / isScopeId / isRegistryRecord（含双 active、null+active 拒绝）/
    upsertEntry（active 换位、旧转 dormant）/ evictEntries（保留 active）/ sameDirectory（unknown/same/different/抛错）
  - 注册表四态 + 单事务 RMW（fake-indexeddb 注入）：empty → ok 首写 → 读回 → 续写 a/b → conflict
```

### 2.5 勘误文件（P0-0 预算口径）

新建 `docs/dispatch/2026-09-20-P0-0-budget-erratum.md`（纳入候选）：旧 P0-0 回执 §7"预算全绿"**仅对应主工作树**（含其它批次债务削减，asCast 31/31、bigFiles 4/4）；**P0-0 冻结候选（隔离树）继承基线红项**（asCast 32/31、bigFiles 5/4，与基线逐项相同 → P0-0 零债务增量）。本勘误不提高阈值、不放宽测试、不修改旧回执与旧清单。

**本综合候选的实测**：budget **全绿**（asCast 31/31、bigFiles 4/4、bang 89/90↓1）——即 P0-0 复核 §7-C1 所要求的"先并入其它批次的债务削减"在综合候选中已满足（见 §4）。

---

## 3. 候选标识、差异与冻结记录

| 项 | 值 |
|---|---|
| 候选提交 SHA | `069144603d56eee730725f848b0c2d69b0995187` |
| 提交树 | `3b0540354ddda4366f4911faac2d86bba9e68b57`（881 条目，`audit/candidate-tree.txt`） |
| 父提交（基线） | `a2ce72bf122574815bf1b9134253a7bd0349c038` |
| 相对父提交差异 | **149 文件（95 A + 54 M），+26757 / −1484**（`audit/candidate-diff-final.txt`） |
| 候选文件集 | 841 件（其中 528 件与基线逐字节相同） |
| 复制完整性 | 841/841 sha256 == 主工作树源（`audit/apply-candidate.json`） |
| 逐文件 blob 对照（提交索引 vs 主工作树） | **841/841 一致，零丢失改动**（`audit/explain-diff.json`） |
| P0-0 13 文件（提交内） | 13/13 blob == `3cdcdc3d` |
| `index.ts` | 工作树 − §4.2 块 == 808 验收字节（true；块恰 1 次） |
| 提交方式 | 独立 worktree + 精确复制 + `git add -A` + 提交（`--no-verify`；等效 depcruise+biome 由 §4 全量实跑覆盖） |

**哈希口径声明**：

- 候选清单（`candidate-set.txt`）：文件**实际字节** sha256（与 808 `candidate.json`、`inputs.sha256` 同口径；`core.autocrlf=true` 下即工作树检出字节）。
- 提交树（`candidate-tree.txt`）：`git ls-tree -r`，**git blob SHA-1**（LF 归一化）口径。
- P0-0 清单复用其 **git blob 口径**（`manifest.sha256` 复算命令 `git cat-file blob <ref>:<path> | sha256sum`），本次以 `git hash-object --path` 对齐。

**构建产物哈希**：`audit/artifacts.sha256`（**609 件**：`apps/canvas/dist` + 四包 `dist`）；入口产物 **`apps/canvas/dist/assets/main-BVSvKDBt.js`**（候选树新构建；与 808 旧产物 `main-Db31m2so.js` 不同——候选源码集不同，属预期）。运行输入冻结清单：`browser/inputs.sha256`（11 项，含上述入口与夹具；**另建新清单，旧清单未覆盖**）。

---

## 4. 验证结果（同一候选；命令/退出码见 `logs/exit-codes.txt`）

### 4.1 工具链核验

| 项 | 仓库声明 | 实测 | 判定 |
|---|---|---|---|
| pnpm | `packageManager: pnpm@10.33.2` | **10.33.2**（`node …/pnpm/bin/pnpm.cjs --version`） | ✅ 一致 |
| Node | `engines.node >=20.19.0` | **v24.15.0** | ✅ 满足 |
| store | — | `E:\.pnpm-store\v10`（离线安装 150 包，17s） | 记录 |

**依赖解析隔离（任务书要求）**：候选树 `pnpm install --frozen-lockfile --offline` 自建依赖；`@mindcanvas/{kernel,free-canvas,react}` 的 junction **全部指向候选树自身** `packages/*`（构建与测试解析证据：vitest 输出头 `RUN … E:/…/mindcanvas-base-integrate/packages/react`；消费验证解析到候选树 dist）。**未借主工作树构建结果**。

### 4.2 门禁 / 构建 / 分析

| 命令（候选树） | 退出码 | 关键结果 |
|---|---|---|
| `pnpm typecheck` | **0** | 四包 Done |
| `pnpm depcruise` | **0** | 537 modules / 1604 dependencies / **0 违规** |
| `pnpm lint` | **0** | 544 files；**1541 warnings + 48 infos（0 error）**（与 808 基线 20260919-03 口径持平） |
| `pnpm budget` | **0** | **全绿**：any 0/0、tsIgnore 0/0、**bang 89/90↓1**、asCast 31/31、console 4/4、todo 1/1、defaultExport 2/2、bigFiles 4/4 |
| `pnpm build` | **0** | 四包构建成功（canvas 242 modules；入口 `main-BVSvKDBt.js`） |
| `pnpm analyze` | **0** | 结构分析通过 |
| **`pnpm gate`（完整单命令）** | **0** | **GATE_EXIT=0，无超时收束**；test 段 12 / 622 / 1545 / 353 |

> 说明：历史批次曾记录"vitest 打印摘要后不退出（环境级，timeout 收束 124）"；本轮完整 gate **干净退出 0**，该现象未复现（如实记录，不推断根因；见 §8）。

### 4.3 测试

| 项 | 结果 |
|---|---|
| free-canvas / kernel / react / canvas | **12 / 622 / 1545 / 353 = 2532 passed**（react 另以 `--pool=threads` 独立复跑 1545/1545） |
| P0-0 三套定向（`packages/react`） | `workspace-scope` **9 passed**；`handle-store` **29 passed**；`directory-host` **51 passed**（期望 9/29/51 全中） |
| 与 808 基线对照 | 808 记录 12/622/1502/353=2489；本候选 = 808 + P0-0 新增 43（9+15+19）→ 2532，逐项吻合 |

### 4.4 NC 负控（隔离副本，候选树内重建）

构建器 `negatives/negatives.py`（候选树版，源 = 候选树，单点中性化"恰 1 处"防呆）；复算 `negatives/rerun-nc-negatives.sh` / `rerun-nc5-entries.sh`（Git Bash + Windows node）。

**NC-1…NC-7：8/8 子命令真实退出码非零**（`negatives/nc-exit-codes.txt`），**红因全部为目标断言、环境错误 0**（`negatives/nc-reds.json`）：

| NC | AssertionError 数 | 环境错误 |
|---|---|---|
| NC-1 / handle-store | 9 | 0 |
| NC-2 / directory-host | 2 | 0 |
| NC-3 / handle-store、directory-host | 2 / 2 | 0 |
| NC-4 / handle-store、directory-host | 2 / 2 | 0 |
| NC-6 / directory-host | 1 | 0 |
| NC-7 / handle-store | 1 | 0 |

**NC-5 三入口：0 / 1 / 0 / 1**（`negatives/entry-exit-codes.txt`）：

| 入口 | 期望 | 实测 | 红因 |
|---|---|---|---|
| 入口 1（默认套件并发回归） | 0 | **0** | — |
| 入口 2（旧快照反例，独立 config） | 非零 | **1** | AssertionError |
| 入口 3-control（正常副本） | 0 | **0** | — |
| 入口 3-neutralized（读取移出事务） | 非零 | **1** | AssertionError |

复算后候选树零残留（临时副本文件清除；`git status` = 0 行；常驻反例仅 `nc5-legacy-snapshot.counterexample.ts`）。

### 4.5 浏览器验收（真 Chromium；页面实际加载 `main-BVSvKDBt.js` = 候选树产物）

| 脚本 | 退出码 | 结果 |
|---|---|---|
| `tools/verify-save-lifecycle.mjs` | **0** | **PASS**（11/11 断言：慢写窗口"保存中…"不误报、恰 2 次写入、第二次含最新编辑） |
| `tools/verify-mode-guard.mjs` | **0** | **PASS**（28/28 断言：未保存标记/组合输入/候选串不提交等） |
| `tools/verify-release-123.mjs --mode=normal --inputs=…` | **0** | **53/53 PASS，envFailures 0** |
| `tools/verify-release-123.mjs --mode=neg-saveas-share` | **1** | 48/53；failedCaseIds = **[R7b, R7c, R7d, R7e, R7f]**；envFailures 0（判别力成立；正常/负控 case 集合与顺序一致） |

快照新鲜度守卫三查通过：产物构建于 2026-09-20 18:53:00 > HEAD 提交 18:46:43；页面加载 bundle == 产物引用 bundle。

---

## 5. 证据索引（`outputs/base-integrate/20260920-01/`）

```
audit/   audit-drift.mjs/log、drift-808-vs-worktree.json、p0-0-sourcing.json、index-ts-delta.json、
         candidate-set.mjs/json/txt、scope-coverage.json、apply-candidate.mjs/json、
         check-candidate-staging.mjs/json、explain-diff.mjs/json（841/841）、
         candidate-diff-final.txt、candidate-tree.txt、artifacts.sha256/json（609）、
         git-status.txt、worktree-changes.json、commit-message.txt
negatives/  negatives.py、rerun-nc-negatives.sh、rerun-nc5-entries.sh、nc-meta.json、
            nc-build.log、check-nc-reds.mjs、nc-reds.json
nc/       NC-1..7 共 8 份运行日志 + t11-entry{1,2,3-control,3-neutralized} 4 份
根级      nc-exit-codes.txt、entry-exit-codes.txt、entry3-after-removal.txt、gate-full.sh
check/   consume-react-entry.mjs
browser/ inputs.sha256、normal/{results.json,shots/,exports/}、neg-saveas-share/{results.json,…}
logs/    gate-typecheck/depcruise/lint/budget.log、gate-full.log（PATH 诊断）、gate-full2.log（GATE_EXIT=0）、
         build-root.log、analyze.log、test-{kernel,canvas,free-canvas}.log、react-full-threads.log、
         p0-{workspace-scope,handle-store,directory-host}.log、verify-{save-lifecycle,mode-guard}.log、
         verify-release-123-normal.log、verify-release-123-neg-saveas-share.log、
         consume-react-entry.log、install-offline.log、exit-codes.txt
impl-copies-archive/  （NC-5 入口 3 双副本 + 反例，源自 P0-0 归档，只读复制）
gate-full.sh
```

---

## 6. 技术观察（不影响结论）

1. **新 worktree 的 `git add` 前中间态**：复制 841 件后、`git add` 前，新 worktree 首次 `status` 显示 313 条（218 M + 95 ??）；`git add -A` 后收敛为 **149 条真实改动（54 M + 95 A）**，与主工作树对候选的改动集**逐一吻合**。提交后工作树零差异；逐文件 blob 对照 **841/841（0 丢失）**。该中间态未影响提交内容（证据链见 §3），如实记录以备复核。
2. **CRLF**：`core.autocrlf=true`，无 `.gitattributes`；候选树与主工作树字节一致（841/841 sha256），blob 口径单列（§3 口径声明）。
3. **完整 gate 干净退出**：与历史"摘要后挂起"记录不同（§4.2 注）。

---

## 7. 未覆盖 / 未运行项（如实声明）

1. **真实系统文件选择器手势、真实 OS 输入法候选框、触控、跨浏览器（仅 Chromium）、离线、跨平台像素金图**：不覆盖（沿用 808 验收与 P0-0 复核的既有边界声明）。
2. **P0-0 专属 CDP 页（`idb-check.html` 真实 IndexedDB 十项）未在候选树重跑**：本次浏览器证据为 save-lifecycle / mode-guard / release 矩阵 + 一个负控；P0-0 三套定向测试与 NC 负控均已跑（§4.3/§4.4）。
3. **NC-5 入口 3 的双副本来自 P0-0 归档**（未在候选树重跑 `make-impl-copies` 生成器）；适用性由：源文件 blob 13/13 == P0-0 固定提交 + control 副本跑绿 + neutralized 副本跑红 佐证。
4. **`pnpm gate` 的分项等效覆盖**照常保留；本次完整命令本身已干净退出（§4.2）。
5. **未 push、未发布、未 amend P0-0 提交、未合并任何分支**；候选仅存在于本地集成分支。
6. 主工作树中 4 件后续批次规划文档未纳入（§2.2）；`outputs/**` 证据目录不入候选（沿用 808 scope 规则）。

---

## 8. 待裁定清单（最小，供上层）

| # | 事项 | 建议 |
|---|---|---|
| 1 | 4 件后续批次规划文档（§2.2）是否随后续交接归档 | 待 N0/S1 等启动时按其自身边界处理 |
| 2 | 消费验证（§2.4）是否需要在后续批次固化为常驻测试 | 本包按"证据侧验证"处理，未向候选新增测试文件 |
| 3 | 完整 gate 干净退出与历史挂起记录的差异（环境性） | 后续复跑时观察，如复现按原口径记录 timeout |

**无阻断项。**

---

## 9. 停止点

综合基线候选 `codex/base-integrate-frozen-20260920 @ 069144603d56eee730725f848b0c2d69b0995187` 冻结完成，证据齐备，**交复核；不启动 N0、S1–S5、P0-D 或图库实施**。本回执不构成验收或发布批准。
