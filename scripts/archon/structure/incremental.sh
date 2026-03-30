#!/bin/bash
# TASK-ENH-006: Incremental structure update via git diff
# Only re-extracts changed files since last indexed SHA.
#
# PRD: PRD-ARCHON-CAP-001 | REQ-STRUCT-007
# Usage: incremental.sh [project-root] [compact-json-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${1:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
COMPACT_JSON="${2:-${PROJECT_ROOT}/.persistent-memory/project-structure.json}"

if [ ! -f "$COMPACT_JSON" ]; then
    echo "No existing structure cache — running full extraction" >&2
    python3 "$SCRIPT_DIR/extract.py" "$PROJECT_ROOT" --compact "$COMPACT_JSON"
    exit $?
fi

# Get last indexed SHA
INDEXED_SHA=$(jq -r '.indexedSha // "none"' "$COMPACT_JSON" 2>/dev/null)
CURRENT_SHA=$(cd "$PROJECT_ROOT" && git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")

if [ "$INDEXED_SHA" = "$CURRENT_SHA" ]; then
    # Check for uncommitted changes
    UNCOMMITTED=$(cd "$PROJECT_ROOT" && git diff --name-only -- '*.py' 2>/dev/null | wc -l | tr -cd '0-9')
    UNSTAGED=$(cd "$PROJECT_ROOT" && git diff --cached --name-only -- '*.py' 2>/dev/null | wc -l | tr -cd '0-9')
    UNTRACKED=$(cd "$PROJECT_ROOT" && git ls-files --others --exclude-standard -- '*.py' 2>/dev/null | wc -l | tr -cd '0-9')
    CHANGED=$(( ${UNCOMMITTED:-0} + ${UNSTAGED:-0} + ${UNTRACKED:-0} ))

    if [ "$CHANGED" -eq 0 ]; then
        echo "Structure is up to date (SHA: $INDEXED_SHA, no uncommitted changes)" >&2
        exit 0
    fi
    echo "SHA matches but $CHANGED uncommitted Python files changed — re-extracting" >&2
fi

# Changes detected — run full extraction (incremental per-file merging is Phase 3)
echo "Changes detected (indexed: $INDEXED_SHA, current: $CURRENT_SHA) — re-extracting" >&2
python3 "$SCRIPT_DIR/extract.py" "$PROJECT_ROOT" --compact "$COMPACT_JSON"
