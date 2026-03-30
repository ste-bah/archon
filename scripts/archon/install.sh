#!/bin/bash
# Install Archon autonomous agents via launchd
# PRD: PRD-ARCHON-CAP-001 | TASK-AUTO-004, TASK-ENH-001, TASK-ENH-002

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="${HOME}/.archon/scripts"

# Verify prerequisites
if [ ! -f "${HOME}/.archon-env" ]; then
    echo "ERROR: Credentials file not found: ~/.archon-env" >&2
    echo "Create it with RC_URL, RC_TOKEN, RC_USER_ID variables and chmod 600" >&2
    exit 1
fi

# Create directories
mkdir -p "${HOME}/.archon/logs" "${HOME}/.archon/budget" "$DEPLOY_DIR/lib"
chmod 700 "${HOME}/.archon/logs" "${HOME}/.archon/budget"

# Deploy scripts to home directory (macOS volume access restriction)
cp "${SCRIPT_DIR}/rc-prefilter.sh" "$DEPLOY_DIR/"
cp "${SCRIPT_DIR}/archon-runner.sh" "$DEPLOY_DIR/"
cp "${SCRIPT_DIR}/leann-drain.sh" "$DEPLOY_DIR/" 2>/dev/null || true
cp "${SCRIPT_DIR}/lib/logging.sh" "$DEPLOY_DIR/lib/"
cp "${SCRIPT_DIR}/system-prompt.md" "$DEPLOY_DIR/"
chmod +x "$DEPLOY_DIR/rc-prefilter.sh" "$DEPLOY_DIR/archon-runner.sh" "$DEPLOY_DIR/leann-drain.sh" 2>/dev/null

# Fix PROJECT_ROOT for deployed scripts
sed -i '' 's|PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"|PROJECT_ROOT="${ARCHON_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." \&\& pwd)}"|' "$DEPLOY_DIR/archon-runner.sh" 2>/dev/null || true

echo "Scripts deployed to $DEPLOY_DIR"

# Install plists
AGENTS=(
    "com.archon.rc-prefilter:RocketChat polling (30-min)"
    "com.archon.learn:Learning (4-hour)"
    "com.archon.consolidate:Memory consolidation (daily 3am)"
    "com.archon.outreach:Outreach alerts (daily 9am)"
    "com.archon.leann-drain:LEANN index drain (15-min)"
)

for entry in "${AGENTS[@]}"; do
    IFS=':' read -r label desc <<< "$entry"
    PLIST_SRC="${SCRIPT_DIR}/${label}.plist"
    PLIST_DST="${HOME}/Library/LaunchAgents/${label}.plist"

    if [ ! -f "$PLIST_SRC" ]; then
        echo "SKIP: ${label} (plist not found)"
        continue
    fi

    # Unload existing
    launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true

    # Copy and load
    cp "$PLIST_SRC" "$PLIST_DST"
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
    echo "  OK: ${desc}"
done

echo ""
echo "Archon autonomous system installed"
echo "Check status: bash ${SCRIPT_DIR}/status.sh"
echo "View logs: tail -f ~/.archon/logs/"
