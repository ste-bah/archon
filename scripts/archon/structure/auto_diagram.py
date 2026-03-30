#!/usr/bin/env python3
"""
TASK-ADV-005: Auto-generate architecture diagram from structural data.

Reads import edges and generates a Mermaid flowchart showing module dependencies.
Renders via mmdc if available.

Usage:
    python3 auto_diagram.py <imports.json> [--output diagram.mmd] [--render diagram.png]
"""

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def generate_mermaid(imports_data: dict[str, Any], max_nodes: int = 40) -> str:
    """Generate a Mermaid flowchart from import edges."""
    edges = imports_data.get('edges', [])
    if not edges:
        return 'graph TD\n    A[No internal dependencies found]'

    # Count how many times each file appears as source or target
    node_importance = Counter()
    for edge in edges:
        node_importance[edge['from']] += 1
        node_importance[edge['to']] += 1

    # Keep only the most connected nodes
    top_nodes = {n for n, _ in node_importance.most_common(max_nodes)}

    # Filter edges to only include top nodes
    filtered_edges = [e for e in edges if e['from'] in top_nodes and e['to'] in top_nodes]

    # Group nodes by directory for subgraphs
    dir_groups: dict[str, list[str]] = {}
    for node in top_nodes:
        parts = node.split('/')
        if len(parts) > 1:
            dir_key = '/'.join(parts[:2])  # First two path segments
        else:
            dir_key = 'root'
        dir_groups.setdefault(dir_key, []).append(node)

    # Generate Mermaid
    lines = ['graph TD']

    # Create node IDs (sanitize for Mermaid)
    node_ids = {}
    for i, node in enumerate(sorted(top_nodes)):
        safe_id = f"N{i}"
        short_name = node.split('/')[-1].replace('.py', '').replace('.ts', '').replace('.tsx', '')
        node_ids[node] = safe_id
        lines.append(f'    {safe_id}["{short_name}"]')

    lines.append('')

    # Add subgraphs for directories
    for dir_name, nodes in sorted(dir_groups.items()):
        if len(nodes) > 1:
            safe_dir = dir_name.replace('/', '_').replace('.', '_').replace('-', '_')
            lines.append(f'    subgraph {safe_dir}["{dir_name}"]')
            for node in sorted(nodes):
                if node in node_ids:
                    lines.append(f'        {node_ids[node]}')
            lines.append('    end')

    lines.append('')

    # Add edges
    seen_edges = set()
    for edge in filtered_edges:
        src = node_ids.get(edge['from'])
        tgt = node_ids.get(edge['to'])
        if src and tgt and (src, tgt) not in seen_edges:
            lines.append(f'    {src} --> {tgt}')
            seen_edges.add((src, tgt))

    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: auto_diagram.py <imports.json> [--output diagram.mmd] [--render diagram.png]", file=sys.stderr)
        sys.exit(1)

    imports_file = sys.argv[1]
    output_file = None
    render_file = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == '--output' and i + 1 < len(args):
            output_file = args[i + 1]; i += 2
        elif args[i] == '--render' and i + 1 < len(args):
            render_file = args[i + 1]; i += 2
        else:
            i += 1

    data = json.loads(Path(imports_file).read_text())
    mermaid = generate_mermaid(data)

    if output_file:
        Path(output_file).write_text(mermaid)
        print(f"Mermaid: {output_file} ({len(mermaid)} chars)", file=sys.stderr)
    else:
        print(mermaid)

    if render_file:
        import subprocess
        mmd_file = render_file.replace('.png', '.mmd').replace('.svg', '.mmd')
        if not output_file:
            Path(mmd_file).write_text(mermaid)

        src = output_file or mmd_file
        result = subprocess.run(
            ['mmdc', '-i', src, '-o', render_file],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            size = Path(render_file).stat().st_size
            print(f"Rendered: {render_file} ({size} bytes)", file=sys.stderr)
        else:
            print(f"Render failed: {result.stderr}", file=sys.stderr)


if __name__ == '__main__':
    main()
