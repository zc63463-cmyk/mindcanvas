# S3-R1 返修回执 · 摘要卫星三缺陷（R1 回执）

- 日期：2026-09-21
- 轮次：S3-R1（返修轮）
- **本文件路径：`docs/dispatch/2026-09-21-summary-node-s3-r1-report-v2.md`**
- **路径说明（必读）**：任务书指定的 `docs/dispatch/2026-09-21-summary-node-s3-r1-report.md` **已存在**（83,477 字节，mtime 2026-09-21 13:05，为上一轮的修订稿）。按任务书「若已存在则改用带后缀的新路径并说明，绝不覆盖」，本回执写入**带 `-v2` 后缀的新路径**，**未覆盖、未修改、未删除**原文件。两份文件内容口径一致（同为「三分桶 + 方案 B + 证据原文」），本文件是本次 ask 的**自包含**回执，不要求读者回查原文即可判定。
- **本轮交付对象（集成线）**：`<local-path>`

---

## 0. 结论（先给结论）

| 项 | 判定 |
|---|---|
| 三个修复是否全部被接受 | **是，3/3 accepted** |
| 方案 A / B | **本轮采用方案 B，三项修复全部为 B**（判据见 §2） |
| 三项负控是否全部按目标断言转红 | **是，3/3**（NC1 exit=1 / NC2 exit=1 / NC3 exit=1，红因原文见 §4） |
| 是否作弊（放宽/改写/删除既有断言、`it.fails`、catch 后报通过、test-only 导出） | **否**（§3.4 / §5） |
| 门禁新增债务 | **0**（lint 1541+48 持平；budget 全项持平或下降；react/canvas 全包与参考值逐数相同） |
| 三项修复是否落在同一交付线上 | **是**（集成线，三条提交线性单父，零冲突） |
| 集成线 HEAD / Tree | `7ef16da145085a88308635962ed2c31e4e55bfa8` / `a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b` |
| 是否 amend / rebase / force / push | **均未做** |
| 是否启动 S4 | **未启动** |
| 阻断级开放项 | **集成线 HEAD `7ef16da` 不在任何分支上**（detached worktree），须在 S4 前显式落地 —— 见 §8.3 P-1 |
| 未覆盖项 | 见 §10（含「`spatialDropped` 子句无判别力」「三包齐跑未完整执行」「运行时端到端未验证」等） |

---

## 1. 固定对象 · 本轮工作树 · 证据目录

### 1.1 固定对象（本轮不可动的锚）

| 项 | 值 | 复核命令（本 ask 内实跑） |
|---|---|---|
| 固定候选 SHA | `9a523d31b33eb9083642d69e2449a2342fac8e8b` | `git rev-parse 9a523d31…` → 一致 |
| 固定候选 Tree | `cc49754a0cbf0cf473dff881c270eb6e2c222082` | `git rev-parse '9a523d31…^{tree}'` → 一致 |
| 基线（S3 之前） | `e187fa90…`（S2-F4 worktree `<local-path>` 的 HEAD，由门禁执行方引用） | 见 §6.2 |

**候选未被 amend**：`git merge-base --is-ancestor 9a523d31 HEAD`（集成树内）= **YES**，即修复以新 commit 叠加在候选之上，候选 tree 仍为 `cc49754a…`（实测）。

### 1.2 本轮工作树（**三棵隔离修复树 + 一条集成线**）

| 角色 | 路径 | HEAD | Tree |
|---|---|---|---|
| frame 修复树 | `<local-path>` | `3d5456aa…` | — |
| bbox 修复树 | `<local-path>` | `396fb39…` | — |
| nested 修复树 | `<local-path>` | `1b03d00658b89ac7ff6264e4b0626f25c518b886` | `d25a8dc9cc0ef8b947f49b8ef7d42c7d831756fd` |
| **集成线（交付对象）** | `<local-path>` | **`7ef16da145085a88308635962ed2c31e4e55bfa8`** | **`a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b`** |

其余相关 worktree（`git worktree list` 实测）：`mindcanvas-s3-rv-S3R-20260921-082207`（候选审查）、`mindcanvas-s3r1-S3-R1-20260921-095941`（候选快照）。**本回执不在任何修复树内写入**（见 §10 口径）。

### 1.3 证据目录

任务书指定的证据目录：`outputs/summary-node/S3/S3-R1-20260921-095941-R1/`

**重要事实：该目录不在交付树（集成线）内，而是分散在三棵修复树各自的 `outputs/` 下。** 实测各树内该目录的清单：

| 树 | 该目录下的实际文件 |
|---|---|
| frame 树 | `red-frame.log`、`green-frame.log`、`kernel-full.log`、`report.md` |
| bbox 树 | `README.md` |
| nested 树 | `README.txt`、`baseline-env.txt`、`behavior-assessment.txt`、`observation-gitignore-signal.txt`、`red/nested-red.txt`、`red/restore-proof.txt`、`green/nested-green.txt`、`green/nested-green-after-restore.txt`、`green/gates.txt` |
| **集成线（交付树）** | **`README.md`**（bbox 线产出，被跟踪；随集成 commit `1bba84d` 进入交付树）+ `gates-and-final-state-20260921-095941-R1-gates.md`（**未跟踪**，`git status --porcelain` 显示 `??`，非本轮门禁 commit 产物） |

> 即：**交付树里只有 `README.md` 一份证据是「跟着走的」**；其余两份独立日志（`red-frame.log`、`nested-red.txt` 等）留在各自修复树内，**不随交付树走**。本回执 §3/§4 引用的原文即取自上述路径（已在各处标注）。

---

## 2. 方案声明：本轮采用 **方案 B**，三项全部为 B

### 2.0 A / B 的定义（使读者无须回查任务书即可判定）

- **方案 A（改语义）**：修改生产源码的**行为语义** —— 为缺陷①引入新的卫星几何放置逻辑（把卫星放置接管进框岛局部坐标 / 岛级缓存体系）；为缺陷②修正 `subtreeBBox` 的算法；为缺陷③实现嵌套摘要的**摘除 / 几何语义**。
- **方案 B（不改语义，只显式表态 / 只补判别力测试）**：生产源码**行为语义不变**，只做（i）对既有契约**显式表态**（缺陷①：把本会被静默丢弃的加法字段显式传播或显式降级）与（ii）**只新增测试**补上原本不存在的判别力（缺陷②③）。

### 2.1 声明

**本轮采用方案 B。** 三项修复与「B」的对应关系：

| 缺陷 | 方案 | 具体形态 |
|---|---|---|
| ① frame | **B** | 显式降级（框内无卫星 → 字段缺失，与基线逐位等价）+ 显式传播（框外有卫星 → 携带**同一批对象引用**）。**未**为框内摘要新造卫星几何。 |
| ② bbox | **B** | **不改生产源码**，只新增一条对「子树口径分叉」真正有判别力的测试。 |
| ③ nested | **B** | **不改语义**，只新增测试覆盖 `nestedSkip` 分支；**明确不实现嵌套摘要 UI**。 |

### 2.2 选择理由（含预研的实测依据）

1. **缺陷①的预研句「框根剪枝 → 基座无卫星」被实测证伪为「只覆盖一半」**。frame 线用探针在候选代码上复现：框根被 `framePrunedCollapsed` 剪掉后，基座对**框内**摘要确实不产出卫星（预研句成立），但**对框外摘要（与框无祖先关系）基座布局真的会产出卫星**——此时丢弃是**可观测的数据丢失**。因此 B 的「显式传播」有真实的失败断言路径，而 A（为框内摘要新造几何）会把卫星放置接进框岛局部坐标 / 岛级缓存体系，**超出本批安全范围**（见 `frameLayout.ts:202-219` 契约注释原文：「那要把卫星放置接进框岛的局部坐标 / 岛级缓存体系，超出本批安全范围」）。
2. **缺陷②的判别力缺口是实测出来的、且不靠改语义就能补**。bbox 线做红-绿-再红三段：先把候选 `satellite.ts:211` 的递归关掉（`for (const c of ln.children)` → `for (const c of [] as LayoutNode[])`），跑既有用例 → **19/19 仍全绿**，证明既有「带外沿口径」用例对分叉**恒盲**（其成员均为叶节点，`subtreeBBox ≡ 节点盒`）。既然缺口在「测试不覆盖」而非「算法算错」，**B（只补测试）就是正解**，A 无的放矢。
3. **缺陷③的可达性经双探针确认后，B 足以覆盖**：探针 P1（外层摘要排在内层成员之后）→ 外层 `dangling/reason=summary-in-range`，`nestedSkip` 空集（**假覆盖**）；探针 P2（外层摘要在自己声明的区间之外，区间 `[成员A, 内层摘要, 成员B]`）→ 外层 `well-formed`，`buildSatellitePlan` 输出 `nestedSkip=["s1"]`，**真命中**。既然分支可达、且其语义与 `satellite.ts:33-37` 的既有承诺一致（「该摘要**不摘除**，留在普通流内可见」），**B（钉住既有语义）即够**；A（实现嵌套 UI）明确**不在本批范围**（`satellite.ts:36`：本批明确不实现嵌套摘要 UI）。

---

## 3. 三个修复逐条

> **通用事实**：三条修复的 commit 均落在固定候选 `9a523d3` 之上；集成线将它们合成**三条线性单父提交**（§7）。红/绿证据原文取自 §1.3 列出的证据文件。

### 3.1 缺陷① `frame`：`expandFrameIslands` 展开期静默丢弃 `LayoutResult.satellites`

**缺陷（根因）**：候选 `packages/kernel/src/layout/frameLayout.ts:245` 在展开期**新构造**返回对象：

```ts
return { nodes, links: [...keptBaseLinks, ...ctx.links], bounds: layoutBounds(nodes) };
```

（本 ask 实测原文：`git show 9a523d31…:packages/kernel/src/layout/frameLayout.ts | sed -n '243,247p'` → 上述三行。）新对象**未携带 `base.satellites`** → 加法字段被静默丢弃。

**红证据原文**（frame 树 `outputs/summary-node/S3/S3-R1-20260921-095941-R1/red-frame.log`，命令 `cd packages/kernel && npx vitest run tests/summary-satellite-frame.test.ts`，exit=1）：

```
AssertionError: 展开结果丢失了基座产出的卫星 S-outside（satellites=undefined）——加法字段被静默丢弃: expected false to be true // Object.is equality
AssertionError: 只有框外摘要产出卫星: expected [] to deeply equal [ 'S-out' ]
AssertionError: 缓存开启：卫星必须传播: expected [] to deeply equal [ 'S-nested' ]
...
 Tests  4 failed | 5 passed (9)
```

**绿证据原文**（frame 树 `green-frame.log` / `kernel-full.log`，同一命令 exit=0）：

```
 ✓ tests/summary-satellite-frame.test.ts (9 tests) 14ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

kernel 全包（`kernel-full.log`）：`Test Files 74 passed (74)` / `Tests 700 passed (700)`。

**改动文件**：`packages/kernel/src/layout/frameLayout.ts`（+34/−1，新增契约注释段 + 显式传播逻辑；见 §3.4）；`packages/kernel/tests/summary-satellite-frame.test.ts`（+510，全新）。

**修复内容**（本 ask 实测 `git diff 9a523d31 HEAD -- packages/kernel/src/layout/frameLayout.ts` 原文）：

```ts
const out: LayoutResult = {
  nodes,
  links: [...keptBaseLinks, ...ctx.links],
  bounds: layoutBounds(nodes),
};
const satellites = base.satellites?.filter(
  (s) => !ctx.dropped.has(s.node.id) && !ctx.spatialDropped.has(s.node.id),
);
if (satellites !== undefined && satellites.length > 0) out.satellites = satellites;
return out;
```

**commit SHA**：frame 树 `3d5456aa93376a672858cf39cc2ccad2ea842aa6`；集成线对应提交 `e1f0d71de691bbf1bb30fc45551188ab9d135de2`（`fix(kernel): frame 路径显式传播摘要卫星 —— 加法字段不再静默丢失`）。

**新增测试名**（9 例，本 ask 实测 `grep -n "it(" packages/kernel/tests/summary-satellite-frame.test.ts`）：

1. ① 框外摘要：基座产出卫星，展开结果不得把它丢掉（红→绿核心）
2. ② 框路径不承诺卫星：框内摘要的 satellites 为空或缺失（显式降级）
3. ③ 框内摘要节点仍在 nodes 中（框路径不得让摘要消失）
4. ④ 无节点消失：全树 id 全集 ⊆ 展开结果 nodes 的 id 集
5. ⑤ 无摘要文档：展开结果与旧行为逐位等价（含 satellites 字段形态）
6. ⑥ 无框文档：走旧路径且不引入任何卫星扰动
7. ⑦ 框内摘要与框外摘要共存：只传播框外的，框内的留流行内可见
8. ⑧ 卫星传播是**同一批对象引用**（框外卫星几何不被岛展开改写）
9. ⑨ 嵌套框 + 缓存开/关：卫星传播逐位一致且可重复

### 3.2 缺陷② `bbox`：`subtreeBBox` 一致性测试不覆盖子树（既有用例对分叉恒盲）

**缺陷**：`packages/kernel/tests/summary-satellite.test.ts` 既有「带外沿口径」用例（原 `:362-385`）与实际组装成员带的用例都用**节点盒**（`n.box.x` / `n.box.x + n.box.w`）组装成员带；该夹具三个成员**均为叶节点**，故 `subtreeBBox(ln) ≡ ln.box`，`satellite.ts` 自持副本与 `layouts.ts` 导出件**即使分叉也恒等** → 既有断言无判别力。

**红证据原文**（bbox 树 `README.md`；命令 `cd packages/kernel && npx vitest run tests/summary-satellite.test.ts`）：

第一步「缺口确证」——变异 `satellite.ts:211` 的递归关闭（`for (const c of ln.children)` → `for (const c of [] as LayoutNode[])`）后跑**既有**用例：

```
Test Files  1 passed (1)
     Tests  19 passed (19)
```

即既有 19 个用例**在分叉下全部照常通过** → 缺口成立。

**绿证据原文**（同一变异态下加入新用例后）：

```
FAIL tests/summary-satellite.test.ts > S3-R1 · 子树口径：带外沿必须用子树并集（成员带子节点时判别）
     > 四项口径一致：layouts.subtreeBBox = 真实含子树节点 = 卫星落点
AssertionError: satellite.ts 副本：带外沿须用子树并集的 maxX:
  expected 400 to be close to 564, received difference is 164, but expected 0.000005
Tests  1 failed | 19 passed (20)
```

即原 19 例仍绿、**新用例独红**，失败量恰为「成员盒带 400」与「子树带 564」之差 **164px**。还原变异后：`Tests 20 passed (20)`；`git diff -- packages/kernel/src/` 为空。（截图同源：`README.md` 的「红证据」「绿证据」两段。）

**改动文件**：`packages/kernel/tests/summary-satellite.test.ts`（**仅新增**：`125 insertions / 0 deletions`，新 `describe` 块插在文件末尾之前的 `S3-R1 · 子树口径` 段）；`outputs/summary-node/S3/S3-R1-20260921-095941-R1/README.md`（+77，证据留档）。**未触碰生产源码。**

**commit SHA**：bbox 树 `007aefe`（测试）+ `396fb39`（README，**注意：bbox 树含两个 commit，见 §8.3 P-2**）；集成线对应提交 `1bba84d29abc4b56084a3e1d883ea6be0258fca6`（`test(kernel): S3-R1 补 subtreeBBox 子树口径一致性用例（原用例叶节点恒盲）`）。

**新增测试名**：`四项口径一致：layouts.subtreeBBox = 真实含子树节点 = 卫星落点`（describe：`S3-R1 · 子树口径：带外沿必须用子树并集（成员带子节点时判别）`）。

### 3.3 缺陷③ `nested`：`nestedSkip` 分支零正式覆盖

**缺陷**：`satellite.ts` 的 `nestedSkip` 分支（`:126-130`，判据 `r.memberIds.some(id => allSummaryIds.has(id))`）在本次提交前**零测试覆盖**——`git grep nestedSkip` 全仓命中只在 `satellite.ts` 自身（源码 8 处，测试 0 处；原文见 nested 树 `baseline-env.txt`）。

**红证据原文**（nested 树 `red/nested-red.txt`）：变异 = 整段删除 `satellite.ts:126-130` 的 `if (r.memberIds.some((id) => allSummaryIds.has(id))) { nestedSkip.add(r.summaryNodeId); continue; }`；命令 `npx vitest run tests/summary-satellite-nested.test.ts --reporter=verbose` → **exit=1**：

```
AssertionError: 外层摘要应命中 nestedSkip: expected [] to deeply equal [ 's1' ]
AssertionError: 外层摘要必须留在流内（不得进 skip）: expected true to be false // Object.is equality
AssertionError: 外层摘要不得被转成卫星: expected true to be false
AssertionError: 本夹具应恰好产出 1 颗卫星（内层摘要）: expected [ …(2) ] to have a length of 1 but got 2
AssertionError: 外层摘要应作为父的布局子节点留在流内: expected [ 'm1', 'm2' ] to include 's1'
 Tests  5 failed | 2 passed (7)
```

**还原证明原文**（`red/restore-proof.txt`）：

```
$ git hash-object packages/kernel/src/layout/satellite.ts
3ecc6e133cece07fdc32751dde2c0aac80cb8126
$ git rev-parse HEAD:packages/kernel/src/layout/satellite.ts
3ecc6e133cece07fdc32751dde2c0aac80cb8126
$ git diff --stat
(空 = 无源码改动)
```

**绿证据原文**（`green/nested-green-after-restore.txt`，还原后重跑；命令同上）→ **exit=0**：`Test Files 1 passed (1)` / `Tests 7 passed (7)`。门禁（`green/gates.txt`）：`npx tsc -b tsconfig.json` 输出空、退出 0；`npx vitest run`（全量 kernel）→ `Test Files 74 passed (74)` / `Tests 698 passed (698)`。

**改动文件**：`packages/kernel/tests/summary-satellite-nested.test.ts`（+229，全新文件，**仅此一个文件**）。生产源码**零改动**。

**commit SHA**：nested 树 `1b03d00658b89ac7ff6264e4b0626f25c518b886`；集成线对应提交 `7ef16da145085a88308635962ed2c31e4e55bfa8`（`test(kernel): S3-R1 nestedSkip 分支正式回归覆盖（7 例，含夹具可达性探针）`）。

**新增测试名**（7 例）：

1. 反例：外层摘要排在内层摘要之前 → 命中 summary-in-range 降级，nestedSkip 为空
2. 正例：外层摘要的成员区间真的含内层摘要节点 → nestedSkip 命中
3. 外层摘要不进入 skip / specs（不摘除、不产卫星几何）
4. 外层与内层节点都仍在普通流 / 布局输出中可见（不得让节点消失）
5. 不产生无效卫星几何：卫星盒有限且为正，且不含外层摘要
6. 摘除语义不因嵌套而改变：外层摘要占普通槽位，内层不占
7. 缓存开/关结果一致：nestedSkip 判定不依赖缓存

### 3.4 断言纪律（三项共同）

- **唯一允许的既有断言变更是「新增」**。三项均**未替换、未删除、未放宽**任何既有断言：集成线全 diff `git diff --name-status 9a523d31 HEAD` 中 `summary-satellite.test.ts` 为 `125 insertions / 0 deletions`，`-frame.test` / `-nested.test` 为全新文件；**全 diff 仅一条删除行**（`frameLayout.ts` 的旧 `return {...}`，被具名 `out` 取代）。
- **生产源码无 test-only 钩子/导出**：集成线 `packages/kernel/src` 相对候选的差集**只有 `frameLayout.ts` 一个文件**（`mindmap/forest/layouts/satellite/index.ts` 与 `react/demo/pipeline.ts` **零改动**）。
- **未触碰**：SVG、`SummaryLayer`、浏览器验收、图库 / 文件管理相关文件。

---

## 4. 三项负控逐条

> 负控 = 把修复**反向还原**，检查新增测试是否**按目标断言转红**。三项均为一键可复现的定向变异。以下「做法」与「红因原文」取自任务书给定素材（负控 JSON）与本 ask 实测复核。

### NC1 · 恢复 `frameLayout` 丢弃 `satellites`

| 项 | 内容 |
|---|---|
| 做法 | `packages/kernel/src/layout/frameLayout.ts:269-276` —— 删除 `const satellites = base.satellites?.filter(...)` 与 `if (satellites !== undefined && satellites.length > 0) out.satellites = satellites;`，改为注释后 `return out;`（展开重建 `LayoutResult` 时不携带 `satellites` 字段） |
| 是否按目标断言转红 | **是** |
| 真实退出码 | **1** |
| 红因原文 | `FAIL tests/summary-satellite-frame.test.ts > S3-R1 · 框路径：卫星字段不得静默丢失 > ① 框外摘要：基座产出卫星，展开结果不得把它丢掉（红→绿核心）` / `AssertionError: 展开结果丢失了基座产出的卫星 S-outside（satellites=undefined）——加法字段被静默丢弃: expected false to be true // Object.is equality` / `❯ tests/summary-satellite-frame.test.ts:330:7` / `Tests 4 failed \| 48 passed (52)`。同一文件内 ②③④⑤⑥ 通过。无 `Invalid hook call` / 模块解析 / 旧 dist / 编译错误日志（grep 计数 0）。 |

### NC2 · `subtreeBBox` 改回只取根节点盒

| 项 | 内容 |
|---|---|
| 做法 | `packages/kernel/src/layout/satellite.ts:204-212` —— `subtreeBBox` 去掉 `for (const c of ln.children) { const cb = subtreeBBox(c); ... }` 递归并集，直接 `return { minX: ln.box.x, minY: ln.box.y, maxX: ln.box.x+ln.box.w, maxY: ln.box.y+ln.box.h };` |
| 是否按目标断言转红 | **是** |
| 真实退出码 | **1** |
| 红因原文 | `FAIL tests/summary-satellite.test.ts > S3-R1 · 子树口径：带外沿必须用子树并集（成员带子节点时判别） > 四项口径一致：layouts.subtreeBBox = 真实含子树节点 = 卫星落点` / `AssertionError: satellite.ts 副本：带外沿须用子树并集的 maxX: expected 400 to be close to 564, received difference is 164, but expected 0.000005` / `❯ tests/summary-satellite.test.ts:566:58` / `Tests 1 failed \| 51 passed (52)`。该断言正是钉住「带外沿 / 卫星几何」的目标断言。无编译 / 环境错误日志（grep 计数 0）。 |

### NC3 · 删除 `nestedSkip` 分支

| 项 | 内容 |
|---|---|
| 做法 | `packages/kernel/src/layout/satellite.ts:125-130` —— 删除 `if (r.memberIds.some((id) => allSummaryIds.has(id))) { nestedSkip.add(r.summaryNodeId); continue; }` 判定与 `continue`（`allSummaryIds` 随之不再被消费，但 `tsc` 构建仍通过） |
| 是否按目标断言转红 | **是** |
| 真实退出码 | **1** |
| 红因原文 | `FAIL tests/summary-satellite-nested.test.ts > S3 · nestedSkip：嵌套外层摘要不摘除、不产卫星、两个节点都可见 > 外层摘要不进入 skip / specs` / `AssertionError: 外层摘要必须留在流内（不得进 skip）: expected true to be false // Object.is equality ❯ tests/summary-satellite-nested.test.ts:154:60` / 另一条：`FAIL > 外层与内层节点都仍在普通流 / 布局输出中可见（不得让节点消失）` / `AssertionError: 外层摘要不得被转成卫星: expected true to be false ❯ :170:48` / `Tests 5 failed \| 47 passed (52)`。无编译 / 环境错误日志（grep 计数 0）。 |

### 4.1 负控结论

- **是否三项全部按目标断言转红：true**
- **是否作弊：false**
- 三项退出码均为 **1**（NC1 / NC2 / NC3），且红因均为 `AssertionError`（非模块解析 / 编译 / 旧 dist / 环境错误）。

---

## 5. 门禁与预算实测数字（含与参考值比对）

### 5.1 本回执作者本轮实跑（在集成线 `7ef16da` 上）

| 命令 | 退出码 | 实测 |
|---|---|---|
| `npx vitest run`（`packages/kernel`，全包） | **0** | `Test Files 75 passed (75)` / `Tests 708 passed (708)` |
| `npx vitest run tests/summary-satellite.test.ts tests/summary-satellite-cache.test.ts tests/summary-satellite-forest.test.ts tests/summary-satellite-frame.test.ts tests/summary-satellite-nested.test.ts` | **0** | `Test Files 5 passed (5)` / `Tests 52 passed (52)`（frame 9 / nested 7 / cache 8 / forest 8 / satellite 20） |
| `npx vitest run tests/summary-satellite-frame.test.ts tests/summary-satellite-nested.test.ts tests/summary-satellite.test.ts` | **0** | 3 files / **36 passed**（20 + 9 + 7） |
| `npx tsc -b tsconfig.json`（`packages/kernel`） | **0** | 无输出 |

> 以上四条均为本 ask 内实跑，非转述。kernel 全包 708 与定向 52 与门禁执行方记录**逐数相同**。

### 5.2 门禁逐条与参考值比对（素材给定，见 §5.3 限定）

| 门禁 | 命令 | 退出码 | 实测 | 参考值 | 比对 |
|---|---|---|---|---|---|
| S3 定向（kernel layout 卫星套件） | `npx vitest run tests/summary-satellite{,-cache,-forest,-frame,-nested}.test.ts` | 0 | 5 files / **52 passed** | 候选态同命令 3 files / **35 passed** | **+17**（frame 9 + nested 7 + cache 8 + forest 8 + satellite 20 vs 候选） |
| kernel 全包 | `npx vitest run` | 0 | 75 files / **708 passed** | **691** | **+17**（新增 16 例 + 既有 1 例新增断言，**无测试减少**） |
| react 定向 | `npx vitest run tests/summary-satellite-pipeline.test.ts` | 0 | 1 file / **3 passed** | 未随素材给出 | 依退出码 0 |
| react 全包 | `npx vitest run` | 0 | 158 files / **1602 passed** | **1602** | **= 参考值（未变）** |
| canvas 定向 | `npx vitest run tests/summary-two-hop.test.tsx tests/summary-two-hop-host.test.tsx` | 0 | 2 files / **38 passed** | 未随素材给出 | 依退出码 0 |
| canvas 全包 | `npx vitest run` | 0 | 45 files / **391 passed** | **391** | **= 参考值（未变）** |
| typecheck | `pnpm typecheck` | 0 | 4/4 子项目 Done（kernel/react/free-canvas/canvas 含 `tsconfig.test`） | 未随素材给出 | 依退出码 0 |
| build | `pnpm -r build` | 0 | 4/4 Done；canvas vite `✓ 250 modules, built in 152ms` | 未随素材给出 | 依退出码 0 |
| depcruise | `pnpm depcruise` | 0 | ✔ no dependency violations (**558 modules, 1678 deps**)；无循环依赖 | 计划书 530 / 1574 | 模块数**上升**（见 §5.3 限定） |
| lint | `npx biome lint packages apps --max-diagnostics=none` | 0 | 565 files；**Found 1541 warnings + 48 infos, 0 errors** | **1541 + 48** | **= 参考值（不上升）** |
| budget | `pnpm budget` | 0 | 全指标在预算内：`any 0/0 · tsIgnore 0/0 · bang 89/90 ↓1 · asCast 31/31 · console 4/4 · todo 1/1 · defaultExport 2/2 · bigFiles 4/4` | — | **持平或下降** |
| 文件边界 | 逐条实测 | 0 | `mindmap.ts 575<600` · `cutAttach.ts 591<600` · `frameLayout.ts 468<600` · `branching.ts` blob `94944bfdea8e11b7931ce679c9ce888b3c62e52a` 在 HEAD/9a523d3/e187fa9 三处**全等** | — | 全部通过 |

### 5.3 门禁与预算结论与限定

- **门禁新增债务：0**（lint 持平、budget 持平或下降、react/canvas 全包与参考值逐数相同）。
- **限定（如实标注）**：
  1. react 定向 / canvas 定向 / typecheck / build / depcruise **五行的参考值未随素材给出**，其「无回归」判定实际依据是**退出码 0**，而非「逐数对比」。
  2. depcruise 的 **558 模块 / 1678 deps 相对计划书基线（530 / 1574）为上升**；本回执据计划书原文补注，**未改判定**（依赖数上升可由新增测试文件引入，但本回执**未逐条归因**）。
  3. `bang 90→89` 的下降方向**未定**（可能是预算改善、也可能是某处 `!` 断言被删的信号）；因基线/候选态的 `bang` 实测值原文未随表提供、且无指向具体 `!` 的定位输出，**该交叉核对状态记为「未做」**。
  4. 上述 r0/canvas 等数字**未由本回执作者复跑**（本回执作者只跑 kernel 侧四条 + `tsc -b`）。

---

## 6. 三类问题分开

### 6.1 第一类 · R1 新增差异（本轮引入、必须由本轮负责）

| 项 | 事实 |
|---|---|
| 生产源码 | **仅 `packages/kernel/src/layout/frameLayout.ts`（+34/−1）**：新增契约注释段（`:202-219`）+ 显式传播/降级逻辑（`:261-276`）。 |
| 测试 | `summary-satellite-frame.test.ts`（**A**，+510）+ `summary-satellite-nested.test.ts`（**A**，+229）+ `summary-satellite.test.ts`（**M**，+125/−0）。 |
| 文档 | `outputs/summary-node/S3/S3-R1-20260921-095941-R1/README.md`（**A**，+77，bbox 线产出）。 |
| 合计 | `5 files changed, 974 insertions(+), 1 deletion(-)`（本 ask 实测 `git diff --name-status` 与 `--stat`）。 |
| 关键不变量 | `packages/kernel/src/layout/{mindmap,forest,layouts,satellite,index}.ts` 与 `packages/react/src/demo/pipeline.ts` 在 `9a523d3..HEAD` 区间**零改动**。 |
| 新增债务 | **0**（§5.3）。 |

**R1 新增差异的方向**：`frameLayout.ts` 的加法字段传播使**框外摘要**的卫星不再丢失；三项测试把此前无判别力的边界（子树口径、nestedSkip）显式钉住。**无一既有断言被替换/删除/放宽**（§3.4）。

### 6.2 第二类 · 基线既有缺陷（R1 之前就存在，**非本轮引入**）

| # | 缺陷 | 事实与实测 | 本轮是否处置 |
|---|---|---|---|
| B-1 | **`layoutLogic` 热缓存 + 折叠换实例：与无缓存不等价** | `summary-satellite-cache.test.ts:305` 用例名即『【基线既有缺陷 · 边界标注】layoutLogic 热缓存 + 折叠换实例：与无缓存不等价』；注释 `:291` 明写「前置缺陷（**基线既有，非本批引入**）：`layoutLogic` 不做 `collapsedKey`/`measureKey` 校验」。门禁执行方独立复算：同一探针在**候选源码**与**基线 `e187fa9` 源码**上各跑一次 → 两端逐位相同 `{WARM:5, STALE:5, COLD:2}`；`layouts.ts` 在 `9a523d3..HEAD` 零改动可交叉印证。 | **未修**（不在本轮范围；本轮只碰 `frameLayout.ts`）。 |
| B-2 | **`satellite.ts:44-45` 注释声称的循环依赖不成立**（评审方实测：注入该 import 后 `depcruise packages apps` 得 `✔ no dependency violations found (556 modules)`） | 属**注释级**，与实测不符。 | **未修**（非本轮范围）。 |
| B-3 | **`frameLayout.ts` 的 biome 2 项（import 组织 + 格式）系候选代码既有** | frame 线以 `git stash` 对照确认：候选版与修复版各报**同样 2 项**；frame 线特意回退了 `biome --write` 造成的 import 重排以保持 diff 最小。 | **未修**（刻意保持 diff 最小，建议后续单独清理）。 |

> **口径**：以上三项均**不是 R1 引入**，本回执**不归因给本轮**，亦**不在本轮修**（B-1 甚至不是本包引入的语义，而是 `layoutLogic` 的缓存键校验缺口）。

### 6.3 第三类 · 流程偏差（与代码正确性无关，但影响可追溯性）

| # | 偏差 | 事实 | 影响 | 处置（本轮实际做法） |
|---|---|---|---|---|
| **P-1** | **集成 commit 不在本仓任何分支上** | 本 ask 实测：`git branch --contains 7ef16da…`（主仓内）**输出为空**；`git worktree list` 显示集成线为 **detached** linked worktree；`git merge-base --is-ancestor 9a523d31 7ef16da` = YES | 该 worktree 的 HEAD 受 **reflog 保护**（`git reflog` 实测 4 条：`7ef16da`/`1bba84d`/`e1f0d71`/`9a523d3`），`worktree remove` 后一段时间内仍可找回；**真正丢失时点是 `gc` 按 `gc.pruneExpire`（默认 90 天）回收到期后**。可达性**有期**。 | **阻断级**：S4 启动前必须显式落地（如 `git branch s3-r1-integ 7ef16da`）。**本回执未执行任何写操作**（不建分支 / 不合入 / 不 push）。 |
| **P-2** | **bbox 树含两个修复 commit（非任务书所设「每棵一个」）** | bbox 树 `007aefe`（test）+ `396fb39`（docs README），两者**均以候选为父** | 集成线须维持「候选..HEAD 恰三条」 | 集成方按任务书指定的补丁来源 `git diff <候选> HEAD` 取 bbox **净差异**，合成**一条** `1bba84d`（subject 沿用 `007aefe`）。**两提交内容无一丢失**（5 文件 git oid 与各修复树逐一 IDENTICAL），但 **README 的 docs 提交信息未单独保留**。 |
| P-3 | **证据不随交付树走** | 三棵修复树的证据分散在各自 `outputs/…`，其中仅 bbox 的 `README.md` 被跟踪并进入交付树（§1.3） | 交付树内该目录只有 `README.md` + 未跟踪的 `gates-…-gates.md` | 已在 §1.3 逐文件列出实际路径；**未做复制/归档**。 |
| P-3a | **P-3 的叠加风险**（未跟踪日志 + 不随交付树 + 修复树清理 = 可能永久丢失） | `red-frame.log`、`nested-red.txt` 等属**未跟踪**证据，且不在交付树内 | 若修复树被 `worktree remove` / 清理，**该证据无法随任何交付物找回** | **仅记录该推理，未做任何处置**（未复制、未归档、未改 ignore）。 |
| **P-4** | **`.gitignore` 间歇命中「`.gitignore:36`」** | nested 线建证据目录时，`git check-ignore -v` 曾对**带尾斜杠**的 `outputs/…/red/` 命中『.gitignore:36』（该文件仅 39 行且第 36 行实为空行）；但 `.gitignore` 与 HEAD 逐字节一致（`8ab7c69260bac6d5299d77284483281e329db7d1`），新文件 `git status --untracked-files=all` 全为 `??`（**实际未被忽略**） | 无实际影响（证据可见） | 评审确认方已在**全新 `git init` 草稿库**中复现该幻影命中并归因（git 2.54.0.windows.1 对「目录形态且无匹配规则」的路径报最后一条空行）。**实施者只上报、未修改任何 ignore 文件，处理正确。** |
| P-5 | **集成执行方未运行 react / free-canvas / apps 测试** | 集成方自述「任务书只点名 kernel 定向集」 | 集成态下 react/canvas 未由集成方实跑 | §5.2 中 react/canvas 各行数据来自门禁执行方的记录，与本回执的 kernel 实跑**同源不同人**。 |
| P-6 | **三包齐跑未由任何一方完整执行** | 本回执作者仅跑 kernel；评审方自述未跑 react / canvas | 跨包回归证据链不完整 | 交叉见 §10 第 3 条。 |

---

## 7. 交付线结构（集成线）

### 7.1 终态

| 项 | 值 | 复核命令（本 ask 实测） |
|---|---|---|
| 集成线 HEAD | `7ef16da145085a88308635962ed2c31e4e55bfa8` | `git rev-parse HEAD`（集成树内）→ 一致 |
| 集成线 Tree | `a2b16714c33ff7ddc16d439fd19734bfb7e3ed8b` | `git rev-parse 'HEAD^{tree}'` → 一致 |
| 固定候选 | `9a523d31b33eb9083642d69e2449a2342fac8e8b`（Tree `cc49754a0cbf0cf473dff881c270eb6e2c222082`） | `git merge-base --is-ancestor 9a523d31 HEAD` → **YES** |
| 冲突 | **无**（三补丁文件互不重叠，`git apply` 三次均 cleanly） | — |
| 线性度 | 三条提交单父链 `9a523d31 → e1f0d71 → 1bba84d → 7ef16da` | `git log --format='%H %s'` → 恰 3 条 |
| reflog | 4 条，**无 `commit (amend)`** | `git reflog` → `7ef16da`/`1bba84d`/`e1f0d71`/`9a523d3` |
| 门禁树 = 集成树 | **一致**（§5.1 四条实跑均在集成树内执行；门禁文件亦在集成树内产出） | — |

### 7.2 三条 commit（SHA + 标题）

| # | SHA | 标题 | 父 | 触及 |
|---|---|---|---|---|
| 1 | `e1f0d71de691bbf1bb30fc45551188ab9d135de2` | `fix(kernel): frame 路径显式传播摘要卫星 —— 加法字段不再静默丢失` | `9a523d31` | `frameLayout.ts` +34/−1；`summary-satellite-frame.test.ts` +510 |
| 2 | `1bba84d29abc4b56084a3e1d883ea6be0258fca6` | `test(kernel): S3-R1 补 subtreeBBox 子树口径一致性用例（原用例叶节点恒盲）` | `e1f0d71` | `summary-satellite.test.ts` +125；`outputs/…/README.md` +77 |
| 3 | `7ef16da145085a88308635962ed2c31e4e55bfa8` | `test(kernel): S3-R1 nestedSkip 分支正式回归覆盖（7 例，含夹具可达性探针）` | `1bba84d` | `summary-satellite-nested.test.ts` +229 |

（本 ask 实测 `git log --format='%H %s' 9a523d31..HEAD` 与 `git show --stat --format='%P'` 逐条核对，父链均为单父。）

### 7.3 最终变更清单

```
A  outputs/summary-node/S3/S3-R1-20260921-095941-R1/README.md
M  packages/kernel/src/layout/frameLayout.ts
A  packages/kernel/tests/summary-satellite-frame.test.ts
A  packages/kernel/tests/summary-satellite-nested.test.ts
M  packages/kernel/tests/summary-satellite.test.ts
```

（`git diff --name-status 9a523d31 HEAD` 实测；合计 `5 files changed, 974 insertions(+), 1 deletion(-)`。）

### 7.4 逐文件哈希

**口径 = git blob（LF，in-repo canonical）**，命令 `git rev-parse HEAD:<f> | git cat-file blob | sha256sum`（本 ask 在集成树内实跑）：

| sha256 | git blob (sha1) | 文件 |
|---|---|---|
| `c5f7372a18e2ae07e8e64f55e83aec18c7cde6707969edadaccf65fd57e0a578` | `84092c094ddbe2e93822deae5d6ec50b179e55e6` | `packages/kernel/src/layout/frameLayout.ts` |
| `d4205961fce103006f586a8cc3f04bf5b16bab68135a96fb9eb34cf122f25882` | `609c5d7a7be726f59e5a857b732f4aabcbf333ca` | `packages/kernel/tests/summary-satellite-frame.test.ts` |
| `4fedcab53d007031808993dfcbb6e6325ce5cd0521d39678e88330b7cbc8aced` | `d14dc4c29d3c29dd13f0ee931aa03e9b830f791d` | `packages/kernel/tests/summary-satellite-nested.test.ts` |
| `aa6eaa901fed82a1cc7da2a378cbc293448d3893e411f1a857f5974627f28abf` | `80ba60aa791be9f3ab08be5aae9cea1fa1b929a4` | `packages/kernel/tests/summary-satellite.test.ts` |
| `871b01b45b778040b5021b6320257f4bf34f586e07218698725fbcc175a0e3f7` | `7372b137eed572789b6d16ca4d9741269e2d94e2` | `outputs/summary-node/S3/S3-R1-20260921-095941-R1/README.md` |

> **本回执作者已逐条实跑复核以上 5 枚 sha256 与 5 枚 git blob oid，全部一致**（命令见上）。
>
> ⚠️ **勿混用口径**：另有「raw worktree 口径」（CRLF，因 `core.autocrlf=true` 且无 `.gitattributes`）给出**不同**的 sha256 ——
> `e783044af6ceb034d5355da5877c551da55d79899df8dff5a23cae6dc333b9da`（frameLayout.ts）、`9db180e129d3358de679d3bc63578faaac7e186d33ccdb914176a2da72c22727`（-frame.test）、`ff0604e5e8f4c0e9c60569b72d4eb6ca82720fd07cd8c176bd4d301961de1b15`（-nested.test）、`221efc0584c95242c65b6a90bf51f3b81b7aef3e436041d93642d1859d1e4cf0`（satellite.test）、`3370a0dc129fba521781155f527615f232a81ab1e0c166fe75de3e584e2b2f95`（README.md）。
> 两套数值都对，但**口径不同，不可互比**。**本回执以 git blob 口径为准。**

**零语义漂移证明**：5 个变更文件的 git oid 与各修复树逐一比对**全部 IDENTICAL**（`frameLayout.ts=84092c09`、`-frame.test=609c5d7a`、`satellite.test=80ba60aa`、`README=7372b137`、`-nested.test=d14dc4c2`）—— 集成过程未产生任何语义漂移。

---

## 8. 结论与未覆盖项

### 8.1 逐条结论

| 项 | 结论 |
|---|---|
| 方案声明 | **三项全部方案 B**（frame = 显式降级 + 显式传播；bbox = 只补判别力测试；nested = 只新增测试） |
| 缺陷① frame | **已修复并被接受**。红证据在隔离副本独立复现（NC1：4 failed，含 ① 核心断言原文）；绿证据复现（9 passed / kernel 700 passed） |
| 缺陷② bbox | **已修复并被接受**。NC2 实测仅新用例独红、既有 19 例全绿（1 failed \| 19 passed / `EXIT=1`），缺口与判别力双双成立 |
| 缺陷③ nested | **已修复并被接受**。NC3 实测 5 failed / `EXIT=1`，五条 `AssertionError` 与修复者留存原文逐字相同；夹具**真命中** `nestedSkip` 非假覆盖 |
| 三项负控 | **全部按目标断言转红**（NC1/NC2/NC3 退出码均为 1，红因均为 `AssertionError`） |
| 是否作弊 | **否**（集成树内实测：`it.fails`/`test.fails`/`.only(`/`xit(`/`xdescribe`/`describe.skip`/`it.skip`/`test.skip`/`.todo(` 全部 **grep 零命中，exit=1**；新文件无 `catch`；无 test-only 导出） |
| 既有断言 | **未替换、未删除、未放宽**（`summary-satellite.test.ts` 为 125 insertions / 0 deletions；全 diff 仅一条删除行） |
| 门禁新增债务 | **0**（限定见 §5.3） |
| 集成成立性 | **成立**（三条提交 / 线性单父 / 零冲突 / 门禁树 = 集成树） |
| **未 amend / 未 rebase / 未 force / 未 push** | **确认：全部未做**（候选仍是 HEAD 祖先；reflog 无 `commit (amend)`） |
| **未启动 S4** | **确认：未启动**（未修改 SVG / SummaryLayer / 浏览器验收 / 图库·文件管理相关文件） |
| **⚠️ 集成线尚未落地到任何分支** | **本轮唯一的阻断级开放项 —— 见 §6.3 P-1** |

### 8.2 未覆盖项（如实列出，不填猜测）

1. **`!ctx.spatialDropped.has(...)` 子句无判别力**（`frameLayout.ts` 集成态新逻辑中）：评审 finding 实测——把该子句删掉后 `summary-satellite-frame.test.ts` 仍 **9 passed / exit 0**，**kernel 全包仍 700 passed**，即**整个 kernel 套件都不分辨该子句**。评审确认方进一步指出：该 finding 的「注释理由不成立」**被实测推翻**（存在真实可达的「布局根==框根」静默降级分支，由 `!ctx.dropped` 子句兜住）。**精确表述**：本回执只测得「文档根成框 → 由 `dropped` 子句兜住」，**未测得任何使其单独决定结果的输入**，故该项记为「**未证可达**」而非「已证不可达」——它是**无判别力的防御性子句，不是已证死代码**。**未修改**。
2. **`satellite.ts` 自持 `subtreeBBox` 经卫星落点间接观测**：该副本未导出，且纪律禁止为测试加 test-only 导出，故经几何间接断言（测试注释已写明折中）。**非直接调用该函数**。
3. **三包齐跑未由任何一方完整执行**：本回执作者只跑 kernel（定向 52 / 全包 708 / `tsc -b`）；评审方自述未跑 react / canvas；集成方自述未跑 react / free-canvas / apps。react 1602 / canvas 391 的回归判定来自门禁执行方记录，**未由本回执作者复跑**。
4. **运行时端到端未验证**：三修复均只有测试与构建证据，**未验证** `pipeline.layoutDemo` 的真实渲染（框路径下框外摘要括线是否实际出现）。本轮按任务书**未启动 S4**，故该项未做。
5. **`nestedSkip` 无运行时消费者**：`packages/react/src`、`apps/` 中引用数为 0，故该判据是**纯包含性**的。**⚠️ 该「引用数为 0」的 `git grep` 命令与输出未由本回执实跑**，目前**无可引证据**。
6. **覆盖率数字缺失**：从未运行带 coverage 的 vitest。「本批前该分支零覆盖」是依 `git grep`（基线全仓 `nestedSkip` 零命中）与「删除分支转红」的对照推得，**非覆盖率报告证实**。
7. **子节点数导致的数值差异已显式标注**：bbox 的证据 README 记录「上一轮同岗位者报告成员一子树盒 `minY=-81/maxY=-7`、卫星 y=0；本夹具子节点数为 3 而非 1，故本工作树复算得 `minY=-103/maxY=15`（并集 `278,-103,542,103`）」——判别结论一致，数值不同，**以本工作树复算值为准**。
8. **`frameLayout.ts` 的 biome 2 项未修**（B-3）：属候选代码既有问题，刻意保持 diff 最小。
9. **`satellite.ts:44-45` 的循环注释与实测不符未修**（B-2）：属注释级。
10. **`frameLayout.ts:273-275` 的集成态行号未复算**：评审 finding 的该锚点只在 frame 树 HEAD `3d5456aa` 成立（固定候选 `9a523d31` 里 `spatialDropped` 在第 272 行、**不存在** `!ctx.spatialDropped` 守卫）；集成态的行号**本回执未复算**。**读者拿到集成线后可能找不到对应行。**
11. **`budget bang 90→89` 与「未删除断言」的交叉核对未做**（§5.3）。
12. **§5.2 中五行门禁（react 定向 / canvas 定向 / typecheck / build / depcruise）的参考值未随素材给出**（§5.3）。

### 8.3 声明

- **未 amend、未 rebase、未 force、未 push**（本 ask 实测：候选仍为集成 HEAD 祖先；集成树 reflog 仅三条 `commit:`，无 `commit (amend)`）。
- **未启动 S4**（本轮仅动 kernel 一个生产文件 `frameLayout.ts` 与 kernel 测试文件）。
- **本回执作者未写入任何被评审源码**；仅新建本报告文件（`docs/dispatch/2026-09-21-summary-node-s3-r1-report-v2.md`），**未覆盖**任务书指定的既有文件。

---

## 附：本回执的证据来源与自查口径

- **本回执作者本轮实跑**（均为 ask 内执行）：集成树 `git rev-parse HEAD` / `HEAD^{tree}` / `git log --format='%H %s' 9a523d31..HEAD` / `git rev-list --count` / `git diff --name-status` / `git show --stat` / `git rev-parse HEAD:<f>` + `git cat-file blob` + `sha256sum`（§1、§7）；集成树 kernel 全包 708 / 定向 52 / 三文件 36 / `tsc -b` exit 0（§5.1）；`git branch --contains 7ef16da` 为空（§6.3 P-1）；`git worktree list`（§1.2）；no-cheat 模式 grep（§8.1）；证据文件原文读取（§3、§4）。
- **取自素材（任务书给出的修复者自述 / 评审结论 / 负控 / 门禁 / 集成线汇报）**：三项自述与红绿证据、三项负控的做法/退出码/红因原文、评审三份结论、门禁与预算逐条数字、集成线终态与逐文件哈希。
- **明确未由本回执作者复跑**：`pnpm typecheck` / `pnpm -r build` / `pnpm depcruise` / `npx biome lint` / `pnpm budget` / react 与 canvas 全包 / 带 coverage 的 vitest / `pipeline.layoutDemo` 运行时渲染 / 三项负控变异（本回执引用素材给定原文，未在本树内重放变异）。
- **本回执如实标注的「结论有、原文未随素材提供」缺口**：NC1 的退出码在素材中虽有（=1），但其**原始 stdout 全文**未随素材提供（仅红因行）；§5.3 第 1 条五行的参考值；`nestedSkip` 消费者的 grep 命令与输出；`bang` 基线/候选态实测值原文。以上均**未按已核引用**。
