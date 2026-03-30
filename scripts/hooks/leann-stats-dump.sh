#!/bin/bash
# =============================================================================
# Dump LEANN stats to .god-agent/leann-stats.json
# =============================================================================
# This script reads the LEANN vector_db files directly using a minimal
# Node.js script that just stats the files. The rich MCP-based stats
# (totalIndexed, uniqueFiles, etc.) come from Claude Code calling
# mcp__leann-search__get_stats and writing the result — this script
# only provides filesystem-level stats as a fallback/supplement.
#
# For full stats: Claude Code should call mcp__leann-search__get_stats
# periodically and write to .god-agent/leann-stats.json
# =============================================================================

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -z "$ROOT" ] && exit 0

cd "$ROOT" || exit 0

OUTPUT="$ROOT/.god-agent/leann-stats.json"
INDEX_FILE="$ROOT/vector_db_leann"
STORES_FILE="$ROOT/vector_db_leann.stores"

# If full MCP stats already exist and are < 10 min old, skip
if [ -f "$OUTPUT" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$OUTPUT" 2>/dev/null || stat -c %Y "$OUTPUT" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt 600 ]; then
    exit 0  # Fresh enough
  fi
fi

# Bail if no index exists
[ ! -f "$INDEX_FILE" ] && exit 0

mkdir -p "$ROOT/.god-agent"

# Write basic filesystem stats (MCP stats will overwrite when available)
INDEX_SIZE=$(stat -f %z "$INDEX_FILE" 2>/dev/null || stat -c %s "$INDEX_FILE" 2>/dev/null || echo 0)
STORES_SIZE=0
if [ -f "$STORES_FILE" ]; then
  STORES_SIZE=$(stat -f %z "$STORES_FILE" 2>/dev/null || stat -c %s "$STORES_FILE" 2>/dev/null || echo 0)
fi
TOTAL_SIZE=$((INDEX_SIZE + STORES_SIZE))
TOTAL_MB=$(echo "scale=2; $TOTAL_SIZE / 1048576" | bc 2>/dev/null || echo "0")

cat > "$OUTPUT" << STATS
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "totalIndexed": 0,
  "uniqueFiles": 0,
  "uniqueRepositories": 0,
  "memoryStats": {
    "totalBytes": $TOTAL_SIZE,
    "totalFormatted": "${TOTAL_MB} MB"
  },
  "languageBreakdown": [],
  "symbolBreakdown": [],
  "leannStats": {},
  "message": "Filesystem stats only — call mcp__leann-search__get_stats for full data",
  "filesystemOnly": true
}
STATS

echo "[LEANN] Basic filesystem stats written to $OUTPUT (${TOTAL_MB} MB)"
