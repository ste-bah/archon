"""Session lifecycle hook entry points for Archon Consciousness.

Three module-level functions wired to Claude Code hooks:
- on_session_start: inject prioritized rules, check for missing reflections,
  inject personality context (v2)
- on_session_end: run reflection, archive session-scoped intents,
  update personality subsystems (v2)
- on_pre_compact: flush the session journal buffer

Implements hook wiring from TASK-CON-010 + TASK-GAP-006.
"""

import json
import logging
from typing import Any

from src.archon_consciousness.intent_model import IntentModel
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.pattern_tracker import PatternTracker
from src.archon_consciousness.reflection_agent import ReflectionAgent
from src.archon_consciousness.session_journal import SessionJournal

logger = logging.getLogger(__name__)

# Defensive personality import — v1 behavior preserved if personality unavailable
try:
    from src.archon_consciousness.personality.integration import PersonalityHooks
    _PERSONALITY_AVAILABLE = True
except ImportError:
    _PERSONALITY_AVAILABLE = False
    logger.info("Personality subsystem not available — v1 only")


def on_session_start(
    client: MemoryGraphClient,
    lance_backend: Any,
    session_num: int,
) -> dict:
    """SessionStart hook: inject prioritized rules, detect missing reflections.

    1. Compute spaced reinforcement priority via PatternTracker.
    2. Scan for sessions that have SessionEvent nodes but no Reflection node.
    3. Return summary dict.

    Args:
        client: MemoryGraphClient for reading/writing nodes.
        lance_backend: LanceDB backend (may be None).
        session_num: Current session number.

    Returns:
        Dict with keys: rules_injected (int), injected_rules (list),
        missing_reflection (bool or list of session_ids).
    """
    # 1. Compute injection priority
    try:
        tracker = PatternTracker(client, current_session_num=session_num)
        injected = tracker.compute_injection_priority()
    except Exception as exc:
        logger.warning("Failed to compute injection priority: %s", exc)
        injected = []

    # 2. Check for missing reflections from previous sessions
    missing = _find_missing_reflections(client)

    # v2: personality injection (FR-PER-041, FR-PER-046)
    personality_injection = None
    if _PERSONALITY_AVAILABLE:
        try:
            hooks = PersonalityHooks(
                client=client, lance=lance_backend,
                session_id=f"session-{session_num}",
                session_num=session_num,
            )
            personality_injection = hooks.build_session_injection()
        except Exception as exc:
            logger.warning("Personality injection failed: %s", exc)

    return {
        "rules_injected": len(injected),
        "injected_rules": injected,
        "missing_reflection": missing if missing else False,
        "personality_injection": personality_injection,
        "personality_available": _PERSONALITY_AVAILABLE,
    }


def on_session_end(
    client: MemoryGraphClient,
    lance_backend: Any,
    session_id: str,
    session_num: int,
) -> dict:
    """Stop hook: run reflection agent, archive session-scoped intents.

    1. Run ReflectionAgent for the session.
    2. Archive session-scoped intents via IntentModel.

    Args:
        client: MemoryGraphClient for reading/writing nodes.
        lance_backend: LanceDB backend (may be None).
        session_id: Current session identifier.
        session_num: Current session number.

    Returns:
        Dict with keys: reflection (dict or None), intents_archived (bool).
    """
    # 1. Run reflection
    reflection_result = None
    try:
        agent = ReflectionAgent(client, session_id, session_num, lance_backend)
        reflection_result = agent.run()
    except Exception as exc:
        logger.warning("Reflection agent failed: %s", exc)

    # 2. Archive session-scoped intents
    intents_archived = False
    try:
        intent_model = IntentModel(client)
        intent_model.archive_session_goals()
        intents_archived = True
    except Exception as exc:
        logger.warning("Intent archival failed: %s", exc)

    # v2: personality session-end processing (FR-PER-041)
    personality_result = None
    if _PERSONALITY_AVAILABLE:
        try:
            hooks = PersonalityHooks(
                client=client, lance=lance_backend,
                session_id=session_id,
                session_num=session_num,
            )
            personality_result = hooks.on_session_end()
        except Exception as exc:
            logger.warning("Personality session-end failed: %s", exc)

    return {
        "reflection": reflection_result,
        "intents_archived": intents_archived,
        "personality": personality_result,
    }


def on_pre_compact(journal: SessionJournal) -> int:
    """PreCompact hook: flush the journal's pending buffer.

    Args:
        journal: The active SessionJournal instance.

    Returns:
        Number of events flushed.
    """
    try:
        return journal.flush()
    except Exception as exc:
        logger.warning("Journal flush failed during pre-compact: %s", exc)
        return 0


# ─── Internal helpers ─────────────────────────────────────────────


def _find_missing_reflections(client: MemoryGraphClient) -> list[str]:
    """Find session_ids that have SessionEvent nodes but no Reflection.

    Scans all SessionEvent nodes to collect unique session_ids, then
    checks whether a Reflection node exists for each.

    Returns:
        List of session_ids missing reflections (may be empty).
    """
    # Collect session_ids from events
    all_events = client.list_by_type("SessionEvent")
    session_ids: set[str] = set()
    for mem in all_events:
        try:
            content = json.loads(mem["content"])
            sid = content.get("session_id")
            if sid:
                session_ids.add(sid)
        except (json.JSONDecodeError, KeyError):
            continue

    if not session_ids:
        return []

    # Collect session_ids that have reflections
    all_reflections = client.list_by_type("Reflection")
    reflected_ids: set[str] = set()
    for mem in all_reflections:
        try:
            content = json.loads(mem["content"])
            sid = content.get("session_id")
            if sid:
                reflected_ids.add(sid)
        except (json.JSONDecodeError, KeyError):
            # Also check the node name pattern: reflection-{session_id}
            name = mem.get("name", "")
            if name.startswith("reflection-"):
                reflected_ids.add(name[len("reflection-"):])

    missing = sorted(session_ids - reflected_ids)
    return missing
