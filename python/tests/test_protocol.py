"""Tests for MCP Protocol."""

import pytest
import json
from mcp_server.protocol.mcp import (
    MCPProtocol,
    MCPError,
    PARSE_ERROR,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    INVALID_PARAMS,
    INTERNAL_ERROR,
)
from mcp_server.tools.base import Tool
from typing import Any, Dict


class MockTool(Tool):
    """Mock tool for testing."""

    @property
    def name(self) -> str:
        return "mock.tool"

    @property
    def description(self) -> str:
        return "A mock tool for testing"

    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "value": {"type": "string"}
            },
            "required": ["value"]
        }

    async def execute(self, value: str) -> Dict[str, Any]:
        return {"echoed": value}


class FailingTool(Tool):
    """Tool that always fails."""

    @property
    def name(self) -> str:
        return "failing.tool"

    @property
    def description(self) -> str:
        return "A tool that always fails"

    @property
    def parameters(self) -> Dict[str, Any]:
        return {"type": "object", "properties": {}}

    async def execute(self) -> Dict[str, Any]:
        raise ValueError("Tool failed")


class TestMCPError:
    """Tests for MCPError class."""

    def test_error_creation(self):
        """Test error creation."""
        error = MCPError(INVALID_PARAMS, "Test error")
        assert error.code == INVALID_PARAMS
        assert error.message == "Test error"
        assert error.data is None

    def test_error_with_data(self):
        """Test error with data."""
        error = MCPError(INTERNAL_ERROR, "Error", {"key": "value"})
        assert error.data == {"key": "value"}

    def test_error_to_dict(self):
        """Test error to dict conversion."""
        error = MCPError(PARSE_ERROR, "Parse failed")
        result = error.to_dict()
        assert result["code"] == PARSE_ERROR
        assert result["message"] == "Parse failed"


class TestMCPProtocol:
    """Tests for MCPProtocol class."""

    def test_register_tool(self):
        """Test tool registration."""
        protocol = MCPProtocol()
        tool = MockTool()
        protocol.register_tool(tool)
        assert "mock.tool" in protocol.tools

    def test_unregister_tool(self):
        """Test tool unregistration."""
        protocol = MCPProtocol()
        tool = MockTool()
        protocol.register_tool(tool)
        result = protocol.unregister_tool("mock.tool")
        assert result is True
        assert "mock.tool" not in protocol.tools

    def test_list_tools(self):
        """Test listing tools."""
        protocol = MCPProtocol()
        tool = MockTool()
        protocol.register_tool(tool)
        result = protocol.list_tools()
        assert "tools" in result
        assert len(result["tools"]) == 1
        assert result["tools"][0]["name"] == "mock.tool"

    @pytest.mark.asyncio
    async def test_handle_initialize(self):
        """Test initialize request."""
        protocol = MCPProtocol()
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }
        response = await protocol.handle_request(request)
        assert response["id"] == 1
        assert "result" in response
        assert protocol.initialized is True

    @pytest.mark.asyncio
    async def test_handle_tools_list(self):
        """Test tools/list request."""
        protocol = MCPProtocol()
        protocol.register_tool(MockTool())
        request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }
        response = await protocol.handle_request(request)
        assert response["id"] == 2
        assert "result" in response
        assert len(response["result"]["tools"]) == 1

    @pytest.mark.asyncio
    async def test_handle_tools_call(self):
        """Test tools/call request."""
        protocol = MCPProtocol()
        protocol.register_tool(MockTool())
        request = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "mock.tool",
                "arguments": {"value": "test"}
            }
        }
        response = await protocol.handle_request(request)
        assert response["id"] == 3
        assert "result" in response

    @pytest.mark.asyncio
    async def test_handle_unknown_method(self):
        """Test unknown method returns error."""
        protocol = MCPProtocol()
        request = {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "unknown/method",
            "params": {}
        }
        response = await protocol.handle_request(request)
        assert "error" in response
        assert response["error"]["code"] == METHOD_NOT_FOUND

    @pytest.mark.asyncio
    async def test_tool_not_found(self):
        """Test calling non-existent tool."""
        protocol = MCPProtocol()
        request = {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {"name": "nonexistent"}
        }
        response = await protocol.handle_request(request)
        assert "error" in response
