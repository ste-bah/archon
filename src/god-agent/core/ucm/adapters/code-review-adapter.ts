/**
 * Code Review Adapter
 *
 * Specialized adapter for code review workflows with file-based
 * pinning strategy and code-optimized token estimation.
 *
 * @module ucm/adapters/code-review-adapter
 */

import type {
  IWorkflowAdapter,
  ITaskContext,
  ITokenConfig,
  IPinningStrategy,
  IPhaseSettings
} from '../types.js';

/**
 * Adapter for code review workflows
 */
export class CodeReviewAdapter implements IWorkflowAdapter {
  readonly name = 'code-review';

  /**
   * Detect if task context is code review related
   *
   * Detection criteria:
   * - 'review' in agentId (case-insensitive)
   * - 'review' in pipelineName (case-insensitive)
   * - 'review' in task description (case-insensitive)
   * - 'pr' or 'pull-request' in context
   *
   * @param context - Task context to analyze
   * @returns True if code review detected
   */
  detect(context: ITaskContext): boolean {
    const agentId = context.agentId?.toLowerCase() || '';
    const pipelineName = context.pipelineName?.toLowerCase() || '';
    const task = context.task?.toLowerCase() || '';

    return (
      agentId.includes('review') ||
      pipelineName.includes('review') ||
      task.includes('review') ||
      task.includes('pr') ||
      task.includes('pull-request') ||
      agentId.includes('code-review')
    );
  }

  /**
   * Get rolling window size for code review
   *
   * Code reviews typically need moderate context:
   * - Initial review: smaller window (3)
   * - Discussion phase: larger window (5)
   * - Final approval: medium window (4)
   *
   * @param context - Task context
   * @returns Rolling window size
   */
  getWindowSize(context: ITaskContext): number {
    const phase = context.phase?.toLowerCase() || '';

    if (phase.includes('initial') || phase.includes('start')) {
      return 3;
    }
    if (phase.includes('discussion') || phase.includes('iteration')) {
      return 5;
    }
    if (phase.includes('final') || phase.includes('approval')) {
      return 4;
    }

    // Default for code review
    return 4;
  }

  /**
   * Get token configuration for code review
   *
   * Code has higher token density due to:
   * - Special characters
   * - Camel/snake case
   * - Indentation
   *
   * @param context - Task context
   * @returns Token configuration
   */
  getTokenConfig(_context: ITaskContext): ITokenConfig {
    return {
      tokensPerWord: 1.5, // Higher for code (vs 1.3 for text)
      averageWordLength: 6, // Code identifiers tend to be longer
      safetyMargin: 0.15 // 15% safety margin for code complexity
    };
  }

  /**
   * Get pinning strategy for code review
   *
   * Uses file-based pinning to maintain:
   * - Key files under review
   * - Related files (imports, dependencies)
   * - Test files
   *
   * @param context - Task context
   * @returns Pinning strategy configuration
   */
  getPinningStrategy(_context: ITaskContext): IPinningStrategy {
    return {
      type: 'file-based',
      autoPin: true,
      threshold: 2, // Pin files referenced 2+ times
      maxPinnedItems: 30, // Reasonable limit for file count
      filePatterns: [
        '**/*.ts',
        '**/*.tsx',
        '**/*.js',
        '**/*.jsx',
        '**/*.test.*',
        '**/*.spec.*'
      ]
    };
  }

  /**
   * Get phase-specific settings for code review
   *
   * @param context - Task context
   * @returns Phase-specific settings
   */
  getPhaseSettings(context: ITaskContext): IPhaseSettings {
    const phase = context.phase?.toLowerCase() || '';

    const baseSettings = {
      compressionEnabled: true,
      compressionRatio: 0.6,
      priorityBoost: 1.0
    };

    if (phase.includes('initial')) {
      return {
        ...baseSettings,
        name: 'Initial Review',
        windowSize: 3,
        focusAreas: ['structure', 'patterns', 'overview'],
        compressionRatio: 0.7 // Less compression for initial review
      };
    }

    if (phase.includes('discussion') || phase.includes('iteration')) {
      return {
        ...baseSettings,
        name: 'Discussion & Iteration',
        windowSize: 5,
        focusAreas: ['feedback', 'changes', 'discussions'],
        compressionRatio: 0.6,
        priorityBoost: 1.2
      };
    }

    if (phase.includes('final') || phase.includes('approval')) {
      return {
        ...baseSettings,
        name: 'Final Approval',
        windowSize: 4,
        focusAreas: ['quality', 'completeness', 'tests'],
        compressionRatio: 0.5, // More compression for final review
        priorityBoost: 1.3
      };
    }

    // Default settings
    return {
      ...baseSettings,
      name: 'Code Review',
      windowSize: 4,
      focusAreas: ['code-quality', 'best-practices', 'maintainability']
    };
  }
}
