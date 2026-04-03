"""File discovery and language detection."""

from __future__ import annotations

import fnmatch
import logging
from pathlib import Path

from .models import Language

logger = logging.getLogger("cartographer.scanner")

# Extensions → Language mapping
EXTENSION_MAP: dict[str, Language] = {
    ".py": Language.PYTHON,
    ".pyi": Language.PYTHON,
    ".ts": Language.TYPESCRIPT,
    ".tsx": Language.TSX,
    ".js": Language.JAVASCRIPT,
    ".jsx": Language.TSX,
    ".mjs": Language.JAVASCRIPT,
    ".cjs": Language.JAVASCRIPT,
    ".rs": Language.RUST,
    ".cpp": Language.CPP,
    ".cxx": Language.CPP,
    ".cc": Language.CPP,
    ".c": Language.C,
    ".h": Language.CPP,  # default; could be C
    ".hpp": Language.CPP,
    ".hxx": Language.CPP,
}

# Always exclude these directories regardless of .gitignore
HARDCODED_EXCLUDES: set[str] = {
    "node_modules",
    "__pycache__",
    ".pycache",
    ".git",
    ".svn",
    ".hg",
    "target",  # Rust build output
    "build",
    "dist",
    ".venv",
    "venv",
    ".env",
    ".tox",
    "site-packages",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".angular",
}

# Skip files matching these patterns
SKIP_PATTERNS: set[str] = {
    "*.min.js",
    "*.min.css",
    "*.bundle.js",
    "*.generated.*",
    "*.d.ts",  # declaration files — optional, could be useful
    "*.map",
    "*.lock",
}


def detect_language(path: Path) -> Language | None:
    """Detect language from file extension."""
    return EXTENSION_MAP.get(path.suffix.lower())


def parse_gitignore(gitignore_path: Path) -> list[str]:
    """Parse a .gitignore file into a list of patterns."""
    patterns: list[str] = []
    if not gitignore_path.is_file():
        return patterns
    try:
        for line in gitignore_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(line)
    except (OSError, UnicodeDecodeError):
        logger.warning("Failed to read %s", gitignore_path)
    return patterns


def _matches_any(name: str, patterns: list[str]) -> bool:
    """Check if a name matches any gitignore-style pattern."""
    for pat in patterns:
        pat = pat.rstrip("/")
        if fnmatch.fnmatch(name, pat):
            return True
    return False


def scan_directory(
    root: Path,
    *,
    languages: set[Language] | None = None,
    max_depth: int | None = None,
    extra_excludes: list[str] | None = None,
) -> list[tuple[Path, Language]]:
    """Discover source files in a directory tree.

    Returns list of (absolute_path, language) tuples.
    Respects .gitignore files at each directory level.
    """
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Not a directory: {root}")

    results: list[tuple[Path, Language]] = []
    gitignore_patterns = parse_gitignore(root / ".gitignore")
    if extra_excludes:
        gitignore_patterns.extend(extra_excludes)

    def _walk(directory: Path, depth: int, patterns: list[str]) -> None:
        if max_depth is not None and depth > max_depth:
            return

        # Check for nested .gitignore
        nested_gi = directory / ".gitignore"
        local_patterns = patterns.copy()
        if nested_gi.is_file() and directory != root:
            local_patterns.extend(parse_gitignore(nested_gi))

        try:
            entries = sorted(directory.iterdir())
        except PermissionError:
            logger.warning("Permission denied: %s", directory)
            return

        for entry in entries:
            name = entry.name

            if entry.is_dir():
                if name in HARDCODED_EXCLUDES:
                    continue
                if name.startswith(".") and name not in ("."):
                    continue
                if _matches_any(name, local_patterns):
                    continue
                _walk(entry, depth + 1, local_patterns)

            elif entry.is_file():
                if any(fnmatch.fnmatch(name, sp) for sp in SKIP_PATTERNS):
                    continue
                if _matches_any(name, local_patterns):
                    continue

                lang = detect_language(entry)
                if lang is None:
                    continue
                if languages and lang not in languages:
                    continue

                results.append((entry, lang))

    _walk(root, 0, gitignore_patterns)
    return results
