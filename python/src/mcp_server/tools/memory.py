"""Memory tools for MCP Server."""

import json
import os
import secrets
import string
from datetime import datetime
from typing import Any, Dict, List, Optional

from .base import Tool


def generate_memory_id() -> str:
    """Generate a memory ID (format: mem_<alphanumeric>)."""
    chars = string.ascii_letters + string.digits
    random_part = ''.join(secrets.choice(chars) for _ in range(12))
    return f"mem_{random_part}"


class MemoryWriteTool(Tool):
    """Write content to memory store."""

    def __init__(self, data_dir: str = "data"):
        self.data_dir = data_dir
        self.items_dir = os.path.join(data_dir, "memory", "shared", "items")
        self.index_dir = os.path.join(data_dir, "memory", "shared", "index")

    @property
    def name(self) -> str:
        return "memory.write"

    @property
    def description(self) -> str:
        return "Write a memory item to the memory store"

    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The content to remember"
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional tags for categorization"
                }
            },
            "required": ["content"]
        }

    async def execute(
        self,
        content: str,
        tags: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Write memory item to storage."""
        if not content:
            raise ValueError("content is required")

        memory_id = generate_memory_id()
        now = datetime.utcnow().isoformat() + "Z"

        item = {
            "id": memory_id,
            "created_at": now,
            "updated_at": now,
            "content": content,
            "keywords": tags or [],
        }

        # Ensure directories exist
        os.makedirs(self.items_dir, exist_ok=True)
        os.makedirs(self.index_dir, exist_ok=True)

        # Write item file
        item_path = os.path.join(self.items_dir, f"{memory_id}.json")
        with open(item_path, "w", encoding="utf-8") as f:
            json.dump(item, f, indent=2)

        # Update keyword index
        await self._update_keyword_index(item)

        return {"memory_id": memory_id, "success": True}

    async def _update_keyword_index(self, item: Dict[str, Any]) -> None:
        """Update the keyword index with new item."""
        index_path = os.path.join(self.index_dir, "keyword.json")

        # Load existing index
        index: Dict[str, List[str]] = {}
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                index = json.load(f)

        # Extract keywords
        keywords = self._extract_keywords(item)

        # Add item to index
        for keyword in keywords:
            if keyword not in index:
                index[keyword] = []
            if item["id"] not in index[keyword]:
                index[keyword].append(item["id"])

        # Save index atomically
        temp_path = index_path + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2)
        os.replace(temp_path, index_path)

    def _extract_keywords(self, item: Dict[str, Any]) -> List[str]:
        """Extract keywords from memory item."""
        keywords = set()

        # Add explicit keywords
        for kw in item.get("keywords", []):
            keywords.add(kw.lower())

        # Extract words from content
        content = item.get("content", "")
        words = content.lower().split()
        for word in words:
            # Clean word
            cleaned = ''.join(c for c in word if c.isalnum())
            if len(cleaned) >= 3:
                keywords.add(cleaned)

        return list(keywords)


class MemorySearchTool(Tool):
    """Search memory items by keyword."""

    def __init__(self, data_dir: str = "data"):
        self.data_dir = data_dir
        self.items_dir = os.path.join(data_dir, "memory", "shared", "items")
        self.index_dir = os.path.join(data_dir, "memory", "shared", "index")

    @property
    def name(self) -> str:
        return "memory.search"

    @property
    def description(self) -> str:
        return "Search for memories by keyword"

    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return",
                    "default": 5
                }
            },
            "required": ["query"]
        }

    async def execute(self, query: str, top_k: int = 5) -> Dict[str, Any]:
        """Search memory items by keyword."""
        if not query or not query.strip():
            return {"results": [], "count": 0}

        query_lower = query.lower()
        matching_ids: set = set()

        # Load keyword index
        index_path = os.path.join(self.index_dir, "keyword.json")
        index: Dict[str, List[str]] = {}
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                index = json.load(f)

        # Search index for matching keywords
        for keyword, ids in index.items():
            if query_lower in keyword:
                for item_id in ids:
                    matching_ids.add(item_id)

        # Load matching items
        results = []
        for item_id in list(matching_ids)[:top_k]:
            item = self._load_item(item_id)
            if item:
                results.append({
                    "id": item["id"],
                    "content": item["content"],
                    "keywords": item.get("keywords", []),
                })

        return {"results": results, "count": len(results)}

    def _load_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Load a memory item by ID."""
        item_path = os.path.join(self.items_dir, f"{item_id}.json")
        if not os.path.exists(item_path):
            return None
        with open(item_path, "r", encoding="utf-8") as f:
            return json.load(f)


class MemoryGetTool(Tool):
    """Get a specific memory by ID."""

    def __init__(self, data_dir: str = "data"):
        self.data_dir = data_dir
        self.items_dir = os.path.join(data_dir, "memory", "shared", "items")

    @property
    def name(self) -> str:
        return "memory.get"

    @property
    def description(self) -> str:
        return "Get a specific memory by ID"

    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "description": "The memory ID"
                }
            },
            "required": ["memory_id"]
        }

    async def execute(self, memory_id: str) -> Dict[str, Any]:
        """Get a memory item by ID."""
        if not memory_id:
            raise ValueError("memory_id is required")

        item_path = os.path.join(self.items_dir, f"{memory_id}.json")

        if not os.path.exists(item_path):
            return {"memory": None}

        with open(item_path, "r", encoding="utf-8") as f:
            item = json.load(f)

        return {"memory": item}
