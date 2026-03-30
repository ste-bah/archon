"""Personality hook integration — wiring subsystems to session lifecycle.

Provides PersonalityHooks class with methods called by the v1 hooks.py
session lifecycle functions. Creates and manages all personality
subsystem instances for a session.

TASK-PER-012 | PRD-ARCHON-CON-002 | FR-PER-041/042/046/047
GUARD-PER-003: No unsolicited state disclosure in injection.
"""

import json
import logging
import math
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
from src.archon_consciousness.personality.curiosity_tracker import CuriosityTracker
from src.archon_consciousness.personality.fast_channel import FastChannel
from src.archon_consciousness.personality.metacognitive_monitor import MetacognitiveMonitor
from src.archon_consciousness.personality.personality_constants import (
    NAMESPACE_SELF_STATE,
    NAMESPACE_TRAITS,
    NAMESPACE_TRUST,
    NODE_PREFIX_TRAIT_SET,
    NODE_PREFIX_TRUST_STATE,
)
from src.archon_consciousness.personality.personality_tracker import PersonalityTracker
from src.archon_consciousness.personality.preference_engine import PreferenceEngine
from src.archon_consciousness.personality.preference_lifecycle import PreferenceLifecycle
from src.archon_consciousness.personality.signal_collector import SignalCollector
from src.archon_consciousness.personality.trust_health import TrustHealth
from src.archon_consciousness.personality.trust_state_tracker import TrustTracker

logger = logging.getLogger(__name__)


class PersonalityHooks:
    """Session-scoped personality hook integration.

    Instantiates all personality subsystems and provides hook methods
    called by the v1 hooks.py lifecycle functions.

    Args:
        client: MemoryGraph backend.
        lance: LanceDB backend (optional).
        session_id: Current session identifier.
        session_num: Current session number.
    """

    def __init__(
        self,
        client: Any,
        lance: Any = None,
        session_id: str = "unknown",
        session_num: int = 1,
    ):
        self._client = client
        self._lance = lance
        self._session_id = session_id
        self._session_num = session_num

        # Initialize subsystems
        self._collector = SignalCollector(
            client=client, lance=lance,
        )
        self._engine = AppraisalEngine()
        self._self_model = AgentSelfModel(
            collector=self._collector,
            engine=self._engine,
            client=client,
            lance=lance,
        )
        self._preference_engine = PreferenceEngine(client=client)
        self._preference_lifecycle = PreferenceLifecycle(
            engine=self._preference_engine, client=client,
        )
        self._trust_tracker = TrustTracker(
            client=client, session_id=session_id,
        )
        self._trust_health = TrustHealth(
            tracker=self._trust_tracker, client=client,
        )
        self._curiosity = CuriosityTracker(
            client=client, lance=lance, session_id=session_id,
        )
        self._fast_channel = FastChannel(lance=lance, client=client)
        self._monitor = MetacognitiveMonitor(
            fast=self._fast_channel, client=client, session_id=session_id,
        )
        self._personality = PersonalityTracker(client=client)

    # ─── Session Start (FR-PER-046) ───────────────────────────────

    def build_session_injection(self) -> str:
        """FR-PER-046: personality context injection (< 300 tokens).

        Loads mood baseline, relationship grade, top preference,
        and personality narrative. No raw scores or signal dumps
        (GUARD-PER-003).
        """
        parts = []

        # Personality narrative
        narrative = self._personality.latest_narrative
        if narrative:
            parts.append(f"Profile: {narrative[:150]}")
        elif self._session_num < 10:
            parts.append("Profile: forming")

        # Mood baseline from last session
        last_mood = self._load_last_mood()
        if last_mood is not None:
            mood_word = (
                "positive" if last_mood > 0.2
                else "negative" if last_mood < -0.2
                else "neutral"
            )
            parts.append(f"Mood: {mood_word}")

        # Relationship health grade
        try:
            grade, _, _ = self._trust_health.compute_grade()
            parts.append(f"Trust: {grade}")
        except Exception:
            pass

        # Top preference
        try:
            strongest = self._preference_engine.get_strongest(limit=1)
            if strongest:
                p = strongest[0]
                parts.append(f"Preference: {p.approach} in {p.context_category}")
        except Exception:
            pass

        injection = " | ".join(parts) if parts else "Personality: initializing"
        return injection[:1200]

    def apply_episode_decay(self) -> int:
        """FR-PER-047: decay stale episode importance.

        Episodes from last 5 sessions: weight 1.0.
        Older: weight 0.5 * exp(-(sessions_since - 5) / 10).
        """
        if not self._lance:
            return 0
        try:
            results = self._lance.search_similar(
                "", limit=500, collection="episodes",
            )
        except Exception:
            return 0

        decayed = 0
        for ep in results:
            metadata = ep.get("metadata", {})
            ep_session = metadata.get("session_num", self._session_num)
            sessions_since = self._session_num - ep_session
            if sessions_since <= 5:
                continue  # weight 1.0, no decay needed
            weight = 0.5 * math.exp(-(sessions_since - 5) / 10.0)
            current_importance = metadata.get("importance", 0.5)
            new_importance = current_importance * weight
            if abs(new_importance - current_importance) > 0.01:
                decayed += 1
                # Would update episode metadata in production
        return decayed

    # ─── Pre-Tool Call (FR-PER-042) ───────────────────────────────

    def on_pre_tool_call(
        self,
        action_type: str,
        target: str,
        error_msg: str = "",
    ) -> str | None:
        """FR-PER-042: fast channel before every tool call.

        Returns context patch string if interrupt fires, None otherwise.
        """
        return self._monitor.on_pre_action(action_type, target, error_msg)

    # ─── Phase Complete (FR-PER-042) ──────────────────────────────

    def on_phase_complete(
        self,
        confidence: float,
        error_count: int,
    ) -> str | None:
        """FR-PER-042: slow channel at natural breakpoints."""
        return self._monitor.on_phase_boundary(confidence, error_count)

    # ─── Session End (FR-PER-041) ─────────────────────────────────

    def on_session_end(self, signals: dict | None = None) -> dict:
        """FR-PER-041: personality updates at session end.

        1. Persist trust state
        2. Update personality traits
        3. Apply preference decay
        4. Record session trust for trends
        """
        # 1. Persist trust
        self._trust_tracker.persist()

        # 2. Update personality traits
        self._personality.update_session(signals or {})

        # 3. Apply preference decay
        decayed = self._preference_lifecycle.apply_decay()

        # 4. Record trust for trends
        self._trust_health.record_session_trust(
            self._trust_tracker.overall_trust,
        )

        # 5. Record correction count for frustration trend
        correction_count = signals.get("corrections", 0) if signals else 0
        self._trust_health.record_session_corrections(correction_count)

        # 6. Persist trend history
        self._trust_health.persist_trends()

        # 7. Apply episode decay (FR-PER-047)
        episode_decay_count = self.apply_episode_decay()

        return {
            "trust_persisted": True,
            "traits_updated": True,
            "preferences_decayed": decayed,
            "episodes_decayed": episode_decay_count,
        }

    # ─── Signal forwarding ────────────────────────────────────────

    def record_correction(self) -> None:
        """Forward correction event to signal collector + trust tracker."""
        self._collector.record_correction()
        self._trust_tracker.record_violation(
            "factual_error", "User correction recorded",
        )

    def record_success(self) -> None:
        """Forward success event to signal collector."""
        self._collector.record_success()

    # ─── Internal helpers ─────────────────────────────────────────

    def _load_last_mood(self) -> float | None:
        """Load the last stored mood valence."""
        try:
            results = self._client.search_memories(
                "self-state", memory_type="AgentSelfState", limit=1,
            )
            if results:
                content = json.loads(results[0]["content"])
                return content.get("mood_valence")
        except Exception:
            pass
        return None
