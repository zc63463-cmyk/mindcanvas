# S5-R2 返修回执（neg3 对照重做 + 文档收口 + 三处缺陷修正）

- **RunId**：`S5-R2-20260922-142654`
- **日期**：2026-09-22
- **返修对象**：S5 首版候选 `123d22b773a06c4b8e3f6aa987e5493a2e3fce1b`（独立复核判 **REJECT**，
  报告 `docs/dispatch/2026-09-21-summary-node-s5-report.md` 第七节两项阻断）
- **环境**：macOS（Apple Silicon，Darwin arm64）/ node v24.21.0 / pnpm 10.33.2 / vitest v4.1.11
  （本仓 git 历史由便携包 `history/mindcanvas.bundle` 恢复；打包工作树为 CRLF，提交内容为 LF，
   本地 `core.autocrlf=true` 对齐）
- **证据目录**：`outputs/summary-node/S5-R2/S5-R2-20260922-142654/`

---

## 一、提交序列与基线锚定

| # | 提交 | 内容 |
|---|---|---|
| 1 | `123d22b`（S5 首版候选，判 REJECT） | 谱系 `7322575 → ceb0573 → a049930 → 123d22b`（线性单父） |
| 2 | `6ead42a` `chore(mac): 便携环境路径适配` | 4 处 `decodeURIComponent` 路径解码（`apps/canvas/vite.config.ts` 的 `pkgSrc`、`tools/lib/releaseAcceptance.mjs` 与 `tools/lib/snapshotCheck.mjs` 的 `ROOT`、`tools/verify-release-123.mjs` 的 `ROOT`）——打包目录含空格，URL pathname 百分号编码致构建/工具解析死路径。**构建/工具链适配，不改产品语义** |
| 3 | 本回执所在提交（`docs+test: S5 返修…`） | 分支 `codex/summary-node-s5-r2-20260922` 顶端；SHA 以 `git rev-parse HEAD` 复核（父 = `6ead42a`） |

**产品源码零改动（沿用浏览器证据的前提）**：
`git diff 123d22b..R2 -- packages/` **为空**；`apps/` 仅 `vite.config.ts` 一处路径解码。
**产物级等价（比零 diff 更硬）**：R2 树上 `pnpm -r build` 产出
`apps/canvas/dist/assets/main-BgdfvXm7.js`，sha256
`159e2d1a8e3c452757daf48e195ce882e175c654eaa4f4057e2189cffb06797a`（450702 B），
与 S5 Windows 浏览器矩阵**实际加载并验收的 bundle 逐字节一致**
（`cmp` IDENTICAL；哈希与 `outputs/summary-node/S5/S5-20260921-230000/browser/bundle-hash.txt` 记载相同）。

## 二、阻断 1（high）修复：neg3-rootbox 阴性对照重做

### 2.1 首轮失实回顾

首轮 neg3-rootbox.log 自称：变异（`subtreeBBox(ln)` → `ln.box`）已落盘且 dist 含标记，
但测试 18 passed、`RED_EXIT=0`，并归因「当前布局产物中成员扁节点无 children，
`subtreeBBox(ln) ≡ ln.box`，变异不可观测」。评审独立复跑证伪：同一变异下
`tests/summary-frames.test.ts` 真实转红（1 failed | 17 passed，exit 1）。

### 2.2 R2 重做结果（四组全部在 Mac 重跑，六步流程 + 双重防护）

每组流程：① 备份 → ② 绿基线（真实退出码）→ ③ 中性化（python3 字节替换，
断言命中 + **落盘硬校验**：grep 计数必须等于期望，否则判无效组跳过红跑）→
④ 变异后跑目标测试（重定向取真实退出码）→ ⑤ 备份还原（**cmp 逐字节**）→ ⑥ 复跑绿。
不重建 dist（react 测试直接 `import '../src/render/summaryFrames.js'`，与评审复跑同口径）。

| 组 | GREEN | RED | 红因（目标断言原文） | RESTORED | 还原校验 |
|---|---|---|---|---|---|
| neg1-unmount（删 SummaryLayer 挂载） | 0 | **1** | `tests/summary-layer-host.test.tsx` 5/6 红，宿主括线断言族（含「括线不参与命中：pointer-events 为 none」） | 0 | cmp IDENTICAL |
| neg2-order（摘要层挪到 nodes 之后） | 0 | **1** | `AssertionError: summaries 必须在 tree-links 之前: expected 2 to be less than 0` | 0 | cmp IDENTICAL |
| **neg3-rootbox（成员带改用自身盒）** | 0 | **1** | `AssertionError: 带右沿必须覆盖成员的子树（否则是「根盒代子树带」的阴性对照目标）: expected 378 to be greater than or equal to 541.999999`（`tests/summary-frames.test.ts:368`，1 failed \| 17 passed） | 0 | cmp IDENTICAL |
| neg4-nofilter（删 satellites 空早退） | 0 | **1** | `AssertionError: 摘除判定只能来自 satellites（单一事实源）: expected [ { …(10) } ] to have a length of +0 but got 1` | 0 | cmp IDENTICAL |

证据：`negctl/neg1-unmount.log`、`neg2-order.log`、`neg3-rootbox.log`、`neg4-nofilter.log`、
驱动脚本 `negctl/run-negctl-r2.sh` 与变异定义 `negctl/mutate-*.py`；终态自检两文件
`grep NEUTERED` 均为 0（无残留）。

### 2.3 根因更正与撤回（对应评审 [medium] 错误归因项）

同形夹具探针（`negctl/probe-rootbox.mjs` → `probe-rootbox.log`，夹具与
`tests/summary-frames.test.ts:347-369` 逐字一致，经真实
`layoutMindmap(..., { satellite: satelliteHook })`）实测：

```
成员一扁节点 children 数 = 1（children 文本：孙节点很长的名字）
孙节点盒右沿 = 542；成员一自身盒右沿 = 378；成员一子树并集右沿 = 542
成员带（成员一..成员三）自身盒并集右沿 = 378；子树并集右沿 = 542
buildSummaryViews（生产口径，react dist）memberBand 右沿 = 542
```

即：**成员在扁表保留子树（子孙未「上提」），两口径差 164px、完全可观测**。
首轮探针的「成员一子一/子二 上提为父的直接孩子」是其夹具书写错误（孙辈被写成兄弟级）
导致的自证等价；「没有任何成员节点在扁表里带 children」「subtreeBBox(ln) ≡ ln.box」
「该变异不是有效阴性对照」三项结论**全部撤回**。首轮日志原样保留
（`outputs/summary-node/S5/S5-20260921-230000/negctl/neg3-rootbox.log`），不删不改。

### 2.4 首轮「假绿」失效机制（R2 实测复现）

R2 首跑（14:35）中，neg3 变异脚本因 Python bytes 字面量含中文触发 `SyntaxError`，
**变异未落盘**，驱动照跑「变异后」测试 → 18 passed、RED=0 —— 与首轮 Windows 异常
现象同构（名义已变异、实测全绿）。该失效已被 R2 驱动的落盘硬校验拦截并留档
（`negctl/neg3-rootbox-attempt1-note.md`），修正后真实转红。据此对首轮异常的归因：
其「grep 确认命中 / dist 含标记」自述**不可复现**，最可信机制即「变异未实际生效
（或未在跑测时生效）」，而非「语义等价」。

### 2.5 无作弊声明

不用 `it.fails` / 反转断言 / catch 报通过 / 宽泛 skip；红因均为目标断言原文；
退出码一律重定向后取 `$?`（非管道）；还原经 `cmp` 逐字节校验。

## 三、阻断 2（high）修复：S5 文档收口（任务书 S5 三件套 + 收口文档）

| 交付物 | 落点 | 状态 |
|---|---|---|
| CHANGELOG 顺延 | `CHANGELOG.md` 摘要节点段：`S1–S4` → `S1–S5`，如实记载「S5 首版 REJECT → S5-R2 返修收口，待独立复核」；层序串补 `island-overview`；负控条目改引 S5-R2 Mac 实测 | ✅ |
| 协议补记 | `docs/specs/2026-09-02-mm-md-protocol.md` §6.5 DOM 层序表补 `island-overview`（IO-1 条件层）并注明「S5-R2 补记——首版表遗漏」；§十二版本历史同步 S1–S5 | ✅ |
| AI 契约补读法 | 核验**已在位**：`docs/specs/2026-09-17-mm-md-ai-contract.md` :32（入口指引）/ :88-89（写法 + 嵌套禁入 + 支持边界）/ :172（读写契约表），无缺失，不重复补写 | ✅ |
| S5 收口文档 | `outputs/summary-node/S5-R2/S5-R2-20260922-142654/docs/closeout.md`（候选终态 + 证据索引 + 未覆盖清单 + AI 契约核验记录）+ 同级 `README.txt` | ✅ |
| dispatch 回执 | 本文件 | ✅ |

## 四、非阻断缺陷修复（评审 §六 findings 3 处）

1. **[medium] 协议 §6.5:445 层序表漏 `island-overview`** —— 已补（见上表），
   依据列对齐 `MapView.tsx` 挂载序与 `mapview-layer-order.test.tsx` CONTRACT 数组。
2. **[low] `tools/verify-summary-supplement.mjs` 横幅与断言矛盾** —— :8（头注释 H 行）与
   :467（section 横幅）改为实际 DOM 契约 `sections → island-overview（IO-1 条件层）→
   summaries → tree-links → … → nodes`；:6（头注释 F 行）改为实测口径（命令层不替换，
   同区间再创建 → 2 条括线，FA1/FA2；删除后重建不叠加，F2–F4）；:491 H2 断言描述串同步
   补 `island-overview`。**断言逻辑零改动**（仅文案）。
   > **Errata（2026-09-22，回应独立复核 [low] finding）**：上述「断言逻辑零改动」
   > 的取证方式**不是 git diff**——R2 改动前的 `verify-summary-supplement.mjs` 版本
   > 未随 S5 首版候选入库（该工具为 S5 新增，远端基线 b808486 之前无此文件的历史锚点
   > 可供 diff），故本回执无法以「`git diff <base>..HEAD` 断言段为空」直证。
   > 实际取证为**语义核对**：逐条比对 R2 前后版本中 `check(...)` 调用的断言表达式、
   > 目标变量与比较运算符，确认仅横幅/描述串（H/F 头注释、section 横幅、H2 断言
   > message 参数）变化，`expect(...)` 的实参与断言逻辑未变。该结论在语义层成立，
   > 但缺乏可复现的 diff 基线，特此如实声明方法边界。
   验证：`grep "背景 rect → tree-links"` 全文件零命中（陈旧横幅已清）。
3. **[low] `.gitignore` 漏 browser 日志否定规则** —— 补 `!outputs/**/browser/*.log`
   （gitignore-scope.txt 方案 A），并把「gates/negctl 内任意命名 .log 放行」记为显式债务；
   落地时另发现同类缺口 **rootdep/**（root 透传依赖负控证据，S5 实际产出
   `rootdep/negctl-root-dep.log` / `positive.log`，同样会被 `*.log` 静默跳过），一并补
   `!outputs/**/rootdep/*.log`。
   验证：`git check-ignore -v` 命中新否定规则；`git add --dry-run` 于
   `outputs/…/browser/preview.log` 可 staged；negctl/gates 日志仍放行。

## 五、验收门禁（Mac 实测，2026-09-22，与 S5 冻结基线同口径）

| 门禁 | 退出码 | 实测 | 冻结基线 | 判定 |
|---|---|---|---|---|
| build（pnpm -r build） | 0 | 产物 `main-BgdfvXm7.js` sha256 与 Windows 证据一致 | — | ✅ |
| kernel 全包 | 0 | Tests 708 passed (708) | 708 | ✅ |
| react 全包 | 0 | Tests 1636 passed (1636) | 1636 | ✅ |
| canvas 全包 | 0 | Tests 396 passed (396) | 396 | ✅ |
| typecheck | 0 | exit 0 | exit 0 | ✅ |
| depcruise | 0 | exit 0 | exit 0 | ✅ |
| lint | 0 | **Found 1541 warnings. Found 48 infos** | 1541 / 48 | ✅ 逐数持平 |
| budget | 0 | exit 0 | exit 0 | ✅ |
| 定向摘要（react 七文件） | 0 | Tests 91 passed (91) | 91 | ✅ |
| prod-build-isolation（有 dist） | 0 | 2 passed | exit 0 | ✅ |
| prod-build-isolation（移走 dist） | **1** | 2 failed（`MISSING_DIST` 断言原文） | 非 0 | ✅ |

证据：`gates/run.log` + 各分项日志；驱动脚本 `gates/run-gates-r2.sh`。
**过程记录（如实）**：门禁共跑三轮 —— 首轮（14:50）`run.log` 的三个内联步骤把 `$?`
写在与 `$(STAMP)` 同一字符串，命令替换先执行导致 EXIT 行误记为 0（pbi-red 真实
exit 1 被误记）；二轮（14:56）修复捕获方式后，`EXIT=$code（` 又触发本机 bash 3.2
「变量名后随多字节字符」解析 bug，该行未输出。三轮（15:0X，最终）两处均已修，
以最终 `run.log` 为准；各分项日志（vitest 输出本身）三轮均完整有效、结果一致。

## 六、浏览器证据沿用论证（Mac 不重跑的边界，如实声明）

- R2 候选与 123d22b 的差异**不含产品源码**：`packages/` 零 diff；`apps/` 仅
  `vite.config.ts` 构建路径解码。
- Mac 重新构建的生产 bundle 与 S5 Windows 浏览器矩阵实际加载的 bundle
  **逐字节一致**（sha256 相同，见 §一）→ 106 断言浏览器矩阵与普通文档逐位等价证据
  **按产物身份沿用**，不因平台迁移而失效。
- 未做：Mac 真机浏览器复跑（用户决策沿用；两个 verify 工具的 playwright 依赖为
  Windows 全局路径 `file:///C:/Users/…`，Mac 适配留后续批次）。此为**已知边界**，
  记入未覆盖清单，不冒充已验证。

## 七、未覆盖项

见 `outputs/summary-node/S5-R2/S5-R2-20260922-142654/docs/closeout.md` 第三节
（S5 报告 §八 10 条如实重申 + 「Mac 未重跑浏览器矩阵」「R2 门禁为 Mac 复测」两条新边界，
共 12 条），此处不重复罗列。

## 八、边界声明

- 本轮**未** push / 合并 / 发布 / amend；未改 `123d22b` 及之前任何提交。
- `outputs/summary-node/S5/S5-20260921-230000/` 原始证据（含被证伪的 neg3 日志与
  REJECT 报告）原样保留、不删不改；本回执与 R2 证据为**新增**，不覆盖旧证据。
- 阴性对照四组与门禁在 `123d22b + 6ead42a` 产品源码上执行（R2 其余改动不触及
  产品源码，`git diff -- packages/` 为空为证）。
- **判定权在独立复核**：本回执不预设结论；复核可按 §二/§五 的证据路径逐项复跑。
