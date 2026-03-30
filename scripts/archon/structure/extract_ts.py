#!/usr/bin/env python3
"""
TASK-ENH-007: TypeScript/JavaScript Structure Extractor

Uses regex-based extraction (no native TS parser dependency).
Extracts classes, functions, interfaces, types, imports, and exports.

PRD: PRD-ARCHON-CAP-001 | REQ-STRUCT-003
"""

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

EXCLUDED_DIRS = {
    'node_modules', '__pycache__', '.venv', '.tv', '.git', '.claude',
    'dist', 'build', 'coverage', '.next', '.nuxt', '.swarm',
}

TS_EXTENSIONS = {'.ts', '.tsx', '.js', '.jsx'}

# Regex patterns for TypeScript/JavaScript structure extraction
RE_CLASS = re.compile(r'^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+[\w,\s]+)?\s*\{', re.MULTILINE)
RE_FUNCTION = re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?\s*\{', re.MULTILINE)
RE_ARROW_EXPORT = re.compile(r'^\s*export\s+(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(?', re.MULTILINE)
RE_INTERFACE = re.compile(r'^\s*(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s<>]+)?\s*\{', re.MULTILINE)
RE_TYPE_ALIAS = re.compile(r'^\s*(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=', re.MULTILINE)
RE_ENUM = re.compile(r'^\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{', re.MULTILINE)
RE_IMPORT = re.compile(r"^\s*import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s+as\s+\w+)?)\s+from\s+)?['\"]([^'\"]+)['\"]", re.MULTILINE)
RE_METHOD = re.compile(r'^\s+(?:(?:public|private|protected|static|async|readonly)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{;]+))?\s*[\{;]', re.MULTILINE)
RE_DECORATOR = re.compile(r'^\s*@(\w+(?:\.[.\w]+)?(?:\([^)]*\))?)', re.MULTILINE)


def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in EXCLUDED_DIRS or part.endswith('.egg-info'):
            return True
    return False


def classify_role_ts(filepath: Path, content: str) -> str:
    name = filepath.name.lower()
    parts = [p.lower() for p in filepath.parts]

    if '.test.' in name or '.spec.' in name or '__tests__' in parts:
        return 'test'
    if 'route' in name or 'api' in parts:
        return 'route'
    if 'hook' in name or 'hooks' in parts:
        return 'hook'
    if 'component' in parts or name.endswith('.tsx'):
        return 'component'
    if 'type' in name or 'types' in parts:
        return 'types'
    if 'util' in name or 'utils' in parts or 'helpers' in parts:
        return 'utility'
    if 'config' in name or name.endswith('.config.ts') or name.endswith('.config.js'):
        return 'config'
    if 'index' in name:
        return 'barrel'
    if 'store' in name or 'context' in name:
        return 'state'
    return 'module'


def extract_ts_file(filepath: Path, project_root: Path) -> dict[str, Any] | None:
    try:
        content = filepath.read_text(encoding='utf-8', errors='replace')
    except (OSError, PermissionError):
        return None

    line_count = content.count('\n') + 1
    rel_path = str(filepath.relative_to(project_root))

    classes = []
    for m in RE_CLASS.finditer(content):
        name = m.group(1)
        extends = m.group(2)
        # Find methods within ~200 lines after class declaration
        class_start = m.start()
        class_region = content[class_start:class_start + 10000]
        methods = []
        for mm in RE_METHOD.finditer(class_region):
            mname = mm.group(1)
            if mname not in ('constructor', 'if', 'for', 'while', 'switch', 'return', 'throw', 'new'):
                methods.append({
                    'name': mname,
                    'params': mm.group(2).strip()[:100] if mm.group(2) else '',
                    'returns': mm.group(3).strip()[:50] if mm.group(3) else None,
                })
        classes.append({
            'name': name,
            'extends': extends,
            'methods': methods[:20],
            'method_count': len(methods),
        })

    functions = []
    for m in RE_FUNCTION.finditer(content):
        functions.append({
            'name': m.group(1),
            'params': m.group(2).strip()[:100] if m.group(2) else '',
            'returns': m.group(3).strip()[:50] if m.group(3) else None,
        })

    # Exported arrow functions / consts
    arrow_exports = [m.group(1) for m in RE_ARROW_EXPORT.finditer(content)]

    interfaces = [m.group(1) for m in RE_INTERFACE.finditer(content)]
    type_aliases = [m.group(1) for m in RE_TYPE_ALIAS.finditer(content)]
    enums = [m.group(1) for m in RE_ENUM.finditer(content)]
    imports = [m.group(1) for m in RE_IMPORT.finditer(content)]
    decorators = [m.group(1) for m in RE_DECORATOR.finditer(content)]

    total_symbols = (
        len(classes) + len(functions) + len(arrow_exports) +
        len(interfaces) + len(type_aliases) + len(enums) +
        sum(c.get('method_count', 0) for c in classes)
    )

    return {
        'path': rel_path,
        'language': 'typescript' if filepath.suffix in {'.ts', '.tsx'} else 'javascript',
        'lines': line_count,
        'role': classify_role_ts(filepath, content),
        'classes': classes,
        'functions': functions,
        'arrow_exports': arrow_exports[:20],
        'interfaces': interfaces,
        'type_aliases': type_aliases,
        'enums': enums,
        'imports': imports,
        'decorators': decorators,
        'class_count': len(classes),
        'function_count': len(functions) + len(arrow_exports),
        'total_symbols': total_symbols,
    }


def extract_ts_project(project_root: str) -> dict[str, Any]:
    root = Path(project_root).resolve()
    start_time = time.monotonic()
    modules = []
    total_lines = 0

    for ext in TS_EXTENSIONS:
        for filepath in sorted(root.rglob(f'*{ext}')):
            if should_exclude(filepath) or filepath.is_symlink():
                continue
            info = extract_ts_file(filepath, root)
            if info:
                modules.append(info)
                total_lines += info.get('lines', 0)

    elapsed_ms = (time.monotonic() - start_time) * 1000

    # Group by directory
    directories: dict[str, list] = {}
    for mod in modules:
        dir_path = str(Path(mod['path']).parent)
        directories.setdefault(dir_path, []).append(mod)

    languages = sorted(set(m['language'] for m in modules))

    return {
        'project_name': root.name,
        'root_path': str(root),
        'languages': languages,
        'file_count': len(modules),
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
    import subprocess
    role_counts: dict[str, int] = {}
    for dir_info in project.get('directories', {}).values():
        for f in dir_info.get('files', []):
            role = f.get('role', 'module')
            role_counts[role] = role_counts.get(role, 0) + 1

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
            role: count for role, count in sorted(role_counts.items()) if role != 'barrel'
        },
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: extract_ts.py <project-root> [--output full.json] [--compact compact.json]", file=sys.stderr)
        sys.exit(1)

    project_root = sys.argv[1]
    output_file = None
    compact_file = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--output' and i + 1 < len(args):
            output_file = args[i + 1]; i += 2
        elif args[i] == '--compact' and i + 1 < len(args):
            compact_file = args[i + 1]; i += 2
        else:
            i += 1

    project = extract_ts_project(project_root)

    if output_file:
        Path(output_file).write_text(json.dumps(project, indent=2))
        print(f"Full: {output_file} ({project['file_count']} files)", file=sys.stderr)
    else:
        print(json.dumps(project, indent=2))

    if compact_file:
        compact = generate_compact_summary(project)
        Path(compact_file).write_text(json.dumps(compact, indent=2))
        print(f"Compact: {compact_file} ({len(json.dumps(compact))} bytes)", file=sys.stderr)

    print(f"Extracted {project['file_count']} TS/JS files, {project['total_symbols']} symbols in {project['extraction_ms']:.0f}ms", file=sys.stderr)


if __name__ == '__main__':
    main()
