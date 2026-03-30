/**
 * Agent Registry
 * TASK-AGT-002 - Multi-category agent registration and lookup
 *
 * Central registry for all loaded agent definitions.
 * Supports lookup by key, category, and pipeline validation.
 */

import type {
  ILoadedAgentDefinition,
  ICategoryInfo,
  IRegistryValidationResult,
  IRegistryStats,
} from './agent-types.js';
import { AgentCategoryScanner } from './agent-category-scanner.js';
import { AgentDefinitionLoader } from './agent-definition-loader.js';

// ==================== Agent Registry ====================

/**
 * AgentRegistry
 *
 * Centralized registry for loaded agent definitions.
 * Provides lookup by key, category, and validation for pipelines.
 */
export class AgentRegistry {
  private agents: Map<string, ILoadedAgentDefinition> = new Map();
  private categories: Map<string, ILoadedAgentDefinition[]> = new Map();
  private categoryInfo: ICategoryInfo[] = [];
  private scanner: AgentCategoryScanner;
  private loader: AgentDefinitionLoader;
  private initialized: boolean = false;
  private initializedAt: number = 0;
  private verbose: boolean;

  constructor(options: { basePath: string; verbose?: boolean }) {
    this.verbose = options.verbose ?? true;
    this.scanner = new AgentCategoryScanner({ verbose: this.verbose });
    this.loader = new AgentDefinitionLoader({
      basePath: options.basePath,
      verbose: this.verbose,
    });
  }

  /**
   * Initialize the registry by loading all agents from all categories
   *
   * @param basePath - Base path to agents directory (e.g., '.claude/agents')
   */
  async initialize(basePath: string): Promise<void> {
    if (this.initialized) {
      if (this.verbose) {
        console.log('[AgentRegistry] Already initialized, skipping');
      }
      return;
    }

    const startTime = Date.now();

    // Discover all categories
    this.categoryInfo = await this.scanner.scanCategories(basePath);

    // Load agents from each category
    for (const category of this.categoryInfo) {
      const definitions = await this.loader.loadAll(category.path, category.name);

      // Register each definition
      const categoryAgents: ILoadedAgentDefinition[] = [];
      for (const def of definitions) {
        // Check for duplicate keys
        if (this.agents.has(def.key)) {
          const existing = this.agents.get(def.key)!;
          if (this.verbose) {
            console.warn(
              `[AgentRegistry] Duplicate key '${def.key}' in ${def.filePath}, ` +
              `already registered from ${existing.filePath}`
            );
          }
          continue;
        }

        this.agents.set(def.key, def);
        categoryAgents.push(def);
      }

      this.categories.set(category.name, categoryAgents);
    }

    this.initialized = true;
    this.initializedAt = Date.now();

    const duration = Date.now() - startTime;
    if (this.verbose) {
      console.log(
        `[AgentRegistry] Initialized with ${this.agents.size} agents ` +
        `from ${this.categories.size} categories in ${duration}ms`
      );
    }
  }

  /**
   * Get agent definition by key
   */
  getByKey(key: string): ILoadedAgentDefinition | undefined {
    return this.agents.get(key);
  }

  /**
   * Get all agents in a category
   */
  getByCategory(category: string): ILoadedAgentDefinition[] {
    return this.categories.get(category) || [];
  }

  /**
   * Get all loaded agents
   */
  getAll(): ILoadedAgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all category names
   */
  getCategoryNames(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Get category info
   */
  getCategoryInfo(): ICategoryInfo[] {
    return [...this.categoryInfo];
  }

  /**
   * Check if an agent is registered
   */
  has(key: string): boolean {
    return this.agents.has(key);
  }

  /**
   * Get total agent count
   */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Check if registry is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Validate that all required pipeline agents are loaded
   *
   * @param requiredKeys - Array of agent keys required for pipeline
   * @returns Validation result with missing keys
   */
  validatePipelineAgents(requiredKeys: string[]): IRegistryValidationResult {
    const missing = requiredKeys.filter(key => !this.agents.has(key));
    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Get registry statistics
   */
  getStats(): IRegistryStats {
    const categoryCounts: Record<string, number> = {};
    for (const [name, agents] of this.categories) {
      categoryCounts[name] = agents.length;
    }

    return {
      totalAgents: this.agents.size,
      totalCategories: this.categories.size,
      categoryCounts,
      initializedAt: this.initializedAt,
    };
  }

  /**
   * Search agents by name pattern (case-insensitive substring match)
   */
  searchByName(pattern: string): ILoadedAgentDefinition[] {
    const lowerPattern = pattern.toLowerCase();
    return this.getAll().filter(agent => {
      // Skip agents with missing critical fields (malformed agent definitions)
      if (!agent.frontmatter.name || !agent.frontmatter.description) {
        return false;
      }

      const keyMatch = agent.key.toLowerCase().includes(lowerPattern);
      const nameMatch = agent.frontmatter.name.toLowerCase().includes(lowerPattern);
      const descMatch = agent.frontmatter.description.toLowerCase().includes(lowerPattern);
      return keyMatch || nameMatch || descMatch;
    });
  }

  /**
   * Get agents with specific capability
   */
  getByCapability(capability: string): ILoadedAgentDefinition[] {
    const lowerCapability = capability.toLowerCase();
    return this.getAll().filter(agent =>
      agent.frontmatter.capabilities?.some(c =>
        c.toLowerCase().includes(lowerCapability)
      )
    );
  }

  /**
   * Get agents by priority level
   */
  getByPriority(priority: 'low' | 'medium' | 'high' | 'critical'): ILoadedAgentDefinition[] {
    return this.getAll().filter(agent =>
      agent.frontmatter.priority === priority
    );
  }

  /**
   * Clear all loaded agents (for testing)
   */
  clear(): void {
    this.agents.clear();
    this.categories.clear();
    this.categoryInfo = [];
    this.initialized = false;
    this.initializedAt = 0;
  }
}

// ==================== Factory Function ====================

/**
 * Create and initialize an agent registry
 *
 * @param basePath - Base path to agents directory
 * @param options - Registry options
 */
export async function createAgentRegistry(
  basePath: string,
  options: { verbose?: boolean } = {}
): Promise<AgentRegistry> {
  const registry = new AgentRegistry({ basePath, ...options });
  await registry.initialize(basePath);
  return registry;
}
