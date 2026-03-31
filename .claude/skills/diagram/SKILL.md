---
name: diagram
description: Generate and render Mermaid diagrams to PNG/SVG. Accepts a description, generates Mermaid syntax, renders via mmdc, returns the file path.
---

# Diagram Generator

Generate Mermaid diagrams from descriptions and render them to PNG.

## What to do

### 1. Determine diagram type

Based on the user's description, pick the best type:

| Type | Use when | Syntax prefix |
|------|----------|---------------|
| flowchart | Processes, workflows, decision trees | `graph TD` or `graph LR` |
| sequence | API calls, message flows, interactions | `sequenceDiagram` |
| class | Data models, class hierarchies, interfaces | `classDiagram` |
| er | Database schemas, entity relationships | `erDiagram` |
| state | State machines, lifecycle stages | `stateDiagram-v2` |
| gantt | Timelines, project plans, phases | `gantt` |

If unclear, default to flowchart.

### 2. Generate Mermaid syntax

Write valid Mermaid syntax based on the description. Tips for tricky cases:
- Flowchart: use `-->` for arrows, `{decision}` for diamonds, `[process]` for rectangles
- Sequence: use `->>` for sync, `-->>` for async, `Note over A,B: text` for notes
- Class: use `+` for public, `-` for private, `<|--` for inheritance
- ER: use `||--o{` for one-to-many, `||--||` for one-to-one
- State: use `[*]` for start/end, `-->` for transitions
- Gantt: use `dateFormat YYYY-MM-DD`, `section` for groups

### 3. Write .mmd file

```bash
mkdir -p docs/diagrams
```

Write the Mermaid syntax to `docs/diagrams/<descriptive-name>.mmd`.

Use a descriptive filename based on what the diagram shows (e.g., `archon-autonomous-flow.mmd`, `market-terminal-architecture.mmd`).

### 4. Render to PNG

```bash
mmdc -i docs/diagrams/<name>.mmd -o docs/diagrams/<name>.png
```

Check the exit code. If it fails:
- Read the stderr error message
- Fix the Mermaid syntax (usually a missing semicolon or unsupported character)
- Retry once
- If second attempt fails, show the error and the .mmd source to the user

### 4.5 Auto-store visual memory

After successful rendering, automatically store the diagram as a visual memory:

1. Generate structured description using the same schema as /remember-visual:
   ```json
   {
     "screen_type": "diagram",
     "key_elements": ["<describe the diagram's main nodes/flows>"],
     "state": "populated",
     "text_content": ["<key text labels from the diagram>"]
   }
   ```

2. Read the .mmd source file content

3. Store to MemoryGraph:
   ```
   mcp__memorygraph__store_memory(
     type="general",
     title="Visual: <diagram-descriptive-name>",
     content="<.mmd source text>\n\n---\nDescription:\n<JSON description>",
     tags=["visual", "diagram", <descriptive tags>],
     importance=0.5
   )
   ```

The .mmd source is the LOSSLESS representation -- it can regenerate the diagram exactly. Do NOT tag as `pinned`.

### 5. Return result

Show the user:
- The file path to the rendered PNG
- A brief description of what the diagram shows
- Offer to modify if needed

For SVG output instead: `mmdc -i <file>.mmd -o <file>.svg`

## Troubleshooting

If mmdc fails with a Chromium/sandbox error:
```bash
echo '{"args":["--no-sandbox"]}' > /tmp/puppeteer-config.json
mmdc -i <file>.mmd -o <file>.png --puppeteerConfigFile /tmp/puppeteer-config.json
```

If mmdc is not installed:
```bash
npm install -g @mermaid-js/mermaid-cli
```

## Rules

- Always create the `docs/diagrams/` directory if it doesn't exist
- Keep .mmd source files alongside the PNGs (they're the reproducible artifact)
- Use descriptive filenames, not generic ones like "diagram1.mmd"
- Do NOT generate diagrams unless the user asks for one
