#!/bin/bash
# leann-batch-index.sh
# Processes queued files and indexes them into LEANN
# Called automatically by coding-pipeline-post.sh or manually

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
QUEUE_FILE="$ROOT/.claude/runtime/leann-index-queue.json"
QUEUE_TXT="$ROOT/.claude/runtime/leann-index-queue.txt"
EMBEDDER_URL="http://localhost:8000"

cd "$ROOT"

# Check if embedder service is available
echo "[LEANN] Checking embedder service..."
if ! curl -s --max-time 5 "$EMBEDDER_URL/" > /dev/null 2>&1; then
  echo "[LEANN] Embedder service not available at $EMBEDDER_URL"
  echo "[LEANN] Files will remain queued for later processing"
  echo "[LEANN] To start embedder: ./embedding-api/api-embed.sh start"
  exit 1
fi
echo "[LEANN] Embedder service is available"

# Get files to index
FILES=()

if [ -f "$QUEUE_FILE" ]; then
  if command -v jq &> /dev/null; then
    while IFS= read -r file; do
      [ -n "$file" ] && FILES+=("$file")
    done < <(jq -r '.files[]' "$QUEUE_FILE" 2>/dev/null)
  fi
fi

if [ -f "$QUEUE_TXT" ]; then
  while IFS= read -r file; do
    [ -n "$file" ] && FILES+=("$file")
  done < "$QUEUE_TXT"
fi

# Deduplicate
FILES=($(printf '%s\n' "${FILES[@]}" | sort -u))

if [ ${#FILES[@]} -eq 0 ]; then
  echo "[LEANN] No files queued for indexing"
  exit 0
fi

echo "[LEANN] Indexing ${#FILES[@]} files..."

INDEXED=0
FAILED=0

for FILE in "${FILES[@]}"; do
  if [ ! -f "$FILE" ]; then
    continue
  fi

  # Get repository name
  REPO_NAME=$(basename "$ROOT")

  # Read file content (skip if > 100KB)
  FILE_SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE" 2>/dev/null || echo "0")
  if [ "$FILE_SIZE" -gt 102400 ]; then
    echo "[LEANN] Skipped (too large): $FILE"
    continue
  fi

  CODE=$(cat "$FILE")

  # Detect language
  case "$FILE" in
    *.ts|*.tsx) LANG="typescript" ;;
    *.js|*.jsx) LANG="javascript" ;;
    *.py) LANG="python" ;;
    *.rs) LANG="rust" ;;
    *.go) LANG="go" ;;
    *.java) LANG="java" ;;
    *) LANG="unknown" ;;
  esac

  # Call embedder API directly (faster than MCP)
  # FIX: metadata must be an array, not an object
  RESPONSE=$(curl -s -X POST http://localhost:8000/embed \
    -H "Content-Type: application/json" \
    -d "{\"texts\": [$(printf '%s' "$CODE" | jq -Rs .)], \"metadata\": [{\"filePath\": \"$FILE\", \"repository\": \"$REPO_NAME\", \"language\": \"$LANG\"}]}" \
    --max-time 120 2>/dev/null || echo "")

  if [ -n "$RESPONSE" ] && echo "$RESPONSE" | grep -q '"message"'; then
    ((INDEXED++))
    echo "[LEANN] Indexed: $FILE"
  else
    ((FAILED++))
    echo "[LEANN] Failed: $FILE"
  fi

  # Delay between requests
  sleep 1
done

echo "[LEANN] Complete: $INDEXED indexed, $FAILED failed"

# Clear the queue only if all files were processed
mkdir -p "$ROOT/.claude/runtime"
if [[ $FAILED -eq 0 ]]; then
  rm -f "$QUEUE_FILE" "$QUEUE_TXT" 2>/dev/null
  echo '{"files":[],"lastUpdated":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > "$QUEUE_FILE"
  echo "[LEANN] Queue cleared"
else
  # Keep failed files in queue for retry
  echo "[LEANN] Keeping $FAILED failed files in queue for retry"
fi

exit 0
