#!/bin/bash
# =============================================================================
# Memory System: SessionStart MemoryGraph Recall Hook
# Queries MemoryGraph for feedback/correction memories and outputs to context.
# Runs AFTER memory-inject.sh. Uses FalkorDB Lite backend.
# Timeout: 5s max to avoid blocking session start.
# =============================================================================

VENV="$HOME/.memorygraph-venv"

if [ ! -d "$VENV" ]; then
  echo "[memory-recall] MemoryGraph venv not found, skipping recall"
  exit 0
fi

# Quick recall of feedback memories via Python + FalkorDB Lite
timeout 8 "$VENV/bin/python3" -c "
import asyncio, os
os.environ['MEMORY_BACKEND'] = 'falkordblite'

async def recall():
    from memorygraph.backends.factory import BackendFactory
    from memorygraph.database import MemoryDatabase
    from memorygraph.models import SearchQuery

    backend = await BackendFactory.create_backend()
    db = MemoryDatabase(backend)

    # Search for feedback/correction memories
    # Search for critical behavioral rules (use single keyword for FalkorDB compatibility)
    all_results = []
    for term in ['ALWAYS', 'feedback', 'correction']:
        q = SearchQuery(query=term, limit=3)
        results = await db.search_memories(q)
        for r in results:
            rid = getattr(r, 'id', '')
            if rid not in [getattr(x, 'id', '') for x in all_results]:
                all_results.append(r)
    results = all_results[:7]

    if results:
        print('[memory-recall] Key behavioral rules from MemoryGraph (FalkorDB):')
        for m in results:
            title = getattr(m, 'title', '') or ''
            content = getattr(m, 'content', '') or ''
            if title:
                short = content[:200]
                print(f'  - {title}: {short}')
    else:
        print('[memory-recall] No feedback memories found')

asyncio.run(recall())
" 2>/dev/null || echo "[memory-recall] Recall timed out or failed"

exit 0
