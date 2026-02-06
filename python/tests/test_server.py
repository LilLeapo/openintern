"""Tests for MCP Server."""

import pytest
import tempfile
import shutil
from mcp_server.server import MCPServer


@pytest.fixture
def temp_data_dir():
    """Create a temporary data directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)


class TestMCPServer:
    """Tests for MCPServer class."""

    def test_server_creation(self, temp_data_dir):
        """Test server can be created."""
        server = MCPServer(data_dir=temp_data_dir)
        assert server is not None

    def test_tools_registered(self, temp_data_dir):
        """Test memory tools are registered."""
        server = MCPServer(data_dir=temp_data_dir)
        tools = server.protocol.list_tools()
        tool_names = [t["name"] for t in tools["tools"]]
        assert "memory.write" in tool_names
        assert "memory.search" in tool_names
        assert "memory.get" in tool_names
