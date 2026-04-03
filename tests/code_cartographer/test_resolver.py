"""Tests for the import resolver."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.code_cartographer.models import (
    Edge,
    EdgeKind,
    FileNode,
    ImportInfo,
    Language,
    UnresolvedImport,
)
from src.code_cartographer.resolver import TsconfigResolver, resolve_imports

ROOT = Path("/project")


def _node(
    path: str | Path,
    lang: Language,
    imports: list[ImportInfo] | None = None,
) -> FileNode:
    p = Path(path) if isinstance(path, str) else path
    return FileNode(path=p, language=lang, imports=imports or [])


def _files(*nodes: FileNode) -> dict[Path, FileNode]:
    return {n.path: n for n in nodes}


# -----------------------------------------------------------------------
# Python
# -----------------------------------------------------------------------

class TestPythonRelativeImport:
    def test_single_dot(self):
        """from .models import User resolves to sibling models.py."""
        src = _node("/project/app/views.py", Language.PYTHON, [
            ImportInfo(module=".models", names=["User"], is_relative=True, line=1),
        ])
        target = _node("/project/app/models.py", Language.PYTHON)
        edges, unresolved = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path
        assert edges[0].names == ["User"]
        assert not unresolved

    def test_double_dot(self):
        """from ..shared import config resolves up one level."""
        src = _node("/project/app/sub/views.py", Language.PYTHON, [
            ImportInfo(module="..shared", names=["config"], is_relative=True, line=5),
        ])
        target = _node("/project/app/shared.py", Language.PYTHON)
        edges, unresolved = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_init_fallback(self):
        """from .utils import helper resolves to utils/__init__.py."""
        src = _node("/project/app/main.py", Language.PYTHON, [
            ImportInfo(module=".utils", names=["helper"], is_relative=True, line=2),
        ])
        target = _node("/project/app/utils/__init__.py", Language.PYTHON)
        edges, unresolved = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path


class TestPythonAbsoluteImport:
    def test_external_stdlib(self):
        """import os is external."""
        src = _node("/project/app/main.py", Language.PYTHON, [
            ImportInfo(module="os", line=1),
        ])
        _, unresolved = resolve_imports(_files(src), ROOT)
        assert len(unresolved) == 1
        assert unresolved[0].reason == "external"

    def test_internal_absolute(self):
        """import app.models resolves to project file."""
        src = _node("/project/main.py", Language.PYTHON, [
            ImportInfo(module="app.models", names=["User"], line=1),
        ])
        target = _node("/project/app/models.py", Language.PYTHON)
        edges, unresolved = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path


# -----------------------------------------------------------------------
# TypeScript / JavaScript
# -----------------------------------------------------------------------

class TestTypeScriptRelative:
    def test_no_extension(self):
        """import { X } from './foo' resolves to foo.ts."""
        src = _node("/project/src/bar.ts", Language.TYPESCRIPT, [
            ImportInfo(module="./foo", names=["X"], is_relative=True, line=1),
        ])
        target = _node("/project/src/foo.ts", Language.TYPESCRIPT)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_js_to_ts_stripping(self):
        """import { X } from './foo.js' finds foo.ts (ESM convention)."""
        src = _node("/project/src/bar.ts", Language.TYPESCRIPT, [
            ImportInfo(module="./foo.js", names=["X"], is_relative=True, line=1),
        ])
        target = _node("/project/src/foo.ts", Language.TYPESCRIPT)
        edges, unresolved = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path
        assert not unresolved

    def test_index_barrel(self):
        """import { Y } from './components' resolves to components/index.ts."""
        src = _node("/project/src/app.ts", Language.TYPESCRIPT, [
            ImportInfo(module="./components", names=["Y"], is_relative=True, line=3),
        ])
        target = _node("/project/src/components/index.ts", Language.TYPESCRIPT)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_external_package(self):
        """import express from 'express' is external."""
        src = _node("/project/src/app.ts", Language.TYPESCRIPT, [
            ImportInfo(module="express", names=["default"], line=1),
        ])
        _, unresolved = resolve_imports(_files(src), ROOT)
        assert len(unresolved) == 1
        assert unresolved[0].reason == "external"


class TestTsconfigResolver:
    def test_path_alias(self, tmp_path: Path):
        tsconfig = tmp_path / "tsconfig.json"
        tsconfig.write_text(
            '{"compilerOptions":{"baseUrl":"src","paths":{"@app/*":["app/*"]}}}'
        )
        r = TsconfigResolver(tmp_path)
        assert r.resolve("@app/utils") == "src/app/utils"

    def test_no_tsconfig(self, tmp_path: Path):
        r = TsconfigResolver(tmp_path)
        assert r.resolve("@app/foo") is None


# -----------------------------------------------------------------------
# Rust
# -----------------------------------------------------------------------

class TestRustCrate:
    def test_crate_path(self):
        """use crate::config::AppConfig resolves to src/config.rs."""
        src = _node("/project/src/main.rs", Language.RUST, [
            ImportInfo(module="crate::config::AppConfig", names=["AppConfig"], line=2),
        ])
        target = _node("/project/src/config.rs", Language.RUST)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_external_std(self):
        """use std::collections::HashMap is external."""
        src = _node("/project/src/main.rs", Language.RUST, [
            ImportInfo(module="std::collections::HashMap", line=1),
        ])
        _, unresolved = resolve_imports(_files(src), ROOT)
        assert len(unresolved) == 1
        assert unresolved[0].reason == "external"


class TestRustMod:
    def test_mod_file(self):
        """mod foo; (is_relative) resolves to foo.rs."""
        src = _node("/project/src/lib.rs", Language.RUST, [
            ImportInfo(module="foo", is_relative=True, line=1),
        ])
        target = _node("/project/src/foo.rs", Language.RUST)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_mod_dir(self):
        """mod bar; resolves to bar/mod.rs if bar.rs doesn't exist."""
        src = _node("/project/src/lib.rs", Language.RUST, [
            ImportInfo(module="bar", is_relative=True, line=1),
        ])
        target = _node("/project/src/bar/mod.rs", Language.RUST)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_super(self):
        """use super::utils resolves from parent directory."""
        src = _node("/project/src/sub/inner.rs", Language.RUST, [
            ImportInfo(module="super::utils", names=["helper"], line=3),
        ])
        target = _node("/project/src/utils.rs", Language.RUST)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path


# -----------------------------------------------------------------------
# C / C++
# -----------------------------------------------------------------------

class TestCppInclude:
    def test_local_include(self):
        """#include "config.h" resolves relative to file."""
        src = _node("/project/src/main.cpp", Language.CPP, [
            ImportInfo(module="config.h", is_relative=True, line=1),
        ])
        target = _node("/project/src/config.h", Language.CPP)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert len(edges) == 1
        assert edges[0].target == target.path

    def test_system_include(self):
        """#include <iostream> is external."""
        src = _node("/project/src/main.cpp", Language.CPP, [
            ImportInfo(module="iostream", is_relative=False, line=1),
        ])
        _, unresolved = resolve_imports(_files(src), ROOT)
        assert len(unresolved) == 1
        assert unresolved[0].reason == "external"


# -----------------------------------------------------------------------
# Cross-cutting: type-only, dynamic, not-found
# -----------------------------------------------------------------------

class TestEdgeKinds:
    def test_type_only_import(self):
        """Type-only imports get EdgeKind.TYPE_IMPORT."""
        src = _node("/project/src/bar.ts", Language.TYPESCRIPT, [
            ImportInfo(
                module="./foo", names=["MyType"], is_relative=True,
                is_type_only=True, line=1,
            ),
        ])
        target = _node("/project/src/foo.ts", Language.TYPESCRIPT)
        edges, _ = resolve_imports(_files(src, target), ROOT)
        assert edges[0].kind == EdgeKind.TYPE_IMPORT

    def test_dynamic_import(self):
        """Dynamic imports → UnresolvedImport with reason='dynamic'."""
        src = _node("/project/src/main.ts", Language.TYPESCRIPT, [
            ImportInfo(module="./lazy", is_dynamic=True, is_relative=True, line=10),
        ])
        _, unresolved = resolve_imports(_files(src), ROOT)
        assert len(unresolved) == 1
        assert unresolved[0].reason == "dynamic"

    def test_not_found(self):
        """Relative import to missing file → reason='not_found'."""
        src = _node("/project/app/views.py", Language.PYTHON, [
            ImportInfo(module=".missing", names=["X"], is_relative=True, line=7),
        ])
        _, unresolved = resolve_imports(_files(src), ROOT)
        assert len(unresolved) == 1
        assert unresolved[0].reason == "not_found"
