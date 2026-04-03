#!/bin/bash
# =============================================================================
# Archon Code Cartographer — Daemon Launcher
#
# Usage: cartographer-start.sh [--background]
#
# Starts the Code Cartographer daemon on port 8042.
# Runs in FOREGROUND by default (for systemd). Use --background for manual use.
#
# Logs (background mode):
#   Linux : ~/.local/share/archon/logs/cartographer.log
# =============================================================================

set -euo pipefail

BACKGROUND=false
for arg in "$@"; do
  case "$arg" in
    --background) BACKGROUND=true ;;
  esac
done

# ---- Locate project root ---------------------------------------------------
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "[cartographer] ERROR: Not inside a git repository. Cannot locate project root." >&2
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
  echo "[cartographer] ERROR: Python 3.11+ not found. Install it or activate ~/.venv." >&2
  exit 1
fi

# ---- Paths -----------------------------------------------------------------
CART_DIR="$HOME/.archon/cartographer"
PID_FILE="$CART_DIR/daemon.pid"
PORT=8042

if [[ "$(uname)" == "Darwin" ]]; then
  LOG_DIR="$HOME/Library/Logs/archon"
else
  LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/archon/logs"
fi
LOG_FILE="$LOG_DIR/cartographer.log"

mkdir -p "$CART_DIR" "$LOG_DIR"

# ---- Already running? ------------------------------------------------------
if [ -f "$PID_FILE" ]; then
  EXISTING_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "[cartographer] Already running (PID $EXISTING_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# ---- Atomic lock (prevent race on simultaneous starts) ---------------------
LOCK_DIR="$CART_DIR/start.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  sleep 1
  exit 0
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT

# ---- Start daemon ----------------------------------------------------------
echo "[cartographer] Starting Code Cartographer daemon..."
echo "[cartographer] Python  : $PYTHON_CMD ($("$PYTHON_CMD" --version 2>&1))"
echo "[cartographer] Project : $ROOT"
echo "[cartographer] Port    : $PORT"

export PYTHONPATH="$ROOT"
cd "$ROOT"

if [ "$BACKGROUND" = true ]; then
  echo "[cartographer] Mode    : background"
  echo "[cartographer] Log     : $LOG_FILE"

  nohup "$PYTHON_CMD" -m src.code_cartographer.daemon --port "$PORT" \
    </dev/null \
    >>"$LOG_FILE" 2>&1 &

  DAEMON_PID=$!

  # ---- Wait for health check -----------------------------------------------
  WAIT=0
  MAX_WAIT=15
  while [ $WAIT -lt $MAX_WAIT ]; do
    sleep 1
    WAIT=$((WAIT + 1))

    # Check process is still alive
    if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
      echo "[cartographer] ERROR: Daemon exited immediately. Check log: $LOG_FILE" >&2
      tail -20 "$LOG_FILE" >&2
      exit 1
    fi

    # Health check
    if curl -sf "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
      echo "[cartographer] Running  (PID $DAEMON_PID, port $PORT)"
      exit 0
    fi
  done

  echo "[cartographer] WARNING: Daemon started (PID $DAEMON_PID) but health check not reachable within ${MAX_WAIT}s."
  echo "[cartographer]          Check log: $LOG_FILE"
  exit 0

else
  echo "[cartographer] Mode    : foreground (systemd)"
  # Foreground — systemd manages the process directly
  exec "$PYTHON_CMD" -m src.code_cartographer.daemon --port "$PORT"
fi
