"""Session event journal with batched writes to MemoryGraph.

Accumulates events in an in-memory buffer and flushes to MemoryGraph
in batches to avoid per-event blocking of the conversation flow.

Per FR-CON-025:
- Events batched, flushed every 5 user messages or on explicit flush()
- If Stop hook fails, max 5 events lost (last unflushed batch)
- flush() is idempotent on empty buffer
"""

from datetime import datetime, timezone

from src.archon_consciousness.constants import EVENT_TYPES
from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import SessionEvent

# Flush trigger interval (every N user messages)
_FLUSH_INTERVAL = 5


class SessionJournal:
    """Batched session event writer.

    Events are logged to an in-memory buffer and flushed to MemoryGraph
    in batches. Sequence numbers are continuous across flushes within
    a session.

    Args:
        client: MemoryGraphClient for persistence.
        session_id: Unique identifier for the current session.

    Raises:
        ValueError: If session_id is empty.
    """

    def __init__(self, client: MemoryGraphClient, session_id: str):
        if not isinstance(session_id, str) or not session_id.strip():
            raise ValueError("session_id must not be empty")
        self._client = client
        self._session_id = session_id
        self._buffer: list[SessionEvent] = []
        self._next_sequence: int = 0

    @property
    def session_id(self) -> str:
        """Read-only session identifier."""
        return self._session_id

    @property
    def pending_count(self) -> int:
        """Number of events in the buffer awaiting flush."""
        return len(self._buffer)

    def log_event(self, event_type: str, content: str) -> None:
        """Log an event to the in-memory buffer.

        Does NOT write to MemoryGraph — call flush() to persist.

        Args:
            event_type: One of the EVENT_TYPES enum values.
            content: Description of the event.

        Raises:
            ValueError: If event_type is invalid or content is empty.
        """
        if event_type not in EVENT_TYPES:
            raise ValueError(
                f"event_type must be one of {EVENT_TYPES}, got '{event_type}'"
            )
        if not isinstance(content, str) or not content.strip():
            raise ValueError("content must not be empty")

        event = SessionEvent(
            session_id=self._session_id,
            sequence_number=self._next_sequence,
            event_type=event_type,
            content=content,
            timestamp=datetime.now(timezone.utc),
        )
        self._buffer.append(event)
        self._next_sequence += 1

    def flush(self) -> int:
        """Write all buffered events to MemoryGraph and clear buffer.

        Returns:
            Number of events flushed. 0 if buffer was empty (no-op).
        """
        if not self._buffer:
            return 0

        # NOTE: MemoryGraph MCP has no batch-write primitive. Events are
        # written sequentially. Names are deterministic (sessionevent-{sid}-{seq:04d})
        # so retries are idempotent (store_memory overwrites by name).
        count = len(self._buffer)
        written = 0
        try:
            for event in self._buffer:
                self._client.store_from_schema(event)
                written += 1
        except Exception:
            # Remove successfully written events from buffer to avoid
            # duplicating them on retry. Keep the failed + remaining events.
            self._buffer = self._buffer[written:]
            raise
        self._buffer.clear()
        return count

    def should_flush(self, message_count: int) -> bool:
        """Determine if a flush should be triggered.

        Args:
            message_count: Number of user messages in the session so far.

        Returns:
            True if message_count is a multiple of the flush interval (5)
            and message_count > 0.
        """
        return message_count > 0 and message_count % _FLUSH_INTERVAL == 0
