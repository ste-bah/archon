#!/usr/bin/env python3
"""
TASK-ENH-005: Python Import Resolution

Resolves Python import statements to actual file paths within a project.
Builds IMPORTS edges for the dependency graph.

Usage:
    python3 imports.py /path/to/project [--output /path/to/imports.json]
"""

import ast
import json
import sys
import time
from pathlib import Path
from typing import Any

if sys.version_info < (3, 9):
    print("ERROR: imports.py requires Python 3.9+", file=sys.stderr)
    sys.exit(1)

# Reuse exclusion patterns from extract.py
EXCLUDED_DIRS = {
    'node_modules', '__pycache__', '.venv', '.tv', '.git', '.claude',
    'dist', 'build', 'coverage', '.tox', '.mypy_cache', '.pytest_cache',
    'site-packages', '.eggs', '.swarm',
}


def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in EXCLUDED_DIRS or part.endswith('.egg-info'):
            return True
    return path.suffix in {'.pyc', '.pyo'}


def build_module_map(project_root: Path) -> dict[str, Path]:
    """Build a map of Python module paths to file paths.

    e.g., 'app.data.cache' -> /project/app/data/cache.py
          'app.data' -> /project/app/data/__init__.py
    """
    module_map: dict[str, Path] = {}

    for filepath in sorted(project_root.rglob('*.py')):
        if should_exclude(filepath) or filepath.is_symlink():
            continue

        rel = filepath.relative_to(project_root)

        # Convert file path to module path
        if filepath.name == '__init__.py':
            # Package: app/data/__init__.py -> app.data
            module_path = '.'.join(rel.parent.parts)
        else:
            # Module: app/data/cache.py -> app.data.cache
            module_path = '.'.join(rel.with_suffix('').parts)

        if module_path:
            module_map[module_path] = filepath

    return module_map


def resolve_import(
    import_module: str,
    import_names: list[str],
    importing_file: Path,
    project_root: Path,
    module_map: dict[str, Path],
    is_relative: bool = False,
    level: int = 0,
) -> list[dict[str, Any]]:
    """Resolve a single import statement to file paths.

    Returns list of {from_file, to_file, symbols, resolved} dicts.
    """
    results = []

    if is_relative and level > 0:
        # Relative import: from ..data.cache import CacheManager
        importing_rel = importing_file.relative_to(project_root)
        package_parts = list(importing_rel.parent.parts)

        # Go up 'level' directories
        if level <= len(package_parts):
            base_parts = package_parts[:len(package_parts) - level + 1] if level == 1 else package_parts[:len(package_parts) - level]
        else:
            return results  # Can't go above project root

        if import_module:
            full_module = '.'.join(base_parts + import_module.split('.'))
        else:
            full_module = '.'.join(base_parts)
    else:
        full_module = import_module

    # Try to resolve the module
    from_file = str(importing_file.relative_to(project_root))

    # Direct module match
    if full_module in module_map:
        results.append({
            'from': from_file,
            'to': str(module_map[full_module].relative_to(project_root)),
            'symbols': import_names,
            'resolved': True,
        })
        return results

    # Try as a name within a package (from app.data import cache -> app/data/cache.py)
    for name in import_names:
        candidate = f"{full_module}.{name}" if full_module else name
        if candidate in module_map:
            results.append({
                'from': from_file,
                'to': str(module_map[candidate].relative_to(project_root)),
                'symbols': [name],
                'resolved': True,
            })

    # If nothing resolved, it's likely a third-party import
    if not results:
        results.append({
            'from': from_file,
            'to': full_module,
            'symbols': import_names,
            'resolved': False,  # External/third-party
        })

    return results


def extract_imports(filepath: Path, project_root: Path, module_map: dict[str, Path]) -> list[dict[str, Any]]:
    """Extract and resolve all imports from a single Python file."""
    try:
        source = filepath.read_bytes().decode('utf-8', errors='replace')
        tree = ast.parse(source, filename=str(filepath))
    except (SyntaxError, OSError):
        return []

    all_imports = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                all_imports.extend(resolve_import(
                    import_module=alias.name,
                    import_names=[alias.asname or alias.name.split('.')[-1]],
                    importing_file=filepath,
                    project_root=project_root,
                    module_map=module_map,
                ))

        elif isinstance(node, ast.ImportFrom):
            if node.module is None and node.level == 0:
                continue  # Skip bare 'import' with no module

            names = [alias.name for alias in node.names if alias.name != '*']
            all_imports.extend(resolve_import(
                import_module=node.module or '',
                import_names=names,
                importing_file=filepath,
                project_root=project_root,
                module_map=module_map,
                is_relative=node.level > 0,
                level=node.level,
            ))

    return all_imports


def extract_project_imports(project_root: str) -> dict[str, Any]:
    """Extract all imports from a project with resolution."""
    root = Path(project_root).resolve()
    start_time = time.monotonic()

    module_map = build_module_map(root)
    all_imports = []
    files_processed = 0

    for filepath in sorted(root.rglob('*.py')):
        if should_exclude(filepath) or filepath.is_symlink():
            continue
        imports = extract_imports(filepath, root, module_map)
        all_imports.extend(imports)
        files_processed += 1

    elapsed_ms = (time.monotonic() - start_time) * 1000

    # Separate internal (resolved) from external
    internal = [i for i in all_imports if i['resolved']]
    external = [i for i in all_imports if not i['resolved']]

    # Build dependency graph (unique edges)
    edges = {}
    for imp in internal:
        key = (imp['from'], imp['to'])
        if key not in edges:
            edges[key] = {'from': imp['from'], 'to': imp['to'], 'symbols': []}
        edges[key]['symbols'].extend(imp['symbols'])

    # Deduplicate symbols per edge
    for edge in edges.values():
        edge['symbols'] = sorted(set(edge['symbols']))

    return {
        'project_root': str(root),
        'files_processed': files_processed,
        'modules_mapped': len(module_map),
        'total_imports': len(all_imports),
        'internal_imports': len(internal),
        'external_imports': len(external),
        'unique_edges': len(edges),
        'extraction_ms': round(elapsed_ms, 1),
        'edges': list(edges.values()),
        'external_dependencies': sorted(set(i['to'] for i in external)),
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: imports.py <project-root> [--output imports.json]", file=sys.stderr)
        sys.exit(1)

    project_root = sys.argv[1]
    output_file = None
    if '--output' in sys.argv:
        idx = sys.argv.index('--output')
        if idx + 1 < len(sys.argv):
            output_file = sys.argv[idx + 1]

    result = extract_project_imports(project_root)

    output = json.dumps(result, indent=2)
    if output_file:
        Path(output_file).write_text(output)
        print(f"Imports: {output_file} ({result['unique_edges']} edges, {result['files_processed']} files, {result['extraction_ms']:.0f}ms)", file=sys.stderr)
    else:
        print(output)

    print(f"Internal: {result['internal_imports']} | External: {result['external_imports']} | Edges: {result['unique_edges']}", file=sys.stderr)


if __name__ == '__main__':
    main()
