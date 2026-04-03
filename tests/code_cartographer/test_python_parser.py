"""Tests for Python parser."""

from pathlib import Path

from src.code_cartographer.models import Language, SymbolKind, Visibility
from src.code_cartographer.parsers.python_parser import PythonParser

FIXTURE = Path(__file__).parent / "fixtures" / "python" / "sample.py"


def _parse():
    parser = PythonParser()
    node = parser.parse_file(FIXTURE, Language.PYTHON)
    assert node is not None
    return node


def test_file_metadata():
    node = _parse()
    assert node.language == Language.PYTHON
    assert node.lines > 0
    assert node.parse_errors == 0


def test_standard_imports():
    node = _parse()
    modules = [i.module for i in node.imports]
    assert "os" in modules
    assert "sys" in modules


def test_from_imports():
    node = _parse()
    path_import = [i for i in node.imports if i.module == "pathlib"]
    assert len(path_import) == 1
    assert "Path" in path_import[0].names


def test_relative_imports():
    node = _parse()
    relative = [i for i in node.imports if i.is_relative]
    assert len(relative) >= 2  # from . import utils, from .models import ...
    modules = [i.module for i in relative]
    # Should have relative markers
    assert any("." in m for m in modules)


def test_try_except_imports():
    node = _parse()
    # ujson and json should both be captured
    modules = [i.module for i in node.imports]
    assert "json" in modules


def test_classes():
    node = _parse()
    classes = [s for s in node.symbols if s.kind == SymbolKind.CLASS]
    names = [c.name for c in classes]
    assert "BaseService" in names
    assert "AuthService" in names

    auth = next(c for c in classes if c.name == "AuthService")
    assert "BaseService" in auth.bases


def test_methods():
    node = _parse()
    methods = [s for s in node.symbols if s.kind == SymbolKind.METHOD]
    method_names = [m.name for m in methods]
    assert "AuthService.authenticate" in method_names
    assert "AuthService._validate_token" in method_names

    validate = next(m for m in methods if m.name == "AuthService._validate_token")
    assert validate.visibility == Visibility.PROTECTED


def test_functions():
    node = _parse()
    funcs = [s for s in node.symbols if s.kind == SymbolKind.FUNCTION]
    names = [f.name for f in funcs]
    assert "create_app" in names
    assert "fetch_data" in names


def test_function_params():
    node = _parse()
    create_app = next(
        s for s in node.symbols
        if s.kind == SymbolKind.FUNCTION and s.name == "create_app"
    )
    assert "config_path" in create_app.params


def test_exports():
    node = _parse()
    assert "AuthService" in node.exports
    assert "create_app" in node.exports
    assert "fetch_data" in node.exports
