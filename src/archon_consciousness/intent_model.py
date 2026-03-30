"""Intent model — goal storage, confidence computation, contradiction tracking.

Implements FR-CON-021 (intent graph + two-tier goals),
FR-CON-022 (confidence formula), FR-CON-023 (ambiguity querying).

Goals are stored as Intent nodes in MemoryGraph. Evidence and contradiction
markers are stored as small auxiliary nodes with EVIDENCED_BY / CONTRADICTED_BY
edges pointing FROM the marker TO the intent node (incoming direction on intent).
"""

import json
import re
import uuid
from datetime import datetime, timezone

from src.archon_consciousness.constants import (
    CONSCIOUSNESS_TAG,
    NODE_PREFIX_INTENT,
    RULE_ID_STOP_WORDS,
)
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import Intent


def _description_to_goal_id(description: str) -> str:
    """Convert a description string to a kebab-case goal_id.

    Strips punctuation, lowercases, removes stop words, joins with hyphens.
    Falls back to a UUID fragment if nothing remains after filtering.
    """
    text = description.lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    words = text.split()
    filtered = [w for w in words if w not in RULE_ID_STOP_WORDS]
    if not filtered:
        filtered = [w for w in words if w]  # fall back to all words
    if not filtered:
        return f"goal-{uuid.uuid4().hex[:8]}"
    return "-".join(filtered)


class IntentModel:
    """Manages the intent graph: goals, evidence, contradictions, confidence.

    Args:
        client: A MemoryGraphClient wrapping MockMemoryGraph or real MCP.
    """

    def __init__(self, client: MemoryGraphClient) -> None:
        self._client = client

    # ── Goal CRUD ─────────────────────────────────────────────────

    def create_goal(self, description: str, tier: str) -> str:
        """Create a new goal node and store it in MemoryGraph.

        Returns the generated goal_id (kebab-case derived from description).
        """
        goal_id = _description_to_goal_id(description)
        intent = Intent(
            goal_id=goal_id,
            description=description,
            tier=tier,
            confidence=0.0,
            status="active",
        )
        self._client.store_from_schema(intent)
        return goal_id

    def get_goal(self, goal_id: str) -> dict | None:
        """Retrieve a goal by its goal_id. Returns dict or None."""
        node_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        mem = self._client.get(node_name)
        if mem is None:
            return None
        return json.loads(mem["content"])

    # ── Evidence ──────────────────────────────────────────────────

    def add_evidence(self, goal_id: str, evidence_ref: str) -> None:
        """Add an evidence marker node and EVIDENCED_BY edge to the goal."""
        marker_id = f"evidence-{uuid.uuid4().hex[:12]}"
        marker_name = f"evidence-marker-{marker_id}"
        self._client.store(
            name=marker_name,
            memory_type="EvidenceMarker",
            content=json.dumps({
                "evidence_ref": evidence_ref,
                "goal_id": goal_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.3,
            tags=[CONSCIOUSNESS_TAG, "evidence-marker"],
        )
        intent_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        self._client.create_relationship(
            source=marker_name,
            target=intent_name,
            relationship_type="EVIDENCED_BY",
            properties={"evidence_ref": evidence_ref},
        )

    def get_evidence(self, goal_id: str) -> list[dict]:
        """Return all evidence markers linked to a goal (incoming EVIDENCED_BY)."""
        intent_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        related = self._client.get_related(
            name=intent_name,
            relationship_type="EVIDENCED_BY",
            direction="incoming",
        )
        results = []
        for mem in related:
            try:
                data = json.loads(mem["content"])
            except (json.JSONDecodeError, KeyError):
                data = {"raw": mem.get("content", "")}
            results.append(data)
        return results

    # ── Contradictions ────────────────────────────────────────────

    def add_contradiction(self, goal_id: str, contradiction_text: str) -> None:
        """Add a contradiction marker node and CONTRADICTED_BY edge."""
        marker_id = f"contra-{uuid.uuid4().hex[:12]}"
        marker_name = f"contradiction-marker-{marker_id}"
        self._client.store(
            name=marker_name,
            memory_type="ContradictionMarker",
            content=json.dumps({
                "text": contradiction_text,
                "goal_id": goal_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.4,
            tags=[CONSCIOUSNESS_TAG, "contradiction-marker"],
        )
        intent_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        self._client.create_relationship(
            source=marker_name,
            target=intent_name,
            relationship_type="CONTRADICTED_BY",
            properties={"text": contradiction_text},
        )

    def get_contradictions(self, goal_id: str) -> list[dict]:
        """Return all contradiction markers linked to a goal."""
        intent_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        related = self._client.get_related(
            name=intent_name,
            relationship_type="CONTRADICTED_BY",
            direction="incoming",
        )
        results = []
        for mem in related:
            try:
                data = json.loads(mem["content"])
            except (json.JSONDecodeError, KeyError):
                data = {"raw": mem.get("content", "")}
            results.append(data)
        return results

    # ── Confidence ────────────────────────────────────────────────

    def compute_confidence(self, goal_id: str) -> float:
        """Compute confidence at query time (FR-CON-022).

        Session-tier goals return 0.0. Persistent goals:
        base = min(1.0, evidence_count / 6.0 + nudge)
        Contradictions reduce: -0.15 per contradiction
        Hard cap: < 3 evidence cannot reach 0.5
        """
        goal = self.get_goal(goal_id)
        if goal is None:
            return 0.0
        if goal.get("tier") == "session":
            return 0.0

        evidence = self.get_evidence(goal_id)
        contradictions = self.get_contradictions(goal_id)
        ev_count = len(evidence)
        contra_count = len(contradictions)

        base = min(1.0, ev_count / 6.0 + (0.05 if ev_count >= 3 else 0.0))
        confidence = max(0.0, base - contra_count * 0.15)

        if ev_count < 3 and confidence >= 0.5:
            confidence = 0.499
        return confidence

    # ── Session lifecycle ─────────────────────────────────────────

    def archive_session_goals(self) -> None:
        """Set status='archived' for all session-tier goals."""
        all_intents = self._client.list_by_type("Intent")
        for mem in all_intents:
            data = json.loads(mem["content"])
            if data.get("tier") == "session" and data.get("status") == "active":
                data["status"] = "archived"
                self._client.update(
                    mem["name"],
                    content=json.dumps(data),
                )

    # ── Listing ───────────────────────────────────────────────────

    def list_active_goals(self) -> list[dict]:
        """Return all goals with status='active'."""
        all_intents = self._client.list_by_type("Intent")
        results = []
        for mem in all_intents:
            data = json.loads(mem["content"])
            if data.get("status") == "active":
                results.append(data)
        return results

    # ── Relevance query ───────────────────────────────────────────

    def query_relevant_goals(self, context: str) -> list[dict]:
        """Return active goals with confidence > 0.3 (FR-CON-023).

        Includes reasoning about each goal's relevance.
        """
        active = self.list_active_goals()
        ctx_words = set(context.lower().split())
        results = []
        for goal in active:
            gid = goal["goal_id"]
            confidence = self.compute_confidence(gid)
            if confidence <= 0.3:
                continue
            evidence = self.get_evidence(gid)
            desc_words = set(goal["description"].lower().split())
            overlap = ctx_words & desc_words
            results.append({
                "goal_id": gid,
                "description": goal["description"],
                "confidence": confidence,
                "evidence_count": len(evidence),
                "reasoning": (
                    f"Goal '{gid}' (confidence={confidence:.2f}) "
                    f"supported by {len(evidence)} evidence items. "
                    f"Context overlap: {overlap or 'general relevance'}."
                ),
            })
        return results
