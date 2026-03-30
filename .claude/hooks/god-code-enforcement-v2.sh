#!/bin/bash
# =============================================================================
# God-Code Enforcement Hook v2 - Memory-Based Pipeline Enforcement
# =============================================================================
# Uses ClaudeFlow memory instead of /tmp/ files for compaction survival.
# State persists in .swarm/memory.db across context compactions.
#
# Version: 2.0.0
# Created: 2026-02-03
# =============================================================================

# Configuration
MEMORY_KEY="enforcement/pipeline/active"
MEMORY_NAMESPACE="default"
MIN_AGENTS_BEFORE_WRITE=6   # Phase 1 complete (6 agents) before writes allowed
TOTAL_PIPELINE_AGENTS=48     # Full pipeline completion count (41 core + 7 Sherlock)

# Phase boundaries (cumulative agent counts)
PHASE1_END=6    # Understanding: agents 1-6
PHASE2_END=10   # Exploration: agents 7-10
PHASE3_END=15   # Architecture: agents 11-15
PHASE4_END=27   # Implementation: agents 16-27 (writes allowed)
PHASE5_END=35   # Testing: agents 28-35 (includes test-fixer)
PHASE6_END=40   # Optimization: agents 36-40
PHASE7_END=41   # Delivery: agent 41
SHERLOCK_END=48 # Sherlock Forensic: agents 42-48

# =============================================================================
# Helper Functions
# =============================================================================

# Generate a unique pipeline ID
generate_pipeline_id() {
  if command -v uuidgen &>/dev/null; then
    uuidgen 2>/dev/null
  elif [[ -f /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid 2>/dev/null
  else
    echo "pid-$(date +%s)-$$-$RANDOM"
  fi
}

# Calculate pipeline phase from agent count
calculate_phase() {
  local count="${1:-0}"

  if [[ "$count" -le "$PHASE1_END" ]]; then
    echo 1
  elif [[ "$count" -le "$PHASE2_END" ]]; then
    echo 2
  elif [[ "$count" -le "$PHASE3_END" ]]; then
    echo 3
  elif [[ "$count" -le "$PHASE4_END" ]]; then
    echo 4
  elif [[ "$count" -le "$PHASE5_END" ]]; then
    echo 5
  elif [[ "$count" -le "$PHASE6_END" ]]; then
    echo 6
  else
    echo 7
  fi
}

# Get phase name for display
get_phase_name() {
  local phase="${1:-1}"

  case "$phase" in
    1) echo "Understanding" ;;
    2) echo "Exploration" ;;
    3) echo "Architecture" ;;
    4) echo "Implementation" ;;
    5) echo "Testing" ;;
    6) echo "Optimization" ;;
    7) echo "Delivery" ;;
    *) echo "Unknown" ;;
  esac
}

# Retrieve state from ClaudeFlow memory
retrieve_state() {
  local raw_output
  raw_output=$(cat .god-agent/pipeline-memory/$MEMORY_KEY.json 2>/dev/null | grep -A 1000 "^| Value:" | tail -n +2 | grep -v "^+" | sed 's/^| //' | sed 's/ *|$//' | tr -d '\n' | sed 's/  */ /g')

  # If that doesn't work, try to find JSON directly
  if [[ -z "$json_value" ]] || [[ "$json_value" == *"not found"* ]]; then
    # Try direct JSON extraction
    json_value=$(echo "$raw_output" | grep -o '{.*}' | head -1)
  fi

  if [[ -n "$json_value" ]] && echo "$json_value" | jq -e . &>/dev/null; then
    echo "$json_value"
    return 0
  fi

  echo ""
  return 1
}

# Store state to ClaudeFlow memory
# Note: pipeline memory uses local JSON files in .god-agent/pipeline-memory/
# FIX: Use atomic upsert to prevent race condition window (Critical Issue #1)
store_state() {
  local state_json="$1"
  local key="${2:-$MEMORY_KEY}"
  local db_path=".swarm/memory.db"

  # ATOMIC UPSERT: Update existing entry or fallback to store
  # Fix: Use correct column names (content not value, no status column in schema)
  if [[ -f "$db_path" ]]; then
    # Try to update existing entry first (atomic upsert pattern)
    local timestamp_ms=$(($(date +%s) * 1000))
    local update_result
    update_result=$(sqlite3 "$db_path" "UPDATE memory_entries SET content='$state_json', updated_at='$timestamp_ms' WHERE namespace='$MEMORY_NAMESPACE' AND key='$key'; SELECT changes();" 2>/dev/null)

    if [[ "$update_result" == "1" ]]; then
      # Successfully updated existing entry - no race window
      return 0
    fi
    # Entry doesn't exist, fall through to store
  fi

  # Store the new value (entry doesn't exist or db file doesn't exist)
  local output
  output=$(# REMOVED: npx claude-flow@alpha memory store -k "$key" -v "$state_json" --namespace "$MEMORY_NAMESPACE" 2>&1)
  local exit_code=$?

  # Check for success indicators in output
  if [[ "$output" == *"stored successfully"* ]] || [[ "$output" == *"[OK]"* ]]; then
    return 0
  fi

  # Also consider exit code 0 as success
  if [[ "$exit_code" -eq 0 ]]; then
    return 0
  fi

  # Retry once if there was a UNIQUE constraint conflict - try UPDATE instead
  if [[ "$output" == *"UNIQUE constraint"* ]] || [[ "$output" == *"already exists"* ]]; then
    if [[ -f "$db_path" ]]; then
      local timestamp_ms=$(($(date +%s) * 1000))
      local update_result
      update_result=$(sqlite3 "$db_path" "UPDATE memory_entries SET content='$state_json', updated_at='$timestamp_ms' WHERE namespace='$MEMORY_NAMESPACE' AND key='$key'; SELECT changes();" 2>/dev/null)
      if [[ "$update_result" == "1" ]]; then
        return 0
      fi
    fi
  fi

  return 1
}

# =============================================================================
# Core Pipeline Functions
# =============================================================================

# Function: activate_pipeline
# Called when /god-code skill is invoked
# Stores initial state to ClaudeFlow memory
activate_pipeline() {
  local pipeline_id
  local timestamp
  local state_json

  pipeline_id=$(generate_pipeline_id)
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Create initial state JSON
  state_json=$(cat <<EOF
{
  "active": true,
  "pipelineId": "$pipeline_id",
  "startedAt": "$timestamp",
  "agentCount": 0,
  "currentPhase": 1,
  "phaseAgentCounts": {
    "phase1": 0,
    "phase2": 0,
    "phase3": 0,
    "phase4": 0,
    "phase5": 0,
    "phase6": 0,
    "phase7": 0
  },
  "minAgentsBeforeWrite": $MIN_AGENTS_BEFORE_WRITE,
  "writeAttemptsBlocked": 0,
  "lastAgentName": null,
  "lastAgentTimestamp": null,
  "compactionSurvivalMarker": "$timestamp"
}
EOF
)

  # Store active state
  if store_state "$state_json" "$MEMORY_KEY"; then
    # Store backup for compaction recovery
    store_state "$state_json" "enforcement/pipeline/backup-$pipeline_id"

    # Create runtime flag file for hook-based enforcement (agent-prompt-enforcer.sh)
    local runtime_dir
    runtime_dir="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/runtime"
    mkdir -p "$runtime_dir"
    echo "0" > "$runtime_dir/.god-code-active"

    echo "=================================================================="
    echo "God-Code Pipeline ACTIVATED"
    echo "=================================================================="
    echo "Pipeline ID: $pipeline_id"
    echo "Started At:  $timestamp"
    echo ""
    echo "Write/Edit BLOCKED until $MIN_AGENTS_BEFORE_WRITE agents complete."
    echo "Use Task() to spawn pipeline agents sequentially."
    echo ""
    echo "Phase 1 (Understanding):  Agents 1-7   [CURRENT]"
    echo "Phase 2 (Exploration):    Agents 8-12"
    echo "Phase 3 (Architecture):   Agents 13-18"
    echo "Phase 4 (Implementation): Agents 19-31 [WRITES ALLOWED]"
    echo "Phase 5 (Testing):        Agents 32-39"
    echo "Phase 6 (Optimization):   Agents 40-45"
    echo "Phase 7 (Delivery):       Agents 46-47"
    echo "=================================================================="
    return 0
  else
    echo "ERROR: Failed to activate pipeline - memory store failed"
    return 1
  fi
}

# Function: increment_agent_count
# Called after each Task() invocation
# Updates agent count and phase in memory, creates checkpoint
increment_agent_count() {
  local agent_name="${1:-unknown}"
  local state
  local active
  local count
  local new_count
  local phase
  local new_phase
  local timestamp
  local updated_state
  local pipeline_id

  # Retrieve current state
  state=$(retrieve_state)

  if [[ -z "$state" ]]; then
    # No active pipeline, nothing to do
    return 0
  fi

  # Check if pipeline is active
  active=$(echo "$state" | jq -r '.active // false')
  if [[ "$active" != "true" ]]; then
    return 0
  fi

  # Get current values
  count=$(echo "$state" | jq -r '.agentCount // 0')
  pipeline_id=$(echo "$state" | jq -r '.pipelineId // "unknown"')

  # Calculate new values
  new_count=$((count + 1))
  new_phase=$(calculate_phase "$new_count")
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Update state with jq
  updated_state=$(echo "$state" | jq \
    --argjson count "$new_count" \
    --argjson phase "$new_phase" \
    --arg name "$agent_name" \
    --arg ts "$timestamp" \
    '.agentCount = $count |
     .currentPhase = $phase |
     .lastAgentName = $name |
     .lastAgentTimestamp = $ts |
     .compactionSurvivalMarker = $ts |
     .phaseAgentCounts["phase" + ($phase | tostring)] += 1')

  # Store updated state
  if store_state "$updated_state" "$MEMORY_KEY"; then
    local phase_name
    phase_name=$(get_phase_name "$new_phase")

    echo "------------------------------------------------------------------"
    echo "Pipeline Task #$new_count spawned: $agent_name"
    echo "Phase: $new_phase ($phase_name)"

    if [[ "$new_count" -ge "$MIN_AGENTS_BEFORE_WRITE" ]] && [[ "$new_phase" -ge 4 ]]; then
      echo "Status: Writes NOW ALLOWED (Phase 4+ reached)"
    else
      local remaining=$((MIN_AGENTS_BEFORE_WRITE - new_count))
      if [[ "$remaining" -gt 0 ]]; then
        echo "Status: Writes blocked ($remaining more agents until Phase 4)"
      fi
    fi

    # Create checkpoint after each agent (compaction survival)
    create_checkpoint "$agent_name" "$new_phase" "PENDING" 2>/dev/null || true

    echo "------------------------------------------------------------------"
    return 0
  else
    echo "WARNING: Failed to update pipeline state in memory"
    return 1
  fi
}

# Function: check_write_permission
# Called on PreToolUse for Write/Edit/MultiEdit
# Returns 0 (allow) or 1 (block)
check_write_permission() {
  local tool_name="${1:-Write}"
  local file_path="${2:-unknown}"

  # Retrieve state from memory
  local state
  state=$(retrieve_state)

  # If no state found, no active pipeline - allow write
  if [[ -z "$state" ]]; then
    return 0
  fi

  # Check if pipeline is active
  local active
  active=$(echo "$state" | jq -r '.active // false')

  if [[ "$active" != "true" ]]; then
    return 0  # No active pipeline, allow write
  fi

  # Get current state values
  local agent_count
  local min_agents
  local current_phase
  local blocked_count
  local pipeline_id

  agent_count=$(echo "$state" | jq -r '.agentCount // 0')
  min_agents=$(echo "$state" | jq -r '.minAgentsBeforeWrite // 7')
  current_phase=$(echo "$state" | jq -r '.currentPhase // 1')
  blocked_count=$(echo "$state" | jq -r '.writeAttemptsBlocked // 0')
  pipeline_id=$(echo "$state" | jq -r '.pipelineId // "unknown"')

  # FIX: Critical Issue #2 - Changed OR to AND to prevent bypass
  # Writes are ONLY allowed if:
  # 1. We are in Phase 4 or later (Implementation phase), AND
  # 2. We have reached the minimum agent count
  # OR we've reached agent 19+ (Phase 4 starts at agent 19 - definite Phase 4)
  #
  # Previous bug: OR condition allowed writes at agent 7 (Phase 1) because
  # agent_count >= min_agents (7) was true even though phase was still 1
  local PHASE4_START_AGENT=19  # Phase 4 (Implementation) starts at agent 19

  # Fast path: If we've spawned 19+ agents, we're definitely in Phase 4+
  if [[ "$agent_count" -ge "$PHASE4_START_AGENT" ]]; then
    return 0  # Allow write - definitely in Phase 4+
  fi

  # Standard check: Must be in Phase 4+ AND have enough agents
  if [[ "$current_phase" -ge 4 ]] && [[ "$agent_count" -ge "$min_agents" ]]; then
    return 0  # Allow write
  fi

  # BLOCK the write - not enough agents spawned
  local new_blocked_count=$((blocked_count + 1))
  local phase_name
  phase_name=$(get_phase_name "$current_phase")

  # Update blocked count in state
  local updated_state
  updated_state=$(echo "$state" | jq --argjson b "$new_blocked_count" '.writeAttemptsBlocked = $b')
  store_state "$updated_state" "$MEMORY_KEY" 2>/dev/null

  # Output detailed block message
  echo ""
  echo "=================================================================="
  echo "BLOCKED: /god-code Pipeline Violation"
  echo "=================================================================="
  echo ""
  echo "Tool:      $tool_name"
  echo "File:      $file_path"
  echo "Pipeline:  $pipeline_id"
  echo ""
  echo "Current State:"
  echo "  - Phase:        $current_phase ($phase_name)"
  echo "  - Agents:       $agent_count / $min_agents minimum"
  echo "  - Block Count:  $new_blocked_count"
  echo ""
  echo "Why Blocked:"
  echo "  The /god-code pipeline requires Phase 4 (Implementation) before"
  echo "  any Write/Edit operations. You are currently in Phase $current_phase."
  echo ""
  echo "Required Action:"
  echo "  1. Use Task() to spawn pipeline agents sequentially"
  echo "  2. Start with: Task(\"task-analyzer\", ...)"
  echo "  3. Complete Phases 1-3 ($((min_agents - agent_count)) more agents)"
  echo "  4. Only Phase 4+ agents (implementation) should write files"
  echo ""
  echo "Phase Overview:"
  echo "  Phase 1 (Understanding):  Agents 1-7   $([ $current_phase -eq 1 ] && echo '[CURRENT]')"
  echo "  Phase 2 (Exploration):    Agents 8-12  $([ $current_phase -eq 2 ] && echo '[CURRENT]')"
  echo "  Phase 3 (Architecture):   Agents 13-18 $([ $current_phase -eq 3 ] && echo '[CURRENT]')"
  echo "  Phase 4 (Implementation): Agents 19-31 [WRITES ALLOWED HERE]"
  echo ""
  echo "To force-deactivate (not recommended):"
  echo "  # REMOVED: npx claude-flow@alpha memory store -k \"$MEMORY_KEY\" -v '{\"active\":false}' --namespace \"$MEMORY_NAMESPACE\""
  echo ""
  echo "=================================================================="

  return 1  # Block the write
}

# Function: check_pipeline_status
# Returns current pipeline status for debugging
check_pipeline_status() {
  local state
  state=$(retrieve_state)

  if [[ -z "$state" ]]; then
    echo "No active pipeline found."
    return 0
  fi

  local active
  active=$(echo "$state" | jq -r '.active // false')

  if [[ "$active" != "true" ]]; then
    echo "Pipeline exists but is not active."
    return 0
  fi

  local pipeline_id
  local agent_count
  local current_phase
  local started_at
  local blocked_count
  local last_agent

  pipeline_id=$(echo "$state" | jq -r '.pipelineId // "unknown"')
  agent_count=$(echo "$state" | jq -r '.agentCount // 0')
  current_phase=$(echo "$state" | jq -r '.currentPhase // 1')
  started_at=$(echo "$state" | jq -r '.startedAt // "unknown"')
  blocked_count=$(echo "$state" | jq -r '.writeAttemptsBlocked // 0')
  last_agent=$(echo "$state" | jq -r '.lastAgentName // "none"')

  local phase_name
  phase_name=$(get_phase_name "$current_phase")

  echo "=================================================================="
  echo "God-Code Pipeline Status"
  echo "=================================================================="
  echo "Pipeline ID:     $pipeline_id"
  echo "Started:         $started_at"
  echo "Agent Count:     $agent_count / $TOTAL_PIPELINE_AGENTS"
  echo "Current Phase:   $current_phase ($phase_name)"
  echo "Last Agent:      $last_agent"
  echo "Writes Blocked:  $blocked_count times"
  echo ""

  if [[ "$current_phase" -ge 4 ]]; then
    echo "Status: Writes ALLOWED (Phase 4+ reached)"
  else
    echo "Status: Writes BLOCKED (Phase 1-3)"
  fi
  echo "=================================================================="
}

# Function: deactivate_pipeline
# Called when pipeline completes or needs manual deactivation
deactivate_pipeline() {
  local reason="${1:-manual}"
  local state
  state=$(retrieve_state)

  if [[ -z "$state" ]]; then
    echo "No active pipeline to deactivate."
    return 0
  fi

  local pipeline_id
  local agent_count
  local started_at
  local blocked_count

  pipeline_id=$(echo "$state" | jq -r '.pipelineId // "unknown"')
  agent_count=$(echo "$state" | jq -r '.agentCount // 0')
  started_at=$(echo "$state" | jq -r '.startedAt // "unknown"')
  blocked_count=$(echo "$state" | jq -r '.writeAttemptsBlocked // 0')

  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Add completion info to state
  local final_state
  final_state=$(echo "$state" | jq \
    --arg reason "$reason" \
    --arg ts "$timestamp" \
    '.active = false | .completedAt = $ts | .completionReason = $reason')

  # Archive the completed/incomplete pipeline
  local archive_key
  if [[ "$agent_count" -ge "$TOTAL_PIPELINE_AGENTS" ]]; then
    archive_key="enforcement/pipeline/completed-$pipeline_id"
    store_state "$final_state" "$archive_key"

    echo "=================================================================="
    echo "God-Code Pipeline COMPLETED"
    echo "=================================================================="
    echo "Pipeline ID:    $pipeline_id"
    echo "Total Agents:   $agent_count"
    echo "Started:        $started_at"
    echo "Completed:      $timestamp"
    echo "Writes Blocked: $blocked_count times"
    echo "=================================================================="
  else
    archive_key="enforcement/pipeline/incomplete-$pipeline_id"
    store_state "$final_state" "$archive_key"

    echo "=================================================================="
    echo "God-Code Pipeline DEACTIVATED (Incomplete)"
    echo "=================================================================="
    echo "Pipeline ID:    $pipeline_id"
    echo "Agents:         $agent_count / $TOTAL_PIPELINE_AGENTS"
    echo "Reason:         $reason"
    echo "Writes Blocked: $blocked_count times"
    echo ""
    echo "WARNING: Pipeline incomplete. Consider resuming or starting fresh."
    echo "=================================================================="
  fi

  # Clear active state (use -v not --value)
  mkdir -p .god-agent/pipeline-memory && echo '{"active":false}' > .god-agent/pipeline-memory/$MEMORY_KEY.json 2>/dev/null || true

  # Clean up backup
  # REMOVED: npx claude-flow@alpha memory delete -k "enforcement/pipeline/backup-$pipeline_id" --namespace "$MEMORY_NAMESPACE" 2>/dev/null

  return 0
}

# Function: recover_from_compaction
# Attempts to recover pipeline state after context compaction
recover_from_compaction() {
  local state
  state=$(retrieve_state)

  # If state exists and is active, check compaction marker
  if [[ -n "$state" ]]; then
    local active
    active=$(echo "$state" | jq -r '.active // false')

    if [[ "$active" == "true" ]]; then
      echo "Pipeline state found and active - no recovery needed."
      return 0
    fi
  fi

  # Try to find backup states
  echo "Searching for backup pipeline states..."

  # List all backup keys (this is a simplified approach)
  # In practice, you'd need to search memory for backup-* keys
  local backup_found=false

  # Check for recent backups by trying common patterns
  for i in $(seq 1 5); do
    # Try to find any backup (simplified - would need memory search in production)
    :
  done

  if [[ "$backup_found" == "false" ]]; then
    echo "No backup pipeline state found."
    echo "If a pipeline was active, it may need to be restarted."
    return 1
  fi
}

# =============================================================================
# Checkpoint/Resume Functions (Compaction Survival)
# =============================================================================

# Configuration for checkpoint
CHECKPOINT_DIR=".god-agent"
CHECKPOINT_FILE="$CHECKPOINT_DIR/pipeline-checkpoint.json"
CHECKPOINT_MEMORY_KEY="enforcement/checkpoint/current"

# List of all 47 agents in order
PIPELINE_AGENTS=(
  # Phase 1: Understanding (7 agents)
  "task-analyzer"
  "requirement-extractor"
  "requirement-prioritizer"
  "scope-definer"
  "context-gatherer"
  "feasibility-analyzer"
  "phase-1-reviewer"
  # Phase 2: Exploration (5 agents)
  "pattern-explorer"
  "technology-scout"
  "research-planner"
  "codebase-analyzer"
  "phase-2-reviewer"
  # Phase 3: Architecture (6 agents)
  "system-designer"
  "component-designer"
  "interface-designer"
  "data-architect"
  "integration-architect"
  "phase-3-reviewer"
  # Phase 4: Implementation (13 agents)
  "code-generator"
  "type-implementer"
  "unit-implementer"
  "service-implementer"
  "data-layer-implementer"
  "api-implementer"
  "frontend-implementer"
  "error-handler-implementer"
  "config-implementer"
  "logger-implementer"
  "dependency-manager"
  "implementation-coordinator"
  "phase-4-reviewer"
  # Phase 5: Testing (8 agents)
  "test-generator"
  "test-runner"
  "integration-tester"
  "regression-tester"
  "security-tester"
  "coverage-analyzer"
  "quality-gate"
  "phase-5-reviewer"
  # Phase 6: Optimization (6 agents)
  "performance-optimizer"
  "performance-architect"
  "code-quality-improver"
  "security-architect"
  "final-refactorer"
  "phase-6-reviewer"
  # Phase 7: Delivery (2 agents)
  "sign-off-approver"
  "recovery-agent"
)

# Ensure checkpoint directory exists
ensure_checkpoint_dir() {
  if [[ ! -d "$CHECKPOINT_DIR" ]]; then
    mkdir -p "$CHECKPOINT_DIR"
  fi
}

# Create or update checkpoint after agent completion
# Usage: create_checkpoint <agent_name> <phase> [verdict]
# FIX: Critical Issue #3 - Validate pipeline ID to prevent checkpoint contamination
create_checkpoint() {
  local agent_name="${1:-unknown}"
  local phase="${2:-1}"
  local verdict="${3:-PENDING}"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  ensure_checkpoint_dir

  # Get current state from memory
  local state
  state=$(retrieve_state)

  # FIX: Critical Issue #3 - Check for stale checkpoint from different pipeline
  # This prevents agent count overflow (48/47) when a new pipeline starts
  # but old checkpoint data persists from a previous pipeline
  if [[ -n "$state" ]]; then
    local current_pipeline_id
    current_pipeline_id=$(echo "$state" | jq -r '.pipelineId // "none"')

    if [[ -f "$CHECKPOINT_FILE" ]]; then
      local checkpoint_pipeline_id
      checkpoint_pipeline_id=$(jq -r '.pipelineId // "none"' "$CHECKPOINT_FILE" 2>/dev/null)

      if [[ "$checkpoint_pipeline_id" != "$current_pipeline_id" && "$checkpoint_pipeline_id" != "none" && -n "$checkpoint_pipeline_id" ]]; then
        echo "[CHECKPOINT] Pipeline ID mismatch detected - clearing stale checkpoint"
        echo "[CHECKPOINT] Stale Pipeline: $checkpoint_pipeline_id"
        echo "[CHECKPOINT] Current Pipeline: $current_pipeline_id"

        # Archive the old checkpoint before clearing (for debugging)
        local archive_name="${CHECKPOINT_DIR}/checkpoint-archive-${checkpoint_pipeline_id}-$(date +%s).json"
        mv "$CHECKPOINT_FILE" "$archive_name" 2>/dev/null || rm -f "$CHECKPOINT_FILE"

        echo "[CHECKPOINT] Old checkpoint archived to: $archive_name"
      fi
    fi
  fi

  if [[ -z "$state" ]]; then
    echo "WARNING: No active pipeline state to checkpoint"
    return 1
  fi

  # Extract pipeline info
  local pipeline_id
  local agent_count
  local task_file
  local target_dir
  local started_at

  pipeline_id=$(echo "$state" | jq -r '.pipelineId // "unknown"')
  agent_count=$(echo "$state" | jq -r '.agentCount // 0')
  started_at=$(echo "$state" | jq -r '.startedAt // "'$timestamp'"')

  # Try to get task file and target dir from pipeline status
  local pipeline_status
  pipeline_status=$(cat .god-agent/pipeline-memory/coding/pipeline/status.json 2>/dev/null | grep -A 1000 "^| Value:" | tail -n +2 | grep -v "^+" | sed 's/^| //' | sed 's/ *|$//' | tr -d '\n' | grep -o '{.*}' | head -1)

  if [[ -n "$pipeline_status" ]]; then
    task_file=$(echo "$pipeline_status" | jq -r '.taskFile // ""')
    target_dir=$(echo "$pipeline_status" | jq -r '.targetDir // ""')
  fi

  # Build completed and pending agent lists
  local completed_agents=()
  local pending_agents=()
  local found_current=false

  for agent in "${PIPELINE_AGENTS[@]}"; do
    if [[ "$found_current" == "true" ]]; then
      pending_agents+=("$agent")
    elif [[ "$agent" == "$agent_name" ]]; then
      completed_agents+=("$agent")
      found_current=true
    else
      completed_agents+=("$agent")
    fi
  done

  # If agent wasn't found in list, just add it to completed
  if [[ "$found_current" == "false" ]]; then
    completed_agents+=("$agent_name")
  fi

  # Build phase verdicts
  local phase_verdicts
  phase_verdicts=$(cat <<EOF
{
  "phase1": "$([ "$phase" -gt 1 ] && echo "INNOCENT" || echo "$verdict")",
  "phase2": "$([ "$phase" -gt 2 ] && echo "INNOCENT" || ([ "$phase" -eq 2 ] && echo "$verdict" || echo "PENDING"))",
  "phase3": "$([ "$phase" -gt 3 ] && echo "INNOCENT" || ([ "$phase" -eq 3 ] && echo "$verdict" || echo "PENDING"))",
  "phase4": "$([ "$phase" -gt 4 ] && echo "INNOCENT" || ([ "$phase" -eq 4 ] && echo "$verdict" || echo "PENDING"))",
  "phase5": "$([ "$phase" -gt 5 ] && echo "INNOCENT" || ([ "$phase" -eq 5 ] && echo "$verdict" || echo "PENDING"))",
  "phase6": "$([ "$phase" -gt 6 ] && echo "INNOCENT" || ([ "$phase" -eq 6 ] && echo "$verdict" || echo "PENDING"))",
  "phase7": "$([ "$phase" -eq 7 ] && echo "$verdict" || echo "PENDING")"
}
EOF
)

  # Collect memory keys that have been stored
  local memory_keys=()
  # Check for common memory keys based on phase
  if [[ "$phase" -ge 1 ]]; then
    memory_keys+=("coding/understanding/task-analysis" "coding/understanding/requirements" "coding/understanding/scope" "coding/understanding/context" "coding/understanding/feasibility")
  fi
  if [[ "$phase" -ge 2 ]]; then
    memory_keys+=("coding/exploration/patterns" "coding/exploration/technologies" "coding/exploration/codebase-analysis")
  fi
  if [[ "$phase" -ge 3 ]]; then
    memory_keys+=("coding/architecture/design" "coding/architecture/components" "coding/architecture/interfaces")
  fi
  if [[ "$phase" -ge 4 ]]; then
    memory_keys+=("coding/implementation/generated-code" "coding/implementation/types" "coding/implementation/services")
  fi
  if [[ "$phase" -ge 5 ]]; then
    memory_keys+=("coding/testing/test-results" "coding/testing/verified-results" "coding/testing/quality-gate-result")
  fi
  if [[ "$phase" -ge 6 ]]; then
    memory_keys+=("coding/optimization/performance" "coding/optimization/quality")
  fi

  # Convert arrays to JSON
  local completed_json
  local pending_json
  local memory_keys_json
  completed_json=$(printf '%s\n' "${completed_agents[@]}" | jq -R . | jq -s .)
  pending_json=$(printf '%s\n' "${pending_agents[@]}" | jq -R . | jq -s .)
  memory_keys_json=$(printf '%s\n' "${memory_keys[@]}" | jq -R . | jq -s .)

  # Build checkpoint JSON
  local checkpoint_json
  checkpoint_json=$(cat <<EOF
{
  "version": "1.0.0",
  "pipelineId": "$pipeline_id",
  "taskFile": "$task_file",
  "targetDir": "$target_dir",
  "startedAt": "$started_at",
  "lastCheckpoint": "$timestamp",
  "status": "running",
  "currentPhase": $phase,
  "currentAgent": $agent_count,
  "lastAgentName": "$agent_name",
  "completedAgents": $completed_json,
  "pendingAgents": $pending_json,
  "phaseVerdicts": $phase_verdicts,
  "memoryKeys": $memory_keys_json,
  "batchMode": {
    "enabled": false,
    "taskList": [],
    "currentIndex": 0,
    "completedTasks": []
  }
}
EOF
)

  # Write checkpoint file
  echo "$checkpoint_json" > "$CHECKPOINT_FILE"

  # Backup to ClaudeFlow memory
  store_state "$checkpoint_json" "$CHECKPOINT_MEMORY_KEY"

  echo "------------------------------------------------------------------"
  echo "Checkpoint created for agent: $agent_name (Phase $phase)"
  echo "Checkpoint file: $CHECKPOINT_FILE"
  echo "Total completed: ${#completed_agents[@]} / 47 agents"
  echo "------------------------------------------------------------------"

  return 0
}

# Resume from checkpoint after context compaction
# Returns resume instructions for the orchestrator
resume_from_checkpoint() {
  local checkpoint_file="$CHECKPOINT_FILE"
  local checkpoint_data=""

  # Try to read from file first
  if [[ -f "$checkpoint_file" ]]; then
    checkpoint_data=$(cat "$checkpoint_file")
    echo "Found checkpoint file: $checkpoint_file"
  fi

  # If file doesn't exist or is empty, try memory backup
  if [[ -z "$checkpoint_data" ]] || ! echo "$checkpoint_data" | jq -e . &>/dev/null; then
    echo "Checkpoint file not found or invalid, checking ClaudeFlow memory backup..."

    local memory_backup
    memory_backup=$(cat .god-agent/pipeline-memory/$CHECKPOINT_MEMORY_KEY.json 2>/dev/null | grep -A 1000 "^| Value:" | tail -n +2 | grep -v "^+" | sed 's/^| //' | sed 's/ *|$//' | tr -d '\n' | grep -o '{.*}' | head -1)

    if [[ -n "$memory_backup" ]] && echo "$memory_backup" | jq -e . &>/dev/null; then
      checkpoint_data="$memory_backup"
      echo "Restored checkpoint from ClaudeFlow memory backup"

      # Restore the file from memory
      ensure_checkpoint_dir
      echo "$checkpoint_data" > "$checkpoint_file"
    else
      echo "No valid checkpoint found in file or memory."
      echo ""
      echo "To start a fresh pipeline, invoke /god-code with your task."
      return 1
    fi
  fi

  # Parse checkpoint data
  local status
  local pipeline_id
  local current_phase
  local current_agent
  local last_agent
  local task_file
  local target_dir
  local pending_count
  local completed_count
  local last_checkpoint

  status=$(echo "$checkpoint_data" | jq -r '.status // "unknown"')
  pipeline_id=$(echo "$checkpoint_data" | jq -r '.pipelineId // "unknown"')
  current_phase=$(echo "$checkpoint_data" | jq -r '.currentPhase // 1')
  current_agent=$(echo "$checkpoint_data" | jq -r '.currentAgent // 0')
  last_agent=$(echo "$checkpoint_data" | jq -r '.lastAgentName // "unknown"')
  task_file=$(echo "$checkpoint_data" | jq -r '.taskFile // ""')
  target_dir=$(echo "$checkpoint_data" | jq -r '.targetDir // ""')
  pending_count=$(echo "$checkpoint_data" | jq '.pendingAgents | length')
  completed_count=$(echo "$checkpoint_data" | jq '.completedAgents | length')
  last_checkpoint=$(echo "$checkpoint_data" | jq -r '.lastCheckpoint // "unknown"')

  # Get next agent to run
  local next_agent
  next_agent=$(echo "$checkpoint_data" | jq -r '.pendingAgents[0] // "recovery-agent"')

  local phase_name
  phase_name=$(get_phase_name "$current_phase")

  echo ""
  echo "=================================================================="
  echo "PIPELINE CHECKPOINT DETECTED"
  echo "=================================================================="
  echo ""
  echo "Pipeline ID:      $pipeline_id"
  echo "Status:           $status"
  echo "Last Checkpoint:  $last_checkpoint"
  echo ""
  echo "Progress:"
  echo "  Current Phase:  $current_phase ($phase_name)"
  echo "  Last Agent:     $last_agent"
  echo "  Completed:      $completed_count / 47 agents"
  echo "  Remaining:      $pending_count agents"
  echo ""

  if [[ -n "$task_file" ]]; then
    echo "Task File:        $task_file"
  fi
  if [[ -n "$target_dir" ]]; then
    echo "Target Dir:       $target_dir"
  fi

  echo ""
  echo "Phase Verdicts:"
  echo "$checkpoint_data" | jq -r '.phaseVerdicts | to_entries[] | "  \(.key): \(.value)"'
  echo ""
  echo "------------------------------------------------------------------"
  echo "RESUME INSTRUCTIONS"
  echo "------------------------------------------------------------------"
  echo ""
  echo "To resume the pipeline, spawn the next agent:"
  echo ""
  echo "  Next Agent: $next_agent"
  echo "  Phase: $current_phase ($phase_name)"
  echo ""
  echo "The orchestrator should:"
  echo "1. Retrieve stored memories from keys listed in checkpoint"
  echo "2. Spawn Task(\"$next_agent\", ...) with appropriate context"
  echo "3. Continue through remaining $pending_count agents"
  echo ""
  echo "Memory keys to retrieve before resuming:"
  echo "$checkpoint_data" | jq -r '.memoryKeys[]' | head -10
  echo ""
  echo "To start fresh instead, run: deactivate_pipeline && activate_pipeline"
  echo "=================================================================="

  return 0
}

# Verify checkpoint integrity
verify_checkpoint() {
  local checkpoint_file="$CHECKPOINT_FILE"
  local errors=0
  local warnings=0

  echo "=================================================================="
  echo "Checkpoint Integrity Verification"
  echo "=================================================================="
  echo ""

  # Check 1: Checkpoint file exists
  if [[ ! -f "$checkpoint_file" ]]; then
    echo "[ERROR] Checkpoint file not found: $checkpoint_file"
    errors=$((errors + 1))
  else
    echo "[OK] Checkpoint file exists"

    # Check 2: Valid JSON
    if ! jq -e . "$checkpoint_file" &>/dev/null; then
      echo "[ERROR] Checkpoint file is not valid JSON"
      errors=$((errors + 1))
    else
      echo "[OK] Checkpoint file is valid JSON"

      # Check 3: Required fields
      local required_fields=("version" "pipelineId" "status" "currentPhase" "currentAgent")
      for field in "${required_fields[@]}"; do
        if [[ $(jq -r ".$field // empty" "$checkpoint_file") == "" ]]; then
          echo "[ERROR] Missing required field: $field"
          errors=$((errors + 1))
        fi
      done
      echo "[OK] All required fields present"
    fi
  fi

  # Check 4: Memory backup exists
  local memory_backup
  memory_backup=$(cat .god-agent/pipeline-memory/$CHECKPOINT_MEMORY_KEY.json 2>/dev/null || [[ "$memory_backup" == *"not found"* ]]; then
    echo "[WARNING] No memory backup found"
    warnings=$((warnings + 1))
  else
    echo "[OK] Memory backup exists"
  fi

  # Check 5: Cross-reference with active pipeline state
  local active_state
  active_state=$(retrieve_state)

  if [[ -n "$active_state" ]]; then
    local active_id
    local checkpoint_id
    active_id=$(echo "$active_state" | jq -r '.pipelineId // ""')
    checkpoint_id=$(jq -r '.pipelineId // ""' "$checkpoint_file" 2>/dev/null)

    if [[ "$active_id" != "$checkpoint_id" ]]; then
      echo "[WARNING] Checkpoint pipeline ID ($checkpoint_id) differs from active pipeline ($active_id)"
      warnings=$((warnings + 1))
    else
      echo "[OK] Checkpoint matches active pipeline"
    fi
  fi

  echo ""
  echo "------------------------------------------------------------------"
  echo "Verification Results: $errors errors, $warnings warnings"
  echo "------------------------------------------------------------------"

  if [[ "$errors" -gt 0 ]]; then
    return 1
  fi
  return 0
}

# Mark checkpoint as completed
complete_checkpoint() {
  local final_verdict="${1:-INNOCENT}"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [[ ! -f "$CHECKPOINT_FILE" ]]; then
    echo "No checkpoint file to complete"
    return 1
  fi

  # Update checkpoint with completion status
  local updated
  updated=$(jq \
    --arg status "completed" \
    --arg ts "$timestamp" \
    --arg verdict "$final_verdict" \
    '.status = $status | .completedAt = $ts | .finalVerdict = $verdict | .pendingAgents = []' \
    "$CHECKPOINT_FILE")

  echo "$updated" > "$CHECKPOINT_FILE"

  # Update memory backup
  store_state "$updated" "$CHECKPOINT_MEMORY_KEY"

  # Archive the checkpoint
  local pipeline_id
  pipeline_id=$(jq -r '.pipelineId // "unknown"' "$CHECKPOINT_FILE")
  store_state "$updated" "enforcement/checkpoint/completed-$pipeline_id"

  echo "Checkpoint marked as completed: $pipeline_id"
  return 0
}

# Clear checkpoint (for starting fresh)
clear_checkpoint() {
  if [[ -f "$CHECKPOINT_FILE" ]]; then
    rm -f "$CHECKPOINT_FILE"
    echo "Checkpoint file removed"
  fi

  # Clear memory backup
  # REMOVED: npx claude-flow@alpha memory delete -k "$CHECKPOINT_MEMORY_KEY" --namespace "$MEMORY_NAMESPACE" 2>/dev/null
  echo "Memory backup cleared"

  return 0
}

# =============================================================================
# Export functions for use by hooks
# =============================================================================
export -f generate_pipeline_id
export -f calculate_phase
export -f get_phase_name
export -f retrieve_state
export -f store_state
export -f activate_pipeline
export -f increment_agent_count
export -f check_write_permission
export -f check_pipeline_status
export -f deactivate_pipeline
export -f recover_from_compaction
export -f ensure_checkpoint_dir
export -f create_checkpoint
export -f resume_from_checkpoint
export -f verify_checkpoint
export -f complete_checkpoint
export -f clear_checkpoint

# =============================================================================
# CLI Interface (when script is run directly)
# =============================================================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    activate)
      activate_pipeline
      ;;
    increment)
      increment_agent_count "${2:-unknown}"
      ;;
    check)
      check_write_permission "${2:-Write}" "${3:-unknown}"
      ;;
    status)
      check_pipeline_status
      ;;
    deactivate)
      deactivate_pipeline "${2:-manual}"
      ;;
    recover)
      recover_from_compaction
      ;;
    checkpoint)
      create_checkpoint "${2:-unknown}" "${3:-1}" "${4:-PENDING}"
      ;;
    resume)
      resume_from_checkpoint
      ;;
    verify-checkpoint)
      verify_checkpoint
      ;;
    complete-checkpoint)
      complete_checkpoint "${2:-INNOCENT}"
      ;;
    clear-checkpoint)
      clear_checkpoint
      ;;
    *)
      echo "God-Code Enforcement Hook v2"
      echo ""
      echo "Usage: $0 <command> [args]"
      echo ""
      echo "Pipeline Commands:"
      echo "  activate              Activate the pipeline (on /god-code invocation)"
      echo "  increment <agent>     Increment agent count (after Task())"
      echo "  check <tool> <file>   Check write permission (before Write/Edit)"
      echo "  status                Show current pipeline status"
      echo "  deactivate [reason]   Deactivate the pipeline"
      echo "  recover               Attempt recovery after compaction"
      echo ""
      echo "Checkpoint Commands (Compaction Survival):"
      echo "  checkpoint <agent> <phase> [verdict]  Create checkpoint after agent"
      echo "  resume                                Resume from checkpoint"
      echo "  verify-checkpoint                     Verify checkpoint integrity"
      echo "  complete-checkpoint [verdict]         Mark checkpoint as completed"
      echo "  clear-checkpoint                      Clear checkpoint (start fresh)"
      echo ""
      echo "Memory Key: $MEMORY_KEY"
      echo "Namespace:  $MEMORY_NAMESPACE"
      echo "Checkpoint: $CHECKPOINT_FILE"
      ;;
  esac
fi
