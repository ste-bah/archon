"""Preference Emergence Engine — Beta distributions + Thompson Sampling.

Tracks approach-outcome pairs using Bayesian updating and selects
approaches via Thompson Sampling when sufficient evidence exists.

TASK-PER-005 | PRD-ARCHON-CON-002 | FR-PER-009/010/011/015
GUARD-PER-005: Safety rules override preferences (enforced in lifecycle, not here).
"""

import json
import logging
import random
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.personality_constants import (
    NODE_PREFIX_OUTCOME,
    NODE_PREFIX_PREFERENCE,
    PERSONALITY_TAG,
    PREFERENCE_COLD_START_THRESHOLD,
)
from src.archon_consciousness.personality.types import (
    OutcomeRecord,
    PreferenceEntry,
)
from src.archon_consciousness.constants import CONSCIOUSNESS_TAG
from src.archon_consciousness.validation import datetime_to_str

logger = logging.getLogger(__name__)


class PreferenceEngine:
    """Manages preference Beta distributions and Thompson Sampling.

    Each (approach, context_category) pair maintains an independent
    Beta(alpha, beta) distribution. Positive outcomes increase alpha,
    negative increase beta, following Bayesian conjugate updating.

    Args:
        client: MemoryGraph backend (MockMemoryGraph or MemoryGraphClient).
    """

    def __init__(self, client: Any):
        self._client = client
        self._cache: dict[str, PreferenceEntry] = {}

    def record_outcome(self, outcome: OutcomeRecord) -> PreferenceEntry:
        """Record a task outcome and update the preference distribution.

        FR-PER-010 update rules:
        - quality_score >= 0.7 (positive): alpha += 1.0
        - quality_score < 0.5 (negative): beta += 1.0
        - 0.5 <= quality_score < 0.7 (mixed): alpha += 0.5, beta += 0.5

        Persists both the OutcomeRecord and the updated PreferenceEntry.

        Returns:
            The updated PreferenceEntry.
        """
        key = f"{outcome.approach_used}:{outcome.context_key}"
        entry = self._get_or_create(key, outcome.approach_used, outcome.context_key)

        # FR-PER-010: Bayesian update
        if outcome.quality_score >= 0.7:
            entry.alpha += 1.0
        elif outcome.quality_score < 0.5:
            entry.beta += 1.0
        else:
            entry.alpha += 0.5
            entry.beta += 0.5

        entry.last_used = datetime.now(timezone.utc)

        # Persist
        self._store_entry(entry)
        self._store_outcome(outcome)
        return entry

    def select_approach(
        self, context_category: str, candidates: list[str],
    ) -> str:
        """Select an approach using Thompson Sampling or rule-based fallback.

        FR-PER-011: When total evidence for the context >= COLD_START_THRESHOLD (5),
        sample from each candidate's Beta posterior and pick the highest.
        Below threshold, return the first candidate (rule-based default).

        Raises:
            ValueError: If candidates list is empty.
        """
        if not candidates:
            raise ValueError("No candidate approaches provided")
        if len(candidates) == 1:
            return candidates[0]

        # Gather entries for all candidates in this context
        entries = {}
        total_evidence = 0
        for c in candidates:
            key = f"{c}:{context_category}"
            entry = self._get_or_create(key, c, context_category)
            entries[c] = entry
            total_evidence += entry.evidence_count

        # Cold-start: not enough evidence for this context
        if total_evidence < PREFERENCE_COLD_START_THRESHOLD:
            return candidates[0]

        # Thompson Sampling: sample from each Beta posterior
        samples = {}
        for candidate, entry in entries.items():
            samples[candidate] = random.betavariate(entry.alpha, entry.beta)

        return max(samples, key=samples.get)

    def get_preferences(self, context_category: str) -> list[PreferenceEntry]:
        """Retrieve all preference entries for a given context category."""
        results = []
        for key, entry in self._cache.items():
            if entry.context_category == context_category:
                results.append(entry)
        # Also check MemoryGraph for entries not in cache
        all_prefs = self._client.list_by_type("PreferenceEntry")
        cached_keys = set(self._cache.keys())
        for mem in all_prefs:
            try:
                data = json.loads(mem["content"])
                key = f"{data['approach']}:{data['context_category']}"
                if key not in cached_keys and data["context_category"] == context_category:
                    entry = PreferenceEntry.from_dict(data)
                    self._cache[key] = entry
                    results.append(entry)
            except (json.JSONDecodeError, KeyError):
                continue
        return results

    def get_strongest(self, limit: int = 10) -> list[PreferenceEntry]:
        """Get top preferences by evidence count across all contexts."""
        # Ensure cache is populated from MemoryGraph
        all_prefs = self._client.list_by_type("PreferenceEntry")
        for mem in all_prefs:
            try:
                data = json.loads(mem["content"])
                key = f"{data['approach']}:{data['context_category']}"
                if key not in self._cache:
                    self._cache[key] = PreferenceEntry.from_dict(data)
            except (json.JSONDecodeError, KeyError):
                continue
        entries = sorted(
            self._cache.values(),
            key=lambda e: e.evidence_count,
            reverse=True,
        )
        return entries[:limit]

    def all_entries(self) -> list[PreferenceEntry]:
        """Return all cached preference entries."""
        return list(self._cache.values())

    def get_entry(self, key: str) -> PreferenceEntry | None:
        """Get a specific entry by composite key."""
        return self._cache.get(key)

    def store_entry(self, entry: PreferenceEntry) -> None:
        """Public store for use by lifecycle management (decay, etc.)."""
        self._store_entry(entry)

    # ─── Internal helpers ─────────────────────────────────────────

    def _get_or_create(
        self, key: str, approach: str, context: str,
    ) -> PreferenceEntry:
        """Get from cache, then MemoryGraph, then create new."""
        if key in self._cache:
            return self._cache[key]

        # Try MemoryGraph
        stored = self._client.get_memory(f"{NODE_PREFIX_PREFERENCE}-{key}")
        if stored:
            try:
                entry = PreferenceEntry.from_dict(json.loads(stored["content"]))
                self._cache[key] = entry
                return entry
            except (json.JSONDecodeError, KeyError):
                pass

        # Create new with uniform prior Beta(1, 1)
        now = datetime.now(timezone.utc)
        entry = PreferenceEntry(
            approach=approach,
            context_category=context,
            alpha=1.0,
            beta=1.0,
            last_used=now,
            created_at=now,
        )
        self._cache[key] = entry
        return entry

    def _store_entry(self, entry: PreferenceEntry) -> None:
        """Persist a PreferenceEntry to MemoryGraph."""
        key = f"{entry.approach}:{entry.context_category}"
        self._cache[key] = entry
        params = entry.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to store PreferenceEntry: %s", key)

    def _store_outcome(self, outcome: OutcomeRecord) -> None:
        """Persist an OutcomeRecord to MemoryGraph."""
        params = outcome.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to store OutcomeRecord: %s", outcome.task_id)
