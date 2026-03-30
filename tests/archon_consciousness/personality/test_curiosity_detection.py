"""Tests for automated curiosity gap detection — behavioral + LLM introspection.

Two detection mechanisms:
1. Behavioral: daemon detects gap signals from event patterns (no LLM)
2. Introspection: phase-check outputs self-evaluation prompt (LLM reads & flags)

AC-010 | FR-PER-026
"""

import json
import pytest


class TestBehavioralGapDetection:
    """Daemon detects knowledge gaps from tool call patterns."""

    def test_repeated_web_search_flags_gap(self, mock_graph):
        from src.archon_consciousness.personality.personality_daemon import (
            DaemonState, detect_behavioral_gaps,
        )
        state = DaemonState(client=mock_graph)
        events = [
            {"tool": "WebSearch", "target": "HNSW index configuration"},
            {"tool": "WebSearch", "target": "HNSW index tuning parameters"},
            {"tool": "WebSearch", "target": "HNSW ef_construction setting"},
        ]
        gaps = detect_behavioral_gaps(events)
        assert len(gaps) >= 1
        assert any("hnsw" in g["topic"].lower() for g in gaps)

    def test_two_searches_not_enough(self, mock_graph):
        from src.archon_consciousness.personality.personality_daemon import (
            DaemonState, detect_behavioral_gaps,
        )
        events = [
            {"tool": "WebSearch", "target": "pytest fixtures"},
            {"tool": "WebSearch", "target": "pytest parametrize"},
        ]
        gaps = detect_behavioral_gaps(events)
        # 2 searches on similar topic — not enough to flag (threshold is 3)
        assert len(gaps) == 0

    def test_many_reads_before_edit_flags_exploration(self, mock_graph):
        from src.archon_consciousness.personality.personality_daemon import (
            DaemonState, detect_behavioral_gaps,
        )
        events = [
            {"tool": "Read", "target": "src/unfamiliar/module_a.py"},
            {"tool": "Read", "target": "src/unfamiliar/module_b.py"},
            {"tool": "Read", "target": "src/unfamiliar/module_c.py"},
            {"tool": "Read", "target": "src/unfamiliar/module_d.py"},
            {"tool": "Read", "target": "src/unfamiliar/module_e.py"},
            {"tool": "Edit", "target": "src/unfamiliar/module_a.py"},
        ]
        gaps = detect_behavioral_gaps(events)
        assert len(gaps) >= 1
        assert any("unfamiliar" in g["topic"].lower() or "exploration" in g["signal_type"]
                    for g in gaps)

    def test_test_failure_cycle_flags_struggling(self, mock_graph):
        from src.archon_consciousness.personality.personality_daemon import (
            DaemonState, detect_behavioral_gaps,
        )
        events = [
            {"tool": "Edit", "target": "src/parser.py"},
            {"tool": "Bash", "target": "python -m pytest", "exit_code": 1},
            {"tool": "Edit", "target": "src/parser.py"},
            {"tool": "Bash", "target": "python -m pytest", "exit_code": 1},
            {"tool": "Edit", "target": "src/parser.py"},
            {"tool": "Bash", "target": "python -m pytest", "exit_code": 1},
        ]
        gaps = detect_behavioral_gaps(events)
        assert len(gaps) >= 1
        assert any("parser" in g["topic"].lower() or g["signal_type"] == "prediction_failure"
                    for g in gaps)

    def test_no_patterns_no_gaps(self, mock_graph):
        from src.archon_consciousness.personality.personality_daemon import (
            DaemonState, detect_behavioral_gaps,
        )
        events = [
            {"tool": "Write", "target": "src/new_file.py"},
            {"tool": "Bash", "target": "python -m pytest"},
            {"tool": "Read", "target": "src/existing.py"},
        ]
        gaps = detect_behavioral_gaps(events)
        assert len(gaps) == 0

    def test_web_fetch_counts_as_search(self, mock_graph):
        from src.archon_consciousness.personality.personality_daemon import (
            DaemonState, detect_behavioral_gaps,
        )
        events = [
            {"tool": "WebFetch", "target": "https://docs.python.org/asyncio"},
            {"tool": "WebSearch", "target": "python asyncio gather vs wait"},
            {"tool": "WebFetch", "target": "https://docs.python.org/asyncio/tasks"},
        ]
        gaps = detect_behavioral_gaps(events)
        assert len(gaps) >= 1


class TestPhaseCheckSelfEvaluation:
    """Phase-check outputs self-evaluation prompt for LLM introspection."""

    def test_phase_check_includes_self_eval_prompt(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import (
            format_self_eval_prompt,
        )
        prompt = format_self_eval_prompt(action_count=15, correction_count=2)
        assert "self-evaluate" in prompt.lower() or "knowledge gap" in prompt.lower()
        assert "personality-curiosity.jsonl" in prompt

    def test_prompt_includes_instruction_to_flag(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import (
            format_self_eval_prompt,
        )
        prompt = format_self_eval_prompt(action_count=10, correction_count=0)
        assert "echo" in prompt  # instruction to write to file
        assert "knowledge_gap" in prompt
