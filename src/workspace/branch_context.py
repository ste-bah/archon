"""Git branch context — tag memories with the current git branch.

Every memory stored via MemoryGraph gets a `branch:{name}` tag.
Branch-scoped queries filter by this tag.
"""

import logging
import os
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)


def get_current_branch(cwd: Optional[str] = None) -> str:
    """Get the current git branch name.

    Returns:
        Branch name (e.g., "main", "feature/xyz").
        "detached:{sha8}" for detached HEAD.
        "unknown" if not a git repo or git fails.
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5,
            cwd=cwd or os.getcwd(),
        )
        if result.returncode != 0:
            return "unknown"

        branch = result.stdout.strip()

        if branch == "HEAD":
            # Detached HEAD — get short SHA
            sha_result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, timeout=5,
                cwd=cwd or os.getcwd(),
            )
            sha = sha_result.stdout.strip() if sha_result.returncode == 0 else "unknown"
            return f"detached:{sha}"

        return branch

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return "unknown"


def branch_tag(branch: Optional[str] = None, cwd: Optional[str] = None) -> str:
    """Get the branch tag string for memory tagging.

    Returns: "branch:{name}" or "branch:detached:{sha}" or "branch:unknown"
    """
    if branch is None:
        branch = get_current_branch(cwd)
    return f"branch:{branch}"


def is_branch_scoped_tag(tag: str) -> bool:
    """Check if a tag is a branch scope tag."""
    return tag.startswith("branch:")


def extract_branch_from_tag(tag: str) -> Optional[str]:
    """Extract branch name from a branch tag. Returns None if not a branch tag."""
    if tag.startswith("branch:"):
        return tag[7:]
    return None


def add_branch_tag(tags: list[str], branch: Optional[str] = None, cwd: Optional[str] = None) -> list[str]:
    """Add branch tag to a tag list (if not already present).

    Returns: New list with branch tag added.
    """
    tag = branch_tag(branch, cwd)
    existing_branch_tags = [t for t in tags if is_branch_scoped_tag(t)]
    if tag in existing_branch_tags:
        return tags
    # Remove any existing branch tags (a memory belongs to one branch)
    clean = [t for t in tags if not is_branch_scoped_tag(t)]
    clean.append(tag)
    return clean


def filter_tags_for_branch(
    tags_to_search: list[str],
    branch: Optional[str] = None,
    include_main: bool = True,
    cwd: Optional[str] = None,
) -> list[str]:
    """Get tags for branch-scoped memory search.

    Args:
        tags_to_search: Base tags for the search.
        branch: Branch to scope to (auto-detected if None).
        include_main: Also include memories from 'main' baseline.
        cwd: Working directory for branch detection.

    Returns:
        Tags list including branch scope tags.
    """
    if branch is None:
        branch = get_current_branch(cwd)

    # The search should return memories tagged with the current branch
    # MemoryGraph search supports tag filtering — we return the branch tag
    # to add to the search criteria
    result = list(tags_to_search)
    result.append(branch_tag(branch))
    if include_main and branch != "main":
        result.append(branch_tag("main"))
    return result
