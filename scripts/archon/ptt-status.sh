#!/bin/bash
# =============================================================================
# Archon Push-to-Talk — Status Query
#
# Usage: ptt-status.sh [--json]
#
# Shows daemon state via the Unix socket. Falls back to PID-file check
# if the socket is unavailable.
# =============================================================================

PID_FILE="$HOME/.archon/ptt/daemon.pid"
SOCK_FILE="$HOME/.archon/ptt/daemon.sock"
JSON_MODE=false

[ "${1:-}" = "--json" ] && JSON_MODE=true

# ---- Query via socket (preferred — returns live state) ---------------------
if [ -S "$SOCK_FILE" ]; then
  RESPONSE=$(echo "status" | nc -U "$SOCK_FILE" 2>/dev/null || true)
  if [ -n "$RESPONSE" ]; then
    if $JSON_MODE; then
      echo "$RESPONSE"
      exit 0
    fi
    # Pretty-print key fields
    STATE=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('state','?'))" 2>/dev/null || echo "?")
    PID=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('pid','?'))" 2>/dev/null || echo "?")
    UPTIME=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); u=d.get('uptime_seconds',0); print(f'{int(u//3600)}h{int((u%3600)//60)}m{int(u%60)}s')" 2>/dev/null || echo "?")
    HOTKEY=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('hotkey','?'))" 2>/dev/null || echo "?")
    MODEL=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('model','?'))" 2>/dev/null || echo "?")
    TX=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('transcriptions',0))" 2>/dev/null || echo "0")
    ERR=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('errors',0))" 2>/dev/null || echo "0")
    CB=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes (clipboard-only mode)' if d.get('clipboard_only') else 'no')" 2>/dev/null || echo "?")

    echo "=== Push-to-Talk Status ==="
    echo "  State          : $STATE"
    echo "  PID            : $PID"
    echo "  Uptime         : $UPTIME"
    echo "  Hotkey         : $HOTKEY"
    echo "  Model          : $MODEL"
    echo "  Transcriptions : $TX"
    echo "  Errors         : $ERR"
    echo "  Clipboard only : $CB"
    exit 0
  fi
fi

# ---- Fall back to PID file check -------------------------------------------
if $JSON_MODE; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo '{"state":"running","pid":'"$PID"',"note":"socket unavailable"}'
    else
      echo '{"state":"stopped"}'
    fi
  else
    echo '{"state":"stopped"}'
  fi
  exit 0
fi

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "=== Push-to-Talk Status ==="
    echo "  State : running (PID $PID)"
    echo "  Note  : socket unavailable — limited status only"
  else
    echo "=== Push-to-Talk Status ==="
    echo "  State : stopped (stale PID file)"
  fi
else
  echo "=== Push-to-Talk Status ==="
  echo "  State : stopped"
fi
