# K0 外派执行任务书：mindcanvas 仓库地基

> 用法：将本文件全文喂给执行 agent（Claude Code / Codex / deepseek-harness 等），工作目录设为本仓库根（`<workspace>`）。本任务书自包含全部上下文。

---

## 你的角色

你是本仓库的工程执行 agent，负责执行 **K0 阶段**（内核重构路线图的第一个阶段）。架构与产品决策已由上游设计定案（文档在案），你的职责是**高质量工程化实现，不做架构重新发明**。遇到文档没覆盖的工程细节，按最小实现原则自行决定并在 commit message 记录理由。

## 项目背景（1 分钟速读）

本项目是纯文本思维导图的**内核与应用**全新仓库，架构范式：微内核（六注册表）+ 插件（渐进增强）+ 库优先（headless kernel / react 渲染器 / 应用组合入口）。数据格式是 `.mm.md` 纯文本（markdown + 行内实体引用 `@kind:id` + HTML 注释笔记块透传键）。

上游项目 **knowledge-canvas**（`<local-path>`）是**只读参考源**：其协议层（`src/protocol/`，含 326 个测试中的协议部分）、布局引擎将在 K1/K2 阶段移植进本仓库——你今天搭的地基必须为它们服务，目录与包边界要按此设计。

## 必读文档（开工前按序读完）

1. `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` —— 你正在执行其中的 **K0** 段；后续 K1-K5 概览建立你的设计前瞻
2. `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` 的 **§4.4-§4.8**（架构原则、扩展缝、微内核、实体中心接入、平台选型）——特别是 §4.7 的「内核接口收敛三件套」
3. `docs/research/2026-08-27-mindmap-kernel-oss-research.md` 的 §1 与 §5（渲染架构分野与三条修正建议）
4. `docs/mirrors/README.md` + 三个镜子文档 —— 你的接口设计要经得起它们的检验（见硬约束 3）

## 任务清单（T1-T7 按序执行，每任务一个 commit）

### T1 · pnpm workspace 三包结构

- 根 `package.json`（private，名 `mindcanvas`，`packageManager` 固定 pnpm 版本）+ `pnpm-workspace.yaml`（`packages/*`、`apps/*`）
- `packages/kernel`：**零运行时依赖**（devDeps 不限），TypeScript strict（根 `tsconfig.base.json` 统一配置），vitest 就绪
- `packages/react`：占位包，依赖 `@mindcanvas/kernel`
- `apps/canvas`：Vite + React 入口，依赖两包，能起一个空页面
- 根级脚本：`build` / `test` / `typecheck` 走 `pnpm -r`

### T2 · Entity 三件套接口（`packages/kernel/src/entity/`）

- `EntityRef`（kind: string + id: string——kind 保持 string 以支持前向兼容）
- `Entity` 统一形状（kind/id/title/status/ref + `meta` 含 `unresolved_reason`）
- `Resolver` 契约（ref → Entity；**失败返回 unresolved Entity 而非抛异常**）
- 参照参考源 `knowledge-canvas/src/protocol/types.ts` 的 Entity 形状设计，但**不 import 参考源任何代码**（K1 才整体移植）

### T3 · 六注册表接口（`packages/kernel/src/registry/`）

定义六个注册表接口 + 空实现（注册表为空时内核照常工作）：

1. `KindRegistry` —— kind 注册（语法校验 / 元信息：颜色、显示名）
2. `NoteKeyRegistry` —— 笔记块透传键的语义处理器注册（如 links / groups / ai_role）
3. `RendererRegistry` —— 节点渲染策略注册（**泛型槽位，不得依赖 react**——渲染器具体类型由 `packages/react` 侧注入）
4. `LayoutRegistry` —— 布局算法注册
5. `SemanticsRegistry` —— SemRole / action 落库映射注册（实体中心接入模型的词汇层）
6. `ChannelRegistry` —— 外部接入通道注册

每个注册表统一语义：`register()` 返回可释放句柄或挂接 Plugin 上下文（**生命周期自注销**——unregister/dispose 随 plugin unload 自动清理）。

### T4 · Plugin 基类（`packages/kernel/src/plugin/`）

- 生命周期 `onload()` / `onunload()`
- 插件注册的一切（经由各注册表）随 `onunload` 自动清理——这是硬性设计要求（来源：Obsidian 模式，见调研报告 §4）

### T5 · 最小 kernel 骨架

- `MindNode` 类型定义（type: 'text' | 'image' | 'entity' 三分 + note 透传 + children——对照参考源 `types.ts` 的形状）
- 极简 parse / serialize：空树（单根节点）round-trip 冒烟测试——**K1 会被移植版整体替换，勿过度设计**
- 导出包入口 `packages/kernel/src/index.ts`

### T6 · ADR 两篇（`docs/adr/`）

- `ADR-0001-platform-web-first-library-first.md`：平台选型 Web-first + 库优先（依据 roadmap 与 spec §4.8，写决策/理由/被否选项）
- `ADR-0002-new-repo-porting-strategy.md`：新仓库演进策略——knowledge-canvas 只读参考源、K1 目录级移植、K4 对齐后旧仓库归档

### T7 · 交付自查与总结

- 全量自查验收门禁（见下）
- 在 commit message 或 `docs/dispatch/K0-report.md` 里逐项打勾 + 记录执行中的工程决策

## 硬约束（违反任意一条即返工）

1. **只做 T1-T7**，不做清单之外的任何「顺手优化」「功能实现」「示例丰富化」
2. `packages/kernel` 不得 import `react` 或任何 DOM API（headless 纯净性；渲染属于 `packages/react`）
3. 接口**只定义三面镜子（`docs/mirrors/`）已证明需要的 + 明显必需项**，不臆造抽象；拿不准就标注 `TODO(K5-mirror-review)` 留给 K5 镜子验收
4. **不修改 knowledge-canvas 参考源仓库的任何文件**（只读）
5. 禁止永续 rAF / 轮询循环 / 后台 tick 类设计进入本阶段任何代码
6. 所有导出 API 带 JSDoc 中文注释（将来服务于 `/schema` 语义注册表自动生成）
7. 测试先行：T2-T5 的每个接口/类型配最小单测（vitest，放各包 `tests/`）

## 验收门禁（完成自查后逐项确认）

- [ ] `pnpm install && pnpm -r build && pnpm -r test` 全绿
- [ ] `packages/kernel` 的依赖图中无 react（可用 `pnpm why react --filter @mindcanvas/kernel` 验证）
- [ ] 空树 round-trip 冒烟测试通过
- [ ] 六注册表接口全部编译通过且空实现可运行
- [ ] Plugin 生命周期自注销有单测证明（注册→unload→注册表清空）
- [ ] ADR 两篇入库
- [ ] git log 呈现 T1-T7 分步提交（message 格式：`K0: T1 workspace 三包结构`）

## 遇到问题时的规则

- 文档之间冲突 → 以 `docs/roadmap/` 为准，并在 commit message 记录冲突点
- 接口设计拿不准 → 宁缺勿滥，`TODO(K5-mirror-review)` 标注后继续
- 单点阻塞超过 30 分钟 → 停下，把问题写入 `docs/dispatch/K0-blockers.md`（现象/已试路径/建议选项），继续执行其余任务，等人工裁决
