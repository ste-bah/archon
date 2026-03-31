---
name: post-mortem
description: Analyse a failure, capture the debugging journey, and store the lesson as a persistent memory. Use after low L-Scores, multi-round debugging, or any significant mistake.
---

# Post-Mortem — Failure Analysis and Learning

Analyse what went wrong, capture the debugging journey, and store the lesson so it's never repeated.

## Input

Requires a description of what failed:
```
/post-mortem the FalkorDBLite create_relationship was broken due to Cypher preamble format
/post-mortem dashboard pipeline tab showing 0/50 agents despite active pipeline
```

If no argument is provided, ask: "What failure should I analyse?"

NOTE: This analysis uses what's visible in the current conversation context. If the session was compacted or the failure happened in a previous session, provide the description explicitly — do not rely on context inference.

## Analysis Structure

Work through these in order:

### 1. Symptom
What was the observable problem? What did the user see or report?

### 2. Attempts (the journey)
What was tried first? Why did it fail? What was tried next? Capture each attempt:
- Attempt 1: [what] → Failed because [why]
- Attempt 2: [what] → Failed because [why]
- ...

### 3. Root Cause
What was the actual underlying problem? Not the symptom — the cause.

### 4. Fix
What ultimately resolved it?

### 5. Key Insight
The non-obvious lesson. The thing that would have saved time if known upfront. This is the most valuable part.

## Store the Lesson

Call `mcp__memorygraph__store_memory` with:
- **type**: `fix`
- **title**: `Post-mortem: [brief description]`
- **content**: Structured as Symptom → Root cause → Fix → Key insight. Include attempt count. (<1000 chars)
- **tags**: `["post-mortem", "debug-journey", "[relevant tech tags]"]`
- **importance**: 0.85

Then search MemoryGraph for related memories and create RELATED_TO relationships where relevant.

## Report

```
Post-mortem stored: [memory_id]
  Symptom: [one line]
  Root cause: [one line]
  Key insight: [one line]
  Linked to: [N] related memories
```

## Rules

- Be honest about what went wrong — no defensive framing
- Capture the JOURNEY (attempts that failed), not just the final fix
- The key insight must be actionable — "check X before assuming Y"
- Do NOT store memories about the memory system itself
- Do NOT modify CLAUDE.md
- Content limit: 1000 chars (post-mortems need more space than summaries)
