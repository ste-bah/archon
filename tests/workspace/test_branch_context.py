"""Tests for git branch context tagging."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from workspace.branch_context import (
    add_branch_tag,
    branch_tag,
    extract_branch_from_tag,
    filter_tags_for_branch,
    get_current_branch,
    is_branch_scoped_tag,
)


class TestGetCurrentBranch:
    def test_returns_branch_name(self):
        """Should return current branch (likely 'main' in this repo)."""
        branch = get_current_branch()
        assert branch != "unknown"
        assert len(branch) > 0

    def test_returns_unknown_for_non_git_dir(self, tmp_path):
        branch = get_current_branch(cwd=str(tmp_path))
        assert branch == "unknown"

    def test_handles_missing_git(self):
        # Even if git isn't in PATH, should not crash
        branch = get_current_branch(cwd="/tmp")
        assert isinstance(branch, str)


class TestBranchTag:
    def test_format(self):
        tag = branch_tag("main")
        assert tag == "branch:main"

    def test_feature_branch(self):
        tag = branch_tag("feature/new-thing")
        assert tag == "branch:feature/new-thing"

    def test_detached(self):
        tag = branch_tag("detached:abc1234")
        assert tag == "branch:detached:abc1234"

    def test_auto_detect(self):
        tag = branch_tag()
        assert tag.startswith("branch:")


class TestIsBranchScopedTag:
    def test_true_for_branch_tag(self):
        assert is_branch_scoped_tag("branch:main") is True

    def test_false_for_other_tag(self):
        assert is_branch_scoped_tag("agent-definition") is False
        assert is_branch_scoped_tag("") is False

    def test_true_for_detached(self):
        assert is_branch_scoped_tag("branch:detached:abc") is True


class TestExtractBranchFromTag:
    def test_extracts_name(self):
        assert extract_branch_from_tag("branch:main") == "main"

    def test_extracts_feature_branch(self):
        assert extract_branch_from_tag("branch:feature/xyz") == "feature/xyz"

    def test_returns_none_for_non_branch(self):
        assert extract_branch_from_tag("agent-definition") is None

    def test_extracts_detached(self):
        assert extract_branch_from_tag("branch:detached:abc") == "detached:abc"


class TestAddBranchTag:
    def test_adds_tag(self):
        tags = add_branch_tag(["foo", "bar"], branch="main")
        assert "branch:main" in tags
        assert "foo" in tags
        assert "bar" in tags

    def test_does_not_duplicate(self):
        tags = add_branch_tag(["foo", "branch:main"], branch="main")
        assert tags.count("branch:main") == 1

    def test_replaces_existing_branch(self):
        tags = add_branch_tag(["foo", "branch:old-branch"], branch="new-branch")
        assert "branch:new-branch" in tags
        assert "branch:old-branch" not in tags

    def test_preserves_non_branch_tags(self):
        tags = add_branch_tag(["a", "b", "branch:old"], branch="new")
        assert "a" in tags
        assert "b" in tags


class TestFilterTagsForBranch:
    def test_includes_current_branch(self):
        tags = filter_tags_for_branch(["search-term"], branch="feature/x")
        assert "branch:feature/x" in tags

    def test_includes_main_by_default(self):
        tags = filter_tags_for_branch(["search-term"], branch="feature/x", include_main=True)
        assert "branch:main" in tags

    def test_no_duplicate_main(self):
        tags = filter_tags_for_branch(["search-term"], branch="main", include_main=True)
        assert tags.count("branch:main") == 1

    def test_excludes_main_when_disabled(self):
        tags = filter_tags_for_branch(["search-term"], branch="feature/x", include_main=False)
        assert "branch:main" not in tags

    def test_preserves_base_tags(self):
        tags = filter_tags_for_branch(["a", "b"], branch="dev")
        assert "a" in tags
        assert "b" in tags
