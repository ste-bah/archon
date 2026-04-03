"""Tests for C++ parser."""

from pathlib import Path

from src.code_cartographer.models import Language, SymbolKind, Visibility
from src.code_cartographer.parsers.cpp_parser import CppParser

FIXTURE = Path(__file__).parent / "fixtures" / "cpp" / "sample.cpp"


def _parse():
    parser = CppParser()
    node = parser.parse_file(FIXTURE, Language.CPP)
    assert node is not None
    return node


def test_file_metadata():
    node = _parse()
    assert node.language == Language.CPP
    assert node.lines > 0
    assert node.parse_errors == 0


def test_system_includes():
    node = _parse()
    system = [i for i in node.imports if not i.is_relative]
    modules = [i.module for i in system]
    assert "iostream" in modules
    assert "vector" in modules
    assert "string" in modules
    assert "memory" in modules


def test_local_includes():
    node = _parse()
    local = [i for i in node.imports if i.is_relative]
    modules = [i.module for i in local]
    assert "config.h" in modules
    assert "utils/logger.h" in modules
    assert "../shared/types.h" in modules


def test_namespaced_class():
    node = _parse()
    classes = [s for s in node.symbols if s.kind == SymbolKind.CLASS]
    names = [c.name for c in classes]
    assert "app::core::BaseProcessor" in names
    assert "app::core::DataProcessor" in names


def test_inheritance():
    node = _parse()
    dp = next(s for s in node.symbols if s.name == "app::core::DataProcessor")
    assert "BaseProcessor" in dp.bases


def test_struct():
    node = _parse()
    structs = [s for s in node.symbols if s.kind == SymbolKind.STRUCT]
    names = [s.name for s in structs]
    assert "app::core::ProcessResult" in names


def test_template_class():
    node = _parse()
    classes = [s for s in node.symbols if s.kind == SymbolKind.CLASS]
    names = [c.name for c in classes]
    assert "app::core::GenericCache" in names


def test_enum():
    node = _parse()
    enums = [s for s in node.symbols if s.kind == SymbolKind.ENUM]
    names = [e.name for e in enums]
    assert "app::core::LogLevel" in names


def test_methods():
    node = _parse()
    methods = [s for s in node.symbols if s.kind == SymbolKind.METHOD]
    method_names = [m.name for m in methods]
    # BaseProcessor methods
    assert "app::core::BaseProcessor.process" in method_names
    # DataProcessor methods
    assert "app::core::DataProcessor.process" in method_names


def test_method_visibility():
    node = _parse()
    methods = [s for s in node.symbols if s.kind == SymbolKind.METHOD]

    # DataProcessor.validateInput should be private
    validate = next(
        (m for m in methods if "validateInput" in m.name), None
    )
    assert validate is not None
    assert validate.visibility == Visibility.PRIVATE


def test_function_declarations():
    node = _parse()
    funcs = [s for s in node.symbols if s.kind == SymbolKind.FUNCTION]
    names = [f.name for f in funcs]
    assert "app::core::run_pipeline" in names
    assert "app::core::initialize" in names
