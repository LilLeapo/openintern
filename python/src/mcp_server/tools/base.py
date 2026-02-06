"""Base class for MCP tools."""

from abc import ABC, abstractmethod
from typing import Any, Dict


class Tool(ABC):
    """Abstract base class for MCP tools."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Tool name (e.g., 'memory.write')."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Tool description for LLM."""
        pass

    @property
    @abstractmethod
    def parameters(self) -> Dict[str, Any]:
        """JSON Schema for tool parameters."""
        pass

    @abstractmethod
    async def execute(self, **kwargs: Any) -> Any:
        """Execute the tool with given parameters."""
        pass

    def to_dict(self) -> Dict[str, Any]:
        """Convert tool to dictionary for tools/list response."""
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.parameters,
        }
