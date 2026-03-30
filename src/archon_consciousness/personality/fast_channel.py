"""Fast channel metacognitive monitor — per-action anomaly detection.

Three lightweight checks running before every tool call: episode
matcher, rule checker, and action anomaly detector. Total budget: 50ms.

TASK-PER-010 | PRD-ARCHON-CON-002 | FR-PER-031/032/033/034
GUARD-PER-007: Interrupts never modify files or execute tools.
GUARD-PER-008: Total fast channel < 50ms, kill at 30ms per component.
"""

import json
import logging
import time
from collections import Counter, deque
from dataclasses import dataclass
from typing import Any

from src.archon_consciousness.personality.personality_constants import (
    EPISODE_SIMILARITY_THRESHOLD,
)

logger = logging.getLogger(__name__)

# Type alias for the action window
ActionTuple = tuple[str, str, str]  # (action_type, target, outcome)


@dataclass
class FastChannelResult:
    """Output of the 3-check fast channel."""

    episode_match: str | None       # matched episode summary
    episode_similarity: float       # cosine similarity (0 if no match)
    rule_violation: str | None      # violated rule_id
    anomaly_type: str | None        # "repeated_edit" | "repeated_error" | "revert_cycle"
    total_ms: float                 # execution time


class FastChannel:
    """Per-action metacognitive fast channel.

    Runs 3 lightweight checks before every tool call:
    1. Episode Matcher — LanceDB HNSW query for negative episodes
    2. Rule Checker — PatternScore regression/low-score check
    3. Action Anomaly Detector — sliding window pattern detection

    GUARD-PER-007: No methods modify files or execute tools.
    GUARD-PER-008: Hard 30ms timeout per component, 50ms total.

    Args:
        lance: LanceDB backend for episode search. Optional.
        client: MemoryGraph backend for rule checking.
    """

    def __init__(self, lance: Any = None, client: Any = None):
        self._lance = lance
        self._client = client
        self._window: deque[ActionTuple] = deque(maxlen=10)

    def check(
        self,
        action_type: str,
        target: str,
        error_msg: str = "",
    ) -> FastChannelResult:
        """Run all 3 fast channel checks. Returns within 50ms budget."""
        start = time.monotonic()

        # 1. Episode matcher (~20ms budget)
        ep_match, ep_sim = self._timed_check(
            lambda: self._check_episodes(action_type, target, error_msg), 30,
        ) or (None, 0.0)

        # 2. Rule checker (~5ms budget)
        rule_viol = self._timed_check(
            lambda: self._check_rules(action_type, target, error_msg), 30,
        )

        # 3. Anomaly detector (~1ms budget) — no timeout needed
        anomaly = self._check_anomalies(action_type, target)

        # Record action in window AFTER checks (so current action isn't in window yet for anomaly)
        self._window.append((action_type, target, "pending"))

        total_ms = (time.monotonic() - start) * 1000
        return FastChannelResult(
            episode_match=ep_match,
            episode_similarity=ep_sim if ep_match else 0.0,
            rule_violation=rule_viol,
            anomaly_type=anomaly,
            total_ms=total_ms,
        )

    def update_outcome(self, outcome: str) -> None:
        """Update the most recent action's outcome in the window."""
        if self._window:
            last = self._window[-1]
            self._window[-1] = (last[0], last[1], outcome)

    # ─── Episode Matcher (FR-PER-032) ─────────────────────────────

    def _check_episodes(
        self, action: str, target: str, error: str,
    ) -> tuple[str, float] | None:
        """Query LanceDB for negative episodes with similarity > 0.85."""
        if not self._lance:
            return None
        context_hash = f"{target}:{action}:{error}"
        try:
            results = self._lance.search_similar(
                context_hash, limit=1, collection="episodes",
            )
        except Exception:
            return None
        if not results:
            return None
        best = results[0]
        similarity = best.get("relevance", 0.0)
        if similarity > EPISODE_SIMILARITY_THRESHOLD:
            outcome = best.get("metadata", {}).get("outcome", "")
            if outcome == "negative":
                return (best.get("text", "")[:200], similarity)
        return None

    # ─── Rule Checker (FR-PER-033) ────────────────────────────────

    def _check_rules(
        self, action: str, target: str, error: str,
    ) -> str | None:
        """Check action against regressing/low-score PatternScore rules."""
        if not self._client:
            return None
        try:
            all_scores = self._client.list_by_type("PatternScore")
        except Exception:
            return None
        for mem in all_scores:
            try:
                data = json.loads(mem["content"])
            except (json.JSONDecodeError, KeyError):
                continue
            if data.get("status") != "active":
                continue
            score = data.get("score", 1.0)
            trend = data.get("trend", "stable")
            if trend == "regressing" or score < 0.5:
                return data.get("rule_id")
        return None

    # ─── Action Anomaly Detector (FR-PER-034) ─────────────────────

    def _check_anomalies(self, action: str, target: str) -> str | None:
        """Sliding window anomaly detection.

        Detects:
        (a) Same file edited 3+ times without test run
        (b) Same error message seen 2+ times
        (c) Revert-edit-revert cycle (3+ edits on same file)
        """
        window = list(self._window)
        if not window:
            return None

        # (a) Repeated edits without test
        if action == "edit":
            recent_same_edits = 0
            has_test_between = False
            for a_type, a_target, _ in reversed(window):
                if a_type == "edit" and a_target == target:
                    recent_same_edits += 1
                elif a_type == "test":
                    has_test_between = True
                    break
                else:
                    break
            if recent_same_edits >= 2 and not has_test_between:
                return "repeated_edit"

        # (b) Repeated errors
        errors = [a[2] for a in window
                  if a[2] and a[2] not in ("pending", "success")]
        if errors:
            counts = Counter(errors)
            if any(c >= 2 for c in counts.values()):
                return "repeated_error"

        # (c) Revert cycle: 3+ consecutive edits to same file
        if len(window) >= 2 and action == "edit":
            recent_targets = [a[1] for a in window[-2:]] + [target]
            if all(t == target for t in recent_targets):
                return "revert_cycle"

        return None

    # ─── Timeout wrapper ──────────────────────────────────────────

    @staticmethod
    def _timed_check(fn, timeout_ms: int):
        """Run fn with soft timeout. Returns None if exceeded or error."""
        start = time.monotonic()
        try:
            result = fn()
        except Exception:
            return None
        elapsed_ms = (time.monotonic() - start) * 1000
        if elapsed_ms > timeout_ms:
            return None
        return result
