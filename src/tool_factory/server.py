#!/usr/bin/env python3
"""Tool Factory MCP Server — dynamic tool creation and execution."""

import ast
import asyncio
import hashlib
import json
import keyword
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from .executor import SandboxExecutor
from .persistence import ToolDefinition, ToolStore

# --- Configuration ---

MAX_ACTIVE_TOOLS = 20
LOG_FILE = Path(".god-agent/tool-factory.log")
TOOL_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{1,48}[a-z0-9]$")
TOOL_NAME_MIN_LENGTH = 3
TOOL_NAME_MAX_LENGTH = 50
TTL_CHECK_INTERVAL_SECONDS = 60

RESERVED_TOOL_NAMES = frozenset({
    "read", "write", "edit", "multiedit", "bash", "glob", "grep",
    "todoread", "todowrite", "task", "agent",
    "webbrowser", "webfetch", "websearch",
    "notebookedit", "notebookread",
})

MCP_TOOL_PREFIXES = frozenset({
    "mcp__", "memorygraph", "leann", "git",
})

# --- Server Setup ---

mcp = FastMCP("tool-factory")
logger = logging.getLogger("tool-factory")

_store: ToolStore
_executor: SandboxExecutor


# --- Validation Helpers ---

def validate_tool_name(name: str) -> tuple[list[str], list[str]]:
    """Validate a tool name. Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    if not name or len(name) < TOOL_NAME_MIN_LENGTH:
        errors.append(f"Tool name must be at least {TOOL_NAME_MIN_LENGTH} characters.")
        return errors, warnings

    if len(name) > TOOL_NAME_MAX_LENGTH:
        errors.append(f"Tool name must be at most {TOOL_NAME_MAX_LENGTH} characters.")
        return errors, warnings

    if not TOOL_NAME_PATTERN.match(name):
        errors.append(
            f"Tool name '{name}' is invalid. Must be 3-50 chars, lowercase "
            f"alphanumeric with hyphens/underscores, starting with a letter."
        )

    if keyword.iskeyword(name):
        errors.append(f"Tool name '{name}' is a Python reserved keyword.")

    if name.lower() in RESERVED_TOOL_NAMES:
        warnings.append(
            f"Tool name '{name}' may conflict with built-in tool. "
            f"Consider a more specific name."
        )

    for prefix in MCP_TOOL_PREFIXES:
        if name.startswith(prefix):
            warnings.append(
                f"Tool name '{name}' starts with MCP prefix '{prefix}'. "
                f"This may cause confusion with existing MCP tools."
            )

    return errors, warnings


def validate_python_syntax(code: str) -> tuple[bool, str | None]:
    """Validate Python code syntax without executing it."""
    try:
        ast.parse(code)
        return True, None
    except SyntaxError as e:
        return False, f"Syntax error at line {e.lineno}: {e.msg}"


def validate_params_against_schema(params: dict, schema: dict | None) -> tuple[bool, str | None]:
    """Validate parameters against JSON Schema. Returns (valid, error_msg)."""
    if schema is None:
        return True, None
    try:
        import jsonschema
        jsonschema.validate(params, schema)
        return True, None
    except jsonschema.ValidationError as e:
        return False, f"Parameter validation failed: {e.message}"
    except jsonschema.SchemaError as e:
        return False, f"Invalid parameter schema: {e.message}"


def strip_extra_params(params: dict, schema: dict | None) -> dict:
    """Strip parameters not defined in the JSON Schema (EC-TOOL-006)."""
    if schema is None or "properties" not in schema:
        return params
    allowed = set(schema["properties"].keys())
    return {k: v for k, v in params.items() if k in allowed}


def _log_event(event: str, **kwargs: Any) -> None:
    """Log tool factory event to the audit log."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Quote values to prevent log format breakage
    details = " ".join(f'{k}="{v}"' for k, v in kwargs.items())
    line = f"{ts} [{event}] {details}\n"
    with open(LOG_FILE, "a") as f:
        f.write(line)


async def _notify_tools_changed() -> None:
    """Send tools/list_changed notification. Safe to call from any context."""
    try:
        ctx = mcp.server.request_context
        if ctx and ctx.session:
            await ctx.session.send_tools_list_changed()
    except Exception:
        # Outside request context (e.g., from TTL expiry loop) — notification skipped.
        # Claude Code will pick up changes on next tool list request.
        logger.debug("Could not send tools_list_changed (no active request context)")


# --- Dynamic Tool Dispatcher ---

def _register_dynamic_tool(tool_def: ToolDefinition) -> None:
    """Register a dynamic tool with FastMCP so it's callable via MCP protocol."""

    async def _dynamic_handler(**kwargs: Any) -> str:
        """Dispatch handler for a dynamic tool."""
        td = _store.get(tool_def.name)
        if td is None:
            return json.dumps({"error": f"Tool '{tool_def.name}' not found."})

        # Check expiry
        if td.is_expired():
            _store.delete(td.name)
            _log_event("EXPIRE", name=td.name, reason="ttl_expired")
            return json.dumps({"error": f"Tool '{td.name}' has expired."})

        # Validate params against schema (REQ-TOOL-010)
        valid, err = validate_params_against_schema(kwargs, td.parameters)
        if not valid:
            return json.dumps({"error": err})

        # Strip extra params (EC-TOOL-006)
        clean_params = strip_extra_params(kwargs, td.parameters)

        # Execute in sandbox
        result = await _executor.execute(td.code, clean_params, td.timeout_seconds)

        # Update usage stats
        td.invocation_count += 1
        td.last_used = datetime.now(timezone.utc).isoformat()
        _store.save(td)

        _log_event("INVOKE", name=td.name,
                   duration_ms=f"{result.duration_ms:.0f}", success=str(result.success))

        return result.output

    # Register with FastMCP using the tool definition's metadata
    mcp.tool(
        name=tool_def.name,
        description=tool_def.description,
    )(_dynamic_handler)


def _unregister_dynamic_tool(name: str) -> None:
    """Unregister a dynamic tool from FastMCP."""
    # FastMCP stores tools in mcp._tool_manager._tools dict
    if hasattr(mcp, '_tool_manager') and hasattr(mcp._tool_manager, '_tools'):
        mcp._tool_manager._tools.pop(name, None)


# --- Management Tools ---

@mcp.tool()
async def add_tool(
    name: str,
    description: str,
    code: str,
    language: str = "python",
    parameters: dict | None = None,
    ttl_minutes: int = 0,
    timeout_seconds: int = 30,
) -> str:
    """Register a new dynamic tool.

    Args:
        name: Unique tool name (lowercase, alphanumeric + hyphens, 3-50 chars).
        description: Human-readable description of what the tool does.
        code: Python source code. Must define a function `run(params) -> dict`.
        language: Only "python" supported.
        parameters: JSON Schema for input validation. None = no params.
        ttl_minutes: Auto-expire after N minutes. 0 = no expiry.
        timeout_seconds: Subprocess timeout (1-120 seconds). Default 30.
    """
    if language != "python":
        return f"Error: Language '{language}' is not supported. Only 'python' is available."

    errors, warnings = validate_tool_name(name)
    if errors:
        return f"Error: {'; '.join(errors)}"

    if _store.has(name):
        return f"Error: Tool '{name}' already exists. Use update_tool to modify it."

    if _store.count_active() >= MAX_ACTIVE_TOOLS:
        active = _store.list_all(include_expired=False)
        tool_list = ", ".join(f"{t.name} (last used: {t.last_used})" for t in active)
        return f"Error: Maximum active tool limit ({MAX_ACTIVE_TOOLS}) reached. Active tools: {tool_list}"

    valid, err = validate_python_syntax(code)
    if not valid:
        return f"Error: {err}"

    if timeout_seconds < 1 or timeout_seconds > 120:
        return f"Error: timeout_seconds must be between 1 and 120 (got {timeout_seconds})."

    now = datetime.now(timezone.utc).isoformat()
    tool = ToolDefinition(
        name=name, description=description, code=code, language=language,
        parameters=parameters, ttl_minutes=ttl_minutes,
        timeout_seconds=timeout_seconds, created_at=now,
    )
    _store.save(tool)
    _register_dynamic_tool(tool)
    _log_event("ADD", name=name, hash=tool.code_hash, ttl=str(ttl_minutes))
    await _notify_tools_changed()

    warning_msg = ""
    if warnings:
        warning_msg = f" Warnings: {'; '.join(warnings)}"
    return f"Tool '{name}' registered successfully.{warning_msg}"


@mcp.tool()
async def remove_tool(name: str) -> str:
    """Unregister a dynamic tool and delete its persisted definition."""
    if not _store.has(name):
        return f"Error: Tool '{name}' does not exist."

    _unregister_dynamic_tool(name)
    _store.delete(name)
    _log_event("REMOVE", name=name, reason="user_request")
    await _notify_tools_changed()
    return f"Tool '{name}' removed."


@mcp.tool()
async def list_tools(include_expired: bool = False) -> str:
    """List all registered dynamic tools."""
    tools = _store.list_all(include_expired=include_expired)
    if not tools:
        return "No dynamic tools registered."

    result = []
    for t in tools:
        ttl_remaining = None
        if t.expires_at:
            expires = datetime.fromisoformat(t.expires_at)
            remaining = (expires - datetime.now(timezone.utc)).total_seconds() / 60
            ttl_remaining = max(0, round(remaining, 1))

        result.append({
            "name": t.name,
            "description": t.description,
            "created": t.created_at,
            "last_used": t.last_used,
            "invocation_count": t.invocation_count,
            "ttl_remaining_minutes": ttl_remaining,
            "expired": t.is_expired(),
        })
    return json.dumps(result, indent=2)


@mcp.tool()
async def view_source(name: str) -> str:
    """Inspect the source code of a dynamic tool."""
    tool = _store.get(name)
    if tool is None:
        return f"Error: Tool '{name}' does not exist."
    return tool.code


@mcp.tool()
async def update_tool(
    name: str,
    code: str | None = None,
    description: str | None = None,
    parameters: dict | None = None,
) -> str:
    """Modify an existing dynamic tool's code, description, or parameters."""
    tool = _store.get(name)
    if tool is None:
        return f"Error: Tool '{name}' does not exist."

    updated = []

    if code is not None:
        valid, err = validate_python_syntax(code)
        if not valid:
            return f"Error: {err}"
        tool.code = code
        tool.code_hash = hashlib.sha256(code.encode()).hexdigest()[:16]
        updated.append("code")

    if description is not None:
        tool.description = description
        updated.append("description")

    if parameters is not None:
        tool.parameters = parameters
        updated.append("parameters")

    if not updated:
        return "Nothing to update. Provide at least one of: code, description, parameters."

    _store.save(tool)
    # Re-register to pick up changes
    _unregister_dynamic_tool(name)
    _register_dynamic_tool(tool)
    _log_event("UPDATE", name=name, fields=",".join(updated))
    await _notify_tools_changed()
    return f"Tool '{name}' updated: {', '.join(updated)}."


# --- TTL Expiry Loop ---

async def _expiry_check_loop() -> None:
    """Periodic check for expired tools. Runs every 60 seconds."""
    while True:
        await asyncio.sleep(TTL_CHECK_INTERVAL_SECONDS)
        expired = [t for t in _store.list_all(include_expired=True) if t.is_expired()]
        for tool in expired:
            _unregister_dynamic_tool(tool.name)
            _store.delete(tool.name)
            logger.info(f"Tool '{tool.name}' expired (TTL: {tool.ttl_minutes}m)")
            _log_event("EXPIRE", name=tool.name, reason="ttl_expired",
                       ttl=str(tool.ttl_minutes))
        if expired:
            await _notify_tools_changed()


# --- Server Lifecycle ---

def _init_globals() -> int:
    """Initialize global store and executor. Returns count of loaded tools."""
    global _store, _executor
    _store = ToolStore()
    loaded = _store.init()
    _executor = SandboxExecutor()

    # Register all persisted tools as dynamic MCP tools
    for tool in _store.list_all(include_expired=False):
        _register_dynamic_tool(tool)

    logger.info(f"Tool Factory initialized. Loaded {loaded} tools from disk.")
    return loaded


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    _init_globals()
    # Start TTL expiry loop as background task
    loop = asyncio.new_event_loop()
    loop.create_task(_expiry_check_loop())
    mcp.run(transport="stdio")
