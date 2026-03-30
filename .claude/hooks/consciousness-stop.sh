#!/bin/bash
# =============================================================================
# Archon Consciousness: Stop Hook
# Outputs reflection reminder and stores session end marker.
# The actual reflection logic runs via Claude's MCP tools during the session,
# not from this external script (MCP tools not available in shell context).
# =============================================================================

echo "[consciousness] Session ending. Key reminders:"
echo "  - Store session reflection via mcp__memorygraph__store_memory if not already done"
echo "  - Archive any session-scoped intents"
echo "  - Flush session event journal"

exit 0
