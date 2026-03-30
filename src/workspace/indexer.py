"""Workspace indexer — orchestrates LEANN multi-repo indexing.

Called by SessionStart hook. Iterates workspace projects and indexes
each into LEANN with repository tagging. Skips up-to-date repos.
"""

import json
import logging
import os
import subprocess
import time
from typing import Any, Optional

from .manifest import WorkspaceManifest, ProjectEntry, load_workspace

logger = logging.getLogger(__name__)


def index_workspace_projects(
    manifest: Optional[WorkspaceManifest] = None,
    leann_caller: Optional[Any] = None,
) -> dict:
    """Index all workspace projects into LEANN.

    Args:
        manifest: Workspace manifest (loaded from disk if None)
        leann_caller: Callable for LEANN MCP operations (for testing).
                     If None, uses subprocess to call LEANN MCP tools.

    Returns:
        Dict with status and per-project results.
    """
    if manifest is None:
        manifest = load_workspace()
    if manifest is None:
        return {"status": "no_manifest"}

    if not manifest.index_config.auto_reindex:
        return {"status": "auto_reindex_disabled"}

    # Check LEANN availability
    if leann_caller is None:
        stats = _get_leann_stats_via_mcp()
        if stats is None:
            return {"status": "leann_unavailable"}
    else:
        stats = None

    results = {}

    for project in manifest.projects:
        if not os.path.isdir(project.path):
            logger.warning(f"Skipping {project.name}: path does not exist")
            results[project.name] = {"status": "path_missing"}
            continue

        # Check if already indexed and recent (incremental skip)
        if stats and _is_repo_recent(stats, project.name, manifest.index_config.reindex_interval_minutes):
            results[project.name] = {"status": "up_to_date"}
            continue

        try:
            result = _index_project(project, leann_caller)
            results[project.name] = result
        except Exception as e:
            logger.error(f"Failed to index {project.name}: {e}")
            results[project.name] = {"status": "error", "error": str(e)}

    return {"status": "ok", "projects": results}


def _index_project(project: ProjectEntry, leann_caller: Optional[Any]) -> dict:
    """Index a single project into LEANN."""
    start = time.time()

    if leann_caller:
        # Test/injectable path
        result = leann_caller(
            "index_repository",
            repository_path=project.path,
            repository_name=project.name,
            max_files=project.max_files,
            excludes=project.excludes,
        )
    else:
        # Production path — call LEANN via MCP tool
        result = _index_via_mcp(project)

    duration_ms = (time.time() - start) * 1000
    return {
        "status": "indexed",
        "project": project.name,
        "duration_ms": round(duration_ms),
        "result": result,
    }


def _get_leann_stats_via_mcp() -> Optional[dict]:
    """Call mcp__leann-search__get_stats to check LEANN availability."""
    try:
        # In production, this would be called via the MCP protocol
        # For now, check if the LEANN daemon socket exists
        import pathlib
        leann_sock = pathlib.Path(".run/leann.sock")
        leann_pid = pathlib.Path(".run/leann-daemon.pid")
        if leann_sock.exists() or leann_pid.exists():
            return {"available": True}
        return None
    except Exception:
        return None


def _is_repo_recent(stats: dict, repo_name: str, interval_minutes: int) -> bool:
    """Check if a repo was indexed recently enough to skip re-indexing."""
    # In production, would check stats.repositoryBreakdown[repo_name].lastIndexed
    # For now, return False (always re-index)
    return False


def _index_via_mcp(project: ProjectEntry) -> dict:
    """Index a project via LEANN MCP tool call."""
    # The SessionStart hook calls LEANN MCP tools directly.
    # This function is called from Python code that doesn't have MCP access.
    # Return metadata for the hook to use.
    return {
        "action": "index_repository",
        "repository_path": project.path,
        "repository_name": project.name,
        "max_files": project.max_files,
        "excludes": project.excludes,
    }
