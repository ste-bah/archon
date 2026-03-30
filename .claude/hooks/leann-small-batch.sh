#!/bin/bash
# leann-small-batch.sh - Process files in small batches with health checks

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
QUEUE_FILE="$ROOT/.claude/runtime/leann-index-queue.json"
EMBEDDER_URL="http://localhost:8000"
BATCH_SIZE=3
PAUSE_BETWEEN_BATCHES=10

cd "$ROOT"

# Get files from queue
FILES=$(cat "$QUEUE_FILE" | jq -r '.files[]' 2>/dev/null | tail -n +51 | head -100)
TOTAL=$(echo "$FILES" | wc -l | tr -d ' ')

echo "[LEANN] Processing $TOTAL files in batches of $BATCH_SIZE"

INDEXED=0
FAILED=0
COUNT=0

for FILE in $FILES; do
  [ -z "$FILE" ] && continue
  [ ! -f "$FILE" ] && continue

  COUNT=$((COUNT + 1))

  # Health check every batch
  if [ $((COUNT % BATCH_SIZE)) -eq 1 ]; then
    echo "[LEANN] Health check..."
    if ! curl -s --max-time 30 "$EMBEDDER_URL/" > /dev/null 2>&1; then
      echo "[LEANN] API not responding, waiting 30s..."
      sleep 30
      if ! curl -s --max-time 30 "$EMBEDDER_URL/" > /dev/null 2>&1; then
        echo "[LEANN] API still down, stopping"
        break
      fi
    fi
  fi

  # Skip large files
  FILE_SIZE=$(stat -f%z "$FILE" 2>/dev/null || echo "0")
  if [ "$FILE_SIZE" -gt 20000 ]; then
    echo "[LEANN] Skip (>20KB): $FILE"
    continue
  fi

  # Read file
  CODE=$(cat "$FILE")
  REPO_NAME=$(basename "$ROOT")

  # Detect language
  case "$FILE" in
    *.ts|*.tsx) LANG="typescript" ;;
    *.js|*.jsx) LANG="javascript" ;;
    *.py) LANG="python" ;;
    *) LANG="unknown" ;;
  esac

  # Index
  RESPONSE=$(curl -s -X POST "$EMBEDDER_URL/embed" \
    -H "Content-Type: application/json" \
    -d "{\"texts\": [$(printf '%s' "$CODE" | jq -Rs .)], \"metadata\": [{\"filePath\": \"$FILE\", \"repository\": \"$REPO_NAME\", \"language\": \"$LANG\"}]}" \
    --max-time 90 2>/dev/null || echo "")

  if [ -n "$RESPONSE" ] && echo "$RESPONSE" | grep -q '"message"'; then
    INDEXED=$((INDEXED + 1))
    echo "[LEANN] [$COUNT/$TOTAL] OK: $(basename "$FILE")"
  else
    FAILED=$((FAILED + 1))
    echo "[LEANN] [$COUNT/$TOTAL] FAIL: $(basename "$FILE")"
  fi

  # Pause between batches
  if [ $((COUNT % BATCH_SIZE)) -eq 0 ]; then
    echo "[LEANN] Batch done, pausing ${PAUSE_BETWEEN_BATCHES}s..."
    sleep $PAUSE_BETWEEN_BATCHES
  fi

  sleep 3
done

echo "[LEANN] Done: $INDEXED indexed, $FAILED failed"
