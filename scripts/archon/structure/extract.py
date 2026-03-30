#!/usr/bin/env python3
"""
TASK-STRUCT-001: Python AST Structure Extractor

Extracts structural information from Python files using the stdlib `ast` module.
Produces a ProjectSummary JSON suitable for MemoryGraph storage and SessionStart injection.

PRD: PRD-ARCHON-CAP-001
Implements: REQ-STRUCT-003, REQ-STRUCT-004, REQ-STRUCT-005, REQ-STRUCT-006
Security: No user input reflected in output. No secrets. No network calls.

Usage:
    python3 extract.py /path/to/project [--output /path/to/output.json] [--compact /path/to/compact.json]
"""

import ast
import json
import os
import sys
import time
import tokenize
import io
from pathlib import Path
from typing import Any

# Require Python 3.9+ for ast.unparse()
if sys.version_info < (3, 9):
    print("ERROR: extract.py requires Python 3.9+ (for ast.unparse)", file=sys.stderr)
    sys.exit(1)

# --- Exclusion patterns (aligned with LEANN's exclusions) ---
EXCLUDED_DIRS = {
    'node_modules', '__pycache__', '.venv', '.tv', '.git', '.claude',
    'dist', 'build', 'coverage', '.tox', '.mypy_cache', '.pytest_cache',
    'site-packages', '.eggs', 'egg-info', '.swarm',
}

EXCLUDED_SUFFIXES = {'.pyc', '.pyo', '.min.js', '.min.css'}


def should_exclude(path: Path) -> bool:
    """Check if a path should be excluded from extraction."""
    parts = path.parts
    for part in parts:
        if part in EXCLUDED_DIRS:
            return True
        if part.endswith('.egg-info'):
            return True
    return path.suffix in EXCLUDED_SUFFIXES


def classify_role(filepath: Path, has_routes: bool = False) -> str:
    """Classify a file's role based on its path and content."""
    name = filepath.name
    parts = [p.lower() for p in filepath.parts]

    if 'test' in name or 'tests' in parts:
        return 'test'
    if 'routes' in parts or 'api' in parts or has_routes:
        return 'route'
    if 'models' in parts or 'schemas' in parts:
        return 'model'
    if 'data' in parts or 'clients' in parts:
        return 'data'
    if 'analysis' in parts:
        return 'analysis'
    if 'config' in parts or name == 'config.py':
        return 'config'
    if 'websocket' in name.lower() or 'ws' in name.lower():
        return 'websocket'
    if name == '__init__.py':
        return 'init'
    if name == 'main.py':
        return 'entry'
    return 'module'


def extract_file_structure(filepath: Path, project_root: Path) -> dict[str, Any] | None:
    """Extract structural information from a single Python file."""
    try:
        raw = filepath.read_bytes()
    except (OSError, PermissionError):
        return None

    # Detect encoding from Python encoding cookie (# -*- coding: xxx -*-)
    try:
        encoding = tokenize.detect_encoding(io.BytesIO(raw).readline)[0]
    except (SyntaxError, UnicodeDecodeError):
        encoding = 'utf-8'

    try:
        source = raw.decode(encoding, errors='replace')
    except (LookupError, UnicodeDecodeError):
        source = raw.decode('utf-8', errors='replace')

    try:
        tree = ast.parse(source, filename=str(filepath))
    except SyntaxError:
        # File has syntax errors — skip, don't crash the whole extractor
        return {
            'path': str(filepath.relative_to(project_root)),
            'language': 'python',
            'lines': source.count('\n') + 1,
            'role': classify_role(filepath),
            'error': 'syntax_error',
            'classes': [],
            'functions': [],
        }

    classes = []
    functions = []
    decorators_found = []

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            methods = []
            for item in ast.iter_child_nodes(node):
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    method_decos = [_unparse_decorator(d) for d in item.decorator_list]
                    methods.append({
                        'name': item.name,
                        'async': isinstance(item, ast.AsyncFunctionDef),
                        'params': _extract_params(item),
                        'returns': _extract_return_type(item),
                        'decorators': method_decos,
                    })
                    decorators_found.extend(method_decos)

            class_decos = [_unparse_decorator(d) for d in node.decorator_list]
            decorators_found.extend(class_decos)

            # Truncate methods if > 20 per class (EC-STRUCT-001)
            truncated = len(methods) > 20
            classes.append({
                'name': node.name,
                'methods': methods[:20],
                'method_count': len(methods),
                'truncated': truncated,
                'decorators': class_decos,
                'bases': [ast.unparse(b) for b in node.bases],
            })

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func_decos = [_unparse_decorator(d) for d in node.decorator_list]
            decorators_found.extend(func_decos)
            functions.append({
                'name': node.name,
                'async': isinstance(node, ast.AsyncFunctionDef),
                'params': _extract_params(node),
                'returns': _extract_return_type(node),
                'decorators': func_decos,
            })

    has_routes = any(
        'router.' in d or 'app.' in d or '@route' in d
        for d in decorators_found
    )

    line_count = source.count('\n') + 1
    rel_path = str(filepath.relative_to(project_root))

    return {
        'path': rel_path,
        'language': 'python',
        'lines': line_count,
        'role': classify_role(filepath, has_routes),
        'classes': classes,
        'functions': functions,
        'class_count': len(classes),
        'function_count': len(functions),
        'total_symbols': len(classes) + len(functions) + sum(c['method_count'] for c in classes),
    }


def _unparse_decorator(node: ast.expr) -> str:
    """Safely unparse a decorator node to string."""
    try:
        return '@' + ast.unparse(node)
    except Exception:
        return '@unknown'


def _extract_params(func: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict]:
    """Extract parameter names and type annotations."""
    params = []
    for arg in func.args.args:
        param = {'name': arg.arg}
        if arg.annotation:
            try:
                param['type'] = ast.unparse(arg.annotation)
            except Exception:
                pass
        params.append(param)
    return params


def _extract_return_type(func: ast.FunctionDef | ast.AsyncFunctionDef) -> str | None:
    """Extract return type annotation."""
    if func.returns:
        try:
            return ast.unparse(func.returns)
        except Exception:
            return None
    return None


def extract_project(project_root: str) -> dict[str, Any]:
    """Extract structure from an entire project directory."""
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise ValueError(f"Not a directory: {root}")

    start_time = time.monotonic()
    modules = []
    total_lines = 0
    total_files = 0

    for filepath in sorted(root.rglob('*.py')):
        if should_exclude(filepath):
            continue
        # Skip symlinks to prevent infinite loops
        if filepath.is_symlink():
            continue

        info = extract_file_structure(filepath, root)
        if info:
            modules.append(info)
            total_lines += info.get('lines', 0)
            total_files += 1

    elapsed_ms = (time.monotonic() - start_time) * 1000

    # Group by directory for the split strategy (REQ-STRUCT-004)
    directories: dict[str, list] = {}
    for mod in modules:
        dir_path = str(Path(mod['path']).parent)
        directories.setdefault(dir_path, []).append(mod)

    return {
        'project_name': root.name,
        'root_path': str(root),
        'languages': ['python'],
        'file_count': total_files,
        'total_lines': total_lines,
        'total_symbols': sum(m.get('total_symbols', 0) for m in modules),
        'extraction_ms': round(elapsed_ms, 1),
        'directories': {
            d: {
                'file_count': len(files),
                'total_lines': sum(f.get('lines', 0) for f in files),
                'total_symbols': sum(f.get('total_symbols', 0) for f in files),
                'files': files,
            }
            for d, files in sorted(directories.items())
        },
    }


def generate_compact_summary(project: dict[str, Any]) -> dict[str, Any]:
    """
    Generate a compact summary (< 3KB) for SessionStart hook injection.
    REQ-STRUCT-005: project name, file count, key modules (aggregated), languages, indexed SHA.
    """
    # Aggregate key modules by role
    role_counts: dict[str, int] = {}
    role_files: dict[str, list[str]] = {}

    for dir_name, dir_info in project.get('directories', {}).items():
        for f in dir_info.get('files', []):
            role = f.get('role', 'module')
            role_counts[role] = role_counts.get(role, 0) + 1
            if role not in ('init', 'test') and len(role_files.get(role, [])) < 5:
                role_files.setdefault(role, []).append(f['path'].split('/')[-1])

    # Get git SHA for staleness detection (REQ-STRUCT-006)
    import subprocess
    try:
        sha = subprocess.run(
            ['git', 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=5,
            cwd=project['root_path']
        ).stdout.strip()[:12]
    except Exception:
        sha = 'unknown'

    return {
        'projectName': project['project_name'],
        'languages': project['languages'],
        'fileCount': project['file_count'],
        'totalLines': project['total_lines'],
        'totalSymbols': project['total_symbols'],
        'extractionMs': project['extraction_ms'],
        'indexedSha': sha,
        'indexedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'keyModules': {
            role: {
                'count': count,
                'examples': role_files.get(role, []),
            }
            for role, count in sorted(role_counts.items())
            if role != 'init'
        },
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: extract.py <project-root> [--output full.json] [--compact compact.json]", file=sys.stderr)
        sys.exit(1)

    project_root = sys.argv[1]
    output_file = None
    compact_file = None

    # Parse args
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--output' and i + 1 < len(args):
            output_file = args[i + 1]
            i += 2
        elif args[i] == '--compact' and i + 1 < len(args):
            compact_file = args[i + 1]
            i += 2
        else:
            print(f"Unknown argument: {args[i]}", file=sys.stderr)
            sys.exit(1)

    # Extract
    project = extract_project(project_root)

    # Write full output
    full_json = json.dumps(project, indent=2)
    if output_file:
        Path(output_file).write_text(full_json)
        print(f"Full structure: {output_file} ({len(full_json)} bytes, {project['file_count']} files)", file=sys.stderr)
    else:
        print(full_json)

    # Write compact summary
    if compact_file:
        compact = generate_compact_summary(project)
        compact_json = json.dumps(compact, indent=2)
        Path(compact_file).write_text(compact_json)
        print(f"Compact summary: {compact_file} ({len(compact_json)} bytes)", file=sys.stderr)

    # Print stats
    print(f"Extracted {project['file_count']} files, {project['total_symbols']} symbols in {project['extraction_ms']:.0f}ms", file=sys.stderr)


if __name__ == '__main__':
    main()
