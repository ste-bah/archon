#!/bin/bash
# =============================================================================
# Personality Phase Check — PostToolUse hook for Bash (test runs only)
# Detects test runs, launches phase-boundary personality computation.
# Non-test commands exit in <1ms. Session isolation via $PPID.
# =============================================================================

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

case "$COMMAND" in
  *pytest*|*vitest*|*"npm test"*|*"npm run test"*) ;;
  *) exit 0 ;;
esac

VENV="$HOME/.memorygraph-venv"
[ ! -d "$VENV" ] && exit 0

SID="$PPID"
SESSION_DIR="$ROOT/.persistent-memory/sessions/$SID"
EVENTS_FILE="$SESSION_DIR/events.jsonl"
CORRECTIONS_FILE="$SESSION_DIR/corrections.jsonl"
CACHE_FILE="$SESSION_DIR/state.json"

timeout 5 "$VENV/bin/python3" -c "
import sys, os, json
os.environ['MEMORY_BACKEND'] = 'falkordblite'
sys.path.insert(0, '$ROOT')

try:
    from src.archon_consciousness.personality.phase_check_runner import run_phase_check, format_hints_output, format_self_eval_prompt
    from src.archon_consciousness.personality.memorygraph_adapter import MemoryGraphAdapter

    import asyncio
    from memorygraph.backends.factory import BackendFactory
    from memorygraph.database import MemoryDatabase

    async def main():
        backend = await BackendFactory.create_backend()
        db = MemoryDatabase(backend)
        adapter = MemoryGraphAdapter(db)

        result = run_phase_check(
            events_path='$EVENTS_FILE',
            corrections_path='$CORRECTIONS_FILE',
            cache_path='$CACHE_FILE',
            client=adapter,
            session_id='$SID',
        )

        if result['state'] != 'neutral':
            print(format_hints_output(result['state'], result['hints']))
        print(format_self_eval_prompt(result.get('correction_count', 0), result.get('correction_count', 0)))

    asyncio.run(main())
except Exception as e:
    pass
" 2>/dev/null || true

exit 0
