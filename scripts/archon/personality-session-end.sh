#!/bin/bash
# =============================================================================
# Personality Session-End — thin bash launcher.
# Calls tested Python session_end_runner. Zero business logic.
# Session isolation via $PPID. Timeout: 10s.
# =============================================================================

VENV="$HOME/.memorygraph-venv"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"

if [ ! -d "$VENV" ] || [ -z "$ROOT" ]; then
  exit 0
fi

SID="$PPID"
SESSION_DIR="$ROOT/.persistent-memory/sessions/$SID"
EVENTS_FILE="$SESSION_DIR/events.jsonl"

# Only run if there are events to process
if [ ! -f "$EVENTS_FILE" ] || [ ! -s "$EVENTS_FILE" ]; then
  exit 0
fi

timeout 10 "$VENV/bin/python3" -c "
import sys, os
os.environ['MEMORY_BACKEND'] = 'falkordblite'
sys.path.insert(0, '$ROOT')

import asyncio

async def run():
    from memorygraph.backends.factory import BackendFactory
    from memorygraph.database import MemoryDatabase
    from src.archon_consciousness.personality.session_end_runner import process_session_end
    from src.archon_consciousness.personality.memorygraph_adapter import MemoryGraphAdapter

    backend = await BackendFactory.create_backend()
    db = MemoryDatabase(backend)
    adapter = MemoryGraphAdapter(db)

    result = process_session_end(
        events_path='$EVENTS_FILE',
        client=adapter,
        session_id='$SID',
        session_num=int(os.environ.get('ARCHON_SESSION_NUM', '1')),
    )
    print(f'[personality-end] {result[\"events_processed\"]} events, trust={result[\"trust_persisted\"]}, traits={result[\"traits_updated\"]}')

asyncio.run(run())
" 2>/dev/null || echo "[personality-end] Processing failed (non-fatal)"

exit 0
