# SUMMARY-NODE-S3-R1-LAND 落地报告

- **日期**：2026-09-21
- **轮次**：S3-R1-LAND（**只落地，不改源码**）
- **性质**：把已完成的 S3-R1 三条修复提交落到本仓一条本地分支上；**不修改源码、不 push、不发布、不合并主分支、不启动 S4**
- **来源集成线**：`<local-path>`（detached `7ef16da`，无任何分支可达 —— 本轮落地的动因）
- **落地分支**：`codex/summary-node-s3-r1-20260921`
- **落地 worktree**：`<local-path>`
- **证据目录**：`outputs/summary-node/S3/S3-R1-LAND-20260921-132101-land/`
- **结论**：**落地完成**，四项交付内容齐备、祖先链正确、工作区干净、旧回执与旧证据未被触碰。

---

## 一、固定对象与最终结果

| 项 | 值 |
|---|---|
| S3 代码候选（固定） | `9a523d31b33eb9083642d69e2449a2342fac8e8b` |
| 候选 tree（实测复算） | `cc49754a0cbf0cf473dff881c270eb6e2c222082`（与任务书一致） |
| **落地分支 HEAD** | 见 `manifest.txt`（终态实测值）—— 报告自身每次修订都会产生新的 HEAD，故**权威终态写在 manifest**；本报告内所列 SHA 均经 `git rev-parse` 实测 |
| 落地分支 Tree | 见 `manifest.txt` |
| 核心 tree（三条修复叠加后） | `a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b`（与集成线逐字相同） |
| 分支名 | `codex/summary-node-s3-r1-20260921` |

**提交序列**（`git log 9a523d3..HEAD`，线性单父；权威终态 SHA/Tree 见 `manifest.txt`）：

自指说明：本报告本身是分支上的一条提交，故「报告里写死自己的 HEAD」在原理上无法闭合 —— 任何一次修订都会产生新 HEAD。因此本表给出**提交序列与各自 SHA**，而**终态 HEAD/Tree 以 `manifest.txt`（在最后一次提交之后生成）为准**。

| # | SHA | parent | tree | subject |
|---|---|---|---|---|
| 4 | `c48b7c354147bede597c323d0e4f35320670d113` | `900b23586f7a0e8a99d7206d1e161f6887ae43b5` | `2be670aa…` | `docs(dispatch): S3-R1 回执落地（第三版 + v2 变体；不覆盖原 S3 回执）` |
| 5+ | 本落地报告及其终态对齐提交（`f438083`, `77b0627`, `14e98cb`, …） | 依次首尾相接 | — | `docs(dispatch): S3-R1-LAND …`（纯文档，仅改本报告） |
| 3 | `900b23586f7a0e8a99d7206d1e161f6887ae43b5` | `f0f6002d98e15f9c20755c9e1df5d3d1f3d3d9cd` | `a2b16714…` | `test(kernel): S3-R1 nestedSkip 分支正式回归覆盖（7 例，含夹具可达性探针）` |
| 2 | `f0f6002d98e15f9c20755c9e1df5d3d1f3d3d9cd` | `4c01d86f790d9a7e7ea5fc40dc02f517fc38277d` | `d97880d5…` | `test(kernel): S3-R1 补 subtreeBBox 子树口径一致性用例（原用例叶节点恒盲）` |
| 1 | `4c01d86f790d9a7e7ea5fc40dc02f517fc38277d` | `9a523d31b33eb9083642d69e2449a2342fac8e8b` | `95076f98…` | `fix(kernel): frame 路径显式传播摘要卫星 —— 加法字段不再静默丢失` |

> 第 1–3 条为三条修复（对应任务书 §4 的 cherry-pick）；第 4 条为 R1 回执（对应 §5）；其后为纯文档提交（本落地报告及其若干次文本对齐）。**无 amend、无 rebase、无历史改写 —— 对齐一律走追加提交。** 第 1–4 条之外的提交只动 `docs/`，对代码内容零影响（核心 tree 始终为 `a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b`）。

> **方法说明（为什么是 cherry-pick 而非 fast-forward）**：集成线 `7ef16da` 的父链恰好就是候选→三条修复，理论上可直接把分支指向它。但那样分支会**只存在于 detached worktree 的对象图**中，且无法把 R1 回执作为独立提交追加在其后。故按任务书 §4 显式执行 cherry-pick，得到**本仓内自持**的三条修复提交（其后追加 R1 回执与本报告）。

**SHA 对应关系**（源 → 落地）：

| 源（集成线） | 落地（本分支） | subject |
|---|---|---|
| `e1f0d71de691bbf1bb30fc45551188ab9d135de2` | `4c01d86f790d9a7e7ea5fc40dc02f517fc38277d` | frameLayout 传播/降级 |
| `1bba84d29abc4b56084a3e1d883ea6be0258fca6` | `f0f6002d98e15f9c20755c9e1df5d3d1f3d3d9cd` | subtreeBBox 子树测试 |
| `7ef16da145085a88308635962ed2c31e4e55bfa8` | `900b23586f7a0e8a99d7206d1e161f6887ae43b5` | nestedSkip 测试 |

**核心 tree 一致性**：落地第 3 条提交的 tree `a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b` **与源集成线 HEAD 的 tree 逐字相同** —— 说明三条修复叠加后的代码内容零漂移，第四条仅追加文档。

---

## 二、要求逐条核验

### 1. 解析三条提交的完整 SHA ✓

（见上表；全部经 `git rev-parse` 取全 40 位，未使用短 SHA 作判据。）

### 2. 祖先链与提交内容 ✓

`git log --format='%H %P'` 实测为**严格单父线性链**：

```
7ef16da (parent 1bba84d) → 1bba84d (parent e1f0d71) → e1f0d71 (parent 9a523d3) → 9a523d3
```

无合并、无分叉。逐条 `git show --stat` 内容与任务书描述一致：

| 源 commit | 内容 |
|---|---|
| `e1f0d71` | `frameLayout.ts` +33/-1、新增 `summary-satellite-frame.test.ts`（510 行） |
| `1bba84d` | `summary-satellite.test.ts` +125/-0、新增 S3-R1 README（77 行） |
| `7ef16da` | 新增 `summary-satellite-nested.test.ts`（229 行） |

> **集成方已登记的偏离（非本轮引入，转述以免误读）**：`1bba84d` 内已含 bbox 修复的 README 文档变更。源 bbox 工作树原本有**两个**提交（`007aefe` 测试 + `396fb39` 文档），集成方按任务书指定的补丁来源取净差异后合为一条，以维持「候选..HEAD 恰三条」。故 `396fb39` 不在链上（实测 `git merge-base --is-ancestor 396fb39 HEAD` = 假），两提交内容无一丢失，仅 README 的独立 docs 提交信息未单独保留。

### 3. 从 `9a523d3` 创建分支 ✓

```
$ git branch codex/summary-node-s3-r1-20260921 9a523d31b33eb9083642d69e2449a2342fac8e8b
$ git rev-parse codex/summary-node-s3-r1-20260921           → 9a523d31…
$ git rev-parse codex/summary-node-s3-r1-20260921^{tree}    → cc49754a0cbf0cf473dff881c270eb6e2c222082
```

分支起点 tree 与固定候选 tree 一致，确认未夹带任何其它批次的改动。

### 4. 按正确顺序 cherry-pick ✓

```
$ git cherry-pick e1f0d71  → [codex/… 4c01d86] 2 files changed, 543 insertions(+), 1 deletion(-)
$ git cherry-pick 1bba84d  → [codex/… f0f6002] 2 files changed, 202 insertions(+)
$ git cherry-pick 7ef16da  → [codex/… 900b235] 1 file changed, 229 insertions(+)
```

**三次全部零冲突**（与集成方记录的「三补丁文件互不重叠」一致）。

### 5. R1 回执单独保留，未 amend 历史 ✓

R1 回执**不在**三条代码提交内，故按任务书单独追加为第 4 条提交（`c48b7c3`）。

**需请示主控的一处判断**：主树内存在**两份** R1 回执文件，均未被 git 跟踪：

| 文件 | 大小 | mtime | 说明 |
|---|---|---|---|
| `docs/dispatch/2026-09-21-summary-node-s3-r1-report.md` | 112,177 B | 13:13 | **第三版**（落实本批读者意见后的定稿） |
| `docs/dispatch/2026-09-21-summary-node-s3-r1-report-v2.md` | 44,038 B | 13:09 | v2 变体；其文件头自述「任务书指定路径已存在，故按『若已存在则改用带后缀的新路径』写入新路径」 |

两份内容**不同**（`cmp` 判定 DIFFERENT），但口径一致（同为「三分桶 + 方案 B + 证据原文」）。

**本轮处置**：**两份都收**，作为同一条 docs 提交进入分支。理由：任务书 §5 要求「如 R1 回执提交不在三条代码提交内，单独保留或追加，不得 amend 历史」；两份都是本轮 R1 的合法回执产物，删除任一都超出「只落地」的授权。若主控认为只应保留定稿版，**建议由主控显式指示**后再处理 —— 本轮**不对已落地分支做任何历史改写**。

### 6. 最终分支包含四项交付内容 ✓

| 要求 | 核验命令 | 结果 |
|---|---|---|
| frameLayout 修复 | `git diff 9a523d3 HEAD --stat -- …/frameLayout.ts` | `+33/-1`；`frameLayout.ts:273-276` 实测含 `const satellites = base.satellites?.filter(...)` 与 `out.satellites = satellites` |
| subtreeBBox 子树测试 | `git show HEAD:…/summary-satellite.test.ts \| grep -c 四项口径一致` | `2`（命中） |
| nestedSkip 测试 | `git cat-file -e HEAD:…/summary-satellite-nested.test.ts` | 存在 ✓ |
| 对应 R1 回执 | `git ls-tree --name-only HEAD docs/dispatch/ \| grep s3-r1` | 两份回执均在树内 ✓ |

### 7. 三项校验 ✓

```
$ git merge-base --is-ancestor 9a523d3 HEAD
exit=0                                  → 是祖先 ✓

$ git branch --contains HEAD
* codex/summary-node-s3-r1-20260921     → 仅本分支 ✓

$ git status --porcelain
(无输出)                                 → 工作区干净 ✓
```

### 8. 完整 SHA / Tree / 父提交 / 提交列表 / 逐文件清单 ✓

见 §一 与证据文件：

- `manifest.txt` —— **终态 HEAD/tree（权威）**/分支/完整提交序列（含 parent 与 tree）/三项校验原文
- `files-manifest.txt` —— name-status + 逐文件 **sha256（blob 口径）** + git oid + 与集成线 blob 一致性对照

**逐文件清单**（`9a523d3..HEAD`）：

```
A  docs/dispatch/2026-09-21-summary-node-s3-r1-report-v2.md
A  docs/dispatch/2026-09-21-summary-node-s3-r1-report.md
A  outputs/summary-node/S3/S3-R1-20260921-095941-R1/README.md
M  packages/kernel/src/layout/frameLayout.ts
A  packages/kernel/tests/summary-satellite-frame.test.ts
A  packages/kernel/tests/summary-satellite-nested.test.ts
M  packages/kernel/tests/summary-satellite.test.ts
```

> **哈希口径显式标注**：`files-manifest.txt` 的 sha256 是 **git blob（LF）口径**。本仓 `core.autocrlf=true` 且无 `.gitattributes`，**worktree 检出文件（CRLF）的哈希与 blob 口径不同** —— S3 原回执曾因混用两种口径引致误读，故本轮显式注明。

**与来源集成线的零漂移证明**：四个核心文件的 git oid 与集成线逐一比对全部 `SAME`（`frameLayout.ts=84092c09`、`satellite.test.ts=80ba60aa`、`satellite-frame.test.ts=609c5d7a`、`satellite-nested.test.ts=d14dc4c2`）。

### 9. 未修改原 S3 代码候选、旧回执、旧证据 ✓

| 对象 | 核验 | 结果 |
|---|---|---|
| 代码候选 `9a523d3` | `git rev-parse 9a523d3^{tree}` | `cc49754a…` 与任务书一致，未被改写 |
| 原 S3 回执 | 仍在 S3 工作树 `<local-path>`（HEAD `e14df2d`） | 未被触碰 |
| 旧 S3 证据 | `outputs/summary-node/{20260920-01,20260920-02-review,S2}` 与 `S3/S3R-*` 目录 | 本轮**只新建** `S3/S3-R1-LAND-20260921-132101-land/`，该路径落地前不存在（实测 `ls` 报 No such file） |
| 主树当前分支 | `codex/file-assets-foundation-20260920` HEAD `a2ce72b` | 未被切换、未被改动 |

### 10. 未 push、未发布、未合并主分支 ✓

- 未执行任何 `git push`；`origin/main` 仍停在 `b17f92b`（与本轮无关的既有提交）。
- 新分支**仅本地存在**；`git branch --contains HEAD` 只回本分支。
- 未做任何 merge / rebase / checkout 主分支操作。

### 11. 完成后停止 ✓

本报告即交付终点；未启动 S4，未做任何修复。

---

## 三、落地分支上的实测（证明落地内容可运行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建 | `pnpm -r build` | 4 包 + canvas 全 `Done` |
| 定向（卫星套件五文件） | `npx vitest run tests/summary-satellite{,-cache,-forest,-frame,-nested}.test.ts` | **5 files / 52 passed**（exit 0） |
| kernel 全包 | `npx vitest run`（packages/kernel） | **75 files / 708 passed**（exit 0） |
| pre-commit 钩子 | 落地第 4 条及其后每条文档提交时自动运行 | depcruise「no dependency violations」；lint「Found 1541 warnings. Found 48 infos.」后「代码检查通过」 |

> 数字与 R1 集成态一致（52 / 708），说明 cherry-pick 未引入任何内容漂移。

**一处环境性说明**：落地 worktree 新建时无 `node_modules`，首次提交被 pre-commit 钩子拦下（`'depcruise' 不是内部或外部命令`）。本轮**选择安装依赖后重试**（`pnpm install --frozen-lockfile`），**未使用 `--no-verify` 绕过钩子** —— 钩子随后正常通过。记录此事以免读者误以为钩子被跳过。

---

## 四、未覆盖与限制（如实标注）

1. **未验证运行时端到端渲染**：仅测试与构建证据；未跑浏览器 / 截图 / `pipeline.layoutDemo` 真实渲染。
2. **两份 R1 回执的取舍未决**：本轮两份都收（理由见 §二.5）；若主控只认定稿版，需主控指示，本轮不做历史改写。
3. **`396fb39`（bbox README 的独立 docs 提交）未单独保留**：系集成方既有处置，本轮转述而非重做；其内容已并入 `1bba84d` 的净差异，未丢失。
4. **落地分支尚未 push、尚未合并**：`codex/summary-node-s3-r1-20260921` 仍是纯本地分支，交付后若回收落地 worktree 需注意分支本身在仓库 `.git` 内，不受 worktree 移除影响（与 R1 集成线的 detached 情形不同 —— 这正是本轮要解决的问题）。
5. **仅落地，未复核修复本身**：R1 的技术复核结论（方案 B、三项负控、8 条发现）见 `docs/dispatch/2026-09-21-summary-node-s3-r1-report.md`，本轮未重复评审。

---

## 五、结论

S3-R1 三条修复提交已按正确顺序落到本地分支 `codex/summary-node-s3-r1-20260921`，HEAD 与 Tree 见 `manifest.txt`（核心 tree `a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b`），提交线性叠加于固定候选 `9a523d3` 之上，R1 回执作为独立提交追加、未 amend 历史。四项交付内容齐备，核心 tree 与 R1 集成线逐字一致，落地分支上定向 52 / kernel 708 全绿。

**未 push、未发布、未合并主分支、未启动 S4。停在此处等待主控复核。**
