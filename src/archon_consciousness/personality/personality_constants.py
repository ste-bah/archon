"""Constants and validation helpers for the personality subsystem.

All enums, thresholds, weights, namespace paths, and node prefixes.
No business logic. Personality-specific validators extend v1 validation.py.

TASK-PER-001 | PRD-ARCHON-CON-002 v1.3
"""

import math

from src.archon_consciousness.validation import validate_nonempty_str

# ── Agent states (FR-PER-003) ─────────────────────────────────────

AGENT_STATES = frozenset({
    "confident", "anxious", "frustrated", "engaged", "cautious", "neutral",
})
NEUTRAL_THRESHOLD = 0.4

# ── State classifier weights (FR-PER-003) ─────────────────────────

STATE_WEIGHTS = {
    "confident": {
        "task_completion": 0.30, "plan_approval": 0.25, "past_success": 0.20,
        "inv_correction_rate": 0.15, "streak_bonus": 0.10,
    },
    "anxious": {
        "inv_past_success": 0.35, "correction_rate": 0.25,
        "pattern_regression": 0.20, "streak_penalty": 0.20,
    },
    "frustrated": {
        "correction_rate": 0.30, "streak_penalty": 0.25,
        "user_frustrated": 0.25, "inv_plan_approval": 0.20,
    },
    "engaged": {
        "novelty": 0.30, "plan_approval": 0.25,
        "user_in_flow": 0.25, "task_completion": 0.20,
    },
    "cautious": {
        "ambiguity": 0.35, "values_conflict": 0.25,
        "inv_past_success": 0.20, "correction_rate_high": 0.20,
    },
}

# ── Mood parameters (FR-PER-004) ──────────────────────────────────

MOOD_THRESHOLD_ADJUSTMENT = 0.05
MOOD_EWMA_ALPHA = 0.3

# ── Dampening (FR-PER-007) ────────────────────────────────────────

DAMPENING_RATE = 0.10
DAMPENING_FLOOR = 0.50

# ── Somatic markers (FR-PER-005) ──────────────────────────────────

SOMATIC_MIN_EPISODES = 5

# ── Trust parameters (FR-PER-017, FR-PER-018) ─────────────────────

TRUST_DIMENSION_WEIGHTS = {
    "competence": 0.30, "integrity": 0.45, "benevolence": 0.25,
}
TRUST_GAMMA_DEFAULT = 0.95
TRUST_GAMMA_INTEGRITY = 0.92
TRUST_INITIAL_ALPHA = 2.0
TRUST_INITIAL_BETA = 1.0

TRUST_DIMENSIONS = frozenset({"competence", "integrity", "benevolence"})

# ── Trust asymmetric weights (FR-PER-018) ─────────────────────────

W_SUCCESS = 1.0
W_FAILURE_MINOR = 1.5
W_FAILURE_MAJOR = 3.0
W_FAILURE_REPEAT = 5.0

# ── Violation types (FR-PER-019) ──────────────────────────────────

VIOLATION_TYPES = frozenset({
    "factual_error", "approach_correction", "repeated_instruction",
    "did_forbidden_action", "acted_without_permission", "repeated_correction",
})

REPAIR_LEVELS = frozenset({
    "acknowledge", "explain", "full_repair", "critical_repair",
})

REPAIR_SEVERITY_THRESHOLDS = [
    (5.0, "critical_repair"),
    (3.0, "full_repair"),
    (1.5, "explain"),
]  # default below 1.5 is "acknowledge"

# ── Preference parameters (FR-PER-009, FR-PER-012) ────────────────

PREFERENCE_COLD_START_THRESHOLD = 5
PREFERENCE_DECAY_HALF_LIFE_DAYS = 30
PREFERENCE_DECAY_LAMBDA = 30.0 / math.log(2)  # ~43.3
PREFERENCE_ALPHA_FLOOR = 1.0
PREFERENCE_BETA_FLOOR = 1.0
PREFERENCE_CERTAINTY_OVERRIDE = 20
MERE_EXPOSURE_DECAY = 0.999

# ── Curiosity parameters (FR-PER-026, FR-PER-027, FR-PER-029) ─────

CURIOSITY_SIGNAL_TYPES = frozenset({
    "knowledge_gap", "repeated_unfamiliarity", "prediction_failure",
    "surprising_success", "conceptual_adjacency",
})
CURIOSITY_MAX_PER_SESSION = 3
CURIOSITY_LEARN_BUDGET_FRACTION = 0.20
CURIOSITY_SUPPRESSION_THRESHOLD = 3

# ── Metacognition parameters (FR-PER-036, FR-PER-037) ─────────────

EPISODE_SIMILARITY_THRESHOLD = 0.85
INTERRUPT_MAX_PER_WINDOW = 3
INTERRUPT_WINDOW_SIZE = 20
INTERRUPT_SOFT_THRESHOLD = 0.6
INTERRUPT_ESCALATED_THRESHOLD = 0.8
TRIGGER_SOURCES = frozenset({
    "episode_match", "rule_violation", "revert_cycle",
    "action_anomaly", "confidence_drop", "error_repeat",
    "soft_composite",
})
INTERRUPT_CHANNELS = frozenset({"fast", "slow"})
INTERRUPT_TRIGGER_TYPES = frozenset({"hard", "soft"})

# ── Personality parameters (FR-PER-045) ───────────────────────────

PERSONALITY_TRAITS = (
    "openness", "conscientiousness", "extraversion",
    "agreeableness", "neuroticism", "honesty_humility",
)
PERSONALITY_GAMMA = 0.98
PERSONALITY_MAX_DELTA = 0.05
PERSONALITY_NARRATIVE_INTERVAL = 10

# ── Health grade thresholds (FR-PER-022) ──────────────────────────

HEALTH_GRADE_THRESHOLDS = [
    (0.93, "A+"), (0.85, "A"), (0.80, "A-"), (0.73, "B+"),
    (0.65, "B"), (0.60, "B-"), (0.50, "C"), (0.40, "D"),
]  # < 0.40 = "F"

# ── MemoryGraph namespaces (FR-PER-044) ───────────────────────────

NAMESPACE_SELF_STATE = "archon/personality/self-state"
NAMESPACE_PREFERENCES = "archon/personality/preferences"
NAMESPACE_PREFERENCES_ARTICULATED = "archon/personality/preferences/articulated"
NAMESPACE_TRUST = "archon/personality/trust"
NAMESPACE_TRUST_TRENDS = "archon/personality/trust/trends"
NAMESPACE_TRUST_VIOLATIONS = "archon/personality/trust/violations"
NAMESPACE_CURIOSITY_ENCOUNTERS = "archon/personality/curiosity/encounters"
NAMESPACE_CURIOSITY_QUEUE = "archon/personality/curiosity/queue"
NAMESPACE_METACOGNITION = "archon/personality/metacognition"
NAMESPACE_TRAITS = "archon/personality/traits"
NAMESPACE_NARRATIVE = "archon/personality/narrative"
NAMESPACE_OUTCOMES = "archon/personality/outcomes"

# ── Node name prefixes ────────────────────────────────────────────

NODE_PREFIX_SELF_STATE = "selfstate"
NODE_PREFIX_OUTCOME = "outcome"
NODE_PREFIX_PREFERENCE = "preference"
NODE_PREFIX_TRUST_STATE = "truststate"
NODE_PREFIX_TRUST_VIOLATION = "trustviol"
NODE_PREFIX_CURIOSITY = "curiosity"
NODE_PREFIX_INTERRUPT = "interrupt"
NODE_PREFIX_TRAIT_SET = "traitset"

# ── Tags ──────────────────────────────────────────────────────────

PERSONALITY_TAG = "archon-personality"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  VALIDATION HELPERS (personality-specific extensions)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def validate_beta_param(value, name: str) -> None:
    """Validate a Beta distribution parameter: float >= 1.0, no NaN/Inf."""
    if isinstance(value, bool):
        raise TypeError(f"{name} must be float, got bool")
    if not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be float, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{name} must be finite, got {value}")
    if value < 1.0:
        raise ValueError(f"{name} must be >= 1.0, got {value}")


def validate_signed_float(value, name: str, min_val: float, max_val: float) -> None:
    """Validate a signed float: handles [-1, 1] and other ranges."""
    if isinstance(value, bool):
        raise TypeError(f"{name} must be float, got bool")
    if not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be float, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{name} must be finite, got {value}")
    if value < min_val or value > max_val:
        raise ValueError(f"{name} must be in [{min_val}, {max_val}], got {value}")


def validate_positive_float(value, name: str) -> None:
    """Validate float > 0 (for severity etc.)."""
    if isinstance(value, bool):
        raise TypeError(f"{name} must be float, got bool")
    if not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be float, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{name} must be finite, got {value}")
    if value <= 0:
        raise ValueError(f"{name} must be > 0, got {value}")


def validate_max_length_str(value, name: str, max_len: int) -> None:
    """Validate non-empty string with max length."""
    validate_nonempty_str(value, name)
    if len(value) > max_len:
        raise ValueError(f"{name} must be <= {max_len} chars, got {len(value)}")


def validate_bounded_str(value, name: str, max_len: int) -> None:
    """Validate string (may be empty) with max length."""
    if not isinstance(value, str):
        raise TypeError(f"{name} must be str, got {type(value).__name__}")
    if len(value) > max_len:
        raise ValueError(f"{name} must be <= {max_len} chars, got {len(value)}")


def validate_dict_field(value, name: str) -> None:
    """Validate that a field is a dict."""
    if not isinstance(value, dict):
        raise TypeError(f"{name} must be dict, got {type(value).__name__}")
