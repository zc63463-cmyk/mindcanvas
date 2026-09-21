# S4-R2 阻断收口候选独立复核（S4-R2-RV）

- **判定**：**BLOCK**
- **复核对象（候选完整 SHA）**：`ceb0573f409259010be6f2073fd5b225bd084335` / tree `f8a229c45a19593e4912472bafc31cacb14f097f`
- **基线（完整 SHA）**：`732257500f6f6b9d2a8f39d67a37b4ebf836e793` / tree `df7b87e6b98e321f03cfbb1c8c4d06590db14110`
- **RunId**：`S4-R2-RV-20260921-200000`
- **复核 worktree**：`<local-path>`（detached HEAD @ `ceb0573`）
- **证据目录**：`outputs/summary-node/S4-R2-RV/S4-R2-RV-20260921-200000/`
- **本报告未修改候选、未修改既有报告或证据、未 push / 未合并 / 未发布 / 未 amend、未启动 S5。**

---

## 0. 一句话结论

**三项原阻断的「实质」均已真正闭合**（日志确已入库且内容真实；范围核验的结论经我独立复算成立；lint 三树差分经我独立复算与声明逐项吻合），**`root` 依赖测试具有真实判别力**（隔离负控证明其观测的是 `root` 的**值**，非回调重建或 mock 次数）。**但候选不可判定 ACCEPT**，因为：**提交结构与自身回执、自身复算配方三处互相矛盾（1 条提交 vs 「四条」/「三条」/「期望三条」），且候选树内仍留存一份「按文档照做即产出错误结论」的验核配方，外加两个会覆盖既有已跟踪证据的工具缺陷。** 详见 §7 阻断项。

按任务书 §7「有任一项不成立即 BLOCK」，判定 **BLOCK**。

---

## 1. 冻结与范围

### 1.1 提交关系（**与任务书/回执自述不一致，见 finding F-06**）

| 项 | 实测 |
|---|---|
| `7322575..ceb0573` 提交数 | **1**（不是「四条」，也不是「三条」） |
| 候选完整 SHA | `ceb0573f409259010be6f2073fd5b225bd084335` |
| 候选 tree | `f8a229c45a19593e4912472bafc31cacb14f097f` |
| 候选父提交 | `732257500f6f6b9d2a8f39d67a37b4ebf836e793`（**父即基线**，单父、线性） |
| `git merge-base --is-ancestor 7322575 ceb0573` | 成立 |
| 分支可达 | `codex/summary-node-s4-r2-20260921` → `ceb0573` |
| 远端可达 | `git branch -r --contains ceb0573` → **0**（未 push） |
| 主工作树 HEAD | `a2ce72bf122574815bf1b9134253a7bd0349c038`（复核全程未变） |

**关键事实**：候选是**一个被压平的单一提交**，其父**就是**基线 `7322575`。
这意味着回执中描述的「`6a384d3` / `09aaa60` / `a43b99d` / 回执提交」四提交序列在候选上**已不存在**——
那些 SHA 仍作为**悬空对象**可被解析（我验证 `6a384d3` 仍能 `git cat-file -t` → `commit`，且是候选的祖先），
但它们**不是候选的提交链**。`6a384d3^{tree}` = `3d3b8cda7c6282d6e79d2d5fb8127421c5b8fb14` 与回执一致，可作代码候选 tree 引用。

### 1.2 候选相对基线的完整文件集合（16 项，`git diff --raw --no-abbrev`）

| 状态 | 文件 | numstat (+\-) | 类别 |
|---|---|---|---|
| M | `.gitignore` | 6/0 | 工具/配置 |
| A | `apps/canvas/tests/useExportActions.test.tsx` | 70/0 | **测试** |
| M | `docs/dispatch/2026-09-21-summary-node-s4-r2-report.md` | 101/19 | 文档 |
| M | `docs/dispatch/2026-09-21-summary-node-s4-report.md` | 13/4 | 文档 |
| M | `outputs/.../S4-R2-.../evidence-index.md` | 1/1 | 证据 |
| M | `outputs/.../S4-R2-.../gates/lint-diff-raw.json` | 431/172 | 证据 |
| M | `outputs/.../S4-R2-.../gates/lint-fix.md` | 9/3 | 证据 |
| M | `outputs/.../S4-R2-.../manifest.txt` | 22/16 | 证据 |
| A | `outputs/.../S4-R2-.../negctl/neg1-unmount.log` | 69/0 | 证据（日志） |
| A | `outputs/.../S4-R2-.../negctl/neg2-order.log` | 67/0 | 证据（日志） |
| A | `outputs/.../S4-R2-.../negctl/neg3-rootbox.log` | 71/0 | 证据（日志） |
| A | `outputs/.../S4-R2-.../negctl/neg4-nofilter.log` | 72/0 | 证据（日志） |
| A | `outputs/.../S4-R2-.../negctl/run.log` | 2/0 | 证据（日志） |
| M | `packages/react/tests/summary-export-svg.test.ts` | 4/1 | **测试** |
| A | `tools/rebuild-lint-diff.mjs` | 160/0 | 工具 |

**分类结论**：
- **产品源码行为改动 = 0**（见 1.3，独立 diff 判定成立）。
- **产品源码注释改动 = 1**（`packages/react/src/chrome/exportSvg.ts`，**不在 `7322575..ceb0573` 范围内**——它在
  代码候选 `6a384d3` **之后**被改；候选已压平，故该改动已并入候选 tree。见 1.4。）
- 测试改动 = 2 文件（1 个新增用例文件 + 1 个注释更正），工具 1 新增，文档 2，证据 8。
- **无无关产品逻辑、无阈值/规则（`biome.json` 零改动）、无锁文件（`pnpm-lock.yaml` 未动）、无生成产物被夹带。**

### 1.3 「代码行为零改动」的 diff 分类证明

- **误导性 glob 复现（阻断 2 的根因，任务书要求记录）**：
  ```bash
  git diff --name-only 905c053 5cc0720 -- 'packages/*/src'   # → 0 条
  git diff --name-only 905c053 5cc0720 -- 'packages/*/src/**' # → 16 条
  ```
  在**已知含 16 处 `packages/*/src` 真实改动**的区间（S1→S4）上，`'packages/*/src'` **仍返回 0**。
  证明它**不是「恰好为空」，而是结构性不匹配**（git pathspec 的 `*` 不跨 `/`）。
  回执对此的根因说明（§一「核验命令自纠」）**正确**。
- **递归路径规则重新核对全部产品源码差异**：
  ```bash
  git diff --name-status 7322575 ceb0573 -- 'packages/*/src/**' 'apps/*/src/**' → 空（0 文件）
  ```
  另用 `git ls-tree -r` 逐树比对 `packages/react/src`：基线 139 文件 / 候选 139 文件，一致。

### 1.4 `exportSvg.ts` 确为注释/口径修正（**已验证**）

`git diff 6a384d3 ceb0573 -- packages/react/src/chrome/exportSvg.ts` → numstat **6/1**，逐行全部为 `//` 注释。

**独立 token 级核验**（剥离 `/* */` 与 `//` 后比对非注释字符）：

| rev | 非注释字符数 | sha256(前16) |
|---|---|---|
| `6a384d3` | 5641 | `35688be7bdc85726` |
| `ceb0573` | 5641 | `35688be7bdc85726` |

**非注释 token 与运行行为均未改变**，结论成立。

### 1.5 `.gitignore` 两个例外（**原判 F-03 系误报，特此更正**）

新增 6 行：说明注释 + `!outputs/**/negctl/*.log` + `!outputs/**/gates/*.log`。

**⚠️ 更正声明（本报告首版的 F-03 结论已作废）**：首版据 `git check-ignore -v` 的输出判定
「两个放行规则未产生预期效果」，并把该行文本读作「仍被忽略」。**该读法是错的**：
`git check-ignore -v` 打印的是**最后匹配到的规则**，命中 `!` 开头（否定）的规则时，
输出同样带路径 —— 它表示**未被忽略**，而非被忽略。

**权威复测（以 `git add` 的真实行为为准，不以 `check-ignore` 文本为准）**：

| 测试 | 命令 | 结果 |
|---|---|---|
| 放行规则命中 | `git check-ignore -v --no-index outputs/…/negctl/_probe.log` | 输出 `.gitignore:13:!outputs/**/negctl/*.log …` → **命中否定 = 未被忽略** |
| **实际能否入库** | `git add --dry-run outputs/…/negctl/_probe.log` | `add 'outputs/…/negctl/_probe.log'` → **无需 `-f` 即被 staged** |
| 索引状态 | `git status --porcelain --ignored=matching -- <该文件>` | `?? …negctl/_probe.log` → **untracked（非 ignored）** |

**结论**：两条例外**确实生效**，本仓没有任何上层目录被忽略，故否定规则可直接生效；
`!outputs/**/negctl/*.log` 已覆盖 outputs/ 下任意深度的 `negctl/`，无需逐层放开父目录。
**F-03 撤回**（不计入阻断，也不计入缺陷）。

（探针文件已删除，目录 `git status` 复归干净。）

**本轮对该注释做了一处增强**（非必需，仅为防止后人重犯我这次的误读）：
注释里补上「`git check-ignore -v` 打印最后匹配规则，命中 `!` 即未被忽略」与
「以 `git add --dry-run` 为准」的验证方法。

> **注**：§7.2 的 B-3 与 F-03 无关；B-3（两个工具覆盖旧证据）经复测**依然成立**。

### 1.6 无意外纳入其他历史日志或大文件（**已验证**）

| 检查 | 结果 |
|---|---|
| 提交内全部 `*.log` | **恰 5 个**，全部位于 `outputs/summary-node/S4-R2/S4-R2-20260921-160000/negctl/`，最大 4134 B |
| 提交内 `negctl/` + `gates/` 全部文件 | 8 个（见 §1.2），无多余 |
| 主工作树中被忽略的 `*.log` | 40+ 个散落根目录（`a3-*.log`、`a4-*.log`、`_tmp_*.log` 等）—— **一个都未被纳入**，放行规则未意外扩大范围 |
| `outputs/` 下最大的已跟踪文件 | 145754 B（`S4/.../browser/a1-menu.png`），**未夹带大文件** |

---

## 2. 阻断 1：日志是否真正入库（**实质闭合**）

### 2.1 在候选提交对象上核验（`git ls-tree -r ceb0573`）

```
100644 blob 118efd1f63a0964053374f71ba8da5a1a78cc4f8   3337  .../negctl/neg1-unmount.log
100644 blob 8356072c5c5721edaa9b7e7016d80ef946474d59   3789  .../negctl/neg2-order.log
100644 blob a37d5e900e7012a40b7403ba66e8bf8c9f047624   4134  .../negctl/neg3-rootbox.log
100644 blob c439566d294d492e1df3252fb5c22c235823df36   3753  .../negctl/neg4-nofilter.log
100644 blob dc49708b60ca981ab2794cf05d0eaf5a41401d48   5823  .../negctl/run-negctl.sh
100644 blob 16b3515f0d2ee1b35dd4186c96a000e8f89e7e57    105  .../negctl/run.log
```

`neg1`–`neg4` + `run.log` **全部在提交中**，路径/数量/文件名与 `evidence-index.md` §1 **完全一致**。
另注：`run-negctl.sh`（驱动脚本）也一并入库，索引 §1 已列。

### 2.2 全新检出后仍可读取（**已验证**）

我并非查看施工现场，而是从**候选完整 SHA 新建 detached worktree**（`git worktree add --detach ... ceb0573`），
并在其中完成构建、测试与全部复算。日志内容通过 `git show ceb0573:<path>` 读取自提交对象本身。

### 2.3 逐份核对日志内容与回执引用（**逐项吻合**）

| # | 日志 | 正常副本先绿 | 重建 dist | 真实退出码 | 红测构成 | 红因 |
|---|---|---|---|---|---|---|
| 1 | `neg1-unmount` | `GREEN_EXIT_CODE=0` / 6 passed | 4×Done | **1** | 5 failed / 1 passed | `Error: 测试前置缺失：括线 d`（`req()` 守卫） |
| 2 | `neg2-order` | `GREEN_EXIT_CODE=0` / 6 passed | 4×Done | **1** | 1 failed / 5 passed | `AssertionError: summaries 必须在 tree-links 之前: expected 2 to be less than 0` |
| 3 | `neg3-rootbox` | `GREEN_EXIT_CODE=0` / 18 passed | 4×Done | **1** | 1 failed / 17 passed | `AssertionError: 带右沿必须覆盖成员的子树…: expected 378 to be greater than or equal to 541.999999` |
| 4 | `neg4-nofilter` | `GREEN_EXIT_CODE=0` / 18 passed | 4×Done | **1** | 2 failed / 16 passed | `AssertionError: 摘除判定只能来自 satellites（单一事实源）: expected [ { …(10) } ] to have a length of +0 but got 1` |

与回执 §四表格**逐字一致**（含每组的 passed/failed 计数与断言原文）。

### 2.4 无作弊迹象（**任务书点名的全部模式，实测 0 命中**）

| 模式 | 命中数（neg1–neg4 合并） |
|---|---|
| `Cannot find module` | **0** |
| `Invalid hook call` | **0** |
| `ReferenceError` | **0** |
| `it.fails` | **0** |
| `.skip(` / `describe.skip` | **0** |
| `catch` 后报 PASS | **0** |
| 反转断言（`expect(...).not.`） | **0** |

四组均「正常副本先绿 → 变异后真实非零」，符合要求。

### 2.5 neg4：目标断言 vs 同前提邻居（**区分正确**）

`neg4` 的 2 条红测中：
- `summary-frames.test.ts:572`「摘除判定只能来自 satellites（单一事实源）」= **✅ 目标断言**
- `summary-frames.test.ts:437`「无 satellites → 不产出 view（括线以卫星为锚）」= **❌ 同前提下的邻居用例**

回执 §四「neg4 的 2 条红测：红因归属」表**已正确区分**，与实跑一致。

### 2.6 日志的独立复现（**我已重跑，非只读日志**）

我在复核 worktree 内**重跑了四组阴性对照**（把驱动的 `ROOT`/`OUT` 改指向复核 worktree 与本轮证据目录，
候选脚本未改），结果：**四组 `REAL_EXIT_CODE=1`，全部复现**，红因与上表同。

### 2.7 阻断 1 的诚实限制（**不推翻结论，但须记录，见 F-04**）

四份已入库日志的「## 5. 还原」段**内嵌了施工 worktree 的 `git diff --stat`**，其中出现：
- `packages/react/tests/summary-export-svg.test.ts | 5 +-`
- `.../negctl/run.log | 3 +-`
- 文件名与 `ceb0573..HEAD` 之间的一处差异吻合。

即：**日志生成时刻（18:25）早于候选提交时刻（18:27:59）**，日志记录的是**未压平前的四提交状态**。
该 `git diff --stat` 是**旁路输出**（`eval "$restore"` 的副作用），**不构成对负控有效性的假证**——
四组的 `GREEN_EXIT_CODE` / `REAL_EXIT_CODE` / 断言原文我均已独立复现。
**结论：阻断 1 实质闭合**，但日志与其所声称的「候选」之间存在一次**未在回执中说明的压平操作**（见 F-06）。

---

## 3. 阻断 2：范围核验是否可信（**结论成立，但候选树内配方仍错，见 F-07**）

### 3.1 复跑旧 glob，记录误导原因 —— 见 §1.3。
**根因已定性**：`'packages/*/src'` 结构性不匹配（`*` 不跨 `/`），在**已知有 16 处改动**的区间上仍返回 0。
回执 §一「核验命令自纠（S4-R2 复核 finding high）」的说明**正确**，并给出了正确写法 `'packages/**/src/**'`。

### 3.2 递归规则重新核对全部产品源码差异（**我已独立复算**）

```bash
git diff --name-status 7322575 ceb0573 -- 'packages/*/src/**' 'apps/*/src/**'   # 空
```
且 `exportSvg.ts` 的注释改动在**被正确召回**后仍判为**非行为改动**（§1.4 token 级核验）。
**「代码候选之后零改生产源码行为」成立。**

### 3.3 文档是否已把表述写准（**报告正文已改对，但 §3.4 另有残留**）

| 回执 §三 宣称的修正 | 实测 |
|---|---|
| lint 数字统一为 S1 1541 / 修复前 1544 / 修复后 1541 | ✅ `S4/.../gates/lint-delta.md`、`final.md` 均已更正 |
| 「框边界」导出层删除（协议 §6.5 / CHANGELOG / `exportSvg.ts` 注释 / `summary-export-svg.test.ts` 四处） | ✅ **四处全部**已验证更正 |
| neg4 引用口径改为「2 红中仅 1 条是目标断言」 | ✅ `s4-report.md` 已改 |
| manifest 非自指 | ✅ `S4-R2/.../manifest.txt` 已改 |

### 3.4 已知残留逐项核对（**任务书点名的五项**）

| 项 | 任务书要求 | 实测 |
|---|---|---|
| 不再写「三提交」 | 删除 | ❌ **`docs/dispatch/2026-09-21-summary-node-s4-r2-report.md:60` 仍写「三条提交均满足…」** —— 而候选**已压平为 1 条**（F-06） |
| 不再写「只有两个改动文件」 | 删除 | ✅ 全仓搜索 `只有两个` / `两个改动` / `两个文件改动` / `仅两个` / `两个生产文件` / `2 ?个改动文件` → **0 命中**（`仅两个` 唯一命中在 `outputs/2026-09-14-node-card-p1-report.md:1`，与本主题无关） |
| S4 lint 真值为 1544 | 写对 | ✅ `s4-report.md:284,291`、`S4/.../lint-delta.md`、`final.md` 均写 1544；且**我已独立复算确认 S4 = 1544**（§4） |
| 不再宣称 SVG 导出存在「框边界」层 | 删除 | ✅ `CHANGELOG.md:48`、协议 §6.5（`docs/specs/2026-09-02-mm-md-protocol.md:450-451`）、`summary-export-svg.test.ts` 均改为「导出**不画框边界**」；`exportSvg.ts` 注释已改 |

### 3.5 全仓搜索旧错误表述（**不只抽查点名文件**）

我按 `三提交|三条提交|3 ?条提交|三个提交`、`框边界`、`只有两个|两个改动|仅两个|两个生产文件`、`1544`
四组模式对 `ceb0573` 的 `docs outputs tools CHANGELOG.md README.md` 做了全仓搜索：

- `框边界`：7 处命中，**全部为更正后的正确表述**（3 处「导出不画框边界」+ 1 处回执说明 + 3 处索引/追溯表），**无残留错误表述**。
- `只有两个`/`两个改动`/`两个生产文件`：**0 命中**。
- `1544`：14 处命中，**全部为正确用法**（「修复前 1544」或 S2 历史的独立读数），**无「S4 = 1543」类残留**。
- `三提交`/`三条提交`：8 文件命中，其中 **7 处属 S3/beam 的历史报告（与 S4-R2 无关，命中合理）**；
  **1 处属本候选**（`s4-r2-report.md:60`，见 §3.4 与 F-06）。

---

## 4. 阻断 3：lint 证据链（**独立复算完全吻合**）

### 4.1 方法

**未采信**候选的新 JSON 或重建脚本。我从候选完整 SHA 另建 detached worktree，
对三个提交各自**独立运行同一版本 Biome（2.5.11，取自复核 worktree 的 `node_modules`）**、
同一命令：`biome lint packages apps --reporter=json`。

### 4.2 汇总读数（**与声明逐项吻合**）

| 提交 | 完整 SHA | warnings | infos | errors | 声明 | 一致 |
|---|---|---|---|---|---|---|
| S1 | `905c053fe396d1fbbc4d663bf4247b0853bffcec` | **1541** | **48** | 0 | 1541 / 48 | ✅ |
| S4 | `5cc072008dd5cf1278d3e7cdb735535fcf0697f1` | **1544** | **48** | 0 | 1544 / 48 | ✅ |
| 候选 | `ceb0573f409259010be6f2073fd5b225bd084335` | **1541** | **48** | 0 | 1541 / 48 | ✅ |

（另经 `summary` 字段核对：S1 `warnings:1541,infos:48`；S4 `1544,48`；候选 `1541,48`。三树 exit 均为 0。）

### 4.3 集合差分（≥2 种键）

**键 `file|category`**：

| 配对 | added | removed |
|---|---|---|
| S1 → S4 | **2**（`apps/canvas/src/hooks/useExportActions.ts` ×1、`packages/react/src/render/MapView.tsx` ×2） | 0 |
| S4 → 候选 | 0 | **2**（同一组，同一计数） |
| **S1 → 候选** | **0** | **0** → **净新增 0** ✅ |

**键 `file|category|message`**：

| 配对 | added | removed |
|---|---|---|
| S1 → S4 | **3** | 0 |
| S4 → 候选 | 0 | **3** |
| **S1 → 候选** | **0** | **0** → **净新增 0** ✅ |

**S1 → S4 净新增的 3 条（键含 message，与回执 §二归因表逐条一致）**：
1. `apps/canvas/src/hooks/useExportActions.ts` · `useExhaustiveDependencies` · **This hook does not specify its dependency on root.**
2. `packages/react/src/render/MapView.tsx` · `useExhaustiveDependencies` · **This hook does not specify its dependency on renderBoxOf.**
3. `packages/react/src/render/MapView.tsx` · `useExhaustiveDependencies` · **This hook specifies more dependencies than necessary: animBoxes, centerPreview.**

**S4 → 候选净减少的正是同一条目三条 message**（逐字相同）。
故 **S1 → S4 净新增 3；S4 → 候选净减少同一组 3；S1 → 候选净新增 0** —— 任务书四项要求**全部成立**。

### 4.4 一处方法学提醒（**非阻断**）

`file|line|category` 键在 S1→候选上给出 37/37 的「非零」。这**不是缺陷**：行号随代码变动本就漂移，
该键不适合跨树比对。任务书点名的两种键（`file|category`、`file|category|message`）**均为净零**。

### 4.5 `tools/rebuild-lint-diff.mjs` 审查（**5 项要求中 4 项不满足，见 F-08~F-11**）

| 任务书要求 | 实测 | 结论 |
|---|---|---|
| 基准 SHA、命令、工具版本、结果字段正确 | `S1 = 0fa0f9df…`（**注意：脚本用的是 `0fa0f9d`，而任务书点名 S1 为 `905c053`**，两者是不同提交）、`S4C = 5cc0720…`；命令含 `--max-diagnostics=3000`（与 `evidence-index.md` §3 记载的命令**不一致**）；工具版本**未记录** | ⚠️ 部分 |
| **不依赖调用者现有 worktree 状态** | ❌ **硬编码绝对路径** `<local-path>`、`…/mindcanvas-s4-S4-20260921-160000`，且**只判目录是否存在、不校验其 HEAD 是否为目标 SHA** | **否（F-09）** |
| **不覆盖旧证据** | ❌ `OUT` 写死为 `outputs/summary-node/S4-R2/S4-R2-20260921-160000/gates/lint-diff-raw.json`（**旧的、已跟踪的**证据文件），**无任何存在性/覆盖防护** | **否（F-08）** |
| **临时 worktree 成功与失败路径均能清理** | ❌ 脚本**只创建、从不 remove**；全文**无 `try/catch`、无 `finally`、无 `rmSync`** | **否（F-10）** |
| 脚本输出与独立复算逐项一致 | 其 `totals`/`pairs` 语义与我的独立复算一致（三对差分、净零） | ✅ |
| （环境依赖须如实说明） | ⚠️ 脚本对缺失的 `node_modules` **建立 junction 软链**到主仓（即**共享 `node_modules`**），且不清理 | **须声明（F-11）** |

**环境依赖如实说明**：上述 4 项失败**均为脚本自身缺陷，非环境失败**，故**不计为候选失败而是记为工具缺陷**。
我的独立复算**未使用该脚本**，也未共享任何 `node_modules`（在复核 worktree 内 `pnpm install --frozen-lockfile`，离线复用 store）。**全程无需联网**（`pnpm install` 输出 `downloaded 0`）。

---

## 5. `root` 依赖判别测试（**具有真实判别力，任务书五项全满足**）

### 5.1 用例内容核验（`apps/canvas/tests/useExportActions.test.tsx` 新增 1 例）

| 任务书要求 | 实测 |
|---|---|
| 首次渲染使用 root A | ✅ `initialProps: { r: rootA }`，且先断言 `exportSvg`/`exportPng` 均收到 `rootA` |
| rerender 后换成**可明确区分**的 root B | ✅ `rootA = {id:'A'}` / `rootB = {id:'B'}`，`rerender({ r: rootB })`，其余 props 引用不变 |
| 调用的是 **rerender 后保留的** `handleExportPng` | ✅ 在 rerender 之后调用 `result.current.handleExportPng()` |
| 断言观察到 **B 的结果**，而非回调重建 / mock 次数 | ✅ 断言 `expect(vi.mocked(exportPng)).toHaveBeenLastCalledWith(layout, token, expect.objectContaining({ root: rootB }))` —— 观测**实参值** |
| 正常候选必须通过 | ✅ `5 passed (5)`（`useExportActions.test.tsx`） |

### 5.2 隔离负控（**只删 deps 内的 `root`**）

在**隔离副本**中仅从 `handleExportPng` 的 deps 数组删除 `root`（其余一律不动）：

```
GREEN_EXIT_CODE=0      Tests  5 passed (5)        ← 未变异先绿
REAL_EXIT_CODE=1                                  ← 变异后真实非零
  ✓ tainted：onNotice 收到「含外部图片」文案…      ← 其余四例保持通过
  ✓ unsupported：…                                
  ✓ 未注入 onNotice → 静默降级…                    
  ✓ 同 layout、换 boundaryLinks → 收到新值…        
  × root 换代后 handleExport / handleExportPng 均使用新 root（缺 root 依赖即红）
  Tests  1 failed | 4 passed (5)                  ← 恰好目标一例转红
```

**失败原文（决定性证据）**：

```
AssertionError: expected last "vi.fn()" call to have been called with [ {}, {}, ObjectContaining{…} ]
- Expected           + Received
    "root": {            "root": {
-     "id": "B",           "id": "A",     ← 收到的是旧 rootA，正是「deps 漏 root」的症状
```

**该用例观测的是 `root` 的值（收到 A 而非 B），不是回调重建或 mock 调用次数**——
判别力真实。另：**测试期望在负控中未被修改**（我未改动测试文件，仅改生产 `deps`）。

### 5.3 计数解释（**已验证**）

| 包 | 实跑 | 回执声称 | 一致 |
|---|---|---|---|
| kernel | **708 passed**（75 files） | 708 | ✅ |
| react | **1636 passed**（161 files） | 1636 | ✅ |
| canvas | **396 passed**（47 files） | 395 → **396（+1）** | ✅ |

canvas 由 395 → 396 的 **+1** 正是本轮新增的 `root` 用例；kernel 与 react 数量未变。
react/kernel 数量不变、canvas 恰 +1 —— **解释成立**。

---

## 6. 完整验证（**全部确定性门禁通过**）

在候选完整 SHA 的 detached worktree 内独立重建并运行：

| 门禁 | 命令 | 真实退出码 | 实测 |
|---|---|---|---|
| build | `pnpm -r build` | **0** | 4× Done |
| typecheck | `pnpm typecheck` | **0** | 4× Done |
| depcruise | `pnpm depcruise` | **0** | ✔ no dependency violations (565 modules, 1694 dependencies) |
| lint | `biome lint packages apps` | **0** | **1541 warnings / 48 infos** |
| budget | `pnpm budget` | **0** | ✅ 全部指标在预算内（债务未增长） |
| kernel 全包 | `npx vitest run` | **0** | 75 files / **708 passed** |
| react 全包 | `npx vitest run` | **0** | 161 files / **1636 passed** |
| canvas 全包（首跑） | `npx vitest run` | **1** | 1 failed / 395 passed — **已知抖动**，见下 |
| canvas 全包（复跑） | `npx vitest run` | **0** | 47 files / **396 passed** |
| 定向（`useExportActions`） | `vitest run tests/useExportActions.test.tsx` | **0** | 5 passed |
| 定向（摘要三件套） | `vitest run summary-*` | **0** | 3 files / **34 passed** |
| `prod-build-isolation` **无产物红** | 移走 `dist` 后跑 | **1** | 2 failed（`expect(files.length, MISSING_DIST).toBeGreaterThan(0)`） |
| `prod-build-isolation` **有产物绿** | `pnpm -r build` 后跑 | **0** | 2 passed |
| 四组阴性对照 | 复核 worktree 内重跑 | — | 四组 `REAL_EXIT_CODE=1`，红因为目标断言 |
| `verify-summary.mjs` | 对候选构建产物 | **0** | **43 项断言全绿 / 0 失败** |

**canvas 首跑失败的诚实说明**：失败用例为 `tests/mode-guard.test.tsx > 导图离开保护 > 导图有未保存编辑…`
（`expect(saveState(container)).toContain('未保存')` 收到 `'✓ 已保存'`）。
我**单独重跑该文件 3 次全部通过**（3× `11 passed`），**全量复跑亦通过**。
这正是候选 `evidence-index.md` §5 第 4 条**已如实披露的既有抖动**（「既有问题，非 S4/R2 引入；本轮全量实跑未复现，
**不宣称已消除**」）。故**计为已知抖动，不构成新阻断**，但**回执「canvas 396 全绿」的可复现性有一个已知例外**，
读者须知该例外在独立环境**可复现**（我遇到了 1 次）。

### 6.1 浏览器验收（**独立证明加载的是当前候选产物**）

强制要求逐项：

| 要求 | 实测 |
|---|---|
| 加载 bundle 名与当前候选 `dist/index.html` 一致 | ✅ 三者一致：`index.html` = `main-D5XK-LFM.js`；HTTP 服务返回 = `main-D5XK-LFM.js`；记录 = `loadedBundle=main-D5XK-LFM.js` |
| 文件字节或哈希与磁盘构建产物一致 | ✅ **SHA-256 逐字相同** `37e1919bf0e590ad2fcb77efd6e4f1042112a47bdb002d52ba435eea999ccf22`，450768 B（磁盘 = 服务） |
| 没有复用旧端口上的服务 | ✅ 事先确认 **5188 空闲**，新起 `vite preview --port 5188 --strictPort`（前置探测返回 `HTTP 200` 且 `src="/assets/main-D5XK-LFM.js"`）；验收后按 PID `taskkill` 终止，端口已释放 |
| 新截图与日志写入本轮目录，未覆盖 S4/S4-R2 已跟踪证据 | ✅ 全部写入 `.../S4-R2-RV/S4-R2-RV-20260921-200000/browser/`；**复核结束时对 `outputs/summary-node/S4/...` 与 `.../S4-R2/...` 的 `git status` 改动数 = 0** |

**方法学说明（必须披露）**：`tools/verify-summary.mjs:29` 将输出目录**硬编码**为**旧的 S4 目录**，
且**完全不读 `S4_SHOTS`**（全文**无 `process.env`**）——即 `evidence-index.md` §3 记载的
`S4_SHOTS="...S4-R2/.../browser" node tools/verify-summary.mjs …` **不会生效**，
照做会**覆盖已跟踪的 S4 证据**。
为**不触碰旧证据**，我在**独立副本**中把该行改为 `process.env.REVIEW_SHOTS ?? '<原值>'` 后运行；
**候选树内该文件保持原样**（复核结束时复核 worktree `dirty=0`）。见 **F-13**。

### 6.2 测试/脚本是否写死旧 S4 目录（**任务书 §6 明确要求**）

| 文件 | 写死内容 | 会否覆盖旧证据 |
|---|---|---|
| `tools/verify-summary.mjs:29` | `const SHOTS = 'outputs/summary-node/S4/S4-20260921-160000/browser';` | **会**（且文档给的 `S4_SHOTS` 开关**不存在**）→ **F-13** |
| `tools/rebuild-lint-diff.mjs:20` | `const OUT = path.join(ROOT, 'outputs/summary-node/S4-R2/S4-R2-20260921-160000/gates/lint-diff-raw.json');` | **会**（无覆盖防护）→ **F-08** |
| `packages/react/src/render/summaryFrames.ts:24` | 注释中引用旧证据路径 | 否（仅注释） |

**是否有「当前复核运行已造成覆盖」**：**否**。我在运行前即发现该硬编码，并改用独立副本 + 环境变量，
故**本轮复核未覆盖任何已跟踪证据**，无需 restore。**如实记为 S5 必须处理的明确欠账**（F-08 / F-13）。

---

## 7. 判定

### 7.1 ACCEPT 条件逐项核对

| 条件 | 结果 |
|---|---|
| 三项原阻断均在候选提交对象内闭环 | **实质闭合**（§2/§3/§4），但**文档与工具侧仍有 3 项未闭环**（F-06/F-07/F-08） |
| `root` 依赖测试具有真实判别力 | ✅ **成立**（§5.2，负控收到 A 而非 B） |
| lint 三树独立复算吻合 | ✅ **成立**（§4，两键均净零，3 条 message 逐字吻合） |
| 所有确定性门禁通过 | ✅ **成立**（build/typecheck/depcruise/lint/budget/测试/负控/浏览器） |
| 候选、主工作树和旧证据均未被修改 | ✅ **成立**（复核 worktree `dirty=0`、候选 worktree `dirty=0`、主 HEAD 未变、旧证据 0 改动） |
| **没有新的 high/medium 阻断问题** | ❌ **不成立** —— 见下 |

### 7.2 阻断项（**判定 BLOCK 的唯一依据**）

#### **B-1（high）候选提交结构与自身回执、自身复算配方三重矛盾**
候选是**单一压平提交**（`7322575..ceb0573` = **1** 条，父即基线），但候选树内三处仍按「多提交」叙述：

1. `docs/dispatch/2026-09-21-summary-node-s4-r2-report.md:60` —— **「三条提交均满足『代码 / 证据文档 / 回执各自独立』的意图」**（F-06：任务书 §3 点名要求删除的「三提交」表述**仍在候选树内**）。
2. `outputs/.../S4-R2-.../evidence-index.md:92` —— 复算配方 **`git log --format='%H %P' 5cc0720..HEAD | cat   # 期望三条、线性`**，实测为 **1** 条。
3. `docs/dispatch/2026-09-21-summary-node-s4-r2-report.md` §一 —— 以「**四条**线性提交」描述提交序列，并附「条数自纠」段说明首版误写「三」。该四提交序列在候选上**不存在**。

**为何是阻断**：候选的定义就是「可被独立复现的交付物」。一份自称「四条提交 / `5cc0720..HEAD` 三条」的候选，
其实际提交结构为 1 条 —— 任何按回执核验的人都无法复现其自述。这**不是措辞问题，是候选身份问题**。

#### **B-2（high）候选树内仍留存一条「照做即错误」的验核配方**
`outputs/.../S4-R2-.../evidence-index.md` §3「复算命令」仍写：
```bash
git diff --name-only 6a384d3..HEAD -- 'packages/*/src' 'apps/*/src'   # 期望空
```
**这正是回执 §一刚刚判为无效的那条命令**（回执：「该单星通配的语义是『名为 src 的末段』，
不会展开到 `src/` 之下」）。我已实跑证明二者结论相反：**该命令返回 0，正确命令返回 `packages/react/src/chrome/exportSvg.ts`**。
即：**阻断 2 的修复只落在报告正文，没有落到证据索引的复算配方上**；独立读者照 §3 做，会重新得到「零改动」的假结论，
并永久看不到 `exportSvg.ts`。（F-07）

#### **B-3（high）两个工具会覆盖既有已跟踪证据，且 `verify-summary.mjs` 的文档化开关不存在**
- `tools/verify-summary.mjs:29` 硬编码输出到**旧 S4 目录**，且**全文无 `process.env`** —— `evidence-index.md` §3 教读者用的 `S4_SHOTS=…` **未实现**，照做会覆盖已跟踪的 S4 截图与 `bundle.txt`。（F-13）
- `tools/rebuild-lint-diff.mjs:20` 硬编码输出到**旧 S4-R2 证据文件** `gates/lint-diff-raw.json`，**无覆盖防护**。（F-08）
- 同一脚本另有：依赖调用者既有 worktree（硬编码路径、**不校验 HEAD**，F-09）、**临时 worktree 从不清理且无 `try/catch`**（F-10）、**junction 共享主仓 `node_modules` 且不清理**（F-11）。

任务书 §6 明确要求：「若仍会覆盖旧证据，即使施工时手动 restore，也应记为 **S5 必须处理的明确欠账**」。
本轮**未造成覆盖**（我绕开了），但欠账成立。

### 7.3 最小补正范围（**不直接修复**）

1. **文档（B-1、B-2）**：把 `s4-r2-report.md:60` 的「三条提交」、§一的「四条线性提交」叙述改为与候选**实际单提交**一致；把 `evidence-index.md` §3 的 `git diff … -- 'packages/*/src' 'apps/*/src'` 替换为 `'packages/*/src/**' 'apps/*/src/**'`，并把 `git log … 5cc0720..HEAD` 的「期望三条」改为实际条数。
2. **工具（B-3）**：`verify-summary.mjs` 的 `SHOTS` 改为经环境变量参数化（或明确默认指向**本轮**目录），使文档中的 `S4_SHOTS` 真正可用；`rebuild-lint-diff.mjs` 的输出路径参数化并在覆盖前做存在性防护，其临时 worktree 加 `try/finally` 清理、校验目标 worktree 的 HEAD、并如实声明其 `node_modules` 共享方式。
3. ~~**`.gitignore`（F-03，medium）**~~：**已撤回**（§1.5）——两条例外经 `git add` 实证**确实生效**，首版判读有误。

**不要求**改动生产源码、测试断言或已通过的 lint 结论 —— 那三部分经我独立复算**均已成立**。

---

## 7.4 补正后复验（S4-R2-RV2，2026-09-21 20:xx）

上列 B-1 / B-2 / B-3 已在补正提交 `1ba5d0d0d6bd3d5fe8a50ce8dfb6f3c81e0b3e34` 中修复，
并经我**从补正提交对象重新独立复验**（详见 `2026-09-21-summary-node-s4-r2-rv2-fix-receipt.md`）：

| 原阻断 | 修复内容 | 独立复验结果 |
|---|---|---|
| B-1 | 候选结构改述为**单提交**（父 = `7322575`）；`5cc0720..HEAD` 全部改为具体 SHA | `git rev-list --count 7322575..<新候选>` = 1；`grep` 残留仅剩标注为**施工期历史**的自纠条目 |
| B-2 | 复算配方改为 `'packages/*/src/**' 'apps/**/src/**'`，并把**错误写法明确标注为「不可作核验项」** | 两条命令实跑：错误写法 0 条、正确写法 1 条（`exportSvg.ts`） |
| B-3 | `verify-summary.mjs` 支持 `REVIEW_SHOTS` / `--shots=`，默认写历史目录时**告警**；`rebuild-lint-diff.mjs` 支持 `--out=`、**默认拒绝覆盖**（exit 2）、`try/finally` **两路清理**、**校验 worktree HEAD**、声明工具链与依赖 | 实跑：覆盖被拒（exit 2）；写新目录成功且**旧证据 blob 逐字不变**；成功/失败两路**均无残留 worktree 与临时目录**；输出值与我的独立复算**逐项一致**（S1 1541 / S4 1544 / 候选 1541；净 3 / 0 / −3） |
| F-03 | **撤回** | `git add --dry-run` 实证例外**生效** |

**复验后的门禁**：build / typecheck / depcruise / lint（1541/48）/ budget 全绿；
kernel 708 / react 1636 / canvas **396** 全绿；浏览器验收 exit 0（`--shots=` 路由到新目录，
旧 S4 证据聚合哈希前后**逐字相同**）。

**结论**：三项原阻断均已闭合，**判定由 BLOCK 改为 ACCEPT**（以补正提交为新候选）。

---

## 8. 最终候选标识与限制

### 8.1 最终候选（冻结值）

```
候选完整 SHA : ceb0573f409259010be6f2073fd5b225bd084335
候选 tree    : f8a229c45a19593e4912472bafc31cacb14f097f
候选父提交   : 732257500f6f6b9d2a8f39d67a37b4ebf836e793  (= 基线)
提交数(7322575..ceb0573) : 1
基线完整 SHA : 732257500f6f6b9d2a8f39d67a37b4ebf836e793
基线 tree    : df7b87e6b98e321f03cfbb1c8c4d06590db14110
代码候选     : 6a384d30f5835eb141a92cf96fc726508a542f9d / tree 3d3b8cda7c6282d6e79d2d5fb8127421c5b8fb14
分支         : codex/summary-node-s4-r2-20260921
远端可达     : 否（未 push）
```

### 8.2 真实退出码清单（复核独立实跑）

| 命令 | 退出码 |
|---|---|
| `pnpm install --frozen-lockfile --prefer-offline` | 0 |
| `pnpm -r build` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm depcruise` | 0 |
| `biome lint packages apps` | 0 |
| `pnpm budget` | 0 |
| kernel `vitest run` | 0 |
| react `vitest run` | 0 |
| canvas `vitest run`（首跑 / 复跑） | **1 / 0**（已知抖动） |
| `prod-build-isolation`（无产物 / 有产物） | **1 / 0** |
| neg1–neg4 | 各组 `GREEN=0` / `REAL=1` |
| `verify-summary.mjs` | 0 |
| `rebuild-lint-diff.mjs` | **未运行**（会覆盖旧证据，见 F-08） |

### 8.3 限制与未覆盖项（**如实列出**）

1. **`rebuild-lint-diff.mjs` 未被执行**：因其会覆盖已跟踪证据且无防护。其**结论**（三对差分、净零）已由我**用独立方法**复算并对上，但**脚本本身的可运行性未验证**。
2. **`mode-guard.test.tsx` 抖动仍存在**：我独立环境**复现到 1 次**（首跑 canvas 失败）。回执称「本轮全量实跑未复现，不宣称已消除」——**该表述诚实**，但独立复现说明抖动概率非零。
3. **浏览器验收仅 Chromium 单浏览器、单机**：未覆盖 Firefox/WebKit/移动端/真实 IME/系统文件选择器。
4. **负控日志与其所声称候选之间存在压平操作**（F-04）：日志生成于候选提交前；其 `git diff --stat` 旁路输出揭示了这一点。四组结论我已独立复现，**但日志本身不是「候选状态」的原始快照**。
5. **未覆盖 S5 范围**：最终浏览器矩阵、CHANGELOG 收尾、交付发布 —— 本轮**未启动**。
6. **`S4_SHOTS` 环境变量**：文档声称可用，**实现中不存在**（我已核实无 `process.env`）。
7. **未核验远端/CI**：无 remote 可达性检查（候选未被 push，无从核验 CI）。

### 8.4 未修改声明

- 候选提交对象、分支引用、候选 worktree：**未修改**（`dirty=0`，`codex/summary-node-s4-r2-20260921` 仍指向 `ceb0573`）。
- 主工作树：HEAD 仍为 `a2ce72bf122574815bf1b9134253a7bd0349c038`。
- 既有报告与证据（`outputs/summary-node/S4/...`、`outputs/summary-node/S4-R2/...`）：**0 处改动**。
- **未 push、未合并、未发布、未 amend、未启动 S5**；复核树内**未做任何修复**。
- 复核产生的唯一工作树：`<local-path>`（detached，保留供主控核验）；
  临时 lint worktree（3 个）与两个隔离副本已清理。

---

## 附：本轮新证清单

`outputs/summary-node/S4-R2-RV/S4-R2-RV-20260921-200000/`（47 个文件，3.2 MB）——
详见同目录 `evidence-index.md`。**本报告与全部新证据均在本轮 RunId 目录内，未触碰任何历史证据。**
