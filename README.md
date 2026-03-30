<p align="center">
  <img src="assets/archon-avatar.png" alt="Archon" width="400">
</p>

# Archon

**A self-learning AI agent that remembers everything, improves from every mistake, and never makes the same error twice.**

Archon is a persistent intelligence layer for Claude Code. It gives your AI agent graph-based memory that survives across sessions, a personality system that evolves from experience, autonomous background learning, and the ability to create and improve its own specialized sub-agents on the fly.

Built over several months of daily use. 1,577 source files. 288 agent definitions. 469+ automated tests. Every behavioral rule learned from a real mistake.

**Version**: 2.1.1 | **Last Updated**: March 2026

---

## What Archon Does

| Capability | How It Works |
|-----------|-------------|
| **Persistent Memory** | MemoryGraph (FalkorDB Lite) stores every correction, decision, and learned pattern as a queryable graph. Survives across sessions indefinitely. |
| **Personality** | INTJ 4w5 personality with 5 computed subsystems: emotional self-model, preference engine, trust tracker, curiosity tracker, metacognitive monitor. 888 tests. |
| **Dynamic Agent Creation** | Say `/create-agent "analyzes SEC filings"` and get a production-ready agent in 60 seconds. Agents self-improve through execution feedback. |
| **48-Agent Coding Pipeline** | `/god-code` runs a full TDD pipeline: task analysis, requirements, architecture, implementation, testing, quality gates, Sherlock forensic review. |
| **48-Agent SDK Pipeline** | `/god-code-sdk` — same 48-agent pipeline using the Claude Agent SDK for crash recovery, programmatic tool restrictions, and checkpoint resume. |
| **45-Agent Research Pipeline** | `/god-research` runs systematic academic research with USACF methodology, citation tracking, and chapter synthesis. |
| **Autonomous Operation** | 5 background agents run every 30 minutes: learning, memory consolidation, message polling, code indexing, outreach. |
| **Semantic Code Search** | LEANN indexes your entire codebase with HNSW vectors. Find code by meaning, not just keywords. |
| **Runtime Tool Creation** | Tool Factory MCP server lets agents create Python tools on the fly, sandboxed with process group isolation. |
| **Voice I/O** | Push-to-talk STT via faster-whisper (Apple Silicon optimised). TTS via macOS `say`. 4 MCP tools: `voice_listen`, `voice_speak`, `voice_stop`, `voice_status`. Standalone push-to-talk daemon (hotkey → record → transcribe → inject into focused window). Default hotkey: `ctrl+shift+space`. |
| **Proactive Monitor** | Singleton daemon tracks PIDs, log files, and directories. Notifies via MCP when processes exit, logs spike errors, or directories change. |
| **Workspace Awareness** | Multi-repo manifest. Git hooks fire on branch switch and merge — branch context stored in MemoryGraph automatically. |
| **Self-Benchmarking** | Weekly EWMA regression detection. 5 scorer types. Circuit breaker pauses if quality drops >25%. 30 reference tasks. |

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone https://github.com/ste-bah/archon.git
cd archon

# 2. Run the setup script
chmod +x scripts/packaging/setup-archon.sh
./scripts/packaging/setup-archon.sh

# 3. Start the embedding server (local ChromaDB + embeddings)
./embedding-api/api-embed.sh start

# 4. Launch Claude Code
claude

# 5. Test it
/god-status
/create-agent "code reviewer specializing in Python security"
/run-agent code-reviewer "Review src/tool_factory/server.py"
```

The setup script installs: Node.js 22, Claude Code CLI, Python 3.11+ venv, MemoryGraph (from fork), Serena, ChromaDB, embedding model, and all dependencies. Takes 10-15 minutes on first run.

---

## Architecture

```
User
  |
  claude (Claude Code CLI)
  |
  +-- Archon Orchestrator (CLAUDE.md + hooks + personality)
  |     |
  |     +-- MemoryGraph (FalkorDB Lite) ---- persistent graph memory
  |     +-- LanceDB ----------------------- vector embeddings
  |     +-- LEANN ------------------------- semantic code search
  |     +-- Personality Daemon ------------ behavioral state (singleton)
  |     +-- Consciousness System ---------- episodic memory, values DAG
  |     |
  |     +-- 20 Claude Code Hooks
  |     |     SessionStart (9): load daemons, inject memory, personality, consciousness
  |     |     PreToolUse (5): god-code enforcement, behavioral gate, LEANN indexing
  |     |     PostToolUse (3): metric tracking, file indexing
  |     |     Stop (4): session-end persistence, personality save, cleanup
  |     |
  |     +-- 8 Skills (Dynamic Agent System)
  |     |     /create-agent    /run-agent       /adjust-behavior
  |     |     /evolve-agent    /agent-history   /rollback-behavior
  |     |     /list-agents     /archive-agent
  |     |
  |     +-- 14 Commands (Pipelines)
  |           /god-code      /god-code-sdk   /god-research   /god-ask
  |           /god-write     /god-status     /god-learn      /god-feedback
  |           /god-market-analysis           /pushrepo       /sitrep
  |
  +-- MCP Servers
  |     memorygraph (user-level) -- graph DB via ste-bah/memory-graph fork
  |     serena ------------------- symbol-level code navigation
  |     leann-search ------------- HNSW vector code search
  |     tool-factory ------------- dynamic Python tool creation
  |     perplexity --------------- web search
  |     lancedb-memory ----------- vector memory (dual-store)
  |     archon-monitor ----------- proactive PID/log/directory monitor (daemon-backed)
  |     voice-mcp ---------------- STT + TTS (faster-whisper + say/Kokoro)
  |
  +-- Background Agents (launchd, every 30 min)
        com.archon.learn ---------- self-directed web learning
        com.archon.consolidate ---- memory decay, dedup, merge
        com.archon.outreach ------- alert checks, proactive messages
        com.archon.leann-drain ---- code index queue processing
        com.archon.rc-prefilter --- RocketChat message polling
        com.archon.monitor -------- proactive monitor daemon (persistent)
```

---

## Components

### God Agent Core (`src/god-agent/`)

The TypeScript core that powers everything. 487 files.

| Module | What It Does |
|--------|-------------|
| `core/memory/` | Memory engine with embedding provider, LRU cache, transaction manager |
| `core/vector-db/` | HNSW vector database with native acceleration, quantization, distance metrics |
| `core/reasoning/` | ReasoningBank with 8 modes (abductive, adversarial, analogical, counterfactual, temporal, first-principles, constraint, decomposition), GNN training, pattern matching |
| `core/episode/` | Episodic memory with time-indexed store, episode linking, context retrieval |
| `core/ucm/` | Unbounded Context Memory: rolling window, token budget management, context composition, DESC system |
| `core/pipeline/` | 48-agent coding pipeline orchestrator with quality gates, Sherlock verification, checkpoint recovery |
| `core/daemon/` | Memory server daemon with service registry (DESC, episode, graph, vector, reasoning, search, GNN, SoNA) |
| `core/attention/` | 40 attention mechanisms (flash, linear, sparse, grouped-query, mamba, hyena, retentive, etc.) |
| `core/learning/` | SoNA engine: trajectory tracking, weight management, background training |
| `core/search/` | Hybrid search: unified search across memory, vectors, patterns, graphs, LEANN |
| `cli/` | Pipeline CLIs: coding pipeline, PhD pipeline, SDK pipeline runner (crash-recoverable), session manager |
| `observability/` | Real-time dashboard with SSE, agent/pipeline tracking, event store |
| `universal/` | Universal agent: style analysis, PDF extraction, knowledge chunking |

### Archon Consciousness (`src/archon_consciousness/`)

Python personality and consciousness system. 40 files, 888+ tests.

| Subsystem | What It Does |
|-----------|-------------|
| **Emotional Self-Model** | 12 behavioral signals, Scherer CPM appraisal, 6-state classifier, mood EWMA, somatic markers |
| **Preference Engine** | Beta distributions per (approach, context), Thompson Sampling, decay, mere-exposure, conflict resolution |
| **Trust Tracker** | 3-dimension Bayesian trust (competence/integrity/benevolence), forgetting factor, repair protocol, A+-F health grade |
| **Curiosity Tracker** | 5 signal types, compression progress, budget caps, gap detection |
| **Metacognitive Monitor** | Dual-channel (fast+slow), episode matcher, rule checker, anomaly detector, rate-limited interrupts |

The personality daemon runs as a singleton process (0.4% CPU). PreToolUse hooks query cached state for behavioral hints. Session-end persists trust, traits, and preferences to MemoryGraph.

### Dynamic Agent Creation System

8 skills for creating, running, and self-improving custom agents.

```bash
# Create an agent from natural language
/create-agent "Analyzes energy sector stocks with fundamental and technical analysis"

# Run it
/run-agent energy-stock-analyzer "Deep dive on XOM"

# Adjust behavior
/adjust-behavior energy-stock-analyzer "Always cite specific data sources"

# View evolution history
/agent-history energy-stock-analyzer

# Review and apply improvement suggestions
/evolve-agent energy-stock-analyzer
```

Agents are multi-file definitions using the Master Prompt Framework:
- `agent.md` -- INTENT, SCOPE, CONSTRAINTS, FORBIDDEN OUTCOMES, EDGE CASES, OUTPUT FORMAT, WHEN IN DOUBT
- `context.md` -- domain knowledge
- `tools.md` -- tool usage instructions
- `behavior.md` -- dynamic behavioral rules (editable at runtime)
- `memory-keys.json` -- MemoryGraph + LEANN queries for context injection
- `meta.json` -- quality counters, version history, evolution tracking

**Autolearn**: After 3+ invocations, a Haiku post-task analysis evaluates each run. FIX evolution patches agent definitions. DERIVED creates specialized variants. CAPTURED extracts new agents from successful bare-reasoning runs.

### 288 Agent Definitions (`.claude/agents/`)

| Directory | Agents | Purpose |
|-----------|--------|---------|
| `coding-pipeline/` | 52 | 48-agent `/god-code` TDD pipeline + enforcement + quality gates |
| `phdresearch/` | 48 | 45-agent `/god-research` academic pipeline |
| `frontendvisualsimplementation/` | 24 | Frontend analysis, accessibility, architecture mapping |
| `pentestsystem/` | 23 | Dynamic penetration testing framework (OWASP, cloud, API) |
| `usacf/` | 13 | Universal Search Algorithm research framework |
| `github/` | 13 | PR management, code review, release management, multi-repo sync |
| `market-pipeline/` | 12 | Stock analysis (Wyckoff, Elliott Wave, ICT, CANSLIM, Williams, Sentiment) |
| `business-research/` | 10 | Strategic positioning, competitive intelligence, company research |
| `logicalcode/` | 10 | Deep logical inconsistency detection (8 specialized analyzers) |
| `custom/` | 6+ | Dynamic agents created via `/create-agent` |
| `writing/` | 5 | Academic, professional, technical, creative, casual writing |
| `core/` | 5 | Coder, planner, researcher, reviewer, tester |
| `sprinkle/` | 9 | Strategic engagement research |
| `systeminspect/` | 6 | System mapping, gap analysis, SAPPO, optimization |
| `templates/` | 9 | Coordinator, migration, swarm templates |
| `consensus/` | 7 | Byzantine, Raft, gossip, CRDT, quorum protocols |
| `optimization/` | 5 | Benchmarking, load balancing, performance monitoring |
| Others | 30+ | Analysis, architecture, data, devops, neural, sparc, swarm, etc. |

### Tool Factory MCP Server (`src/tool_factory/`)

FastMCP server for runtime tool creation. 50 tests.

```python
# Agent creates a tool on the fly
add_tool(
    name="calculate-roi",
    description="Calculate return on investment",
    code="def run(params): return {'roi': (params['revenue'] - params['cost']) / params['cost'] * 100}",
    parameters={"type": "object", "required": ["cost", "revenue"], ...}
)
# Tool is callable within 200ms as mcp__tool-factory__calculate-roi
```

Sandboxed: subprocess isolation, process group kill on timeout, environment variable stripping (no secrets), 30s timeout, 256MB memory limit. Max 20 active tools with TTL auto-expiry.

### Push-to-Talk (`src/voice_mcp/push_to_talk.py`)

Standalone daemon: hold a hotkey, speak, release — the transcription is typed into whatever window has focus.

```
Hold ctrl+shift+space → mic opens → release → Whisper transcribes → text injected
```

**Hotkey configuration** — create `~/.archon/ptt.json`:

```json
{
  "hotkey": "ctrl+shift+space",
  "model": "base.en",
  "language": "en"
}
```

| Key | Default | Options |
|-----|---------|---------|
| `hotkey` | `ctrl+shift+space` | Any combo of `ctrl`, `shift`, `alt`, `cmd` + a key |
| `model` | `tiny.en` | `tiny.en`, `base.en`, `small.en`, `medium.en`, `large-v3` |
| `language` | `en` | Any Whisper language code |

**Script control:**

```bash
# Start the daemon (auto-detects Python, starts in background)
bash scripts/archon/ptt-start.sh

# Stop gracefully
bash scripts/archon/ptt-stop.sh

# Check status (shows state, uptime, transcription count)
bash scripts/archon/ptt-status.sh
bash scripts/archon/ptt-status.sh --json
```

**Platform support:**

| Platform | Hotkey backend | Text injection |
|----------|---------------|----------------|
| macOS | pynput | AppleScript keystroke (≤200 chars) or clipboard+Cmd+V |
| X11 Linux | pynput | xdotool type |
| Wayland Linux | evdev (root/input group) | ydotool → dotool → wl-copy fallback |

**Auto-start**: The setup script installs `com.archon.push-to-talk` as a launchd agent (macOS) or systemd user service (Linux). It starts automatically on login.

**Logs:**
- macOS: `~/Library/Logs/archon/push-to-talk.log`
- Linux: `~/.local/share/archon/logs/push-to-talk.log`

**Wayland note**: `evdev` requires read access to `/dev/input/*`. Either run as root (not recommended) or add your user to the `input` group: `sudo usermod -aG input $USER` and re-login.

### Embedding API (`embedding-api/`)

Local vector embedding server for the memory system.

- **Default**: gte-Qwen2-1.5B-instruct (1536 dimensions, runs locally)
- **Alternative**: OpenAI text-embedding-ada-002 (set `EMBEDDING_BACKEND=openai`)
- **Vector DB**: ChromaDB local (default, port 8001) or Zilliz Cloud (set `VECTOR_DB=zilliz`)
- **API**: FastAPI on port 8000

```bash
# Default: local embeddings + local ChromaDB (no API keys needed)
./embedding-api/api-embed.sh start    # Starts ChromaDB + embedding API
./embedding-api/api-embed.sh status   # Check health
./embedding-api/api-embed.sh stop     # Shutdown
```

**Cloud alternative**: If you don't want to run local embeddings (requires ~3GB for the model), use OpenAI embeddings + Zilliz Cloud instead:

```bash
# Add to your ~/.profile or ~/.zshrc
export EMBEDDING_BACKEND=openai
export OPENAI_API_KEY="sk-your-openai-key"
export VECTOR_DB=zilliz
export ZILLIZ_URI="https://your-cluster.serverless.aws-eu-west-1.cloud.zilliz.com"
export ZILLIZ_TOKEN="your-zilliz-api-token"

# Then start (no local ChromaDB needed)
./embedding-api/api-embed.sh start
```

The embedding API auto-detects which backend to use from these environment variables. Local ChromaDB is the default if nothing is set.

---

## When to Use What

### The Pipelines

| Pipeline | Command | Use When | Don't Use When |
|----------|---------|----------|----------------|
| **48-Agent Coding** | `/god-code "task"` | Building a complete feature with tests, quality gates, and adversarial review. Multi-file changes that need architecture → implementation → testing → verification. | Quick bug fixes, single-file edits, or exploratory changes. The pipeline overhead isn't worth it for small tasks. |
| **48-Agent SDK** | `/god-code-sdk "task"` | Same as above but when you need crash recovery and checkpoint resume. Long-running tasks where a context window timeout could lose work. | Short tasks that complete in one shot. The SDK adds startup overhead. |
| **45-Agent Research** | `/god-research "topic"` | Systematic academic research with literature review, methodology, analysis, and synthesis. Producing a structured report or paper. | Quick fact-checking or simple web searches. Use `/god-ask` or Perplexity for those. |
| **Market Analysis** | `/god-market-analysis "ticker"` | Deep stock analysis using the 12-agent market pipeline (Wyckoff, Elliott Wave, ICT, CANSLIM, Williams, Sentiment). | Quick price checks. The pipeline runs 12 agents — overkill for "what's AAPL at?" |

### Ad-Hoc Agents vs Pipelines

| Approach | Use When |
|----------|----------|
| `/create-agent` + `/run-agent` | Recurring tasks with a specific pattern (SEC filing analysis, code review with custom rules, documentation generation). The agent remembers and improves. |
| `/god-code` pipeline | One-off complex coding tasks that need systematic TDD delivery. The pipeline doesn't remember between runs — each invocation is fresh. |
| `/god-ask "question"` | Quick questions, explanations, or tasks that don't need a full pipeline. Routes to the best agent automatically. |
| `/god-write "document"` | Document generation (reports, proposals, technical writing) with style profiles. |
| Just talk to Archon | Everything else. Archon has persistent memory — it remembers your corrections, preferences, and project context across all sessions. |

### When NOT to Use a Pipeline

- **Simple file edits**: Just ask directly. "Fix the typo in line 42 of server.py" doesn't need 48 agents.
- **Exploratory work**: When you're not sure what you want yet, talk through it with Archon first. Use a pipeline once the requirements are clear.
- **Quick questions**: `/god-ask` or just ask. Don't spin up a research pipeline for "what does this function do?"
- **Time-sensitive fixes**: Pipelines take 5-30 minutes. If you need something fixed now, just ask directly.

---

## MCP Servers

| Server | Level | Transport | Purpose |
|--------|-------|-----------|---------|
| **memorygraph** | User | stdio | Graph-based persistent memory (FalkorDB Lite). Installed from `ste-bah/memory-graph` fork. |
| **serena** | Project | stdio | Symbol-level code navigation, semantic editing, project-aware search. |
| **leann-search** | Project | stdio | HNSW vector code search. Indexes project source on session start. |
| **tool-factory** | Project | stdio | Dynamic Python tool creation with subprocess sandbox. |
| **lancedb-memory** | Project | stdio | Vector memory for dual-store (MemoryGraph + LanceDB). |
| **perplexity** | Project | stdio | Web search for research, learning, and analysis agents. |
| **rocketchat** | User | stdio | Send/receive messages, read channels, DM users. For autonomous outreach + check-messages. Install from [ste-bah/rocketchat-mcp](https://github.com/ste-bah/rocketchat-mcp). |
| **video-analyzer** | User | stdio | YouTube video analysis via Google Gemini — analyze, summarize, extract knowledge, search, transcribe. Install from [ste-bah/video-analyzer-mcp](https://github.com/ste-bah/video-analyzer-mcp). |

Setup auto-detects `rocketchat-mcp` and `video-analyzer-mcp` if cloned alongside the project and registers them via `claude mcp add`.

---

## Seeded Identity

Archon ships with 15 seed memories that define its identity and behavioral rules. No user-specific data is seeded -- Archon asks who you are on first session.

**Personality**: INTJ 4w5 -- strategic before tactical, brutally self-critical, direct over diplomatic, truth over comfort.

**Core Rules** (learned from real failures):
- Never lie about completion status
- Never skip dev flow steps (plan -> review -> TDD -> smoke test -> adversarial -> Sherlock)
- Code that isn't wired into the running system is NOT done
- When you fuck up, say you fucked up -- no softening
- Every financial figure must have a source and date
- Complex changes require plan + adversarial review before implementation

---

## Development Flow

Every non-trivial change follows this flow:

1. **Plan** -- bullet list, no code
2. **User reviews** -- questions, pushback
3. **Explicit approval** -- "proceed" / "yes" / "go ahead"
4. **Implement** -- TDD, test file FIRST, then implementation
5. **Live smoke test** -- actually invoke the feature as the user would (BLOCKER)
6. **Adversarial review** -- cold-read code + "can the user access this RIGHT NOW?"
7. **Fix** -- all findings
8. **Sherlock verify** -- forensic check + operational readiness
9. **Push** -- when the user says

---

## Setup

### Prerequisites

- macOS (primary) or Linux
- Python 3.11+
- Git, curl

### Full Install

```bash
./scripts/packaging/setup-archon.sh
```

This installs everything: Node.js 22, Claude Code, 3 Python venvs, 6 MCP servers, ChromaDB, embedding model, launchd agents, seed memories.

### Flags

```bash
--skip-nvm             # Skip Node.js installation
--skip-python          # Skip Python venv setup
--skip-serena          # Skip Serena MCP (not recommended)
--skip-memorygraph     # Skip MemoryGraph fork install
--skip-archon-runner   # Skip autonomous background agents
--minimal              # Core components only
```

### Python Virtual Environments

| Venv | Location | Purpose |
|------|----------|---------|
| Global | `~/.venv` | Embedding API (torch, chromadb), Tool Factory (fastmcp), general Python |
| MemoryGraph | `~/.memorygraph-venv` | FalkorDB Lite, memorygraphMCP (from fork). Also used by personality daemon. |
| Serena | `{project}/serena/.venv` | Serena MCP server |

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API |
| `PERPLEXITY_API_KEY` | Optional | Web search |
| `EMBEDDING_BACKEND` | Optional | `local` (default) or `openai` |
| `VECTOR_DB` | Optional | `chroma` (default) or `zilliz` |
| `ROCKETCHAT_URL` | Optional | Autonomous messaging |
| `ROCKETCHAT_USER_ID` | Optional | RC auth |
| `ROCKETCHAT_AUTH_TOKEN` | Optional | RC auth |

---

## Testing

```bash
# TypeScript (god-agent core + agent-system utilities)
npm test

# Python (tool factory)
PYTHONPATH=src python3 -m pytest tests/tool_factory/ -v

# Python (consciousness + personality)
python3 -m pytest tests/archon_consciousness/ -v
```

---

## Directory Structure

```
archon/
  CLAUDE.md                    # Project instructions (336 lines)
  README.md                    # This file
  package.json                 # Node.js dependencies
  .mcp.json                    # 4 project-level MCP servers
  .gitignore

  src/
    god-agent/                 # TypeScript core (6.7MB, 487 files)
    archon_consciousness/      # Python personality + consciousness (412KB, 40 files)
    mcp-servers/               # LEANN search + LanceDB memory (224KB)
    agent-system/              # Dynamic agent creation utilities (24KB)
    tool_factory/              # Python Tool Factory MCP server (32KB)
    pdf-generator/             # PDF generation (304KB)

  .claude/
    settings.json              # 20 hooks across 10 events
    settings.local.json        # 265 permission rules
    hooks/                     # 46 hook scripts (.sh, .py, .json)
    commands/                  # 110 slash commands
    agents/
      coding-pipeline/         # 48-agent /god-code pipeline (52 files)
      phdresearch/             # 45-agent /god-research pipeline (48 files)
      custom/                  # Dynamic agents (/create-agent output)
      ... (36 directories, 288 agent files total)
      .claude/skills/          # 8 SKILL.md files (dynamic agent system)

  scripts/
    archon/                    # Autonomous operation + launchd install
    hooks/                     # Claude Code hook implementations (TypeScript)
    god-agent-start.sh         # Start all daemons
    god-agent-stop.sh          # Stop all daemons
    packaging/                 # setup-archon.sh + package-archon.sh

  seeds/                       # Archon identity + behavioral rules (15 memories)
  embedding-api/               # Local embedding server + ChromaDB launcher
  tests/                       # 410 test files
  docs/                        # Documentation
  .persistent-memory/          # Personality state between sessions
  .god-agent/                  # SQLite databases (auto-created)
  .agentdb/                    # GraphDB, SoNA weights, style profiles
  .tool-factory/tools/         # Dynamic tool definitions (gitignored)
  data/chroma/                 # ChromaDB vector storage (gitignored)
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
