"""MCP Protocol implementation."""

import json
import sys
import asyncio
import logging
from typing import Any, Dict, List, Optional, Callable

from ..tools.base import Tool

# Configure logging to stderr (stdout is for protocol)
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger("mcp")


# JSON-RPC 2.0 Error Codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class MCPError(Exception):
    """MCP Protocol error."""

    def __init__(self, code: int, message: str, data: Any = None):
        self.code = code
        self.message = message
        self.data = data
        super().__init__(message)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-RPC error object."""
        error = {"code": self.code, "message": self.message}
        if self.data is not None:
            error["data"] = self.data
        return error


class MCPProtocol:
    """MCP Protocol handler."""

    def __init__(self):
        self.tools: Dict[str, Tool] = {}
        self.initialized = False
        self._running = False

    def register_tool(self, tool: Tool) -> None:
        """Register a tool."""
        self.tools[tool.name] = tool
        logger.debug(f"Registered tool: {tool.name}")

    def unregister_tool(self, name: str) -> bool:
        """Unregister a tool."""
        if name in self.tools:
            del self.tools[name]
            return True
        return False

    def list_tools(self) -> Dict[str, Any]:
        """Handle tools/list request."""
        tools_list = [tool.to_dict() for tool in self.tools.values()]
        return {"tools": tools_list}

    async def call_tool(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tools/call request."""
        name = params.get("name")
        arguments = params.get("arguments", {})

        if not name:
            raise MCPError(INVALID_PARAMS, "Missing tool name")

        tool = self.tools.get(name)
        if not tool:
            raise MCPError(METHOD_NOT_FOUND, f"Tool not found: {name}")

        try:
            result = await tool.execute(**arguments)
            return {
                "content": [
                    {"type": "text", "text": json.dumps(result)}
                ]
            }
        except Exception as e:
            logger.error(f"Tool execution failed: {e}")
            raise MCPError(INTERNAL_ERROR, str(e))

    async def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a JSON-RPC request."""
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})

        logger.debug(f"Handling request: {method}")

        try:
            if method == "initialize":
                result = self._handle_initialize(params)
            elif method == "tools/list":
                result = self.list_tools()
            elif method == "tools/call":
                result = await self.call_tool(params)
            elif method == "shutdown":
                result = self._handle_shutdown()
            else:
                raise MCPError(METHOD_NOT_FOUND, f"Unknown method: {method}")

            return self._make_response(request_id, result)

        except MCPError as e:
            return self._make_error_response(request_id, e)
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            error = MCPError(INTERNAL_ERROR, str(e))
            return self._make_error_response(request_id, error)

    def _handle_initialize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle initialize request."""
        self.initialized = True
        logger.info("MCP Server initialized")
        return {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "mcp-server",
                "version": "0.1.0"
            }
        }

    def _handle_shutdown(self) -> Dict[str, Any]:
        """Handle shutdown request."""
        self._running = False
        logger.info("MCP Server shutting down")
        return {}

    def _make_response(
        self, request_id: Any, result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create a JSON-RPC success response."""
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result
        }

    def _make_error_response(
        self, request_id: Any, error: MCPError
    ) -> Dict[str, Any]:
        """Create a JSON-RPC error response."""
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": error.to_dict()
        }

    async def run_async(self) -> None:
        """Run the server asynchronously (stdio mode)."""
        self._running = True
        logger.info("MCP Server starting (async)")

        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await asyncio.get_event_loop().connect_read_pipe(
            lambda: protocol, sys.stdin
        )

        while self._running:
            try:
                line = await reader.readline()
                if not line:
                    break

                line_str = line.decode('utf-8').strip()
                if not line_str:
                    continue

                request = json.loads(line_str)
                response = await self.handle_request(request)
                output = json.dumps(response) + '\n'
                sys.stdout.write(output)
                sys.stdout.flush()

            except json.JSONDecodeError as e:
                error = MCPError(PARSE_ERROR, str(e))
                response = self._make_error_response(None, error)
                sys.stdout.write(json.dumps(response) + '\n')
                sys.stdout.flush()
            except Exception as e:
                logger.error(f"Error in run loop: {e}")
                break

        logger.info("MCP Server stopped")

    def run(self) -> None:
        """Run the server synchronously (stdio mode)."""
        self._running = True
        logger.info("MCP Server starting")

        while self._running:
            try:
                line = sys.stdin.readline()
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                request = json.loads(line)
                response = asyncio.run(self.handle_request(request))
                sys.stdout.write(json.dumps(response) + '\n')
                sys.stdout.flush()

            except json.JSONDecodeError as e:
                error = MCPError(PARSE_ERROR, str(e))
                response = self._make_error_response(None, error)
                sys.stdout.write(json.dumps(response) + '\n')
                sys.stdout.flush()
            except Exception as e:
                logger.error(f"Error in run loop: {e}")
                break

        logger.info("MCP Server stopped")
