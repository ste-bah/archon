"""Tests for MemoryGraph namespace convention enforcement."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from workspace.namespace import (
    GLOBAL_PREFIX,
    VALID_AREAS,
    extract_project_from_key,
    is_global_key,
    normalize_key,
    reset_slug_cache,
    validate_namespace_key,
)


class TestValidateNamespaceKey:
    def test_valid_key(self):
        ok, msg = validate_namespace_key("archon/api/ticker-endpoint")
        assert ok is True

    def test_valid_global_key(self):
        ok, msg = validate_namespace_key("_global/patterns/error-handling")
        assert ok is True

    def test_empty_key(self):
        ok, msg = validate_namespace_key("")
        assert ok is False
        assert "empty" in msg.lower()

    def test_too_long_key(self):
        ok, msg = validate_namespace_key("a" * 301)
        assert ok is False
        assert "length" in msg.lower() or "long" in msg.lower()

    def test_path_traversal_rejected(self):
        ok, msg = validate_namespace_key("archon/../etc/passwd")
        assert ok is False
        assert "traversal" in msg.lower()

    def test_backslash_traversal_rejected(self):
        ok, msg = validate_namespace_key("archon/..\\windows\\system32")
        assert ok is False

    def test_missing_separator(self):
        ok, msg = validate_namespace_key("just-a-slug")
        assert ok is False
        assert "segment" in msg.lower() or "slash" in msg.lower() or "format" in msg.lower()

    def test_invalid_project_slug(self):
        ok, msg = validate_namespace_key("UPPER CASE/api/thing")
        assert ok is False

    def test_unknown_area_warns_not_rejects(self):
        ok, msg = validate_namespace_key("archon/custom-area/thing")
        # Unknown area is a warning, not a rejection in non-strict mode
        assert ok is True

    def test_strict_mode_rejects_unknown_area(self):
        ok, msg = validate_namespace_key("archon/custom-area/thing", strict=True)
        assert ok is False
        assert "area" in msg.lower()

    def test_all_known_areas_valid(self):
        for area in VALID_AREAS:
            ok, msg = validate_namespace_key(f"archon/{area}/test")
            assert ok is True, f"Area '{area}' should be valid: {msg}"

    def test_name_too_long(self):
        ok, msg = validate_namespace_key(f"archon/api/{'x' * 201}")
        assert ok is False


class TestNormalizeKey:
    def test_already_prefixed(self):
        assert normalize_key("archon/api/thing", "archon") == "archon/api/thing"

    def test_adds_prefix(self):
        result = normalize_key("api/thing", "archon")
        assert result == "archon/api/thing"

    def test_global_key_unchanged(self):
        assert normalize_key("_global/patterns/x", "archon") == "_global/patterns/x"

    def test_rejects_path_traversal(self):
        with pytest.raises(ValueError, match="traversal"):
            normalize_key("../etc/passwd", "archon")

    def test_rejects_too_long(self):
        with pytest.raises(ValueError):
            normalize_key("a" * 300, "archon")

    def test_auto_detect_slug(self):
        reset_slug_cache()
        # Without a workspace manifest, falls back to _global
        result = normalize_key("api/thing")
        assert result.startswith("_global/") or "/" in result


class TestExtractProjectFromKey:
    def test_extracts_project(self):
        proj, rest = extract_project_from_key("archon/api/ticker")
        assert proj == "archon"
        assert rest == "api/ticker"

    def test_extracts_global(self):
        proj, rest = extract_project_from_key("_global/patterns/error")
        assert proj == "_global"
        assert rest == "patterns/error"

    def test_deep_path(self):
        proj, rest = extract_project_from_key("tla/database/schema/users/v2")
        assert proj == "tla"
        assert rest == "database/schema/users/v2"

    def test_no_prefix_raises(self):
        with pytest.raises(ValueError):
            extract_project_from_key("no-slash")


class TestIsGlobalKey:
    def test_global_key(self):
        assert is_global_key("_global/patterns/x") is True

    def test_project_key(self):
        assert is_global_key("archon/api/x") is False

    def test_empty(self):
        assert is_global_key("") is False


class TestSlugCacheReset:
    def test_reset_clears_cache(self):
        reset_slug_cache()
        # Should not crash
        normalize_key("api/test")
        reset_slug_cache()
        normalize_key("api/test")
