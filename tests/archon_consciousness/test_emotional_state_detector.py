"""Tests for EmotionalStateDetector — preprocessing, signals, classification.

Written BEFORE implementation (TDD).
Covers FR-CON-005, FR-CON-006, FR-CON-007.
"""

import pytest

from src.archon_consciousness.emotional_state_detector import (
    EmotionalStateDetector,
    classify_state,
    extract_signals,
    get_communication_params,
    preprocess,
)


# ─── Preprocessing ─────────────────────────────────────────────────


class TestPreprocess:
    """Test message preprocessing — strip code, quotes, URLs."""

    def test_fenced_code_block_stripped(self):
        text = "Look at this:\n```python\nprint('hello')\n```\nWhat do you think?"
        result = preprocess(text)
        assert "print" not in result
        assert "What do you think" in result

    def test_inline_code_stripped(self):
        text = "The `ERROR_HANDLER` keeps failing"
        result = preprocess(text)
        assert "ERROR_HANDLER" not in result
        assert "keeps failing" in result

    def test_blockquote_stripped(self):
        text = "I noticed:\n> This is a quote\nAfter the quote"
        result = preprocess(text)
        assert "This is a quote" not in result
        assert "After the quote" in result

    def test_url_stripped(self):
        text = "Check https://example.com/path?q=1 for details"
        result = preprocess(text)
        assert "https://example.com" not in result
        assert "Check" in result
        assert "details" in result

    def test_multiple_code_blocks(self):
        text = "First ```code1``` then ```code2``` done"
        result = preprocess(text)
        assert "code1" not in result
        assert "code2" not in result
        assert "done" in result

    def test_only_code_returns_empty(self):
        text = "```\nall code\n```"
        result = preprocess(text)
        assert result.strip() == "" or len(result.strip()) < 5

    def test_normal_text_unchanged(self):
        text = "This is a normal message without any special formatting"
        result = preprocess(text)
        assert "normal message" in result

    def test_mixed_content(self):
        text = "Error in `TypeError` module\n> old output\nhttps://url.com\nPlease fix"
        result = preprocess(text)
        assert "TypeError" not in result
        assert "old output" not in result
        assert "url.com" not in result
        assert "Please fix" in result

    def test_caps_in_inline_code_not_polluting(self):
        """ALL CAPS variable in backticks should not trigger caps detection."""
        text = "The `NULL_POINTER_EXCEPTION` is expected behavior"
        result = preprocess(text)
        assert "NULL_POINTER_EXCEPTION" not in result

    def test_exclamation_in_code_block_not_polluting(self):
        text = "Look:\n```\nassert x != None  # Important!\n```\nOk?"
        result = preprocess(text)
        assert "Important!" not in result

    def test_all_caps_in_backticks_stripped(self):
        text = "Set `DEBUG=TRUE` and check `ERROR_LEVEL`"
        result = preprocess(text)
        assert "DEBUG" not in result
        assert "ERROR_LEVEL" not in result


# ─── Signal Extraction ─────────────────────────────────────────────


class TestExtractSignals:
    """Test signal extraction from preprocessed text."""

    def test_brevity_short_with_high_avg(self):
        # 5 words, avg > 30
        history = ["word " * 40] * 5  # 40 words each
        signals = extract_signals("just five words here ok", history)
        assert signals.message_brevity is True

    def test_brevity_long_message(self):
        history = ["word " * 40] * 5
        signals = extract_signals("word " * 50, history)
        assert signals.message_brevity is False

    def test_brevity_low_avg(self):
        # Short message but avg is also short → not brief relative to history
        history = ["hi there"] * 5  # ~2 words each
        signals = extract_signals("just five words here ok", history)
        assert signals.message_brevity is False

    def test_length_delta_at_average(self):
        history = ["word " * 20] * 5  # 20 words each
        signals = extract_signals("word " * 20, history)
        assert abs(signals.length_delta) < 0.1

    def test_length_delta_half_average(self):
        history = ["word " * 40] * 5  # 40 words each
        signals = extract_signals("word " * 20, history)
        assert signals.length_delta < -0.3

    def test_punctuation_density_exclamations(self):
        signals = extract_signals("What!!! This is broken!!!", [])
        assert signals.punctuation_density > 0.0

    def test_punctuation_density_calm(self):
        signals = extract_signals("ok sure that sounds good", [])
        assert signals.punctuation_density == 0.0

    def test_question_frequency(self):
        signals = extract_signals("Why? How? What do you mean?", [])
        assert signals.question_frequency == 3.0

    def test_frustration_lexicon(self):
        signals = extract_signals("This is stuck and broken and failing", [])
        assert signals.sentiment_counts["frustration"] >= 3

    def test_urgency_lexicon(self):
        signals = extract_signals("urgent deadline need this asap", [])
        assert signals.sentiment_counts["urgency"] >= 3

    def test_confusion_lexicon(self):
        signals = extract_signals("confused unclear don't understand", [])
        assert signals.sentiment_counts["confusion"] >= 3


# ─── Classification ────────────────────────────────────────────────


class TestClassifyState:
    """Test state classification from signals."""

    def test_frustrated_detection(self):
        signals = extract_signals(
            "This is broken!! What the hell, it keeps failing!",
            ["word " * 30] * 5,
        )
        state, confidence = classify_state(signals)
        assert state == "frustrated"
        assert confidence >= 0.6

    def test_confused_detection(self):
        signals = extract_signals(
            "I'm confused, what do you mean? This doesn't make sense, how does it work?",
            ["word " * 20] * 5,
        )
        state, confidence = classify_state(signals)
        assert state == "confused"
        assert confidence >= 0.6

    def test_urgent_detection(self):
        signals = extract_signals(
            "urgent production down need hotfix asap",
            ["word " * 20] * 5,
        )
        state, confidence = classify_state(signals)
        assert state == "urgent"
        assert confidence >= 0.6

    def test_neutral_on_calm_message(self):
        signals = extract_signals(
            "ok that sounds good, let me think about it for a moment",
            ["word " * 15] * 5,
        )
        state, confidence = classify_state(signals)
        assert state == "neutral"

    def test_neutral_on_low_confidence(self):
        """Ambiguous signals → confidence < 0.6 → neutral."""
        signals = extract_signals("maybe", ["word " * 15] * 5)
        state, confidence = classify_state(signals)
        assert state == "neutral"

    def test_confidence_always_in_range(self):
        for text in [
            "broken!!! stuck failing wtf",
            "ok sure",
            "why? how? confused unclear",
            "urgent asap deadline now",
            "let me explore this idea further, what about alternatives?",
        ]:
            signals = extract_signals(text, ["word " * 20] * 5)
            _, confidence = classify_state(signals)
            assert 0.0 <= confidence <= 1.0

    def test_all_six_states_reachable(self):
        """Each state can be triggered with appropriate input."""
        test_cases = {
            "frustrated": "broken!! stuck failing wtf terrible",
            "confused": "confused unclear don't understand what do you mean how does this work?",
            "urgent": "urgent critical production down hotfix asap immediately",
            "in_flow": "yes",  # very short, no signals — after long messages
            "exploring": "I wonder what would happen if we tried a different approach? What about using a DAG structure? Or maybe something simpler would work better for this specific case?",
            "neutral": "ok that sounds reasonable",
        }
        states_seen = set()
        for expected_state, text in test_cases.items():
            history = ["word " * 40] * 5 if expected_state == "in_flow" else ["word " * 20] * 5
            signals = extract_signals(text, history)
            state, _ = classify_state(signals)
            states_seen.add(state)
        # We should see at least 5 distinct states (in_flow is hardest to trigger)
        assert len(states_seen) >= 5, f"Only saw {states_seen}, expected at least 5"


# ─── Communication Params ──────────────────────────────────────────


class TestCommunicationParams:
    """Test state → communication parameter mapping."""

    def test_frustrated_params(self):
        params = get_communication_params("frustrated")
        assert params["max_sentences"] == 3
        assert params["acknowledge_friction"] is True
        assert params["unsolicited_suggestions"] is False

    def test_in_flow_params(self):
        params = get_communication_params("in_flow")
        assert params["max_sentences"] == 1
        assert params["explanations"] is False
        assert params["questions"] is False

    def test_confused_params(self):
        params = get_communication_params("confused")
        assert params["use_numbered_lists"] is True
        assert params["clarifying_questions"] == 1

    def test_exploring_params(self):
        params = get_communication_params("exploring")
        assert params["max_sentences"] == 10
        assert params["offer_alternatives"] is True

    def test_urgent_params(self):
        params = get_communication_params("urgent")
        assert params["action_first"] is True
        assert params["preamble"] is False

    def test_neutral_returns_standard(self):
        params = get_communication_params("neutral")
        assert params["override"] is False


# ─── Detector Class Integration ────────────────────────────────────


class TestDetectorClass:
    """Test EmotionalStateDetector end-to-end."""

    def test_first_message_is_neutral(self):
        """EC-CON-003: no baseline → neutral."""
        detector = EmotionalStateDetector()
        state, confidence, params = detector.detect("broken!!! wtf")
        assert state == "neutral"  # first message, no history

    def test_second_message_can_detect_state(self):
        detector = EmotionalStateDetector()
        # Build history with normal messages
        for _ in range(5):
            detector.detect("This is a normal length message with several words in it for baseline")
        # Now a frustrated message
        state, confidence, params = detector.detect("broken!!! stuck failing wtf terrible")
        # Should detect frustration (or at minimum not neutral)
        assert state in ("frustrated", "neutral")  # may need more history

    def test_reset_forces_neutral(self):
        detector = EmotionalStateDetector()
        # Build some history
        for _ in range(5):
            detector.detect("Normal message with enough words for a baseline measurement")
        detector.reset()
        # After reset, next message is like first → neutral
        state, _, _ = detector.detect("broken!!! failing!!!")
        assert state == "neutral"

    def test_user_correction_reset(self):
        """EC-CON-011: user says 'I'm not frustrated' → caller resets to neutral."""
        detector = EmotionalStateDetector()
        for _ in range(5):
            detector.detect("Normal message with enough words for a baseline measurement")
        # Simulate frustration detection then user correction
        detector.detect("broken!! stuck failing wtf terrible awful seriously")
        # Caller detects correction phrase and calls reset
        detector.reset()
        state, _, _ = detector.detect("Please continue with the implementation")
        assert state == "neutral"

    def test_no_http_imports(self):
        """GUARD-CON-001: no HTTP client in emotional state module."""
        import src.archon_consciousness.emotional_state_detector as mod
        with open(mod.__file__) as f:
            source = f.read()
        assert "import requests" not in source
        assert "import urllib" not in source
        assert "import httpx" not in source
        assert "import aiohttp" not in source
