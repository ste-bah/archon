#!/bin/bash
# =============================================================================
# Archon Push-to-Talk — Stop Daemon
#
# Usage: ptt-stop.sh
#
# Sends "stop" command via the Unix socket for a graceful shutdown.
# Falls back to SIGTERM if the socket is unavailable.
# =============================================================================

PID_FILE="$HOME/.archon/ptt/daemon.pid"
SOCK_FILE="$HOME/.archon/ptt/daemon.sock"

# ---- Try graceful socket stop first ----------------------------------------
if [ -S "$SOCK_FILE" ]; then
  RESPONSE=$(echo "stop" | nc -U "$SOCK_FILE" 2>/dev/null || true)
  if echo "$RESPONSE" | grep -q '"ok"'; then
    echo "[ptt] Graceful stop sent"
    # Wait up to 5s for PID file to disappear
    for _ in 1 2 3 4 5; do
      sleep 1
      [ ! -f "$PID_FILE" ] && echo "[ptt] Daemon stopped" && exit 0
    done
    echo "[ptt] Stop sent but daemon still running — trying SIGTERM"
  fi
fi

# ---- Fall back to SIGTERM --------------------------------------------------
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID"
    echo "[ptt] SIGTERM sent to PID $PID"
    for _ in 1 2 3 4 5; do
      sleep 1
      kill -0 "$PID" 2>/dev/null || { echo "[ptt] Daemon stopped"; exit 0; }
    done
    echo "[ptt] WARNING: Daemon still running after 5s — sending SIGKILL"
    kill -9 "$PID" 2>/dev/null || true
    rm -f "$PID_FILE" "$SOCK_FILE"
    echo "[ptt] Killed"
  else
    echo "[ptt] Not running (stale PID file)"
    rm -f "$PID_FILE"
  fi
else
  echo "[ptt] Not running (no PID file)"
fi
