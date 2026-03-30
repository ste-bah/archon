"""Session-end runner — production entry point for personality processing.

Reads accumulated tool events from JSONL, computes session signals,
and delegates ALL business logic to the tested PersonalityHooks class.
Zero formula duplication — this is a thin orchestrator.

Called by scripts/archon/personality-session-end.sh at session Stop.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.integration import PersonalityHooks

logger = logging.getLogger(__name__)


def infer_approach(events: list[dict]) -> str:
    """Infer development approach from event patterns.

    TDD: test file written/edited BEFORE implementation file.
    impl-first: implementation file written/edited BEFORE test file.
    unknown: can't determine (no tests or no impl files).
    """
    first_test_idx = None
    first_impl_idx = None
    for i, ev in enumerate(events):
        if ev.get("tool") not in ("Write", "Edit", "MultiEdit"):
            continue
        target = ev.get("target", "").lower()
        is_test = "test" in target and (target.endswith(".py") or target.endswith(".ts") or target.endswith(".tsx"))
        is_impl = not is_test and (target.endswith(".py") or target.endswith(".ts") or target.endswith(".tsx"))
        if is_test and first_test_idx is None:
            first_test_idx = i
        if is_impl and first_impl_idx is None:
            first_impl_idx = i
    if first_test_idx is None or first_impl_idx is None:
        return "unknown"
    return "tdd" if first_test_idx < first_impl_idx else "impl-first"


def infer_context(events: list[dict]) -> str:
    """Infer task context from file paths in events.

    Returns: "{task_type}:{domain}:{language}" string.
    """
    languages = set()
    domains = set()
    for ev in events:
        if ev.get("tool") not in ("Write", "Edit", "MultiEdit"):
            continue
        target = ev.get("target", "").lower()
        if target.endswith(".py"):
            languages.add("python")
        elif target.endswith(".ts") or target.endswith(".tsx"):
            languages.add("typescript")
        elif target.endswith(".sh"):
            languages.add("bash")
        if "frontend" in target or "component" in target:
            domains.add("frontend")
        elif "backend" in target or "api" in target:
            domains.add("backend")
        elif "test" in target:
            domains.add("testing")
    lang = next(iter(languages), "general")
    domain = next(iter(domains), "general")
    return f"coding:{domain}:{lang}"


def compute_signals_from_events(events: list[dict]) -> dict:
    """Parse tool events into personality-relevant signals.

    No business logic — just counting and categorizing.

    Args:
        events: List of event dicts with 'tool' and 'target' keys.

    Returns:
        Signal dict for PersonalityHooks.on_session_end().
    """
    edit_count = 0
    test_count = 0
    total_actions = len(events)

    for ev in events:
        tool = ev.get("tool", "")
        target = ev.get("target", "")

        if tool in ("Write", "Edit", "MultiEdit"):
            edit_count += 1
        elif tool == "Bash":
            target_lower = target.lower()
            if ("pytest" in target_lower or "vitest" in target_lower
                    or "test" in target_lower):
                test_count += 1

    tdd_compliance = test_count > 0 and edit_count > 0

    return {
        "total_actions": total_actions,
        "edit_count": edit_count,
        "test_count": test_count,
        "tdd_compliance": tdd_compliance,
        "plan_adherence": True,  # default; override from session metrics
        "novel_approaches_tried": 0,
        "proactive_suggestions": 0,
        "user_suggestion_acceptance_rate": 0.8,  # default optimistic
        "state_volatility": 0.0,
        "error_admissions": 0,
        "uncertainty_flags": 0,
    }


def read_events(events_path: str) -> list[dict]:
    """Read JSONL events file, skipping corrupt lines.

    Returns:
        List of parsed event dicts.
    """
    if not os.path.exists(events_path):
        return []

    events = []
    with open(events_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning("Skipping corrupt event line: %s", line[:50])
    return events


def process_session_end(
    events_path: str,
    client: Any,
    lance: Any = None,
    session_id: str = "unknown",
    session_num: int = 1,
) -> dict:
    """Process session-end personality updates.

    Reads events, computes signals, delegates to PersonalityHooks.
    ALL business logic (trust, traits, preferences, decay) runs
    through the tested PersonalityHooks class.

    Args:
        events_path: Path to the JSONL events file.
        client: MemoryGraph backend.
        lance: LanceDB backend (optional).
        session_id: Current session identifier.
        session_num: Current session number.

    Returns:
        Dict with processing results.
    """
    # 1. Read events
    events = read_events(events_path)
    if not events:
        return {
            "events_processed": 0,
            "trust_persisted": False,
            "traits_updated": False,
            "preferences_decayed": 0,
        }

    # 2. Compute signals from events
    signals = compute_signals_from_events(events)

    # 3. Delegate to tested PersonalityHooks
    hooks = PersonalityHooks(
        client=client,
        lance=lance,
        session_id=session_id,
        session_num=session_num,
    )

    # 4. Feed correction/success events into signal collector
    if signals["edit_count"] > 0 and signals["tdd_compliance"]:
        hooks.record_success()

    # 5. Record preference outcome (FR-PER-015)
    approach = infer_approach(events)
    context = infer_context(events)
    if approach != "unknown" and signals["total_actions"] > 0:
        from src.archon_consciousness.personality.types import OutcomeRecord
        quality = 1.0 - min(1.0, signals.get("corrections", 0) / max(1, signals["total_actions"]))
        try:
            outcome = OutcomeRecord(
                task_id=f"session-{session_id}",
                timestamp=datetime.now(timezone.utc),
                context_key=context,
                approach_used=approach,
                success=quality >= 0.7,
                quality_score=quality,
                iterations=1,
                user_feedback="",
                self_assessed_confidence=quality,
            )
            hooks._preference_engine.record_outcome(outcome)
        except Exception:
            pass

    # 6. Record autonomy signals (FR-PER-025)
    task_calls = sum(1 for e in events if e.get("tool") == "Task")
    direct_edits = signals["edit_count"]
    hooks._trust_health.record_session_autonomy(task_calls, direct_edits)

    # 7. Run session-end processing (trust, traits, preferences, episode decay)
    end_result = hooks.on_session_end(signals=signals)

    # 8. Write comprehensive local cache for next session's personality-start.sh
    session_data_path = os.path.join(
        os.path.dirname(events_path), "personality-session-data.json",
    )
    _write_session_data_cache(session_data_path, hooks, signals, approach, context)

    # 9. Clean up events file
    try:
        os.remove(events_path)
    except OSError:
        pass

    return {
        "events_processed": len(events),
        **end_result,
    }


def _write_session_data_cache(
    path: str,
    hooks: Any,
    signals: dict,
    approach: str,
    context: str,
) -> None:
    """Write personality-session-data.json for next session's start hook.

    This is the PRIMARY read source for personality-start.sh.
    Contains trust grade, trait means, mood, top preference, narrative.
    Atomic write via temp + rename.
    """
    import tempfile

    try:
        grade, score, _ = hooks._trust_health.compute_grade()
        trait_means = hooks._personality.trait_means
        mood = hooks._self_model._mood_valence if hooks._self_model else 0.0
        narrative = hooks._personality.latest_narrative
        session_count = hooks._personality._traits.session_count

        top_pref = ""
        try:
            strongest = hooks._preference_engine.get_strongest(limit=1)
            if strongest:
                p = strongest[0]
                top_pref = f"{p.approach} in {p.context_category}"
        except Exception:
            pass

        data = {
            "trust_grade": grade,
            "trust_score": round(score, 3),
            "trust_overall": round(hooks._trust_tracker.overall_trust, 3),
            "trait_means": {k: round(v, 3) for k, v in trait_means.items()},
            "mood_valence": round(mood, 3),
            "top_preference": top_pref,
            "narrative": narrative or "",
            "session_count": session_count,
            "corrections": signals.get("corrections", 0),
            "approach": approach,
            "context": context,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        dir_name = os.path.dirname(path) or "."
        os.makedirs(dir_name, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception:
        logger.warning("Failed to write session data cache: %s", path)
