#!/bin/bash
# =============================================================================
# Personality Session Cleanup — cleans up THIS session's directory.
# Does NOT kill the daemon — daemon self-manages its lifecycle.
# =============================================================================

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0

SID="$PPID"
rm -rf "$ROOT/.persistent-memory/sessions/$SID" 2>/dev/null

exit 0
