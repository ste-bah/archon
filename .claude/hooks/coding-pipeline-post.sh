#!/bin/bash
# coding-pipeline-post.sh v3
# Triggered AFTER /god-code execution
# ENFORCES feedback submission before allowing completion
# LEANN indexing runs independently of feedback gate

set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

# Source enforcement functions if available
if [[ -f ".claude/hooks/god-code-enforcement-v2.sh" ]]; then
  source ".claude/hooks/god-code-enforcement-v2.sh"
fi

echo "═══════════════════════════════════════════════════════════════"
echo "POST-HOOK: Verifying Pipeline Completion Requirements"
echo "═══════════════════════════════════════════════════════════════"

# Step 1: Check if pipeline was active
PIPELINE_STATE=$(cat .god-agent/pipeline-memory/enforcement/pipeline/active.json 2>/dev/null || echo '{}')
PIPELINE_ACTIVE=$(echo "$PIPELINE_STATE" | jq -r '.active // false' 2>/dev/null || echo "false")

if [[ "$PIPELINE_ACTIVE" != "true" ]]; then
  echo "[WARN] No active pipeline detected - skipping enforcement"
  exit 0
fi

PIPELINE_ID=$(echo "$PIPELINE_STATE" | jq -r '.pipelineId // "unknown"' 2>/dev/null)
AGENT_COUNT=$(echo "$PIPELINE_STATE" | jq -r '.agentCount // 0' 2>/dev/null)

echo "[INFO] Pipeline ID: $PIPELINE_ID"
echo "[INFO] Agent Count: $AGENT_COUNT / 47"

# Step 2: LEANN index queue check
# Shell hooks cannot call MCP tools directly. LEANN indexing MUST be done by Claude
# calling mcp__leann-search__process_queue before pipeline completes.
LEANN_QUEUE=".claude/runtime/leann-index-queue.json"
if [[ -f "$LEANN_QUEUE" ]]; then
  QUEUE_COUNT=$(jq '.files | length' "$LEANN_QUEUE" 2>/dev/null || echo "0")
  if [[ "$QUEUE_COUNT" -gt 0 ]]; then
    echo ""
    echo "!! LEANN PROTOCOL VIOLATION: $QUEUE_COUNT files NOT indexed !!"
    echo ""
    echo "   Pipeline wrote files but orchestrator did NOT call"
    echo "   mcp__leann-search__process_queue before completing."
    echo ""
    echo "   These files will NOT be searchable by future pipelines."
    echo "   FIX: Call mcp__leann-search__process_queue now (repeat until queueRemaining=0)"
    echo ""
  else
    echo "[OK] LEANN index queue is empty — all files indexed"
  fi
else
  echo "[INFO] No LEANN queue file found"
fi

# Step 3: GATE - Verify minimum agents were spawned
MIN_AGENTS=19  # Phase 4 start
if [[ "$AGENT_COUNT" -lt "$MIN_AGENTS" ]]; then
  echo ""
  echo "BLOCKED: Insufficient agents spawned"
  echo "   Required: $MIN_AGENTS minimum (Phase 4)"
  echo "   Actual: $AGENT_COUNT"
  echo ""
  echo "   Pipeline cannot complete without proper agent execution."
  echo "═══════════════════════════════════════════════════════════════"
  exit 1
fi

# Step 4: GATE - Verify feedback was submitted
echo "[INFO] Checking feedback submission..."
FEEDBACK_STATUS=$(cat .god-agent/pipeline-memory/coding/pipeline/feedback-status.json 2>/dev/null || echo '{}')
FEEDBACK_VERIFIED=$(echo "$FEEDBACK_STATUS" | jq -r '.verified // false' 2>/dev/null || echo "false")
FEEDBACK_TRAJECTORY=$(echo "$FEEDBACK_STATUS" | jq -r '.trajectoryId // "none"' 2>/dev/null)

if [[ "$FEEDBACK_VERIFIED" != "true" ]]; then
  echo ""
  echo "BLOCKED: Feedback not submitted or not verified"
  echo ""
  echo "   The learning loop MUST be closed before pipeline completes."
  echo ""
  echo "   REQUIRED ACTION:"
  echo "   1. Run: npx tsx src/god-agent/universal/cli.ts code-feedback \"$PIPELINE_ID\" --output \"[output]\" --agent \"pipeline\" --phase 7"
  echo "   2. Run: npx tsx src/god-agent/universal/cli.ts verify-feedback \"$PIPELINE_ID\""
  echo "   3. Store: # REMOVED: npx claude-flow@alpha memory store -k \"coding/pipeline/feedback-status\" --value '{\"trajectoryId\":\"$PIPELINE_ID\",\"verified\":true}'"
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  exit 1
fi

echo "[OK] Feedback verified for trajectory: $FEEDBACK_TRAJECTORY"

# Step 5: All gates passed - mark complete
echo ""
echo "All completion requirements verified"
echo ""

# Aggregate XP
TOTAL_XP=$(cat .god-agent/pipeline-memory/coding/xp/total.json 2>/dev/null | jq -r '.xp // 0' || echo "0")

# Update final state
# REMOVED: npx claude-flow@alpha memory store -k "coding/pipeline/state" --value '{
  "status": "completed",
  "pipelineId": "'"$PIPELINE_ID"'",
  "agentCount": '$AGENT_COUNT',
  "feedbackVerified": true,
  "totalXP": '$TOTAL_XP',
  "completedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' 2>/dev/null

# Deactivate enforcement
if type deactivate_pipeline &>/dev/null; then
  deactivate_pipeline
fi

echo "═══════════════════════════════════════════════════════════════"
echo "PIPELINE COMPLETE"
echo "   Pipeline ID: $PIPELINE_ID"
echo "   Agents: $AGENT_COUNT / 47"
echo "   XP Earned: $TOTAL_XP"
echo "═══════════════════════════════════════════════════════════════"
