---
name: understand
description: Generate a deep understanding of a source code file — business logic, algorithms, edge cases, and design decisions. Stores to MemoryGraph with commit SHA for staleness detection. User-invoked only.
---

# Understand — Deep Code File Analysis

Generate a 4-layer understanding of a source code file and store it to MemoryGraph for future recall.

## Input

The user provides a file path after `/understand`, e.g.:
```
/understand src/api/routes/watchlist.py
/understand market-terminal/frontend/src/hooks/useAnalysis.ts
```

If no file path is provided, ask: "Which file should I analyze?"

## Steps

### 1. Read the target file

Read the file via the Read tool. If the file does not exist, report: "File not found: `<path>`"

If the file exceeds 500 lines, note: "File exceeds 500-line limit — consider refactoring." Still proceed with the analysis.

### 2. Get commit SHA

Run: `git rev-parse HEAD` to get the current commit SHA (for staleness detection by `/recall`).

### 3. Check for existing understanding

Search MemoryGraph: `mcp__memorygraph__search_memories(query="Code: <relative-file-path>", limit=5)`

If a result with a matching title `"Code: <relative-file-path>"` is found, this is an UPDATE. Note the existing memory ID for use with `mcp__memorygraph__update_memory`. Merge new insights with existing decision context rather than overwriting.

### 4. Generate 4-layer summary

Analyze the file and produce these four layers:

**Layer 1 — Architecture**
Where does this file fit in the project? What does it import? What depends on it? What is its role (route, model, service, test, utility, hook, component, config)?

To enrich this layer, search LEANN for related code:
`mcp__leann-search__search_code(query="<key function/class names from this file>", limit=5, minScore=0.80, includeCode=true)`
Note any files that import from or are similar to this file — these are its neighbors in the codebase graph.

**Layer 2 — Business Logic**
What does the code DO? Key algorithms, data transformations, state management. Describe the main operations in plain language. Include function signatures and their purposes.

**Layer 3 — Edge Cases**
What guards, fallbacks, and error handling exist? What boundary conditions are handled? What input validation is present? Any known limitations or TODO comments?

**Layer 4 — Decision Context**
WHY was it written this way? Look at comments, naming choices, architectural patterns. If the user has explained the reasoning in conversation, capture that. This is the highest-value layer — encourage the user to share WHY decisions were made if this layer is thin.

### 5. Handle test files

If the file is a test file (detected by path containing `test`, `spec`, `__tests__`), do NOT produce a full 4-layer analysis. Instead, produce a brief summary:
```
Test file for <module-under-test> with N test cases.
Key scenarios tested: <bullet list of describe/it blocks or test functions>
Mocking strategy: <what is mocked and how>
```

### 6. Store to MemoryGraph

Determine the file's role from Layer 1 (e.g., "route", "service", "hook", "component", "utility", "model", "test", "config").

Determine importance: 0.6 by default, bumped to 0.7 if Layer 4 has substantive content (comments, design rationale, user-provided reasoning).

Format the content as:
```
## Architecture
<Layer 1 content>

## Business Logic
<Layer 2 content>

## Edge Cases
<Layer 3 content>

## Decision Context
<Layer 4 content>

---
file_path: <relative-path>
commit_sha: <HEAD SHA>
timestamp: <ISO 8601>
```

**If NEW** (no existing memory found):
```
mcp__memorygraph__store_memory(
  type="code_pattern",
  title="Code: <relative-file-path>",
  content="<formatted 4-layer summary>",
  tags=["code-understanding", "<project-name>", "<file-role>"],
  importance=<0.6 or 0.7>
)
```

**If UPDATE** (existing memory found):
```
mcp__memorygraph__update_memory(
  memory_id=<existing-id>,
  content="<formatted 4-layer summary with merged insights>",
  tags=["code-understanding", "<project-name>", "<file-role>"],
  importance=<0.6 or 0.7>
)
```

### 7. Report

Show the user:
```
## Understanding: <relative-file-path>

- **Status**: New understanding / Updated existing understanding
- **Commit SHA**: <short SHA>
- **Layers**: Architecture, Business Logic, Edge Cases, Decision Context
- **Importance**: 0.6 / 0.7
- **File role**: <role>

<4-layer summary content>

> Layer 4 (Decision Context) is the highest-value layer. If you know WHY
> specific design decisions were made, share them and I will update the
> understanding.
```

## Rules

- User-invoked only — NO automatic triggers, NO PostToolUse hooks
- Never store credentials, secrets, API keys, or tokens found in code or comments
- Do NOT produce detailed summaries of test files — use the brief format from Step 5
- The commit SHA in the stored memory enables `/recall` to detect staleness
- If updating, preserve any user-provided Decision Context from the previous version unless explicitly superseded
- Always use relative file paths (from project root) in the memory title and tags
