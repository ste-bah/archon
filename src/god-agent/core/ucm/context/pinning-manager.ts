/**
 * Pinning Manager
 * TASK-UCM-CTX-003
 *
 * Manages pinned agents that should always be included in context.
 * RULE-017: Maximum 2000 tokens for pinned content
 * Auto-pins agents when cross-reference threshold is exceeded.
 */

import { BudgetExceededError } from '../errors.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';

/**
 * Pinned agent entry
 */
interface IPinnedEntry {
  agentId: string;
  content: string;
  tokenCount: number;
  pinnedAt: number;
  reason: PinReason;
  priority: number;
}

/**
 * Reason for pinning
 */
export enum PinReason {
  Manual = 'manual',
  CrossReference = 'cross-reference',
  Foundational = 'foundational',
  HighReuse = 'high-reuse',
}

/**
 * Pinning Manager
 * Maintains set of always-included agents with token budget enforcement
 */
export class PinningManager {
  private pinned: Map<string, IPinnedEntry> = new Map();
  private maxTokens: number;
  private crossRefThreshold: number;
  private crossRefCounts: Map<string, number> = new Map();

  constructor(
    maxTokens: number = 2000,
    crossRefThreshold: number = 3
  ) {
    this.maxTokens = maxTokens;
    this.crossRefThreshold = crossRefThreshold;
  }

  /**
   * Pin an agent to context
   * RULE-017: Enforce 2000 token maximum
   *
   * @param agentId - Agent to pin
   * @param content - Agent content
   * @param tokenCount - Token count for content
   * @param reason - Reason for pinning
   * @param priority - Priority level (higher = more important)
   * @throws BudgetExceededError if pinning would exceed budget
   */
  public pin(
    agentId: string,
    content: string,
    tokenCount: number,
    reason: PinReason = PinReason.Manual,
    priority: number = 1
  ): void {
    // Check if already pinned
    const existing = this.pinned.get(agentId);
    if (existing) {
      // Update if needed
      if (existing.content === content && existing.reason === reason) {
        return;
      }
      // Unpin first to free tokens
      this.unpin(agentId);
    }

    // Check budget
    const currentTokens = this.getTotalTokens();
    if (currentTokens + tokenCount > this.maxTokens) {
      // Try to make space by evicting lowest priority
      if (!this.makeSpace(tokenCount, priority)) {
        throw new BudgetExceededError(currentTokens + tokenCount, this.maxTokens, `pinning-${agentId}`);
      }
    }

    // Pin agent
    this.pinned.set(agentId, {
      agentId,
      content,
      tokenCount,
      pinnedAt: Date.now(),
      reason,
      priority,
    });
  }

  /**
   * Unpin an agent
   * @param agentId - Agent to unpin
   * @returns True if was pinned and removed
   */
  public unpin(agentId: string): boolean {
    return this.pinned.delete(agentId);
  }

  /**
   * Check if agent is pinned
   * @param agentId - Agent to check
   * @returns True if pinned
   */
  public isPinned(agentId: string): boolean {
    return this.pinned.has(agentId);
  }

  /**
   * Get all pinned agents
   * @returns Array of pinned entries sorted by priority (highest first)
   */
  public getPinned(): readonly IPinnedEntry[] {
    return Array.from(this.pinned.values())
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get specific pinned agent
   * @param agentId - Agent to retrieve
   * @returns Pinned entry or null
   */
  public getPinnedAgent(agentId: string): IPinnedEntry | null {
    return this.pinned.get(agentId) ?? null;
  }

  /**
   * Check if can pin new agent
   * @param tokenCount - Tokens needed
   * @param priority - Priority of new pin
   * @returns True if can accommodate
   */
  public canPin(tokenCount: number, priority: number = 1): boolean {
    const currentTokens = this.getTotalTokens();

    // Direct fit
    if (currentTokens + tokenCount <= this.maxTokens) {
      return true;
    }

    // Check if can make space
    return this.canMakeSpace(tokenCount, priority);
  }

  /**
   * Try to make space by evicting lower priority pins
   * @param needed - Tokens needed
   * @param priority - Priority of new pin
   * @returns True if space made
   */
  private makeSpace(needed: number, priority: number): boolean {
    const currentTokens = this.getTotalTokens();
    const toFree = currentTokens + needed - this.maxTokens;

    if (toFree <= 0) return true;

    // Get candidates for eviction (lower priority than new pin)
    const candidates = Array.from(this.pinned.values())
      .filter(p => p.priority < priority)
      .sort((a, b) => a.priority - b.priority); // Lowest priority first

    let freed = 0;
    const toEvict: string[] = [];

    for (const candidate of candidates) {
      toEvict.push(candidate.agentId);
      freed += candidate.tokenCount;
      if (freed >= toFree) break;
    }

    if (freed < toFree) return false;

    // Evict
    for (const agentId of toEvict) {
      this.unpin(agentId);
    }

    return true;
  }

  /**
   * Check if can make space without actually evicting
   * @param needed - Tokens needed
   * @param priority - Priority of new pin
   * @returns True if space could be made
   */
  private canMakeSpace(needed: number, priority: number): boolean {
    const currentTokens = this.getTotalTokens();
    const toFree = currentTokens + needed - this.maxTokens;

    if (toFree <= 0) return true;

    const evictable = Array.from(this.pinned.values())
      .filter(p => p.priority < priority)
      .reduce((sum, p) => sum + p.tokenCount, 0);

    return evictable >= toFree;
  }

  /**
   * Record cross-reference to agent
   * Auto-pins if threshold exceeded
   *
   * @param agentId - Referenced agent
   * @param content - Agent content (for auto-pin)
   * @param tokenCount - Token count (for auto-pin)
   */
  public recordCrossReference(
    agentId: string,
    content?: string,
    tokenCount?: number
  ): void {
    const count = (this.crossRefCounts.get(agentId) ?? 0) + 1;
    this.crossRefCounts.set(agentId, count);

    // Auto-pin if threshold exceeded and not already pinned
    if (
      count >= this.crossRefThreshold &&
      !this.isPinned(agentId) &&
      content &&
      tokenCount !== undefined
    ) {
      try {
        this.pin(
          agentId,
          content,
          tokenCount,
          PinReason.CrossReference,
          2 // Medium-high priority
        );
      } catch (error) {
        // Failed to auto-pin due to budget - that's ok
        console.warn(`Failed to auto-pin ${agentId} on cross-reference threshold:`, error);
      }
    }
  }

  /**
   * Get cross-reference count for agent
   * @param agentId - Agent to query
   * @returns Number of cross-references
   */
  public getCrossRefCount(agentId: string): number {
    return this.crossRefCounts.get(agentId) ?? 0;
  }

  /**
   * Get total pinned token count
   * @returns Sum of all pinned tokens
   */
  public getTotalTokens(): number {
    return Array.from(this.pinned.values())
      .reduce((sum, entry) => sum + entry.tokenCount, 0);
  }

  /**
   * Get available token budget
   * @returns Remaining tokens before limit
   */
  public getAvailableTokens(): number {
    return Math.max(0, this.maxTokens - this.getTotalTokens());
  }

  /**
   * Get pinning statistics
   * @returns Pinning metrics
   */
  public getStats() {
    const entries = Array.from(this.pinned.values());
    const byReason = entries.reduce((acc, entry) => {
      acc[entry.reason] = (acc[entry.reason] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      pinnedCount: this.pinned.size,
      totalTokens: this.getTotalTokens(),
      availableTokens: this.getAvailableTokens(),
      utilization: this.maxTokens > 0 ? this.getTotalTokens() / this.maxTokens : 0,
      maxTokens: this.maxTokens,
      byReason,
      avgTokensPerPin: entries.length > 0
        ? this.getTotalTokens() / entries.length
        : 0,
      crossRefThreshold: this.crossRefThreshold,
      autoPinCandidates: Array.from(this.crossRefCounts.entries())
        .filter(([id, count]) => count >= this.crossRefThreshold && !this.isPinned(id))
        .map(([id, count]) => ({ agentId: id, crossRefs: count })),
    };
  }

  /**
   * Clear all pinned agents
   * @returns Cleared entries
   */
  public clear(): IPinnedEntry[] {
    const cleared = Array.from(this.pinned.values());
    this.pinned.clear();
    this.crossRefCounts.clear();
    return cleared;
  }

  /**
   * Update max token budget
   * May evict lowest priority pins if budget reduced
   *
   * @param newMax - New maximum tokens
   */
  public setMaxTokens(newMax: number): void {
    this.maxTokens = newMax;

    // Evict lowest priority if over budget
    while (this.getTotalTokens() > this.maxTokens) {
      const lowestPriority = Array.from(this.pinned.values())
        .sort((a, b) => a.priority - b.priority)[0];

      if (!lowestPriority) break;
      this.unpin(lowestPriority.agentId);
    }
  }

  /**
   * Update cross-reference threshold
   * @param threshold - New threshold
   */
  public setCrossRefThreshold(threshold: number): void {
    this.crossRefThreshold = threshold;
  }
}
