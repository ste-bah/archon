#!/bin/bash
#===============================================================================
# Import Archon Seed Data into MemoryGraph
#
# Uses the memorygraph CLI's built-in import command.
# Copies personality.md to ~/.claude/personality.md.
# Creates first-run marker for user onboarding.
#
# Usage: ./import-seeds.sh
#===============================================================================

set -e

ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SEEDS_DIR="$ROOT/seeds"
VENV="$HOME/.memorygraph-venv"
MEMORYGRAPH="$VENV/bin/memorygraph"

if [ ! -d "$SEEDS_DIR" ]; then
    echo "No seeds directory found at $SEEDS_DIR — skipping seed import."
    exit 0
fi

echo "=== Archon Seed Import ==="

# 1. Copy personality.md (Archon's style, not user-specific)
if [ -f "$SEEDS_DIR/personality.md" ]; then
    mkdir -p "$HOME/.claude"
    if [ -f "$HOME/.claude/personality.md" ]; then
        cp "$HOME/.claude/personality.md" "$HOME/.claude/personality.md.bak.$(date +%Y%m%d%H%M%S)"
        echo "Backed up existing personality.md"
    fi
    cp "$SEEDS_DIR/personality.md" "$HOME/.claude/personality.md"
    echo "Imported: personality.md -> ~/.claude/personality.md"
fi

# 2. Import seed memories via memorygraph CLI
if [ -f "$SEEDS_DIR/memorygraph-seeds.json" ] && [ -x "$MEMORYGRAPH" ]; then
    echo "Importing seed memories via memorygraph CLI..."
    "$MEMORYGRAPH" --backend falkordblite --profile extended \
        import --format json --input "$SEEDS_DIR/memorygraph-seeds.json" --skip-duplicates \
        2>&1 | tail -5

    echo "Seed memories imported."
elif [ -f "$SEEDS_DIR/memorygraph-seeds.json" ]; then
    echo "WARNING: memorygraph CLI not found at $MEMORYGRAPH"
    echo "  Seeds will be imported on first Claude Code session via MCP."
    echo "  Or install MemoryGraph first: bash scripts/packaging/setup-archon.sh"
else
    echo "No seed file found."
fi

# 3. Copy first-run prompt if it exists
if [ -f "$SEEDS_DIR/first-run-prompt.md" ]; then
    mkdir -p "$ROOT/.persistent-memory"
    cp "$SEEDS_DIR/first-run-prompt.md" "$ROOT/.persistent-memory/first-run-prompt.md"
    echo "Created: first-run marker (Archon will onboard new user on first session)"
fi

echo ""
echo "=== Seed import done ==="
echo "  Archon identity and rules: loaded"
echo "  User profile: NOT loaded (Archon asks on first session)"
