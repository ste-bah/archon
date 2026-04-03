"""Tests for TypeScript parser."""

from pathlib import Path

from src.code_cartographer.models import Language, SymbolKind, Visibility
from src.code_cartographer.parsers.typescript_parser import TypeScriptParser

FIXTURE = Path(__file__).parent / "fixtures" / "typescript" / "sample.ts"


def _parse():
    parser = TypeScriptParser(tsx=False)
    node = parser.parse_file(FIXTURE, Language.TYPESCRIPT)
    assert node is not None
    return node


def test_file_metadata():
    node = _parse()
    assert node.language == Language.TYPESCRIPT
    assert node.lines > 0
    assert node.parse_errors == 0


def test_named_imports():
    node = _parse()
    express_import = [i for i in node.imports if i.module == "express"]
    assert len(express_import) == 1
    assert "Router" in express_import[0].names
    assert "Request" in express_import[0].names


def test_type_import():
    node = _parse()
    type_imports = [i for i in node.imports if i.is_type_only]
    assert len(type_imports) >= 1
    config_import = [i for i in type_imports if i.module == "./config"]
    assert len(config_import) == 1


def test_relative_imports():
    node = _parse()
    relative = [i for i in node.imports if i.is_relative]
    assert len(relative) >= 3  # ./config, ./services/user.service, ../shared/utils, ./defaults


def test_namespace_import():
    node = _parse()
    ns = [i for i in node.imports if any("*" in n for n in i.names)]
    assert len(ns) >= 1  # import * as utils


def test_default_import():
    node = _parse()
    defaults_import = [i for i in node.imports if i.module == "./defaults"]
    assert len(defaults_import) == 1


def test_interface():
    node = _parse()
    ifaces = [s for s in node.symbols if s.kind == SymbolKind.INTERFACE]
    names = [i.name for i in ifaces]
    assert "ApiResponse" in names


def test_type_alias():
    node = _parse()
    types = [s for s in node.symbols if s.kind == SymbolKind.TYPE_ALIAS]
    names = [t.name for t in types]
    assert "UserId" in names


def test_class():
    node = _parse()
    classes = [s for s in node.symbols if s.kind == SymbolKind.CLASS]
    names = [c.name for c in classes]
    assert "ApiController" in names


def test_methods():
    node = _parse()
    methods = [s for s in node.symbols if s.kind == SymbolKind.METHOD]
    method_names = [m.name for m in methods]
    assert "ApiController.getUser" in method_names
    assert "ApiController.handleError" in method_names

    handle_error = next(m for m in methods if m.name == "ApiController.handleError")
    assert handle_error.visibility == Visibility.PRIVATE


def test_exported_function():
    node = _parse()
    funcs = [s for s in node.symbols if s.kind == SymbolKind.FUNCTION]
    names = [f.name for f in funcs]
    assert "createRouter" in names
    assert "createRouter" in node.exports


def test_exports():
    node = _parse()
    assert "ApiResponse" in node.exports
    assert "UserId" in node.exports
    assert "ApiController" in node.exports
    assert "default" in node.exports


def test_constant():
    node = _parse()
    consts = [s for s in node.symbols if s.kind == SymbolKind.CONSTANT]
    names = [c.name for c in consts]
    assert "API_VERSION" in names
    assert "API_VERSION" in node.exports
