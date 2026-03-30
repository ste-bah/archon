"""Phase-boundary personality computation runner.

Called after test runs to compute operational state via the tested
AgentSelfModel. Reads events + corrections, reconstructs counters,
calls process_turn(), writes state cache for PreToolUse gate.

ALL business logic delegated to tested modules. This is orchestration only.
"""

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
from src.archon_consciousness.personality.signal_collector import SignalCollector

logger = logging.getLogger(__name__)


def format_self_eval_prompt(action_count: int, correction_count: int) -> str:
    """Generate LLM introspection prompt for curiosity gap detection.

    This prompt enters the agent's context at phase boundaries.
    The INTJ 4w5 personality drives honest self-evaluation.
    NOT a confidence self-report (GUARD-PER-002 compliant).
    """
    return (
        f"[PERSONALITY SELF-EVAL ({action_count} actions, {correction_count} corrections): "
        f"Did you encounter unfamiliar concepts, APIs, or patterns during recent work? "
        f"If yes, flag each knowledge gap: "
        f"echo '{{\"type\":\"knowledge_gap\",\"topic\":\"<topic>\",\"ts\":\"<ISO>\"}}' "
        f">> .persistent-memory/personality-curiosity.jsonl]"
    )


def format_hints_output(state: str, hints: dict) -> str:
    """Format behavioral hints for context injection.

    One line, bracketed, machine-parseable.
    """
    val = hints.get("validation_level", "normal")
    verb = hints.get("response_verbosity", "standard")
    expl = hints.get("exploration_mode", "default")
    weight = hints.get("influence_weight", 1.0)
    return (
        f"[PERSONALITY STATE: {state} | "
        f"Val: {val}, Verb: {verb}, Expl: {expl}, Weight: {weight:.1f}]"
    )


def run_phase_check(
    events_path: str,
    corrections_path: str,
    cache_path: str,
    client: Any,
    lance: Any = None,
    session_id: str = "unknown",
) -> dict:
    """Run phase-boundary personality computation.

    1. Read events + corrections from JSONL files
    2. Load previous mood from cache (if exists)
    3. Reconstruct SignalCollector counters from event data
    4. Call process_turn() via tested AgentSelfModel
    5. Write state + hints to cache file (atomic)
    6. Store AgentSelfState to MemoryGraph

    Args:
        events_path: Path to personality-events.jsonl.
        corrections_path: Path to personality-corrections.jsonl.
        cache_path: Path to personality-current-state.json.
        client: MemoryGraph backend.
        lance: LanceDB backend (optional, for somatic markers).
        session_id: Current session identifier.

    Returns:
        Dict with state, mood_valence, hints, correction_count.
    """
    # 1. Read events
    events = _read_jsonl(events_path)
    corrections = _read_jsonl(corrections_path)

    # 2. Load previous mood from cache
    prev_mood = 0.0
    prev_state = "neutral"
    prev_consecutive = 0
    if os.path.exists(cache_path):
        try:
            with open(cache_path) as f:
                prev_cache = json.load(f)
            prev_mood = prev_cache.get("mood_valence", 0.0)
            prev_state = prev_cache.get("state", "neutral")
            prev_consecutive = prev_cache.get("consecutive_state_count", 0)
        except (json.JSONDecodeError, OSError):
            pass

    if not events:
        # No events — produce neutral state
        result = {
            "state": "neutral",
            "mood_valence": prev_mood,
            "hints": {
                "validation_level": "normal",
                "response_verbosity": "standard",
                "exploration_mode": "default",
                "influence_weight": 1.0,
            },
            "correction_count": len(corrections),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "consecutive_state_count": 0,
        }
        _write_cache_atomic(cache_path, result)
        return result

    # 3. Reconstruct counters from events
    edit_count = sum(1 for e in events if e.get("tool") in ("Write", "Edit", "MultiEdit"))
    test_count = sum(1 for e in events if e.get("tool") == "Bash"
                     and any(kw in e.get("target", "").lower()
                             for kw in ("pytest", "vitest", "npm test")))
    correction_count = len(corrections)
    total_actions = len(events)

    # 4. Build SignalCollector with reconstructed counters
    # Note: corrections are user corrections on approach/facts, NOT test failures.
    # Tests passing/failing and user corrections are independent signals.
    collector = SignalCollector(client=client, lance=lance)
    collector._corrections = correction_count
    collector._total_interactions = total_actions
    collector._tasks_attempted = max(1, test_count)
    collector._tasks_completed = test_count  # tests ran = tasks attempted & completed
    collector._plans_submitted = max(1, edit_count)
    collector._plans_approved = edit_count  # edits happened = plans approved (corrections are separate)
    collector._consecutive_corrections = min(correction_count, 5)
    collector._consecutive_successes = min(10, max(0, total_actions - correction_count))
    if correction_count > 0:
        collector._user_emotional_state = "frustrated" if correction_count >= 3 else "neutral"

    # 5. Build AgentSelfModel with previous mood
    engine = AppraisalEngine()
    model = AgentSelfModel(
        collector=collector, engine=engine, client=client, lance=lance,
    )
    model._mood_valence = prev_mood
    model._last_state = prev_state
    model._consecutive_state_count = prev_consecutive

    # 6. Run process_turn() — the tested 12-step pipeline
    turn_number = total_actions  # approximate turn from event count
    state_obj, hints_obj = model.process_turn(
        turn_number=turn_number,
        session_id=session_id,
        task_context="",  # no specific task context at phase boundary
    )

    # 7. Build cache + result
    result = {
        "state": state_obj.primary_state,
        "mood_valence": state_obj.mood_valence,
        "hints": {
            "validation_level": hints_obj.validation_level,
            "response_verbosity": hints_obj.response_verbosity,
            "exploration_mode": hints_obj.exploration_mode,
            "influence_weight": hints_obj.influence_weight,
            "should_present_options": hints_obj.should_present_options,
            "should_retrieve_episodes": hints_obj.should_retrieve_episodes,
            "should_verify_values": hints_obj.should_verify_values,
        },
        "correction_count": correction_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "consecutive_state_count": model._consecutive_state_count,
    }

    # 8. Write cache atomically
    _write_cache_atomic(cache_path, result)

    return result


def _read_jsonl(path: str) -> list[dict]:
    """Read JSONL file, skipping corrupt lines."""
    if not path or not os.path.exists(path):
        return []
    entries = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return entries


def _write_cache_atomic(path: str, data: dict) -> None:
    """Write JSON cache file atomically via temp + rename."""
    dir_name = os.path.dirname(path) or "."
    try:
        os.makedirs(dir_name, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
            os.replace(tmp_path, path)  # atomic on same filesystem
        except Exception:
            os.unlink(tmp_path)
            raise
    except Exception:
        logger.warning("Failed to write personality state cache: %s", path)
