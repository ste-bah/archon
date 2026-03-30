"""Adapter bridging the async memorygraph SDK to our sync interface.

The personality modules use a simple sync interface (store_memory, get_memory,
list_by_type, search_memories). The production MemoryGraph backend is async
with a different API (Memory model, MemoryType enum, SearchQuery).

This adapter translates between the two.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


class MemoryGraphAdapter:
    """Sync adapter over the async memorygraph.MemoryDatabase.

    Implements the same interface as MockMemoryGraph from conftest.py.

    Args:
        db: An instance of memorygraph.MemoryDatabase (already initialized).
    """

    def __init__(self, db: Any):
        self._db = db

    def _run(self, coro):
        """Run an async coroutine synchronously."""
        try:
            asyncio.get_running_loop()
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result(timeout=5)
        except RuntimeError:
            return asyncio.run(coro)

    @staticmethod
    def _node_tag(name: str) -> str:
        """Return the canonical lookup tag for a memory name."""
        return f"node:{name}"

    def store_memory(
        self,
        name: str,
        memory_type: str,
        content: str,
        importance: float = 0.5,
        tags: list[str] | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Store a memory node using the memorygraph Memory model."""
        from memorygraph.models import Memory, MemoryType

        # Map string type to MemoryType enum (default to 'general')
        try:
            mem_type = MemoryType(memory_type.lower())
        except (ValueError, KeyError):
            mem_type = MemoryType.GENERAL

        # Ensure the node:<name> tag is always present for reliable retrieval
        all_tags = list(tags or [])
        node_tag = self._node_tag(name)
        if node_tag not in all_tags:
            all_tags.append(node_tag)

        now = datetime.now(timezone.utc)
        try:
            memory = Memory(
                type=mem_type,
                title=name[:200],  # title max 200 chars
                content=content,
                tags=all_tags,
                importance=importance,
                created_at=now,
                updated_at=now,
            )
            result = self._run(self._db.store_memory(memory))
            return {"success": True, "name": name}
        except Exception as e:
            logger.warning("MemoryGraphAdapter.store_memory failed: %s", e)
            return {"success": False, "name": name}

    def get_memory(self, name: str) -> dict | None:
        """Retrieve a memory by its node tag (reliable for hyphenated names)."""
        from memorygraph.models import SearchQuery

        try:
            node_tag = self._node_tag(name)
            results = self._run(self._db.search_memories(
                SearchQuery(tags=[node_tag], limit=5),
            ))
            # Tag filtering should be exact, but verify title as a safeguard
            for r in results:
                r_tags = list(getattr(r, "tags", []) or [])
                title = getattr(r, "title", "")
                if node_tag in r_tags or title == name:
                    return {
                        "name": title,
                        "content": getattr(r, "content", ""),
                        "type": str(getattr(r, "type", "")),
                        "tags": r_tags,
                        "importance": getattr(r, "importance", 0.5),
                    }
        except Exception as e:
            logger.warning("MemoryGraphAdapter.get_memory failed: %s", e)
        return None

    def list_by_type(self, memory_type: str) -> list[dict]:
        """List all memories of a given type using MemoryType filter."""
        from memorygraph.models import MemoryType, SearchQuery

        try:
            mem_type = MemoryType(memory_type.lower())
        except (ValueError, KeyError):
            mem_type = MemoryType.GENERAL

        try:
            results = self._run(self._db.search_memories(
                SearchQuery(memory_types=[mem_type], limit=100),
            ))
            output = []
            for r in results:
                r_tags = list(getattr(r, "tags", []) or [])
                # Only include results that have a node: tag (our memories)
                if not any(t.startswith("node:") for t in r_tags):
                    continue
                output.append({
                    "name": getattr(r, "title", ""),
                    "content": getattr(r, "content", ""),
                    "type": str(getattr(r, "type", "")),
                    "tags": r_tags,
                })
            return output
        except Exception as e:
            logger.warning("MemoryGraphAdapter.list_by_type failed: %s", e)
            return []

    def search_memories(
        self,
        query: str,
        memory_type: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Search memories by keyword."""
        from memorygraph.models import SearchQuery

        try:
            results = self._run(self._db.search_memories(
                SearchQuery(query=query, limit=limit),
            ))
            output = []
            for r in results:
                r_tags = list(getattr(r, "tags", []) or [])
                if tags and not any(t in r_tags for t in tags):
                    continue
                output.append({
                    "name": getattr(r, "title", ""),
                    "content": getattr(r, "content", ""),
                    "type": str(getattr(r, "type", "")),
                    "tags": r_tags,
                })
            return output[:limit]
        except Exception as e:
            logger.warning("MemoryGraphAdapter.search_memories failed: %s", e)
            return []
