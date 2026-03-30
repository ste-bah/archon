/**
 * Rolling Window Manager
 * TASK-UCM-CTX-001
 *
 * Implements phase-aware rolling window for active agent context.
 * RULE-010 to RULE-014: Different window sizes per phase
 * - Planning: 2 agents
 * - Research: 3 agents
 * - Writing: 5 agents
 * - QA: 10 agents
 *
 * Uses FIFO queue with automatic eviction when capacity exceeded.
 */

import type { IPhaseSettings, IRetrievalResult } from '../types.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';

/**
 * Phase-aware window size configuration
 * Maps research phase to maximum number of agents in window
 */
const PHASE_WINDOW_SIZES: Record<string, number> = {
  planning: 2,
  research: 3,
  writing: 5,
  qa: 10,
};

/**
 * Rolling window entry
 * Contains agent context and metadata
 */
interface IWindowEntry {
  agentId: string;
  content: string;
  tokenCount: number;
  timestamp: number;
  phase: string;
}

/**
 * Rolling Window Manager
 * Maintains FIFO queue of active agents with phase-aware sizing
 */
export class RollingWindow {
  private window: IWindowEntry[] = [];
  private currentPhase: string = 'research';
  private capacity: number;

  constructor(
    initialPhase: string = 'research',
    customCapacity?: number
  ) {
    this.currentPhase = initialPhase.toLowerCase();
    this.capacity = customCapacity ?? this.getPhaseCapacity(this.currentPhase);
  }

  /**
   * Get window capacity for current phase
   * RULE-010 to RULE-014
   */
  private getPhaseCapacity(phase: string): number {
    return PHASE_WINDOW_SIZES[phase.toLowerCase()] ?? 3; // Default to research window size
  }

  /**
   * Push new agent into window
   * Auto-evicts oldest if capacity exceeded (FIFO)
   *
   * @param agentId - Unique agent identifier
   * @param content - Agent context content
   * @param tokenCount - Token count for content
   * @returns Evicted entry if any
   */
  public push(agentId: string, content: string, tokenCount: number): IWindowEntry | null {
    const entry: IWindowEntry = {
      agentId,
      content,
      tokenCount,
      timestamp: Date.now(),
      phase: this.currentPhase,
    };

    // Check if agent already in window - update instead
    const existingIndex = this.window.findIndex(e => e.agentId === agentId);
    if (existingIndex !== -1) {
      this.window.splice(existingIndex, 1);
    }

    // Add to end of queue
    this.window.push(entry);

    // Evict oldest if over capacity (FIFO)
    if (this.window.length > this.capacity) {
      return this.window.shift() ?? null;
    }

    return null;
  }

  /**
   * Remove and return oldest entry (FIFO pop)
   * @returns Oldest entry or null if empty
   */
  public pop(): IWindowEntry | null {
    return this.window.shift() ?? null;
  }

  /**
   * Get current window contents
   * @returns Array of window entries in order (oldest to newest)
   */
  public getWindow(): readonly IWindowEntry[] {
    return [...this.window];
  }

  /**
   * Get specific agent from window
   * @param agentId - Agent to retrieve
   * @returns Entry if found, null otherwise
   */
  public getAgent(agentId: string): IWindowEntry | null {
    return this.window.find(e => e.agentId === agentId) ?? null;
  }

  /**
   * Check if agent is in window
   * @param agentId - Agent to check
   * @returns True if in window
   */
  public hasAgent(agentId: string): boolean {
    return this.window.some(e => e.agentId === agentId);
  }

  /**
   * Remove specific agent from window
   * @param agentId - Agent to remove
   * @returns Removed entry or null
   */
  public remove(agentId: string): IWindowEntry | null {
    const index = this.window.findIndex(e => e.agentId === agentId);
    if (index === -1) return null;

    const [removed] = this.window.splice(index, 1);
    return removed;
  }

  /**
   * Resize window for new phase
   * RULE-010 to RULE-014: Phase-specific window sizes
   *
   * @param phase - New research phase
   * @returns Evicted entries if downsizing
   */
  public resize(phase: string): IWindowEntry[] {
    this.currentPhase = phase.toLowerCase();
    this.capacity = this.getPhaseCapacity(this.currentPhase);

    // Evict oldest entries if over new capacity
    const evicted: IWindowEntry[] = [];
    while (this.window.length > this.capacity) {
      const entry = this.window.shift();
      if (entry) evicted.push(entry);
    }

    return evicted;
  }

  /**
   * Get current window size
   * @returns Number of entries in window
   */
  public size(): number {
    return this.window.length;
  }

  /**
   * Get current capacity
   * @returns Maximum window size for current phase
   */
  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get current phase
   * @returns Active research phase
   */
  public getPhase(): string {
    return this.currentPhase;
  }

  /**
   * Get total token count in window
   * @returns Sum of all entry token counts
   */
  public getTotalTokens(): number {
    return this.window.reduce((sum, entry) => sum + entry.tokenCount, 0);
  }

  /**
   * Clear all entries from window
   * @returns All cleared entries
   */
  public clear(): IWindowEntry[] {
    const cleared = [...this.window];
    this.window = [];
    return cleared;
  }

  /**
   * Get window statistics
   * @returns Window metrics and status
   */
  public getStats() {
    return {
      size: this.window.length,
      capacity: this.capacity,
      utilization: this.capacity > 0 ? this.window.length / this.capacity : 0,
      totalTokens: this.getTotalTokens(),
      phase: this.currentPhase,
      agents: this.window.map(e => ({
        agentId: e.agentId,
        tokenCount: e.tokenCount,
        age: Date.now() - e.timestamp,
      })),
    };
  }
}
