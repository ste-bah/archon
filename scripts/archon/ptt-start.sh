#!/bin/bash
# =============================================================================
# Archon Push-to-Talk — Singleton Daemon Launcher
#
# Usage: ptt-start.sh [--hotkey "ctrl+shift+space"] [--model tiny.en]
#
# Starts the PTT daemon in the background. Safe to call multiple times —
# exits silently if already running. Logs to:
#   macOS : ~/Library/Logs/archon/push-to-talk.log
#   Linux : ~/.local/share/archon/logs/push-to-talk.log
# =============================================================================

set -euo pipefail

# ---- Locate project root ---------------------------------------------------
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "[ptt] ERROR: Not inside a git repository. Cannot locate project root." >&2
  exit 1
fi

# ---- Locate Python interpreter ---------------------------------------------
PYTHON_CMD=""
for candidate in "$HOME/.venv/bin/python3" python3.12 python3.11 python3; do
  if command -v "$candidate" &>/dev/null 2>&1 || [ -x "$candidate" ]; then
    if "$candidate" -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
      PYTHON_CMD="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON_CMD" ]; then
  echo "[ptt] ERROR: Python 3.11+ not found. Install it or activate ~/.venv." >&2
  exit 1
fi

# ---- Paths -----------------------------------------------------------------
PTT_DIR="$HOME/.archon/ptt"
PID_FILE="$PTT_DIR/daemon.pid"
SOCK_FILE="$PTT_DIR/daemon.sock"

if [[ "$(uname)" == "Darwin" ]]; then
  LOG_DIR="$HOME/Library/Logs/archon"
else
  LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/archon/logs"
fi
LOG_FILE="$LOG_DIR/push-to-talk.log"

mkdir -p "$PTT_DIR" "$LOG_DIR"

# ---- Already running? ------------------------------------------------------
if [ -f "$PID_FILE" ]; then
  EXISTING_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "[ptt] Already running (PID $EXISTING_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# ---- Atomic lock (prevent race on simultaneous starts) ---------------------
LOCK_DIR="$PTT_DIR/start.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  sleep 1
  exit 0
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT

# ---- Start daemon ----------------------------------------------------------
echo "[ptt] Starting push-to-talk daemon..."
echo "[ptt] Python  : $PYTHON_CMD ($("$PYTHON_CMD" --version 2>&1))"
echo "[ptt] Project : $ROOT"
echo "[ptt] Log     : $LOG_FILE"

nohup "$PYTHON_CMD" -m src.voice_mcp.push_to_talk \
  </dev/null \
  >>"$LOG_FILE" 2>&1 &

DAEMON_PID=$!

# ---- Wait for PID file (daemon writes it on startup) -----------------------
WAIT=0
MAX_WAIT=15
while [ $WAIT -lt $MAX_WAIT ]; do
  sleep 1
  WAIT=$((WAIT + 1))

  # Check process is still alive
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "[ptt] ERROR: Daemon exited immediately. Check log: $LOG_FILE" >&2
    tail -20 "$LOG_FILE" >&2
    exit 1
  fi

  # Check PID file was written (daemon is up and past startup)
  if [ -f "$PID_FILE" ]; then
    RUNNING_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    echo "[ptt] Running  (PID $RUNNING_PID, hotkey: $(
      [ -f "$HOME/.archon/ptt.json" ] && \
        python3 -c "import json,sys; d=json.load(open('$HOME/.archon/ptt.json')); print(d.get('hotkey','ctrl+shift+space'))" 2>/dev/null || \
        echo "ctrl+shift+space"
    ))"
    echo "[ptt] Log      : $LOG_FILE"
    exit 0
  fi
done

echo "[ptt] WARNING: Daemon started (PID $DAEMON_PID) but PID file not written within ${MAX_WAIT}s."
echo "[ptt]          Check log: $LOG_FILE"
exit 0
