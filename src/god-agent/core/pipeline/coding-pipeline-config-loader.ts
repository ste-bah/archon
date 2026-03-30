/**
 * CodingPipelineConfigLoader - Loads pipeline configuration from agent definition files
 *
 * Implements REQ-PIPE-047 (support all 47 coding agents)
 * Pattern from: PipelineConfigLoader in pipeline-loader.ts
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-config-loader
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

import type {
  CodingPipelinePhase,
  CodingPipelineAgent,
  IAgentMapping,
  AlgorithmType,
} from './types.js';
import { SHERLOCK_PHASE_MAP } from './types.js';

// Import extracted modules
import {
  AGENTS_DIR,
  TYPE_TO_PHASE,
  PHASE_DEFAULT_ALGORITHM,
  AGENT_ORDER,
  CRITICAL_AGENT_KEYS,
} from './coding-pipeline-constants.js';

import {
  parseYAML,
  extractFrontmatter,
} from './coding-pipeline-yaml-parser.js';

import {
  inferDependencies,
  inferMemoryReads,
  inferMemoryWrites,
  calculateXPReward,
  type PhaseAgentInfo,
} from './coding-pipeline-inference.js';

const logger = createComponentLogger('CodingPipelineConfigLoader', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Coding agent configuration from definition file
 */
export interface CodingAgentConfig {
  /** Unique agent key (filename without .md) */
  key: string;
  /** Human-readable name */
  name: string;
  /** Pipeline phase */
  phase: CodingPipelinePhase;
  /** Execution order within pipeline */
  order: number;
  /** Agent description */
  description: string;
  /** Agent type from frontmatter */
  type: string;
  /** Agent category */
  category: string;
  /** Version string */
  version: string;
  /** Priority level */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Agent capabilities */
  capabilities: string[];
  /** Available tools */
  tools: string[];
  /** Quality gates */
  qualityGates: string[];
  /** Pre/post hooks */
  hooks: {
    pre?: string;
    post?: string;
  };
  /** Algorithm for this agent */
  algorithm: AlgorithmType;
  /** Fallback algorithm */
  fallbackAlgorithm?: AlgorithmType;
  /** If true, pipeline halts on failure */
  critical: boolean;
  /** Full markdown content */
  fullContent: string;
}

/**
 * Coding pipeline configuration
 */
export interface CodingPipelineConfig {
  id: string;
  name: string;
  agents: CodingAgentConfig[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CODING PIPELINE CONFIG LOADER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CodingPipelineConfigLoader class
 *
 * Dynamically loads agent configurations from .claude/agents/coding-pipeline/*.md files.
 * This replaces the hardcoded CODING_PIPELINE_MAPPINGS with file-driven configuration.
 */
export class CodingPipelineConfigLoader {
  private configCache: CodingPipelineConfig | null = null;
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  /**
   * Load pipeline configuration from agent definition files
   * Returns config with all 47 agents
   * [REQ-PIPE-047]
   */
  async loadPipelineConfig(): Promise<CodingPipelineConfig> {
    if (this.configCache) {
      return this.configCache;
    }

    const agentsDir = path.join(this.basePath, AGENTS_DIR);

    let files: string[];
    try {
      files = await fs.readdir(agentsDir);
    } catch {
      // INTENTIONAL: Directory access failure - throw descriptive error for caller handling
      throw new Error(`Coding agents directory not found: ${agentsDir}`);
    }

    const agentFiles = files.filter(f => f.endsWith('.md'));
    const agents: CodingAgentConfig[] = [];

    for (const file of agentFiles) {
      try {
        const filePath = path.join(agentsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const agent = this.parseAgentDefinition(content, file);
        agents.push(agent);
      } catch (error) {
        logger.warn('Failed to parse coding agent definition', { file, error: String(error) });
      }
    }

    // Sort agents by order
    agents.sort((a, b) => a.order - b.order);

    this.configCache = {
      id: 'coding-pipeline',
      name: 'God Agent Coding Pipeline',
      agents
    };

    return this.configCache;
  }

  /**
   * Parse agent definition markdown file
   * Extract frontmatter and content
   */
  private parseAgentDefinition(content: string, filename: string): CodingAgentConfig {
    // Extract YAML frontmatter using extracted module
    const extracted = extractFrontmatter(content);

    if (!extracted) {
      throw new Error(`No frontmatter found in ${filename}`);
    }

    const [frontmatterYaml, fullContent] = extracted;
    const frontmatter = parseYAML(frontmatterYaml);

    // Build agent key from filename
    const key = filename.replace('.md', '');

    // Get order from AGENT_ORDER map
    const order = AGENT_ORDER[key] || 99;

    // Determine phase from AGENT_ORDER position, NOT frontmatter type
    // This is more reliable since frontmatter types may not match intended phase
    const phase = this.derivePhase(order, key);

    // Store original type from frontmatter for reference
    const agentType = (frontmatter.type as string) || 'implementation';

    // Determine if critical
    const isCritical = CRITICAL_AGENT_KEYS.has(key) ||
      frontmatter.priority === 'critical';

    // Get algorithm
    const algorithm = PHASE_DEFAULT_ALGORITHM[phase];

    return {
      key,
      name: (frontmatter.name as string) || key,
      phase,
      order,
      description: (frontmatter.description as string) || '',
      type: agentType,
      category: (frontmatter.category as string) || 'coding-pipeline',
      version: (frontmatter.version as string) || '1.0.0',
      priority: this.parsePriority(frontmatter.priority as string),
      capabilities: this.parseStringArray(frontmatter.capabilities),
      tools: this.parseStringArray(frontmatter.tools),
      qualityGates: this.parseStringArray(frontmatter.qualityGates),
      hooks: this.parseHooks(frontmatter.hooks),
      algorithm,
      fallbackAlgorithm: this.getFallbackAlgorithm(algorithm),
      critical: isCritical,
      fullContent,
    };
  }

  /**
   * Parse priority string to typed value
   */
  private parsePriority(priority: string | undefined): 'critical' | 'high' | 'medium' | 'low' {
    if (priority === 'critical') return 'critical';
    if (priority === 'high') return 'high';
    if (priority === 'low') return 'low';
    return 'medium';
  }

  /**
   * Parse string array from frontmatter
   */
  private parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(v => String(v));
    }
    return [];
  }

  /**
   * Parse hooks from frontmatter
   */
  private parseHooks(hooks: unknown): { pre?: string; post?: string } {
    if (typeof hooks === 'object' && hooks !== null) {
      const h = hooks as Record<string, unknown>;
      return {
        pre: typeof h.pre === 'string' ? h.pre : undefined,
        post: typeof h.post === 'string' ? h.post : undefined,
      };
    }
    return {};
  }

  /**
   * Derive pipeline phase from agent key and order.
   * Sherlock reviewers use SHERLOCK_PHASE_MAP (each reviewer belongs to the phase it reviews).
   * Regular agents use order-based boundaries.
   */
  private derivePhase(order: number, key: string): CodingPipelinePhase {
    // Sherlock reviewers belong to the phase they review, not delivery
    const sherlockPhase = SHERLOCK_PHASE_MAP[key as keyof typeof SHERLOCK_PHASE_MAP];
    if (sherlockPhase) return sherlockPhase;

    // Regular agents: order-based boundaries
    // Phase 1: Understanding (1-6)
    // Phase 2: Exploration (7-10)
    // Phase 3: Architecture (11-15)
    // Phase 4: Implementation (16-27)
    // Phase 5: Testing (28-35)  — includes test-fixer
    // Phase 6: Optimization (36-40) — includes final-refactorer
    // Phase 7: Delivery (41)
    if (order <= 6) return 'understanding';
    if (order <= 10) return 'exploration';
    if (order <= 15) return 'architecture';
    if (order <= 27) return 'implementation';
    if (order <= 35) return 'testing';
    if (order <= 40) return 'optimization';
    return 'delivery';
  }

  /**
   * Get fallback algorithm for primary algorithm
   */
  private getFallbackAlgorithm(primary: AlgorithmType): AlgorithmType {
    const fallbacks: Record<AlgorithmType, AlgorithmType> = {
      'LATS': 'ToT',
      'ReAct': 'Reflexion',
      'Self-Debug': 'ReAct',
      'Reflexion': 'ReAct',
      'PoT': 'ReAct',
      'ToT': 'ReAct',
    };
    return fallbacks[primary] || 'ReAct';
  }

  /**
   * Get agent by index
   */
  async getAgentByIndex(index: number): Promise<CodingAgentConfig> {
    const config = await this.loadPipelineConfig();

    if (index < 0 || index >= config.agents.length) {
      throw new Error(`Invalid agent index: ${index}. Valid range: 0-${config.agents.length - 1}`);
    }

    return config.agents[index];
  }

  /**
   * Get agent by key
   */
  async getAgentByKey(key: string): Promise<CodingAgentConfig | undefined> {
    const config = await this.loadPipelineConfig();
    return config.agents.find(a => a.key === key);
  }

  /**
   * Get agents for a specific phase
   */
  async getAgentsForPhase(phase: CodingPipelinePhase): Promise<CodingAgentConfig[]> {
    const config = await this.loadPipelineConfig();
    return config.agents.filter(a => a.phase === phase);
  }

  /**
   * Get Sherlock reviewer agents
   */
  async getSherlockAgents(): Promise<CodingAgentConfig[]> {
    const config = await this.loadPipelineConfig();
    return config.agents.filter(a => a.type === 'sherlock-reviewer');
  }

  /**
   * Get critical agents
   */
  async getCriticalAgents(): Promise<CodingAgentConfig[]> {
    const config = await this.loadPipelineConfig();
    return config.agents.filter(a => a.critical);
  }

  /**
   * Convert CodingAgentConfig to IAgentMapping for orchestrator compatibility
   */
  async getAgentMappings(): Promise<IAgentMapping[]> {
    const config = await this.loadPipelineConfig();

    // Build PhaseAgentInfo array for inference functions
    const phaseAgents: PhaseAgentInfo[] = config.agents.map(a => ({
      key: a.key,
      phase: a.phase,
      order: a.order,
    }));

    return config.agents.map(agent => ({
      phase: agent.phase,
      agentKey: agent.key as CodingPipelineAgent,
      priority: agent.order,
      category: agent.category,
      algorithm: agent.algorithm,
      fallbackAlgorithm: agent.fallbackAlgorithm,
      dependsOn: inferDependencies(agent.key, phaseAgents),
      memoryReads: inferMemoryReads(agent.key, phaseAgents),
      memoryWrites: inferMemoryWrites(agent.key),
      xpReward: calculateXPReward(agent.key, agent.critical),
      parallelizable: !agent.critical && agent.priority !== 'critical',
      critical: agent.critical,
      description: agent.description,
    }));
  }

  /**
   * Clear cache to force reload
   */
  clearCache(): void {
    this.configCache = null;
  }

  /**
   * Validate all agent files exist and are parseable
   */
  async validateAgentFiles(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const config = await this.loadPipelineConfig();

      // Check for expected agent count
      const expectedKeys = Object.keys(AGENT_ORDER);
      const foundKeys = new Set(config.agents.map(a => a.key));

      for (const expected of expectedKeys) {
        if (!foundKeys.has(expected)) {
          errors.push(`Missing agent file: ${expected}.md`);
        }
      }

      // Check for unexpected agents
      for (const agent of config.agents) {
        if (!AGENT_ORDER[agent.key]) {
          errors.push(`Unknown agent (not in AGENT_ORDER): ${agent.key}.md`);
        }
      }

      // Validate each agent has required fields
      for (const agent of config.agents) {
        if (!agent.name) errors.push(`Agent ${agent.key} missing 'name'`);
        if (!agent.description) errors.push(`Agent ${agent.key} missing 'description'`);
        if (!agent.type) errors.push(`Agent ${agent.key} missing 'type'`);
      }

    } catch (error) {
      errors.push(`Failed to load pipeline config: ${error}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new CodingPipelineConfigLoader instance
 */
export function createCodingPipelineConfigLoader(basePath?: string): CodingPipelineConfigLoader {
  return new CodingPipelineConfigLoader(basePath);
}

/**
 * Get agent mappings for the coding pipeline
 * Convenience function that loads config and returns IAgentMapping array
 */
export async function loadCodingPipelineMappings(basePath?: string): Promise<IAgentMapping[]> {
  const loader = createCodingPipelineConfigLoader(basePath);
  return loader.getAgentMappings();
}
