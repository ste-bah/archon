#!/bin/bash
# =============================================================================
# Archon Consciousness: SessionStart Hook
# Queries PatternScore nodes from MemoryGraph and outputs prioritized rules
# for injection into session context. Also checks for missing reflections.
# Timeout: 8s max to avoid blocking session start.
# =============================================================================

VENV="$HOME/.memorygraph-venv"

if [ ! -d "$VENV" ]; then
  exit 0
fi

timeout 8 "$VENV/bin/python3" -c "
import asyncio, os, json
os.environ['MEMORY_BACKEND'] = 'falkordblite'

async def inject_consciousness():
    from memorygraph.backends.factory import BackendFactory
    from memorygraph.database import MemoryDatabase
    from memorygraph.models import SearchQuery

    backend = await BackendFactory.create_backend()
    db = MemoryDatabase(backend)

    # Search for active PatternScore nodes
    q = SearchQuery(query='rule_id', limit=50)
    results = await db.search_memories(q)

    rules = []
    for r in results:
        title = getattr(r, 'title', '') or ''
        content = getattr(r, 'content', '') or ''
        tags = getattr(r, 'tags', []) or []
        if 'pattern-score' not in tags:
            continue
        try:
            data = json.loads(content)
        except:
            continue
        if data.get('status') != 'active':
            continue
        score = data.get('score', 0.5)
        rule_id = data.get('rule_id', '')
        trend = data.get('trend', 'unknown')
        rules.append((rule_id, score, trend))

    if rules:
        # Sort by priority: lowest score first (needs most attention)
        rules.sort(key=lambda r: r[1])
        print('[consciousness] Active behavioral rules (sorted by attention priority):')
        for rule_id, score, trend in rules[:10]:
            print(f'  - {rule_id} (score={score:.2f}, trend={trend})')
        if len(rules) > 10:
            print(f'  ... and {len(rules)-10} more rules tracking')
    else:
        print('[consciousness] No active behavioral rules found')

asyncio.run(inject_consciousness())
" 2>/dev/null || true

exit 0
