# OSS 深度调研：思维导图 × Forgejo 联动的内核定位与架构指导

| 项 | 值 |
|---|---|
| 日期 | 2026-08-27 |
| 目的 | 调研成熟开源项目，确定本项目（canvas-bridge）的内核定义与架构指导原则 |
| 关联 | `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md`（设计 spec） |
| 方法 | 定向调研 5 个成熟系统（Terraform / Renovate / Markmap / GitHub MCP Server / deepseek-harness）+ GitHub Trending 生态观察（trending 详情 API 因无 token 限流，快照未取得，以定向调研为主） |

---

## 1. 逐项目架构剖析

### 1.1 Terraform —— plan/apply 分离与漂移检测

**关键机制**：
- **plan 是只读工件**：计算期望态与实际态的 diff，输出可审查的执行计划；apply 才写
- **plan artifact 绑定**：CI/CD 中「被审查的计划就是被执行的计划」——approve 的是 plan 工件本身，不是重新计算的意图
- **drift 定义**：实际基础设施偏离声明配置 = drift；`plan` 是主要检测工具，**不是所有 drift 都应该 auto-fix**（有的漂移是紧急热修，需要 triage）
- **state 是缓存**：state 文件映射配置↔真实资源，可备份可重建，不鼓励直接交互
- **GitOps 门禁**：plan-in-PR → review → merge → apply-with-approval

**对本项目的启示**：我们的 analyze/apply 就是 plan/apply——但调研确认了两个此前隐含的要点必须**显式化**：① 提议集要像 plan artifact 一样「批准即绑定」（node_anchor 指纹正是这个机制，已被 R 设计覆盖）；② 对账回流绝不自动应用（inbound 提议必须人接受）——Terraform 社区把「盲目 revert drift」列为经典事故。

### 1.2 Renovate —— 机器提议、人类合并

**关键机制**（特别注意：**Renovate 官方支持 Forgejo 平台**——机器提议模式在我们目标平台上已被验证）：
- 四类模块正交：platform（源码托管平台）/ manager（文件格式识别）/ datasource（版本查询）/ versioning（版本比较）——新增平台不动其他三层
- **PR 即提议**：bot 开 PR，人（或 CI 通过后）合并；分组（grouping）与调度（schedule）控制噪音
- **dependencyDashboard**：每仓一个 issue 汇总全部待处理更新——单一视图看全部漂移
- **三层配置叠加**：cli > env > file > default；`automerge` 按规则分级（patch 自动、major 必须人审）
- 调试哲学：`LOG_LEVEL=debug` 必须能解释「为什么没有开 PR」

**对本项目的启示**：① 对账报告 = dependencyDashboard 的等价物（单一视图列出全部待同步项）——确认 spec §7.3 方向正确；② 噪音控制是被低估的设计面：Renovate 用 prConcurrentLimit/prHourlyLimit/分组对抗 PR 泛滥，Sync Panel 需要同等的「低置信聚合、批量放行、不打扰」策略；③ debug 可解释性：「为什么这个节点没生成提议」必须可回答。

### 1.3 Markmap —— 文本优先与两相架构

**关键机制**：
- **两相处理**：Phase 1（parse & transform：多格式输入 → 统一 IPureNode 树）/ Phase 2（render：D3 布局 + SVG）——**IPureNode 是转换与渲染之间的 pivot 数据契约**
- 纯文本 markdown 是唯一事实源，渲染是投影（与我们的 `.mm.md` 理念同源）
- 插件系统：插件声明所需资源（CSS/JS），按文档特性检测按需加载
- Monorepo 分层：lib（转换）/ view（渲染）/ cli / autoloader / common——按需引用、独立测试

**对本项目的启示**：knowledge-canvas 的 protocol（parser/serializer）↔ layout（渲染）分离与 Markmap 同构，验证了现有架构。新增强调：**relations v2 的解析必须留在协议侧数据结构里，不耦合渲染**——连线几何是渲染层的投影。

### 1.4 GitHub 官方 MCP Server —— 工具面治理

**关键机制**：
- **toolset 分组**：60+ 工具按 repos/issues/pull_requests 等命名组管理，启动时按配置注册——未启用的组**完全不出现**在 tools/list 里
- **--read-only 旗标**：readOnlyHint 标注的才注册，写工具直接跳过——给 agent 只读访问是安全默认
- **server instructions**：MCP 规范的服务端指令，教模型「先 A 后 B」的工作流和分页等通用习惯——系统提示词级自描述
- **工具合并**：create_issue/update_issue 合并为 `issue_write(method: create|update)`——多方法单工具，减少工具数量、AI 推理更清晰
- 三种鉴权（PAT/GitHub App/OAuth）按环境变量自动选择

**对本项目的启示**：① **agent key 应默认只读**（读分支/对账随时可用），写操作（apply/推评论）需要显式开启——比「双凭证」更进一步的默认安全；② MCP 工具面坚持 5 个工具的多方法设计（read_branch 已含评论合并视图）；③ `/schema` 端点等价于 server instructions，方向正确。

### 1.5 deepseek-harness（前轮已调研）

插件化 agent 框架（cordis DI），agent-loop/沙箱/计划模式，MCP 已支持。定位为「智能侧」，与本桥「主权侧」互补。本报告不重复展开。

---

## 2. 内核定义

综合四个成熟系统的共同骨架，本项目的内核收敛为一个三元组：

```
内核（Kernel）=
  ① 文本协议画布（Text Protocol Canvas）
     .mm.md 单一事实源，人机同读，透传兼容演进
  × ② 提议门禁执行器（Plan-Gated Executor）
     analyze = plan（只读、可审查、指纹绑定、可作废）
     apply = 执行（幂等、逐条回报）
     人批 = 硬门禁（架构属性，非 agent 自律）
  + ③ 漂移对账（Reconcile）
     导图 = desired state，Forgejo = actual state
     台账 = state file（缓存可重建，非事实源）
     漂移只报告，修复必须经 inbound 提议人工接受
```

**一句话：Terraform for ideas —— 把想法当基础设施管理：导图声明期望态，桥执行受控变更，对账发现漂移，人握住每一个 apply。**

这个定义同时解释了三个此前看似独立的设计决策为何必然：画布主权（单一事实源必然）、提议门禁（受控变更必然）、台账可重建（缓存性质必然）。

## 3. 架构指导原则（十条，从调研对象提炼）

| # | 原则 | 来源 | 在本项目的落点 |
|---|---|---|---|
| P1 | 两相分离 + pivot 数据契约 | Markmap IPureNode | MindNode AST 是唯一契约；relations v2 解析结果进协议侧数据，不碰渲染 |
| P2 | 被审查的 = 被执行的 | Terraform plan artifact | node_anchor 指纹绑定；失配即 stale 宁可不写 |
| P3 | 机器提议、人类合并 | Renovate（已在 Forgejo 验证） | ProposalSet 人批门禁；评论推送自然语言确认 |
| P4 | 状态是缓存不是事实 | Terraform state / ledger | 台账删除重建即全量对账；首次运行路径=重建路径 |
| P5 | 漂移只 triage 不自动修复 | Terraform drift 实践 | inbound 提议必须人在画布接受；绝不 auto-apply |
| P6 | 汇总仪表盘对抗遗漏 | Renovate dependencyDashboard | 对账报告 = 全部待同步项的单一视图 |
| P7 | 噪音控制是设计面 | Renovate limit/分组/调度 | Sync Panel：高置信批量放行、低置信聚合、默认不打扰 |
| P8 | 可解释性：能回答「为什么没有」 | Renovate debug 日志 | analyze 必须能解释「这个节点为何 skip/低置信」 |
| P9 | 只读默认 + 写显式开启 | GitHub MCP --read-only | agent key 默认只读；apply/推评论类工具需配置显式启用 |
| P10 | 工具聚合 + 自描述 | GitHub MCP toolset/instructions | MCP 面保持 5 个多方法工具；/schema 端点即 server instructions |

## 4. 对现有 spec 的验证结论

**已验证为正确的设计**（调研背书）：画布主权（P2/P3/P4 三重印证）、提议集指纹（P2）、台账可重建（P4）、对账人工接受（P5）、/schema 自描述（P10）、5 工具 MCP 面（P10）。

**建议增补的两处**（对应 P7/P9，spec 尚未显式覆盖）：
1. **§6.2 鉴权条款强化**：agent key 默认只读；`analyze`/`apply`/`forgejo/comment` 三端点对 agent 凭证需显式开启（`AGENT_WRITE=true`）
2. **新增噪音控制原则**（进 §7.1 或独立小节）：Sync Panel 批量批准策略——confidence ≥ 0.8 提议支持一键批量放行；低置信聚合为一条待审组；对账报告一次性呈现、不推送提醒

## 5. 遗留说明

- GitHub Trending 快照因 API 限流（无 GITHUB_TOKEN）未取得，生态趋势观察以 deepseek-harness 调研替代；后续可配置 token 后重跑 `github-trending-cn` 补充
- 本报告的原则映射均指向现有 spec 决策，两处增补建议待确认后以 R10 形式合入
