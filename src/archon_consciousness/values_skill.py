"""Values skill command router for Archon Consciousness.

Routes /values operations to the appropriate subsystem modules:
- RuleRegistry for add/remove
- PatternTracker for show-atrophy
- ValuesDAG for reprioritize, show-conflicts, show-deep-chains,
  deprecate, show-broken-chains

Implements FR-CON-016.
"""

import json

from src.archon_consciousness.constants import (
    DEFAULT_TIER,
    NODE_PREFIX_PATTERN_SCORE,
    NODE_PREFIX_VALUES_NODE,
    TIERS,
)
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.pattern_tracker import PatternTracker
from src.archon_consciousness.rule_registry import RuleRegistry
from src.archon_consciousness.values_dag import ValuesDAG

_OPERATIONS = [
    "list", "add", "remove", "reprioritize",
    "show-conflicts", "show-atrophy", "show-deep-chains",
    "deprecate", "show-broken-chains",
]

_HELP_TEXT = (
    "Available operations:\n"
    "  list                — Show all active rules\n"
    "  add <text> [--tier T] — Create a new rule\n"
    "  remove <rule_id>    — Archive a rule\n"
    "  reprioritize <a> <b> <edge_type> [context]\n"
    "  show-conflicts      — List unresolved conflicts\n"
    "  show-atrophy        — List stale high-score rules\n"
    "  show-deep-chains    — List priority chains > 5 hops\n"
    "  deprecate <old> <new> — Deprecate with SUPERSEDED_BY\n"
    "  show-broken-chains  — List broken deprecation chains\n"
)


class ValuesSkill:
    """Command router for /values skill."""

    def __init__(self, client: MemoryGraphClient, session_num: int):
        self._client = client
        self._registry = RuleRegistry(client)
        self._tracker = PatternTracker(client, session_num)
        self._dag = ValuesDAG(client)
        self._session_num = session_num

    def execute(self, operation: str, args: str = "") -> str:
        """Route an operation to the appropriate handler."""
        op = operation.strip()
        if not op or op not in _OPERATIONS:
            return f"Unknown operation: '{op}'\n\n{_HELP_TEXT}"

        dispatch = {
            "list": self._op_list,
            "add": self._op_add,
            "remove": self._op_remove,
            "reprioritize": self._op_reprioritize,
            "show-conflicts": self._op_show_conflicts,
            "show-atrophy": self._op_show_atrophy,
            "show-deep-chains": self._op_show_deep_chains,
            "deprecate": self._op_deprecate,
            "show-broken-chains": self._op_show_broken_chains,
        }
        handler = dispatch[op]
        return handler(args.strip())

    # ─── Operation Handlers ───────────────────────────────────────

    def _op_list(self, args: str) -> str:
        """List all active rules with rule_id, tier, score, trend."""
        rules = self._registry.list_active_rules()
        if not rules:
            return "No active rules found. Use 'add' to create one."

        lines = [f"Active rules ({len(rules)}):"]
        lines.append(f"  {'RULE ID':<30} {'TIER':<14} {'SCORE':<8} {'TREND'}")
        lines.append("  " + "-" * 70)
        for rule in rules:
            score_data = self._get_score_data(rule.rule_id)
            score = score_data.get("score", 0.0) if score_data else 0.0
            trend = score_data.get("trend", "?") if score_data else "?"
            lines.append(
                f"  {rule.rule_id:<30} {rule.tier:<14} "
                f"{score:<8.2f} {trend}"
            )
        return "\n".join(lines)

    def _op_add(self, args: str) -> str:
        """Create a new rule from text. Supports --tier flag."""
        tier = DEFAULT_TIER
        rule_text = args

        if "--tier" in args:
            parts = args.split("--tier")
            rule_text = parts[0].strip()
            tier_arg = parts[1].strip().split()[0] if parts[1].strip() else ""
            if tier_arg in TIERS:
                tier = tier_arg

        if not rule_text:
            return "Error: rule text is required. Usage: add <text> [--tier T]"

        try:
            rule_id = self._registry.create_rule(rule_text, tier)
            return f"Created rule '{rule_id}' (tier={tier})"
        except ValueError as e:
            return f"Error: {e}"

    def _op_remove(self, args: str) -> str:
        """Archive a rule by rule_id."""
        rule_id = args.strip()
        if not rule_id:
            return "Error: rule_id is required. Usage: remove <rule_id>"
        try:
            self._registry.archive_rule(rule_id)
            return f"Archived rule '{rule_id}'"
        except KeyError:
            return f"Error: rule not found '{rule_id}'"

    def _op_reprioritize(self, args: str) -> str:
        """Add/update a priority edge between two rules."""
        parts = args.split()
        if len(parts) < 3:
            return (
                "Error: requires at least 3 arguments.\n"
                "Usage: reprioritize <rule_a> <rule_b> <edge_type> [context]"
            )
        rule_a, rule_b, edge_type = parts[0], parts[1], parts[2]
        self._dag.add_edge(rule_a, rule_b, edge_type)
        return f"Added {edge_type} edge: {rule_a} -> {rule_b}"

    def _op_show_conflicts(self, args: str) -> str:
        """List unresolved conflicts from the DAG."""
        cycles = self._dag.detect_cycles()
        if not cycles:
            return "No unresolved conflicts detected."
        lines = [f"Detected {len(cycles)} conflict(s):"]
        for i, cycle in enumerate(cycles, 1):
            lines.append(f"  {i}. {' -> '.join(cycle)}")
        return "\n".join(lines)

    def _op_show_atrophy(self, args: str) -> str:
        """List rules with high scores but untested for many sessions."""
        alerts = self._tracker.check_alerts()
        atrophy = [a for a in alerts if a["type"] == "atrophy"]
        if not atrophy:
            return "No atrophy alerts. All high-score rules tested recently."
        lines = [f"Atrophy alerts ({len(atrophy)}):"]
        for a in atrophy:
            lines.append(
                f"  {a['rule_id']}: score={a['score']:.2f}, "
                f"{a['details']}"
            )
        return "\n".join(lines)

    def _op_show_deep_chains(self, args: str) -> str:
        """List priority chains longer than 5 hops."""
        graph = self._dag._build_adjacency()
        deep = []
        for start in graph:
            chains = self._find_chains(graph, start, max_depth=20)
            for chain in chains:
                if len(chain) > 5:
                    deep.append(chain)
        if not deep:
            return "No deep priority chains found (all <= 5 hops)."
        lines = [f"Deep chains ({len(deep)}):"]
        for chain in deep:
            lines.append(f"  {' -> '.join(chain)} ({len(chain)} hops)")
        return "\n".join(lines)

    def _op_deprecate(self, args: str) -> str:
        """Deprecate a rule in favor of another."""
        parts = args.split()
        if len(parts) < 2:
            return "Error: requires 2 arguments. Usage: deprecate <old> <new>"
        old_id, new_id = parts[0], parts[1]
        try:
            self._registry.deprecate_rule(old_id, new_id)
            return f"Deprecated '{old_id}' in favor of '{new_id}'"
        except KeyError as e:
            return f"Error: {e}"

    def _op_show_broken_chains(self, args: str) -> str:
        """List deprecation chains terminating at non-active rules."""
        all_nodes = self._client.list_by_type("ValuesNode")
        broken = []
        for mem in all_nodes:
            content = json.loads(mem["content"])
            if content.get("status") != "deprecated":
                continue
            rule_id = content["rule_id"]
            terminal = self._registry.follow_supersession_chain(rule_id)
            if terminal is None:
                broken.append(rule_id)
        if not broken:
            return "No broken deprecation chains found."
        lines = [f"Broken deprecation chains ({len(broken)}):"]
        for rid in broken:
            lines.append(f"  {rid} -> (no active terminal)")
        return "\n".join(lines)

    # ─── Helpers ──────────────────────────────────────────────────

    def _get_score_data(self, rule_id: str) -> dict | None:
        """Load PatternScore data for a rule."""
        mem = self._client.get(f"{NODE_PREFIX_PATTERN_SCORE}-{rule_id}")
        if mem is None:
            return None
        return json.loads(mem["content"])

    @staticmethod
    def _find_chains(
        graph: dict[str, list[str]],
        start: str,
        max_depth: int = 20,
    ) -> list[list[str]]:
        """DFS to find all chains from start node."""
        chains: list[list[str]] = []

        def dfs(node: str, path: list[str]) -> None:
            neighbors = graph.get(node, [])
            if not neighbors or len(path) >= max_depth:
                if len(path) > 1:
                    chains.append(list(path))
                return
            for neighbor in neighbors:
                if neighbor not in path:
                    path.append(neighbor)
                    dfs(neighbor, path)
                    path.pop()
                else:
                    if len(path) > 1:
                        chains.append(list(path))

        dfs(start, [start])
        return chains
