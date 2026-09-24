import json
import os
from pathlib import Path
from typing import Optional
from fastmcp import FastMCP
import networkx as nx
from core.engine import CausalityGraphEngine
from core.models import GraphJson, RawNode, RawEdge
from extractors.forgejo import ForgejoMetallurgyExtractor
from compiler.pipeline import GraphCompiler

mcp = FastMCP("CausalityGraphEngine")

# Cache of loaded engines per domain
_LOADED_ENGINES: dict[str, tuple[CausalityGraphEngine, GraphJson]] = {}
CACHE_DIR = Path(os.environ.get("GRAPH_ENGINE_CACHE_DIR", ".engine/cache"))


def get_or_load_engine(domain: str) -> tuple[CausalityGraphEngine, GraphJson]:
    """Retrieve engine and GraphJson from memory cache or file cache."""
    if domain in _LOADED_ENGINES:
        return _LOADED_ENGINES[domain]

    cache_file = CACHE_DIR / f"{domain}.graph.json"
    if not cache_file.exists():
        raise FileNotFoundError(
            f"Graph cache for domain '{domain}' not found at {cache_file}. Please compile first."
        )

    with open(cache_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    graph_json = GraphJson.model_validate(data)
    engine = CausalityGraphEngine()

    raw_nodes = [
        RawNode(
            id=n.id,
            label=n.label,
            level=n.level,
            kind=n.kind,
            file_path=n.file_path,
            metadata=n.metadata,
        )
        for n in graph_json.nodes
    ]
    raw_edges = [
        RawEdge(
            from_id=e.from_node,
            to_id=e.to_node,
            kind=e.kind,
            direction=e.direction,
            metadata=e.metadata,
        )
        for e in graph_json.edges
    ]
    engine.load(raw_nodes, raw_edges)

    _LOADED_ENGINES[domain] = (engine, graph_json)
    return engine, graph_json


@mcp.tool()
def inspect_node_chain(node_id: str, domain: str = "math") -> dict:
    """Inspect full upstream ancestors, downstream descendants, and guardrails for a node.

    Args:
        node_id: The ID of the node to inspect.
        domain: Domain name (default 'math').
    """
    engine, graph_json = get_or_load_engine(domain)
    if node_id not in engine.graph:
        return {"error": f"Node '{node_id}' not found in domain '{domain}'."}

    node = engine.node_registry[node_id]
    ancestors = sorted(list(engine.get_ancestors(node_id)))
    descendants = sorted(list(engine.get_descendants(node_id)))

    direct_preds = [
        {"from": u, "kind": engine.graph[u][node_id].get("kind", "calls_core")}
        for u in engine.graph.predecessors(node_id)
    ]
    direct_succs = [
        {"to": v, "kind": engine.graph[node_id][v].get("kind", "calls_core")}
        for v in engine.graph.successors(node_id)
    ]

    return {
        "node": {
            "id": node.id,
            "label": node.label,
            "level": node.level,
            "kind": node.kind,
            "file_path": node.file_path,
        },
        "guardrails": node.metadata.get("guardrails", []),
        "ancestors": ancestors,
        "descendants": descendants,
        "direct_predecessors": direct_preds,
        "direct_successors": direct_succs,
    }


@mcp.tool()
def detect_cascade_drift(changed_node_id: str, domain: str = "math") -> dict:
    """Detect all downstream nodes affected by modifying a given node (cascade drift set).

    Args:
        changed_node_id: The node that has been or will be changed.
        domain: Domain name (default 'math').
    """
    engine, graph_json = get_or_load_engine(domain)
    if changed_node_id not in engine.graph:
        return {"error": f"Node '{changed_node_id}' not found in domain '{domain}'."}

    descendants = engine.get_descendants(changed_node_id)
    distances = nx.single_source_shortest_path_length(engine.graph, changed_node_id)
    affected_nodes = []
    for d_id in descendants:
        d_node = engine.node_registry[d_id]
        affected_nodes.append(
            {
                "id": d_node.id,
                "label": d_node.label,
                "level": d_node.level,
                "kind": d_node.kind,
                "distance": distances.get(d_id),
            }
        )

    warning = ""
    if affected_nodes:
        warning = (
            f"Node '{changed_node_id}' modification will cause cascade drift in "
            f"{len(affected_nodes)} downstream nodes. Verify guardrails and invariants."
        )

    return {
        "target": changed_node_id,
        "affected_count": len(affected_nodes),
        "affected_nodes": affected_nodes,
        "warning": warning,
    }


@mcp.tool()
def check_proof_path(
    given_nodes: list[str], goal_node: str, domain: str = "math"
) -> dict:
    """Check if goal_node is reachable from given_nodes, returning the shortest path.

    Args:
        given_nodes: List of prerequisite or given node IDs.
        goal_node: Target node to prove or reach.
        domain: Domain name (default 'math').
    """
    engine, graph_json = get_or_load_engine(domain)
    reachable, path = engine.check_reachability(given_nodes, goal_node)

    return {
        "goal_node": goal_node,
        "reachable": reachable,
        "path": path,
        "given_nodes": given_nodes,
    }


@mcp.tool()
def compile_graph(
    source_dir: str,
    domain: str = "math",
    force_rebuild: bool = False,
    cache_dir: Optional[str] = None,
) -> dict:
    """Compile a folder of markdown files into the domain graph cache.

    Args:
        source_dir: Relative or absolute path to the directory containing markdown files.
        domain: Domain name (default 'math').
        force_rebuild: If true, ignore cache and rebuild completely.
        cache_dir: Explicit cache directory; defaults to <source_dir>/.engine/cache (FIX-001).
    """
    global CACHE_DIR
    CACHE_DIR = Path(cache_dir) if cache_dir else Path(source_dir) / ".engine" / "cache"
    extractor = ForgejoMetallurgyExtractor(domain=domain)
    compiler = GraphCompiler(extractor=extractor, cache_dir=CACHE_DIR)
    result = compiler.compile(source_dir, force_rebuild=force_rebuild)

    # Invalidate in-memory cache
    if domain in _LOADED_ENGINES:
        del _LOADED_ENGINES[domain]

    return result.to_dict()


if __name__ == "__main__":
    mcp.run()
