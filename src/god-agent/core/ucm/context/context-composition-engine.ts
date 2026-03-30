/**
 * Context Composition Engine
 * TASK-UCM-CTX-004
 *
 * Main orchestrator for composing full context from multiple tiers.
 * RULE-015: Four-tier context structure
 * 1. Pinned (always included, max 2000 tokens)
 * 2. DESC Prior Solutions (max 2)
 * 3. Active Window (phase-aware size)
 * 4. Archived (reference only)
 *
 * Integrates RollingWindow, DependencyTracker, and PinningManager
 */

import type { IPhaseSettings, IRetrievalResult } from '../types.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';
import { BudgetExceededError } from '../errors.js';
import { RollingWindow } from './rolling-window.js';
import { DependencyTracker } from './dependency-tracker.js';
import { PinningManager, PinReason } from './pinning-manager.js';

/**
 * Composed context tier
 */
export interface IContextTier {
  tier: 'pinned' | 'desc-prior' | 'active' | 'archived';
  agents: IContextAgent[];
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agent in composed context
 */
export interface IContextAgent {
  agentId: string;
  content: string;
  tokenCount: number;
  tier: string;
  priority: number;
  metadata?: Record<string, unknown>;
}

/**
 * Context composition options
 */
export interface ICompositionOptions {
  targetAgent?: string;
  contextWindow: number;
  phase: string;
  includeDependencies?: boolean;
  maxDescPrior?: number;
  priorityWeights?: {
    pinned: number;
    descPrior: number;
    active: number;
    dependency: number;
  };
}

/**
 * Composed context result
 */
export interface IComposedContext {
  tiers: IContextTier[];
  totalTokens: number;
  contextWindow: number;
  utilization: number;
  agents: IContextAgent[];
  metadata: {
    phase: string;
    targetAgent?: string;
    pinnedCount: number;
    descPriorCount: number;
    activeCount: number;
    archivedCount: number;
    budgetRemaining: number;
  };
}

/**
 * Context Composition Engine
 * Orchestrates multi-tier context assembly with budget management
 */
export class ContextCompositionEngine {
  private rollingWindow: RollingWindow;
  private dependencyTracker: DependencyTracker;
  private pinningManager: PinningManager;
  private descPriorCache: Map<string, IRetrievalResult[]> = new Map();
  private archivedAgents: Map<string, IContextAgent> = new Map();

  constructor(
    initialPhase: string = 'research',
    maxPinnedTokens: number = 2000
  ) {
    this.rollingWindow = new RollingWindow(initialPhase);
    this.dependencyTracker = new DependencyTracker();
    this.pinningManager = new PinningManager(maxPinnedTokens);
  }

  /**
   * Compose full context for target agent or general query
   * RULE-015: Four-tier composition
   *
   * @param options - Composition options
   * @returns Composed context with all tiers
   */
  public compose(options: ICompositionOptions): IComposedContext {
    const {
      targetAgent,
      contextWindow,
      phase,
      includeDependencies = true,
      maxDescPrior = 2,
      priorityWeights = {
        pinned: 10,
        descPrior: 8,
        active: 5,
        dependency: 6,
      },
    } = options;

    // Update phase if changed
    if (phase !== this.rollingWindow.getPhase()) {
      this.rollingWindow.resize(phase);
    }

    const tiers: IContextTier[] = [];
    let remainingBudget = contextWindow;

    // TIER 1: Pinned agents (always included)
    const pinnedTier = this.composePinnedTier();
    tiers.push(pinnedTier);
    remainingBudget -= pinnedTier.tokenCount;

    if (remainingBudget < 0) {
      throw new BudgetExceededError(pinnedTier.tokenCount, contextWindow, 'pinned-agents');
    }

    // TIER 2: DESC Prior Solutions (max 2)
    const descPriorTier = this.composeDescPriorTier(targetAgent, maxDescPrior, remainingBudget);
    tiers.push(descPriorTier);
    remainingBudget -= descPriorTier.tokenCount;

    // TIER 3: Active Window (phase-aware)
    const activeTier = this.composeActiveTier(
      targetAgent,
      includeDependencies,
      remainingBudget,
      priorityWeights
    );
    tiers.push(activeTier);
    remainingBudget -= activeTier.tokenCount;

    // TIER 4: Archived (reference only, no tokens consumed)
    const archivedTier = this.composeArchivedTier();
    tiers.push(archivedTier);

    // Collect all agents in priority order
    const allAgents = [
      ...pinnedTier.agents,
      ...descPriorTier.agents,
      ...activeTier.agents,
      ...archivedTier.agents,
    ];

    const totalTokens = contextWindow - remainingBudget;

    return {
      tiers,
      totalTokens,
      contextWindow,
      utilization: contextWindow > 0 ? totalTokens / contextWindow : 0,
      agents: allAgents,
      metadata: {
        phase,
        targetAgent,
        pinnedCount: pinnedTier.agents.length,
        descPriorCount: descPriorTier.agents.length,
        activeCount: activeTier.agents.length,
        archivedCount: archivedTier.agents.length,
        budgetRemaining: remainingBudget,
      },
    };
  }

  /**
   * Get context for specific agent
   * Includes dependencies and DESC prior solutions
   *
   * @param agentId - Target agent
   * @param contextWindow - Available token budget
   * @param phase - Current research phase
   * @returns Composed context
   */
  public getContextForAgent(
    agentId: string,
    contextWindow: number,
    phase: string
  ): IComposedContext {
    return this.compose({
      targetAgent: agentId,
      contextWindow,
      phase,
      includeDependencies: true,
      maxDescPrior: 2,
    });
  }

  /**
   * Compose Tier 1: Pinned agents
   * @returns Pinned tier
   */
  private composePinnedTier(): IContextTier {
    const pinned = this.pinningManager.getPinned();

    return {
      tier: 'pinned',
      agents: pinned.map(p => ({
        agentId: p.agentId,
        content: p.content,
        tokenCount: p.tokenCount,
        tier: 'pinned',
        priority: p.priority,
        metadata: {
          reason: p.reason,
          pinnedAt: p.pinnedAt,
        },
      })),
      tokenCount: this.pinningManager.getTotalTokens(),
      metadata: {
        maxTokens: this.pinningManager.getStats().maxTokens,
        utilization: this.pinningManager.getStats().utilization,
      },
    };
  }

  /**
   * Compose Tier 2: DESC Prior Solutions
   * RULE-019: Max 2 prior solutions
   *
   * @param targetAgent - Target agent for DESC lookup
   * @param maxPrior - Maximum prior solutions
   * @param budget - Remaining token budget
   * @returns DESC prior tier
   */
  private composeDescPriorTier(
    targetAgent: string | undefined,
    maxPrior: number,
    budget: number
  ): IContextTier {
    if (!targetAgent) {
      return {
        tier: 'desc-prior',
        agents: [],
        tokenCount: 0,
      };
    }

    const priorResults = this.descPriorCache.get(targetAgent) ?? [];
    const agents: IContextAgent[] = [];
    let totalTokens = 0;

    for (let i = 0; i < Math.min(priorResults.length, maxPrior); i++) {
      const result = priorResults[i];
      const tokenCount = result.tokenCount ?? this.estimateTokens(result.content ?? '');

      if (totalTokens + tokenCount > budget) break;

      agents.push({
        agentId: result.agentId ?? `desc-${i}`,
        content: result.content ?? '',
        tokenCount,
        tier: 'desc-prior',
        priority: 8 - i, // Descending priority
        metadata: {
          similarity: result.similarity,
          descIndex: i,
        },
      });

      totalTokens += tokenCount;
    }

    return {
      tier: 'desc-prior',
      agents,
      tokenCount: totalTokens,
      metadata: {
        maxPrior,
        available: priorResults.length,
      },
    };
  }

  /**
   * Compose Tier 3: Active Window
   * Phase-aware window with dependency ordering
   *
   * @param targetAgent - Target agent
   * @param includeDependencies - Include dependency chain
   * @param budget - Remaining token budget
   * @param weights - Priority weights
   * @returns Active tier
   */
  private composeActiveTier(
    targetAgent: string | undefined,
    includeDependencies: boolean,
    budget: number,
    weights: Record<string, number>
  ): IContextTier {
    const windowEntries = this.rollingWindow.getWindow();
    const agents: IContextAgent[] = [];
    let totalTokens = 0;

    // Get dependency-ordered agents
    const agentIds = windowEntries.map(e => e.agentId);
    const orderedIds = includeDependencies && targetAgent
      ? this.getOrderedWithDependencies(targetAgent, agentIds)
      : this.dependencyTracker.getTopologicalOrder(agentIds);

    // Build agents in order
    for (const agentId of orderedIds) {
      const entry = windowEntries.find(e => e.agentId === agentId);
      if (!entry) continue;

      if (totalTokens + entry.tokenCount > budget) break;

      const isDependency = targetAgent
        ? this.dependencyTracker.getDependencies(targetAgent).has(agentId)
        : false;

      const priority = isDependency ? weights.dependency : weights.active;

      agents.push({
        agentId: entry.agentId,
        content: entry.content,
        tokenCount: entry.tokenCount,
        tier: 'active',
        priority,
        metadata: {
          phase: entry.phase,
          timestamp: entry.timestamp,
          isDependency,
        },
      });

      totalTokens += entry.tokenCount;
    }

    return {
      tier: 'active',
      agents,
      tokenCount: totalTokens,
      metadata: {
        windowSize: this.rollingWindow.size(),
        capacity: this.rollingWindow.getCapacity(),
        phase: this.rollingWindow.getPhase(),
      },
    };
  }

  /**
   * Compose Tier 4: Archived
   * Reference only, no token consumption
   *
   * @returns Archived tier
   */
  private composeArchivedTier(): IContextTier {
    const agents = Array.from(this.archivedAgents.values());

    return {
      tier: 'archived',
      agents: agents.map(a => ({
        ...a,
        tier: 'archived',
        priority: 1,
      })),
      tokenCount: 0, // Not included in budget
      metadata: {
        count: agents.length,
        note: 'Reference only, not included in token budget',
      },
    };
  }

  /**
   * Get dependency-ordered agents including target's dependencies
   * @param targetAgent - Target agent
   * @param availableAgents - Available agent IDs
   * @returns Ordered agent IDs
   */
  private getOrderedWithDependencies(
    targetAgent: string,
    availableAgents: string[]
  ): string[] {
    const dependencies = this.dependencyTracker.getTransitiveDependencies(targetAgent);
    const relevant = availableAgents.filter(
      id => id === targetAgent || dependencies.has(id)
    );
    return this.dependencyTracker.getTopologicalOrder(relevant);
  }

  /**
   * Add agent to rolling window
   * @param agentId - Agent ID
   * @param content - Agent content
   * @param tokenCount - Token count
   */
  public addToWindow(agentId: string, content: string, tokenCount: number): void {
    const evicted = this.rollingWindow.push(agentId, content, tokenCount);

    // Archive evicted agent
    if (evicted) {
      this.archivedAgents.set(evicted.agentId, {
        agentId: evicted.agentId,
        content: evicted.content,
        tokenCount: evicted.tokenCount,
        tier: 'archived',
        priority: 1,
        metadata: {
          evictedAt: Date.now(),
          phase: evicted.phase,
        },
      });
    }
  }

  /**
   * Add dependency relationship
   * @param dependent - Dependent agent
   * @param dependency - Dependency agent
   */
  public addDependency(dependent: string, dependency: string): void {
    this.dependencyTracker.addDependency(dependent, dependency);

    // Record cross-reference for auto-pinning
    const windowEntry = this.rollingWindow.getAgent(dependency);
    if (windowEntry) {
      this.pinningManager.recordCrossReference(
        dependency,
        windowEntry.content,
        windowEntry.tokenCount
      );
    }
  }

  /**
   * Pin agent to context
   * @param agentId - Agent to pin
   * @param content - Agent content
   * @param tokenCount - Token count
   * @param reason - Pin reason
   */
  public pin(
    agentId: string,
    content: string,
    tokenCount: number,
    reason: PinReason = PinReason.Manual
  ): void {
    this.pinningManager.pin(agentId, content, tokenCount, reason);
  }

  /**
   * Unpin agent
   * @param agentId - Agent to unpin
   */
  public unpin(agentId: string): void {
    this.pinningManager.unpin(agentId);
  }

  /**
   * Set DESC prior solutions for agent
   * @param agentId - Target agent
   * @param results - Prior solution results
   */
  public setDescPrior(agentId: string, results: IRetrievalResult[]): void {
    this.descPriorCache.set(agentId, results.slice(0, 2)); // Max 2
  }

  /**
   * Update research phase
   * Resizes rolling window automatically
   *
   * @param phase - New phase
   */
  public setPhase(phase: string): void {
    this.rollingWindow.resize(phase);
  }

  /**
   * Get composition statistics
   * @returns Engine metrics
   */
  public getStats() {
    return {
      rollingWindow: this.rollingWindow.getStats(),
      dependencies: this.dependencyTracker.getStats(),
      pinning: this.pinningManager.getStats(),
      archived: {
        count: this.archivedAgents.size,
        totalTokens: Array.from(this.archivedAgents.values())
          .reduce((sum, a) => sum + a.tokenCount, 0),
      },
      descPrior: {
        agentsWithPrior: this.descPriorCache.size,
        totalResults: Array.from(this.descPriorCache.values())
          .reduce((sum, results) => sum + results.length, 0),
      },
    };
  }

  /**
   * Clear all context
   */
  public clear(): void {
    this.rollingWindow.clear();
    this.dependencyTracker.clear();
    this.pinningManager.clear();
    this.descPriorCache.clear();
    this.archivedAgents.clear();
  }

  /**
   * Estimate tokens for content (simple heuristic)
   * @param content - Content to estimate
   * @returns Estimated token count
   */
  private estimateTokens(content: string): number {
    // Simple heuristic: ~4 characters per token
    return Math.ceil(content.length / 4);
  }

  /**
   * Get rolling window instance
   * @returns Rolling window
   */
  public getRollingWindow(): RollingWindow {
    return this.rollingWindow;
  }

  /**
   * Get dependency tracker instance
   * @returns Dependency tracker
   */
  public getDependencyTracker(): DependencyTracker {
    return this.dependencyTracker;
  }

  /**
   * Get pinning manager instance
   * @returns Pinning manager
   */
  public getPinningManager(): PinningManager {
    return this.pinningManager;
  }
}
