"""Mermaid diagram generation from a ProjectGraph."""

from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from pathlib import Path

from .models import EdgeKind, ProjectGraph, SymbolKind

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_id(name: str) -> str:
    """Turn a path/name into a valid Mermaid node ID (alphanum + underscore).

    Uses path-aware separators to avoid collisions:
    ``/`` -> ``__``, ``.`` -> ``_d_``, other non-alnum -> ``_``.
    For example ``src/foo/bar.py`` -> ``src__foo__bar_d_py`` while
    ``src/foo_bar.py`` -> ``src__foo_bar_d_py`` (distinct).
    """
    s = str(name)
    s = s.replace("/", "__")
    s = s.replace(".", "_d_")
    s = re.sub(r"[^A-Za-z0-9_]", "_", s).strip("_")
    return s or "root"


def _relative(path: Path, root: Path) -> str:
    """Return a short relative path string for labels."""
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _dir_of(path: Path, root: Path) -> str:
    """Return the parent directory relative to root (or '.' for top-level)."""
    rel = _relative(path, root)
    parent = str(Path(rel).parent)
    return parent if parent != "." else "(root)"


def _top_by_count(items: dict[str, int], cap: int) -> tuple[dict[str, int], int]:
    """Return the top *cap* items by value and how many were trimmed."""
    if len(items) <= cap:
        return items, 0
    sorted_items = sorted(items.items(), key=lambda kv: kv[1], reverse=True)
    trimmed = len(sorted_items) - cap
    return dict(sorted_items[:cap]), trimmed


# ---------------------------------------------------------------------------
# Diagram generators
# ---------------------------------------------------------------------------

def generate_module_map(graph: ProjectGraph, node_cap: int = 60) -> str:
    """Generate a directory-level dependency diagram.

    Aggregates file-level edges into directory-level edges, counting how many
    imports flow between each pair of directories.
    """
    root = graph.root
    dir_edges: Counter[tuple[str, str]] = Counter()

    for edge in graph.edges:
        src_dir = _dir_of(edge.source, root)
        tgt_dir = _dir_of(edge.target, root)
        if src_dir != tgt_dir:
            dir_edges[(src_dir, tgt_dir)] += 1

    # Collect all directory nodes that participate in edges
    node_counts: Counter[str] = Counter()
    for (s, t), count in dir_edges.items():
        node_counts[s] += count
        node_counts[t] += count

    kept, trimmed = _top_by_count(dict(node_counts), node_cap)
    kept_set = set(kept.keys())

    lines = ["graph LR"]
    # Declare nodes
    for d in sorted(kept_set):
        nid = _sanitize_id(d)
        lines.append(f'    {nid}["{d}"]')

    # Edges (only between kept nodes)
    for (s, t), count in sorted(dir_edges.items()):
        if s in kept_set and t in kept_set:
            sid, tid = _sanitize_id(s), _sanitize_id(t)
            lines.append(f"    {sid} -->|{count}| {tid}")

    if trimmed:
        lines.append(f'    note_{_sanitize_id("overflow")}["... and {trimmed} more directories"]')

    return "\n".join(lines) + "\n"


def generate_class_hierarchy(graph: ProjectGraph, node_cap: int = 60) -> str:
    """Generate a class/struct/trait inheritance diagram."""
    inheritable = {SymbolKind.CLASS, SymbolKind.STRUCT, SymbolKind.TRAIT, SymbolKind.INTERFACE}

    # Collect all classes/structs and their bases
    classes: dict[str, str] = {}  # fqn -> label
    edges: list[tuple[str, str, str]] = []  # (child_id, parent_id, label)

    # Map short name -> list of (fqn, file) for resolving bases
    name_to_fqn: dict[str, list[str]] = defaultdict(list)

    for path, fnode in graph.files.items():
        rel = _relative(path, graph.root)
        for sym in fnode.symbols:
            if sym.kind not in inheritable:
                continue
            fqn = f"{rel}::{sym.name}"
            classes[fqn] = sym.name
            name_to_fqn[sym.name].append(fqn)

    # Build edges by matching bases to known symbols
    for path, fnode in graph.files.items():
        rel = _relative(path, graph.root)
        for sym in fnode.symbols:
            if sym.kind not in inheritable or not sym.bases:
                continue
            child_fqn = f"{rel}::{sym.name}"
            edge_label = "implements" if sym.kind == SymbolKind.INTERFACE else "extends"
            for base in sym.bases:
                candidates = name_to_fqn.get(base, [])
                if candidates:
                    parent_fqn = candidates[0]  # pick first match
                else:
                    # External base -- add as a standalone node
                    parent_fqn = f"ext::{base}"
                    classes[parent_fqn] = f"{base} (external)"
                edges.append((child_fqn, parent_fqn, edge_label))

    # Cap nodes by edge participation
    node_edge_count: Counter[str] = Counter()
    for child, parent, _ in edges:
        node_edge_count[child] += 1
        node_edge_count[parent] += 1
    # Also count isolated classes with 0 edges
    for fqn in classes:
        if fqn not in node_edge_count:
            node_edge_count[fqn] = 0

    kept, trimmed = _top_by_count(dict(node_edge_count), node_cap)
    kept_set = set(kept.keys())

    lines = ["graph TD"]
    for fqn in sorted(kept_set):
        nid = _sanitize_id(fqn)
        label = classes.get(fqn, fqn.split("::")[-1])
        lines.append(f'    {nid}["{label}"]')

    for child, parent, label in edges:
        if child in kept_set and parent in kept_set:
            cid, pid = _sanitize_id(child), _sanitize_id(parent)
            lines.append(f"    {cid} -->|{label}| {pid}")

    if trimmed:
        lines.append(f'    overflow_note["... and {trimmed} more classes"]')

    return "\n".join(lines) + "\n"


def generate_import_flow(graph: ProjectGraph, node_cap: int = 40) -> str:
    """Generate a file-level import flow for the top N most-connected files."""
    root = graph.root
    # Score each file by total edges
    file_scores: Counter[Path] = Counter()
    for edge in graph.edges:
        file_scores[edge.source] += 1
        file_scores[edge.target] += 1

    top_files = {p for p, _ in file_scores.most_common(node_cap)}
    trimmed = max(0, len(file_scores) - node_cap)

    lines = ["graph LR"]
    for p in sorted(top_files):
        nid = _sanitize_id(_relative(p, root))
        label = _relative(p, root)
        lines.append(f'    {nid}["{label}"]')

    for edge in graph.edges:
        if edge.source in top_files and edge.target in top_files:
            sid = _sanitize_id(_relative(edge.source, root))
            tid = _sanitize_id(_relative(edge.target, root))
            names_label = ", ".join(edge.names[:3])
            if len(edge.names) > 3:
                names_label += "..."
            if names_label:
                lines.append(f"    {sid} -->|{names_label}| {tid}")
            else:
                lines.append(f"    {sid} --> {tid}")

    if trimmed:
        lines.append(f'    overflow_note["... and {trimmed} more files"]')

    return "\n".join(lines) + "\n"


def generate_cycles_diagram(graph: ProjectGraph) -> str | None:
    """Generate a diagram showing circular dependencies.

    Returns None if no cycles are detected.
    """
    if not graph.cycles:
        return None

    root = graph.root
    lines = ["graph LR"]
    lines.append("    style_cycle:::cycle")
    lines.append("    classDef cycle stroke:#f00,stroke-width:2px")

    seen_nodes: set[str] = set()
    for i, cycle in enumerate(graph.cycles):
        for path in cycle:
            nid = _sanitize_id(_relative(path, root))
            if nid not in seen_nodes:
                label = _relative(path, root)
                lines.append(f'    {nid}["{label}"]:::cycle')
                seen_nodes.add(nid)
        # Draw edges around the cycle
        for j in range(len(cycle)):
            src = _sanitize_id(_relative(cycle[j], root))
            tgt = _sanitize_id(_relative(cycle[(j + 1) % len(cycle)], root))
            lines.append(f"    {src} --> {tgt}")

    return "\n".join(lines) + "\n"


def generate_focus_diagram(
    graph: ProjectGraph, module: str, depth: int = 2
) -> str:
    """Generate a diagram for a specific module and its neighbors up to *depth* hops."""
    root = graph.root

    # Build adjacency (both directions)
    adj: defaultdict[Path, set[Path]] = defaultdict(set)
    for edge in graph.edges:
        adj[edge.source].add(edge.target)
        adj[edge.target].add(edge.source)

    # Find matching file(s) for the module query
    focus_files: set[Path] = set()
    for path in graph.files:
        rel = _relative(path, root)
        if module in rel:
            focus_files.add(path)

    if not focus_files:
        log.warning("No files match module query %r", module)
        return f'graph LR\n    no_match["No files match \\"{module}\\""]' + "\n"

    # BFS to collect neighbors within depth
    visited: set[Path] = set(focus_files)
    frontier: set[Path] = set(focus_files)
    for _ in range(depth):
        next_frontier: set[Path] = set()
        for p in frontier:
            for neighbor in adj.get(p, set()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    next_frontier.add(neighbor)
        frontier = next_frontier

    lines = ["graph LR"]
    # Declare nodes -- highlight focus files
    for p in sorted(visited):
        nid = _sanitize_id(_relative(p, root))
        label = _relative(p, root)
        if p in focus_files:
            lines.append(f'    {nid}["{label}"]:::focus')
        else:
            lines.append(f'    {nid}["{label}"]')

    lines.append("    classDef focus fill:#ff9,stroke:#f90,stroke-width:2px")

    # Edges among visited nodes
    for edge in graph.edges:
        if edge.source in visited and edge.target in visited:
            sid = _sanitize_id(_relative(edge.source, root))
            tid = _sanitize_id(_relative(edge.target, root))
            lines.append(f"    {sid} --> {tid}")

    return "\n".join(lines) + "\n"


def generate_all(
    graph: ProjectGraph,
    node_cap: int = 60,
    focus: str | None = None,
) -> dict[str, str]:
    """Generate all diagrams and return ``{name: mermaid_content}``.

    Keys: ``module-map``, ``class-hierarchy``, ``import-flow``,
    ``cycles`` (only if cycles exist), ``focus-{module}`` (only if *focus* given).
    """
    diagrams: dict[str, str] = {
        "module-map": generate_module_map(graph, node_cap),
        "class-hierarchy": generate_class_hierarchy(graph, node_cap),
        "import-flow": generate_import_flow(graph, node_cap),
    }

    cycles = generate_cycles_diagram(graph)
    if cycles is not None:
        diagrams["cycles"] = cycles

    if focus:
        diagrams[f"focus-{focus}"] = generate_focus_diagram(graph, focus)

    log.info("Generated %d diagrams", len(diagrams))
    return diagrams
