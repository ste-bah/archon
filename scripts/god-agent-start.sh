#!/bin/bash
# God Agent Services - Background Startup
# Starts all 6 daemon services in the background with health checks
# All services log to logs/ with automatic rotation (keep last 5 per service)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

MEMORY_SOCKET="/tmp/god-agent-memory.sock"
DAEMON_SOCKET="/tmp/godagent-db.sock"
UCM_SOCKET="/tmp/godagent-ucm.sock"
PIPELINE_SOCKET="/tmp/godagent-pipeline.sock"
OBSERVE_PID="$HOME/.god-agent/daemon.pid"

MAX_LOGS=5

is_socket_alive() {
    [ -S "$1" ]
}

is_observe_running() {
    if [ -f "$OBSERVE_PID" ]; then
        local pid
        pid=$(cat "$OBSERVE_PID" 2>/dev/null)
        kill -0 "$pid" 2>/dev/null && return 0
    fi
    return 1
}

# Rotate logs: service.log -> service.log.1 -> service.log.2 ... -> service.log.N (delete oldest)
rotate_log() {
    local logfile="$1"
    if [ ! -f "$logfile" ]; then
        return 0
    fi
    # Only rotate if file has content
    local size
    size=$(wc -c < "$logfile" 2>/dev/null || echo 0)
    if [ "$size" -lt 100 ]; then
        return 0
    fi
    # Shift existing rotated logs
    local i=$MAX_LOGS
    while [ $i -gt 1 ]; do
        local prev=$((i - 1))
        [ -f "${logfile}.${prev}" ] && mv "${logfile}.${prev}" "${logfile}.${i}"
        i=$((i - 1))
    done
    # Current -> .1
    mv "$logfile" "${logfile}.1"
}

# Clean rotated logs older than 7 days
cleanup_old_logs() {
    find "$LOG_DIR" -name "*.log.*" -mtime +7 -delete 2>/dev/null || true
}

start_service() {
    local name="$1"
    local cmd="$2"
    local socket="$3"
    local timeout="${4:-10}"
    local logname="$5"

    if [ -n "$socket" ] && is_socket_alive "$socket"; then
        echo -e "${YELLOW}skip${NC}  $name (already running)"
        return 0
    fi

    # Clean stale socket
    [ -n "$socket" ] && rm -f "$socket" 2>/dev/null

    # Rotate log before starting
    local logfile="$LOG_DIR/${logname}.log"
    rotate_log "$logfile"

    printf "%-25s" "  $name"
    nohup node --import tsx/esm $cmd </dev/null >>"$logfile" 2>&1 &
    local pid=$!

    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        sleep 1
        elapsed=$((elapsed + 1))
        # Check process is still alive
        if ! kill -0 "$pid" 2>/dev/null; then
            echo -e "${RED}crashed${NC} (see $logfile)"
            return 1
        fi
        if [ -n "$socket" ] && is_socket_alive "$socket"; then
            echo -e "${GREEN}ok${NC} (${elapsed}s) → $logfile"
            return 0
        fi
    done

    echo -e "${RED}timeout${NC} (${timeout}s) → $logfile"
    return 1
}

echo "=== God Agent Services ==="

# Clean old rotated logs on startup
cleanup_old_logs

# 1. Memory Server
start_service "Memory Server" "src/god-agent/core/memory-server/memory-daemon.ts start" "$MEMORY_SOCKET" 10 "memory-server"

# 2. Core Daemon
start_service "Core Daemon" "src/god-agent/core/daemon/daemon-cli.ts start" "$DAEMON_SOCKET" 10 "core-daemon"

# 3. UCM Daemon
start_service "UCM Daemon" "src/god-agent/core/ucm/daemon/ucm-cli.ts start" "$UCM_SOCKET" 10 "ucm-daemon"

# 4. Pipeline Daemon (60s timeout — first start includes UniversalAgent init + capability indexing)
start_service "Pipeline Daemon" "src/god-agent/cli/pipeline-daemon.ts start" "$PIPELINE_SOCKET" 60 "pipeline-daemon"

# 5. Observability
if is_observe_running; then
    echo -e "${YELLOW}skip${NC}  Observability (already running)"
else
    obs_logfile="$LOG_DIR/observability.log"
    rotate_log "$obs_logfile"
    printf "%-25s" "  Observability"
    nohup node --import tsx/esm src/god-agent/observability/daemon.ts start --daemon </dev/null >>"$obs_logfile" 2>&1 &
    obs_pid=$!
    sleep 3
    if is_observe_running; then
        echo -e "${GREEN}ok${NC} → $obs_logfile"
    elif kill -0 "$obs_pid" 2>/dev/null; then
        echo -e "${GREEN}ok${NC} (no pidfile) → $obs_logfile"
    else
        echo -e "${RED}failed${NC} (see $obs_logfile)"
    fi
fi

# 6. Code Cartographer
CART_PID_FILE="$HOME/.archon/cartographer/daemon.pid"
CART_PORT=8042
cart_running=false
if [ -f "$CART_PID_FILE" ]; then
    cart_pid=$(cat "$CART_PID_FILE" 2>/dev/null)
    if [ -n "$cart_pid" ] && kill -0 "$cart_pid" 2>/dev/null; then
        cart_running=true
    fi
fi

if [ "$cart_running" = true ]; then
    echo -e "${YELLOW}skip${NC}  Code Cartographer (already running, PID $cart_pid)"
else
    cart_logfile="$LOG_DIR/cartographer.log"
    rotate_log "$cart_logfile"
    printf "%-25s" "  Code Cartographer"
    bash "$SCRIPT_DIR/archon/cartographer-start.sh" --background >>"$cart_logfile" 2>&1 &
    cart_start_pid=$!
    # Wait for health check (max 15s)
    elapsed=0
    while [ $elapsed -lt 15 ]; do
        sleep 1
        elapsed=$((elapsed + 1))
        if curl -sf "http://127.0.0.1:${CART_PORT}/health" >/dev/null 2>&1; then
            echo -e "${GREEN}ok${NC} (${elapsed}s) → $cart_logfile"
            break
        fi
    done
    if [ $elapsed -ge 15 ]; then
        if kill -0 "$cart_start_pid" 2>/dev/null; then
            echo -e "${YELLOW}starting${NC} (slow) → $cart_logfile"
        else
            echo -e "${RED}failed${NC} (see $cart_logfile)"
        fi
    fi
fi

echo "=========================="
