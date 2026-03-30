/**
 * Pattern Source Adapter
 * Wraps ReasoningBank for quad-fusion search
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 *
 * @module src/god-agent/core/search/adapters/pattern-adapter
 */

import type { ReasoningBank } from '../../reasoning/reasoning-bank.js';
import type { IReasoningRequest, IPatternMatch } from '../../reasoning/reasoning-types.js';
import { ReasoningMode } from '../../reasoning/reasoning-types.js';
import type {
  SourceExecutionResult,
  RawSourceResult,
} from '../search-types.js';
import { withTimeout, TimeoutError, generateResultId } from '../utils.js';

/**
 * Adapter for pattern matching via ReasoningBank
 */
export class PatternSourceAdapter {
  private readonly reasoningBank: ReasoningBank;

  /**
   * Create pattern source adapter
   * @param reasoningBank - ReasoningBank instance
   */
  constructor(reasoningBank: ReasoningBank) {
    this.reasoningBank = reasoningBank;
  }

  /**
   * Execute pattern search
   *
   * @param query - Query embedding (VECTOR_DIM dimensions, default 1536) or text query for fallback
   * @param minConfidence - Minimum pattern confidence threshold
   * @param timeoutMs - Timeout in milliseconds
   * @returns Source execution result
   */
  async search(
    query: Float32Array | string,
    minConfidence: number,
    timeoutMs: number
  ): Promise<SourceExecutionResult> {
    const startTime = performance.now();

    // Handle empty query
    if (!query || (typeof query === 'string' && query.trim().length === 0)) {
      return {
        status: 'success',
        results: [],
        durationMs: performance.now() - startTime,
      };
    }

    try {
      const searchPromise = this.executeSearch(query, minConfidence);
      const results = await withTimeout(searchPromise, timeoutMs, 'pattern');

      return {
        status: 'success',
        results,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;

      if (error instanceof TimeoutError) {
        return {
          status: 'timeout',
          durationMs,
        };
      }

      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
      };
    }
  }

  /**
   * Execute pattern matching via ReasoningBank
   */
  private async executeSearch(
    query: Float32Array | string,
    minConfidence: number
  ): Promise<RawSourceResult[]> {
    // Convert string query to embedding if needed
    const embedding = typeof query === 'string'
      ? this.textToEmbedding(query)
      : query;

    const request: IReasoningRequest = {
      query: embedding,
      type: ReasoningMode.PATTERN_MATCH,
      maxResults: 20,
      confidenceThreshold: minConfidence,
      minLScore: 0.3,
      enhanceWithGNN: false,
      applyLearning: true,
    };

    try {
      const response = await this.reasoningBank.reason(request);

      return response.patterns
        .filter((pattern) => pattern.confidence >= minConfidence)
        .map((pattern, index) => this.patternToResult(pattern, index));
    } catch (error) {
      // Handle initialization errors gracefully
      if (error instanceof Error && error.message.includes('not initialized')) {
        return [];
      }
      // RULE-070: Re-throw with operation context
      throw new Error(
        `Pattern search failed (minConfidence: ${minConfidence}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Convert text to a mock embedding for testing
   * In production, this would use a proper embedding model
   */
  private textToEmbedding(text: string): Float32Array {
    // Create deterministic pseudo-embedding from text
    const embedding = new Float32Array(1536);
    const textBytes = Buffer.from(text);

    for (let i = 0; i < 1536; i++) {
      // Use text bytes to create deterministic values
      const byteIndex = i % textBytes.length;
      const value = (textBytes[byteIndex] / 255) * 2 - 1; // Normalize to [-1, 1]
      embedding[i] = value;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < 1536; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < 1536; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Convert pattern match to raw source result
   */
  private patternToResult(pattern: IPatternMatch, index: number): RawSourceResult {
    return {
      source: 'pattern' as const,
      id: generateResultId('pattern', index),
      content: pattern.template,
      score: pattern.confidence,
      metadata: {
        patternId: pattern.patternId,
        taskType: pattern.taskType,
        lScore: pattern.lScore,
      },
    };
  }
}
