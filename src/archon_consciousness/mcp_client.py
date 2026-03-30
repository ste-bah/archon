"""Abstraction layer over MemoryGraph MCP tools.

Provides a typed interface that wraps the raw MCP tool calls. In production,
the caller invokes actual MCP tools. In tests, a MockMemoryGraph is injected.

This layer handles:
- Serialization/deserialization of schema objects
- Name generation for MemoryGraph nodes
- Tag management for consciousness nodes
- Relationship creation with typed properties
"""

import json
from typing import Any, Callable, Optional

from src.archon_consciousness.constants import CONSCIOUSNESS_TAG


class MemoryGraphClient:
    """Typed wrapper around MemoryGraph MCP tool calls.

    Args:
        backend: Object implementing store_memory, get_memory, update_memory,
                 delete_memory, search_memories, create_relationship,
                 get_related_memories methods. In tests, use MockMemoryGraph.
    """

    def __init__(self, backend: Any):
        self._backend = backend

    def store(
        self,
        name: str,
        memory_type: str,
        content: str,
        importance: float = 0.5,
        tags: list[str] | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Store a memory node."""
        return self._backend.store_memory(
            name=name,
            memory_type=memory_type,
            content=content,
            importance=importance,
            tags=tags or [CONSCIOUSNESS_TAG],
            metadata=metadata,
        )

    def get(self, name: str) -> dict | None:
        """Retrieve a memory by exact name. Returns None if not found."""
        return self._backend.get_memory(name)

    def update(self, name: str, **kwargs) -> dict:
        """Partial update of a memory's fields."""
        return self._backend.update_memory(name, **kwargs)

    def delete(self, name: str) -> dict:
        """Remove a memory by name."""
        return self._backend.delete_memory(name)

    def search(
        self,
        query: str,
        memory_type: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Search memories by keyword."""
        return self._backend.search_memories(
            query=query,
            memory_type=memory_type,
            tags=tags,
            limit=limit,
        )

    def list_by_type(self, memory_type: str) -> list[dict]:
        """List all memories of a given type."""
        return self._backend.list_by_type(memory_type)

    def create_relationship(
        self,
        source: str,
        target: str,
        relationship_type: str,
        properties: dict | None = None,
    ) -> dict:
        """Create a directed edge between two memories."""
        return self._backend.create_relationship(
            source=source,
            target=target,
            relationship_type=relationship_type,
            properties=properties,
        )

    def get_related(
        self,
        name: str,
        relationship_type: str | None = None,
        direction: str = "outgoing",
    ) -> list[dict]:
        """Get memories connected by relationships."""
        return self._backend.get_related_memories(
            name=name,
            relationship_type=relationship_type,
            direction=direction,
        )

    def store_from_schema(self, schema_obj: Any) -> dict:
        """Store a schema object (Episode, PatternScore, etc.) using its
        to_memorygraph_params() method."""
        params = schema_obj.to_memorygraph_params()
        return self.store(
            name=params["name"],
            memory_type=params["memory_type"],
            content=params["content"],
            importance=params.get("importance", 0.5),
            tags=params.get("tags", [CONSCIOUSNESS_TAG]),
        )

    def get_and_deserialize(self, name: str, schema_cls: type) -> Any | None:
        """Retrieve a memory and deserialize to a schema object."""
        mem = self.get(name)
        if mem is None:
            return None
        content = json.loads(mem["content"])
        return schema_cls.from_dict(content)
