/**
 * RoutingHistory - Routing Decision Tracking
 *
 * Tracks routing decisions with explanations and pattern matches,
 * using a circular buffer with FIFO eviction.
 *
 * @module observability/routing-history
 * @see TASK-OBS-005-ROUTING-HISTORY.md
 * @see SPEC-OBS-001-CORE.md
 */

import { BUFFER_LIMITS } from './types.js';
import { ActivityStream } from './activity-stream.js';

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Agent candidate during routing
 */
export interface IAgentCandidate {
  /** Agent type identifier */
  agentType: string;
  /** Candidate score */
  score: number;
  /** Capabilities that matched */
  matchedCapabilities: string[];
  /** Confidence in this candidate */
  confidence: number;
}

/**
 * Pattern match information
 */
export interface IPatternMatch {
  /** Pattern identifier */
  patternId: string;
  /** Similarity score 0-1 */
  similarity: number;
  /** Source of the pattern */
  source: 'reasoning-bank' | 'cold-start';
}

/**
 * Routing decision input
 */
export interface IRoutingDecision {
  /** Original task description */
  taskDescription: string;
  /** Task type classification */
  taskType: string;
  /** Selected agent type */
  selectedAgent: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Alternative candidates considered */
  candidates: IAgentCandidate[];
  /** Reasoning steps taken */
  reasoningSteps: string[];
  /** Pattern matches (optional) */
  patternMatches?: IPatternMatch[];
  /** Whether cold start was used */
  coldStartUsed: boolean;
}

/**
 * Complete routing explanation with metadata
 */
export interface IRoutingExplanation {
  /** Unique routing ID (format: route_{timestamp}_{random}) */
  id: string;
  /** Decision timestamp (Unix epoch ms) */
  timestamp: number;
  /** Original task description */
  taskDescription: string;
  /** Task type classification */
  taskType: string;
  /** Selected agent type */
  selectedAgent: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Explanation details */
  explanation: {
    /** Human-readable summary */
    summary: string;
    /** Alternative candidates */
    candidates: IAgentCandidate[];
    /** Reasoning steps */
    reasoningSteps: string[];
    /** Pattern matches */
    patternMatches: IPatternMatch[];
    /** Cold start flag */
    coldStartUsed: boolean;
  };
}

/**
 * RoutingHistory interface
 * Implements [REQ-OBS-08]: Routing decision tracking
 * Implements [REQ-OBS-09]: Routing explanation details
 */
export interface IRoutingHistory {
  /**
   * Record a routing decision
   * @param decision Routing decision to record
   * @returns Unique routing ID
   */
  record(decision: IRoutingDecision): string;

  /**
   * Get routing explanation by ID
   * @param routingId Routing decision ID
   * @returns Routing explanation or null if not found
   */
  getById(routingId: string): IRoutingExplanation | null;

  /**
   * Get recent routing decisions
   * @param limit Maximum number to return (default: 10)
   * @returns Recent routing explanations
   */
  getRecent(limit?: number): IRoutingExplanation[];

  /**
   * Filter routing decisions by task type
   * @param taskType Task type to filter by
   * @returns Matching routing explanations
   */
  filterByTaskType(taskType: string): IRoutingExplanation[];

  /**
   * Filter routing decisions by selected agent
   * @param agentType Agent type to filter by
   * @returns Matching routing explanations
   */
  filterByAgent(agentType: string): IRoutingExplanation[];

  /**
   * Clear all routing history
   */
  clear(): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * RoutingHistory circular buffer implementation
 *
 * Implements:
 * - [REQ-OBS-08]: Routing decision tracking
 * - [REQ-OBS-09]: Routing explanation with confidence, factors, alternatives
 * - [RULE-OBS-004]: Maximum 100 routing decisions with FIFO eviction
 */
export class RoutingHistory implements IRoutingHistory {
  // Circular buffer storage
  private buffer: (IRoutingExplanation | null)[];
  private head: number = 0;  // Points to oldest element
  private tail: number = 0;  // Points to next write position
  private count: number = 0;
  private readonly maxSize: number;

  // Activity stream for event emission
  private activityStream?: ActivityStream;

  /**
   * Create a new RoutingHistory
   * @param activityStream Optional activity stream for event emission
   * @param maxSize Maximum buffer size (default: 100 per RULE-OBS-004)
   */
  constructor(
    activityStream?: ActivityStream,
    maxSize: number = BUFFER_LIMITS.ROUTING_HISTORY
  ) {
    this.maxSize = maxSize;
    this.activityStream = activityStream;
    // Pre-allocate buffer for memory efficiency
    this.buffer = new Array(maxSize).fill(null);
  }

  /**
   * Record a routing decision
   * Implements [REQ-OBS-08]: Record routing decisions
   * Implements [REQ-OBS-09]: Generate human-readable explanations
   */
  public record(decision: IRoutingDecision): string {
    const routingId = this.generateRoutingId();
    const timestamp = Date.now();

    // Generate human-readable summary
    const confidencePercent = Math.round(decision.confidence * 100);
    const summary = `Selected ${decision.selectedAgent} with ${confidencePercent}% confidence for ${decision.taskType} task`;

    const explanation: IRoutingExplanation = {
      id: routingId,
      timestamp,
      taskDescription: decision.taskDescription,
      taskType: decision.taskType,
      selectedAgent: decision.selectedAgent,
      confidence: decision.confidence,
      explanation: {
        summary,
        candidates: decision.candidates,
        reasoningSteps: decision.reasoningSteps,
        patternMatches: decision.patternMatches || [],
        coldStartUsed: decision.coldStartUsed,
      },
    };

    // Store in circular buffer
    this.buffer[this.tail] = explanation;
    this.tail = (this.tail + 1) % this.maxSize;

    if (this.count < this.maxSize) {
      this.count++;
    } else {
      // Buffer full - evict oldest (FIFO)
      this.head = (this.head + 1) % this.maxSize;
    }

    // Emit event to activity stream
    this.emitRoutingEvent(explanation);

    return routingId;
  }

  /**
   * Get routing explanation by ID
   */
  public getById(routingId: string): IRoutingExplanation | null {
    const all = this.getAllExplanations();
    return all.find(exp => exp.id === routingId) || null;
  }

  /**
   * Get recent routing decisions
   * @param limit Maximum number to return (default: 10)
   */
  public getRecent(limit: number = 10): IRoutingExplanation[] {
    const all = this.getAllExplanations();

    // Return most recent (already in chronological order, oldest first)
    // We want newest, so take from the end
    return all.slice(-limit);
  }

  /**
   * Filter routing decisions by task type
   */
  public filterByTaskType(taskType: string): IRoutingExplanation[] {
    const all = this.getAllExplanations();
    return all.filter(exp => exp.taskType === taskType);
  }

  /**
   * Filter routing decisions by selected agent
   */
  public filterByAgent(agentType: string): IRoutingExplanation[] {
    const all = this.getAllExplanations();
    return all.filter(exp => exp.selectedAgent === agentType);
  }

  /**
   * Clear all routing history
   */
  public clear(): void {
    this.buffer = new Array(this.maxSize).fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Get current count of routing decisions
   */
  public size(): number {
    return this.count;
  }

  /**
   * Check if buffer is full
   */
  public isFull(): boolean {
    return this.count >= this.maxSize;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate unique routing ID
   * Format: route_{timestamp}_{random}
   */
  private generateRoutingId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `route_${timestamp}_${random}`;
  }

  /**
   * Get all routing explanations in chronological order
   */
  private getAllExplanations(): IRoutingExplanation[] {
    if (this.count === 0) {
      return [];
    }

    const result: IRoutingExplanation[] = [];

    // Start from head (oldest) and collect all valid entries
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      const exp = this.buffer[idx];
      if (exp) {
        result.push(exp);
      }
      idx = (idx + 1) % this.maxSize;
    }

    return result;
  }

  /**
   * Emit routing decision event to activity stream
   */
  private emitRoutingEvent(explanation: IRoutingExplanation): void {
    if (!this.activityStream) {
      return;
    }

    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: explanation.timestamp,
      component: 'routing' as const,
      operation: 'routing_decision',
      status: 'success' as const,
      metadata: {
        routingId: explanation.id,
        selectedAgent: explanation.selectedAgent,
        taskType: explanation.taskType,
        confidence: explanation.confidence,
        coldStartUsed: explanation.explanation.coldStartUsed,
      },
    };

    this.activityStream.push(event);
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default RoutingHistory;
