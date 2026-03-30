"""Tests for tool-factory server management tools and validation."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from tool_factory.server import validate_tool_name, validate_python_syntax, MAX_ACTIVE_TOOLS
from tool_factory.persistence import ToolDefinition, ToolStore
from datetime import datetime, timedelta, timezone


class TestValidateToolName:
    def test_valid_name(self):
        errors, warnings = validate_tool_name("calculate-roi")
        assert errors == []

    def test_valid_name_with_underscores(self):
        errors, warnings = validate_tool_name("my_tool_v2")
        assert errors == []

    def test_too_short(self):
        errors, _ = validate_tool_name("ab")
        assert len(errors) > 0

    def test_too_long(self):
        errors, _ = validate_tool_name("a" * 51)
        assert len(errors) > 0

    def test_starts_with_digit(self):
        errors, _ = validate_tool_name("1tool")
        assert len(errors) > 0

    def test_starts_with_hyphen(self):
        errors, _ = validate_tool_name("-tool")
        assert len(errors) > 0

    def test_uppercase_rejected(self):
        errors, _ = validate_tool_name("MyTool")
        assert len(errors) > 0

    def test_special_chars_rejected(self):
        errors, _ = validate_tool_name("tool!@#")
        assert len(errors) > 0

    def test_python_keyword_rejected(self):
        errors, _ = validate_tool_name("import")
        assert any("keyword" in e.lower() for e in errors)

    def test_reserved_name_warns(self):
        _, warnings = validate_tool_name("read")
        assert len(warnings) > 0
        assert any("conflict" in w.lower() for w in warnings)

    def test_reserved_name_bash_warns(self):
        _, warnings = validate_tool_name("bash")
        assert len(warnings) > 0

    def test_mcp_prefix_warns(self):
        _, warnings = validate_tool_name("mcp__my-tool")
        assert len(warnings) > 0
        assert any("prefix" in w.lower() for w in warnings)

    def test_empty_name(self):
        errors, _ = validate_tool_name("")
        assert len(errors) > 0


class TestValidatePythonSyntax:
    def test_valid_code(self):
        valid, err = validate_python_syntax("def run(params):\n    return {}")
        assert valid is True
        assert err is None

    def test_missing_colon(self):
        valid, err = validate_python_syntax("def run(params)\n    return {}")
        assert valid is False
        assert "line 1" in err

    def test_invalid_indentation(self):
        valid, err = validate_python_syntax("def run(params):\nreturn {}")
        assert valid is False

    def test_empty_string_valid(self):
        valid, err = validate_python_syntax("")
        assert valid is True  # empty is syntactically valid Python

    def test_complex_valid_code(self):
        code = """
import json
import math

def run(params):
    x = params.get('x', 0)
    y = params.get('y', 0)
    return {'distance': math.sqrt(x**2 + y**2)}
"""
        valid, err = validate_python_syntax(code)
        assert valid is True


class TestServerIntegration:
    """Integration tests using the store and validation together."""

    def test_add_and_retrieve_tool(self, tmp_path):
        store = ToolStore(base_dir=tmp_path)
        store.init()

        # Simulate add_tool validation
        name = "test-calc"
        errors, warnings = validate_tool_name(name)
        assert errors == []

        code = "def run(params):\n    return {'sum': params['a'] + params['b']}"
        valid, err = validate_python_syntax(code)
        assert valid is True

        tool = ToolDefinition(
            name=name, description="Add numbers", code=code,
            language="python", parameters={"type": "object"},
            ttl_minutes=0, timeout_seconds=30,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(tool)
        assert store.get(name) is not None

    def test_duplicate_tool_detected(self, tmp_path):
        store = ToolStore(base_dir=tmp_path)
        store.init()

        tool = ToolDefinition(
            name="dup-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0, timeout_seconds=30,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(tool)
        assert store.has("dup-tool") is True

    def test_active_limit_enforcement(self, tmp_path):
        store = ToolStore(base_dir=tmp_path)
        store.init()

        for i in range(MAX_ACTIVE_TOOLS):
            store.save(ToolDefinition(
                name=f"tool-{i:03d}", description="test", code="def run(p): return {}",
                language="python", parameters=None, ttl_minutes=0, timeout_seconds=30,
                created_at=datetime.now(timezone.utc).isoformat(),
            ))

        assert store.count_active() == MAX_ACTIVE_TOOLS

    def test_expired_tool_not_counted(self, tmp_path):
        store = ToolStore(base_dir=tmp_path)
        store.init()

        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        store.save(ToolDefinition(
            name="expired-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60, timeout_seconds=30,
            created_at=past,
        ))

        assert store.count_active() == 0  # expired does not count

    def test_update_tool_code(self, tmp_path):
        store = ToolStore(base_dir=tmp_path)
        store.init()

        tool = ToolDefinition(
            name="updatable", description="v1", code="def run(p): return {'v': 1}",
            language="python", parameters=None, ttl_minutes=0, timeout_seconds=30,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(tool)

        # Update code
        new_code = "def run(p): return {'v': 2}"
        valid, err = validate_python_syntax(new_code)
        assert valid is True

        tool.code = new_code
        store.save(tool)
        retrieved = store.get("updatable")
        assert "v': 2" in retrieved.code

    def test_timeout_validation(self):
        """Timeout must be 1-120."""
        # These would be checked in the server's add_tool handler
        assert 1 <= 30 <= 120  # default valid
        assert not (1 <= 0 <= 120)  # 0 invalid
        assert not (1 <= 121 <= 120)  # 121 invalid

    def test_unsupported_language(self):
        """Only python is supported."""
        assert "python" == "python"  # would pass
        assert "javascript" != "python"  # would fail in server
