/**
 * Agent Types
 * TASK-AGT-001 - Type definitions for Universal Subagent System
 *
 * Defines types for loading and managing agent definitions from
 * .claude/agents/ markdown files with YAML frontmatter.
 */

// ==================== Hook Types ====================

/**
 * Pre and post execution hooks from agent YAML frontmatter
 */
export interface IAgentHooks {
  /** Bash script to run before agent execution (memory retrieval, setup) */
  pre?: string;
  /** Bash script to run after agent execution (memory storage, cleanup) */
  post?: string;
}

// ==================== Frontmatter Types ====================

/**
 * YAML frontmatter structure from agent markdown files
 *
 * Example:
 * ```yaml
 * ---
 * name: step-back-analyzer
 * type: meta-analyst
 * color: "#6A1B9A"
 * description: Use PROACTIVELY at research start...
 * capabilities:
 *   - principle_extraction
 *   - evaluation_criteria_design
 * priority: critical
 * hooks:
 *   pre: |
 *     echo "Starting agent..."
 *     mcp__memorygraph__recall_memories with query "research/meta/context"
 *   post: |
 *     mcp__memorygraph__store_memory with title "research/meta/principles"
 * ---
 * ```
 */
export interface IAgentFrontmatter {
  /** Agent name (kebab-case identifier) */
  name: string;

  /** Agent category/type (e.g., 'meta-analyst', 'section-writer') */
  type?: string;

  /** Hex color code for UI visualization */
  color?: string;

  /** Human-readable description of agent purpose and usage */
  description: string;

  /** Array of capability identifiers */
  capabilities?: string[];

  /** Execution priority level */
  priority?: 'low' | 'medium' | 'high' | 'critical';

  /** Trigger phrases that activate this agent */
  triggers?: string[];

  /** Icon emoji for display */
  icon?: string;

  /** Category classification */
  category?: string;

  /** Version string */
  version?: string;

  /** XP reward mapping for gamification */
  xp_rewards?: Record<string, number>;

  /** Personality profile (e.g., 'INTJ + Enneagram 8') */
  personality?: string;

  /** Pre and post execution hooks */
  hooks?: IAgentHooks;

  /** Tools available to this agent (e.g., 'Read', 'Write', 'Bash') */
  tools?: string[];

  /** Quality gate requirements (array of strings describing quality criteria) */
  qualityGates?: string[];
}

// ==================== Loaded Definition Types ====================

/**
 * Fully loaded agent definition with prompt content
 * Created by AgentDefinitionLoader after parsing markdown file
 */
export interface ILoadedAgentDefinition {
  /** Unique key (filename without .md extension) */
  key: string;

  /** Category directory name (e.g., 'phdresearch', 'core') */
  category: string;

  /** Parsed YAML frontmatter */
  frontmatter: IAgentFrontmatter;

  /** Full markdown body after frontmatter (agent prompt/instructions) */
  promptContent: string;

  /** Alias for promptContent (for backward compatibility) */
  prompt?: string;

  /** Description from frontmatter (for convenience) */
  description?: string;

  /** Absolute path to source file */
  filePath: string;

  /** Timestamp when definition was loaded */
  loadedAt: number;
}

// ==================== Category Types ====================

/**
 * Information about an agent category directory
 */
export interface ICategoryInfo {
  /** Directory name (e.g., 'phdresearch') */
  name: string;

  /** Absolute path to directory */
  path: string;

  /** Number of .md agent files in directory */
  agentCount: number;
}

// ==================== Loader Configuration ====================

/**
 * Configuration options for AgentDefinitionLoader
 */
export interface IAgentLoaderOptions {
  /** Base path to agents directory (default: '.claude/agents') */
  basePath: string;

  /** Whether to validate hook syntax (default: true) */
  validateHooks?: boolean;

  /** Whether to require YAML frontmatter (default: true) */
  requireFrontmatter?: boolean;

  /** Whether to log warnings (default: true) */
  verbose?: boolean;
}

// ==================== Registry Types ====================

/**
 * Result of validating pipeline agents against registry
 */
export interface IRegistryValidationResult {
  /** Whether all required agents are loaded */
  valid: boolean;

  /** List of agent keys that are missing */
  missing: string[];
}

/**
 * Statistics about loaded agents
 */
export interface IRegistryStats {
  /** Total number of loaded agents */
  totalAgents: number;

  /** Number of categories */
  totalCategories: number;

  /** Number of categories scanned (alias for totalCategories) */
  categoriesScanned?: number;

  /** Agent count per category */
  categoryCounts: Record<string, number>;

  /** Timestamp of last initialization */
  initializedAt: number;
}

// ==================== Type Guards ====================

/**
 * Type guard to check if frontmatter has hooks
 */
export function hasHooks(
  frontmatter: IAgentFrontmatter
): frontmatter is IAgentFrontmatter & { hooks: IAgentHooks } {
  return frontmatter.hooks !== undefined;
}

/**
 * Type guard to check if frontmatter has pre-hook
 */
export function hasPreHook(
  frontmatter: IAgentFrontmatter
): frontmatter is IAgentFrontmatter & { hooks: { pre: string } } {
  return hasHooks(frontmatter) && typeof frontmatter.hooks.pre === 'string';
}

/**
 * Type guard to check if frontmatter has post-hook
 */
export function hasPostHook(
  frontmatter: IAgentFrontmatter
): frontmatter is IAgentFrontmatter & { hooks: { post: string } } {
  return hasHooks(frontmatter) && typeof frontmatter.hooks.post === 'string';
}

// ==================== Default Values ====================

/**
 * Default loader options
 */
export const DEFAULT_LOADER_OPTIONS: Required<Omit<IAgentLoaderOptions, 'basePath'>> = {
  validateHooks: true,
  requireFrontmatter: true,
  verbose: true,
};

/**
 * Default frontmatter for agents without YAML
 */
export function createDefaultFrontmatter(key: string): IAgentFrontmatter {
  return {
    name: key,
    description: `Agent: ${key}`,
    priority: 'medium',
  };
}
