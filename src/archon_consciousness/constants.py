"""Shared constants for the Archon Consciousness Enhancement System.

All enums, limits, and magic values live here. No business logic.
Referenced by: schemas.py, context_descriptor.py, rule_registry.py, and all subsystem modules.
"""

# --- Tier hierarchy (higher index = lower priority) ---
TIERS = ("safety", "ethics", "guidelines", "helpfulness")
TIER_RANK = {tier: idx for idx, tier in enumerate(TIERS)}  # safety=0 (highest)
DEFAULT_TIER = "guidelines"

# --- Rule statuses ---
RULE_STATUSES = ("active", "archived", "deprecated")

# --- Edge types for values DAG ---
EDGE_TYPES = (
    "STRICT_PRIORITY",
    "DEFEASIBLE_PRIORITY",
    "DEFEATS",
    "EVIDENCED_BY",
    "CONTRADICTED_BY",
    "SUPERSEDED_BY",
    "PINNED_BY",
)

# --- Session event types ---
EVENT_TYPES = (
    "correction",
    "decision",
    "state_change",
    "rule_applied",
    "novel_situation_encountered",
)

# --- Emotional states ---
EMOTIONAL_STATES = (
    "frustrated",
    "exploring",
    "in_flow",
    "confused",
    "urgent",
    "neutral",
)

# --- Emotional valence labels ---
EMOTIONAL_VALENCES = ("positive", "negative", "neutral", "mixed")

# --- Intent tiers ---
INTENT_TIERS = ("persistent", "session")

# --- Trend classifications ---
TREND_CLASSIFICATIONS = (
    "improving",
    "stable",
    "regressing",
    "insufficient_data",
    "frozen",
)

# --- Context descriptor modes ---
CONTEXT_MODES = ("pipeline", "manual", "any")

# --- Context descriptor task types ---
CONTEXT_TASK_TYPES = ("coding", "research", "review", "any")

# --- Storage limits ---
MAX_ACTIVE_RULES = 200
MAX_ACTIVE_RULES_WARN = 150
MAX_EPISODES = 1000
MAX_EPISODES_CONSOLIDATION_TRIGGER = 800  # 80% of cap

# --- Rule ID constraints ---
RULE_ID_MAX_LENGTH = 50
RULE_ID_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"  # kebab-case

# --- Episode constraints ---
EPISODE_KEYWORDS_MIN = 0  # fast-path stores empty
EPISODE_KEYWORDS_MAX = 7
IMPORTANCE_MIN = 0.0
IMPORTANCE_MAX = 1.0
IMPORTANCE_DEFAULT = 0.5

# --- Compliance score constraints ---
SCORE_MIN = 0.0
SCORE_MAX = 1.0
SCORE_INITIAL = 0.5

# --- Confidence constraints ---
CONFIDENCE_MIN = 0.0
CONFIDENCE_MAX = 1.0
CONFIDENCE_NEUTRAL_FLOOR = 0.6  # below this, default to neutral

# --- MemoryGraph node type prefixes (for name generation) ---
NODE_PREFIX_EPISODE = "episode"
NODE_PREFIX_PATTERN_SCORE = "patternscore"
NODE_PREFIX_VALUES_NODE = "valuesnode"
NODE_PREFIX_EMOTIONAL_STATE = "emotionalstate"
NODE_PREFIX_REFLECTION = "reflection"
NODE_PREFIX_INTENT = "intent"
NODE_PREFIX_SESSION_EVENT = "sessionevent"

# --- MemoryGraph tags for consciousness nodes ---
CONSCIOUSNESS_TAG = "archon-consciousness"

# --- Deprecation chain limit ---
MAX_SUPERSESSION_CHAIN_DEPTH = 5

# --- DAG traversal limit ---
MAX_TRAVERSAL_DEPTH = 10

# --- Stop words for rule_id generation ---
RULE_ID_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "ought",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
    "they", "them", "their", "this", "that", "these", "those",
    "and", "but", "or", "nor", "not", "no", "so", "if", "then",
    "for", "of", "in", "on", "at", "to", "by", "with", "from",
    "up", "out", "off", "over", "under", "again", "further",
    "when", "where", "why", "how", "what", "which", "who", "whom",
    "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "than", "too", "very",
    "just", "about", "above", "after", "before", "between", "into",
    "through", "during", "without", "also", "always", "never",
})
