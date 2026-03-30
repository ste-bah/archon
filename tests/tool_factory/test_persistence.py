"""Tests for tool-factory persistence layer."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

# We'll fix the import path once the module exists
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from tool_factory.persistence import ToolDefinition, ToolStore


class TestToolDefinition:
    def test_code_hash_computed(self):
        td = ToolDefinition(
            name="test", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        assert len(td.code_hash) == 16
        assert td.code_hash  # non-empty

    def test_expires_at_computed_with_ttl(self):
        now = datetime.now(timezone.utc)
        td = ToolDefinition(
            name="test", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60,
            timeout_seconds=30, created_at=now.isoformat(),
        )
        assert td.expires_at is not None
        expires = datetime.fromisoformat(td.expires_at)
        assert expires > now

    def test_no_expiry_when_ttl_zero(self):
        td = ToolDefinition(
            name="test", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        assert td.expires_at is None
        assert td.is_expired() is False

    def test_is_expired_true_when_past_ttl(self):
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        td = ToolDefinition(
            name="test", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60,
            timeout_seconds=30, created_at=past,
        )
        assert td.is_expired() is True

    def test_is_expired_false_when_within_ttl(self):
        now = datetime.now(timezone.utc).isoformat()
        td = ToolDefinition(
            name="test", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60,
            timeout_seconds=30, created_at=now,
        )
        assert td.is_expired() is False


class TestToolStore:
    def test_init_creates_directory(self, tmp_path):
        store_dir = tmp_path / "new_store"
        store = ToolStore(base_dir=store_dir)
        count = store.init()
        assert store_dir.exists()
        assert count == 0

    def test_save_writes_json(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        td = ToolDefinition(
            name="test-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(td)
        path = tmp_tools_dir / "test-tool.json"
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["name"] == "test-tool"

    def test_save_atomic_write(self, tmp_tools_dir):
        """Verify no .tmp file remains after save."""
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        td = ToolDefinition(
            name="test-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(td)
        tmp_files = list(tmp_tools_dir.glob("*.tmp"))
        assert len(tmp_files) == 0

    def test_init_loads_saved_tools(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        td = ToolDefinition(
            name="loaded-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(td)
        # Create a new store instance and init (simulates server restart)
        store2 = ToolStore(base_dir=tmp_tools_dir)
        count = store2.init()
        assert count == 1
        assert store2.get("loaded-tool") is not None

    def test_delete_removes_file_and_memory(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        td = ToolDefinition(
            name="del-me", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(td)
        store.delete("del-me")
        assert store.get("del-me") is None
        assert not (tmp_tools_dir / "del-me.json").exists()

    def test_get_nonexistent_returns_none(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        assert store.get("nonexistent") is None

    def test_list_all_excludes_expired(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        expired_td = ToolDefinition(
            name="expired-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60,
            timeout_seconds=30, created_at=past,
        )
        active_td = ToolDefinition(
            name="active-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0,
            timeout_seconds=30, created_at=datetime.now(timezone.utc).isoformat(),
        )
        store.save(expired_td)
        store.save(active_td)
        active_list = store.list_all(include_expired=False)
        assert len(active_list) == 1
        assert active_list[0].name == "active-tool"

    def test_list_all_includes_expired(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        expired_td = ToolDefinition(
            name="expired-tool", description="test", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60,
            timeout_seconds=30, created_at=past,
        )
        store.save(expired_td)
        all_list = store.list_all(include_expired=True)
        assert len(all_list) == 1

    def test_count_active(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        now = datetime.now(timezone.utc).isoformat()
        store.save(ToolDefinition(name="expired", description="", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=60, timeout_seconds=30, created_at=past))
        store.save(ToolDefinition(name="active", description="", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0, timeout_seconds=30, created_at=now))
        assert store.count_active() == 1

    def test_corrupt_json_skipped(self, tmp_tools_dir):
        (tmp_tools_dir / "corrupt.json").write_text("NOT VALID JSON {{{")
        store = ToolStore(base_dir=tmp_tools_dir)
        count = store.init()
        assert count == 0  # corrupt file skipped

    def test_has_returns_true_for_existing(self, tmp_tools_dir):
        store = ToolStore(base_dir=tmp_tools_dir)
        store.init()
        store.save(ToolDefinition(name="exists", description="", code="def run(p): return {}",
            language="python", parameters=None, ttl_minutes=0, timeout_seconds=30,
            created_at=datetime.now(timezone.utc).isoformat()))
        assert store.has("exists") is True
        assert store.has("nope") is False
