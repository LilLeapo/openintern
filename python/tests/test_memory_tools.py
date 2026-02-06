"""Tests for Memory tools."""

import pytest
import os
import json
import tempfile
import shutil
from mcp_server.tools.memory import (
    MemoryWriteTool,
    MemorySearchTool,
    MemoryGetTool,
    generate_memory_id,
)


@pytest.fixture
def temp_data_dir():
    """Create a temporary data directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)


class TestGenerateMemoryId:
    """Tests for memory ID generation."""

    def test_format(self):
        """Test ID format."""
        mem_id = generate_memory_id()
        assert mem_id.startswith("mem_")
        assert len(mem_id) == 16  # mem_ + 12 chars

    def test_uniqueness(self):
        """Test IDs are unique."""
        ids = [generate_memory_id() for _ in range(100)]
        assert len(set(ids)) == 100


class TestMemoryWriteTool:
    """Tests for MemoryWriteTool."""

    @pytest.mark.asyncio
    async def test_write_memory(self, temp_data_dir):
        """Test writing memory item."""
        tool = MemoryWriteTool(temp_data_dir)
        result = await tool.execute(
            content="Test content",
            tags=["test", "example"]
        )
        assert result["success"] is True
        assert "memory_id" in result

    @pytest.mark.asyncio
    async def test_creates_file(self, temp_data_dir):
        """Test file is created."""
        tool = MemoryWriteTool(temp_data_dir)
        result = await tool.execute(content="Test")
        mem_id = result["memory_id"]

        item_path = os.path.join(
            temp_data_dir, "memory", "shared", "items",
            f"{mem_id}.json"
        )
        assert os.path.exists(item_path)


class TestMemorySearchTool:
    """Tests for MemorySearchTool."""

    @pytest.mark.asyncio
    async def test_search_empty(self, temp_data_dir):
        """Test search with no items."""
        tool = MemorySearchTool(temp_data_dir)
        result = await tool.execute(query="test")
        assert result["count"] == 0
        assert result["results"] == []

    @pytest.mark.asyncio
    async def test_search_finds_item(self, temp_data_dir):
        """Test search finds written item."""
        write_tool = MemoryWriteTool(temp_data_dir)
        await write_tool.execute(content="Hello world")

        search_tool = MemorySearchTool(temp_data_dir)
        result = await search_tool.execute(query="hello")
        assert result["count"] >= 1


class TestMemoryGetTool:
    """Tests for MemoryGetTool."""

    @pytest.mark.asyncio
    async def test_get_nonexistent(self, temp_data_dir):
        """Test getting non-existent item."""
        tool = MemoryGetTool(temp_data_dir)
        result = await tool.execute(memory_id="mem_nonexistent")
        assert result["memory"] is None

    @pytest.mark.asyncio
    async def test_get_existing(self, temp_data_dir):
        """Test getting existing item."""
        write_tool = MemoryWriteTool(temp_data_dir)
        write_result = await write_tool.execute(content="Test")
        mem_id = write_result["memory_id"]

        get_tool = MemoryGetTool(temp_data_dir)
        result = await get_tool.execute(memory_id=mem_id)
        assert result["memory"] is not None
        assert result["memory"]["content"] == "Test"
