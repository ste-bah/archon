-- ============================================================
-- EPISODES TABLE SCHEMA
-- ============================================================
-- Specification: SPEC-FUNC-DESC, SPEC-TECH-DATABASE
-- Requirements: REQ-DESC-001, REQ-DESC-002
-- Constitution: RULE-011, RULE-016, RULE-020, RULE-023
-- ============================================================

-- Database configuration for optimal performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- EPISODES TABLE
-- Stores all learning episodes (append-only per RULE-016)
-- ============================================================
CREATE TABLE IF NOT EXISTS episodes (
    -- Primary key (UUID)
    id TEXT PRIMARY KEY NOT NULL,

    -- Core content fields
    content TEXT NOT NULL,
    summary TEXT,
    context TEXT,

    -- Vector embedding (Float32Array serialized to BLOB)
    embedding BLOB NOT NULL,

    -- Quality score (0.0 to 1.0 range enforced)
    quality REAL NOT NULL DEFAULT 0.5
        CHECK (quality >= 0.0 AND quality <= 1.0),

    -- Temporal metadata
    timestamp INTEGER NOT NULL,

    -- Agent/session identification
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,

    -- Episode type classification
    type TEXT NOT NULL DEFAULT 'task'
        CHECK (type IN ('task', 'feedback', 'context', 'pattern')),

    -- Tags stored as JSON array string
    tags TEXT NOT NULL DEFAULT '[]',

    -- Version tracking (RULE-020)
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES (RULE-023: Indexes on FKs and common query fields)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_quality ON episodes(quality DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_type ON episodes(type);

-- ============================================================
-- APPEND-ONLY TRIGGERS (RULE-016)
-- Episodes are immutable once created
-- ============================================================
CREATE TRIGGER IF NOT EXISTS episodes_no_update
BEFORE UPDATE ON episodes
BEGIN
    SELECT RAISE(ABORT, 'RULE-016 VIOLATION: Episodes are append-only. UPDATE operations forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS episodes_no_delete
BEFORE DELETE ON episodes
BEGIN
    SELECT RAISE(ABORT, 'RULE-016 VIOLATION: Episodes are append-only. DELETE operations forbidden.');
END;
