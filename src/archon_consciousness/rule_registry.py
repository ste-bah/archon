"""Rule registry for Archon Consciousness behavioral rules.

Handles:
- Rule creation with auto-generated kebab-case rule_id
- Collision resolution (qualifier word, then -N suffix)
- Rule lifecycle (active → archived, active → deprecated)
- SUPERSEDED_BY chain following for deprecated rules
- Capacity enforcement (max 200 active rules)

All persistence via MemoryGraphClient (mockable for tests).
"""

import json
import re
import uuid
from datetime import datetime, timezone

from src.archon_consciousness.constants import (
    CONSCIOUSNESS_TAG,
    DEFAULT_TIER,
    MAX_ACTIVE_RULES,
    MAX_SUPERSESSION_CHAIN_DEPTH,
    NODE_PREFIX_PATTERN_SCORE,
    NODE_PREFIX_VALUES_NODE,
    RULE_ID_MAX_LENGTH,
    RULE_ID_PATTERN,
    RULE_ID_STOP_WORDS,
    SCORE_INITIAL,
    TIERS,
)
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import PatternScore, ValuesNode


class RuleRegistry:
    """Manages behavioral rule CRUD, IDs, lifecycle, and capacity.

    Args:
        client: MemoryGraphClient for persistence.
    """

    def __init__(self, client: MemoryGraphClient):
        self._client = client
        self._on_archive_hooks: list = []  # TASK-CON-006 registers hysteresis flush here
        self._on_deprecate_hooks: list = []

    # ─── Rule ID Generation ────────────────────────────────────────

    def generate_rule_id(self, rule_text: str) -> str:
        """Generate a kebab-case rule_id from natural language text.

        Algorithm:
        1. Lowercase, strip punctuation
        2. Split into words, remove stop words
        3. Take first 5 meaningful words
        4. Join with hyphens
        5. Truncate to RULE_ID_MAX_LENGTH
        6. If empty (all stop words), use "rule-<short-uuid>" fallback
        """
        # Strip punctuation, lowercase
        cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", rule_text.lower())
        words = cleaned.split()

        # Remove stop words
        meaningful = [w for w in words if w not in RULE_ID_STOP_WORDS]

        if not meaningful:
            # All stop words — fallback
            return f"rule-{uuid.uuid4().hex[:8]}"

        # Take first 5 words, join with hyphens
        candidate = "-".join(meaningful[:5])

        # Truncate to max length, but don't cut in the middle of a word
        if len(candidate) > RULE_ID_MAX_LENGTH:
            # Find last hyphen before the limit
            truncated = candidate[:RULE_ID_MAX_LENGTH]
            last_hyphen = truncated.rfind("-")
            if last_hyphen > 0:
                candidate = truncated[:last_hyphen]
            else:
                candidate = truncated

        return candidate.rstrip("-")

    def resolve_collision(
        self,
        candidate_id: str,
        existing_ids: set[str],
        rule_text: str = "",
    ) -> str:
        """Resolve a rule_id collision.

        Strategy (per PRD FR-CON-029):
        1. If no collision, return candidate as-is.
        2. Append distinguishing scope word from rule_text.
        3. If still colliding, append -N (next available integer).

        Args:
            candidate_id: The generated rule_id that collides.
            existing_ids: Set of all existing rule_ids (active + archived).
            rule_text: Original rule text for qualifier extraction.

        Returns:
            A unique rule_id that doesn't collide.
        """
        if candidate_id not in existing_ids:
            return candidate_id

        # Try adding a qualifier word from the rule text
        if rule_text:
            qualifier = self._extract_qualifier(candidate_id, rule_text)
            if qualifier:
                qualified = f"{candidate_id}-{qualifier}"
                if len(qualified) <= RULE_ID_MAX_LENGTH and qualified not in existing_ids:
                    return qualified

        # Numeric suffix fallback
        for n in range(2, 1000):
            suffixed = f"{candidate_id}-{n}"
            if len(suffixed) <= RULE_ID_MAX_LENGTH and suffixed not in existing_ids:
                return suffixed

        # Extreme fallback (should never reach here)
        return f"{candidate_id}-{uuid.uuid4().hex[:6]}"

    _QUALIFIER_SKIP_VERBS = frozenset({
        "use", "write", "make", "dont", "never", "always", "keep",
        "ensure", "avoid", "prefer", "check", "run", "add", "create",
        "set", "get", "put", "let", "take", "give", "try", "start",
    })

    def _extract_qualifier(self, candidate_id: str, rule_text: str) -> str | None:
        """Extract the single most discriminating noun from rule_text
        that isn't already in the candidate_id.

        Prefers longer words (more discriminating) and skips common verbs.
        """
        cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", rule_text.lower())
        words = cleaned.split()
        candidate_words = set(candidate_id.split("-"))

        # Collect candidates, prefer longer words (more discriminating)
        candidates = []
        for word in words:
            if (word not in RULE_ID_STOP_WORDS
                    and word not in self._QUALIFIER_SKIP_VERBS
                    and word not in candidate_words
                    and len(word) >= 3):
                candidates.append(word)

        if not candidates:
            return None
        # Sort by length descending — longest word is most discriminating
        candidates.sort(key=len, reverse=True)
        return candidates[0]

    # ─── CRUD Operations ───────────────────────────────────────────

    def create_rule(
        self,
        rule_text: str,
        tier: str = DEFAULT_TIER,
    ) -> str:
        """Create a new behavioral rule with auto-generated rule_id.

        Creates both a ValuesNode and a PatternScore (initial score 0.5).

        Args:
            rule_text: Natural language description of the rule.
            tier: One of safety/ethics/guidelines/helpfulness.

        Returns:
            The generated rule_id.

        Raises:
            ValueError: If at max capacity (200 active rules).
            ValueError: If tier is invalid.
        """
        if tier not in TIERS:
            raise ValueError(f"tier must be one of {TIERS}, got '{tier}'")
        self._check_capacity()
        rule_id = self._generate_unique_id(rule_text)
        self._store_new_rule(rule_id, rule_text, tier)
        return rule_id

    def _check_capacity(self) -> None:
        """Raise ValueError if at max active rules."""
        active_count = self.count_active_rules()
        if active_count >= MAX_ACTIVE_RULES:
            raise ValueError(
                f"Cannot create rule: maximum {MAX_ACTIVE_RULES} active rules reached "
                f"(current: {active_count}). Archive unused rules first."
            )

    def _generate_unique_id(self, rule_text: str) -> str:
        """Generate a collision-free rule_id from rule text."""
        existing_ids = self._all_rule_ids()
        candidate = self.generate_rule_id(rule_text)
        return self.resolve_collision(candidate, existing_ids, rule_text)

    def _store_new_rule(self, rule_id: str, rule_text: str, tier: str) -> None:
        """Persist ValuesNode and PatternScore for a new rule."""
        node = ValuesNode(
            rule_id=rule_id, rule_text=rule_text, tier=tier,
            status="active", created_at=datetime.now(timezone.utc),
        )
        self._client.store_from_schema(node)
        score = PatternScore(
            rule_id=rule_id, score=SCORE_INITIAL, last_tested_session=None,
            tested_session_count=0, last_delta=None,
            trend="insufficient_data", status="active",
        )
        self._client.store_from_schema(score)

    def get_rule(self, rule_id: str) -> ValuesNode | None:
        """Retrieve a rule by its rule_id. Returns None if not found."""
        return self._client.get_and_deserialize(
            f"{NODE_PREFIX_VALUES_NODE}-{rule_id}",
            ValuesNode,
        )

    def list_active_rules(self) -> list[ValuesNode]:
        """List all active (non-archived, non-deprecated) rules."""
        all_nodes = self._client.list_by_type("ValuesNode")
        result = []
        for mem in all_nodes:
            content = json.loads(mem["content"])
            if content.get("status") == "active":
                result.append(ValuesNode.from_dict(content))
        return result

    def count_active_rules(self) -> int:
        """Count active rules. Excludes archived and deprecated."""
        return len(self.list_active_rules())

    def is_rule_id_available(self, rule_id: str) -> bool:
        """Check if a rule_id is available for use.

        Returns False for both active AND archived IDs
        (archived IDs are permanently reserved per FR-CON-030).
        """
        return rule_id not in self._all_rule_ids()

    # ─── Lifecycle Operations ──────────────────────────────────────

    def archive_rule(self, rule_id: str) -> None:
        """Archive a rule (soft-delete).

        NOTE: Uses read-modify-write pattern (not atomic). In concurrent
        scenarios, updates between get and store could be lost. Acceptable
        for single-session Claude Code usage. If multi-session concurrency
        is needed, implement content-level CAS in MemoryGraphClient.

        Sets status to "archived" on both ValuesNode and PatternScore.
        Freezes the PatternScore trend. Idempotent — archiving an
        already-archived rule is a no-op.

        Raises:
            KeyError: If rule_id not found.
        """
        node = self.get_rule(rule_id)
        if node is None:
            raise KeyError(f"Rule not found: {rule_id}")

        if node.status == "archived":
            return  # Idempotent

        # Notify lifecycle hooks (e.g., hysteresis cache flush in TASK-CON-006)
        for hook in self._on_archive_hooks:
            hook(rule_id)

        # Update ValuesNode status
        updated_node = ValuesNode(
            rule_id=node.rule_id,
            rule_text=node.rule_text,
            tier=node.tier,
            status="archived",
            created_at=node.created_at,
        )
        self._client.store_from_schema(updated_node)

        # Update PatternScore status + freeze trend
        self._freeze_pattern_score(rule_id, "archived")

    def deprecate_rule(self, old_rule_id: str, new_rule_id: str) -> None:
        """Deprecate a rule in favor of another.

        Sets old rule status to "deprecated", creates SUPERSEDED_BY edge.

        Raises:
            KeyError: If either rule_id not found.
        """
        old_node = self.get_rule(old_rule_id)
        if old_node is None:
            raise KeyError(f"Rule not found: {old_rule_id}")

        new_node = self.get_rule(new_rule_id)
        if new_node is None:
            raise KeyError(f"Rule not found: {new_rule_id}")

        # Notify lifecycle hooks
        for hook in self._on_deprecate_hooks:
            hook(old_rule_id, new_rule_id)

        # Update old rule status
        updated_node = ValuesNode(
            rule_id=old_node.rule_id,
            rule_text=old_node.rule_text,
            tier=old_node.tier,
            status="deprecated",
            created_at=old_node.created_at,
        )
        self._client.store_from_schema(updated_node)

        # Freeze pattern score
        self._freeze_pattern_score(old_rule_id, "deprecated")

        # Create SUPERSEDED_BY edge
        self._client.create_relationship(
            source=f"{NODE_PREFIX_VALUES_NODE}-{old_rule_id}",
            target=f"{NODE_PREFIX_VALUES_NODE}-{new_rule_id}",
            relationship_type="SUPERSEDED_BY",
            properties={
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    def follow_supersession_chain(self, rule_id: str) -> ValuesNode | None:
        """Follow SUPERSEDED_BY chain to terminal active rule.

        Returns the terminal active ValuesNode, or None if the chain
        is broken (terminal is archived/deprecated). Max depth per PRD.

        If rule_id is already active, returns that rule.
        """
        current_id = rule_id
        for _ in range(MAX_SUPERSESSION_CHAIN_DEPTH):
            node = self.get_rule(current_id)
            if node is None:
                return None
            if node.status == "active":
                return node
            # Follow SUPERSEDED_BY edge
            related = self._client.get_related(
                f"{NODE_PREFIX_VALUES_NODE}-{current_id}",
                relationship_type="SUPERSEDED_BY",
                direction="outgoing",
            )
            if not related:
                return None  # Archived with no successor = broken chain
            # Extract the target rule_id from the related memory name
            target_name = related[0]["name"]
            # Name format: "valuesnode-<rule_id>"
            prefix = f"{NODE_PREFIX_VALUES_NODE}-"
            if target_name.startswith(prefix):
                current_id = target_name[len(prefix):]
            else:
                return None

        return None  # Chain too deep

    # ─── Internal Helpers ──────────────────────────────────────────

    def _all_rule_ids(self) -> set[str]:
        """Get all rule_ids (active + archived + deprecated)."""
        all_nodes = self._client.list_by_type("ValuesNode")
        ids = set()
        for mem in all_nodes:
            content = json.loads(mem["content"])
            ids.add(content["rule_id"])
        return ids

    def _freeze_pattern_score(self, rule_id: str, new_status: str) -> None:
        """Set PatternScore status and freeze trend to 'frozen'."""
        score_mem = self._client.get(f"{NODE_PREFIX_PATTERN_SCORE}-{rule_id}")
        if score_mem is None:
            return
        content = json.loads(score_mem["content"])
        content["status"] = new_status
        content["trend"] = "frozen"
        self._client.store(
            name=f"{NODE_PREFIX_PATTERN_SCORE}-{rule_id}",
            memory_type="PatternScore",
            content=json.dumps(content),
            importance=0.5,
            tags=[CONSCIOUSNESS_TAG, "pattern-score"],
        )
