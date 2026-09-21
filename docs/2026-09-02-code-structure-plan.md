# 代码结构规范化规划：编写逻辑 / 层次逻辑 / 实现逻辑

> 日期：2026-09-02 · 状态：**待确认**（按「先设计再执行」纪律）
> 数据基线：全部为本次**实测**（`node scripts/analyze-codebase.mjs`），非文档声称
> 关联：ADR-0004（接口冻结）· ADR-0005（依赖方向守护）· ADR-0007（StageInner 拆分）

---

## 〇、为什么要做这件事

当前代码库**工程质量已经很高**：739 测试全绿、`any` 0 处、`@ts-ignore` 0 处、依赖方向零违规。
所以这次规划**不是救火，而是解决三个「结构性问题」**——它们现在不造成故障，但会随规模线性放大成本：

1. **冻结了等于没冻结**：ADR-0004 宣称接口冻结，但两个包都用 `export *` 全量穿透，
   实际公开面 ≈ 400+ 符号 —— 冻结一个 400 符号的面，任何内部重构都是破坏性的。
2. **复杂度高度集中**：react/render 占 react 包 48%，其中 3 个文件占 52%；
   app 层 93% 的代码挤在一个组件里。
3. **规范只存在于代码里**：没有编写规范文档，新代码靠"看邻居怎么写"来对齐，
   这正是 `export *` 扩散、巨型组件长成的原因。

---

## 一、实测基线

### 1.1 规模分布

| 层 | 文件 | 行数 | 最大文件 |
|---|---|---|---|
| `packages/react` | 69 | 10,991 | MapView.tsx (1455) |
| `packages/kernel` | 37 | 3,961 | goldenCases.ts (557) |
| `apps/canvas` | 5 | 1,861 | **MindmapStage.tsx (1738)** |
| 测试 | 102 | 11,953 | — |

生产 : 测试 = **1 : 0.71**（测试密度充足）

### 1.2 目录职责分布

| 模块 | 文件 | 行数 | 均长 | 评价 |
|---|---|---|---|---|
| `react/render` | 19 | 5,244 | 276 | ⚠ 重心过重，3 文件占 52% |
| `react/chrome` | 26 | 4,032 | 155 | ✅ 小而专 |
| `kernel/layout` | 12 | 1,361 | 113 | ✅ |
| `kernel/protocol` | 5 | 1,353 | 271 | （goldenCases 占 557） |
| `react/edit` | 9 | 964 | 107 | ✅ |
| `kernel/tree` | 4 | 607 | 152 | ✅ |
| `kernel/registry` | 10 | 489 | 49 | ✅ 极专 |
| `react/theme` | 4 | 356 | 89 | ✅ |
| `react/runtime` / `search` / `demo` / `plugins` | 9 | 370 | 41 | ✅ |

**kernel 侧结构明显优于 react 侧**：文件更小、职责更专、均长 49–152 行。

### 1.3 编写逻辑健康度（生产代码 16,813 行）

| 指标 | 数量 | /千行 | 评价 |
|---|---|---|---|
| `any` | 0 | 0.0 | ✅ |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0.0 | ✅ |
| `console.*` | 4 | 0.2 | ✅ 极少 |
| `TODO/FIXME/HACK` | 1 | 0.1 | ✅ |
| `export default` | 5 | 0.3 | ✅ 几乎全具名导出 |
| `as` 断言 | 40 | 2.4 | ✅ 健康 |
| `biome-ignore` | 1 | 0.1 | ✅ |
| 非空断言 `!` | 94（生产） | 5.6 | ⚠ 见下 |
| 非空断言 `!`（测试） | ~676 | — | 测试断言场景，可接受 |

**结论：微观编写风格相当干净**，问题不在写法，在结构。

---

## 二、层次逻辑

### 2.1 现状：方向是对的

```
apps/canvas ──19──> @mindcanvas/react ──35──> @mindcanvas/kernel
     └────────3──────────────────────────────────────┘
```

- 依赖**严格单向**、无环，`depcruise` 0 违规 ✅
- 跨包引用**全部走包根**，无子路径穿透 ✅
- kernel 保持零 react / 零 DOM ✅
- 目录职责边界清晰，无跨层混放 ✅

### 2.2 问题一：公开面全量穿透（**P0，头号问题**）

| 包 | 入口形式 | 实际公开面 |
|---|---|---|
| kernel | 14 具名 + `export *` ×9 | **≈157 符号** |
| react | 0 具名 + `export *` ×10 | **≈271 符号** |

`packages/react/src/index.ts` 全文只有 10 行 `export * from`：

```ts
export * from './theme/index.js';
export * from './render/index.js';
export * from './demo/index.js';
// ...共 10 条
```

而子模块的 index 同样是 `export *`——**穿透是递归的**，等于包内每个具名导出都是公开 API。

**这直接架空 ADR-0004**：冻结纪律针对的是「公开签名变更视为 major」，
但当内部实现即公开面时，任何重构（改文件名、改内部函数签名、删辅助函数）都是 major。
结果只有两种：要么不敢重构，要么冻结纪律形同虚设。

#### ⚠️ 策略修正（2026-09-02 实测后推翻原方案）

原方案打算「按本仓库内是否被跨包消费」来决定砍哪些符号。**这个前提是错的，已实测推翻**：

| 观察 | 数据 |
|---|---|
| kernel 公开面 162 符号，本仓库内只消费 46 | 「未消费」116 个（72%） |
| 但其中 **ADR-0004 冻结的接口占 33%** | `KindRegistry` `LayoutRegistry` `NoteKeyRegistry` `RendererRegistry` `Registry` `MindNode` `ParseResult` `LayoutAlgorithm` … |

这些符号本仓库内不消费，**是因为它们是给外部三项目用的扩展点**（`types.ts` 头注明确写
「三项目（Forge 知识画布 / markvault-js MindFlow / markvault-reborn）共享的协议层」）。
**按消费数据收敛 = 删掉 ADR-0004 冻结的公开接口。**

修正后的分类（`scripts/analyze-export-classification.mjs`）：

| 包 | 公开面 | FROZEN 冻结 | CONSUMED 已消费 | EXTENSION 扩展点 | INTERNAL 候选 |
|---|---|---|---|---|---|
| kernel | 162 | **53 (33%)** | 18 (11%) | 8 (5%) | 83 (51%) |
| react | 274 | 23 (8%) | 47 (17%) | 7 (3%) | 197 (72%) |

**必须保留**：kernel 71 / react 70（冻结 + 已消费）。
**可讨论**：kernel 91 / react 204 —— 但「可讨论」≠「可删」，
kernel 对外共享，删前须逐项确认外部项目未使用。

#### 修正后的执行路径

| 阶段 | 动作 | 风险 |
|---|---|---|
| **Phase 1 显式化** | `export *` → 显式具名清单，**保留全部当前符号、零删减** | **零**（typecheck 兜底） |
| Phase 2 逐项收敛 | 基于清单逐项决策，先 react（对外依赖少）后 kernel | 需人工确认 |

Phase 1 的价值不是"变小"，而是**把隐式穿透变成可审查、可 diff、可标注的清单**——
有了清单，新增导出才有摩擦，Phase 2 才有决策依据。

### 2.3 问题二：app 层过薄且单点（P1）

`apps/canvas` 5 个文件 1,861 行，其中 `MindmapStage.tsx` 独占 1,738 行（**93%**）。
应用组合层（本该是最薄、最像"配方"的一层）反而成了全项目最大的文件。

### 2.4 问题三：规范无文档（P1）

没有 `CONTRIBUTING.md` / 编写规范 / 协议 spec。规范只存在于：
`biome.json`（风格）、`.dependency-cruiser.js`（方向）、`ADR-0004`（接口）。
缺的是**「新代码该怎么写」的正面说明**，尤其是分层与导出约定。

### 2.5 层次规范（建议确立）

| # | 规范 | 判据 |
|---|---|---|
| L1 | **包根必须显式具名导出，禁用 `export *`** | 入口文件无 `export *` |
| L2 | 内部模块用「目录 index + 具名再导出」，不递归穿透 | 二级 index 亦为具名 |
| L3 | 跨包只能引包根，禁止子路径 | `depcruise` 规则固化 |
| L4 | app 层只做组合（配方），不含业务逻辑 | app 单文件 ≤ 400 行 |
| L5 | kernel 零 react 零 DOM | `depcruise` 已有 |

---

## 三、代码编写逻辑

### 3.1 现状

微观风格已经很好（见 1.3）。真正的缺口是**没有成文的规范**，
导致一致性靠"读邻居代码"来维持——这在 3 个包规模下还撑得住，再大就会漂。

### 3.2 编写规范（建议确立）

| # | 规范 | 现状 | 动作 |
|---|---|---|---|
| C1 | 类型严格：`any` = 0，`@ts-ignore` = 0 | ✅ 已是 | 写入规范 + biome 固化 |
| C2 | 一律具名导出，`export default` 仅限入口组件 | ✅ 5 处 | 收敛到 0 |
| C3 | 生产代码非空断言 ≤ 现有 94 处（**只减不增**） | 94 | biome 计数门禁 |
| C4 | 每个模块顶部有职责注释（一段话，说明「是什么 / 不是什么」） | 部分有 | 新增模块强制 |
| C5 | 公开 API 必须带 TSDoc（参数/返回值/副作用） | 部分有 | 随 L1 收敛后补 |
| C6 | 文件 ≤ 600 行；超出需说明或拆分 | 4 个超限 | 见第四节 |
| C7 | 错误处理：kernel 返回 `Diagnostic`，不抛异常 | 已如此 | 写入规范 |

**C3 说明**：非空断言在测试里 676 处是合理的（测试要断言"这里一定非空"），
生产代码 94 处则多为历史遗留。定「只减不增」比「清零」更务实——
清零需要大量类型重构，收益不匹配成本。

---

## 四、实现逻辑优化（明确靶点）

### 4.1 复杂度热点（实测）

| 文件 | 行数 | 主体函数 | 判定 |
|---|---|---|---|
| `apps/canvas/src/MindmapStage.tsx` | 1,738 | **StageContent 1,394 行** | 🔴 必拆 |
| `packages/react/src/render/MapView.tsx` | 1,455 | **MapView 1,093 行**（43 Hooks） | 🔴 必拆 |
| `packages/react/src/render/edgeRouting.ts` | 809 | 23 函数 / 均 35 行 | 🟡 观察（刚清理过又回长） |
| `packages/react/src/chrome/EdgeEditor.tsx` | 785 | 20 函数 / 均 39 行 | 🟡 观察 |
| `packages/react/src/edit/controller.ts` | 351 | **1 个函数 351 行** | 🟡 观察 |
| `packages/kernel/src/protocol/goldenCases.ts` | 557 | 数据文件 | ✅ 合理 |

### 4.2 拆分方案

#### T1 · StageContent 拆分（1,394 行 → ~400 行）

结构已摸清：`StageContent` 内 21 个 Hooks + **10 个面板**的条件渲染与状态。

| 抽出 | 内容 | 预估行数 |
|---|---|---|
| `StagePanels.tsx` | 10 个面板/浮层的条件渲染：`ThemeSwitcher` `PerfPanel` `QaEditor` `ContextMenu` `EdgeEditor` `ShortcutHelpPanel` `SearchPanel` `OutlinePanel` `AssetPanel` `EntityGraphPanel` | ~600 |
| `useDocumentActions.ts` | L323 起 B1 文档操作：打开/新建/保存/另存为 + 未保存守卫 | ~200 |
| `StageContent`（剩余） | 布局骨架 + 数据编排 | ~400 |

> 面板可再分组：内容面板（Search/Outline/Asset/EntityGraph）、瞬时浮层（ContextMenu/QaEditor/EdgeEditor/ShortcutHelp）、常驻（ThemeSwitcher/PerfPanel）。

#### T2 · MapView 交互层拆分（1,455 行 → ~700 行）

ADR-0007 已把此项定为 **P2-3**，评价是「6 类指针事件是内聚度最高、最容易独立的一块」——实测确认这个判断准确：

- L1–608：视图 / 布局 / 渲染
- **L609+：交互**（注释明确标注「pan（拖拽+惯性阻尼）/ zoom（滚轮+越界回弹）/ fit（双击）/ 点选」）
- L681+：JSX 中 6 类事件处理器 `onPointerDown/Move/Up/Cancel` `onWheel` `onContextMenu` `onDoubleClick`

抽出 `render/interactions/`：`usePan.ts` `useZoom.ts` `usePointerSelect.ts` `useContextMenu.ts`。
43 个 Hooks 中交互相关的约 15 个可随之迁出。

#### T3 · 观察项（暂不动）

`edgeRouting.ts`（809 行，23 函数均 35 行）、`EdgeEditor.tsx`（785 行，20 函数均 39 行）——
**函数均长健康（35–39 行），是大而清晰的模块，不是泥球**。
拆它们的收益低于 T1/T2。`controller.ts` 单函数 351 行需单独看是否可拆。

### 4.3 执行排序

| 顺序 | 任务 | 类型 | 预估 | 风险 |
|---|---|---|---|---|
| 1a | **Phase 1 导出面显式化**（kernel + react，零删减） | 层次 | 0.5 天 | **低**（typecheck 兜底） |
| 1b | **C4/C6 编写规范文档** | 规范 | 0.5 天 | 低 |
| 2 | **T1 StageContent 拆分** | 实现 | 1 天 | 中（1,394 行搬迁） |
| 3 | **T2 MapView 交互拆分** | 实现 | 1–1.5 天 | 中高（43 Hooks 依赖序） |
| 4 | Phase 2 导出面逐项收敛（先 react 后 kernel） | 层次 | 待定 | **需人工确认** |
| 5 | C2/C3 收敛（default export、非空断言只减不增） | 规范 | 0.5 天 | 低 |

**依赖关系**：1a、1b 可并行且与 2、3 独立；2、3 串行（同属大组件拆分，避免同时做导致回归难定位）；
**4 必须在 1a 之后**（没有清单就没有决策依据），且需外部项目消费情况确认。

> ⚠️ 原排序把「收敛导出面」列为第 1 项并假设 0.5–1 天完成 —— 实测后已拆为 1a（显式化，可自动）
> 与 4（真正收敛，需人工）。**真正的收敛不是一天能做完的事**，它依赖外部项目信息。

**全程门禁**：739 测试全绿 · 三包 typecheck 0 错 · depcruise 0 违规 · lint 0 error · build 全绿。

---

## 五、验证方式

拆分与收敛类改动，**测试全绿不等于行为不变**——必须有额外验证：

| 任务 | 验证 |
|---|---|
| L1 导出面收敛 | app 侧 build 通过 + 浏览器冒烟（画布/面板/主题切换） |
| T1 StageContent | 10 个面板逐个开关冒烟 + 保存/新建/另存为 + 未保存守卫 |
| T2 MapView | pan/zoom/fit/点选/右键/双击 六类手势逐个验证 |
| 全部 | `git diff --stat` 确认为纯搬迁（无逻辑改写） |

---

## 六、明确不做

- ❌ **不改 kernel 的模块划分**——它是全项目结构最好的部分（均长 49–152 行）
- ❌ **不拆 edgeRouting / EdgeEditor**——函数均长健康，属"大而清晰"而非泥球
- ❌ **不顺带清 warning**（843 条，770 条是非空断言）——单一职责，独立一轮
- ❌ **不引入新抽象层**（如 DDD 分层）——当前三层已够，加层是负收益
- ❌ **不动公开语义**——本次是结构重组，不是行为变更

---

## 附：分析工具

- `scripts/analyze-codebase.mjs` —— 本次全部数据来源，可随时复跑看趋势
  ```bash
  node scripts/analyze-codebase.mjs
  ```
- ⚠️ `code-analyzer` skill 的自动分析对本 TS monorepo **不适用**
  （判为 MVC、Data Models 空、Entry Points 0），其产出已弃用，勿引用。
