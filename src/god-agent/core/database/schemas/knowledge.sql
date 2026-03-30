-- ============================================================
-- KNOWLEDGE AND KNOWLEDGE_CHUNKS TABLE SCHEMA
-- ============================================================
-- Specification: TASKS-CHUNKING-FIX.md (Sprint 13)
-- Requirements: REQ-CHUNK-001 to REQ-CHUNK-006
-- Constitution: RULE-008, RULE-011, RULE-015, RULE-020, RULE-023, RULE-046
-- ============================================================

-- Database configuration for optimal performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- KNOWLEDGE TABLE (Parent)
-- Stores knowledge entry metadata (migrated from JSON storage)
-- RULE-008: SQLite as primary storage (not in-memory Map)
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge (
    -- Primary key (UUID)
    id TEXT PRIMARY KEY NOT NULL,

    -- Original full content (for backward compatibility)
    -- NULL for chunked entries (content reconstructed from chunks)
    content TEXT,

    -- Metadata fields
    category TEXT NOT NULL,
    domain TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',  -- JSON array

    -- Quality score (0.0 to 1.0 range enforced)
    quality REAL NOT NULL DEFAULT 1.0
        CHECK (quality >= 0.0 AND quality <= 1.0),

    -- Usage tracking
    usage_count INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER NOT NULL,

    -- Chunking metadata [REQ-CHUNK-001]
    is_chunked INTEGER NOT NULL DEFAULT 0,  -- 0 = legacy single content, 1 = chunked
    chunk_count INTEGER DEFAULT NULL,
    total_chars INTEGER DEFAULT NULL,
    total_estimated_tokens INTEGER DEFAULT NULL,

    -- Version tracking (RULE-020)
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

-- ============================================================
-- KNOWLEDGE_CHUNKS TABLE (Child)
-- Stores individual chunks of large knowledge content
-- RULE-046: Atomic writes via transaction with parent
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    -- Primary key (UUID)
    id TEXT PRIMARY KEY NOT NULL,

    -- Foreign key to parent knowledge entry
    -- RULE-021: ON DELETE RESTRICT (no orphaned chunks)
    knowledge_id TEXT NOT NULL
        REFERENCES knowledge(id) ON DELETE RESTRICT,

    -- Chunk position [REQ-CHUNK-003]
    chunk_index INTEGER NOT NULL,

    -- Character offsets in original content
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,

    -- Chunk content
    content TEXT NOT NULL,
    estimated_tokens INTEGER,

    -- Version tracking (RULE-020)
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Ensure chunk order is unique per knowledge entry
    UNIQUE(knowledge_id, chunk_index)
);

-- ============================================================
-- INDEXES (RULE-023: Indexes on FKs and common query fields)
-- ============================================================

-- Knowledge table indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge(domain);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_quality ON knowledge(quality DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunked ON knowledge(is_chunked);

-- Knowledge chunks table indexes
CREATE INDEX IF NOT EXISTS idx_chunks_knowledge_id ON knowledge_chunks(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_chunks_order ON knowledge_chunks(knowledge_id, chunk_index);

-- ============================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================

-- View to get knowledge with reconstructed content from chunks
CREATE VIEW IF NOT EXISTS knowledge_full AS
SELECT
    k.id,
    k.category,
    k.domain,
    k.tags,
    k.quality,
    k.usage_count,
    k.last_used,
    k.is_chunked,
    k.chunk_count,
    k.version,
    k.created_at,
    k.updated_at,
    CASE
        WHEN k.is_chunked = 0 THEN k.content
        ELSE (
            SELECT GROUP_CONCAT(kc.content, '')
            FROM knowledge_chunks kc
            WHERE kc.knowledge_id = k.id
            ORDER BY kc.chunk_index
        )
    END AS content
FROM knowledge k;

-- ============================================================
-- MIGRATION HELPER (for existing JSON data)
-- This is a helper query, not auto-executed
-- ============================================================
-- INSERT INTO knowledge (id, content, category, domain, tags, quality, usage_count, last_used, is_chunked, version, created_at)
-- SELECT
--     json_extract(value, '$.id'),
--     json_extract(value, '$.content'),
--     json_extract(value, '$.category'),
--     json_extract(value, '$.domain'),
--     json_extract(value, '$.tags'),
--     json_extract(value, '$.quality'),
--     json_extract(value, '$.usageCount'),
--     json_extract(value, '$.lastUsed'),
--     0,  -- is_chunked = false for legacy entries
--     1,
--     datetime(json_extract(value, '$.createdAt') / 1000, 'unixepoch')
-- FROM json_each(?)  -- Pass JSON array from session-knowledge.json
