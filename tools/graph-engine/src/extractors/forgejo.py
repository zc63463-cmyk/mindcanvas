import re
import yaml
from pathlib import Path
from typing import Any
from extractors.base import BaseDomainExtractor
from core.models import RawNode, RawEdge

FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


class ForgejoMetallurgyExtractor(BaseDomainExtractor):
    """Extractor for Forgejo cognitive metallurgy notes (YAML frontmatter)."""

    def __init__(self, domain: str = "math"):
        self._domain = domain

    @property
    def domain_name(self) -> str:
        return self._domain

    def extract_from_content(
        self, content: str, file_path: str
    ) -> tuple[list[RawNode], list[RawEdge]]:
        match = FRONTMATTER_PATTERN.match(content)
        if not match:
            return [], []

        raw_yaml = match.group(1)
        try:
            data = yaml.safe_load(raw_yaml)
        except Exception:
            return [], []

        if not isinstance(data, dict):
            return [], []

        # 1. Resolve Node ID
        stem = Path(file_path).stem
        node_id = str(data.get("id") or stem).strip()
        label = str(data.get("title") or data.get("label") or stem).strip()
        level = data.get("level")
        kind = str(data.get("type") or "concept").strip()

        # Metadata including guardrails
        metadata: dict[str, Any] = {}
        if "guardrails" in data and isinstance(data["guardrails"], list):
            metadata["guardrails"] = [str(g).strip() for g in data["guardrails"]]

        node = RawNode(
            id=node_id,
            label=label,
            domain=self._domain,
            level=str(level) if level is not None else None,
            kind=kind,
            file_path=file_path,
            metadata=metadata,
        )

        edges: list[RawEdge] = []

        # Helper to safely parse string or list
        def get_id_list(key: str) -> list[str]:
            val = data.get(key)
            if not val:
                return []
            if isinstance(val, list):
                return [str(item).strip() for item in val if item]
            return [str(val).strip()]

        # 2. Dependencies / calls_core
        for prereq in get_id_list("prerequisites") + get_id_list("calls_core"):
            edges.append(
                RawEdge(from_id=prereq, to_id=node_id, kind="calls_core", direction="fwd")
            )

        # 3. Implements
        for target in get_id_list("implements"):
            edges.append(
                RawEdge(from_id=node_id, to_id=target, kind="implements", direction="fwd")
            )

        # 4. Subsumes
        for target in get_id_list("subsumes"):
            edges.append(
                RawEdge(from_id=node_id, to_id=target, kind="subsumes", direction="fwd")
            )

        # 5. Twins (symmetric)
        for twin in get_id_list("twins"):
            edges.append(
                RawEdge(from_id=node_id, to_id=twin, kind="twin", direction="both")
            )

        # 6. Fractures
        for fracture in get_id_list("fractures"):
            edges.append(
                RawEdge(from_id=node_id, to_id=fracture, kind="fracture", direction="fwd")
            )

        return [node], edges
