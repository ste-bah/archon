"""Tests for RuleRegistry — CRUD, rule_id generation, collision resolution.

Written BEFORE implementation (TDD).
"""

import json
import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.rule_registry import RuleRegistry
from src.archon_consciousness.schemas import PatternScore, ValuesNode


class TestRuleIdGeneration:
    """Test rule_id generation from natural language rule text."""

    def test_simple_rule(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.generate_rule_id("Always ask before implementing")
        # "always" and "before" are stop words, stripped
        assert rule_id == "ask-implementing"
        assert len(rule_id) <= 50

    def test_strips_stop_words(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.generate_rule_id(
            "Do not use the var keyword in any of the code"
        )
        # Should strip: do, not, use, the, in, any, of, the
        assert "do" not in rule_id.split("-")
        assert "not" not in rule_id.split("-")
        assert "the" not in rule_id.split("-")

    def test_lowercase(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.generate_rule_id("Never Echo User Input")
        assert rule_id == rule_id.lower()

    def test_max_length_enforced(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        long_text = " ".join(["word"] * 100)
        rule_id = registry.generate_rule_id(long_text)
        assert len(rule_id) <= 50

    def test_special_characters_stripped(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.generate_rule_id(
            "Don't use emojis! (seriously, never)"
        )
        # Should not contain apostrophes, exclamation marks, parens
        assert "'" not in rule_id
        assert "!" not in rule_id
        assert "(" not in rule_id

    def test_empty_after_stripping_uses_fallback(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.generate_rule_id("the a an is")
        # All stop words — should produce a fallback ID
        assert len(rule_id) > 0
        assert rule_id.startswith("rule-")


class TestCollisionResolution:
    """Test rule_id collision resolution."""

    def test_no_collision(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        resolved = registry.resolve_collision("no-emojis", set())
        assert resolved == "no-emojis"

    def test_collision_adds_qualifier(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        resolved = registry.resolve_collision(
            "no-emojis",
            {"no-emojis"},
            rule_text="Don't use emojis in responses",
        )
        assert resolved != "no-emojis"
        assert resolved.startswith("no-emojis-")
        assert len(resolved) <= 50

    def test_double_collision_adds_suffix(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        resolved = registry.resolve_collision(
            "no-emojis",
            {"no-emojis", "no-emojis-responses"},
            rule_text="Don't use emojis in responses",
        )
        # qualifier "responses" already taken, should get numeric suffix
        assert resolved not in {"no-emojis", "no-emojis-responses"}
        assert len(resolved) <= 50

    def test_numeric_suffix_increments(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        existing = {"no-emojis", "no-emojis-responses", "no-emojis-2"}
        resolved = registry.resolve_collision(
            "no-emojis", existing, rule_text="Don't use emojis in responses"
        )
        assert resolved not in existing


class TestRuleCreation:
    """Test create_rule end-to-end."""

    def test_create_stores_values_node(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.create_rule("Always ask before implementing")
        # Should find the ValuesNode in graph
        node = client.get(f"valuesnode-{rule_id}")
        assert node is not None
        content = json.loads(node["content"])
        assert content["rule_id"] == rule_id
        assert content["tier"] == "guidelines"  # default
        assert content["status"] == "active"

    def test_create_stores_pattern_score(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.create_rule("Always ask before implementing")
        # Should find the PatternScore in graph
        score = client.get(f"patternscore-{rule_id}")
        assert score is not None
        content = json.loads(score["content"])
        assert content["score"] == 0.5  # initial
        assert content["tested_session_count"] == 0

    def test_create_with_custom_tier(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.create_rule("Never act without approval", tier="safety")
        node = client.get(f"valuesnode-{rule_id}")
        content = json.loads(node["content"])
        assert content["tier"] == "safety"

    def test_create_returns_rule_id(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        rule_id = registry.create_rule("Write tests first")
        assert isinstance(rule_id, str)
        assert len(rule_id) > 0

    def test_create_with_invalid_tier_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        with pytest.raises(ValueError, match="tier"):
            registry.create_rule("Some rule", tier="critical")

    def test_create_handles_collision(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        id1 = registry.create_rule("Never use emojis in responses")
        id2 = registry.create_rule("Never use emojis in commit messages")
        assert id1 != id2

    def test_create_at_max_capacity_raises(self, populated_graph):
        """200 active rules limit."""
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        # Populated graph has 5 rules. Create 195 more to hit 200.
        for i in range(195):
            registry.create_rule(f"Rule number {i} for capacity test", tier="guidelines")
        # 201st should fail
        with pytest.raises(ValueError, match="maximum"):
            registry.create_rule("One too many rules")


class TestRuleListing:
    """Test list_active_rules and count_active_rules."""

    def test_list_active_returns_only_active(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        rules = registry.list_active_rules()
        assert len(rules) == 5
        for rule in rules:
            assert rule.status == "active"

    def test_count_active_matches_list(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        assert registry.count_active_rules() == len(registry.list_active_rules())

    def test_get_rule_by_id(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        rule = registry.get_rule("ask-before-implementing")
        assert rule is not None
        assert rule.rule_id == "ask-before-implementing"
        assert rule.tier == "safety"

    def test_get_nonexistent_rule_returns_none(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        rule = registry.get_rule("does-not-exist")
        assert rule is None

    def test_is_rule_id_available_active(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        assert registry.is_rule_id_available("ask-before-implementing") is False

    def test_is_rule_id_available_new(self, populated_graph):
        client = MemoryGraphClient(populated_graph)
        registry = RuleRegistry(client)
        assert registry.is_rule_id_available("brand-new-rule") is True
