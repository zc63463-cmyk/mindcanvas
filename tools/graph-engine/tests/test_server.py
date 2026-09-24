import tempfile
from pathlib import Path
import server
from extractors.forgejo import ForgejoMetallurgyExtractor
from compiler.pipeline import GraphCompiler

DOC_A = """---
id: rolle-theorem
title: 罗尔定理
level: L0
type: theorem
---
"""

DOC_B = """---
id: lagrange-mvt
title: 拉格朗日中值定理
level: L0
type: theorem
calls_core:
  - rolle-theorem
---
"""

DOC_C = """---
id: cauchy-mvt
title: 柯西中值定理
level: L0
type: theorem
calls_core:
  - lagrange-mvt
guardrails:
  - "g'(x) != 0"
---
"""


def test_server_tools():
    with tempfile.TemporaryDirectory() as tmp_src, tempfile.TemporaryDirectory() as tmp_cache:
        src_path = Path(tmp_src)
        cache_path = Path(tmp_cache)

        (src_path / "rolle.md").write_text(DOC_A, encoding="utf-8")
        (src_path / "lagrange.md").write_text(DOC_B, encoding="utf-8")
        (src_path / "cauchy.md").write_text(DOC_C, encoding="utf-8")

        # Point server CACHE_DIR to temporary cache
        server.CACHE_DIR = cache_path
        server._LOADED_ENGINES.clear()

        # 1. Test compile_graph
        compile_res = server.compile_graph(str(src_path), domain="math")
        assert compile_res["status"] == "success"
        assert compile_res["node_count"] == 3

        # 2. Test inspect_node_chain
        chain = server.inspect_node_chain("cauchy-mvt", domain="math")
        assert chain["node"]["id"] == "cauchy-mvt"
        assert "lagrange-mvt" in chain["ancestors"]
        assert "rolle-theorem" in chain["ancestors"]
        assert chain["guardrails"] == ["g'(x) != 0"]

        # 3. Test detect_cascade_drift
        drift = server.detect_cascade_drift("rolle-theorem", domain="math")
        assert drift["target"] == "rolle-theorem"
        assert drift["affected_count"] == 2
        affected_ids = {n["id"] for n in drift["affected_nodes"]}
        assert affected_ids == {"lagrange-mvt", "cauchy-mvt"}
        by_id = {n["id"]: n["distance"] for n in drift["affected_nodes"]}
        assert by_id["lagrange-mvt"] == 1
        assert by_id["cauchy-mvt"] == 2

        # 4. Test check_proof_path
        path_res = server.check_proof_path(["rolle-theorem"], "cauchy-mvt", domain="math")
        assert path_res["reachable"] is True
        assert path_res["path"] == ["rolle-theorem", "lagrange-mvt", "cauchy-mvt"]


def test_compile_resolves_cache_from_source_dir_without_cwd_dependency():
    """FIX-001: compile_graph without explicit cache_dir must resolve to
    <source_dir>/.engine/cache and be immediately readable by read-only tools,
    regardless of the process CWD (no monkeypatching CACHE_DIR)."""
    with tempfile.TemporaryDirectory() as tmp_src:
        src_path = Path(tmp_src)
        (src_path / "rolle.md").write_text(DOC_A, encoding="utf-8")
        (src_path / "lagrange.md").write_text(DOC_B, encoding="utf-8")
        (src_path / "cauchy.md").write_text(DOC_C, encoding="utf-8")

        saved_cache = server.CACHE_DIR
        server._LOADED_ENGINES.clear()
        try:
            res = server.compile_graph(str(src_path), domain="math")
            assert res["status"] == "success"
            assert (src_path / ".engine" / "cache" / "math.graph.json").exists()
            chain = server.inspect_node_chain("cauchy-mvt", domain="math")
            assert chain["node"]["id"] == "cauchy-mvt"
        finally:
            server.CACHE_DIR = saved_cache
            server._LOADED_ENGINES.clear()
