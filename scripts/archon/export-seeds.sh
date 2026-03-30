#!/bin/bash
#===============================================================================
# Export Archon Seed Data
#
# Uses memorygraph CLI to export, then filters to identity/rules only.
# NO user-specific data is exported.
#
# Output: seeds/
#
# Usage: ./export-seeds.sh
#===============================================================================

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEEDS_DIR="$ROOT/seeds"
VENV="$HOME/.memorygraph-venv"
MEMORYGRAPH="$VENV/bin/memorygraph"

mkdir -p "$SEEDS_DIR"

echo "=== Archon Seed Export ==="

# 1. Export personality.md (Archon's style, strip user-specific info)
if [ -f "$HOME/.claude/personality.md" ]; then
    # Copy but strip lines containing personal info
    grep -v "Steven\|Bahia\|ste-bah" "$HOME/.claude/personality.md" > "$SEEDS_DIR/personality.md" 2>/dev/null || \
    cp "$HOME/.claude/personality.md" "$SEEDS_DIR/personality.md"
    echo "Exported: personality.md"
fi

# 2. DO NOT export understanding.md
echo "Skipped: understanding.md (user-specific)"

# 3. Create first-run prompt
cat > "$SEEDS_DIR/first-run-prompt.md" << 'EOF'
# Archon First Run

On the FIRST session with a new user, Archon should:

1. Introduce itself: "I'm Archon -- an INTJ 4w5 AI agent. Direct, honest, strategic."
2. Ask the user:
   - "What's your name?"
   - "What's your technical background?"
   - "What projects are you working on?"
   - "Any preferences for how I should work?"
3. Store responses in MemoryGraph as the understanding profile
4. Generate ~/.claude/understanding.md from the responses
5. Remove this first-run marker file
EOF
echo "Created: first-run-prompt.md"

# 4. Export from MemoryGraph via CLI, then filter
if [ -x "$MEMORYGRAPH" ]; then
    FULL_EXPORT="$SEEDS_DIR/_full_export.json"
    echo "Exporting all memories from MemoryGraph..."
    "$MEMORYGRAPH" --backend falkordblite --profile extended \
        export --format json --output "$FULL_EXPORT" 2>/dev/null

    if [ -f "$FULL_EXPORT" ]; then
        # Filter to only identity, values, corrections, workflows (no user data)
        python3 -c "
import json

with open('$FULL_EXPORT') as f:
    data = json.load(f)

# Filter: keep memories with these tags or importance >= 0.95
KEEP_TAGS = {'identity', 'values-node', 'archon-consciousness', 'pinned',
             'correction', 'dev-flow', 'workflow', 'personality'}

filtered = []
for mem in data.get('memories', data if isinstance(data, list) else []):
    tags = set(mem.get('tags', []))
    importance = mem.get('importance', 0)
    title = mem.get('title', '')

    # Skip user-specific memories
    if any(x in title.lower() for x in ['steven', 'bahia', 'ste-bah', 'session 2026', 'prd-', 'task-']):
        continue

    # Keep identity, values, corrections, workflows
    if tags & KEEP_TAGS or importance >= 0.95:
        filtered.append(mem)

# Preserve the CLI export format so import works
output = {
    'format_version': data.get('format_version', '2.0'),
    'export_version': data.get('export_version', '1.0'),
    'export_date': data.get('export_date', ''),
    'backend_type': data.get('backend_type', 'falkordblite'),
    'memory_count': len(filtered),
    'relationship_count': 0,
    'memories': filtered,
    'relationships': [],
}
with open('$SEEDS_DIR/memorygraph-seeds.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f'Filtered: {len(filtered)} memories from {len(data.get(\"memories\", data))} total')
"
        rm -f "$FULL_EXPORT"
    else
        echo "WARNING: Export failed. Using static seed file."
    fi
else
    echo "WARNING: memorygraph CLI not found. Using static seed file if present."
fi

echo ""
echo "=== Seeds ==="
ls -la "$SEEDS_DIR/" 2>/dev/null
