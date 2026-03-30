#!/usr/bin/env python3
"""
TASK-ADV-004: Convention Auto-Detection

Analyzes a project to detect coding conventions:
- Naming (snake_case vs camelCase)
- Test file patterns
- Import ordering
- Decorator usage patterns
- File structure conventions

Usage:
    python3 conventions.py /path/to/project [--output conventions.json]
"""

import ast
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

EXCLUDED_DIRS = {
    'node_modules', '__pycache__', '.venv', '.tv', '.git', '.claude',
    'dist', 'build', 'coverage', 'site-packages', '.swarm',
}


def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in EXCLUDED_DIRS or part.endswith('.egg-info'):
            return True
    return False


def detect_naming_convention(names: list[str]) -> dict[str, Any]:
    """Detect whether names follow snake_case, camelCase, PascalCase, etc."""
    patterns = Counter()
    for name in names:
        if name.startswith('_'):
            name = name.lstrip('_')
        if not name:
            continue
        if '_' in name and name == name.lower():
            patterns['snake_case'] += 1
        elif '_' in name and name == name.upper():
            patterns['SCREAMING_SNAKE'] += 1
        elif name[0].isupper() and '_' not in name:
            patterns['PascalCase'] += 1
        elif name[0].islower() and '_' not in name and any(c.isupper() for c in name):
            patterns['camelCase'] += 1
        elif name == name.lower():
            patterns['lowercase'] += 1
        else:
            patterns['mixed'] += 1

    total = sum(patterns.values())
    dominant = patterns.most_common(1)[0] if patterns else ('unknown', 0)

    return {
        'dominant': dominant[0],
        'percentage': round(dominant[1] / total * 100, 1) if total > 0 else 0,
        'distribution': dict(patterns.most_common()),
        'sample_size': total,
    }


def detect_test_patterns(project_root: Path, py_files: list[Path]) -> dict[str, Any]:
    """Detect test file naming and organization patterns."""
    test_files = [f for f in py_files if 'test' in f.name.lower() or 'tests' in str(f).lower()]
    test_patterns = Counter()

    for f in test_files:
        name = f.name
        if name.startswith('test_'):
            test_patterns['test_*.py'] += 1
        elif name.endswith('_test.py'):
            test_patterns['*_test.py'] += 1
        elif name.startswith('test') and not name.startswith('test_'):
            test_patterns['test*.py'] += 1

    # Check test location
    test_dirs = set()
    for f in test_files:
        rel = f.relative_to(project_root)
        for part in rel.parts:
            if 'test' in part.lower():
                test_dirs.add(part)
                break

    return {
        'file_count': len(test_files),
        'naming_pattern': test_patterns.most_common(1)[0][0] if test_patterns else 'unknown',
        'naming_distribution': dict(test_patterns),
        'test_directories': sorted(test_dirs),
        'colocated': len(test_dirs) == 0 and len(test_files) > 0,
    }


def detect_decorator_patterns(py_files: list[Path], project_root: Path) -> dict[str, Any]:
    """Detect common decorator usage patterns."""
    decorator_counts = Counter()

    for filepath in py_files:
        try:
            source = filepath.read_bytes().decode('utf-8', errors='replace')
            tree = ast.parse(source)
        except (SyntaxError, OSError):
            continue

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                for deco in node.decorator_list:
                    try:
                        text = ast.unparse(deco)
                        # Extract base decorator name
                        base = re.match(r'(\w+(?:\.\w+)*)', text)
                        if base:
                            decorator_counts[base.group(1)] += 1
                    except Exception:
                        pass

    return {
        'top_decorators': dict(decorator_counts.most_common(10)),
        'total_decorators': sum(decorator_counts.values()),
        'unique_decorators': len(decorator_counts),
    }


def detect_import_patterns(py_files: list[Path], project_root: Path) -> dict[str, Any]:
    """Detect import organization patterns."""
    has_stdlib_first = 0
    has_blank_between_groups = 0
    total_files = 0

    for filepath in py_files:
        try:
            source = filepath.read_text(encoding='utf-8', errors='replace')
            tree = ast.parse(source)
        except (SyntaxError, OSError):
            continue

        imports = []
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                imports.append(node)

        if len(imports) < 3:
            continue
        total_files += 1

        # Check if stdlib comes before project imports
        saw_project = False
        stdlib_after_project = False
        for imp in imports:
            if isinstance(imp, ast.ImportFrom) and imp.module and imp.level == 0:
                mod = imp.module.split('.')[0]
                if mod in ('os', 'sys', 'json', 'time', 'datetime', 'pathlib', 'typing',
                           'collections', 're', 'math', 'functools', 'itertools', 'asyncio'):
                    if saw_project:
                        stdlib_after_project = True
                else:
                    saw_project = True

        if not stdlib_after_project:
            has_stdlib_first += 1

    return {
        'stdlib_first_percentage': round(has_stdlib_first / total_files * 100, 1) if total_files > 0 else 0,
        'files_analyzed': total_files,
    }


def analyze_project(project_root: str) -> dict[str, Any]:
    root = Path(project_root).resolve()
    start_time = time.monotonic()

    py_files = [f for f in sorted(root.rglob('*.py')) if not should_exclude(f) and not f.is_symlink()]

    # Collect all function and class names
    func_names = []
    class_names = []
    var_names = []

    for filepath in py_files:
        try:
            source = filepath.read_bytes().decode('utf-8', errors='replace')
            tree = ast.parse(source)
        except (SyntaxError, OSError):
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
                func_names.append(node.name)
            elif isinstance(node, ast.ClassDef):
                class_names.append(node.name)

    elapsed_ms = (time.monotonic() - start_time) * 1000

    return {
        'project': root.name,
        'files_analyzed': len(py_files),
        'extraction_ms': round(elapsed_ms, 1),
        'conventions': {
            'function_naming': detect_naming_convention(func_names),
            'class_naming': detect_naming_convention(class_names),
            'test_patterns': detect_test_patterns(root, py_files),
            'decorator_patterns': detect_decorator_patterns(py_files, root),
            'import_ordering': detect_import_patterns(py_files, root),
        },
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: conventions.py <project-root> [--output conventions.json]", file=sys.stderr)
        sys.exit(1)

    project_root = sys.argv[1]
    output_file = None
    if '--output' in sys.argv:
        idx = sys.argv.index('--output')
        if idx + 1 < len(sys.argv):
            output_file = sys.argv[idx + 1]

    result = analyze_project(project_root)

    output = json.dumps(result, indent=2)
    if output_file:
        Path(output_file).write_text(output)
        print(f"Conventions: {output_file}", file=sys.stderr)
    else:
        print(output)

    c = result['conventions']
    print(f"Functions: {c['function_naming']['dominant']} ({c['function_naming']['percentage']}%)", file=sys.stderr)
    print(f"Classes: {c['class_naming']['dominant']} ({c['class_naming']['percentage']}%)", file=sys.stderr)
    print(f"Tests: {c['test_patterns']['naming_pattern']} ({c['test_patterns']['file_count']} files)", file=sys.stderr)
    print(f"Decorators: {c['decorator_patterns']['unique_decorators']} unique, top: {list(c['decorator_patterns']['top_decorators'].keys())[:3]}", file=sys.stderr)


if __name__ == '__main__':
    main()
