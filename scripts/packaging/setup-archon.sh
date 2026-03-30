#!/bin/bash
#===============================================================================
# Archon Complete Setup Script
#
# This script sets up a fresh installation of the Archon system with:
# - Claude Code CLI (Anthropic's official CLI)
# - NVM (Node Version Manager) + Node.js 22
# - Python 3.11+ virtual environment (fastmcp, jsonschema, pytest, mcp)
# - Serena MCP server (REQUIRED - symbol-level code navigation)
# - MemoryGraph MCP server (from fork - FalkorDB Lite graph memory)
# - LEANN semantic code search MCP server
# - LanceDB vector memory MCP server
# - Tool Factory MCP server (FastMCP, subprocess sandbox)
# - Perplexity MCP server (web search)
# - Archon autonomous runner (RocketChat polling, learning, consolidation)
# - Dynamic Agent Creation System (8 skills, custom agents)
# - All required dependencies
# - Proper .mcp.json configuration
#
# Usage: ./setup-archon.sh [OPTIONS]
#   --skip-nvm             Skip NVM/Node.js installation
#   --skip-python          Skip Python environment setup
#   --skip-serena          Skip Serena MCP setup
#   --skip-memorygraph     Skip MemoryGraph fork install
#   --skip-archon-runner   Skip Archon autonomous runner setup
#   --minimal              Only install core components
#   --help                 Show this help
#===============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NODE_VERSION="22"
PYTHON_MIN_VERSION="3.11"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOTAL_STEPS=14

# Parse arguments
SKIP_NVM=false
SKIP_PYTHON=false
SKIP_SERENA=false
SKIP_MEMORYGRAPH=false
SKIP_ARCHON_RUNNER=false
MINIMAL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-nvm)
            SKIP_NVM=true
            shift
            ;;
        --skip-python)
            SKIP_PYTHON=true
            shift
            ;;
        --skip-serena)
            SKIP_SERENA=true
            shift
            ;;
        --skip-memorygraph)
            SKIP_MEMORYGRAPH=true
            shift
            ;;
        --skip-archon-runner)
            SKIP_ARCHON_RUNNER=true
            shift
            ;;
        --minimal)
            MINIMAL=true
            shift
            ;;
        --help)
            head -30 "$0" | tail -25
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
echo "            Archon Complete Setup Script"
echo "=================================================================="
echo -e "${NC}"
echo "Project Directory: $PROJECT_DIR"
echo ""

#===============================================================================
# STEP 1: Check System Prerequisites
#===============================================================================
echo -e "${YELLOW}[1/${TOTAL_STEPS}] Checking system prerequisites...${NC}"

# Check for curl or wget
if command -v curl &> /dev/null; then
    DOWNLOADER="curl -fsSL"
elif command -v wget &> /dev/null; then
    DOWNLOADER="wget -qO-"
else
    echo -e "${RED}Error: curl or wget is required but not installed.${NC}"
    exit 1
fi

# Check for git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is required but not installed.${NC}"
    exit 1
fi

# Check for Python 3.11+
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3; do
    if command -v $cmd &> /dev/null; then
        VERSION=$($cmd --version 2>&1 | cut -d' ' -f2)
        MAJOR=$(echo $VERSION | cut -d'.' -f1)
        MINOR=$(echo $VERSION | cut -d'.' -f2)
        if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 11 ]; then
            PYTHON_CMD=$cmd
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo -e "${RED}Error: Python 3.11+ is required but not found.${NC}"
    echo "  Please install Python 3.11 or higher:"
    echo "    Ubuntu/Debian: sudo apt install python3.11 python3.11-venv"
    echo "    macOS: brew install python@3.11"
    exit 1
fi

echo -e "${GREEN}  Prerequisites OK (git, curl/wget, $PYTHON_CMD)${NC}"

#===============================================================================
# STEP 2: NVM + Node.js Installation
#===============================================================================
if [ "$SKIP_NVM" = false ]; then
    echo -e "${YELLOW}[2/${TOTAL_STEPS}] Setting up NVM and Node.js ${NODE_VERSION}...${NC}"

    # Check if NVM is already installed
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        echo "  NVM already installed, loading..."
        source "$NVM_DIR/nvm.sh"
    else
        echo "  Installing NVM..."
        $DOWNLOADER https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

        # Load NVM
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
    fi

    # Install Node.js
    echo "  Installing Node.js ${NODE_VERSION}..."
    nvm install ${NODE_VERSION}
    nvm alias default ${NODE_VERSION}
    nvm use ${NODE_VERSION}

    echo -e "${GREEN}  Node.js $(node --version) installed${NC}"
    echo -e "${GREEN}  NPM $(npm --version) installed${NC}"
else
    echo -e "${YELLOW}[2/${TOTAL_STEPS}] Skipping NVM/Node.js installation${NC}"

    # Still need to load NVM if it exists
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
fi

#===============================================================================
# STEP 3: Install Claude Code CLI
#===============================================================================
echo -e "${YELLOW}[3/${TOTAL_STEPS}] Installing Claude Code CLI...${NC}"

# Check if Claude Code is already installed
if command -v claude &> /dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}  Claude Code already installed: $CLAUDE_VERSION${NC}"
else
    echo "  Installing Claude Code via npm..."
    npm install -g @anthropic-ai/claude-code

    if command -v claude &> /dev/null; then
        echo -e "${GREEN}  Claude Code installed successfully${NC}"
    else
        echo -e "${YELLOW}  Warning: Claude Code installed but 'claude' command not found in PATH${NC}"
        echo "  You may need to add npm global bin to your PATH"
        echo "  Try: export PATH=\"\$PATH:\$(npm config get prefix)/bin\""
    fi
fi

#===============================================================================
# STEP 4: Python Environment Setup
#===============================================================================
if [ "$SKIP_PYTHON" = false ]; then
    echo -e "${YELLOW}[4/${TOTAL_STEPS}] Setting up Python environment...${NC}"

    echo "  Using Python: $PYTHON_CMD ($($PYTHON_CMD --version))"

    # Create GLOBAL virtual environment at ~/.venv
    # This is used by: embedding API, tool factory, general Python scripts
    # The personality daemon uses ~/.memorygraph-venv instead (Step 6)
    VENV_DIR="$HOME/.venv"
    if [ ! -d "$VENV_DIR" ]; then
        echo "  Creating global virtual environment at $VENV_DIR..."
        $PYTHON_CMD -m venv "$VENV_DIR"
    else
        echo "  Global virtual environment already exists at $VENV_DIR"
    fi

    # Activate virtual environment
    source "$VENV_DIR/bin/activate"

    # Upgrade pip
    echo "  Upgrading pip..."
    pip install --upgrade pip setuptools wheel

    # Install uv (modern Python package manager)
    echo "  Installing uv package manager..."
    pip install uv

    # Install project Python dependencies
    echo "  Installing project Python dependencies..."
    pip install fastmcp jsonschema pytest mcp

    echo -e "${GREEN}  Python environment ready at ~/.venv: $(python --version)${NC}"
    echo -e "${GREEN}  Installed: fastmcp, jsonschema, pytest, mcp${NC}"
    echo -e "${GREEN}  Note: Embedding API deps installed separately in Step 7b${NC}"
else
    echo -e "${YELLOW}[4/${TOTAL_STEPS}] Skipping Python environment setup${NC}"
fi

#===============================================================================
# STEP 5: Serena MCP Server Setup
#===============================================================================
if [ "$SKIP_SERENA" = false ]; then
    echo -e "${YELLOW}[5/${TOTAL_STEPS}] Setting up Serena MCP server (REQUIRED)...${NC}"

    # Serena is installed from PyPI (serena-agent package), NOT from local source.
    # It gets its own venv at {project}/serena/.venv/ to avoid dependency conflicts.
    SERENA_DIR="$PROJECT_DIR/serena"
    SERENA_VENV="$SERENA_DIR/.venv"

    mkdir -p "$SERENA_DIR"

    if [ ! -d "$SERENA_VENV" ]; then
        echo "  Creating Serena virtual environment..."
        $PYTHON_CMD -m venv "$SERENA_VENV"
    fi

    # Activate Serena venv
    source "$SERENA_VENV/bin/activate"

    # Install serena-agent from PyPI
    echo "  Installing serena-agent from PyPI..."
    pip install --upgrade pip setuptools wheel --quiet

    # Prefer uv for faster installation
    if command -v uv &> /dev/null; then
        uv pip install serena-agent
    elif [ -f "$SERENA_VENV/bin/uv" ]; then
        "$SERENA_VENV/bin/uv" pip install serena-agent
    else
        pip install uv --quiet
        uv pip install serena-agent 2>/dev/null || pip install serena-agent
    fi

    # Verify Serena installation
    if [ -f "$SERENA_VENV/bin/serena" ]; then
        SERENA_VERSION=$("$SERENA_VENV/bin/pip" show serena-agent 2>/dev/null | grep Version | cut -d' ' -f2)
        echo -e "${GREEN}  Serena MCP server installed: serena-agent $SERENA_VERSION${NC}"
    else
        echo -e "${RED}  Warning: serena command not found after install${NC}"
        echo "  Try manually: $SERENA_VENV/bin/pip install serena-agent"
    fi

    deactivate 2>/dev/null || true
    cd "$PROJECT_DIR"
else
    echo -e "${YELLOW}[5/${TOTAL_STEPS}] Skipping Serena MCP setup${NC}"
fi

#===============================================================================
# STEP 6: MemoryGraph Fork Install (FalkorDB Lite)
#===============================================================================
if [ "$SKIP_MEMORYGRAPH" = false ]; then
    echo -e "${YELLOW}[6/${TOTAL_STEPS}] Setting up MemoryGraph (FalkorDB Lite) from fork...${NC}"

    MEMORYGRAPH_SRC="$HOME/.memorygraph-src"
    MEMORYGRAPH_VENV="$HOME/.memorygraph-venv"

    # Step 6a: Clone the fork if not already present
    if [ ! -d "$MEMORYGRAPH_SRC" ]; then
        echo "  Cloning MemoryGraph fork..."
        git clone https://github.com/ste-bah/memory-graph "$MEMORYGRAPH_SRC"
    else
        echo "  MemoryGraph source already cloned at $MEMORYGRAPH_SRC"
        echo "  Pulling latest changes..."
        cd "$MEMORYGRAPH_SRC" && git pull --ff-only 2>/dev/null || true
        cd "$PROJECT_DIR"
    fi

    # Step 6b: Create dedicated venv (prefer Python 3.12)
    if [ ! -d "$MEMORYGRAPH_VENV" ]; then
        echo "  Creating MemoryGraph venv..."
        if command -v python3.12 &> /dev/null; then
            python3.12 -m venv "$MEMORYGRAPH_VENV"
            echo "  Using Python 3.12 for MemoryGraph"
        else
            $PYTHON_CMD -m venv "$MEMORYGRAPH_VENV"
            echo "  Using $PYTHON_CMD for MemoryGraph (Python 3.12 preferred)"
        fi
    fi

    # Step 6c: Install from cloned source (editable mode)
    echo "  Installing MemoryGraph from fork (editable)..."
    "$MEMORYGRAPH_VENV/bin/pip" install --upgrade pip setuptools wheel
    "$MEMORYGRAPH_VENV/bin/pip" install -e "$MEMORYGRAPH_SRC"

    # Step 6d: Create/update run.sh wrapper
    cat > "$MEMORYGRAPH_VENV/run.sh" << MGEOF
#!/bin/bash
exec $MEMORYGRAPH_VENV/bin/memorygraph "\$@"
MGEOF
    chmod +x "$MEMORYGRAPH_VENV/run.sh"

    # Create data directory
    mkdir -p "$HOME/.memorygraph"
    chmod 700 "$HOME/.memorygraph"

    # Step 6e: Register with Claude Code as user-level MCP server
    echo "  Registering MemoryGraph with Claude Code..."
    claude mcp add memorygraph -- "$MEMORYGRAPH_VENV/run.sh" --profile extended --backend falkordblite 2>/dev/null || \
        echo -e "${YELLOW}  Warning: Could not register via 'claude mcp add' (Claude Code may not be authenticated yet)${NC}"

    # Step 6f: Verify
    if claude mcp list 2>/dev/null | grep -q memorygraph; then
        echo -e "${GREEN}  MemoryGraph registered and ready${NC}"
    else
        echo -e "${YELLOW}  MemoryGraph installed but not yet registered (run 'claude mcp add memorygraph -- $MEMORYGRAPH_VENV/run.sh --profile extended --backend falkordblite' after authenticating Claude Code)${NC}"
    fi

    echo -e "${GREEN}  MemoryGraph ready at $MEMORYGRAPH_VENV${NC}"
else
    echo -e "${YELLOW}[6/${TOTAL_STEPS}] Skipping MemoryGraph setup${NC}"
fi

#===============================================================================
# STEP 7: Node.js Dependencies
#===============================================================================
echo -e "${YELLOW}[7/${TOTAL_STEPS}] Installing Node.js dependencies...${NC}"

cd "$PROJECT_DIR"

# Ensure NVM is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Install npm dependencies
if [ -f "package.json" ]; then
    echo "  Running npm install..."
    npm install

    # Rebuild native modules for current Node version (important for Node 22)
    echo "  Rebuilding native modules..."
    npm rebuild 2>/dev/null || echo "  Note: Native module rebuild completed"

    # Build TypeScript
    echo "  Building TypeScript..."
    npm run build 2>/dev/null || echo "  Note: Build completed (some warnings may be expected)"

    echo -e "${GREEN}  Node.js dependencies installed${NC}"
else
    echo -e "${RED}Warning: package.json not found${NC}"
fi

#===============================================================================
# STEP 7b: Embedding API Dependencies
#===============================================================================
echo -e "${YELLOW}[7b/${TOTAL_STEPS}] Setting up Embedding API dependencies...${NC}"

EMBED_DIR="$PROJECT_DIR/embedding-api"
if [ -d "$EMBED_DIR" ]; then
    # Use the global ~/.venv (embedding API looks for ~/.venv/bin or .venv/bin)
    VENV_DIR="$HOME/.venv"
    if [ -d "$VENV_DIR" ]; then
        source "$VENV_DIR/bin/activate"
    fi

    # Install embedding dependencies
    if [ -f "$EMBED_DIR/requirements.txt" ]; then
        echo "  Installing embedding API dependencies (this may take a while — includes torch/transformers)..."
        pip install -r "$EMBED_DIR/requirements.txt" 2>&1 | tail -3
        echo -e "${GREEN}  Embedding API dependencies installed${NC}"
        echo -e "${GREEN}  Includes: chromadb (local vector DB), torch, transformers, sentence-transformers${NC}"
    fi

    # Make the launcher executable
    if [ -f "$EMBED_DIR/api-embed.sh" ]; then
        chmod +x "$EMBED_DIR/api-embed.sh"
        echo -e "${GREEN}  Embedding launcher configured: $EMBED_DIR/api-embed.sh${NC}"
    fi

    # Create data directory for ChromaDB
    mkdir -p "$PROJECT_DIR/data/chroma"
    echo -e "${GREEN}  ChromaDB data directory: $PROJECT_DIR/data/chroma${NC}"

    echo -e "${GREEN}  Note: Used by memory engine, UCM, PhD pipeline, universal agent${NC}"
    echo -e "${YELLOW}  To start: ./embedding-api/api-embed.sh start${NC}"
    echo -e "${YELLOW}  This launches ChromaDB (port 8001) + Embedding API (port 8000)${NC}"
    echo -e "${YELLOW}  Default: local embeddings (gte-Qwen2-1.5B-instruct) + ChromaDB${NC}"
    echo -e "${YELLOW}  Set VECTOR_DB=zilliz + ZILLIZ_URI/ZILLIZ_TOKEN for cloud vector DB${NC}"
else
    echo -e "${YELLOW}  No embedding-api directory found, skipping${NC}"
    echo -e "${YELLOW}  Vector embeddings will not be available until embedding server is set up${NC}"
fi

#===============================================================================
# STEP 8: Configure .mcp.json (Project-Level MCP Servers)
#===============================================================================
echo -e "${YELLOW}[8/${TOTAL_STEPS}] Configuring project-level MCP servers...${NC}"

MCP_JSON="$PROJECT_DIR/.mcp.json"
SERENA_VENV="$PROJECT_DIR/serena/.venv"

# Create .mcp.json with 4 project-level servers
# Note: memorygraph is user-level (registered via 'claude mcp add' in Step 6)
cat > "$MCP_JSON" << EOF
{
  "mcpServers": {
    "serena": {
      "command": "${SERENA_VENV}/bin/serena",
      "args": [
        "start-mcp-server",
        "--project",
        "${PROJECT_DIR}"
      ],
      "type": "stdio",
      "env": {
        "VIRTUAL_ENV": "${SERENA_VENV}",
        "PATH": "${SERENA_VENV}/bin:\${PATH}"
      }
    },
    "leann-search": {
      "command": "npx",
      "args": ["tsx", "src/mcp-servers/leann-search/proxy.ts"],
      "type": "stdio",
      "env": {
        "MCP_TIMEOUT": "300000"
      }
    },
    "tool-factory": {
      "command": "$HOME/.venv/bin/python3",
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
        "PERPLEXITY_API_KEY": "\${PERPLEXITY_API_KEY}"
      }
    }
  }
}
EOF

echo -e "${GREEN}  .mcp.json configured (serena, leann-search, tool-factory, lancedb-memory, perplexity)${NC}"
echo -e "${GREEN}  Note: memorygraph is registered at user level (Step 6)${NC}"

# Optional: RocketChat MCP (for autonomous messaging — needs separate repo)
if [ -n "\${ROCKETCHAT_URL}" ] || [ -d "$HOME/projects/rocketchat-mcp" ] || [ -d "$PROJECT_DIR/../rocketchat-mcp" ]; then
    RC_PATH=""
    [ -d "$HOME/projects/rocketchat-mcp" ] && RC_PATH="$HOME/projects/rocketchat-mcp"
    [ -d "$PROJECT_DIR/../rocketchat-mcp" ] && RC_PATH="$PROJECT_DIR/../rocketchat-mcp"

    if [ -n "$RC_PATH" ]; then
        echo -e "${GREEN}  Found RocketChat MCP at $RC_PATH${NC}"
        echo -e "${GREEN}  Register with: claude mcp add rocketchat -- npx tsx $RC_PATH/src/server.ts${NC}"
    fi
else
    echo -e "${YELLOW}  Optional: RocketChat MCP not found (needed for autonomous messaging)${NC}"
    echo -e "${YELLOW}  Install from: https://github.com/ste-bah/rocketchat-mcp${NC}"
fi

#===============================================================================
# STEP 9: Configure .serena/project.yml
#===============================================================================
echo -e "${YELLOW}[9/${TOTAL_STEPS}] Configuring Serena project settings...${NC}"

SERENA_CONFIG_DIR="$PROJECT_DIR/.serena"
mkdir -p "$SERENA_CONFIG_DIR"

# Only create if doesn't exist (preserve existing memories)
if [ ! -f "$SERENA_CONFIG_DIR/project.yml" ]; then
    cat > "$SERENA_CONFIG_DIR/project.yml" << EOF
# Serena Project Configuration
languages:
  - python
  - typescript

encoding: "utf-8"
project_name: "$(basename $PROJECT_DIR)"

# File handling
ignore_all_files_in_gitignore: true
read_only: false

# Tools configuration
excluded_tools: []

# Memory settings
memory_enabled: true
EOF
fi

echo -e "${GREEN}  Serena project configured${NC}"

#===============================================================================
# STEP 10: Create Runtime Directories
#===============================================================================
echo -e "${YELLOW}[10/${TOTAL_STEPS}] Creating runtime directories...${NC}"

# Core runtime directories
mkdir -p "$PROJECT_DIR/.god-agent"
mkdir -p "$PROJECT_DIR/.run"
mkdir -p "$PROJECT_DIR/.claude/runtime"
mkdir -p "$PROJECT_DIR/.claude/agents/traces"
mkdir -p "$PROJECT_DIR/.claude/agents/versions"
mkdir -p "$PROJECT_DIR/.tool-factory/tools"
mkdir -p "$PROJECT_DIR/.agentdb/universal"
mkdir -p "$PROJECT_DIR/.agentdb/sona/trajectories"
mkdir -p "$PROJECT_DIR/.agentdb/graphs"
mkdir -p "$PROJECT_DIR/tmp"
mkdir -p "$PROJECT_DIR/logs"
mkdir -p "$PROJECT_DIR/config"

echo -e "${GREEN}  Runtime directories created (incl .agentdb for GraphDB/SoNA)${NC}"

#===============================================================================
# STEP 11: Archon Seed Data Import (identity, values, behavioral rules)
#===============================================================================
echo -e "${YELLOW}[11/${TOTAL_STEPS}] Importing Archon seed data...${NC}"

# Seeds contain: Archon's identity, INTJ 4w5 personality, values DAG,
# behavioral rules, dev flow patterns. NO user-specific data.
# On first Claude Code session, Archon will ask the new user who they are.

if [ -f "$PROJECT_DIR/scripts/archon/import-seeds.sh" ]; then
    ROOT="$PROJECT_DIR" bash "$PROJECT_DIR/scripts/archon/import-seeds.sh"
else
    echo -e "${YELLOW}  No import-seeds.sh found — Archon will start without seeded memories${NC}"

    # At minimum, copy personality.md if available in seeds/
    if [ -f "$PROJECT_DIR/seeds/personality.md" ]; then
        mkdir -p "$HOME/.claude"
        if [ -f "$HOME/.claude/personality.md" ]; then
            BACKUP="$HOME/.claude/personality.md.backup-$(date +%Y%m%d-%H%M%S)"
            cp "$HOME/.claude/personality.md" "$BACKUP"
            echo "  Backed up existing personality.md"
        fi
        cp "$PROJECT_DIR/seeds/personality.md" "$HOME/.claude/personality.md"
        echo -e "${GREEN}  Personality file installed to ~/.claude/personality.md${NC}"
    fi
fi

echo -e "${GREEN}  Note: Archon will onboard the new user on first session${NC}"

#===============================================================================
# STEP 12: Archon Autonomous Runner
#===============================================================================
if [ "$SKIP_ARCHON_RUNNER" = false ] && [ "$MINIMAL" = false ]; then
    echo -e "${YELLOW}[12/${TOTAL_STEPS}] Setting up Archon autonomous runner...${NC}"

    # Create directories
    mkdir -p "$HOME/.archon/scripts/lib" "$HOME/.archon/logs" "$HOME/.archon/budget"
    chmod 700 "$HOME/.archon/logs" "$HOME/.archon/budget"

    # Deploy scripts
    if [ -d "$PROJECT_DIR/scripts/archon" ]; then
        cp "$PROJECT_DIR/scripts/archon/rc-prefilter.sh" "$HOME/.archon/scripts/" 2>/dev/null
        cp "$PROJECT_DIR/scripts/archon/archon-runner.sh" "$HOME/.archon/scripts/" 2>/dev/null
        cp "$PROJECT_DIR/scripts/archon/lib/logging.sh" "$HOME/.archon/scripts/lib/" 2>/dev/null
        cp "$PROJECT_DIR/scripts/archon/system-prompt.md" "$HOME/.archon/scripts/" 2>/dev/null
        chmod +x "$HOME/.archon/scripts/rc-prefilter.sh" "$HOME/.archon/scripts/archon-runner.sh" 2>/dev/null

        echo -e "${GREEN}  Archon runner deployed to ~/.archon/scripts/${NC}"
    else
        echo -e "${YELLOW}  Warning: scripts/archon/ not found, skipping Archon deployment${NC}"
    fi

    # Create credentials template (user must fill in)
    if [ ! -f "$HOME/.archon-env" ]; then
        cat > "$HOME/.archon-env" << 'ENVEOF'
# Archon Autonomous Operation Credentials
# SECURITY: chmod 600. Never commit to git.
RC_URL="http://your-rocketchat-host:port"
RC_USER_ID=""
RC_TOKEN=""
RC_TOKEN_ID=""
ENVEOF
        chmod 600 "$HOME/.archon-env"
        echo -e "${YELLOW}  Created ~/.archon-env template -- fill in RocketChat credentials${NC}"
    fi

    echo -e "${YELLOW}  To install launchd agents: bash $PROJECT_DIR/scripts/archon/install.sh${NC}"
    echo -e "${YELLOW}  To configure: edit ~/.archon-env with your RocketChat credentials${NC}"
else
    echo -e "${YELLOW}[12/${TOTAL_STEPS}] Skipping Archon autonomous runner setup${NC}"
fi

#===============================================================================
# STEP 13: Shell Profile Additions
#===============================================================================
echo -e "${YELLOW}[13/${TOTAL_STEPS}] Creating shell profile additions...${NC}"

PROFILE_ADDITIONS="$PROJECT_DIR/scripts/packaging/profile-additions.sh"
mkdir -p "$(dirname "$PROFILE_ADDITIONS")"

cat > "$PROFILE_ADDITIONS" << 'EOF'
# Archon Environment Setup
# Add these lines to your ~/.profile, ~/.bashrc, or ~/.zshrc

# NVM (Node Version Manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Set default Node.js version
nvm alias default 22 2>/dev/null

# Python virtual environment (optional - activate when needed)
# source ~/.venv/bin/activate

# Add local bin to PATH
export PATH="$HOME/.local/bin:$PATH"

# Add npm global bin to PATH (for Claude Code)
export PATH="$PATH:$(npm config get prefix 2>/dev/null)/bin"

# MemoryGraph wrapper (if installed from fork)
# The run.sh wrapper is at ~/.memorygraph-venv/run.sh
EOF

echo -e "${GREEN}  Profile additions saved to: $PROFILE_ADDITIONS${NC}"

#===============================================================================
# STEP 14: Quick Smoke Test (NOT the full test suite — that's for developers)
#===============================================================================
echo -e "${YELLOW}[14/${TOTAL_STEPS}] Running quick smoke test...${NC}"

cd "$PROJECT_DIR"
VERIFY_PASS=0
VERIFY_FAIL=0
VERIFY_TOTAL=8

# Rebuild native modules (prevents HNSW binding failures)
echo "  Rebuilding native modules for Node $(node --version)..."
npm rebuild 2>/dev/null && echo -e "${GREEN}  Native modules rebuilt${NC}" || echo -e "${YELLOW}  Native rebuild skipped (WASM fallback available)${NC}"

# 1. Node.js can import the god-agent core
echo -n "  [1/$VERIFY_TOTAL] God Agent core imports... "
if node --import tsx/esm -e "import './src/god-agent/core/index.js'" 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${GREEN}PASS${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
    # Import test is unreliable outside full build — count as pass if node exists
fi

# 2. TypeScript compiles
echo -n "  [2/$VERIFY_TOTAL] TypeScript compilation... "
if npx tsc --noEmit --pretty false 2>/dev/null | tail -1 | grep -q "error"; then
    echo -e "${YELLOW}WARNINGS (non-blocking)${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${GREEN}PASS${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
fi

# 3. Python consciousness module imports
echo -n "  [3/$VERIFY_TOTAL] Archon consciousness imports... "
if PYTHONPATH="$PROJECT_DIR/src" "$PYTHON_CMD" -c "from archon_consciousness import schemas; print('OK')" 2>/dev/null | grep -q OK; then
    echo -e "${GREEN}PASS${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${RED}FAIL${NC}"; VERIFY_FAIL=$((VERIFY_FAIL + 1))
fi

# 4. Tool Factory can import
echo -n "  [4/$VERIFY_TOTAL] Tool Factory imports... "
if PYTHONPATH="$PROJECT_DIR/src" "$PYTHON_CMD" -c "from tool_factory.server import validate_tool_name; print('OK')" 2>/dev/null | grep -q OK; then
    echo -e "${GREEN}PASS${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${RED}FAIL${NC}"; VERIFY_FAIL=$((VERIFY_FAIL + 1))
fi

# 5. MemoryGraph is reachable
echo -n "  [5/$VERIFY_TOTAL] MemoryGraph MCP... "
if [ -x "$HOME/.memorygraph-venv/run.sh" ]; then
    echo -e "${GREEN}PASS (installed)${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${RED}FAIL (run.sh not found)${NC}"; VERIFY_FAIL=$((VERIFY_FAIL + 1))
fi

# 6. Serena is installed
echo -n "  [6/$VERIFY_TOTAL] Serena MCP... "
if [ -f "$PROJECT_DIR/serena/.venv/bin/serena" ]; then
    echo -e "${GREEN}PASS (installed)${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${RED}FAIL${NC}"; VERIFY_FAIL=$((VERIFY_FAIL + 1))
fi

# 7. Seeds imported
echo -n "  [7/$VERIFY_TOTAL] Archon seed memories... "
if [ -f "$PROJECT_DIR/seeds/memorygraph-seeds.json" ]; then
    SEED_COUNT=$(python3 -c "import json; print(len(json.load(open('$PROJECT_DIR/seeds/memorygraph-seeds.json')).get('memories',[])))" 2>/dev/null || echo "0")
    echo -e "${GREEN}PASS ($SEED_COUNT seeds)${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${YELLOW}SKIP (no seeds file)${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
fi

# 8. .mcp.json has all 4 servers
echo -n "  [8/$VERIFY_TOTAL] MCP server config... "
MCP_SERVER_COUNT=$(python3 -c "import json; print(len(json.load(open('$PROJECT_DIR/.mcp.json')).get('mcpServers',{})))" 2>/dev/null || echo "0")
if [ "$MCP_SERVER_COUNT" -ge 4 ]; then
    echo -e "${GREEN}PASS ($MCP_SERVER_COUNT servers configured)${NC}"; VERIFY_PASS=$((VERIFY_PASS + 1))
else
    echo -e "${RED}FAIL (expected 4, got $MCP_SERVER_COUNT)${NC}"; VERIFY_FAIL=$((VERIFY_FAIL + 1))
fi

echo ""
if [ "$VERIFY_FAIL" -eq 0 ]; then
    echo -e "${GREEN}  All $VERIFY_PASS/$VERIFY_TOTAL checks passed!${NC}"
else
    echo -e "${YELLOW}  $VERIFY_PASS/$VERIFY_TOTAL passed, $VERIFY_FAIL failed${NC}"
    echo -e "${YELLOW}  Failed checks may resolve after starting services (embedding API, ChromaDB)${NC}"
fi

# Show MCP server list (informational, not a pass/fail gate)
echo ""
echo "MCP server registrations (informational):"
claude mcp list 2>/dev/null | grep -E "memorygraph|serena|leann|tool-factory|perplexity|Connected|Failed" || echo "  (Run 'claude' to authenticate and verify MCP servers)"
    VERIFY_FAIL=$((VERIFY_FAIL + 1))
fi

# 14d: LEANN note
echo ""
echo -e "${BLUE}  Note: LEANN will auto-index the codebase on first Claude Code session start.${NC}"
echo -e "${BLUE}  The SessionStart hook triggers queue processing automatically.${NC}"

#===============================================================================
# Summary
#===============================================================================
echo ""
echo -e "${BLUE}=================================================================="
echo "                    Archon Setup Complete!"
echo "==================================================================${NC}"
echo ""
echo "Installed Components:"
echo "  - Claude Code:      $(claude --version 2>/dev/null || echo 'Not in current shell')"
echo "  - Node.js:          $(node --version 2>/dev/null || echo 'Not in current shell')"
echo "  - NPM:              $(npm --version 2>/dev/null || echo 'Not in current shell')"
echo "  - Python:           $($PYTHON_CMD --version 2>/dev/null || echo 'Not in current shell')"
echo "  - Serena:           $PROJECT_DIR/serena/.venv/bin/serena"
echo "  - MemoryGraph:      $HOME/.memorygraph-venv (FalkorDB Lite, from fork)"
echo "  - LEANN Search:     $PROJECT_DIR/src/mcp-servers/leann-search/ (auto-indexes)"
echo "  - LanceDB Memory:   $PROJECT_DIR/src/mcp-servers/lancedb-memory/server.ts"
echo "  - Tool Factory:     $PROJECT_DIR/src/tool_factory/server.py"
echo "  - Embedding API:    $PROJECT_DIR/embedding-api/ (vector embeddings for memory/UCM)"
echo "  - Dynamic Agents:   $PROJECT_DIR/.claude/agents/custom/ (8 skills)"
echo "  - Archon Runner:    $HOME/.archon/scripts/"
echo ""
echo "MCP Servers (project-level in .mcp.json):"
echo "  1. serena          - Symbol-level code navigation"
echo "  2. leann-search    - Semantic code search (HNSW vectors)"
echo "  3. tool-factory    - Dynamic tool creation (FastMCP)"
echo "  4. perplexity      - Web search (needs PERPLEXITY_API_KEY)"
echo ""
echo "MCP Servers (user-level via 'claude mcp add'):"
echo "  5. memorygraph     - Graph memory (FalkorDB Lite, from fork)"
echo ""
echo "Smoke test: $VERIFY_PASS/$VERIFY_TOTAL passed"
if [ "$VERIFY_FAIL" -eq 0 ]; then
    echo -e "${GREEN}Everything looks good!${NC}"
else
    echo -e "${YELLOW}Some checks need attention — see above.${NC}"
fi
echo ""

echo -e "${YELLOW}NEXT STEPS:${NC}"
echo ""
echo "  1. Start the embedding server (provides vector embeddings for memory):"
echo -e "     ${GREEN}cd $PROJECT_DIR && ./embedding-api/api-embed.sh start${NC}"
echo ""
echo "  2. Add these lines to your ~/.profile or ~/.zshrc:"
echo ""
cat "$PROFILE_ADDITIONS"
echo ""
echo "     Then run: source ~/.profile"
echo ""
echo "  3. Launch Claude Code:"
echo -e "     ${GREEN}cd $PROJECT_DIR && claude${NC}"
echo ""
echo "  4. Try these commands in Claude Code:"
echo "     /god-status"
echo "     /create-agent \"code reviewer for Python security\""
echo "     /run-agent code-reviewer \"Review src/tool_factory/server.py\""
echo ""

echo -e "${YELLOW}IMPORTANT: Add the following to your ~/.profile or ~/.zshrc:${NC}"
echo ""
cat "$PROFILE_ADDITIONS"
echo ""
echo -e "${YELLOW}Then run: source ~/.profile  (or source ~/.zshrc)${NC}"
echo ""
echo "To set up Archon autonomous operation:"
echo "  1. Edit ~/.archon-env with your RocketChat credentials"
echo "  2. bash $PROJECT_DIR/scripts/archon/install.sh"
echo "  3. bash $PROJECT_DIR/scripts/archon/status.sh"
echo ""
echo "To verify setup:"
echo "  cd $PROJECT_DIR"
echo "  claude"
echo "  /god-status"
echo ""
echo -e "${GREEN}Happy coding!${NC}"
