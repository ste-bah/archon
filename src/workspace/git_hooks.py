"""Git hook handlers for branch-aware memory.

Called by post-checkout and post-merge git hooks.
Handles branch switch logging, merge tag-and-promote, and orphan detection.
"""

import logging
import os
import subprocess
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from .branch_context import get_current_branch, branch_tag

# Branches that should NEVER be reported as orphaned
_SAFE_BRANCHES = {"main", "master", "_global", "unknown"}

logger = logging.getLogger(__name__)


def on_branch_switch(prev_branch: str, new_branch: str) -> dict:
    """Handle a branch switch. Called by post-checkout hook.

    Logs the switch. Does NOT modify memories — that's handled by
    branch_context.add_branch_tag() at store time.

    Returns dict with switch details for logging.
    """
    result = {
        "event": "branch_switch",
        "from": prev_branch,
        "to": new_branch,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    logger.info(f"Branch switch: {prev_branch} -> {new_branch}")
    return result


def on_branch_merge(
    merged_branch: str,
    target_branch: str,
    squash: bool = False,
    memory_searcher: Optional[Callable] = None,
    memory_updater: Optional[Callable] = None,
) -> dict:
    """Handle a branch merge. Called by post-merge hook.

    Tag-and-promote: finds all memories with branch:{merged_branch} tag
    and adds merged-to:{target_branch} + merge-date:{iso} tags.

    Args:
        merged_branch: The branch that was merged (source).
        target_branch: The branch merged into (usually main).
        squash: Whether this was a squash merge.
        memory_searcher: Callable(tags=[str]) -> list[dict]. Search MemoryGraph.
        memory_updater: Callable(mem_id, tags=[str]). Update MemoryGraph tags.

    Returns dict with promotion results.
    """
    source_tag = branch_tag(merged_branch)
    merge_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    promotion_tags = [
        f"merged-to:{target_branch}",
        f"merge-date:{merge_date}",
    ]
    if squash:
        promotion_tags.append("merge-type:squash")

    result = {
        "event": "branch_merge",
        "merged_branch": merged_branch,
        "target_branch": target_branch,
        "squash": squash,
        "source_tag": source_tag,
        "promotion_tags": promotion_tags,
        "promoted_count": 0,
    }

    if memory_searcher and memory_updater:
        # Find all memories with the source branch tag
        memories = memory_searcher(tags=[source_tag])
        for mem in memories:
            existing_tags = mem.get("tags", [])
            new_tags = list(dict.fromkeys(existing_tags + promotion_tags))
            memory_updater(mem["id"], tags=new_tags)
            result["promoted_count"] += 1

    logger.info(
        f"Merge: {merged_branch} -> {target_branch}. "
        f"Promoted {result['promoted_count']} memories."
    )
    return result


def get_worktree_branches(cwd: Optional[str] = None) -> set[str]:
    """Get set of branch names that are checked out in git worktrees.

    These branches should NOT be considered orphaned even if they
    don't appear in `git branch --list` from the main checkout.
    """
    try:
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            capture_output=True, text=True, timeout=5,
            cwd=cwd or os.getcwd(),
        )
        if result.returncode != 0:
            return set()

        branches = set()
        for line in result.stdout.splitlines():
            if line.startswith("branch "):
                # Format: "branch refs/heads/feature-xyz"
                ref = line.split(" ", 1)[1]
                branch_name = ref.replace("refs/heads/", "")
                branches.add(branch_name)
        return branches

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return set()


def get_local_branches(cwd: Optional[str] = None) -> set[str]:
    """Get set of all local branch names."""
    try:
        result = subprocess.run(
            ["git", "branch", "--list", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=5,
            cwd=cwd or os.getcwd(),
        )
        if result.returncode != 0:
            return set()

        return {b.strip() for b in result.stdout.splitlines() if b.strip()}

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return set()


def detect_orphaned_branches(
    stored_branch_tags: list[str],
    cwd: Optional[str] = None,
) -> list[str]:
    """Detect branches that have memories but no longer exist in git.

    Compares stored branch tags against git branch --list AND git worktree list.

    Args:
        stored_branch_tags: List of "branch:{name}" tags from MemoryGraph.
        cwd: Working directory for git commands.

    Returns:
        List of branch names that are orphaned (have memories but no git branch).
    """
    # Get all known branches from git
    local_branches = get_local_branches(cwd)
    worktree_branches = get_worktree_branches(cwd)
    all_known = local_branches | worktree_branches
    all_known.update(_SAFE_BRANCHES)

    orphaned = []
    for tag in stored_branch_tags:
        if not tag.startswith("branch:"):
            continue
        branch_name = tag[7:]  # strip "branch:" prefix

        # Skip detached HEAD tags
        if branch_name.startswith("detached:"):
            continue

        if branch_name not in all_known:
            orphaned.append(branch_name)

    return orphaned


def tag_orphaned_memories(
    orphaned_branches: list[str],
    memory_searcher: Optional[Callable] = None,
    memory_updater: Optional[Callable] = None,
) -> int:
    """Add 'orphaned:true' tag to memories from orphaned branches.

    Returns count of memories tagged.
    """
    count = 0
    if not memory_searcher or not memory_updater:
        return count

    for branch in orphaned_branches:
        source_tag = branch_tag(branch)
        memories = memory_searcher(tags=[source_tag])
        for mem in memories:
            existing_tags = mem.get("tags", [])
            if "orphaned:true" not in existing_tags:
                new_tags = list(dict.fromkeys(existing_tags + ["orphaned:true"]))
                memory_updater(mem["id"], tags=new_tags)
                count += 1

    if count > 0:
        logger.info(f"Tagged {count} memories as orphaned from branches: {orphaned_branches}")

    return count
