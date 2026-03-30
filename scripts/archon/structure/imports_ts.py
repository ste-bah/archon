#!/usr/bin/env python3
"""
TASK-ADV-002: TypeScript Import Resolution

Resolves TypeScript imports to file paths within a project.
Handles: relative imports, barrel files (index.ts), path aliases (@/).

Usage:
    python3 imports_ts.py /path/to/project [--output imports.json] [--tsconfig tsconfig.json]
"""

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

EXCLUDED_DIRS = {
    'node_modules', '__pycache__', '.venv', '.tv', '.git', '.claude',
    'dist', 'build', 'coverage', '.next', '.swarm',
}
TS_EXTENSIONS = {'.ts', '.tsx', '.js', '.jsx'}

RE_IMPORT = re.compile(
    r"""(?:import|export)\s+"""
    r"""(?:(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?"""
    r"""['"]([^'"]+)['"]""",
    re.MULTILINE
)
RE_REQUIRE = re.compile(r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""")
RE_IMPORT_NAMES = re.compile(r"""import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]""", re.MULTILINE)


def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in EXCLUDED_DIRS:
            return True
    return False


def load_path_aliases(project_root: Path, tsconfig_path: str | None = None) -> dict[str, str]:
    """Load path aliases from tsconfig.json (e.g., @/* -> src/*)."""
    aliases = {}
    tsconfig = project_root / (tsconfig_path or 'tsconfig.json')
    if not tsconfig.exists():
        return aliases

    try:
        # Strip comments from tsconfig (JSON with comments)
        content = tsconfig.read_text()
        content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        config = json.loads(content)

        paths = config.get('compilerOptions', {}).get('paths', {})
        base_url = config.get('compilerOptions', {}).get('baseUrl', '.')

        for alias, targets in paths.items():
            if targets:
                # @/* -> src/* becomes '@/' -> 'src/'
                alias_prefix = alias.replace('/*', '/').replace('*', '')
                target_prefix = targets[0].replace('/*', '/').replace('*', '')
                resolved = str((project_root / base_url / target_prefix).resolve())
                aliases[alias_prefix] = resolved
    except (json.JSONDecodeError, KeyError):
        pass

    return aliases


def build_ts_file_map(project_root: Path) -> dict[str, Path]:
    """Map importable paths to actual files, including barrel files."""
    file_map: dict[str, Path] = {}

    for ext in TS_EXTENSIONS:
        for filepath in sorted(project_root.rglob(f'*{ext}')):
            if should_exclude(filepath) or filepath.is_symlink():
                continue

            rel = filepath.relative_to(project_root)
            # Without extension: src/hooks/useAnalysis
            no_ext = str(rel.with_suffix(''))
            file_map[no_ext] = filepath
            # With extension
            file_map[str(rel)] = filepath

            # Barrel: src/hooks/index.ts -> importable as src/hooks
            if filepath.name.startswith('index.'):
                dir_path = str(rel.parent)
                if dir_path != '.':
                    file_map[dir_path] = filepath

    return file_map


def resolve_ts_import(
    import_path: str,
    importing_file: Path,
    project_root: Path,
    file_map: dict[str, Path],
    path_aliases: dict[str, str],
) -> dict[str, Any] | None:
    """Resolve a single import to a file path."""
    from_file = str(importing_file.relative_to(project_root))

    # Skip node_modules / external packages
    if not import_path.startswith('.') and not any(import_path.startswith(a) for a in path_aliases):
        return {'from': from_file, 'to': import_path, 'resolved': False}

    # Apply path aliases
    resolved_path = import_path
    for alias, target in path_aliases.items():
        if import_path.startswith(alias):
            resolved_path = import_path.replace(alias, str(Path(target).relative_to(project_root)) + '/', 1)
            break

    # Resolve relative imports
    if resolved_path.startswith('.'):
        base = importing_file.parent
        resolved = (base / resolved_path).resolve()
        try:
            resolved_path = str(resolved.relative_to(project_root))
        except ValueError:
            return {'from': from_file, 'to': import_path, 'resolved': False}

    # Look up in file map
    if resolved_path in file_map:
        return {
            'from': from_file,
            'to': str(file_map[resolved_path].relative_to(project_root)),
            'resolved': True,
        }

    # Try with extensions
    for ext in ['.ts', '.tsx', '.js', '.jsx']:
        candidate = resolved_path + ext.replace('.', '')  # without the dot in map key
        if candidate in file_map:
            return {
                'from': from_file,
                'to': str(file_map[candidate].relative_to(project_root)),
                'resolved': True,
            }

    # Try as directory (barrel import)
    for ext in ['/index.ts', '/index.tsx', '/index.js']:
        candidate = resolved_path.rstrip('/') + ext.replace('.', '')
        if candidate in file_map:
            return {
                'from': from_file,
                'to': str(file_map[candidate].relative_to(project_root)),
                'resolved': True,
            }

    return {'from': from_file, 'to': import_path, 'resolved': False}


def extract_ts_imports(project_root: str, tsconfig_path: str | None = None) -> dict[str, Any]:
    root = Path(project_root).resolve()
    start_time = time.monotonic()

    path_aliases = load_path_aliases(root, tsconfig_path)
    file_map = build_ts_file_map(root)
    all_imports = []
    files_processed = 0

    for ext in TS_EXTENSIONS:
        for filepath in sorted(root.rglob(f'*{ext}')):
            if should_exclude(filepath) or filepath.is_symlink():
                continue

            try:
                content = filepath.read_text(encoding='utf-8', errors='replace')
            except (OSError, PermissionError):
                continue

            files_processed += 1

            # Extract all import paths
            for m in RE_IMPORT.finditer(content):
                imp = resolve_ts_import(m.group(1), filepath, root, file_map, path_aliases)
                if imp:
                    all_imports.append(imp)

            for m in RE_REQUIRE.finditer(content):
                imp = resolve_ts_import(m.group(1), filepath, root, file_map, path_aliases)
                if imp:
                    all_imports.append(imp)

    elapsed_ms = (time.monotonic() - start_time) * 1000

    internal = [i for i in all_imports if i['resolved']]
    external = [i for i in all_imports if not i['resolved']]

    # Build unique edges
    edges = {}
    for imp in internal:
        key = (imp['from'], imp['to'])
        if key not in edges:
            edges[key] = {'from': imp['from'], 'to': imp['to']}

    return {
        'project_root': str(root),
        'files_processed': files_processed,
        'path_aliases': {k: str(v) for k, v in path_aliases.items()} if path_aliases else {},
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
        print("Usage: imports_ts.py <project-root> [--output imports.json] [--tsconfig tsconfig.json]", file=sys.stderr)
        sys.exit(1)

    project_root = sys.argv[1]
    output_file = None
    tsconfig = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--output' and i + 1 < len(args):
            output_file = args[i + 1]; i += 2
        elif args[i] == '--tsconfig' and i + 1 < len(args):
            tsconfig = args[i + 1]; i += 2
        else:
            i += 1

    result = extract_ts_imports(project_root, tsconfig)

    output = json.dumps(result, indent=2)
    if output_file:
        Path(output_file).write_text(output)
    else:
        print(output)

    print(f"TS Imports: {result['unique_edges']} edges, {result['files_processed']} files, {result['extraction_ms']:.0f}ms", file=sys.stderr)


if __name__ == '__main__':
    main()
