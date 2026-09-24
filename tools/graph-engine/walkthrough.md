# 图引擎（Graph Engine）与 mindcanvas 拓扑消费落地总结

根据实施规划方案，图引擎微内核、领域提取器、编译管线、FastMCP Agent 服务及 mindcanvas 前端只读适配器已全量落地并完成自动化回归验证。

## 一、本次实施交付成果

1. **规格与契约层（Milestone M1）**：`docs/specs/2026-09-08-graph-engine-spec.md` 定义通用中间表达（IR: RawNode / RawEdge），冻结 graph.json v1.0 Schema（节点、边、闭包与入度索引），确定 `BaseDomainExtractor` 抽象契约与 FastMCP 工具签名。

2. **图计算微内核与算法层（Milestone M2）**：`core/models.py`（Pydantic 校验 + `CycleDetectedError`）；`core/engine.py` 基于 NetworkX 实现纯数学 DAG 计算——`check_acyclic` 环检测、`get_topological_order` 拓扑学习序/排期、`compute_indices` 预计算 descendants（级联漂移受影响集）与 ancestors（前置母材链）、`check_reachability` 路径判存与最短路径求解。

3. **领域提取与编译（Milestone M3）**：`extractors/base.py` 定义 `BaseDomainExtractor`（预留 PomodoroXII 任务插件插槽）；`extractors/forgejo.py` 解析 YAML frontmatter 的 `calls_core / prerequisites / implements / subsumes / twins / guardrails`；`compiler/pipeline.py` 编译管线——整库 `source_hash` 校验 + 变更时全量重建（当前规模毫秒级；真·增量按文件 `content_hash` 仅重编变更闭包列入 backlog），产物原子写至 `.engine/cache/<domain>.graph.json`，内建孤立节点/缺失前置 Lint 检测。

4. **Agent FastMCP 服务层（Milestone M4）**：`server.py` 暴露 4 个只读探针工具：`inspect_node_chain`（前置/后继链 + 相区断言）、`detect_cascade_drift`（级联漂移范围 + 跳数）、`check_proof_path`（推导路径连通性）、`compile_graph`（领域编译 + Lint 报告）。缓存目录支持 `GRAPH_ENGINE_CACHE_DIR` 环境变量注入，`compile_graph` 缺省解析到 `<source_dir>/.engine/cache`（FIX-001）。

5. **mindcanvas 渲染消费适配器（Milestone M4）**：`packages/kernel/src/adapters/graphJsonAdapter.ts` 将 graph.json 转为 mindcanvas 可消费的 `EditableNode` 树；自动识别入度为 0 的节点生成多中心 `CenterSpec[]`（复用 G6′ 森林布局 `forest.ts`）；跨分支因果边无损转为 `root.note.edges` 文档级自由边（ADR-0008，走 `edgeRouting.ts` 避障路由）；`packages/kernel/src/index.ts` 导出 `graphJsonToMindmap` 及配套类型。

## 二、测试与验证结果

- Python 图引擎单测：`tools/graph-engine/.venv/Scripts/pytest.exe tools/graph-engine/tests -q` → **10/10 通过**（编译缓存复用、环检测、传递闭包与级联漂移、最短路径、入度、拓扑序、提取器、4 个 MCP 工具端到端、非 CWD 缓存解析）。
- 前端适配器与内核测试：`corepack pnpm --filter @mindcanvas/kernel test -- --run` → **50 文件 / 393+ 条全部通过**。
- Monorepo 构建：`corepack pnpm -r build` → kernel / react / apps/canvas 全部通过，零类型错误。

## 三、后续使用与接入方式

1. **Agent 本地挂载 FastMCP**（IDE MCP 配置）：

```json
{
  "mcpServers": {
    "graph-engine": {
      "command": "E:\\Development\\MyAwesomeApp\\mindcanvas\\tools\\graph-engine\\.venv\\Scripts\\python.exe",
      "args": ["-m", "server"],
      "cwd": "E:\\Development\\MyAwesomeApp\\mindcanvas\\tools\\graph-engine\\src",
      "env": { "GRAPH_ENGINE_CACHE_DIR": "E:\\Development\\MyAwesomeApp\\<forgejo-repo-root>\\.engine\\cache" }
    }
  }
}
```

> 注：缓存目录建议指向 Forgejo 仓库根 `.engine/cache`（与前端 fetch 路径一致），或省略 `env` 由 `compile_graph(source_dir=<仓库根>)` 自动解析（FIX-001）。

2. **前端展示拓扑大屏**：

```ts
import { graphJsonToMindmap } from '@mindcanvas/kernel';
const graphPayload = await fetch('/.engine/cache/math.graph.json').then(r => r.json());
const { root, centers, edges } = graphJsonToMindmap(graphPayload);
// <MapView root={root} /> 底层自动启用避障边与森林布局
```

## 四、已知限制（规划边界）

- 八大图算法当前覆盖：DAG / 环检测 / 拓扑排序 / 传递闭包 / 可达性 / 最短路径 / 入度计数；**断言求值、3-Hit 事件监听、介数中心性** 未实现（`guardrails` 仅存节点 metadata）——断言求值归入 M4 认知里程碑，3-Hit 事件归消费侧，介数中心性为冷路径。
