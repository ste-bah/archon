"""Intent skill command router for Archon Consciousness.

Routes /intent operations to the IntentModel subsystem:
- list: show active goals with confidence and evidence count
- show-evidence: display evidence and contradictions for a goal
- confirm: add explicit confirmation as evidence
- correct: update goal description
- promote: promote session-scoped goal to persistent

Implements FR-CON-024.
"""

import json
from datetime import datetime, timezone

from src.archon_consciousness.constants import NODE_PREFIX_INTENT
from src.archon_consciousness.intent_model import IntentModel
from src.archon_consciousness.mcp_client import MemoryGraphClient

_OPERATIONS = ["list", "show-evidence", "confirm", "correct", "promote"]

_HELP_TEXT = (
    "Available operations:\n"
    "  list                    — Show all active goals\n"
    "  show-evidence <goal_id> — Show evidence for a goal\n"
    "  confirm <goal_id>       — Add confirmation evidence\n"
    "  correct <goal_id> <desc> — Update goal description\n"
    "  promote <goal_id>       — Promote session goal to persistent\n"
)


class IntentSkill:
    """Command router for /intent skill."""

    def __init__(self, client: MemoryGraphClient):
        self._client = client
        self._model = IntentModel(client)

    def execute(self, operation: str, args: str = "") -> str:
        """Route an operation to the appropriate handler."""
        op = operation.strip()
        if not op or op not in _OPERATIONS:
            return f"Unknown operation: '{op}'\n\n{_HELP_TEXT}"

        dispatch = {
            "list": self._op_list,
            "show-evidence": self._op_show_evidence,
            "confirm": self._op_confirm,
            "correct": self._op_correct,
            "promote": self._op_promote,
        }
        handler = dispatch[op]
        return handler(args.strip())

    # ─── Operation Handlers ───────────────────────────────────────

    def _op_list(self, args: str) -> str:
        """List all active goals with confidence and evidence count."""
        goals = self._model.list_active_goals()
        if not goals:
            return "No active goals found. Goals are created from patterns."

        lines = [f"Active goals ({len(goals)}):"]
        lines.append(
            f"  {'GOAL ID':<30} {'TIER':<12} {'CONFIDENCE':<12} {'EVIDENCE'}"
        )
        lines.append("  " + "-" * 70)
        for goal in goals:
            gid = goal["goal_id"]
            tier = goal.get("tier", "?")
            confidence = self._model.compute_confidence(gid)
            evidence = self._model.get_evidence(gid)
            lines.append(
                f"  {gid:<30} {tier:<12} "
                f"{confidence:<12.2f} {len(evidence)}"
            )
        return "\n".join(lines)

    def _op_show_evidence(self, args: str) -> str:
        """Show all evidence and contradictions for a goal."""
        goal_id = args.strip()
        if not goal_id:
            return "Error: goal_id required. Usage: show-evidence <goal_id>"

        goal = self._model.get_goal(goal_id)
        if goal is None:
            return f"Error: goal not found '{goal_id}'"

        evidence = self._model.get_evidence(goal_id)
        contradictions = self._model.get_contradictions(goal_id)
        confidence = self._model.compute_confidence(goal_id)

        lines = [
            f"Goal: {goal_id}",
            f"Description: {goal.get('description', '?')}",
            f"Confidence: {confidence:.2f}",
            "",
            f"Evidence ({len(evidence)}):",
        ]
        if evidence:
            for i, ev in enumerate(evidence, 1):
                ref = ev.get("evidence_ref", ev.get("raw", "?"))
                lines.append(f"  {i}. {ref}")
        else:
            lines.append("  (none)")

        lines.append(f"\nContradictions ({len(contradictions)}):")
        if contradictions:
            for i, c in enumerate(contradictions, 1):
                text = c.get("text", c.get("raw", "?"))
                lines.append(f"  {i}. {text}")
        else:
            lines.append("  (none)")

        return "\n".join(lines)

    def _op_confirm(self, args: str) -> str:
        """Add explicit confirmation as evidence for a goal."""
        goal_id = args.strip()
        if not goal_id:
            return "Error: goal_id required. Usage: confirm <goal_id>"

        goal = self._model.get_goal(goal_id)
        if goal is None:
            return f"Error: goal not found '{goal_id}'"

        ref = f"user-confirmation-{datetime.now(timezone.utc).isoformat()}"
        self._model.add_evidence(goal_id, ref)
        new_confidence = self._model.compute_confidence(goal_id)
        return (
            f"Confirmed goal '{goal_id}'. "
            f"New confidence: {new_confidence:.2f}"
        )

    def _op_correct(self, args: str) -> str:
        """Update goal description."""
        parts = args.split(maxsplit=1)
        if len(parts) < 2:
            return (
                "Error: requires goal_id and new description.\n"
                "Usage: correct <goal_id> <new_description>"
            )
        goal_id, new_desc = parts[0], parts[1]

        goal = self._model.get_goal(goal_id)
        if goal is None:
            return f"Error: goal not found '{goal_id}'"

        goal["description"] = new_desc
        node_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        self._client.update(node_name, content=json.dumps(goal))
        return f"Updated goal '{goal_id}' description."

    def _op_promote(self, args: str) -> str:
        """Promote a session-scoped goal to persistent."""
        goal_id = args.strip()
        if not goal_id:
            return "Error: goal_id required. Usage: promote <goal_id>"

        goal = self._model.get_goal(goal_id)
        if goal is None:
            return f"Error: goal not found '{goal_id}'"

        if goal.get("tier") == "persistent":
            return f"Goal '{goal_id}' is already persistent."

        goal["tier"] = "persistent"
        node_name = f"{NODE_PREFIX_INTENT}-{goal_id}"
        self._client.update(node_name, content=json.dumps(goal))
        return f"Promoted goal '{goal_id}' to persistent tier."
