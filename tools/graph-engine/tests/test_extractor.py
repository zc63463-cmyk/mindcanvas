from extractors.forgejo import ForgejoMetallurgyExtractor

SAMPLE_DOC = """---
id: cauchy-mvt
title: 柯西中值定理
level: L0
type: theorem
prerequisites:
  - lagrange-mvt
calls_core:
  - rolle-theorem
implements:
  - generalized-mvt
subsumes:
  - mean-value-family
twins:
  - darboux-theorem
fractures:
  - discontinuous-derivative
guardrails:
  - "f, g 在 [a, b] 连续"
  - "g'(x) != 0"
---

# 柯西中值定理
正文内容...
"""


def test_forgejo_extractor():
    extractor = ForgejoMetallurgyExtractor(domain="math")
    nodes, edges = extractor.extract_from_content(SAMPLE_DOC, "math/cauchy.md")

    assert len(nodes) == 1
    node = nodes[0]
    assert node.id == "cauchy-mvt"
    assert node.label == "柯西中值定理"
    assert node.level == "L0"
    assert node.kind == "theorem"
    assert len(node.metadata["guardrails"]) == 2

    # Edges: 2 calls_core (lagrange-mvt, rolle-theorem), 1 implements, 1 subsumes, 1 twin, 1 fracture
    assert len(edges) == 6

    kinds = {e.kind: e for e in edges}
    assert "calls_core" in kinds
    assert "implements" in kinds
    assert "subsumes" in kinds
    assert "twin" in kinds
    assert "fracture" in kinds
