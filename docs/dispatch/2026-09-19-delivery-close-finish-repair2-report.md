# DELIVERY-CLOSE 深度收尾返修（第二轮 · DF-R5）· 执行回执 · 2026-09-19

> 输入：`docs/dispatch/2026-09-19-delivery-close-finish-repair-review.md`（最新裁决：DF-R1/R3 关闭、DF-R4 当前输出范围认可、仅剩 **DF-R5**）。
> 工作区：`<workspace>`（唯一）。HEAD：**`a2ce72bf122574815bf1b9134253a7bd0349c038`（未变）**；分支 `main`。
> **未 commit / push / pull / rebase / reset / stash；未整树暂存；未发版；未提高预算；未覆盖他方文件；未启动图库/文件管理实现或第 4 项。**
> 工具：pnpm **10.33.2** · Node **v24.15.0** · Chromium（Playwright core）· 本轮独占预览端口 **5179**。
> 证据根目录：**`outputs/delivery-close-finish/20260919-04/`**（RunId `20260919-04`）。
> 主控目录 `outputs/delivery-close-owner-review-20260919-01/` 与 `…-02/`、以及 `20260919-02/`、`20260919-03/` 全部**只读、未覆盖**。
> **本轮只改验收工具与文档**：产品源码、测试、门禁配置**逐字未动**（§4 有候选差异为证）。
> **结论上限：可复核。** 不宣称主控放行、不宣称已发布。

---

## §0 摘要

| 项 | 结果 |
|---|---|
| DF-R5 红→绿 | 主控同格式目的地探针（副本）**exit 1 → exit 0**：`aScope=open:main:release-123.mm.md`、`bScope=save:release-123-saved.mm.md`，A 读回 `A SAVED`、B 读回 `B SAVED` |
| 三层身份 | 夹具来源 / 目的地 id（`open:<夹具来源>:<名>` ｜ `save:<名>`）/ 句柄对象 三层拆开；同名但来源不同也不合并；换 handle 重开读回同一 committed |
| 既有契约 | 创建时冻结归属、pending 不可读、`close()` 成功才入账、失败不推进成功快照、跨夹具旧句柄、**stale-json 读取覆盖** —— 全部保留（专项探针 19/19） |
| 浏览器新旅程 | **R7**（真实 UI 点「另存为」触发 `showSaveFilePicker`）6 项全绿；A/B 各自最后快照、B 后续写入不改 A、A pending/失败不改 B、换 handle 重开读最新成功快照 |
| 行为负控 | 新增 **`neg-saveas-share`**：只让「另存为目的地」塌回当前已打开文件的身份 → **只** R7b/R7c/R7d/R7e/R7f 红，R1–R6 全绿（证明负控只打隔离） |
| 正常矩阵 | **53/53 PASS，退出码 0**，实际加载 `main-Db31m2so.js`（与上一轮同一产物） |
| 负控总账 | **7 个行为负控全部各自命中目标**（+1 冻结守卫篡改 exit 3）；全部 53 项固定集合一致；**环境失败 0** |
| 候选 | **808 项**（746 tracked + 62 untracked，0 删除）立即复算 **0/0/0**；与 805 项的差异 = 仅 `tools/verify-release-123.mjs` + 3 份文档变更/新增，**产品/门禁路径 0 处** |
| 门禁 | **产品源码与测试未改** → 按复核口径引用 `20260919-03` 的 `gate/build/analyze` 0 与 2489 测试；本轮**未**机械重跑全仓门禁 |
| 既有旅程 | `verify-save-lifecycle.mjs` **PASS** · `verify-mode-guard.mjs` **PASS**（同候选、同 bundle，本轮实跑） |
| 勘误 | 见 §6：R5b 是**指标替换**；R5c 只保证 **≥2 个 depth**；旧回执 §4.2 的连带红归属与 §5.1 的 804 项 |

---

## §1 复现（**用副本，未覆盖主控证据**）

两个文件复制到 `outputs/delivery-close-finish/20260919-04/repro/`：`audit-copy.mjs`（只改 `dest` 与导入深度）、`same-format-probe-copy.mjs`（同目录 import，逐字相同）。

返修前实测（`repro/same-format-probe-before.log` + `audit-copy.json`）：

```text
sameFormatDestinations: aName=release-123.mm.md  bName=release-123-saved.mm.md
                        aExpected=A SAVED  bExpected=B SAVED
                        aActual  =B SAVED  bActual  =B SAVED     ← A 被 B 覆盖
                        aScope=md:main     bScope=md:main       ← 两个不同文件共用存储身份
crossFixture:           expected=MAIN FILE  actual=MAIN FILE     ← 跨夹具那条已修好，未被本轮破坏
exit 1（正式期望：红）
```

---

## §2 DF-R5 实现：目的地三层身份

### 2.1 修复前的问题

`makeHandle()` 已在创建时冻结身份，但身份本身只有 `md:<fixtureKind>`：

```js
const scopeOf = (kind) => (kind === 'md' ? `md:${window.__fixtureKind}` : kind);
// 打开 A：release-123.mm.md        → md:main
// 另存为 B：release-123-saved.mm.md → md:main   ← 撞同一存储键
```

### 2.2 现在的三层

| 层 | 取值 | 说明 |
|---|---|---|
| ① **夹具来源** | `fixtureKind`（main/centers/pure/nested） | 决定「打开选择器返回的那份文件」的种子内容 |
| ② **目的地 id** | 打开：`open:<夹具来源>:<文件名>`；另存为：`save:<文件名>` | 账本存储键。两个不同 md 文件必得两个 id；**同名但来源不同**（open vs save）也不合并；同一份文件重复打开 → 同一 id |
| ③ **句柄对象** | 一次性外壳，自带 `destinationId` 与创建时冻结的 `originalText` | 重建句柄只复用存储，**不重置**内容 |

同时新增：

- **目的地表** `destinations: id → { seed }`，seed 在**首次见到该目的地**时固定。打开目的地 seed = 该夹具原文件；另存为目的地在磁盘上尚不存在 → seed = 空（真正的「新文件」）。这正是「不能每次 picker 都造空文件」与「新目的地初始为空」两条的同时满足。
- **`__rejectAll()`**：让 gate reject，用于「`close()` 失败不记账、不推进成功快照」的可测路径（失败由 `close()` 如实抛出，`gate.catch` 只防 unhandled rejection）。
- Node 侧等待口径：`saveViaClick` 从「盯固定 scope 的计数」改为**全局已完成写入数** + 回报 `lastScope`（另存为之后会话目的地已换文件，继续盯旧 scope 会永远等不到）；`R1c` 额外断言**本次新完成写入落在打开的那份文件上**。
- `R6f` 的 `lastCommitted` 从固定 `'json'` 键改为**这份画布文件自己的目的地**。

### 2.3 专项探针（真实注入源码，19 条 + 负控 + stale-json 覆盖）

`repro/dest-isolation-probe.mjs`（`dest-isolation-probe.json`）：

```text
formal 19/19 PASS：
  A/B 目的地 id 不同 · 写 B 之后 A 仍读自己内容 · B 读自己内容 · B 再写一次仍不改 A ·
  B 更新为自己的新快照 · 同名（save 与 open 同名）仍不合并 · 同名新目的地初始为空 ·
  同名目的地写入后 A 仍不变 · 重开得到新句柄对象 · 重开指向同一目的地 ·
  重开读回最新成功快照（不是空文件）· pending 期间 A 仍读旧快照 · pending 期间 B 不受影响 ·
  close 失败如实抛出 · close 失败不记账 · 失败不推进成功快照 · 失败不推进 B ·
  跨夹具切换后 A 仍读 MAIN · 跨夹具切换后新打开的 pure 目的地独立
negativeControl（只中性化目的地隔离）：12 条转红，全部指向隔离本身
staleJsonCoverage：读取恒返回原始夹具（readAfterWrite={"canvas":"JSON FILE"}），而该文件 committed 已是 REWRITTEN → 覆盖仍在
```

### 2.4 真实浏览器旅程 R7（走 UI）

放在矩阵末尾（本旅程会把会话目的地切到新文件、并改写 main 夹具文本，置末不扰动 R1–R6）。开头 `goto` 新开一页，A 的首个 committed 就发生在 R7a。

| caseId | 断言 | 实测 |
|---|---|---|
| R7a | 打开文件 A 保存：新完成写入落在 **A 的目的地** | `lastScope=open:main:release-123.mm.md`；286 bytes |
| R7b | **真实点「另存为」** → 写入落在**新目的地 B**，A 的最后快照逐字不变 | `bDest=save:release-123.mm.md`（**B 名与 A 同名**，应用把 `suggestedName` 传成当前文件名 → 恰好覆盖「同名不同文件」）、`aUnchanged=true` |
| R7c | B 的后续保存只改 B | `lastScope=save:release-123.mm.md`、`aUnchanged=true`、`bAdvanced=true` |
| R7d | A 的 **pending**（write 未 close）不改 A 也不改 B | `aAfterPending=unchanged`、`bSame=true` |
| R7e | A 的 **close 失败**（gate reject）不推进成功快照、不改 B | `threw=true`、`aAdvanced=false`、`bSame=true` |
| R7f | 换 handle 重开同一文件 | `newHandleObject=true`、`sameDest=true`、读回 == A 的最新成功快照（非空） |

> R7d/R7e 直接在**替身**上操作（浏览器里没有「让系统写入失败」的 UI 入口）—— DF-R5 的对象本来就是替身契约；仍在真实浏览器、同一份注入句柄上执行。R7a–R7c、R7f 是端到端 UI 旅程。

---

## §3 负控总账（固定集合 53 项，环境失败 0）

覆盖 `--inputs` 全量冻结校验；正常与全部负控的 caseId 集合与顺序完全一致。

| 负控 | 机制（**期望值一律不变**） | 退出码 | 目标红项 | 连带红项 | 环境错误 |
|---|---|---|---|---|---|
| `neg-undoredo` | 运行期省略 Ctrl+Z | 1 | R1e | 无 | 0 |
| `neg-stalejson` | json 读取恒返回原始夹具 | 1 | R6d / R6f | R6e | 0 |
| `neg-canvas` | 不加速 `?backend=canvas` | 1 | R5a / R5b | R5d、R5c | 0 |
| `neg-endpoints` | 扰动独立夹具副本的跨框边端点 | 1 | R3d | 无 | 0 |
| `neg-theme` | 扰动独立导出 SVG 副本的字号 | 1 | R2d | 无 | 0 |
| `neg-canvas-links` | 只把路径几何指令打成空函数 | 1 | R5d | 无 | 0 |
| **`neg-saveas-share`** | **只**让另存为目的地塌回当前已打开文件的身份（打开侧 id 不变） | 1 | **R7b / R7c** | R7d、R7e、R7f（都源于 A/B 共用身份） | 0 |
| `freeze-guard`（tamper） | 输入冻结清单副本里驱动哈希改全 0 | **3** | 停止该运行，**不产出 results.json** | — | — |

`neg-saveas-share` 的设计要点：最初版本把**打开侧** id 也一起塌回 `md:<fixtureKind>`，结果 R1c/R1f/R3f/R6c 等「本次写入落在哪份文件」的正常断言因**命名口径变化**一起变红 —— 那不是「只打隔离」。收窄为**只塌另存为目的地**后：**只有 R7 家族 5 项红**，R1–R6 全绿，负控真正指向 DF-R5。

---

## §4 候选、输入与门禁口径

### 4.1 候选差异（`repro/candidate-diff.json`）

```text
20260919-03：805 项  →  20260919-04：808 项（746 tracked + 62 untracked，0 删除）
新增：docs/dispatch/2026-09-19-delivery-close-finish-repair-review.md（主控 · 本轮裁决）
      docs/dispatch/2026-09-19-delivery-close-finish-repair2-prompt.md（主控 · 本轮启动）
      docs/dispatch/2026-09-19-delivery-close-finish-repair2-report.md（本回执）
变更：tools/verify-release-123.mjs（本轮工具修复）
      CHANGELOG.md、docs/dispatch/2026-09-18-delivery-close-report.md（本轮制度性记录）
删除：无
productOrGateTouched: []      ← 产品源码 / 测试 / 门禁配置 **0 处**
headUnchanged: true
复算：declared 808 / recomputed 808 / missing 0 / mismatched 0 / extra 0
```

> 计数说明：候选在**本回执写入磁盘之后**生成，本回执自身也在候选内（+1 项）。

### 4.2 门禁口径（按复核指示，不机械重跑）

本轮**没有**触碰产品源码、测试或门禁配置（§4.1 可证），因此：

- `pnpm gate` / `pnpm build` / `pnpm analyze` 的 **exit 0**、测试 **2489**（12/622/1502/353）、depcruise 530 模块 / 1574 依赖 / 0 违规、lint 1541 warnings + 48 infos（0 error）、budget 全绿（`any 0`、`bang 89/90`、`asCast 31/31`、`bigFiles 4/4`）——**沿用 `outputs/delivery-close-finish/20260919-03/gates/` 的同候选证据**，本轮未重跑。
- 产物未变：全程浏览器证据实际加载 **`main-Db31m2so.js`**（与 `20260919-03` 同一 bundle）。
- 本轮**实跑**的浏览器验证：正常矩阵 53/53、7 个行为负控 + 冻结守卫、`verify-save-lifecycle.mjs` PASS、`verify-mode-guard.mjs` PASS。

### 4.3 运行输入冻结

`inputs.sha256`（11 项：驱动 + helper + 5 份夹具 + 产物入口 bundle）在驱动定稿后重建，首行写 reason；正常与全部负控均带 `--inputs` 逐项复算。篡改副本 → **exit 3 且不产出 results.json**。旧 805/197 材料未覆盖。

---

## §5 未覆盖与限制（如实保留）

| 限制 | 说明 |
|---|---|
| 替身 ≠ 真实文件系统 | 目的地 id 用 `(来源, 文件名)` 合成：**同一路径**在 `open` 与 `save` 两个来源下被当成两个文件。真实 FS 里「另存为选到当前已打开的那个路径」本应是同一文件；本轮按复核要求取**永不合并**的保守语义。这是 mock 语义，不是产品行为主张。 |
| 同名不同目录 | 句柄只带 `name`，替身无目录概念 → 无法区分同名不同目录。已覆盖的是「同名但来源不同」。 |
| 产品保存协调器 | 本轮**只修替身**；未改产品。R7 只声称「用真实 UI 触发另存为后，两个文件在替身里各自成账」。 |
| R7d/R7e 的执行位置 | 直接在替身上操作（无对应 UI 入口），见 §2.4 说明。 |
| 真实系统对话框 / OS 输入法 / 触控 / 跨浏览器 / 像素金图 | 与上一轮一致：不覆盖。 |
| Canvas 小写命令（复核 §4 非阻断备注） | `tracePath` 遇到小写命令只 `continue`、未清 `cmd`，`M 1 2 l 30 40 L 50 60` 会发出 `moveTo(1,2), moveTo(30,40), lineTo(50,60)`。当前场景构造器只产出绝对命令，**本轮不重开 DF-R4、不扩大产品修复**；本回执**不承诺**支持任意 SVG 路径。 |

---

## §6 勘误（不覆写旧回执）

复核 §4 指出的三处编辑残留，在此更正（旧文件保持原样）：

1. **`neg-canvas-links` 的连带红写错了。** `20260919-03` 回执 §4.2 表把 R5c 记成该负控的「连带红」——实际 `neg-canvas-links` **只有 R5d 一项红**；**R5c 的连带红属于 `neg-canvas`**（无画布 → 无候选点）。本轮实测复核：`neg-canvas-links → failed=[R5d]`。
2. **R5b 是「验收指标替换」，不是「未改期望值 / 未删检查」。** 措辞更正：连线落笔会连通原先分离的墨迹带，旧的「≥3 条分离墨迹带」代理判据**必然失效**，因此**替换**为由 R5c 坐标命中身份直接证明多档节点被绘制。这是一次**有理由的指标替换**，应如实如此表述。
3. **R5c 的实际保证是 ≥2 个 depth，不是三档全覆盖。** `20260919-03` 回执 §5.1 写「新增 804 项」「R5c 命中三档」均不准确：候选最终为 **805 项**（本轮为 808 项）；R5c 的判据是「≥2 个不同已知节点且命中身份跨越 **≥2** 个 depth 档」，实测命中 `乙叶二/乙叶一/乙叶三/分支乙`（depth 1 与 2）——**不是**「三档全部逐区绘制已证」。

---

## §7 服务、清理与停止条款

| 项 | 处置 |
|---|---|
| 5179（本轮 `vite preview`） | **已停止**（收尾执行） |
| 5175 / 5177 / 5178（他方或上轮） | 未动 |
| 主控目录 `…-01/`、`…-02/`；执行者 `20260919-02/`、`20260919-03/` | **只读**：探针均为副本，候选/清单/结果未被覆盖 |
| 临时脚本 | `repro/` 下 4 个专项探针（audit 副本、同格式目的地副本、目的地隔离专项、候选差异）保留为本轮可复跑证据；无其它临时文件残留 |

**停止条款**：未 commit / push / pull / rebase / reset / stash；未整树暂存；未发版、未升版本号、未改 git config；未提高预算或扩大排除；未删除具名导出；未覆盖他方文件；未启动图库/文件管理实现或第 4 项。

**结论：可复核。** 交主控复核。
