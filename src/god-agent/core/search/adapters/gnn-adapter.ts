/**
 * GNN Enhancement Adapter
 * Integrates GNN Enhancer into Unified Search pipeline
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-GNN-003
 *
 * Enhances embeddings with graph context for improved search quality.
 * Implements circuit breaker pattern for resilience.
 *
 * @module src/god-agent/core/search/adapters/gnn-adapter
 */

import type { GNNEnhancer, TrajectoryGraph } from '../../reasoning/gnn-enhancer.js';
import type { FallbackGraph } from '../../graph-db/fallback-graph.js';

/**
 * GNN enhancement point in search pipeline
 */
export type GNNEnhancementPoint = 'pre_search' | 'post_search' | 'both' | 'none';

/**
 * GNN enhancement configuration
 */
export interface GNNEnhancementOptions {
  /** Enable GNN enhancement */
  enabled: boolean;

  /** When to enhance: before search, after, or both */
  enhancementPoint: GNNEnhancementPoint;

  /** Graph traversal depth for context building (default: 2) */
  graphDepth: number;

  /** Enhancement timeout in ms (default: 50ms) */
  timeout: number;

  /** Fallback to raw embeddings on error (default: true) */
  fallbackOnError: boolean;

  /** Cache enhanced embeddings (default: true) */
  cacheResults: boolean;

  /** Circuit breaker configuration */
  circuitBreaker?: {
    /** Enable circuit breaker (default: true) */
    enabled: boolean;

    /** Failure threshold before opening (default: 5) */
    threshold: number;

    /** Reset timeout in ms (default: 60000) */
    resetTimeout: number;
  };
}

/**
 * Default GNN enhancement options
 */
export const DEFAULT_GNN_OPTIONS: GNNEnhancementOptions = {
  enabled: false,
  enhancementPoint: 'pre_search',
  graphDepth: 2,
  timeout: 50,
  fallbackOnError: true,
  cacheResults: true,
  circuitBreaker: {
    enabled: true,
    threshold: 5,
    resetTimeout: 60000,
  },
};

/**
 * Circuit breaker states
 */
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker for GNN enhancement
 * Protects search pipeline from cascading failures
 */
class GNNCircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly threshold: number,
    private readonly resetTimeout: number
  ) { }

  /**
   * Execute function with circuit breaker protection
   *
   * @param fn - Function to execute
   * @param fallback - Fallback value on failure or open circuit
   * @returns Result or fallback
   */
  async execute<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    // Check if circuit should close after timeout
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.resetTimeout) {
        this.state = 'half-open';
        this.successCount = 0;
      } else {
        return fallback; // Circuit open, return fallback immediately
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      return fallback;
    }
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Get circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailures(): number {
    return this.failures;
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      // Require 2 successes to close circuit
      if (this.successCount >= 2) {
        this.state = 'closed';
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  /**
   * Manually reset circuit
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
  }
}

/**
 * GNN enhancement statistics
 */
export interface GNNEnhancementStats {
  /** Total enhancements attempted */
  totalAttempts: number;

  /** Successful enhancements */
  successes: number;

  /** Failures (returned to fallback) */
  failures: number;

  /** Timeouts */
  timeouts: number;

  /** Circuit breaker trips */
  circuitBreakerTrips: number;

  /** Average enhancement time (ms) */
  avgEnhancementTime: number;

  /** Circuit breaker state */
  circuitState: CircuitState;
}

/**
 * GNN Search Adapter
 * Integrates GNN Enhancer into search pipeline with circuit breaker
 */
export class GNNSearchAdapter {
  private readonly gnnEnhancer: GNNEnhancer;
  private readonly graphDb: FallbackGraph;
  private readonly circuitBreaker: GNNCircuitBreaker | null;
  private options: GNNEnhancementOptions;

  // Statistics
  private totalAttempts = 0;
  private successes = 0;
  private failures = 0;
  private timeouts = 0;
  private circuitBreakerTrips = 0;
  private totalEnhancementTime = 0;

  /**
   * Create GNN search adapter
   *
   * @param gnnEnhancer - GNN enhancer instance
   * @param graphDb - Graph database for context building
   * @param options - Enhancement configuration
   */
  constructor(
    gnnEnhancer: GNNEnhancer,
    graphDb: FallbackGraph,
    options?: Partial<GNNEnhancementOptions>
  ) {
    this.gnnEnhancer = gnnEnhancer;
    this.graphDb = graphDb;
    this.options = { ...DEFAULT_GNN_OPTIONS, ...options };

    // Initialize circuit breaker if enabled
    if (this.options.circuitBreaker?.enabled) {
      this.circuitBreaker = new GNNCircuitBreaker(
        this.options.circuitBreaker.threshold,
        this.options.circuitBreaker.resetTimeout
      );
    } else {
      this.circuitBreaker = null;
    }
  }

  /**
   * Enhance embedding with GNN
   *
   * @param embedding - Raw embedding (VECTOR_DIM, default 1536D)
   * @param query - Query string for graph context
   * @returns Enhanced embedding (1024D) or original on failure
   */
  async enhance(
    embedding: Float32Array,
    query: string
  ): Promise<Float32Array> {
    // Check if enhancement is disabled
    if (!this.options.enabled) {
      return embedding;
    }

    this.totalAttempts++;

    // Build enhancement function
    const enhancementFn = async (): Promise<Float32Array> => {
      const startTime = performance.now();

      try {
        // Build graph context from query
        const graph = await this.buildGraphContext(query, this.options.graphDepth);

        // Enhance with timeout
        const enhancePromise = this.gnnEnhancer.enhance(embedding, graph);
        const result = await this.withTimeout(
          enhancePromise,
          this.options.timeout
        );

        const duration = performance.now() - startTime;
        this.totalEnhancementTime += duration;
        this.successes++;

        return result.enhanced;
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          this.timeouts++;
          // RULE-070: Re-throw timeout with context
          throw new Error(
            `GNN enhancement timed out after ${this.options.timeout}ms`,
            { cause: error }
          );
        } else {
          this.failures++;
          // RULE-070: Re-throw with operation context
          throw new Error(
            `GNN enhancement failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          );
        }
      }
    };

    // Execute with circuit breaker if enabled
    if (this.circuitBreaker) {
      if (this.circuitBreaker.isOpen()) {
        this.circuitBreakerTrips++;
      }

      return this.circuitBreaker.execute(enhancementFn, embedding);
    }

    // Execute without circuit breaker
    try {
      return await enhancementFn();
    } catch (error) {
      if (this.options.fallbackOnError) {
        return embedding; // Graceful fallback
      }
      // RULE-070: Re-throw with operation context
      throw new Error(
        `GNN search enhancement failed without circuit breaker: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Build graph context from query
   *
   * @param query - Query string
   * @param depth - Traversal depth
   * @returns Trajectory graph for enhancement
   */
  private async buildGraphContext(
    query: string,
    depth: number
  ): Promise<TrajectoryGraph | undefined> {
    try {
      // Extract entities from query (simple approach: use words)
      const entities = this.extractEntities(query);

      if (entities.length === 0) {
        return undefined;
      }

      // Find graph nodes for entities
      const nodes = await this.findGraphNodes(entities, depth);

      if (nodes.length === 0) {
        return undefined;
      }

      // Build trajectory graph structure
      return {
        nodes: nodes.map((node) => ({
          id: node.id,
          embedding: node.embedding,
          metadata: node.metadata,
        })),
        // Let GNN enhancer build edges from embeddings
        edges: undefined,
      };
    } catch (error) {
      // Return undefined on error - GNN will use simple projection
      return undefined;
    }
  }

  /**
   * Extract entities from query
   * Simple word-based extraction (could be enhanced with NER)
   */
  private extractEntities(query: string): string[] {
    // Remove common stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
      'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'should', 'could', 'can', 'may', 'might', 'must',
    ]);

    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .slice(0, 10); // Limit to 10 entities
  }

  /**
   * Find graph nodes related to entities
   *
   * @param entities - Entity strings
   * @param depth - Traversal depth
   * @returns Graph nodes with embeddings
   */
  private async findGraphNodes(
    entities: string[],
    depth: number
  ): Promise<Array<{ id: string; embedding: Float32Array; metadata?: Record<string, unknown> }>> {
    const nodes: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, unknown> }> = [];

    for (const entity of entities) {
      try {
        // Find nodes matching entity (placeholder - actual implementation depends on graph schema)
        // For now, return empty array to avoid errors
        // In production: query graphDb for nodes matching entity
      } catch (error) {
        // Skip failed lookups
        continue;
      }
    }

    return nodes;
  }

  /**
   * Execute promise with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('GNN enhancement timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Get enhancement statistics
   */
  getStats(): GNNEnhancementStats {
    return {
      totalAttempts: this.totalAttempts,
      successes: this.successes,
      failures: this.failures,
      timeouts: this.timeouts,
      circuitBreakerTrips: this.circuitBreakerTrips,
      avgEnhancementTime:
        this.successes > 0 ? this.totalEnhancementTime / this.successes : 0,
      circuitState: this.circuitBreaker?.getState() || 'closed',
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalAttempts = 0;
    this.successes = 0;
    this.failures = 0;
    this.timeouts = 0;
    this.circuitBreakerTrips = 0;
    this.totalEnhancementTime = 0;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker?.reset();
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<GNNEnhancementOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): GNNEnhancementOptions {
    return { ...this.options };
  }
}
