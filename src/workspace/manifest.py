"""Workspace manifest — multi-project awareness for Archon.

Loads and validates ~/.claude/workspace.json defining which projects
Archon should be aware of. Used by LEANN indexer and MemoryGraph namespacing.
"""

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

WORKSPACE_PATH = Path.home() / ".claude" / "workspace.json"
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
MAX_PROJECTS = 20
DEFAULT_MAX_FILES = 5000
DEFAULT_MAX_MEMORY_MB = 500
DEFAULT_REINDEX_INTERVAL = 30


@dataclass
class ProjectEntry:
    name: str
    path: str
    role: str  # "primary" | "secondary"
    max_files: int = DEFAULT_MAX_FILES
    excludes: list[str] = field(default_factory=list)


@dataclass
class IndexConfig:
    max_memory_mb: int = DEFAULT_MAX_MEMORY_MB
    auto_reindex: bool = True
    reindex_interval_minutes: int = DEFAULT_REINDEX_INTERVAL


@dataclass
class WorkspaceManifest:
    version: str
    projects: list[ProjectEntry]
    index_config: IndexConfig


def load_workspace(path: Path = WORKSPACE_PATH) -> Optional[WorkspaceManifest]:
    """Load and validate workspace manifest. Returns None if missing or invalid."""
    if not path.exists():
        logger.debug(f"No workspace manifest at {path}")
        return None

    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to parse workspace manifest: {e}")
        return None

    try:
        return validate_manifest(data)
    except ValueError as e:
        logger.warning(f"Invalid workspace manifest: {e}")
        return None


def validate_manifest(data: dict) -> WorkspaceManifest:
    """Validate raw JSON dict. Raises ValueError on invalid data."""
    if not isinstance(data, dict):
        raise ValueError("Workspace manifest must be a JSON object.")

    # Version
    version = data.get("version")
    if version != "1.0":
        raise ValueError(f"version must be '1.0', got '{version}'")

    # Projects
    projects_raw = data.get("projects")
    if not isinstance(projects_raw, list) or len(projects_raw) < 1:
        raise ValueError("projects must be a non-empty array (at least 1 project)")
    if len(projects_raw) > MAX_PROJECTS:
        raise ValueError(f"projects must have at most {MAX_PROJECTS} entries, got {len(projects_raw)}")

    seen_names: set[str] = set()
    projects: list[ProjectEntry] = []

    for i, p in enumerate(projects_raw):
        if not isinstance(p, dict):
            raise ValueError(f"projects[{i}] must be an object")

        # Name
        name = p.get("name", "")
        if not NAME_PATTERN.match(name):
            raise ValueError(
                f"projects[{i}].name '{name}' is invalid. "
                f"Must match pattern: {NAME_PATTERN.pattern}"
            )
        if name in seen_names:
            raise ValueError(f"Duplicate project name: '{name}'")
        seen_names.add(name)

        # Path
        path_str = p.get("path", "")
        if not os.path.isabs(path_str):
            raise ValueError(
                f"projects[{i}].path '{path_str}' must be an absolute path"
            )

        # Resolve symlinks and check for loops
        try:
            resolved = str(Path(path_str).resolve())
            if resolved != path_str and os.path.islink(path_str):
                logger.info(f"projects[{i}].path '{path_str}' is a symlink -> '{resolved}'")
        except (OSError, RuntimeError):
            raise ValueError(f"projects[{i}].path '{path_str}' has a symlink loop or is unresolvable")

        # Warn (don't error) if path doesn't exist
        if not os.path.isdir(path_str):
            logger.warning(f"projects[{i}].path '{path_str}' does not exist (will skip at index time)")

        # Role
        role = p.get("role", "")
        if role not in ("primary", "secondary"):
            raise ValueError(
                f"projects[{i}].role must be 'primary' or 'secondary', got '{role}'"
            )

        # MaxFiles (guard bool-is-int: isinstance(True, int) is True)
        max_files = p.get("maxFiles", DEFAULT_MAX_FILES)
        if isinstance(max_files, bool) or not isinstance(max_files, int) or max_files < 100 or max_files > 50000:
            raise ValueError(
                f"projects[{i}].maxFiles must be 100..50000 integer, got {max_files}"
            )

        # Reject unknown keys (additionalProperties: false)
        ALLOWED_PROJECT_KEYS = {"name", "path", "role", "maxFiles", "excludes"}
        unknown = set(p.keys()) - ALLOWED_PROJECT_KEYS
        if unknown:
            raise ValueError(
                f"projects[{i}] has unknown keys: {unknown}. Allowed: {ALLOWED_PROJECT_KEYS}"
            )

        # Excludes
        excludes = p.get("excludes", [])
        if not isinstance(excludes, list):
            raise ValueError(f"projects[{i}].excludes must be an array")

        projects.append(ProjectEntry(
            name=name,
            path=path_str,
            role=role,
            max_files=max_files,
            excludes=excludes,
        ))

    # IndexConfig with range validation
    ic_raw = data.get("indexConfig", {})
    if not isinstance(ic_raw, dict):
        raise ValueError("indexConfig must be an object")

    max_mem = ic_raw.get("maxMemoryMB", DEFAULT_MAX_MEMORY_MB)
    if not isinstance(max_mem, int) or max_mem < 100 or max_mem > 2000:
        raise ValueError(f"indexConfig.maxMemoryMB must be 100..2000, got {max_mem}")

    reindex_interval = ic_raw.get("reindexIntervalMinutes", DEFAULT_REINDEX_INTERVAL)
    if not isinstance(reindex_interval, int) or reindex_interval < 5 or reindex_interval > 1440:
        raise ValueError(f"indexConfig.reindexIntervalMinutes must be 5..1440, got {reindex_interval}")

    # Reject unknown indexConfig keys
    ALLOWED_IC_KEYS = {"maxMemoryMB", "autoReindex", "reindexIntervalMinutes"}
    unknown_ic = set(ic_raw.keys()) - ALLOWED_IC_KEYS
    if unknown_ic:
        raise ValueError(f"indexConfig has unknown keys: {unknown_ic}")

    index_config = IndexConfig(
        max_memory_mb=max_mem,
        auto_reindex=ic_raw.get("autoReindex", True),
        reindex_interval_minutes=reindex_interval,
    )

    # Reject unknown top-level keys
    ALLOWED_TOP_KEYS = {"version", "projects", "indexConfig"}
    unknown_top = set(data.keys()) - ALLOWED_TOP_KEYS
    if unknown_top:
        raise ValueError(f"Unknown top-level keys: {unknown_top}")

    return WorkspaceManifest(
        version=version,
        projects=projects,
        index_config=index_config,
    )


def project_slug_from_cwd(manifest: WorkspaceManifest, cwd: str) -> Optional[str]:
    """Return the project slug whose path is a prefix of cwd. None if no match.

    If multiple projects match (nested paths), the longest prefix wins.
    """
    best_match: Optional[str] = None
    best_length = 0

    for project in manifest.projects:
        proj_path = project.path.rstrip("/")
        if cwd == proj_path or cwd.startswith(proj_path + "/"):
            if len(proj_path) > best_length:
                best_match = project.name
                best_length = len(proj_path)

    return best_match


def get_add_dir_args(manifest: WorkspaceManifest, primary_path: str) -> list[str]:
    """Return ['--add-dir', '/path1', '--add-dir', '/path2', ...] for non-primary projects."""
    args: list[str] = []
    primary_normalized = primary_path.rstrip("/")

    for project in manifest.projects:
        proj_normalized = project.path.rstrip("/")
        if proj_normalized != primary_normalized:
            args.extend(["--add-dir", project.path])

    return args
