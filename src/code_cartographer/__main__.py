"""CLI entry point for Code Cartographer.

Usage:
    PYTHONPATH=. python -m src.code_cartographer /path/to/project [options]
"""

from __future__ import annotations

import json
import logging
import signal
import sys
from pathlib import Path

from tqdm import tqdm

from .config import CartographerConfig, parse_cli_args
from .graph import analyze, compute_metrics, detect_clusters
from .models import FileNode, Language, ProjectGraph
from .parsers.python_parser import PythonParser
from .parsers.typescript_parser import TypeScriptParser
from .parsers.rust_parser import RustParser
from .parsers.cpp_parser import CppParser
from .renderers.html_interactive import generate_interactive_html
from .renderers.mermaid import render_all as render_mermaid_all
from .resolver import resolve_imports
from .scanner import scan_directory
from .summarizer import generate_summary
from .visualizer import generate_all as generate_diagrams

log = logging.getLogger("cartographer")

PARSERS = {
    Language.PYTHON: PythonParser(),
    Language.TYPESCRIPT: TypeScriptParser(tsx=False),
    Language.TSX: TypeScriptParser(tsx=True),
    Language.JAVASCRIPT: TypeScriptParser(tsx=False),
    Language.RUST: RustParser(),
    Language.CPP: CppParser(),
    Language.C: CppParser(),
}

# ── Signal handling ──────────────────────────────────────────────────

_interrupted = False


def _handle_sigint(signum, frame):  # noqa: ANN001
    global _interrupted  # noqa: PLW0603
    if _interrupted:
        sys.exit(130)
    _interrupted = True
    print("\nInterrupt received — finishing current file, then stopping.", file=sys.stderr)


# ── Per-file parse with timeout ──────────────────────────────────────

class _ParseTimeout(Exception):
    pass


def _alarm_handler(signum, frame):  # noqa: ANN001
    raise _ParseTimeout


def _parse_file(path: Path, language: Language) -> FileNode | None:
    """Parse a single file with a best-effort 10s timeout (Linux only)."""
    parser = PARSERS.get(language)
    if parser is None:
        log.warning("No parser for %s (%s), skipping", path, language.value)
        return None

    old_handler = None
    try:
        old_handler = signal.signal(signal.SIGALRM, _alarm_handler)
        signal.alarm(10)
    except (AttributeError, OSError):
        pass  # SIGALRM not available (Windows)

    try:
        return parser.parse_file(path, language)
    except _ParseTimeout:
        log.warning("Parse timeout (>10s): %s", path)
        return None
    except Exception:
        log.warning("Failed to parse %s", path, exc_info=True)
        return None
    finally:
        try:
            signal.alarm(0)
            if old_handler is not None:
                signal.signal(signal.SIGALRM, old_handler)
        except (AttributeError, OSError):
            pass


# ── Main pipeline ────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    """Run the full Code Cartographer pipeline."""

    cfg: CartographerConfig = parse_cli_args(
        argv if argv is not None else sys.argv[1:]
    )

    logging.basicConfig(
        level=logging.DEBUG if cfg.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    signal.signal(signal.SIGINT, _handle_sigint)

    # ── Step 1: Scan ─────────────────────────────────────────────────
    log.info("Scanning %s ...", cfg.project_path)
    discovered = scan_directory(
        cfg.project_path,
        languages=cfg.languages,
        max_depth=cfg.max_depth,
        extra_excludes=cfg.exclude_patterns or None,
    )
    if not discovered:
        log.error("No source files found in %s", cfg.project_path)
        return 1

    log.info("Found %d source files", len(discovered))

    # ── Step 2: Parse ────────────────────────────────────────────────
    files: dict[Path, FileNode] = {}
    skipped = 0
    for path, language in tqdm(discovered, desc="Parsing", unit="file", disable=None):
        if _interrupted:
            log.warning("Interrupted — stopping parse phase early")
            break
        node = _parse_file(path, language)
        if node is not None:
            files[path] = node
        else:
            skipped += 1

    if skipped:
        log.info("Skipped %d file(s) during parsing", skipped)

    if not files:
        log.error("No files were successfully parsed")
        return 1

    # ── Step 3: Resolve imports ──────────────────────────────────────
    log.info("Resolving imports ...")
    edges, unresolved = resolve_imports(files, cfg.project_path)

    # ── Step 4: Build graph and analyze ──────────────────────────────
    graph = ProjectGraph(
        name=cfg.name,
        root=cfg.project_path,
        files=files,
        edges=edges,
        unresolved=unresolved,
    )
    graph = analyze(graph)
    metrics = compute_metrics(graph)
    clusters = detect_clusters(graph)

    # ── Step 5: Create output directory ──────────────────────────────
    out = cfg.output_dir
    assert out is not None  # load_config always sets a default
    out.mkdir(parents=True, exist_ok=True)
    diagrams_dir = out / "diagrams"
    diagrams_dir.mkdir(parents=True, exist_ok=True)

    # ── Step 6: Summary ──────────────────────────────────────────────
    summary_md = generate_summary(graph, metrics=metrics, clusters=clusters)
    (out / "summary.md").write_text(summary_md, encoding="utf-8")
    log.info("Wrote %s", out / "summary.md")

    # ── Step 7: Mermaid diagrams ─────────────────────────────────────
    if cfg.generate_diagrams:
        mermaid_sources = generate_diagrams(
            graph, node_cap=cfg.node_cap, focus=cfg.focus_module,
        )
        log.info("Generated %d Mermaid diagram(s)", len(mermaid_sources))

        # ── Step 8: Write .mmd files and optionally render to PNG ────
        if mermaid_sources:
            rendered = render_mermaid_all(
                mermaid_sources, diagrams_dir, render=cfg.render_png,
            )
            if cfg.render_png:
                if rendered:
                    log.info("Rendered %d diagram(s) to PNG", len(rendered))
                else:
                    log.warning("PNG rendering failed — is mmdc installed?")

    # ── Step 9: Interactive HTML ─────────────────────────────────────
    if cfg.generate_html:
        html_path = diagrams_dir / "overview.html"
        generate_interactive_html(graph, html_path, node_cap=cfg.node_cap)
        log.info("Wrote %s", html_path)

    # ── Step 10: analysis.json ───────────────────────────────────────
    analysis_path = out / "analysis.json"
    analysis_path.write_text(
        json.dumps(graph.to_dict(), indent=2), encoding="utf-8",
    )
    log.info("Wrote %s", analysis_path)

    # ── Step 11: Print summary stats ─────────────────────────────────
    cycle_count = len(graph.cycles)
    print(f"\n{'=' * 50}")
    print(f"  Code Cartographer — {cfg.name}")
    print(f"{'=' * 50}")
    print(f"  Files parsed:    {graph.file_count}")
    print(f"  Symbols found:   {graph.symbol_count}")
    print(f"  Edges resolved:  {graph.edge_count}")
    print(f"  Unresolved:      {len(graph.unresolved)}")
    print(f"  Cycles found:    {cycle_count}")
    print(f"  Output:          {out}")
    print(f"{'=' * 50}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
