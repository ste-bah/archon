#!/bin/bash
# =============================================================================
# Archon Code Cartographer — Stop Daemon
#
# Usage: cartographer-stop.sh
#
# Sends SIGTERM for graceful shutdown. Force-kills after 5s if still running.
# =============================================================================

PID_FILE="$HOME/.archon/cartographer/daemon.pid"
PORT=8042

# ---- Try SIGTERM first -----------------------------------------------------
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID"
    echo "[cartographer] SIGTERM sent to PID $PID"
    for _ in 1 2 3 4 5; do
      sleep 1
      kill -0 "$PID" 2>/dev/null || {
        echo "[cartographer] Daemon stopped"
        rm -f "$PID_FILE"
        exit 0
      }
    done
    echo "[cartographer] WARNING: Daemon still running after 5s — sending SIGKILL"
    kill -9 "$PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "[cartographer] Killed"
  else
    echo "[cartographer] Not running (stale PID file)"
    rm -f "$PID_FILE"
  fi
else
  echo "[cartographer] Not running (no PID file)"
fi
