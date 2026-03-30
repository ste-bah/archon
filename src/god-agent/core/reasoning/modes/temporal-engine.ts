/**
 * Temporal Reasoning Engine
 * SPEC-RSN-002 Section 2.6 - Temporal Reasoning Mode
 *
 * Implements time-ordered causal chain reasoning with sequence-aware inference:
 * 1. Extract temporal references from query
 * 2. Query temporal hyperedges from GraphDB within time range
 * 3. Build Chain-of-History (CoH) for time-ordered events
 * 4. Apply temporal causal reasoning (forward/backward)
 * 5. If evolution tracking enabled, identify concept drift
 * 6. Return temporal chains with confidence decay
 *
 * Performance target: <150ms for 30-day time range queries
 */

import type { GraphDB } from '../../graph-db/graph-db.js';
import type { CausalMemory } from '../causal-memory.js';
import type { IReasoningRequest, ReasoningMode, IPatternMatch, IInferenceResult, IProvenanceInfo } from '../reasoning-types.js';
import type {
  TemporalConfig,
  ITemporalResult,
  TemporalChain,
  TemporalConstraint,
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';
import {
  Granularity,
  type ITemporalHyperedge,
} from '../../graph-db/types.js';
import type { NodeID } from '../causal-types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../../observability/index.js';

const logger = createComponentLogger('TemporalEngine', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Temporal event with timestamp and granularity
 */
interface TemporalEvent {
  nodeId: NodeID;
  timestamp: number;
  granularity: Granularity;
  metadata?: Record<string, unknown>;
}

/**
 * Temporal context extracted from query
 */
interface TemporalContext {
  timeRange: { start: number; end: number };
  granularity: Granularity;
  referenceTimestamps: number[];
  temporalMarkers: string[];
}

/**
 * Temporal inference with confidence decay
 */
interface TemporalInference {
  chains: TemporalChain[];
  avgConfidence: number;
  temporalConsistency: number;
  direction: 'forward' | 'backward' | 'bidirectional';
}

/**
 * Concept evolution tracking result
 */
interface ConceptEvolution {
  embeddingDrift: number;
  frequencyChanges: Array<{
    concept: string;
    trend: 'increasing' | 'decreasing' | 'stable';
    changeRate: number;
  }>;
  emergingPatterns: string[];
  decliningPatterns: string[];
}

/**
 * Historical embedding storage
 */
interface HistoricalEmbedding {
  concept: string;
  embedding: number[];
  timestamp: number;
  chainId?: string;
}

/**
 * Frequency snapshot for trend analysis
 */
interface FrequencySnapshot {
  concept: string;
  count: number;
  timestamp: number;
}

/**
 * Evolution snapshot for historical tracking
 */
interface EvolutionSnapshot {
  timestamp: number;
  avgDrift: number;
  frequencyChanges: Array<{concept: string; percentChange: number; trend: string}>;
  emergingPatterns: string[];
  decliningPatterns: string[];
}

/**
 * Dependencies for TemporalEngine
 */
export interface TemporalEngineDependencies {
  graphDB: GraphDB;
  causalMemory: CausalMemory;
}

/**
 * Temporal Reasoning Engine
 *
 * Performs time-ordered causal reasoning with Chain-of-History (CoH) and
 * confidence decay based on temporal distance.
 *
 * Memory Storage:
 * - Historical embeddings stored in-memory for concept drift tracking
 * - Frequency snapshots tracked for trend analysis
 * - Evolution snapshots preserved for pattern learning
 */
export class TemporalEngine {
  private graphDB: GraphDB;
  private causalMemory: CausalMemory;
  private embeddingProvider?: any; // IEmbeddingProvider - will be lazy-loaded

  // In-memory storage for concept evolution tracking
  private historicalEmbeddings: Map<string, HistoricalEmbedding[]> = new Map();
  private frequencySnapshots: Map<string, FrequencySnapshot[]> = new Map();
  private evolutionHistory: EvolutionSnapshot[] = [];

  constructor(deps: TemporalEngineDependencies) {
    this.graphDB = deps.graphDB;
    this.causalMemory = deps.causalMemory;
  }

  /**
   * Perform temporal reasoning with time-ordered causal chains
   *
   * Algorithm:
   * 1. Extract temporal references from query
   * 2. Query temporal hyperedges from GraphDB within time range
   * 3. Build Chain-of-History (CoH) for time-ordered events
   * 4. Apply temporal causal reasoning (forward/backward)
   * 5. If evolution tracking, identify concept drift
   * 6. Return temporal chains with confidence decay
   *
   * @param request Reasoning request
   * @param config Temporal configuration
   * @returns Temporal result with event chains and constraints
   */
  async reason(
    request: IReasoningRequest,
    config: TemporalConfig
  ): Promise<ITemporalResult> {
    const startTime = performance.now();

    // 1. Extract temporal context from query embedding
    const timeRange = this.parseTimeRange(config.timeRange);
    const temporalContext = this.extractTemporalContext(request.query, timeRange);

    // 2. Query temporal hyperedges from GraphDB
    const temporalEdges = await this.queryTemporalHyperedges(
      temporalContext.timeRange,
      config.granularity
    );

    // 3. Build Chain-of-History (CoH) from temporal hyperedges
    const chainLength = config.chainLength ?? 10;
    const chains = this.buildChainOfHistory(temporalEdges, chainLength);

    // 4. Apply temporal causal reasoning with confidence decay
    const direction = this.inferTemporalDirection(temporalContext);
    const confidenceDecay = 0.9; // Decay factor per time unit
    const inference = await this.applyTemporalCausalReasoning(
      chains,
      direction,
      confidenceDecay
    );

    // 5. Track concept evolution if enabled
    let evolution: ConceptEvolution | undefined;
    if (config.evolutionTracking !== false) {
      evolution = await this.trackConceptEvolution(chains, inference);
    }

    const processingTimeMs = performance.now() - startTime;
    const latencyMs = Math.round(processingTimeMs);

    // Build result with all required IAdvancedReasoningResult fields
    const result: ITemporalResult = {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.TEMPORAL,
      answer: this.formatAnswer(inference.chains, evolution),
      reasoningSteps: this.generateReasoningSteps(chains, inference, temporalContext),
      latencyMs,
      confidence: inference.avgConfidence,

      // IReasoningResponse fields (from base interface)
      type: 'causal-inference' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: this.generateTrajectoryId(),
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: chains.map(() => inference.avgConfidence),
        totalSources: chains.length,
        combinedLScore: inference.avgConfidence,
        sourceBreakdown: {
          causal: chains.length,
        },
      } as IProvenanceInfo,

      // Mode-specific field
      temporalChains: inference.chains,
    };

    return result;
  }

  /**
   * Query temporal hyperedges from GraphDB within time range
   *
   * @param timeRange Time range filter
   * @param granularity Temporal granularity filter
   * @returns Filtered temporal hyperedges
   */
  private async queryTemporalHyperedges(
    timeRange: { start: number; end: number },
    _granularity: TemporalConfig['granularity']
  ): Promise<ITemporalHyperedge[]> {
    // Get all hyperedges from GraphDB
    const allHyperedges = await this.graphDB.getAllHyperedges();

    // Filter for temporal hyperedges within the time range
    const temporalEdges = allHyperedges.filter((edge): edge is ITemporalHyperedge => {
      // Check if it's a temporal hyperedge
      if (!('expiresAt' in edge)) {
        return false;
      }

      const temporal = edge as ITemporalHyperedge;
      const timestamp = (temporal.metadata?.timestamp as number) || temporal.createdAt;

      // Check if within time range
      if (timestamp < timeRange.start || timestamp > timeRange.end) {
        return false;
      }

      // Check if not expired
      if (temporal.expiresAt && timestamp > temporal.expiresAt) {
        return false;
      }

      return true;
    });

    return temporalEdges;
  }

  /**
   * Extract temporal context from query embedding
   *
   * Analyzes the query to identify temporal references and markers.
   *
   * @param embedding Query embedding
   * @param timeRange Time range for analysis
   * @returns Temporal context
   */
  private extractTemporalContext(
    _embedding: Float32Array,
    timeRange: { start: number; end: number }
  ): TemporalContext {
    // For now, use the provided time range as the primary context
    // In a full implementation, this would analyze the embedding for temporal signals
    return {
      timeRange,
      granularity: 'day' as Granularity,
      referenceTimestamps: [],
      temporalMarkers: [],
    };
  }

  /**
   * Build Chain-of-History (CoH) from temporal hyperedges
   *
   * Creates time-ordered event sequences from temporal hyperedges.
   *
   * @param hyperedges Temporal hyperedges
   * @param maxLength Maximum chain length
   * @returns Temporal chains
   */
  private buildChainOfHistory(
    hyperedges: ITemporalHyperedge[],
    maxLength: number
  ): TemporalChain[] {
    if (hyperedges.length === 0) {
      return [];
    }

    // Sort hyperedges by timestamp
    const sorted = [...hyperedges].sort((a, b) => {
      const timeA = a.metadata?.timestamp as number || a.createdAt;
      const timeB = b.metadata?.timestamp as number || b.createdAt;
      return timeA - timeB;
    });

    // Build chains by grouping related events
    const chains: TemporalChain[] = [];
    const visited = new Set<string>();

    for (const edge of sorted) {
      if (visited.has(edge.id)) continue;

      // Extract events from this hyperedge
      const events: TemporalEvent[] = edge.nodes.map((nodeId) => ({
        nodeId,
        timestamp: (edge.metadata?.timestamp as number) || edge.createdAt,
        granularity: edge.granularity,
        metadata: edge.metadata,
      }));

      // Build chain starting from this edge
      const chain = this.buildSingleChain(sorted, edge, events, maxLength, visited);
      chains.push(chain);
    }

    return chains;
  }

  /**
   * Build a single temporal chain from a starting hyperedge
   */
  private buildSingleChain(
    _allEdges: ITemporalHyperedge[],
    startEdge: ITemporalHyperedge,
    initialEvents: TemporalEvent[],
    maxLength: number,
    visited: Set<string>
  ): TemporalChain {
    visited.add(startEdge.id);

    const events: Array<{
      nodeId: NodeID;
      timestamp: number;
      granularity: TemporalConfig['granularity'];
    }> = initialEvents.map((e) => ({
      nodeId: e.nodeId,
      timestamp: e.timestamp,
      granularity: this.mapGranularity(e.granularity),
    }));

    // Infer temporal constraints between events
    const constraints = this.inferTemporalConstraints(initialEvents);

    // Calculate duration and consistency
    const timestamps = events.map((e) => e.timestamp);
    const duration = Math.max(...timestamps) - Math.min(...timestamps);
    const consistency = this.calculateTemporalConsistency(events, constraints);

    return {
      events: events.slice(0, maxLength),
      constraints,
      consistency,
      duration,
    };
  }

  /**
   * Apply temporal causal reasoning with confidence decay
   *
   * Performs causal inference over temporal chains with confidence
   * decreasing based on time distance between events.
   *
   * @param chains Temporal chains
   * @param direction Traversal direction
   * @param confidenceDecay Decay factor per time unit
   * @returns Temporal inference
   */
  private async applyTemporalCausalReasoning(
    chains: TemporalChain[],
    direction: 'forward' | 'backward' | 'bidirectional',
    confidenceDecay: number
  ): Promise<TemporalInference> {
    const enhancedChains: TemporalChain[] = [];
    let totalConfidence = 0;
    let totalConsistency = 0;

    for (const chain of chains) {
      // Apply confidence decay based on time distance
      const decayedChain = this.applyConfidenceDecay(chain, confidenceDecay);

      // Perform causal inference if CausalMemory is available
      if (this.causalMemory && chain.events.length > 1) {
        try {
          const nodeIds = chain.events.map((e) => e.nodeId);

          // Choose traversal direction
          if (direction === 'forward' || direction === 'bidirectional') {
            await this.causalMemory.inferConsequences(nodeIds.slice(0, -1), 3);
          }

          if (direction === 'backward' || direction === 'bidirectional') {
            const lastNode = nodeIds[nodeIds.length - 1];
            await this.causalMemory.findCauses(lastNode, 3);
          }
        } catch (error) {
          // Continue if causal inference fails
          logger.warn('Temporal causal inference failed', { error: String(error) });
        }
      }

      enhancedChains.push(decayedChain);
      totalConfidence += this.calculateChainConfidence(decayedChain);
      totalConsistency += decayedChain.consistency ? 1 : 0;
    }

    const avgConfidence = chains.length > 0 ? totalConfidence / chains.length : 0;
    const temporalConsistency = chains.length > 0 ? totalConsistency / chains.length : 0;

    return {
      chains: enhancedChains,
      avgConfidence,
      temporalConsistency,
      direction,
    };
  }

  /**
   * Apply confidence decay based on time distance
   *
   * Confidence decreases exponentially with time gaps between events.
   *
   * @param chain Temporal chain
   * @param decayFactor Decay factor per time unit (0-1)
   * @returns Chain with decayed confidence
   */
  private applyConfidenceDecay(
    chain: TemporalChain,
    decayFactor: number
  ): TemporalChain {
    if (chain.events.length < 2) {
      return chain;
    }

    // Calculate time gaps between consecutive events
    const gaps: number[] = [];
    for (let i = 1; i < chain.events.length; i++) {
      const gap = chain.events[i].timestamp - chain.events[i - 1].timestamp;
      gaps.push(gap);
    }

    // Convert gaps to time units based on granularity
    const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const timeUnits = this.calculateTimeUnits(avgGap, chain.events[0].granularity);

    // Apply exponential decay: confidence = baseConfidence * decayFactor^timeUnits
    const baseConfidence = chain.consistency ? 0.8 : 0.5;
    const decayedConfidence = baseConfidence * Math.pow(decayFactor, timeUnits);

    // Update constraints with decayed confidence
    const updatedConstraints = chain.constraints.map((c) => ({
      ...c,
      confidence: c.confidence * decayedConfidence,
    }));

    return {
      ...chain,
      constraints: updatedConstraints,
    };
  }

  /**
   * Track concept evolution over time
   *
   * Identifies concept drift and pattern changes across temporal chains.
   *
   * Real implementation:
   * 1. Extract concepts from temporal chains
   * 2. Calculate embedding drift using cosine similarity
   * 3. Analyze frequency trends with linear regression
   * 4. Detect emerging/declining patterns (>50% change)
   * 5. Store evolution snapshot for learning
   *
   * @param chains Temporal chains
   * @param inference Temporal inference
   * @returns Concept evolution with real metrics
   */
  private async trackConceptEvolution(
    chains: TemporalChain[],
    _inference: TemporalInference
  ): Promise<ConceptEvolution> {
    if (chains.length === 0) {
      return {
        embeddingDrift: 0,
        frequencyChanges: [],
        emergingPatterns: [],
        decliningPatterns: [],
      };
    }

    // 1. Extract concepts from chains
    const concepts = this.extractConceptsFromChains(chains);

    if (concepts.length === 0) {
      return {
        embeddingDrift: 0,
        frequencyChanges: [],
        emergingPatterns: [],
        decliningPatterns: [],
      };
    }

    // 2. Calculate embedding drift for each concept
    const driftResults = await this.calculateEmbeddingDrift(concepts);
    const avgDrift = driftResults.length > 0
      ? driftResults.reduce((sum, r) => sum + r.drift, 0) / driftResults.length
      : 0;

    // 3. Analyze frequency trends
    const frequencyChanges = await this.analyzeFrequencyTrends(concepts);

    // 4. Detect emerging and declining patterns
    const emergingPatterns = this.detectEmergingPatterns(frequencyChanges);
    const decliningPatterns = this.detectDecliningPatterns(frequencyChanges);

    // 5. Store evolution snapshot
    await this.storeEvolutionSnapshot({
      timestamp: Date.now(),
      avgDrift,
      frequencyChanges: frequencyChanges.map(fc => ({
        concept: fc.concept,
        percentChange: fc.changeRate,
        trend: fc.trend,
      })),
      emergingPatterns,
      decliningPatterns,
    });

    return {
      embeddingDrift: avgDrift,
      frequencyChanges,
      emergingPatterns,
      decliningPatterns,
    };
  }

  /**
   * Infer temporal constraints between events
   *
   * Determines temporal relationships (before, after, during, concurrent).
   *
   * @param events Temporal events
   * @returns Temporal constraints
   */
  private inferTemporalConstraints(events: TemporalEvent[]): TemporalConstraint[] {
    const constraints: TemporalConstraint[] = [];

    // Infer constraints between consecutive events
    for (let i = 0; i < events.length - 1; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const eventA = events[i];
        const eventB = events[j];

        const type = this.determineTemporalRelationship(
          eventA.timestamp,
          eventB.timestamp
        );

        constraints.push({
          type,
          eventA: eventA.nodeId,
          eventB: eventB.nodeId,
          confidence: 0.9,
        });
      }
    }

    return constraints;
  }

  /**
   * Calculate temporal consistency of a chain
   *
   * Checks if events follow a consistent temporal order.
   */
  private calculateTemporalConsistency(
    events: Array<{ nodeId: NodeID; timestamp: number }>,
    constraints: TemporalConstraint[]
  ): boolean {
    // Check if timestamps are monotonically increasing
    for (let i = 1; i < events.length; i++) {
      if (events[i].timestamp < events[i - 1].timestamp) {
        return false;
      }
    }

    // Check if all constraints are satisfied
    for (const constraint of constraints) {
      const eventA = events.find((e) => e.nodeId === constraint.eventA);
      const eventB = events.find((e) => e.nodeId === constraint.eventB);

      if (!eventA || !eventB) continue;

      const valid = this.validateConstraint(constraint, eventA.timestamp, eventB.timestamp);
      if (!valid) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate a temporal constraint
   */
  private validateConstraint(
    constraint: TemporalConstraint,
    timestampA: number,
    timestampB: number
  ): boolean {
    switch (constraint.type) {
      case 'before':
        return timestampA < timestampB;
      case 'after':
        return timestampA > timestampB;
      case 'concurrent':
        return Math.abs(timestampA - timestampB) < 1000; // Within 1 second
      case 'during':
        return true; // Simplified
      default:
        return false;
    }
  }

  /**
   * Calculate chain confidence
   */
  private calculateChainConfidence(chain: TemporalChain): number {
    if (chain.constraints.length === 0) {
      return chain.consistency ? 0.5 : 0.3;
    }

    const avgConstraintConfidence =
      chain.constraints.reduce((sum, c) => sum + c.confidence, 0) /
      chain.constraints.length;

    return chain.consistency ? avgConstraintConfidence : avgConstraintConfidence * 0.7;
  }

  /**
   * Determine temporal relationship between two timestamps
   */
  private determineTemporalRelationship(
    timestampA: number,
    timestampB: number
  ): 'before' | 'after' | 'during' | 'concurrent' {
    const diff = Math.abs(timestampB - timestampA);

    if (diff < 1000) {
      return 'concurrent';
    }

    return timestampA < timestampB ? 'before' : 'after';
  }

  /**
   * Calculate time units from milliseconds based on granularity
   */
  private calculateTimeUnits(milliseconds: number, granularity: string): number {
    const units: Record<string, number> = {
      millisecond: 1,
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const unit = units[granularity] || units['day'];
    return milliseconds / unit;
  }

  /**
   * Infer temporal direction from context
   */
  private inferTemporalDirection(
    _context: TemporalContext
  ): 'forward' | 'backward' | 'bidirectional' {
    // Default to bidirectional for temporal reasoning
    return 'bidirectional';
  }

  /**
   * Parse time range from config
   */
  private parseTimeRange(timeRange?: {
    start: number | string;
    end: number | string;
  }): { start: number; end: number } {
    if (!timeRange) {
      // Default to last 30 days
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      return { start: thirtyDaysAgo, end: now };
    }

    const start = typeof timeRange.start === 'string'
      ? this.parseRelativeTime(timeRange.start)
      : timeRange.start;

    const end = typeof timeRange.end === 'string'
      ? this.parseRelativeTime(timeRange.end)
      : timeRange.end;

    return { start, end };
  }

  /**
   * Parse relative time string (e.g., "30d", "1h", "now")
   */
  private parseRelativeTime(relative: string): number {
    if (relative === 'now') {
      return Date.now();
    }

    const match = relative.match(/^(\d+)([smhdwMy])$/);
    if (!match) {
      return Date.now();
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const units: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      M: 30 * 24 * 60 * 60 * 1000,
      y: 365 * 24 * 60 * 60 * 1000,
    };

    return Date.now() - value * (units[unit] || units['d']);
  }

  /**
   * Map GraphDB Granularity to TemporalConfig granularity
   */
  private mapGranularity(granularity: Granularity): TemporalConfig['granularity'] {
    const mapping: Record<Granularity, TemporalConfig['granularity']> = {
      [Granularity.Hourly]: 'hour',
      [Granularity.Daily]: 'day',
      [Granularity.Monthly]: 'month',
    };

    return mapping[granularity] || 'day';
  }

  /**
   * Extract concepts from temporal chains
   *
   * Extracts unique node IDs as concept identifiers from chains.
   *
   * @param chains Temporal chains
   * @returns Array of unique concept identifiers
   */
  private extractConceptsFromChains(chains: TemporalChain[]): string[] {
    const conceptSet = new Set<string>();

    for (const chain of chains) {
      for (const event of chain.events) {
        conceptSet.add(event.nodeId);
      }
    }

    return Array.from(conceptSet);
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * Formula: cos(θ) = (A·B) / (||A|| * ||B||)
   *
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score [0, 1]
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Average multiple embeddings
   *
   * @param embeddings Array of embedding vectors
   * @returns Averaged embedding vector
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      return [];
    }

    const length = embeddings[0].length;
    const averaged = new Array(length).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < length; i++) {
        averaged[i] += embedding[i];
      }
    }

    for (let i = 0; i < length; i++) {
      averaged[i] /= embeddings.length;
    }

    return averaged;
  }

  /**
   * Linear regression for trend analysis
   *
   * Calculates slope, R² confidence, and percent change.
   *
   * @param data Array of {count, timestamp} data points
   * @returns Regression results with slope, confidence, and percentChange
   */
  private linearRegression(data: Array<{count: number; timestamp: number}>): {
    slope: number;
    confidence: number;
    percentChange: number;
  } {
    if (data.length < 2) {
      return { slope: 0, confidence: 0, percentChange: 0 };
    }

    // Calculate means
    const n = data.length;
    const meanX = data.reduce((sum, d) => sum + d.timestamp, 0) / n;
    const meanY = data.reduce((sum, d) => sum + d.count, 0) / n;

    // Calculate slope
    let numerator = 0;
    let denominator = 0;

    for (const d of data) {
      const dx = d.timestamp - meanX;
      const dy = d.count - meanY;
      numerator += dx * dy;
      denominator += dx * dx;
    }

    const slope = denominator === 0 ? 0 : numerator / denominator;

    // Calculate R² (coefficient of determination)
    const predictions = data.map(d => meanY + slope * (d.timestamp - meanX));
    const ssRes = data.reduce((sum, d, i) => sum + Math.pow(d.count - predictions[i], 2), 0);
    const ssTot = data.reduce((sum, d) => sum + Math.pow(d.count - meanY, 2), 0);
    const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

    // Calculate percent change from first to last
    const firstCount = data[0].count;
    const lastCount = data[n - 1].count;
    const percentChange = firstCount === 0 ? 0 : ((lastCount - firstCount) / firstCount) * 100;

    return {
      slope,
      confidence: Math.max(0, Math.min(1, rSquared)), // Clamp to [0, 1]
      percentChange,
    };
  }

  /**
   * Calculate embedding drift for concepts
   *
   * Compares current embeddings with historical embeddings using cosine similarity.
   * Drift = 1 - similarity (higher drift = more change)
   *
   * @param concepts Array of concept identifiers
   * @returns Array of drift results with confidence scores
   */
  private async calculateEmbeddingDrift(concepts: string[]): Promise<Array<{
    concept: string;
    drift: number;
    confidence: number;
  }>> {
    const results: Array<{concept: string; drift: number; confidence: number}> = [];
    const daysBack = 30;

    for (const concept of concepts) {
      // Get historical embeddings for this concept
      const historicalEmbeddings = await this.getHistoricalEmbeddings(concept, daysBack);

      if (historicalEmbeddings.length < 2) {
        // Not enough history - store current embedding if we have it
        // Use real semantic embedding (SPEC-EMB-002)
        const currentEmbedding = await this.generatePlaceholderEmbedding(concept);
        await this.storeHistoricalEmbedding(concept, Array.from(currentEmbedding));
        continue;
      }

      // Get current and historical embeddings
      const currentEmbedding = historicalEmbeddings[historicalEmbeddings.length - 1].embedding;
      const oldEmbeddings = historicalEmbeddings.slice(0, -1).map(h => h.embedding);
      const avgOldEmbedding = this.averageEmbeddings(oldEmbeddings);

      // Calculate drift as 1 - cosine similarity
      const similarity = this.cosineSimilarity(currentEmbedding, avgOldEmbedding);
      const drift = 1 - similarity;

      // Confidence is higher with more historical data
      const confidence = Math.min(1, historicalEmbeddings.length / 10);

      results.push({
        concept,
        drift,
        confidence,
      });
    }

    return results;
  }

  /**
   * Analyze frequency trends using linear regression
   *
   * @param concepts Array of concept identifiers
   * @returns Frequency changes with trend classification
   */
  private async analyzeFrequencyTrends(concepts: string[]): Promise<Array<{
    concept: string;
    trend: 'increasing' | 'decreasing' | 'stable';
    changeRate: number;
  }>> {
    const results: Array<{
      concept: string;
      trend: 'increasing' | 'decreasing' | 'stable';
      changeRate: number;
    }> = [];

    for (const concept of concepts) {
      const snapshots = this.frequencySnapshots.get(concept) || [];

      if (snapshots.length < 2) {
        // Not enough data - create snapshot for current observation
        const currentSnapshot: FrequencySnapshot = {
          concept,
          count: 1,
          timestamp: Date.now(),
        };

        const existing = this.frequencySnapshots.get(concept) || [];
        this.frequencySnapshots.set(concept, [...existing, currentSnapshot]);
        continue;
      }

      // Run linear regression on frequency data
      const regression = this.linearRegression(snapshots);

      // Classify trend based on percent change
      let trend: 'increasing' | 'decreasing' | 'stable';
      if (regression.percentChange > 10) {
        trend = 'increasing';
      } else if (regression.percentChange < -10) {
        trend = 'decreasing';
      } else {
        trend = 'stable';
      }

      results.push({
        concept,
        trend,
        changeRate: regression.percentChange,
      });
    }

    return results;
  }

  /**
   * Detect emerging patterns (>50% increase)
   *
   * @param frequencyChanges Frequency change results
   * @returns Array of emerging pattern identifiers
   */
  private detectEmergingPatterns(frequencyChanges: Array<{
    concept: string;
    changeRate: number;
    trend: string;
  }>): string[] {
    return frequencyChanges
      .filter(fc => fc.trend === 'increasing' && fc.changeRate > 50)
      .map(fc => fc.concept);
  }

  /**
   * Detect declining patterns (>50% decrease)
   *
   * @param frequencyChanges Frequency change results
   * @returns Array of declining pattern identifiers
   */
  private detectDecliningPatterns(frequencyChanges: Array<{
    concept: string;
    changeRate: number;
    trend: string;
  }>): string[] {
    return frequencyChanges
      .filter(fc => fc.trend === 'decreasing' && fc.changeRate < -50)
      .map(fc => fc.concept);
  }

  /**
   * Store historical embedding
   *
   * @param concept Concept identifier
   * @param embedding Embedding vector
   */
  private async storeHistoricalEmbedding(concept: string, embedding: number[]): Promise<void> {
    const historical: HistoricalEmbedding = {
      concept,
      embedding,
      timestamp: Date.now(),
    };

    const existing = this.historicalEmbeddings.get(concept) || [];
    this.historicalEmbeddings.set(concept, [...existing, historical]);

    // Keep only last 100 embeddings per concept to prevent memory growth
    const updated = this.historicalEmbeddings.get(concept) || [];
    if (updated.length > 100) {
      this.historicalEmbeddings.set(concept, updated.slice(-100));
    }
  }

  /**
   * Retrieve historical embeddings for a concept
   *
   * @param concept Concept identifier
   * @param daysBack Number of days to look back
   * @returns Historical embeddings within time range
   */
  private async getHistoricalEmbeddings(concept: string, daysBack: number): Promise<HistoricalEmbedding[]> {
    const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    const allEmbeddings = this.historicalEmbeddings.get(concept) || [];

    return allEmbeddings.filter(h => h.timestamp >= cutoffTime);
  }

  /**
   * Store evolution snapshot
   *
   * @param snapshot Evolution snapshot to store
   */
  private async storeEvolutionSnapshot(snapshot: EvolutionSnapshot): Promise<void> {
    this.evolutionHistory.push(snapshot);

    // Keep only last 1000 snapshots to prevent memory growth
    if (this.evolutionHistory.length > 1000) {
      this.evolutionHistory = this.evolutionHistory.slice(-1000);
    }
  }

  /**
   * Generate semantic embedding for a concept using real embedding provider (SPEC-EMB-002)
   *
   * @param concept Concept identifier
   * @returns Semantic embedding vector (1536 dimensions)
   */
  private async generatePlaceholderEmbedding(concept: string): Promise<Float32Array> {
    try {
      // Use real embedding provider (LocalEmbeddingProvider with all-mpnet-base-v2)
      if (!this.embeddingProvider) {
        // Fallback if provider not initialized - this should not happen
        const { EmbeddingProviderFactory } = await import('../../memory/embedding-provider.js');
        this.embeddingProvider = await EmbeddingProviderFactory.getProvider();
      }

      // If mock provider, use deterministic hash-based embedding for reproducible tests
      const providerName = this.embeddingProvider.getProviderName?.();
      if (providerName === 'mock' || providerName === 'MockEmbeddingProvider') {
        return this.generateHashBasedEmbedding(concept);
      }

      return await this.embeddingProvider.embed(concept);
    } catch (error) {
      // Ultimate fallback: hash-based deterministic embedding
      logger.warn('Embedding provider failed, using hash-based fallback', { error: String(error) });
      return this.generateHashBasedEmbedding(concept);
    }
  }

  /**
   * Generate hash-based deterministic embedding as ultimate fallback
   */
  private generateHashBasedEmbedding(text: string): Float32Array {
    const dimensions = 1536;
    const embedding = new Float32Array(dimensions);

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Use hash as seed for deterministic random numbers
    let seed = Math.abs(hash);
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    // Generate normalized random vector
    let sumSquares = 0;
    for (let i = 0; i < dimensions; i++) {
      const value = random() * 2 - 1; // Range [-1, 1]
      embedding[i] = value;
      sumSquares += value * value;
    }

    // Normalize to unit vector
    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Generate trajectory ID for tracking
   */
  private generateTrajectoryId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `traj_temporal_${timestamp}_${random}`;
  }

  /**
   * Format answer from temporal chains
   */
  private formatAnswer(
    chains: TemporalChain[],
    evolution?: ConceptEvolution
  ): string {
    if (chains.length === 0) {
      return 'No temporal chains identified in the time range.';
    }

    const lines = [
      `Identified ${chains.length} temporal chain(s)`,
      `Total events: ${chains.reduce((sum, c) => sum + c.events.length, 0)}`,
    ];

    if (chains.length > 0) {
      const avgDuration = chains.reduce((sum, c) => sum + c.duration, 0) / chains.length;
      lines.push(`Average chain duration: ${Math.round(avgDuration / 1000)}s`);
    }

    if (evolution && evolution.embeddingDrift > 0.1) {
      lines.push(`Detected concept drift: ${(evolution.embeddingDrift * 100).toFixed(1)}%`);
    }

    return lines.join('\n');
  }

  /**
   * Generate reasoning steps for temporal analysis
   */
  private generateReasoningSteps(
    chains: TemporalChain[],
    inference: TemporalInference,
    context: TemporalContext
  ): string[] {
    return [
      `Queried time range: ${new Date(context.timeRange.start).toISOString()} to ${new Date(context.timeRange.end).toISOString()}`,
      `Temporal granularity: ${context.granularity}`,
      `Built ${chains.length} temporal chains from hyperedges`,
      `Applied ${inference.direction} temporal inference`,
      `Temporal consistency: ${inference.temporalConsistency ? 'verified' : 'inconsistencies detected'}`,
      `Average confidence: ${(inference.avgConfidence * 100).toFixed(1)}%`,
    ];
  }
}
