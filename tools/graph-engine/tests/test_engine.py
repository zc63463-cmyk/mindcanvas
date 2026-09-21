import pytest
from core.models import RawNode, RawEdge, CycleDetectedError
from core.engine import CausalityGraphEngine


def sample_math_nodes() -> list[RawNode]:
    return [
        RawNode(id="rolle-theorem", label="罗尔定理", level="L0", kind="theorem"),
        RawNode(id="lagrange-mvt", label="拉格朗日中值定理", level="L0", kind="theorem"),
        RawNode(id="cauchy-mvt", label="柯西中值定理", level="L0", kind="theorem"),
        RawNode(id="taylor-expansion", label="泰勒公式", level="L1", kind="paradigm"),
        RawNode(id="power-rule", label="幂函数求导", level="L0", kind="theorem"),
    ]


def sample_math_edges() -> list[RawEdge]:
    return [
        RawEdge(from_id="rolle-theorem", to_id="lagrange-mvt", kind="calls_core"),
        RawEdge(from_id="lagrange-mvt", to_id="cauchy-mvt", kind="calls_core"),
        RawEdge(from_id="cauchy-mvt", to_id="taylor-expansion", kind="calls_core"),
        RawEdge(from_id="power-rule", to_id="taylor-expansion", kind="calls_core"),
    ]


def test_basic_dag_build_and_export():
    engine = CausalityGraphEngine()
    engine.load(sample_math_nodes(), sample_math_edges())

    graph_json = engine.to_graph_json(domain="math", source_hash="hash123")

    assert graph_json.version == "1.0.0"
    assert graph_json.domain == "math"
    assert len(graph_json.nodes) == 5
    assert len(graph_json.edges) == 4
    assert len(graph_json.indices.topological_order) == 5


def test_cycle_detection():
    engine = CausalityGraphEngine()
    nodes = [
        RawNode(id="A", label="Node A"),
        RawNode(id="B", label="Node B"),
        RawNode(id="C", label="Node C"),
    ]
    edges = [
        RawEdge(from_id="A", to_id="B", kind="depends"),
        RawEdge(from_id="B", to_id="C", kind="depends"),
        RawEdge(from_id="C", to_id="A", kind="depends"),  # Cycle: A -> B -> C -> A
    ]
    engine.load(nodes, edges)

    with pytest.raises(CycleDetectedError) as exc_info:
        engine.check_acyclic()

    assert "Cycle detected" in str(exc_info.value)


def test_transitive_closures_and_cascade_drift():
    engine = CausalityGraphEngine()
    engine.load(sample_math_nodes(), sample_math_edges())

    # Descendants of rolle-theorem (cascade drift set)
    descendants = engine.get_descendants("rolle-theorem")
    assert set(descendants) == {"lagrange-mvt", "cauchy-mvt", "taylor-expansion"}

    # Ancestors of cauchy-mvt (prerequisites chain)
    ancestors = engine.get_ancestors("cauchy-mvt")
    assert set(ancestors) == {"rolle-theorem", "lagrange-mvt"}


def test_reachability_and_proof_path():
    engine = CausalityGraphEngine()
    engine.load(sample_math_nodes(), sample_math_edges())

    # Reachable path from rolle to taylor
    reachable, path = engine.check_reachability(["rolle-theorem"], "taylor-expansion")
    assert reachable is True
    assert path == ["rolle-theorem", "lagrange-mvt", "cauchy-mvt", "taylor-expansion"]

    # Reachable from multiple sources
    reachable, path = engine.check_reachability(["power-rule"], "taylor-expansion")
    assert reachable is True
    assert path == ["power-rule", "taylor-expansion"]

    # Unreachable target
    reachable, path = engine.check_reachability(["cauchy-mvt"], "rolle-theorem")
    assert reachable is False
    assert path == []


def test_in_degree_computation():
    engine = CausalityGraphEngine()
    engine.load(sample_math_nodes(), sample_math_edges())

    indices = engine.compute_indices()

    # taylor-expansion has 2 in-edges (from cauchy-mvt and power-rule)
    assert indices.in_degree["taylor-expansion"] == 2
    # rolle-theorem and power-rule are root nodes (in_degree = 0)
    assert indices.in_degree["rolle-theorem"] == 0
    assert indices.in_degree["power-rule"] == 0


def test_topological_sort_order():
    engine = CausalityGraphEngine()
    engine.load(sample_math_nodes(), sample_math_edges())

    topo = engine.get_topological_order()

    # Predecessors must appear before successors
    assert topo.index("rolle-theorem") < topo.index("lagrange-mvt")
    assert topo.index("lagrange-mvt") < topo.index("cauchy-mvt")
    assert topo.index("cauchy-mvt") < topo.index("taylor-expansion")
    assert topo.index("power-rule") < topo.index("taylor-expansion")
