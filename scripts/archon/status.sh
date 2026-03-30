#!/bin/bash
# Check Archon autonomous polling status
# PRD: PRD-ARCHON-CAP-001 | TASK-AUTO-004

echo "=== Archon Autonomous Status ==="

# launchd status
if launchctl print "gui/$(id -u)/com.archon.rc-prefilter" >/dev/null 2>&1; then
    echo "launchd: ACTIVE (30-min interval)"
    LAST_EXIT=$(launchctl print "gui/$(id -u)/com.archon.rc-prefilter" 2>/dev/null | grep "last exit code" || echo "unknown")
    echo "  $LAST_EXIT"
else
    echo "launchd: NOT INSTALLED"
fi

# Budget status
TODAY=$(date +%Y-%m-%d)
BUDGET_FILE="${HOME}/.archon/budget/${TODAY}.json"
if [ -f "$BUDGET_FILE" ]; then
    echo ""
    echo "Today's spend:"
    jq -r '"  messages: $\(.messages // 0) / $5.00\n  learning: $\(.learning // 0) / $5.00\n  overflow: $\(.overflow // 0) / $2.00"' "$BUDGET_FILE" 2>/dev/null || echo "  (parse error)"
else
    echo ""
    echo "No budget file for today (no autonomous runs yet)"
fi

# Recent log entries
LOG_FILE="/Volumes/Externalwork/projects/claudeflow-testing/.persistent-memory/autonomous-runs.jsonl"
if [ -f "$LOG_FILE" ]; then
    echo ""
    echo "Last 5 runs:"
    tail -5 "$LOG_FILE" | jq -r '"  \(.timestamp) \(.task_type) \(.outcome) $\(.cost_usd // 0)"' 2>/dev/null || echo "  (no entries)"
else
    echo ""
    echo "No log file yet"
fi

# Lock status
if [ -d "/tmp/archon-autonomous.lock" ]; then
    PID=$(cat /tmp/archon-autonomous.lock/pid 2>/dev/null || echo "unknown")
    AGE=$(( $(date +%s) - $(cat /tmp/archon-autonomous.lock/timestamp 2>/dev/null || echo "$(date +%s)") ))
    echo ""
    echo "Lock: HELD (pid=$PID, age=${AGE}s)"
else
    echo ""
    echo "Lock: FREE"
fi
