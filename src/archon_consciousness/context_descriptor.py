"""ContextDescriptor schema and matching logic for values DAG.

Used by FR-CON-014's conflict resolution algorithm to determine
whether a context-sensitive edge applies to the current situation.

Matching rules (per PRD):
- "any" on the EDGE side is a wildcard (matches everything)
- "any" on the CURRENT side does NOT wildcard-match a specific edge value
- None edge_context matches all situations
- All 3 fields must match for the overall match to succeed
"""

from dataclasses import dataclass

from src.archon_consciousness.constants import (
    CONTEXT_MODES,
    CONTEXT_TASK_TYPES,
    EMOTIONAL_STATES,
)

# user_state allows all 6 emotional states plus "any"
_VALID_USER_STATES = EMOTIONAL_STATES + ("any",)


@dataclass(frozen=True)
class ContextDescriptor:
    """Structured context for DAG edge matching.

    Fields:
        mode: "pipeline" | "manual" | "any"
        user_state: one of 6 emotional states | "any"
        task_type: "coding" | "research" | "review" | "any"
    """

    mode: str
    user_state: str
    task_type: str

    def __post_init__(self):
        if self.mode not in CONTEXT_MODES:
            raise ValueError(
                f"mode must be one of {CONTEXT_MODES}, got '{self.mode}'"
            )
        if self.user_state not in _VALID_USER_STATES:
            raise ValueError(
                f"user_state must be one of {_VALID_USER_STATES}, "
                f"got '{self.user_state}'"
            )
        if self.task_type not in CONTEXT_TASK_TYPES:
            raise ValueError(
                f"task_type must be one of {CONTEXT_TASK_TYPES}, "
                f"got '{self.task_type}'"
            )

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "user_state": self.user_state,
            "task_type": self.task_type,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ContextDescriptor":
        return cls(
            mode=d["mode"],
            user_state=d["user_state"],
            task_type=d["task_type"],
        )


def context_matches(
    current: ContextDescriptor,
    edge_context: ContextDescriptor | None,
) -> bool:
    """Determine if the current situation matches an edge's context.

    Args:
        current: The current situation context.
        edge_context: The context condition on a DAG edge, or None.

    Returns:
        True if the edge applies in the current situation.

    Rules:
        - None edge_context matches all situations.
        - "any" on the edge side matches any value in that field.
        - "any" on the current side does NOT match specific edge values.
        - All 3 fields must match independently.
    """
    if edge_context is None:
        return True

    if edge_context.mode != "any" and current.mode != edge_context.mode:
        return False
    if edge_context.user_state != "any" and current.user_state != edge_context.user_state:
        return False
    if edge_context.task_type != "any" and current.task_type != edge_context.task_type:
        return False

    return True
