import hashlib
import json
from pathlib import Path
from typing import Optional, Any
from core.models import RawNode, RawEdge, GraphJson
from core.engine import CausalityGraphEngine
from extractors.base import BaseDomainExtractor


class CompileResult:
    def __init__(
        self,
        domain: str,
        source_hash: str,
        node_count: int,
        edge_count: int,
        cache_path: Path,
        lint_issues: list[dict[str, Any]],
        graph_json: GraphJson,
    ):
        self.domain = domain
        self.source_hash = source_hash
        self.node_count = node_count
        self.edge_count = edge_count
        self.cache_path = cache_path
        self.lint_issues = lint_issues
        self.graph_json = graph_json

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": "success",
            "domain": self.domain,
            "source_hash": self.source_hash,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "cache_path": str(self.cache_path),
            "lint_issues": self.lint_issues,
        }


class GraphCompiler:
    """Incrementally compiles domain source markdown files into .engine/cache/<domain>.graph.json."""

    def __init__(
        self,
        extractor: BaseDomainExtractor,
        cache_dir: Optional[Path | str] = None,
    ):
        self.extractor = extractor
        self.cache_dir = Path(cache_dir or ".engine/cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def calculate_source_hash(self, files: list[Path]) -> str:
        """Compute aggregated hash of file contents and paths."""
        hasher = hashlib.sha256()
        for f in sorted(files, key=lambda p: str(p)):
            hasher.update(str(f.name).encode("utf-8"))
            try:
                hasher.update(f.read_bytes())
            except Exception:
                pass
        return hasher.hexdigest()[:16]

    def compile(
        self,
        source_dir: Path | str,
        glob_pattern: str = "**/*.md",
        force_rebuild: bool = False,
    ) -> CompileResult:
        root_path = Path(source_dir)
        files = list(root_path.glob(glob_pattern))
        source_hash = self.calculate_source_hash(files)

        cache_file = self.cache_dir / f"{self.extractor.domain_name}.graph.json"

        # Check if cache is still fresh
        if not force_rebuild and cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)
                    if cached_data.get("source_hash") == source_hash:
                        graph_json = GraphJson.model_validate(cached_data)
                        return CompileResult(
                            domain=self.extractor.domain_name,
                            source_hash=source_hash,
                            node_count=len(graph_json.nodes),
                            edge_count=len(graph_json.edges),
                            cache_path=cache_file,
                            lint_issues=[],
                            graph_json=graph_json,
                        )
            except Exception:
                pass

        # Parse all files
        all_nodes: list[RawNode] = []
        all_edges: list[RawEdge] = []
        for file in files:
            nodes, edges = self.extractor.extract_from_file(file)
            all_nodes.extend(nodes)
            all_edges.extend(edges)

        # De-duplicate nodes by ID
        unique_nodes: dict[str, RawNode] = {}
        lint_issues: list[dict[str, Any]] = []
        for node in all_nodes:
            if node.id in unique_nodes:
                lint_issues.append(
                    {
                        "level": "warning",
                        "code": "DUPLICATE_NODE_ID",
                        "node": node.id,
                        "msg": f"Duplicate node ID '{node.id}' found in {node.file_path}",
                    }
                )
            else:
                unique_nodes[node.id] = node

        # Lint check missing prerequisites
        for edge in all_edges:
            if edge.from_id not in unique_nodes:
                lint_issues.append(
                    {
                        "level": "warning",
                        "code": "MISSING_SOURCE_NODE",
                        "node": edge.from_id,
                        "msg": f"Edge references nonexistent source node '{edge.from_id}'",
                    }
                )
            if edge.to_id not in unique_nodes:
                lint_issues.append(
                    {
                        "level": "warning",
                        "code": "MISSING_TARGET_NODE",
                        "node": edge.to_id,
                        "msg": f"Edge references nonexistent target node '{edge.to_id}'",
                    }
                )

        # Build DAG in engine
        engine = CausalityGraphEngine()
        engine.load(list(unique_nodes.values()), all_edges)
        engine.check_acyclic()

        # Check orphan nodes
        for node_id in unique_nodes:
            if engine.graph.degree(node_id) == 0:
                lint_issues.append(
                    {
                        "level": "info",
                        "code": "ORPHAN_NODE",
                        "node": node_id,
                        "msg": f"Node '{node_id}' is isolated with no incoming or outgoing edges",
                    }
                )

        graph_json = engine.to_graph_json(
            domain=self.extractor.domain_name,
            source_hash=source_hash,
        )

        # Atomic write to cache file
        temp_cache = cache_file.with_suffix(".tmp")
        with open(temp_cache, "w", encoding="utf-8") as f:
            f.write(graph_json.model_dump_json(by_alias=True, indent=2))
        temp_cache.replace(cache_file)

        return CompileResult(
            domain=self.extractor.domain_name,
            source_hash=source_hash,
            node_count=len(graph_json.nodes),
            edge_count=len(graph_json.edges),
            cache_path=cache_file,
            lint_issues=lint_issues,
            graph_json=graph_json,
        )
