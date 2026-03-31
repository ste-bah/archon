---
name: decompose-prd
description: "Decompose a PRD into individual task specs with a _index.md batch execution runbook. Reads the decomposition framework from docs2/prdtospec.md and generates atomic task files organized by phase."
user-invocable: true
arguments: "<path to PRD file>"
---

# Decompose PRD into Task Specs

Break down a Product Requirements Document into individual, atomic task specification files with a batch execution index.

## Template

Read the full decomposition framework at:
```
/Volumes/Externalwork/projects/claudeflow-testing/docs2/prdtospec.md
```

This is the ONLY methodology to use. Do not improvise a decomposition approach.

## Steps

### 1. Read the framework

Read `docs2/prdtospec.md` completely. Key sections:
- Part 2: Breaking Down a PRD (decomposition process)
- Part 3: The Specification Document Structure (task spec format)
- Part 4: Context Files (the memory bank)
- Part 5: AI Agent Instructions (how agents consume specs)
- Appendix A: Quick Reference Templates

### 2. Read the PRD

Read the PRD file provided as argument. Extract:
- PRD ID and version
- All functional requirements (FR-xxx)
- All non-functional requirements (NFR-xxx)
- Edge cases (EC-xxx)
- Dependencies between features
- Phase/milestone structure (if defined)

### 3. Decompose into phases and tasks

Following the framework's decomposition process:

**Phase identification:**
- Group related requirements into logical phases
- Each phase should be independently shippable
- Dependencies flow forward (Phase N depends on Phase N-1)

**Task identification:**
- Each task is an atomic work unit for one `/god-code` pipeline run
- A task should be completable in one session (< 300 tests typically)
- A task maps to a cohesive set of requirements (e.g., one endpoint, one component, one module)

**Task ID convention:**
```
TASK-<ABBREV>-<SEQ>
```
Examples: TASK-API-001, TASK-UI-003, TASK-NET-007

### 4. Write individual task spec files

Create a directory structure:
```
docs/<project>-prompts/
  _index.md                         # Batch execution runbook
  phase-0-<name>/
    TASK-<ABBREV>-001.md
    TASK-<ABBREV>-002.md
  phase-1-<name>/
    TASK-<ABBREV>-003.md
    ...
```

Each task file follows this format (from the framework):
```markdown
# TASK-<ID>: <Title>

**PRD**: `<path to PRD>`
**Phase**: <N> — <Phase Name>
**Priority**: MUST | SHOULD | MAY
**Depends On**: <list of TASK-IDs or "none">

## Objective

<1-2 sentences: what this task delivers>

## Requirements Addressed

- FR-001: <requirement text>
- FR-002: <requirement text>
- NFR-001: <requirement text>

## Specification

<Detailed specification following the framework's Level 4 task spec format.
Include: data models, API contracts, business rules, error handling,
edge cases. Use Given/When/Then for acceptance criteria.>

## Acceptance Criteria

- [ ] <criterion 1 — measurable, binary pass/fail>
- [ ] <criterion 2>
- [ ] <criterion 3>

## Anti-Patterns

- Do NOT <common mistake 1>
- Do NOT <common mistake 2>

## Files Expected

- `src/<path>` — <what it contains>
- `tests/<path>` — <what it tests>
```

### 5. Write the _index.md

The index file is the batch execution runbook. Follow the exact format used in existing projects (e.g., `docs/tla-prompts/_index.md`):

```markdown
# Pipeline Prompts Index - <Project Name>

**PRD**: `<path to PRD>`
**PRD ID**: <PRD-ID>
**Total Tasks**: <N>
**Generated**: <YYYY-MM-DD>

## Execution Instructions

Run individual tasks:
\```bash
/god-code "$(cat docs/<project>-prompts/<phase>/<task-file>.md)"
\```

**WARNING**: Do NOT batch an entire phase in one session. The 48-agent pipeline
per task will exhaust context. Use the recommended batch groupings below
(max 3 tasks per batch).

## Recommended Batch Execution Runbook

Each batch below is sized to stay within safe context/memory limits.
Run each batch as a separate `/god-code` invocation.

### Phase 0: <Name> (<N> batches -> <N> sessions)

\```bash
# Batch 0A: <description> (run alone / tightly coupled / independent)
/god-code "$(cat docs/<project>-prompts/phase-0-<name>/TASK-XXX-001.md)"

# Batch 0B: <description>
/god-code -batch \
  "$(cat docs/<project>-prompts/phase-0-<name>/TASK-XXX-002.md)" \
  "$(cat docs/<project>-prompts/phase-0-<name>/TASK-XXX-003.md)"
\```

### Phase 1: <Name> ...
```

**Batching rules:**
- Max 3 tasks per batch
- Foundation/scaffold tasks run alone (they create the structure others depend on)
- Tightly coupled tasks (shared schema, shared API contract) batch together
- Independent tasks (no shared state) can batch up to 3
- Mark dependencies: batch B cannot start until batch A completes

### 6. Present for review

Show the user:
- Total tasks generated
- Phase breakdown (tasks per phase)
- Batch count and estimated sessions
- Dependency graph (which batches must run before others)
- Ask: "Would you like me to adjust any batching or task boundaries?"

## Rules

- ALWAYS read `docs2/prdtospec.md` before decomposing — never decompose from memory
- NEVER create tasks without stable identifiers (TASK-XXX-NNN)
- NEVER batch more than 3 tasks together
- NEVER put dependent tasks in the same batch as their dependencies
- Each task file must be self-contained — an agent reading ONLY that file should have everything needed
- Task specs go in `docs/<project>-prompts/`, never in project root
- If the PRD has insufficient detail for a task spec, mark sections as `[TBD — needs PRD clarification]`
