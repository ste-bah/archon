#!/usr/bin/env python3
"""
TASK-ADV-003: "What breaks if I change X?" query

Given a file path and an imports JSON, finds all files that depend on the target.
Supports both Python and TypeScript import graphs.

Usage:
    python3 what_breaks.py <imports.json> <file-path>
"""

import json
import sys
from pathlib import Path
from typing import Any


def find_dependents(imports_data: dict[str, Any], target_file: str) -> list[dict[str, Any]]:
    """Find all files that import from the target file (direct dependents)."""
    dependents = []
    for edge in imports_data.get('edges', []):
        if edge['to'] == target_file:
            dependents.append({
                'file': edge['from'],
                'symbols': edge.get('symbols', []),
            })
    return dependents


def find_transitive_dependents(imports_data: dict[str, Any], target_file: str, max_depth: int = 3) -> dict[str, list]:
    """Find transitive dependents up to max_depth levels."""
    # Build reverse adjacency list
    reverse_graph: dict[str, list[str]] = {}
    for edge in imports_data.get('edges', []):
        reverse_graph.setdefault(edge['to'], []).append(edge['from'])

    visited = set()
    levels: dict[str, list[str]] = {}

    current = {target_file}
    for depth in range(1, max_depth + 1):
        next_level = set()
        for node in current:
            for dep in reverse_graph.get(node, []):
                if dep not in visited and dep != target_file:
                    next_level.add(dep)
                    visited.add(dep)
        if next_level:
            levels[f"depth_{depth}"] = sorted(next_level)
        current = next_level

    return levels


def main():
    if len(sys.argv) < 3:
        print("Usage: what_breaks.py <imports.json> <file-path>", file=sys.stderr)
        print("Example: what_breaks.py /tmp/mt-imports.json app/data/cache.py", file=sys.stderr)
        sys.exit(1)

    imports_file = sys.argv[1]
    target_file = sys.argv[2]

    data = json.loads(Path(imports_file).read_text())

    # Normalize target path
    if target_file.startswith('./'):
        target_file = target_file[2:]

    print(f"Impact analysis: {target_file}")
    print(f"{'=' * 60}")

    # Direct dependents
    direct = find_dependents(data, target_file)
    print(f"\nDirect dependents ({len(direct)} files):")
    for dep in sorted(direct, key=lambda d: d['file']):
        symbols = ', '.join(dep.get('symbols', [])[:5])
        suffix = f" (imports: {symbols})" if symbols else ""
        print(f"  {dep['file']}{suffix}")

    # Transitive dependents
    transitive = find_transitive_dependents(data, target_file)
    total_transitive = sum(len(v) for v in transitive.values())

    if total_transitive > 0:
        print(f"\nTransitive dependents ({total_transitive} files):")
        for depth, files in transitive.items():
            level = depth.split('_')[1]
            print(f"  Level {level} ({len(files)}):")
            for f in files[:10]:
                print(f"    {f}")
            if len(files) > 10:
                print(f"    ... and {len(files) - 10} more")

    total = len(direct) + total_transitive
    print(f"\n{'=' * 60}")
    print(f"Total impact: {total} files affected by changes to {target_file}")

    if total == 0:
        print("(No internal dependents found — this file is a leaf node or not imported)")


if __name__ == '__main__':
    main()
