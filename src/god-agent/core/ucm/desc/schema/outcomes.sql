-- IDESC-001: Intelligent DESC v2 - Outcome Tracking Schema
-- TASK-IDESC-INFRA-001: Create Outcome Database Schema
-- Implements: REQ-IDESC-001, REQ-IDESC-002
-- Constitution: GUARD-IDESC-001 (append-only)

-- ============================================================================
-- Episode Outcomes Table
-- ============================================================================
-- Records success/failure outcomes for each episode injection.
-- APPEND-ONLY: No UPDATE or DELETE operations allowed (GUARD-IDESC-001)

CREATE TABLE IF NOT EXISTS episode_outcomes (
  outcome_id TEXT PRIMARY KEY,              -- UUID
  episode_id TEXT NOT NULL,                 -- FK to episodes table
  task_id TEXT NOT NULL,                    -- Task/session ID that used this episode
  success INTEGER NOT NULL CHECK (success IN (0, 1)),  -- 1=success, 0=failure
  error_type TEXT CHECK (
    error_type IS NULL OR error_type IN (
      'syntax_error',
      'logic_error',
      'not_applicable',
      'stale_solution',
      'incomplete',
      'security_issue'
    )
  ),
  details TEXT,                             -- JSON with additional context
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE RESTRICT
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_episode_outcomes_episode_id
  ON episode_outcomes(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_outcomes_task_id
  ON episode_outcomes(task_id);
CREATE INDEX IF NOT EXISTS idx_episode_outcomes_recorded_at
  ON episode_outcomes(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_episode_outcomes_success
  ON episode_outcomes(episode_id, success);

-- ============================================================================
-- Episode Statistics Table (Denormalized)
-- ============================================================================
-- Pre-computed statistics for O(1) lookups (NFR-IDESC-002: <50ms shouldInject)

CREATE TABLE IF NOT EXISTS episode_stats (
  episode_id TEXT PRIMARY KEY,              -- FK to episodes table
  outcome_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_outcome_at TEXT,

  -- Computed success rate (NULL if outcome_count < 3 per REQ-IDESC-002)
  success_rate REAL GENERATED ALWAYS AS (
    CASE
      WHEN outcome_count >= 3 THEN CAST(success_count AS REAL) / outcome_count
      ELSE NULL
    END
  ) STORED,

  FOREIGN KEY (episode_id) REFERENCES episodes(episode_id) ON DELETE CASCADE
);

-- Index for statistics lookups
CREATE INDEX IF NOT EXISTS idx_episode_stats_success_rate
  ON episode_stats(success_rate) WHERE success_rate IS NOT NULL;

-- ============================================================================
-- Trigger: Enforce Append-Only for Outcomes (GUARD-IDESC-001)
-- ============================================================================
-- Block UPDATE and DELETE operations on episode_outcomes

CREATE TRIGGER IF NOT EXISTS enforce_append_only_outcomes_update
BEFORE UPDATE ON episode_outcomes
BEGIN
  SELECT RAISE(ABORT, 'GUARD-IDESC-001: episode_outcomes is append-only, UPDATE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS enforce_append_only_outcomes_delete
BEFORE DELETE ON episode_outcomes
BEGIN
  SELECT RAISE(ABORT, 'GUARD-IDESC-001: episode_outcomes is append-only, DELETE not allowed');
END;

-- ============================================================================
-- Trigger: Auto-Update Episode Statistics
-- ============================================================================
-- Automatically maintain denormalized stats on INSERT

CREATE TRIGGER IF NOT EXISTS update_episode_stats_on_outcome
AFTER INSERT ON episode_outcomes
BEGIN
  INSERT INTO episode_stats (
    episode_id,
    outcome_count,
    success_count,
    failure_count,
    last_outcome_at
  )
  VALUES (
    NEW.episode_id,
    1,
    NEW.success,
    1 - NEW.success,
    NEW.recorded_at
  )
  ON CONFLICT (episode_id) DO UPDATE SET
    outcome_count = outcome_count + 1,
    success_count = success_count + NEW.success,
    failure_count = failure_count + (1 - NEW.success),
    last_outcome_at = NEW.recorded_at;
END;

-- ============================================================================
-- Threshold History Table (GUARD-IDESC-006)
-- ============================================================================
-- Audit log for all threshold adjustments

CREATE TABLE IF NOT EXISTS threshold_history (
  change_id TEXT PRIMARY KEY,               -- UUID
  category TEXT NOT NULL CHECK (
    category IN ('coding', 'research', 'general')
  ),
  old_value REAL NOT NULL,
  new_value REAL NOT NULL,
  change_reason TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by TEXT                           -- Source: 'active_learning', 'manual', etc.
);

-- Enforce bounded threshold changes (GUARD-IDESC-003: +/-5% per 30 days)
-- Note: This validation is enforced in application code
CREATE INDEX IF NOT EXISTS idx_threshold_history_category_time
  ON threshold_history(category, changed_at DESC);
