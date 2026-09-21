from abc import ABC, abstractmethod
from pathlib import Path
from core.models import RawNode, RawEdge


class BaseDomainExtractor(ABC):
    """Abstract interface for domain-specific extractors."""

    @property
    @abstractmethod
    def domain_name(self) -> str:
        """Domain identifier e.g. 'math', 'pomodoro-tasks'."""
        pass

    @abstractmethod
    def extract_from_content(
        self, content: str, file_path: str
    ) -> tuple[list[RawNode], list[RawEdge]]:
        """Extract RawNodes and RawEdges from text content."""
        pass

    def extract_from_file(
        self, file_path: Path | str
    ) -> tuple[list[RawNode], list[RawEdge]]:
        """Helper to read file and extract."""
        path = Path(file_path)
        content = path.read_text(encoding="utf-8", errors="replace")
        return self.extract_from_content(content, str(path))
