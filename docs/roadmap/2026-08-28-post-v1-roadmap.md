# mindcanvas v1.0 后续深度规划（B/M/E/I 四线）

> 日期：2026-08-28 · 前置：内核 K0-K5 全部完成、接口冻结 1.0.0（ADR-0004）· 决策人：蒋指导
> 定位：从「能力就绪」到「价值兑现」的路径排序。

## 一、现状盘点（资产清点）

| 资产 | 状态 | 可复用性 |
|---|---|---|
| mindcanvas 内核 v1.0 | 666 测试（kernel 266 + react 126），契约冻结 semver | 一切后续工作的地基 |
| 联动 spec R1-R15 | 15 轮修订闭环，含实施蓝图（§11）与开放问题（§12） | forgejo-bridge 的完整需求文档 |
| 三面镜子验收结论 | 9 缺口 → 2 已补（resolveAll/note-anchor）+ 7 插件侧方案 | B/E 线的接口输入 |
| K4 交互对照表 | P1 主力项已消化（缩进/导航/搜索/大纲/右键/帮助面板） | 剩余：实体 picker |
| demo 三画布 + 主题快照 | gateway/roadmap + classic/sticker/glass | B0 提示词验证的输入 |
| knowledge-canvas 旧仓库 | 参考源使命完成，文档已随迁 | 待归档（I2） |

## 二、战略主判断：价值假设验证优先

**全部桥侧投资都建立在一个未实证的假设上**：「LLM 读导图 → 产出符合契约的提议集」质量达标（spec Phase 1 验收线：满意提议 ≥ 80%）。

推论——**B0（CLI 提示词验证）必须最先做**：

1. **风险最早暴露**：假设不成立则桥的整体设计需回炉，早一天知道少一周浪费
2. **成本极低**：1-2 天、零耦合（不依赖内核、不依赖 sidecar，晚执行不损失价值 = 随时执行也不损失先机）
3. **产出直接可迭代**：prompt 是 Phase 1 迭代主战场（spec §8 目录设计已预留 `llm/prompts/`）

## 三、优先级评分矩阵

| 线 | 任务 | 价值 | 成本 | 风险 | 依赖 | 优先级 |
|---|---|---|---|---|---|---|
| B0 | CLI 提示词验证 | 10（核心假设实证） | 2（1-2天） | 0（零耦合） | 无 | **P0 立即** |
| I1 | Forgejo 远端推送 | 6（版本安全网） | 1（半小时） | 0 | 无 | **P0 顺手** |
| I2 | knowledge-canvas 归档 | 4（心智收口） | 1（半小时） | 0 | 无 | P0 顺手 |
| B1 | 插件骨架 + ProposalSet 类型 | 7 | 2 | 1 | B0 达标 | P1 |
| B2 | Sidecar 五端点 + 幂等 + 台账 | 9 | 3 | 2 | B1 | P1 |
| B3 | 对账 reconcile + /schema + Bridge Skill | 9 | 3 | 2 | B2 | P1 |
| B4 | MCP 工具面 + 对话闭环实测 | 10（首个真实价值交付） | 3 | 2 | B3 | P1 |
| M1 | 实体 picker + 实体节点编辑 | 7（实体中心画布入口，与 B 线呼应） | 3 | 2 | 无（v1.0 契约足够） | P1 可并行 |
| B5 | 画布集成（Sync Panel/promote/saveGate/409/links·groups 渲染） | 8（完整体验） | 4（最重的一块） | 3 | B4 + M1 | P2 |
| M2 | 富内容实验（翻转背面/@draw SVG） | 6（探索性，用户兴趣） | 3 | 2 | 无 | P2 用户主导 |
| M3 | PWA + 同源部署进 Forgejo | 5 | 2 | 1 | B2（同源需要 sidecar 布局定） | P2 |
| E1 | PomodoroXI session 插件 | 6 | 3 | 2 | B 线走通一个完整三段式样本（≥B3） | P3 |
| E2 | MarkVault 标注互通 | 5 | 3 | 2 | 同上 | P3 |
| M4 | 主题 tokens 迭代 | 4 | 1-2 | 0 | 无 | 随时（用户审美驱动） |
| I3 | 公网部署（Docker Compose + CF Tunnel） | 5 | 3 | 3 | B 线稳定自用后 | P3 |

## 四、B 线：forgejo-bridge（价值主线，串行主干）

> 依据 spec §11 实施蓝图，按 R12 无耦合先行原则排序。技术栈：FastAPI Sidecar（Python）+ mindcanvas react 集成（TS），三通道适配层隔离语言差异。

### B0 · CLI 提示词验证（1-2 天）【对应 spec Phase 1】

- 固定 prompt，输入三张 demo 画布 `.mm.md`，输出提议集 JSON
- 人工核对标题/body/归属/建议标记质量，**验收线：满意提议 ≥ 80%**
- 产出：`llm/prompts/` 模板 v1 + 质量评估记录（每张画布的提议逐条打分）
- **决策点 D1**：达标 → B1；不达标 → 迭代 prompt（≤2 轮）；仍不达标 → 回 spec 修订提议 schema（这是最大的早期风险，宁可在这里回炉也不要带病进服务开发）

### B1 · 插件立项与骨架（0.5-1 天）

- forgejo-bridge 独立目录/仓库（FastAPI 项目骨架：pyproject + uv/标准布局）
- `ProposalSet` 类型定义（K5 结论：插件侧自带，内核保持最小 API）+ `semantics.json` v1（含 qa 词汇——R15）
- `GET /schema` 的数据源定义（双层定义的语义层落地）

### B2 · Sidecar 五端点 + 幂等 + 台账（1-2 天）

- 五端点（`/canvas/branch` 读 / `/forgejo/comment` 推评论 / `/analyze` / `/apply` / `/reconcile`）+ agent key 只读默认（`AGENT_WRITE` 显式开启——R10 安全条款）
- 幂等键域（refKey）+ 台账 SQLite（缓存语义：删了全量对账重建——R14 存储四层表）
- 单测全绿（spec Phase 2 验收口径）

### B3 · 对账 + Bridge Skill（1-2 天）

- reconcile 对账逻辑：期望态（导图 refs）vs 实际态（Forgejo contents API），stale/dangling 报告不自动回写（P2 盲目 revert drift 是经典事故——调研背书）
- `SKILL.md` 发布（Bridge Skill 行为规范 R4：五条纪律含未知词汇透传上报）
- **里程碑 B 前半**：对话 agent 可问「有什么需要同步」

### B4 · MCP 工具面 + 对话闭环实测（1-2 天）

- 五端点 → MCP 工具映射（read_branch / reconcile / push_comment / analyze / apply）
- **deepseek-harness 或 WorkBuddy 实测**：完成读分支 → 讨论 → 推评论 → 对账全流程
- **决策点 D2**：自用 1 周，对话闭环是否进入日常？（这是「首个真实价值交付」的验收）
- **里程碑 B**：对话 agent 协作闭环可用

### B5 · 画布集成（2-3 天，最重一块）【对应 spec Phase 2 画布侧】

- Sync Panel（出库/入库页签 + 高置信批量放行/低置信聚合——R10 噪音控制）
- promote 节点升级交互 + saveGate 保存管线 + 409 三向合并 + resolver 轮询回显
- links/groups 渲染（dangling 灰色悬空线——note-anchor 契约的渲染落地）
- **走 react 插件注册表**（RendererRegistry/ChannelRegistry），不硬编码——微内核纪律的最后验证
- **里程碑 C**：Terraform for ideas 完整体（画布一键审批全链路）

## 五、M 线：mindcanvas 产品深化（并行支线，用户主导）

| 项 | 内容 | 备注 |
|---|---|---|
| M1 实体 picker | `@` 触发实体插入、实体节点编辑（P1 对照表最后一项主力） | **与 B 线呼应最紧**——实体中心的画布侧入口；B 线桥通了以后这个入口直接产出真 issue |
| M2 富内容实验 | 节点翻转背面 note 深化 / `@draw` SVG 节点（R11 扩展缝矩阵验证案例） | 用户兴趣驱动，探索性质 |
| M3 PWA + 部署 | 同源部署进 Forgejo `/assets/canvas/`（R14 局域网阶段） | 需要 B2 的 sidecar 布局一起定 |
| M4 主题迭代 | tokens 层调整（风格迭代只动 tokens 不动组件——ADR-0003 红利） | 随时，半小时级 |

## 六、E 线与 I 线

**E 线（生态接入，P3）**：E1 PomodoroXI session 插件、E2 MarkVault 标注互通——**门槛：B 线至少走通 B3**（三段式契约有一个完整实现样本后复制，不从零摸索）。镜子二/三已验收接口零缺口，接入即用。

**I 线（基础设施，P0 顺手 + P3 后期）**：
- I1 Forgejo 远端推送（半小时，版本安全网——建议本周内）
- I2 knowledge-canvas 归档（README 标注继任仓库 mindcanvas）
- I3 公网部署（B 线稳定自用后再做，Docker Compose + Cloudflare Tunnel——R14 已定案）

## 七、执行节奏（压缩时间线）

```
第 1 周        第 2 周           第 3 周          之后
─────────────────────────────────────────────────
B0 ─ B1 ─ B2 ─ B3 ─ B4 ───── B5 ─────── E1/E2 复制
I1/I2 (半天)                                I3
M1 (并行插队)     M4 随时 / M2 用户兴趣驱动
        ↑D1      ↑D2            ↑里程碑C
```

- 主干串行：B 线（AI 外派为主，沿用任务书→执行→独立复核循环）
- 并行支线：M 线用户主导探索，M1 可与 B1-B3 并行外派
- 时间盒总计：B0-B4 ≈ 5-8 天（到对话闭环可用），B5 ≈ 2-3 天，全部 ≈ 2 周内

## 八、风险与对策

| 风险 | 对策 |
|---|---|
| LLM 提议质量不达标（最大风险） | B0 风险前置——1-2 天暴露；prompt 迭代 ≤2 轮；仍不达标回 spec 修 schema，不带病进服务开发 |
| B5 画布集成量级超预期 | 拆两批：先只读对账视图（Sync Panel 只读态），审批交互后补 |
| 跨语言集成复杂度（TS 画布 × Python sidecar） | 三通道适配层隔离（R8 设计）；画布只经 REST/MCP 与 sidecar 通信，零 Python 依赖 |
| 单人多线并行负担 | B 线为唯一主干，M 线轻量插队；E/I 线严格设门槛不提前启动 |
| 「0 用户」验证缺失（创业验证课题的已知瓶颈） | B4 后先自用沉淀真实用例；之后再考虑公开分享（V2EX 等，与 PomodoroXI 同路径） |
| 内核契约变更冲动 | ADR-0004 冻结纪律：minor 可加不可改，major 须 ADR——插件开发期若真需要 major，先出 ADR 评审 |

## 九、下一步动作（按序）

1. **今天**：I1 推送 Forgejo 远端（半小时）+ I2 归档 knowledge-canvas（半小时）
2. **立即**：出 B0 深度外派任务书（CLI 提示词验证——任务书只需 demo 画布 + 提议 schema + 质量评估表模板，无需其他依赖）
3. **B0 回来后**：按 D1 决策走 B1，同时 M1 可并行外派
