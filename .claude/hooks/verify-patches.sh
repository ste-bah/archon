#!/bin/bash
# =============================================================================
# Verify FalkorDBLite patches are intact
# Returns 0 if patches match, 1 if mismatch or missing
# =============================================================================

PATCHED_FILE="$HOME/.memorygraph-venv/lib/python3.12/site-packages/memorygraph/backends/_falkordb_shared.py"
BACKUP_FILE="$HOME/.memorygraph/patched-falkordb-shared.py"

if [ ! -f "$PATCHED_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "[memory] FalkorDBLite patch files not found"
  exit 1
fi

CURRENT_HASH=$(md5 -q "$PATCHED_FILE" 2>/dev/null || md5sum "$PATCHED_FILE" 2>/dev/null | cut -d' ' -f1)
BACKUP_HASH=$(md5 -q "$BACKUP_FILE" 2>/dev/null || md5sum "$BACKUP_FILE" 2>/dev/null | cut -d' ' -f1)

if [ "$CURRENT_HASH" != "$BACKUP_HASH" ]; then
  echo "[memory] WARNING: FalkorDBLite patches have been overwritten."
  echo "[memory] Restore with: cp ~/.memorygraph/patched-falkordb-shared.py ~/.memorygraph-venv/lib/python3.12/site-packages/memorygraph/backends/_falkordb_shared.py"
  exit 1
fi

exit 0
