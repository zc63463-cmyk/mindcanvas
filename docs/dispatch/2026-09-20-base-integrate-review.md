# BASE-INTEGRATE 独立复核报告（只读）

- 复核对象：**综合基线候选** `codex/base-integrate-frozen-20260920 @ 069144603d56eee730725f848b0c2d69b0995187`
- 复核日期：2026-09-20
- 复核方式：**只读独立复核**（未修改候选、未修复、未重构、未启动 N0 / P0-D / S1–S5 / 图库）
- 实施回执：`docs/dispatch/2026-09-20-base-integrate-report.md`
- 施工证据：`outputs/base-integrate/20260920-01/`
- 独立 worktree：`<workspace>-bi-review`（`git worktree add --detach <path> 06914460…`，未依赖 `codex/*` 引用）
- 本次复核证据：`outputs/base-integrate/20260920-02-review/`（脚本、日志、退出码、旧证据哈希基线/复算）

---

## 0. 结论

**ACCEPT —— 可作为 N0 与 P0-D 的共同冻结起点。**

判定依据：固定输入齐备；候选 SHA / 父提交 / Tree / 881 条目与声明一致；来源闭包从上游材料**独立复推导**无差异（候选集合恰 841、无未归属）；P0-0 13 文件在**提交内**逐件 blob == `3cdcdc3d`（13/13）；`index.ts` 集成块准确且公共消费通过（50/50）；`pnpm gate` / `build` / `analyze` 全部退出 0（budget 全绿，阈值与门禁配置 byte-equal 未被放宽）；NC 负控 8/8 真实非零且红因全为目标 AssertionError（环境错误 0）、NC-5 三入口 0/1/0/1；四组既有浏览器验收成立且**浏览器加载产物字节 == 本次复核构建产物**；补跑的 P0-0 真实 IndexedDB 十项 **10/10 PASS**；候选工作树（复核树与原施工树）结束时均无 tracked 改动；**无 Critical / Important 发现**。

---

## 1. Findings（按严重程度）

**Critical：无。Important：无。**

### Minor / 观察项（可 ACCEPT 后单列；不修改原候选）

| # | 事项 | 证据 | 判定 |
|---|---|---|---|
| M-1 | **行尾呈现口径**：从冻结提交**新检出**后，808 来源的 801 件中 198 件的**字节** sha256 与"808 验收字节"不同——逐件深挖证明**全部为 LF→CRLF 呈现差异**（git `core.autocrlf=true` 检出转换）：内容（git blob 归一化）与 808 验收载体一致、可逆转换后与声明逐字节相等、0 件内容差异。施工回执"复制完整性 841/841 sha256 == 主工作树源"在候选**工作树（复制物）**上成立；"801 件保持验收字节"应按**内容（blob）口径**理解 | `recompute/eol-deep-dive.json`（byte-equal 603 / eol-only 198 / P0-OVERRIDE 6 / suspicious 0） | 口径澄清，非缺陷；建议后续交接注明"内容核验用 blob 口径" |
| M-2 | **P0-0 覆盖后的 detach 语义变化（契约内）**：原 808 版 `deleteDirectoryHandle()` 总是尝试删裸键；P0-0 版 `detach()` 改为 `writeWorkspaceRegistry(markDormant, {kind:'delete'})`，注册表 **unavailable / corrupt 时不写任何键**（"不覆盖损坏库"契约）→ 该情形下裸键保留。有正式测试覆盖（`directory-host.test.ts`「R1：detach 把 active 置 dormant、不删条目，且同事务删除裸键」；`handle-store.test.ts`「R1：detach 原子」） | `codereview/diff-directoryHost.diff`；测试定位 | 属 P0-0 已验收设计（G0 v5.1 + NC-3/NC-4），非集成回归；如实记录供上层知道语义 |
| M-3 | **施工过程记录**：复核首次跑完整 gate 时因 Git Bash 会话 `pnpm` 不在 PATH 而 exit 1（`logs/gate-full.log`，环境包装问题）；修正 PATH 后 `GATE_EXIT=0`（`logs/gate-full.log` 复跑）。施工回执记录为 0，复核独立取得 0 | `logs/gate-full.log` | 环境问题，非候选缺陷 |

**代码审查结论（任务四 6 项）**：

1. **P0-0 覆盖对既有功能的影响**——`handleStore.ts` 相对基线为**纯新增**（+197/−0，旧文件句柄 API 未动）；`directoryTypes.ts` 纯新增（`isSameEntry?` 可选声明）；`package.json` +1 脚本；`directoryHost.ts` +47/−14（pick/restore/requestPermission/detach 改走单一身份路径，`requestPermission` 对已挂载态显式不重解析、不动 scopeId/epoch）。**6 件覆盖文件的 808 版本 == 基线版本（内容，逐件验证）** ⇒ 候选在这些文件上的全部改动 = 纯 P0-0 增量。保存生命周期 / 模式守卫全量回归通过（§4）⇒ 未破坏。
2. **`index.ts` 导出**：170 个导出块 / 526 个导出名 / **0 重复**；P0-0 面 12 值 + 8 类型全部在列且单一来源；`scopeIdentity` 内部工具（`applyIdentity` / `markDormant` / `BROWSER_SCOPE`）**未进入公共 API**、无 `edit/scopeIdentity.js` 接线；94 个 `from './…'` 目标全部存在（无死接线）。
3. **包入口消费**：复核独立实现（`check/consume-entry-review.mjs` 47 项 + `consume-entry-unavailable.mjs` 3 项）：`@mindcanvas/react` self-reference 解析 → **复核树 dist**（非 src 深路径）；覆盖 12 值导出类型、常量、scopeId、校验器（含双 active / null+active）、追加/淘汰、同一性四态、**注册表 empty/ok/conflict/corrupt 与 unavailable 独立进程**。`corrupt` 注入证明"不覆盖损坏记录"。
4. **构建/测试/浏览器产物一致性**：vitest 输出头 root = 复核树；`pnpm build` 于复核树产出（canvas 入口 `main-BVSvKDBt.js`）；HTTP 实测**服务端字节 == 构建产物字节**（sha256 `0ac677702f51e353f914394f3f0a81a5e7b53f37f6acd653b0e41584ecbc6e60`，与施工 `inputs.sha256` 声明值相同）；浏览器快照守卫确认页面实际加载同名 bundle；**复核构建 609 件产物与施工产物清单逐件 sha256 相同（identical）**。
5. **文档数字对照**：施工回执 §1–§5 的每个关键数字与本次独立实测逐项一致（见 §3.4 对照表）。
6. **施工证据脚本审查**：负控/入口复算脚本以 `timeout …; echo "$?"` 捕获**子命令真实退出码**（`$?` 紧邻、不被中间命令污染），清单文件先清空后追加；浏览器脚本以 `--inputs` 清单复算为前置（不一致 → exit 3，本次两次运行均通过）；消费/门禁脚本异常路径记断言失败并 exit 1（不吞）。**"读取旧 results.json"风险在本轮复核中结构性排除**：所有输出指向全新目录（`20260920-02-review/…`），且新旧矩阵结果一致性已交叉对比（§4.3）。

---

## 2. 固定输入与隔离

| 项 | 结果 |
|---|---|
| 候选提交解析 | ✅ commit；Tree `3b0540354ddda4366f4911faac2d86bba9e68b57`；父 `a2ce72bf…`（均与预期一致） |
| 交付回执 / 施工证据 / 上游 808 清单 / 最终验收文档 / P0-0 manifest / P0-0 复核 | ✅ 全部存在 |
| 复核报告路径 | ✅ 开工前不存在（本报告为新文件） |
| 复核证据目录 | ✅ 开工前不存在（本次新建 `20260920-02-review/`） |
| worktree | ✅ `git worktree add --detach <独占路径> 06914460…`；**未依赖任何 `codex/*` 引用** |
| 依赖 | ✅ 复核树独立 `pnpm install --frozen-lockfile --offline`（pnpm **10.33.2**、150 包、13.3s）；**`pnpm-lock.yaml` 未变（未更新锁文件）**；`@mindcanvas/*` junction 全部指向复核树自身 |
| 旧证据保护 | ✅ 开工生成 479 件只读哈希基线（digest `6791e41b…`），收尾复算 **identical（missing/extra/changed 全空）** |

---

## 3. 来源闭包独立复算（不复用施工脚本）

独立实现：`recompute/closure-recompute.mjs`（上游材料 → 集合重推导 + 逐件核验）；行尾深挖：`recompute/eol-deep-dive.mjs`。

### 3.1 提交标识与差异

| 核验 | 实测 |
|---|---|
| Tree == 预期 | ✅（另：提交树 881 条目、基线树 786 条目） |
| 相对父提交差异 | ✅ **149 文件 = 95 新增 + 54 修改 + 0 删除**；`+26757 / -1484`（短统计逐字命中） |

### 3.2 候选集合重推导（841 = A 808 + B 13 + C 1 + D 25 + E 1）

- **A**：`20260919-04/candidate.json` 808 项（746 tracked + 62 untracked + 0 deleted，声明核验通过）；
- **B**：P0-0 固定提交 13 项（6 件覆盖 A 中旧版 + 7 件新增，与 A 的包含关系逐件核对）；
- **C**：`index.ts` 集成块；**D**：25 件验收链文档；**E**：1 件预算勘误；
- **841 项无未归属**：149 差异逐件分类 = 808 来源 109 + 25 文档 + 1 勘误 + 6 P0-0 覆盖 + 7 P0-0 新增 + 1 集成 = 149，`UNATTRIBUTED = 0`。

### 3.3 来源内容逐件核验

| 判据 | 结果 |
|---|---|
| 801 件保持 808 验收**内容** | ✅ 603 件字节相等 + **198 件仅 LF→CRLF 呈现差异**（blob 一致、可逆转回声明字节；0 件内容差异） |
| 6 件 = P0-0 覆盖版 | ✅（且先证明这 6 件的 **808 版 == 基线版内容**，见 §1 审查 1） |
| **P0-0 13/13（提交内）** | ✅ `git rev-parse HEAD:<p>` == `3cdcdc3d:<p>`，13/13 |
| `index.ts` §4.2 块 | ✅ 恰出现 1 次；删除该块后 sha256 == 808 验收字节 `85ed6301…`；内部工具未进公共面 |
| 4 件规划文档排除 | ✅ 未进入候选提交（`ls-tree` 核验）；**无产品源码误排除**（808 产品面全部在树） |
| 清单口径 | 候选清单 = 工作树**字节 SHA-256**；提交树 = **git blob SHA-1**（`candidate-tree` 881 行）；产物清单另列（§4.4） |

---

## 4. 独立验证（同一复核候选；退出码均真实）

### 4.1 命令与退出码

| 命令（复核树） | 退出码 | 关键结果 |
|---|---|---|
| `pnpm gate`（timeout 900，未收束） | **0** | test 段 12 / 622 / 1545 / 353 = **2532**；depcruise 537 模块 / 1604 deps / 0 违规；lint 1541 warn + 48 info（0 error）；**budget 全绿**（asCast 31/31、bigFiles 4/4、bang 89/90↓1） |
| `pnpm build` | **0** | 四包构建；`main-BVSvKDBt.js`（437.48 kB） |
| `pnpm analyze` | **0** | 结构分析通过 |
| P0-0 定向 ×3 | **0** | workspace-scope **9/9**、handle-store **29/29**、directory-host **51/51** |
| 消费验证（复核版） | **0** ×2 | **47/47** + **3/3**（≥ 施工 39 项覆盖） |
| `artifacts-compare` | **0** | 复核构建 **609 件** 与施工产物清单**逐件 sha256 identical** |
| 负控 NC-1..7（8 子命令） | **1 ×8** | 见 4.2 |
| NC-5 三入口 | 0 / 1 / 0 / 1 | 见 4.2 |
| `verify-save-lifecycle` | **0** | **PASS**（页面加载 `main-BVSvKDBt.js`） |
| `verify-mode-guard` | **0** | **PASS** |
| `verify-release-123 --mode=normal` | **0** | **53/53 PASS**，envFailures 0 |
| `verify-release-123 --mode=neg-saveas-share` | **1** | 48/53；failed = **[R7b, R7c, R7d, R7e, R7f]**；envFailures 0 |
| CDP 驱动 IndexedDB | **0** | title=DONE、exceptions 0、**10/10 PASS** |
| `inputs` 复算（11 项） | **0** | ok（无 missing/mismatched/extra） |

### 4.2 NC 红因与环境错误（复核树内重建隔离副本）

副本构建：`negatives/negatives-review.py`（源 = 复核树；单点中性化"恰命中 1 次"防呆；junction 复用复核树 node_modules）。

| 子命令 | 退出码 | AssertionError | 环境错误 |
|---|---|---|---|
| NC-1/handle-store | 1 | 9 | 0 |
| NC-2/directory-host | 1 | 2 | 0 |
| NC-3/handle-store、directory-host | 1、1 | 2、2 | 0 |
| NC-4/handle-store、directory-host | 1、1 | 2、2 | 0 |
| NC-6/directory-host | 1 | 1 | 0 |
| NC-7/handle-store | 1 | 1 | 0 |
| **NC-5**：entry1 / entry2 / entry3-control / entry3-neutralized | 0 / 1 / 0 / 1 | 0 / 3 / 0 / 3 | **全部 0** |

⇒ 8/8 真实非零、红因全为目标断言、**环境错误总数 0**；NC-5 精确 **0 / 非零 / 0 / 非零**；复算后候选树零残留。

### 4.3 浏览器证据与产物哈希

- 服务：复核树 `vite preview`（5188）+ 复核树根静态服务（5189，供 IndexedDB 页）；页面实际加载 bundle 由快照守卫确认。
- **实际加载产物哈希**：`main-BVSvKDBt.js` = `0ac677702f51e353f914394f3f0a81a5e7b53f37f6acd653b0e41584ecbc6e60`；HTTP 取得字节与复核 build 产物**逐字节相同**，且与施工 `inputs.sha256` 声明一致。
- 正常 vs 负控矩阵：**case 集合与顺序完全一致（54/54）**，状态差异**恰为 R7 家族 5 项**（env 0）。
- 与施工矩阵交叉核对：case 集合一致、`ok` 状态差异为空、summary 完全一致（不依赖旧 results.json：本轮输出全部为全新目录）。
- **真实 IndexedDB 十项（此前两轮未覆盖，本轮补齐）**：使用**复核候选新构建的 `packages/react/dist`**（页面 → `../../packages/react/dist/edit/handleStore.js`，仅调整该 dist 路径与输出目录/服务地址；十项断言与期望未改）：

| # | 断言 | 实测 |
|---|---|---|
| C0 | 真实 IndexedDB 可用 | PASS |
| C1 | 加载 dist 模块（真实构建产物） | PASS |
| C2 | 缺键 → empty | PASS |
| C3 | 写入 ok + 裸键为**裸句柄**（无包装） | PASS |
| C4 | 已存 null → corrupt（≠empty） | PASS |
| C5 | 删除键 → empty | PASS |
| C6 | 真实 IDB 原子回滚（第 2 个 put 失败 → 两键旧值） | PASS |
| C7 | 两实例并发（真实 IDB）→ a,b,c 全保留且合法 | PASS |
| C8a | 微任务后 put（对照 OK） | PASS |
| C8b | 跨任务延迟后 put（预期 THROW `TransactionInactiveError`） | PASS |

**10/10 PASS**，`exceptions = 0`。

### 4.4 施工文档数字对照（抽查全项一致）

| 施工声明 | 复核实测 | 一致 |
|---|---|---|
| 149 文件（95 A + 54 M）、+26757/−1484 | 逐项相同 | ✅ |
| 841 件 / 13·13 blob / index.ts = 808 + §4.2 块 | 全部复现 | ✅ |
| 609 产物（identical） | 609、逐件 identical | ✅ |
| GATE_EXIT=0；12/622/1545/353=2532；9/29/51 | 全部复现 | ✅ |
| NC 8/8、NC-5 0/1/0/1 | 全部复现 | ✅ |
| 浏览器 PASS/PASS/53-53/neg R7 家族 | 全部复现 | ✅ |
| 消费 39/39 | 复核独立版 47/47 + 3/3（覆盖并超出） | ✅ |
| `main-BVSvKDBt.js` | 同名同字节哈希 | ✅ |
| install 150 包 / pnpm 10.33.2 | 150 包 / 10.33.2（锁未改） | ✅ |

**门禁配置未放宽**：`scripts/check-code-budget.mjs`、`biome.json`、`.dependency-cruiser.js`、`.githooks/pre-commit`、`.github/workflows/ci.yml`、各 `vitest.config.ts`、`tsconfig.base.json` 均为 **byte-equal**（与 808 验收一致）；`pnpm-lock.yaml` 内容一致（eol-only）——**未改阈值、未更新锁文件**。

---

## 5. 未覆盖项与残余风险（如实声明）

1. **真实系统文件选择器手势、真实 OS 输入法候选框、触控、跨浏览器（仅 Chromium）、离线、跨平台像素金图**：不覆盖（沿用 808 验收与 P0-0 复核的既有边界）。
2. **NC-5 入口 3 双副本来自 P0-0 归档**（未在复核树重生成 `make-impl-copies`）；适用性由：源文件 blob 13/13 == P0-0 固定提交 + control 副本跑绿 / neutralized 副本跑红 + 本轮 0/1/0/1 复现。
3. **行尾呈现口径（M-1）**：从提交重新检出的字节呈现依赖 `core.autocrlf`；内容口径不受影响，但后续若做字节级归档比对需先知此口径。
4. 复核树 `.workbuddy/` 下留有两轮负控副本与 IndexedDB 运行文件（git 忽略，未入任何提交）；如需清理由上层裁定。
5. 本报告覆盖的是**候选提交**的冻结验证；`pnpm gate` 历史上"vitest 摘要后挂起"的环境现象本轮未复现（两轮 gate 均干净退出），不推断根因。

---

## 6. 未修改声明

- **候选提交**：`06914460…` 及其 tree、881 条目、全部文件字节**未变动**（复核全程 detached 检出，只读；结束时 `git status` = 0 行）。
- **原施工工作树** `mindcanvas-base-integrate`：`git status` = 0 行、HEAD 未变（复核未触碰）。
- **旧证据与上游材料**：479 件哈希基线-收尾复算 **identical**（含施工证据 `20260920-01/`、`delivery-close-finish/20260919-04/`、`file-assets/P0-0/`、施工回执与勘误）；**未修改原回执、旧清单或旧证据**；未 amend P0-0 提交、未 push、未发布。
- 本轮新增均在：`outputs/base-integrate/20260920-02-review/`（证据 + 脚本）、`docs/dispatch/2026-09-20-base-integrate-review.md`（本报告）、复核 worktree（detached，可清理）。
- 服务与进程：本轮启动的 `vite preview`（5188）、静态服务（5189）、headless Chrome（CDP 9334）均已停止/关闭，端口无监听。

**结论复述：ACCEPT。** 候选 `069144603d56eee730725f848b0c2d69b0995187` 来源闭包无差异、P0-0 13/13 未漂移、集成块准确且公共消费通过、门禁/构建/分析全绿、负控与浏览器/IndexedDB 证据成立、无 Critical / Important 发现，**可作为 N0 与 P0-D 的共同冻结起点**；Minor 事项（M-1 口径、M-2 契约语义记录）留档，不阻断。交主控复核。
