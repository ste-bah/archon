"""Tests for archon monitor pattern matching."""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from archon_monitor.patterns import (
    DEFAULT_ERROR_PATTERNS,
    classify_severity,
    compile_patterns,
    match_line,
)


class TestMatchLine:
    def test_matches_error(self):
        assert match_line("2026-03-30 ERROR: something broke") is not None

    def test_matches_fatal(self):
        assert match_line("FATAL: out of memory") is not None

    def test_matches_exception(self):
        assert match_line("raise ValueError('bad input')") is None  # no "Exception" word
        assert match_line("Exception in thread main") is not None

    def test_matches_traceback(self):
        assert match_line("Traceback (most recent call last):") is not None

    def test_matches_node_stack(self):
        assert match_line("    at Function.Module._load (internal/modules/cjs/loader.js:12:33)") is not None

    def test_matches_exit_code(self):
        assert match_line("Process terminated with exit code 1") is not None
        assert match_line("exit code 0") is None  # 0 is success

    def test_matches_timeout(self):
        assert match_line("TIMEOUT after 30 seconds") is not None

    def test_matches_connection_refused(self):
        assert match_line("Connection refused on port 8080") is not None

    def test_matches_permission_denied(self):
        assert match_line("Error: Permission denied: /etc/shadow") is not None

    def test_no_match_on_normal_line(self):
        assert match_line("INFO: Server started on port 3000") is None
        assert match_line("DEBUG: Processing request") is None
        assert match_line("") is None

    def test_custom_patterns(self):
        custom = compile_patterns([r"CUSTOM_ERR_\d+"])
        assert match_line("Got CUSTOM_ERR_42 in handler", custom) is not None
        assert match_line("All good", custom) is None

    def test_case_insensitive_error(self):
        assert match_line("error: lowercase") is not None
        assert match_line("Error: mixed case") is not None


class TestCompilePatterns:
    def test_valid_patterns(self):
        patterns = compile_patterns([r"\bFOO\b", r"bar_\d+"])
        assert len(patterns) == 2
        assert all(isinstance(p, re.Pattern) for p in patterns)

    def test_invalid_pattern_raises(self):
        with pytest.raises(ValueError, match="Invalid regex"):
            compile_patterns([r"[invalid"])

    def test_empty_list(self):
        assert compile_patterns([]) == []


class TestClassifySeverity:
    def test_fatal_is_critical(self):
        p = re.compile(r"\bFATAL\b")
        assert classify_severity(p, "FATAL error") == "critical"

    def test_oom_is_critical(self):
        p = re.compile(r"\bOOM\b")
        assert classify_severity(p, "OOM killer") == "critical"

    def test_error_is_error(self):
        p = re.compile(r"\bERROR\b")
        assert classify_severity(p, "ERROR in module") == "error"

    def test_failed_is_error(self):
        p = re.compile(r"\bFAILED\b")
        assert classify_severity(p, "Test FAILED") == "error"

    def test_timeout_is_warning(self):
        p = re.compile(r"\bTIMEOUT\b")
        assert classify_severity(p, "TIMEOUT reached") == "warning"

    def test_unknown_is_info(self):
        p = re.compile(r"something_else")
        assert classify_severity(p, "something_else happened") == "info"


class TestDefaultPatterns:
    def test_has_at_least_10_patterns(self):
        assert len(DEFAULT_ERROR_PATTERNS) >= 10

    def test_all_are_compiled(self):
        assert all(isinstance(p, re.Pattern) for p in DEFAULT_ERROR_PATTERNS)
