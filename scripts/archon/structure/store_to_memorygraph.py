#!/usr/bin/env python3
"""
TASK-STRUCT-002: Store structure to MemoryGraph with 50KB split strategy.

Reads the full extraction JSON and stores per-directory nodes in MemoryGraph
via the Python API (same approach as memorygraph-recall.sh).

Usage:
    python3 store_to_memorygraph.py /path/to/full-structure.json
"""

import json
import sys
import time
from pathlib import Path

VENV_PATH = Path.home() / '.memorygraph-venv' / 'lib' / 'python3.12' / 'site-packages'
DB_PATH = str(Path.home() / '.memorygraph' / 'memory.db')
MAX_CONTENT_SIZE = 45000  # Stay under 50KB with metadata overhead


def main():
    if len(sys.argv) < 2:
        print("Usage: store_to_memorygraph.py <full-structure.json>", file=sys.stderr)
        sys.exit(1)

    structure_file = sys.argv[1]
    data = json.loads(Path(structure_file).read_text())

    # Add memorygraph to path
    sys.path.insert(0, str(VENV_PATH))
    try:
        from memorygraph import MemoryGraph
    except ImportError:
        print("ERROR: memorygraph package not found. Install in ~/.memorygraph-venv", file=sys.stderr)
        sys.exit(1)

    mg = MemoryGraph(backend='falkordb_lite', db_path=DB_PATH)

    project_name = data['project_name']
    root_tag = f"structure:{project_name}"

    # Delete existing structure nodes for this project
    existing = mg.search_memories(root_tag, limit=100)
    deleted = 0
    for mem in existing:
        mid = mem.get('id') if isinstance(mem, dict) else getattr(mem, 'id', None)
        if mid:
            try:
                mg.delete_memory(mid)
                deleted += 1
            except Exception:
                pass
    if deleted:
        print(f"Cleaned {deleted} existing structure nodes for {project_name}", file=sys.stderr)

    # Store root summary node
    root_content = json.dumps({
        'project_name': project_name,
        'root_path': data['root_path'],
        'languages': data['languages'],
        'file_count': data['file_count'],
        'total_lines': data['total_lines'],
        'total_symbols': data['total_symbols'],
        'extraction_ms': data['extraction_ms'],
        'directory_count': len(data.get('directories', {})),
    })

    root_id = mg.store_memory(
        memory_type='project',
        title=f"Project Structure: {project_name}",
        content=root_content,
        tags=[root_tag, 'structure', 'project-root'],
        importance=0.7,
    )
    print(f"Stored root node: {root_id}", file=sys.stderr)

    # Store per-directory nodes (split strategy for 50KB limit)
    stored = 0
    for dir_path, dir_info in data.get('directories', {}).items():
        dir_content = json.dumps(dir_info)

        # If directory content exceeds limit, truncate file details
        if len(dir_content) > MAX_CONTENT_SIZE:
            # Reduce to file summaries only (no method details)
            slim_files = []
            for f in dir_info.get('files', []):
                slim_files.append({
                    'path': f['path'],
                    'role': f.get('role', 'module'),
                    'lines': f.get('lines', 0),
                    'class_count': f.get('class_count', 0),
                    'function_count': f.get('function_count', 0),
                    'total_symbols': f.get('total_symbols', 0),
                })
            dir_content = json.dumps({
                'file_count': dir_info['file_count'],
                'total_lines': dir_info['total_lines'],
                'total_symbols': dir_info['total_symbols'],
                'files': slim_files,
                'truncated': True,
            })

        # If STILL over limit (huge directory), just store counts
        if len(dir_content) > MAX_CONTENT_SIZE:
            dir_content = json.dumps({
                'file_count': dir_info['file_count'],
                'total_lines': dir_info['total_lines'],
                'total_symbols': dir_info['total_symbols'],
                'truncated': True,
                'reason': 'exceeds_50kb_even_after_slim',
            })

        dir_id = mg.store_memory(
            memory_type='project',
            title=f"Structure: {project_name}/{dir_path}",
            content=dir_content,
            tags=[root_tag, 'structure', f'structure:{project_name}/{dir_path}'],
            importance=0.5,
        )

        # Link to root
        try:
            mg.create_relationship(
                source_id=root_id if isinstance(root_id, str) else str(root_id),
                target_id=dir_id if isinstance(dir_id, str) else str(dir_id),
                relationship_type='CONTAINS',
                context={'directory': dir_path},
            )
        except Exception:
            pass  # Relationship creation may fail on some MemoryGraph versions

        stored += 1

    print(f"Stored {stored} directory nodes + 1 root node for {project_name}", file=sys.stderr)


if __name__ == '__main__':
    main()
