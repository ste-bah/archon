"""Tests for preference outcome inference from events.

TASK-GAP-004 | FR-PER-015
"""

import pytest


class TestApproachInference:

    def test_tdd_detected(self):
        from src.archon_consciousness.personality.session_end_runner import infer_approach
        events = [
            {"tool": "Write", "target": "tests/test_parser.py"},
            {"tool": "Write", "target": "src/parser.py"},
            {"tool": "Bash", "target": "python -m pytest"},
        ]
        assert infer_approach(events) == "tdd"

    def test_impl_first_detected(self):
        from src.archon_consciousness.personality.session_end_runner import infer_approach
        events = [
            {"tool": "Write", "target": "src/parser.py"},
            {"tool": "Edit", "target": "src/parser.py"},
            {"tool": "Write", "target": "tests/test_parser.py"},
        ]
        assert infer_approach(events) == "impl-first"

    def test_no_tests_returns_unknown(self):
        from src.archon_consciousness.personality.session_end_runner import infer_approach
        events = [
            {"tool": "Write", "target": "src/parser.py"},
            {"tool": "Edit", "target": "src/parser.py"},
        ]
        assert infer_approach(events) == "unknown"

    def test_empty_returns_unknown(self):
        from src.archon_consciousness.personality.session_end_runner import infer_approach
        assert infer_approach([]) == "unknown"


class TestContextInference:

    def test_python_backend(self):
        from src.archon_consciousness.personality.session_end_runner import infer_context
        events = [
            {"tool": "Write", "target": "src/archon_consciousness/parser.py"},
        ]
        ctx = infer_context(events)
        assert "python" in ctx.lower()

    def test_typescript_frontend(self):
        from src.archon_consciousness.personality.session_end_runner import infer_context
        events = [
            {"tool": "Write", "target": "market-terminal/frontend/src/App.tsx"},
        ]
        ctx = infer_context(events)
        assert "typescript" in ctx.lower() or "ts" in ctx.lower()

    def test_empty_returns_general(self):
        from src.archon_consciousness.personality.session_end_runner import infer_context
        assert "general" in infer_context([]).lower()
