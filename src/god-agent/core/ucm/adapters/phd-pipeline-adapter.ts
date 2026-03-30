/**
 * PhD Pipeline Adapter
 *
 * Specialized adapter for PhD research workflows with phase-aware
 * rolling window sizes and cross-reference pinning strategy.
 *
 * Implements RULE-010 to RULE-014 from CONSTITUTION-UCM-001.md
 *
 * @module ucm/adapters/phd-pipeline-adapter
 */

import type {
  IWorkflowAdapter,
  ITaskContext,
  ITokenConfig,
  IPinningStrategy,
  IPhaseSettings
} from '../types.js';

/**
 * PhD research workflow phases
 */
export enum PhdPhase {
  PLANNING = 'planning',
  RESEARCH = 'research',
  WRITING = 'writing',
  QA = 'qa'
}

/**
 * Adapter for PhD research pipeline workflows
 */
export class PhdPipelineAdapter implements IWorkflowAdapter {
  readonly name = 'phd-pipeline';

  /**
   * Detect if task context is part of PhD pipeline
   *
   * Detection criteria:
   * - 'phd' in pipelineName (case-insensitive)
   * - 'phd' in agentId (case-insensitive)
   * - 'writing' in phase (case-insensitive)
   *
   * @param context - Task context to analyze
   * @returns True if PhD pipeline detected
   */
  detect(context: ITaskContext): boolean {
    const pipelineName = context.pipelineName?.toLowerCase() || '';
    const agentId = context.agentId?.toLowerCase() || '';
    const phase = context.phase?.toLowerCase() || '';

    return (
      pipelineName.includes('phd') ||
      agentId.includes('phd') ||
      phase.includes('writing')
    );
  }

  /**
   * Get phase-aware rolling window size
   *
   * Window sizes per RULE-010 to RULE-014:
   * - Planning: 2 messages (RULE-011)
   * - Research: 3 messages (RULE-012)
   * - Writing: 5 messages (RULE-013)
   * - QA: 10 messages (RULE-014)
   * - Default: 3 messages (RULE-010)
   *
   * @param context - Task context
   * @returns Rolling window size
   */
  getWindowSize(context: ITaskContext): number {
    const phase = this.detectPhase(context);

    switch (phase) {
      case PhdPhase.PLANNING:
        return 2; // RULE-011
      case PhdPhase.RESEARCH:
        return 3; // RULE-012
      case PhdPhase.WRITING:
        return 5; // RULE-013
      case PhdPhase.QA:
        return 10; // RULE-014
      default:
        return 3; // RULE-010
    }
  }

  /**
   * Get token configuration for PhD workflows
   *
   * @param context - Task context
   * @returns Token configuration
   */
  getTokenConfig(context: ITaskContext): ITokenConfig {
    return {
      tokensPerWord: 1.3, // Standard for academic text
      averageWordLength: 5,
      safetyMargin: 0.1 // 10% safety margin
    };
  }

  /**
   * Get pinning strategy for PhD workflows
   *
   * Uses cross-reference pinning to maintain citations and key concepts
   *
   * @param context - Task context
   * @returns Pinning strategy configuration
   */
  getPinningStrategy(context: ITaskContext): IPinningStrategy {
    return {
      type: 'cross-reference',
      autoPin: true,
      threshold: 3, // Pin items referenced 3+ times
      maxPinnedItems: 50 // Reasonable limit for citations/key concepts
    };
  }

  /**
   * Get phase-specific settings
   *
   * @param context - Task context
   * @returns Phase-specific settings
   */
  getPhaseSettings(context: ITaskContext): IPhaseSettings {
    const phase = this.detectPhase(context);

    const baseSettings = {
      compressionEnabled: true,
      compressionRatio: 0.7,
      priorityBoost: 1.0
    };

    switch (phase) {
      case PhdPhase.PLANNING:
        return {
          ...baseSettings,
          name: 'Foundation & Discovery',
          windowSize: 2,
          focusAreas: ['research-questions', 'methodology', 'scope'],
          compressionRatio: 0.8 // Less compression for planning
        };

      case PhdPhase.RESEARCH:
        return {
          ...baseSettings,
          name: 'Research & Analysis',
          windowSize: 3,
          focusAreas: ['literature-review', 'data-collection', 'analysis'],
          compressionRatio: 0.7
        };

      case PhdPhase.WRITING:
        return {
          ...baseSettings,
          name: 'Writing & Synthesis',
          windowSize: 5,
          focusAreas: ['chapters', 'arguments', 'citations', 'synthesis'],
          compressionRatio: 0.6, // More compression for writing
          priorityBoost: 1.2 // Boost priority for writing phase
        };

      case PhdPhase.QA:
        return {
          ...baseSettings,
          name: 'Quality Assurance & Review',
          windowSize: 10,
          focusAreas: ['consistency', 'citations', 'formatting', 'review'],
          compressionRatio: 0.5, // Maximum compression for QA
          priorityBoost: 1.5 // High priority for QA
        };

      default:
        return {
          ...baseSettings,
          name: 'General',
          windowSize: 3,
          focusAreas: []
        };
    }
  }

  /**
   * Detect the current PhD phase from context
   *
   * @param context - Task context
   * @returns Detected phase
   */
  private detectPhase(context: ITaskContext): PhdPhase {
    const phase = context.phase?.toLowerCase() || '';
    const agentId = context.agentId?.toLowerCase() || '';
    const task = context.task?.toLowerCase() || '';

    // Check explicit phase
    if (phase.includes('planning') || phase.includes('foundation')) {
      return PhdPhase.PLANNING;
    }
    if (phase.includes('research') || phase.includes('discovery')) {
      return PhdPhase.RESEARCH;
    }
    if (phase.includes('writing') || phase.includes('synthesis')) {
      return PhdPhase.WRITING;
    }
    if (phase.includes('qa') || phase.includes('review') || phase.includes('quality')) {
      return PhdPhase.QA;
    }

    // Check agent ID patterns
    if (agentId.includes('planner') || agentId.includes('architect')) {
      return PhdPhase.PLANNING;
    }
    if (agentId.includes('researcher') || agentId.includes('analyst')) {
      return PhdPhase.RESEARCH;
    }
    if (agentId.includes('writer') || agentId.includes('synthesis')) {
      return PhdPhase.WRITING;
    }
    if (agentId.includes('reviewer') || agentId.includes('qa')) {
      return PhdPhase.QA;
    }

    // Check task patterns
    if (task.includes('plan') || task.includes('scope')) {
      return PhdPhase.PLANNING;
    }
    if (task.includes('research') || task.includes('analyze')) {
      return PhdPhase.RESEARCH;
    }
    if (task.includes('write') || task.includes('chapter')) {
      return PhdPhase.WRITING;
    }
    if (task.includes('review') || task.includes('validate')) {
      return PhdPhase.QA;
    }

    // Default to research phase
    return PhdPhase.RESEARCH;
  }
}
