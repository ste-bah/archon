-- ============================================================
-- OUTCOMES AND FEEDBACK TABLES - SPEC-FUNC-LEARNING
-- ============================================================
-- Implements: REQ-DESC-005, GAP-DESC-005
-- Constitution: RULE-014, RULE-018, RULE-020, RULE-021, RULE-023
-- ============================================================

-- Episode outcomes table - results linked to episodes
CREATE TABLE IF NOT EXISTS episode_outcomes (
    -- Identity
    id TEXT PRIMARY KEY NOT NULL,
    episode_id TEXT NOT NULL,

    -- Outcome data (validated enum)
    outcome TEXT NOT NULL
        CHECK (outcome IN ('positive', 'negative', 'neutral')),
    quality_score REAL NOT NULL
        CHECK (quality_score >= 0.0 AND quality_score <= 1.0),

    -- Context
    trajectory_id TEXT,
    feedback_text TEXT,

    -- Timestamps (RULE-020)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1,

    -- Foreign key with RESTRICT (RULE-021)
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE RESTRICT
);

-- Indexes (RULE-023)
CREATE INDEX IF NOT EXISTS idx_outcomes_episode ON episode_outcomes(episode_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_quality ON episode_outcomes(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_trajectory ON episode_outcomes(trajectory_id);

-- ============================================================
-- APPEND-ONLY TRIGGERS FOR OUTCOMES (RULE-018)
-- ============================================================

CREATE TRIGGER IF NOT EXISTS outcomes_no_update
BEFORE UPDATE ON episode_outcomes
BEGIN
    SELECT RAISE(ABORT, 'Outcomes are append-only (RULE-018). Updates are forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS outcomes_no_delete
BEFORE DELETE ON episode_outcomes
BEGIN
    SELECT RAISE(ABORT, 'Outcomes are append-only (RULE-018). Deletes are forbidden.');
END;

-- ============================================================
-- LEARNING FEEDBACK TABLE
-- (Replaces events.db learning_feedback that was never read)
-- ============================================================

CREATE TABLE IF NOT EXISTS learning_feedback (
    -- Identity
    id TEXT PRIMARY KEY NOT NULL,

    -- References
    trajectory_id TEXT NOT NULL,
    episode_id TEXT,
    pattern_id TEXT,

    -- Feedback data (RULE-088 validated)
    quality REAL NOT NULL
        CHECK (quality >= 0.0 AND quality <= 1.0),
    outcome TEXT NOT NULL
        CHECK (outcome IN ('positive', 'negative', 'neutral')),

    -- Context
    task_type TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    result_length INTEGER,
    has_code_blocks INTEGER NOT NULL DEFAULT 0,

    -- RLM (Relay Race Memory) context for learning
    -- Tracks context injection success and source agent metadata
    rlm_injection_success INTEGER,
    rlm_source_agent TEXT,
    rlm_source_step_index INTEGER,
    rlm_source_domain TEXT,

    -- Timestamps (RULE-020)
    created_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,

    -- Processing status for batch learning
    processed INTEGER NOT NULL DEFAULT 0
);

-- Indexes (RULE-023)
CREATE INDEX IF NOT EXISTS idx_feedback_trajectory ON learning_feedback(trajectory_id);
CREATE INDEX IF NOT EXISTS idx_feedback_quality ON learning_feedback(quality DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_processed ON learning_feedback(processed);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON learning_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_rlm_success
  ON learning_feedback(rlm_injection_success, quality DESC);

-- ============================================================
-- TRAJECTORY METADATA TABLE
-- (Binary data stored in .agentdb/sona/trajectories/)
-- ============================================================

CREATE TABLE IF NOT EXISTS trajectory_metadata (
    -- Identity
    id TEXT PRIMARY KEY NOT NULL,

    -- File reference for binary data
    file_path TEXT NOT NULL,
    file_offset INTEGER NOT NULL,
    file_length INTEGER NOT NULL,

    -- Metadata
    route TEXT NOT NULL,
    step_count INTEGER NOT NULL,
    quality_score REAL
        CHECK (quality_score IS NULL OR (quality_score >= 0.0 AND quality_score <= 1.0)),

    -- Timestamps (RULE-020)
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1,

    -- Status
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'failed', 'abandoned'))
);

-- Indexes (RULE-023)
CREATE INDEX IF NOT EXISTS idx_trajectory_status ON trajectory_metadata(status);
CREATE INDEX IF NOT EXISTS idx_trajectory_route ON trajectory_metadata(route);
CREATE INDEX IF NOT EXISTS idx_trajectory_created ON trajectory_metadata(created_at DESC);

-- ============================================================
-- APPEND-ONLY TRIGGERS FOR TRAJECTORY_METADATA (RULE-016, RULE-017)
-- Only status and quality_score updates allowed
-- ============================================================

CREATE TRIGGER IF NOT EXISTS trajectory_metadata_no_delete
BEFORE DELETE ON trajectory_metadata
BEGIN
    SELECT RAISE(ABORT, 'Trajectory metadata is append-only (RULE-016). DELETE forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trajectory_metadata_limited_update
BEFORE UPDATE ON trajectory_metadata
WHEN OLD.id != NEW.id
   OR OLD.file_path != NEW.file_path
   OR OLD.file_offset != NEW.file_offset
   OR OLD.file_length != NEW.file_length
   OR OLD.route != NEW.route
   OR OLD.step_count != NEW.step_count
   OR OLD.created_at != NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'Trajectory metadata: only status, quality_score, completed_at updates allowed (RULE-016).');
END;

-- ============================================================
-- SCHEMA VERSION TABLE (for migrations)
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);

-- Record initial schema version
INSERT OR IGNORE INTO schema_version (version, description)
VALUES (1, 'Initial schema - FUCKUP-001 remediation Phase 1');
