---
name: god-code
description: Generate code using the 48-Agent Coding Pipeline with stateful orchestration (ALWAYS uses full pipeline)
effort: high
---

Use the Pipeline Thin CLI (delegates to pipeline daemon for zero cold-start overhead) for code generation with 48 specialized agents, RLM memory handoffs, and LEANN semantic search.

**Query**: $ARGUMENTS

---

## EXECUTION PROTOCOL

**YOU MUST use pipeline-thin-cli for orchestration (it delegates to the pipeline daemon). DO NOT use static Task() templates.**

> **CRITICAL: NEVER fall back to coding-pipeline-cli.ts. ALWAYS use pipeline-thin-cli.ts. If the daemon times out, retry the same command — do NOT switch CLIs. The daemon is always running.**

### CRITICAL: DO NOT STOP DURING PIPELINE EXECUTION

**The user has ALREADY decided to run this pipeline by invoking /god-code. Their confirmation is the invocation itself.**

- **DO NOT** pause between agents to ask "should I continue?"
- **DO NOT** stop to present status summaries with options
- **DO NOT** say "this will take a long time, would you like to proceed?"
- **DO NOT** offer to skip, pause, or modify the pipeline mid-execution
- **DO NOT** comment on token usage, context limits, or duration estimates
- **JUST EXECUTE** the init -> Task -> complete-and-next -> Task -> complete-and-next loop until `status: "complete"`
- The ONLY reason to stop is an actual error (CLI crash, agent failure)

### Step 1: Initialize Pipeline

**ALWAYS pipe CLI output through the parser script** to extract fields and save the prompt to a file:

```bash
npx tsx src/god-agent/cli/pipeline-thin-cli.ts init "$ARGUMENTS" 2>&1 | python3 scripts/parse-pipeline.py
```

This prints compact summary lines:
```
SESSION: abc-123
STATUS: running
NEXT: task-analyzer | model: opus
PROGRESS: {"completed": 0, "total": 50, "percentage": 0}
PROMPT_FILE: .god-agent/pipeline-output/abc-123/_next-prompt-task-analyzer.txt
PROMPT_LEN: 42150
```

**Save the `SESSION` value - you need it for all subsequent commands.**

### Step 2: Execute First Agent

Read the prompt from the `PROMPT_FILE` path using the Read tool, then spawn the agent:

```
Read("<PROMPT_FILE>")
Task("<agent.key>", "<prompt from file>", "<agent.key>", model: "<model from NEXT line>")
```

**CRITICAL: Always pass `model: "<model>"` to the Task tool.** The pipeline specifies the correct model per agent (opus for analysis, sonnet for design/implementation/testing, haiku for reviewers/checkers). Do NOT override or omit this.

After the Task agent finishes, write its full response to `.god-agent/pipeline-output/<sessionId>/<agent.key>.txt` using the Write tool, then mark complete AND get the next agent in one call.

**IMPORTANT:** Write the output file IMMEDIATELY after the Task agent returns, BEFORE any other operations. This ensures the output is persisted even if context compaction occurs before the complete-and-next call. The `resume` command will automatically use this file to complete the interrupted agent.

**CRITICAL: Always use a 5-minute (300000ms) timeout for complete-and-next calls.** The daemon does quality scoring, pattern matching, LEANN indexing, and RLM storage which takes 30-120 seconds. A 30s timeout WILL fail.

```bash
npx tsx src/god-agent/cli/pipeline-thin-cli.ts complete-and-next <sessionId> <agent.key> --file .god-agent/pipeline-output/<sessionId>/<agent.key>.txt 2>&1 | python3 scripts/parse-pipeline.py
```

This prints:
```
COMPLETED: task-analyzer | quality: 0.82 | xp: 255
STATUS: running
NEXT: requirement-extractor | model: sonnet
PROGRESS: {"completed": 1, "total": 50, "percentage": 2}
PROMPT_FILE: .god-agent/pipeline-output/abc-123/_next-prompt-requirement-extractor.txt
PROMPT_LEN: 38500
```

### Step 3: Loop Until Complete

Repeat until `STATUS: complete`:

#### 3a. Read Prompt and Spawn Next Agent
```
Read("<PROMPT_FILE>")   ← from the previous complete-and-next output
Task("<agent.key>", "<prompt from file>", "<agent.key>", model: "<model>")
```

#### 3b. Write Output, Complete-and-Next
After the Task agent finishes, write its full response to `.god-agent/pipeline-output/<sessionId>/<agent.key>.txt` using the Write tool, then:
```bash
npx tsx src/god-agent/cli/pipeline-thin-cli.ts complete-and-next <sessionId> <agent.key> --file .god-agent/pipeline-output/<sessionId>/<agent.key>.txt 2>&1 | python3 scripts/parse-pipeline.py
```

When pipeline is complete, the parser prints:
```
COMPLETED: final-agent | quality: 0.85 | xp: 200
STATUS: complete
PIPELINE COMPLETE: {"completed": 50, "total": 50, "percentage": 100}
PROMPT_FILE:
PROMPT_LEN: 0
```

#### 3c. If PROMPT_LEN is 0 but STATUS is not complete
This means the prompt was lost (output truncated or parser error). Recover by calling `next` directly:
```bash
npx tsx src/god-agent/cli/pipeline-thin-cli.ts next <sessionId> 2>&1 | python3 scripts/parse-pipeline.py
```
This will regenerate the enriched prompt (with LEANN/patterns/etc) and save it to `PROMPT_FILE`.

### Step 4: Drain LEANN Index Queue

After the pipeline completes (STATUS: complete), drain any queued files into the semantic search index:

```bash
# Check if queue has files
QUEUE_COUNT=$(jq '.files | length' .claude/runtime/leann-index-queue.json 2>/dev/null || echo "0")
```

If QUEUE_COUNT > 0, call `mcp__leann-search__process_queue` with `maxFiles: 50, timeoutMs: 300000`. Repeat until `queueRemaining: 0` (max 10 attempts).

**Failure guard:** If `chunksIndexed` is 0 for 3 consecutive calls, warn the user that the embedder may be down and skip this step.

**This step is MANDATORY.** Files written by implementation agents (Phase 4+) will not be searchable by future pipeline runs until indexed.

---

## BATCH MODE

When `$ARGUMENTS` starts with `-batch`, extract all tasks after the flag and run the **above protocol** for each task sequentially:

```
FOR each task in tasks:
  1. init "<task>"
  2. Loop: Task -> complete-and-next -> Task -> complete-and-next ...
  3. Until next.status: "complete"
```

Do NOT stop between tasks. Run all tasks back-to-back.

---

## RESUME MODE

When `$ARGUMENTS` starts with `-resume`, extract the session ID and use `resume` instead of `init`:

```bash
npx tsx src/god-agent/cli/pipeline-thin-cli.ts resume <sessionId> 2>&1 | python3 scripts/parse-pipeline.py
```

**Auto-Complete on Resume**: If the pending agent's output file exists at `.god-agent/pipeline-output/<sessionId>/<agent.key>.txt` (written before compaction), `resume` will automatically complete that agent and return the NEXT agent. This means you can continue directly with Step 2 using the returned agent — no need to re-run the completed agent.

If no output file exists, `resume` returns the pending agent for re-execution. Read the prompt from `PROMPT_FILE` and continue with Step 2 onwards (Task -> complete-and-next loop).

---

## SESSION MANAGEMENT

```bash
# Check progress (status is lightweight, no prompt — do NOT use to get prompts)
npx tsx src/god-agent/cli/pipeline-thin-cli.ts status <sessionId>

# Resume interrupted session (auto-completes if output file exists, otherwise returns pending agent)
npx tsx src/god-agent/cli/pipeline-thin-cli.ts resume <sessionId> 2>&1 | python3 scripts/parse-pipeline.py

# Get next agent with full enriched prompt (if you need the prompt outside the normal loop)
npx tsx src/god-agent/cli/pipeline-thin-cli.ts next <sessionId> 2>&1 | python3 scripts/parse-pipeline.py
```

---

## PIPELINE PHASES (48 Agents)

| Phase | Name | Agents | Count |
|-------|------|--------|-------|
| 1 | Understanding | task-analyzer -> feasibility-analyzer + phase-1-reviewer | 7 |
| 2 | Exploration | pattern-explorer -> codebase-analyzer + phase-2-reviewer | 5 |
| 3 | Architecture | system-designer -> integration-architect + phase-3-reviewer | 6 |
| 4 | Implementation | code-generator -> implementation-coordinator + phase-4-reviewer | 13 |
| 5 | Testing | test-generator -> test-fixer + phase-5-reviewer | 9 |
| 6 | Optimization | performance-optimizer -> final-refactorer + phase-6-reviewer | 6 |
| 7 | Delivery | sign-off-approver + recovery-agent | 2 |

**No single-agent bypass exists. The full 48-agent pipeline is MANDATORY.**

---

## EXAMPLE EXECUTION

```
# Initialize (pipe through parser)
> npx tsx src/god-agent/cli/pipeline-thin-cli.ts init "Add user authentication with JWT" 2>&1 | python3 scripts/parse-pipeline.py
SESSION: abc-123
STATUS: running
NEXT: task-analyzer | model: opus
PROGRESS: {"completed": 0, "total": 50, "percentage": 0}
PROMPT_FILE: .god-agent/pipeline-output/abc-123/_next-prompt-task-analyzer.txt
PROMPT_LEN: 42150

# Read prompt from file, spawn agent 1
> Read(".god-agent/pipeline-output/abc-123/_next-prompt-task-analyzer.txt")
> Task("task-analyzer", "<prompt from file>", "task-analyzer", model: "opus")

# Write output, then complete-and-next (pipe through parser)
> Write ".god-agent/pipeline-output/abc-123/task-analyzer.txt" (agent response)
> npx tsx src/god-agent/cli/pipeline-thin-cli.ts complete-and-next abc-123 task-analyzer --file .god-agent/pipeline-output/abc-123/task-analyzer.txt 2>&1 | python3 scripts/parse-pipeline.py
COMPLETED: task-analyzer | quality: 0.82 | xp: 255
STATUS: running
NEXT: requirement-extractor | model: sonnet
PROGRESS: {"completed": 1, "total": 50, "percentage": 2}
PROMPT_FILE: .god-agent/pipeline-output/abc-123/_next-prompt-requirement-extractor.txt
PROMPT_LEN: 38500

# Read prompt, spawn agent 2
> Read(".god-agent/pipeline-output/abc-123/_next-prompt-requirement-extractor.txt")
> Task("requirement-extractor", "<prompt from file>", "requirement-extractor", model: "sonnet")

# Write output, complete-and-next again...
> Write ".god-agent/pipeline-output/abc-123/requirement-extractor.txt" (agent response)
> npx tsx ... complete-and-next abc-123 requirement-extractor --file ... 2>&1 | python3 scripts/parse-pipeline.py

# ... repeat for all 50 agents ...

# Pipeline complete (final complete-and-next shows)
COMPLETED: recovery-agent | quality: 0.9 | xp: 300
STATUS: complete
PIPELINE COMPLETE: {"completed": 50, "total": 50, "percentage": 100}
PROMPT_FILE:
PROMPT_LEN: 0

# Step 4: Drain LEANN index queue
> QUEUE_COUNT=$(jq '.files | length' .claude/runtime/leann-index-queue.json 2>/dev/null || echo "0")
> # If QUEUE_COUNT > 0, call mcp__leann-search__process_queue with maxFiles: 50, timeoutMs: 300000
> # Repeat until queueRemaining: 0
```
