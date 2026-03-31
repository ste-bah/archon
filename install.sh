#!/bin/bash
# Archon installer — single entry point
# Usage: ./install.sh [setup-archon.sh flags]
# Docs:  https://github.com/ste-bah/archon

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_SCRIPT="$SCRIPT_DIR/scripts/packaging/setup-archon.sh"
REGISTER_SCRIPT="$HOME/.archon/scripts/register-mcp.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ ! -f "$SETUP_SCRIPT" ]; then
    echo -e "${RED}ERROR: setup-archon.sh not found at $SETUP_SCRIPT${NC}" >&2
    exit 1
fi

# ── Step 1: Run full setup ────────────────────────────────────────────────────
echo -e "${BLUE}=================================================================="
echo "                  Archon Installer"
echo "==================================================================${NC}"
echo ""

bash "$SETUP_SCRIPT" "$@"

# ── Step 2: Verify MCP registration; prompt for auth + retry if needed ───────
echo ""
if claude mcp list 2>/dev/null | grep -q "memorygraph"; then
    echo -e "${GREEN}=================================================================="
    echo "  Archon is ready. Start with: claude"
    echo "==================================================================${NC}"
    exit 0
fi

# MCP registration didn't take — claude may not have been authenticated yet
echo -e "${YELLOW}=================================================================="
echo "  ACTION REQUIRED: Authenticate Claude Code to finish setup"
echo "==================================================================${NC}"
echo ""
echo "  MCP servers (MemoryGraph etc.) could not be registered because"
echo "  Claude Code is not authenticated yet."
echo ""
echo "  1. Authenticate now:"
echo "       claude"
echo ""
echo "  2. Then press Enter here to complete MCP registration automatically."
echo ""
echo -n "  Press Enter after authenticating (or Ctrl+C to skip)... "
read -r

echo ""
echo "Registering MCP servers..."
if [ -x "$REGISTER_SCRIPT" ]; then
    if bash "$REGISTER_SCRIPT"; then
        echo ""
        echo -e "${GREEN}=================================================================="
        echo "  Archon is ready. Start with: claude"
        echo "==================================================================${NC}"
    else
        echo ""
        echo -e "${RED}  Registration still failing. Run manually after fixing auth:"
        echo "    bash ~/.archon/scripts/register-mcp.sh${NC}"
        exit 1
    fi
else
    echo -e "${RED}  register-mcp.sh not found. Run setup-archon.sh again.${NC}"
    exit 1
fi
