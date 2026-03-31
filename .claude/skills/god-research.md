---
description: Deep research using the PhD Pipeline CLI with 45 specialized agents and DESC episodic memory
effort: high
---

Use the PhD Pipeline CLI (`phd-cli`) for deep research with dynamic agent orchestration, DESC episode injection, and style profile integration.

**Query**: $ARGUMENTS

---

## EXECUTION PROTOCOL

**YOU MUST use phd-cli for orchestration. DO NOT use static Task() templates.**

### 🚨 CRITICAL: DO NOT STOP DURING PIPELINE EXECUTION

**The user has ALREADY decided to run this pipeline by invoking /god-research. Their confirmation is the invocation itself.**

- **DO NOT** pause between agents to ask "should I continue?"
- **DO NOT** stop to present status summaries with options
- **DO NOT** say "this will take a long time, would you like to proceed?"
- **DO NOT** offer to skip, pause, or modify the pipeline mid-execution
- **DO NOT** comment on token usage, context limits, or duration estimates
- **JUST EXECUTE** the init → spawn → complete → spawn → complete loop until the pipeline returns `status: "complete"`
- The ONLY reason to stop is an actual error (CLI crash, agent failure)

### Step 1: Initialize Pipeline

```bash
npx tsx src/god-agent/cli/phd-cli.ts init "$ARGUMENTS" --json
```

This returns:
```json
{
  "sessionId": "uuid",
  "pipelineId": "...",
  "totalAgents": 45,
  "agent": { "key": "step-back-analyzer", "prompt": "...", ... }
}
```

**Save the `sessionId` - you need it for all subsequent commands.**

### Step 2: Execute First Agent

From the init response, spawn the first agent:

```
Task("<agent.key>", "<agent.prompt>", "<agent.key>")
```

Then mark complete:
```bash
npx tsx src/god-agent/cli/phd-cli.ts complete <sessionId> <agent.key> --json
```

### Step 3: Loop Until Complete

Repeat until `status: "complete"`:

#### 3a. Get Next Agent
```bash
npx tsx src/god-agent/cli/phd-cli.ts next <sessionId> --json
```

Returns:
```json
{
  "sessionId": "...",
  "status": "next",
  "progress": { "completed": N, "total": 45, "percentage": X },
  "agent": {
    "key": "...",
    "prompt": "... (includes DESC injection + workflow context) ...",
    ...
  },
  "desc": { "episodesInjected": N, "episodeIds": [...] }
}
```

#### 3b. Spawn Agent
```
Task("<agent.key>", "<agent.prompt>", "<agent.key>")
```

#### 3c. Mark Complete
```bash
npx tsx src/god-agent/cli/phd-cli.ts complete <sessionId> <agent.key> --json
```

When pipeline is complete, `next` returns:
```json
{
  "status": "complete",
  "slug": "<topic-slug>",
  "summary": { "duration": ..., "agentsCompleted": 45, "errors": 0 }
}
```

### Step 4: Final Assembly (Phase 8)

When `status: "complete"` is returned, **automatically invoke Phase 8**:

```bash
# Phase 8 - Final Assembly
npx tsx src/god-agent/cli/phd-cli.ts final --slug <slug-from-response> --verbose
```

Display progress message: **"Starting Phase 8: Final Assembly..."**

This produces the final paper at: `docs/research/<slug>/final/final-paper.md`

#### Phase 8 Error Handling

If Phase 8 fails, handle based on exit code:

| Exit Code | Error Type | Suggested Action |
|-----------|------------|------------------|
| 2 | MISSING_FILES | Show which source files are missing. Re-run failed Phase 6/7 agents. |
| 4 | MAPPING_FAILURE | Chapter mapping failed. Suggest re-running Phase 6 agents. |
| 5 | VALIDATION_FAILURE | Display validation errors. Fix content issues and retry. |
| Other | General Error | Display error message. Suggest manual finalize: `npx tsx src/god-agent/cli/phd-cli.ts final --slug <slug>` |

---

## WHAT PHD-CLI PROVIDES AUTOMATICALLY

1. **45 Agents**: Loaded from `.claude/agents/phdresearch/*.md`
2. **DESC Episode Injection**: Prior solutions from similar tasks injected into prompts
3. **Workflow Context**: `Agent #X/45 | Previous: Y | Next: Z`
4. **TASK COMPLETION SUMMARY**: Standardized output format
5. **Session Persistence**: Resume interrupted pipelines
6. **Style Profiles**: Academic writing style integration
7. **Dynamic Phase 6**: Chapter structure determines which writers spawn

---

## PIPELINE PHASES (45 Agents + Final Assembly)

| Phase | Name | Agents | Count |
|-------|------|--------|-------|
| 1 | Foundation | step-back-analyzer → dissertation-architect | 6 |
| 2 | Discovery | literature-mapper → context-tier-manager | 5 |
| 3 | Architecture | theoretical-framework-analyst → risk-analyst | 4 |
| 4 | Synthesis | evidence-synthesizer → opportunity-identifier | 5 |
| 5 | Design | method-designer → methodology-writer | 10 |
| 6 | Writing | introduction-writer → abstract-writer | 6 |
| 7 | Validation | adversarial-reviewer → file-length-manager | 9 |
| **8** | **Final Assembly** | **`phd-cli final`** | **1** |

**Phase 8** runs automatically after Phase 7 completes. It merges all chapter outputs into a single final paper.

---

## SESSION MANAGEMENT COMMANDS

```bash
# Check progress
npx tsx src/god-agent/cli/phd-cli.ts status <sessionId> --json

# List all sessions
npx tsx src/god-agent/cli/phd-cli.ts list --json

# Resume interrupted session
npx tsx src/god-agent/cli/phd-cli.ts resume <sessionId> --json

# Abort session
npx tsx src/god-agent/cli/phd-cli.ts abort <sessionId> --json
```

---

## OUTPUT LOCATION

All research outputs go to: `docs/research/<topic-slug>/`

Structure is determined by the locked chapter structure created by `dissertation-architect` in Phase 1.

---

## EXAMPLE FULL EXECUTION

```
# Initialize
> npx tsx src/god-agent/cli/phd-cli.ts init "improving local AI agents and preventing context degradation" --json
{
  "sessionId": "abc-123-def",
  "slug": "improving-local-ai-agents",
  "totalAgents": 45,
  "agent": { "key": "step-back-analyzer", "prompt": "..." }
}

# Spawn agent 1
> Task("step-back-analyzer", "<prompt>", "step-back-analyzer")

# Complete agent 1
> npx tsx src/god-agent/cli/phd-cli.ts complete abc-123-def step-back-analyzer --json
{ "success": true, "nextAgent": "self-ask-decomposer" }

# Get agent 2
> npx tsx src/god-agent/cli/phd-cli.ts next abc-123-def --json
{ "agent": { "key": "self-ask-decomposer", "prompt": "..." } }

# ... repeat for all 45 agents ...

# Phase 7 complete - triggers Phase 8 automatically
> npx tsx src/god-agent/cli/phd-cli.ts next abc-123-def --json
{ "status": "complete", "slug": "improving-local-ai-agents", "summary": { "agentsCompleted": 45 } }

# Phase 8: Final Assembly (auto-triggered)
> Starting Phase 8: Final Assembly...
> npx tsx src/god-agent/cli/phd-cli.ts final --slug improving-local-ai-agents --verbose
{
  "success": true,
  "output": "docs/research/improving-local-ai-agents/final/final-paper.md",
  "wordCount": 25000
}
```
