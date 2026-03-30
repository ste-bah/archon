"""Tests for /values skill command router.

Written BEFORE implementation (TDD).
Covers FR-CON-016.
"""

import json
import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.values_skill import ValuesSkill


def _seed_rule(mock_graph, rule_id, tier="guidelines", score=0.5, status="active"):
    mock_graph.store_memory(
        name=f"valuesnode-{rule_id}",
        memory_type="ValuesNode",
        content=json.dumps({
            "rule_id": rule_id, "rule_text": f"Rule {rule_id}",
            "tier": tier, "status": status,
            "created_at": "2026-03-28T00:00:00+00:00",
        }),
        importance=0.8, tags=["archon-consciousness", "values-node"],
    )
    mock_graph.store_memory(
        name=f"patternscore-{rule_id}",
        memory_type="PatternScore",
        content=json.dumps({
            "rule_id": rule_id, "score": score,
            "last_tested_session": None, "tested_session_count": 5,
            "last_delta": None, "trend": "stable", "status": status,
            "score_history": [score] * 5,
            "last_tested_session_num": None, "consecutive_drops": 0,
        }),
        importance=0.5, tags=["archon-consciousness"],
    )


class TestList:
    def test_list_shows_active_rules(self, mock_graph):
        _seed_rule(mock_graph, "ask-before-implementing", "safety", 0.8)
        _seed_rule(mock_graph, "tdd-first", "ethics", 0.6)
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("list")
        assert "ask-before-implementing" in output
        assert "tdd-first" in output
        assert "safety" in output

    def test_list_empty(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("list")
        assert "No active rules" in output or "0 rules" in output.lower()


class TestAdd:
    def test_add_creates_rule(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("add", "Always write tests first")
        assert "Created" in output or "created" in output
        # Verify rule exists in graph
        nodes = mock_graph.list_by_type("ValuesNode")
        assert len(nodes) >= 1

    def test_add_with_custom_tier(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("add", "Never act without approval --tier safety")
        assert "Created" in output or "created" in output


class TestRemove:
    def test_remove_archives_rule(self, mock_graph):
        _seed_rule(mock_graph, "old-rule")
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("remove", "old-rule")
        assert "Archived" in output or "archived" in output

    def test_remove_nonexistent(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("remove", "ghost-rule")
        assert "not found" in output.lower() or "error" in output.lower()


class TestShowAtrophy:
    def test_show_atrophy_lists_stale_rules(self, mock_graph):
        mock_graph.store_memory(
            name="patternscore-stale-rule",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": "stale-rule", "score": 0.85,
                "last_tested_session": None, "tested_session_count": 10,
                "last_delta": None, "trend": "stable", "status": "active",
                "score_history": [0.85] * 10,
                "last_tested_session_num": 5, "consecutive_drops": 0,
            }),
            importance=0.5, tags=["archon-consciousness"],
        )
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=50)
        output = skill.execute("show-atrophy")
        assert "stale-rule" in output


class TestDeprecate:
    def test_deprecate_links_rules(self, mock_graph):
        _seed_rule(mock_graph, "old-rule")
        _seed_rule(mock_graph, "new-rule")
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("deprecate", "old-rule new-rule")
        assert "Deprecated" in output or "deprecated" in output

    def test_deprecate_nonexistent(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("deprecate", "ghost old-rule")
        assert "not found" in output.lower() or "error" in output.lower()


class TestReprioritize:
    def test_reprioritize_creates_edge(self, mock_graph):
        _seed_rule(mock_graph, "rule-a")
        _seed_rule(mock_graph, "rule-b")
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("reprioritize", "rule-a rule-b DEFEASIBLE_PRIORITY")
        assert "Priority" in output or "edge" in output.lower() or "Added" in output


class TestShowConflicts:
    def test_show_conflicts_returns_output(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("show-conflicts")
        assert isinstance(output, str)


class TestShowDeepChains:
    def test_show_deep_chains_returns_output(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("show-deep-chains")
        assert isinstance(output, str)


class TestShowBrokenChains:
    def test_show_broken_chains_returns_output(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("show-broken-chains")
        assert isinstance(output, str)


class TestInvalidOperation:
    def test_invalid_operation_shows_help(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("nonexistent-command")
        assert "Available operations" in output or "Unknown" in output

    def test_no_args_shows_help(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = ValuesSkill(client, session_num=1)
        output = skill.execute("")
        assert "Available" in output or "operations" in output.lower()
