#!/usr/bin/env python3
"""
archive_helper.py — SQLite cold storage for Archon's tiered memory system.

Manages a SQLite database at ~/.archon/memory-archive.db for archived memories
that have been evicted from the hot MemoryGraph/FalkorDB tier.

All SQL uses parameterized queries. No user input is reflected in queries.
Pure stdlib: sqlite3, json, os, pathlib, sys, uuid, datetime.
"""

import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# UUID validation for memory IDs
_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)

# Max query result limit to prevent DoS
_MAX_LIMIT = 500


def _escape_like(value: str, escape_char: str = "\\") -> str:
    """Escape LIKE metacharacters to prevent wildcard injection."""
    return (
        value
        .replace(escape_char, escape_char * 2)
        .replace("%", escape_char + "%")
        .replace("_", escape_char + "_")
    )


def _validated_id(candidate) -> str:
    """Validate ID is UUID format, or generate a new one."""
    if candidate and isinstance(candidate, str) and _UUID_RE.match(candidate):
        return candidate
    return str(uuid.uuid4())

ARCHIVE_DIR = Path.home() / ".archon"
ARCHIVE_DB_PATH = ARCHIVE_DIR / "memory-archive.db"

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    type TEXT,
    tags TEXT,
    context TEXT,
    importance REAL,
    confidence REAL,
    created_at TEXT,
    updated_at TEXT,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT,
    properties TEXT,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_title ON memories(title);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived_at);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_id);
"""


def get_archive_db() -> sqlite3.Connection:
    """Get or create the archive database connection.

    Creates ~/.archon/ with 0700 permissions if it does not exist.
    Returns a sqlite3.Connection with row_factory set to sqlite3.Row.
    """
    if not ARCHIVE_DIR.exists():
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    # Always enforce permissions, whether newly created or pre-existing
    os.chmod(str(ARCHIVE_DIR), 0o700)

    conn = sqlite3.connect(str(ARCHIVE_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    init_schema(conn)

    # Restrict database file to owner only, regardless of umask
    if ARCHIVE_DB_PATH.exists():
        os.chmod(str(ARCHIVE_DB_PATH), 0o600)

    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables and indexes if they do not exist."""
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


def archive_memory(conn: sqlite3.Connection, memory_data: dict) -> bool:
    """Insert a memory into the archive.

    Args:
        conn: Active database connection.
        memory_data: Dict with keys: id, title, content, type, tags (list),
            context (dict), importance, confidence, created_at, updated_at.

    Returns:
        True on success, False on error.
    """
    try:
        memory_id = _validated_id(memory_data.get("id"))
        tags_json = json.dumps(memory_data.get("tags", []))
        context_json = json.dumps(memory_data.get("context", {}))

        conn.execute(
            """INSERT OR REPLACE INTO memories
               (id, title, content, type, tags, context,
                importance, confidence, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                memory_id,
                memory_data.get("title", ""),
                memory_data.get("content"),
                memory_data.get("type"),
                tags_json,
                context_json,
                memory_data.get("importance"),
                memory_data.get("confidence"),
                memory_data.get("created_at"),
                memory_data.get("updated_at"),
            ),
        )
        conn.commit()
        return True
    except sqlite3.Error as exc:
        print(f"[archive_helper] archive_memory error: {type(exc).__name__}", file=sys.stderr)
        return False


def archive_relationship(conn: sqlite3.Connection, rel_data: dict) -> bool:
    """Insert a relationship into the archive.

    Args:
        conn: Active database connection.
        rel_data: Dict with keys: id, from_id, to_id, type, properties (dict).

    Returns:
        True on success, False on error.
    """
    try:
        rel_id = _validated_id(rel_data.get("id"))
        props_json = json.dumps(rel_data.get("properties", {}))

        conn.execute(
            """INSERT OR REPLACE INTO relationships
               (id, from_id, to_id, type, properties)
               VALUES (?, ?, ?, ?, ?)""",
            (
                rel_id,
                rel_data["from_id"],
                rel_data["to_id"],
                rel_data.get("type"),
                props_json,
            ),
        )
        conn.commit()
        return True
    except (sqlite3.Error, KeyError) as exc:
        print(f"[archive_helper] archive_relationship error: {type(exc).__name__}", file=sys.stderr)
        return False


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict, deserializing JSON fields."""
    d = dict(row)
    for key in ("tags",):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    for key in ("context", "properties"):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    return d


def search_archive(
    conn: sqlite3.Connection, query: str, limit: int = 10
) -> list[dict]:
    """Search archived memories by keyword in title and content.

    Uses case-insensitive LIKE matching on title and content fields.

    Args:
        conn: Active database connection.
        query: Search keyword.
        limit: Maximum number of results (default 10).

    Returns:
        List of memory dicts matching the query.
    """
    try:
        # Validate and cap limit to prevent DoS
        if not isinstance(limit, int) or isinstance(limit, bool):
            limit = 10
        limit = max(1, min(limit, _MAX_LIMIT))

        # Escape LIKE metacharacters to prevent wildcard injection
        pattern = f"%{_escape_like(query)}%"
        cursor = conn.execute(
            """SELECT * FROM memories
               WHERE title LIKE ? ESCAPE '\\' COLLATE NOCASE
                  OR content LIKE ? ESCAPE '\\' COLLATE NOCASE
               ORDER BY archived_at DESC
               LIMIT ?""",
            (pattern, pattern, limit),
        )
        return [_row_to_dict(row) for row in cursor.fetchall()]
    except sqlite3.Error as exc:
        print(f"[archive_helper] search_archive error: {type(exc).__name__}", file=sys.stderr)
        return []


def get_archived_memory(
    conn: sqlite3.Connection, memory_id: str
) -> dict | None:
    """Get a specific archived memory by ID.

    Args:
        conn: Active database connection.
        memory_id: The memory's unique identifier.

    Returns:
        Memory dict if found, None otherwise.
    """
    try:
        cursor = conn.execute(
            "SELECT * FROM memories WHERE id = ?", (memory_id,)
        )
        row = cursor.fetchone()
        return _row_to_dict(row) if row else None
    except sqlite3.Error as exc:
        print(f"[archive_helper] get_archived_memory error: {type(exc).__name__}", file=sys.stderr)
        return None


def restore_memory(
    conn: sqlite3.Connection, memory_id: str
) -> dict | None:
    """Remove a memory from archive and return its data for re-insertion to FalkorDB.

    Reads the full memory data, deletes it from the archive, and returns
    the data dict so the caller can re-insert it into the hot tier.

    Args:
        conn: Active database connection.
        memory_id: The memory's unique identifier.

    Returns:
        Memory dict if found and removed, None otherwise.
    """
    try:
        memory = get_archived_memory(conn, memory_id)
        if memory is None:
            return None

        conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        # Also remove any relationships involving this memory
        conn.execute(
            "DELETE FROM relationships WHERE from_id = ? OR to_id = ?",
            (memory_id, memory_id),
        )
        conn.commit()
        return memory
    except sqlite3.Error as exc:
        print(f"[archive_helper] restore_memory error: {type(exc).__name__}", file=sys.stderr)
        return None


def get_archive_stats(conn: sqlite3.Connection) -> dict:
    """Return archive statistics.

    Returns:
        Dict with keys: total_memories, total_relationships, oldest, newest.
    """
    try:
        mem_count = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        rel_count = conn.execute(
            "SELECT COUNT(*) FROM relationships"
        ).fetchone()[0]

        oldest_row = conn.execute(
            "SELECT MIN(archived_at) FROM memories"
        ).fetchone()
        newest_row = conn.execute(
            "SELECT MAX(archived_at) FROM memories"
        ).fetchone()

        return {
            "total_memories": mem_count,
            "total_relationships": rel_count,
            "oldest": oldest_row[0] if oldest_row else None,
            "newest": newest_row[0] if newest_row else None,
        }
    except sqlite3.Error as exc:
        print(f"[archive_helper] get_archive_stats error: {type(exc).__name__}", file=sys.stderr)
        return {
            "total_memories": 0,
            "total_relationships": 0,
            "oldest": None,
            "newest": None,
        }


def list_recent_archives(
    conn: sqlite3.Connection, limit: int = 10
) -> list[dict]:
    """List most recently archived memories.

    Useful for /autonomous-status display.

    Args:
        conn: Active database connection.
        limit: Maximum number of results (default 10).

    Returns:
        List of memory dicts ordered by archived_at descending.
    """
    try:
        if not isinstance(limit, int) or isinstance(limit, bool):
            limit = 10
        limit = max(1, min(limit, _MAX_LIMIT))
        cursor = conn.execute(
            "SELECT * FROM memories ORDER BY archived_at DESC LIMIT ?",
            (limit,),
        )
        return [_row_to_dict(row) for row in cursor.fetchall()]
    except sqlite3.Error as exc:
        print(f"[archive_helper] list_recent_archives error: {type(exc).__name__}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------


def _run_tests() -> None:
    """Run basic self-tests using an in-memory database."""
    import tempfile

    test_dir = tempfile.mkdtemp()
    test_db = os.path.join(test_dir, "test-archive.db")

    conn = sqlite3.connect(test_db)
    conn.row_factory = sqlite3.Row
    passed = 0
    failed = 0

    def check(name: str, condition: bool) -> None:
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"  PASS: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name}")

    print("archive_helper self-test")
    print("=" * 50)

    # 1. Schema init
    try:
        init_schema(conn)
        check("init_schema creates tables", True)
    except Exception as exc:
        check(f"init_schema creates tables ({exc})", False)

    # 2. Archive a memory
    mem = {
        "id": "a0000001-0000-4000-8000-000000000001",
        "title": "Test Memory Alpha",
        "content": "This is test content about alpha patterns.",
        "type": "observation",
        "tags": ["test", "alpha"],
        "context": {"source": "unit-test", "session": "self-test"},
        "importance": 0.8,
        "confidence": 0.9,
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-02T00:00:00Z",
    }
    result = archive_memory(conn, mem)
    check("archive_memory returns True", result is True)

    # 3. Archive a second memory
    mem2 = {
        "id": "a0000002-0000-4000-8000-000000000002",
        "title": "Beta Pattern Recognition",
        "content": "Content about beta recognition strategies.",
        "type": "insight",
        "tags": ["beta"],
        "context": {},
        "importance": 0.5,
        "confidence": 0.7,
        "created_at": "2025-02-01T00:00:00Z",
        "updated_at": "2025-02-01T00:00:00Z",
    }
    archive_memory(conn, mem2)

    # 4. Archive a relationship
    rel = {
        "id": "b0000001-0000-4000-8000-000000000001",
        "from_id": "a0000001-0000-4000-8000-000000000001",
        "to_id": "a0000002-0000-4000-8000-000000000002",
        "type": "related_to",
        "properties": {"weight": 0.75},
    }
    rel_result = archive_relationship(conn, rel)
    check("archive_relationship returns True", rel_result is True)

    # 5. Get by ID
    fetched = get_archived_memory(conn, "a0000001-0000-4000-8000-000000000001")
    check("get_archived_memory finds memory", fetched is not None)
    check(
        "get_archived_memory returns correct title",
        fetched is not None and fetched["title"] == "Test Memory Alpha",
    )
    check(
        "tags deserialized as list",
        fetched is not None and fetched["tags"] == ["test", "alpha"],
    )
    check(
        "context deserialized as dict",
        fetched is not None and fetched["context"]["source"] == "unit-test",
    )

    # 6. Search
    results = search_archive(conn, "alpha")
    check("search_archive finds by keyword", len(results) == 1)
    check(
        "search_archive result has correct id",
        len(results) == 1 and results[0]["id"] == "a0000001-0000-4000-8000-000000000001",
    )

    # Case-insensitive search
    results_ci = search_archive(conn, "BETA")
    check("search_archive is case-insensitive", len(results_ci) == 1)

    # Content search
    results_content = search_archive(conn, "strategies")
    check("search_archive searches content field", len(results_content) == 1)

    # 7. Stats
    stats = get_archive_stats(conn)
    check("get_archive_stats total_memories", stats["total_memories"] == 2)
    check("get_archive_stats total_relationships", stats["total_relationships"] == 1)
    check("get_archive_stats oldest is not None", stats["oldest"] is not None)
    check("get_archive_stats newest is not None", stats["newest"] is not None)

    # 8. List recent
    recent = list_recent_archives(conn, limit=5)
    check("list_recent_archives returns memories", len(recent) == 2)

    # 9. Restore
    restored = restore_memory(conn, "a0000001-0000-4000-8000-000000000001")
    check("restore_memory returns data", restored is not None)
    check(
        "restore_memory returns correct title",
        restored is not None and restored["title"] == "Test Memory Alpha",
    )

    # Verify deletion
    gone = get_archived_memory(conn, "a0000001-0000-4000-8000-000000000001")
    check("restore_memory removes from archive", gone is None)

    # Verify relationship also removed
    rel_cursor = conn.execute(
        "SELECT COUNT(*) FROM relationships WHERE from_id = ? OR to_id = ?",
        ("a0000001-0000-4000-8000-000000000001", "a0000001-0000-4000-8000-000000000001"),
    )
    rel_count = rel_cursor.fetchone()[0]
    check("restore_memory removes related relationships", rel_count == 0)

    # Restore non-existent
    nothing = restore_memory(conn, "does-not-exist")
    check("restore_memory returns None for missing id", nothing is None)

    # 10. Stats after restore
    stats2 = get_archive_stats(conn)
    check("stats after restore shows 1 memory", stats2["total_memories"] == 1)
    check("stats after restore shows 0 relationships", stats2["total_relationships"] == 0)

    conn.close()

    # Cleanup
    try:
        os.remove(test_db)
        os.rmdir(test_dir)
    except OSError:
        pass

    print("=" * 50)
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    if failed > 0:
        sys.exit(1)
    else:
        print("All tests passed.")


def _append_archival_log(entry: dict) -> None:
    """Append a JSON line to the archival log at .persistent-memory/archival-log.jsonl.

    This is the same log that process_archive_staging.py writes to.
    We duplicate the append logic here so archive_helper.py stays self-contained
    (no circular imports).
    """
    # Resolve project root: archive_helper.py lives at scripts/archon/structure/
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    log_path = project_root / ".persistent-memory" / "archival-log.jsonl"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


if __name__ == "__main__":
    if "--test" in sys.argv:
        _run_tests()
    elif "--restore" in sys.argv:
        idx = sys.argv.index("--restore")
        memory_id = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else ""
        if not memory_id:
            print("Usage: python3 archive_helper.py --restore <memory-id>", file=sys.stderr)
            sys.exit(1)
        conn = get_archive_db()
        data = restore_memory(conn, memory_id)
        if data:
            # Log the restore action to archival-log.jsonl
            _append_archival_log({
                "action": "restore",
                "direction": "restore",
                "id": data.get("id", memory_id),
                "title": data.get("title", ""),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            print(json.dumps(data, default=str))
        else:
            print(json.dumps({"error": "Memory not found in archive"}))
        conn.close()
    elif "--stats" in sys.argv:
        conn = get_archive_db()
        stats = get_archive_stats(conn)

        # Enrich with recent archival log activity
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        log_path = project_root / ".persistent-memory" / "archival-log.jsonl"
        recent_moves = []
        if log_path.exists():
            try:
                with open(log_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                # Last 10 log entries
                for line in lines[-10:]:
                    line = line.strip()
                    if line:
                        try:
                            recent_moves.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
            except OSError:
                pass

        stats["recent_log_entries"] = recent_moves
        stats["log_entry_count"] = 0
        if log_path.exists():
            try:
                with open(log_path, "r", encoding="utf-8") as f:
                    stats["log_entry_count"] = sum(1 for line in f if line.strip())
            except OSError:
                pass

        print(json.dumps(stats, indent=2, default=str))
        conn.close()
    elif "--search" in sys.argv:
        idx = sys.argv.index("--search")
        query = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else ""
        if not query:
            print("Usage: python3 archive_helper.py --search <query>", file=sys.stderr)
            sys.exit(1)
        conn = get_archive_db()
        results = search_archive(conn, query)
        for r in results:
            print(json.dumps({
                "id": r["id"],
                "title": r["title"],
                "type": r["type"],
                "importance": r["importance"],
                "archived_at": r["archived_at"],
                "content_preview": (r.get("content") or "")[:200],
            }))
        conn.close()
    else:
        print("Usage: python3 archive_helper.py [command]")
        print()
        print("Commands:")
        print("  --test              Run self-tests against an in-memory database.")
        print("  --search <query>    Search archived memories by keyword (returns JSON lines).")
        print("  --restore <id>      Restore an archived memory by ID (returns full JSON, removes from archive).")
        print("  --stats             Show archive statistics (returns JSON).")
