# S4-R2 最小收口回执

- **任务**：消除 S4 复核确认的 3 条真实 lint 新增，并修正与候选终态有关的证据口径。
- **基线**：S4 最终候选 `5cc072008dd5cf1278d3e7cdb735535fcf0697f1` / tree `f280fe39138e70bf23bb954d0ef64187df12e943`
- **S1 基线（lint 对照）**：`0fa0f9dfb6eecec6d47019b4efd2f7615fe9350b` / tree `6eb177324a678bb40492932f276cc0dddec918c1`
- **worktree**：`<local-path>`（独立 worktree，主工作树未动）
- **RunId**：`S4-R2-20260921-160000`
- **证据目录**：`outputs/summary-node/S4-R2/S4-R2-20260921-160000/`
- **分支**：`codex/summary-node-s4-r2-20260921`

**结果一句话**：lint 从 S4 候选的 **1544** 回到 S1 基线 **1541**（净增 **0**，阈值与规则配置未动）；
证据口径按候选终态逐条更正；未在本 worktree 复现的两个问题按任务书 §3 **从结论中删除、不做修复**；
四项阴性对照在 R2 代码上重跑仍真实转红且红因是目标断言。**未启动 S5。**

---

## 一、提交序列（**交付候选已压平为单一提交**）

**候选终态**（本节以 S4-R2-RV 复核后的实际提交对象为准）：

```
0fa0f9d (S1 基线)
   └─ … S4 十三条提交 …
        5cc0720 (S4 候选 = R2 起点)
           └─ 7322575 (R2 前置收口；= S4-R2-RV 复核基线)
                └─ ceb0573  fix(s4-r2): 修复独立复核三项阻断（证据入库 / 范围核验 / lint 差分基准）  ← 唯一候选提交
```

`ceb0573` 的**父提交即 `7322575`**（`git rev-list --count 7322575..ceb0573` = **1**），单父、线性、无合并。

**线性核验**：

```bash
git rev-list --count 7322575..ceb0573        # 期望且实测：1
git log --format='%H %P' 7322575..ceb0573    # 恰一行，父提交 = 7322575…
```

> **⚠️ 施工期四提交 → 交付候选单提交（如实说明）**：R2 施工期曾形成四条线性提交
> `6a384d3 → 09aaa60 → a43b99d → <回执提交>`。交付候选 `ceb0573` **已把这四条压平为一条**，
> 故这四条**不是**候选的提交链 —— 它们仅作为**悬空对象**仍可解析（`6a384d3` 等 SHA 仍能
> `git cat-file -t`，且是 `ceb0573` 的祖先），可用于引用「代码候选 tree」。
> **因此**：任何按「四条 / 三条提交」核验候选的读法都会失败；候选结构**只有一个提交**。
> 本回执下方涉及 `6a384d3..HEAD` 的复算命令，其语义是「**代码候选 → 候选终态**」的**内容**对照
> （该对照仍成立，因压平保留了内容），**不是**提交链核验。
>
> **施工期条数自述的历史修订（保留以便追溯，非候选终态）**：施工稿首版标题写「线性**三**提交」，
> 后因 `5cc0720..HEAD` 的范围包含回执提交自身而自纠为「**四**条」。该自纠针对的是**施工期**提交链；
> 交付候选经压平后，两者**均不等于**候选的实际提交数（**1**）。

**代码候选之后的提交不改**生产**源码**（`exportSvg.ts` 仅注释，见下）：

```bash
# 正确写法（能命中嵌套路径）。注意 -- 'packages/*/src' 在本仓库**不命中** ——
# 该单星通配的语义是「名为 src 的末段」，不会展开到 src/ 之下，见下方说明。
git diff --name-only 6a384d3..HEAD -- 'packages/**/src/**' 'apps/**/src/**'
# 期望且实测：packages/react/src/chrome/exportSvg.ts（仅注释，见下）
```

**⚠️ 该文件在代码候选之后被改（如实说明）**：`packages/react/src/chrome/exportSvg.ts`
在 `09aaa60`（**代码候选 `6a384d3` 之后**）被改，numstat **6/1**，逐行检视**全部为 `//` 注释**、
非注释语句增删 = **0**。故它不是行为改动，但「代码候选之后**零改**生产源码」这句话
**字面不成立** —— 准确表述是「代码候选之后的提交**零改生产源码的行为**」。

> **核验命令自纠（S4-R2 复核 finding high）**：本回执首版用的
> `git diff --name-only 6a384d3..HEAD -- 'packages/*/src' 'apps/*/src'` **在本仓库返回空**，
> 于是「无输出 = 零改动」的结论**空转**，恰好掩盖了上面这处 `exportSvg.ts`。
> 根因：git pathspec 里 `*` 不跨 `/`，`packages/*/src` 只能匹配「packages 下一层的、名为 src 的项」，
> 而 `src/` 之下的文件不在其展开范围内。**教训**：范围核验不能只写一个 pathspec 就信它的空输出；
> 应对照 `git diff --name-only <base>..HEAD`（无 pathspec）的全量清单逐个人工判断。

> 说明：任务书把「证据/文档修复」与「最终回执」列为两条提交。**施工期**实际拆分为三条 ——
> 因为阴性对照日志与浏览器截图是**二进制/日志类证据**（体量大、与文字口径修正无关），
> 与文档口径修正混在一提交会掩盖审阅焦点，故单列一条证据提交。
> 施工期三条均满足「代码 / 证据文档 / 回执各自独立」的**意图**（代码与证据不混），提交顺序线性、无 amend。
> **交付候选 `ceb0573` 已把施工期四条压平为单条**（见上）；故「各自独立」在候选上体现为
> **单提交内文件分组清晰**，而不再体现为多条提交。

---

## 二、代码修复（任务书 §1）

修复前实测与归因见 `outputs/summary-node/S4-R2/S4-R2-20260921-160000/gates/lint-fix.md`。摘要如下。

| # | 位置（修复前） | category | 归因 | 修法 |
|---|---|---|---|---|
| 1 | `packages/react/src/render/MapView.tsx:1015` | `lint/correctness/useExhaustiveDependencies` | `summaryViews` 闭包读 `renderBoxOf`，却在 deps 里以 `animBoxes` / `centerPreview` 代偿 —— 既漏报真实依赖，又把两个非直接依赖列为多余 | 复用同序同长的 `cullBoxes`（它就是 `layout.nodes.map(renderBoxOf(…))`，位于文件更下方），闭包不再引用 `renderBoxOf`，deps 如实声明为 `[layout, rootNode, cullBoxes]` |
| 2 | 同 #1（同一 hook 的第二条诊断） | 同上 | 同上（"specifies more dependencies than necessary: animBoxes, centerPreview"） | 同上，一并消除 |
| 3 | `apps/canvas/src/hooks/useExportActions.ts:60` | `lint/correctness/useExhaustiveDependencies` | `handleExportPng` 函数体读 `root`，deps 漏列 —— S4 提交 `327a754` 新增 `root` 参数时只补了 `handleExport`，漏了本处 | deps 补 `root`：`[layout, token, docName, onNotice, boundaryLinks, root]` |

**计数说明**：一个 hook 可同时报「漏列依赖」与「多余依赖」，故 **2 个 hook 位置 → 3 条 warning**。
这也解释了为什么 S4 原口径「只看汇总数字 1543/1541」会漏判 —— S4 复核的「不能只看汇总数字」正是此意。

### 行为等价论证

- **`MapView`**：取盒出口仍是**同一个** `renderBoxOf`。`cullBoxes` 由它以 `layout.nodes.map(renderBoxOf)` 产出，
  与 `layout.nodes` **同序同长**，故 `cullBoxes[i]` 就是第 i 个节点的动画帧盒（含 `animBoxes` + `centerPreview` 平移）
  —— 与修复前逐值等价，仅**取用位置**后移。
- **`useExportActions`**：仅补 deps 数组，回调体零改动。补 `root` 后回调身份随 `root` 变化，
  这正是正确行为 —— 修复前 `root` 变化时回调不更新，属**真实缺陷面**（导出可能用旧 root 计算括线）。

### 纪律核验（任务书「禁止规避」）

| 判据 | 实测 | 证据 |
|---|---|---|
| 未提高阈值 | `biome.json` 未改动 | `git diff --stat 5cc0720..ceb0573 -- biome.json` 无输出 |
| 未禁用规则 | 本批 diff 无任何 `biome-ignore` / `eslint-disable` 新增 | 见上表两处功能改动 |
| 未删除测试 | 未删任何断言；本轮为 `useExportActions` 的 root 依赖**新增 1 条能抓住缺陷的用例**（见 §六） | `git diff 5cc0720..ceb0573 -- apps/canvas/tests packages/react/tests` |
| 未放宽判据 | 判据仍是「集合差分净增 = 0」，与 S1 逐键对齐 | `gates/lint-diff-raw.json`（`pairs.s1_to_r2Candidate`） |

### 被否掉的两种修法（记录以免重走）

1. **把 `renderBoxOf` 改成 `useCallback`**：稳定化后 5 个消费点全部新增
   「does not specify its dependency on renderBoxOf」，**净增 > 净减**（实测更差，已回退）。
2. **在本 hook 内复制一份取盒逻辑**：重复 `centerPreview && …` 判断，新增 1 条 `useOptionalChain`，
   且分叉了取盒出口（违反「唯一出口」）。

---

## 三、证据与文档修正（任务书 §2）

| 目标 | 文档 | 修正内容 |
|---|---|---|
| lint 数字统一到实测 | `S4/…/gates/lint-delta.md`、`gates/final.md` | 统一为 **S1 1541 / 修复前 1544 / 修复后 1541**；补「原版错在哪」逐条追溯表 |
| 3 条告警逐条归因 | 同上 | 见 §二表格（hook 1 报 2 条 + hook 3 报 1 条）|
| manifest 非自指 | `S4-R2/…/manifest.txt` | 改记**代码候选 SHA + 对应 tree + 生成时点**，并显式声明「回执提交可能晚于 manifest，manifest 不包含自身」；给出 `git diff <代码候选>..HEAD` 复算命令 |
| 协议 §6.5 导出层序 | `docs/specs/2026-09-02-mm-md-protocol.md`、`CHANGELOG.md` | 按 `exportSvg.ts` / `exportPng.ts` **实际调用序**改写：背景 rect → 树线 path → boundaryLinks（虚线）→ **摘要括线** → 节点卡；**删除不存在的「框边界」导出层**；显式区分画布 DOM 层序与 SVG 导出序 |
| neg4 引用口径 | `docs/dispatch/2026-09-21-summary-node-s4-report.md` | 改为「2 红中**仅 1 条是目标断言**，另 1 条是同前提下邻居用例失败」，并注明 S4 的 `negN-*.log` 从未入库（本轮已补，见 §四） |
| 产物门禁不得静默通过 | `apps/canvas/tests/prod-build-isolation.test.ts` | 两个用例由 `if (files.length === 0) return`（静默通过）改为 `expect(files.length, MISSING_DIST).toBeGreaterThan(0)` |

**关于「框边界」**：S4 的文档与代码注释都写了导出序含「框边界」，但 `exportSvg.ts` 实际**不发射框边界**
（Section 框是画布侧 chrome）。本轮把注释与两处文档一并改正 —— 这是**文档失实**，非生产缺陷。

**另一处方向性失实**：注释声称「与画布层序一致」，但画布 DOM 序是 `sections → summaries → tree-links`
（summaries 在 tree-links **之前**），导出序却把括线写在树线**之后**，方向相反。两套契约各自成立
（画布按 z-order 自下而上；导出按「后被覆盖者后写」），本轮在注释与协议里写明，不再宣称「一致」。

### prod-build-isolation 的红/绿双向验证

| 场景 | 命令 | 实测 |
|---|---|---|
| **红**（无产物） | 临时移走 `apps/canvas/dist` 后跑该用例 | exit **1**，2 failed |
| **绿**（有产物） | `pnpm -r build` 后跑该用例 | exit **0**，2 passed |

即：产物缺失时**明确失败**，「观测口命中 0」不再能被「dist 不存在」满足。

---

## 四、阴性对照四项（R2 代码上重跑）

驱动脚本：`outputs/summary-node/S4-R2/S4-R2-20260921-160000/negctl/run-negctl.sh`
逐组日志：`negctl/neg{1..4}-*.log` + `negctl/run.log`。
**日志确实入库**（可在任意 clone 上用 `git ls-tree -r <回执提交> -- .../negctl/` 核到 5 个 `.log`）。

> **S4-R2 复核后补正（务必读）**：本回执的**首版**在这里写「本轮回执才首次入库」，
> 但当时**一个字都没有入库** —— 根因是仓库根 `.gitignore` 的 `*.log` 使
> `git add <目录>` **静默跳过**这些文件（exit 0、无任何 ignored 提示）。
> 该失实陈述已由 S4-R2 独立复核发现（finding high），并在本轮**真正修掉**：
> `.gitignore` 增加 `!outputs/**/negctl/*.log` 与 `!outputs/**/gates/*.log`，
> 入库前用 `git ls-tree` 逐个数过。**教训**：「已入库」这类关于自身产物的断言，
> 必须以 `git ls-tree` / `git status` 的**实测输出**为准，不能以「我执行了 git add」为准。

每组流程：① 正常副本先绿 → ② 中性化 → ③ **重建 dist** → ④ 跑目标测试取真实退出码 → ⑤ 还原。

| # | 中性化 | 目标测试 | 正常副本 | 中性化后 | 红测构成 | 红因（目标断言原文） |
|---|---|---|---|---|---|---|
| 1 | 删除 `<SummaryLayer>` 挂载 | `summary-layer-host.test.tsx` | exit 0（6 passed） | **exit 1** | 5 failed / 1 passed | `Error: 测试前置缺失：括线 d`（`req()` 前置守卫） |
| 2 | 摘要层挪到节点层之后 | `summary-layer-host.test.tsx` | exit 0（6 passed） | **exit 1** | 1 failed / 5 passed | `AssertionError: summaries 必须在 tree-links 之前: expected 2 to be less than 0` |
| 3 | 成员带用**自身盒**代子树并集 | `summary-frames.test.ts` | exit 0（18 passed） | **exit 1** | 1 failed / 17 passed | `AssertionError: 带右沿必须覆盖成员的子树（否则是「根盒代子树带」的阴性对照目标）: expected 378 to be greater than or equal to 541.999999` |
| 4 | 删 `satellites` 空早退（改消费 `plan.specs`） | `summary-frames.test.ts` | exit 0（18 passed） | **exit 1** | 2 failed / 16 passed | `AssertionError: 摘除判定只能来自 satellites（单一事实源）: expected [ { …(10) } ] to have a length of +0 but got 1` |

### neg4 的 2 条红测：红因归属（任务书 §2 要求精确化）

neg4 有 2 条红测，**只有 1 条是负控的目标断言**：

| 红测（文件:行） | 断言原文 | 是否负控目标 |
|---|---|---|
| `summary-frames.test.ts:572` | `摘除判定只能来自 satellites（单一事实源）` | ✅ **是**（负控目标） |
| `summary-frames.test.ts:437` | `无 satellites → 不产出 view（括线以卫星为锚）` | ❌ 否 —— 同一前提（satellites 空）下的邻居用例，**顺带**转红 |

S4 原回执只引用了其中一条，读起来像「只有 1 条红」，与实跑（2 failed）不符。本表为更正口径。

### 合规核验

- 正常副本先绿 ✓（四组 GREEN_EXIT_CODE=0）
- 中性化后**重建 dist**（四组 log §3 均见 4×`Done`）✓
- 真实非零退出 ✓（子 shell 重定向取 `$?`，不经管道）
- 红因是**目标断言**原文 ✓（neg1 为前置守卫抛错，属该用例的目标断言路径；neg2/3/4 为断言原文）
- 四组 log 中 `Cannot find module` / `Invalid hook call` / `ReferenceError` 命中数均 **0** ✓
- 无 `it.fails`、无反转断言、无 catch 报通过、无宽泛 skip ✓
- 还原后工作区干净 ✓（`git status --porcelain` 无 `M`）

---

## 五、验收门禁（R2 终态实测）

| 门禁 | 命令 | 实测 | 与 S4 候选比 |
|---|---|---|---|
| build | `pnpm -r build` | 4× `Done` | 持平 |
| typecheck | `pnpm typecheck` | 4× `Done` | 持平 |
| depcruise | `pnpm depcruise` | `✔ no dependency violations found (565 modules, 1694 dependencies cruised)` | 持平 |
| **lint** | `biome lint packages apps` | **1541 warnings + 48 infos**，exit **0** | **1544 → 1541（= S1 基线，净增 0）** |
| budget | `pnpm budget` | `✅ 全部指标在预算内（债务未增长）`；超 600 行文件 4 个，全部持平 | 持平 |
| kernel tests | `npx vitest run`（packages/kernel） | **708 passed** | 持平 |
| react tests | `npx vitest run`（packages/react） | 161 files / **1636 passed** | 持平 |
| canvas tests | `npx vitest run`（apps/canvas） | 47 files / **396 passed** | **395 → 396（+1，本轮新增的 root 用例）** |
| 定向（摘要三件套） | `vitest run summary-*` | 3 files / **34 passed** | 持平 |

> **测试计数说明（已含本轮修复）**：
> - kernel 708 / react 1636 —— 与 S4 持平，未增未删；
> - canvas **396**（S4 为 395）—— **+1** 来自本轮为 `useExportActions` 的 `root` 依赖
>   新增的 1 条用例（见 §六·补）。这是复核 finding 要求的补正：该修复此前**无任何 committed 测试钉住**。
> - `prod-build-isolation.test.ts` 的改动是**收紧**（2 个 `if (files.length === 0) return;`
>   静默通过 → `expect(...).toBeGreaterThan(0)` 明确失败），无任何断言被删。

### lint 是否真的净增 0（不只看汇总数字）

汇总数字 1541 与 S1 相同，但这**不能单独证明**净增为 0 —— 也可能是「消掉 3 条同时新增 3 条」。
故另做**集合差分**：以 `path|line|category` 为键取两工作树的诊断集合，比对新增/移除
（原始数据 `gates/lint-diff-raw.json`）。结论：**净增量 = 0**。
具体到 R2 触及的两个文件：`MapView.tsx` 与 `useExportActions.ts` 在修复后各自 **0 条**
`useExhaustiveDependencies`（修复前 `MapView.tsx` 2 条 + `useExportActions.ts` 1 条）。

> **该原始数据已在复核后重建（finding medium）**：旧文件自称与 S1 基线对齐，但
> `baseTotal/s4Total` 自述为 1541/1541、与 S4 候选实测 **1544** 矛盾，且**不含 `useExportActions`** ——
> 与 S1→S4、S1→候选、S4→候选**三种配对全不匹配**。现由 `tools/rebuild-lint-diff.mjs` 重建为
> **三对自述基准**的差分（`pairs.s1_to_s4Candidate` / `s1_to_r2Candidate` / `s4Candidate_to_r2Candidate`），
> 每对带 `baseWarnings/targetWarnings/addedCount/removedCount/netByFileCategory/nonzero`。实测：
> S1→S4 净增 **+3**、S1→候选净增 **0**、S4→候选净增 **−3** —— 结论未变，但**证据链补齐**。

---

## 六、浏览器验收（任务书 §4「重建 dist 后确认加载当前候选产物」）

命令：

```bash
# 1) 生产构建
pnpm -r build
# 2) 预览（独立端口）
cd apps/canvas && npx vite preview --port 5177 --strictPort
# 3) 验收（脚本自带「快照新鲜度」与「实际加载 bundle」双守卫）
#    ⚠️ 输出目录须显式指定，否则写入**已入库的历史 S4 证据目录**（脚本会告警提醒）。
#    正确开关是 **REVIEW_SHOTS**（或命令行 `--shots=`；`S4_SHOTS` 是首版文档的笔误，脚本从未实现）：
REVIEW_SHOTS="outputs/summary-node/S4-R2/S4-R2-20260921-160000/browser" \
  node tools/verify-summary.mjs http://localhost:5177
```

**实测：exit 0，全部通过。** 产物与加载一致性：

```
[snapshot] 产物构建于 … · 引用的入口 = main-BgdfvXm7.js
[snapshot] 页面实际加载 = main-BgdfvXm7.js
```

`browser/bundle.txt` 记录 `loadedBundle=main-BgdfvXm7.js`，与 `apps/canvas/dist/index.html` 所引入口**逐字一致**。

### 本轮踩到的真实坑（记录，因为正是上述守卫要拦的情形）

第一次实跑被守卫**拒绝**：

```
⛔ 页面加载的是旧 bundle（浏览器缓存）：期望 main-BgdfvXm7.js，实际 main-xueCbZ36.js
```

原因不是浏览器缓存，而是 **5177 端口残留了 S4 期的旧预览进程**，页面仍由旧进程提供 S4 期 bundle。
`pkill -f "vite preview"` 在 Git Bash 下**打不到 Windows 进程**，改用 `taskkill //F //PID <pid>` 才释放端口；
重启预览后页面即提供 `main-BgdfvXm7.js`，重跑通过。
—— 这说明该守卫有效：若没有它，本轮会拿**旧产物**的截图冒充「当前候选产物」的验收。

验收覆盖面（A 创建/选中、B 成员变化/降级、C 左岛方向与降级域、D 三主题×三缩放与 SVG 导出）
与 S4 一致，截图与导出件见 `browser/`。**沿用 S4 的边界声明**：系统文件选择器、真实 OS IME、
跨浏览器矩阵**仍不在本包覆盖范围**，不伪称已覆盖。

---

## 六·补、独立复核三项阻断项的**修复记录**（本轮）

S4-R2 独立复核（报告见 `docs/dispatch/2026-09-21-summary-node-s4-r2-review.md`）
判定 BLOCK，三项阻断。本轮逐项修复如下。

### 阻断 1（high）：阴性对照日志从未入库，而回执声称「已补」

| 项 | 修复 |
|---|---|
| 根因 | 仓库根 `.gitignore` 的 `*.log` 让 `git add <目录>` **静默跳过**这些文件 |
| 修法 | `.gitignore` 增加 `!outputs/**/negctl/*.log` 与 `!outputs/**/gates/*.log`（附注释说明为何需要否定规则） |
| 核实 | `git check-ignore -v` 已不再命中；`git add <negctl dir>` 真的暂存了 **5 个 `.log`** |
| 陈述更正 | 回执 §四 删去「本轮回执才首次入库」的失实表述，改为如实记录「首版确实没入库、本轮才真正补上」，并写明教训 |

**教训（已写进回执）**：「已入库」这类**关于自身产物**的断言，必须以
`git ls-tree` / `git status` 的**实测输出**为准，不能以「我执行过 git add」为准 ——
`git add` 对忽略文件的静默跳过是**没有警告**的。

### 阻断 2（high）：范围核验命令空转，掩盖第三处生产源码改动

| 项 | 修复 |
|---|---|
| 核验命令 | 回执 §一 的 `-- 'packages/*/src'` → 改为能命中的 `'packages/**/src/**'`，并**说明为何旧的写法不命中**（git pathspec 里 `*` 不跨 `/`） |
| 如实说明 | 明确写出 `packages/react/src/chrome/exportSvg.ts` 在代码候选后的 `09aaa60` 被改（numstat 6/1、非注释行 0），并**纠正表述**：「零改生产源码」→「零改生产源码的**行为**」 |
| 条数自纠 | §一 标题「线性**三**提交」→「**四**条」（`5cc0720..HEAD` 含回执提交自身） |
| 措辞更正 | `gates/lint-fix.md`「本批 diff 仅含两处功能改动」→「两处**行为**改动 + 一处**注释**改动」 |
| 残留清理 | `packages/react/tests/summary-export-svg.test.ts:7` 的「框边界」注释一并更正（这是被复核指出的第四处残留） |
| 旧数字同步 | S4 回执正文的 lint「1543」→ **1544**（经 S1/S4 两棵树上独立复算确认） |

### 阻断 3（medium）：`lint-diff-raw.json` 标注与内容不符

| 项 | 修复 |
|---|---|
| 问题 | 旧文件自称是「与 S1 基线逐键对齐」，但 `baseTotal/s4Total=1541/1541` 与 S4 候选实测 **1544** 矛盾，且**不含 `useExportActions`**；键集与 S1→S4、S1→候选、S4→候选**三种配对全不匹配** |
| 修法 | 新增 `tools/rebuild-lint-diff.mjs`，用 `git worktree` 抽 S1 与 S4 两棵树，三方各自实跑 biome，产出**三对自述清晰的差分**，每对带 `baseWarnings/targetWarnings/addedCount/removedCount/netByFileCategory/nonzero` |
| 实测 | `s1_to_s4Candidate` 净增 **+3**（正是那两条 hook）；`s1_to_r2Candidate` 净增 **0**；`s4Candidate_to_r2Candidate` 净增 **−3** |

> 说明：**结论没变**（相对 S1 净增 0），变的是**证据链被真正补上** ——
> 旧文件的读者按文档去核时根本核不动。

### 复核另指出的 medium：`useExportActions` 的 root 修复**无测试钉住**

| 项 | 修复 |
|---|---|
| 问题 | 该文件的既有用例都用 `renderHook` **只渲染一次、root 全程不变**，故「deps 漏 root」时**照样全绿**；四组负控也无一指向它 |
| 修法 | 新增 1 条用例：用 `rerender` 换 `root`（其余 props 引用不变），断言两个导出函数都收到新值 |
| **红/绿双向实证** | 正常副本 **exit 0（5 passed）**；把 `root` 从 `handleExportPng` 的 deps 去掉后 **exit 1（1 failed | 4 passed）**，红因为目标断言（另 4 条仍绿 —— 恰好证明旧用例盲区） |

---

## 七、明确不处理项（任务书 §3）

| 事项 | 决定 | 理由 |
|---|---|---|
| `collectSummaryDiagnostics` 无生产调用方 | **记录为 S1 遗留边界**，不在本包补调用链 | 任务书 §3 明令；补调用链会超出「最小收口」范围并引入新行为面 |
| 复核提到但**本 worktree 无法复现**的 `exportSvg.ts if (true)` / `__mutbak.ts` | **从 S4 结论中删除**，不做修复 | 候选 worktree 中不存在该代码；不实施「不存在于候选 worktree 的修复」 |
| 逐字等价用例被证明**判别力不足** | **不改生产逻辑**；仅在 S4 回执中如实标注相邻子串断言的**实际覆盖范围** | 用例非判别属测试强度问题，改动生产逻辑会引入未被要求的风险 |
| mode-guard 抖动 | 保留为**既有**限制（S4 已用基线复现证明非 S4 引入） | 与本次收口无关 |
| 系统文件选择器 / 真实 OS IME / 跨浏览器 | 保留为**声明边界** | 同上，不伪称覆盖 |
| S5 范围（最终浏览器矩阵、文档、CHANGELOG、交付收尾） | **未启动** | 任务书要求：独立复核 ACCEPT 后才可下发 |

---

## 八、未覆盖 / 已知限制（如实列出）

1. **`collectSummaryDiagnostics` 无生产调用方** —— S1 遗留边界，本包未补（见 §七）。
2. **mode-guard 用例据报存在抖动** —— 非 S4/R2 引入；R2 本轮全量实跑未复现，但**不因此宣称已消除**。
3. **系统文件选择器 / 真实 OS IME / 跨浏览器矩阵** —— 不在本包验收范围（浏览器验收走 `file://` + 内置 chromium）。
4. **`exportSvg.ts` 的括线与画布层序方向相反** —— 已在协议与注释中写明为两套契约；属**设计选择**而非缺陷，
   但若后续要求「导出与画布逐像素一致」需重新评估。
5. **阴性对照 neg1 的红因是前置守卫抛错**（`测试前置缺失：括线 d`），非 `AssertionError` ——
   它是该用例经 `req()` 声明的目标前置断言路径，但严格说不是「数值断言原文」，此处如实标注。
6. **`outputs/` 下的 PNG/SVG 为二进制证据**，本轮 git 提交时提示 `LF → CRLF`（文本类证据 `bundle.txt` /
   `run-negctl.sh`），不影响内容。

---

## 九、声明

- **未启动 S5**；未 push、未合并、未发布、未 amend 任何既有提交。
- 未修改主工作树、S3 worktree、S4 worktree 或任何旧提交 / 旧证据（旧证据仅在 `5cc0720..ceb0573` 中按 §3 修正口径）。
- `packages/kernel` 与 `packages/kernel/src/layout/branching.ts` 在 `5cc0720..ceb0573` 中**零改动**。
- **未重新引入** `window.__mindcanvasSummaryHost`；生产构建观测口命中仍为 **0**（`prod-build-isolation` 守卫，且已由静默通过改为产物缺失即失败）。
- **本回执为 S4-R2 的终态记录，并构成一条独立提交**；其后的提交不再改动生产代码。
- 完成后**停止，等待独立复核**。
