/**
 * FeedbackGenerator - Quality Estimation for ReasoningBank
 *
 * Implements: TASK-ORC-007 (TECH-ORC-001 lines 760-816)
 *
 * Analyzes task output and generates quality estimates for ReasoningBank
 * feedback using heuristic indicators.
 *
 * @module orchestration/services/feedback-generator
 */

import type { IQualityEstimate } from '../types.js';

/**
 * Metadata for quality estimation
 */
export interface IFeedbackMetadata {
  agentType: string;
  taskType: string;
  success: boolean;
  error?: string;
}

/**
 * FeedbackGenerator - Generates quality estimates for task output
 */
export class FeedbackGenerator {
  /**
   * Generate quality estimate from task output
   *
   * @param output - Task output
   * @param metadata - Task metadata
   * @returns Quality estimate with reasoning
   */
  generateQualityEstimate(
    output: string,
    metadata: IFeedbackMetadata
  ): IQualityEstimate {
    // 1. Check for completion markers
    const hasCompletionMarkers = this.hasCompletionMarkers(output);

    // 2. Check for error indicators
    const hasErrors = this.hasErrors(output, metadata);

    // 3. Check for expected deliverables
    const hasExpectedDeliverables = this.hasExpectedDeliverables(output);

    // 4. Validate output length adequacy
    const outputLengthAdequate = output.length >= 50;

    // Build indicators
    const indicators = {
      hasCompletionMarkers,
      hasErrors,
      hasExpectedDeliverables,
      outputLengthAdequate
    };

    // 5. Calculate quality score
    const quality = this.calculateQualityScore(indicators, metadata.success);

    // 6. Classify outcome
    const outcome = this.classifyOutcome(quality);

    // 7. Generate reasoning
    const reasoning = this.generateReasoning(indicators, output, metadata);

    return {
      quality,
      outcome,
      indicators,
      reasoning,
      timestamp: Date.now()
    };
  }

  /**
   * Check for completion markers
   *
   * Keywords: "complete", "done", "success", "finished"
   *
   * @param output - Task output
   * @returns Whether completion markers are present
   */
  private hasCompletionMarkers(output: string): boolean {
    const completionKeywords = [
      /\bcomplete\w*\b/i,
      /\bdone\b/i,
      /\bsuccess\w*\b/i,
      /\bfinished\b/i
    ];

    return completionKeywords.some(pattern => pattern.test(output));
  }

  /**
   * Check for error indicators
   *
   * Keywords: "error", "failed", "exception", "warning"
   *
   * @param output - Task output
   * @param metadata - Task metadata
   * @returns Whether errors are present
   */
  private hasErrors(output: string, metadata: IFeedbackMetadata): boolean {
    // Check metadata first
    if (metadata.error || !metadata.success) {
      return true;
    }

    // Check output for error keywords
    const errorKeywords = [
      /\berror\w*\b/i,
      /\bfailed\b/i,
      /\bexception\w*\b/i,
      /\bwarning\w*\b/i
    ];

    return errorKeywords.some(pattern => pattern.test(output));
  }

  /**
   * Check for expected deliverables
   *
   * Looks for: code blocks, file paths, schemas
   *
   * @param output - Task output
   * @returns Whether deliverables are present
   */
  private hasExpectedDeliverables(output: string): boolean {
    // Check for code blocks
    if (/```[\s\S]*?```/.test(output)) {
      return true;
    }

    // Check for file paths
    if (/[\w\-\/]+\.[\w]+/.test(output)) {
      return true;
    }

    // Check for schemas (interface, type, class)
    if (/(interface|type|class)\s+\w+/.test(output)) {
      return true;
    }

    return false;
  }

  /**
   * Calculate quality score from indicators
   *
   * Algorithm (from spec lines 1094-1099):
   * - Base: 0.5
   * - +0.2 if completionMarkers present
   * - -0.3 if errors present
   * - +0.1 if deliverables present
   * - +0.1 if length adequate
   * - Min: 0.0, Max: 1.0
   *
   * @param indicators - Quality indicators
   * @param success - Task success flag
   * @returns Quality score (0-1)
   */
  private calculateQualityScore(
    indicators: IQualityEstimate['indicators'],
    success: boolean
  ): number {
    let score = 0.5; // Base

    // Completion markers
    if (indicators.hasCompletionMarkers) {
      score += 0.2;
    }

    // Errors
    if (indicators.hasErrors) {
      score -= 0.3;
    }

    // Deliverables
    if (indicators.hasExpectedDeliverables) {
      score += 0.1;
    }

    // Length
    if (indicators.outputLengthAdequate) {
      score += 0.1;
    }

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Classify outcome based on quality
   *
   * Classification (from spec lines 1100-1102):
   * - Positive: quality >= 0.7
   * - Negative: quality < 0.4
   * - Neutral: 0.4 <= quality < 0.7
   *
   * @param quality - Quality score
   * @returns Outcome classification
   */
  private classifyOutcome(quality: number): 'positive' | 'negative' | 'neutral' {
    if (quality >= 0.7) {
      return 'positive';
    } else if (quality < 0.4) {
      return 'negative';
    } else {
      return 'neutral';
    }
  }

  /**
   * Generate reasoning for estimate
   *
   * @param indicators - Quality indicators
   * @param output - Task output
   * @param metadata - Task metadata
   * @returns Reasoning string
   */
  private generateReasoning(
    indicators: IQualityEstimate['indicators'],
    output: string,
    metadata: IFeedbackMetadata
  ): string {
    const reasons: string[] = [];

    // Completion
    if (indicators.hasCompletionMarkers) {
      reasons.push('Task completed with success markers');
    }

    // Errors
    if (indicators.hasErrors) {
      reasons.push('Errors detected in output');
      if (metadata.error) {
        reasons.push(`Error: ${metadata.error}`);
      }
    }

    // Deliverables
    if (indicators.hasExpectedDeliverables) {
      // Count deliverables
      const codeBlocks = (output.match(/```[\s\S]*?```/g) || []).length;
      const filePaths = (output.match(/[\w\-\/]+\.[\w]+/g) || []).length;
      const schemas = (output.match(/(interface|type|class)\s+\w+/g) || []).length;

      const deliverables: string[] = [];
      if (codeBlocks > 0) deliverables.push(`${codeBlocks} code blocks`);
      if (filePaths > 0) deliverables.push(`${filePaths} file paths`);
      if (schemas > 0) deliverables.push(`${schemas} schemas`);

      reasons.push(`Found ${deliverables.join(', ')}`);
    } else {
      reasons.push('No expected deliverables found');
    }

    // Length
    if (!indicators.outputLengthAdequate) {
      reasons.push('Output length inadequate (< 50 chars)');
    }

    return reasons.join('. ') + '.';
  }
}
