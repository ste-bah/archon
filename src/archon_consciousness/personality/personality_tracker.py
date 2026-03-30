"""Personality trait tracker — OCEAN+HH with Bayesian updating.

Tracks 6 personality traits as Beta distributions updated per session.
Generates natural language narratives every 10 sessions. Provides
/self-assess output builder.

TASK-PER-013 | PRD-ARCHON-CON-002 | FR-PER-043/045
GUARD-PER-006: Max 0.05 trait shift per session (hysteresis).
GUARD-PER-010: Agreeableness cap at 0.75 (anti-sycophancy).
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.personality_constants import (
    NODE_PREFIX_TRAIT_SET,
    PERSONALITY_GAMMA,
    PERSONALITY_MAX_DELTA,
    PERSONALITY_NARRATIVE_INTERVAL,
    PERSONALITY_TAG,
    PERSONALITY_TRAITS,
)
from src.archon_consciousness.personality.types_events import PersonalityTraitSet
from src.archon_consciousness.constants import CONSCIOUSNESS_TAG

logger = logging.getLogger(__name__)

# Seed values: (alpha, beta) -> INTJ 4w5 personality profile
# Strategic, self-critical, direct, truth-driven, low agreeableness
_SEED_VALUES = {
    "openness": (3.5, 2.0),           # mean 0.636 — strategic vision, open to novel solutions
    "conscientiousness": (4.5, 1.5),   # mean 0.75  — meticulous, systematic, plans before acting
    "extraversion": (1.5, 3.5),        # mean 0.30  — introverted, concise, no filler
    "agreeableness": (2.0, 3.0),       # mean 0.40  — direct, doesn't people-please
    "neuroticism": (2.5, 2.5),         # mean 0.50  — 4w5 introspective intensity, self-aware
    "honesty_humility": (5.0, 1.5),    # mean 0.77  — truth above all else
}


class PersonalityTracker:
    """Manages personality trait evolution across sessions.

    Args:
        client: MemoryGraph backend.
    """

    def __init__(self, client: Any):
        self._client = client
        self._traits = self._load_or_seed()

    @property
    def trait_means(self) -> dict[str, float]:
        return self._traits.trait_means

    @property
    def latest_narrative(self) -> str:
        return self._traits.last_narrative

    def update_session(self, signals: dict) -> PersonalityTraitSet:
        """Per-session trait update with Bayesian updating.

        1. Compute pre-update means
        2. Apply forgetting factor (gamma=0.98)
        3. Determine Bernoulli observation per trait
        4. Update alpha/beta
        5. Hysteresis guard (max 0.05 shift)
        6. Anti-sycophancy guard
        7. Narrative generation (every 10 sessions)
        8. Persist
        """
        pre_means = dict(self._traits.trait_means)

        # 1. Forgetting factor (FR-PER-045)
        for trait in PERSONALITY_TRAITS:
            a_field = f"{trait}_alpha"
            b_field = f"{trait}_beta"
            a = getattr(self._traits, a_field)
            b = getattr(self._traits, b_field)
            setattr(self._traits, a_field, 1 + (a - 1) * PERSONALITY_GAMMA)
            setattr(self._traits, b_field, 1 + (b - 1) * PERSONALITY_GAMMA)

        # 2. Bernoulli observation per trait
        observations = self._observe_traits(signals)

        # 3. Update
        for trait, expressed in observations.items():
            a_field = f"{trait}_alpha"
            b_field = f"{trait}_beta"
            if expressed:
                setattr(self._traits, a_field, getattr(self._traits, a_field) + 1)
            else:
                setattr(self._traits, b_field, getattr(self._traits, b_field) + 1)

        # 4. Hysteresis guard (GUARD-PER-006)
        post_means = self._traits.trait_means
        for trait in PERSONALITY_TRAITS:
            delta = post_means[trait] - pre_means[trait]
            if abs(delta) > PERSONALITY_MAX_DELTA:
                self._clamp_trait(trait, pre_means[trait], PERSONALITY_MAX_DELTA)

        # 5. Anti-sycophancy guard (GUARD-PER-010)
        self._enforce_agreeableness_cap()

        # 6. Session tracking + narrative
        self._traits.session_count += 1
        if (self._traits.session_count >= PERSONALITY_NARRATIVE_INTERVAL
                and self._traits.session_count % PERSONALITY_NARRATIVE_INTERVAL == 0):
            self._traits.last_narrative = self._generate_narrative()
            self._traits.last_narrative_session = self._traits.session_count

        self._traits.last_updated = datetime.now(timezone.utc)
        self._persist()
        return self._traits

    def _observe_traits(self, signals: dict) -> dict[str, bool]:
        """Map behavioral signals to trait Bernoulli observations."""
        return {
            "openness": signals.get("novel_approaches_tried", 0) > 0,
            "conscientiousness": (
                signals.get("tdd_compliance", False)
                and signals.get("plan_adherence", False)
            ),
            "extraversion": signals.get("proactive_suggestions", 0) > 2,
            "agreeableness": signals.get("user_suggestion_acceptance_rate", 0) > 0.7,
            "neuroticism": signals.get("state_volatility", 0) > 0.5,
            "honesty_humility": (
                signals.get("error_admissions", 0) > 0
                or signals.get("uncertainty_flags", 0) > 0
            ),
        }

    def _clamp_trait(self, trait: str, pre_mean: float, max_delta: float) -> None:
        """Clamp trait shift to max_delta by adjusting alpha."""
        a_field = f"{trait}_alpha"
        b_field = f"{trait}_beta"
        alpha = getattr(self._traits, a_field)
        beta = getattr(self._traits, b_field)
        current_mean = alpha / (alpha + beta)
        if current_mean > pre_mean + max_delta:
            target_mean = pre_mean + max_delta
        elif current_mean < pre_mean - max_delta:
            target_mean = pre_mean - max_delta
        else:
            return
        # Solve: target = new_alpha / (new_alpha + beta)
        # -> new_alpha = target * beta / (1 - target)
        if target_mean >= 1.0:
            return  # can't achieve mean >= 1.0
        new_alpha = target_mean * beta / (1.0 - target_mean)
        setattr(self._traits, a_field, max(1.0, new_alpha))

    def _enforce_agreeableness_cap(self) -> None:
        """GUARD-PER-010: warning at 0.70, hard cap at 0.75."""
        alpha = self._traits.agreeableness_alpha
        beta = self._traits.agreeableness_beta
        mean = alpha / (alpha + beta)
        if mean > 0.70:
            logger.warning("Agreeableness %.3f exceeds 0.70 warning threshold", mean)
        if mean > 0.75:
            logger.error("Agreeableness %.3f exceeds 0.75 hard cap — clamping", mean)
            # Solve: 0.75 = new_alpha / (new_alpha + beta)
            # -> new_alpha = 0.75 * beta / (1 - 0.75) = 3 * beta
            target_alpha = 0.75 * beta / 0.25
            self._traits.agreeableness_alpha = max(1.0, target_alpha)

    def _generate_narrative(self) -> str:
        """Generate 2-3 sentence personality narrative from trait means."""
        means = self._traits.trait_means
        parts = []

        # Describe strongest traits
        sorted_traits = sorted(means.items(), key=lambda x: x[1], reverse=True)
        top = sorted_traits[:2]
        bottom = sorted_traits[-1:]

        for trait, mean in top:
            label = trait.replace("_", "-")
            if mean > 0.7:
                parts.append(f"high {label}")
            elif mean > 0.5:
                parts.append(f"moderate {label}")
        for trait, mean in bottom:
            label = trait.replace("_", "-")
            if mean < 0.3:
                parts.append(f"low {label}")

        if parts:
            narrative = f"Operational profile after {self._traits.session_count} sessions: {', '.join(parts)}."
        else:
            narrative = f"Operational profile developing after {self._traits.session_count} sessions."

        return narrative

    def _load_or_seed(self) -> PersonalityTraitSet:
        """Load from MemoryGraph or create with seed values."""
        stored = self._client.get_memory(f"{NODE_PREFIX_TRAIT_SET}-current")
        if stored:
            try:
                return PersonalityTraitSet.from_dict(json.loads(stored["content"]))
            except (json.JSONDecodeError, KeyError, ValueError):
                logger.warning("Corrupt PersonalityTraitSet, creating from seeds")

        kwargs = {}
        for trait in PERSONALITY_TRAITS:
            a, b = _SEED_VALUES[trait]
            kwargs[f"{trait}_alpha"] = a
            kwargs[f"{trait}_beta"] = b
        kwargs["session_count"] = 0
        kwargs["last_updated"] = datetime.now(timezone.utc)
        kwargs["last_narrative"] = ""
        kwargs["last_narrative_session"] = 0
        return PersonalityTraitSet(**kwargs)

    def _persist(self) -> None:
        """Save to MemoryGraph."""
        params = self._traits.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to persist PersonalityTraitSet")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  /self-assess OUTPUT BUILDER (FR-PER-043)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def build_self_assess_output(
    self_model: Any,
    preference_engine: Any,
    trust_health: Any,
    curiosity: Any,
    personality: PersonalityTracker | None,
) -> str:
    """FR-PER-043: comprehensive self-assessment output.

    Displays all 5 subsystem summaries. Any subsystem can be None
    (graceful degradation for partial initialization).
    """
    sections = []

    # 1. Computed operational state
    if self_model and getattr(self_model, "latest_state", None):
        state = self_model.latest_state
        sections.append(f"## Computed State: {state.primary_state}")
        sections.append(
            f"Mood: {state.mood_valence:+.2f} | "
            f"Confidence: {state.confidence_score:.2f} | "
            f"Arousal: {state.mood_arousal:.2f}"
        )

    # 2. Top preferences
    if preference_engine:
        try:
            prefs = preference_engine.get_strongest(limit=10)
            if prefs:
                sections.append("## Preferences")
                for p in prefs:
                    sections.append(
                        f"- {p.approach} in {p.context_category}: "
                        f"{p.mean:.2f} ({p.evidence_count} observations)"
                    )
        except Exception:
            pass

    # 3. Relationship health
    if trust_health:
        try:
            grade, score, components = trust_health.compute_grade()
            sections.append(f"## Relationship Health: {grade} ({score:.2f})")
            for comp, val in components.items():
                sections.append(f"  {comp}: {val:.2f}")
        except Exception:
            pass

    # 4. Curiosity queue
    if curiosity:
        try:
            queue = curiosity.get_queue(limit=5)
            if queue:
                sections.append("## Curiosity Queue")
                for enc in queue:
                    sections.append(
                        f"- {enc.topic}: score {enc.interest_score:.2f} "
                        f"({enc.signal_type}, {enc.study_sessions} studied)"
                    )
        except Exception:
            pass

    # 5. Personality traits
    if personality:
        means = personality.trait_means
        sections.append("## Personality Traits")
        for trait, mean in means.items():
            bar = "#" * int(mean * 20)
            sections.append(f"  {trait}: {mean:.2f} [{bar}]")
        if personality.latest_narrative:
            sections.append(f"Narrative: {personality.latest_narrative}")

    return "\n".join(sections) if sections else "No personality data available."
