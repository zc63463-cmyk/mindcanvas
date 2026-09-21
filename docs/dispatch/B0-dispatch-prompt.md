# B0 深度外派任务书：CLI 提示词验证（价值假设实证）

> **本文件即开工令**。工作目录 = `<workspace>`。任务书自包含全部上下文，不需要读取任何外部对话。

## 你的角色

你是 mindcanvas 仓库的工程执行 agent。本次任务 = forgejo-bridge 插件线的**第一步：验证核心价值假设**——「一个没有本项目上下文的通用 LLM，只靠 prompt + 画布纯文本，能否产出符合契约的高质量提议集」。你写的是**测量工具**，不是产品；你收集的是**质量数据**，不是要掩盖的失败。

**本任务只测量、不调优**：LLM 输出质量差也是有效数据（D1 决策的输入）。prompt 迭代是 B0.1 的事，不在本轮范围。

## 背景（90 秒）

mindcanvas 是纯文本思维导图内核（已冻结 v1.0.0，`.mm.md` 文件为事实源，支持 `@issue:123` 类实体引用）。战略定位「Terraform for ideas」：导图声明期望态，forgejo-bridge 插件执行受控变更（提议 → 人批 → 落库）。整个桥的第一块试金石是 outbound 方向：**LLM 读画布 → 产出「该建什么 issue/milestone」的提议集**。

spec 已定完整数据契约（ProposalSet），但 **prompt 从未写过、质量从未测过**。B0 用三张 demo 画布把这条链路跑通并给出质量数据。验收线（spec Phase 1）：**满意提议 ≥ 80%**（软指标，用户人工判）。

## 必读材料（按序）

1. `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` — **§6.1 ProposalSet 契约（本任务的事实源，逐字对齐）**、§5 节点类型体系（SemRole 定义）、§6.2 的 `/analyze` 输入描述（mm.md 原文 + 手动标记集 + structureType + note.rel）
2. `packages/kernel/tests/fixtures/gateway.mm.md` / `ideas-pool.mm.md` / `roadmap.mm.md` — 三张被测画布（先读懂其语法：标题层级、`@kind:id` 实体引用、`<!-- ... -->` 笔记块含 `qa:` 键）
3. `packages/kernel/src/index.ts` 公开导出面 — 你只消费公开 API（`parseMm` / `nodeByPath` 等），不读不碰内核实现

## 任务清单

### T1 · ProposalSet JSON Schema 与校验器

- `llm/schema/proposal-set.schema.json`：从 spec §6.1 **忠实提取**（outbound 方向；inbound 专属字段本轮忽略）。必填：`canvas` / `direction`（固定 "outbound"）/ `analyzed_at` / `proposals[]`；每条提议必填 `node_anchor.path` + `node_anchor.text_hash` / `action`（枚举 create_issue | create_milestone | add_comment | link_issues | skip）/ `sem_role`（枚举 task | question | risk | decision | context | idea）/ `title` / `body_md` / `confidence`（0-1）/ `rationale`；可选 `milestone` / `labels`
- `llm/lib/validate.mjs`：校验函数（手写或引 Ajv，装在 `llm/` 自身的 package.json，**不动 workspace 三包依赖**）+ 两类错误分级：**E=结构违规**（缺字段/枚举外值）、**W=内容告警**（锚点路径在画布中不存在——防幻觉的关键检查）

### T2 · Prompt 模板 v1

`llm/prompts/analyze-outbound.md`，内容分五段：

1. **角色与任务**：你是项目管理助手，读取一份纯文本思维导图，为适合落库为工单的节点产出提议
2. **语义定义**（以 spec 为准，不自创）：六种 SemRole 的判定标准、五种 action 的适用场景、**关键纪律「落库动作靠手动标记与显式信号，你的推断一律通过 confidence + rationale 呈现，宁缺勿滥」**
3. **输入**：画布 `.mm.md` 原文（含结构提示：已存在的实体节点表示已落库，不要重复提议）
4. **输出**：严格 JSON，结构与字段说明（贴 schema 精简版）+ 2 个 few-shot 示例（用画布外虚构的迷你导图，防真实答案泄漏）
5. **硬性约束**：只允许引用输入中存在的节点路径；不确定 → `action: "skip"`；输出前自检 JSON 合法性

### T3 · CLI 脚本（双模式）

`llm/analyze.mjs`（Node ESM，`llm/package.json` 独立）：

- 输入：画布路径（或名称，默认三张 fixtures）
- **组装**：用 `@mindcanvas/kernel` 公开 API（workspace 内直接 import 源码或 dist）`parseMm` 解析画布 → 提取节点树 + 路径（`nodeByPath` 约定与 spec §5.5 路径锚一致：`根/分支/节点名`）→ 与 prompt 模板拼装 → 计算每个节点的 `text_hash = sha256(path + "\n" + text)`（十六进制，前 16 位）
- **模式 A（API 自动）**：`--api` 读 `.env` 的 `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL`（OpenAI 兼容 chat/completions；`.env` 入 gitignore，提供 `.env.example`）
- **模式 B（手动搬运）**：`--export` 把完整 prompt 写到 `llm/out/<画布名>.prompt.md`（用户贴给任意 LLM）→ `--parse <回复文件>` 解析回复文本（剥 markdown 代码栅栏）、校验、落 `llm/out/<画布名>.proposals.json`
- **产出评估**：每次 parse 后输出硬指标汇总（提议总数 / E 级违规数 / W 级告警数 / action 分布 / sem_role 分布 / confidence 均值）

### T4 · 三画布实测

- 三张画布各跑一遍（模式 A 或 B，取决于 key 可用性；**两者都要能跑**——key 缺失时模式 B 是唯一路径，必须真实可用）
- **严禁**：你（执行 agent）自己扮演被测 LLM 直接生成提议——你有本任务书上下文，自测数据全部污染。测量对象必须是外部 LLM
- 每张画布的 LLM 原始回复存档 `llm/out/<画布名>.raw.md`（评估证据）

### T5 · 质量评估表

`llm/out/quality-review.md`：

- **硬指标表**（机器判，你填）：每画布的提议数 / E 违规 / W 告警 / 分布统计
- **软指标评估表**（模板，用户人工填）：每条提议四维打分（标题精修质量 / body 完整度 / 归属正确性 / 标记合理性，各 1-5 分）+ 汇总公式（≥4 分视为满意 → 满意率 = 满意条数 / 总条数，对照 80% 线）
- 已知问题清单（你在准备过程中观察到的画布/契约/prompt 设计问题，如实记录）

### T6 · B0 交付报告

`docs/dispatch/B0-report.md`：门禁勾选 + 硬指标数据 + 三画布摘要 + 已知问题 + **D1 决策输入**（硬指标 + 软指标评估表就绪状态）+ 工程决策与冲突记录（任务书与实际不符时以 spec 为准并记录）。

## 硬约束

1. **零耦合承诺**：`packages/kernel` / `packages/react` / `apps/canvas` 的 src 一律不改（消费公开 API 允许；`llm/` 是独立目录独立依赖）
2. **测量有效性**：被测 LLM 只能看到 prompt + 画布文本——prompt 中不得包含任务书信息、spec 原文整段、或任何「答案提示」
3. **LLM 的违规输出是数据不是失败**：E/W 记录入评估，脚本不得静默修复或丢弃违规提议
4. **text_hash 规则固定**：`sha256(path + "\n" + text)`——将来 B1/B2 的锚定校验必须与此一致，写进脚本 JSDoc
5. `.env` 不入库；`llm/out/` 的 raw/proposals **入库**（评估证据，含敏感信息检查：不应有任何 key）
6. 每任务一个 commit：`B0: T1 ...` 格式
7. JSDoc/注释中文；发现疑似 bug 只记录不修改

## 验收门禁

- [ ] `llm/schema` + `llm/lib/validate.mjs` 就绪，校验器对构造的违规样例能正确分级 E/W
- [ ] `llm/prompts/analyze-outbound.md` v1 就绪（五段结构齐全）
- [ ] `llm/analyze.mjs` 双模式可用：`--export`/`--parse` 在无 key 环境真实跑通
- [ ] 三画布全部产出提议集 JSON + raw 回复存档
- [ ] 硬指标数据落档 `quality-review.md`
- [ ] 软指标评估表就绪（用户填）
- [ ] kernel/react/canvas 三包零改动（git diff 实证）+ 666 测试不回归（可只跑 build 不跑全测，因为零改动）
- [ ] git log 呈 `B0: TX` 分步提交
- [ ] B0-report 含 D1 决策输入

## 熔断规则

- 单点阻塞 30 分钟（如 kernel 公开 API 不足以提取所需数据结构）→ 写 `docs/dispatch/B0-blockers.md` 停下等裁决，**不许改内核**
- LLM 回复完全无法解析（模式 B 用户侧问题）→ 记录现象，改用模式 A（key 可用时）或报告说明，不算熔断

## 产物迁移预期

`llm/` 目录在 B1（forgejo-bridge 独立仓库立项）时**整体迁走**——目录结构按可迁移设计（无 workspace 内相对路径依赖，import kernel 走包名）。
