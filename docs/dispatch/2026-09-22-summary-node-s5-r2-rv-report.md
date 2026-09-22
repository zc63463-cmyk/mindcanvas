# S5-R2 返修候选独立复核回执（独立复核员）

- **复核对象**：S5-R2 返修候选，分支 `codex/summary-node-s5-r2-20260922`，HEAD
  `a8bb8b55157b691e2d91e76f2bde39f09af74741`（`docs+test: S5 返修（neg3 对照重做 + 文档收口 +
  层序表/横幅/忽略规则修正）`，父 = `6ead42a`）
- **复核日期**：2026-09-22
- **环境（实测）**：macOS Darwin arm64 / node v24.21.0 / pnpm 10.33.2 / vitest v4.1.11 /
  本地 `core.autocrlf=true` / 工作树 CRLF
- **被审对象**：S5 首版候选 `123d22b`（判 REJECT）→ Mac 适配 `6ead42a` → R2 候选 `a8bb8b5`
- **背景材料**：`docs/dispatch/2026-09-21-summary-node-s5-report.md`（REJECT 评审）、
  `docs/dispatch/2026-09-22-summary-node-s5-r2-report.md`（施工方 R2 回执）、
  `outputs/summary-node/S5-R2/S5-R2-20260922-142654/`（R2 证据）、
  `outputs/summary-node/S5/S5-20260921-230000/`（S5 首版证据，只读）
- **判定权声明**：本回执为独立复核结论，不采信施工方回执的结论性表述，逐项以**本人实跑/实读**为准。

---

## 0. 一句话结论

**ACCEPT。** 两项 high 阻断均经我独立复跑有效闭合（neg3 阴性对照真实转红、S5 文档收口齐备），
三处缺陷修复属实，门禁实测与冻结基线逐数持平，产品源码零 diff 且 bundle 与 S5 浏览器矩阵
实际加载产物**逐字节相同**。未发现新 high finding。附两项如实记录的 medium/low 观察（不阻断）。

---

## 1. 基线锚定（开工前核对）

| 项 | 要求 | 实测 | 一致 |
|---|---|---|---|
| 分支 | `codex/summary-node-s5-r2-20260922` | `codex/summary-node-s5-r2-20260922` | ✅ |
| HEAD | `a8bb8b5` | `a8bb8b55157b691e2d91e76f2bde39f09af74741` | ✅ |
| 提交序列 | `123d22b → 6ead42a → a8bb8b5` | `123d22b`(123d22b773a0) → `6ead42a`(6ead42ad9e17) → `a8bb8b5`；`HEAD^ = 6ead42a` | ✅ |
| 工作树 | `git status --porcelain` 为空 | 空 | ✅ |
| node / pnpm | v24.21.0 / 10.33.2 | v24.21.0 / 10.33.2 | ✅ |
| core.autocrlf | true（勿改） | true（未改） | ✅ |

基线锚定完全相符，无需差异报告，按任务书执行复核。

---

## 2. 逐项复核表（实测 vs 施工方主张）

### 2.1 [high 阻断] neg3-rootbox 阴性对照重做

| # | 施工方主张 | 我的实测 | 结论 |
|---|---|---|---|
| a | 同形变异 `const b = subtreeBBox(ln);` → `const b = ln.box;` 后 `tests/summary-frames.test.ts` 转红，真实 exit 1，红因 `expected 378 to be greater than or equal to 541.999999`（:368） | 备份 `summaryFrames.ts`（sha256 `05fd38bc…`）→ 字节替换（`subtreeBBox(ln)` 计数 1→0，`NEUTERED(rv-neg3)` 计数 0→1，**先确认在盘再跑测**）→ `npx vitest run tests/summary-frames.test.ts` 重定向取 `$?` = **1**，`1 failed \| 17 passed`，失败用例「成员带包含成员的子树（不是成员自身盒）」，断言原文与 :368 逐字相同 → 用**自备备份** `cp` 还原，`cmp` **IDENTICAL**，sha256 回到 `05fd38bc…`，`git status` 对该文件为空 → 复跑 **exit 0 / 18 passed** | **主张属实** |
| b | 探针 `probe-rootbox.log` 证伪「语义等价」，成员扁节点 children=1、孙盒右沿 542、自身盒右沿 378、生产 memberBand 右沿 542 | 独立重跑 `node probe-rootbox.mjs`，`PROBE_EXIT_CODE=0`，输出逐项与主张一致：`flat nodes = 7, satellites = 1`；`children 数 = 1（孙节点很长的名字）`；`孙节点…在扁表内 = true，盒右沿 = 542`；`成员一 自身盒右沿 = 378`；`成员一 子树并集右沿 = 542`；`成员带自身盒并集右沿 = 378`；`子树并集右沿 = 542`；`buildSummaryViews views = 1，memberBand 右沿 = 542` | **主张属实；探针有效证伪首版「不可观测」结论** |
| b | 首版失实日志原样保留未篡改 | 该目录整批于 `a8bb8b5` 首次入库（见 §4 finding），**本会话内无法与该批次之前的状态比对**；当前态文字**内部自洽地**呈现首版失实内容（`RED_EXIT = 0`、`18 passed`、`成员一子一/子二 上提为父的直接孩子`），且与被 REJECT 的评审 §七引用一致，**未见事后美化迹象** | **保留属实**；「与原物逐字比对」以只读方式不可核（见 §6 未核验声明） |
| c | neg1/neg2/neg4 三组红因均为目标断言、还原 cmp 一致 | **neg2-order 我独立完整重跑**：绿基线 exit 0（6 passed）→ 施变异（`SummaryLayer` 计数 2、挂载移至 tree-links 之后 edge-labels 之前，确认在盘）→ 红 exit **1**，`AssertionError: summaries 必须在 tree-links 之前: expected 2 to be less than 0`（`tests/summary-layer-host.test.tsx:110`）→ 自备备份 `cmp` **IDENTICAL**、复跑 exit 0。neg1/neg4：**读日志 + 读变异脚本**，红因分别为目标断言族与「摘除判定只能来自 satellites（单一事实源）」，变异脚本字节替换断言唯一，还原行均 `cmp IDENTICAL` | **主张属实**（neg2 全流程实测；neg1/neg4 未逐条复跑，见 §6） |

**关键机制核实**：`negctl/run-negctl-r2.sh` 的中性化步骤含**落盘硬校验**——`grep` 计数不等于期望即
判「本组红跑无效」并写 `REAL_EXIT_CODE=SKIPPED_MUTATION_NOT_APPLIED`，**不**把未落盘的变异计为绿。
这正是首轮「假绿」的拦截点；`neg3-rootbox-attempt1-note.md` 如实留档了 R2 首跑因 Python bytes
字面量含中文触发 `SyntaxError`、变异未落盘而得出 18 passed 的无效结果。**该机制可信，且施工方
主动留档了对自己不利的过程证据。**

### 2.2 [high 阻断] S5 文档收口

| 交付物 | 要求 | 实测 | 结论 |
|---|---|---|---|
| CHANGELOG 摘要段 | 顺延 S1–S5；如实记载「首版 REJECT → R2 返修收口，待独立复核」；负控条目改引 S5-R2 Mac 实测；层序串补 island-overview | 标题改为 `S1–S5`；正文「**本段记到 S5**：S5 首版（09-21）被独立复核判 REJECT…S5-R2 返修（09-22）…待独立复核」；负控条目「4 组，**S5-R2 Mac 实测**退出码 1」并注明「S5 首轮该组证据失实，已由 S5-R2 重做取代」；层序串补 `island-overview（IO-1 条件层）` | ✅ 属实 |
| 协议 §6.5 DOM 层序表 | 补 island-overview，且与 CONTRACT 数组、MapView 挂载序一致 | 表已补 `sections → island-overview（IO-1 条件层…） → summaries → tree-links → …`；我核对 `packages/react/tests/mapview-layer-order.test.tsx` 的 `CONTRACT = ['sections','island-overview','tree-links','free-edges','nodes','edge-labels','ghosts','drag']` 与 `MapView.tsx` 挂载序（`SectionLayer:1939` → `IslandOverviewLayer:1967` → `SummaryLayer:1983` → `tree-links:1985`）**三者一致** | ✅ 属实 |
| 协议 §十二 版本历史 | 同步 S1–S5 | `v1.12 候选` 行改为「S1–S5 已实现并验证（S5 首版 REJECT、S5-R2 返修收口）」 | ✅ 属实 |
| closeout.md | 候选终态 + 证据索引 + 未覆盖清单 12 条齐备如实 | 五节齐备（候选终态 / 证据索引 / 未覆盖清单 / AI 契约核验 / 边界声明）；清单实数 **12 条**（我逐行计数）；第 4 条**明写**「**Mac 未重跑浏览器矩阵**……此为已知边界，不冒充已验证」 | ✅ 属实，未冒充已验证 |
| AI 契约 summary_of 补读法 | :32 / :88-89 / :172 在位 | 逐行读原文：:32 入口指引「**节点级** `summary_of` — 概要括线」；:88-89 写法 + 成员须同父连续区间含两端 + `from == to` 单成员 + 嵌套禁入 + org/note.dir/框内不支持括线；:172 读写契约表含 `summary_of`。该文件自 `123d22b` 起**零改动**（`git diff` 为空），确为「已在位、不重复补写」 | ✅ 属实 |

### 2.3 三处缺陷修复

| 缺陷 | 要求 | 实测 | 结论 |
|---|---|---|---|
| [medium] 协议层序表漏 island-overview | 补记 | 见 §2.2，已补且与代码/契约三方一致 | ✅ |
| [low] `tools/verify-summary-supplement.mjs` 横幅与断言矛盾 | 头注释 H 行与节横幅改实测层序；F 行改实测口径；断言逻辑零改动 | :9 与 :469 均为 `sections → island-overview（IO-1 条件层） → summaries → tree-links → … → nodes`；:491 H2 描述串同步；陈旧横幅 `grep "背景 rect → tree-links"` **零命中**；:6/:342-343 改为「命令层不做替换……两次独立事务」实测口径。**断言逻辑零改动**：该文件在 `123d22b`/`6ead42a` **均不存在**、系 R2 新增（见 §4 finding），故「仅文案改动」不能靠 `git diff` 直证；我改用**语义核对**——H1/H2/H3 断言体（`idxSummary < idxNodes`、`idxSummary < idxTreeLinks`、背景 rect 在最底）与 S5 首版 `supplement-output.txt` 中 H0-H3 全 ✔ 的断言口径一致，无新增/放宽/删除断言 | ✅ 本质属实（取证方式受限，见 §4） |
| [low] `.gitignore` 漏 browser 日志否定规则 | 补 `!outputs/**/browser/*.log` 与 `!outputs/**/rootdep/*.log`；`git check-ignore -v` + `git add --dry-run` 实测；确认 S5 证据日志已入库 | `git check-ignore -v --no-index`：browser/preview.log → `.gitignore:22:!outputs/**/browser/*.log`（命中否定）；rootdep/positive.log 与 negctl-root-dep.log → `.gitignore:25:!outputs/**/rootdep/*.log`；无关日志仍命中 `.gitignore:8:*.log`（正确忽略）。`git add --dry-run` 三个文件**退出码 0**（可 staged）。`git ls-files 'outputs/summary-node/S5/**/*.log'` → **19 条**，其中**确含** `browser/preview.log`、`rootdep/negctl-root-dep.log`、`rootdep/positive.log` | ✅ 属实（且实测到「已实际入库」这一步，而非仅规则文本） |

### 2.4 门禁（实跑三项 + 读日志核数）

| 门禁 | 冻结基线 | 施工方 R2 主张 | 我的实测 | 结论 |
|---|---|---|---|---|
| `pnpm lint` | 1541 warnings / 48 infos | 逐数持平 | **实跑 exit 0**，`Found 1541 warnings. Found 48 infos.` | ✅ 逐数持平 |
| `packages/react` `npx vitest run tests/summary-` | 91 passed | 91 passed | **实跑 exit 0**，`Test Files 7 passed (7) / Tests 91 passed (91)` | ✅ |
| prod-build-isolation（有 dist） | 退出 0 | 2 passed | **实跑 exit 0**，2 passed | ✅ |
| prod-build-isolation（移走 dist） | 非 0 | exit 1，`MISSING_DIST` 原文 | `mv apps/canvas/dist` 后**实跑 exit 1**，2 failed，红因 `AssertionError: 生产产物缺失（apps/canvas/dist 下没有 .js）…`，断言名 `MISSING_DIST`（`:54` / `:70`）；**已将 dist 移回并复跑转绿（exit 0）** | ✅ |
| kernel 全包 | 708 | 708 | 读 `gates/kernel.log`：`Tests 708 passed (708)` | ✅ 核数 |
| react 全包 | 1636 | 1636 | 读 `gates/react.log`：`Tests 1636 passed (1636)` | ✅ 核数 |
| canvas 全包 | 396 | 396 | 读 `gates/canvas.log`：`Tests 396 passed (396)` | ✅ 核数 |
| typecheck / depcruise / budget | exit 0 | exit 0 | 读日志：typecheck `pnpm -r typecheck` 正常；depcruise `✔ no dependency violations found (565 modules, 1694 dependencies cruised)`；budget `✅ 全部指标在预算内（债务未增长）` | ✅ 核数 |
| 定向摘要（R2 日志） | 91 | 91 | 读 `gates/targeted-summary.log`：`Tests 91 passed (91)` | ✅ 核数 |

**门禁过程记录的诚实性核实**：`gates/run-gates-r2.sh` 注释如实记录首跑（14:50）把 `$?` 写在与
`$(STAMP)` 同一字符串致命令替换先执行、pbi-red 真实 exit 1 被误记为 0，并说明以最终轮为准。
我实跑 `prod-build-isolation` 红向得 exit 1，且最终 `run.log` 记 `prod-build-isolation-red EXIT=1`，
**与该说明自洽**。最终轮 `run.log` 各 EXIT 行由 `code=$?` 单独捕获后输出，逻辑正确。

### 2.5 产品零改动与浏览器证据沿用论证

| 要求 | 我的实测 | 结论 |
|---|---|---|
| `git diff 123d22b..HEAD -- packages/` 为空 | 输出**全空** | ✅ |
| `apps/` 仅 `vite.config.ts` | `git diff --name-only` 仅 `apps/canvas/vite.config.ts`；内容为 `decodeURIComponent(...pathname)` 的**构建路径解码**（`6ead42a` 另同修 3 个 tools 的 `ROOT`），不触产品语义 | ✅ |
| bundle sha256 = `159e2d1a…`，且与 S5 证据 `bundle-hash.txt` 一致 | `shasum -a 256 apps/canvas/dist/assets/main-BgdfvXm7.js` = `159e2d1a8e3c452757daf48e195ce882e175c654eaa4f4057e2189cffb06797a`（450702 B）；与证据 `bundle-hash.txt` 的 `disk_sha256` / `served_sha256` 逐字相同 | ✅ |

**独立判断：零 diff + bundle 逐字节一致是否足以支撑证据沿用？——成立，且论证可再加强一层。**

理由：(1) 浏览器矩阵的证据对象是**被服务并加载的那个 bundle**，而非源码树；产出该 bundle 的输入
（`packages/`）在 R2 候选上零 diff，唯一源码侧差异是**构建器**（vite 配置的路径解码）。(2) 关键的
不是「推断应当一致」，而是**可实测的字节同一**：我进一步取 S5 证据目录内**已入库**的
`browser/served-main-BgdfvXm7.js`（即当年被真实浏览器加载的服务端副本）与当前树重新构建的
`apps/canvas/dist/assets/main-BgdfvXm7.js` 做 `cmp`，结果 **IDENTICAL**（同为 450702 B，同 sha256）。
这使「按产物身份沿用」从「零 diff 的推理」升级为「产物级逐字节实证」——构建器差异**未**改变任何
输出字节。(3) 沿用边界已如实声明：Mac **未**重跑浏览器矩阵（playwright 依赖为 Windows 全局路径），
此项**不是**被冒充为已验证，而是明确记入未覆盖清单第 4 条。

### 2.6 证据自洽性交叉检查

- **阳性对照**：S4-R2 的 `neg3-rootbox.log`（同 `subtreeBBox → ln.box` 变异）早于 S5 即为
  `REAL_EXIT_CODE=1`、红因 `expected 378 to be greater than or equal to 541.999999`（:368）——
  与首轮 S5 的 `RED_EXIT = 0` 直接矛盾，佐证「首轮变异未生效」，印证 R2 的根因更正。
- **探针路径**：`probe-rootbox.mjs` 从 `packages/kernel/dist` 与 `packages/react/dist` 导入
  `layoutMindmap` / `buildSummaryViews`；我重跑 exit 0 且数值自洽，说明 dist 为未变异态且与
  source 口径一致。
- **终态自检**：`packages/react/src/` 下 `NEUTERED` 命中 **0 文件**（我独立 grep 复核），
  与 `run.log` 自检一致，无变异残留。

---

## 3. 阻断闭合判定

| 阻断 | 级别 | 闭合判定 | 依据 |
|---|---|---|---|
| neg3-rootbox 阴性对照失实 | high | **已闭合** | §2.1：同形变异独立复跑真实转红（exit 1，:368 断言原文逐字），还原 `cmp` IDENTICAL + 复跑转绿；根因探针独立复现，逐数一致；落盘硬校验机制有效拦截「未落盘即跑测」的假绿 |
| S5 文档收口缺失 | high | **已闭合** | §2.2：CHANGELOG 顺延 S1–S5 并如实记载 REJECT→R2；协议 §6.5 层序表与 §十二 已补且与代码/契约三方一致；closeout.md 三件齐备、未覆盖 12 条、Mac 边界如实声明；AI 契约补读法在位 |

---

## 4. Findings（分级 + 依据）

**[medium] `outputs/summary-node/S5/S5-20260921-230000/` 整批证据于 `a8bb8b5` 首次入库，其原始性在本会话内不可核。**

- 依据：`git log --oneline --all -- "outputs/summary-node/S5/**"` 仅返回 `a8bb8b5` 一条；
  `git diff --name-only 6ead42a..a8bb8b5 -- "outputs/summary-node/S5/**"` 新增 **85** 文件；
  `git cat-file -e 123d22b:…/negctl/neg3-rootbox.log` → `fatal: … exists on disk, but not in '123d22b'`。
  即：被评审 REJECT 引用的那批「S5 首版原始证据」**并未**存在于 `123d22b` 提交中，而是在 R2 提交里
  与 R2 证据**一并**入库。
- 影响与判断：这**不等于**证据失实。① 时间线可信：提交信息如实分两阶段（`123d22b` 为 S5 候选、
  `6ead42a` 为 Mac 适配），未声称 S5 证据随 `123d22b` 入库；评审在 `123d22b` 上做的是**代码侧**
  核对（其 §七明确写「未核验的部分：未重跑浏览器 MCP 矩阵…读的是 verify-output.txt」），
  说明评审当时已在文件系统看到该目录。② 内容自洽：首版 neg3 日志呈现**对己不利**的失实内容，
  且与 REJECT 报告的引用逐字一致，未发现事后改写迹象。③ 与本次两项阻断的闭合判定**无因果冲突**：
  neg3 由 R2 独立重做取代，首版日志仅作历史留存。
- 结论：**不足以推翻 ACCEPT**，但构成一条应显式声明的**可追溯性边界**——若下游需要「REJECT 所依据
  的原始证据未被事后触碰」的强保证，则须以该目录的只读备份/工作树快照另行比对，本仓 git 历史
  不提供该保证。建议后续批次把证据目录随其候选提交入库（与 S4-R2 的做法一致）。

**[low] `tools/verify-summary-supplement.mjs` 的「断言逻辑零改动」主张不可由 git diff 直证。**

- 依据：该文件在 `123d22b` 与 `6ead42a` 均**不存在**（`git cat-file -e` 两次 fatal），系 `a8bb8b5`
  **新增** 728 行；`git diff 123d22b..HEAD -- tools/verify-summary-supplement.mjs` 为 `new file`，
  故无法用 diff 证明「仅改文案、断言未动」。
- 影响与判断：施工方回执 §四.2 以「断言逻辑零改动（仅文案）」表述，**取证方式与事实不符**
  （不存在可供 diff 的基线）；但其**实质主张可独立验证成立**：我以语义核对——H1/H2/H3 断言体与
  S5 首版 `supplement-output.txt` 中 H0-H3 全 ✔ 的断言口径一致，未见新增/放宽/删除断言；
  陈旧横幅 `grep "背景 rect → tree-links"` 零命中。
- 结论：**表述瑕疵，非证据失实**，不阻断。建议回执改为「相对 S5 首版输出的断言口径一致」
  之类的可核表述。

---

## 5. 未核验声明（如实列出，不含糊）

以下项**我未核验**，不得视为已通过：

1. **Mac 真机浏览器矩阵**：未重跑。经用户决策由施工方沿用 Windows 106 断言证据；我只做了
   §2.5 的**产物字节同一性**实证（`cmp` IDENTICAL）与证据文本实读，未在真实浏览器中执行任何断言。
2. **kernel 708 / react 1636 / canvas 396 全量三套件**：未重跑，仅**读 R2 日志核数**（708/1636/396）。
3. **typecheck / depcruise / budget**：未实跑，仅读日志（depcruise 记 `565 modules, 1694 deps` 无违规；
   budget 记全部指标在预算内）。
4. **neg1-unmount / neg4-nofilter 的变异复跑**：未逐条重跑，仅读日志 + 读变异脚本（脚本字节替换断言
   唯一、还原 `cmp IDENTICAL`）。**neg2-order 与 neg3-rootbox 已独立完整重跑。**
5. **rootdep 负控与 S5 首版 browser/supplement 输出内容**：未重跑，仅读文本。
6. **首版证据目录「未被篡改」的强保证**：见 §4 finding——无法与入库前状态比对，**未核验**。
7. **closeout.md 未覆盖清单 12 条中除 Mac 边界外的其余各条**（如 IME、原生文件选择器、Canvas 后端、
   降级域等）：未逐条重跑验证，仅确认其被如实列出。
8. **`tools/probe-supplement-failures.mjs`（R2 新增 108 行）**：未审读其内容与用途。
9. **Windows 侧任何重跑**：本轮全部在 Mac 进行，未在 Windows 原环境复测 R2 候选。
10. **验收工具的 playwright 依赖**（`file:///C:/Users/…` Windows 全局路径）：未在 Mac 适配，故
    `verify-summary.mjs` / `verify-summary-supplement.mjs` 本机不可运行——这也是浏览器矩阵未重跑的
    直接原因，属**已知边界**而非隐瞒。

---

## 6. 最终判定

**ACCEPT。**

- 两项 high 阻断**均有效闭合**：neg3-rootbox 经我独立复跑真实转红（exit 1，目标断言原文逐字，
  还原 `cmp` 逐字节一致），根因更正探针独立复现且逐数吻合；S5 文档收口（CHANGELOG 顺延 S1–S5 +
  协议 §6.5 层序表补 `island-overview` 且与 CONTRACT/挂载序三方一致 + closeout.md 候选终态/证据索引/
  未覆盖 12 条 + AI 契约补读法在位）齐备如实。
- 三处缺陷修复**属实**：协议层序表已补；工具横幅与自身断言对齐、陈旧文案零残留；`.gitignore`
  两条否定规则经 `check-ignore` + `add --dry-run` + `ls-files` 三重实测生效，S5 证据日志确已入库。
- 门禁**实测逐数持平**：lint 1541/48、定向 91、prod-build-isolation 双向（0 / 1 且红因 MISSING_DIST 原文，
  验后 dist 已移回复绿）；其余读日志核数与冻结基线一致。
- 产品**零改动**（`packages/` 空 diff），且 bundle 与 S5 浏览器矩阵实际加载产物**逐字节相同**
  （我以已入库的 `served-main-BgdfvXm7.js` 与当前构建 `cmp` 实证），证据沿用论证成立。
- **无新 high finding。** 附两项不阻断的观察（§4）：S5 首版证据整批在 R2 提交入库、
  致其原始性在本会话内不可核（medium，可追溯性边界）；工具「断言逻辑零改动」表述取证方式与
  事实不符（low，实质主张经语义核对成立）。

---

## 7. 本轮边界声明

- 本轮**未** push / 合并 / 发布 / amend；**未**修改候选任何被审文件（唯一的变异为复核所需的
  `summaryFrames.ts` 与 `MapView.tsx` 临时改动，均以自备备份 `cp` 还原并经 `cmp` 逐字节校验，
  终态 `git status --porcelain` 为空、`NEUTERED` 残留 0）。
- `outputs/summary-node/S5/S5-20260921-230000/` 旧证据目录**只读**，未改动（`git status --ignored`
  对该目录为空）。
- 真实退出码一律重定向后取 `$?`（非管道）；未使用 `it.fails` / 反转断言 / catch 报通过 / 宽泛 skip。
- 本回执为独立复核结论，判定权与责任在复核方；施工方回执的结论性表述未被采信为依据。
