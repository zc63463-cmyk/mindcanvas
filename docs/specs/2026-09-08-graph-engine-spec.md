# 图引擎实现规格说明书（Graph Engine Implementation Spec）

> 日期：2026-09-08 · 版本：v1.0.0
> 适用：认知因果图引擎、FastMCP Agent 探针、mindcanvas 拓扑大屏消费适配器

---

## 一、系统架构与分工

图引擎是知识库与任务空间的**因果计算大脑**，定位为**无状态编译器 + 内存图计算服务**——整库 `source_hash` 校验，未变更复用缓存；变更触发全量重建（原子写）。真·增量（按文件 `content_hash` 仅重编变更闭包）列入 backlog，触发条件：单域 > 5,000 文件或单次编译 > 1s。

```
[Markdown 源文件 (YAML Frontmatter)]
               │
               ▼ (Extractor 提取)
    [通用中间表达 IR: RawNode / RawEdge]
               │
               ▼ (Engine 构建 NetworkX 有向图 & 验证)
[验证: DAG 环检测 / 断链定位 / 闭包与入度索引]
               │
               ▼ (Compiler 序列化)
  [.engine/cache/<domain>.graph.json]
         │                       │
         ▼ (FastMCP 服务)         ▼ (只读适配器)
[Agent 工具探针 (只读分析)]   [mindcanvas 拓扑大屏]
```

### 三大红线
1. **单向编译**：源文本为唯一事实源，`graph.json` 为可丢弃重建的编译缓存。
2. **读写分离**：Agent 仅拥有只读查询与增量编译调用权限，图结构的变更必须通过 Git 提交修改源文本。
3. **计算与呈现分离**：图引擎不包含任何渲染逻辑，mindcanvas 不执行任何图推理算法。

---

## 二、通用中间表达（IR: Intermediate Representation）

不论是 Forgejo 冶金学学习流，还是 PomodoroXII 任务空间，提取器统一输出以下标准化 IR：

```python
from typing import Literal, Optional, Any
from pydantic import BaseModel, Field

class RawNode(BaseModel):
    id: str = Field(description="全局唯一节点标识")
    label: str = Field(description="节点人类可读标题")
    domain: str = Field(default="default", description="业务领域或学科")
    level: Optional[str] = Field(default=None, description="分级标识，如 L0~L3, P0~P2")
    kind: str = Field(default="concept", description="节点类型，如 theorem, task, concept")
    file_path: Optional[str] = Field(default=None, description="源文件相对路径")
    metadata: dict[str, Any] = Field(default_factory=dict, description="领域专属扩展属性")

class RawEdge(BaseModel):
    from_id: str = Field(description="源节点 ID")
    to_id: str = Field(description="目标节点 ID")
    kind: str = Field(description="关系类型，如 calls_core, blocks, implements, precedes")
    direction: Literal["fwd", "back", "both"] = Field(default="fwd", description="边方向")
    metadata: dict[str, Any] = Field(default_factory=dict, description="边属性，如 guardrail")
```

---

## 三、编译产物契约（`graph.json` Schema v1.0）

**编译语义**：整库 `source_hash` 校验——未变更直接复用缓存；变更触发全量重建（原子写）。真·增量（按文件 `content_hash` 仅重编变更闭包）列入 backlog，触发条件：单域 > 5,000 文件或单次编译 > 1s。

编译产物以单个 JSON 文件保存在 `.engine/cache/<domain>.graph.json`，结构如下：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GraphEngineCache",
  "type": "object",
  "required": ["version", "domain", "source_hash", "nodes", "edges", "indices"],
  "properties": {
    "version": { "type": "string", "const": "1.0.0" },
    "domain": { "type": "string" },
    "source_hash": { "type": "string", "description": "源文件变动哈希摘要" },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label", "kind"],
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" },
          "level": { "type": "string" },
          "kind": { "type": "string" },
          "file_path": { "type": "string" },
          "metadata": { "type": "object" }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to", "kind"],
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" },
          "kind": { "type": "string" },
          "direction": { "type": "string", "enum": ["fwd", "back", "both"] },
          "metadata": { "type": "object" }
        }
      }
    },
    "indices": {
      "type": "object",
      "required": ["descendants", "ancestors", "in_degree", "topological_order"],
      "properties": {
        "descendants": {
          "type": "object",
          "description": "节点下游闭包映射：{ [node_id]: [downstream_ids] }"
        },
        "ancestors": {
          "type": "object",
          "description": "节点上游前置闭包映射：{ [node_id]: [upstream_ids] }"
        },
        "in_degree": {
          "type": "object",
          "description": "节点入度计数映射：{ [node_id]: count }"
        },
        "topological_order": {
          "type": "array",
          "items": { "type": "string" },
          "description": "全图拓扑排序列表"
        }
      }
    }
  }
}
```

---

## 四、领域提取器接口契约（Extractor Contract）

```python
from abc import ABC, abstractmethod

class BaseDomainExtractor(ABC):
    """领域提取器抽象基类"""

    @abstractmethod
    def extract_from_content(self, content: str, file_path: str) -> tuple[list[RawNode], list[RawEdge]]:
        """从文件内容提取通用节点与边"""
        pass
```

### 1. Forgejo 认知冶金学提取规则
* **主节点**：从 Frontmatter 提取 `id`, `title` (若无则取文件名或 H1), `level` (L0~L3), `type` (concept/theorem/paradigm)。
* **因果边**：
  * `prerequisites: [id, ...]` $\to$ `(id, current, "calls_core")`
  * `calls_core: [id, ...]` $\to$ `(id, current, "calls_core")`
  * `implements: [id, ...]` $\to$ `(current, id, "implements")`
  * `subsumes: [id, ...]` $\to$ `(current, id, "subsumes")`
* **约束与断言**：
  * `guardrails: [str, ...]` $\to$ 注入节点的 `metadata.guardrails`，作为相区断言条件。

### 2. PomodoroXII 任务空间提取规则（预留插槽）
* **主节点**：Task 列表或 Task 文件中的任务项，提取 `@task:id`、`status` (todo/doing/done)、`pomodoros` (估时)。
* **依赖边**：
  * `blocks: [@task:id, ...]` $\to$ `(current, id, "blocks")`
  * `depends_on: [@task:id, ...]` $\to$ `(id, current, "blocks")`

---

## 五、FastMCP Agent 接口契约

服务通过 FastMCP 启动，向 Agent 暴露以下 4 个标准工具：

### 1. `inspect_node_chain`
* **描述**：获取某个节点的完整因果上下文，包括其直接前置、直接后继、上游闭包链、下游受影响集以及相区断言。
* **输入**：`node_id: str`
* **输出**：
  ```json
  {
    "node": { "id": "cauchy-mvt", "label": "柯西中值定理", "level": "L0" },
    "ancestors": ["rolle-theorem", "lagrange-mvt"],
    "descendants": ["taylor-expansion"],
    "direct_predecessors": [
      { "from": "lagrange-mvt", "kind": "calls_core" }
    ],
    "direct_successors": [
      { "to": "taylor-expansion", "kind": "calls_core" }
    ],
    "guardrails": ["f, g 在 [a, b] 连续", "g'(x) != 0"]
  }
  ```

### 2. `detect_cascade_drift`
* **描述**：评估修改指定节点时会造成的级联漂移风险范围（即哪些下游知识或任务将被污染或需要重新检验）。
* **输入**：`changed_node_id: str`
* **输出**：
  ```json
  {
    "target": "rolle-theorem",
    "affected_count": 3,
    "affected_nodes": [
      { "id": "lagrange-mvt", "level": "L0", "distance": 1 },
      { "id": "cauchy-mvt", "level": "L0", "distance": 2 },
      { "id": "taylor-expansion", "level": "L1", "distance": 3 }
    ],
    "warning": "核心母材修改，将造成 3 个下游实体级联漂移，请在 PR 中注明受影响范围。"
  }
  ```

### 3. `check_proof_path`
* **描述**：检查从一组已知节点出发是否可以推导或执行到目标节点，若不可达则指出断裂点。
* **输入**：`given_nodes: list[str]`, `goal_node: str`
* **输出**：
  ```json
  {
    "reachable": true,
    "path": ["rolle-theorem", "lagrange-mvt", "cauchy-mvt"],
    "missing_prerequisites": []
  }
  ```

### 4. `compile_graph`
* **描述**：重新触发指定领域的图编译，更新缓存并返回图健康体检报告（Lint 报告）。
* **输入**：`domain: str`（单域契约，多域 = 多次调用）, `force_rebuild: bool = False`, `cache_dir: str = None`（缺省解析到 `<source_dir>/.engine/cache`）
* **输出**：
  ```json
  {
    "status": "success",
    "domain": "math",
    "node_count": 42,
    "edge_count": 68,
    "source_hash": "c8f1...",
    "lint_issues": [
      { "level": "warning", "code": "ORPHAN_NODE", "node": "isolated-lemma", "msg": "节点无任何出入边" }
    ]
  }
  ```

---

### 5. 能力边界（已实现 vs 规划）

**已实现**：DAG 构建 / 环检测 / 拓扑排序 / 传递闭包（descendants / ancestors 索引）/ 可达性与最短路径 / 入度计数 / 级联漂移（含跳数 `distance`）。

**规划（本期不实现）**：断言求值（`guardrails` 仅存节点 `metadata`，属 M4 认知里程碑）、3-Hit 入度事件监听（消费侧）、介数中心性（冷路径，>5K 域降级为采样估算）。

---

## 六、mindcanvas 前端只读适配契约

前端 `packages/kernel/src/adapters/graphJsonAdapter.ts` 提供转换函数：

```ts
export function graphJsonToMindmap(graph: GraphJson): {
  root: EditableNode;
  centers: CenterSpec[];
  edges: DocEdgePayload[];
}
```

* **转换策略**：
  1. 使用拓扑排序的根节点（入度为 0 的母材节点）作为森林中心（Centers）；
  2. 因果依赖主干使用 `forest.ts`（G6′ 多中心局部布局后平移合并）；
  3. 跨分支依赖与长程边映射为 `root.note.edges`，自动交由 `edgeRouting.ts` 运行智能避障曲线渲染。
