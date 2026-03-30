"""Workspace search — cross-project LEANN search.

Wraps LEANN search_code to query across all indexed repositories.
Groups results by repository and returns typed results.
"""

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class WorkspaceSearchResult:
    repository: str
    file_path: str
    content: str
    score: float
    line_number: Optional[int] = None


def search_workspace(
    query: str,
    max_results: int = 10,
    repository: Optional[str] = None,
    leann_caller: Optional[Any] = None,
) -> list[WorkspaceSearchResult]:
    """Search LEANN across all workspace repositories.

    Args:
        query: Search query string.
        max_results: Maximum results (default 10, max 50).
        repository: Optional — scope to single repo name.
        leann_caller: Callable for LEANN MCP operations (for testing).

    Returns:
        List of WorkspaceSearchResult, sorted by score descending.
    """
    if not query or not query.strip():
        return []

    max_results = min(max(1, max_results), 50)

    if leann_caller:
        raw_results = leann_caller(
            "search_code",
            query=query,
            max_results=max_results,
            repository=repository,
        )
    else:
        # Production: would call mcp__leann-search__search_code
        raw_results = []

    return _parse_results(raw_results)


def _parse_results(raw_results: list[dict]) -> list[WorkspaceSearchResult]:
    """Parse raw LEANN results into typed WorkspaceSearchResult objects."""
    results = []
    for r in raw_results:
        results.append(WorkspaceSearchResult(
            repository=r.get("repository", "unknown"),
            file_path=r.get("filePath", r.get("file_path", "")),
            content=r.get("content", ""),
            score=r.get("score", 0.0),
            line_number=r.get("lineNumber", r.get("line_number")),
        ))
    return sorted(results, key=lambda x: x.score, reverse=True)


def group_by_repository(results: list[WorkspaceSearchResult]) -> dict[str, list[WorkspaceSearchResult]]:
    """Group results by repository name."""
    grouped: dict[str, list[WorkspaceSearchResult]] = {}
    for r in results:
        grouped.setdefault(r.repository, []).append(r)
    return grouped
