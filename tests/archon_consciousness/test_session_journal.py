"""Tests for SessionJournal — batched event writing to MemoryGraph.

Written BEFORE implementation (TDD). All tests must fail until
session_journal.py exists.

Covers FR-CON-025: session event journal with batching.
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.session_journal import SessionJournal


class TestConstruction:
    """Test SessionJournal initialization."""

    def test_creates_with_valid_args(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-abc-123")
        assert journal.session_id == "session-abc-123"

    def test_pending_count_initially_zero(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-abc-123")
        assert journal.pending_count == 0

    def test_empty_session_id_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        with pytest.raises(ValueError, match="session_id"):
            SessionJournal(client, "")

    def test_session_id_is_readonly(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-abc-123")
        with pytest.raises(AttributeError):
            journal.session_id = "different-id"


class TestLogEvent:
    """Test event logging to in-memory buffer."""

    def test_valid_event_added_to_buffer(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "User said: don't do that")
        assert journal.pending_count == 1

    def test_multiple_events_accumulate(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "First correction")
        journal.log_event("decision", "Made a choice")
        journal.log_event("state_change", "State changed to frustrated")
        assert journal.pending_count == 3

    def test_invalid_event_type_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        with pytest.raises(ValueError, match="event_type"):
            journal.log_event("invalid_type", "Some content")

    def test_empty_content_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        with pytest.raises(ValueError, match="content"):
            journal.log_event("correction", "")

    def test_whitespace_content_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        with pytest.raises(ValueError, match="content"):
            journal.log_event("correction", "   ")

    def test_none_content_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        with pytest.raises(ValueError, match="content"):
            journal.log_event("correction", None)

    def test_non_string_event_type_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        with pytest.raises(ValueError, match="event_type"):
            journal.log_event(123, "Some content")

    def test_no_memorygraph_writes_before_flush(self, mock_graph):
        """Events stay in buffer — no MCP calls until flush."""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "First")
        journal.log_event("decision", "Second")
        journal.log_event("rule_applied", "Third")
        # Mock call log should have zero store_memory calls
        store_calls = [c for c in mock_graph.call_log if c[0] == "store_memory"]
        assert len(store_calls) == 0

    def test_all_five_event_types_accepted(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        for et in ("correction", "decision", "state_change",
                    "rule_applied", "novel_situation_encountered"):
            journal.log_event(et, f"Event of type {et}")
        assert journal.pending_count == 5

    def test_sequence_numbers_auto_increment(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "First")
        journal.log_event("decision", "Second")
        journal.log_event("rule_applied", "Third")
        journal.flush()
        # Verify stored events have sequence 0, 1, 2
        events = mock_graph.list_by_type("SessionEvent")
        seqs = sorted(json.loads(e["content"])["sequence_number"] for e in events)
        assert seqs == [0, 1, 2]


class TestFlush:
    """Test flushing buffered events to MemoryGraph."""

    def test_flush_writes_all_buffered_events(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "First")
        journal.log_event("decision", "Second")
        flushed = journal.flush()
        assert flushed == 2
        events = mock_graph.list_by_type("SessionEvent")
        assert len(events) == 2

    def test_flush_clears_buffer(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "First")
        journal.flush()
        assert journal.pending_count == 0

    def test_flush_idempotent_on_empty_buffer(self, mock_graph):
        """Flushing empty buffer is a no-op — no MCP calls, returns 0."""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        mock_graph.call_log.clear()
        flushed = journal.flush()
        assert flushed == 0
        store_calls = [c for c in mock_graph.call_log if c[0] == "store_memory"]
        assert len(store_calls) == 0

    def test_flush_preserves_correct_session_id(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-xyz")
        journal.log_event("correction", "Test event")
        journal.flush()
        events = mock_graph.list_by_type("SessionEvent")
        content = json.loads(events[0]["content"])
        assert content["session_id"] == "session-xyz"

    def test_flush_preserves_event_types(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "C")
        journal.log_event("decision", "D")
        journal.flush()
        events = mock_graph.list_by_type("SessionEvent")
        types = {json.loads(e["content"])["event_type"] for e in events}
        assert types == {"correction", "decision"}

    def test_flush_preserves_content_verbatim(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "User said: don't implement without asking")
        journal.flush()
        events = mock_graph.list_by_type("SessionEvent")
        content = json.loads(events[0]["content"])
        assert content["content"] == "User said: don't implement without asking"

    def test_flush_stores_valid_timestamps(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "Test")
        journal.flush()
        events = mock_graph.list_by_type("SessionEvent")
        content = json.loads(events[0]["content"])
        # Should be parseable as ISO datetime
        ts = datetime.fromisoformat(content["timestamp"])
        assert isinstance(ts, datetime)

    def test_flush_correct_memorygraph_node_names(self, mock_graph):
        """Names follow pattern: sessionevent-{session_id}-{seq:04d}"""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "First")
        journal.log_event("decision", "Second")
        journal.flush()
        names = sorted(mock_graph.memories.keys())
        session_event_names = [n for n in names if n.startswith("sessionevent-")]
        assert "sessionevent-session-1-0000" in session_event_names
        assert "sessionevent-session-1-0001" in session_event_names

    def test_flush_tags_include_consciousness(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "Test")
        journal.flush()
        events = mock_graph.list_by_type("SessionEvent")
        assert "archon-consciousness" in events[0]["tags"]
        assert "session-event" in events[0]["tags"]


class TestMultipleFlushes:
    """Test sequence continuity across multiple flushes."""

    def test_sequence_continues_across_flushes(self, mock_graph):
        """Sequence numbers don't reset — they continue from last flush."""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "Batch 1 event 1")
        journal.log_event("correction", "Batch 1 event 2")
        journal.log_event("correction", "Batch 1 event 3")
        journal.flush()
        journal.log_event("decision", "Batch 2 event 1")
        journal.log_event("decision", "Batch 2 event 2")
        journal.flush()
        events = mock_graph.list_by_type("SessionEvent")
        seqs = sorted(json.loads(e["content"])["sequence_number"] for e in events)
        assert seqs == [0, 1, 2, 3, 4]

    def test_large_batch(self, mock_graph):
        """100 events buffered, flush writes all 100."""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        for i in range(100):
            journal.log_event("decision", f"Event {i}")
        assert journal.pending_count == 100
        journal.flush()
        assert journal.pending_count == 0
        events = mock_graph.list_by_type("SessionEvent")
        assert len(events) == 100


class TestShouldFlush:
    """Test the should_flush trigger logic."""

    def test_should_flush_at_5(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(5) is True

    def test_should_flush_at_10(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(10) is True

    def test_should_flush_at_15(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(15) is True

    def test_should_not_flush_at_1(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(1) is False

    def test_should_not_flush_at_3(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(3) is False

    def test_should_not_flush_at_6(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(6) is False

    def test_should_not_flush_at_0(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        assert journal.should_flush(0) is False


class TestPartialFlushFailure:
    """Test error recovery when MemoryGraph fails mid-flush."""

    def test_partial_write_trims_buffer(self, mock_graph):
        """If store fails on 3rd of 5 events, buffer retains 3rd-5th."""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        for i in range(5):
            journal.log_event("correction", f"Event {i}")

        # Monkey-patch to fail on 3rd write
        original_store = mock_graph.store_memory
        call_count = [0]
        def failing_store(**kwargs):
            call_count[0] += 1
            if call_count[0] == 3:
                raise RuntimeError("MemoryGraph write failed")
            return original_store(**kwargs)
        mock_graph.store_memory = failing_store

        with pytest.raises(RuntimeError, match="write failed"):
            journal.flush()

        # 2 events written successfully, 3 remain in buffer
        assert journal.pending_count == 3
        events = mock_graph.list_by_type("SessionEvent")
        assert len(events) == 2


class TestCrashResilience:
    """Test behavior when flush is never called (simulated crash)."""

    def test_unflushed_events_not_in_memorygraph(self, mock_graph):
        """Simulated crash: buffer has events, no flush — nothing persisted."""
        client = MemoryGraphClient(mock_graph)
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "Event 1")
        journal.log_event("correction", "Event 2")
        journal.log_event("correction", "Event 3")
        journal.log_event("correction", "Event 4")
        journal.log_event("correction", "Event 5")
        # No flush() — simulating crash
        events = mock_graph.list_by_type("SessionEvent")
        assert len(events) == 0  # All 5 lost — acceptable per FR-CON-025
