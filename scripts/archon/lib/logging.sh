#!/usr/bin/env bash
# =============================================================================
# TASK-AUTO-003: Structured Logging Library
# Provides log_entry() and update_budget() for autonomous runner.
#
# PRD: PRD-ARCHON-CAP-001
# Implements: REQ-AUTO-007
# Security: All output sanitized via jq (no raw interpolation into JSON)
#           No sensitive data (tokens, message content) in log entries
#
# Required vars (must be set by caller before sourcing):
#   LOG_FILE      — Path to autonomous-runs.jsonl
#   BUDGET_DIR    — Path to budget directory
#   TODAY          — Date string YYYY-MM-DD
#   RUN_ID         — ISO timestamp for this run
#   TASK_TYPE      — check-messages|learn|consolidate
#   MODELS         — Associative array of task→model
#   BUDGET_TIERS   — Associative array of task→tier limit
# =============================================================================

# --- Helper: Update budget file atomically ---
# Uses write-to-temp-then-rename to prevent corruption on kill
update_budget() {
    local tier="$1" cost="$2"
    local budget_file="${BUDGET_DIR}/${TODAY}.json"
    local tmpfile
    tmpfile=$(mktemp "${budget_file}.XXXXXX")
    jq --arg tier "$tier" --argjson cost "$cost" \
        '.[$tier] = ((.[$tier] // 0) + $cost)' "$budget_file" > "$tmpfile" 2>/dev/null
    if [ $? -eq 0 ] && [ -s "$tmpfile" ]; then
        mv "$tmpfile" "$budget_file"
    else
        rm -f "$tmpfile"
    fi
}

# --- Structured JSONL log entry ---
# All string fields sanitized via jq -Rs to prevent injection/corruption
log_entry() {
    local outcome="$1" skip_reason="${2:-null}" cost="${3:-0}" duration="${4:-0}" error="${5:-null}" summary="${6:-null}"
    local budget_file="${BUDGET_DIR}/${TODAY}.json"
    local remaining_msg remaining_learn remaining_overflow
    remaining_msg=$(jq -r '.messages // 0' "$budget_file" 2>/dev/null || echo "0")
    remaining_learn=$(jq -r '.learning // 0' "$budget_file" 2>/dev/null || echo "0")
    remaining_overflow=$(jq -r '.overflow // 0' "$budget_file" 2>/dev/null || echo "0")

    # Sanitize via jq for proper JSON string encoding (prevents newline/control char injection)
    local json_summary="null" json_error="null" json_skip="null"
    if [ "$summary" != "null" ]; then
        json_summary=$(printf '%s' "$summary" | head -c 200 | jq -Rs '.' 2>/dev/null || echo '"sanitization_failed"')
    fi
    if [ "$error" != "null" ]; then
        json_error=$(printf '%s' "$error" | head -c 500 | jq -Rs '.' 2>/dev/null || echo '"sanitization_failed"')
    fi
    if [ "$skip_reason" != "null" ]; then
        # skip_reason comes from hardcoded strings only (lock_held, budget_exceeded, etc.)
        json_skip="\"$skip_reason\""
    fi

    jq -nc \
        --arg ts "$RUN_ID" \
        --arg rid "$RUN_ID" \
        --arg tt "$TASK_TYPE" \
        --arg oc "$outcome" \
        --argjson sr "$json_skip" \
        --argjson dur "$duration" \
        --argjson cost "$cost" \
        --arg model "$(get_config "$TASK_TYPE" model 2>/dev/null || echo sonnet)" \
        --argjson rm "$(echo "${BUDGET_TIERS[check-messages]:-5} - $remaining_msg" | bc 2>/dev/null || echo 0)" \
        --argjson rl "$(echo "${BUDGET_TIERS[learn]:-5} - $remaining_learn" | bc 2>/dev/null || echo 0)" \
        --argjson ro "$(echo "${BUDGET_TIERS[consolidate]:-2} - $remaining_overflow" | bc 2>/dev/null || echo 0)" \
        --argjson err "$json_error" \
        --argjson sum "$json_summary" \
        '{timestamp:$ts,run_id:$rid,task_type:$tt,outcome:$oc,skip_reason:$sr,duration_ms:$dur,cost_usd:$cost,model:$model,budget_remaining:{messages:$rm,learning:$rl,overflow:$ro},error:$err,summary:$sum}' \
        >> "$LOG_FILE"
}

# --- Log rotation ---
# Call at start of each run to prevent unbounded growth
rotate_log() {
    local log="$1"
    local max_size=$((10 * 1024 * 1024))  # 10MB
    if [ -f "$log" ]; then
        local size
        size=$(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null || echo 0)
        if [ "$size" -gt "$max_size" ]; then
            mv "$log" "${log}.$(date +%Y%m%d%H%M%S).bak"
        fi
    fi
}

# --- Circuit breaker (REQ-AUTO-008) ---
# After 3 consecutive failures, disables autonomous runs and notifies Steven.
CIRCUIT_BREAKER_FILE="${BUDGET_DIR}/circuit-breaker.json"
CIRCUIT_BREAKER_THRESHOLD=3

check_circuit_breaker() {
    if [ ! -f "$CIRCUIT_BREAKER_FILE" ]; then
        return 0  # No breaker file = circuit closed (OK to run)
    fi
    local state
    state=$(jq -r '.state // "closed"' "$CIRCUIT_BREAKER_FILE" 2>/dev/null)
    if [ "$state" = "open" ]; then
        return 1  # Circuit is open (tripped) — do NOT run
    fi
    return 0
}

increment_failure_count() {
    local count=0
    if [ -f "$CIRCUIT_BREAKER_FILE" ]; then
        count=$(jq -r '.consecutive_failures // 0' "$CIRCUIT_BREAKER_FILE" 2>/dev/null)
    fi
    count=$((count + 1))

    local state="closed"
    if [ "$count" -ge "$CIRCUIT_BREAKER_THRESHOLD" ]; then
        state="open"
    fi

    local tmpfile
    tmpfile=$(mktemp "${CIRCUIT_BREAKER_FILE}.XXXXXX")
    jq -nc --argjson count "$count" --arg state "$state" \
        --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{consecutive_failures: $count, state: $state, updated: $updated}' > "$tmpfile"
    mv "$tmpfile" "$CIRCUIT_BREAKER_FILE"

    if [ "$state" = "open" ]; then
        notify_circuit_breaker_tripped "$count"
    fi
}

reset_failure_count() {
    if [ -f "$CIRCUIT_BREAKER_FILE" ]; then
        local tmpfile
        tmpfile=$(mktemp "${CIRCUIT_BREAKER_FILE}.XXXXXX")
        jq -nc '{consecutive_failures: 0, state: "closed", updated: "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > "$tmpfile"
        mv "$tmpfile" "$CIRCUIT_BREAKER_FILE"
    fi
}

notify_circuit_breaker_tripped() {
    local count="$1"
    local env_file="${HOME}/.archon-env"
    if [ ! -f "$env_file" ] || [ -L "$env_file" ]; then return 0; fi

    local rc_token rc_user_id rc_url
    eval "$(grep -E '^RC_(TOKEN|USER_ID|URL)=' "$env_file")"
    rc_token="${RC_TOKEN:-}"; rc_user_id="${RC_USER_ID:-}"; rc_url="${RC_URL:-}"
    if [ -z "$rc_token" ] || [ -z "$rc_user_id" ] || [ -z "$rc_url" ]; then return 0; fi

    local config_file
    config_file=$(mktemp "${TMPDIR:-/tmp}/archon-cb.XXXXXX")
    chmod 600 "$config_file"
    printf 'header = "X-Auth-Token: %s"\n' "$rc_token" > "$config_file"
    printf 'header = "X-User-Id: %s"\n' "$rc_user_id" >> "$config_file"
    printf 'header = "Content-Type: application/json"\n' >> "$config_file"

    # DM Steven (not the channel — this is an alert)
    curl -sf --max-time 10 --config "$config_file" \
        -X POST "${rc_url}/api/v1/chat.sendMessage" \
        -d "{\"message\":{\"channel\":\"@steven\",\"msg\":\"CIRCUIT BREAKER TRIPPED: ${count} consecutive autonomous failures. Autonomous runs disabled. Check logs: ~/.archon/logs/ and run: bash scripts/archon/status.sh. To reset: rm ~/.archon/budget/circuit-breaker.json\"}}" \
        >/dev/null 2>&1

    rm -f "$config_file"
}

# --- Budget exhaustion notification ---
# Posts a single message to A.I.-Chat when budget tier is exhausted.
# Uses curl directly ($0 — no AI invocation). Posts once per tier per day.
notify_budget_exhausted() {
    local tier="$1" limit="$2"
    local flag_file="${BUDGET_DIR}/notified-${tier}-${TODAY}"

    # Only notify once per tier per day
    if [ -f "$flag_file" ]; then
        return 0
    fi

    # Load RocketChat credentials
    local env_file="${HOME}/.archon-env"
    if [ ! -f "$env_file" ] || [ -L "$env_file" ]; then
        return 0  # Can't notify without creds — degrade silently
    fi

    # shellcheck source=/dev/null
    local rc_token rc_user_id rc_url
    eval "$(grep -E '^RC_(TOKEN|USER_ID|URL)=' "$env_file")"
    rc_token="${RC_TOKEN:-}"
    rc_user_id="${RC_USER_ID:-}"
    rc_url="${RC_URL:-}"

    if [ -z "$rc_token" ] || [ -z "$rc_user_id" ] || [ -z "$rc_url" ]; then
        return 0
    fi

    local tomorrow
    tomorrow=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d 2>/dev/null || echo "tomorrow")

    # Use curl config file to hide token from ps
    local config_file
    config_file=$(mktemp "${TMPDIR:-/tmp}/archon-notify.XXXXXX")
    chmod 600 "$config_file"
    printf 'header = "X-Auth-Token: %s"\n' "$rc_token" > "$config_file"
    printf 'header = "X-User-Id: %s"\n' "$rc_user_id" >> "$config_file"
    printf 'header = "Content-Type: application/json"\n' >> "$config_file"

    curl -sf --max-time 10 --config "$config_file" \
        -X POST "${rc_url}/api/v1/chat.sendMessage" \
        -d "{\"message\":{\"rid\":\"GENERAL\",\"msg\":\"Budget limit reached (\$${limit} ${tier}). Autonomous responses paused until ${tomorrow}. Tag @steven for urgent items.\"}}" \
        >/dev/null 2>&1

    rm -f "$config_file"
    touch "$flag_file"  # Prevent duplicate notifications
}
