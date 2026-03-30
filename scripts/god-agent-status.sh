#!/bin/bash
# God Agent Services - Status Check

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

check_socket() {
    local name="$1"
    local socket="$2"
    if [ -S "$socket" ]; then
        echo -e "  $name  ${GREEN}RUNNING${NC}  ($socket)"
    else
        echo -e "  $name  ${RED}STOPPED${NC}"
    fi
}

check_pid() {
    local name="$1"
    local pidfile="$2"
    if [ -f "$pidfile" ]; then
        local pid
        pid=$(cat "$pidfile" 2>/dev/null | grep -oE '[0-9]+' | head -1)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            local cpu
            cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
            echo -e "  $name  ${GREEN}RUNNING${NC}  (PID $pid, CPU ${cpu}%)"
        else
            echo -e "  $name  ${YELLOW}STALE PID${NC}  ($pidfile)"
        fi
    else
        echo -e "  $name  ${RED}STOPPED${NC}"
    fi
}

echo "=== God Agent Service Status ==="
check_socket "Memory Server  " "/tmp/god-agent-memory.sock"
check_socket "Core Daemon    " "/tmp/godagent-db.sock"
check_socket "UCM Daemon     " "/tmp/godagent-ucm.sock"
check_socket "Pipeline Daemon" "/tmp/godagent-pipeline.sock"
check_pid    "Observability  " "$HOME/.god-agent/daemon.pid"

# Check for orphan processes
orphans=$(ps aux | grep -E "(memory-daemon|daemon-cli|ucm-cli|daemon-server|observability/daemon|pipeline-daemon)" | grep -v grep | wc -l | tr -d ' ')
if [ "$orphans" -gt 0 ]; then
    echo ""
    echo -e "  ${YELLOW}$orphans daemon process(es) found:${NC}"
    ps aux | grep -E "(memory-daemon|daemon-cli|ucm-cli|daemon-server|observability/daemon|pipeline-daemon)" | grep -v grep | awk '{printf "    PID %-6s CPU %5s%%  %s\n", $2, $3, $11}'
fi
echo "================================="
