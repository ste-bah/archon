/**
 * Reasoning Service - IPC wrapper for ReasoningBank
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Exposes reasoning operations via JSON-RPC 2.0
 */

import type { ReasoningBank } from '../../reasoning/reasoning-bank.js';
import type { IReasoningRequest } from '../../reasoning/reasoning-types.js';
import { ReasoningMode } from '../../reasoning/reasoning-types.js';
import { createServiceHandler, type ServiceHandler } from '../service-registry.js';

/**
 * Reasoning service parameters
 */
export interface IReasoningReasonParams {
  query: number[]; // Float32Array serialized as number[]
  type?: ReasoningMode;
  maxResults?: number;
  confidenceThreshold?: number;
  minLScore?: number;
  enhanceWithGNN?: boolean;
}

export interface IReasoningFeedbackParams {
  trajectoryId: string;
  quality: number;
  outcome: 'success' | 'failure';
  userFeedback?: string;
}

/**
 * Create reasoning service handler
 *
 * @param reasoningBank - ReasoningBank instance
 * @returns Service handler with method map
 */
export function createReasoningService(reasoningBank: ReasoningBank): ServiceHandler {
  return createServiceHandler({
    /**
     * Execute reasoning query
     */
    reason: async (params: IReasoningReasonParams) => {
      const { query, type = ReasoningMode.HYBRID, maxResults, confidenceThreshold, minLScore, enhanceWithGNN } = params;
      if (!query) {
        throw new Error('query is required');
      }

      const request: IReasoningRequest = {
        query: new Float32Array(query),
        type,
        maxResults,
        confidenceThreshold,
        minLScore,
        enhanceWithGNN,
      };

      const response = await reasoningBank.reason(request);

      return {
        query: Array.from(response.query),
        type: response.type,
        patterns: response.patterns.map((p) => ({
          patternId: p.patternId,
          confidence: p.confidence,
          template: p.template,
          taskType: p.taskType,
          lScore: p.lScore,
        })),
        causalInferences: response.causalInferences.map((c) => ({
          nodeId: c.nodeId,
          probability: c.probability,
          confidence: c.confidence,
          chain: c.chain,
          lScore: c.lScore,
        })),
        trajectoryId: response.trajectoryId,
        confidence: response.confidence,
        provenanceInfo: response.provenanceInfo,
        processingTimeMs: response.processingTimeMs,
        enhancedEmbedding: response.enhancedEmbedding
          ? Array.from(response.enhancedEmbedding)
          : undefined,
      };
    },

    /**
     * Provide feedback for a trajectory
     */
    provideFeedback: async (params: IReasoningFeedbackParams) => {
      const { trajectoryId, quality, outcome, userFeedback } = params;
      if (!trajectoryId || quality === undefined || !outcome) {
        throw new Error('trajectoryId, quality, and outcome are required');
      }

      // Convert quality and outcome to ILearningFeedback format
      const verdict: 'correct' | 'incorrect' | 'neutral' =
        outcome === 'success' ? 'correct' :
        outcome === 'failure' ? 'incorrect' :
        'neutral';

      await reasoningBank.provideFeedback({
        trajectoryId,
        verdict,
        quality,
        reasoning: userFeedback,
      });

      return { success: true };
    },

    /**
     * Get reasoning statistics
     */
    stats: async () => {
      // ReasoningBank doesn't expose stats directly
      // Return basic info
      return {
        initialized: true,
      };
    },
  });
}
