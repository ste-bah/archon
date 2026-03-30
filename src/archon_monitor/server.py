#!/usr/bin/env python3
"""Archon Monitor MCP Server — session client for the monitor daemon.

Thin FastMCP server that forwards tool calls to the persistent daemon
over Unix socket. One MCP server per Claude Code session, one daemon
for all sessions.
"""

import asyncio
import json
import logging
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .daemon import SOCKET_PATH, send_to_daemon

mcp = FastMCP("archon-monitor")
logger = logging.getLogger("archon.monitor.mcp")


@mcp.tool()
async def archon_monitor_track(
    target: str,
    label: str,
    track_type: str = "pid",
    patterns: list[str] | None = None,
    stale_threshold: int = 300,
) -> str:
    """Start monitoring a process, log file, or directory.

    Args:
        target: PID number, absolute log file path, or directory path.
        label: Human-readable label (e.g., "pytest run", "god-code pipeline").
        track_type: One of "pid", "log", "directory". Default: "pid".
        patterns: Optional regex patterns for log monitoring.
        stale_threshold: Seconds of inactivity before marking stale. Default 300.
    """
    try:
        response = await send_to_daemon("track", {
            "type": track_type,
            "label": label,
            "target": target,
            "patterns": patterns or [],
            "stale_threshold": stale_threshold,
            "metadata": {"session_ppid": os.getppid()},
        })
        if response.get("status") == "ok":
            item = response["item"]
            return f"Tracking {track_type} '{label}' (ID: {item['item_id']}, target: {target})"
        return f"Error: {response.get('error', 'unknown')}"
    except (ConnectionRefusedError, FileNotFoundError):
        return "Error: Monitor daemon not running. Start with: launchctl start com.archon.monitor"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
async def archon_monitor_untrack(item_id: str) -> str:
    """Stop monitoring a tracked item.

    Args:
        item_id: The 8-character ID returned by archon_monitor_track.
    """
    try:
        response = await send_to_daemon("untrack", {"item_id": item_id})
        if response.get("status") == "ok":
            return f"Stopped tracking {item_id}"
        return f"Item {item_id} not found"
    except (ConnectionRefusedError, FileNotFoundError):
        return "Error: Monitor daemon not running."
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
async def archon_monitor_status() -> str:
    """Get the current status of the monitor daemon and all tracked items."""
    try:
        response = await send_to_daemon("status")
        return json.dumps(response, indent=2)
    except (ConnectionRefusedError, FileNotFoundError):
        return json.dumps({"status": "daemon_not_running", "message": "Start with: launchctl start com.archon.monitor"})
    except Exception as e:
        return json.dumps({"status": "error", "error": str(e)})


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    mcp.run(transport="stdio")
