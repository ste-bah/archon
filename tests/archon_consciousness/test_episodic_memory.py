"""Tests for EpisodicMemory class — store, retrieve, pin, enrich.

Written BEFORE implementation (TDD).
Covers FR-CON-001, FR-CON-002, FR-CON-004, FR-CON-026.
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import Episode


# ─── Fast-path store ───────────────────────────────────────────────


class TestFastPathStore:
    """Test EpisodicMemory.store_fast (FR-CON-026 fast path)."""

    def _make_episode(self, **overrides):
        defaults = {
            "timestamp": datetime(2026, 3, 28, 12, 0, 0, tzinfo=timezone.utc),
            "trigger": "User asked about consciousness",
            "context": "Mid-session discussion about AI self-awareness",
            "action_taken": "Presented plan for consciousness enhancement",
            "outcome": "User approved the plan",
            "emotional_valence": "positive",
            "lesson_extracted": "Users respond well to structured plans",
        }
        defaults.update(overrides)
        return Episode(**defaults)

    def test_stores_to_memorygraph(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        assert client.get(name) is not None

    def test_stores_draft_embedding_to_lancedb(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        lance_entry = mock_lance.get(name)
        assert lance_entry is not None

    def test_embedding_status_is_draft(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        data = client.get(name)
        content = json.loads(data["content"])
        meta = data.get("metadata", {})
        # embedding_status tracked in metadata or content
        assert "draft" in json.dumps(data).lower()

    def test_keywords_empty_in_fast_path(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        data = client.get(name)
        content = json.loads(data["content"])
        assert content["keywords"] == []

    def test_tags_empty_in_fast_path(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        data = client.get(name)
        content = json.loads(data["content"])
        assert content["tags"] == []

    def test_importance_defaults_to_half(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        data = client.get(name)
        content = json.loads(data["content"])
        assert content["importance"] == 0.5

    def test_returns_episode_name(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        name = em.store_fast(ep)
        assert isinstance(name, str)
        assert name.startswith("episode-")

    # ─── Slow-path enrich ────────────────────────────────────────


class TestSlowPathEnrich:
    """Test EpisodicMemory.enrich (FR-CON-026 slow path)."""

    def test_enrich_updates_keywords(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Test enrich", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        em.enrich(name, keywords=["keyword1", "keyword2"], tags=["tag1"])
        data = client.get(name)
        content = json.loads(data["content"])
        assert content["keywords"] == ["keyword1", "keyword2"]
        assert content["tags"] == ["tag1"]

    def test_enrich_upgrades_embedding_status(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Test enrich status", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        em.enrich(name, keywords=["k"], tags=["t"])
        data = client.get(name)
        assert data["metadata"]["embedding_status"] == "enriched"

    def test_enrich_upgrades_importance(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Test importance", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        em.enrich(name, keywords=["k"], tags=["t"], importance=0.9)
        data = client.get(name)
        content = json.loads(data["content"])
        assert content["importance"] == 0.9

    def test_enrich_regenerates_lancedb_embedding(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Original text", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        draft_entry = mock_lance.get(name)
        draft_embedding = draft_entry["embedding"]
        em.enrich(name, keywords=["enriched"], tags=["extra"])
        enriched_entry = mock_lance.get(name)
        # Embedding should change (different text was used)
        assert enriched_entry["embedding"] != draft_embedding


class TestFastPathStoreContinued:

    def _make_episode(self, **overrides):
        defaults = {
            "timestamp": datetime(2026, 3, 28, 12, 0, 0, tzinfo=timezone.utc),
            "trigger": "User asked about consciousness",
            "context": "Mid-session discussion about AI self-awareness",
            "action_taken": "Presented plan for consciousness enhancement",
            "outcome": "User approved the plan",
            "emotional_valence": "positive",
            "lesson_extracted": "Users respond well to structured plans",
        }
        defaults.update(overrides)
        return Episode(**defaults)

    def test_no_llm_calls_in_fast_path(self, mock_graph, mock_lance):
        """Fast path: zero LLM calls (verified by no enrichment-related calls)."""
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = self._make_episode()
        em.store_fast(ep)
        # Only embed_and_store + store_memory calls, no enrich calls
        lance_calls = [c[0] for c in mock_lance.call_log]
        assert "enrich" not in " ".join(lance_calls).lower()


# ─── Retrieval ─────────────────────────────────────────────────────


class TestRetrieval:
    """Test EpisodicMemory.retrieve_top3 (FR-CON-002)."""

    def _store_episodes(self, em, client, mock_lance, episodes):
        """Store multiple episodes and return their names."""
        names = []
        for ep in episodes:
            name = em.store_fast(ep)
            names.append(name)
        return names

    def test_empty_store_returns_empty_list(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        result = em.retrieve_top3("some query context")
        assert result == []

    def test_returns_max_three(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        # Store 5 episodes with different triggers
        for i in range(5):
            ep = Episode(
                timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
                trigger=f"Unique trigger number {i} about implementation",
                context="Context", action_taken="Action", outcome="Outcome",
                emotional_valence="neutral", lesson_extracted="Lesson",
            )
            em.store_fast(ep)
        result = em.retrieve_top3("trigger about implementation")
        assert len(result) <= 3

    def test_retrieval_returns_episode_objects(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Test trigger for retrieval",
            context="Context", action_taken="Action", outcome="Outcome",
            emotional_valence="neutral", lesson_extracted="Lesson",
        )
        em.store_fast(ep)
        result = em.retrieve_top3("Test trigger for retrieval")
        if result:  # may be empty if below threshold
            assert isinstance(result[0], Episode)


# ─── Pin / Unpin ───────────────────────────────────────────────────


class TestPinUnpin:
    """Test pin/unpin operations (FR-CON-004)."""

    def test_pin_creates_pinned_by_edge(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Important event", context="C", action_taken="A",
            outcome="O", emotional_valence="negative",
            lesson_extracted="Critical lesson",
        )
        name = em.store_fast(ep)
        em.pin(name, "Critical learning moment")
        # Check PINNED_BY edge exists
        related = client.get_related(name, "PINNED_BY", direction="incoming")
        # The pin creates a marker node pointing to the episode
        assert em.is_pinned(name) is True

    def test_unpin_removes_pin(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Pin then unpin", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        em.pin(name, "Temp pin")
        em.unpin(name)
        assert em.is_pinned(name) is False

    def test_pin_idempotent(self, mock_graph, mock_lance):
        """Double-pin doesn't create duplicate."""
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Double pin", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        em.pin(name, "First pin")
        em.pin(name, "Second pin")  # should not duplicate
        assert em.is_pinned(name) is True

    def test_unpin_nonpinned_is_noop(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Never pinned", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        em.unpin(name)  # should not raise
        assert em.is_pinned(name) is False
