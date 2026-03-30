#!/bin/bash
# =============================================================================
# God-Code Pipeline Enforcer Hook
# Blocks direct file writes when /god-code pipeline should be active
# =============================================================================

GOD_CODE_FLAG="/tmp/.claude-god-code-active-$$"
PIPELINE_AGENTS_REQUIRED=7  # Minimum agents before allowing direct writes (Phase 1 complete)

# Check if god-code session is active
check_god_code_active() {
  # Look for any god-code flag files (may be from parent process)
  for flag in /tmp/.claude-god-code-active-*; do
    if [[ -f "$flag" ]]; then
      echo "$flag"
      return 0
    fi
  done
  return 1
}

# Count Task() invocations in current session
count_task_invocations() {
  local count=0
  # This would need to be tracked externally or via memory
  # For now, check if the flag file contains a count
  local flag_file=$(check_god_code_active)
  if [[ -f "$flag_file" ]]; then
    count=$(cat "$flag_file" 2>/dev/null || echo "0")
  fi
  echo "$count"
}

# Main enforcement logic
enforce_pipeline() {
  local tool_name="$1"
  local file_path="$2"

  # Only enforce for Write/Edit operations
  if [[ "$tool_name" != "Write" && "$tool_name" != "Edit" && "$tool_name" != "MultiEdit" ]]; then
    return 0
  fi

  # Check if god-code is active
  local flag_file=$(check_god_code_active)
  if [[ -z "$flag_file" ]]; then
    return 0  # No god-code session, allow
  fi

  # Check task count
  local task_count=$(count_task_invocations)

  if [[ "$task_count" -lt "$PIPELINE_AGENTS_REQUIRED" ]]; then
    echo "═══════════════════════════════════════════════════════════════════"
    echo "🚫 BLOCKED: /god-code Pipeline Violation Detected"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "You attempted to use $tool_name directly on: $file_path"
    echo ""
    echo "RULE: /god-code REQUIRES the 47-agent pipeline."
    echo "      You must spawn agents using Task() tool, not write code directly."
    echo ""
    echo "Task agents spawned so far: $task_count"
    echo "Minimum required before direct writes: $PIPELINE_AGENTS_REQUIRED"
    echo ""
    echo "REQUIRED ACTION:"
    echo "  1. Use Task(\"task-analyzer\", ...) to start Phase 1"
    echo "  2. Continue with all 47 agents sequentially"
    echo "  3. Only implementation agents (Phase 4+) should write files"
    echo ""
    echo "To disable enforcement: rm $flag_file"
    echo "═══════════════════════════════════════════════════════════════════"
    return 1
  fi

  return 0
}

# Activate god-code mode (call this when /god-code is invoked)
activate_god_code() {
  echo "0" > "$GOD_CODE_FLAG"
  echo "🔒 God-Code Pipeline Mode ACTIVATED"
  echo "   Flag: $GOD_CODE_FLAG"
  echo "   Direct writes blocked until pipeline agents are spawned"
}

# Increment task count (call this after each Task() invocation)
increment_task_count() {
  local flag_file=$(check_god_code_active)
  if [[ -f "$flag_file" ]]; then
    local count=$(cat "$flag_file" 2>/dev/null || echo "0")
    echo $((count + 1)) > "$flag_file"
    echo "Pipeline agent count: $((count + 1))"
  fi
}

# Deactivate god-code mode (call when pipeline completes)
deactivate_god_code() {
  local flag_file=$(check_god_code_active)
  if [[ -f "$flag_file" ]]; then
    rm -f "$flag_file"
    echo "🔓 God-Code Pipeline Mode DEACTIVATED"
  fi
}

# Export functions for use by hooks
export -f check_god_code_active
export -f count_task_invocations
export -f enforce_pipeline
export -f activate_god_code
export -f increment_task_count
export -f deactivate_god_code
