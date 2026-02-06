"""MCP Server main entry point."""

import os
import sys
import logging

from .protocol.mcp import MCPProtocol
from .tools.memory import (
    MemoryWriteTool,
    MemorySearchTool,
    MemoryGetTool,
)

logger = logging.getLogger("mcp.server")


class MCPServer:
    """MCP Server for Agent System."""

    def __init__(self, data_dir: str = "data"):
        """Initialize MCP Server.

        Args:
            data_dir: Base directory for data storage.
        """
        self.data_dir = data_dir
        self.protocol = MCPProtocol()
        self._register_tools()

    def _register_tools(self) -> None:
        """Register all available tools."""
        # Memory tools
        self.protocol.register_tool(
            MemoryWriteTool(self.data_dir)
        )
        self.protocol.register_tool(
            MemorySearchTool(self.data_dir)
        )
        self.protocol.register_tool(
            MemoryGetTool(self.data_dir)
        )

        logger.info(
            f"Registered {len(self.protocol.tools)} tools"
        )

    def run(self) -> None:
        """Run the server (stdio mode)."""
        self.protocol.run()


def main() -> None:
    """Main entry point."""
    # Get data directory from environment or use default
    data_dir = os.environ.get("MCP_DATA_DIR", "data")

    server = MCPServer(data_dir=data_dir)
    server.run()


if __name__ == "__main__":
    main()
