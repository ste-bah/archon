// Agent definition file names (order matters for Context Envelope assembly)
export const AGENT_FILES = [
  'agent.md',
  'context.md',
  'tools.md',
  'behavior.md',
  'memory-keys.json',
  'meta.json',
] as const;

// Required files (agent.md is the only required file per REQ-DEF-001)
export const REQUIRED_FILES = ['agent.md'] as const;

// Token hard limits per file (REQ-DEF-003)
export const TOKEN_LIMITS: Record<string, number> = {
  'agent.md': 3_000,
  'context.md': 5_000,
  'tools.md': 2_000,
  'behavior.md': 1_500,
};

// Total controllable prompt limit (all files + memory + behavior rules + task)
export const TOTAL_CONTROLLABLE_TOKEN_LIMIT = 15_000;

// Paths
export const AGENTS_BASE_DIR = '.claude/agents';
export const CUSTOM_AGENTS_DIR = '.claude/agents/custom';
export const TEMPLATE_DIR = '.claude/agents/custom/_template';
export const ARCHIVED_AGENTS_DIR = '.claude/agents/archived';
export const VERSIONS_DIR = '.claude/agents/versions';
export const TRACES_DIR = '.claude/agents/traces';

// Name constraints
export const AGENT_NAME_MAX_LENGTH = 50;
export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
export const AGENT_NAME_MIN_LENGTH = 2;

// Reserved names (cannot be used as agent names)
export const RESERVED_NAMES = new Set([
  '_template',
  'archived',
  'versions',
  'traces',
  'custom',
]);
