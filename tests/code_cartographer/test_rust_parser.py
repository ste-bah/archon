"""Tests for Rust parser."""

from pathlib import Path

from src.code_cartographer.models import Language, SymbolKind, Visibility
from src.code_cartographer.parsers.rust_parser import RustParser

FIXTURE = Path(__file__).parent / "fixtures" / "rust" / "sample.rs"


def _parse():
    parser = RustParser()
    node = parser.parse_file(FIXTURE, Language.RUST)
    assert node is not None
    return node


def test_file_metadata():
    node = _parse()
    assert node.language == Language.RUST
    assert node.lines > 0
    assert node.parse_errors == 0


def test_std_imports():
    node = _parse()
    modules = [i.module for i in node.imports]
    assert "std::collections" in modules or any("HashMap" in (i.names or []) for i in node.imports)


def test_crate_imports():
    node = _parse()
    crate_imports = [i for i in node.imports if i.is_relative]
    # crate::config::AppConfig and super::utils::validate
    assert len(crate_imports) >= 2


def test_trait():
    node = _parse()
    traits = [s for s in node.symbols if s.kind == SymbolKind.TRAIT]
    names = [t.name for t in traits]
    assert "Storage" in names


def test_trait_methods():
    node = _parse()
    methods = [s for s in node.symbols if s.kind == SymbolKind.METHOD and s.name.startswith("Storage.")]
    names = [m.name for m in methods]
    assert "Storage.get" in names
    assert "Storage.set" in names
    assert "Storage.delete" in names


def test_struct():
    node = _parse()
    structs = [s for s in node.symbols if s.kind == SymbolKind.STRUCT]
    names = [s.name for s in structs]
    assert "MemoryStore" in names

    ms = next(s for s in structs if s.name == "MemoryStore")
    assert "Debug" in ms.decorators
    assert "Serialize" in ms.decorators


def test_impl_methods():
    node = _parse()
    methods = [s for s in node.symbols if s.kind == SymbolKind.METHOD and s.name.startswith("MemoryStore.")]
    names = [m.name for m in methods]
    assert "MemoryStore.new" in names
    assert "MemoryStore.is_full" in names


def test_enum():
    node = _parse()
    enums = [s for s in node.symbols if s.kind == SymbolKind.ENUM]
    names = [e.name for e in enums]
    assert "CachePolicy" in names


def test_functions():
    node = _parse()
    funcs = [s for s in node.symbols if s.kind == SymbolKind.FUNCTION]
    names = [f.name for f in funcs]
    assert "create_store" in names
    assert "init_storage" in names


def test_constants():
    node = _parse()
    consts = [s for s in node.symbols if s.kind == SymbolKind.CONSTANT]
    names = [c.name for c in consts]
    assert "MAX_CONNECTIONS" in names


def test_visibility():
    node = _parse()
    ms_is_full = next(
        (s for s in node.symbols if s.name == "MemoryStore.is_full"), None
    )
    assert ms_is_full is not None
    assert ms_is_full.visibility == Visibility.PRIVATE
