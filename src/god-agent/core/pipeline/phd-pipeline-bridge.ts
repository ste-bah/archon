/**
 * PhD Pipeline Bridge
 * TASK-BRG-001 - PhD-specific pipeline bridge extending base
 *
 * Extends PipelineBridge with PhD-specific:
 * - Quality gate requirements (citations, methodology)
 * - Phase-specific task descriptions
 * - Writing phase requirements
 */

import { PipelineBridge, type IPipelineBridgeConfig } from './pipeline-bridge.js';
import type { IPipelineConfig, IAgentConfig } from './pipeline-types.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { ILoadedAgentDefinition } from '../agents/agent-types.js';
import { getStyleProfileManager } from '../../universal/style-profile.js';
import { StyleAnalyzer } from '../../universal/style-analyzer.js';

// ==================== PhD-Specific Types ====================

/**
 * PhD Pipeline Bridge Configuration
 * Extends base bridge config with PhD-specific options
 */
export interface IPhDPipelineBridgeConfig extends IPipelineBridgeConfig {
  /** Optional style profile ID for Phase 6 (Writing) */
  styleProfileId?: string;
}

// ==================== PhD-Specific Constants ====================

/**
 * Phase-specific quality requirements
 */
const PHASE_QUALITY_REQUIREMENTS: Record<number, string[]> = {
  1: ['Clear problem framing', 'Explicit assumptions documented'],
  2: ['Literature citations included', 'Multiple perspectives explored'],
  3: ['Component interfaces defined', 'Dependencies documented'],
  4: ['Cross-validation complete', 'Consistency verified'],
  5: ['Algorithms specified', 'Complexity analyzed'],
  6: ['APA/Academic style', 'Minimum 15 citations', 'Clear methodology'],
  7: ['All QA criteria addressed', 'Reproducibility confirmed'],
};

/**
 * Writing phase ID
 */
const WRITING_PHASE_ID = 6;

/**
 * QA phase ID
 */
const QA_PHASE_ID = 7;

/**
 * Minimum citation requirements by phase
 */
const CITATION_REQUIREMENTS: Record<number, number> = {
  2: 5,  // Discovery
  6: 15, // Writing
  7: 3,  // QA (for verification)
};

// ==================== PhD Pipeline Bridge ====================

/**
 * PhD-Specific Pipeline Bridge
 *
 * Extends base bridge with academic research requirements:
 * - Citation counting
 * - Methodology verification
 * - Reproducibility gates
 * - Style profile integration for writing phase
 */
export class PhDPipelineBridge extends PipelineBridge {
  private styleProfileId?: string;

  constructor(
    config: IPipelineConfig,
    registry: AgentRegistry | null = null,
    bridgeConfig: Partial<IPhDPipelineBridgeConfig> = {}
  ) {
    // Force category to 'phd' for PhD pipeline
    super(config, registry, {
      ...bridgeConfig,
      category: 'phd',
    });

    // Store style profile ID if provided
    this.styleProfileId = bridgeConfig.styleProfileId;
  }

  // ==================== Override Methods ====================

  /**
   * Build PhD-specific task description
   */
  protected override buildTaskDescription(
    agentConfig: IAgentConfig,
    loadedDef: ILoadedAgentDefinition | null
  ): string {
    const parts: string[] = [];

    // Position context
    parts.push(`[${this.getPhaseName(agentConfig.phase)}]`);
    parts.push(agentConfig.description);

    // Phase-specific instructions
    const phaseInstructions = this.getPhaseInstructions(agentConfig.phase);
    if (phaseInstructions) {
      parts.push('\nPhase Requirements:');
      parts.push(phaseInstructions);
    }

    // Input/output specification
    if (agentConfig.inputs.length > 0) {
      parts.push(`\nExpected Inputs: ${agentConfig.inputs.join(', ')}`);
    }
    if (agentConfig.outputs.length > 0) {
      parts.push(`Required Outputs: ${agentConfig.outputs.join(', ')}`);
    }

    // Citation requirements
    const citationReq = CITATION_REQUIREMENTS[agentConfig.phase];
    if (citationReq) {
      parts.push(`\nCitation Requirement: Minimum ${citationReq} academic sources`);
    }

    // Style profile for ALL phases (UK English, academic conventions)
    // Applied to all agents to ensure consistent language throughout research outputs
    const stylePrompt = this.getStylePromptSync();
    if (stylePrompt && stylePrompt !== this.getDefaultStylePrompt()) {
      parts.push('\n--- Writing Style Requirements ---');
      parts.push(stylePrompt);
      parts.push('\nIMPORTANT: Apply these style requirements to ALL written output.');
    }

    // Critical agent warning
    if (agentConfig.critical) {
      parts.push('\n⚠️ CRITICAL AGENT: Pipeline will halt on failure');
    }

    // Add loaded prompt if available
    if (loadedDef && this.bridgeConfig.includeAgentPrompts) {
      const prompt = loadedDef.prompt || loadedDef.promptContent;
      if (prompt) {
        parts.push('\n--- Specialized Agent Instructions ---');
        parts.push(prompt);

        // Include capabilities
        if (loadedDef.frontmatter.capabilities?.length) {
          parts.push(`\nCapabilities: ${loadedDef.frontmatter.capabilities.join(', ')}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Build PhD-specific quality gate
   */
  protected override buildQualityGate(
    agentConfig: IAgentConfig,
    loadedDef: ILoadedAgentDefinition | null
  ): string {
    const gates: string[] = [];

    // Output requirements
    for (const output of agentConfig.outputs) {
      gates.push(`Must produce ${output}`);
    }

    // Phase-specific requirements
    const phaseReqs = PHASE_QUALITY_REQUIREMENTS[agentConfig.phase];
    if (phaseReqs) {
      gates.push(...phaseReqs);
    }

    // Citation requirements
    const citationReq = CITATION_REQUIREMENTS[agentConfig.phase];
    if (citationReq) {
      gates.push(`Must cite ${citationReq}+ academic sources`);
    }

    // Writing phase special requirements
    if (agentConfig.phase === WRITING_PHASE_ID) {
      gates.push('Must follow academic writing standards');
      gates.push('Must include proper citations (APA/IEEE format)');
    }

    // QA phase requirements
    if (agentConfig.phase === QA_PHASE_ID) {
      gates.push('Must provide evidence-based assessment');
      gates.push('Must identify actionable improvements');
    }

    // Critical agent requirements
    if (agentConfig.critical) {
      gates.push('CRITICAL: Must pass all quality criteria');
    }

    // Timeout gate
    gates.push(`Must complete within ${agentConfig.timeout}s`);

    // Add loaded definition quality gates if present
    if (loadedDef?.frontmatter.qualityGates?.length) {
      gates.push(...loadedDef.frontmatter.qualityGates);
    }

    return gates.join('; ');
  }

  // ==================== PhD-Specific Methods ====================

  /**
   * Get phase-specific instructions
   */
  protected getPhaseInstructions(phaseId: number): string | null {
    const instructions: Record<number, string> = {
      1: 'Focus on establishing solid theoretical foundation. Identify all assumptions and constraints.',
      2: 'Conduct thorough literature review. Explore multiple solution approaches. Document all sources.',
      3: 'Design modular, extensible architecture. Define clear interfaces. Map all dependencies.',
      4: 'Integrate findings from all previous phases. Resolve contradictions. Ensure consistency.',
      5: 'Specify detailed algorithms. Analyze complexity. Design error handling.',
      6: 'Write clear, academic prose. Follow citation standards. Include visual aids.',
      7: 'Critically evaluate all aspects. Verify reproducibility. Provide actionable feedback.',
    };

    return instructions[phaseId] ?? null;
  }

  /**
   * Get PhD-specific statistics
   */
  getPhDStatistics(): {
    totalAgents: number;
    phases: number;
    criticalAgents: number;
    writingAgents: number;
    qaAgents: number;
    estimatedCitations: number;
  } {
    const base = this.getStatistics();
    const writingAgents = this.config.agents.filter(
      a => a.phase === WRITING_PHASE_ID
    ).length;
    const qaAgents = this.config.agents.filter(
      a => a.phase === QA_PHASE_ID
    ).length;

    // Estimate total citations needed
    let estimatedCitations = 0;
    for (const agent of this.config.agents) {
      const req = CITATION_REQUIREMENTS[agent.phase];
      if (req) estimatedCitations += req;
    }

    return {
      ...base,
      writingAgents,
      qaAgents,
      estimatedCitations,
    };
  }

  /**
   * Get agents by phase
   */
  getAgentsByPhase(phaseId: number): IAgentConfig[] {
    return this.config.agents.filter(a => a.phase === phaseId);
  }

  /**
   * Get critical path agents (those in the longest dependency chain)
   */
  getCriticalPathAgents(): IAgentConfig[] {
    // Build dependency graph
    const agentMap = new Map<number, IAgentConfig>();
    for (const agent of this.config.agents) {
      agentMap.set(agent.id, agent);
    }

    // Find longest path using DFS with memoization
    const memo = new Map<number, number>();
    const pathMemo = new Map<number, number[]>();

    const getLongestPath = (id: number): number => {
      if (memo.has(id)) return memo.get(id)!;

      const agent = agentMap.get(id);
      if (!agent || agent.dependencies.length === 0) {
        memo.set(id, 1);
        pathMemo.set(id, [id]);
        return 1;
      }

      let maxLength = 0;
      let maxPath: number[] = [];
      for (const depId of agent.dependencies) {
        const length = getLongestPath(depId);
        if (length > maxLength) {
          maxLength = length;
          maxPath = pathMemo.get(depId) ?? [];
        }
      }

      memo.set(id, maxLength + 1);
      pathMemo.set(id, [...maxPath, id]);
      return maxLength + 1;
    };

    // Find the agent with the longest path
    let maxPath: number[] = [];
    for (const agent of this.config.agents) {
      getLongestPath(agent.id);
      const path = pathMemo.get(agent.id) ?? [];
      if (path.length > maxPath.length) {
        maxPath = path;
      }
    }

    return maxPath.map(id => agentMap.get(id)!).filter(Boolean);
  }

  /**
   * Validate PhD-specific requirements
   */
  validatePhDRequirements(): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check total agent count
    if (this.config.agents.length !== 48) {
      issues.push(`Expected 48 agents, found ${this.config.agents.length}`);
    }

    // Check phase count
    if (this.config.phases.length !== 7) {
      issues.push(`Expected 7 phases, found ${this.config.phases.length}`);
    }

    // Check critical agents exist
    const criticalKeys = ['step-back-analyzer', 'contradiction-analyzer', 'adversarial-reviewer'];
    for (const key of criticalKeys) {
      const agent = this.config.agents.find(a => a.key === key);
      if (!agent) {
        issues.push(`Missing critical agent: ${key}`);
      } else if (!agent.critical) {
        issues.push(`Agent ${key} should be marked as critical`);
      }
    }

    // Check writing phase has sufficient agents
    const writingAgents = this.getAgentsByPhase(WRITING_PHASE_ID);
    if (writingAgents.length < 5) {
      issues.push(`Writing phase should have at least 5 agents, found ${writingAgents.length}`);
    }

    // Check QA phase has sufficient agents
    const qaAgents = this.getAgentsByPhase(QA_PHASE_ID);
    if (qaAgents.length < 10) {
      issues.push(`QA phase should have at least 10 agents, found ${qaAgents.length}`);
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  // ==================== Style Profile Methods ====================

  /**
   * Get default style prompt
   */
  private getDefaultStylePrompt(): string {
    return 'Use APA/Academic style with formal tone and US English conventions.';
  }

  /**
   * Get style prompt (synchronous)
   * Used during task description building (synchronous context)
   */
  private getStylePromptSync(): string {
    if (!this.styleProfileId) {
      return this.getDefaultStylePrompt();
    }

    try {
      const styleManager = getStyleProfileManager();
      const profile = styleManager.getProfile(this.styleProfileId);

      if (!profile?.characteristics) {
        console.warn(`[PhDPipelineBridge] Style profile not found: ${this.styleProfileId}`);
        return this.getDefaultStylePrompt();
      }

      const analyzer = new StyleAnalyzer();
      const prompt = analyzer.generateStylePrompt(profile.characteristics);
      console.log(`[PhDPipelineBridge] Loaded style profile: ${this.styleProfileId}`);
      return prompt;
    } catch (error) {
      console.error(`[PhDPipelineBridge] Error loading style profile:`, error);
      return this.getDefaultStylePrompt();
    }
  }
}

// ==================== Factory Function ====================

/**
 * Create a PhD pipeline bridge with default configuration
 */
export function createPhDPipelineBridge(
  config: IPipelineConfig,
  registry: AgentRegistry | null = null
): PhDPipelineBridge {
  return new PhDPipelineBridge(config, registry, {
    includeAgentPrompts: true,
    strictOrdering: true,
  });
}

// ==================== Exports ====================

export {
  PHASE_QUALITY_REQUIREMENTS,
  CITATION_REQUIREMENTS,
  WRITING_PHASE_ID,
  QA_PHASE_ID,
};
