# 第 3 步 · 合入 6ead42a 空格路径修复 · 执行报告

- 日期：2026-09-22
- 执行者：外派执行者（MindCanvas 第 3 步）
- 任务性质：**机械合入**（构建/工具链适配），非开发任务
- 仓库实际路径：`/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5`
  （注意：workspace 根目录 `mindcanvas-portable-20260921` 只是便携打包目录，**不是** git 仓库；
  真正的仓库在同级子目录 `mindcanvas-s5/`，分支 `main`）
- 结论：**合入完成，退出码 0（干净 cherry-pick，无冲突）；缺陷消除，验收通过。**

---

## 1. 范围与前置基线（实测）

### 1.1 开工基线核对表

| 项 | 期望值 | 实测值 | 判定 |
|---|---|---|---|
| 分支 | main | `main` | ✅ |
| HEAD | 以实测为准 | `f9d17a787c1eedd8c13f14bf4cd091f82ce781da` | ✅ 与派单方写稿值一致 |
| 工作树 | 干净 | `git status --porcelain` 输出为空 | ✅ |
| 待合入提交存在 | commit | `git cat-file -t 6ead42a` → `commit`，exit 0 | ✅ |
| 6ead42a 非 main 祖先 | exit 1 | `git merge-base --is-ancestor 6ead42a HEAD` → **exit 1** | ✅ |
| 四文件仍带缺陷 | 0 命中 | `grep -rn decodeURIComponent <四文件>` → **exit 1，0 命中** | ✅ |

命令原文：

```console
$ git rev-parse --abbrev-ref HEAD
main
$ git rev-parse HEAD
f9d17a787c1eedd8c13f14bf4cd091f82ce781da
$ git status --porcelain
（空）
$ git cat-file -t 6ead42ad9e173c0fb368b3fe45c6c8ba70c55d6f
commit
$ git merge-base --is-ancestor 6ead42ad9e173c0fb368b3fe45c6c8ba70c55d6f HEAD ; echo "is-ancestor exit=$?"
is-ancestor exit=1
$ grep -rn decodeURIComponent apps/canvas/vite.config.ts tools/lib/releaseAcceptance.mjs tools/lib/snapshotCheck.mjs tools/verify-release-123.mjs ; echo "grep exit=$?"
grep exit=1
```

**六条基线全部符合，无漂移，按计划执行。**

### 1.2 待合入提交

```
commit 6ead42ad9e173c0fb368b3fe45c6c8ba70c55d6f
Author: 新020
Date:   Tue Sep 22 14:22:51 2026 +0800

    chore(mac): 便携环境路径适配（decodeURIComponent 解 %20/空格路径）
```

- 父提交：`123d22b773a06c4b8e3f6aa987e5493a2e3fce1b`
- 该提交相对其父仅碰 4 个文件（`git diff --name-only 6ead42a~1 6ead42a` 逐条核对），无夹带：
  `apps/canvas/vite.config.ts`、`tools/lib/releaseAcceptance.mjs`、
  `tools/lib/snapshotCheck.mjs`、`tools/verify-release-123.mjs`
- 包含该提交的分支仅 `codex/summary-node-s5-r2-20260922`（`git branch -a --contains`），未合入 main。

### 1.3 合入前分叉实况（blob 级核对）

| 文件 | main(HEAD) blob | 6ead42a~1 blob | 6ead42a blob | 与派单方描述 |
|---|---|---|---|---|
| apps/canvas/vite.config.ts | `0b31eed5…` | `0b31eed5…` | `3b0fe1c2…` | 一致（main==父，干净应用） |
| tools/lib/releaseAcceptance.mjs | `b460df7f…` | `b460df7f…` | `3e2766e1…` | 一致 |
| tools/lib/snapshotCheck.mjs | `7ae1c5f4…` | `7ae1c5f4…` | `6972b534…` | 一致 |
| tools/verify-release-123.mjs | `c062fc40…` | `6ca1d779…` | `87218c8f…` | **已分叉**，与预期一致 |

文件 4 分叉点已定位：第 50 行附近的 playwright import。main 已是裸包名 `'playwright'`，
而 6ead42a 一侧仍是 Windows 硬编码 `file:///C:/…/playwright-core/index.mjs`。
本任务要改的 `ROOT` 行（第 67 行）两边一致。

---

## 2. 提交锚定

### 2.1 合入方式：`git cherry-pick`（真实退出码 0，无冲突）

```console
$ git cherry-pick 6ead42ad9e173c0fb368b3fe45c6c8ba70c55d6f
Auto-merging tools/verify-release-123.mjs
[main 1dfb1b0] chore(mac): 便携环境路径适配（decodeURIComponent 解 %20/空格路径）
 Date: Tue Sep 22 14:22:51 2026 +0800
 Committer: 新020 <xin020@xin020deMini.lan>
 4 files changed, 27 insertions(+), 8 deletions(-)
$ echo $?
0
```

- **CHERRY_PICK_EXIT = 0**，输出只有 `Auto-merging tools/verify-release-123.mjs` 一行提示，
  **没有 `CONFLICT`、没有 `error`、无 `.git/CHERRY_PICK_HEAD` 残留**，无需任何手工解冲突。
- cherry-pick 后 `git status --porcelain` 为空（工作树干净，无未完成状态）。
- 派单方预测的「文件 4 预期不冲突」得到实证：git 在 import 区自动保留 main 的 `playwright` 裸包名，
  仅把 `ROOT` 行按 6ead42a 改。**未使用 `-X ours` / `-X theirs`。**

### 2.2 提交锚定

| 时点 | HEAD |
|---|---|
| 合入前 | `f9d17a787c1eedd8c13f14bf4cd091f82ce781da` |
| 合入后 | `1dfb1b0667e04864e8fd71e31011feec424af277` |

合入后新提交的父即原来的 `f9d17a7`（线性追加，未 rebase/reset/stash，未 push）。
`6ead42a` 现已在新提交的祖先链上；原分支 `codex/summary-node-s5-r2-20260922` 未被修改。

### 2.3 逐处核对：合入结果与 6ead42a 意图一致

四文件 blob 比对（合入后 vs 源提交）：

```console
apps/canvas/vite.config.ts        new=3b0fe1c28526afea9878a80309a29bdf8dd74b6c  src=3b0fe1c2…  ✅ 完全相同
tools/lib/releaseAcceptance.mjs   new=3e2766e1c12460f19bb09721fe3cdc670a98276b  src=3e2766e1…  ✅ 完全相同
tools/lib/snapshotCheck.mjs       new=6972b534c7c793ffd219b73a19f6e3150992e804  src=6972b534…  ✅ 完全相同
tools/verify-release-123.mjs      new=0a413d7f0c11e82a3c9876dfd096374c9a917d52  src=87218c8f…  ⚠ 见下
```

文件 4 的 blob 差异经 `git diff 6ead42a HEAD -- tools/verify-release-123.mjs` 核对，
**唯一差异就是那行 playwright import**，且方向是「保留 main 的修复」：

```diff
@@ -47,7 +47,7 @@
 import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
 import { join, resolve } from 'node:path';
-import { chromium } from 'file:///C:/Users/20564/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
+import { chromium } from 'playwright';
```

即：`ROOT` 行已按 6ead42a 改成 `decodeURIComponent(...)`（第 67 行），
而 6ead42a 里那行 Windows 硬编码 playwright 路径**没有被带过来**，main 的裸包名 `'playwright'` 原样保留。
这正是任务要求的行为（保留 main 的 playwright import + 应用 decodeURIComponent 到 ROOT）。

---

## 3. 四文件改动清单

`git diff HEAD~1 HEAD --stat` 原文：

```
 apps/canvas/vite.config.ts      | 15 ++++++++++++---
 tools/lib/releaseAcceptance.mjs | 11 +++++++++--
 tools/lib/snapshotCheck.mjs     |  7 +++++--
 tools/verify-release-123.mjs    |  2 +-
 4 files changed, 27 insertions(+), 8 deletions(-)
```

改动面 = 4 文件、4 处代码点（每处把 `.pathname` 包进 `decodeURIComponent(...)`，
保留原有 `.replace(/^\/([A-Za-z]:)/, '$1')` 盘符处理），另附注释。
**无任何产品源码、测试期望、依赖或锁文件改动。**

四处结果行（`grep` 实测）：

| 文件 | 行 | 内容 |
|---|---|---|
| apps/canvas/vite.config.ts | 16 | `decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');` |
| tools/lib/releaseAcceptance.mjs | 32 | `export const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(` |
| tools/lib/snapshotCheck.mjs | 26 | `const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(` |
| tools/verify-release-123.mjs | 67 | `const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');` |

---

## 4. 验证证据（全部实跑，退出码为命令重定向后取的 `$?`，未经管道）

### 4.1 静态验证 —— ✅ 通过

```console
$ grep -rn decodeURIComponent apps/canvas/vite.config.ts tools/lib/releaseAcceptance.mjs tools/lib/snapshotCheck.mjs tools/verify-release-123.mjs
apps/canvas/vite.config.ts:8: *  1. `decodeURIComponent`：`.pathname` 是**百分号编码**的 URL 片段，空格会原样变成
apps/canvas/vite.config.ts:16:  decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
tools/lib/snapshotCheck.mjs:25:/** tools/lib/ → 仓库根；`decodeURIComponent` 负责解掉 `.pathname` 的 `%20` 等编码 */
tools/lib/snapshotCheck.mjs:26:const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(
tools/verify-release-123.mjs:67:const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
tools/lib/releaseAcceptance.mjs:29: * `decodeURIComponent` 不可省：`.pathname` 是百分号编码片段，路径含空格会得到 `%20`
tools/lib/releaseAcceptance.mjs:32:export const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(
grep exit=0
```

四文件均含 `decodeURIComponent`（修复前 0 命中 → 现 7 行命中：**4 处代码 + 3 处注释**）。

### 4.2 ROOT 解析生效的直接取证 —— ✅ 通过

因 playwright 缺失（见 §6.1）无法直接跑验收脚本，改为直接 import 被修的模块验证 ROOT：

```console
$ node --input-type=module -e '...import { ROOT } from "../tools/lib/releaseAcceptance.mjs"...'
raw pathname      : /Users/xin020/Desktop/temp%20workbase/mindcanvas-portable-20260921/
has %20 (bug)     : true          ← 未解码的 pathname 确实是死路径形式
releaseAcceptance ROOT: /Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5/
ROOT has %20      : false         ← 修复后已被解码
ROOT existsSync   : true          ← 真实存在的目录
ROOT/package.json : true
PROBE_EXIT=0
```

这条证明：在含空格的当前路径下，被修的 `ROOT` 已能解析到真实存在的仓库根。

### 4.3 缺陷消除的核心判据：apps/canvas 套件 —— ✅ 大幅转绿

```console
$ cd apps/canvas && ./node_modules/.bin/vitest run > /tmp/post-vitest.log 2>&1 ; echo $?
（第一次）POST_VITEST_EXIT=1
 Test Files  1 failed | 46 passed (47)
      Tests  1 failed | 395 passed (396)

（第二次，同一命令重跑）POST_VITEST_RUN2_EXIT=0
 Test Files  47 passed (47)
      Tests  396 passed (396)
```

**第二次全绿**（`47 passed (47)`、`396 passed (396)`、exit 0）。
第一次的 1 个失败经判定为**既有 flaky 时序**，非路径缺陷残留，证据见 §5.2。

修复后日志中路径缺陷签名**全部归零**：

```console
$ grep -c "Failed to resolve import" /tmp/post-vitest.log   → 0 （grep exit 1，无命中）
$ grep -c "temp%20workbase"           /tmp/post-vitest.log   → 0 （grep exit 1）
$ grep -c "UNLOADABLE_DEPENDENCY"     /tmp/post-vitest.log   → 0 （grep exit 1）
```

### 4.4 构建验证 —— ✅ exit 0

```console
$ cd apps/canvas && ./node_modules/.bin/vite build > /tmp/post-build.log 2>&1 ; echo $?
POST_BUILD_EXIT=0

vite v8.2.2 building client environment for production...
transforming...
✓ 252 modules transformed.
rendering chunks...
computing gzip size...
dist/radial.html                         0.44 kB │ gzip:   0.32 kB
dist/index.html                          0.58 kB │ gzip:   0.34 kB
dist/assets/radial-CN1wIim6.js          18.69 kB │ gzip:   6.98 kB
dist/assets/radialSurface-DQOuNKaH.js  229.26 kB │ gzip:  73.31 kB
dist/assets/main-BgdfvXm7.js           450.70 kB │ gzip: 146.19 kB
✓ built in 123ms
```

缺陷签名 `grep -c "UNLOADABLE_DEPENDENCY\|temp%20workbase"` = 0。

### 4.5 门禁（只读项）—— ✅ 四项全 exit 0

| # | 命令 | 真实退出码 | 输出摘要 |
|---|---|---|---|
| 1 | `pnpm typecheck` | **0** | 四个包 typecheck 全 `Done`（free-canvas / kernel / react / apps/canvas） |
| 2 | `pnpm depcruise` | **0** | `✔ no dependency violations found (565 modules, 1694 dependencies cruised)` |
| 3 | `node scripts/check-code-budget.mjs` | **0** | `✅ 全部指标在预算内（债务未增长）` |
| 4 | `node scripts/check-public-content.mjs` | **0** | `Public content paths checked: 899` |

全部符合「预期保持 exit 0」。本改动不动产品代码，未影响预算与依赖规则。

### 4.6 关于全仓 `pnpm gate`

**未运行全仓 `pnpm gate`**，原因（如任务书所述）：本机 canvas 套件之外的既有 flaky 会污染结论。
改跑 §4.5 的四项只读门禁 + §4.3 的 canvas 套件，判定依据充分。

---

## 5. 修复前后对比

### 5.1 canvas 套件读数

| | 修复前（f9d17a7） | 修复后第一次（1dfb1b0） | 修复后第二次（1dfb1b0） |
|---|---|---|---|
| Test Files | **40 failed \| 7 passed (47)** | 1 failed \| 46 passed (47) | **47 passed (47)** |
| Tests | 33 passed (33) | 1 failed \| 395 passed (396) | **396 passed (396)** |
| 退出码 | **1** | 1 | **0** |

失败文件数 **40 → 0**；通过文件数 **7 → 47**；通过用例数 **33 → 396**。

### 5.2 唯一一次红跑的定性判定：既有 flaky 时序，非路径缺陷残留

第一次修复后运行有 1 个失败，**判定为既有 flaky，非本缺陷残留**，依据三条：

1. **错误类型不符**：该失败是 UI 状态断言，不是模块解析错误——
   ```
   FAIL tests/mode-guard.test.tsx > MODE-GUARD · 导图离开保护 > 导图有未保存编辑 → 进入自由画布前必须确认；取消保留编辑与画布
   AssertionError: expected '✓ 已保存' to contain '未保存'
   Expected: "未保存"   Received: "✓ 已保存"
    ❯ tests/mode-guard.test.tsx:329:34
   ```
   任务书定的判据：`Failed to resolve import` 属「路径缺陷残留」；计时/状态断言属「既有 flaky」。
   本例断言的是「编辑后应显示未保存」，是时序/状态传播问题，与路径解析无关。
2. **单独复跑即通过**：`vitest run tests/mode-guard.test.tsx` → `1 passed (1)` / `11 passed (11)`，**exit 0**。
3. **全量重跑即通过**：第二次全量 `vitest run` → `47 passed (47)` / `396 passed (396)`，**exit 0**。
   同一提交、同一命令，一次红一次绿 = 负载相关抖动（首次跑 50.50s 环境初始化 18.39s，
   与任务书所述「个别时序用例抖动」特征吻合）。

**未修改任何测试期望、未放宽阈值、未改断言。** 该 flaky 如实记录于此，本任务不修。

---

## 6. 未运行项与已知边界

### 6.1 playwright 缺失 → 106 断言矩阵本机不可复跑（**未验证，非已通过**）

```console
$ ls node_modules/playwright
ls: node_modules/playwright: No such file or directory   (exit 1)
```

因此以下两个**真浏览器验收脚本本机无法运行**，106 断言矩阵**本机未复跑**：

- `tools/verify-summary.mjs`
- `tools/verify-summary-supplement.mjs`

这是**已知边界，如实声明**——本报告**不主张**这两个脚本已验证通过。
可间接说明的部分：二者均 `import` 自 `./lib/releaseAcceptance.mjs`（本次被修文件），
其 ROOT 解析已在 §4.2 用直接 import 取证为可用；但它们自身的断言逻辑本机未执行。

### 6.2 既有 flaky（如实记录，本任务不修）

- `apps/canvas/tests/mode-guard.test.tsx:329` —— 首次全量跑偶发红（`'✓ 已保存'` vs `'未保存'`），
  单独跑与第二次全量跑均绿。判定为负载相关时序抖动（§5.2）。
- 任务书提及的 `packages/kernel` 的 `benchmark-layout.test.ts:78` 墙钟断言 —— 属 canvas 之外的
  套件，本次未运行该套件，故未观测、不做主张。

### 6.3 范围外（本任务不涉及）

真实系统文件选择器手势、真实 OS 输入法、跨浏览器、触控 —— 均在本任务范围外，未测。

---

## 7. 残余问题与下一步建议

1. **本步无残余问题。** 合入后四文件修复点齐备（§4.1）、ROOT 解析生效（§4.2）、
   canvas 套件归零路径缺陷（§4.3）、构建恢复（§4.4）、四项门禁保持绿（§4.5）。
2. **`.pathname` 未解码用法已全仓清扫**：本次扫描 `*.ts/*.tsx/*.mjs/*.js`（排除 node_modules/dist）
   中所有 `import.meta.url` + `pathname` 组合，命中**恰好 4 处，且全部已被 `decodeURIComponent` 包裹**，
   **未发现第 5 处漏网**。故无「修复不完整」需上报的后续项。
3. **未 push、未发布、未进入下一步**。按任务书要求，做完即停。
4. 建议交接方向（供派单方）：本步属**构建/工具链前置**，空格路径已通，
   可支撑后续 **第 4 步 P0-D** 与 **第 5 步 P0-A** 在含空格路径下正常出产物与跑验收。
   若第 4/5 步需真浏览器验收，需先解决本机 playwright 缺失（属环境准备，非本任务范围）。

---

## 附：本步未触碰清单（合规声明）

未合入 6ead42a 之外的任何旁支提交（未含 outputs/ 证据、未含 .gitignore 否定规则）；
未改任何产品源码（packages/**、apps/canvas/src/**）；未改测试期望/阈值/断言；
未 rebase、未 reset、未 stash、未清理、未 push、未合并其他分支；未做 pnpm install 之外的依赖变动，
未升级锁文件；未处理第 1、2 步内容。
