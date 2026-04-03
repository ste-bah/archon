"""Generate a compact Markdown summary of a ProjectGraph for AI context windows."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .models import FileNode, ProjectGraph, SymbolKind

log = logging.getLogger(__name__)

_ENTRY_NAMES = {"main", "index", "app", "lib", "__main__", "cli", "server"}
_TOP_N = 15
_TOP_SYMBOLS = 20


def _rel(path: Path, root: Path) -> str:
    """Return a relative path string, falling back to the full path."""
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _cluster_key(path: Path, root: Path) -> str:
    """Top-level directory within root, or <root> for files at the top."""
    rel = Path(_rel(path, root))
    parts = rel.parts
    return parts[0] if len(parts) > 1 else "<root>"


def _symbol_counts(graph: ProjectGraph) -> dict[str, int]:
    """Count symbols by kind across all files."""
    counts: dict[str, int] = Counter()
    for fnode in graph.files.values():
        for sym in fnode.symbols:
            counts[sym.kind.value] += 1
    return dict(counts)


def _section_overview(graph: ProjectGraph, metrics: dict | None = None) -> str:
    lang_bd = graph.language_breakdown()
    lang_str = ", ".join(f"{c} {l}" for l, c in sorted(lang_bd.items(), key=lambda x: -x[1]))

    sym_counts = _symbol_counts(graph)
    sym_parts = []
    for kind in ("function", "method", "class", "struct", "interface", "trait", "enum"):
        c = sym_counts.get(kind, 0)
        if c:
            sym_parts.append(f"{c} {kind}{'s' if c != 1 else ''}")

    ext_count = sum(1 for u in graph.unresolved if u.reason == "external")
    nf_count = sum(1 for u in graph.unresolved if u.reason != "external")

    # Use pre-computed metrics when available, fall back to inline computation
    file_count = metrics["total_files"] if metrics else graph.file_count
    edge_count = metrics["total_edges"] if metrics else graph.edge_count
    cycle_count = metrics["circular_deps_count"] if metrics else len(graph.cycles)

    lines = [
        "## Overview",
        f"- **Files**: {file_count} ({lang_str})",
        f"- **Symbols**: {', '.join(sym_parts) if sym_parts else '0'}",
        f"- **Dependencies**: {edge_count} internal edges, {ext_count} external, {nf_count} unresolved",
        f"- **Circular dependencies**: {cycle_count} cycle{'s' if cycle_count != 1 else ''} detected",
    ]
    return "\n".join(lines)


def _section_module_structure(graph: ProjectGraph, clusters: dict[str, list[Path]] | None) -> str:
    if clusters is None:
        clusters = {}
        for path in graph.files:
            key = _cluster_key(path, graph.root)
            clusters.setdefault(key, []).append(path)

    rows: list[tuple[str, int, int, int, int]] = []
    for name, paths in clusters.items():
        n_files = len(paths)
        n_syms = sum(len(graph.files[p].symbols) for p in paths if p in graph.files)
        fi = sum(graph.fan_in(p) for p in paths if p in graph.files)
        fo = sum(graph.fan_out(p) for p in paths if p in graph.files)
        rows.append((name, n_files, n_syms, fi, fo))

    rows.sort(key=lambda r: r[1], reverse=True)

    lines = [
        "## Module Structure",
        "| Module | Files | Symbols | Fan-in | Fan-out |",
        "|--------|-------|---------|--------|---------|",
    ]
    for name, nf, ns, fi, fo in rows:
        lines.append(f"| {name} | {nf} | {ns} | {fi} | {fo} |")
    return "\n".join(lines)


def _section_entry_points(graph: ProjectGraph) -> str:
    entries: list[str] = []
    for path in sorted(graph.files, key=lambda p: str(p)):
        stem = path.stem.lower()
        fi = graph.fan_in(path)
        fo = graph.fan_out(path)
        if stem in _ENTRY_NAMES or (fi == 0 and fo > 0):
            entries.append(f"- `{_rel(path, graph.root)}` (fan-in={fi}, fan-out={fo})")
    if not entries:
        return "## Key Entry Points\nNone detected."
    return "## Key Entry Points\n" + "\n".join(entries[:_TOP_N])


def _section_hotspots(graph: ProjectGraph) -> str:
    spots = graph.hotspots(_TOP_N)
    if not spots:
        return "## Dependency Hotspots\nNone."
    lines = [
        "## Dependency Hotspots",
        "| File | Fan-in | Fan-out | Score |",
        "|------|--------|---------|-------|",
    ]
    for path, fi, fo in spots:
        if fi + fo == 0:
            continue
        lines.append(f"| {_rel(path, graph.root)} | {fi} | {fo} | {fi + fo} |")
    return "\n".join(lines)


def _section_cycles(graph: ProjectGraph) -> str:
    if not graph.cycles:
        return "## Circular Dependencies\nNone detected."
    lines = ["## Circular Dependencies"]
    for i, cycle in enumerate(graph.cycles, 1):
        chain = " -> ".join(f"`{_rel(p, graph.root)}`" for p in cycle)
        chain += f" -> `{_rel(cycle[0], graph.root)}`"
        lines.append(f"{i}. {chain}")
    return "\n".join(lines)


def _clean_module_name(raw: str) -> str | None:
    """Extract a clean top-level package name from a raw import string.

    Strips whitespace, newlines, quotes, and path separators, then returns
    the first path/dotted component.  Returns ``None`` for empty strings or
    single-character fragments that are almost certainly parse artefacts.
    """
    # Strip whitespace, newlines, surrounding quotes
    cleaned = raw.strip().strip("'\"").strip()
    # Remove common statement prefixes that leak through ("from ", "import ")
    for prefix in ("from ", "import "):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix):]
    cleaned = cleaned.strip()
    # Extract top-level package: first component before . / or ::
    for sep in (".", "/", "::"):
        cleaned = cleaned.split(sep)[0]
    cleaned = cleaned.strip()
    # Discard empty or single-char fragments (garbled artefacts)
    if len(cleaned) <= 1:
        return None
    # Must look like an identifier (alphanumeric + _ + -)
    if not all(c.isalnum() or c in ("_", "-", "@") for c in cleaned):
        return None
    return cleaned


def _section_external_deps(graph: ProjectGraph) -> str:
    ext_by_lang: dict[str, set[str]] = defaultdict(set)
    for u in graph.unresolved:
        if u.reason != "external":
            continue
        lang = "Unknown"
        if u.source in graph.files:
            lang = graph.files[u.source].language.value.capitalize()
        top_mod = _clean_module_name(u.module)
        if top_mod is None:
            continue
        ext_by_lang[lang].add(top_mod)

    if not ext_by_lang:
        return "## External Dependencies\nNone detected."

    lines = ["## External Dependencies"]
    for lang in sorted(ext_by_lang):
        lines.append(f"### {lang}")
        lines.append(", ".join(sorted(ext_by_lang[lang])))
    return "\n".join(lines)


def _section_symbols(graph: ProjectGraph) -> str:
    classes: list[tuple[str, str, int, list[str], int]] = []
    functions: list[tuple[str, str, int, int]] = []

    for path, fnode in graph.files.items():
        rel = _rel(path, graph.root)
        methods_in_class: dict[str, int] = Counter()
        for sym in fnode.symbols:
            if sym.kind == SymbolKind.METHOD:
                # Heuristic: attribute method count to file for ranking
                for s2 in fnode.symbols:
                    if s2.kind in (SymbolKind.CLASS, SymbolKind.STRUCT):
                        methods_in_class[s2.name] += 1

        for sym in fnode.symbols:
            if sym.kind in (SymbolKind.CLASS, SymbolKind.STRUCT, SymbolKind.INTERFACE, SymbolKind.TRAIT):
                mc = methods_in_class.get(sym.name, 0)
                classes.append((sym.name, rel, sym.line, sym.bases, mc))
            elif sym.kind == SymbolKind.FUNCTION:
                fi = graph.fan_in(path)
                functions.append((sym.name, rel, sym.line, fi))

    classes.sort(key=lambda x: x[4], reverse=True)
    functions.sort(key=lambda x: x[3], reverse=True)

    lines = [f"## Symbol Summary"]

    kind_label = "Classes/Structs"
    lines.append(f"### {kind_label} ({len(classes)})")
    for name, rel, line, bases, _mc in classes[:_TOP_SYMBOLS]:
        ext = f" extends `{'`, `'.join(bases)}`" if bases else ""
        lines.append(f"- `{name}` ({rel}:{line}){ext}")

    lines.append(f"\n### Key Functions ({len(functions)})")
    for name, rel, line, _fi in functions[:_TOP_SYMBOLS]:
        lines.append(f"- `{name}` ({rel}:{line})")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_summary(
    graph: ProjectGraph,
    metrics: dict | None = None,
    clusters: dict[str, list[Path]] | None = None,
) -> str:
    """Generate a compact Markdown summary of the project.

    Args:
        graph: The fully-resolved project graph.
        metrics: Optional pre-computed metrics dict (from ``compute_metrics``).
        clusters: Optional pre-computed clusters dict (from ``detect_clusters``).

    Returns:
        A Markdown string under ~10 KB for typical projects.
    """
    if graph.file_count == 0:
        log.info("Empty graph for project '%s' — generating minimal summary.", graph.name)
        return (
            f"# {graph.name} — Architecture Summary\n\n"
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d')} | Tool: Code Cartographer\n\n"
            "## Overview\nNo source files found.\n"
        )

    log.info(
        "Generating summary for '%s': %d files, %d symbols, %d edges.",
        graph.name, graph.file_count, graph.symbol_count, graph.edge_count,
    )

    header = (
        f"# {graph.name} — Architecture Summary\n\n"
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d')} | Tool: Code Cartographer"
    )

    sections = [
        header,
        _section_overview(graph, metrics),
        _section_module_structure(graph, clusters),
        _section_entry_points(graph),
        _section_hotspots(graph),
        _section_cycles(graph),
        _section_external_deps(graph),
        _section_symbols(graph),
    ]

    summary = "\n\n".join(sections) + "\n"

    size_kb = len(summary.encode("utf-8")) / 1024
    log.info("Summary generated: %.1f KB", size_kb)
    if size_kb > 10:
        log.warning("Summary exceeds 10 KB target (%.1f KB) — consider reducing top-N limits.", size_kb)

    return summary
