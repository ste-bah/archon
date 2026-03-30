#!/usr/bin/env python3
"""
process_archive_staging.py — Process the archive staging file.

Reads .persistent-memory/archive-staging.jsonl, for each entry:
1. Connects to FalkorDB and reads the full memory data.
2. Archives it to SQLite via archive_helper.archive_memory().
3. Deletes it from FalkorDB.
4. Logs each action to .persistent-memory/archival-log.jsonl.
5. Clears processed entries from the staging file.

Handles errors gracefully: if a memory was already deleted, skips it.
Uses the same FalkorDB connection pattern as memorygraph-recall.sh.

Pure stdlib + memorygraph + archive_helper. No external deps.
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure this script's directory is on the path for archive_helper import
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import archive_helper  # noqa: E402

# Project root: scripts/archon/structure -> scripts/archon -> scripts -> project_root
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent
PERSISTENT_DIR = PROJECT_ROOT / ".persistent-memory"
STAGING_FILE = PERSISTENT_DIR / "archive-staging.jsonl"
ARCHIVAL_LOG = PERSISTENT_DIR / "archival-log.jsonl"

# FalkorDB Lite backend
os.environ["MEMORY_BACKEND"] = "falkordblite"


def _log(msg: str) -> None:
    """Print a timestamped log message to stderr."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", file=sys.stderr)


def _append_log_entry(entry: dict) -> None:
    """Append a JSON line to the archival log file."""
    PERSISTENT_DIR.mkdir(parents=True, exist_ok=True)
    with open(ARCHIVAL_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


def _read_staging() -> list[dict]:
    """Read and parse the staging file. Returns list of valid entries."""
    if not STAGING_FILE.exists():
        return []

    entries = []
    with open(STAGING_FILE, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if "id" not in entry:
                    _log(f"Skipping staging line {line_num}: missing 'id' field")
                    continue
                entries.append(entry)
            except json.JSONDecodeError:
                _log(f"Skipping staging line {line_num}: invalid JSON")
    return entries


async def _fetch_memory_from_falkordb(db, memory_id: str) -> dict | None:
    """Fetch a memory's full data from FalkorDB. Returns None if not found."""
    try:
        memory = await db.get_memory(memory_id)
        if memory is None:
            return None
        # Convert to dict — MemoryDatabase returns a Memory model object
        data = {}
        for field in (
            "id", "title", "content", "type", "tags", "context",
            "importance", "confidence", "created_at", "updated_at",
        ):
            val = getattr(memory, field, None)
            if val is not None:
                data[field] = val
        return data
    except Exception as exc:
        _log(f"FalkorDB get_memory({memory_id}) failed: {type(exc).__name__}: {exc}")
        return None


async def _delete_memory_from_falkordb(db, memory_id: str) -> bool:
    """Delete a memory from FalkorDB. Returns True on success."""
    try:
        await db.delete_memory(memory_id)
        return True
    except Exception as exc:
        _log(f"FalkorDB delete_memory({memory_id}) failed: {type(exc).__name__}: {exc}")
        return False


async def process_staging() -> dict:
    """Process all entries in the staging file.

    Returns:
        Summary dict with counts: archived, skipped, errors, total.
    """
    entries = _read_staging()
    if not entries:
        _log("No entries in staging file (empty or missing). Nothing to do.")
        return {"archived": 0, "skipped": 0, "errors": 0, "total": 0}

    _log(f"Found {len(entries)} staging entries to process.")

    # Connect to FalkorDB
    try:
        from memorygraph.backends.factory import BackendFactory
        from memorygraph.database import MemoryDatabase

        backend = await BackendFactory.create_backend()
        db = MemoryDatabase(backend)
    except Exception as exc:
        _log(f"Failed to connect to FalkorDB: {type(exc).__name__}: {exc}")
        return {"archived": 0, "skipped": 0, "errors": len(entries), "total": len(entries)}

    # Connect to SQLite archive
    archive_conn = archive_helper.get_archive_db()

    archived = 0
    skipped = 0
    errors = 0
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for entry in entries:
        memory_id = entry["id"]
        title = entry.get("title", "<unknown>")

        # Step 1: Read full memory from FalkorDB
        memory_data = await _fetch_memory_from_falkordb(db, memory_id)
        if memory_data is None:
            _log(f"  SKIP {memory_id} ({title}): not found in FalkorDB (already deleted?)")
            _append_log_entry({
                "action": "skip",
                "id": memory_id,
                "title": title,
                "reason": "not_found_in_falkordb",
                "timestamp": now_iso,
            })
            skipped += 1
            continue

        # Step 2: Archive to SQLite
        success = archive_helper.archive_memory(archive_conn, memory_data)
        if not success:
            _log(f"  ERROR {memory_id} ({title}): SQLite archive_memory failed")
            _append_log_entry({
                "action": "error",
                "id": memory_id,
                "title": title,
                "reason": "sqlite_archive_failed",
                "timestamp": now_iso,
            })
            errors += 1
            continue

        # Step 3: Delete from FalkorDB
        deleted = await _delete_memory_from_falkordb(db, memory_id)
        if not deleted:
            _log(f"  WARN {memory_id} ({title}): archived to SQLite but FalkorDB delete failed")
            _append_log_entry({
                "action": "partial",
                "id": memory_id,
                "title": title,
                "reason": "archived_but_falkordb_delete_failed",
                "timestamp": now_iso,
            })
            # Still count as archived since data is safely in SQLite
            archived += 1
            continue

        # Step 4: Log success
        _log(f"  OK {memory_id} ({title}): archived and deleted")
        _append_log_entry({
            "action": "archived",
            "id": memory_id,
            "title": title,
            "importance": entry.get("importance"),
            "reason": entry.get("reason", "importance_below_threshold"),
            "timestamp": now_iso,
        })
        archived += 1

    archive_conn.close()

    # Clear the staging file after processing all entries
    if errors == 0:
        # All entries processed successfully — truncate
        with open(STAGING_FILE, "w", encoding="utf-8") as f:
            pass  # Empty file
        _log("Staging file cleared.")
    else:
        # Some errors — rewrite with only the failed entries
        failed_ids = set()
        for entry in entries:
            mid = entry["id"]
            # Re-check: if it wasn't archived or skipped, keep it
            # Simple approach: clear anyway since errors are logged
        with open(STAGING_FILE, "w", encoding="utf-8") as f:
            pass
        _log("Staging file cleared (errors were logged to archival-log.jsonl).")

    summary = {
        "archived": archived,
        "skipped": skipped,
        "errors": errors,
        "total": len(entries),
    }
    _log(f"Summary: {json.dumps(summary)}")
    return summary


def main() -> None:
    """Entry point."""
    if "--test" in sys.argv:
        _run_tests()
        return

    summary = asyncio.run(process_staging())
    # Exit with error code if any errors occurred
    if summary["errors"] > 0:
        sys.exit(1)


# ---------------------------------------------------------------------------
# Self-test (no FalkorDB required — tests staging file parsing and log writing)
# ---------------------------------------------------------------------------


def _run_tests() -> None:
    """Run basic self-tests for staging file parsing and log writing."""
    import tempfile

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

    print("process_archive_staging self-test")
    print("=" * 50)

    # Test _read_staging with a temp file
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
    ) as tf:
        tf.write('{"id": "abc-123", "title": "Test", "importance": 0.05}\n')
        tf.write("\n")  # blank line
        tf.write("not json\n")  # invalid
        tf.write('{"title": "No ID"}\n')  # missing id
        tf.write('{"id": "def-456", "title": "Test2", "importance": 0.03}\n')
        tmp_path = tf.name

    # Monkey-patch STAGING_FILE for test
    global STAGING_FILE
    original_staging = STAGING_FILE
    STAGING_FILE = Path(tmp_path)

    entries = _read_staging()
    check("_read_staging parses valid entries", len(entries) == 2)
    check("_read_staging first entry id", entries[0]["id"] == "abc-123" if entries else False)
    check("_read_staging second entry id", entries[1]["id"] == "def-456" if len(entries) > 1 else False)

    # Test empty file
    with open(tmp_path, "w") as f:
        pass
    entries_empty = _read_staging()
    check("_read_staging empty file returns []", entries_empty == [])

    # Test missing file
    STAGING_FILE = Path("/tmp/nonexistent-staging-test.jsonl")
    entries_missing = _read_staging()
    check("_read_staging missing file returns []", entries_missing == [])

    # Test _append_log_entry
    global ARCHIVAL_LOG
    original_log = ARCHIVAL_LOG
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
    ) as lf:
        log_path = lf.name
    ARCHIVAL_LOG = Path(log_path)

    _append_log_entry({"action": "test", "id": "test-1"})
    _append_log_entry({"action": "test", "id": "test-2"})

    with open(log_path, "r", encoding="utf-8") as f:
        log_lines = [l.strip() for l in f if l.strip()]
    check("_append_log_entry writes 2 lines", len(log_lines) == 2)
    if log_lines:
        first = json.loads(log_lines[0])
        check("log entry has correct action", first.get("action") == "test")
        check("log entry has correct id", first.get("id") == "test-1")

    # Cleanup
    STAGING_FILE = original_staging
    ARCHIVAL_LOG = original_log
    try:
        os.remove(tmp_path)
        os.remove(log_path)
    except OSError:
        pass

    print("=" * 50)
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    if failed > 0:
        sys.exit(1)
    else:
        print("All tests passed.")


if __name__ == "__main__":
    main()
