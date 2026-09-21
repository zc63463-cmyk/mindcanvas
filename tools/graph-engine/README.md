# graph-engine

认知因果图引擎与 FastMCP 服务（mindcanvas 的 Agent 计算层）。

- **核心**：NetworkX DAG 计算——环检测 / 拓扑排序 / 传递闭包 / 可达性 / 最短路径 / 入度计数
- **提取器**：Forgejo 认知冶金学（YAML frontmatter）；`BaseDomainExtractor` 预留 Pomodoro 任务插件插槽
- **编译**：整库 `source_hash` 校验 + 全量重建（原子写）→ `.engine/cache/<domain>.graph.json`
- **服务**：FastMCP 只读探针——`inspect_node_chain` / `detect_cascade_drift` / `check_proof_path` / `compile_graph`

使用与验证：见 `walkthrough.md`；契约与 Schema：见 `docs/specs/2026-09-08-graph-engine-spec.md`（mindcanvas 仓库）。
