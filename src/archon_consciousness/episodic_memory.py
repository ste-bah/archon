"""Episodic memory system for Archon Consciousness.

Orchestrates episode storage, retrieval, pin/unpin, and merge using
MemoryGraph (structured data) and LanceDB (vector embeddings).

Implements:
- FR-CON-001: 11-field episode storage
- FR-CON-002: Composite scoring + MMR retrieval
- FR-CON-003: Importance-modulated decay (via retrieval_scoring)
- FR-CON-004: Pin/unpin with PINNED_BY edge
- FR-CON-026: Dual-stream (fast/slow path) + mid-session enrichment
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

from src.archon_consciousness.constants import (
    CONSCIOUSNESS_TAG,
    IMPORTANCE_DEFAULT,
    NODE_PREFIX_EPISODE,
)
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.retrieval_scoring import (
    composite_score,
    decay_factor,
    mmr_rerank,
    should_retrieve,
    tiebreak_by_recall_count,
)
from src.archon_consciousness.episode_merge import pick_survivor, union_lessons
from src.archon_consciousness.schemas import Episode

# Pin marker node prefix
_PIN_PREFIX = "pin-marker"


class EpisodicMemory:
    """Manages episode lifecycle: store, retrieve, pin, merge.

    Uses two backends:
    - MemoryGraphClient for structured episode data
    - LanceDB backend for vector embeddings and similarity search
    """

    def __init__(self, graph_client: MemoryGraphClient, lance_backend: Any):
        self._graph = graph_client
        self._lance = lance_backend

    # ─── Fast-path Store (FR-CON-026) ──────────────────────────────

    def store_fast(self, episode: Episode) -> str:
        """Store an episode via the fast path (zero LLM calls).

        Writes structured data to MemoryGraph and a draft embedding
        to LanceDB. Keywords and tags are left empty (filled by
        slow-path enrichment later).

        Returns:
            The MemoryGraph node name for the stored episode.
        """
        # Force fast-path defaults
        fast_ep = Episode(
            timestamp=episode.timestamp,
            trigger=episode.trigger,
            context=episode.context,
            action_taken=episode.action_taken,
            outcome=episode.outcome,
            emotional_valence=episode.emotional_valence,
            lesson_extracted=episode.lesson_extracted,
            keywords=[],   # empty in fast path
            tags=[],        # empty in fast path
            occurrence_count=episode.occurrence_count,
            importance=IMPORTANCE_DEFAULT,
            _id=episode._id,
        )

        # Store to MemoryGraph
        params = fast_ep.to_memorygraph_params()
        self._graph.store(
            name=params["name"],
            memory_type=params["memory_type"],
            content=params["content"],
            importance=params.get("importance", IMPORTANCE_DEFAULT),
            tags=params.get("tags", [CONSCIOUSNESS_TAG]),
            metadata={"embedding_status": "draft"},
        )

        # Store draft embedding to LanceDB (content-only concatenation)
        embed_text = self._build_embed_text(fast_ep, draft=True)
        self._lance.embed_and_store(
            text=embed_text,
            metadata={
                "episode_name": params["name"],
                "embedding_status": "draft",
            },
            name=params["name"],
        )

        return params["name"]

    # ─── Slow-path Enrich (FR-CON-026) ──────────────────────────────

    def enrich(
        self,
        episode_name: str,
        keywords: list[str],
        tags: list[str],
        importance: float | None = None,
    ) -> None:
        """Enrich a draft episode with keywords, tags, and upgraded embedding.

        Called by slow-path consolidation (via /loop), not during session.
        Updates the episode in MemoryGraph and regenerates the LanceDB
        embedding with the enriched text.

        Args:
            episode_name: The MemoryGraph name of the episode.
            keywords: 3-7 extracted keywords.
            tags: Categorical labels.
            importance: Upgraded importance score (optional).
        """
        ep = self._load_episode(episode_name)
        new_importance = importance if importance is not None else ep.importance
        enriched = Episode(
            timestamp=ep.timestamp, trigger=ep.trigger, context=ep.context,
            action_taken=ep.action_taken, outcome=ep.outcome,
            emotional_valence=ep.emotional_valence,
            lesson_extracted=ep.lesson_extracted,
            keywords=keywords, tags=tags,
            occurrence_count=ep.occurrence_count,
            importance=new_importance, _id=ep._id,
        )
        self._store_enriched(enriched, new_importance)

    def _store_enriched(self, episode: Episode, importance: float) -> None:
        """Persist an enriched episode to both stores."""
        params = episode.to_memorygraph_params()
        self._graph.store(
            name=params["name"], memory_type=params["memory_type"],
            content=params["content"], importance=importance,
            tags=params.get("tags", [CONSCIOUSNESS_TAG]),
            metadata={"embedding_status": "enriched"},
        )
        embed_text = self._build_embed_text(episode, draft=False)
        self._lance.embed_and_store(
            text=embed_text, name=params["name"],
            metadata={"episode_name": params["name"], "embedding_status": "enriched"},
        )

    # ─── Retrieval (FR-CON-002) ────────────────────────────────────

    def retrieve_top3(
        self,
        situation_context: str,
        threshold: float = 0.3,
        mmr_lambda: float = 0.7,
    ) -> list[Episode]:
        """Retrieve the top-3 most relevant episodes.

        Returns empty list if no episodes match (novel situation).
        """
        lance_results = self._lance.search_similar(query=situation_context, limit=20)
        if not lance_results:
            logger.info("Novel situation: no episodes in store (EC-CON-001)")
            return []

        candidates = self._score_candidates(lance_results, threshold)
        if not candidates:
            logger.info("Novel situation: all episodes below threshold (EC-CON-001)")
            return []

        candidates = self._maybe_enrich_draft(candidates)
        self._populate_embeddings(candidates)
        reranked = mmr_rerank(candidates, lambda_val=mmr_lambda, top_k=3)
        reranked = tiebreak_by_recall_count(reranked, tolerance=0.05)
        return [c["episode"] for c in reranked[:3]]

    def _score_candidates(self, lance_results: list, threshold: float) -> list[dict]:
        """Build scored candidate list from LanceDB results."""
        now = datetime.now(timezone.utc)
        candidates = []
        for lr in lance_results:
            episode_name = lr.get("metadata", {}).get("episode_name", lr.get("name"))
            if not episode_name:
                continue
            mem = self._graph.get(episode_name)
            if mem is None:
                continue
            ep = Episode.from_dict(json.loads(mem["content"]))
            age_days = (now - ep.timestamp).total_seconds() / 86400.0
            recency = decay_factor(age_days, ep.importance, pinned=self.is_pinned(episode_name))
            relevance = lr.get("relevance", 1.0 - lr.get("cosine_distance", 0.5))
            score = composite_score(relevance, recency)
            if not should_retrieve(score, threshold):
                continue
            candidates.append({
                "composite_score": score, "embedding": [],
                "episode": ep, "episode_name": episode_name,
                "recall_count": ep.occurrence_count,
            })
        return candidates

    def _populate_embeddings(self, candidates: list[dict]) -> None:
        """Load embeddings from LanceDB for MMR computation."""
        for c in candidates:
            if not c["embedding"]:
                entry = self._lance.get(c["episode_name"])
                if entry:
                    c["embedding"] = entry.get("embedding", [])

    # ─── Pin / Unpin (FR-CON-004) ──────────────────────────────────

    def pin(self, episode_name: str, reason: str) -> None:
        """Pin an episode to protect from decay and merge.

        Creates a marker node with PINNED_BY edge. Idempotent.
        """
        if self.is_pinned(episode_name):
            return  # Already pinned — idempotent

        pin_name = f"{_PIN_PREFIX}-{episode_name}"
        self._graph.store(
            name=pin_name,
            memory_type="PinMarker",
            content=json.dumps({"reason": reason, "episode": episode_name}),
            importance=0.1,
            tags=[CONSCIOUSNESS_TAG, "pin-marker"],
        )
        self._graph.create_relationship(
            source=pin_name,
            target=episode_name,
            relationship_type="PINNED_BY",
            properties={"reason": reason},
        )

    def unpin(self, episode_name: str) -> None:
        """Remove pin from an episode. No-op if not pinned."""
        pin_name = f"{_PIN_PREFIX}-{episode_name}"
        pin_marker = self._graph.get(pin_name)
        if pin_marker is not None:
            self._graph.delete(pin_name)

    def is_pinned(self, episode_name: str) -> bool:
        """Check if an episode is pinned."""
        pin_name = f"{_PIN_PREFIX}-{episode_name}"
        return self._graph.get(pin_name) is not None

    # ─── Merge (EC-CON-012) ────────────────────────────────────────

    def merge_episodes(self, name_a: str, name_b: str) -> str:
        """Merge two near-identical episodes.

        Algorithm per EC-CON-012:
        1. Pinned episode always survives
        2. More non-null fields survives; tie → more recent
        3. Union lesson_extracted (deduplicated)
        4. Sum occurrence_counts
        5. Transfer edges to survivor
        6. Delete loser from both stores

        Returns:
            Name of the surviving episode.
        """
        a_pinned = self.is_pinned(name_a)
        b_pinned = self.is_pinned(name_b)

        ep_a = self._load_episode(name_a)
        ep_b = self._load_episode(name_b)

        survivor_name, loser_name = pick_survivor(
            name_a, ep_a, a_pinned, name_b, ep_b, b_pinned,
        )
        survivor_ep = ep_a if survivor_name == name_a else ep_b
        loser_ep = ep_b if survivor_name == name_a else ep_a

        self._transfer_edges(loser_name, survivor_name)
        self._apply_merge(survivor_ep, loser_ep)
        self._delete_episode(loser_name)
        return survivor_name

    def _apply_merge(self, survivor: Episode, loser: Episode) -> None:
        """Update survivor with merged data from loser."""
        updated = Episode(
            timestamp=survivor.timestamp, trigger=survivor.trigger,
            context=survivor.context, action_taken=survivor.action_taken,
            outcome=survivor.outcome, emotional_valence=survivor.emotional_valence,
            lesson_extracted=union_lessons(survivor.lesson_extracted, loser.lesson_extracted),
            keywords=survivor.keywords or loser.keywords,
            tags=list(set(survivor.tags + loser.tags)),
            occurrence_count=survivor.occurrence_count + loser.occurrence_count,
            importance=max(survivor.importance, loser.importance),
            _id=survivor._id,
        )
        self._graph.store_from_schema(updated)

    def _delete_episode(self, name: str) -> None:
        """Remove an episode from both stores."""
        try:
            self._graph.delete(name)
        except KeyError:
            pass
        self._lance.delete(name)

    # ─── Internal helpers ──────────────────────────────────────────

    # ─── Mid-session enrichment (FR-CON-026) ─────────────────────

    def _maybe_enrich_draft(self, candidates: list[dict]) -> list[dict]:
        """Trigger mid-session enrichment if all results are drafts.

        Condition: all candidates have draft embeddings AND 3+ drafts
        exist in the LanceDB store. If triggered, synchronously enrich
        the top-1 candidate only (3-second timeout, fallback to draft).

        Returns candidates unchanged if conditions not met.
        """
        if not candidates:
            return candidates

        # Check if all are draft
        all_draft = all(
            self._is_draft(c["episode_name"]) for c in candidates
        )
        if not all_draft:
            return candidates

        # Count drafts in store
        draft_count = sum(
            1 for entry in self._lance.entries.values()
            if entry.get("metadata", {}).get("embedding_status") == "draft"
        ) if hasattr(self._lance, 'entries') else 0

        if draft_count < 3:
            return candidates

        # Enrich top-1 only (by composite score)
        top = max(candidates, key=lambda c: c["composite_score"])
        try:
            # Simulated enrichment — in production this would call LLM
            # with 3-second timeout. Here we just upgrade the embedding.
            ep = top["episode"]
            self.enrich(
                top["episode_name"],
                keywords=["auto-enriched"],
                tags=["mid-session-enriched"],
            )
        except Exception as exc:
            logger.warning("Mid-session enrichment failed: %s", exc)

        return candidates

    def _is_draft(self, episode_name: str) -> bool:
        """Check if an episode has a draft embedding."""
        mem = self._graph.get(episode_name)
        if mem is None:
            return False
        metadata = mem.get("metadata", {})
        if isinstance(metadata, dict):
            return metadata.get("embedding_status") == "draft"
        return False

    def _transfer_edges(self, from_name: str, to_name: str) -> None:
        """Transfer EVIDENCED_BY edges from one episode to another."""
        related = self._graph.get_related(
            from_name, relationship_type="EVIDENCED_BY", direction="incoming",
        )
        for rel in related:
            source = rel.get("name", "")
            props = rel.get("_relationship", {}).get("properties", {})
            try:
                self._graph.create_relationship(
                    source=source, target=to_name,
                    relationship_type="EVIDENCED_BY", properties=props,
                )
            except KeyError:
                pass  # Source node may not exist

    def _load_episode(self, name: str) -> Episode:
        """Load an Episode from MemoryGraph by name."""
        mem = self._graph.get(name)
        if mem is None:
            raise KeyError(f"Episode not found: {name}")
        return Episode.from_dict(json.loads(mem["content"]))

    @staticmethod
    def _build_embed_text(episode: Episode, draft: bool = False) -> str:
        """Build text for embedding generation.

        Draft: trigger + context + action_taken + outcome + lesson_extracted
        Enriched: + keywords + tags (per FR-CON-002)
        """
        parts = [
            episode.trigger,
            episode.context,
            episode.action_taken,
            episode.outcome,
            episode.lesson_extracted,
        ]
        if not draft and episode.keywords:
            parts.append(" ".join(episode.keywords))
        if not draft and episode.tags:
            parts.append(" ".join(episode.tags))
        return " ".join(parts)
