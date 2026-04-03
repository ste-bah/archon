"""Code Cartographer MCP Server — FastMCP stdio proxy to the cartographer daemon.

Run with: python3 -m src.code_cartographer.mcp_server

Exposes 6 tools that forward requests to the cartographer daemon at
http://127.0.0.1:8042 and return human-readable text for Claude.
"""

import asyncio
import json
import logging
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("cartographer-mcp")

DAEMON = "http://127.0.0.1:8042"
SCAN_TIMEOUT = 120
QUERY_TIMEOUT = 10
NOT_RUNNING = (
    "Cartographer daemon not running. "
    "Start it with: bash scripts/archon/cartographer-start.sh"
)
mcp = FastMCP("cartographer")


def _http_get(path: str, timeout: int = QUERY_TIMEOUT) -> dict:
    url = f"{DAEMON}{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _http_post(path: str, body: dict, timeout: int = QUERY_TIMEOUT) -> dict:
    url = f"{DAEMON}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


async def _run(func, *args, **kwargs):
    """Run a blocking function in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(func, *args, **kwargs))


def _daemon_error(exc: Exception) -> str:
    if isinstance(exc, (urllib.error.URLError, ConnectionError, OSError)):
        return NOT_RUNNING
    return f"Cartographer error: {exc}"


def _fmt_scan(data: dict, name: str = "") -> str:
    display_name = name or data.get("name", "?")
    lines = [f"Scan complete: {display_name}"]
    lines.append(f"  Files: {data.get('files', '?')} | Symbols: {data.get('symbols', '?')} | Edges: {data.get('edges', '?')}")
    lines.append(f"  Cycles: {data.get('cycles', '?')} | Cached: {data.get('cached', '?')}")
    return "\n".join(lines)


def _fmt_query(data: dict) -> str:
    qtype = data.get("query_type", "")
    results = data.get("results", data)

    if qtype == "hotspots" and isinstance(results, list):
        header = f"{'File':<46} {'Fan-in':>7}  {'Fan-out':>7}  {'Score':>5}"
        rows = [header, "-" * len(header)]
        for r in results:
            fname = r.get("file", r.get("name", "?"))
            fan_in = r.get("fan_in", 0)
            fan_out = r.get("fan_out", 0)
            score = fan_in + fan_out
            rows.append(f"{fname:<46} {fan_in:>7}  {fan_out:>7}  {score:>5}")
        return "\n".join(rows)

    if qtype == "cycles" and isinstance(results, list):
        if not results:
            return "No dependency cycles found."
        project_root = data.get("project_root", "")
        items = []
        for i, c in enumerate(results, 1):
            if isinstance(c, list):
                if project_root:
                    c = [str(Path(f).relative_to(project_root)) if f.startswith(project_root) else f for f in c]
                # Close the cycle: append first element
                display = " -> ".join(c)
                if len(c) > 1:
                    display += f" -> {c[0]}"
                items.append(f"  {i}. {display}")
            else:
                items.append(f"  {i}. {c}")
        return "Dependency cycles found:\n" + "\n".join(items)

    if isinstance(results, list):
        return "\n".join(f"  - {json.dumps(r) if isinstance(r, dict) else r}" for r in results) or "(no results)"

    if isinstance(results, dict):
        return "\n".join(f"  {k}: {v}" for k, v in results.items())

    return str(results)


def _fmt_list(data: dict) -> str:
    projects = data.get("projects", [])
    if not projects:
        return "No scanned projects."
    header = f"{'Project':<30} {'Files':>6} {'Symbols':>8} {'Last Scan'}"
    lines = [header, "-" * len(header)]
    for p in projects:
        lines.append(
            f"{p.get('name','?'):<30} {p.get('files','?'):>6} "
            f"{p.get('symbols','?'):>8} {p.get('last_scan','?')}"
        )
    return "\n".join(lines)


def _fmt_status(data: dict) -> str:
    return "Cartographer daemon status:\n" + "\n".join(f"  {k}: {v}" for k, v in data.items())


def _fmt_focus(data: dict) -> str:
    lines = []
    files = data.get("files", [])
    if files:
        lines.append(f"Focus on module -- {len(files)} files:")
        lines.extend(f"  - {f}" for f in files)
    diagram = data.get("mermaid", data.get("diagram", ""))
    if diagram:
        lines.extend(["", "```mermaid", diagram, "```"])
    return "\n".join(lines) if lines else json.dumps(data, indent=2)


@mcp.tool()
async def cartographer_scan(
    path: str,
    name: str = "",
    languages: str = "",
    force: bool = False,
) -> str:
    """Scan a project directory and build dependency graph.

    Args:
        path: Absolute path to the project directory
        name: Project name (default: directory name)
        languages: Comma-separated language filter (py,ts,rs,cpp). Empty = all.
        force: Force rescan even if cache is fresh
    """
    if not name:
        name = Path(path).name
    body: dict = {"path": path, "name": name,
                  **({"languages": languages} if languages else {}),
                  **({"force": True} if force else {})}
    try:
        data = await _run(_http_post, "/scan", body, SCAN_TIMEOUT)
        return _fmt_scan(data, name=name)
    except Exception as exc:
        logger.error("scan failed: %s", exc)
        return _daemon_error(exc)


@mcp.tool()
async def cartographer_summary(name: str) -> str:
    """Get the architecture summary for a scanned project. Returns compact markdown that fits in context."""
    try:
        data = await _run(_http_get, f"/summary?name={name}")
        return data.get("markdown", data.get("summary", json.dumps(data, indent=2)))
    except Exception as exc:
        logger.error("summary failed: %s", exc)
        return _daemon_error(exc)


@mcp.tool()
async def cartographer_query(
    name: str,
    query_type: str,
    target: str = "",
    top_n: int = 20,
) -> str:
    """Query a project's dependency graph.

    Args:
        name: Project name
        query_type: One of: hotspots, cycles, file-deps, symbol-search, file-info
        target: File path or search query (for file-deps, symbol-search, file-info)
        top_n: Max results (for hotspots)
    """
    body: dict = {"name": name, "type": query_type, "top_n": top_n,
                  **({"target": target} if target else {})}
    try:
        data = await _run(_http_post, "/query", body)
        return _fmt_query(data)
    except Exception as exc:
        logger.error("query failed: %s", exc)
        return _daemon_error(exc)


@mcp.tool()
async def cartographer_focus(
    name: str,
    module: str,
    depth: int = 2,
) -> str:
    """Get focused dependency view of a module and its neighbors.

    Args:
        name: Project name
        module: Module/directory path to focus on (e.g. "src/auth")
        depth: How many hops from the module to include (default 2)
    """
    body = {"name": name, "module": module, "depth": depth}
    try:
        data = await _run(_http_post, "/focus", body)
        return _fmt_focus(data)
    except Exception as exc:
        logger.error("focus failed: %s", exc)
        return _daemon_error(exc)


@mcp.tool()
async def cartographer_list() -> str:
    """List all scanned projects with stats."""
    try:
        data = await _run(_http_get, "/list")
        return _fmt_list(data)
    except Exception as exc:
        logger.error("list failed: %s", exc)
        return _daemon_error(exc)


@mcp.tool()
async def cartographer_status() -> str:
    """Check cartographer daemon status, cache freshness, and loaded projects."""
    try:
        data = await _run(_http_get, "/status")
        return _fmt_status(data)
    except Exception as exc:
        logger.error("status failed: %s", exc)
        return _daemon_error(exc)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    mcp.run(transport="stdio")
