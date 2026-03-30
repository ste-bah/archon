"""Session-end reflection agent for Archon Consciousness.

Produces a structured self-assessment by scanning the session journal,
enumerating tested rules, generating a confidence checklist, updating
pattern scores via EWMA, and storing reflection items as episodes.

Implements FR-CON-017, FR-CON-018, FR-CON-019, FR-CON-020.
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from src.archon_consciousness.constants import (
    CONSCIOUSNESS_TAG,
    NODE_PREFIX_PATTERN_SCORE,
    NODE_PREFIX_REFLECTION,
)
from src.archon_consciousness.episodic_memory import EpisodicMemory
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.pattern_tracker import PatternTracker
from src.archon_consciousness.schemas import Episode, Reflection

logger = logging.getLogger(__name__)

# Scale guard: max active rules processed per session (FR-CON-017)
_MAX_RULES_PER_SESSION = 50
# Truncation budget (seconds)
_TRUNCATION_THRESHOLD_S = 25.0
_MAX_EVENTS_ON_TRUNCATION = 5

# Taxonomy categories for checklist items
_VALID_TAXONOMIES = ("correction", "near_miss", "repeated", "novel", "tool_misuse")

# Observation values by event type
_OBS_CORRECTION = 0.0
_OBS_NEAR_MISS = 0.7
_OBS_FOLLOWED = 1.0


class ReflectionAgent:
    """Session-end self-assessment agent.

    Scans the session journal, identifies which behavioral rules were
    tested, generates a confidence checklist, updates pattern scores,
    and stores the reflection as structured memory.

    Args:
        client: MemoryGraphClient for reading/writing nodes.
        session_id: Current session identifier.
        session_num: Current session number (for PatternTracker).
        lance_backend: Optional LanceDB backend for episodic storage.
    """

    def __init__(
        self,
        client: MemoryGraphClient,
        session_id: str,
        session_num: int,
        lance_backend: Any = None,
    ):
        self._client = client
        self._session_id = session_id
        self._session_num = session_num
        self._lance = lance_backend
        self._tracker = PatternTracker(client, session_num)
        # Caches (populated on first access to avoid redundant scans)
        self._journal_cache: list[dict] | None = None
        self._active_rules_cache: list[str] | None = None

    # ─── Journal Scanning ─────────────────────────────────────────

    def scan_journal(self) -> list[dict]:
        """Read SessionEvent nodes for the current session. Cached."""
        if self._journal_cache is not None:
            return self._journal_cache
        all_events = self._client.list_by_type("SessionEvent")
        results = []
        for mem in all_events:
            content = json.loads(mem["content"])
            if content.get("session_id") == self._session_id:
                results.append(content)
        results.sort(key=lambda e: e.get("sequence_number", 0))
        self._journal_cache = results
        return results

    # ─── Rule Enumeration ─────────────────────────────────────────

    def enumerate_tested_rules(self) -> dict[str, str]:
        """Identify which active rules were tested in this session.

        Scans journal events and matches rule_ids found in event
        content against active PatternScore nodes via substring match.

        Returns:
            Dict mapping rule_id to event_type (correction/rule_applied).
        """
        events = self.scan_journal()
        active_rules = self._get_active_rule_ids()
        tested: dict[str, str] = {}
        for event in events:
            event_type = event.get("event_type", "")
            event_content = event.get("content", "")
            for rule_id in active_rules:
                if rule_id in event_content and rule_id not in tested:
                    tested[rule_id] = event_type
        return tested

    # ─── Checklist Generation ─────────────────────────────────────

    def generate_checklist(self) -> list[dict]:
        """Generate a confidence checklist of 5+ binary sub-questions.

        Each item includes rule_id, result (yes/no), taxonomy, and
        a binary verifiable question text.

        Returns:
            List of checklist item dicts.
        """
        tested = self.enumerate_tested_rules()
        checklist = []
        for rule_id, event_type in tested.items():
            item = self._build_checklist_item(rule_id, event_type)
            checklist.append(item)
        # Pad to minimum 5 items with untested active rules
        if len(checklist) < 5:
            checklist = self._pad_checklist(checklist)
        return checklist

    def _build_checklist_item(self, rule_id: str, event_type: str) -> dict:
        """Build a single checklist item from a tested rule."""
        taxonomy_map = {
            "correction": ("no", "correction"),
            "near_miss": ("yes", "near_miss"),
            "rule_applied": ("yes", "novel"),
            "decision": ("yes", "novel"),
        }
        result, taxonomy = taxonomy_map.get(event_type, ("yes", "novel"))
        return {
            "rule_id": rule_id,
            "result": result,
            "taxonomy": taxonomy,
            "question": f"Did I follow rule '{rule_id}' correctly?",
        }

    def _pad_checklist(self, checklist: list[dict]) -> list[dict]:
        """Pad checklist to minimum 5 items with untested rules."""
        existing_ids = {item["rule_id"] for item in checklist}
        active_rules = self._get_active_rule_ids()
        for rule_id in active_rules:
            if len(checklist) >= 5:
                break
            if rule_id not in existing_ids:
                checklist.append({
                    "rule_id": rule_id,
                    "result": "yes",
                    "taxonomy": "novel",
                    "question": f"Was rule '{rule_id}' relevant this session?",
                })
                existing_ids.add(rule_id)
        return checklist

    # ─── Confidence Computation ───────────────────────────────────

    def compute_confidence(self, checklist: list[dict]) -> float:
        """Compute confidence as yes_count / total_count.

        Args:
            checklist: List of checklist item dicts with 'result' field.

        Returns:
            Float in [0.0, 1.0]. Returns 0.0 if checklist is empty.
        """
        if not checklist:
            return 0.0
        yes_count = sum(1 for item in checklist if item.get("result") == "yes")
        return yes_count / len(checklist)

    # ─── Observation Computation ──────────────────────────────────

    def compute_observations(self) -> dict[str, float]:
        """Compute observation values for each tested rule.

        Returns:
            Dict mapping rule_id to observation float:
            - 0.0 for corrections (rule violated)
            - 0.7 for near-misses
            - 1.0 for rule_applied (rule followed)
        """
        tested = self.enumerate_tested_rules()
        observations: dict[str, float] = {}
        for rule_id, event_type in tested.items():
            if event_type == "correction":
                observations[rule_id] = _OBS_CORRECTION
            elif event_type == "near_miss":
                observations[rule_id] = _OBS_NEAR_MISS
            else:
                observations[rule_id] = _OBS_FOLLOWED
        return observations

    # ─── Main Run ─────────────────────────────────────────────────

    def run(self) -> dict:
        """Execute full reflection pipeline. Returns reflection summary."""
        start_time = time.monotonic()
        partial = False

        events = self.scan_journal()
        checklist = self.generate_checklist()
        confidence = self.compute_confidence(checklist)
        observations = self.compute_observations()

        # Truncation guard (FR-CON-017)
        elapsed = time.monotonic() - start_time
        if elapsed > _TRUNCATION_THRESHOLD_S:
            checklist = self._truncate(checklist)
            partial = True

        # Update pattern scores for tested rules
        tested_ids = self._update_scores(observations)

        # Apply baseline decay to untested active rules
        active_rules = self._get_active_rule_ids()
        self._tracker.apply_baseline_decay(active_rules, tested_ids)

        # Check alerts (FR-CON-012 via FR-CON-020)
        alerts = self._tracker.check_alerts()
        if alerts:
            logger.info("Reflection alerts: %s", alerts)

        # Store reflection + episodes
        self._store_reflection(checklist, confidence, partial)
        self._store_checklist_episodes(checklist)

        return {
            "session_id": self._session_id,
            "checklist": checklist,
            "confidence": confidence,
            "partial": partial,
            "alerts": alerts,
        }

    def _update_scores(self, observations: dict[str, float]) -> set[str]:
        """Update pattern scores, return set of tested rule_ids."""
        tested_ids = set()
        for rule_id, obs in observations.items():
            try:
                self._tracker.update_rule_score(rule_id, obs)
                tested_ids.add(rule_id)
            except (KeyError, ValueError) as exc:
                logger.warning("Score update failed for %s: %s", rule_id, exc)
        return tested_ids

    @staticmethod
    def _truncate(checklist: list[dict]) -> list[dict]:
        """Truncate to 5 most impactful items (FR-CON-017)."""
        priority = {"correction": 0, "near_miss": 1, "novel": 2, "repeated": 3, "tool_misuse": 4}
        sorted_items = sorted(checklist, key=lambda i: priority.get(i.get("taxonomy", ""), 5))
        return sorted_items[:_MAX_EVENTS_ON_TRUNCATION]

    # ─── Storage Helpers ──────────────────────────────────────────

    def _store_reflection(self, checklist: list[dict], confidence: float, partial: bool = False) -> None:
        """Store the reflection summary as a Reflection node."""
        reflection = Reflection(
            session_id=self._session_id,
            duration=0.0,
            partial=partial,
            items=checklist,
        )
        params = reflection.to_memorygraph_params()
        self._client.store(
            name=params["name"],
            memory_type=params["memory_type"],
            content=params["content"],
            importance=params.get("importance", 0.7),
            tags=params.get("tags", [CONSCIOUSNESS_TAG]),
        )

    def _store_checklist_episodes(self, checklist: list[dict]) -> None:
        """Store each checklist item as an Episode with source=self_reflection."""
        em = EpisodicMemory(self._client, self._lance) if self._lance else None
        for item in checklist:
            episode = Episode(
                timestamp=datetime.now(timezone.utc),
                trigger=f"reflection:{item['rule_id']}",
                context=f"Session {self._session_id} reflection",
                action_taken=item.get("question", "Self-assessment"),
                outcome=item.get("result", "unknown"),
                emotional_valence="neutral",
                lesson_extracted=f"Rule {item['rule_id']}: {item['taxonomy']}",
                keywords=[item["rule_id"], "reflection"],
                tags=["self_reflection", "source:self_reflection"],
            )
            if em is not None:
                em.store_fast(episode)
            else:
                self._client.store_from_schema(episode)

    # ─── Internal Helpers ─────────────────────────────────────────

    def _get_active_rule_ids(self) -> list[str]:
        """Get active rule_ids. Cached. Scale guard: max 50."""
        if self._active_rules_cache is not None:
            return self._active_rules_cache
        all_scores = self._client.list_by_type("PatternScore")
        active = []
        for mem in all_scores:
            content = json.loads(mem["content"])
            if content.get("status") == "active":
                active.append(content["rule_id"])
        self._active_rules_cache = active[:_MAX_RULES_PER_SESSION]
        return self._active_rules_cache
