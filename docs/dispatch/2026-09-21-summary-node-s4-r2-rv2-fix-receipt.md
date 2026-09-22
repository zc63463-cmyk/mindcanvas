# S4-R2 阻断收口复核 —— 补正回执（RV2）

- **任务**：深度修复 `2026-09-21-summary-node-s4-r2-blocker-closeout-review.md` 判定的三项阻断（B-1 / B-2 / B-3），并撤回首版的一处误报（F-03）。
- **补正前候选（复核对象）**：`ceb0573f409259010be6f2073fd5b225bd084335` / tree `f8a229c45a19593e4912472bafc31cacb14f097f`
- **补正后候选（新交付候选）**：`a049930b931fae17d1ba795801da953486b95f9f` / tree `279fa29436617cdcf0e28b1af05c819b4bfc1333`
- **基线**：`732257500f6f6b9d2a8f39d67a37b4ebf836e793` / tree `df7b87e6b98e321f03cfbb1c8c4d06590db14110`
- **分支**：`codex/summary-node-s4-r2-20260921`（未 push；远端可达 **0**）
- **补正 worktree**：`<local-path>`
- **独立复验 worktree**：`<local-path>`（detached @ `a049930`）
- **复验证据目录**：`outputs/summary-node/S4-R2-RV/S4-R2-RV-FIX-20260921-204500/`
- **判定**：**ACCEPT**（三项阻断全部闭合）

---

## 0. 一句话结论

三项原阻断**全部真正闭合**，且是在**补正提交对象上从零独立复验**的：B-1 候选结构口径已与实际单提交谱系对齐（`7322575 → ceb0573 → a049930`）；B-2 复算配方改用可命中的递归 pathspec 并把错误写法显式标为「不可作核验项」；B-3 两个工具已参数化、拒绝覆盖、两路清理、校验 HEAD、声明依赖。**F-03 系我首版误报，已撤回**。全套确定性门禁与四组阴性对照在新提交上重跑全部通过。

---

## 1. 修复清单（6 文件，均为文档 / 证据 / 工具，**无产品源码、无测试、无阈值**）

```
 M  .gitignore                                                            11/0
 M  docs/dispatch/2026-09-21-summary-node-s4-r2-report.md                 127/27
 M  outputs/…/S4-R2/…/evidence-index.md                                    35/13
 M  outputs/…/S4-R2/…/manifest.txt                                         49/31
 M  tools/rebuild-lint-diff.mjs                                           252/0   （重写）
 M  tools/verify-summary.mjs                                               23/1
```

**范围纪律（实测）**：
- 产品源码（`packages/*/src/**`、`apps/*/src/**`）改动 = **0**
- 测试（`packages/*/tests/**`、`apps/*/tests/**`）改动 = **0**
- `biome.json` / `pnpm-lock.yaml` / `packages/kernel` 改动 = **0**

新候选相对基线的完整文件集 = **16 项**（与补正前完全一致，仅内容更新），其中新增 6 项、修改 10 项。

---

## 2. 阻断 B-1：候选结构矛盾 —— **已闭合**

**问题**：候选是单一压平提交（父即基线），但回执按「四条线性提交」叙述，并称「三条提交均满足…」；
`evidence-index.md` 的复算配方写 `# 期望三条`。

**修复**：
1. `s4-r2-report.md` §一标题与正文改述为**单提交结构**，给出真实谱系
   （`5cc0720 → 7322575 → ceb0573`），并显式标注「施工期四提交已压平为一条」。
2. `evidence-index.md` 复算命令改为 `git rev-list --count 7322575..ceb0573` → 期望 **1**。
3. `manifest.txt` §1 说明、§4 关系图、§5 复算命令、§6.1 标题、§6.2 实测值同步改写。
4. 施工期「三条 / 四条」自纠文字**保留但明确标注为施工期历史**（可追溯，不误导）。

**独立复验（在补正提交对象上）**：

```
$ git rev-list --count 7322575..a049930        → 2   （7322575 之后两次提交）
$ git log --format='%H %P' 7322575..a049930
a049930b931fae17d1ba795801da953486b95f9f ceb0573f409259010be6f2073fd5b225bd084335
ceb0573f409259010be6f2073fd5b225bd084335 732257500f6f6b9d2a8f39d67a37b4ebf836e793
```

文档内残余的「四条 / 三条」命中**全部**带「施工期」限定或处于『任何按四条/三条核验的读法都会失败』的警示语境；
无任何一处再以候选身份自称多条提交。

---

## 3. 阻断 B-2：复算配方失效 —— **已闭合**

**问题**：`evidence-index.md` §3 与 `manifest.txt` §5 的「结构核验」仍列 `-- 'packages/*/src' 'apps/*/src'`；
该写法结构性返回空（`*` 不跨 `/`），**在任何改动集上都为空**，却被当作「期望空」的核验项 —— 照做必得假阴性。

**修复**：
- 主核验项改为 `git diff --name-only <codeCandidate>..<deliverableSHA> -- 'packages/*/src/**' 'apps/**/src/**'`，
  并写明「期望且实测：`packages/react/src/chrome/exportSvg.ts`（仅注释）」。
- 错误写法**保留但降级为反例**，配独立性说明与实证：
  「在已知含 16 处 `packages/*/src` 改动的区间 `905c053..5cc0720` 上，该写法仍返回 0」，
  并明确「**不要把它当核验项**」。

**独立复验（补正树内实跑）**：

```
$ git diff --name-only 6a384d3..a049930 -- 'packages/*/src' 'apps/*/src'
（空 —— 且文档已声明此空**不可作为证据**）
$ git diff --name-only 6a384d3..a049930 -- 'packages/*/src/**' 'apps/*/src/**'
packages/react/src/chrome/exportSvg.ts
```

另：删除了 `manifest.txt` §4/§5 中残留的 `..HEAD` 写法（改为具体 SHA），消除自指歧义。

---

## 4. 阻断 B-3：工具覆盖旧证据 —— **已闭合**

### 4.1 `tools/verify-summary.mjs`

**修复**：`SHOTS` 解析顺序改为 `--shots=<dir>` → `REVIEW_SHOTS` → 默认历史目录；
默认命中历史目录时打印**覆盖告警**（并提示 `REVIEW_SHOTS_ALLOW_LEGACY`）；文件头注释写明正确用法。

> 首版文档教的 `S4_SHOTS` **从未被实现**（脚本全文无 `process.env`）；现文档已同步改为 `REVIEW_SHOTS`。

**独立复验**：在补正提交上以**文档所述变量**运行，输出正确路由且历史证据未被触碰：

```
$ REVIEW_SHOTS="…/S4-R2-RV-FIX-20260921-204500/browser" node tools/verify-summary.mjs http://localhost:5191
✅ verify-summary 全部通过        exit=0       截图 19 个写入新目录
```

**历史证据保护（聚合哈希）**：

| | `outputs/summary-node/S4/S4-20260921-160000/browser`（S4 worktree 内）聚合 sha256 |
|---|---|
| 运行前 | `2d72d5c8e95392299a616234c5a24d89f9f8d2f1e0f6c3ced7fae75122c86d35` |
| 运行后 | `2d72d5c8e95392299a616234c5a24d89f9f8d2f1e0f6c3ced7fae75122c86d35` |
| 结论 | **逐字相同 → 历史证据未被覆盖** |

浏览器一致性：`disk index.html` = `main-BgdfvXm7.js`；服务返回 = `main-BgdfvXm7.js`；断言全绿。

### 4.2 `tools/rebuild-lint-diff.mjs`

**修复**（四项全中）：

| 原缺陷 | 修复 |
|---|---|
| 输出写死旧 S4-R2 证据文件、**无覆盖防护** | `--out=` / `LINT_OUT` 参数化；输出已存在且无 `--force` 时**拒绝并 exit 2** |
| 依赖调用者既有 worktree（硬编码路径、不校验 HEAD） | 自建临时 worktree 于 `os.tmpdir()`，建好后**断言 `HEAD == 目标 SHA`**，不符即抛错 |
| 临时 worktree **从不清理**、无 `try/catch` | 包 `try/finally`，成功与失败**两路**均 `git worktree remove --force` + 删临时目录 |
| junction 共享 `node_modules` 未声明 | 文件头「环境依赖」明写：共享主仓 `node_modules`、**不联网**、需先 `pnpm install` |
| 基准 SHA / 命令 / 工具版本 / 结果字段 | 输出新增 `generatedAt`、`toolchain{biome,command,node,platform}`、`refs.r2CandidateResolved`（解析后的实际 SHA） |
| （附带修复）Windows 版本探测用 POSIX 路径 | 版本探测与执行统一走 `biome.cmd`（win32），修复 `ENOENT` |

**独立复验（补正树内三路实跑）**：

```
# ① 默认路径（历史证据）→ 拒绝
$ node tools/rebuild-lint-diff.mjs
[rebuild-lint-diff] 拒绝覆盖已存在的输出文件：…/S4-R2/S4-R2-20260921-160000/gates/lint-diff-raw.json
exit=2

# ② 指定新目录 → 成功，且工具链/差分自述完整
$ node tools/rebuild-lint-diff.mjs --out="…/S4-R2-RV-FIX-20260921-204500/gates/lint-diff-rebuilt.json"
toolchain: biome=Version: 2.5.11 node=v24.15.0
totals: s1=1541 s4=1544 cand=1541
s1_to_s4Candidate:  net=3   （useExportActions net=1; MapView net=2）
s1_to_r2Candidate:  net=0
s4Candidate_to_r2Candidate: net=-3
exit=0

# ③ 旧证据 blob 未变
$ git hash-object …/S4-R2/S4-R2-20260921-160000/gates/lint-diff-raw.json
c9cd74729cd6516a28d65b3efe4af2fe9f90ef29   （= 原值）

# ④ 清理（成功路径与失败路径均验证）
$ git worktree list | grep lint-diff     → 无
$ ls -d /tmp/lint-diff-*                 → 无
```

**失败路径**另以「在 `try` 内注入 `throw`」的副本实测：`exit=1`，无残留 worktree、无残留临时目录、无半成品输出。

### 4.3 脚本输出与独立复算的一致性

脚本输出（`totals` / `pairs.*.netByFileCategory`）与我在 §5 的**独立复算逐项一致** ——
即工具不仅修好了防护，其**计算结果也可信**。

---

## 5. 撤回误报：F-03（`.gitignore` 例外「未生效」）

**首版判定**：据 `git check-ignore -v` 输出判定两条 `!outputs/**/…/*.log` 例外未生效，记 F-03（medium）。

**该判定错误**：`git check-ignore -v` 打印的是**最后匹配到的规则**；
命中 `!` 开头的否定规则时输出同样带路径，**表示未被忽略**，而非被忽略。首版把该文本读反了。

**权威复测（以 `git add` 的真实行为为准）**：

| 测试 | 结果 |
|---|---|
| `git check-ignore -v --no-index …/negctl/_probe.log` | 命中 `!outputs/**/negctl/*.log` → 未被忽略 |
| `git add --dry-run …/negctl/_probe.log` | `add '…/negctl/_probe.log'` → **无需 `-f` 即 staged** |
| `git status --porcelain --ignored=matching -- <该文件>` | `??` → **untracked（非 ignored）** |

**结论**：两条例外**确实生效**；本仓无任何上层目录被忽略，故否定规则可直接生效。
**F-03 撤回**（不计入阻断，亦不计入缺陷）。探针文件已删除，目录复归干净。

**顺带增强**（非必需）：`.gitignore` 注释补上「`check-ignore` 命中 `!` 即未被忽略」与
「以 `git add --dry-run` 为准」的验证方法，防止后人重犯此误读。

---

## 6. 补正后的完整独立复验（**在新提交上从零重跑**）

复验方式：`git worktree add --detach <local-path> a049930b…`，
`pnpm install --frozen-lockfile --prefer-offline`（**downloaded 0，未联网**），随后全量实跑。

| 门禁 | 命令 | 真实退出码 | 实测 |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile --prefer-offline` | 0 | 离线复用 store |
| build | `pnpm -r build` | 0 | 4× Done |
| typecheck | `pnpm typecheck` | 0 | 4× Done |
| depcruise | `pnpm depcruise` | 0 | ✔ no violations（565 modules / 1694 deps） |
| lint | `biome lint packages apps` | 0 | **1541 warnings / 48 infos** |
| budget | `pnpm budget` | 0 | ✅ 全部指标在预算内 |
| kernel | `npx vitest run` | 0 | **708 passed** |
| react | `npx vitest run` | 0 | **1636 passed** |
| canvas | `npx vitest run` | 0 | **396 passed** |
| prod-build-isolation（有产物 / 无产物） | `vitest run tests/prod-build-isolation.test.ts` | **0 / 1** | 2 passed / 2 failed（双向有效） |
| 浏览器验收 | `REVIEW_SHOTS=… node tools/verify-summary.mjs` | 0 | 全绿；历史证据未动 |
| 四组阴性对照 | 补正树内重跑 | 各组 GREEN=0 / **REAL=1** | neg1 5f/1p、neg2 1f/5p、neg3 1f/17p、neg4 2f/16p |
| root 依赖隔离负控 | 仅删 `handleExportPng` deps 内 `root` | GREEN=0 / **REAL=1** | **1 failed \| 4 passed**（恰好目标一例红） |

### 6.1 lint 三树独立复算（补正提交）

| 提交 | 完整 SHA | warnings | infos | errors |
|---|---|---|---|---|
| S1 | `905c053fe396d1fbbc4d663bf4247b0853bffcec` | **1541** | 48 | 0 |
| S4 | `5cc072008dd5cf1278d3e7cdb735535fcf0697f1` | **1544** | 48 | 0 |
| 补正候选 | `a049930b931fae17d1ba795801da953486b95f9f` | **1541** | 48 | 0 |

集合差分（两种键）：

| 键 | S1→S4 | S4→候选 | **S1→候选** |
|---|---|---|---|
| `file\|category` | +3 / −0 | +0 / −3 | **+0 / −0 → 净增 0** ✅ |
| `file\|category\|message` | +3 / −0 | +0 / −3 | **+0 / −0 → 净增 0** ✅ |

S1→S4 的 3 条与 S4→候选净减的 3 条**为同一组 message**：
`useExportActions` 的 `…dependency on root`、`MapView` 的 `…dependency on renderBoxOf`、
`MapView` 的 `…more dependencies than necessary: animBoxes, centerPreview`。

---

## 7. 最终候选标识

```
交付候选完整 SHA : a049930b931fae17d1ba795801da953486b95f9f
交付候选 tree    : 279fa29436617cdcf0e28b1af05c819b4bfc1333
父提交           : ceb0573f409259010be6f2073fd5b225bd084335
祖父提交         : 732257500f6f6b9d2a8f39d67a37b4ebf836e793（= 基线）
提交数 7322575.. : 2
基线完整 SHA     : 732257500f6f6b9d2a8f39d67a37b4ebf836e793
基线 tree        : df7b87e6b98e321f03cfbb1c8c4d06590db14110
分支             : codex/summary-node-s4-r2-20260921
远端可达         : 否（0 个 remote ref 含该提交）
代码候选（施工期）: 6a384d30f5835eb141a92cf96fc726508a542f9d / tree 3d3b8cda7c6282d6e79d2d5fb8127421c5b8fb14
```

**文件集合**：相对基线 **16 项**（10 修改 / 6 新增）——
新增：`apps/canvas/tests/useExportActions.test.tsx`、`negctl/neg{1..4}*.log` + `run.log`（5）、`tools/rebuild-lint-diff.mjs`；
修改：`.gitignore`、两份 dispatch 报告、`evidence-index.md`、`lint-diff-raw.json`、`lint-fix.md`、`manifest.txt`、
`packages/react/tests/summary-export-svg.test.ts`、`tools/verify-summary.mjs`。

---

## 8. ACCEPT 条件逐项核对

| 条件 | 结果 |
|---|---|
| 三项原阻断均在候选提交对象内闭环 | ✅ B-1 / B-2 / B-3 全部闭合（§2–§4），且在**新提交对象**上独立复验 |
| `root` 依赖测试具有真实判别力 | ✅ 隔离负控 `1 failed \| 4 passed`，失败原文收到 `"id":"A"`（应 `"B"`） |
| lint 三树独立复算吻合 | ✅ 1541 / 1544 / 1541；两键 S1→候选**净增 0** |
| 所有确定性门禁通过 | ✅ build / typecheck / depcruise / lint / budget / 测试 / 产物门禁 / 负控 / 浏览器 |
| 候选、主工作树和旧证据均未被修改 | ✅ 候选 worktree `dirty=0`；主 HEAD 未变；`outputs/summary-node/S4` 与 `S4-R2` 改动 **0** |
| 没有新的 high/medium 阻断问题 | ✅ 无（首版 F-03 已撤回） |

**判定：ACCEPT。**

---

## 9. 限制与未覆盖项（如实列出）

1. **`mode-guard.test.tsx` 抖动仍在**：本轮补正树全量实跑未复现；但**上一轮我独立复现过 1 次**，
   故该抖动概率非零。候选未声称已消除，本回执亦不声称。
2. **浏览器验收仅 Chromium 单机**：未覆盖 Firefox / WebKit / 移动端 / 真实 OS IME / 系统文件选择器。
3. **`rebuild-lint-diff.mjs` 的 `--force` 路径未实跑**：覆盖历史证据这一动作**按设计不应发生**，
   故仅验证了「拒绝」（exit 2）与「写新目录」两路；`--force` 分支留作逃生门未演练。
4. **构建哈希不跨树稳定**：本轮在不同 worktree 上得到 `main-BgdfvXm7.js` 与 `main-D5XK-LFM.js`
   两个哈希，说明产物非字节可复现（时间戳/路径敏感）。故「loadedBundle == dist/index.html」这一断言
   **只在同一棵树内成立**，不可作为跨环境常量比对。已在回执中避免此误导。
5. **未核验远端 / CI**：候选未 push，无 remote 可达性可查。
6. **S5 范围未启动**：最终浏览器矩阵、CHANGELOG 收尾、交付发布 —— 本轮**未启动**。
7. **未修改**：候选历史提交 `ceb0573`、主工作树、任何旧报告与旧证据；**未 push / 未合并 / 未发布 / 未 amend**。

---

## 10. 本轮产物

- 补正提交：`a049930b931fae17d1ba795801da953486b95f9f`
- 复验证据：`outputs/summary-node/S4-R2-RV/S4-R2-RV-FIX-20260921-204500/`
  （`gates/` 门禁日志与 lint 三树 JSON、`negctl/` 四组日志、`browser/` 截图与导出件、`gates/negctl-root-dep.log`）
- 首轮复核报告与本回执：`docs/dispatch/2026-09-21-summary-node-s4-r2-blocker-closeout-review.md`（含 F-03 撤回声明）
