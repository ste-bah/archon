"""Data models for Code Cartographer."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class Language(Enum):
    PYTHON = "python"
    TYPESCRIPT = "typescript"
    TSX = "tsx"
    JAVASCRIPT = "javascript"
    RUST = "rust"
    CPP = "cpp"
    C = "c"


class SymbolKind(Enum):
    FUNCTION = "function"
    METHOD = "method"
    CLASS = "class"
    STRUCT = "struct"
    TRAIT = "trait"
    INTERFACE = "interface"
    ENUM = "enum"
    TYPE_ALIAS = "type_alias"
    CONSTANT = "constant"
    MODULE = "module"


class Visibility(Enum):
    PUBLIC = "public"
    PRIVATE = "private"
    PROTECTED = "protected"
    INTERNAL = "internal"  # pub(crate) in Rust


class EdgeKind(Enum):
    IMPORT = "import"
    TYPE_IMPORT = "type_import"
    INHERITANCE = "inheritance"
    IMPLEMENTATION = "implementation"  # impl Trait for Struct
    RE_EXPORT = "re_export"
    DYNAMIC = "dynamic"  # unresolvable dynamic import


@dataclass
class Symbol:
    name: str
    kind: SymbolKind
    visibility: Visibility = Visibility.PUBLIC
    line: int = 0
    params: list[str] = field(default_factory=list)
    return_type: str | None = None
    bases: list[str] = field(default_factory=list)  # parent classes/traits
    decorators: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d: dict = {"name": self.name, "kind": self.kind.value, "line": self.line}
        if self.visibility != Visibility.PUBLIC:
            d["visibility"] = self.visibility.value
        if self.params:
            d["params"] = self.params
        if self.return_type:
            d["return_type"] = self.return_type
        if self.bases:
            d["bases"] = self.bases
        if self.decorators:
            d["decorators"] = self.decorators
        return d


@dataclass
class ImportInfo:
    """A single import statement extracted from source."""
    module: str  # the import path as written
    names: list[str] = field(default_factory=list)  # specific names imported
    alias: str | None = None
    is_type_only: bool = False
    is_dynamic: bool = False
    is_relative: bool = False
    line: int = 0

    def to_dict(self) -> dict:
        d: dict = {"module": self.module, "line": self.line}
        if self.names:
            d["names"] = self.names
        if self.alias:
            d["alias"] = self.alias
        if self.is_type_only:
            d["type_only"] = True
        if self.is_dynamic:
            d["dynamic"] = True
        if self.is_relative:
            d["relative"] = True
        return d


@dataclass
class FileNode:
    """Parsed representation of a single source file."""
    path: Path
    language: Language
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[ImportInfo] = field(default_factory=list)
    exports: list[str] = field(default_factory=list)  # exported symbol names
    lines: int = 0
    parse_errors: int = 0

    def to_dict(self) -> dict:
        return {
            "path": str(self.path),
            "language": self.language.value,
            "lines": self.lines,
            "symbols": [s.to_dict() for s in self.symbols],
            "imports": [i.to_dict() for i in self.imports],
            "exports": self.exports,
            "parse_errors": self.parse_errors,
        }


@dataclass
class Edge:
    """A dependency edge between two files."""
    source: Path  # file that imports
    target: Path  # file being imported
    kind: EdgeKind = EdgeKind.IMPORT
    names: list[str] = field(default_factory=list)  # specific symbols imported

    def to_dict(self) -> dict:
        d: dict = {
            "source": str(self.source),
            "target": str(self.target),
            "kind": self.kind.value,
        }
        if self.names:
            d["names"] = self.names
        return d


@dataclass
class UnresolvedImport:
    """An import that couldn't be mapped to a project file."""
    source: Path
    module: str
    reason: str  # "external", "dynamic", "not_found"
    line: int = 0


@dataclass
class ProjectGraph:
    """The full dependency graph for a project."""
    name: str
    root: Path
    files: dict[Path, FileNode] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)
    unresolved: list[UnresolvedImport] = field(default_factory=list)
    cycles: list[list[Path]] = field(default_factory=list)
    _fan_in: dict[Path, int] = field(default_factory=dict, repr=False)
    _fan_out: dict[Path, int] = field(default_factory=dict, repr=False)

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def symbol_count(self) -> int:
        return sum(len(f.symbols) for f in self.files.values())

    @property
    def edge_count(self) -> int:
        return len(self.edges)

    def language_breakdown(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for f in self.files.values():
            lang = f.language.value
            counts[lang] = counts.get(lang, 0) + 1
        return counts

    def build_index(self) -> None:
        """Pre-compute fan_in and fan_out counts from edges for O(1) lookup."""
        fi: dict[Path, int] = defaultdict(int)
        fo: dict[Path, int] = defaultdict(int)
        for e in self.edges:
            fi[e.target] += 1
            fo[e.source] += 1
        self._fan_in = dict(fi)
        self._fan_out = dict(fo)

    def fan_in(self, path: Path) -> int:
        """How many files import this file."""
        if self._fan_in:
            return self._fan_in.get(path, 0)
        return sum(1 for e in self.edges if e.target == path)

    def fan_out(self, path: Path) -> int:
        """How many files this file imports."""
        if self._fan_out:
            return self._fan_out.get(path, 0)
        return sum(1 for e in self.edges if e.source == path)

    def hotspots(self, top_n: int = 20) -> list[tuple[Path, int, int]]:
        """Return files with highest fan_in + fan_out."""
        scores = []
        for path in self.files:
            fi = self._fan_in.get(path, 0) if self._fan_in else self.fan_in(path)
            fo = self._fan_out.get(path, 0) if self._fan_out else self.fan_out(path)
            scores.append((path, fi, fo))
        scores.sort(key=lambda x: x[1] + x[2], reverse=True)
        return scores[:top_n]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "root": str(self.root),
            "file_count": self.file_count,
            "symbol_count": self.symbol_count,
            "edge_count": self.edge_count,
            "language_breakdown": self.language_breakdown(),
            "files": {str(p): f.to_dict() for p, f in self.files.items()},
            "edges": [e.to_dict() for e in self.edges],
            "unresolved": [
                {"source": str(u.source), "module": u.module, "reason": u.reason, "line": u.line}
                for u in self.unresolved
            ],
            "cycles": [[str(p) for p in c] for c in self.cycles],
        }
