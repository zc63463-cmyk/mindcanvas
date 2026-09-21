# 开发规范

> 本文件是**正面说明**：新代码该怎么写、为什么要这么写。
> 每条规范都注明**判据**——能自动检查的用工具固化，不能的检查项会写明人工核对方式。
>
> 数据基线来自 `node scripts/analyze-codebase.mjs`（可随时复跑看趋势）。
> 架构决策见 `docs/adr/`，结构规划见 `docs/2026-09-02-code-structure-plan.md`。

---

## 一、分层与依赖方向

```
apps/canvas  ──19──>  @mindcanvas/react  ──35──>  @mindcanvas/kernel
     └────────3──────────────────────────────────────────┘
```

| 层 | 职责 | 约束 |
|---|---|---|
| `packages/kernel` | 协议解析/序列化、布局引擎、编辑树 TreeOp、六注册表、实体解析 | **零 react、零 DOM** |
| `packages/react` | 渲染核心、chrome 面板/浮层、编辑控制器、主题、搜索 | 可依赖 kernel |
| `apps/canvas` | **只做组合**（把 kernel + react 拼成应用） | 不含业务逻辑 |

**判据**：`pnpm depcruise`（0 违规）。规则定义在 `.dependency-cruiser.js`，pre-commit 自动跑。

---

## 二、导出面（最重要的一条）

### 规则

1. **入口必须显式具名导出，禁止 `export *`。**
   `packages/*/src/index.ts` 是公开 API 的唯一清单——新增导出**必须手动加进去**。
   这个摩擦是有意的：它让公开面的每一次变化都出现在 diff 里，可被 review。
2. **跨包只能引包根**，禁止子路径深引用（`@mindcanvas/react/dist/xxx`）。
3. `class` / `enum` 既是值也是类型，归 `export {}`；纯类型（`interface` / `type`）用 `export type {}`。

### 为什么禁止 `export *`

它不只是"图省事"。这两件事它一直在替你做，改成显式后必须自己处理：

- **`verbatimModuleSyntax` 区分 type/value** —— re-export 类型漏写 `export type` 会报 TS1205。
- **跨模块重名**（如 `EntityRef` 被多个模块导出）—— `export *` 下编译器处理，显式化后变 TS2300。

需要重新生成或调整清单时，用 TypeScript Compiler API 版生成器（已处理全部情况）：

```bash
node scripts/gen-explicit-exports-ts.mjs <kernel|react>           # 预览
node scripts/gen-explicit-exports-ts.mjs <kernel|react> --write    # 写入
```

### 🔴 删除导出符号前必须读这一段

**禁止按「本仓库内是否被消费」来删符号。**

`kernel` 是三项目共享的协议层（见 `packages/kernel/src/protocol/types.ts` 头注：
Forge 知识画布 / markvault-js MindFlow / markvault-reborn）。ADR-0004 冻结的接口里，
有 **53 个在本仓库内几乎不消费**——`KindRegistry` `LayoutRegistry` `NoteKeyRegistry`
`RendererRegistry` `Registry` `MindNode` `ParseResult` `LayoutAlgorithm` …
它们是给**外部**用的扩展点，不消费才是正常的。

按消费数据收敛 = 删掉冻结接口。

删任何符号前，先跑分类工具看它属于哪一类：

```bash
node scripts/analyze-export-classification.mjs
# FROZEN 冻结（不可删）· CONSUMED 已消费（不可删）
# EXTENSION 扩展点（建议留）· INTERNAL 内部（候选，仍需确认外部未使用）
```

---

## 三、类型

| 规则 | 判据 | 现状 |
|---|---|---|
| 不用 `any` | biome + review | 0 处 ✅ |
| 不用 `@ts-ignore` / `@ts-expect-error` | review | 0 处 ✅ |
| 非空断言 `!`：生产代码**只减不增** | `pnpm budget`（**生产口径**；`analyze-codebase.mjs` 含 import 重命名误报） | 90 处 |
| 类型断言 `as`：谨慎，优先类型收窄 | 同上 | 31 处 ✅ |

**非空断言为什么定"只减不增"而不是"清零"**：测试里有大量 `!` 是合理的
（测试要断言"这里必非空"），生产侧 90 处多为历史遗留。清零需要大量类型重构，
收益不匹配成本——所以定基线冻结，新增代码不使用即可。

---

## 四、文件组织与规模

| 规则 | 判据 |
|---|---|
| 单一职责：一个文件一件事 | review |
| 文件 ≤ 600 行；超出需说明或拆分 | `analyze-codebase.mjs` 的复杂度热点表 |
| 一律具名导出，`export default` 仅限入口组件 | 现 2 处（仅入口组件，预算锁死） |
| 每个模块顶部有职责注释（是什么 / **不是什么**） | review |

当前超限文件（**拆分候选，别再往里加**）：

| 文件 | 行数 | 备注 |
|---|---|---|
| `apps/canvas/src/MindmapStage.tsx` | 2,241 | `StageContent` 1,781 行（全仓最长函数，:351-2131）、管着 10 个面板；文件 14 函数均长 160（已抽 7 个 hook 至 `hooks/`，持续拆分中） |
| `packages/react/src/render/MapView.tsx` | 2,088 | `MapView` 1,745 行、Hooks 密集（24 函数均长 87）；手势层已抽 useMapGestures / beamDrag |
| `packages/react/src/render/edgeRouting.ts` | 1,213 | 35 函数均 35 行，**函数粒度健康，暂不拆** |

> `EdgeEditor.tsx` 已拆出 `edgeEditorShared.tsx`（2026-09-12 债务腾挪批次）、现 491 行 < 600 —— **已退出本表**。

> 判断是否该拆，看**函数均长**而不是文件行数。
> `edgeRouting` 均长 35 行，属"大而清晰"；
> `StageContent` / `MapView` 是单个函数上千行，才需要拆。

**序列化格式契约**：`.mm.md` 的 canonical 输出在分支（heading）之间保留一个空行
（保住手写分段，避免首次保存产生全量 diff）。空行必须插在**笔记块之前**——
笔记块归属其后的节点，插在之后会拆开「笔记 ↔ 所属节点」。见 CHANGELOG 1.3.1。

---

## 五、协议层（`.mm.md`）改动纪律

> **协议规格书**：`docs/specs/2026-09-02-mm-md-protocol.md`
> （行词法 / 缩进 / 实体引用与 id 校验 / 笔记块 / 结构装配 / 诊断码 / canonical 格式 / 前向兼容）。
> 改协议实现前先读它，改完同步它。

- 协议是**纯文本事实源**：手写 → 解析 → 序列化 → 再解析必须**数据无损**。
  改协议后用压力脚本验证：
  ```bash
  cd apps/canvas && npx vite-node scripts/diag-mm-roundtrip.mts
  ```
- 未知字段**全部透传**（`Note` 有 `[key: string]: unknown`），新字段按 `KNOWN_NOTE_ORDER` 排序。
- 未注册 kind 不校验 + 保留（W-UNKNOWN-KIND），保证前向兼容。
- 公开接口变更视为 major，须同步 `CHANGELOG.md` 与 `docs/adr/ADR-0004`。
  > ✅ v1.3.0（`note.desc` 幕布描述）已于 2026-09-02 补录进 CHANGELOG。
  > 教训：实现时就要写，别等事后补——这是三项目共享的协议层，下游无从得知。
- 改序列化格式（canonical 输出）需同步 `serializer-roundtrip.test.ts` 的 canonical 用例，
  并确认往返无损 + 幂等。用真实文件验证：
  ```bash
  cd apps/canvas && npx vite-node scripts/diag-roundtrip-real.mts
  ```

---

## 六、测试

- 生产 : 测试行数比约 **1 : 0.71**（基线：kernel 301 + react 469 + canvas 24 = **794**）。
- 改行为必须有测试；改结构（如拆分、导出面）**测试全绿不等于行为不变**，
  需额外冒烟（见规划文档「验证方式」一节）。
- **新写的守卫必须做变异测试**：改源码复现缺陷，确认测试真的会红。
  本项目已两次遇到"以为守得住、实际守不住"。
  （`check-code-budget.mjs` 已做过：注入一个 `any` → 门禁报超预算且 exit 1。）
- ⚠️ apps 层**不要整体渲染 `MindmapStage`**——jsdom 下会挂起（SIGTERM）。
  保护靠：抽出 hook 用 `renderHook` 单独测（见 `tests/useDocumentActions.test.tsx`）。

---

## 七、本地门禁

```bash
pnpm gate:fast   # 提交前：typecheck + depcruise + lint + budget（~1 分钟）
pnpm gate        # 推送前：+ 794 测试（2-3 分钟）
pnpm budget      # 单跑债务预算
pnpm analyze     # 单跑结构实测（规模 / 导出面 / 复杂度热点）
```

**债务预算（`pnpm budget`）**：冻结存量债务、**只减不增**。
`any` 与 `@ts-ignore` 必须为 0；非空断言、`as`、console、TODO、default export、超 600 行文件数
各有上限（见 `scripts/check-code-budget.mjs` 的 `CODE_BUDGET`）。
统计口径为**生产代码**（测试里的 `!` 是合理的"断言必非空"语义，不计入；配置文件不计入）。

与 `biome lint` 的分工：lint 看**风格**，budget 看**债务总量趋势**——
lint 允许存量 warning，budget 不允许债务增长。

`core.hooksPath = .githooks`：**pre-commit 只跑快检**，**pre-push 跑全量**。
所以没跑过测试别 push，会被钩子拦下。

---

## 八、环境坑（都能省你半小时）

| 坑 | 正解 |
|---|---|
| 仓库根 `npx tsc` 装到废弃假包 `tsc@2.0.4` | 用 `packages/*/node_modules/.bin/tsc`（根 `node_modules/.bin` 没有 typescript） |
| 改了 `packages/*` 的**类型**后 app 侧报 TS2305 | **不必**手动 build：各包用 project references 声明依赖，`pnpm typecheck`（`tsc -b`）会按需先构建依赖包的类型产物 |
| 需要更新**发布产物** `dist/` | 仍要 `pnpm build`。`dist/` 被 gitignore，只服务发布与运行时，类型检查已不再依赖它 |
| 跑 TS 脚本报 `tsx/dist/cli.mjs` 不存在 | 根 `tsx` 破损；用 `cd apps/canvas && npx vite-node scripts/xxx.mts` |
| 诊断脚本测到"改动没生效" | 一律 import **源码相对路径**，不要用包名（否则测到陈旧 dist） |
| `tsc -b` 产生 `*.tsbuildinfo` | 已 gitignore，勿入库；它是 build mode 的增量信息 |
| dev server 变 502 | 端口残留，重启（`vite.config.ts` 改完尤其容易） |

---

## 九、提交

Conventional Commits，中文说明，正文写清**为什么**：

```
refactor(stage): ADR-0007 StageInner 拆分——条件 Hook 调用归零

<动机 / 方案 / 验证 / 门禁结果>
```

✅ **已建 git 远端**（2026-09-02）：<https://github.com/zc63463-cmyk/mindcanvas>，
成果不再单点。⚠️ 该仓库当前为**公开**，提交前确认不含私密内容。

⚠️ 本机历史曾断裂：8 月历史（157 commits）不在主仓库里，存于
`<workspace>-backup-20260831.bundle`。
两份 bundle 与当前仓库历史**不连续**，无法自动拼接，都留着别删。


## 公开仓库补充约定（2026-09-21）

开发环境与当前分支状态以 README.md、docs/development.md 和 docs/development-handoff.md 为准。上文的历史测试数字不代表当前 CI。main 不自动吸收工作区暂存线或 S5 候选；S5 的 REJECT 必须另行返修和复验。
