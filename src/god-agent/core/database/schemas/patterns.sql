-- ============================================================
-- PATTERNS TABLE - SPEC-FUNC-PATTERNS, CONST-FUCKUP-001
-- ============================================================
-- Implements: REQ-PAT-001, GAP-PATTERN-001
-- Constitution: RULE-013, RULE-019, RULE-020, RULE-023
-- ============================================================

-- Patterns table - learned associations between context and actions
CREATE TABLE IF NOT EXISTS patterns (
    -- Identity
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,

    -- Content
    context TEXT NOT NULL,
    action TEXT NOT NULL,
    outcome TEXT,
    embedding BLOB NOT NULL,

    -- Learning metrics
    weight REAL NOT NULL DEFAULT 0.5
        CHECK (weight >= 0.0 AND weight <= 1.0),
    success_count INTEGER NOT NULL DEFAULT 0
        CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0
        CHECK (failure_count >= 0),

    -- Associations
    trajectory_ids TEXT NOT NULL DEFAULT '[]',
    agent_id TEXT NOT NULL,
    task_type TEXT NOT NULL,

    -- Timestamps (RULE-020)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,

    -- Soft delete flag (RULE-019: no hard DELETE)
    deprecated INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]'
);

-- Indexes for common queries (RULE-023)
CREATE INDEX IF NOT EXISTS idx_patterns_task_type ON patterns(task_type);
CREATE INDEX IF NOT EXISTS idx_patterns_agent ON patterns(agent_id);
CREATE INDEX IF NOT EXISTS idx_patterns_weight ON patterns(weight DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_deprecated ON patterns(deprecated);
CREATE INDEX IF NOT EXISTS idx_patterns_updated ON patterns(updated_at DESC);

-- ============================================================
-- NO DELETE TRIGGER (RULE-019)
-- Patterns use soft-delete via deprecated flag
-- Weight updates are allowed for learning
-- ============================================================

CREATE TRIGGER IF NOT EXISTS patterns_no_delete
BEFORE DELETE ON patterns
BEGIN
    SELECT RAISE(ABORT, 'Patterns cannot be deleted (RULE-019). Use deprecated flag instead.');
END;
