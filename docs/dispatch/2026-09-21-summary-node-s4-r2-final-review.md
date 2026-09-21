# S4-R2 阻断收口候选最终独立复核（S4-R2-FRV）

- **判定**：**ACCEPT**
- **候选完整 SHA**：`123d22b773a06c4b8e3f6aa987e5493a2e3fce1b`
- **候选 tree**：`bdf0b32af5b17b28ac3aa54c6c307fea82a6a4c3`
- **基线完整 SHA**：`732257500f6f6b9d2a8f39d67a37b4ebf836e793` / tree `df7b87e6b98e321f03cfbb1c8c4d06590db14110`
- **RunId**：`S4-R2-FRV-20260921-220000`
- **复核 worktree**：`<local-path>`（detached @ `123d22b`）
- **证据目录**：`outputs/summary-node/S4-R2-FRV/S4-R2-FRV-20260921-220000/`
- **复核性质**：只读。**未修改候选、主工作树、既有报告与旧证据；未 push / 未合并 / 未发布 / 未 amend；未启动 S5。**

---

## 0. 结论摘要

三项原阻断（B-1 候选结构矛盾 / B-2 复算配方失效 / B-3 工具覆盖旧证据）**在候选提交对象内真实闭环**，
经**从候选完整 SHA 新建 detached worktree 的从零独立复验**全部成立。
lint 三树独立复算与候选工具输出**逐项吻合**；`root` 依赖测试具有**真实判别力**（负控收到 `rootA` 而非 `rootB`）；
全部确定性门禁与本轮四组阴性对照通过；候选、主工作树与旧证据**均未被修改**。

**未发现新的 high/medium 阻断项。** 仅有一项 **low** 级观察（`.gitignore` 例外的路径范围比自述略宽，见 §7.2），不构成阻断。

---

## 1. 谱系与范围

### 1.1 提交谱系（实测）

```
$ git rev-list --count 7322575..123d22b
3

$ git log --format='%H %T %P %s' 7322575..123d22b
123d22b… bdf0b32… a049930… docs(dispatch): S4-R2-RV 补正回执（三项阻断闭合 + F-03 误报撤回；判定 ACCEPT）
a049930… 279fa29… ceb0573… fix(s4-r2-rv): 闭合独立复核三项阻断 —— 候选结构口径 / 复算配方 / 证据输出防护
ceb0573… f8a229c… 7322575… fix(s4-r2): 修复独立复核三项阻断（证据入库 / 范围核验 / lint 差分基准）
```

| 项 | 实测 |
|---|---|
| 提交数 `7322575..123d22b` | **3**（线性单父链，无合并） |
| 候选父提交 | `a049930b931fae17d1ba795801da953486b95f9f` |
| 候选祖父 | `ceb0573f409259010be6f2073fd5b225bd084335` |
| 基线是候选祖先 | ✅ `git merge-base --is-ancestor` 成立 |
| 分支 | `codex/summary-node-s4-r2-20260921` → `123d22b` |
| 远端可达 | **0** 个 remote ref（未 push） |
| 复核 worktree dirty | **0** |
| 主工作树 HEAD | `a2ce72bf122574815bf1b9134253a7bd0349c038`（复核全程未变） |

### 1.2 文件集合（`7322575..123d22b` 共 17 项）

| 类别 | 文件 | numstat |
|---|---|---|
| **测试** | `apps/canvas/tests/useExportActions.test.tsx` (M) | 70/0 |
| **测试** | `packages/react/tests/summary-export-svg.test.ts` (M) | 4/1 |
| **工具** | `tools/rebuild-lint-diff.mjs` (A) | 252/0 |
| **工具** | `tools/verify-summary.mjs` (M) | 23/1 |
| 配置 | `.gitignore` (M) | 11/0 |
| 文档 | `docs/dispatch/…s4-r2-report.md` (M) | 127/27 |
| 文档 | `docs/dispatch/…s4-r2-rv2-fix-receipt.md` (A) | 289/0 |
| 文档 | `docs/dispatch/…s4-report.md` (M) | 13/4 |
| 证据 | `…/S4-R2/…/evidence-index.md` (M) | 35/13 |
| 证据 | `…/S4-R2/…/gates/lint-diff-raw.json` (M) | 431/172 |
| 证据 | `…/S4-R2/…/gates/lint-fix.md` (M) | 9/3 |
| 证据 | `…/S4-R2/…/manifest.txt` (M) | 49/31 |
| 证据 | `…/negctl/neg{1..4}-*.log` (A×4) | 69/0, 67/0, 71/0, 72/0 |
| 证据 | `…/negctl/run.log` (A) | 2/0 |

**分类核验（两种方法一致）**：

```
$ git diff --name-status 7322575 123d22b -- 'packages/*/src/**' 'apps/*/src/**'
（空 —— 产品源码 0 改动）

$ git diff --name-only 7322575 123d22b | wc -l
17        （无 pathspec 的权威全量清单，逐个人工分类同上表）
```

**无无关产品逻辑、无阈值/规则（`biome.json` 零改动）、无锁文件（`pnpm-lock.yaml` 零改动）、
无 kernel 改动、无生成产物被夹带。**

### 1.3 产品行为确实未变（**已独立验证**）

`packages/react/src/chrome/exportSvg.ts` 在**代码候选之后**被改（注释口径更正），但：

| 检查 | 结果 |
|---|---|
| 是否在 `7322575..123d22b` 范围内 | **否**（`git diff --name-only 7322575 123d22b -- …exportSvg.ts` 为空） |
| 相对代码候选 `6a384d3` 的 numstat | **6/1** |
| 剥离注释后的非注释 token | `6a384d3` = 5641 chars / sha256 `35688be7bdc85726`；`123d22b` = **5641 chars / sha256 `35688be7bdc85726`** |

→ **非注释语句与运行行为均未改变**；仅注释变化。文档表述已由「零改生产源码」更正为
「零改生产源码的**行为**」，与实际一致（`s4-r2-report.md:62`、`manifest.txt:79`）。

### 1.4 旧错误表述全仓搜索

| 检查项 | 结果 |
|---|---|
| 候选自称「三条提交 / 四条提交」为**当前终态** | ❌ 无。全部命中属 (a) **S3/beam 历史报告**（与 S4-R2 无关）、(b) 候选自身**明确警告**「任何按『四条 / 三条提交』核验候选的读法都会失败；候选结构**只有一个提交**」（`s4-r2-report.md:42`）、(c) 补正回执**复述**首版问题、(d) 标注为「**施工期**」的历史说明（`manifest.txt:28`、`s4-r2-report.md:47,300`） |
| 用 `packages/*/src` / `apps/*/src` 作为生产源码范围**核验项** | ❌ 无。正确写法 `'packages/*/src/**' 'apps/**/src/**'` 为**主核验项**；错误写法仅作为**反例**出现，并附「不可作核验项」标注与实证（`evidence-index.md:100-107`、`manifest.txt:73`） |
| lint 数字写成 S4 的 **1543** | ❌ 无。所有 1543 命中均为**更正追溯**（「原文写 1543 为笔误/旧读」）或另一语境的历史数字；S4 真值统一为 **1544** |
| SVG 导出层含不存在的「**框边界**」 | ❌ 无。7 处命中全部为**更正后表述**：「导出**不画框边界**」/「删除不存在的框边界导出层」 |
| 「零改生产源码」与注释改动一致 | ✅ 已统一为「零改生产源码的**行为**」 |

---

## 2. 日志入库闭环

### 2.1 在候选提交对象上核验

```
$ git ls-tree -r --long 123d22b -- …/S4-R2/…/negctl/
100644 blob 118efd1f…   3337  …/negctl/neg1-unmount.log
100644 blob 8356072c…   3789  …/negctl/neg2-order.log
100644 blob a37d5e90…   4134  …/negctl/neg3-rootbox.log
100644 blob c439566d…   3753  …/negctl/neg4-nofilter.log
100644 blob dc49708b…   5823  …/negctl/run-negctl.sh
100644 blob 16b3515f…    105  …/negctl/run.log
```

全仓已跟踪 `*.log` **恰 5 个**，全部位于该 `negctl/` 目录，与 `evidence-index.md` 一致。

### 2.2 从全新 detached worktree 重新读取

在候选完整 SHA 新建的 detached worktree 中，5 份日志均可从磁盘与提交对象两种途径读取
（`git cat-file -e` 与文件系统 `ls -l` 均通过）。

### 2.3 退出码与计数核对（读自**提交对象**）

| # | GREEN | REAL | 中性化后构成 | 与回执一致 |
|---|---|---|---|---|
| neg1-unmount | 0（6 passed） | **1** | 5 failed / 1 passed | ✅ |
| neg2-order | 0（6 passed） | **1** | 1 failed / 5 passed | ✅ |
| neg3-rootbox | 0（18 passed） | **1** | 1 failed / 17 passed | ✅ |
| neg4-nofilter | 0（18 passed） | **1** | 2 failed / 16 passed | ✅ |

### 2.4 无作弊迹象（全部 0 命中）

| 模式 | 命中 |
|---|---|
| `Cannot find module` / `Invalid hook call` / `ReferenceError` | **0 / 0 / 0** |
| `it.fails` / `.skip(` / `describe.skip` | **0 / 0 / 0** |
| `catch` 后报 PASS | **0** |
| 反转断言（`expect(...).not.`） | **0** |

### 2.5 neg4 目标断言与邻居带红（区分准确）

- `summary-frames.test.ts:572`「摘除判定只能来自 satellites（单一事实源）」= **目标断言**
- `summary-frames.test.ts:437`「无 satellites → 不产出 view」= **同前提邻居用例**

回执 §四的归属表与实跑日志一致，区分准确。

### 2.6 `.gitignore` 例外的真实 Git 行为（**已用 `git add` 实证**）

| 检验 | 命令 | 结果 |
|---|---|---|
| negctl 下新日志可纳入 | `git add --dry-run …/negctl/_probe.log` | `add '…/negctl/_probe.log'` ✅ |
| gates 下新日志可纳入 | `git add --dry-run …/gates/_probe.log` | `add '…/gates/_probe.log'` ✅ |
| **未扩大到无关日志** | `git check-ignore -q` on `outputs/base-integrate/…/logs/gate-lint.log` | **IGNORED** ✅ |
| 同上（audit 子目录） | `…/audit/explain-diff.log` | **IGNORED** ✅ |
| 仓库根散落日志 | `out_root_probe.log` | **IGNORED** ✅ |
| `docs/` 下日志 | `docs/_probe.log` | **IGNORED** ✅ |

`outputs/` 下共 **637** 个 `*.log`，其中仅 **10** 个匹配 `negctl/` 子路径；其余 **627** 个仍被忽略。
→ 例外**生效且范围受限于 `outputs/**/negctl/` 与 `outputs/**/gates/`**。探针已清理，worktree 复归 `dirty=0`。

---

## 3. 范围核验工具（独立检查）

### 3.1 `tools/rebuild-lint-diff.mjs`

| 要求 | 静态 | 动态实跑 |
|---|---|---|
| `--out=` 可写入新目录 | ✅（另支持 `LINT_OUT` 环境变量） | ✅ exit **0**，写入新目录并打印 `toolchain` 行 |
| 默认目标已存在时**非零退出并拒绝覆盖** | ✅（`existsSync(OUT) && !FORCE → exit 2`） | ✅ exit **2**，并提示改用 `--out=` 或显式 `--force` |
| **成功路径**清理临时 worktree | ✅ `try/finally → cleanup()` | ✅ 无残留 worktree、无 `/tmp/lint-diff-*` |
| **失败路径**清理临时 worktree | ✅ 同上 | ✅ 注入 mid-run `throw` 后 exit **1**，无残留 worktree、无临时目录、**无半成品输出** |
| 建树后**校验目标 HEAD**，不依赖调用者 worktree | ✅（`rev-parse HEAD` ≠ ref 即抛错） | ✅ 无任何硬编码调用者 worktree 路径（`grep LINT_WT` 为空） |
| 记录 Biome / Node / Git 工具链 | ✅ | ✅ 输出 `{"biome":"Version: 2.5.11","command":"lint packages apps --reporter=json --max-diagnostics=3000","node":"v24.15.0","platform":"win32"}`，并附 `refs.r2CandidateResolved=123d22b…`（实际解析值） |
| 明确记录共享 `node_modules` junction / 安装前提 | ✅ 文件头「环境依赖」段声明 | — |
| **不覆盖旧 evidence** | ✅ 覆盖防护 | ✅ 全程后 `lint-diff-raw.json` blob 仍为 `c9cd7472…`（= 提交值） |

### 3.2 `tools/verify-summary.mjs`

| 要求 | 结果 |
|---|---|
| 支持 `REVIEW_SHOTS` 与 `--shots=` | ✅ 二者均实现（命令行优先） |
| 默认命中历史证据目录时**告警或拒绝** | ✅ 打印 `⚠️ 未指定输出目录，正在写入历史证据目录…` 并提示 `REVIEW_SHOTS_ALLOW_LEGACY` |
| 新目录运行**不写入** S4 / S4-R2 旧证据 | ✅ 见下（聚合哈希前后逐字相同） |
| `loadedBundle` 与当前 `dist/index.html` 对应产物一致 | ✅ 三者一致（见 §6.2） |
| 失败时**非零退出**，不以空目录 / 缺产物判通过 | ✅ 指向死端口 → exit **1**；另有 `checkSnapshotFresh()` + `assertLoadedBundle` 双守卫，`process.exit(pass ? 0 : 1)` |

**旧证据保护（两轮独立运行后聚合哈希）**：

| 目录 | 运行前 | 运行后 |
|---|---|---|
| `…/S4/S4-20260921-160000/browser` | `172d88f5bc3c…` | `172d88f5bc3c…` ✅ |
| `…/S4-R2/S4-R2-20260921-160000/browser` | `b893aeb8bcc3…` | `b893aeb8bcc3…` ✅ |

---

## 4. lint 三树复算（**未采信候选 JSON**）

**方法**：从候选完整 SHA 另建 detached worktree；对三个提交各自**独立建树**，
以**同一 Biome 二进制**（`2.5.11`，取自复核 worktree）运行**同一命令**
`biome lint packages apps --reporter=json`。

### 4.1 汇总

| 提交 | 完整 SHA | warnings | infos | errors | 要求 | 一致 |
|---|---|---|---|---|---|---|
| S1 | `905c053fe396d1fbbc4d663bf4247b0853bffcec` | **1541** | **48** | 0 | 1541 / 48 | ✅ |
| S4 | `5cc072008dd5cf1278d3e7cdb735535fcf0697f1` | **1544** | **48** | 0 | 1544 / 48 | ✅ |
| 候选 | `123d22b773a06c4b8e3f6aa987e5493a2e3fce1b` | **1541** | **48** | 0 | 1541 / 48 | ✅ |

### 4.2 集合差分（两种键）

| 键 | S1→S4 | S4→候选 | **S1→候选** |
|---|---|---|---|
| `file\|category` | **+3 / −0** | **+0 / −3** | **+0 / −0 → 净增 0** ✅ |
| `file\|category\|message` | **+3 / −0** | **+0 / −3** | **+0 / −0 → 净增 0** ✅ |

**S1→S4 净增的 3 条**（键含 message）：

1. `apps/canvas/src/hooks/useExportActions.ts` · `useExhaustiveDependencies` · *This hook does not specify its dependency on **root**.*
2. `packages/react/src/render/MapView.tsx` · `useExhaustiveDependencies` · *This hook does not specify its dependency on **renderBoxOf**.*
3. `packages/react/src/render/MapView.tsx` · `useExhaustiveDependencies` · *This hook specifies more dependencies than necessary: **animBoxes, centerPreview**.*

**S4→候选净减的 3 条为同一组（message 逐字相同）。**

→ 六项要求（S1=1541 / S4=1544 / 候选=1541 / S1→S4 净增 3 / S4→候选净减 3 / S1→候选净增 0）**全部满足**。

### 4.3 与脚本输出逐项比对

```
OK   totals.s1.warnings   : tool=1541  mine=1541
OK   totals.s4.warnings   : tool=1544  mine=1544
OK   totals.cand.warnings : tool=1541  mine=1541
OK   s1_to_s4 net          : tool=3     mine=3
OK   s1_to_cand net        : tool=0     mine=0
OK   s4_to_cand net        : tool=-3    mine=-3
*** ALL MATCH ***
```

> 说明：`file|line|category` **不作为**比对键 —— 行号随代码变动漂移，跨树比对无意义
> （S1→候选会给出 37/37 的假非零）。任务书点名的两种键均为净零。

---

## 5. `root` 依赖判别测试

### 5.1 用例内容（逐项符合要求）

| 要求 | 实测 |
|---|---|
| 初次渲染使用 root A | ✅ `initialProps: { r: rootA }`，并先断言 `exportSvg`/`exportPng` 收到 `rootA` |
| rerender 换成**可明确区分**的 root B | ✅ `rootA={id:'A'}` / `rootB={id:'B'}`，`rerender({ r: rootB })`，其余 props 引用不变 |
| 调用的是 **rerender 后保留的** `handleExportPng` | ✅ rerender 之后调用 `result.current.handleExportPng()` |
| 断言观察到 **B** 的结果（非回调重建 / mock 次数） | ✅ `expect(vi.mocked(exportPng)).toHaveBeenLastCalledWith(layout, token, expect.objectContaining({ root: rootB }))` |
| 正常候选必须通过 | ✅ `5 passed (5)` |

### 5.2 隔离负控（**只删 `root`，不改测试期望**）

在隔离副本中仅从 `handleExportPng` 的 deps 删除 `root`，随后重建：

```
GREEN_EXIT_CODE=0      Tests  5 passed (5)          ← 变异前先绿
REAL_EXIT_CODE=1                                    ← 真实非零
  ✓ tainted：onNotice 收到「含外部图片」文案…        ← 其余 4 例继续通过
  ✓ unsupported：…
  ✓ 未注入 onNotice → 静默降级…
  ✓ 同 layout、换 boundaryLinks → 收到新值…
  × root 换代后 handleExport / handleExportPng 均使用新 root（缺 root 依赖即红）
  Tests  1 failed | 4 passed (5)                    ← 恰好目标一例红
```

**失败原文（决定性证据 —— 观测的是 root 的值，不是调用次数）**：

```
AssertionError: expected last "vi.fn()" call to have been called with [ {}, {}, ObjectContaining{…} ]
- Expected            + Received
    "root": {             "root": {
-     "id": "B",            "id": "A",     ← 收到旧 rootA，正是「deps 漏 root」的症状
```

**测试期望未被修改**（负控中仅改生产 `deps`）：

```
commit 版 sha256(去 CRLF) : da59714f38b93bd169fbf46e61cd19000a75f77c340e3c04c724e34abbe47fef
隔离副版 sha256(去 CRLF)  : da59714f38b93bd169fbf46e61cd19000a75f77c340e3c04c724e34abbe47fef
*** MATCH ***
```

### 5.3 计数解释

| 包 | 实跑 | 说明 |
|---|---|---|
| kernel | **708 passed** | 与 S4 持平，未增未删 |
| react | **1636 passed** | 与 S4 持平，未增未删 |
| canvas | **396 passed** | S4 为 395 → **+1** = 本轮新增的 `root` 依赖用例 |

→ canvas 395→396、React/kernel 数量不变，**解释成立且与实跑一致**。

---

## 6. 全量门禁

### 6.1 确定性门禁（在候选 worktree 内重建后实跑）

| 门禁 | 命令 | 真实退出码 | 实测 |
|---|---|---|---|
| build | `pnpm -r build` | **0** | 4× Done |
| typecheck | `pnpm typecheck` | **0** | 4× Done |
| depcruise | `pnpm depcruise` | **0** | ✔ no violations（565 modules / 1694 deps） |
| lint | `biome lint packages apps` | **0** | **1541 warnings / 48 infos** |
| budget | `pnpm budget` | **0** | ✅ 全部指标在预算内（债务未增长） |
| kernel 全包 | `npx vitest run` | **0** | 708 passed |
| React 全包 | `npx vitest run` | **0** | 1636 passed |
| Canvas 全包 | `npx vitest run` | **0** | 396 passed |
| 定向（摘要三件套） | `vitest run summary-*` | **0** | 34 passed |
| 定向（`useExportActions`） | `vitest run tests/useExportActions.test.tsx` | **0** | 5 passed |
| `prod-build-isolation` 无产物 | 移走 `dist` | **1** | 2 failed（`expect(files.length, MISSING_DIST).toBeGreaterThan(0)`） |
| `prod-build-isolation` 有产物 | `pnpm -r build` 后 | **0** | 2 passed |

### 6.2 浏览器验收（新服务 / 新端口 / 新目录）

| 要求 | 实测 |
|---|---|
| 使用**新**端口，未复用旧服务 | ✅ 事前确认 **5197 空闲**，新起 `vite preview --port 5197 --strictPort`；验收后按 PID 终止，端口已释放 |
| bundle 文件名 | `dist/index.html` = **`main-BgdfvXm7.js`**；HTTP 服务返回 = **`main-BgdfvXm7.js`**；记录 = `loadedBundle=main-BgdfvXm7.js` |
| 磁盘哈希 | `sha256` = `159e2d1a8e3c452757daf48e195ce882e175c654eaa4f4057e2189cffb06797a`（1500+ KB 级） |
| **服务字节与磁盘一致** | 服务返回 sha256 = `159e2d1a…` → **逐字相同** |
| 退出码 | **0** |
| 断言 | **43 项通过 / 0 失败** |
| 截图路径 | 16 个 PNG 写入 `…/S4-R2-FRV/S4-R2-FRV-20260921-220000/browser/`，**未覆盖** S4 / S4-R2 旧证据（聚合哈希前后相同） |

### 6.3 四组阴性对照（在本轮 worktree 内独立重跑）

| 组 | GREEN | REAL | 中性化后 |
|---|---|---|---|
| neg1-unmount | 0 | **1** | 5 failed / 1 passed |
| neg2-order | 0 | **1** | 1 failed / 5 passed |
| neg3-rootbox | 0 | **1** | 1 failed / 17 passed |
| neg4-nofilter | 0 | **1** | 2 failed / 16 passed |

红因均与提交日志中的目标断言一致；跑完后 worktree `dirty=0`（还原成功）。

---

## 7. 判定

### 7.1 ACCEPT 条件逐项核对

| 条件 | 结果 |
|---|---|
| 三项原阻断在候选提交对象内**真实闭环** | ✅ B-1/B-2/B-3 全部（§1.4、§3、§4） |
| B-1、B-2、B-3 的**文档、工具、谱系矛盾均消除** | ✅ 见 §1.4（无旧错误表述）、§3（工具全项通过） |
| lint 三树**独立复算吻合** | ✅ 1541 / 1544 / 1541；两键 S1→候选**净增 0**；与脚本**逐项 ALL MATCH** |
| `root` 依赖测试具有**真实判别力** | ✅ 负控中收到 `"id":"A"` 而非 `"B"`；测试期望未被修改 |
| **全部确定性门禁通过** | ✅ build / typecheck / depcruise / lint / budget / 三包测试 / 产物门禁 / 四组负控 / 浏览器 |
| 候选、主工作树与旧证据**未被修改** | ✅ 候选 worktree `dirty=0`；主 HEAD 未变；`S4` 与 `S4-R2` 证据 0 改动 |
| **无新的 high/medium 阻断项** | ✅ 无（仅一项 low，见下） |

**判定：ACCEPT。**

### 7.2 新发现项（**low，不阻断**）

**`.gitignore` 例外的路径范围比自述略宽**：
`!outputs/**/negctl/*.log` 与 `!outputs/**/gates/*.log` 使用 `**` 通配，
因此**任何未来 run 的同名子目录**（如 `outputs/summary-node/S4/R1/negctl/`）也会自动放行，
并不限于本交付的 RunId。

- **影响评估**：范围仍**严格限于** `outputs/**/negctl/` 与 `outputs/**/gates/`；
  实测 `outputs/` 下 637 个 `*.log` 中**仅 10 个**落在放行范围，其余 627 个（含 `base-integrate/**/logs/`、`audit/`）
  **仍被忽略**；仓库根与 `docs/` 下的日志亦仍被忽略。**候选内实际入库的仅 5 个预期日志**，无夹带。
- **结论**：与「只放行预期的 `negctl/*.log` 与 `gates/*.log`」的**路径模式描述一致**，
  仅「不限于本 RunId」这一点未在注释中言明。**属措辞精度问题，不构成阻断**；
  建议（非必须）后续在注释里补一句「作用域为 outputs/ 下任意 `negctl/`、`gates/` 目录」。

---

## 8. 最终候选标识、退出码与限制

### 8.1 候选标识（冻结值）

```
候选完整 SHA : 123d22b773a06c4b8e3f6aa987e5493a2e3fce1b
候选 tree    : bdf0b32af5b17b28ac3aa54c6c307fea82a6a4c3
谱系         : 7322575 (基线) → ceb0573 → a049930 → 123d22b
提交数       : 3（线性单父，未 push）
基线完整 SHA : 732257500f6f6b9d2a8f39d67a37b4ebf836e793
基线 tree    : df7b87e6b98e321f03cfbb1c8c4d06590db14110
分支         : codex/summary-node-s4-r2-20260921
远端可达     : 否（0 remote refs）
```

### 8.2 真实退出码汇总（本轮独立实跑）

| 命令 | 退出码 |
|---|---|
| `pnpm install --frozen-lockfile --prefer-offline` | 0（`downloaded 0`，未联网） |
| `pnpm -r build` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm depcruise` | 0 |
| `biome lint packages apps` | 0（1541/48） |
| `pnpm budget` | 0 |
| kernel / react / canvas `vitest run` | 0 / 0 / 0（708 / 1636 / 396） |
| `prod-build-isolation`（无 / 有产物） | **1 / 0** |
| `rebuild-lint-diff.mjs` 默认路径（拒绝覆盖） | **2** |
| `rebuild-lint-diff.mjs --out=<新目录>` | 0 |
| `rebuild-lint-diff.mjs` 注入失败 | **1**（清理成功，无残留） |
| `verify-summary.mjs`（REVIEW_SHOTS，活服务） | 0（43 通过 / 0 失败） |
| `verify-summary.mjs`（死端口） | **1** |
| neg1–neg4 | 各组 GREEN=0 / **REAL=1** |
| root 依赖隔离负控 | GREEN=0 / **REAL=1** |

### 8.3 限制与未覆盖项（如实列出）

1. **`rebuild-lint-diff.mjs` 的 `--force` 分支未演练** —— 覆盖历史证据按设计不应发生，故只验证了「拒绝」（exit 2）路径。
2. **`mode-guard.test.tsx` 既有抖动未消除** —— 本轮 canvas 全量实跑为绿（396 passed）；
   但该抖动在**更早一轮独立复现过 1 次**（`expect(saveState).toContain('未保存')` 收到 `'✓ 已保存'`）。
   候选未声称已消除，本报告亦**不声称**已消除。
3. **浏览器验收仅 Chromium 单机** —— 未覆盖 Firefox / WebKit / 移动端 / 真实 OS IME / 系统文件选择器。
4. **构建哈希不跨树稳定** —— 本轮实测到 `main-BgdfvXm7.js` 与（更早一轮）`main-D5XK-LFM.js` 两个哈希，
   说明产物非字节可复现。故「`loadedBundle` == `dist/index.html`」**仅在同一棵树内成立**，
   不可作为跨环境常量比对。
5. **未核验远端 / CI** —— 候选未 push，无 remote 可达性可查。
6. **未启动 S5** —— 最终浏览器矩阵、文档收尾、交付发布不在本轮范围。

### 8.4 未修改声明

- 候选提交对象、分支引用 `codex/summary-node-s4-r2-20260921`（仍为 `123d22b`）、候选 worktree（`dirty=0`）：**未修改**。
- 主工作树 HEAD 仍为 `a2ce72bf122574815bf1b9134253a7bd0349c038`。
- 既有报告与旧证据（`outputs/summary-node/S4/…`、`…/S4-R2/…`）：**0 处改动**（聚合哈希逐字相同）。
- **未 push、未合并、未发布、未 amend**；复核树内**未做任何修复**。
- 复核产生的唯一新 worktree：`<local-path>`（detached，保留供核验）；
  临时 lint worktree（3 个）与隔离副本已清理。

---

## 附：本轮新证据

`outputs/summary-node/S4-R2-FRV/S4-R2-FRV-20260921-220000/`（详见同目录 `evidence-index.md`）。
**全部新证据均写入本轮 RunId 目录，未触碰任何历史证据。**
