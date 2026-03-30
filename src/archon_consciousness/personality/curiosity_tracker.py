"""Curiosity Tracker — encounter detection, scoring, queue, budget.

Flags knowledge gaps during work and feeds ranked topics into
the learning system. Implements Schmidhuber's compression progress
metric with budget caps.

TASK-PER-009 | PRD-ARCHON-CON-002 | FR-PER-026/027/028/029/030
"""

import json
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.personality_constants import (
    CURIOSITY_MAX_PER_SESSION,
    CURIOSITY_SIGNAL_TYPES,
    CURIOSITY_SUPPRESSION_THRESHOLD,
    NODE_PREFIX_CURIOSITY,
    PERSONALITY_TAG,
)
from src.archon_consciousness.personality.types_events import CuriosityEncounter
from src.archon_consciousness.constants import CONSCIOUSNESS_TAG

logger = logging.getLogger(__name__)


class CuriosityTracker:
    """Manages curiosity encounters, scoring, and learning queue.

    Flags up to CURIOSITY_MAX_PER_SESSION encounters per session.
    Scores by multi-factor formula. Tracks study outcomes and
    suppresses irreducibly uncertain topics.

    Args:
        client: MemoryGraph backend.
        lance: LanceDB backend for relevance scoring. Optional.
        session_id: Current session identifier.
    """

    def __init__(self, client: Any, session_id: str, lance: Any = None):
        self._client = client
        self._lance = lance
        self._session_id = session_id
        self._session_flagged: int = 0
        self._encounters: dict[str, CuriosityEncounter] = {}

    def flag_encounter(
        self,
        signal_type: str,
        topic: str,
        confidence: float,
        context: str = "",
    ) -> CuriosityEncounter | None:
        """FR-PER-026: flag a curiosity encounter.

        Returns None if session budget exhausted (max 3 per session).

        Raises:
            ValueError: If signal_type is not a valid curiosity signal.
        """
        if signal_type not in CURIOSITY_SIGNAL_TYPES:
            raise ValueError(
                f"Invalid signal type: '{signal_type}'. "
                f"Must be one of {CURIOSITY_SIGNAL_TYPES}"
            )

        if self._session_flagged >= CURIOSITY_MAX_PER_SESSION:
            return None

        encounter = CuriosityEncounter(
            encounter_id=str(uuid.uuid4()),
            session_id=self._session_id,
            timestamp=datetime.now(timezone.utc),
            signal_type=signal_type,
            topic=topic[:200],
            confidence_at_flag=confidence,
            context_summary=context[:500] if context else "",
            interest_score=0.0,
            study_sessions=0,
            compression_progress=0.0,
            suppressed=False,
        )
        encounter.interest_score = self._compute_interest_score(encounter)
        self._session_flagged += 1
        self._encounters[encounter.encounter_id] = encounter
        self._store_encounter(encounter)
        return encounter

    def get_queue(self, limit: int = 5) -> list[CuriosityEncounter]:
        """FR-PER-028: priority queue sorted by interest_score descending.

        Excludes suppressed encounters.
        """
        active = [e for e in self._encounters.values() if not e.suppressed]
        active.sort(key=lambda e: e.interest_score, reverse=True)
        return active[:limit]

    def record_study_outcome(
        self, encounter_id: str, accuracy_improved: bool,
    ) -> None:
        """FR-PER-028 + FR-PER-030: track learning outcome.

        Increments study_sessions. If accuracy improved, increases
        compression_progress. After 3 sessions with no progress,
        marks as suppressed ("irreducibly uncertain").
        """
        enc = self._load_encounter(encounter_id)
        enc.study_sessions += 1

        if accuracy_improved:
            enc.compression_progress += 1.0
        else:
            # FR-PER-028: no improvement after 3 -> reduce priority 50%
            if enc.study_sessions >= 3:
                enc.interest_score *= 0.5

        # FR-PER-030: 3+ sessions with zero progress -> suppress
        if (enc.study_sessions >= CURIOSITY_SUPPRESSION_THRESHOLD
                and enc.compression_progress <= 0):
            enc.suppressed = True

        self._encounters[enc.encounter_id] = enc
        self._store_encounter(enc)

    def apply_cross_domain_boost(self, recent_domains: dict[str, int]) -> None:
        """FR-PER-029: boost cross-domain topics if >60% in one domain.

        If more than 60% of recent learning is concentrated in one domain,
        boost interest scores of topics NOT in that domain by 2x.
        """
        total = sum(recent_domains.values())
        if total == 0:
            return

        dominant_domain = None
        for domain, count in recent_domains.items():
            if count / total > 0.6:
                dominant_domain = domain
                break

        if dominant_domain is None:
            return

        for enc in self._encounters.values():
            if enc.suppressed:
                continue
            if dominant_domain.lower() not in enc.topic.lower():
                enc.interest_score *= 2.0
                self._store_encounter(enc)

    # ─── Interest score computation (FR-PER-027) ──────────────────

    def _compute_interest_score(self, enc: CuriosityEncounter) -> float:
        """Multi-factor interest score.

        interest = (frequency * uncertainty * relevance * recency * novelty)
                   / (1 + learning_cost)
        """
        occurrence_count = self._count_occurrences(enc.topic)
        frequency_weight = max(0.1, math.log(1 + occurrence_count))
        uncertainty_weight = 1.0 - enc.confidence_at_flag
        relevance_weight = self._compute_relevance(enc.topic)
        recency_decay = 1.0  # just flagged, decay = exp(0) = 1.0
        novelty_bonus = 1.5 if not self._topic_known(enc.topic) else 1.0
        learning_cost = 2.0  # default estimate (1-5 scale)

        return (
            frequency_weight * uncertainty_weight * relevance_weight
            * recency_decay * novelty_bonus
        ) / (1 + learning_cost)

    def _count_occurrences(self, topic: str) -> int:
        """Count how many times this topic has been flagged."""
        count = 0
        for enc in self._encounters.values():
            if enc.topic.lower() == topic.lower():
                count += 1
        return count

    def _compute_relevance(self, topic: str) -> float:
        """Compute relevance to recent tasks via embedding similarity."""
        if not self._lance or not topic:
            return 0.5  # default mid-relevance
        try:
            results = self._lance.search_similar(topic, limit=1, collection="episodes")
            if results:
                return results[0].get("relevance", 0.5)
        except Exception:
            pass
        return 0.5

    def _topic_known(self, topic: str) -> bool:
        """Check if topic exists in knowledge graph (MemoryGraph)."""
        results = self._client.search_memories(topic, limit=1)
        return len(results) > 0

    # ─── Persistence ──────────────────────────────────────────────

    def _store_encounter(self, enc: CuriosityEncounter) -> None:
        """Persist encounter to MemoryGraph."""
        params = enc.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to store CuriosityEncounter: %s", enc.encounter_id)

    def _load_encounter(self, encounter_id: str) -> CuriosityEncounter:
        """Load encounter from cache or MemoryGraph."""
        if encounter_id in self._encounters:
            return self._encounters[encounter_id]
        stored = self._client.get_memory(f"{NODE_PREFIX_CURIOSITY}-{encounter_id}")
        if stored:
            return CuriosityEncounter.from_dict(json.loads(stored["content"]))
        raise KeyError(f"Encounter not found: {encounter_id}")
