import networkx as nx
from typing import Optional
from .models import (
    RawNode,
    RawEdge,
    CycleDetectedError,
    GraphIndices,
    ExportedNode,
    ExportedEdge,
    GraphJson,
)


class CausalityGraphEngine:
    """Core NetworkX wrapper for causality and DAG algorithms."""

    def __init__(self):
        self.graph = nx.DiGraph()
        self.node_registry: dict[str, RawNode] = {}
        self.edge_registry: list[RawEdge] = []

    def load(self, nodes: list[RawNode], edges: list[RawEdge]) -> "CausalityGraphEngine":
        """Load nodes and edges into the directed graph."""
        self.graph.clear()
        self.node_registry.clear()
        self.edge_registry.clear()

        for node in nodes:
            self.node_registry[node.id] = node
            self.graph.add_node(
                node.id,
                label=node.label,
                level=node.level,
                kind=node.kind,
                file_path=node.file_path,
                metadata=node.metadata,
            )

        for edge in edges:
            self.edge_registry.append(edge)
            # Add directed edge in graph (from_id -> to_id)
            self.graph.add_edge(
                edge.from_id,
                edge.to_id,
                kind=edge.kind,
                direction=edge.direction,
                metadata=edge.metadata,
            )

        return self

    def check_acyclic(self) -> None:
        """Validate DAG: raise CycleDetectedError if any cycle exists."""
        try:
            cycle = nx.find_cycle(self.graph, orientation="original")
            cycle_nodes = [edge[0] for edge in cycle] + [cycle[-1][1]]
            raise CycleDetectedError(cycle_nodes)
        except nx.NetworkXNoCycle:
            pass

    def get_topological_order(self) -> list[str]:
        """Compute topological sort order."""
        self.check_acyclic()
        return list(nx.topological_sort(self.graph))

    def get_descendants(self, node_id: str) -> list[str]:
        """Return all downstream reachable nodes (transitive closure)."""
        if node_id not in self.graph:
            return []
        return list(nx.descendants(self.graph, node_id))

    def get_ancestors(self, node_id: str) -> list[str]:
        """Return all upstream prerequisite nodes (transitive closure)."""
        if node_id not in self.graph:
            return []
        return list(nx.ancestors(self.graph, node_id))

    def check_reachability(self, source_nodes: list[str], target_node: str) -> tuple[bool, list[str]]:
        """Check if target_node is reachable from any source node. Returns (reachable, shortest_path)."""
        if target_node not in self.graph:
            return False, []

        shortest: Optional[list[str]] = None
        for s in source_nodes:
            if s not in self.graph:
                continue
            if s == target_node:
                return True, [s]
            if nx.has_path(self.graph, s, target_node):
                p = nx.shortest_path(self.graph, s, target_node)
                if shortest is None or len(p) < len(shortest):
                    shortest = p

        if shortest is not None:
            return True, shortest
        return False, []

    def compute_indices(self) -> GraphIndices:
        """Precompute hot-path indices for O(1) reads in graph.json."""
        self.check_acyclic()

        descendants: dict[str, list[str]] = {}
        ancestors: dict[str, list[str]] = {}
        in_degree: dict[str, int] = {}

        for n in self.graph.nodes():
            descendants[n] = sorted(list(nx.descendants(self.graph, n)))
            ancestors[n] = sorted(list(nx.ancestors(self.graph, n)))
            in_degree[n] = self.graph.in_degree(n)

        topo_order = list(nx.topological_sort(self.graph))

        return GraphIndices(
            descendants=descendants,
            ancestors=ancestors,
            in_degree=in_degree,
            topological_order=topo_order,
        )

    def to_graph_json(self, domain: str, source_hash: str) -> GraphJson:
        """Export compiled graph into validated GraphJson schema."""
        indices = self.compute_indices()

        nodes: list[ExportedNode] = [
            ExportedNode(
                id=n.id,
                label=n.label,
                level=n.level,
                kind=n.kind,
                file_path=n.file_path,
                metadata=n.metadata,
            )
            for n in self.node_registry.values()
        ]

        edges: list[ExportedEdge] = [
            ExportedEdge(
                from_node=e.from_id,
                to_node=e.to_id,
                kind=e.kind,
                direction=e.direction,
                metadata=e.metadata,
            )
            for e in self.edge_registry
        ]

        return GraphJson(
            version="1.0.0",
            domain=domain,
            source_hash=source_hash,
            nodes=nodes,
            edges=edges,
            indices=indices,
        )
