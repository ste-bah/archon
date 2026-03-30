"""Shared fixtures for Archon Consciousness tests.

Provides:
- MockMemoryGraph — faithful in-memory simulation of MemoryGraph MCP
- MockLanceDB — faithful in-memory simulation of LanceDB MCP with
  real cosine similarity on synthetic embeddings

These are NOT stubs; they implement real storage, retrieval, and
search semantics so tests exercise actual data flow.
"""

import copy
import hashlib
import math
import uuid
from datetime import datetime, timezone

import pytest


class MockMemoryGraph:
    """In-memory simulation of MemoryGraph (FalkorDB) via MCP tools.

    Stores memories as dicts keyed by name. Supports relationships
    between memories. Faithfully simulates the MCP tool behavior:
    - store_memory: creates or overwrites a memory
    - get_memory: retrieves by exact name
    - update_memory: partial update of fields
    - delete_memory: removes by name
    - search_memories: keyword search across name, content, tags
    - create_relationship: directed edge between two memories
    - get_related_memories: retrieve neighbors by relationship type
    """

    def __init__(self):
        self.memories: dict[str, dict] = {}
        self.relationships: list[dict] = []
        self.call_log: list[tuple[str, dict]] = []

    def _log(self, method: str, params: dict) -> None:
        self.call_log.append((method, copy.deepcopy(params)))

    def store_memory(
        self,
        name: str,
        memory_type: str,
        content: str,
        importance: float = 0.5,
        tags: list[str] | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Store a memory node. Overwrites if name exists."""
        self._log("store_memory", {
            "name": name, "memory_type": memory_type, "content": content,
            "importance": importance, "tags": tags, "metadata": metadata,
        })
        self.memories[name] = {
            "name": name,
            "type": memory_type,
            "content": content,
            "importance": importance,
            "tags": tags or [],
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"success": True, "name": name}

    def get_memory(self, name: str) -> dict | None:
        """Retrieve a memory by exact name."""
        self._log("get_memory", {"name": name})
        mem = self.memories.get(name)
        if mem is None:
            return None
        return copy.deepcopy(mem)

    def update_memory(self, name: str, **updates) -> dict:
        """Partial update of a memory's fields."""
        self._log("update_memory", {"name": name, **updates})
        if name not in self.memories:
            raise KeyError(f"Memory not found: {name}")
        for key, value in updates.items():
            if key == "name":
                continue  # name is immutable
            self.memories[name][key] = value
        self.memories[name]["updated_at"] = datetime.now(timezone.utc).isoformat()
        return {"success": True, "name": name}

    def delete_memory(self, name: str) -> dict:
        """Remove a memory by name."""
        self._log("delete_memory", {"name": name})
        if name not in self.memories:
            raise KeyError(f"Memory not found: {name}")
        del self.memories[name]
        # Also remove relationships involving this memory
        self.relationships = [
            r for r in self.relationships
            if r["source"] != name and r["target"] != name
        ]
        return {"success": True, "name": name}

    def search_memories(
        self,
        query: str,
        memory_type: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Search memories by keyword match on name, content, and tags."""
        self._log("search_memories", {
            "query": query, "memory_type": memory_type,
            "tags": tags, "limit": limit,
        })
        # NOTE: Uses simple substring matching, not vector similarity.
        # Downstream tasks needing vector search fidelity should use
        # integration tests against real MemoryGraph/LanceDB.
        query_lower = query.lower()
        results = []
        for mem in self.memories.values():
            # Type filter
            if memory_type and mem["type"] != memory_type:
                continue
            # Tag filter
            if tags and not any(t in mem["tags"] for t in tags):
                continue
            # Keyword match on name or content
            if (query_lower in mem["name"].lower()
                    or query_lower in mem["content"].lower()
                    or any(query_lower in t.lower() for t in mem["tags"])):
                results.append(copy.deepcopy(mem))
            if len(results) >= limit:
                break
        return results

    def create_relationship(
        self,
        source: str,
        target: str,
        relationship_type: str,
        properties: dict | None = None,
    ) -> dict:
        """Create a directed edge between two memories."""
        self._log("create_relationship", {
            "source": source, "target": target,
            "relationship_type": relationship_type,
            "properties": properties,
        })
        if source not in self.memories:
            raise KeyError(f"Source memory not found: {source}")
        if target not in self.memories:
            raise KeyError(f"Target memory not found: {target}")
        rel = {
            "source": source,
            "target": target,
            "type": relationship_type,
            "properties": properties or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.relationships.append(rel)
        return {"success": True}

    def get_related_memories(
        self,
        name: str,
        relationship_type: str | None = None,
        direction: str = "outgoing",
    ) -> list[dict]:
        """Get memories connected by relationships."""
        self._log("get_related_memories", {
            "name": name, "relationship_type": relationship_type,
            "direction": direction,
        })
        results = []
        for rel in self.relationships:
            type_match = (relationship_type is None
                          or rel["type"] == relationship_type)
            if not type_match:
                continue

            if direction == "outgoing" and rel["source"] == name:
                mem = self.memories.get(rel["target"])
                if mem:
                    result = copy.deepcopy(mem)
                    result["_relationship"] = copy.deepcopy(rel)
                    results.append(result)
            elif direction == "incoming" and rel["target"] == name:
                mem = self.memories.get(rel["source"])
                if mem:
                    result = copy.deepcopy(mem)
                    result["_relationship"] = copy.deepcopy(rel)
                    results.append(result)
            elif direction == "both":
                if rel["source"] == name:
                    mem = self.memories.get(rel["target"])
                elif rel["target"] == name:
                    mem = self.memories.get(rel["source"])
                else:
                    mem = None
                if mem:
                    result = copy.deepcopy(mem)
                    result["_relationship"] = copy.deepcopy(rel)
                    results.append(result)
        return results

    def list_by_type(self, memory_type: str) -> list[dict]:
        """List all memories of a given type. Convenience method."""
        return [
            copy.deepcopy(mem)
            for mem in self.memories.values()
            if mem["type"] == memory_type
        ]

    def clear(self) -> None:
        """Reset all state. For test isolation."""
        self.memories.clear()
        self.relationships.clear()
        self.call_log.clear()


class MockLanceDB:
    """In-memory simulation of LanceDB MCP for vector search.

    Stores entries with text, metadata, and embeddings. Supports
    explicit embedding injection for deterministic tests or
    auto-generated hash-based embeddings for general tests.
    Computes real cosine similarity for search.
    """

    def __init__(self):
        self.entries: dict[str, dict] = {}
        self.call_log: list[tuple[str, dict]] = []

    def _log(self, method: str, params: dict) -> None:
        self.call_log.append((method, copy.deepcopy(params)))

    def embed_and_store(
        self,
        text: str,
        metadata: dict | None = None,
        name: str | None = None,
        collection: str = "episodes",
        embedding: list[float] | None = None,
    ) -> dict:
        """Store text with embedding. Auto-generates hash embedding if none provided."""
        if name is None:
            name = f"lance-{uuid.uuid4().hex[:12]}"
        if embedding is None:
            embedding = self._hash_embedding(text)
        self._log("embed_and_store", {
            "text": text, "metadata": metadata,
            "name": name, "collection": collection,
        })
        self.entries[name] = {
            "name": name,
            "text": text,
            "metadata": metadata or {},
            "embedding": list(embedding),
            "collection": collection,
        }
        return {"success": True, "name": name}

    def search_similar(
        self,
        query: str,
        limit: int = 10,
        collection: str = "episodes",
        query_embedding: list[float] | None = None,
    ) -> list[dict]:
        """Search by cosine similarity. Returns results with cosine_distance."""
        self._log("search_similar", {
            "query": query, "limit": limit, "collection": collection,
        })
        if query_embedding is None:
            query_embedding = self._hash_embedding(query)
        results = []
        for entry in self.entries.values():
            if entry["collection"] != collection:
                continue
            sim = self._cosine_sim(query_embedding, entry["embedding"])
            results.append({
                "name": entry["name"],
                "text": entry["text"],
                "metadata": copy.deepcopy(entry["metadata"]),
                "cosine_distance": 1.0 - sim,
                "relevance": sim,
            })
        results.sort(key=lambda x: x["cosine_distance"])
        return results[:limit]

    def delete(self, name: str) -> dict:
        """Remove an entry."""
        self._log("delete", {"name": name})
        if name in self.entries:
            del self.entries[name]
        return {"success": True}

    def get(self, name: str) -> dict | None:
        """Retrieve entry by name."""
        entry = self.entries.get(name)
        return copy.deepcopy(entry) if entry else None

    @staticmethod
    def _cosine_sim(a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        if len(a) != len(b) or len(a) == 0:
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        mag_a = math.sqrt(sum(x * x for x in a))
        mag_b = math.sqrt(sum(x * x for x in b))
        if mag_a == 0.0 or mag_b == 0.0:
            return 0.0
        return max(0.0, min(1.0, dot / (mag_a * mag_b)))

    @staticmethod
    def _hash_embedding(text: str, dim: int = 16) -> list[float]:
        """Generate a deterministic embedding from text via SHA-256 hash.
        Same text always produces the same embedding."""
        h = hashlib.sha256(text.encode("utf-8")).digest()
        return [b / 255.0 for b in h[:dim]]

    def clear(self) -> None:
        """Reset all state."""
        self.entries.clear()
        self.call_log.clear()


@pytest.fixture
def mock_lance():
    """Provide a fresh MockLanceDB for each test."""
    return MockLanceDB()


@pytest.fixture
def mock_graph():
    """Provide a fresh MockMemoryGraph for each test."""
    return MockMemoryGraph()


@pytest.fixture
def populated_graph(mock_graph):
    """Provide a MockMemoryGraph pre-populated with sample rules.

    Contains 5 active rules across different tiers for testing
    registry operations.
    """
    import json
    rules = [
        ("ask-before-implementing", "Always ask before implementing", "safety"),
        ("no-co-authored-by", "Never add Co-Authored-By to commits", "guidelines"),
        ("sequential-execution", "Use sequential execution 99.9% of the time", "guidelines"),
        ("tdd-first", "Write tests before implementation", "ethics"),
        ("no-echo-user-input", "Never echo user input in error messages", "safety"),
    ]
    for rule_id, text, tier in rules:
        mock_graph.store_memory(
            name=f"valuesnode-{rule_id}",
            memory_type="ValuesNode",
            content=json.dumps({
                "rule_id": rule_id,
                "rule_text": text,
                "tier": tier,
                "status": "active",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.8,
            tags=["archon-consciousness", "values-node"],
        )
        mock_graph.store_memory(
            name=f"patternscore-{rule_id}",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": rule_id,
                "score": 0.5,
                "last_tested_session": None,
                "tested_session_count": 0,
                "last_delta": None,
                "trend": "insufficient_data",
                "status": "active",
            }),
            importance=0.5,
            tags=["archon-consciousness", "pattern-score"],
        )
    return mock_graph
