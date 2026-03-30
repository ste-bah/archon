"""Values DAG with defeasible conflict resolution for Archon Consciousness.

Implements the 6-step conflict resolution algorithm, cycle detection,
tier-based priority, hysteresis caching, and ContextDescriptor matching.

FR-CON-013: DAG structure with 3 edge types + 4 tiers
FR-CON-014: 6-step resolution algorithm
FR-CON-015: Cycle detection
FR-CON-028: Tier classification
"""

import json
import logging
from collections import deque
from typing import Optional

from src.archon_consciousness.constants import (
    CONSCIOUSNESS_TAG,
    DEFAULT_TIER,
    MAX_TRAVERSAL_DEPTH,
    NODE_PREFIX_VALUES_NODE,
    TIER_RANK,
)
from src.archon_consciousness.context_descriptor import (
    ContextDescriptor,
    context_matches,
)
from src.archon_consciousness.mcp_client import MemoryGraphClient

logger = logging.getLogger(__name__)


class ValuesDAG:
    """Manages the behavioral rule priority DAG with conflict resolution.

    Stores edges in MemoryGraph as relationships between ValuesNode nodes.
    Maintains a session-scoped hysteresis cache to prevent oscillation.
    """

    def __init__(self, client: MemoryGraphClient):
        self._client = client
        self._hysteresis: dict[frozenset, dict] = {}

    # ─── Conflict Resolution (FR-CON-014) ──────────────────────────

    def resolve_conflict(
        self, rule_a: str, rule_b: str, current_context: ContextDescriptor,
    ) -> dict:
        """Resolve a conflict between two rules using the 6-step algorithm.

        Returns dict with: winner, loser, rule_a, rule_b, step, reason.
        """
        pair = frozenset({rule_a, rule_b})

        # Step 0: Hysteresis cache
        if pair in self._hysteresis:
            cached = dict(self._hysteresis[pair])
            cached["step"] = "hysteresis"
            return cached

        # Step 1: Tier check
        result = self._step_tier_check(rule_a, rule_b)
        if result:
            self._cache(pair, result)
            return result

        # Step 2: STRICT_PRIORITY
        result = self._step_strict(rule_a, rule_b)
        if result:
            self._cache(pair, result)
            return result

        # Step 3: DEFEATS (1-hop, context-matched)
        result = self._step_defeats(rule_a, rule_b, current_context)
        if result:
            self._cache(pair, result)
            return result

        # Step 4: DEFEASIBLE_PRIORITY (transitive, context-matched)
        result = self._step_defeasible(rule_a, rule_b, current_context)
        if result:
            self._cache(pair, result)
            return result

        # Step 5: Unresolved
        return self._make_result(rule_a, rule_b, None, "unresolved", "No valid path")

    # ─── Edge Management ───────────────────────────────────────────

    def add_edge(
        self, source: str, target: str, edge_type: str,
        weight: float = 1.0,
        context: Optional[ContextDescriptor] = None,
    ) -> None:
        """Add a priority edge between two rules."""
        src_name = f"{NODE_PREFIX_VALUES_NODE}-{source}"
        tgt_name = f"{NODE_PREFIX_VALUES_NODE}-{target}"
        props = {"edge_type": edge_type, "weight": weight}
        if context is not None:
            props["context"] = context.to_dict()
        self._client.create_relationship(src_name, tgt_name, edge_type, props)

    def remove_edge(self, source: str, target: str) -> None:
        """Remove all priority edges between source and target.

        NOTE: MemoryGraph MCP doesn't expose fine-grained relationship
        deletion. In production, this requires backend-specific handling.
        The mock supports it via direct manipulation.
        """
        self.flush_hysteresis(source)
        self.flush_hysteresis(target)
        src_name = f"{NODE_PREFIX_VALUES_NODE}-{source}"
        tgt_name = f"{NODE_PREFIX_VALUES_NODE}-{target}"
        # Remove relationships matching source→target
        if hasattr(self._client._backend, 'relationships'):
            self._client._backend.relationships = [
                r for r in self._client._backend.relationships
                if not (r["source"] == src_name and r["target"] == tgt_name)
            ]

    # ─── Tier Assignment (FR-CON-028) ────────────────────────────

    def assign_tier(self, rule_id: str, tier: str) -> None:
        """Assign or reassign a tier to a rule."""
        name = f"{NODE_PREFIX_VALUES_NODE}-{rule_id}"
        mem = self._client.get(name)
        if mem is None:
            raise KeyError(f"Rule not found: {rule_id}")
        content = json.loads(mem["content"])
        content["tier"] = tier
        self._client.store(
            name=name, memory_type="ValuesNode",
            content=json.dumps(content), importance=0.8,
            tags=[CONSCIOUSNESS_TAG, "values-node"],
        )

    # ─── Hysteresis ────────────────────────────────────────────────

    def flush_hysteresis(self, rule_id: str | None = None) -> None:
        """Flush hysteresis cache entries. None = flush all."""
        if rule_id is None:
            self._hysteresis.clear()
            return
        to_remove = [k for k in self._hysteresis if rule_id in k]
        for k in to_remove:
            del self._hysteresis[k]

    def _cache(self, pair: frozenset, result: dict) -> None:
        self._hysteresis[pair] = result

    # ─── Cycle Detection (FR-CON-015) ──────────────────────────────

    def detect_cycles(self) -> list[list[str]]:
        """Detect cycles in STRICT and DEFEASIBLE edges via DFS."""
        graph = self._build_adjacency()
        visited = set()
        rec_stack = set()
        cycles = []

        def dfs(node, path):
            visited.add(node)
            rec_stack.add(node)
            path.append(node)
            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    dfs(neighbor, path)
                elif neighbor in rec_stack:
                    idx = path.index(neighbor)
                    cycles.append(list(path[idx:]))
            path.pop()
            rec_stack.discard(node)

        for node in graph:
            if node not in visited:
                dfs(node, [])
        return cycles

    def _build_adjacency(self) -> dict[str, list[str]]:
        """Build adjacency list from all priority edges."""
        graph: dict[str, list[str]] = {}
        all_nodes = self._client.list_by_type("ValuesNode")
        for mem in all_nodes:
            content = json.loads(mem["content"])
            if content.get("status") != "active":
                continue
            rule_id = content["rule_id"]
            name = f"{NODE_PREFIX_VALUES_NODE}-{rule_id}"
            related = self._client.get_related(name, direction="outgoing")
            for rel in related:
                rel_type = rel.get("_relationship", {}).get("type", "")
                if rel_type in ("STRICT_PRIORITY", "DEFEASIBLE_PRIORITY"):
                    target_name = rel["name"]
                    target_id = target_name.replace(f"{NODE_PREFIX_VALUES_NODE}-", "")
                    graph.setdefault(rule_id, []).append(target_id)
        return graph

    # ─── Step Implementations ──────────────────────────────────────

    def _step_tier_check(self, rule_a: str, rule_b: str) -> dict | None:
        tier_a = self._get_tier(rule_a)
        tier_b = self._get_tier(rule_b)
        if tier_a == tier_b:
            return None
        rank_a = TIER_RANK.get(tier_a, TIER_RANK[DEFAULT_TIER])
        rank_b = TIER_RANK.get(tier_b, TIER_RANK[DEFAULT_TIER])
        if rank_a < rank_b:
            return self._make_result(rule_a, rule_b, rule_a, "tier",
                                     f"{tier_a} outranks {tier_b}")
        return self._make_result(rule_a, rule_b, rule_b, "tier",
                                 f"{tier_b} outranks {tier_a}")

    def _step_strict(self, rule_a: str, rule_b: str) -> dict | None:
        """Check STRICT_PRIORITY edges (transitive, max depth).
        Archived nodes are skipped during traversal in _has_path."""
        if self._has_path(rule_a, rule_b, "STRICT_PRIORITY"):
            return self._make_result(rule_a, rule_b, rule_a, "strict",
                                     "STRICT_PRIORITY path A→B")
        if self._has_path(rule_b, rule_a, "STRICT_PRIORITY"):
            return self._make_result(rule_a, rule_b, rule_b, "strict",
                                     "STRICT_PRIORITY path B→A")
        return None

    def _step_defeats(
        self, rule_a: str, rule_b: str, ctx: ContextDescriptor,
    ) -> dict | None:
        """Check DEFEATS edges (1-hop only, context-matched)."""
        if self._has_direct_defeats(rule_a, rule_b, ctx):
            return self._make_result(rule_a, rule_b, rule_a, "defeats",
                                     "DEFEATS A→B with matching context",
                                     context_evaluated=ctx.to_dict())
        if self._has_direct_defeats(rule_b, rule_a, ctx):
            return self._make_result(rule_a, rule_b, rule_b, "defeats",
                                     "DEFEATS B→A with matching context",
                                     context_evaluated=ctx.to_dict())
        return None

    def _step_defeasible(
        self, rule_a: str, rule_b: str, ctx: ContextDescriptor,
    ) -> dict | None:
        """Check DEFEASIBLE_PRIORITY (transitive, context on all edges)."""
        weight_ab = self._best_defeasible_path(rule_a, rule_b, ctx)
        weight_ba = self._best_defeasible_path(rule_b, rule_a, ctx)
        if weight_ab is not None and (weight_ba is None or weight_ab > weight_ba):
            return self._make_result(rule_a, rule_b, rule_a, "defeasible",
                                     f"DEFEASIBLE path A→B (min_weight={weight_ab:.2f})")
        if weight_ba is not None:
            return self._make_result(rule_a, rule_b, rule_b, "defeasible",
                                     f"DEFEASIBLE path B→A (min_weight={weight_ba:.2f})")
        return None

    # ─── Graph Traversal Helpers ───────────────────────────────────

    def _has_path(self, source: str, target: str, edge_type: str) -> bool:
        """BFS for a path via edge_type, max depth, skipping archived."""
        if self._is_archived(source):
            return False
        queue = deque([(source, 0)])
        visited = {source}
        while queue:
            current, depth = queue.popleft()
            if depth >= MAX_TRAVERSAL_DEPTH:
                continue
            for neighbor in self._get_neighbors(current, edge_type):
                if self._is_archived(neighbor):
                    continue
                if neighbor == target:
                    return True
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, depth + 1))
        return False

    def _has_direct_defeats(
        self, source: str, target: str, ctx: ContextDescriptor,
    ) -> bool:
        """Check for a direct (1-hop) DEFEATS edge with matching context."""
        if self._is_archived(source):
            return False
        src_name = f"{NODE_PREFIX_VALUES_NODE}-{source}"
        related = self._client.get_related(src_name, "DEFEATS", direction="outgoing")
        for rel in related:
            target_name = rel["name"]
            target_id = target_name.replace(f"{NODE_PREFIX_VALUES_NODE}-", "")
            if target_id != target:
                continue
            if self._is_archived(target_id):
                continue
            edge_ctx = self._parse_edge_context(rel)
            if context_matches(ctx, edge_ctx):
                return True
        return False

    def _best_defeasible_path(
        self, source: str, target: str, ctx: ContextDescriptor,
    ) -> float | None:
        """BFS for best DEFEASIBLE_PRIORITY path (all contexts must match).

        Returns the highest minimum-edge-weight among valid paths, or None.
        """
        # BFS with (node, depth, min_weight_so_far)
        queue = deque([(source, 0, 1.0)])
        best_min_weight = None
        visited_with_weight: dict[str, float] = {source: 1.0}

        while queue:
            current, depth, min_w = queue.popleft()
            if depth >= MAX_TRAVERSAL_DEPTH:
                continue
            src_name = f"{NODE_PREFIX_VALUES_NODE}-{current}"
            related = self._client.get_related(
                src_name, "DEFEASIBLE_PRIORITY", direction="outgoing",
            )
            for rel in related:
                neighbor_name = rel["name"]
                neighbor_id = neighbor_name.replace(f"{NODE_PREFIX_VALUES_NODE}-", "")
                if self._is_archived(neighbor_id):
                    continue
                edge_ctx = self._parse_edge_context(rel)
                if not context_matches(ctx, edge_ctx):
                    continue
                edge_weight = rel.get("_relationship", {}).get("properties", {}).get("weight", 0.5)
                path_min = min(min_w, edge_weight)

                if neighbor_id == target:
                    if best_min_weight is None or path_min > best_min_weight:
                        best_min_weight = path_min
                    continue

                prev = visited_with_weight.get(neighbor_id, -1.0)
                if path_min > prev:
                    visited_with_weight[neighbor_id] = path_min
                    queue.append((neighbor_id, depth + 1, path_min))

        return best_min_weight

    def _get_neighbors(self, rule_id: str, edge_type: str) -> list[str]:
        """Get outgoing neighbors for a specific edge type."""
        src_name = f"{NODE_PREFIX_VALUES_NODE}-{rule_id}"
        related = self._client.get_related(src_name, edge_type, direction="outgoing")
        return [
            r["name"].replace(f"{NODE_PREFIX_VALUES_NODE}-", "")
            for r in related
        ]

    def _get_tier(self, rule_id: str) -> str:
        """Get tier for a rule, defaulting to guidelines if not found."""
        mem = self._client.get(f"{NODE_PREFIX_VALUES_NODE}-{rule_id}")
        if mem is None:
            return DEFAULT_TIER
        content = json.loads(mem["content"])
        return content.get("tier", DEFAULT_TIER)

    def _is_archived(self, rule_id: str) -> bool:
        """Check if a rule is archived or deprecated."""
        mem = self._client.get(f"{NODE_PREFIX_VALUES_NODE}-{rule_id}")
        if mem is None:
            return False
        content = json.loads(mem["content"])
        return content.get("status") in ("archived", "deprecated")

    def _parse_edge_context(self, rel: dict) -> ContextDescriptor | None:
        """Parse ContextDescriptor from edge properties."""
        props = rel.get("_relationship", {}).get("properties", {})
        ctx_data = props.get("context")
        if ctx_data is None:
            return None
        if isinstance(ctx_data, dict):
            return ContextDescriptor.from_dict(ctx_data)
        return None

    @staticmethod
    def _make_result(
        rule_a: str, rule_b: str, winner: str | None,
        step: str, reason: str,
        path: list[str] | None = None,
        context_evaluated: dict | None = None,
    ) -> dict:
        return {
            "rule_a": rule_a, "rule_b": rule_b,
            "winner": winner,
            "loser": rule_b if winner == rule_a else (rule_a if winner == rule_b else None),
            "step": step, "reason": reason,
            "path": path or [],
            "context_evaluated": context_evaluated,
        }
