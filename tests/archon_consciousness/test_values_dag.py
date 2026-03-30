"""Tests for ValuesDAG — conflict resolution, edges, cycles, tiers.

Written BEFORE implementation (TDD).
Covers FR-CON-013, FR-CON-014, FR-CON-015, FR-CON-028.
"""

import json
import pytest

from src.archon_consciousness.context_descriptor import ContextDescriptor
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.values_dag import ValuesDAG


def _seed_rules(mock_graph, rules):
    """Helper: seed ValuesNode entries for testing."""
    for rule_id, tier in rules:
        mock_graph.store_memory(
            name=f"valuesnode-{rule_id}",
            memory_type="ValuesNode",
            content=json.dumps({
                "rule_id": rule_id, "rule_text": f"Rule {rule_id}",
                "tier": tier, "status": "active",
                "created_at": "2026-03-28T00:00:00+00:00",
            }),
            importance=0.8, tags=["archon-consciousness", "values-node"],
        )


# ─── Step 0: Hysteresis ───────────────────────────────────────────


class TestHysteresis:

    def test_cached_winner_returned(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r1 = dag.resolve_conflict("rule-a", "rule-b", ctx)
        r2 = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r1["winner"] == r2["winner"]
        assert r2["step"] == "hysteresis"

    def test_flush_clears_cache(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        dag.resolve_conflict("rule-a", "rule-b", ctx)
        dag.flush_hysteresis("rule-a")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["step"] != "hysteresis"

    def test_flush_all_clears_entire_cache(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        dag.resolve_conflict("rule-a", "rule-b", ctx)
        dag.flush_hysteresis()  # flush all
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["step"] != "hysteresis"


# ─── Step 1: Tier Check ───────────────────────────────────────────


class TestTierCheck:

    def test_safety_beats_guidelines(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "safety"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "tier"

    def test_ethics_beats_helpfulness(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "ethics"), ("rule-b", "helpfulness")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"

    def test_same_tier_falls_through(self, mock_graph):
        """Same tier → no resolution at step 1, falls to later steps."""
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["step"] != "tier"  # should be unresolved or later step

    def test_unseeded_defaults_to_guidelines(self, mock_graph):
        """Rule without tier → default guidelines (FR-CON-028)."""
        # rule-a has no ValuesNode → treated as guidelines
        _seed_rules(mock_graph, [("rule-b", "safety")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-b"  # safety beats default guidelines


# ─── Step 2: STRICT_PRIORITY ──────────────────────────────────────


class TestStrictPriority:

    def test_direct_edge(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "strict"

    def test_transitive_3_hops(self, mock_graph):
        _seed_rules(mock_graph, [
            ("rule-a", "guidelines"), ("rule-b", "guidelines"),
            ("rule-c", "guidelines"),
        ])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-c", "STRICT_PRIORITY")
        dag.add_edge("rule-c", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "strict"

    def test_max_depth_exceeded(self, mock_graph):
        """Chain > 10 hops → treated as no path."""
        rules = [(f"rule-{i}", "guidelines") for i in range(12)]
        _seed_rules(mock_graph, rules)
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        for i in range(11):
            dag.add_edge(f"rule-{i}", f"rule-{i+1}", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-0", "rule-11", ctx)
        # 11 hops > 10 max → no strict path found
        assert r["step"] != "strict"

    def test_reverse_direction(self, mock_graph):
        """A→B means A wins over B. If we ask B vs A, B should lose."""
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-b", "rule-a", ctx)
        assert r["winner"] == "rule-a"


# ─── Step 3: DEFEATS ──────────────────────────────────────────────


class TestDefeats:

    def test_direct_defeats_with_matching_context(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="pipeline", user_state="any", task_type="coding")
        dag.add_edge("rule-a", "rule-b", "DEFEATS",
                     context=ContextDescriptor(mode="pipeline", user_state="any", task_type="any"))
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "defeats"

    def test_defeats_non_matching_context_ignored(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="manual", user_state="any", task_type="any")
        dag.add_edge("rule-a", "rule-b", "DEFEATS",
                     context=ContextDescriptor(mode="pipeline", user_state="any", task_type="any"))
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["step"] != "defeats"

    def test_defeats_1_hop_only(self, mock_graph):
        """DEFEATS does NOT traverse transitively."""
        _seed_rules(mock_graph, [
            ("rule-a", "guidelines"), ("rule-b", "guidelines"),
            ("rule-c", "guidelines"),
        ])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-c", "DEFEATS",
                     context=ContextDescriptor(mode="any", user_state="any", task_type="any"))
        dag.add_edge("rule-c", "rule-b", "DEFEATS",
                     context=ContextDescriptor(mode="any", user_state="any", task_type="any"))
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        # No direct DEFEATS from A→B, so defeats step fails
        assert r["step"] != "defeats"

    def test_defeats_with_null_edge_context_matches_all(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "DEFEATS", context=None)
        ctx = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "defeats"


# ─── Step 4: DEFEASIBLE_PRIORITY ──────────────────────────────────


class TestDefeasiblePriority:

    def test_direct_defeasible_matching_context(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="manual", user_state="any", task_type="any")
        dag.add_edge("rule-a", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.8, context=ctx)
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "defeasible"

    def test_defeasible_mismatched_context_ignored(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        edge_ctx = ContextDescriptor(mode="pipeline", user_state="any", task_type="any")
        dag.add_edge("rule-a", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.8, context=edge_ctx)
        current_ctx = ContextDescriptor(mode="manual", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", current_ctx)
        assert r["step"] != "defeasible"

    def test_defeasible_null_context_matches_all(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.9, context=None)
        ctx = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "defeasible"

    def test_transitive_defeasible_all_contexts_match(self, mock_graph):
        _seed_rules(mock_graph, [
            ("rule-a", "guidelines"), ("rule-b", "guidelines"),
            ("rule-c", "guidelines"),
        ])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-c", "DEFEASIBLE_PRIORITY", weight=0.8, context=None)
        dag.add_edge("rule-c", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.7, context=None)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"
        assert r["step"] == "defeasible"

    def test_transitive_defeasible_one_context_mismatch_invalidates(self, mock_graph):
        """If any edge in the path has mismatched context, path is invalid."""
        _seed_rules(mock_graph, [
            ("rule-a", "guidelines"), ("rule-b", "guidelines"),
            ("rule-c", "guidelines"),
        ])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-c", "DEFEASIBLE_PRIORITY", weight=0.8, context=None)
        dag.add_edge("rule-c", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.7,
                     context=ContextDescriptor(mode="pipeline", user_state="any", task_type="any"))
        ctx = ContextDescriptor(mode="manual", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        # Second edge doesn't match → path invalid
        assert r["step"] == "unresolved"

    def test_weight_tiebreaker(self, mock_graph):
        """Multiple valid paths → highest minimum-edge-weight wins."""
        _seed_rules(mock_graph, [
            ("rule-a", "guidelines"), ("rule-b", "guidelines"),
            ("rule-c", "guidelines"), ("rule-d", "guidelines"),
        ])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        # Path 1: A→C→B with weights 0.9, 0.3 (min=0.3)
        dag.add_edge("rule-a", "rule-c", "DEFEASIBLE_PRIORITY", weight=0.9, context=None)
        dag.add_edge("rule-c", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.3, context=None)
        # Path 2: A→D→B with weights 0.6, 0.6 (min=0.6) — higher min
        dag.add_edge("rule-a", "rule-d", "DEFEASIBLE_PRIORITY", weight=0.6, context=None)
        dag.add_edge("rule-d", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.6, context=None)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["winner"] == "rule-a"


# ─── Step 5: Unresolved ───────────────────────────────────────────


class TestUnresolved:

    def test_no_path_unresolved(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert r["step"] == "unresolved"
        assert r["winner"] is None


# ─── Archived Rule Exclusion ──────────────────────────────────────


class TestArchivedExclusion:

    def test_archived_edge_skipped(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        # Archive rule-a
        mem = mock_graph.get_memory("valuesnode-rule-a")
        content = json.loads(mem["content"])
        content["status"] = "archived"
        mock_graph.store_memory(
            name="valuesnode-rule-a", memory_type="ValuesNode",
            content=json.dumps(content), importance=0.8,
            tags=["archon-consciousness"],
        )
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "STRICT_PRIORITY")
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        # Archived → edge skipped → no strict resolution
        assert r["step"] != "strict"


# ─── Cycle Detection ──────────────────────────────────────────────


class TestCycleDetection:

    def test_simple_cycle(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.5, context=None)
        dag.add_edge("rule-b", "rule-a", "DEFEASIBLE_PRIORITY", weight=0.5, context=None)
        cycles = dag.detect_cycles()
        assert len(cycles) >= 1

    def test_longer_cycle(self, mock_graph):
        _seed_rules(mock_graph, [
            ("rule-a", "guidelines"), ("rule-b", "guidelines"),
            ("rule-c", "guidelines"),
        ])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.5, context=None)
        dag.add_edge("rule-b", "rule-c", "DEFEASIBLE_PRIORITY", weight=0.5, context=None)
        dag.add_edge("rule-c", "rule-a", "DEFEASIBLE_PRIORITY", weight=0.5, context=None)
        cycles = dag.detect_cycles()
        assert len(cycles) >= 1

    def test_no_cycle(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "guidelines"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        dag.add_edge("rule-a", "rule-b", "DEFEASIBLE_PRIORITY", weight=0.5, context=None)
        cycles = dag.detect_cycles()
        assert len(cycles) == 0


# ─── Resolution Logging ───────────────────────────────────────────


class TestResolutionLogging:

    def test_resolution_has_required_fields(self, mock_graph):
        _seed_rules(mock_graph, [("rule-a", "safety"), ("rule-b", "guidelines")])
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        r = dag.resolve_conflict("rule-a", "rule-b", ctx)
        assert "winner" in r
        assert "loser" in r
        assert "step" in r
        assert "reason" in r
        assert "rule_a" in r
        assert "rule_b" in r
        assert "path" in r
        assert "context_evaluated" in r
