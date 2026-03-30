#!/bin/bash
# =============================================================================
# TASK-AUTO-001: RocketChat Bash Pre-Filter
# Polls RocketChat REST API ($0/call) for unread messages.
# Only invokes archon-runner.sh when messages exist in monitored channels.
#
# PRD: PRD-ARCHON-CAP-001
# Implements: REQ-AUTO-001a
# Security: Credentials loaded from ~/.archon-env (chmod 600, no symlinks)
#           Tokens passed via curl --config (not command-line args)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Log directory (user-private, not /tmp) ---
LOG_DIR="${HOME}/.archon/logs"
mkdir -p "$LOG_DIR" 2>/dev/null
chmod 700 "$LOG_DIR" 2>/dev/null
LOG_FILE="${LOG_DIR}/prefilter.log"

# --- Logging ---
log_info()  { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO  $1" >> "$LOG_FILE"; }
log_warn()  { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WARN  $1" >> "$LOG_FILE"; }
log_error() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR $1" >> "$LOG_FILE"; }

# --- Rotate log if > 1MB ---
if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG_FILE" "${LOG_FILE}.$(date +%Y%m%d%H%M%S).bak"
fi

# --- Load credentials ---
ARCHON_ENV="${HOME}/.archon-env"
if [ ! -f "$ARCHON_ENV" ]; then
    log_error "Credentials file not found"
    exit 0
fi

# Reject symlinks (Finding 7)
if [ -L "$ARCHON_ENV" ]; then
    log_error "Credentials file is a symlink — refusing to load"
    exit 0
fi

# Verify permissions (must be 600)
PERMS=$(stat -f%Lp "$ARCHON_ENV" 2>/dev/null || stat -c%a "$ARCHON_ENV" 2>/dev/null || echo "unknown")
if [ "$PERMS" != "600" ]; then
    log_error "Insecure permissions on credentials file: ${PERMS} (must be 600)"
    exit 0
fi

# Read file atomically then evaluate (TOCTOU fix — Finding 5)
ENV_CONTENT=$(cat "$ARCHON_ENV" 2>/dev/null)
if [ -z "$ENV_CONTENT" ]; then
    log_error "Credentials file is empty"
    exit 0
fi
eval "$ENV_CONTENT"

# Validate required vars (never log their values)
if [ -z "${RC_TOKEN:-}" ] || [ -z "${RC_URL:-}" ]; then
    log_error "Missing required vars: RC_TOKEN or RC_URL"
    exit 0
fi

# Validate RC_URL against allowlist (SSRF prevention — Finding 4)
# RC_URL_ALLOWLIST can be set in env for testing; defaults to production URL
RC_URL_ALLOW="${RC_URL_ALLOWLIST:-http://192.168.1.125:8100|https://192.168.1.125:*}"
URL_ALLOWED=false
IFS='|' read -ra ALLOWED_URLS <<< "$RC_URL_ALLOW"
for pattern in "${ALLOWED_URLS[@]}"; do
    case "$RC_URL" in
        $pattern) URL_ALLOWED=true; break ;;
    esac
done
if [ "$URL_ALLOWED" != "true" ]; then
    log_error "RC_URL not in allowlist"
    exit 0
fi

# --- Helper: curl with auth via config file (Finding 3 — hide token from ps) ---
# Uses CURL_CMD var for testability (tests can override with a mock)
CURL_CMD="${CURL_CMD:-curl}"

rc_curl() {
    local endpoint="$1"
    local extra_user_id="${2:-${RC_USER_ID:-}}"

    # If using a mock curl (test mode), skip config file to preserve mock behavior
    if [ "$CURL_CMD" != "curl" ] || type -t curl 2>/dev/null | grep -q "function"; then
        local result
        result=$($CURL_CMD -sf --max-time 10 \
            -H "X-Auth-Token: ${RC_TOKEN}" \
            -H "X-User-Id: ${extra_user_id}" \
            "${RC_URL}${endpoint}" 2>/dev/null)
        local exit_code=$?
        if [ $exit_code -eq 0 ] && [ -n "$result" ]; then
            echo "$result"
            return 0
        fi
        return $exit_code
    fi

    # Production mode: use config file to hide token from process list
    local config_file
    config_file=$(mktemp "${TMPDIR:-/tmp}/archon-curl.XXXXXX")
    chmod 600 "$config_file"
    printf 'header = "X-Auth-Token: %s"\n' "$RC_TOKEN" > "$config_file"
    printf 'header = "X-User-Id: %s"\n' "$extra_user_id" >> "$config_file"
    local result
    result=$(curl -sf --max-time 10 --config "$config_file" "${RC_URL}${endpoint}" 2>/dev/null)
    local exit_code=$?
    rm -f "$config_file"
    if [ $exit_code -eq 0 ] && [ -n "$result" ]; then
        echo "$result"
        return 0
    fi
    return $exit_code
}

# --- Auto-resolve RC_USER_ID if not set (first run) ---
if [ -z "${RC_USER_ID:-}" ]; then
    ME_RESPONSE=$(rc_curl "/api/v1/me" "${RC_TOKEN_ID:-}")
    if [ $? -eq 0 ] && [ -n "$ME_RESPONSE" ]; then
        RC_USER_ID=$(echo "$ME_RESPONSE" | jq -r '._id // empty' 2>/dev/null)

        # Validate user ID is safe alphanumeric (RCE prevention — Finding 2)
        if [[ ! "$RC_USER_ID" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
            log_error "Auto-resolved user ID contains unsafe characters — aborting"
            exit 0
        fi

        log_info "Auto-resolved RC_USER_ID"

        # Persist via atomic rewrite (no sed injection — Finding 2)
        TMPFILE=$(mktemp "${ARCHON_ENV}.XXXXXX")
        grep -v '^RC_USER_ID=' "$ARCHON_ENV" > "$TMPFILE"
        echo "RC_USER_ID=\"${RC_USER_ID}\"" >> "$TMPFILE"
        chmod 600 "$TMPFILE"
        mv "$TMPFILE" "$ARCHON_ENV"
    else
        log_error "Failed to resolve user ID from API"
        exit 0
    fi
fi

# --- Monitored channels ---
# A.I.-Chat (multi-AI collaboration) and DMs (type "d")
MONITORED_CHANNELS='["A.I.-Chat"]'

# --- Poll RocketChat ---
RESPONSE=$(rc_curl "/api/v1/subscriptions.get")
CURL_EXIT=$?

if [ $CURL_EXIT -ne 0 ] || [ -z "$RESPONSE" ]; then
    log_warn "RocketChat unreachable"
    exit 0
fi

# Parse response: filter to monitored channels + DMs with unread > 0
# RocketChat subscriptions.get returns {"update": [...], "remove": [...]}
UNREAD=$(echo "$RESPONSE" | jq --argjson channels "$MONITORED_CHANNELS" '
    [.update // [] | .[] |
        select(.unread > 0) |
        select(
            (.name as $n | $channels | index($n)) or
            .t == "d"
        )
        | .unread
    ] | add // 0
' 2>/dev/null)
JQ_EXIT=$?

if [ $JQ_EXIT -ne 0 ] || [ -z "$UNREAD" ]; then
    log_warn "Failed to parse RocketChat response"
    exit 0
fi

# --- Self-message filter (Gate 4 — moved here from runner per adversarial review) ---
# Check if the last message in unread channels is from Archon (own messages don't need response)
LAST_AUTHOR=$(echo "$RESPONSE" | jq -r '
    [.update // [] | .[] | select(.unread > 0) | .lastMessage.u.username // ""] | .[0]
' 2>/dev/null)
if [ "$LAST_AUTHOR" = "archon" ]; then
    log_info "Last message is self-authored — skipping"
    exit 0
fi

# --- Decision ---
if [ "${UNREAD:-0}" -gt 0 ]; then
    log_info "Found ${UNREAD} unread in monitored channels"

    RUNNER="${SCRIPT_DIR}/archon-runner.sh"
    if [ -x "$RUNNER" ]; then
        exec "$RUNNER" "check-messages"
    else
        log_warn "Runner not found — standalone mode"
        echo "UNREAD_MESSAGES=${UNREAD}"
        exit 0
    fi
else
    # Heartbeat: log successful poll with no messages (proves the poll ran)
    log_info "Poll OK — 0 unread in monitored channels"
    exit 0
fi
