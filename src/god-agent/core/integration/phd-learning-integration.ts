/**
 * PhD Learning Integration
 * TASK-LRN-001 - PhD-specific learning integration
 *
 * Extends base LearningIntegration with PhD research-specific
 * quality calculation and phase-aware trajectory tracking.
 */

import {
  LearningIntegration,
  type ILearningIntegrationConfig,
  type IQualityCalculation,
  DEFAULT_LEARNING_CONFIG,
} from './learning-integration.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { IAgentResult } from '../orchestration/orchestration-types.js';

// ==================== PhD-Specific Constants ====================

/**
 * Phase importance weights for quality calculation
 * Higher weights for critical phases
 */
export const PHASE_WEIGHTS: Record<string, number> = {
  Foundation: 1.2,    // Critical for problem framing
  Discovery: 1.0,     // Standard importance
  Architecture: 1.1,  // Important for design
  Synthesis: 1.0,     // Standard
  Design: 1.1,        // Important for implementation
  Writing: 1.3,       // Critical for output quality
  QA: 1.2,            // Critical for validation
};

/**
 * Minimum output lengths by phase
 */
export const PHASE_MIN_OUTPUT_LENGTH: Record<string, number> = {
  Foundation: 500,
  Discovery: 1000,
  Architecture: 800,
  Synthesis: 600,
  Design: 1000,
  Writing: 2000,
  QA: 500,
};

/**
 * Critical agent keys that should have higher quality thresholds
 */
export const CRITICAL_AGENT_KEYS = [
  'step-back-analyzer',
  'contradiction-analyzer',
  'adversarial-reviewer',
  'final-synthesizer',
  'sign-off-approver',
];

/**
 * PhD-specific configuration defaults
 */
export const PHD_LEARNING_CONFIG: Partial<ILearningIntegrationConfig> = {
  routePrefix: 'phd/',
  qualityThreshold: 0.85,  // Higher threshold for academic work
  enableHyperedges: true,
  hyperedgeThreshold: 0.9,
};

// ==================== PhD Learning Integration ====================

/**
 * PhD-Specific Learning Integration
 *
 * Extends base integration with:
 * - Phase-weighted quality calculation
 * - Citation awareness in quality scoring
 * - Critical agent tracking
 * - Academic writing quality metrics
 */
export class PhDLearningIntegration extends LearningIntegration {
  /** Track critical agent results for special handling */
  private criticalAgentResults: Map<string, IAgentResult> = new Map();

  /** Track phase completion for phase-level learning */
  private phaseCompletionCounts: Map<string, { total: number; successful: number }> = new Map();

  constructor(
    sonaEngine: SonaEngine,
    config: Partial<ILearningIntegrationConfig> = {},
    reasoningBank: ReasoningBank | null = null
  ) {
    // Merge PhD defaults with provided config
    super(sonaEngine, { ...PHD_LEARNING_CONFIG, ...config }, reasoningBank);
  }

  // ==================== Override Methods ====================

  /**
   * PhD-specific quality calculation
   */
  protected override calculateQuality(result: IAgentResult): IQualityCalculation {
    const baseCalc = super.calculateQuality(result);

    // Get phase weight
    const phase = this.extractPhase(result);
    const phaseWeight = PHASE_WEIGHTS[phase] ?? 1.0;

    // Check output length against phase minimum
    const minLength = PHASE_MIN_OUTPUT_LENGTH[phase] ?? 500;
    let outputQualityBonus = 0;

    if (result.output) {
      const outputLength = result.output.length;
      if (outputLength >= minLength * 2) {
        outputQualityBonus = 0.1;
      } else if (outputLength >= minLength) {
        outputQualityBonus = 0.05;
      } else if (outputLength < minLength * 0.5) {
        outputQualityBonus = -0.1; // Penalty for very short output
      }
    }

    // Citation bonus for writing/research phases
    let citationBonus = 0;
    if (result.output && (phase === 'Writing' || phase === 'Discovery')) {
      const citationCount = this.countCitations(result.output);
      if (citationCount >= 15) {
        citationBonus = 0.1;
      } else if (citationCount >= 10) {
        citationBonus = 0.05;
      } else if (citationCount >= 5) {
        citationBonus = 0.02;
      }
    }

    // Critical agent handling
    const isCritical = this.isCriticalAgent(result.agentName);
    const criticalPenalty = isCritical && !result.success ? 0.2 : 0;

    // Calculate final quality with phase weighting
    const adjustedQuality = Math.max(
      0,
      Math.min(
        1.0,
        (baseCalc.quality + outputQualityBonus + citationBonus - criticalPenalty) * phaseWeight
      )
    );

    // Track phase completion
    this.updatePhaseCompletion(phase, result.success);

    // Track critical agent results
    if (isCritical) {
      this.criticalAgentResults.set(result.agentName, result);
    }

    return {
      quality: adjustedQuality,
      factors: {
        ...baseCalc.factors,
        outputBonus: baseCalc.factors.outputBonus + outputQualityBonus + citationBonus,
        errorPenalty: baseCalc.factors.errorPenalty - criticalPenalty,
      },
    };
  }

  /**
   * PhD-specific agent start with phase tracking
   */
  override onAgentStart(
    agentName: string,
    phase: string,
    pipelineTrajectoryId?: string
  ): string | undefined {
    // Initialize phase tracking if not exists
    if (!this.phaseCompletionCounts.has(phase)) {
      this.phaseCompletionCounts.set(phase, { total: 0, successful: 0 });
    }

    const phaseData = this.phaseCompletionCounts.get(phase)!;
    phaseData.total++;

    return super.onAgentStart(agentName, phase, pipelineTrajectoryId);
  }

  // ==================== PhD-Specific Methods ====================

  /**
   * Count citations in output text
   */
  protected countCitations(output: string): number {
    const patterns = [
      /\[\d+\]/g,                              // [1], [2]
      /\([A-Z][a-z]+,?\s*\d{4}\)/g,           // (Author, 2024)
      /[A-Z][a-z]+\s+et\s+al\.\s*\(\d{4}\)/g, // Author et al. (2024)
    ];

    let count = 0;
    for (const pattern of patterns) {
      const matches = output.match(pattern);
      if (matches) count += matches.length;
    }

    // Rough deduplication
    return Math.ceil(count * 0.7);
  }

  /**
   * Check if agent is critical
   */
  protected isCriticalAgent(agentName: string): boolean {
    const normalizedName = agentName.toLowerCase().replace(/\s+/g, '-');
    return CRITICAL_AGENT_KEYS.includes(normalizedName);
  }

  /**
   * Extract phase from agent result metadata
   */
  protected extractPhase(result: IAgentResult): string {
    // Try to get from metadata in trajectory
    const metadata = this.trajectoryIds.get(result.agentName);
    if (metadata?.phase) {
      return metadata.phase;
    }

    // Try to infer from position string
    const position = result.position;
    if (position) {
      // Position is like "Agent #12/48"
      const match = position.match(/Agent #(\d+)/);
      if (match) {
        const agentNum = parseInt(match[1], 10);
        return this.inferPhaseFromAgentNumber(agentNum);
      }
    }

    return 'Unknown';
  }

  /**
   * Infer phase from agent number (based on PhD pipeline structure)
   */
  protected inferPhaseFromAgentNumber(agentNum: number): string {
    if (agentNum <= 4) return 'Foundation';
    if (agentNum <= 9) return 'Discovery';
    if (agentNum <= 15) return 'Architecture';
    if (agentNum <= 20) return 'Synthesis';
    if (agentNum <= 25) return 'Design';
    if (agentNum <= 32) return 'Writing';
    return 'QA';
  }

  /**
   * Update phase completion tracking
   */
  protected updatePhaseCompletion(phase: string, success: boolean): void {
    const phaseData = this.phaseCompletionCounts.get(phase);
    if (phaseData && success) {
      phaseData.successful++;
    }
  }

  // ==================== Statistics ====================

  /**
   * Get phase completion statistics
   */
  getPhaseStatistics(): Map<string, { total: number; successful: number; rate: number }> {
    const stats = new Map<string, { total: number; successful: number; rate: number }>();

    for (const [phase, data] of this.phaseCompletionCounts) {
      stats.set(phase, {
        total: data.total,
        successful: data.successful,
        rate: data.total > 0 ? data.successful / data.total : 0,
      });
    }

    return stats;
  }

  /**
   * Get critical agent results
   */
  getCriticalAgentResults(): Map<string, IAgentResult> {
    return new Map(this.criticalAgentResults);
  }

  /**
   * Get overall PhD pipeline success metrics
   */
  getPhdMetrics(): {
    phaseStats: Map<string, { total: number; successful: number; rate: number }>;
    criticalAgentCount: number;
    criticalAgentSuccessRate: number;
    overallSuccessRate: number;
  } {
    const phaseStats = this.getPhaseStatistics();

    let totalAgents = 0;
    let successfulAgents = 0;
    for (const data of phaseStats.values()) {
      totalAgents += data.total;
      successfulAgents += data.successful;
    }

    let criticalSuccess = 0;
    for (const result of this.criticalAgentResults.values()) {
      if (result.success) criticalSuccess++;
    }

    return {
      phaseStats,
      criticalAgentCount: this.criticalAgentResults.size,
      criticalAgentSuccessRate:
        this.criticalAgentResults.size > 0
          ? criticalSuccess / this.criticalAgentResults.size
          : 0,
      overallSuccessRate: totalAgents > 0 ? successfulAgents / totalAgents : 0,
    };
  }

  /**
   * Clear all PhD-specific tracking
   */
  override clear(): void {
    super.clear();
    this.criticalAgentResults.clear();
    this.phaseCompletionCounts.clear();
  }
}

// ==================== Factory ====================

/**
 * Create a PhD learning integration with default configuration
 */
export function createPhDLearningIntegration(
  sonaEngine: SonaEngine,
  reasoningBank: ReasoningBank | null = null,
  config: Partial<ILearningIntegrationConfig> = {}
): PhDLearningIntegration {
  return new PhDLearningIntegration(sonaEngine, config, reasoningBank);
}

// Constants are already exported at declaration
