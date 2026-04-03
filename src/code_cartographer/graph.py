"""Graph analysis for Code Cartographer — cycles, clusters, metrics."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from .models import ProjectGraph


def detect_cycles(graph: ProjectGraph) -> list[list[Path]]:
    """Find all cycles using iterative Tarjan's SCC algorithm.

    Uses an explicit call stack instead of recursion to avoid
    RecursionError on projects with deep dependency chains (>1000 files).

    Returns a list of cycles where each cycle is a list of file paths
    with length >= 2 (self-loops are excluded).
    """
    adj: dict[Path, list[Path]] = defaultdict(list)
    nodes: set[Path] = set()
    for edge in graph.edges:
        adj[edge.source].append(edge.target)
        nodes.add(edge.source)
        nodes.add(edge.target)

    index_counter = 0
    scc_stack: list[Path] = []
    on_stack: set[Path] = set()
    indices: dict[Path, int] = {}
    lowlinks: dict[Path, int] = {}
    sccs: list[list[Path]] = []

    for node in sorted(nodes, key=str):
        if node in indices:
            continue

        # Explicit call stack: each frame is (node, neighbor_iterator, is_initial_visit)
        # We store tuples of (v, iterator_over_neighbors, caller_v_or_None)
        call_stack: list[tuple[Path, int]] = []  # (node, neighbor_index)
        # Initialize the first node
        indices[node] = index_counter
        lowlinks[node] = index_counter
        index_counter += 1
        scc_stack.append(node)
        on_stack.add(node)
        call_stack.append((node, 0))

        while call_stack:
            v, ni = call_stack[-1]
            neighbors = adj[v]

            if ni < len(neighbors):
                w = neighbors[ni]
                # Advance the neighbor index for v
                call_stack[-1] = (v, ni + 1)

                if w not in indices:
                    # "Recurse" into w
                    indices[w] = index_counter
                    lowlinks[w] = index_counter
                    index_counter += 1
                    scc_stack.append(w)
                    on_stack.add(w)
                    call_stack.append((w, 0))
                elif w in on_stack:
                    lowlinks[v] = min(lowlinks[v], indices[w])
            else:
                # All neighbors of v processed — "return" from v
                call_stack.pop()
                if call_stack:
                    # Update caller's lowlink
                    caller = call_stack[-1][0]
                    lowlinks[caller] = min(lowlinks[caller], lowlinks[v])

                # Check if v is an SCC root
                if lowlinks[v] == indices[v]:
                    scc: list[Path] = []
                    while True:
                        w = scc_stack.pop()
                        on_stack.discard(w)
                        scc.append(w)
                        if w == v:
                            break
                    if len(scc) >= 2:
                        sccs.append(scc)

    return sccs


def detect_clusters(graph: ProjectGraph) -> dict[str, list[Path]]:
    """Group files into clusters by top-level directory within the project root.

    Returns {cluster_name: [file_paths]} plus inter-cluster edge counts
    stored under the special key "__inter_cluster_edges__" as a stringified dict.
    """
    clusters: dict[str, list[Path]] = defaultdict(list)

    for path in graph.files:
        try:
            rel = path.relative_to(graph.root)
        except ValueError:
            rel = path
        parts = rel.parts
        cluster_name = parts[0] if len(parts) > 1 else "<root>"
        clusters[cluster_name].append(path)

    return dict(clusters)


def inter_cluster_edges(graph: ProjectGraph) -> dict[tuple[str, str], int]:
    """Count edges between clusters (by top-level directory)."""
    def _cluster_of(p: Path) -> str:
        try:
            rel = p.relative_to(graph.root)
        except ValueError:
            rel = p
        parts = rel.parts
        return parts[0] if len(parts) > 1 else "<root>"

    counts: dict[tuple[str, str], int] = defaultdict(int)
    for edge in graph.edges:
        src_cluster = _cluster_of(edge.source)
        tgt_cluster = _cluster_of(edge.target)
        if src_cluster != tgt_cluster:
            counts[(src_cluster, tgt_cluster)] += 1
    return dict(counts)


def compute_metrics(graph: ProjectGraph) -> dict:
    """Compute graph-level metrics."""
    total_files = graph.file_count
    total_edges = graph.edge_count

    if total_files == 0:
        return {
            "avg_fan_in": 0.0,
            "avg_fan_out": 0.0,
            "max_fan_in": 0,
            "max_fan_out": 0,
            "max_fan_in_file": None,
            "max_fan_out_file": None,
            "total_edges": total_edges,
            "total_files": total_files,
            "circular_deps_count": len(graph.cycles),
        }

    fan_ins: dict[Path, int] = {}
    fan_outs: dict[Path, int] = {}
    for path in graph.files:
        fan_ins[path] = graph.fan_in(path)
        fan_outs[path] = graph.fan_out(path)

    max_fi_file = max(fan_ins, key=fan_ins.get)  # type: ignore[arg-type]
    max_fo_file = max(fan_outs, key=fan_outs.get)  # type: ignore[arg-type]

    return {
        "avg_fan_in": sum(fan_ins.values()) / total_files,
        "avg_fan_out": sum(fan_outs.values()) / total_files,
        "max_fan_in": fan_ins[max_fi_file],
        "max_fan_out": fan_outs[max_fo_file],
        "max_fan_in_file": max_fi_file,
        "max_fan_out_file": max_fo_file,
        "total_edges": total_edges,
        "total_files": total_files,
        "circular_deps_count": len(graph.cycles),
    }


def analyze(graph: ProjectGraph) -> ProjectGraph:
    """Run all analysis on the graph. Populates graph.cycles and returns it."""
    graph.cycles = detect_cycles(graph)
    graph.build_index()
    return graph
