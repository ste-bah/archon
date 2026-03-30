#!/bin/bash

# --- CONFIGURATION ---
# Derive project directory from script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_DIR="$PROJECT_ROOT"

# Virtual environment - check common locations
if [ -d "$PROJECT_ROOT/.venv/bin" ]; then
    VENV_BIN="$PROJECT_ROOT/.venv/bin"
elif [ -d "$HOME/.venv/bin" ]; then
    VENV_BIN="$HOME/.venv/bin"
else
    VENV_BIN="$(dirname "$(which python3)")"
fi

SCRIPT="$PROJECT_ROOT/embedding-api/api-embedder2.py"

# UPDATE: Changed directory here to "vector_db_1536" 
# This ensures we don't overwrite your old 768D/1024D vectors.
DB_DIR="$PROJECT_DIR/vector_db_1536"

# PID files
API_PID="$PROJECT_DIR/embedder.pid"
CHROMA_PID="$PROJECT_DIR/chroma.pid"

# Logs
API_LOG="$PROJECT_DIR/embedder2.log"
CHROMA_LOG="$PROJECT_DIR/chroma2.log"

# Ensure directories exist
mkdir -p "$PROJECT_DIR"
mkdir -p "$DB_DIR"

case "$1" in
    start)
        # 1. Start ChromaDB Server
        if [ -f "$CHROMA_PID" ] && kill -0 $(cat $CHROMA_PID) 2>/dev/null; then
            echo "ChromaDB already running."
        else
            echo "Starting ChromaDB on port 8001..."
            # Use the full path to the chroma executable in your venv
            nohup "$VENV_BIN/chroma" run --path "$DB_DIR" --port 8001 --host 127.0.0.1 > "$CHROMA_LOG" 2>&1 &
            echo $! > "$CHROMA_PID"
            sleep 2
        fi

        # 2. Start API Server
        if [ -f "$API_PID" ] && kill -0 $(cat $API_PID) 2>/dev/null; then
            echo "API already running."
        else
            echo "Starting API server..."
            # Use the full path to the python executable in your venv
            nohup "$VENV_BIN/python3" -u "$SCRIPT" > "$API_LOG" 2>&1 &
            echo $! > "$API_PID"
            sleep 2
        fi

        # Final Check
        if kill -0 $(cat $CHROMA_PID) 2>/dev/null && kill -0 $(cat $API_PID) 2>/dev/null; then
            echo "All services started successfully."
            echo "API: http://127.0.0.1:8000"
            echo "DB:  http://127.0.0.1:8001"
            echo "DB Path: $DB_DIR"
        else
            echo "Warning: One or more services failed to start. Check logs."
        fi
        ;;

    stop)
        if [ -f "$API_PID" ]; then
            kill $(cat "$API_PID") && rm "$API_PID" && echo "API stopped."
        fi
        if [ -f "$CHROMA_PID" ]; then
            kill $(cat "$CHROMA_PID") && rm "$CHROMA_PID" && echo "ChromaDB stopped."
        fi
        ;;

    status)
        [ -f "$API_PID" ] && kill -0 $(cat $API_PID) 2>/dev/null && echo "API: Running" || echo "API: Stopped"
        [ -f "$CHROMA_PID" ] && kill -0 $(cat $CHROMA_PID) 2>/dev/null && echo "Chroma: Running" || echo "Chroma: Stopped"
        ;;

    *)
        echo "Usage: $0 {start|stop|status}"
        exit 1
        ;;
esac
