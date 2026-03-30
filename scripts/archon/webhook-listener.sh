#!/bin/bash
# TASK-ADV-001: RocketChat Webhook Listener
# Lightweight HTTP listener that triggers archon-runner on incoming messages.
# Uses netcat (nc) — no Node/Python server dependency.
#
# PRD: PRD-ARCHON-CAP-001 | REQ-AUTO-010
# Security: Binds to localhost only. Validates webhook secret.
#
# Setup in RocketChat:
#   Admin > Integrations > Outgoing Webhook
#   URL: http://localhost:8420/archon-webhook
#   Channel: A.I.-Chat
#   Trigger: Message Sent
#   Script: (none needed)
#
# Usage: ./webhook-listener.sh [port]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-8420}"
RUNNER="${SCRIPT_DIR}/archon-runner.sh"
LOG_DIR="${HOME}/.archon/logs"
LOG_FILE="${LOG_DIR}/webhook.log"
WEBHOOK_SECRET="${ARCHON_WEBHOOK_SECRET:-}"  # Optional shared secret

mkdir -p "$LOG_DIR" 2>/dev/null

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG_FILE"; }

log "Webhook listener starting on localhost:${PORT}"
echo "Archon webhook listener on localhost:${PORT}"
echo "Configure RocketChat outgoing webhook to: http://localhost:${PORT}/archon-webhook"

while true; do
    # Read HTTP request via nc (netcat)
    REQUEST=$(nc -l -p "$PORT" -w 5 2>/dev/null || nc -l "$PORT" 2>/dev/null)

    if [ -z "$REQUEST" ]; then
        continue
    fi

    # Extract path from first line
    PATH_LINE=$(echo "$REQUEST" | head -1)

    # Only handle POST to /archon-webhook
    if ! echo "$PATH_LINE" | grep -q "POST /archon-webhook"; then
        # Return 404 for other paths
        printf "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found" | nc -l -p "$PORT" -w 1 2>/dev/null &
        continue
    fi

    # Extract JSON body (everything after the blank line)
    BODY=$(echo "$REQUEST" | sed -n '/^\r*$/,$ p' | tail -n +2)

    # Validate webhook secret if configured
    if [ -n "$WEBHOOK_SECRET" ]; then
        REQ_SECRET=$(echo "$BODY" | jq -r '.token // ""' 2>/dev/null)
        if [ "$REQ_SECRET" != "$WEBHOOK_SECRET" ]; then
            log "REJECTED: invalid webhook secret"
            continue
        fi
    fi

    # Extract message author — skip self-messages
    AUTHOR=$(echo "$BODY" | jq -r '.user_name // ""' 2>/dev/null)
    if [ "$AUTHOR" = "archon" ]; then
        log "SKIP: self-authored message from archon"
        continue
    fi

    CHANNEL=$(echo "$BODY" | jq -r '.channel_name // ""' 2>/dev/null)
    TEXT=$(echo "$BODY" | jq -r '.text // ""' 2>/dev/null | head -c 100)
    log "RECEIVED: ${AUTHOR} in ${CHANNEL}: ${TEXT}..."

    # Invoke runner in background (don't block the listener)
    if [ -x "$RUNNER" ]; then
        "$RUNNER" "check-messages" &
        log "DISPATCHED: archon-runner.sh check-messages (pid=$!)"
    else
        log "ERROR: Runner not executable: $RUNNER"
    fi
done
