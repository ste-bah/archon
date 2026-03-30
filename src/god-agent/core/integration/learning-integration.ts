/**
 * Learning Integration
 * TASK-LRN-001 - Integrates pipeline execution with Sona Engine learning
 *
 * Creates trajectories for agent executions and provides feedback
 * for continuous improvement through pattern recognition.
 */

import type { SonaEngine } from '../learning/sona-engine.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { IAgentResult, IPipelineExecution } from '../orchestration/orchestration-types.js';

// ==================== Types ====================

/**
 * Learning integration configuration
 */
export interface ILearningIntegrationConfig {
  /** Enable trajectory tracking */
  trackTrajectories: boolean;
  /** Automatically provide feedback on completion */
  autoFeedback: boolean;
  /** Quality threshold for pattern creation (0-1) */
  qualityThreshold: number;
  /** Route prefix for trajectories */
  routePrefix: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Enable ReasoningBank hyperedge creation */
  enableHyperedges?: boolean;
  /** Minimum quality for hyperedge creation */
  hyperedgeThreshold?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_LEARNING_CONFIG: ILearningIntegrationConfig = {
  trackTrajectories: true,
  autoFeedback: true,
  qualityThreshold: 0.8,
  routePrefix: 'pipeline/',
  verbose: false,
  enableHyperedges: false,
  hyperedgeThreshold: 0.85,
};

/**
 * Trajectory metadata for tracking
 */
export interface ITrajectoryMetadata {
  trajectoryId: string;
  agentName: string;
  phase: string;
  createdAt: number;
  pipelineTrajectoryId?: string;
}

/**
 * Quality calculation result
 */
export interface IQualityCalculation {
  quality: number;
  factors: {
    baseSuccess: number;
    speedBonus: number;
    outputBonus: number;
    errorPenalty: number;
  };
}

/**
 * Learning integration events
 */
export type LearningEventType =
  | 'trajectory:created'
  | 'trajectory:feedback'
  | 'pattern:created'
  | 'hyperedge:created';

export interface ILearningEvent {
  type: LearningEventType;
  timestamp: number;
  trajectoryId?: string;
  quality?: number;
  agentName?: string;
  data?: Record<string, unknown>;
}

export type LearningEventListener = (event: ILearningEvent) => void;

// ==================== Learning Integration ====================

/**
 * Base Learning Integration
 *
 * Bridges pipeline execution with Sona Engine for trajectory
 * tracking and continuous learning through feedback loops.
 */
export class LearningIntegration {
  protected sonaEngine: SonaEngine;
  protected reasoningBank: ReasoningBank | null;
  protected config: ILearningIntegrationConfig;

  /** Active trajectory IDs by agent name */
  protected trajectoryIds: Map<string, ITrajectoryMetadata> = new Map();

  /** Event listeners */
  protected listeners: LearningEventListener[] = [];

  /** Pipeline-level trajectory ID */
  protected pipelineTrajectoryId: string | null = null;

  constructor(
    sonaEngine: SonaEngine,
    config: Partial<ILearningIntegrationConfig> = {},
    reasoningBank: ReasoningBank | null = null
  ) {
    this.sonaEngine = sonaEngine;
    this.reasoningBank = reasoningBank;
    this.config = { ...DEFAULT_LEARNING_CONFIG, ...config };
  }

  // ==================== Event Handling ====================

  /**
   * Add event listener
   */
  addEventListener(listener: LearningEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: LearningEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit learning event
   */
  protected emitEvent(event: ILearningEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        if (this.config.verbose) {
          console.error('[LearningIntegration] Event listener error:', error);
        }
      }
    }
  }

  // ==================== Pipeline Lifecycle ====================

  /**
   * Called when pipeline starts
   * Creates a pipeline-level trajectory
   */
  onPipelineStart(pipelineId: string, pipelineName: string): string | undefined {
    if (!this.config.trackTrajectories) {
      return undefined;
    }

    const route = this.buildRoute(pipelineName);
    const trajectoryId = this.sonaEngine.createTrajectory(
      route,
      ['pipeline', pipelineName],
      [pipelineId]
    );

    this.pipelineTrajectoryId = trajectoryId;

    if (this.config.verbose) {
      console.log(`[LearningIntegration] Pipeline trajectory created: ${trajectoryId}`);
    }

    this.emitEvent({
      type: 'trajectory:created',
      timestamp: Date.now(),
      trajectoryId,
      data: { pipelineId, pipelineName },
    });

    return trajectoryId;
  }

  /**
   * Called when an agent starts execution
   * Creates an agent-level trajectory
   */
  onAgentStart(
    agentName: string,
    phase: string,
    pipelineTrajectoryId?: string
  ): string | undefined {
    if (!this.config.trackTrajectories) {
      return undefined;
    }

    const route = this.buildAgentRoute(phase, agentName);
    const contextIds = pipelineTrajectoryId
      ? [pipelineTrajectoryId]
      : this.pipelineTrajectoryId
        ? [this.pipelineTrajectoryId]
        : [];

    const trajectoryId = this.sonaEngine.createTrajectory(
      route,
      [agentName, phase],
      contextIds
    );

    const metadata: ITrajectoryMetadata = {
      trajectoryId,
      agentName,
      phase,
      createdAt: Date.now(),
      pipelineTrajectoryId: pipelineTrajectoryId ?? this.pipelineTrajectoryId ?? undefined,
    };

    this.trajectoryIds.set(agentName, metadata);

    if (this.config.verbose) {
      console.log(`[LearningIntegration] Agent trajectory created: ${agentName} -> ${trajectoryId}`);
    }

    this.emitEvent({
      type: 'trajectory:created',
      timestamp: Date.now(),
      trajectoryId,
      agentName,
      data: { phase },
    });

    return trajectoryId;
  }

  /**
   * Called when an agent completes execution
   * Provides feedback to Sona Engine
   */
  async onAgentComplete(
    agentName: string,
    result: IAgentResult
  ): Promise<void> {
    if (!this.config.trackTrajectories || !this.config.autoFeedback) {
      return;
    }

    const metadata = this.trajectoryIds.get(agentName);
    if (!metadata) {
      if (this.config.verbose) {
        console.warn(`[LearningIntegration] No trajectory found for agent: ${agentName}`);
      }
      return;
    }

    // Calculate quality
    const qualityCalc = this.calculateQuality(result);

    // Provide feedback to Sona Engine
    await this.sonaEngine.provideFeedback(metadata.trajectoryId, qualityCalc.quality);

    if (this.config.verbose) {
      console.log(
        `[LearningIntegration] Feedback provided: ${agentName} -> quality=${qualityCalc.quality.toFixed(2)}`
      );
    }

    this.emitEvent({
      type: 'trajectory:feedback',
      timestamp: Date.now(),
      trajectoryId: metadata.trajectoryId,
      quality: qualityCalc.quality,
      agentName,
      data: { factors: qualityCalc.factors },
    });

    // Create hyperedge if quality is high enough
    if (
      this.config.enableHyperedges &&
      this.reasoningBank &&
      qualityCalc.quality >= (this.config.hyperedgeThreshold ?? 0.85)
    ) {
      await this.createHyperedge(metadata, result, qualityCalc.quality);
    }

    // Clean up trajectory metadata
    this.trajectoryIds.delete(agentName);
  }

  /**
   * Called when pipeline completes
   * Provides overall quality feedback
   */
  async onPipelineComplete(
    execution: IPipelineExecution,
    pipelineTrajectoryId?: string
  ): Promise<void> {
    const trajectoryId = pipelineTrajectoryId ?? this.pipelineTrajectoryId;
    if (!trajectoryId) {
      return;
    }

    // Calculate pipeline-level quality
    const quality = this.calculatePipelineQuality(execution);

    // Provide feedback
    await this.sonaEngine.provideFeedback(trajectoryId, quality);

    if (this.config.verbose) {
      console.log(
        `[LearningIntegration] Pipeline feedback provided: quality=${quality.toFixed(2)}`
      );
    }

    this.emitEvent({
      type: 'trajectory:feedback',
      timestamp: Date.now(),
      trajectoryId,
      quality,
      data: {
        pipelineId: execution.pipelineId,
        status: execution.status,
        totalAgents: execution.totalAgents,
      },
    });

    // Clear state
    this.trajectoryIds.clear();
    this.pipelineTrajectoryId = null;
  }

  // ==================== Quality Calculation ====================

  /**
   * Calculate quality score for agent result
   * Override in subclasses for custom calculation
   */
  protected calculateQuality(result: IAgentResult): IQualityCalculation {
    const factors = {
      baseSuccess: 0,
      speedBonus: 0,
      outputBonus: 0,
      errorPenalty: 0,
    };

    // Base quality from success/failure
    if (result.success) {
      factors.baseSuccess = 0.7;
    } else {
      factors.errorPenalty = -0.7;
    }

    // Speed bonus for fast execution (< 60s)
    if (result.duration < 60000) {
      factors.speedBonus = 0.1;
    } else if (result.duration < 120000) {
      factors.speedBonus = 0.05;
    }

    // Output quality bonus
    if (result.output) {
      if (result.output.length > 1000) {
        factors.outputBonus = 0.15;
      } else if (result.output.length > 500) {
        factors.outputBonus = 0.1;
      } else if (result.output.length > 100) {
        factors.outputBonus = 0.05;
      }
    }

    const quality = Math.max(
      0,
      Math.min(
        1.0,
        factors.baseSuccess + factors.speedBonus + factors.outputBonus + factors.errorPenalty
      )
    );

    return { quality, factors };
  }

  /**
   * Calculate quality score for entire pipeline
   */
  protected calculatePipelineQuality(execution: IPipelineExecution): number {
    const totalAgents = execution.totalAgents;
    if (totalAgents === 0) return 0;

    // Count successful agents
    let successCount = 0;
    for (const result of execution.agentResults.values()) {
      if (result.success) {
        successCount++;
      }
    }

    const successRate = successCount / totalAgents;

    // Bonus for full completion
    const completionBonus = execution.status === 'completed' ? 0.1 : 0;

    // Penalty for errors
    const errorPenalty = execution.error ? 0.2 : 0;

    return Math.max(0, Math.min(1.0, successRate + completionBonus - errorPenalty));
  }

  // ==================== Helper Methods ====================

  /**
   * Build route string for pipeline
   */
  protected buildRoute(pipelineName: string): string {
    const normalized = pipelineName.toLowerCase().replace(/\s+/g, '-');
    return `${this.config.routePrefix}${normalized}`;
  }

  /**
   * Build route string for agent
   */
  protected buildAgentRoute(phase: string, agentName: string): string {
    const normalizedPhase = phase.toLowerCase().replace(/\s+/g, '-');
    const normalizedAgent = agentName.toLowerCase().replace(/\s+/g, '-');
    return `${this.config.routePrefix}${normalizedPhase}/${normalizedAgent}`;
  }

  /**
   * Create hyperedge in ReasoningBank for high-quality execution
   */
  protected async createHyperedge(
    metadata: ITrajectoryMetadata,
    result: IAgentResult,
    quality: number
  ): Promise<void> {
    if (!this.reasoningBank) return;

    try {
      // Use ReasoningBank's feedback mechanism
      // Derive verdict from quality score
      const verdict = quality >= 0.7 ? 'correct' : quality >= 0.4 ? 'neutral' : 'incorrect';
      await this.reasoningBank.provideFeedback({
        trajectoryId: metadata.trajectoryId,
        verdict,
        quality,
      });

      this.emitEvent({
        type: 'hyperedge:created',
        timestamp: Date.now(),
        trajectoryId: metadata.trajectoryId,
        quality,
        agentName: metadata.agentName,
      });

      if (this.config.verbose) {
        console.log(
          `[LearningIntegration] Hyperedge created for ${metadata.agentName}`
        );
      }
    } catch (error) {
      if (this.config.verbose) {
        console.error('[LearningIntegration] Failed to create hyperedge:', error);
      }
    }
  }

  // ==================== State Management ====================

  /**
   * Get current trajectory count
   */
  getActiveTrajectoryCount(): number {
    return this.trajectoryIds.size;
  }

  /**
   * Get trajectory metadata for agent
   */
  getTrajectoryMetadata(agentName: string): ITrajectoryMetadata | undefined {
    return this.trajectoryIds.get(agentName);
  }

  /**
   * Get all active trajectory metadata
   */
  getAllTrajectoryMetadata(): Map<string, ITrajectoryMetadata> {
    return new Map(this.trajectoryIds);
  }

  /**
   * Get pipeline trajectory ID
   */
  getPipelineTrajectoryId(): string | null {
    return this.pipelineTrajectoryId;
  }

  /**
   * Clear all tracking state
   */
  clear(): void {
    this.trajectoryIds.clear();
    this.pipelineTrajectoryId = null;
  }

  /**
   * Get configuration
   */
  getConfig(): ILearningIntegrationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ILearningIntegrationConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ==================== Exports ====================

export { DEFAULT_LEARNING_CONFIG as DEFAULT_CONFIG };
