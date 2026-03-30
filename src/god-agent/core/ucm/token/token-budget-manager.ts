/**
 * Token Budget Manager (BDG-001)
 * Allocates and tracks token budgets per workflow phase and context tier
 *
 * Constitution Rules Applied:
 * - RULE-007: contextWindow = 100,000 tokens
 * - RULE-008: maxOutputTokens = 15,000
 * - RULE-017: Pinned tier max 2,000 tokens
 * - RULE-018: Summary max 200 tokens per agent
 * - RULE-043: Summarization budget allocation
 */

import type { ITokenConfig, IPhaseSettings, ISummarizationConfig } from '../types.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';
import { BudgetAllocationError } from '../errors.js';

export interface IBudgetAllocation {
  phase: string;
  pinned: number;
  activeWindow: number;
  archivedSummaries: number;
  total: number;
  timestamp: number;
}

export interface ITierBudget {
  pinned: number;
  active: number;
  archived: number;
}

export interface IBudgetStatus {
  allocated: number;
  used: number;
  remaining: number;
  percentUsed: number;
}

/**
 * Manages token budget allocation across context tiers and workflow phases
 */
export class TokenBudgetManager {
  private config: ITokenConfig;
  private summaryConfig: ISummarizationConfig;
  private allocations: Map<string, IBudgetAllocation>;
  private tierBudgets: ITierBudget;
  private maxOutputTokens: number;
  private pinnedContextMaxTokens: number;

  constructor(
    config: ITokenConfig = DEFAULT_UCM_CONFIG.tokenManagement.defaults,
    summaryConfig: ISummarizationConfig = DEFAULT_UCM_CONFIG.tokenManagement.summarization,
    maxOutputTokens: number = 15000,
    pinnedContextMaxTokens: number = 2000
  ) {
    this.config = config;
    this.summaryConfig = summaryConfig;
    this.maxOutputTokens = maxOutputTokens;
    this.pinnedContextMaxTokens = pinnedContextMaxTokens;
    this.allocations = new Map();
    this.tierBudgets = this.calculateTierBudgets();
  }

  /**
   * Calculate initial tier budgets based on constitution rules
   */
  private calculateTierBudgets(): ITierBudget {
    const contextWindow = this.config.contextWindow ?? 200000;
    const maxOutput = this.maxOutputTokens;
    const availableForContext = contextWindow - maxOutput; // Reserve for output

    // RULE-017: Pinned tier max 2,000 tokens
    const pinnedBudget = Math.min(2000, this.pinnedContextMaxTokens);

    // Remaining budget split between active and archived
    const remainingBudget = availableForContext - pinnedBudget;

    // Active window gets priority (70% of remaining)
    const activeBudget = Math.floor(remainingBudget * 0.7);

    // Archived gets the rest (30% of remaining)
    const archivedBudget = remainingBudget - activeBudget;

    return {
      pinned: pinnedBudget,
      active: activeBudget,
      archived: archivedBudget
    };
  }

  /**
   * Allocate budget for a specific workflow phase
   * @param phase - Workflow phase name
   * @param phaseSettings - Phase-specific settings
   * @param agentCount - Number of agents in the phase
   * @returns Allocated budget breakdown
   */
  allocate(
    phase: string,
    phaseSettings: IPhaseSettings,
    agentCount: number = 1
  ): IBudgetAllocation {
    // Calculate phase-specific budgets
    const phaseMaxTokens = phaseSettings.maxActiveTokens || 50000;
    const pinnedBudget = Math.min(
      this.tierBudgets.pinned,
      phaseMaxTokens * 0.1 // 10% for pinned
    );

    // Active window budget based on phase settings
    const activeWindowBudget = Math.min(
      this.tierBudgets.active,
      phaseMaxTokens - pinnedBudget
    );

    // RULE-018: Summary max 200 tokens per agent
    const summaryTokensPerAgent = Math.min(200, this.summaryConfig.maxTokens);
    const archivedSummariesBudget = Math.min(
      this.tierBudgets.archived,
      summaryTokensPerAgent * agentCount * 2 // Buffer for multiple summaries
    );

    const totalBudget = pinnedBudget + activeWindowBudget + archivedSummariesBudget;

    // Validate against context window (RULE-007)
    const availableContext = (this.config.contextWindow ?? 200000) - this.maxOutputTokens;
    if (totalBudget > availableContext) {
      throw new BudgetAllocationError(totalBudget, availableContext);
    }

    const allocation: IBudgetAllocation = {
      phase,
      pinned: Math.floor(pinnedBudget),
      activeWindow: Math.floor(activeWindowBudget),
      archivedSummaries: Math.floor(archivedSummariesBudget),
      total: Math.floor(totalBudget),
      timestamp: Date.now()
    };

    this.allocations.set(phase, allocation);
    return allocation;
  }

  /**
   * Get remaining budget for a phase
   * @param phase - Workflow phase name
   * @param currentUsage - Current token usage
   * @returns Remaining budget by tier
   */
  getRemaining(phase: string, currentUsage: number): IBudgetStatus {
    const allocation = this.allocations.get(phase);

    if (!allocation) {
      throw new Error(`No budget allocation found for phase: ${phase}`);
    }

    const remaining = Math.max(0, allocation.total - currentUsage);
    const percentUsed = (currentUsage / allocation.total) * 100;

    return {
      allocated: allocation.total,
      used: currentUsage,
      remaining,
      percentUsed
    };
  }

  /**
   * Check if a token allocation request can be satisfied
   * @param phase - Workflow phase name
   * @param requestedTokens - Tokens requested
   * @param currentUsage - Current token usage
   * @returns True if allocation can be satisfied
   */
  canAllocate(phase: string, requestedTokens: number, currentUsage: number): boolean {
    try {
      const status = this.getRemaining(phase, currentUsage);
      return status.remaining >= requestedTokens;
    } catch {
      // INTENTIONAL: Budget check failure - return false as safe default
      return false;
    }
  }

  /**
   * Get allocation for a specific phase
   */
  getAllocation(phase: string): IBudgetAllocation | undefined {
    return this.allocations.get(phase);
  }

  /**
   * Get all allocations
   */
  getAllAllocations(): Map<string, IBudgetAllocation> {
    return new Map(this.allocations);
  }

  /**
   * Get tier budgets
   */
  getTierBudgets(): ITierBudget {
    return { ...this.tierBudgets };
  }

  /**
   * Update configuration and recalculate budgets
   */
  updateConfig(config: Partial<ITokenConfig>): void {
    this.config = { ...this.config, ...config };
    this.tierBudgets = this.calculateTierBudgets();

    // Recalculate existing allocations if needed
    // This is conservative - existing allocations remain valid
  }

  /**
   * Clear allocation for a phase (when phase completes)
   */
  clearAllocation(phase: string): boolean {
    return this.allocations.delete(phase);
  }

  /**
   * Clear all allocations
   */
  clearAll(): void {
    this.allocations.clear();
  }

  /**
   * Get budget statistics
   */
  getStatistics(): {
    totalAllocated: number;
    activePhases: number;
    tierBudgets: ITierBudget;
    allocations: IBudgetAllocation[];
  } {
    const allocations = Array.from(this.allocations.values());
    const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.total, 0);

    return {
      totalAllocated,
      activePhases: this.allocations.size,
      tierBudgets: this.getTierBudgets(),
      allocations
    };
  }
}
