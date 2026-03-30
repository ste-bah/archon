#!/bin/bash
# =============================================================================
# Personality Daemon — Singleton Launcher
# One global daemon, reused across all sessions. Atomic mkdir lock
# prevents race. stdout/stderr redirected to prevent hook hang.
# =============================================================================

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0

VENV="$HOME/.memorygraph-venv"
[ ! -d "$VENV" ] && exit 0

PID_FILE="$ROOT/.run/personality-daemon.pid"
LOCK_DIR="$ROOT/.run/personality-daemon.lock"
SESSIONS_DIR="$ROOT/.persistent-memory/sessions"

mkdir -p "$ROOT/.run" "$SESSIONS_DIR"

# Check if daemon already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    PROC_CMD=$(ps -p "$OLD_PID" -o command= 2>/dev/null || echo "")
    if echo "$PROC_CMD" | grep -q "personality_daemon"; then
      exit 0  # daemon running, all good
    fi
  fi
  rm -f "$PID_FILE"
fi

# Atomic lock — only one session can start the daemon
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  sleep 1  # another process is starting, wait briefly
  exit 0
fi

# Start daemon with FalkorDB (try) or MinimalClient (fallback)
# CRITICAL: nohup + redirect ALL output to prevent hook hang
nohup "$VENV/bin/python3" -c "
import sys, os, logging
os.environ['MEMORY_BACKEND'] = 'falkordblite'
sys.path.insert(0, '$ROOT')
logging.basicConfig(
    filename='$ROOT/.persistent-memory/personality-daemon.log',
    level=logging.WARNING,
)

from src.archon_consciousness.personality.personality_daemon import MultiSessionDaemon

# Try FalkorDB, fall back to MinimalClient
client = None
try:
    import asyncio
    from memorygraph.backends.factory import BackendFactory
    from memorygraph.database import MemoryDatabase
    from src.archon_consciousness.personality.memorygraph_adapter import MemoryGraphAdapter
    backend = asyncio.run(BackendFactory.create_backend())
    db = MemoryDatabase(backend)
    client = MemoryGraphAdapter(db)
except Exception:
    pass

daemon = MultiSessionDaemon('$SESSIONS_DIR', client=client)
daemon.run(poll_interval=0.2, pid_file='$PID_FILE')
" >/dev/null 2>&1 &

DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"
rmdir "$LOCK_DIR" 2>/dev/null
echo "[personality-daemon] Started singleton (PID $DAEMON_PID)"
exit 0
