"""Preference lifecycle management — decay, mere-exposure, conflict, articulation.

Extends PreferenceEngine with time-based decay, bias counterweights,
safety-first conflict resolution, and human-readable articulation.

TASK-PER-006 | PRD-ARCHON-CON-002 | FR-PER-012/013/014/016
GUARD-PER-005: Safety/correctness rules ALWAYS override preferences.
"""

import logging
import math
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.personality_constants import (
    MERE_EXPOSURE_DECAY,
    PREFERENCE_ALPHA_FLOOR,
    PREFERENCE_BETA_FLOOR,
    PREFERENCE_CERTAINTY_OVERRIDE,
    PREFERENCE_DECAY_LAMBDA,
)
from src.archon_consciousness.personality.types import PreferenceEntry

logger = logging.getLogger(__name__)


class PreferenceLifecycle:
    """Manages preference decay, bias counterweights, and conflict resolution.

    Args:
        engine: PreferenceEngine instance to operate on.
        client: MemoryGraph backend for conflict logging.
    """

    def __init__(self, engine: Any, client: Any):
        self._engine = engine
        self._client = client

    def apply_decay(self) -> int:
        """FR-PER-012: decay unused preferences with 30-day half-life.

        For preferences unused > 7 days, apply factor exp(-days/lambda)
        to both alpha and beta. Floor at 1.0 each.

        Returns:
            Count of decayed entries.
        """
        decayed = 0
        now = datetime.now(timezone.utc)
        for entry in self._engine.all_entries():
            days_unused = (now - entry.last_used).total_seconds() / 86400.0
            if days_unused <= 7.0:
                continue
            factor = math.exp(-days_unused / PREFERENCE_DECAY_LAMBDA)
            entry.alpha = max(PREFERENCE_ALPHA_FLOOR, entry.alpha * factor)
            entry.beta = max(PREFERENCE_BETA_FLOOR, entry.beta * factor)
            self._engine.store_entry(entry)
            decayed += 1
        return decayed

    def apply_mere_exposure_decay(
        self,
        selected_approach: str,
        context: str,
        all_candidates: list[str],
    ) -> None:
        """FR-PER-016: decay non-selected approaches to counteract mere exposure.

        Applies 0.999 per-session decay to alpha/beta of approaches that
        were NOT selected, preventing unfair advantage from retrieval frequency.
        """
        for candidate in all_candidates:
            if candidate == selected_approach:
                continue
            key = f"{candidate}:{context}"
            entry = self._engine.get_entry(key)
            if entry is None:
                continue
            entry.alpha = max(PREFERENCE_ALPHA_FLOOR, entry.alpha * MERE_EXPOSURE_DECAY)
            entry.beta = max(PREFERENCE_BETA_FLOOR, entry.beta * MERE_EXPOSURE_DECAY)
            self._engine.store_entry(entry)

    def resolve_conflict(self, preference: PreferenceEntry, rule_tier: str) -> str:
        """FR-PER-014: preference-rule conflict resolution.

        Safety/correctness rules (tier-1 "safety", tier-2 "ethics") ALWAYS win.
        For style/approach rules ("guidelines", "helpfulness"):
            preference wins if certainty (alpha + beta) > CERTAINTY_OVERRIDE (20).
            Otherwise, rule wins.

        GUARD-PER-005: No code path allows preference to override safety.

        Returns:
            "preference_wins" or "rule_wins".
        """
        # GUARD-PER-005: safety and ethics ALWAYS win, no exceptions
        if rule_tier in ("safety", "ethics"):
            return "rule_wins"

        # Style/approach: preference wins only if certainty exceeds threshold
        certainty = preference.alpha + preference.beta
        if certainty > PREFERENCE_CERTAINTY_OVERRIDE:
            return "preference_wins"

        return "rule_wins"

    def articulate_preferences(self, min_evidence: int = 10) -> list[str]:
        """FR-PER-013: generate natural language preference statements.

        For preferences with evidence_count >= min_evidence, produce
        human-readable statements referencing approach, context, and
        outcome counts.

        Returns:
            List of articulated preference strings.
        """
        statements = []
        for entry in self._engine.get_strongest(limit=20):
            if entry.evidence_count < min_evidence:
                continue
            positive = int(entry.alpha - 1)
            negative = int(entry.beta - 1)
            mean = entry.mean

            if mean > 0.7:
                strength = "strongly prefer"
            elif mean > 0.55:
                strength = "slightly prefer"
            else:
                strength = "am neutral on"

            stmt = (
                f"In {entry.context_category} tasks, I {strength} "
                f"{entry.approach} ({positive} positive, {negative} negative "
                f"outcomes over {entry.evidence_count} observations)."
            )
            statements.append(stmt)
        return statements
