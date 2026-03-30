#!/bin/bash
#===============================================================================
# God Agent Session Save Script
# Called on Claude Code exit to persist God Agent state
#===============================================================================

# Source environment
source ~/.profile 2>/dev/null
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 22 --silent 2>/dev/null

# Get project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

# Quick save - just trigger a learn command which will save state on shutdown
echo "[God Agent] Saving session state..."

# Create a minimal save by running status (which initializes and shuts down cleanly)
timeout 15 npx tsx src/god-agent/universal/cli.ts status --quiet 2>/dev/null
STATUS_RESULT=$?

# Check if save succeeded
if [ $STATUS_RESULT -eq 0 ]; then
    echo "[God Agent] Session state saved to .agentdb/"
else
    echo "[God Agent] Warning: Could not save session state (timeout or error)"
fi

#===============================================================================
# AUTO-LEARNING: Submit final pipeline feedback (MANDATORY)
# This ensures learning happens AUTOMATICALLY without relying on LLM
#===============================================================================
echo "[God Agent] AUTO-LEARNING: Submitting pipeline feedback..."

# Use XDG_RUNTIME_DIR or fallback to project-local for security (avoid /tmp attacks)
FLAG_DIR="${XDG_RUNTIME_DIR:-$PROJECT_DIR/.claude/runtime}"
mkdir -p "$FLAG_DIR" 2>/dev/null
FLAG_FILE="$FLAG_DIR/.god-code-active-$$"

# Also check legacy /tmp location for backwards compatibility
LEGACY_FLAG="/tmp/.claude-god-code-active"
if [ -f "$FLAG_FILE" ]; then
    TASK_COUNT=$(cat "$FLAG_FILE" 2>/dev/null || echo "0")
elif [ -f "$LEGACY_FLAG" ]; then
    TASK_COUNT=$(cat "$LEGACY_FLAG" 2>/dev/null || echo "0")
    FLAG_FILE="$LEGACY_FLAG"  # Clean up legacy file
else
    TASK_COUNT="0"
fi

# Check if pipeline was running (task count > 0)
if [ "$TASK_COUNT" -gt 0 ]; then
    # Validate task count is numeric
    if ! [[ "$TASK_COUNT" =~ ^[0-9]+$ ]]; then
        echo "[God Agent] Warning: Invalid task count in flag file, defaulting to 0"
        TASK_COUNT="0"
    fi

    # Generate trajectory ID for this session
    TRAJ_ID="session-end-$(date +%s)-$$"

    # Calculate quality based on task count (more tasks = higher quality)
    # Formula: base 0.5 + 0.01 per task, max 0.95
    # Using pure bash to avoid bc dependency issues
    QUALITY_INT=$((50 + TASK_COUNT))  # 50 = 0.50, task count adds 0.01 per task
    if [ "$QUALITY_INT" -gt 95 ]; then
        QUALITY_INT=95
    fi
    # Convert to decimal string (bash doesn't do floats)
    QUALITY="0.${QUALITY_INT}"

    echo "[God Agent] Pipeline had $TASK_COUNT agents executed"
    echo "[God Agent] Submitting feedback with quality: $QUALITY"

    # Submit feedback to God Agent CLI (MANDATORY AUTO-LEARNING)
    timeout 30 npx tsx src/god-agent/universal/cli.ts code-feedback "$TRAJ_ID" \
        --output "Pipeline session completed with $TASK_COUNT agents executed" \
        --agent "47-agent-pipeline" \
        --phase 7 \
        2>/dev/null

    if [ $? -eq 0 ]; then
        echo "[God Agent] ✓ AUTO-LEARNING: Pipeline feedback submitted successfully"
    else
        echo "[God Agent] ⚠ AUTO-LEARNING: Feedback submission failed (will retry next session)"

        # Queue failed feedback for retry
        echo "{\"trajectoryId\":\"$TRAJ_ID\",\"taskCount\":$TASK_COUNT,\"quality\":$QUALITY,\"timestamp\":\"$(date -Iseconds)\"}" >> "$PROJECT_DIR/.claude/hooks/feedback-queue.json"
    fi

    # Clean up flag files (both new and legacy locations)
    rm -f "$FLAG_FILE" "$LEGACY_FLAG" 2>/dev/null
    echo "[God Agent] Pipeline mode deactivated"
else
    echo "[God Agent] No active pipeline detected (non-pipeline session)"
fi

# Process any queued feedback from previous failed submissions - REAL RETRY LOGIC
QUEUE_FILE="$PROJECT_DIR/.claude/hooks/feedback-queue.json"
if [ -f "$QUEUE_FILE" ]; then
    QUEUE_SIZE=$(wc -c < "$QUEUE_FILE" 2>/dev/null || echo "0")
    if [ "$QUEUE_SIZE" -gt 10 ]; then
        echo "[God Agent] Processing queued feedback entries..."

        # Use jq if available for proper JSON parsing, otherwise warn
        if command -v jq >/dev/null 2>&1; then
            # Read and process each entry
            PROCESSED=0
            FAILED=0

            # Extract trajectory IDs and resubmit each one
            while IFS= read -r ENTRY; do
                ENTRY_TRAJ=$(echo "$ENTRY" | jq -r '.trajectoryId // empty' 2>/dev/null)
                ENTRY_QUALITY=$(echo "$ENTRY" | jq -r '.quality // 0.7' 2>/dev/null)
                ENTRY_TASK_COUNT=$(echo "$ENTRY" | jq -r '.taskCount // 0' 2>/dev/null)

                if [ -n "$ENTRY_TRAJ" ]; then
                    # Attempt to resubmit
                    timeout 15 npx tsx src/god-agent/universal/cli.ts code-feedback "$ENTRY_TRAJ" \
                        --output "Retry: $ENTRY_TASK_COUNT agents, quality $ENTRY_QUALITY" \
                        --agent "47-agent-pipeline" \
                        --phase 7 \
                        2>/dev/null

                    if [ $? -eq 0 ]; then
                        PROCESSED=$((PROCESSED + 1))
                    else
                        FAILED=$((FAILED + 1))
                    fi
                fi
            done < <(jq -c '.[]' "$QUEUE_FILE" 2>/dev/null)

            echo "[God Agent] Retry complete: $PROCESSED processed, $FAILED failed"

            # Archive processed queue
            if [ "$PROCESSED" -gt 0 ]; then
                mv "$QUEUE_FILE" "$PROJECT_DIR/.claude/hooks/feedback-queue.processed.$(date +%s).json" 2>/dev/null
            fi
        else
            echo "[God Agent] Warning: jq not installed, cannot parse feedback queue"
            echo "[God Agent] Install jq for proper retry processing: brew install jq"
        fi
    fi
fi

echo "[God Agent] Session save complete"
