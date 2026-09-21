# 摘要节点 S1 回执：协议 / 访问器 / 三态锚解析 / 诊断 / 迁移登记

- **包**：SUMMARY-NODE · 任务 **S1**（S2–S5 未开始）
- **日期**：2026-09-20 ｜ **RunId**：`20260920-01`
- **冻结候选**：`069144603d56eee730725f848b0c2d69b0995187`（分支 `codex/base-integrate-frozen-20260920`，综合基线候选）
- **隔离 worktree**：`<workspace>/.workbuddy/wt-summary-node-s1`（主仓 `git status` 不可见；`.workbuddy/` 已 gitignore）
- **本包分支**：`codex/summary-node-s1-20260920` ｜ **HEAD**：`905c053fe396d1fbbc4d663bf4247b0853bffcec`
- **证据目录**：`outputs/summary-node/20260920-01/`（39 个文件，索引见其 `README.txt`；本回执另存一份为 `s1-report.md`）
- **结论**：S1 交付完成、红→绿→阴性对照三态证据齐全、门禁逐数持平；**可提交独立复核**。
  **未 push、未发布、未合并、未启动 S2。**

---

## §1 开工前置逐项核验

| # | 前置 | 实际 | 判定 |
|---|---|---|---|
| 1 | 冻结候选（不用共享脏工作树） | 候选 `0691446`（149 文件、含 DELIVERY-CLOSE 808 + P0-0 13 + index.ts 接线）；worktree 起点 `git status`=0 | 满足 |
| 2 | 独立 worktree | `.workbuddy/wt-summary-node-s1`，`git worktree list` 可见，与共享树并存不互扰 | 满足 |
| 3 | 候选引用 | `0691446`（分支 `codex/base-integrate-frozen-20260920`） | 满足 |
| 4 | 候选清单 + SHA-256 | `candidate-manifest.sha256`：**881 tracked + 2 只读复制件 = 883 条，missing=0**（`make-manifest.mjs` 可复算） | 满足 |
| 5–6 | P0-0 回执 / 复核 | 本批未直接依赖；候选已含 P0-0 产物（`workspaceScope.ts` 等 13 文件），worktree 内 `pnpm --filter @mindcanvas/react test` 全绿 | 不阻断（见 §7 限制 1） |
| 7 | 共享接线点处理方式 | 本批**未触碰** `packages/react/src/index.ts`、`packages/react/package.json`、`apps/canvas/src/MindmapStage.tsx`、`CHANGELOG.md`；`packages/kernel/src/index.ts` 为**加法导出**（+16 行，无删除） | 满足 |
| 8 | RunId | `outputs/summary-node/20260920-01/` | 满足 |

**计划/设计稿未入综合候选** → 从主工作树**只读复制**并逐字节校验：

| 文件 | 源 SHA-256 = 复制件 SHA-256 |
|---|---|
| `docs/dispatch/2026-09-20-summary-node-plan.md` | `878e5bc99139f7608c8025982c0dd4da033019fa383136aaa0fc751c2d8f625c` |
| `docs/2026-09-20-摘要节点-设计与实施规划.md` | `005aeab18140208e684c527126a0e8d484c260cf7a8fead4e7e2677f3f495438` |

工具链：`node=v24.15.0`、`pnpm=10.33.2`（与仓库 `packageManager` 声明一致）；`pnpm install --frozen-lockfile --prefer-offline` → exit 0，`Lockfile is up to date`（**未改锁文件**）。

---

## §2 基线实测 vs 计划 §0（差异先报，不用历史数字替代）

| 项 | 计划 §0 | 本次实测 | 差异 |
|---|---|---|---|
| kernel 测试 | 622 | **622/622** | — |
| react 测试 | 1502 | **1545/1545** | **+43** |
| canvas 测试 | 353 | **353/353** | — |
| depcruise | 530 模块 / 1574 deps / 0 | **537 / 1604 / 0** | +7 / +30 |
| lint | 1541 warn + 48 info | **1541 + 48** | 逐数持平 |
| budget | any 0 / bang 89-90 / asCast 31/31 / bigFiles 4/4 | **同** | 逐数持平 |
| typecheck / build | 0 / 0 | **0 / 0** | — |

**差异归因（可核）**：计划 §0 取自 2026-09-19 收口报；本批候选取自 2026-09-20 的综合基线，
已并入交付收口批次（808 文件）与 P0-0（13 文件）的新增用例与模块，
故 `react 1545`、`depcruise 537/1604` 高于 §0 是**候选前进**所致，非本批 S1 引入（S1 自身增量为 +34 kernel / +9 react 用例、+5 模块 / +18 deps）。

**流程事实（含一处纪律偏差）**：fresh worktree 必须先 `pnpm typecheck`（project references 产出 `dist/`），
否则依赖包解析失败（`Failed to resolve entry for package "@mindcanvas/kernel"` / `"@mindcanvas/free-canvas"`）而全红。
**偏差**：`gates/baseline-react-test.log`、`gates/baseline-canvas-test.log` 被失败后的复跑**复用同一路径**，
失败原文未单独留档（仅本回执与证据 README 记录该事实）；其后所有日志一跑一路径，未再覆盖。

---

## §3 S1 变更清单（10 文件：4 改 + 6 增）

`A` = 新增，`M` = 修改；SHA-256 见 `s1-changed-files.sha256`。

| 状态 | 文件 | 内容 |
|---|---|---|
| A | `packages/kernel/src/protocol/summary.ts`（71 行） | `summaryOf` / `upsertSummaryOf` / `removeSummaryOf` |
| M | `packages/kernel/src/protocol/types.ts` | `Note.summary_of?: SummarySpec` + `SummarySpec` 类型（+18 行） |
| A | `packages/kernel/src/registry/summary-anchor.ts`（218 行） | `resolveSummaries` / `collectSummaryDiagnostics` / `W_SUMMARY_DANGLING` |
| M | `packages/kernel/src/index.ts`（475 行） | 加法导出：3 个值 + 2 个类型 + `SummarySpec`（+16 行） |
| A | `packages/kernel/tests/summary-roundtrip.test.ts` | 13 用例：两形态往返 / 坏形态透传 / canonical / 写读闭环 |
| A | `packages/kernel/tests/summary-anchor.test.ts` | 21 用例：三态矩阵 / memberIds 区间 / 诊断 |
| M | `packages/react/src/edit/cutAttach.ts`（**591**/600 行） | ①`collectReferenceAnchors` 增 `summary_of.from/to` 分支；②`applyAnchorUpdateToNote` / `readAnchorField` 增 `summary_of.<leaf>` 形态解析 |
| A | `packages/react/tests/summary-anchor-migration.test.ts` | 9 用例：采集 / 改名重写 / cid 原样 / 剪切批量 / 幂等 / 删端点无损 |
| A | `docs/dispatch/2026-09-20-summary-node-plan.md` | 只读复制入候选（指纹锚定） |
| A | `docs/2026-09-20-摘要节点-设计与实施规划.md` | 只读复制入候选（指纹锚定） |

**行为口径（供复核）**

- `summaryOf`：仅当 `from` / `to` **皆为非空字符串**才返回；否则 `undefined`，**原值一律不删不改**（坏锚不静默删除）。
- `resolveSummaries`：cid 索引**一次预建**（无摘要文档零开销短路）；单次先序遍历同时产出「父 + 兄弟序」索引与待解析清单。
- 判定顺序（每条给最可解释的原因，`reason` 机器可读）：`unparsable-from/to`(stale) → `from/to-not-found`(dangling) →
  `summary-is-root` → `summary-not-same-parent` → `from/to-not-same-parent` → `order-inverted` → `summary-in-range` → well-formed。
- `memberIds` = 成员共同父的 `children.slice(fromIndex, toIndex+1)`（含两端，按兄弟顺序）；`parentId` 供 S3 卫星定位（**加法字段**）。
- 中间成员增删**不**触发 dangling（范围按位置自然伸缩）；端点失效才报 dangling。

---

## §4 红 → 绿 → 阴性对照（原文）

### 4.1 红（实现前，`red/`）

```
# red/s1-kernel-summary.log
 FAIL  tests/summary-anchor.test.ts
Error: Cannot find module '../src/registry/summary-anchor.js' imported from .../tests/summary-anchor.test.ts
 FAIL  tests/summary-roundtrip.test.ts
Error: Cannot find module '../src/protocol/summary.js' imported from .../tests/summary-roundtrip.test.ts
 Test Files  2 failed (2)
      Tests  no tests
EXIT=1

# red/s1-react-migration.log
 Test Files  1 failed (1)
      Tests  7 failed | 1 passed (8)
EXIT=1
```

### 4.2 绿（实现后，`green/`）

```
# green/s1-kernel-summary.log
 Test Files  2 passed (2)
      Tests  34 passed (34)
EXIT=0

# green/s1-react-migration.log
 Test Files  1 passed (1)
      Tests  9 passed (9)
EXIT=0
```

**实现过程中的两次自我修正（如实记录，均先红后绿）**

1. 首轮实现后 2 条红：`canonical` 断言未考虑写端 `yamlScalar` 对 `{` 起始标量的加引号/转义（`summary_of: "{\"from\"…}"`）；
   诊断文案未携带原因码。→ 修正断言为正则 `summary_of: "\{`、并把原因码写进消息。
2. `pnpm typecheck` 报 `TS2322: Type 'string | null' is not assignable to 'string | undefined'`（`parentId: self.parentId`）→ 改用已收窄的 `parent.id`。
3. 发现测试夹具语义错误：原「反缩进成员后仍 well-formed」期望**与设计不符**（成员被移出父级＝跨父，正确语义是 dangling）。
   → 把该用例改为「改名父级（两条锚一起跟随）」，另**新增**一条「成员反缩进 → 锚跟随但结构跨父 → dangling」正向钉住正确语义。

### 4.3 阴性对照 NC-同父（`nc/`）

- **中性化**：删除 `resolveOne` 的三处「同父」判据，其余逐字不变（`nc/neutralize.diff` 全文、`nc/summary-anchor.neutralized.ts` 中性化全文）。
- **执行点**：已提交内容 `905c053`，中性化前哈希 `76aa4944aad3430433e208346cc069c2e30f86faf713a8adfbf248e9ef576bdd`。

```
# nc/NC-sameparent-kernel.log
 × 端点移出同父（指向成员B的子节点）→ dangling(from-not-same-parent)
 × 摘要节点自身换了父级 → dangling(summary-not-same-parent)
 × 端点指向文档根自身 → dangling(from-not-same-parent)（根无兄弟，不能当成员）
 × 终点移出同父（指向成员B的子节点）→ dangling(to-not-same-parent)
AssertionError: expected { summaryNodeId: 's1', …(4) } to match object { state: 'dangling', …(1) }
      Tests  4 failed | 17 passed (21)
EXIT=1

# nc/NC-sameparent-react.log
 × 成员被反缩进移出范围 → 锚文本跟随新路径，但结构跨父 → dangling（可见、可解释、数据不丢）
AssertionError: expected { summaryNodeId: 'ndmu9soop61g', …(3) } to match object { state: 'dangling', …(1) }
      Tests  1 failed | 8 passed (9)
EXIT=1
```

**判别力**：转红集合与「跨父 / 错层」用例**一一对应**，其余 17 + 8 条不连带转红（无宽泛失败）。
**恢复**：`git checkout -- packages/kernel/src/registry/summary-anchor.ts`，恢复后哈希与提交逐位一致（`76aa4944…76bdd`）、`git status --porcelain` = 0，随后重建 `dist` 并复跑全量（见 §5）。

---

## §5 门禁实测（S1 后，逐数对照）

| 项 | 命令 | 实测 | 判定 |
|---|---|---|---|
| kernel | `pnpm --filter @mindcanvas/kernel test` | **70 files / 656 tests passed**，exit 0 | 622 → 656（+34） |
| react | `pnpm --filter @mindcanvas/react test` | **155 files / 1554 tests passed**，exit 0 | 1545 → 1554（+9） |
| canvas | `pnpm --filter canvas test` | **43 files / 353 tests passed**，exit 0 | 持平 |
| typecheck | `pnpm typecheck` | exit 0 | 持平 |
| build | `pnpm build` | exit 0 | 持平 |
| depcruise | `pnpm depcruise` | `no dependency violations found (542 modules, 1622 dependencies cruised)`，exit 0 | 537/1604 → 542/1622（新模块 2 + 新测试 3） |
| lint | `pnpm lint` | **`Found 1541 warnings.` / `Found 48 infos.`**，exit 0 | **逐数持平（不得上升已守住）** |
| budget | `pnpm budget` | any 0 / tsIgnore 0 / bang 89-90 / asCast **31/31** / console 4 / todo 1 / defaultExport 2 / bigFiles 4/4，exit 0 | 逐数持平 |

**行数预算**：`cutAttach.ts` **591**/600（余 9）；`kernel/src/index.ts` 475/600；`summary-anchor.ts` 218；`summary.ts` 71；
`branching.ts` **未触碰**。

**lint 不得上升的落实**：首轮实现引入 37 条新告警（36 × `noNonNullAssertion` + 1 × `useIterableCallbackReturn`），
全部在实现侧消除——正则捕获组改用解构默认值（`const [, dk = '', dleaf = ''] = …exec(field) ?? []`）、
测试夹具改用显式检查助手（`at()` / `childAt()` / `rootOf()`）、forEach 改块体。
**未放宽任何规则、未新增 `any` / `as` / `!` 债务**（asCast 31/31 持平，`!` 计数未上升）。

---

## §6 未运行项 / 限制 / 降级项

1. **未启动 S2**：无 `planCreateSummary` / `createSummary`、无右键菜单项、无 `summaryDraft` 草稿态、无两跳点选交互。
2. **未做 S4/S5 产物**：无 `summaryFrames.ts` / `SummaryLayer.tsx` / `verify-summary.mjs`；**无浏览器验证与截图**（S1 无渲染改动，按计划 S1 不含渲染验收）。
3. **未更新文档**：协议文档（`docs/specs/2026-09-02-mm-md-protocol.md`）、AI 契约、`CHANGELOG.md` 按计划属 S5，**本次均未改**。
4. **`.mm.md` 未改语法**：`summary_of` 走既有「一层嵌套 mapping / 对象值内联 JSON」两条能力，parser/serializer **零改动**（有往返测试钉住）。
5. **布局/缓存未触碰**：S1 不含布局改动，故无「逐位等价」证据（属 S3）。
6. 候选基线 `react/depcruise` 数字高于计划 §0，原因见 §2；**未以历史数字替代当前实测**。

## §7 阻断项与残余风险

1. **无阻断项**（本包范围内）。
2. **限制**：P0-0 的独立复核文档本批未随候选提供；本批只以「候选内含 P0-0 产物且全绿」为事实，
   **不声称 P0-0 已通过复核**——如主控需要，请在放行 S2 前一并确认。
3. **风险（交 S2/S3）**：
   - `summary_of` 写入时的 `cid` 补发与「跨父/根/倒序」拒绝提示属 S2；S1 只保证读侧三态与数据无损。
   - 范围含「中间成员折叠」的带高整合（L2）属 S3 停止条款域。
   - `duplicate` 的 cid 债务、跨父成员、非连续成员集合均为计划 §6 明确不做项。

---

## §8 下一包（S2）可消费接口

```ts
// @mindcanvas/kernel
summaryOf(note: Note | undefined | null): SummarySpec | undefined
upsertSummaryOf(note: Note | undefined, spec: SummarySpec): Note      // 不可变
removeSummaryOf(note: Note | undefined): Note                         // 不可变；未命中返回原引用
resolveSummaries(root: EditableNode): ResolvedSummary[]               // 三态 + memberIds + parentId
collectSummaryDiagnostics(resolved: readonly ResolvedSummary[]): SummaryDiagnostic[]
W_SUMMARY_DANGLING = 'W-SUMMARY-DANGLING'
type SummarySpec = { from: string; to: string }
interface ResolvedSummary {
  summaryNodeId: string; state: 'well-formed' | 'dangling' | 'stale';
  memberIds?: string[]; parentId?: string; reason?: string; label?: string;
}
```

`packages/react/edit/cutAttach.ts`：`collectReferenceAnchors` 已产出 `field: 'summary_of.from' | 'summary_of.to'`；
`applyAnchorUpdateToNote` / `readAnchorField`（经 `buildMigrationOps`）已能读写该形态——S2 建 S 节点后，
改名/缩进/重排/剪切会自动迁移锚，**无需再登记**。

---

## §9 交回声明

- **未 push、未发布、未部署、未合并**；未执行 `pull/rebase/reset/stash`；未 `git add -A`（逐路径 `add`）。
- 三条**本地**提交：`f036f99`（计划/设计稿入候选）、`1032699`（kernel 数据层）、`905c053`（react 迁移登记）。
- 未修改其他批次目录与历史证据（`outputs/file-assets/**`、`outputs/delivery-close-*` 等只读引用）；
  未改动共享工作树；未删除任何文件。
- 证据目录：`outputs/summary-node/20260920-01/`（索引 `README.txt`，含候选清单、基线、红/绿、NC、门禁日志、变更指纹）。

**是否可提交独立复核：可以。** S1 交付物、红/绿/NC 证据、门禁数字与候选指纹均已固化；
**尚未构成任何「产品已验收 / 已合并」的声明**，S2 起等待主控指令。
