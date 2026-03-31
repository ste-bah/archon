#!/bin/bash
# Register Archon MCP servers with Claude Code (user-level)
# Called automatically by setup-archon.sh — re-run manually if registration failed
# Usage: bash ~/.archon/scripts/register-mcp.sh

MEMORYGRAPH_VENV="${HOME}/.memorygraph-venv"
FAILED=0

_register() {
    local name="$1"; shift
    echo -n "  ${name}... "
    if claude mcp add "${name}" -- "$@" 2>/dev/null; then
        echo "OK"
    else
        echo "FAILED"
        echo "    Run manually: claude mcp add ${name} -- $*"
        FAILED=$((FAILED + 1))
    fi
}

echo "Registering Archon MCP servers with Claude Code..."
echo ""

if [ -x "${MEMORYGRAPH_VENV}/run.sh" ]; then
    _register memorygraph "${MEMORYGRAPH_VENV}/run.sh" --profile extended --backend falkordblite
else
    echo "  memorygraph... SKIP (${MEMORYGRAPH_VENV}/run.sh not found — run setup-archon.sh first)"
    FAILED=$((FAILED + 1))
fi

echo ""
if [ "${FAILED}" -eq 0 ]; then
    echo "All MCP servers registered successfully."
else
    echo "ERROR: ${FAILED} registration(s) failed."
    echo ""
    echo "If Claude Code is not yet authenticated, run 'claude' first, then:"
    echo "  bash ~/.archon/scripts/register-mcp.sh"
    exit 1
fi

echo ""
echo "Current MCP registrations:"
claude mcp list 2>/dev/null || echo "  (run 'claude' to verify)"
