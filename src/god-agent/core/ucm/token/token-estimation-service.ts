/**
 * Token Estimation Service
 * Fast, accurate token estimation using constitutional ratios
 *
 * CONSTITUTION RULES:
 * - RULE-001: prose = 1.3 tokens/word
 * - RULE-002: code = 1.5 tokens/word
 * - RULE-003: tables = 2.0 tokens/word
 * - RULE-004: citations = 1.4 tokens/word
 * - RULE-006: default = 1.3 tokens/word
 * - RULE-020: Accuracy ±5%
 * - RULE-051: <10ms for 10K words
 */

import type {
  ITokenEstimator,
  ITokenEstimate,
  IEstimationHints,
  ITokenBreakdown
} from '../types.js';
import { ContentType, TOKEN_RATIOS } from '../types.js';
import { WordCounter } from './word-counter.js';
import { ContentClassifier } from './content-classifier.js';

/**
 * High-performance token estimation service
 * Meets RULE-051: <10ms for 10K words
 */
export class TokenEstimationService implements ITokenEstimator {
  private wordCounter: WordCounter;
  private classifier: ContentClassifier;

  constructor() {
    this.wordCounter = new WordCounter();
    this.classifier = new ContentClassifier();
  }

  /**
   * Estimate tokens for given text
   * @param text - Input text to estimate
   * @param hints - Optional hints for faster classification
   * @returns Token estimate with confidence and breakdown
   */
  estimate(text: string, hints?: IEstimationHints): ITokenEstimate {
    const startTime = performance.now();

    if (!text || text.trim().length === 0) {
      return {
        tokens: 0,
        confidence: 1.0,
        contentType: ContentType.PROSE,
        wordCount: 0,
        estimatedLatencyMs: performance.now() - startTime
      };
    }

    // Use hints for faster estimation if provided
    if (hints && this.canUseFastPath(hints)) {
      return this.fastEstimate(text, hints, startTime);
    }

    // Full detailed estimation
    return this.detailedEstimate(text, startTime);
  }

  /**
   * Fast path estimation using hints
   * Avoids full content classification for performance
   */
  private fastEstimate(
    text: string,
    hints: IEstimationHints,
    startTime: number
  ): ITokenEstimate {
    const wordCount = this.wordCounter.count(text);

    // Determine content type from hints
    let contentType: ContentType;
    let ratio: number;

    if (hints.hasCode) {
      contentType = ContentType.CODE;
      ratio = TOKEN_RATIOS[ContentType.CODE];
    } else if (hints.hasTables) {
      contentType = ContentType.TABLE;
      ratio = TOKEN_RATIOS[ContentType.TABLE];
    } else if (hints.hasCitations) {
      contentType = ContentType.CITATION;
      ratio = TOKEN_RATIOS[ContentType.CITATION];
    } else {
      contentType = ContentType.PROSE;
      ratio = TOKEN_RATIOS[ContentType.PROSE];
    }

    const tokens = Math.round(wordCount * ratio);
    const latency = performance.now() - startTime;

    return {
      tokens,
      confidence: 0.95, // High confidence with hints
      contentType,
      wordCount,
      estimatedLatencyMs: latency
    };
  }

  /**
   * Detailed estimation with full content classification
   * Provides breakdown by content type
   */
  private detailedEstimate(text: string, startTime: number): ITokenEstimate {
    const breakdown = this.classifier.classifyDetailed(text);

    let totalTokens = 0;
    let totalWords = 0;

    // Calculate tokens for each content type
    const enhancedBreakdown: ITokenBreakdown[] = breakdown.map(item => {
      const ratio = TOKEN_RATIOS[item.contentType];
      const tokens = Math.round(item.wordCount * ratio);
      totalTokens += tokens;
      totalWords += item.wordCount;

      return {
        ...item,
        tokenCount: tokens
      };
    });

    // Determine primary content type
    const primaryType = breakdown.length > 0
      ? breakdown[0].contentType
      : ContentType.PROSE;

    const latency = performance.now() - startTime;

    // Confidence based on content homogeneity
    // More homogeneous content = higher confidence
    const maxPercentage = breakdown.length > 0 ? breakdown[0].percentage : 1.0;
    const confidence = 0.90 + (maxPercentage * 0.05); // 90-95% confidence

    return {
      tokens: totalTokens,
      confidence: Math.min(confidence, 0.95), // Cap at 95% per RULE-020
      contentType: primaryType,
      breakdown: enhancedBreakdown,
      wordCount: totalWords,
      estimatedLatencyMs: latency
    };
  }

  /**
   * Check if we can use fast path estimation
   */
  private canUseFastPath(hints: IEstimationHints): boolean {
    // Only use fast path if exactly one hint is provided
    const hintCount = [
      hints.hasCode,
      hints.hasTables,
      hints.hasCitations
    ].filter(Boolean).length;

    return hintCount === 1;
  }

  /**
   * Batch estimation for multiple texts
   * Optimized for processing multiple items efficiently
   */
  estimateBatch(texts: string[], hints?: IEstimationHints): ITokenEstimate[] {
    return texts.map(text => this.estimate(text, hints));
  }

  /**
   * Quick token count without detailed breakdown
   * Optimized for RULE-051 performance requirement
   */
  quickEstimate(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }

    const wordCount = this.wordCounter.count(text);

    // Use default ratio for fastest estimation
    return Math.round(wordCount * TOKEN_RATIOS[ContentType.PROSE]);
  }

  /**
   * Estimate with validation against performance requirements
   * Ensures RULE-051: <10ms for 10K words
   */
  estimateWithValidation(text: string): ITokenEstimate & { meetsPerformanceTarget: boolean } {
    const result = this.estimate(text);

    // Calculate expected max latency based on word count
    // RULE-051: 10ms for 10K words = 1ms per 1K words
    const expectedMaxLatencyMs = (result.wordCount / 1000);
    const meetsPerformanceTarget = result.estimatedLatencyMs <= expectedMaxLatencyMs;

    return {
      ...result,
      meetsPerformanceTarget
    };
  }
}
