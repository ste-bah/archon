"""Import resolver — maps ImportInfo entries to project file paths."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .models import (
    Edge,
    EdgeKind,
    FileNode,
    ImportInfo,
    Language,
    UnresolvedImport,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_imports(
    files: dict[Path, FileNode],
    root: Path,
) -> tuple[list[Edge], list[UnresolvedImport]]:
    """Resolve every import across *files* and return edges + unresolved."""
    known: set[Path] = set(files)
    edges: list[Edge] = []
    unresolved: list[UnresolvedImport] = []
    tsconfig = TsconfigResolver(root)

    for node in files.values():
        for imp in node.imports:
            result = _resolve_one(imp, node, root, known, tsconfig)
            if isinstance(result, Edge):
                edges.append(result)
            else:
                unresolved.append(result)

    return edges, unresolved


# ---------------------------------------------------------------------------
# Per-import dispatch
# ---------------------------------------------------------------------------

def _resolve_one(
    imp: ImportInfo,
    node: FileNode,
    root: Path,
    known: set[Path],
    tsconfig: TsconfigResolver,
) -> Edge | UnresolvedImport:
    if imp.is_dynamic:
        return UnresolvedImport(node.path, imp.module, "dynamic", imp.line)

    kind = EdgeKind.TYPE_IMPORT if imp.is_type_only else EdgeKind.IMPORT

    lang = node.language
    if lang == Language.PYTHON:
        return _resolve_python(imp, node, root, known, kind)
    if lang in (Language.TYPESCRIPT, Language.TSX, Language.JAVASCRIPT):
        return _resolve_ts(imp, node, root, known, kind, tsconfig)
    if lang == Language.RUST:
        return _resolve_rust(imp, node, root, known, kind)
    if lang in (Language.CPP, Language.C):
        return _resolve_cpp(imp, node, root, known, kind)

    return UnresolvedImport(node.path, imp.module, "not_found", imp.line)


# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------

_PYTHON_EXTENSIONS = (".py",)


def _resolve_python(
    imp: ImportInfo,
    node: FileNode,
    root: Path,
    known: set[Path],
    kind: EdgeKind,
) -> Edge | UnresolvedImport:
    module = imp.module

    if imp.is_relative:
        # Count leading dots already stripped by parser — encoded as
        # module starting with dots, e.g. ".models" or "..shared.config".
        dots = 0
        for ch in module:
            if ch == ".":
                dots += 1
            else:
                break
        rest = module[dots:]
        base = node.path.parent
        for _ in range(dots - 1):
            base = base.parent
        parts = rest.split(".") if rest else []
        return _try_python_path(base, parts, node, imp, known, kind)

    # Absolute import — check if it maps to a project file.
    parts = module.split(".")
    target = _try_python_path(root, parts, node, imp, known, kind)
    if isinstance(target, Edge):
        return target
    # Treat as external (stdlib / third-party).
    return UnresolvedImport(node.path, module, "external", imp.line)


def _try_python_path(
    base: Path,
    parts: list[str],
    node: FileNode,
    imp: ImportInfo,
    known: set[Path],
    kind: EdgeKind,
) -> Edge | UnresolvedImport:
    if not parts:
        # `from . import something` — resolve to __init__.py in base
        init = base / "__init__.py"
        if init in known:
            return Edge(node.path, init, kind, imp.names)
        return UnresolvedImport(node.path, imp.module, "not_found", imp.line)

    rel = Path(*parts) if len(parts) > 1 else Path(parts[0])
    candidates = [
        base / rel.with_suffix(".py"),
        base / rel / "__init__.py",
    ]
    for c in candidates:
        if c in known:
            return Edge(node.path, c, kind, imp.names)
    return UnresolvedImport(node.path, imp.module, "not_found", imp.line)


# ---------------------------------------------------------------------------
# TypeScript / JavaScript
# ---------------------------------------------------------------------------

_TS_EXTENSIONS = (".ts", ".tsx", ".js")
_TS_INDEX_FILES = ("index.ts", "index.tsx", "index.js")


def _resolve_ts(
    imp: ImportInfo,
    node: FileNode,
    root: Path,
    known: set[Path],
    kind: EdgeKind,
    tsconfig: TsconfigResolver,
) -> Edge | UnresolvedImport:
    module = imp.module

    if not imp.is_relative:
        # Try tsconfig paths first.
        mapped = tsconfig.resolve(module)
        if mapped:
            for candidate in _ts_candidates(root / mapped):
                if candidate in known:
                    return Edge(node.path, candidate, kind, imp.names)
        return UnresolvedImport(node.path, module, "external", imp.line)

    base = node.path.parent
    raw = base / module

    # ESM convention: strip .js and try .ts/.tsx
    candidates = _ts_candidates(raw)
    for c in candidates:
        if c in known:
            return Edge(node.path, c, kind, imp.names)

    return UnresolvedImport(node.path, module, "not_found", imp.line)


def _ts_candidates(raw: Path) -> list[Path]:
    """Generate candidate paths for a TS/JS import specifier."""
    candidates: list[Path] = []
    suffix = raw.suffix

    if suffix == ".js":
        # ESM: ./foo.js → try foo.ts, foo.tsx, foo.js
        stem = raw.with_suffix("")
        candidates.extend(stem.with_suffix(ext) for ext in _TS_EXTENSIONS)
    elif suffix in _TS_EXTENSIONS:
        candidates.append(raw)
    else:
        # No extension — try adding each, then index files.
        candidates.extend(raw.with_suffix(ext) for ext in _TS_EXTENSIONS)
        candidates.extend(raw / idx for idx in _TS_INDEX_FILES)

    return candidates


# ---------------------------------------------------------------------------
# Rust
# ---------------------------------------------------------------------------

_RUST_EXTERNAL_PREFIXES = ("std", "alloc", "core")


def _resolve_rust(
    imp: ImportInfo,
    node: FileNode,
    root: Path,
    known: set[Path],
    kind: EdgeKind,
) -> Edge | UnresolvedImport:
    module = imp.module  # e.g. "crate::config::AppConfig" or "super::utils"

    parts = module.split("::")

    if parts[0] in _RUST_EXTERNAL_PREFIXES:
        return UnresolvedImport(node.path, module, "external", imp.line)

    if parts[0] == "crate":
        # Resolve from src/ relative to root.
        sub = parts[1:]
        return _try_rust_path(root / "src", sub, node, imp, known, kind)

    if parts[0] == "super":
        base = node.path.parent
        i = 0
        while i < len(parts) and parts[i] == "super":
            base = base.parent
            i += 1
        return _try_rust_path(base, parts[i:], node, imp, known, kind)

    if parts[0] == "self":
        return _try_rust_path(node.path.parent, parts[1:], node, imp, known, kind)

    # `mod foo;` style or external crate — treat as external if not resolvable.
    if imp.is_relative:
        return _try_rust_path(node.path.parent, parts, node, imp, known, kind)

    return UnresolvedImport(node.path, module, "external", imp.line)


def _try_rust_path(
    base: Path,
    parts: list[str],
    node: FileNode,
    imp: ImportInfo,
    known: set[Path],
    kind: EdgeKind,
) -> Edge | UnresolvedImport:
    if not parts:
        # e.g. `use super;` — look for mod.rs
        mod_rs = base / "mod.rs"
        if mod_rs in known:
            return Edge(node.path, mod_rs, kind, imp.names)
        return UnresolvedImport(node.path, imp.module, "not_found", imp.line)

    # Walk as deep as we can match directories, then try file.
    # `use crate::config::AppConfig` with parts=["config","AppConfig"]
    # Try progressively: config.rs, config/mod.rs, config/AppConfig.rs ...
    for depth in range(len(parts), 0, -1):
        seg = parts[:depth]
        rel = Path(*seg) if len(seg) > 1 else Path(seg[0])
        candidates = [
            base / rel.with_suffix(".rs"),
            base / rel / "mod.rs",
        ]
        for c in candidates:
            if c in known:
                return Edge(node.path, c, kind, imp.names)

    return UnresolvedImport(node.path, imp.module, "not_found", imp.line)


# ---------------------------------------------------------------------------
# C / C++
# ---------------------------------------------------------------------------

def _resolve_cpp(
    imp: ImportInfo,
    node: FileNode,
    root: Path,
    known: set[Path],
    kind: EdgeKind,
) -> Edge | UnresolvedImport:
    module = imp.module  # the include path, e.g. "config.h" or "iostream"

    if not imp.is_relative:
        return UnresolvedImport(node.path, module, "external", imp.line)

    # Local include — search relative to file, then include paths.
    candidate = node.path.parent / module
    if candidate in known:
        return Edge(node.path, candidate, kind, imp.names)

    # Try include dirs from compile_commands.json.
    cc_path = root / "compile_commands.json"
    if cc_path.exists():
        for inc_dir in _read_include_dirs(cc_path):
            c = Path(inc_dir) / module
            if c in known:
                return Edge(node.path, c, kind, imp.names)

    return UnresolvedImport(node.path, module, "not_found", imp.line)


def _read_include_dirs(cc_path: Path) -> list[str]:
    """Extract -I paths from compile_commands.json."""
    try:
        data = json.loads(cc_path.read_text())
    except (json.JSONDecodeError, OSError):
        return []
    dirs: list[str] = []
    for entry in data:
        cmd = entry.get("command", "")
        parts = cmd.split()
        for i, tok in enumerate(parts):
            if tok == "-I" and i + 1 < len(parts):
                dirs.append(parts[i + 1])
            elif tok.startswith("-I"):
                dirs.append(tok[2:])
    return dirs


# ---------------------------------------------------------------------------
# TsconfigResolver
# ---------------------------------------------------------------------------

class TsconfigResolver:
    """Reads tsconfig.json paths / baseUrl and resolves path aliases."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.base_url: str | None = None
        self.paths: dict[str, list[str]] = {}
        self._load()

    def _load(self) -> None:
        tsconfig = self.root / "tsconfig.json"
        if not tsconfig.exists():
            return
        try:
            data = json.loads(tsconfig.read_text())
        except (json.JSONDecodeError, OSError):
            log.warning("Failed to parse tsconfig.json")
            return
        opts = data.get("compilerOptions", {})
        self.base_url = opts.get("baseUrl")
        self.paths = opts.get("paths", {})

    def resolve(self, module: str) -> str | None:
        """Return a root-relative path for *module* if it matches a tsconfig path alias."""
        for pattern, targets in self.paths.items():
            prefix = pattern.removesuffix("*")
            if pattern.endswith("*") and module.startswith(prefix):
                rest = module[len(prefix):]
                if targets:
                    mapped = targets[0].removesuffix("*") + rest
                    if self.base_url:
                        return f"{self.base_url}/{mapped}"
                    return mapped
            elif module == pattern and targets:
                if self.base_url:
                    return f"{self.base_url}/{targets[0]}"
                return targets[0]
        return None
