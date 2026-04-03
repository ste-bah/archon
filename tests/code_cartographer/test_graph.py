"""Tests for Code Cartographer graph analysis."""

from pathlib import Path

from src.code_cartographer.graph import (
    analyze,
    compute_metrics,
    detect_clusters,
    detect_cycles,
    inter_cluster_edges,
)
from src.code_cartographer.models import Edge, FileNode, Language, ProjectGraph


ROOT = Path("/project")


def _make_graph(
    edges: list[tuple[str, str]],
    files: list[str] | None = None,
) -> ProjectGraph:
    """Helper to build a ProjectGraph from simple string pairs."""
    all_names: set[str] = set()
    for s, t in edges:
        all_names.add(s)
        all_names.add(t)
    if files:
        all_names.update(files)

    file_nodes = {
        ROOT / name: FileNode(path=ROOT / name, language=Language.PYTHON)
        for name in sorted(all_names)
    }
    edge_objs = [Edge(source=ROOT / s, target=ROOT / t) for s, t in edges]
    return ProjectGraph(name="test", root=ROOT, files=file_nodes, edges=edge_objs)


# ── detect_cycles ──────────────────────────────────────────────────


class TestDetectCycles:
    def test_no_cycles(self):
        g = _make_graph([("a.py", "b.py"), ("b.py", "c.py")])
        assert detect_cycles(g) == []

    def test_simple_two_node_cycle(self):
        g = _make_graph([("a.py", "b.py"), ("b.py", "a.py")])
        cycles = detect_cycles(g)
        assert len(cycles) == 1
        assert set(cycles[0]) == {ROOT / "a.py", ROOT / "b.py"}

    def test_three_node_cycle(self):
        g = _make_graph([("a.py", "b.py"), ("b.py", "c.py"), ("c.py", "a.py")])
        cycles = detect_cycles(g)
        assert len(cycles) == 1
        assert set(cycles[0]) == {ROOT / "a.py", ROOT / "b.py", ROOT / "c.py"}

    def test_multiple_independent_cycles(self):
        g = _make_graph([
            ("a.py", "b.py"), ("b.py", "a.py"),
            ("x.py", "y.py"), ("y.py", "z.py"), ("z.py", "x.py"),
        ])
        cycles = detect_cycles(g)
        assert len(cycles) == 2
        cycle_sets = [set(c) for c in cycles]
        assert {ROOT / "a.py", ROOT / "b.py"} in cycle_sets
        assert {ROOT / "x.py", ROOT / "y.py", ROOT / "z.py"} in cycle_sets

    def test_self_loop_excluded(self):
        """A self-referencing edge should not appear as a cycle."""
        g = _make_graph([("a.py", "a.py")])
        assert detect_cycles(g) == []

    def test_empty_graph(self):
        g = ProjectGraph(name="empty", root=ROOT)
        assert detect_cycles(g) == []


# ── detect_clusters ────────────────────────────────────────────────


class TestDetectClusters:
    def test_groups_by_top_directory(self):
        g = ProjectGraph(
            name="test",
            root=ROOT,
            files={
                ROOT / "src" / "a.py": FileNode(
                    path=ROOT / "src" / "a.py", language=Language.PYTHON
                ),
                ROOT / "src" / "b.py": FileNode(
                    path=ROOT / "src" / "b.py", language=Language.PYTHON
                ),
                ROOT / "tests" / "t.py": FileNode(
                    path=ROOT / "tests" / "t.py", language=Language.PYTHON
                ),
            },
        )
        clusters = detect_clusters(g)
        assert set(clusters.keys()) == {"src", "tests"}
        assert len(clusters["src"]) == 2
        assert len(clusters["tests"]) == 1

    def test_root_level_files(self):
        g = ProjectGraph(
            name="test",
            root=ROOT,
            files={
                ROOT / "main.py": FileNode(
                    path=ROOT / "main.py", language=Language.PYTHON
                ),
            },
        )
        clusters = detect_clusters(g)
        assert "<root>" in clusters
        assert clusters["<root>"] == [ROOT / "main.py"]


# ── inter_cluster_edges ───────────────────────────────────────────


class TestInterClusterEdges:
    def test_counts_cross_cluster(self):
        g = ProjectGraph(
            name="test",
            root=ROOT,
            files={
                ROOT / "src" / "a.py": FileNode(
                    path=ROOT / "src" / "a.py", language=Language.PYTHON
                ),
                ROOT / "lib" / "b.py": FileNode(
                    path=ROOT / "lib" / "b.py", language=Language.PYTHON
                ),
            },
            edges=[
                Edge(source=ROOT / "src" / "a.py", target=ROOT / "lib" / "b.py"),
            ],
        )
        ic = inter_cluster_edges(g)
        assert ic == {("src", "lib"): 1}

    def test_intra_cluster_excluded(self):
        g = ProjectGraph(
            name="test",
            root=ROOT,
            files={
                ROOT / "src" / "a.py": FileNode(
                    path=ROOT / "src" / "a.py", language=Language.PYTHON
                ),
                ROOT / "src" / "b.py": FileNode(
                    path=ROOT / "src" / "b.py", language=Language.PYTHON
                ),
            },
            edges=[
                Edge(source=ROOT / "src" / "a.py", target=ROOT / "src" / "b.py"),
            ],
        )
        ic = inter_cluster_edges(g)
        assert ic == {}


# ── compute_metrics ────────────────────────────────────────────────


class TestComputeMetrics:
    def test_basic_metrics(self):
        g = _make_graph([
            ("a.py", "b.py"),
            ("a.py", "c.py"),
            ("b.py", "c.py"),
        ])
        m = compute_metrics(g)
        assert m["total_files"] == 3
        assert m["total_edges"] == 3
        # fan_in: a=0, b=1, c=2  => avg = 1.0
        assert m["avg_fan_in"] == 1.0
        # fan_out: a=2, b=1, c=0 => avg = 1.0
        assert m["avg_fan_out"] == 1.0
        assert m["max_fan_in"] == 2
        assert m["max_fan_out"] == 2
        assert m["max_fan_in_file"] == ROOT / "c.py"
        assert m["max_fan_out_file"] == ROOT / "a.py"
        assert m["circular_deps_count"] == 0

    def test_empty_graph(self):
        g = ProjectGraph(name="empty", root=ROOT)
        m = compute_metrics(g)
        assert m["total_files"] == 0
        assert m["total_edges"] == 0
        assert m["max_fan_in_file"] is None

    def test_circular_deps_counted(self):
        g = _make_graph([("a.py", "b.py"), ("b.py", "a.py")])
        g.cycles = detect_cycles(g)
        m = compute_metrics(g)
        assert m["circular_deps_count"] == 1


# ── analyze ────────────────────────────────────────────────────────


class TestAnalyze:
    def test_populates_cycles(self):
        g = _make_graph([("a.py", "b.py"), ("b.py", "a.py")])
        assert g.cycles == []
        result = analyze(g)
        assert result is g
        assert len(g.cycles) == 1
        assert set(g.cycles[0]) == {ROOT / "a.py", ROOT / "b.py"}

    def test_no_cycles_clears(self):
        g = _make_graph([("a.py", "b.py")])
        g.cycles = [[ROOT / "fake"]]  # stale data
        analyze(g)
        assert g.cycles == []
