# K5 深度外派任务书：三镜子验收 + 接口冻结 v1.0

> **本文件即开工令**。工作目录 = 仓库根。本任务书自包含全部上下文，不需要读取任何外部对话。

## 你的角色

你是 mindcanvas 仓库的工程执行 agent。本次是**收官阶段**——不是写功能，是**验收接口表达力并冻结 v1.0**。K0-K4 已交付完整内核（协议 225 测试 / 渲染 126 测试全绿），现在要用三面「镜子」压力测试全部公开接口，消化遗留 TODO，然后把接口冻结为 1.0.0。

**你只做本任务书清单内的事。发现架构层面问题 → 记录进报告，不动手大改（那是 v1.0 之后的事）。**

## 背景（60 秒）

mindcanvas 是纯文本思维导图内核（pnpm workspace：`packages/kernel` headless 零 DOM / `packages/react` 渲染 / `apps/canvas` 组合入口）。设计哲学「Terraform for ideas」：`.mm.md` 文件是事实源，实体可升格接入（Forgejo issue / MindFlow 标注 / PomodoroXI 任务项），一切接入走「实体声明 → 读管道 → 写管道」三段式契约。

**「两个消费者」规则**（本阶段的核心方法论）：一个 API 边界在被至少两个消费者压力测试之前，都当它是猜的。K0 时接口先行只定义了镜子已证明需要的部分；现在三面镜子（三份真实消费者规格）就位，是兑现这个规则的时刻。

## 必读文档（按序，共 4 份）

1. `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` — K5 阶段定义与验收门禁
2. `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` — **镜子一**：forgejo-bridge 插件的完整规格（重点 §4.4 内核三元组 / §4.7 实体中心模型 / §5 节点类型体系 / §6 数据契约）
3. `docs/mirrors/mindflow-annotation-design.md` — **镜子二**：MindFlow 标注系统设计
4. `docs/mirrors/pomodoroxi-integration-sketch.md` — **镜子三**：PomodoroXI session/任务项接入设想

代码侧重点读：`packages/kernel/src/index.ts`（公开面全貌）、`packages/kernel/src/entity/entity.ts`、`packages/kernel/src/registry/`（六注册表）、`packages/kernel/src/tree/op.ts`（TreeOp）。

## 任务清单

### T1 · 镜子一 harness：forgejo-bridge 消费者模拟

在 `packages/kernel/tests/mirrors/forgejo-bridge-harness.test.ts` 写一个**模拟消费者测试套件**（不是实现插件）：

- 用公开 API 完成 forgejo-bridge 的核心数据路径：解析含 `@issue:123` / `@milestone:v1` / `@doc:readme.md` 的 `.mm.md` → 取出全部 EntityRef → 经 Resolver 接口返回 Entity（含 unresolved 降级）→ 验证 SemRole 注册表能表达 spec §6 的映射（issue→entity / milestone→milestone）
- 验证 spec 需要的**写路径数据表达力**：提议（proposal）→ action 枚举 → 幂等键——确认这些概念在 `semantics` 注册表/action 通道接口上有落点（哪怕只是类型能表达）
- 验证 reconcile 数据需求：期望态（导图）与实际态（resolver 结果）的对账所需信息是否齐备
- **产出结论段**：接口够用项清单 + 缺口清单（每条缺口注明「v1.0 内补 / v1.0 后补」建议）

### T2 · 镜子二 harness：MindFlow 标注消费者模拟

`packages/kernel/tests/mirrors/mindflow-annotation-harness.test.ts`：

- `annotation` kind（已注册）的 EntityRef 流转：标注节点解析 → Entity 形状 → note 键透传（含 L1/L2/L3 分层信息放在 note 透传键的形态）
- 标注渲染需要的节点数据访问：hover 浮窗内容（note 字段）、颜色→背景映射所需的 meta 通道
- 决策沉淀路径：note.decisions 键的读写往返
- 同样产出接口结论段

### T3 · 镜子三 harness：PomodoroXI 任务项消费者模拟

`packages/kernel/tests/mirrors/pomodoroxi-harness.test.ts`：

- `session:42` / `task:xxx` 形态实体引用的解析与透传（当前未注册 kind → 验证未知 kind 透传 + unresolved(unknown-kind) 降级路径，这本身就是镜子验收的一部分）
- 导图节点标记 → 创建任务/番茄的写路径表达力（action 通道）
- 任务状态同步进导图：resolver 轮询 → 状态变化 → 渲染数据可感知（TreeOp 更新 note/角标路径）
- 接口结论段

### T4 · 消化两处 TODO(K5-mirror-review)

依据三个 harness 暴露的真实需求，完成：

1. `entity.ts` 的 `resolveMany(refs): Promise<Map<string, Entity>>` — 批量解析（镜子一的对账场景必然需要：一次拉全部实体而非 N 次单查）。实现 + 单测（含部分失败：成功的入 Map，失败的也入 Map 但带 unresolved_reason）
2. `note-key.ts` 的 links/groups 处理契约 — 依据 spec §5.5 的锚定规则（路径锚/实体锚/dangling 状态）精化类型契约：links 的解析状态（well-formed / dangling / stale）进入 note 键注册表的语义描述，kernel 侧提供纯函数判定（不涉及渲染）

完成后 `grep -rn "K5-mirror-review" packages/` 必须归零。

### T5 · 接口冻结 v1.0

- 三包 `package.json` version → `1.0.0`
- 根 `CHANGELOG.md` 创建：按 K0-K5 阶段记录已冻结的公开面（六注册表接口、Entity 三件套、TreeOp、MeasureFn、协议语法、React 渲染组件公开 props）
- `docs/adr/ADR-0004-interface-freeze-v1.md`：冻结清单（哪些类型/函数/组件从此 semver 管理）+ 变更流程（minor 可加不可改，major 破坏性变更需 ADR）+ 三面镜子验收结论摘要
- 冻结语义：**冻结后 kernel 公开导出的任何签名变更都算 major**

### T6 · 终检

- 依赖图：`pnpm why react --filter @mindcanvas/kernel` 无匹配；无 DOM 类型引入（grep `document\|window` 于 kernel src 应为零，测试文件除外）
- 无插件构建：纯 kernel + 内置渲染可运行（K4 T3 已建立，验证未回归）
- 全量测试 + typecheck + build 三绿（kernel + react + canvas 三包）

### T7 · K5 交付报告

`docs/dispatch/K5-report.md`：

- 门禁逐项打勾 + 证据
- **三面镜子验收结论表**（每面镜子：够用项 / 缺口项 / 缺口处置建议）
- 接口冻结清单摘要
- **forgejo-bridge 立项条件确认**：spec R1-R15 全部就绪？镜像验收通过？→ 输出「可以立项 / 需先补 X」结论
- 工程决策与冲突记录（任务书与实际情况不符时：以仓库现状为准，记录冲突）

## 硬约束

1. **镜子 harness 是测试代码，不是产品代码**——不实现 forgejo/mindflow/pomodoroxi 的任何真实功能，只验证接口表达力。harness 里的模拟 Resolver 返回硬编码数据即可
2. **冻结前的接口修订是允许的**（这是最后窗口）——T1-T3 发现的缺口若属「不补就无法表达镜子需求」，可直接修订接口，但必须：每处修订记入 ADR-0004 附录 + 全量测试保持绿 + 修订理由注明来自哪面镜子
3. kernel 依赖图零 react/DOM 不变量不许破坏
4. 测试基线（kernel 225+ / react 126+）只增不减
5. 每任务一个 commit：`K5: T1 ...` 格式
6. JSDoc 中文注释；发现参考源或既有代码疑似 bug → 只记录不修改
7. 不碰 `knowledge-canvas` 参考源仓库任何文件

## 验收门禁

- [ ] 三面镜子 harness 全绿，每面有接口结论段（够用/缺口清单）
- [ ] `grep -rn "K5-mirror-review" packages/` 归零
- [ ] `resolveMany` 实现含部分失败语义单测
- [ ] links/groups 契约精化有类型与纯函数判定 + 单测
- [ ] 三包 version 1.0.0 + CHANGELOG.md + ADR-0004 入库
- [ ] `pnpm -r build / test / typecheck` 全绿
- [ ] `pnpm why react --filter @mindcanvas/kernel` 无匹配
- [ ] 无插件构建可运行验证
- [ ] git log 呈 `K5: TX` 分步提交
- [ ] K5-report 含 forgejo-bridge 立项条件结论

## 熔断规则

单点阻塞超过 30 分钟（如镜子需求发现接口设计层面的根本缺陷、无法用小修订消化）→ 写 `docs/dispatch/K5-blockers.md`（现象 / 已试路径 / 怀疑的架构层面根因）停下等裁决。**不要自行重构架构。**
