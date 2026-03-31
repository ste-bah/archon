---
name: remember-visual
description: Store visual context (screenshots, diagrams, photos) as structured descriptions in MemoryGraph. Uses a fixed JSON schema for consistency. Warns on potential credential exposure.
---

# Remember Visual

Store visual context (screenshots, diagrams, photos) as structured memory descriptions in MemoryGraph for later recall.

## What to do

### 1. Read the image

User provides an image path. Read it via the Read tool (multimodal support).

If the file does not exist or cannot be read, inform the user and stop.

### 2. Security check

Scan all visible text in the image for credential patterns:
- Strings matching `key=`, `token=`, `password`, `secret`, `api_key`, `API_KEY`
- Long base64-like strings (40+ characters of contiguous alphanumeric/+/= characters)

If any pattern is detected, warn the user:

> "This image may contain sensitive text (credentials detected). Store description only without text_content? [y/n]"

Wait for explicit confirmation before proceeding. If user says yes, set `text_content` to an empty array `[]` in the stored description.

### 3. Generate structured description

Use this FIXED schema (never deviate from these 4 fields):

```json
{
  "screen_type": "form|dashboard|list|detail|error|diagram|photo|chart|terminal|other",
  "key_elements": ["element 1 description", "element 2 description"],
  "state": "empty|loading|populated|error|other",
  "text_content": ["notable text visible in the image"]
}
```

Guidelines for filling each field:
- **screen_type**: Pick the single best match from the enum values.
- **key_elements**: Be specific. Describe UI components, data structures, visual elements, layout regions. Aim for 3-8 elements.
- **state**: Reflects whether the screen/image shows data or is empty/loading/errored.
- **text_content**: Capture notable labels, headings, values, error messages. Omit boilerplate (e.g. "OK", "Cancel") unless meaningful.

### 4. Store to MemoryGraph

```
mcp__memorygraph__store_memory(
  type="general",
  title="Visual: <descriptive-name>",
  content=<JSON description above as string>,
  tags=["visual", "<screen_type>", <additional descriptive tags>],
  importance=0.5
)
```

Rules for storage:
- The `<descriptive-name>` should summarize what the image shows (e.g. "market-terminal-watchlist-panel", "deployment-error-stack-trace").
- Do NOT tag as `pinned` -- visual memories can be archived.
- Additional tags should capture the domain context (e.g. "market-terminal", "deployment", "architecture").

### 5. Optional: Store to LanceDB for semantic search

If LanceDB MCP tools are available, also store an embedding for semantic retrieval.

Concatenate for the embedding text:
```
screen_type + " " + " ".join(key_elements) + " " + " ".join(text_content)
```

Use `mcp__lancedb-memory__dual_store` or `mcp__lancedb-memory__embed_and_store` with this concatenated text.

### 6. Report

Show the user:
- What was stored (the JSON description)
- The descriptive name used in the title
- The tags applied
- The original file path reference

End with: "Re-read original at [path] for full visual detail."

## Rules

- User-invoked only -- no automatic triggers
- FIXED JSON schema -- never deviate from the 4 fields (screen_type, key_elements, state, text_content)
- Warn on credentials in text_content before storing
- Do NOT store base64 image data by default -- only if user explicitly confirms AND the image is < 50KB
- Unpinned by default (visual memories can be archived)
- If the image cannot be read or is corrupted, inform the user and do not store anything
