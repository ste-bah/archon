#!/bin/bash
#===============================================================================
# Archon Packaging Script
#
# Creates a distributable package of the Archon system — the self-learning
# AI agent with consciousness, personality, semantic search, and dynamic
# agent creation.
#
# Usage: ./package-archon.sh [OPTIONS]
#   --output DIR     Output directory (default: ./archon-package)
#   --tarball        Create tarball archive
#   --version VER    Set version (default: 3.0.0)
#   --help           Show this help
#===============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/archon-package"
CREATE_TARBALL=false
VERSION="2.2.6"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --tarball)
            CREATE_TARBALL=true
            shift
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --help)
            head -14 "$0" | tail -11
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}"
echo "=================================================================="
echo "            Archon Packaging Script v${VERSION}"
echo "=================================================================="
echo -e "${NC}"

# Create output directory
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

STEP=0
TOTAL_STEPS=22

#===============================================================================
# STEP 1: God Agent Core Source
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying God Agent core (src/god-agent/)...${NC}"
mkdir -p "$OUTPUT_DIR/src"
cp -r "$PROJECT_DIR/src/god-agent" "$OUTPUT_DIR/src/"
TS_COUNT=$(find "$OUTPUT_DIR/src/god-agent" -name "*.ts" | wc -l | tr -d ' ')
echo -e "${GREEN}  Done: $TS_COUNT TypeScript files${NC}"

#===============================================================================
# STEP 2: Claude Code Configuration (selective copy)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Claude Code configuration (.claude/ — selective)...${NC}"

# Settings files
mkdir -p "$OUTPUT_DIR/.claude"
cp "$PROJECT_DIR/.claude/settings.json" "$OUTPUT_DIR/.claude/" 2>/dev/null || true
cp "$PROJECT_DIR/.claude/settings.local.json" "$OUTPUT_DIR/.claude/" 2>/dev/null || true

# Hooks — only .sh and .py scripts, NOT feedback-queue.processed.* junk
mkdir -p "$OUTPUT_DIR/.claude/hooks"
find "$PROJECT_DIR/.claude/hooks" -maxdepth 1 \( -name "*.sh" -o -name "*.py" -o -name "*.json" \) -not -name "feedback-queue*" -exec cp {} "$OUTPUT_DIR/.claude/hooks/" \;
HOOK_COUNT=$(find "$OUTPUT_DIR/.claude/hooks" -type f | wc -l | tr -d ' ')

# Skills — our 8 custom skills
OUR_SKILLS="create-agent run-agent adjust-behavior rollback-behavior list-agents archive-agent evolve-agent agent-history"
mkdir -p "$OUTPUT_DIR/.claude/agents/.claude/skills"
for skill in $OUR_SKILLS; do
    if [ -d "$PROJECT_DIR/.claude/agents/.claude/skills/$skill" ]; then
        cp -r "$PROJECT_DIR/.claude/agents/.claude/skills/$skill" "$OUTPUT_DIR/.claude/agents/.claude/skills/"
    fi
done
SKILL_COUNT=$(find "$OUTPUT_DIR/.claude/agents/.claude/skills" -type d -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')

# ALL our agent definitions — copy every top-level directory in .claude/agents/
# This includes: coding-pipeline, phdresearch, usacf, market-pipeline, business-research,
# frontendvisualsimplementation, pentestsystem, logicalcode, writing, sherlock-homes,
# core, github, custom, templates, and more.
# EXCLUDE: .claude/agents/.claude/agents/ (generated claude-flow defs — 76 files, not ours)
# EXCLUDE: .claude/agents/.claude/commands/ (generated — we have our own at .claude/commands/)
# EXCLUDE: .claude/agents/.claude/helpers/ (generated)
# EXCLUDE: .claude/agents/.claude/checkpoints/ (empty)
# KEEP: .claude/agents/.claude/skills/ (our 8 skills, already copied above)
for agent_dir in "$PROJECT_DIR/.claude/agents"/*/; do
    dir_name=$(basename "$agent_dir")
    # Skip the .claude subdirectory (handled separately for skills only)
    if [ "$dir_name" = ".claude" ]; then
        continue
    fi
    mkdir -p "$OUTPUT_DIR/.claude/agents/$dir_name"
    cp -r "$agent_dir"* "$OUTPUT_DIR/.claude/agents/$dir_name/" 2>/dev/null || true
done

# Also copy any top-level .md files in .claude/agents/ (e.g., base-template-generator.md)
find "$PROJECT_DIR/.claude/agents" -maxdepth 1 -name "*.md" -exec cp {} "$OUTPUT_DIR/.claude/agents/" \; 2>/dev/null || true

AGENT_DIR_COUNT=$(find "$OUTPUT_DIR/.claude/agents" -mindepth 1 -maxdepth 1 -type d | grep -v "\.claude" | wc -l | tr -d ' ')
AGENT_FILE_COUNT=$(find "$OUTPUT_DIR/.claude/agents" -name "*.md" -not -path "*/.claude/*" | wc -l | tr -d ' ')

# Commands
if [ -d "$PROJECT_DIR/.claude/commands" ]; then
    cp -r "$PROJECT_DIR/.claude/commands" "$OUTPUT_DIR/.claude/"
fi
COMMAND_COUNT=$(find "$OUTPUT_DIR/.claude/commands" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

echo -e "${GREEN}  Done: ${AGENT_DIR_COUNT} agent dirs (${AGENT_FILE_COUNT} files), ${SKILL_COUNT} skills, ${COMMAND_COUNT} commands, ${HOOK_COUNT} hooks${NC}"
echo -e "${GREEN}  Included: coding-pipeline, phdresearch, usacf, market-pipeline, business-research, pentestsystem, custom, + more${NC}"
echo -e "${GREEN}  Excluded: .claude/agents/.claude/agents/ (generated), feedback-queue.processed.* (~400 files)${NC}"

#===============================================================================
# STEP 3: Archon Consciousness + Personality (Python)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Archon consciousness (src/archon_consciousness/)...${NC}"
if [ -d "$PROJECT_DIR/src/archon_consciousness" ]; then
    cp -r "$PROJECT_DIR/src/archon_consciousness" "$OUTPUT_DIR/src/"
    # Remove __pycache__ directories
    find "$OUTPUT_DIR/src/archon_consciousness" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    PY_COUNT=$(find "$OUTPUT_DIR/src/archon_consciousness" -name "*.py" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $PY_COUNT Python files (consciousness v1 + personality v2)${NC}"
else
    echo -e "${YELLOW}  Warning: src/archon_consciousness/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 4: MCP Servers (LEANN + LanceDB)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying MCP servers (src/mcp-servers/)...${NC}"
if [ -d "$PROJECT_DIR/src/mcp-servers" ]; then
    cp -r "$PROJECT_DIR/src/mcp-servers" "$OUTPUT_DIR/src/"
    LEANN_COUNT=$(find "$OUTPUT_DIR/src/mcp-servers/leann-search" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
    LANCE_COUNT=$(find "$OUTPUT_DIR/src/mcp-servers/lancedb-memory" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: leann-search ($LEANN_COUNT TS files), lancedb-memory ($LANCE_COUNT TS files)${NC}"
else
    echo -e "${YELLOW}  Warning: src/mcp-servers/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 5: Agent System (TypeScript agent creation utilities)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying agent system (src/agent-system/)...${NC}"
if [ -d "$PROJECT_DIR/src/agent-system" ]; then
    cp -r "$PROJECT_DIR/src/agent-system" "$OUTPUT_DIR/src/"
    AS_COUNT=$(find "$OUTPUT_DIR/src/agent-system" -name "*.ts" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $AS_COUNT TypeScript files${NC}"
else
    echo -e "${YELLOW}  Warning: src/agent-system/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 6: Tool Factory (Python MCP server)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Tool Factory (src/tool_factory/)...${NC}"
if [ -d "$PROJECT_DIR/src/tool_factory" ]; then
    cp -r "$PROJECT_DIR/src/tool_factory" "$OUTPUT_DIR/src/"
    find "$OUTPUT_DIR/src/tool_factory" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    TF_COUNT=$(find "$OUTPUT_DIR/src/tool_factory" -name "*.py" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $TF_COUNT Python files${NC}"
else
    echo -e "${YELLOW}  Warning: src/tool_factory/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 6b: Workspace Module (multi-project, git hooks, branch context)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying workspace module (src/workspace/)...${NC}"
if [ -d "$PROJECT_DIR/src/workspace" ]; then
    cp -r "$PROJECT_DIR/src/workspace" "$OUTPUT_DIR/src/"
    find "$OUTPUT_DIR/src/workspace" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    WS_COUNT=$(find "$OUTPUT_DIR/src/workspace" -name "*.py" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $WS_COUNT Python files (manifest, namespace, branch context, git hooks, search)${NC}"
else
    echo -e "${YELLOW}  Warning: src/workspace/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 6c: Voice MCP Server (STT + TTS)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Voice MCP server (src/voice_mcp/)...${NC}"
if [ -d "$PROJECT_DIR/src/voice_mcp" ]; then
    cp -r "$PROJECT_DIR/src/voice_mcp" "$OUTPUT_DIR/src/"
    find "$OUTPUT_DIR/src/voice_mcp" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    VM_COUNT=$(find "$OUTPUT_DIR/src/voice_mcp" -name "*.py" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $VM_COUNT Python files (server, stt, tts, audio)${NC}"
else
    echo -e "${YELLOW}  Warning: src/voice_mcp/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 6d: Archon Monitor (daemon, dispatch, pipeline monitor)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Archon Monitor (src/archon_monitor/)...${NC}"
if [ -d "$PROJECT_DIR/src/archon_monitor" ]; then
    cp -r "$PROJECT_DIR/src/archon_monitor" "$OUTPUT_DIR/src/"
    find "$OUTPUT_DIR/src/archon_monitor" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    AM_COUNT=$(find "$OUTPUT_DIR/src/archon_monitor" -name "*.py" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $AM_COUNT Python files (daemon, models, patterns, dispatch, rate limiter, pipeline monitor)${NC}"
else
    echo -e "${YELLOW}  Warning: src/archon_monitor/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 6e: Benchmark Suite (harness, scorers, regression, scheduler)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Benchmark Suite (scripts/benchmark/)...${NC}"
if [ -d "$PROJECT_DIR/scripts/benchmark" ]; then
    mkdir -p "$OUTPUT_DIR/scripts/benchmark"
    cp "$PROJECT_DIR/scripts/benchmark/"*.py "$OUTPUT_DIR/scripts/benchmark/" 2>/dev/null || true
    BM_COUNT=$(find "$OUTPUT_DIR/scripts/benchmark" -name "*.py" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $BM_COUNT Python files (schemas, scorers, cost_tracker, regression, scheduler)${NC}"
else
    echo -e "${YELLOW}  Warning: scripts/benchmark/ not found, skipping${NC}"
fi

# Copy benchmark reference tasks
if [ -f "$PROJECT_DIR/tests/benchmark/reference-tasks.jsonl" ]; then
    mkdir -p "$OUTPUT_DIR/tests/benchmark"
    cp "$PROJECT_DIR/tests/benchmark/reference-tasks.jsonl" "$OUTPUT_DIR/tests/benchmark/"
    echo -e "${GREEN}  Copied 30 reference tasks (reference-tasks.jsonl)${NC}"
fi

# Copy benchmark + monitor launchd plists
mkdir -p "$OUTPUT_DIR/scripts/packaging"
if [ -f "$PROJECT_DIR/scripts/packaging/com.archon.benchmark.plist" ]; then
    cp "$PROJECT_DIR/scripts/packaging/com.archon.benchmark.plist" "$OUTPUT_DIR/scripts/packaging/"
    echo -e "${GREEN}  Copied benchmark launchd plist${NC}"
fi

if [ -f "$PROJECT_DIR/scripts/packaging/com.archon.monitor.plist" ]; then
    cp "$PROJECT_DIR/scripts/packaging/com.archon.monitor.plist" "$OUTPUT_DIR/scripts/packaging/"
    echo -e "${GREEN}  Copied monitor launchd plist${NC}"
fi

if [ -f "$PROJECT_DIR/scripts/packaging/com.archon.push-to-talk.plist" ]; then
    cp "$PROJECT_DIR/scripts/packaging/com.archon.push-to-talk.plist" "$OUTPUT_DIR/scripts/packaging/"
    echo -e "${GREEN}  Copied push-to-talk launchd plist${NC}"
fi

if [ -f "$PROJECT_DIR/scripts/packaging/archon-push-to-talk.service" ]; then
    cp "$PROJECT_DIR/scripts/packaging/archon-push-to-talk.service" "$OUTPUT_DIR/scripts/packaging/"
    echo -e "${GREEN}  Copied push-to-talk systemd service${NC}"
fi

#===============================================================================
# STEP 6f: Git Hooks (post-checkout, post-merge)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying git hooks (scripts/git-hooks/)...${NC}"
if [ -d "$PROJECT_DIR/scripts/git-hooks" ]; then
    mkdir -p "$OUTPUT_DIR/scripts/git-hooks"
    cp "$PROJECT_DIR/scripts/git-hooks/"* "$OUTPUT_DIR/scripts/git-hooks/" 2>/dev/null || true
    chmod +x "$OUTPUT_DIR/scripts/git-hooks/"* 2>/dev/null || true
    GH_COUNT=$(find "$OUTPUT_DIR/scripts/git-hooks" -type f | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $GH_COUNT hook scripts (post-checkout, post-merge)${NC}"
else
    echo -e "${YELLOW}  Warning: scripts/git-hooks/ not found, skipping${NC}"
fi

#===============================================================================
# STEP 7: PDF Generator (optional)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying PDF generator (src/pdf-generator/)...${NC}"
if [ -d "$PROJECT_DIR/src/pdf-generator" ]; then
    cp -r "$PROJECT_DIR/src/pdf-generator" "$OUTPUT_DIR/src/"
    PDF_COUNT=$(find "$OUTPUT_DIR/src/pdf-generator" -name "*.ts" | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $PDF_COUNT TypeScript files${NC}"
else
    echo -e "${YELLOW}  No pdf-generator found, skipping (optional)${NC}"
fi

#===============================================================================
# STEP 7b: Embedding API (local embedding server for memory + UCM)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying Embedding API...${NC}"
mkdir -p "$OUTPUT_DIR/embedding-api"

# Copy embedding API files
if [ -d "$PROJECT_DIR/embedding-api" ]; then
    cp "$PROJECT_DIR/embedding-api/api_embedder.py" "$OUTPUT_DIR/embedding-api/" 2>/dev/null || true
    cp "$PROJECT_DIR/embedding-api/requirements.txt" "$OUTPUT_DIR/embedding-api/" 2>/dev/null || true
    echo -e "${GREEN}  Done: api_embedder.py + requirements.txt${NC}"
else
    echo -e "${YELLOW}  No embedding-api/ found in source${NC}"
fi

# Copy launcher script
if [ -f "$PROJECT_DIR/scripts/packaging/api-embed.sh" ]; then
    cp "$PROJECT_DIR/scripts/packaging/api-embed.sh" "$OUTPUT_DIR/embedding-api/"
    chmod +x "$OUTPUT_DIR/embedding-api/api-embed.sh"
    echo -e "${GREEN}  Done: api-embed.sh launcher${NC}"
fi

echo -e "${GREEN}  Note: Used by memory engine, UCM, PhD pipeline, universal agent for vector embeddings${NC}"

#===============================================================================
# STEP 8: Tests
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying tests directory (tests/)...${NC}"
if [ -d "$PROJECT_DIR/tests" ]; then
    cp -r "$PROJECT_DIR/tests" "$OUTPUT_DIR/"
    # Remove __pycache__ from copied tests
    find "$OUTPUT_DIR/tests" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    TEST_COUNT=$(find "$OUTPUT_DIR/tests" \( -name "*.ts" -o -name "*.test.ts" -o -name "*.py" \) | wc -l | tr -d ' ')
    echo -e "${GREEN}  Done: $TEST_COUNT test files${NC}"
else
    mkdir -p "$OUTPUT_DIR/tests"
    echo -e "${YELLOW}  Created empty tests directory${NC}"
fi

#===============================================================================
# STEP 9: Documentation (empty structure only)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Creating docs directory (empty)...${NC}"
mkdir -p "$OUTPUT_DIR/docs"
echo -e "${GREEN}  Done: Empty docs directory created (files excluded from package)${NC}"

#===============================================================================
# STEP 10: Project Configuration Files
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying project configuration files...${NC}"
cp "$PROJECT_DIR/package.json" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/tsconfig.json" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/CLAUDE.md" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/vitest.config.ts" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/.gitignore" "$OUTPUT_DIR/" 2>/dev/null || true
cp "$PROJECT_DIR/install.sh" "$OUTPUT_DIR/" 2>/dev/null || true
chmod +x "$OUTPUT_DIR/install.sh" 2>/dev/null || true

# License (LICENSE-archon -> LICENSE in package)
if [ -f "$PROJECT_DIR/LICENSE-archon" ]; then
    cp "$PROJECT_DIR/LICENSE-archon" "$OUTPUT_DIR/LICENSE"
fi

# Assets (avatar image for README)
if [ -d "$PROJECT_DIR/assets" ]; then
    cp -r "$PROJECT_DIR/assets" "$OUTPUT_DIR/"
    echo -e "${GREEN}  Copied assets/ ($(find "$OUTPUT_DIR/assets" -type f | wc -l | tr -d ' ') files)${NC}"
fi

# Create .mcp.json template with 4 project-level servers
# Note: memorygraph is user-level (registered via `claude mcp add`), NOT in .mcp.json
cat > "$OUTPUT_DIR/.mcp.json" << 'MCPEOF'
{
  "mcpServers": {
    "serena": {
      "command": "${PROJECT_DIR}/serena/.venv/bin/serena",
      "args": [
        "start-mcp-server",
        "--project",
        "${PROJECT_DIR}"
      ],
      "type": "stdio",
      "env": {
        "VIRTUAL_ENV": "${PROJECT_DIR}/serena/.venv",
        "PATH": "${PROJECT_DIR}/serena/.venv/bin:${PATH}"
      }
    },
    "leann-search": {
      "command": "npx",
      "args": ["tsx", "src/mcp-servers/leann-search/proxy.ts"],
      "type": "stdio"
    },
    "tool-factory": {
      "command": "${HOME}/.venv/bin/python3",
      "args": ["src/tool_factory/server.py"],
      "type": "stdio"
    },
    "lancedb-memory": {
      "command": "npx",
      "args": ["tsx", "src/mcp-servers/lancedb-memory/server.ts"],
      "type": "stdio"
    },
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "type": "stdio",
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
      }
    },
    "archon-monitor": {
      "command": "${HOME}/.venv/bin/python3",
      "args": ["-m", "src.archon_monitor.server"],
      "type": "stdio"
    },
    "voice-mcp": {
      "command": "${HOME}/.venv/bin/python3",
      "args": ["-m", "src.voice_mcp"],
      "type": "stdio"
    }
  }
}
MCPEOF
echo -e "${GREEN}  Done: package.json, tsconfig.json, CLAUDE.md, vitest.config.ts, .gitignore, .mcp.json${NC}"

#===============================================================================
# STEP 11: Scripts and Hooks
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying scripts and hooks...${NC}"
mkdir -p "$OUTPUT_DIR/scripts/packaging"
mkdir -p "$OUTPUT_DIR/scripts/hooks"

# Copy archon autonomous operation scripts
if [ -d "$PROJECT_DIR/scripts/archon" ]; then
    cp -r "$PROJECT_DIR/scripts/archon" "$OUTPUT_DIR/scripts/"
    echo -e "${GREEN}  - scripts/archon/: Copied (autonomous operation, launchd)${NC}"
fi

# Copy hook scripts
if [ -d "$PROJECT_DIR/scripts/hooks" ]; then
    cp -r "$PROJECT_DIR/scripts/hooks/"* "$OUTPUT_DIR/scripts/hooks/" 2>/dev/null || true
    echo -e "${GREEN}  - scripts/hooks/: Copied${NC}"
fi

# Copy god-agent lifecycle scripts
for script in god-agent-start.sh god-agent-stop.sh god-agent-status.sh; do
    if [ -f "$PROJECT_DIR/scripts/$script" ]; then
        cp "$PROJECT_DIR/scripts/$script" "$OUTPUT_DIR/scripts/"
    fi
done
echo -e "${GREEN}  - god-agent-*.sh: Copied (start/stop/status)${NC}"

# Copy packaging scripts (including this one)
cp "$PROJECT_DIR/scripts/packaging/package-archon.sh" "$OUTPUT_DIR/scripts/packaging/" 2>/dev/null || true
cp "$PROJECT_DIR/scripts/packaging/setup-archon.sh" "$OUTPUT_DIR/scripts/packaging/" 2>/dev/null || true

chmod +x "$OUTPUT_DIR/scripts/packaging/"*.sh 2>/dev/null || true
chmod +x "$OUTPUT_DIR/scripts/hooks/"*.sh 2>/dev/null || true
chmod +x "$OUTPUT_DIR/scripts/archon/"*.sh 2>/dev/null || true
chmod +x "$OUTPUT_DIR/scripts/god-agent-"*.sh 2>/dev/null || true
echo -e "${GREEN}  Done${NC}"

#===============================================================================
# STEP 12: Persistent Memory (personality state template)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying persistent memory template (.persistent-memory/)...${NC}"
if [ -d "$PROJECT_DIR/.persistent-memory" ]; then
    mkdir -p "$OUTPUT_DIR/.persistent-memory"
    # Copy directory structure and .gitignore, but not actual data files
    # (personality state rebuilds from use)
    cp "$PROJECT_DIR/.persistent-memory/.gitignore" "$OUTPUT_DIR/.persistent-memory/" 2>/dev/null || true
    # Copy template/skeleton files if present
    find "$PROJECT_DIR/.persistent-memory" -maxdepth 1 -name "*.template" -exec cp {} "$OUTPUT_DIR/.persistent-memory/" \;
    echo -e "${GREEN}  Done: Directory structure created (data files excluded — rebuilt from use)${NC}"
else
    mkdir -p "$OUTPUT_DIR/.persistent-memory"
    echo -e "${GREEN}  Created empty .persistent-memory/ directory${NC}"
fi

#===============================================================================
# STEP 13: UCM Hook Configuration
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying UCM hook configuration (.ucm/)...${NC}"
if [ -d "$PROJECT_DIR/.ucm" ]; then
    mkdir -p "$OUTPUT_DIR/.ucm"
    cp -r "$PROJECT_DIR/.ucm/"* "$OUTPUT_DIR/.ucm/" 2>/dev/null || true
    echo -e "${GREEN}  Done: .ucm/ included${NC}"
else
    mkdir -p "$OUTPUT_DIR/.ucm"
    echo -e "${GREEN}  Created empty .ucm/ directory${NC}"
fi

#===============================================================================
# STEP 13b: Archon Seed Data (identity, values, behavioral rules)
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Packaging Archon seed data...${NC}"

# First, run the export script to generate fresh seeds from current MemoryGraph
if [ -x "$PROJECT_DIR/scripts/archon/export-seeds.sh" ]; then
    echo "  Running seed export..."
    bash "$PROJECT_DIR/scripts/archon/export-seeds.sh" 2>/dev/null || true
fi

# Copy seeds directory
if [ -d "$PROJECT_DIR/seeds" ]; then
    cp -r "$PROJECT_DIR/seeds" "$OUTPUT_DIR/"
    SEED_COUNT=$(python3 -c "import json; d=json.load(open('$OUTPUT_DIR/seeds/memorygraph-seeds.json')); print(len(d['memories']))" 2>/dev/null || echo "?")
    echo -e "${GREEN}  Done: $SEED_COUNT seed memories + personality.md + first-run prompt${NC}"
    echo -e "${GREEN}  Note: Seeds contain Archon identity and rules ONLY — no user data${NC}"
else
    echo -e "${YELLOW}  No seeds/ directory found — Archon will start without seeded memories${NC}"
fi

# Copy the import script
mkdir -p "$OUTPUT_DIR/scripts/archon"
cp "$PROJECT_DIR/scripts/archon/import-seeds.sh" "$OUTPUT_DIR/scripts/archon/" 2>/dev/null || true
cp "$PROJECT_DIR/scripts/archon/export-seeds.sh" "$OUTPUT_DIR/scripts/archon/" 2>/dev/null || true
chmod +x "$OUTPUT_DIR/scripts/archon/"*.sh 2>/dev/null || true

#===============================================================================
# STEP 14: Runtime Directories
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Creating runtime directories...${NC}"

# Core runtime directories
mkdir -p "$OUTPUT_DIR/.god-agent"
mkdir -p "$OUTPUT_DIR/.run"
mkdir -p "$OUTPUT_DIR/.tool-factory/tools"
mkdir -p "$OUTPUT_DIR/.claude/runtime"
mkdir -p "$OUTPUT_DIR/.claude/agents/traces"
mkdir -p "$OUTPUT_DIR/.claude/agents/versions"
mkdir -p "$OUTPUT_DIR/tmp"
mkdir -p "$OUTPUT_DIR/logs"
mkdir -p "$OUTPUT_DIR/data/chroma"

# .agentdb — core data directory for GraphDB, SoNA, style profiles
# Used by: god-agent core (graph-db, sona-engine, style-profiles, memory-client)
mkdir -p "$OUTPUT_DIR/.agentdb/universal"
mkdir -p "$OUTPUT_DIR/.agentdb/sona/trajectories"
mkdir -p "$OUTPUT_DIR/.agentdb/graphs"

echo -e "${GREEN}  - .god-agent/: Created (SQLite DBs auto-created at runtime)${NC}"
echo -e "${GREEN}  - .agentdb/: Created (GraphDB, SoNA weights, style profiles)${NC}"
echo -e "${GREEN}  - .run/: Created (PID files)${NC}"
echo -e "${GREEN}  - .tool-factory/tools/: Created (dynamic tool sandbox)${NC}"
echo -e "${GREEN}  - .claude/runtime/: Created${NC}"
echo -e "${GREEN}  - .claude/agents/traces/: Created${NC}"
echo -e "${GREEN}  - .claude/agents/versions/: Created${NC}"
echo -e "${GREEN}  - tmp/, logs/: Created${NC}"

#===============================================================================
# STEP 15: Clean Up Artifacts
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Cleaning artifacts...${NC}"
find "$OUTPUT_DIR" -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true
find "$OUTPUT_DIR" -name ".github" -type d -exec rm -rf {} + 2>/dev/null || true
find "$OUTPUT_DIR" -name ".gitignore.backup" -type f -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name "*.orig" -type f -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$OUTPUT_DIR" -name "*.pyc" -type f -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name ".DS_Store" -type f -delete 2>/dev/null || true
echo -e "${GREEN}  Removed: .git/, .github/, __pycache__/, *.pyc, .DS_Store, *.orig${NC}"

#===============================================================================
# STEP 16: README and Final Package
#===============================================================================
STEP=$((STEP + 1))
echo -e "${YELLOW}[$STEP/$TOTAL_STEPS] Copying README and finalizing package...${NC}"

# Copy the Archon README (README-archon.md -> README.md in package)
if [ -f "$PROJECT_DIR/README-archon.md" ]; then
    cp "$PROJECT_DIR/README-archon.md" "$OUTPUT_DIR/README.md"
    echo -e "${GREEN}  Copied README-archon.md -> README.md${NC}"
else
    echo -e "${YELLOW}  WARNING: README-archon.md not found, creating minimal README${NC}"
    cat > "$OUTPUT_DIR/README.md" << 'EOF'
# Archon - Universal Self-Learning AI System

A complete Claude Code enhancement package with dynamic agent creation, semantic memory, consciousness/personality, and self-learning capabilities.

## Quick Start

### 1. Run the setup script

```bash
cd archon-package
chmod +x scripts/packaging/setup-archon.sh
./scripts/packaging/setup-archon.sh
```

This will:
- Install NVM and Node.js 22 (if not present)
- Install Claude Code CLI globally
- Set up Python 3.11+ virtual environment
- Install Serena MCP server (code analysis)
- Install MemoryGraph from fork (graph-based memory)
- Configure all MCP servers and dependencies

### 2. Add to your shell profile

Add these lines to `~/.profile` or `~/.bashrc`:

```bash
# NVM (Node Version Manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
nvm alias default 22 2>/dev/null
```

Then run: `source ~/.profile`

### 3. Start Claude Code

```bash
claude
```

### 4. Test the installation

```
/god-status
/create-agent a general-purpose research assistant
```

## Directory Structure

```
archon/
  src/
    god-agent/                  # Core God Agent (TypeScript)
      core/                     # Memory engine, vector DB, HNSW, reasoning bank, pipeline
      cli/                      # Coding pipeline, PhD pipeline, SDK runner
      hooks/                    # Coding pipeline hook
      observability/            # Dashboard daemon, SSE broadcaster
      orchestration/            # Agent router, context injector
      universal/                # Universal agent, style analyzer, PDF extractor
    archon_consciousness/       # Consciousness + Personality (Python)
    mcp-servers/
      leann-search/             # LEANN semantic code search MCP server
      lancedb-memory/           # LanceDB vector memory MCP server
    agent-system/               # Dynamic agent creation utilities (TypeScript)
    tool_factory/               # Tool Factory MCP server (Python)
    pdf-generator/              # PDF generation (optional)
  .claude/
    settings.json               # Hooks configuration
    settings.local.json         # Permissions + MCP server enables
    hooks/                      # Hook shell scripts (clean, no processed queue files)
    commands/                   # Slash commands
    agents/
      custom/                   # Our custom agent definitions
      .claude/skills/           # 8 skills (create-agent, run-agent, etc.)
    runtime/                    # Created at runtime (gitignored)
    agents/traces/              # Agent execution traces
    agents/versions/            # Agent version history
  scripts/
    archon/                     # Autonomous operation (launchd, runner, drain)
    hooks/                      # Claude Code hook implementations
    god-agent-start.sh          # Start all daemons
    god-agent-stop.sh           # Stop all daemons
    god-agent-status.sh         # Status check
    packaging/                  # Setup + package scripts
  tests/                        # Full test suite
  docs/                         # Documentation (empty in package)
  .persistent-memory/           # Personality state (template)
  .ucm/                         # UCM hook configuration
  .god-agent/                   # Runtime data (DBs auto-created)
  .run/                         # PID files (runtime)
  .tool-factory/tools/          # Dynamic tool sandbox
  tmp/                          # Temporary files
  logs/                         # Log files
```

## MCP Servers

| Server | Purpose | Install |
|--------|---------|---------|
| memorygraph | Graph-based persistent memory (FalkorDB Lite) | Setup script clones fork, registers user-level |
| serena | Symbol-level code navigation + semantic editing | Setup script installs via uv |
| leann-search | Semantic code search (HNSW vector index) | Bundled in src/mcp-servers/ |
| tool-factory | Dynamic tool creation (FastMCP, sandbox) | Bundled in src/tool_factory/ |
| perplexity | Web search for research + learning agents | Requires PERPLEXITY_API_KEY |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/create-agent` | Create a custom agent from natural language description |
| `/run-agent` | Invoke a custom agent with a task |
| `/adjust-behavior` | Adjust behavioral rules for an agent |
| `/evolve-agent` | Review + apply evolution suggestions |
| `/god-code` | Generate code with 48-agent coding pipeline |
| `/god-research` | Deep research with PhD pipeline (45 agents) |
| `/god-status` | Show system status and learning statistics |
| `/god-ask` | Ask anything with intelligent agent selection |
| `/god-write` | Generate documents with agent selection |
| `/god-feedback` | Provide feedback for trajectory improvement |

## Requirements

- Node.js 22+ (via NVM)
- Python 3.11+
- ~2GB disk space
- Git, curl or wget

## Troubleshooting

### Node.js not found
```bash
source ~/.nvm/nvm.sh && nvm use 22
```

### MemoryGraph not connecting
```bash
claude mcp list | grep memorygraph
~/.memorygraph-venv/run.sh --profile extended --backend falkordblite
```

### Serena not starting
```bash
source serena/.venv/bin/activate
serena start-mcp-server --project $(pwd)
```

### MCP servers not registered
```bash
claude mcp list
# Project-level servers are in .mcp.json
# memorygraph is user-level: claude mcp add memorygraph -- ~/.memorygraph-venv/run.sh --profile extended --backend falkordblite
```

### Verify installation
```bash
node --version          # Should be v22.x.x
claude --version        # Should show Claude Code version
claude mcp list         # Should show memorygraph + project servers
```

## License

See individual component licenses.
EOF
fi

# Calculate sizes
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
echo -e "${GREEN}  Package created: $TOTAL_SIZE${NC}"

# Create tarball if requested
if [ "$CREATE_TARBALL" = true ]; then
    echo ""
    echo -e "${YELLOW}Creating tarball archive...${NC}"
    TARBALL_NAME="archon-v${VERSION}.tar.gz"
    cd "$(dirname "$OUTPUT_DIR")"
    tar --exclude='node_modules' \
        --exclude='.git' \
        --exclude='.github' \
        --exclude='dist' \
        --exclude='coverage' \
        --exclude='*.log' \
        -czvf "$TARBALL_NAME" "$(basename "$OUTPUT_DIR")"
    TARBALL_SIZE=$(du -sh "$TARBALL_NAME" | cut -f1)
    echo -e "${GREEN}  Tarball created: $TARBALL_NAME ($TARBALL_SIZE)${NC}"
    cd "$PROJECT_DIR"
fi

# Summary
echo ""
echo -e "${BLUE}=================================================================="
echo "                    Packaging Complete!"
echo "==================================================================${NC}"
echo ""
echo "Package location: $OUTPUT_DIR"
echo "Total size: $TOTAL_SIZE"
echo ""
echo "Directory Structure Created:"
echo "  - src/god-agent/           : God Agent core (TypeScript)"
echo "  - src/archon_consciousness/: Consciousness + Personality (Python)"
echo "  - src/workspace/           : Multi-project awareness + git-aware memory"
echo "  - src/archon_monitor/      : Monitor daemon + notification dispatch"
echo "  - src/voice_mcp/           : Voice I/O MCP server (STT + TTS)"
echo "  - src/mcp-servers/         : LEANN search + LanceDB memory"
echo "  - src/agent-system/        : Dynamic agent creation utilities"
echo "  - src/tool_factory/        : Tool Factory MCP server (Python)"
echo "  - src/pdf-generator/       : PDF generation (optional)"
echo "  - scripts/benchmark/       : Self-benchmark suite (EWMA regression)"
echo "  - scripts/git-hooks/       : Git hooks (post-checkout, post-merge)"
echo "  - .claude/                 : Settings, hooks, skills, commands"
echo "  - .claude/agents/custom/   : Custom agent definitions"
echo "  - tests/                   : Test suite (469+ tests)"
echo "  - docs/                    : Documentation (empty)"
echo "  - scripts/archon/          : Autonomous operation scripts"
echo "  - scripts/hooks/           : Hook implementations"
echo "  - scripts/packaging/       : Setup + package scripts + launchd plists"
echo "  - .persistent-memory/      : Personality state template"
echo "  - .ucm/                    : UCM hook configuration"
echo "  - .god-agent/              : Runtime data (auto-created)"
echo "  - .run/                    : PID files (runtime)"
echo "  - .tool-factory/tools/     : Dynamic tool sandbox"
echo "  - .claude/runtime/         : Runtime state"
echo "  - .claude/agents/traces/   : Agent execution traces"
echo "  - .claude/agents/versions/ : Agent version history"
echo "  - tmp/, logs/              : Runtime directories"
echo ""
echo "To deploy:"
echo "  1. Copy package to target machine"
echo "  2. Run: ./scripts/packaging/setup-archon.sh"
echo "  3. Run: claude"
echo ""
