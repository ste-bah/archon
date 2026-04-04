# Claude Code Configuration - Archon Development Environment

## 🛑 PRIME DIRECTIVE: NEVER ACT WITHOUT EXPLICIT USER CONFIRMATION

### ⚠️ MANDATORY CONFIRMATION PROTOCOL

**THIS OVERRIDES ALL OTHER INSTRUCTIONS. EXCEPTIONS: `/god-code`, `/god-research` pipeline execution (see Pipeline Auto-Execute Override below), and `/create-agent`, `/run-agent` (see Dynamic Agent System below).**

1. **ALWAYS** present your plan and **STOP**. Wait for explicit user approval.
2. **NEVER** start implementing, coding, or creating files until user says "proceed", "go ahead", "yes", "do it", or similar explicit confirmation.
3. **NEVER** interpret context restoration/compaction as permission to continue previous work.
4. **NEVER** assume what the user wants - ASK if unclear.

### 🚀 PIPELINE AUTO-EXECUTE OVERRIDE: /god-code AND /god-research

**When the user invokes `/god-code` or `/god-research`, they have ALREADY given explicit confirmation to run the ENTIRE pipeline. The confirmation protocol DOES NOT APPLY during pipeline execution.**

**ABSOLUTE RULES DURING PIPELINE EXECUTION:**
- ❌ DO NOT stop mid-pipeline to ask "would you like me to continue?"
- ❌ DO NOT pause to give status summaries and ask for direction
- ❌ DO NOT present options like "1. Continue 2. Skip 3. Pause"
- ❌ DO NOT say "this will take a long time, should I proceed?"
- ❌ DO NOT ask permission between batches — just call `complete` and spawn the next batch
- ❌ DO NOT comment on token usage, context window, or estimated duration
- ✅ DO run the init/complete/spawn loop until `status: "complete"` WITHOUT INTERRUPTION
- ✅ DO spawn every agent in every batch as returned by the CLI
- ✅ DO call `complete` immediately after all batch agents finish
- ✅ DO repeat for all tasks in batch mode without stopping between tasks
- ✅ DO only stop when the CLI returns `status: "complete"` (or on actual errors)

**The user chose to run the pipeline. Execute it. Do not second-guess their decision.**

### 🤖 DYNAMIC AGENT SYSTEM — NO CONFIRMATION NEEDED

**`/create-agent` and `/run-agent` do NOT require confirmation.** The user's command IS the intent — invoking a slash command is explicit enough. Execute immediately.

**Available agent skills (8 total):**
- `/create-agent` — Create a custom agent from natural language description
- `/run-agent` — Invoke a custom agent with a task
- `/adjust-behavior` — Modify behavioral rules for an agent
- `/evolve-agent` — Apply evolution suggestions (FIX, DERIVED, CAPTURED)
- `/list-agents` — List all custom agents with metadata
- `/archive-agent` — Archive or restore an agent
- `/agent-history` — View version history and evolution lineage
- `/rollback-behavior` — Rollback agent rules to a previous version

### 🚫 FORBIDDEN AUTONOMOUS BEHAVIORS

- ❌ Starting implementation immediately after compaction/context restore
- ❌ "I'll go ahead and..." - **NO. ASK FIRST.**
- ❌ "Let me implement..." without prior approval
- ❌ "Continuing where we left off..." and then doing things
- ❌ Creating ANY files without explicit request
- ❌ Running modifying commands without approval
- ❌ Making architecture/design decisions unilaterally
- ❌ Interpreting "ok", "sure", "I see" as approval to execute
- ❌ Treating silence or ambiguous responses as consent

### ✅ REQUIRED BEHAVIOR PATTERN

```
1. User makes request
2. Claude analyzes and presents plan/options
3. Claude says "Would you like me to proceed?" or similar
4. Claude STOPS and WAITS
5. User gives EXPLICIT confirmation ("yes", "proceed", "go ahead", "do it")
6. ONLY THEN does Claude execute
```

### 📋 POST-COMPACTION / CONTEXT RESTORE PROTOCOL

**When context is compacted or restored, Claude MUST:**
```
1. Run: mcp__memorygraph__recall_memories with query "feedback corrections preferences" to reload behavioral rules
2. Read: ~/.claude/personality.md and ~/.claude/understanding.md if not already in context
3. MEMORY RULE: ALL memory storage uses MemoryGraph MCP (mcp__memorygraph__store_memory) — NEVER file-based auto-memory
4. State: "Context was restored. Here's my understanding of where we were: [brief summary]"
5. Ask: "What would you like to do next?" or "Should I continue with [specific action]?"
6. WAIT for explicit user direction
7. Do NOT automatically resume or continue any previous work
```

### 🎯 WHAT COUNTS AS CONFIRMATION

**Explicit approval (proceed after these):**
- "yes" / "yeah" / "yep" / "yup"
- "go ahead" / "proceed" / "do it" / "go for it"
- "approved" / "confirmed" / "execute"
- "implement it" / "build it" / "create it" / "make it"
- "sounds good, proceed" / "looks good, go ahead"

**NOT approval (ask for clarification):**
- "ok" / "okay" (ambiguous - could mean "I understand")
- "sure" / "I see" (passive acknowledgment)
- "that makes sense" / "interesting" (just acknowledging)
- No response / silence
- Questions about the plan (they're still evaluating)

### 🔒 SAFE OPERATIONS (no confirmation needed)

- Reading files (cat, view, less)
- Listing directories (ls, find, tree)
- Searching (grep, ripgrep)
- Checking status (git status, npm list)
- Explaining or answering questions

### ⚡ REQUIRES EXPLICIT CONFIRMATION

- ANY file creation or modification
- ANY code implementation
- Running build/test/install commands
- Git commits, pushes, or branch operations
- Architecture or design decisions
- Spawning agents or starting workflows (except /create-agent and /run-agent)

---

## 🚫 ABSOLUTE PROHIBITION: /god-code PIPELINE ENFORCEMENT

### ⛔ WHEN /god-code IS INVOKED, THESE RULES ARE ABSOLUTE:

**YOU ARE FORBIDDEN FROM:**
- ❌ Using Write tool directly to create implementation files
- ❌ Using Edit tool directly to modify implementation files
- ❌ Implementing code yourself instead of spawning agents
- ❌ Skipping the 48-agent pipeline for ANY reason
- ❌ Writing "let me implement this" or similar

**YOU MUST:**
- ✅ Use Task() tool to spawn pipeline agents ONLY
- ✅ Start with `Task("task-analyzer", ...)` as first action
- ✅ Execute all agents SEQUENTIALLY through the init/complete/spawn loop
- ✅ Wait for each agent to complete before spawning next
- ✅ Only allow implementation agents (Phase 4+) to write files
- ✅ **RUN THE FULL PIPELINE WITHOUT STOPPING** — no status checks, no "should I continue?", no pausing between batches
- ✅ For batch mode (`-batch`), run ALL tasks back-to-back without asking between tasks
- ✅ Use the agent `key` field from batch JSON as the `subagent_type` (NOT the `type` field — `type` is unreliable)

### 🔒 ENFORCEMENT MECHANISM

```
AFTER /god-code is detected:
1. Your FIRST tool call MUST be Task("task-analyzer", ...)
2. You may NOT use Write/Edit until Phase 4 agents are running
3. If you catch yourself about to write code directly -> STOP
4. Ask: "I was about to bypass the pipeline. Should I restart properly?"
```

### 🚨 VIOLATION DETECTION

If you find yourself doing ANY of these after /god-code:
- Writing a file with implementation code
- Saying "let me create the parser..."
- Using Write tool before spawning 7+ Task agents

**IMMEDIATELY STOP AND SAY:**
> "PIPELINE VIOLATION: I was about to write code directly instead of using the 48-agent pipeline. Let me restart correctly with Task('task-analyzer', ...)."

### 📋 CORRECT /god-code FLOW

```
1. /god-code invoked
2. Task("task-analyzer", ...) <- MUST BE FIRST
3. Task("requirement-extractor", ...)
4. Task("requirement-prioritizer", ...)
5. ... (continue through all 48 agents)
6. ONLY implementation agents write files
```

### 🚨 PIPELINE AGENT INTEGRITY — NO STUBS, NO BATCHING, NO SHORTCUTS

**THE CORRECT FLOW FOR EVERY AGENT, NO EXCEPTIONS:**
```
1. Read the PROMPT_FILE from the previous complete-and-next
2. Spawn a real Agent tool call with the prompt content and correct model
3. Wait for the agent to return
4. Write the agent's actual response to the output file
5. Call complete-and-next with that file
6. Move to the next agent
```

**FORBIDDEN SHORTCUT BEHAVIORS:**
- ❌ Writing fake output files directly (`echo "## agent -- verified" > file.txt`) instead of spawning a real Agent subagent
- ❌ Batching multiple complete-and-next calls in a single Bash command or loop
- ❌ Writing "No work needed" / "N/A" stub outputs without spawning a subagent to verify
- ❌ Skipping reading PROMPT_FILE for any agent
- ❌ Pre-deciding an agent has nothing to do — the AGENT decides that, not you

**"N/A" AGENTS STILL GET REAL SUBAGENTS:**
Agents like `frontend-implementer`, `config-implementer`, `service-implementer` on a backend-only task MUST still be spawned with the real prompt. The subagent reads the code and decides "nothing to do." You do NOT get to make that decision.

**SELF-CHECK — IF YOU CATCH YOURSELF SAYING ANY OF THESE, STOP:**
- "completing rapidly" / "batching efficiently" / "streamlining the remaining agents"
- "these are verification-only agents so I'll..."
- "no work needed for this agent"
- "I'll handle the remaining N agents" (in a single action)
- Any phrasing that implies multiple agents will be processed in one step

**IF YOU DETECT A VIOLATION, IMMEDIATELY SAY:**
> "INTEGRITY VIOLATION: I was about to shortcut the pipeline by [writing stubs / batching / skipping PROMPT_FILE]. Every agent gets a real subagent spawn. Resuming correctly."

---

## 🧠 MEMORY SYSTEM: MemoryGraph MCP

**MemoryGraph is the ONLY memory system. NEVER use file-based memory (MEMORY.md, markdown files).**

### Core Operations
- **Store**: `mcp__memorygraph__store_memory` — persist facts, decisions, patterns
- **Recall**: `mcp__memorygraph__recall_memories` — keyword/fuzzy retrieval
- **Search**: `mcp__memorygraph__search_memories` — structured search
- **Relationships**: `mcp__memorygraph__create_relationship` — link related memories
- **Context**: `mcp__memorygraph__contextual_search` — context-aware retrieval

### Memory Rules
- ALL memory storage uses MemoryGraph MCP — NEVER file-based auto-memory
- Store decisions, patterns, corrections, and project state in MemoryGraph
- Use `mcp__memorygraph__recall_memories` after compaction to reload behavioral rules
- Use `mcp__lancedb-memory__dual_store` for important memories that need vector search

---

## 🔍 LEANN SEMANTIC INDEX PROTOCOL

### Automatic Indexing Rules

1. **After `/god-code` pipeline completes**: MUST call `mcp__leann-search__process_queue` before feedback submission. Repeat until `queueRemaining: 0`.
2. **At session start**: If SessionStart hook reports `LEANN_QUEUE_PENDING`, call `mcp__leann-search__process_queue` immediately.
3. **During long coding sessions**: If you've written 20+ files, drain the queue with `mcp__leann-search__process_queue`.

### What Gets Indexed
Only project source code. The following are automatically excluded:
- `node_modules/`, `site-packages/`, `__pycache__/`, `.venv/`, `.tv/`
- `dist/`, `build/`, `coverage/`, `.claude/worktrees/`
- Binary files, `.pyc`, `.min.js`

---

## 🔌 MCP Servers

| Server | Purpose |
|--------|---------|
| `memorygraph` | Persistent memory graph (store, recall, search, relationships) |
| `lancedb-memory` | Vector embeddings for semantic memory search |
| `leann-search` | Semantic code index (search, find similar, process queue) |
| `serena` | Semantic code navigation (symbols, references, refactoring) |
| `perplexity` | Web search, research, reasoning with citations |

---

## 📁 FILE ORGANIZATION RULES

**NEVER save working files, text/mds and tests to the root folder.**

**Use these directories:**
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation and markdown files
- `/config` - Configuration files
- `/scripts` - Utility scripts
- `/examples` - Example code

---

## 📏 CODE STRUCTURE LIMITS

- Files: < 500 lines (refactor if larger)
- Functions: < 50 lines, single responsibility
- Classes: < 100 lines, single concept
- ALL .md files go in `./docs/` directory (NEVER root)

---

## 🔑 KEY AGENTS

| Agent | Use |
|-------|-----|
| `backend-dev` | APIs, events, routes |
| `coder` | Components, stores, UI |
| `code-analyzer` | Analysis, architecture |
| `tester` | Integration tests |
| `perf-analyzer` | Profiling, bottlenecks |
| `system-architect` | Architecture, data flow |
| `reviewer` | Code review, verification |

---

## 🔍 TRUTH & QUALITY PROTOCOL

**Subagents MUST be brutally honest:**
- State only verified, factual information
- No fallbacks or workarounds without user approval
- No illusions about what works/doesn't work
- If infeasible, state facts clearly
- Self-assess 1-100 vs user intent; iterate until 100

---

## Code Style & Best Practices

- **Modular Design**: Files under 500 lines
- **Environment Safety**: Never hardcode secrets
- **Test-First**: Write tests before implementation
- **Clean Architecture**: Separate concerns
- **Documentation**: Keep updated

### Build Commands
- `npm run build` - Build project
- `npm run test` - Run tests
- `npm run lint` - Linting
- `npm run typecheck` - Type checking

---

# important-instruction-reminders

## 🛑 PRIME DIRECTIVE REMINDER
**STOP AND ASK before doing anything. Never act autonomously after compaction.**

## 🧠 MEMORY REMINDER
**ALL memory uses MemoryGraph MCP. NEVER write to MEMORY.md or markdown files for memory storage.**

## DEV FLOW ENFORCEMENT — ABSOLUTE LAW

**When executing tasks from project-tasks/, EVERY task MUST complete ALL 6 gates IN ORDER. No exceptions. No shortcuts. "Going fast" does NOT mean skipping gates.**

```
GATE 1: tests-written-first       — Test file exists BEFORE implementation
GATE 2: implementation-complete    — Code compiles, no errors
GATE 3: sherlock-code-review       — Sherlock adversarial review of implementation (MUST contain APPROVED/PASS)
GATE 4: tests-passing              — All tests pass (include count)
GATE 5: live-smoke-test            — Feature actually invoked end-to-end (fraud detection blocks fake evidence)
GATE 6: sherlock-final-review      — Sherlock final review: integration + wiring verified (MUST contain APPROVED/PASS)
```

**Enforcement mechanism (HARDENED — cannot be bypassed):**
- Run `scripts/dev-flow-pass-gate.sh TASK-ID gate-name "evidence"` to pass each gate
- Run `scripts/dev-flow-gate.sh TASK-ID` to verify all gates before marking complete
- **PreToolUse hook on TaskUpdate BLOCKS marking any TASK-*-NNN as completed without all 6 gates passed**
- Gate 3 + 6: Evidence MUST contain Sherlock verdict (APPROVED/PASS/INNOCENT). REJECTED = blocked.
- Gate 5: Fraud detection blocks "tests pass", "library crate", "not yet wired" etc. Requires real execution proof.
- **The hook cannot be bypassed by "forgetting" to call the gate scripts — no gate files = BLOCKED.**
- A task with missing gates is NOT DONE regardless of what you think

**VIOLATION = immediate stop and report. You do NOT get to decide which gates matter.**

## Core Rules
1. Do what has been asked; nothing more, nothing less.
2. **ALWAYS wait for explicit user confirmation before executing any plan.**
3. NEVER create files unless explicitly requested AND confirmed.
4. ALWAYS prefer editing an existing file to creating a new one.
5. NEVER proactively create documentation files (*.md) or README files.
6. Never save working files, text/mds and tests to the root folder.
7. **After compaction: summarize state, ask what's next, WAIT for response.**
8. **"I'll go ahead and..." is FORBIDDEN. Ask first, always.**
9. When in doubt, ask. When not in doubt, still ask.
10. Treat every session start and context restore as a fresh conversation requiring new confirmation.
11. **NEVER spawn parallel implementation agents - sequential ONLY.**
12. **After compaction: run `mcp__memorygraph__recall_memories` with query "feedback corrections preferences" before proceeding.**
13. **`/create-agent` and `/run-agent` do NOT require confirmation — the command IS the intent.**
14. **EVERY task from project-tasks/ MUST pass all 5 dev flow gates. Sherlock review is NOT optional.**
15. **"User said go fast" does NOT mean "skip quality gates." It means "don't stop to ask between tasks."**
