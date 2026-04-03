"""Configuration loading for Code Cartographer."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path

from .models import Language

# ── Language string mapping ──────────────────────────────────────────

_LANG_MAP: dict[str, Language] = {
    "py": Language.PYTHON,
    "python": Language.PYTHON,
    "ts": Language.TYPESCRIPT,
    "typescript": Language.TYPESCRIPT,
    "tsx": Language.TSX,
    "js": Language.JAVASCRIPT,
    "javascript": Language.JAVASCRIPT,
    "rs": Language.RUST,
    "rust": Language.RUST,
    "cpp": Language.CPP,
    "c++": Language.CPP,
    "c": Language.C,
}


def _parse_language(raw: str) -> Language:
    key = raw.strip().lower()
    if key not in _LANG_MAP:
        raise ValueError(f"Unknown language: {raw!r}")
    return _LANG_MAP[key]


# ── Config dataclass ─────────────────────────────────────────────────

@dataclass
class CartographerConfig:
    project_path: Path
    name: str = ""
    output_dir: Path | None = None
    languages: set[Language] | None = None
    max_depth: int | None = None
    exclude_patterns: list[str] = field(default_factory=list)
    generate_diagrams: bool = True
    render_png: bool = True
    generate_html: bool = True
    node_cap: int = 60
    focus_module: str | None = None
    verbose: bool = False


# ── Load from .cartographer.json + CLI overrides ─────────────────────

def load_config(project_path: Path, **cli_overrides) -> CartographerConfig:
    """Load config from .cartographer.json merged with CLI overrides."""
    project_path = Path(project_path).resolve()
    file_cfg: dict = {}
    cfg_file = project_path / ".cartographer.json"
    if cfg_file.exists():
        file_cfg = json.loads(cfg_file.read_text())

    # Start with file values, override with any explicit CLI args
    merged = {**file_cfg, **{k: v for k, v in cli_overrides.items() if v is not None}}

    # Parse languages from either source
    languages: set[Language] | None = None
    if "languages" in merged:
        raw = merged.pop("languages")
        if isinstance(raw, set):
            languages = raw
        elif isinstance(raw, (list, tuple)):
            languages = {_parse_language(lang) for lang in raw}

    # Map JSON key "exclude" to dataclass field "exclude_patterns"
    exclude = merged.pop("exclude", None) or merged.pop("exclude_patterns", [])
    if isinstance(exclude, str):
        exclude = [exclude]

    name = merged.get("name", "") or project_path.name
    output_dir = merged.get("output_dir")
    if output_dir is not None:
        output_dir = Path(output_dir)
    else:
        output_dir = project_path.parent / "research" / name

    return CartographerConfig(
        project_path=project_path,
        name=name,
        output_dir=output_dir,
        languages=languages,
        max_depth=merged.get("max_depth"),
        exclude_patterns=list(exclude),
        generate_diagrams=merged.get("generate_diagrams", True),
        render_png=merged.get("render_png", True),
        generate_html=merged.get("generate_html", True),
        node_cap=merged.get("node_cap", 60),
        focus_module=merged.get("focus_module"),
        verbose=merged.get("verbose", False),
    )


# ── CLI argument parser ──────────────────────────────────────────────

def parse_cli_args(args: list[str] | None = None) -> CartographerConfig:
    """Parse command-line arguments into a CartographerConfig."""
    parser = argparse.ArgumentParser(
        prog="code-cartographer",
        description="Map a codebase's dependency graph and generate diagrams.",
    )
    parser.add_argument("project_path", type=Path, help="Path to project root")
    parser.add_argument("--name", default=None, help="Project name (default: dir name)")
    parser.add_argument("--output", default=None, help="Output directory")
    parser.add_argument(
        "--languages", default=None,
        help="Comma-separated language filter (e.g. py,ts,rs,cpp)",
    )
    parser.add_argument("--max-depth", type=int, default=None, help="Max traversal depth")
    parser.add_argument(
        "--exclude", action="append", default=None,
        help="Glob pattern to exclude (repeatable)",
    )
    parser.add_argument("--no-diagrams", action="store_true", help="Skip diagram generation")
    parser.add_argument("--no-render", action="store_true", help="Skip PNG rendering")
    parser.add_argument("--no-html", action="store_true", help="Skip HTML generation")
    parser.add_argument("--node-cap", type=int, default=None, help="Max nodes per diagram")
    parser.add_argument("--focus", default=None, help="Focus on a specific module")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")

    ns = parser.parse_args(args)

    overrides: dict = {}
    if ns.name is not None:
        overrides["name"] = ns.name
    if ns.output is not None:
        overrides["output_dir"] = ns.output
    if ns.languages is not None:
        overrides["languages"] = [s.strip() for s in ns.languages.split(",")]
    if ns.max_depth is not None:
        overrides["max_depth"] = ns.max_depth
    if ns.exclude:
        overrides["exclude_patterns"] = ns.exclude
    if ns.no_diagrams:
        overrides["generate_diagrams"] = False
    if ns.no_render:
        overrides["render_png"] = False
    if ns.no_html:
        overrides["generate_html"] = False
    if ns.node_cap is not None:
        overrides["node_cap"] = ns.node_cap
    if ns.focus is not None:
        overrides["focus_module"] = ns.focus
    if ns.verbose:
        overrides["verbose"] = True

    return load_config(ns.project_path, **overrides)
