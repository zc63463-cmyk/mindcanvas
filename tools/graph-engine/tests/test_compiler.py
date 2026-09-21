import tempfile
from pathlib import Path
from extractors.forgejo import ForgejoMetallurgyExtractor
from compiler.pipeline import GraphCompiler

DOC_A = """---
id: rolle-theorem
title: 罗尔定理
level: L0
type: theorem
---
# 罗尔定理
"""

DOC_B = """---
id: lagrange-mvt
title: 拉格朗日中值定理
level: L0
type: theorem
calls_core:
  - rolle-theorem
---
# 拉格朗日中值定理
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
# 柯西中值定理
"""


def test_compiler_end_to_end():
    with tempfile.TemporaryDirectory() as tmp_src, tempfile.TemporaryDirectory() as tmp_cache:
        src_path = Path(tmp_src)
        cache_path = Path(tmp_cache)

        (src_path / "rolle.md").write_text(DOC_A, encoding="utf-8")
        (src_path / "lagrange.md").write_text(DOC_B, encoding="utf-8")
        (src_path / "cauchy.md").write_text(DOC_C, encoding="utf-8")

        extractor = ForgejoMetallurgyExtractor(domain="math")
        compiler = GraphCompiler(extractor=extractor, cache_dir=cache_path)

        # 1. First compile
        res1 = compiler.compile(src_path)
        assert res1.node_count == 3
        assert res1.edge_count == 2
        assert res1.cache_path.exists()

        # 2. Re-compile without changes should hit cache
        res2 = compiler.compile(src_path)
        assert res2.source_hash == res1.source_hash
        assert res2.node_count == 3

        # 3. Add a new file and re-compile
        DOC_D = """---
id: taylor-expansion
title: 泰勒公式
level: L1
calls_core:
  - cauchy-mvt
---
# 泰勒公式
"""
        (src_path / "taylor.md").write_text(DOC_D, encoding="utf-8")
        res3 = compiler.compile(src_path)
        assert res3.node_count == 4
        assert res3.edge_count == 3
        assert res3.source_hash != res1.source_hash
