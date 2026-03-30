"""Emotional state detector for Archon Consciousness.

Detects user emotional state from text signals using rule-based
heuristics (no ML). Preprocesses messages to strip code/quotes/URLs,
extracts 5 signals, classifies into 6 states, and maps to
communication parameters.

Implements FR-CON-005, FR-CON-006, FR-CON-007.
GUARD-CON-001: No HTTP/external API calls.
GUARD-CON-006: Default to neutral when confidence < 0.6.
GUARD-CON-009: Never surface detection to user.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from src.archon_consciousness.constants import CONFIDENCE_NEUTRAL_FLOOR

# ─── Lexicons (FR-CON-005) ─────────────────────────────────────────

FRUSTRATION_LEXICON = frozenset({
    "broken", "stuck", "again", "wtf", "wrong", "annoying", "frustrated",
    "ugh", "sigh", "keeps", "failing", "still", "seriously",
    "ridiculous", "unacceptable", "terrible", "awful",
})
# Multi-word entries handled separately (18 singles + 3 phrases = 21, trimmed to 20 by PRD)
FRUSTRATION_PHRASES = ("doesn't work", "what the hell", "come on")

URGENCY_LEXICON = frozenset({
    "asap", "urgent", "critical", "hotfix", "immediately", "deadline",
    "blocking", "priority", "emergency", "hurry", "rush", "today", "now",
    "quick", "fast",
})
URGENCY_PHRASES = ("production down", "ship it", "right now", "before eod", "time-sensitive")

CONFUSION_LEXICON = frozenset({
    "confused", "unclear", "lost", "huh", "ambiguous", "conflicting",
    "mismatch", "explain", "contradicts",
})
CONFUSION_PHRASES = (
    "don't understand", "what do you mean", "makes no sense", "which one",
    "not sure", "wait what", "i thought", "how does", "why would",
    "that doesn't", "i expected",
)

# ─── Preprocessing ─────────────────────────────────────────────────

_FENCED_CODE_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_INLINE_CODE_RE = re.compile(r"`[^`]+`")
_BLOCKQUOTE_RE = re.compile(r"^>.*$", re.MULTILINE)
_URL_RE = re.compile(r"https?://\S+")


def preprocess(text: str) -> str:
    """Strip code blocks, inline code, blockquotes, and URLs."""
    text = _FENCED_CODE_RE.sub("", text)
    text = _INLINE_CODE_RE.sub("", text)
    text = _BLOCKQUOTE_RE.sub("", text)
    text = _URL_RE.sub("", text)
    return text.strip()


# ─── Signal Vector ─────────────────────────────────────────────────


@dataclass
class SignalVector:
    """5 text signals extracted from a preprocessed message."""
    message_brevity: bool = False
    length_delta: float = 0.0
    punctuation_density: float = 0.0
    question_frequency: float = 0.0
    sentiment_counts: dict = field(default_factory=lambda: {
        "frustration": 0, "urgency": 0, "confusion": 0,
    })


def extract_signals(text: str, message_history: list[str]) -> SignalVector:
    """Extract 5 signals from preprocessed text + message history."""
    cleaned = preprocess(text)
    words = cleaned.split()
    word_count = len(words)
    lower_text = cleaned.lower()

    # Rolling average from history
    history_lengths = [len(preprocess(m).split()) for m in message_history[-5:]]
    rolling_avg = sum(history_lengths) / max(1, len(history_lengths)) if history_lengths else 0.0

    # Signal 1: message_brevity
    brevity = word_count < 10 and rolling_avg > 30

    # Signal 2: length_delta (normalized deviation)
    delta = (word_count - rolling_avg) / max(1.0, rolling_avg) if rolling_avg > 0 else 0.0

    # Signal 3: punctuation_density
    exclamation_count = cleaned.count("!")
    caps_words = sum(1 for w in words if w.isupper() and len(w) > 1)
    punct_density = (exclamation_count + caps_words) / max(1, word_count)

    # Signal 4: question_frequency
    question_count = float(cleaned.count("?"))

    # Signal 5: sentiment word matches
    frustration = _count_matches(lower_text, FRUSTRATION_LEXICON, FRUSTRATION_PHRASES)
    urgency = _count_matches(lower_text, URGENCY_LEXICON, URGENCY_PHRASES)
    confusion = _count_matches(lower_text, CONFUSION_LEXICON, CONFUSION_PHRASES)

    return SignalVector(
        message_brevity=brevity,
        length_delta=delta,
        punctuation_density=punct_density,
        question_frequency=question_count,
        sentiment_counts={"frustration": frustration, "urgency": urgency, "confusion": confusion},
    )


def _count_matches(text: str, lexicon: frozenset, phrases: tuple) -> int:
    """Count lexicon word matches + phrase matches in text."""
    count = 0
    text_words = set(text.split())
    for word in lexicon:
        if word in text_words:
            count += 1
    for phrase in phrases:
        if phrase in text:
            count += 1
    return count


# ─── Classification ────────────────────────────────────────────────

_STATE_WEIGHTS = {
    "frustrated": {"punct": 0.25, "sentiment_f": 0.40, "brevity": 0.15, "neg_delta": 0.20},
    "confused": {"questions": 0.30, "sentiment_c": 0.35, "pos_delta": 0.15, "no_brevity": 0.20},
    "urgent": {"sentiment_u": 0.50, "brevity": 0.25, "low_questions": 0.25},
    "in_flow": {"brevity": 0.30, "consistent": 0.30, "no_sentiment": 0.20, "low_questions": 0.20},
    "exploring": {"pos_delta": 0.25, "questions": 0.30, "no_frustration": 0.20, "no_brevity": 0.25},
}


def classify_state(signals: SignalVector) -> tuple[str, float]:
    """Classify emotional state from signal vector.

    Returns (state, confidence). confidence < 0.6 → ("neutral", confidence).
    """
    scores = _compute_state_scores(signals)
    best_state = max(scores, key=lambda k: scores[k])
    confidence = scores[best_state]
    if confidence < CONFIDENCE_NEUTRAL_FLOOR:
        return "neutral", confidence
    return best_state, confidence


def _compute_state_scores(s: SignalVector) -> dict[str, float]:
    """Compute weighted score for each state from signals."""
    total_sent = sum(s.sentiment_counts.values())
    brevity_f = 1.0 if s.message_brevity else 0.0
    no_brevity_f = 0.3 if not s.message_brevity else 0.0
    return {
        "frustrated": (
            0.25 * min(1.0, s.punctuation_density * 5.0)
            + 0.40 * min(1.0, s.sentiment_counts["frustration"] / 2.0)
            + 0.15 * brevity_f
            + 0.20 * min(1.0, max(0.0, -s.length_delta))
        ),
        "confused": (
            0.30 * min(1.0, s.question_frequency / 2.0)
            + 0.35 * min(1.0, s.sentiment_counts["confusion"] / 2.0)
            + 0.15 * min(1.0, max(0.0, s.length_delta))
            + 0.20 * no_brevity_f
        ),
        "urgent": (
            0.50 * min(1.0, s.sentiment_counts["urgency"] / 2.0)
            + 0.25 * brevity_f
            + 0.25 * max(0.0, 1.0 - s.question_frequency / 2.0)
        ),
        "in_flow": (
            0.30 * brevity_f
            + 0.30 * max(0.0, 1.0 - abs(s.length_delta) * 2.0)
            + 0.20 * max(0.0, 1.0 - total_sent / 2.0)
            + 0.20 * max(0.0, 1.0 - s.question_frequency / 2.0)
        ),
        "exploring": (
            0.25 * min(1.0, max(0.0, s.length_delta))
            + 0.30 * min(1.0, s.question_frequency / 2.0)
            + 0.20 * max(0.0, 1.0 - s.sentiment_counts["frustration"] / 2.0)
            + 0.25 * no_brevity_f
        ),
    }


# ─── Communication Parameters (FR-CON-007) ─────────────────────────

_COMMUNICATION_PARAMS = {
    "frustrated": {
        "override": True, "max_sentences": 3,
        "acknowledge_friction": True, "unsolicited_suggestions": False,
        "questions": False, "preamble": True,
        "use_numbered_lists": False, "clarifying_questions": 0,
        "offer_alternatives": False, "action_first": False,
        "explanations": True,
    },
    "in_flow": {
        "override": True, "max_sentences": 1,
        "acknowledge_friction": False, "unsolicited_suggestions": False,
        "questions": False, "preamble": False,
        "use_numbered_lists": False, "clarifying_questions": 0,
        "offer_alternatives": False, "action_first": False,
        "explanations": False,
    },
    "confused": {
        "override": True, "max_sentences": 10,
        "acknowledge_friction": False, "unsolicited_suggestions": False,
        "questions": True, "preamble": True,
        "use_numbered_lists": True, "clarifying_questions": 1,
        "offer_alternatives": False, "action_first": False,
        "explanations": True,
    },
    "exploring": {
        "override": True, "max_sentences": 10,
        "acknowledge_friction": False, "unsolicited_suggestions": True,
        "questions": True, "preamble": True,
        "use_numbered_lists": False, "clarifying_questions": 0,
        "offer_alternatives": True, "action_first": False,
        "explanations": True,
    },
    "urgent": {
        "override": True, "max_sentences": 5,
        "acknowledge_friction": False, "unsolicited_suggestions": False,
        "questions": False, "preamble": False,
        "use_numbered_lists": False, "clarifying_questions": 0,
        "offer_alternatives": False, "action_first": True,
        "explanations": False,
    },
    "neutral": {
        "override": False, "max_sentences": 0,
        "acknowledge_friction": False, "unsolicited_suggestions": False,
        "questions": True, "preamble": True,
        "use_numbered_lists": False, "clarifying_questions": 0,
        "offer_alternatives": False, "action_first": False,
        "explanations": True,
    },
}


def get_communication_params(state: str) -> dict:
    """Get communication parameters for a given state."""
    return dict(_COMMUNICATION_PARAMS.get(state, _COMMUNICATION_PARAMS["neutral"]))


# ─── Detector Class ────────────────────────────────────────────────


class EmotionalStateDetector:
    """Detects user emotional state from text signals.

    Maintains a message history for rolling-average computation.
    First message always returns neutral (EC-CON-003).
    """

    def __init__(self, logger=None):
        self._logger = logger
        self._history: list[str] = []
        self._current_state: str = "neutral"

    def detect(self, message: str) -> tuple[str, float, dict]:
        """Detect emotional state from a message.

        Returns (state, confidence, communication_params).
        First message always returns neutral.
        """
        # EC-CON-003: first message → neutral (no baseline)
        if len(self._history) == 0:
            self._history.append(message)
            params = get_communication_params("neutral")
            return "neutral", 0.0, params

        signals = extract_signals(message, self._history)
        state, confidence = classify_state(signals)
        params = get_communication_params(state)

        # Log transition if state changed
        if state != self._current_state and self._logger:
            self._logger.log_transition(
                self._current_state, state, confidence,
                f"Signals: brevity={signals.message_brevity}, "
                f"punct={signals.punctuation_density:.2f}, "
                f"questions={signals.question_frequency}, "
                f"sentiment={signals.sentiment_counts}",
            )

        self._current_state = state
        self._history.append(message)
        return state, confidence, params

    def reset(self) -> None:
        """Force state to neutral and clear history (EC-CON-011)."""
        self._current_state = "neutral"
        self._history.clear()
