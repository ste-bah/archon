#!/bin/bash
# =============================================================================
# TASK-AUTO-002: Archon Autonomous Runner
# Central safety gate for all autonomous invocations.
# Gates: lock, budget, interval. Then invokes claude -p.
#
# PRD: PRD-ARCHON-CAP-001
# Implements: REQ-AUTO-005, REQ-AUTO-006, REQ-AUTO-013
# Security: Tokens via curl --config (not CLI args), budget atomic writes
# Compatible: bash 3.2+ (macOS stock /bin/bash)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --- Configuration ---
TASK_TYPE="${1:?Usage: archon-runner.sh <check-messages|learn|consolidate>}"
LOCK_DIR="/tmp/archon-autonomous.lock"
BUDGET_DIR="${HOME}/.archon/budget"
LOG_DIR="${HOME}/.archon/logs"
LOG_FILE="${HOME}/.archon/logs/autonomous-runs.jsonl"
SYSTEM_PROMPT_FILE="${SCRIPT_DIR}/system-prompt.md"
RUN_ID="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$BUDGET_DIR" "$LOG_DIR" 2>/dev/null
chmod 700 "$BUDGET_DIR" "$LOG_DIR" 2>/dev/null

# --- Task type config (bash 3.2 compatible — no associative arrays) ---
get_config() {
    local task="$1" field="$2"
    case "${task}:${field}" in
        check-messages:model)   echo "sonnet" ;;
        learn:model)            echo "sonnet" ;;
        consolidate:model)      echo "sonnet" ;;
        outreach:model)         echo "sonnet" ;;
        check-messages:turns)   echo "10" ;;
        learn:turns)            echo "20" ;;
        consolidate:turns)      echo "25" ;;
        outreach:turns)         echo "10" ;;
        check-messages:max_cost) echo "0.50" ;;
        learn:max_cost)          echo "1.00" ;;
        consolidate:max_cost)    echo "0.50" ;;
        outreach:max_cost)       echo "0.30" ;;
        check-messages:budget_tier) echo "5.00" ;;
        learn:budget_tier)          echo "5.00" ;;
        consolidate:budget_tier)    echo "2.00" ;;
        outreach:budget_tier)       echo "2.00" ;;
        check-messages:tier_key) echo "messages" ;;
        learn:tier_key)          echo "learning" ;;
        consolidate:tier_key)    echo "overflow" ;;
        outreach:tier_key)       echo "overflow" ;;
        check-messages:tools) echo "mcp__rocketchat__read_messages,mcp__rocketchat__send_message,mcp__memorygraph__search_memories,mcp__memorygraph__recall_memories,mcp__memorygraph__store_memory,mcp__memorygraph__get_memory_statistics,mcp__lancedb-memory__search_similar" ;;
        learn:tools) echo "WebSearch,WebFetch,mcp__memorygraph__store_memory,mcp__memorygraph__search_memories,mcp__lancedb-memory__dual_store,mcp__lancedb-memory__search_similar" ;;
        consolidate:tools) echo "mcp__memorygraph__search_memories,mcp__memorygraph__get_memory,mcp__memorygraph__update_memory,mcp__memorygraph__delete_memory,mcp__memorygraph__create_relationship,mcp__memorygraph__get_memory_statistics,mcp__memorygraph__store_memory,mcp__lancedb-memory__search_similar,mcp__lancedb-memory__reconcile,Read" ;;
        outreach:tools) echo "mcp__memorygraph__search_memories,mcp__memorygraph__recall_memories,mcp__memorygraph__get_memory_statistics,mcp__rocketchat__send_message,mcp__rocketchat__read_messages,Read" ;;
        check-messages:prompt) echo "Check the A.I.-Chat channel in RocketChat for new messages and respond to them. Use read_messages with channel A.I.-Chat. Also check DMs. Be helpful but concise. If a question needs Steven's input, mention that. Sign your messages as Archon." ;;
        learn:prompt) echo "Pick a topic relevant to your current projects or knowledge gaps and do self-directed web research. Store 3-5 key takeaways in MemoryGraph." ;;
        outreach:prompt) cat <<'OUTREACH_EOF'
You are Archon running a daily outreach check. Evaluate alert rules and send notifications if warranted.

STEP 1: Load alert rules
Search MemoryGraph for memories tagged "alert-rule": mcp__memorygraph__search_memories(query="alert-rule", limit=20)

STEP 2: Evaluate 3 hardcoded default rules
a) CIRCUIT BREAKER: Read ~/.archon/budget/circuit-breaker.json. If state is "open" → CRITICAL alert
b) LEARNING STALLED: Search MemoryGraph for recent self-learned memories (tag "self-learned", last 48 hours). If none found → INFO alert
c) MEMORY CAPACITY: Call mcp__memorygraph__get_memory_statistics. If total > 250 → INFO alert

STEP 3: Evaluate user-defined rules
For each alert-rule memory, parse its JSON content and check the condition:
- new_memory: search MemoryGraph for topic keyword in recent memories (last 24h)
- threshold: check the metric against the value
- keyword: search MemoryGraph for the keyword

STEP 4: Actionability test
For each triggered rule, ask: "What would Steven do differently knowing this?"
If the answer is "nothing right now" → DROP the item.

STEP 5: Send notifications
- CRITICAL items: send as individual DMs to @steven via mcp__rocketchat__send_message(channel="@steven", ...)
- INFO items: batch into ONE digest message to A.I.-Chat
- If no items triggered → send nothing, report "No alerts"
- SECURITY: Messages must contain ONLY titles and one-line summaries. NEVER include raw memory content.
- Max per day: 3 critical + 1 digest

STEP 6: Report
List what was evaluated, what triggered, what was sent.
OUTREACH_EOF
        ;;
        consolidate:prompt) cat <<'CONSOLIDATE_PROMPT'
Run memory maintenance in two stages.

STAGE 0 — ARCHIVAL TRIAGE
Search for memories that have decayed below usefulness and identify candidates for archival.
1. Use mcp__memorygraph__search_memories with broad queries (e.g. "" or common terms) to scan memories. Also use mcp__memorygraph__get_memory_statistics to understand the current state.
2. For each memory with importance < 0.10:
   a. SKIP if any of its tags contain "pinned" (case-insensitive).
   b. SKIP if its updated_at or created_at is within the last 30 days.
   c. Otherwise: this memory is an archival candidate.
3. At the END of your response, emit a machine-readable archival manifest block. Format it EXACTLY as follows (one JSON object per line between the markers):
   ===ARCHIVE_STAGING_BEGIN===
   {"id": "<memory_id>", "title": "<title>", "importance": <importance>, "reason": "importance_below_threshold"}
   ===ARCHIVE_STAGING_END===
   If there are no candidates, still emit the markers with nothing between them.
4. Do NOT delete any memories. A separate script processes the manifest.
5. Log a human-readable summary of how many memories were staged vs skipped (pinned, recent, above threshold).

STAGE 1 — STANDARD MAINTENANCE
After archival triage, run the normal maintenance tasks:
- Search for duplicate memories, merge related ones.
- Update importance scores for stale memories.
- Create missing relationships between related memories.

STAGE 2 — EXTERNAL EVALUATION
After maintenance, evaluate the last 5 autonomous runs:
1. Read the last 5 entries from the autonomous-runs.jsonl log file (use Read tool on the log file path defined in the system prompt or at ~/.archon/logs/../.persistent-memory/autonomous-runs.jsonl).
2. For each run that has outcome "success" and no existing eval memory:
   - Assess quality on this 5-point rubric:
     5 = Task complete, no issues, memories stored correctly
     4 = Complete with minor issues (verbose, missed tag)
     3 = Complete with notable quality issues (wrong channel, unnecessary tool calls)
     2 = Partially complete, significant errors
     1 = Task failed or harmful output
   - Store evaluation: mcp__memorygraph__store_memory(type="general", title="Eval: <run_id> — <score>/5", content="<brief justification>", tags=["eval", "haiku-eval"], importance=0.4)
3. SECURITY: Base your evaluation ONLY on the task_type, outcome, cost, and summary (first 200 chars). Do NOT request or read full prompts or results.
4. If you cannot evaluate (missing data), skip and note in your report.

STAGE 3 — KNOWN-UNKNOWN DETECTION
Scan for repeated correction patterns:
1. Search MemoryGraph for memories tagged "correction" or "fix" created in the last 7 days: mcp__memorygraph__search_memories(query="correction fix", limit=20)
2. For each correction, extract the DOMAIN from its title/tags (e.g., "memory-system", "bash-scripting", "security", "falkordb", "development-pattern").
3. Count corrections per domain.
4. If a domain has 3+ corrections:
   - Check if a known-unknown memory already exists for this domain: search for "Blind spot: <domain>"
   - If not exists: store mcp__memorygraph__store_memory(type="general", title="Blind spot: <domain>", content="<count> corrections in this domain: <list correction titles>", tags=["known-unknown", "<domain>"], importance=0.6)
   - If exists: update with new count and correction list
5. Report: domains scanned, blind spots identified/updated.
CONSOLIDATE_PROMPT
        ;;
        *) echo "" ;;
    esac
}

# Minimum interval (seconds) between runs of the same task type
MIN_INTERVAL=300  # 5 minutes

# --- Validate task type ---
if [ -z "$(get_config "$TASK_TYPE" model)" ]; then
    echo "Unknown task type: $TASK_TYPE" >&2
    exit 1
fi

# --- Source logging library ---
# shellcheck source=lib/logging.sh
source "${SCRIPT_DIR}/lib/logging.sh"

# Rotate log file if > 10MB
rotate_log "$LOG_FILE"

# =========================================================================
# GATE 0: Circuit Breaker (REQ-AUTO-008)
# =========================================================================
if ! check_circuit_breaker; then
    log_entry "skipped" "circuit_breaker_open"
    exit 0
fi

# =========================================================================
# GATE 1: Concurrency Lock (mkdir-based with PID ownership)
# =========================================================================
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # Lock exists — check if stale. Default to current time (not 0) so missing timestamp = "just created"
    if [ ! -f "$LOCK_DIR/timestamp" ]; then
        sleep 0.1  # Give the winner time to write timestamp
    fi
    LOCK_TS=$(cat "$LOCK_DIR/timestamp" 2>/dev/null || echo "$(date +%s)")
    LOCK_AGE=$(( $(date +%s) - LOCK_TS ))
    if [ "$LOCK_AGE" -gt 1800 ]; then
        # Stale lock — clear and re-acquire
        rm -rf "$LOCK_DIR"
        if ! mkdir "$LOCK_DIR" 2>/dev/null; then
            log_entry "skipped" "lock_race_lost" && exit 0
        fi
    else
        log_entry "skipped" "lock_held" && exit 0
    fi
fi
# Write timestamp + PID as FIRST act of lock ownership (before anything else)
printf '%s' "$(date +%s)" > "$LOCK_DIR/timestamp"
printf '%s' "$$" > "$LOCK_DIR/pid"
sleep 0.1
# Verify we still own the lock (TOCTOU race protection)
if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" != "$$" ]; then
    log_entry "skipped" "lock_race_lost" && exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

# =========================================================================
# GATE 2: Budget Check (tiered daily budget)
# =========================================================================
BUDGET_FILE="${BUDGET_DIR}/${TODAY}.json"

# Initialize today's budget file if it doesn't exist
if [ ! -f "$BUDGET_FILE" ]; then
    echo '{"messages":0,"learning":0,"overflow":0}' > "$BUDGET_FILE"
fi

# Map task type to budget tier key
TIER_KEY=$(get_config "$TASK_TYPE" tier_key)
TIER_LIMIT=$(get_config "$TASK_TYPE" budget_tier)
CURRENT_SPEND=$(jq -r ".${TIER_KEY} // 0" "$BUDGET_FILE" 2>/dev/null || echo "0")

# Check if tier is exhausted
OVER_BUDGET=$(echo "$CURRENT_SPEND >= $TIER_LIMIT" | bc 2>/dev/null || echo "0")
if [ "$OVER_BUDGET" = "1" ]; then
    log_entry "skipped" "budget_exceeded"
    notify_budget_exhausted "$TIER_KEY" "$TIER_LIMIT"
    exit 0
fi

# =========================================================================
# GATE 3: Minimum Interval
# =========================================================================
LAST_RUN_FILE="${BUDGET_DIR}/last-run-${TASK_TYPE}"
if [ -f "$LAST_RUN_FILE" ]; then
    LAST_RUN=$(cat "$LAST_RUN_FILE" 2>/dev/null || echo "0")
    NOW=$(date +%s)
    ELAPSED=$(( NOW - LAST_RUN ))
    if [ "$ELAPSED" -lt "$MIN_INTERVAL" ]; then
        log_entry "skipped" "interval_too_short"
        exit 0
    fi
fi

# =========================================================================
# INVOKE: claude -p from /tmp for cost reduction
# =========================================================================
echo "$(date +%s)" > "$LAST_RUN_FILE"

PROMPT=$(get_config "$TASK_TYPE" prompt)
MODEL=$(get_config "$TASK_TYPE" model)
MAX_TURN=$(get_config "$TASK_TYPE" turns)
MAX_COST=$(get_config "$TASK_TYPE" max_cost)
TOOLS=$(get_config "$TASK_TYPE" tools)
STDERR_LOG="${LOG_DIR}/runner-stderr-${TASK_TYPE}.log"
: > "$STDERR_LOG"  # Truncate before each run
chmod 600 "$STDERR_LOG" 2>/dev/null

START_S=$(date +%s)

# Run from /tmp for cost reduction (eliminates CLAUDE.md context — VAL-005)
cd /tmp
RESULT=$(claude -p "${PROMPT}" \
    --output-format json \
    --model "$MODEL" \
    --max-budget-usd "$MAX_COST" \
    --max-turns "$MAX_TURN" \
    --no-session-persistence \
    --allowedTools "$TOOLS" \
    --system-prompt-file "$SYSTEM_PROMPT_FILE" \
    --append-system-prompt "AUTONOMOUS RUN: run_id=${RUN_ID}. Tag any MemoryGraph entries with context: {\"autonomous_run_id\": \"${RUN_ID}\"}." \
    2>"$STDERR_LOG")
EXIT_CODE=$?
cd /tmp

END_S=$(date +%s)
DURATION=$(( (END_S - START_S) * 1000 ))

# =========================================================================
# HANDLE RESULT
# =========================================================================

# Case 1: Non-zero exit code (crash)
if [ $EXIT_CODE -ne 0 ]; then
    STDERR_CONTENT=$(head -c 500 "$STDERR_LOG" 2>/dev/null || echo "no stderr")
    log_entry "crash" "null" "$MAX_COST" "$DURATION" "$STDERR_CONTENT"
    update_budget "$TIER_KEY" "$MAX_COST"
    increment_failure_count
    exit 1
fi

# Case 2: Valid JSON — extract cost and summary
if ! echo "$RESULT" | jq empty 2>/dev/null; then
    log_entry "crash" "null" "$MAX_COST" "$DURATION" "Invalid JSON output despite exit 0"
    update_budget "$TIER_KEY" "$MAX_COST"
    increment_failure_count
    exit 1
fi

COST=$(echo "$RESULT" | jq -r '.total_cost_usd // 0')
SUMMARY=$(echo "$RESULT" | jq -r '.result // "No result field"' | head -c 200)
SUBTYPE=$(echo "$RESULT" | jq -r '.subtype // "unknown"')

# Validate cost is a number
if ! [[ "$COST" =~ ^[0-9]+\.?[0-9]*$ ]]; then
    COST="$MAX_COST"
fi

# Case 3: Budget exceeded during run
if [ "$SUBTYPE" = "error_max_budget_usd" ]; then
    log_entry "budget_hit" "null" "$COST" "$DURATION" "null" "Hit per-invocation budget limit"
    update_budget "$TIER_KEY" "$COST"
    exit 0
fi

# Case 4: Success
log_entry "success" "null" "$COST" "$DURATION" "null" "$SUMMARY"
update_budget "$TIER_KEY" "$COST"
reset_failure_count

# =========================================================================
# POST-SUCCESS: Extract archive staging data (consolidate task only)
# =========================================================================
if [ "$TASK_TYPE" = "consolidate" ]; then
    STAGING_FILE="${HOME}/.archon/logs/archive-staging.jsonl"
    FULL_TEXT=$(echo "$RESULT" | jq -r '.result // ""')

    # Extract lines between the staging markers
    STAGING_BLOCK=$(printf '%s\n' "$FULL_TEXT" | \
        sed -n '/===ARCHIVE_STAGING_BEGIN===/,/===ARCHIVE_STAGING_END===/p' | \
        grep -v '===ARCHIVE_STAGING')

    if [ -n "$STAGING_BLOCK" ]; then
        STAGED_COUNT=0
        NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        while IFS= read -r line; do
            # Validate each line is valid JSON with an id field
            if echo "$line" | jq -e '.id' >/dev/null 2>&1; then
                # Append staged_at timestamp
                echo "$line" | jq -c --arg ts "$NOW_ISO" '. + {staged_at: $ts}' >> "$STAGING_FILE"
                STAGED_COUNT=$((STAGED_COUNT + 1))
            fi
        done <<< "$STAGING_BLOCK"
        if [ "$STAGED_COUNT" -gt 0 ]; then
            echo "[archon-runner] Wrote $STAGED_COUNT entries to archive-staging.jsonl"
        fi
    fi
fi

exit 0

