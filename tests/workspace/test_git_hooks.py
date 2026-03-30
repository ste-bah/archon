"""Tests for git hook handlers — branch switch, merge, orphan detection."""

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from workspace.git_hooks import (
    on_branch_switch,
    on_branch_merge,
    get_local_branches,
    get_worktree_branches,
    detect_orphaned_branches,
    tag_orphaned_memories,
)


class TestOnBranchSwitch:
    def test_returns_switch_details(self):
        result = on_branch_switch("main", "feature/new")
        assert result["event"] == "branch_switch"
        assert result["from"] == "main"
        assert result["to"] == "feature/new"
        assert "timestamp" in result

    def test_handles_detached_head(self):
        result = on_branch_switch("main", "detached:abc1234")
        assert result["to"] == "detached:abc1234"


class TestOnBranchMerge:
    def test_returns_merge_details(self):
        result = on_branch_merge("feature/x", "main")
        assert result["event"] == "branch_merge"
        assert result["merged_branch"] == "feature/x"
        assert result["target_branch"] == "main"
        assert "merged-to:main" in result["promotion_tags"]

    def test_squash_flag(self):
        result = on_branch_merge("feature/x", "main", squash=True)
        assert "merge-type:squash" in result["promotion_tags"]

    def test_non_squash_no_squash_tag(self):
        result = on_branch_merge("feature/x", "main", squash=False)
        assert "merge-type:squash" not in result["promotion_tags"]

    def test_promotes_memories(self):
        # Mock memory operations
        mock_memories = [
            {"id": "mem1", "tags": ["branch:feature/x", "project"]},
            {"id": "mem2", "tags": ["branch:feature/x", "bugfix"]},
        ]
        updated = {}

        def searcher(tags):
            return [m for m in mock_memories if any(t in m["tags"] for t in tags)]

        def updater(mem_id, tags):
            updated[mem_id] = tags

        result = on_branch_merge("feature/x", "main",
                                 memory_searcher=searcher, memory_updater=updater)
        assert result["promoted_count"] == 2
        assert "mem1" in updated
        assert "merged-to:main" in updated["mem1"]

    def test_tag_order_preserved(self):
        """Promotion must preserve original tag order (no set randomization)."""
        mock_memories = [
            {"id": "m1", "tags": ["branch:feature/x", "alpha", "beta", "gamma"]},
        ]
        updated = {}

        def searcher(tags):
            return [m for m in mock_memories if any(t in m["tags"] for t in tags)]

        def updater(mem_id, tags):
            updated[mem_id] = tags

        on_branch_merge("feature/x", "main",
                        memory_searcher=searcher, memory_updater=updater)
        tags = updated["m1"]
        # Original tags must appear in original order before promotion tags
        orig_positions = [tags.index(t) for t in ["branch:feature/x", "alpha", "beta", "gamma"]]
        assert orig_positions == sorted(orig_positions), "Original tag order was not preserved"

    def test_no_promotion_without_callbacks(self):
        result = on_branch_merge("feature/x", "main")
        assert result["promoted_count"] == 0

    def test_merge_date_in_tags(self):
        result = on_branch_merge("feature/x", "main")
        date_tags = [t for t in result["promotion_tags"] if t.startswith("merge-date:")]
        assert len(date_tags) == 1
        assert datetime.now(timezone.utc).strftime("%Y-%m-%d") in date_tags[0]


class TestGetLocalBranches:
    def test_returns_branches(self):
        branches = get_local_branches()
        # We're in a git repo, should have at least 'main'
        assert isinstance(branches, set)
        assert len(branches) > 0

    def test_non_git_dir_returns_empty(self, tmp_path):
        branches = get_local_branches(cwd=str(tmp_path))
        assert branches == set()


class TestGetWorktreeBranches:
    def test_returns_set(self):
        branches = get_worktree_branches()
        assert isinstance(branches, set)

    def test_non_git_dir_returns_empty(self, tmp_path):
        branches = get_worktree_branches(cwd=str(tmp_path))
        assert branches == set()


class TestDetectOrphanedBranches:
    def test_detects_orphaned(self):
        stored = ["branch:main", "branch:feature/deleted", "branch:feature/also-gone"]
        orphaned = detect_orphaned_branches(stored)
        # main is always known, feature/* likely don't exist
        assert "main" not in orphaned
        assert "feature/deleted" in orphaned
        assert "feature/also-gone" in orphaned

    def test_main_never_orphaned(self):
        stored = ["branch:main"]
        orphaned = detect_orphaned_branches(stored)
        assert "main" not in orphaned

    def test_detached_never_orphaned(self):
        stored = ["branch:detached:abc1234"]
        orphaned = detect_orphaned_branches(stored)
        assert len(orphaned) == 0

    def test_unknown_never_orphaned(self):
        stored = ["branch:unknown"]
        orphaned = detect_orphaned_branches(stored)
        assert "unknown" not in orphaned

    def test_global_never_orphaned(self):
        stored = ["branch:_global"]
        orphaned = detect_orphaned_branches(stored)
        assert "_global" not in orphaned

    def test_master_never_orphaned(self):
        stored = ["branch:master"]
        orphaned = detect_orphaned_branches(stored)
        assert "master" not in orphaned

    def test_non_branch_tags_ignored(self):
        stored = ["project", "agent-definition", "branch:orphan-branch"]
        orphaned = detect_orphaned_branches(stored)
        assert "project" not in orphaned
        assert "agent-definition" not in orphaned

    def test_empty_stored_returns_empty(self):
        assert detect_orphaned_branches([]) == []

    def test_existing_branch_not_orphaned(self):
        # Get actual current branch
        current = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True
        ).stdout.strip()
        stored = [f"branch:{current}"]
        orphaned = detect_orphaned_branches(stored)
        assert current not in orphaned


class TestTagOrphanedMemories:
    def test_tags_orphaned_memories(self):
        mock_memories = [
            {"id": "m1", "tags": ["branch:dead-branch", "test"]},
        ]
        updated = {}

        def searcher(tags):
            return [m for m in mock_memories if any(t in m["tags"] for t in tags)]

        def updater(mem_id, tags):
            updated[mem_id] = tags

        count = tag_orphaned_memories(["dead-branch"], searcher, updater)
        assert count == 1
        assert "orphaned:true" in updated["m1"]

    def test_no_double_tagging(self):
        mock_memories = [
            {"id": "m1", "tags": ["branch:dead", "orphaned:true"]},
        ]
        updated = {}

        def searcher(tags):
            return mock_memories

        def updater(mem_id, tags):
            updated[mem_id] = tags

        count = tag_orphaned_memories(["dead"], searcher, updater)
        assert count == 0  # Already tagged

    def test_no_callbacks_returns_zero(self):
        count = tag_orphaned_memories(["dead"])
        assert count == 0
