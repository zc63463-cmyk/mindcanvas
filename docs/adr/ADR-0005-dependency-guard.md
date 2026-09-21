# ADR-0005 · 依赖方向守护（Architecture Guard）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-01 |
| 决策人 | 蒋指导、WorkBuddy（工程执笔） |
| 状态 | 已接受（已落地：dependency-cruiser + git hooks + CI 配置就绪） |
| 上游 | ADR-0001（库优先）· ADR-0004（接口冻结 v1）· 2026-09-01 架构深度分析报告 |

## 背景

2026-09-01 的架构盘点暴露一个结构性缺口：

- 项目**内在纪律很强**——3 处 typecheck 全绿、746 个测试（测试代码比 1:21）、4 个 ADR、11 个文档目录；
- 但**外在防线为零**——无 CI、无 lint/format、无架构守护；
- 最严重的：**`kernel 零运行时依赖 / 无 DOM` 这条最宝贵的架构资产，没有任何机器防线**。
  该事实在盘点当天是靠**手工 grep** 验证的——只要有人 `import react` 进 kernel，没有任何机制会阻止。

同时盘点确认：项目当时**无 git remote、无 commits**，GitHub Actions 无法立即运行。

## 决策

**引入 dependency-cruiser 作为架构依赖守护，把架构约定变成机器可执行的规则。**

### 1. 依赖方向（不可协商）

```
packages/kernel  ──▶  ∅                （零运行时依赖、无 DOM）
packages/react   ──▶  @mindcanvas/kernel
apps/canvas      ──▶  @mindcanvas/react + @mindcanvas/kernel
apps/*           ─X─  apps/*           （app 之间互不依赖）
```

### 2. 守护规则（`.dependency-cruiser.js`，7 条）

| 规则 | 严重级 | 守护内容 |
|---|---|---|
| `kernel-pure` | error | kernel 禁止依赖 react / react-dom / @mindcanvas/react / apps |
| `kernel-no-node-builtin` | error | kernel 禁止依赖 fs/path/os 等 Node 内置模块（保持同构） |
| `no-kernel-depends-on-outer` | error | kernel 禁止依赖 packages/react 与 apps |
| `no-cross-app` | error | apps 之间互不依赖（`pathNot` 排除同 app 内部引用） |
| `no-circular` | error | 全局禁止循环依赖 |
| `no-orphans` | warn | 孤立模块提示死代码（研究中产物允许暂时孤立） |
| `no-duplicate-dep` | warn | 同一依赖多版本共存 |

### 3. 三层防线（因无 git remote 而分层落地）

| 层 | 载体 | 触发时机 | 状态 |
|---|---|---|---|
| 本地 | `pnpm gate:fast`（typecheck + depcruise） | 手动 / pre-commit | ✅ 立即生效 |
| 本地 | `pnpm gate`（+ 746 测试） | 手动 / pre-push | ✅ 立即生效 |
| Git hooks | `.githooks/`（`core.hooksPath=.githooks`） | commit / push 自动 | ✅ 已配置，首次 commit 起生效 |
| CI | `.github/workflows/ci.yml` | push / PR | ⏳ 就绪待 `git remote add` |

**hooks 放 `.githooks/` 而非 `.git/hooks/`** —— 后者不进版本控制，无法团队共享。

### 4. 门禁分层原则

> **提交要轻快，推送要可靠。**

- `pre-commit`：只跑 depcruise（~10s），不跑全量测试
- `pre-push`：跑全量 gate（~2-3 分钟）
- 两者都可用 `--no-verify` 绕过（紧急通道），但规则文件里的 comment 会解释「为什么不能这么干」

## 理由

1. **kernel 纯净性是复利资产**——它让内核能在 headless（测试 / Node / CI）环境复用，也让 DOM 不泄漏进纯计算层。失去它，ADR-0001「库优先」就失去根基。
2. **机器防线 > 文档约定**——人会忘、会赶工、会偷懒；CI 不会。
3. **dependency-cruiser 而非 Nx / Turborepo**——3 包规模杀鸡用牛刀。depcruise 零侵入、规则即文档、跑一次 10 秒。
4. **负向测试验证有效性**——故意在 kernel 里 `import react`，确认守护真实拦截（`error kernel-pure: ... → react`，exit 1），再复原。规则不是摆设。

## 不做什么（明确排除）

- ❌ 不引入 Nx / Turborepo（3 包规模不需要）
- ❌ 不做 Feature-Sliced 重构（现有 kernel/react/canvas 分层已清晰，重构风险 > 收益）
- ❌ 不强推 lint/format 到 pre-commit（提交要轻快；风格门禁留给 P1 Biome + CI）
- ❌ 不拆 MapView（1305 行）作为门禁前置项——**先有防线，再动结构**

## 影响

- 新增文件：`.dependency-cruiser.js`、`.githooks/pre-commit`、`.githooks/pre-push`、`.github/workflows/ci.yml`
- 修改：根 `package.json` 增加 `depcruise` / `depcruise:graph` / `gate` / `gate:fast` 四个脚本
- 新增依赖：`dependency-cruiser@^18.2.0`（仅 devDependency，零运行时影响）
- 基线：227 模块 / 500 依赖，**当前 0 违规**

## 后续（P1/P2，不在本 ADR 范围）

- ~~P1：Biome 接管 lint + format~~ → **已完成，见下节**
- P2：MapView 拆分（先拆 interactions）；Changesets 自动发版
- 待 `git remote add` 后：CI 自动生效，届时把「本地 gate」与「CI gate」对齐校验

## P1 补充：Biome 风格门禁（2026-09-01 完成）

### 落地内容

| 项 | 内容 |
|---|---|
| 格式化 | `pnpm format:fix` 全量执行 —— **236 文件、修复 235 个**（539 errors → 174） |
| 门禁接线 | `lint` / `format` / `format:fix` / `lint:fix` 四脚本；`gate` 与 `gate:fast` 均含 lint |
| hooks | `pre-commit` 在 depcruise 后追加 `pnpm lint`（保持「提交要轻快」） |
| CI | `ci.yml` 门禁 4/5 → 5/5，追加 `pnpm lint` |
| ADR-0006 | 渲染后端策略（SVG 为唯一可信后端，Canvas 维持实验性）—— 见独立文档 |

### 最终状态

- `pnpm lint`：**0 error**（887 warnings + 44 infos，均不阻塞，exit=0）
- `pnpm gate:fast`：typecheck 3/3 + depcruise + lint 全过
- 格式化后 746 个测试全绿（格式化只改格式，不改语义）

### 降级为 warn 的规则（不清零存量债，只防劣化）

| 规则 | 数量 | 降级理由 |
|---|---|---|
| `a11y`（整组 `off`） | 92 | 无头画布应用：MapView 大量 div/svg 需 onClick 做指针交互，语义化按钮/键盘可访问性不适用；强制会破坏交互设计且收益为零 |
| `useHookAtTopLevel` | 38 | **已知真问题**：`MindmapStage.tsx:166` 早退 `if (!controller) return null` 之后仍调用 Hook（456 行 useMemo 等）。修复需重构控制流，属 P2 —— 详见下方「P2 深挖结论」 |

#### P2 深挖结论（2026-09-01 过渡处理时确认）

**原判断「controller 永不为空」是错的。** `useEditor` 签名返回 `EditorController`（非 null），但传入处是
`controllerRef.current ?? (null as unknown as EditorController)`，而 `controllerRef.current` 的初始化条件是
`if (controllerRef.current === null && editable)`（`MindmapStage.tsx:151`）。
**当数据管线解析失败（`editable` 为 null）时，controller 确实为 null** —— 该早退不是纯防御代码。

因此：

- ❌ **不能简单删除早退** —— 会导致后续 31 处 Hook（`:481` useMemo 读 `controller.root`、`:647` 读 `controller.dirty`）TypeError 崩溃
- ✅ **正确修复 = 组件拆分** —— 把 `StageInner` 拆为「数据加载层」+「渲染层」：外层在 `editable`/`controller` 为 null 时直接返回错误提示；内层接收**非 null** 的 controller，所有 Hook 无条件调用。这是 React 官方推荐解法
- ⚠️ **为何不在 P1 做** —— `StageInner` 是 1479 行核心组件，拆分涉及 31 处 Hook 依赖与大量 JSX 搬迁，风险显著高于收益。规则已降级为 warn（不阻塞门禁），且触发条件（解析失败）极罕见

已在代码 `MindmapStage.tsx:166` 上方固化上述分析（含修复方案），避免后人重复排查或误删早退。
| `useExhaustiveDependencies` | 26 | 画布性能场景常刻意省略依赖（避免每帧重算） |
| `useIterableCallbackReturn` / `noArrayIndexKey` / `noNonNullAssertedOptionalChain` | 18 | 风格问题，非正确性缺陷 |
| `noInvalidUseBeforeDeclaration` | 2 | 存量 |

### 排除目录

- `**/scripts`：`apps/canvas/scripts/*.mjs` 共 12 个诊断脚本**混用 TS 类型注解与 .mjs 扩展名**（如 `diag-10k-layout-perf.mjs:23` 的 `(d: number, indent: string): void`），Biome 按 JS 解析会报 15 个 parse 错误。这些是开发期诊断脚本，非产品代码，故整体排除而非改扩展名（改扩展名会影响 node 直接执行）

### 格式化踩坑（重要，避免复发）

1. **`@ts-expect-error` 会被格式化破坏**：`packages/react/tests/theme-tokens.test.tsx` 用单行对象 + `@ts-expect-error` 做「类型完整性守护」。格式化把单行对象展开为多行后，类型错误落在对象内部属性上，`@ts-expect-error`（在 const 行）覆盖不到 → 报 TS2578/TS2741，守护反而失效。
   **处置**：该文件已加 `// biome-ignore-all format:` 保护，禁止格式化。
2. **并发 agent 会改同一批文件**：格式化期间出现「行号对不上」的瞬时 typecheck 错误，实为其他 agent 正在写入该文件。**任何 typecheck 报错先重跑确认，再判断**。
3. **格式化前必须物理备份**：本项目长期无 commits，`git checkout` 救不回来。备份落在 `.backup-pre-format/`（1.5M），验收通过后清理。
