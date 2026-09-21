from typing import Literal, Optional, Any
from pydantic import BaseModel, Field


class CycleDetectedError(Exception):
    """Raised when a directed cycle is detected in a DAG."""
    def __init__(self, cycle: list[str]):
        super().__init__(f"Cycle detected in graph: {' -> '.join(cycle)}")
        self.cycle = cycle


class RawNode(BaseModel):
    id: str = Field(description="Unique node identifier")
    label: str = Field(description="Human-readable title/label")
    domain: str = Field(default="default", description="Domain/subject")
    level: Optional[str] = Field(default=None, description="Level e.g. L0, L1, L2")
    kind: str = Field(default="concept", description="Entity kind")
    file_path: Optional[str] = Field(default=None, description="Source file relative path")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Custom metadata e.g. guardrails")


class RawEdge(BaseModel):
    from_id: str = Field(description="Source node ID")
    to_id: str = Field(description="Target node ID")
    kind: str = Field(description="Edge relation type e.g. calls_core, blocks")
    direction: Literal["fwd", "back", "both"] = Field(default="fwd", description="Visual direction")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Edge metadata")


class GraphIndices(BaseModel):
    descendants: dict[str, list[str]] = Field(default_factory=dict, description="Downstream closures")
    ancestors: dict[str, list[str]] = Field(default_factory=dict, description="Upstream closures")
    in_degree: dict[str, int] = Field(default_factory=dict, description="In-degree counts")
    topological_order: list[str] = Field(default_factory=list, description="Topological sort order")


class ExportedNode(BaseModel):
    id: str
    label: str
    level: Optional[str] = None
    kind: str
    file_path: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExportedEdge(BaseModel):
    from_node: str = Field(alias="from")
    to_node: str = Field(alias="to")
    kind: str
    direction: Literal["fwd", "back", "both"] = "fwd"
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class GraphJson(BaseModel):
    version: str = "1.0.0"
    domain: str
    source_hash: str
    nodes: list[ExportedNode]
    edges: list[ExportedEdge]
    indices: GraphIndices

    model_config = {"populate_by_name": True}
