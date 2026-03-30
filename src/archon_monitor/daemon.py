"""Archon Monitor Daemon — persistent background process for proactive monitoring.

Singleton daemon + session client pattern (same as personality daemon).
Runs via launchd, communicates with MCP server over Unix socket.
"""

import asyncio
import json
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Callable, Optional

from .models import ItemState, MonitorEvent, TrackType, TrackedItem
from .patterns import DEFAULT_ERROR_PATTERNS, classify_severity, compile_patterns, match_line

SOCKET_PATH = Path.home() / ".archon" / "monitor" / "monitor.sock"
PID_FILE = Path.home() / ".archon" / "monitor" / "daemon.pid"
STATE_FILE = Path.home() / ".archon" / "monitor" / "state.json"
LOG_FILE = Path.home() / ".archon" / "logs" / "monitor.log"

logger = logging.getLogger("archon.monitor")


class MonitorDaemon:
    """Singleton monitor daemon with Unix socket IPC."""

    def __init__(
        self,
        socket_path: Path = SOCKET_PATH,
        pid_file: Path = PID_FILE,
        state_file: Path = STATE_FILE,
        pid_poll_interval: float = 5.0,
    ):
        self._socket_path = socket_path
        self._pid_file = pid_file
        self._state_file = state_file
        self._pid_poll_interval = pid_poll_interval
        self._items: dict[str, TrackedItem] = {}
        self._event_callback: Optional[Callable] = None
        self._running = False
        self._server: Optional[asyncio.AbstractServer] = None
        self._start_time: Optional[float] = None

    @property
    def tracked_count(self) -> int:
        return len(self._items)

    @property
    def items(self) -> dict[str, TrackedItem]:
        return dict(self._items)

    def set_event_callback(self, callback: Callable[[MonitorEvent], None]) -> None:
        self._event_callback = callback

    # --- Lifecycle ---

    async def start(self) -> None:
        """Start daemon: PID file, load state, socket server, poll loop."""
        self._running = True
        self._start_time = asyncio.get_event_loop().time()

        self._socket_path.parent.mkdir(parents=True, exist_ok=True)
        self._pid_file.parent.mkdir(parents=True, exist_ok=True)
        self._state_file.parent.mkdir(parents=True, exist_ok=True)

        self._write_pid_file()
        self._load_state()

        # Remove stale socket
        if self._socket_path.exists():
            self._socket_path.unlink()

        self._server = await asyncio.start_unix_server(
            self._handle_client, path=str(self._socket_path)
        )
        os.chmod(str(self._socket_path), 0o600)

        logger.info(f"Monitor daemon started (PID {os.getpid()}, socket {self._socket_path})")

    async def run_forever(self) -> None:
        """Run the main event loop with PID polling."""
        try:
            while self._running:
                await self._poll_pids()
                await self._check_stale()
                await asyncio.sleep(self._pid_poll_interval)
        except asyncio.CancelledError:
            pass

    async def stop(self) -> None:
        """Graceful shutdown."""
        self._running = False
        self._save_state()

        if self._server:
            self._server.close()
            await self._server.wait_closed()

        self._remove_pid_file()
        if self._socket_path.exists():
            self._socket_path.unlink()

        logger.info("Monitor daemon stopped")

    # --- PID/State Management ---

    def _write_pid_file(self) -> None:
        self._pid_file.write_text(str(os.getpid()))

    def _remove_pid_file(self) -> None:
        if self._pid_file.exists():
            self._pid_file.unlink()

    def _load_state(self) -> None:
        if not self._state_file.exists():
            return
        try:
            data = json.loads(self._state_file.read_text())
            for item_data in data.get("items", []):
                item = TrackedItem.from_dict(item_data)
                self._items[item.item_id] = item
            logger.info(f"Loaded {len(self._items)} tracked items from state")
        except Exception as e:
            logger.warning(f"Failed to load state: {e}")

    def _save_state(self) -> None:
        try:
            data = {"items": [item.to_dict() for item in self._items.values()]}
            tmp = self._state_file.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data, indent=2))
            tmp.rename(self._state_file)
        except Exception as e:
            logger.error(f"Failed to save state: {e}")

    # --- Tracking ---

    def track(self, track_type: TrackType, label: str, target: str,
              patterns: Optional[list[str]] = None,
              stale_threshold: int = 300,
              metadata: Optional[dict] = None) -> TrackedItem:
        """Start tracking a PID, log file, or directory."""
        # Validate
        if track_type == TrackType.PID:
            pid = int(target)
            if pid <= 1:
                raise ValueError(f"Cannot track PID {pid} (reserved)")
            # Verify PID exists
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                raise ValueError(f"PID {pid} does not exist")
            except PermissionError:
                pass  # exists but we can't signal — still trackable

        elif track_type == TrackType.LOG:
            if not os.path.isabs(target):
                raise ValueError(f"Log path must be absolute: {target}")

        elif track_type == TrackType.DIRECTORY:
            if not os.path.isabs(target):
                raise ValueError(f"Directory path must be absolute: {target}")
            if not os.path.isdir(target):
                raise ValueError(f"Directory does not exist: {target}")

        item = TrackedItem(
            item_id=TrackedItem.new_id(),
            track_type=track_type,
            label=label,
            target=target,
            patterns=patterns or [],
            stale_threshold_seconds=stale_threshold,
            metadata=metadata or {},
        )
        self._items[item.item_id] = item
        self._save_state()

        logger.info(f"Tracking {track_type.value}: {label} ({target})")
        return item

    def untrack(self, item_id: str) -> bool:
        """Stop tracking an item."""
        if item_id not in self._items:
            return False
        del self._items[item_id]
        self._save_state()
        return True

    def get_status(self) -> dict:
        """Return daemon status + all tracked items."""
        uptime = 0.0
        if self._start_time:
            uptime = asyncio.get_event_loop().time() - self._start_time

        return {
            "status": "ok",
            "pid": os.getpid(),
            "uptime_seconds": round(uptime),
            "tracked_count": len(self._items),
            "items": [item.to_dict() for item in self._items.values()],
        }

    # --- Polling ---

    async def _poll_pids(self) -> None:
        """Check all tracked PIDs for exit."""
        for item in list(self._items.values()):
            if item.track_type != TrackType.PID or item.state != ItemState.RUNNING:
                continue

            pid = int(item.target)
            try:
                os.kill(pid, 0)
                item.last_activity = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
            except ProcessLookupError:
                # Process exited — determine success/failure
                item.state = ItemState.COMPLETED
                self._emit_event(MonitorEvent(
                    item_id=item.item_id,
                    event_type="exit",
                    severity="info",
                    category="process_exit",
                    message=f"Process '{item.label}' (PID {pid}) exited",
                    source=str(pid),
                ))
                self._save_state()
            except PermissionError:
                # Still running, just can't signal
                item.last_activity = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)

    async def _check_stale(self) -> None:
        """Check for stale tracked items."""
        for item in self._items.values():
            if item.state == ItemState.RUNNING and item.is_stale():
                item.state = ItemState.STALE
                self._emit_event(MonitorEvent(
                    item_id=item.item_id,
                    event_type="stale",
                    severity="warning",
                    category="process_exit",
                    message=f"Tracked item '{item.label}' is stale (no activity for {item.stale_threshold_seconds}s)",
                ))
                self._save_state()

    def _emit_event(self, event: MonitorEvent) -> None:
        """Emit a monitor event to the callback."""
        logger.info(f"Event: {event.event_type} [{event.severity}] {event.message}")
        if self._event_callback:
            try:
                self._event_callback(event)
            except Exception as e:
                logger.error(f"Event callback failed: {e}")

    # --- Unix Socket IPC ---

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle a single client connection (JSON-RPC style)."""
        try:
            data = await asyncio.wait_for(reader.read(65536), timeout=5.0)
            if not data:
                return

            request = json.loads(data.decode())
            method = request.get("method", "")
            params = request.get("params", {})

            if method == "health":
                response = self.get_status()
            elif method == "track":
                try:
                    item = self.track(
                        track_type=TrackType(params["type"]),
                        label=params["label"],
                        target=str(params["target"]),
                        patterns=params.get("patterns"),
                        stale_threshold=params.get("stale_threshold", 300),
                        metadata=params.get("metadata"),
                    )
                    response = {"status": "ok", "item": item.to_dict()}
                except (ValueError, KeyError) as e:
                    response = {"status": "error", "error": str(e)}
            elif method == "untrack":
                success = self.untrack(params.get("item_id", ""))
                response = {"status": "ok" if success else "not_found"}
            elif method == "status":
                response = self.get_status()
            else:
                response = {"status": "error", "error": f"Unknown method: {method}"}

            writer.write(json.dumps(response).encode())
            await writer.drain()
        except (json.JSONDecodeError, asyncio.TimeoutError) as e:
            try:
                writer.write(json.dumps({"status": "error", "error": str(e)}).encode())
                await writer.drain()
            except Exception:
                pass
        finally:
            writer.close()
            await writer.wait_closed()


async def send_to_daemon(
    method: str,
    params: Optional[dict] = None,
    socket_path: Path = SOCKET_PATH,
    timeout: float = 5.0,
) -> dict:
    """Send a request to the monitor daemon and return the response."""
    reader, writer = await asyncio.wait_for(
        asyncio.open_unix_connection(str(socket_path)),
        timeout=timeout,
    )
    try:
        request = json.dumps({"method": method, "params": params or {}})
        writer.write(request.encode())
        await writer.drain()

        data = await asyncio.wait_for(reader.read(65536), timeout=timeout)
        return json.loads(data.decode())
    finally:
        writer.close()
        await writer.wait_closed()
