# 摘要节点 S1 独立复核报告

- **复核对象（候选）**：`905c053fe396d1fbbc4d663bf4247b0853bffcec`（分支 `codex/summary-node-s1-20260920`）
- **综合基线**：`069144603d56eee730725f848b0c2d69b0995187`
- **被复核回执**：`docs/dispatch/2026-09-20-summary-node-s1-report.md`（证据副本 `outputs/summary-node/20260920-01/s1-report.md`）
- **原证据**：`outputs/summary-node/20260920-01/`
- **本次复核证据**：`outputs/summary-node/20260920-02-review/`（日志一跑一路径，失败日志未复写）
- **复核方式**：**只读独立复核**——从完整候选 SHA 建 **detached worktree**（`<workspace>-review-s1`，起点 `git status --porcelain` = 0），独立安装、**构建候选自身 dist**（不使用施工树产物）；未修改主工作树、施工树、旧报告、旧证据。
- **复核日期**：2026-09-20
- **结论**：**ACCEPT（附条件）** —— S1 可作为 S2 基础。无 Critical、无 Important 阻断项；发现 1 项 Minor 文档不准确、2 项回执口径错误（其中 1 项需更正）。详见 §1.4 与 §5。

> 说明：原回执结论为「交付完成、可提交独立复核」。本次复核**独立重跑**了定向测试、全包测试、门禁与阴性对照，并新增独立探针；结论独立性以本次实测为准。
> 主控已确认 **P0-0 与 BASE-INTEGRATE 通过**，本次不重开其验收（但 §1.4 更正回执中关于 P0-0 文档的事实陈述）。

---

## §1 Findings

### 1.1 交付闭包（清单数字错误与源码缺陷分别定级）

**F-1（Minor · 回执口径错误，需更正 · 非源码缺陷）**
`docs/dispatch/2026-09-20-summary-node-s1-report.md:60` 与 `outputs/summary-node/20260920-01/README.txt:83` 均写「**10 文件：4 改 + 6 增**」。
实际 `git diff --name-status 0691446 905c053` = **3 M + 7 A**（合计 10，总数对、分类错）。逐文件复核见 §2.5，`s1-changed-files.txt` 自身**正确**（3 M + 7 A），故这是**报告/索引的转录错误**，不影响交付物内容与哈希锚定。
- 触发条件：无（纯文档数字）。
- 期望：回执与 README 与 `s1-changed-files.txt` 一致（3 改 + 7 增）。

**F-2（Minor · 回执事实陈述错误，需更正）**
回执 §7 限制 2 称「P0-0 的独立复核文档本批未随候选提供」。
实测：**候选树内存在** `docs/dispatch/2026-09-20-P0-0-review.md`（内容为 P0-0 独立复核报告，结论 **ACCEPT**；blob `ecc43cc8…`）；同一文件在**基线 `0691446` 树中亦已存在**，即并非「本批」新增或缺失。
- 口径更正：该文档**随候选提供且已随基线提供**；回执应改为「已随候选提供（`docs/dispatch/2026-09-20-P0-0-review.md`）；本批未直接依赖其内容」，或直接删去该限制条。
- 定级理由：**不阻断**。P0-0/BASE-INTEGRATE 已由主控确认通过，且该限制条原意是「不声称 P0-0 已通过复核」——这一**不越权声称**的保守姿态本身正确，仅**事实前提写错**。

**F-3（Minor · 注释/回执措辞不准确 · 非功能缺陷）**
`packages/kernel/src/registry/summary-anchor.ts:152-153` 注释称「无摘要的文档**零额外开销**（先收集再决定是否建索引）」；回执 `:80` 复述为「无摘要文档零开销短路」。
实测：`resolveSummaries` 的 `walk` **无条件遍历全树**（`:159-168`），「零额外开销」仅对**cid 索引**成立，对**全树遍历**不成立。对照 `resolveSections`（`section-anchor.ts:41-43`）在 `specs.length === 0` 时**建索引前即返回**，两者行为不同。
- 实测证据（无摘要树 · 1093 节点 · 各 200 次；对照法：同一棵树分别调 `resolveSummaries` 与 `resolveSections`；探针 `probes/probe-overhead.mjs`，在**另一次全新构建**上独立复现，日志 `logs/review-probe-overhead.log`）：
  `resolveSummaries` × 200 = **15.2 ms**（全树裸遍历参照 1.5 ms）；`resolveSections` × 200 = **0.2 ms**。两值均返回空清单 `[]`。
- **静态判据（不依赖计时）**：`resolveSummaries` 的 `walk(root, null, 0)` 在 `pending.length === 0` 的早退**之前**执行（`summary-anchor.ts:168` 早退、`:159` 遍历），故**无摘要时亦遍历全树**；`resolveSections` 的 `if (specs.length === 0) return []`（`section-anchor.ts:43`）在**任何遍历前**返回。此结构与计时一致，结论不依赖机器性能。
- 触发条件：任何调用（每次布局都会全树遍历）。
- 期望：措辞限定为「cid 索引零额外开销（先收集再决定是否建索引）」；**不要求本包做额外性能优化**（S1 契约未承诺 O(1) 短路，且 S3 才决定调用时机/ memo 策略）。
- 说明：`cid 索引一次预建` 的**另一条声明准确**（`buildCidIndex` 每调用一次，`:170`；20 摘要 × 50 成员 × 100 次 = 3.9 ms，无 O(S×N) 复发）。

### 1.2 无 Critical / 无 Important 阻断项

源码层面**未发现**导致数据损坏、语义错误或契约违背的缺陷：
- 三态判定、同父/顺序/自包含校验、数据无损（坏锚不删）经独立探针**全部符合候选设计稿契约**（§3）。
- 迁移链路（改名/缩进/反缩进/跨父/剪切/接回/幂等/不原地改）经**真实 controller** 验证**全部通过**（§4）。
- 阴性对照**两处独立复现**，判别力与转红集合与回执逐位一致（§6）。

### 1.3 接口注意事项（交 S2 / S3，非缺陷）

**N-1（S3 需承担过滤职责）**：当一条摘要的范围区间**包含另一条摘要节点**时，外层摘要被报为 **well-formed**、`memberIds` 中含该摘要节点、且**不产出诊断**（探针 `OVL-*`，`logs/review-probe-gaps.log`）。
- 判定：**非 S1 契约缺陷**。计划 §6 明确将「嵌套摘要（范围含另一摘要）」列为**本批不做**；S1 只承诺同父连续区间语义。但 S3 布局**不得假设 `memberIds` 全为可放置的普通成员**，需自行过滤/降级，否则会把摘要节点当普通成员纳入成员带。
- 注意：若摘要节点**落在自身范围内**，S1 已正确报 `dangling/summary-in-range`（探针 `NEST-*`），该情形无需 S3 额外处理。

**N-2（S3 依赖字段）**：`ResolvedSummary` 的 well-formed 条目提供 `{summaryNodeId, state, memberIds, parentId, label}`（探针 `S3-interface`）。`parentId` 为**加法字段**，供卫星定位；S3 可安全消费。

**N-3（S2 写入契约）**：`upsertSummaryOf` 以 `{from, to}` **重建** `summary_of`（`protocol/summary.ts:57`），**丢弃其中未知嵌套键**（探针 `EX-3` / `EX3-result`）。
- 现状**不构成 S1 数据丢失**：该函数在 S1 **无任何生产调用方**（仅测试；`grep` 证），且真实的迁移写回路径 `applyAnchorUpdateToNote`（`cutAttach.ts:204`）用 `{...cur0, [dleaf]: to}` **合并**，未知键与其它 note 字段**均保留**（探针 `M-preserve-*` 通过）。
- 但 S2 建摘要写入时若直接使用 `upsertSummaryOf` 覆盖既有节点，会**丢失** `summary_of` 内的扩展键（如未来新增的 `label`/样式键）。与设计稿「数据硬纪律：roundtrip 无损 / 无效锚不静默删除」（设计稿 `:49`、`:86`）以及本仓 `Note.summary_of` 注释所称「前向兼容」精神相冲突。
- 建议（S2 范围，非本次返修项）：改用合并语义，或明确文档化「upsert 为整体替换、扩展键由调用方负责携带」。
- 注：`upsertSection`（`section.ts:105-119`）亦为整体重建，故此为**既有同构先例**，不是 S1 新引入的偏差；**不扩大兼容承诺**，仅指出 S2 消费风险。

### 1.4 覆盖空白（本轮发现的证据侧空白，已补探针）

以下为**候选测试未覆盖**、但本次以独立探针覆盖并**通过**的点（不改正式测试、不改候选）：
- `upsertSummaryOf` 携带扩展键的行为（§1.3 N-3）——候选测试 `summary-roundtrip.test.ts` 仅覆盖「无扩展键的覆盖写入」。
- 「范围含另一摘要」的 well-formed 产出（N-1）。
- 重复 cid（两节点同 cid）时锚解析为 well-formed 指向其中之一（探针 `DUP-cid`）——与 `buildCidIndex` 既有语义一致，S1 未承诺 cid 去重（计划 §7 将 `duplicate` 的 cid 债务列为②批次）。
- 「成员同父但 S 不同父（S 被搬走）」的专用用例（探针 `XP-members-share-other-parent` → `summary-not-same-parent`，通过）。
- **无效原始 `summary_of` 被忽略 ≠ 已覆盖 stale**：候选测试 `summary-anchor.test.ts:251-258` 断言「形态非法不产出条目」；本次探针 `IG-1…IG-4` **显式区分**了「忽略非法形状（无条目、无诊断、原值保留）」与「stale 诊断产出（可解析但歧义/不可解析）」，两者**均已按设计分别覆盖**，未将二者混同。

### 1.5 明确未覆盖 / 不要求

- **未做** S1 的 UI、布局、浏览器证据（S2–S5 范畴，本次不要求，亦未以「新模块缺失的导入失败」冒充行为断言红灯）。
- **未启动 S2**；未修改候选、未修复、未合并、未 push、未发布。

---

## §2 来源与清单复算（交付闭包）

### 2.1 祖先关系与差异

- `git merge-base --is-ancestor 0691446 905c053` → **成立**（基线是候选的直接祖先）。
- 基线..候选之间**恰 3 条提交**：
  | 提交 | 说明 |
  |---|---|
  | `f036f99` | docs(dispatch): 摘要节点计划与设计稿入候选（只读复制 + SHA-256 锚定） |
  | `1032699` | feat(kernel): 摘要数据层（summary_of 访问器/三态锚解析/W_SUMMARY_DANGLING） |
  | `905c053` | feat(react): summary_of 锚迁移登记（采集/解析/写回） |
- **候选树文件数 = 888**（实测 `git ls-tree -r --name-only 905c053 | wc -l`）；基线树 = 881；881 + 7 新增 = 888 ✓。

### 2.2 变更集（**3 M + 7 A**）

```
M  packages/kernel/src/index.ts
M  packages/kernel/src/protocol/types.ts
M  packages/react/src/edit/cutAttach.ts
A  docs/2026-09-20-摘要节点-设计与实施规划.md
A  docs/dispatch/2026-09-20-summary-node-plan.md
A  packages/kernel/src/protocol/summary.ts
A  packages/kernel/src/registry/summary-anchor.ts
A  packages/kernel/tests/summary-anchor.test.ts
A  packages/kernel/tests/summary-roundtrip.test.ts
A  packages/react/tests/summary-anchor-migration.test.ts
```
→ 与回执「4 改 + 6 增」**不符**（见 F-1）；总数 10 正确。

### 2.3 `candidate-manifest.sha256` 的生成阶段（关键更正）

**回执与 README 均称该清单为「候选逐文件 SHA-256：881 tracked + 2 只读复制件 = 883 条」**。实测其**实际语义为开工基线（`0691446`）的冻结清单**，而非最终候选清单：

- 条目 **883 = 881 + 2**，其中 **881 条路径集合与基线树 `0691446` 逐条相等**（`manifest paths NOT in baseline tree: 0`，`baseline tree files: 881`）。
- 相对**最终候选树 888**，清单**缺 7 条**（恰为 7 个新增文件：2 docs + 3 新 src/test kernel + 1 新 react test）。
- `candidate-head.txt` 冻结的正是 `0691446`（**基线**），与上一条自洽。
- **运行 `make-manifest.mjs` 时所在工作树 = 开工基线**：清单内容对**基线** `git ls-files` 逐文件哈希，外加 2 个只读复制件（`extras` 参数）。
- **结论**：**该清单应被理解为「开工基线清单」，而非「最终候选清单」**。它锚定的是**起点**，不构成对终态闭包的证明。回执 §1 前置 4「候选清单 + SHA-256（883 条，missing=0）」的**命名与阶段归属不准确**。
- **不影响交付物完整性**：终态 10 文件另有 `s1-changed-files.sha256` 锚定，且本次已独立复算通过（§2.5）。

**"missing=0" 的正确读法**：`missing=0` 仅表示「生成清单时，基线 `git ls-files` 的 881 条 + 2 extras 全部可读」——**这是基线侧的自洽，不是终态闭包成立**。本次复核**未以 `missing=0` 作为终态依据**，而是另做逐文件终态复算（§2.5）。

### 2.4 清单字节复算与行尾差异（工作树字节 vs git blob）

对 883 条清单**逐条重算**，并区分三种形态：

| 哈希口径 | 命中条数 |
|---|---|
| 基线 **git blob 原始字节（LF）** | 5 |
| 基线 **git blob 经 LF→CRLF 转换** | **876** |
| 主工作树当前字节 | 2（即 2 个只读复制件，见下） |
| **无法解释** | **0** |

- **行尾差异成因**：仓库 `core.autocrlf = true`（无 `.gitattributes`）。git **blob 内存储 LF**，而**检出到工作树为 CRLF**。清单器 `make-manifest.mjs` 用 `readFileSync` 读**工作树文件**，故 876 条文本文件记的是 **CRLF 形态哈希**；5 条二进制（如 `.svg`/`.png`）无行尾转换，两口径一致。
- 2 个「主工作树字节」命中的是**只读复制件**（`docs/dispatch/2026-09-20-summary-node-plan.md`、`docs/2026-09-20-摘要节点-设计与实施规划.md`），以**源文件字节**（LF）入清单。
- **工作树字节哈希 ≠ git blob**：两者在 `core.autocrlf=true` 下**必然不同**，这是**规范化口径差异**，**不是**内容篡改或行尾污染。§2.5 给出双向对照。

### 2.5 终态 10 文件独立复算 + 复核侧终态清单

**复核侧清单**（新建，**不覆盖**原清单）：`outputs/summary-node/20260920-02-review/reviewer-s1-changed-files.sha256`
（列：`status` / `git-blob@candidate(LF)` / `review-worktree-bytes(CRLF)` / `path`）

逐文件对照原 `s1-changed-files.sha256`：

| 状态 | 文件 | 原位记录口径 |
|---|---|---|
| A | `docs/2026-09-20-摘要节点-设计与实施规划.md` | blob(LF) |
| A | `docs/dispatch/2026-09-20-summary-node-plan.md` | blob(LF) |
| M | `packages/kernel/src/index.ts` | 工作树(CRLF) |
| A | `packages/kernel/src/protocol/summary.ts` | 工作树(CRLF) |
| M | `packages/kernel/src/protocol/types.ts` | 工作树(CRLF) |
| A | `packages/kernel/src/registry/summary-anchor.ts` | 工作树(CRLF) |
| A | `packages/kernel/tests/summary-anchor.test.ts` | 工作树(CRLF) |
| A | `packages/kernel/tests/summary-roundtrip.test.ts` | 工作树(CRLF) |
| M | `packages/react/src/edit/cutAttach.ts` | 工作树(CRLF) |
| A | `packages/react/tests/summary-anchor-migration.test.ts` | 工作树(CRLF) |

- **10/10 全部命中**（8 条工作树 CRLF 口径 + 2 条 docs 的 LF 口径），**无多余条目、无缺失条目**。
- 因此原 `s1-changed-files.sha256` **内容正确**，仅**混合了两种行尾口径**（代码文件记 CRLF、只读复制件记 LF）——回执未说明此差异，属**可读性/口径披露不足**，非错误。
- **终态闭包成立**（依据是上述逐文件复算，**不是** `missing=0`）。

### 2.6 计划/设计稿复制件指纹

| 文件 | 回执声称 SHA-256 | 本次实测（主树与候选树一致） | 判定 |
|---|---|---|---|
| `docs/dispatch/2026-09-20-summary-node-plan.md` | `878e5bc9…f625c` | `878e5bc99139f7608c8025982c0dd4da033019fa383136aaa0fc751c2d8f625c` | **逐字节一致** ✓ |
| `docs/2026-09-20-摘要节点-设计与实施规划.md` | `005aeab1…95438` | `005aeab18140208e684c527126a0e8d484c260cf7a8fead4e7e2677f3f495438` | **逐字节一致** ✓ |

两份复制件与主工作树源文件**内容一致**（复制时 LF 保真，见 §2.4）。

### 2.7 原证据只读复算（开工 / 结束各一次，确认未改写）

- `logs/evidence-recompute-pass1.log`（复核开始）与 `logs/evidence-recompute-pass2.log`（复核结束）两次复算。
- 覆盖：`candidate-manifest.sha256` = `209dc993…b58a4`、`s1-changed-files.sha256` = `807082f4…ba25cd`、`s1-changed-files.txt` = `4a03a728…917fa`、`README.txt` = `3f98a7ca…edf27`、`s1-report.md` = `59657635…380d66`、`docs/.../s1-report.md` = 同值（**证据副本与正本逐字节一致**）。
- 两轮**全部哈希相同**，**原证据在整个复核期间未被改写** ✓。

---

## §3 协议与解析审查（以候选设计稿为契约）

以设计稿 `docs/2026-09-20-摘要节点-设计与实施规划.md` 为契约（**未机械套用此前 prompt 中的同义状态名**）。公开三态 = `well-formed` / `dangling` / `stale`，与设计稿 §4.2 表**一致**；`AnchorResolutionState`（`note-anchor.ts:12`）同源，无第四态、无命名漂移。

**独立探针**：`probes/probe-protocol.mjs`（58 断言），日志 `logs/review-probe-protocol.log`。

| 组 | 内容 | 结果 |
|---|---|---|
| RT | mapping 形态与内联 JSON 的 parse→serialize→parse 语义往返、二次序列化字节一致、两形态归一 | **5/5 PASS** |
| IL | 裸标量、缺字段、空串、数字型 `from` → `undefined` 且**原值保留** | **9/9 PASS** |
| UN | 未知**嵌套**键保留并往返、不破坏收窄 | **3/3 PASS** |
| PU | `summaryOf` **不修改输入**（note 字节不变）；改动返回对象**不回写** note | **2/2 PASS** |
| UP/RM | `upsert`/`remove` 不可变性、兄弟键保留、覆盖不追加、未命中**返回原引用**、`undefined` 入参 | **10/10 PASS** |
| ST | 单成员合法、端点缺失、跨父（双向）、倒序、S 为根、S 自包含、范围跨过 S、坏锚 stale、**路径歧义 stale** | **14/14 PASS** |
| MU | 同树多摘要互不污染（健康与损坏并存）、无摘要空清单 | **3/3 PASS** |
| IG | 非法形状被忽略（无条目、无诊断、原值保留） | **4/4 PASS** |
| DG | 诊断码 `W-SUMMARY-DANGLING`、消息含标题与**机器可读原因码**、well-formed 零诊断 | **3/3 PASS** |

**合计 56/58 PASS**；2 个 FAIL 经归因**均为探针自身缺陷**，非源码缺陷：
- `UN-4`（未知**顶层** note 键）：探针把第二个 `<!-- -->` 块放在正文之后，parser 正确判为 `W-ORPHAN-NOTE`（孤儿笔记），**属正确行为**；改为单块后（`zzz_unknown` 与 `summary_of` 同块）**通过**。
- `EX-3`：**真实现象**（见 §1.3 N-3），已单列为接口注意事项，非本包阻断项。

**关键结论**：
- **`upsert` + 端点更新是否丢扩展字段**：`upsertSummaryOf` **会丢** `summary_of` 内未知键；但**迁移写回路径不丢**（`applyAnchorUpdateToNote` 合并，§1.3 N-3 / §4）。契约上 `未知值透传不丢` 系**读侧 `summaryOf`** 的承诺（计划 `:87`），`upsert` 明确为**不可变**但未承诺保留扩展键——**依既定契约判定，不自行扩大兼容承诺**，仅作文档/接口提示。
- **无效原始 `summary_of` 被忽略是否符合设计**：**符合**（计划与设计稿均只对**可解析形态**承诺三态）。已显式区分「忽略非法形状」与「输出 stale 诊断」，未混作已覆盖（§1.4）。
- **范围含另一摘要**：见 N-1，**S1 契约未涵盖**（计划 §6 明确不做），不当作 S1 缺陷；已标注 S3 过滤职责。
- **"无摘要零开销"注释**：**不准确**（F-3）。

---

## §4 迁移审查（真实 controller / migration 链路）

**探针**：`packages/react/tests/zz-review-migration.probe.test.ts`（证据侧新文件，**不改正式测试、不改候选**；复核完可删），驱动真实 `EditorController` → `collectReferenceAnchors` → `planReferenceMigration` → `buildMigrationOps` → `applyOp`。
日志：`logs/review-probe-migration.log`（`REVIEW-MIGRATION-PROBE total=33 pass=33 fail=0`）。

| # | 场景 | 结果 |
|---|---|---|
| 1 | 改名成员 → 路径锚跟随新路径、仍 well-formed、**`to` 未被误动** | PASS |
| 2 | 改名**父级** → **两条锚一起跟随**（无半更新） | PASS |
| 3 | **cid 锚**在改名后**原样保留**（身份稳定） | PASS |
| 4 | 反缩进成员 → 锚跟随新路径，结构跨父 → `dangling/from-not-same-parent`，**数据不丢** | PASS |
| 5 | 缩进**摘要节点自身** → `dangling`，两端原值保留 | PASS |
| 6 | 两端同时迁移 → **互不覆盖**，`from`/`to` 保持相异 | PASS |
| 7 | **只更新 `from` 不动 `to`，反之亦然** | PASS |
| 8 | 迁移**不丢** `summary_of` 未知扩展键（`label`/`future`）**及其它 note 字段**（`status`/`cid`） | PASS |
| 9 | 剪切含摘要子树 → 锚批量重写为新路径、仍 well-formed、迁移 op 与前缀结构 op **同批** | PASS |
| 10 | **幂等**：对已迁移树再跑真实迁移（改无关兄弟）→ 锚稳定、仍 well-formed | PASS |
| 11 | **输入树与 note 不被原地修改**（原夹具字节不变） | PASS |
| 12 | 接回（attach）链路：剪切后仍 well-formed、`planAttachIsland` 产出计划 | PASS |

**既有测试断言的修改理由审查**：回执 §4.2 自我修正 3 称，原「反缩进成员后仍 well-formed」夹具语义**与设计不符**，已改为「改名父级」并**新增**「反缩进 → 锚跟随但结构跨父 → dangling」用例（`summary-anchor-migration.test.ts:184-206`）。
- 本次独立判定：**修改理由成立**。设计稿将 dangling 定义为「端点被删 / **移出同父** / 顺序倒置」（设计稿 §4.2 表），成员被反缩进后确已移出与摘要节点相同的父级，故 `dangling` 是**正确期望**；原夹具确实把**错误实现**写成了期望。
- 且该用例是**阴性对照的判别点**（§6），修改后**转红集合与跨父情形一一对应**，非「把测试改绿」。

---

## §5 验证要求实测

### 5.1 定向三文件测试

| 套件 | 命令 | 实测 | 期望 | 判定 |
|---|---|---|---|---|
| kernel 定向 | `vitest run tests/summary-roundtrip.test.ts tests/summary-anchor.test.ts` | **34 passed (34，2 files)，exit 0** | 34 | **一致** ✓ |
| react 定向 | `vitest run tests/summary-anchor-migration.test.ts` | **9 passed (9)，exit 0** | 9 | **一致** ✓ |

日志：`logs/review-kernel-targeted-1.log`、`logs/review-react-targeted-1.log`。

### 5.2 全包测试

| 包 | 实测 | 回执声称 | 判定 |
|---|---|---|---|
| kernel | **656 passed (70 files)，exit 0** | 656 | **一致** ✓ |
| react | **1554 passed (155 files)，exit 0** | 1554 | **一致** ✓ |
| canvas | **353 passed (43 files)，exit 0** | 353 | **一致** ✓ |

> react 首轮实测 1567/156，系**本次复核探针文件**（13 用例）计入所致；排除探针后复跑得 **1554/155**，与回执**精确一致**（`logs/review-react-full-noprobe.log`）。

### 5.3 门禁与预算

| 项 | 实测 | 回执声称 | 判定 |
|---|---|---|---|
| typecheck | **exit 0** | exit 0 | 一致 ✓ |
| build | **exit 0** | exit 0 | 一致 ✓ |
| depcruise | **542 模块 / 1622 deps / 0 违规，exit 0** | 542/1622/0 | **一致** ✓ |
| lint | **1541 warnings + 48 infos，exit 0** | 1541 + 48 | **一致（逐数持平）** ✓ |
| budget | any **0** / tsIgnore 0 / bang **89** (预算 90) / asCast **31/31** / console 4 / todo 1 / defaultExport 2 / bigFiles **4/4**，exit 0 | 同 | **一致** ✓ |

> depcruise 首轮 543/1625 系复核探针计入；排除后复跑 **542/1622**，精确一致（`logs/review-depcruise-clean.log`）。
> **行数预算**：`cutAttach.ts` **591**/600（余 9，与回执一致）、`kernel/src/index.ts` **475**/600、`summary-anchor.ts` 218、`summary.ts` 71。

### 5.4 公共 `@mindcanvas/kernel` 导出实际可消费

从**构建产物 `dist/index.js`** 直接导入（非源码路径）：

- 运行时导出 **6/6 全部存在**：`summaryOf` / `upsertSummaryOf` / `removeSummaryOf` / `resolveSummaries` / `collectSummaryDiagnostics` / `W_SUMMARY_DANGLING`（值 `'W-SUMMARY-DANGLING'`）。
- 类型导出就位：`ResolvedSummary` / `SummaryDiagnostic` / `SummarySpec`（`dist/index.d.ts:10,76,77`）。
- 经公共面**冒烟调用成功**：`resolveSummaries` 返回 `[{summaryNodeId:'s',state:'well-formed',memberIds:['m1','m2'],parentId:'r',label:'摘要'}]`；`summaryOf` 正确收窄。exit 0。

### 5.5 阴性对照（隔离副本，去同父守卫）

**隔离位置**：`<workspace>-nc-s1/`（**在主工作树之外**，不污染主树/施工树/证据）。
**中性化**：仅把 `resolveOne` 的**三处「同父」守卫判据**前置 `false &&`（`neutralize.diff` 为**最小 diff**，仅 3 行守卫谓词，其余逐字不变；`summary-anchor.NEUTRALIZED.ts` 全文留档）。**未反转断言、未使用 `it.fails`、未吞退出码。**

| 步骤 | 副本 | 结果 |
|---|---|---|
| 中性化前（正常副本） | 原样候选 | kernel 定向 **21 passed (21)，exit 0** |
| 中性化后 | 去三处同父守卫 | kernel 定向 **4 failed \| 17 passed (21)，exit 1** |
| 中性化后 | 同上（react） | **1 failed \| 8 passed (9)，exit 1** |

- **转红集合与「跨父 / 错层」用例一一对应**（具体 4 条：端点移出同父、摘要自身换父、端点指向文档根、终点移出同父；react 1 条：成员反缩进后跨父）。
- **与回执 NC 数字逐位一致**（`4 failed | 17 passed (21)`、`1 failed | 8 passed (9)`，均 exit 1）✓。
- **恢复**：`cp` 还原后哈希 `76aa4944aad3430433e208346cc069c2e30f86faf713a8adfbf248e9ef576bdd` **与候选逐位一致**，`git status --porcelain` 干净（仅复核探针文件为 untracked）✓。
- **重要流程发现（不影响结论，供 S3/S4 参考）**：react 侧测试经 `@mindcanvas/kernel` → **`dist/`** 解析（`package.json` `main: ./dist/index.js`）。**首次仅中性化 `src/` 时 react 用例仍全绿（9/9）**，因 `dist` 未重建；**重建 `dist` 后**才复现 `1 failed`。→ **对 `src` 打补丁而不同步 `dist`，测试会给出假绿**。本次已按正确方式（重建 dist）复现。S3/S4 做阴性对照时须注意此点。

### 5.6 覆盖空白补探针

本轮全部发现均有**证据侧独立探针**支撑（`probes/probe-protocol.mjs`、`probes/probe-gaps.mjs`、`zz-review-migration.probe.test.ts`）；**未修改正式测试、未修改候选**。

### 5.7 日志纪律

每次运行**独立日志路径**，**失败日志未被复跑覆盖**（`review-nc-neutralized.log` 与 `review-nc-neutralized-react.log` 均保留失败原文；中性化前后的失败/成功分离留存）。日志全清单见 `outputs/summary-node/20260920-02-review/logs/`（23 个）。

---

## §6 未覆盖项与接口注意事项

**未覆盖（且本次亦不要求）**：
- S1 的 UI / 布局 / 浏览器证据（S2–S5）；本次**未**以「新模块缺失造成导入失败」冒充行为红灯。
- 布局逐位等价、卫星几何、森林平移、导出括线（S3/S4）。
- 6.8 节 §1.5 所列 S1 契约外行为（嵌套摘要、duplicate cid 债务）。

**交 S2**：
- 写入端使用 `upsertSummaryOf` 时注意**扩展键丢弃**（N-3），并承担 `cid` 补发与「跨父/根/倒序」拒绝提示。

**交 S3**：
- `memberIds` **可能包含另一摘要节点**（N-1），须自行过滤；**不可假设全为可放置普通成员**。
- `resolveSummaries` **每次调用全树遍历**（F-3），S3 决策调用时机/memo 时以此为准（**不要求 S1 优化**）。
- 可消费字段 `{summaryNodeId, state, memberIds, parentId, label}`（N-2）。

---

## §7 结论

**ACCEPT —— S1 可作为 S2 的基础。**

**判定依据（全部基于本次独立实测，非回执转述）**：
1. **交付闭包成立**：3 条提交祖孙关系正确、候选树 888 文件、终态 **3 M + 7 A = 10** 文件经**逐文件复算 10/10 命中**、无多余/缺失（**依据是逐文件复算，非 `missing=0`**）。
2. **源码无语义缺陷**：三态、同父/顺序/自包含、数据无损、迁移全链路（12 场景 / 33 断言）**全部符合候选设计稿契约**。
3. **门禁与测试逐数一致**：定向 34 + 9、kernel 656、react 1554、canvas 353、typecheck/build exit 0、depcruise 542/1622/0、lint 1541+48、budget 全部持平。
4. **阴性对照独立复现**：正常副本 exit 0，中性化副本因**目标断言** exit 非零（4 failed / 1 failed），判别力与转红集合精确对应。
5. **原证据未被改写**：开工/结束两次只读复算全哈希一致。

**须更正的文档口径（不阻断，建议随 S2 一并修订）**：
- **F-1**：回执与 README 的「4 改 + 6 增」应为「**3 改 + 7 增**」。
- **F-2**：回执 §7 关于「P0-0 复核文档未随候选提供」**与事实不符**——该文档**已随候选（且已随基线）提供**。
- **F-3**：`summary-anchor.ts` 注释与回执的「无摘要**零开销**」应限定为「**cid 索引**零额外开销」；全树遍历是无条件的。
- 建议补充披露：`candidate-manifest.sha256` 实为**开工基线清单**（883 = 881 基线 + 2 只读复制件），**非最终候选清单**；终态闭包由 `s1-changed-files.sha256` 承担。

**无 Critical、无 Important 阻断项；不存在需返修才能进入 S2 的源码缺陷。** 上述 3 项均为文档/措辞更正，最小返修范围为**回执与注释文本**，不触及实现。

**声明**：本次**未修改**候选与主工作树、**未修复**、**未合并**、**未 push**、**未发布**、**未启动 S2**。复核 worktree（`mindcanvas-review-s1`）与 NC 目录（`mindcanvas-nc-s1`）为复核专用产物，位于候选与主工作树之外。
