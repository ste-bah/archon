"""MemoryGraph namespace convention enforcement.

Validates and normalizes memory keys to follow the {project-slug}/area/name format.
Auto-detects project slug from cwd + workspace manifest.
"""

import logging
import os
import re
from typing import Optional

from .manifest import load_workspace, project_slug_from_cwd, NAME_PATTERN

logger = logging.getLogger(__name__)

VALID_AREAS = frozenset({
    "api", "database", "frontend", "events", "performance",
    "bugs", "tests", "docs", "contracts", "patterns", "decisions",
    "personality", "monitor", "benchmark", "git", "workspace",
})

GLOBAL_PREFIX = "_global"
KEY_MAX_LENGTH = 300
NAME_MAX_LENGTH = 200
AREA_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,30}$")
PATH_TRAVERSAL_PATTERN = re.compile(r"\.\.[/\\]")

# Cached project slug (resolved once per process)
_cached_slug: Optional[str] = None


def get_current_project_slug() -> str:
    """Resolve the current project slug from cwd + workspace manifest.

    Returns '_global' if cwd doesn't match any manifest entry.
    Caches result for process lifetime.
    """
    global _cached_slug
    if _cached_slug is not None:
        return _cached_slug

    manifest = load_workspace()
    if manifest is None:
        _cached_slug = GLOBAL_PREFIX
        return _cached_slug

    cwd = os.getcwd()
    slug = project_slug_from_cwd(manifest, cwd)
    if slug is None:
        logger.warning("cwd %s not in workspace manifest. Using '_global'.", cwd)
        _cached_slug = GLOBAL_PREFIX
    else:
        _cached_slug = slug
    return _cached_slug


def reset_slug_cache() -> None:
    """Reset cached slug. Used in tests and after cwd changes."""
    global _cached_slug
    _cached_slug = None


def validate_namespace_key(key: str, strict: bool = False) -> tuple[bool, str]:
    """Validate a memory key follows namespace convention.

    Returns (is_valid, message).
    """
    if not key:
        return False, "Key is empty"

    if len(key) > KEY_MAX_LENGTH:
        return False, f"Key length {len(key)} exceeds maximum {KEY_MAX_LENGTH}"

    if PATH_TRAVERSAL_PATTERN.search(key):
        return False, "Key contains path traversal sequence"

    parts = key.split("/")
    if len(parts) < 2:
        return False, "Key must have at least 2 slash-separated segments: {prefix}/{rest}"

    # First segment: project slug or _global
    prefix = parts[0]
    if prefix != GLOBAL_PREFIX and not NAME_PATTERN.match(prefix):
        return False, f"First segment '{prefix}' is not a valid project slug or '_global'"

    # Second segment: area
    if len(parts) >= 2:
        area = parts[1]
        if not AREA_PATTERN.match(area):
            if strict:
                return False, f"Area '{area}' does not match pattern {AREA_PATTERN.pattern}"
        elif area not in VALID_AREAS:
            if strict:
                return False, f"Area '{area}' is not in the known areas list"
            else:
                logger.debug(f"Unknown area '{area}' in key '{key}' (allowed in non-strict mode)")

    # Name length check
    name_part = "/".join(parts[2:]) if len(parts) > 2 else ""
    if len(name_part) > NAME_MAX_LENGTH:
        return False, f"Name portion length {len(name_part)} exceeds maximum {NAME_MAX_LENGTH}"

    return True, "ok"


def normalize_key(key: str, project_slug: Optional[str] = None) -> str:
    """Ensure key has proper namespace prefix.

    Prepends project slug if not already prefixed.
    Raises ValueError on path traversal or excessive length.
    """
    if PATH_TRAVERSAL_PATTERN.search(key):
        raise ValueError(f"Key contains path traversal sequence: {key}")

    if not key:
        raise ValueError("Key cannot be empty")

    # Check if already prefixed with a known slug or _global
    parts = key.split("/")
    first = parts[0]

    if first == GLOBAL_PREFIX:
        result = key
    elif NAME_PATTERN.match(first) and len(parts) >= 3 and first not in VALID_AREAS:
        # Already has a valid prefix with slug/area/name structure
        # and the first segment is NOT a known area (which would mean it's missing a slug)
        result = key
    else:
        # No valid prefix — prepend the project slug
        if project_slug is None:
            project_slug = get_current_project_slug()
        result = f"{project_slug}/{key}"

    if len(result) > KEY_MAX_LENGTH:
        raise ValueError(f"Normalized key length {len(result)} exceeds {KEY_MAX_LENGTH}")

    return result


def extract_project_from_key(key: str) -> tuple[str, str]:
    """Split a namespaced key into (project_slug, remainder).

    Raises ValueError if key has no recognizable prefix.
    """
    if "/" not in key:
        raise ValueError(f"Key '{key}' has no slash separator")

    parts = key.split("/", 1)
    prefix = parts[0]

    if prefix == GLOBAL_PREFIX or NAME_PATTERN.match(prefix):
        return prefix, parts[1]

    raise ValueError(f"Key '{key}' has no valid namespace prefix")


def is_global_key(key: str) -> bool:
    """Check if a key uses the _global/ prefix."""
    return key.startswith(f"{GLOBAL_PREFIX}/")
