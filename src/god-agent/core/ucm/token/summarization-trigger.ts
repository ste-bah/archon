/**
 * Summarization Trigger (BDG-003)
 * Determines when context summarization is needed based on token usage
 *
 * Constitution Rules Applied:
 * - RULE-042: summarizationThreshold = 70%
 * - RULE-043: Summarization budget allocation
 * - RULE-044: Emergency summarization at 90%
 */

import type { ITokenConfig, ISummarizationConfig } from '../types.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';

export interface ITriggerReason {
  triggered: boolean;
  reason: string;
  severity: 'normal' | 'high' | 'critical';
  percentUsed: number;
  threshold: number;
  details?: Record<string, unknown>;
}

export interface ISummarizationDecision {
  shouldSummarize: boolean;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  reason: ITriggerReason;
  recommendedAction: string;
  estimatedSavings?: number;
}

export interface ISummarizationContext {
  phase: string;
  currentUsage: number;
  budgetAllocated: number;
  agentCount: number;
  activeWindowSize: number;
}

/**
 * Determines when summarization should be triggered based on usage patterns
 */
export class SummarizationTrigger {
  private config: ITokenConfig;
  private summaryConfig: ISummarizationConfig;

  constructor(
    config: ITokenConfig = DEFAULT_UCM_CONFIG.tokenManagement.defaults,
    summaryConfig: ISummarizationConfig = DEFAULT_UCM_CONFIG.tokenManagement.summarization
  ) {
    this.config = config;
    this.summaryConfig = summaryConfig;
  }

  /**
   * Determine if summarization should be triggered
   * RULE-042: summarizationThreshold = 70%
   *
   * @param context - Current summarization context
   * @returns Decision with reasoning and urgency
   */
  shouldSummarize(context: ISummarizationContext): ISummarizationDecision {
    const reason = this.getTriggerReason(context);

    if (!reason.triggered) {
      return {
        shouldSummarize: false,
        urgency: 'low',
        reason,
        recommendedAction: 'Continue monitoring usage'
      };
    }

    // Determine urgency based on severity and percentage
    const urgency = this.calculateUrgency(reason.percentUsed, reason.severity);

    // Estimate token savings from summarization
    const estimatedSavings = this.estimateSavings(context);

    // Recommend action based on urgency
    const recommendedAction = this.getRecommendedAction(urgency, context);

    return {
      shouldSummarize: true,
      urgency,
      reason,
      recommendedAction,
      estimatedSavings
    };
  }

  /**
   * Get the specific trigger reason with details
   */
  getTriggerReason(context: ISummarizationContext): ITriggerReason {
    const percentUsed = (context.currentUsage / context.budgetAllocated) * 100;

    // RULE-044: Emergency summarization at 90%
    if (percentUsed >= 90) {
      return {
        triggered: true,
        reason: 'Emergency threshold reached (90%)',
        severity: 'critical',
        percentUsed,
        threshold: 90,
        details: {
          message: 'Immediate summarization required to prevent context overflow',
          action: 'emergency-summarization'
        }
      };
    }

    // RULE-041: Warning threshold at 80%
    if (percentUsed >= 80) {
      return {
        triggered: true,
        reason: 'High usage warning threshold reached (80%)',
        severity: 'high',
        percentUsed,
        threshold: 80,
        details: {
          message: 'Summarization recommended to maintain healthy context buffer',
          action: 'proactive-summarization'
        }
      };
    }

    // RULE-042: Standard summarization threshold at 70%
    const summarizationThreshold = this.config.summarizationThreshold ?? 0.7;
    if (percentUsed >= summarizationThreshold) {
      return {
        triggered: true,
        reason: `Summarization threshold reached (${this.config.summarizationThreshold}%)`,
        severity: 'normal',
        percentUsed,
        threshold: summarizationThreshold,
        details: {
          message: 'Standard summarization to optimize context usage',
          action: 'scheduled-summarization'
        }
      };
    }

    // Agent count trigger - many agents in active window
    if (context.agentCount > 10 && percentUsed >= 60) {
      return {
        triggered: true,
        reason: 'High agent count with moderate usage',
        severity: 'normal',
        percentUsed,
        threshold: 60,
        details: {
          agentCount: context.agentCount,
          message: 'Many agents in window - summarization will help consolidate',
          action: 'agent-count-summarization'
        }
      };
    }

    // Active window size trigger
    const estimatedWindowTokens = context.activeWindowSize;
    const windowPercentOfBudget = (estimatedWindowTokens / context.budgetAllocated) * 100;

    if (windowPercentOfBudget >= 50 && percentUsed >= 65) {
      return {
        triggered: true,
        reason: 'Active window consuming significant budget',
        severity: 'normal',
        percentUsed,
        threshold: 65,
        details: {
          windowSize: context.activeWindowSize,
          windowPercent: windowPercentOfBudget,
          message: 'Large active window - summarization will free up space',
          action: 'window-size-summarization'
        }
      };
    }

    // No trigger conditions met
    return {
      triggered: false,
      reason: 'Usage within acceptable limits',
      severity: 'normal',
      percentUsed,
      threshold: this.config.summarizationThreshold ?? 0.7
    };
  }

  /**
   * Calculate urgency level based on usage and severity
   */
  private calculateUrgency(
    percentUsed: number,
    severity: 'normal' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (severity === 'critical' || percentUsed >= 90) {
      return 'critical';
    }

    if (severity === 'high' || percentUsed >= 80) {
      return 'high';
    }

    if (percentUsed >= 70) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Estimate token savings from summarization
   * RULE-018: Summary max 200 tokens per agent
   */
  private estimateSavings(context: ISummarizationContext): number {
    // Assume each agent in active window has ~500-1000 tokens on average
    const avgTokensPerAgent = 750;
    const estimatedCurrentUsage = context.agentCount * avgTokensPerAgent;

    // After summarization: 200 tokens per agent (RULE-018)
    const summaryTokensPerAgent = Math.min(200, this.summaryConfig.maxTokens);
    const estimatedAfterSummary = context.agentCount * summaryTokensPerAgent;

    // Estimated savings
    return Math.max(0, estimatedCurrentUsage - estimatedAfterSummary);
  }

  /**
   * Get recommended action based on urgency
   */
  private getRecommendedAction(
    urgency: 'low' | 'medium' | 'high' | 'critical',
    context: ISummarizationContext
  ): string {
    switch (urgency) {
      case 'critical':
        return `URGENT: Immediately summarize ${context.agentCount} agents in active window to prevent context overflow`;

      case 'high':
        return `Summarize ${context.agentCount} agents in active window within next operation to maintain buffer`;

      case 'medium':
        return `Schedule summarization of ${context.agentCount} agents at next convenient checkpoint`;

      case 'low':
      default:
        return `Consider summarizing ${context.agentCount} agents to optimize context usage`;
    }
  }

  /**
   * Check if emergency summarization is needed
   * RULE-044: Emergency at 90%
   */
  isEmergency(currentUsage: number, budgetAllocated: number): boolean {
    const percentUsed = (currentUsage / budgetAllocated) * 100;
    return percentUsed >= 90;
  }

  /**
   * Check if proactive summarization is recommended
   * Between 70-80%
   */
  isProactiveRecommended(currentUsage: number, budgetAllocated: number): boolean {
    const percentUsed = (currentUsage / budgetAllocated) * 100;
    return percentUsed >= (this.config.summarizationThreshold ?? 0.7) && percentUsed < 80;
  }

  /**
   * Get next summarization threshold that will be crossed
   */
  getNextThreshold(currentUsage: number, budgetAllocated: number): {
    threshold: number;
    tokensUntil: number;
    severity: 'normal' | 'high' | 'critical';
  } | null {
    const percentUsed = (currentUsage / budgetAllocated) * 100;

    // Find next threshold
    const summarizationThreshold = this.config.summarizationThreshold ?? 0.7;
    const thresholds = [
      { percent: summarizationThreshold, severity: 'normal' as const },
      { percent: 80, severity: 'high' as const },
      { percent: 90, severity: 'critical' as const }
    ];

    for (const { percent, severity } of thresholds) {
      if (percent !== undefined && percentUsed < percent) {
        const tokensUntil = Math.floor((percent / 100) * budgetAllocated) - currentUsage;
        return {
          threshold: percent,
          tokensUntil: Math.max(0, tokensUntil),
          severity
        };
      }
    }

    // Already past all thresholds
    return null;
  }

  /**
   * Calculate optimal batch size for summarization
   * Returns number of agents to summarize in one batch
   */
  getOptimalBatchSize(context: ISummarizationContext): number {
    const { agentCount, currentUsage, budgetAllocated } = context;
    const percentUsed = (currentUsage / budgetAllocated) * 100;

    // Critical: summarize all agents
    if (percentUsed >= 90) {
      return agentCount;
    }

    // High: summarize 75% of agents
    if (percentUsed >= 80) {
      return Math.ceil(agentCount * 0.75);
    }

    // Normal: summarize 50% of agents
    if (percentUsed >= 70) {
      return Math.ceil(agentCount * 0.5);
    }

    // Low priority: summarize 25% of agents
    return Math.max(1, Math.ceil(agentCount * 0.25));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ITokenConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ITokenConfig {
    return { ...this.config };
  }
}
