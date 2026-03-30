#!/bin/bash
# =============================================================================
# Pipeline Integrity Guard Hook
# =============================================================================
# Catches sneaky pipeline shortcut patterns that bypass the existing
# Write/Edit enforcement:
#
# 1. Writing fake output files via Bash (echo/cat redirect to output files)
# 2. Batching multiple complete-and-next calls in one Bash command
# 3. Running pipeline CLI commands (complete, next) without a preceding
#    real Agent/Task spawn
#
# This hook runs on PreToolUse for Bash commands during active pipeline.
# =============================================================================

# NOTE: Do NOT use set -e or pipefail here — grep returns non-zero on no match
# and we need those non-matches to be safe pass-throughs.

# Read tool input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only check Bash commands
if [ "$TOOL_NAME" != "Bash" ] || [ -z "$COMMAND" ]; then
  exit 0
fi

# Check if pipeline is active
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -z "$ROOT" ]; then
  exit 0
fi

ACTIVE_FLAG="$ROOT/.claude/runtime/.god-code-active"
if [ ! -f "$ACTIVE_FLAG" ]; then
  # Also check memory-based enforcement
  if [ -f "$ROOT/.swarm/memory.db" ]; then
    ACTIVE=$(sqlite3 "$ROOT/.swarm/memory.db" \
      "SELECT content FROM memory_entries WHERE namespace='default' AND key='enforcement/pipeline/active' LIMIT 1;" 2>/dev/null || echo "")
    # No entry found → no active pipeline
    if [ -z "$ACTIVE" ]; then
      exit 0
    fi
    # Entry exists but pipeline is not active
    if echo "$ACTIVE" | jq -e '.active == true' &>/dev/null 2>&1; then
      : # Pipeline IS active, continue to checks
    else
      exit 0  # Pipeline is not active (active=false or unparseable)
    fi
  else
    exit 0  # No memory db, no active pipeline
  fi
fi

# =============================================================================
# PATTERN 1: Fake output file writing via redirects
# Catches: echo "## something" > output.txt
#          cat <<EOF > /path/to/output
#          printf "..." > output
# =============================================================================
# Look for redirect operators writing to files that look like pipeline outputs
if echo "$COMMAND" | grep -qE '(echo|printf|cat)\s.*>\s*.*(output|result|summary|response|agent-)'; then
  echo ""
  echo "=================================================================="
  echo "BLOCKED: Pipeline Integrity Violation — Fake Output"
  echo "=================================================================="
  echo ""
  echo "Detected: Writing directly to what appears to be a pipeline output file."
  echo "Command:  $(echo "$COMMAND" | head -c 200)"
  echo ""
  echo "RULE: Pipeline agent outputs must come from REAL Agent/Task subagent"
  echo "      spawns, not from echo/cat/printf redirects."
  echo ""
  echo "Correct flow:"
  echo "  1. Read PROMPT_FILE"
  echo "  2. Spawn real Agent tool with prompt content"
  echo "  3. Write the agent's ACTUAL response to the output file"
  echo "  4. Call complete-and-next"
  echo ""
  echo "=================================================================="
  exit 1
fi

# =============================================================================
# PATTERN 2: Batched complete-and-next calls
# Catches: multiple complete/next calls chained with && or ; or in loops
# =============================================================================
COMPLETE_COUNT=$(echo "$COMMAND" | grep -o 'complete-and-next\|complete_and_next\|coding-pipeline-cli.*complete\|phd-cli.*complete' | wc -l | tr -d ' ')
if [ "$COMPLETE_COUNT" -gt 1 ]; then
  echo ""
  echo "=================================================================="
  echo "BLOCKED: Pipeline Integrity Violation — Batched Completions"
  echo "=================================================================="
  echo ""
  echo "Detected: $COMPLETE_COUNT complete-and-next calls in a single command."
  echo "Command:  $(echo "$COMMAND" | head -c 200)"
  echo ""
  echo "RULE: Each pipeline agent must be completed INDIVIDUALLY."
  echo "      One complete-and-next per Bash command, with a real Agent"
  echo "      spawn between each."
  echo ""
  echo "=================================================================="
  exit 1
fi

# =============================================================================
# PATTERN 3: Loop-based agent processing
# Catches: for/while loops that iterate over agents or pipeline steps
# =============================================================================
if echo "$COMMAND" | grep -qE '(for|while)\s.*\b(agent|step|phase|pipeline|complete)\b'; then
  # Only flag if it also contains complete-and-next or output writing
  if echo "$COMMAND" | grep -qE '(complete|next|output|result)'; then
    echo ""
    echo "=================================================================="
    echo "BLOCKED: Pipeline Integrity Violation — Loop-Based Processing"
    echo "=================================================================="
    echo ""
    echo "Detected: Loop iterating over pipeline agents/steps."
    echo "Command:  $(echo "$COMMAND" | head -c 200)"
    echo ""
    echo "RULE: Each agent must be processed individually:"
    echo "      1. Read PROMPT_FILE"
    echo "      2. Spawn real Agent subagent"
    echo "      3. Wait for completion"
    echo "      4. Write actual response"
    echo "      5. Call complete-and-next"
    echo ""
    echo "Loops that process multiple agents are NEVER acceptable."
    echo ""
    echo "=================================================================="
    exit 1
  fi
fi

# =============================================================================
# PATTERN 4: Heredoc/multiline stub writing
# Catches: cat <<EOF > output, cat <<'HEREDOC' > file
# =============================================================================
if echo "$COMMAND" | grep -qE "cat\s*<<['\"]?\w*['\"]?\s*>" ; then
  # Check if target looks like a pipeline output
  TARGET=$(echo "$COMMAND" | grep -oE ">\s*\S+" | head -1 | sed 's/>\s*//')
  if echo "$TARGET" | grep -qiE '(output|result|summary|response|agent|pipeline|phase)'; then
    echo ""
    echo "=================================================================="
    echo "BLOCKED: Pipeline Integrity Violation — Heredoc Stub"
    echo "=================================================================="
    echo ""
    echo "Detected: Writing heredoc content directly to pipeline output file."
    echo "Target:   $TARGET"
    echo ""
    echo "RULE: Output files must contain REAL agent responses, not stubs."
    echo ""
    echo "=================================================================="
    exit 1
  fi
fi

# All checks passed
exit 0
