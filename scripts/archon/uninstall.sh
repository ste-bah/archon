#!/bin/bash
# Uninstall all Archon autonomous agents
# PRD: PRD-ARCHON-CAP-001

for label in com.archon.rc-prefilter com.archon.learn com.archon.consolidate com.archon.outreach com.archon.leann-drain; do
    launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
    rm -f "${HOME}/Library/LaunchAgents/${label}.plist"
    echo "Removed: ${label}"
done

echo "Archon autonomous agents removed"
echo "To also remove circuit breaker: rm ~/.archon/budget/circuit-breaker.json"
