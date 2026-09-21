# K1 外派执行任务书：协议内核移植与铁律固化

> 用法：将本文件全文喂给执行 agent（Claude Code / Codex / deepseek-harness 等），工作目录设为本仓库根（`<workspace>`）。本任务书自包含全部上下文。

---

## 你的角色

你是本仓库的工程执行 agent，负责执行 **K1 阶段**：把参考源 knowledge-canvas 的协议层**整体移植**进 `packages/kernel`。K0 已完成并验收（六注册表 / Entity 三件套 / Plugin 基类 / 最小骨架），你的工作是把骨架换成真正的引擎。**移植而非重写**——本阶段的成功标准是「忠实搬运 + 最低限度接线」，不是改良。

## 必读文档（开工前按序读完）

1. `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` 的 **K1 段**（你的任务定义）与「启动方式」「风险与对策」
2. `docs/dispatch/K0-report.md` —— 了解 K0 交付的模块边界与 11 条工程决策（尤其 NodeNext 构建）
3. 参考源代码（只读）：`<local-path>`（types / parser / serializer / uri / goldenCases）与 `tests/` 中仅依赖协议层的测试
4. `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` §5.5 —— 存储三件套与透传语义（协议层是它的实现载体）

## 任务清单（T1-T6 按序执行，每任务一个 commit）

### T1 · 协议层目录级移植

- 从参考源 `src/protocol/` **整体拷贝** `types.ts` / `parser.ts` / `serializer.ts` / `uri.ts` / `goldenCases.ts` 到 `packages/kernel/src/protocol/`
- 修 import 路径；**删除 K0 的最小骨架** `src/types.ts` / `src/parse.ts` / `src/serialize.ts`，包入口改指 `protocol/`
- **不得改动移植代码的逻辑**（哪怕看到可优化处——那是 K5 之后的事）

### T2 · 协议测试随迁

- 识别参考源 `tests/` 中**仅依赖 `src/protocol`** 的测试文件（parser 兼容、serializer round-trip、types 校验、uri、golden 相关），全部拷贝到 `packages/kernel/tests/` 并修 import
- 依赖 layout / state / forgejo 的测试**不移植**（属 K2/K4）
- 测试文件名保持 `{模块}-{场景}.test.ts` 风格

### T3 · 与 K0 模块接线（本阶段唯一的「新代码」）

- `entity/` 三件套与协议层 `types.ts` 中的 Entity 形状存在重复——**以协议层为准**：`entity.ts` 改为 re-export / 适配自协议层，保持 K0 的对外 API 不破坏（`unresolvedEntity` / `isUnresolved` / `refKey` / `Resolver` 契约保留）
- `KindRegistry` 种子：协议层的 `REGISTERED_KINDS` + `KIND_META`（七类）以「内置默认注册」形式进入注册表——提供 `registerBuiltinKinds(registries)` 或等价机制，**并在交付报告记录你选择的关系设计**（协议层持有语法事实，注册表持有运行时容器）
- golden cases 若依赖 fixture 文件，一并随迁

### T4 · 透传铁律固化测试

新增（这是新代码）三个铁律测试，全部围绕「未知值永不丢失」：

1. 未知 kind：`@future-kind:xyz` 解析 → W-UNKNOWN-KIND 诊断 + 实体节点保留 → 序列化 round-trip 后原样保留
2. 未知 note 键：笔记块带 `ai_role: "task"` / `rel: [...]` / 任意未知键 → round-trip 不丢不改
3. 混合场景：未知 kind + 未知 note 键 + 已知 kind 共存文件 → 全量保留

### T5 · Demo 画布 fixtures 抽样验证

- 从参考源 `src/demo/canvas/` 拷贝三份 `.mm.md`（gateway / roadmap / ideas-pool）到 `packages/kernel/tests/fixtures/`
- 新增测试：解析无 E 级（错误级）诊断回归 + round-trip 稳定（serialize(parse(serialize(parse(x)))) === serialize(parse(x))）

### T6 · 交付自查与报告

- `docs/dispatch/K1-report.md`：门禁逐项打勾 + 移植文件清单（源→目的地映射）+ 接线设计决策 + 未移植测试及原因清单

## 硬约束（违反任意一条即返工）

1. **移植的协议代码逐字忠实**——发现参考源疑似 bug 一律记录到 K1-report「发现清单」，不改代码
2. 只移植协议层：`src/layout` / `src/state` / `src/forgejo` / `src/components` 一律不碰（K2/K4 的事）
3. **不修改 knowledge-canvas 参考源仓库任何文件**（只读拷贝）
4. `packages/kernel` 依赖图保持零运行时依赖、零 react / DOM
5. K0 已交付的注册表 / Plugin 语义不破坏（`registry-basic` / `plugin-lifecycle` 测试必须继续绿）
6. 测试先行精神：T4/T5 的新测试先写红再实现（此处实现=移植接线，预期很快转绿；若一直红说明移植有问题）

## 验收门禁（完成自查后逐项确认）

- [ ] `pnpm install && pnpm -r build && pnpm -r test` 全绿（K0 的 24 测 + 移植测试 + 新增铁律/fixture 测试全部通过）
- [ ] 参考源协议相关测试**数量无遗漏**（K1-report 列出「已移植 N / 参考 源协议相关共 M」并说明差额原因——差额只能是「依赖非协议模块」）
- [ ] 三个透传铁律测试通过（未知 kind / 未知 note 键 / 混合）
- [ ] 三份 demo 画布 fixtures 解析无错误级诊断 + round-trip 幂等
- [ ] K0 原有测试（registry / plugin / entity）继续全绿
- [ ] git log 呈现 `K1: TX ...` 分步提交

## 遇到问题时的规则

- 参考源代码与文档描述冲突 → 以参考源代码为准（它是 326 测试固化的现实），记录冲突到报告
- 某测试依赖判断拿不准（是否「仅依赖协议层」）→ 尝试拷贝后看能否脱离其他模块编译运行，能则移植，不能则记录
- 单点阻塞超过 30 分钟 → 写 `docs/dispatch/K1-blockers.md`（现象/已试路径/建议选项），跳过继续其余任务
