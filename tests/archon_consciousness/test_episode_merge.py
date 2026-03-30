"""Tests for episode merge algorithm.

Written BEFORE implementation (TDD).
Covers EC-CON-012: merge near-identical episodes.
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import Episode


class TestMergeSelection:
    """Test which episode survives the merge."""

    def _store_episode(self, client, mock_lance, episode, lance_name=None):
        """Helper: store an episode in both MemoryGraph and LanceDB."""
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        em = EpisodicMemory(client, mock_lance)
        params = episode.to_memorygraph_params()
        client.store(
            name=params["name"], memory_type=params["memory_type"],
            content=params["content"], importance=params.get("importance", 0.5),
            tags=params.get("tags", []),
        )
        lance_name = lance_name or params["name"]
        mock_lance.embed_and_store(
            text=episode.trigger, metadata={"episode_name": params["name"]},
            name=lance_name,
        )
        return params["name"]

    def test_more_nonnull_fields_survives(self, mock_graph, mock_lance):
        """Episode with more non-null fields wins."""
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        em = EpisodicMemory(MemoryGraphClient(mock_graph), mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Trigger A", context="Context A", action_taken="Action A",
            outcome="Outcome A", emotional_valence="negative",
            lesson_extracted="Lesson A",
            keywords=["approval", "ask"], tags=["pipeline"],  # more fields filled
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 27, tzinfo=timezone.utc),
            trigger="Trigger B", context="Context B", action_taken="Action B",
            outcome="Outcome B", emotional_valence="negative",
            lesson_extracted="Lesson B",
            keywords=[], tags=[],  # fewer fields filled
        )
        name_a = self._store_episode(MemoryGraphClient(mock_graph), mock_lance, ep_a)
        name_b = self._store_episode(MemoryGraphClient(mock_graph), mock_lance, ep_b)
        survivor = em.merge_episodes(name_a, name_b)
        assert survivor == name_a

    def test_tied_nonnull_more_recent_survives(self, mock_graph, mock_lance):
        """Equal non-null count → more recent timestamp wins."""
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        em = EpisodicMemory(MemoryGraphClient(mock_graph), mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 25, tzinfo=timezone.utc),
            trigger="Old", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=[], tags=[],
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="New", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=[], tags=[],
        )
        name_a = self._store_episode(MemoryGraphClient(mock_graph), mock_lance, ep_a)
        name_b = self._store_episode(MemoryGraphClient(mock_graph), mock_lance, ep_b)
        survivor = em.merge_episodes(name_a, name_b)
        assert survivor == name_b


class TestMergeLessonUnion:
    """Test lesson_extracted deduplication and union."""

    def test_lessons_unioned(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="T", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="Always ask first",
            keywords=["ask"], tags=["approval"],
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 27, tzinfo=timezone.utc),
            trigger="T", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="Wait for confirmation",
            keywords=[], tags=[],
        )
        name_a = ep_a.to_memorygraph_params()["name"]
        name_b = ep_b.to_memorygraph_params()["name"]
        client.store_from_schema(ep_a)
        client.store_from_schema(ep_b)
        mock_lance.embed_and_store("T", {}, name_a)
        mock_lance.embed_and_store("T", {}, name_b)

        survivor = em.merge_episodes(name_a, name_b)
        data = client.get(survivor)
        content = json.loads(data["content"])
        # Both lessons should be present
        assert "Always ask first" in content["lesson_extracted"]
        assert "Wait for confirmation" in content["lesson_extracted"]

    def test_duplicate_lessons_deduplicated(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="T", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="Always ask first",
            keywords=["ask"], tags=[],
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 27, tzinfo=timezone.utc),
            trigger="T", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="Always ask first",  # same lesson
            keywords=[], tags=[],
        )
        name_a = ep_a.to_memorygraph_params()["name"]
        name_b = ep_b.to_memorygraph_params()["name"]
        client.store_from_schema(ep_a)
        client.store_from_schema(ep_b)
        mock_lance.embed_and_store("T", {}, name_a)
        mock_lance.embed_and_store("T", {}, name_b)

        em.merge_episodes(name_a, name_b)
        data = client.get(name_a)
        content = json.loads(data["content"])
        # Should NOT have "Always ask first" twice
        assert content["lesson_extracted"].count("Always ask first") == 1


class TestMergeOccurrenceCount:
    """Test occurrence_count increment on merge."""

    def test_occurrence_count_incremented(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="T", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=["k"], tags=["t"],
            occurrence_count=3,
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 27, tzinfo=timezone.utc),
            trigger="T", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=[], tags=[],
            occurrence_count=2,
        )
        name_a = ep_a.to_memorygraph_params()["name"]
        name_b = ep_b.to_memorygraph_params()["name"]
        client.store_from_schema(ep_a)
        client.store_from_schema(ep_b)
        mock_lance.embed_and_store("T", {}, name_a)
        mock_lance.embed_and_store("T", {}, name_b)

        survivor = em.merge_episodes(name_a, name_b)
        data = client.get(survivor)
        content = json.loads(data["content"])
        # Survivor should have sum of occurrence_counts
        assert content["occurrence_count"] == 5


class TestMergePinnedProtection:
    """Test pinned episodes are NEVER merge targets."""

    def test_pinned_always_survives(self, mock_graph, mock_lance):
        """If A is pinned and B is not, A survives regardless of fields."""
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)

        ep_a = Episode(
            timestamp=datetime(2026, 3, 25, tzinfo=timezone.utc),
            trigger="Old pinned", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=[], tags=[],  # fewer fields
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="New unpinned", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="Different L",
            keywords=["a", "b", "c"], tags=["x", "y"],  # more fields
        )
        name_a = ep_a.to_memorygraph_params()["name"]
        name_b = ep_b.to_memorygraph_params()["name"]
        client.store_from_schema(ep_a)
        client.store_from_schema(ep_b)
        mock_lance.embed_and_store("T", {}, name_a)
        mock_lance.embed_and_store("T", {}, name_b)

        # Pin episode A
        em.pin(name_a, "Critical learning moment")

        survivor = em.merge_episodes(name_a, name_b)
        assert survivor == name_a  # pinned always survives


class TestMergeEdgeTransfer:
    """Test EVIDENCED_BY edge transfer to survivor."""

    def test_evidenced_by_edges_transferred(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Survivor", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=["k"], tags=["t"],
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 27, tzinfo=timezone.utc),
            trigger="Victim", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L2", keywords=[], tags=[],
        )
        name_a = ep_a.to_memorygraph_params()["name"]
        name_b = ep_b.to_memorygraph_params()["name"]
        client.store_from_schema(ep_a)
        client.store_from_schema(ep_b)
        mock_lance.embed_and_store("Survivor", {}, name_a)
        mock_lance.embed_and_store("Victim", {}, name_b)

        # Create an intent node that EVIDENCED_BY points to ep_b
        client.store("intent-test", "Intent", '{"goal_id": "test"}', tags=["intent"])
        client.create_relationship("intent-test", name_b, "EVIDENCED_BY", {"timestamp": "2026-03-28"})

        # Merge: ep_a survives, ep_b is deleted
        em.merge_episodes(name_a, name_b)

        # The EVIDENCED_BY edge should now point to survivor (ep_a)
        related = client.get_related("intent-test", "EVIDENCED_BY", direction="outgoing")
        target_names = [r["name"] for r in related]
        assert name_a in target_names


class TestMergeCleanup:
    """Test deleted episode is removed from both stores."""

    def test_deleted_episode_removed_from_memorygraph(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep_a = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Survivor", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L", keywords=["k"], tags=["t"],
        )
        ep_b = Episode(
            timestamp=datetime(2026, 3, 27, tzinfo=timezone.utc),
            trigger="Victim", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L2", keywords=[], tags=[],
        )
        name_a = ep_a.to_memorygraph_params()["name"]
        name_b = ep_b.to_memorygraph_params()["name"]
        client.store_from_schema(ep_a)
        client.store_from_schema(ep_b)
        mock_lance.embed_and_store("Survivor", {}, name_a)
        mock_lance.embed_and_store("Victim", {}, name_b)

        em.merge_episodes(name_a, name_b)
        assert client.get(name_b) is None  # deleted from MemoryGraph
        assert mock_lance.get(name_b) is None  # deleted from LanceDB
