#!/bin/bash
# God Agent Services - Clean Shutdown
# Stops all 5 daemon services with graceful shutdown then force kill

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "=== Stopping God Agent Services ==="

# Use existing npm stop commands (they have proper shutdown logic)
for service in pipeline observe ucm daemon memory; do
    printf "%-25s" "  $service"
    npm run ${service}:stop 2>/dev/null && echo -e "${GREEN}ok${NC}" || echo -e "${RED}not running${NC}"
done

# Kill any orphan processes that escaped npm stop
echo -n "  Cleaning orphans...     "
pkill -f "memory-daemon.ts" 2>/dev/null || true
pkill -f "daemon-cli.ts start" 2>/dev/null || true
pkill -f "ucm-cli.ts" 2>/dev/null || true
pkill -f "daemon-server.ts" 2>/dev/null || true
pkill -f "observability/daemon.ts" 2>/dev/null || true
pkill -f "pipeline-daemon.ts" 2>/dev/null || true
sleep 1
echo -e "${GREEN}ok${NC}"

# Clean stale sockets
for sock in /tmp/god-agent-memory.sock /tmp/godagent-db.sock /tmp/godagent-ucm.sock /tmp/godagent-pipeline.sock; do
    [ -e "$sock" ] && rm -f "$sock"
done

# Clean stale PID files
rm -f /tmp/godagent-daemon.pid /tmp/godagent-ucm.pid /tmp/godagent-pipeline.pid 2>/dev/null

echo "=========================="
echo "Logs: $ROOT_DIR/logs/"
