"""Tests for rule lifecycle — active/archived/deprecated transitions.

Written BEFORE implementation (TDD).
"""

import json
import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.rule_registry import RuleRegistry


class TestArchiveRule:
    """Test archiving (soft-delete) of rules."""

    def test_archive_changes_status(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.archive_rule("no-co-authored-by")
        rule = registry.get_rule("no-co-authored-by")
        assert rule is not None
        assert rule.status == "archived"

    def test_archive_freezes_pattern_score(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.archive_rule("no-co-authored-by")
        score_data = client.get("patternscore-no-co-authored-by")
        content = json.loads(score_data["content"])
        assert content["status"] == "archived"
        assert content["trend"] == "frozen"

    def test_archived_excluded_from_active_list(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.archive_rule("no-co-authored-by")
        active = registry.list_active_rules()
        active_ids = {r.rule_id for r in active}
        assert "no-co-authored-by" not in active_ids

    def test_archived_excluded_from_count(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        before = registry.count_active_rules()
        registry.archive_rule("no-co-authored-by")
        after = registry.count_active_rules()
        assert after == before - 1

    def test_archived_rule_id_permanently_reserved(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.archive_rule("no-co-authored-by")
        assert registry.is_rule_id_available("no-co-authored-by") is False

    def test_archive_idempotent(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.archive_rule("no-co-authored-by")
        # Second archive should not raise
        registry.archive_rule("no-co-authored-by")
        rule = registry.get_rule("no-co-authored-by")
        assert rule.status == "archived"

    def test_archive_nonexistent_raises(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        with pytest.raises(KeyError, match="not found"):
            registry.archive_rule("does-not-exist")

    def test_archive_frees_capacity(self, populated_graph):
        """Archiving reduces active count, allowing new rules."""
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        before = registry.count_active_rules()
        registry.archive_rule("tdd-first")
        after = registry.count_active_rules()
        assert after == before - 1


class TestDeprecateRule:
    """Test deprecation with SUPERSEDED_BY edge."""

    def test_deprecate_changes_status(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        rule = registry.get_rule("tdd-first")
        assert rule.status == "deprecated"

    def test_deprecate_creates_superseded_by_edge(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        related = client.get_related(
            "valuesnode-tdd-first",
            relationship_type="SUPERSEDED_BY",
            direction="outgoing",
        )
        assert len(related) == 1
        assert related[0]["name"] == "valuesnode-sequential-execution"

    def test_deprecate_excluded_from_active_list(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        active_ids = {r.rule_id for r in registry.list_active_rules()}
        assert "tdd-first" not in active_ids

    def test_deprecate_freezes_pattern_score(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        score_data = client.get("patternscore-tdd-first")
        content = json.loads(score_data["content"])
        assert content["status"] == "deprecated"
        assert content["trend"] == "frozen"

    def test_deprecate_nonexistent_source_raises(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        with pytest.raises(KeyError, match="not found"):
            registry.deprecate_rule("ghost-rule", "sequential-execution")

    def test_deprecate_nonexistent_target_raises(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        with pytest.raises(KeyError, match="not found"):
            registry.deprecate_rule("tdd-first", "ghost-rule")

    def test_deprecate_rule_id_permanently_reserved(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        assert registry.is_rule_id_available("tdd-first") is False

    def test_follow_supersession_chain(self, populated_graph):
        """Follow SUPERSEDED_BY chain to terminal active rule."""
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        # Create chain: tdd-first → sequential-execution (both active, then deprecate)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        terminal = registry.follow_supersession_chain("tdd-first")
        assert terminal is not None
        assert terminal.rule_id == "sequential-execution"
        assert terminal.status == "active"

    def test_follow_broken_chain_returns_none(self, populated_graph):
        """Broken chain (terminal is also archived) returns None."""
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        registry.deprecate_rule("tdd-first", "sequential-execution")
        registry.archive_rule("sequential-execution")
        terminal = registry.follow_supersession_chain("tdd-first")
        assert terminal is None

    def test_follow_chain_active_rule_returns_self(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        terminal = registry.follow_supersession_chain("sequential-execution")
        assert terminal is not None
        assert terminal.rule_id == "sequential-execution"
