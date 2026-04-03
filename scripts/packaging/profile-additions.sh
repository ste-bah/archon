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
