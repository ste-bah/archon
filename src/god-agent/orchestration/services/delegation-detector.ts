/**
 * Delegation Detector Service
 *
 * Implements: TASK-ORC-010 (TECH-ORC-001 lines 819-876, 1107-1128, 1231-1250)
 *
 * Detects when orchestrator should delegate work to agents based on
 * multi-step operation patterns (3+ sequential operations).
 *
 * @module orchestration/services/delegation-detector
 */

import type { InteractionStore } from '../../universal/interaction-store.js';
import type { IDelegationPattern } from '../types.js';
import {
  MIN_OPERATION_COUNT,
  DELEGATION_KEYWORDS,
  OPERATION_AGENT_MAPPING
} from '../constants.js';

/**
 * Detection thresholds configuration
 */
export interface IDelegationThresholds {
  /** Minimum operation count to trigger detection (default: 3) */
  minOperationCount: number;
  /** Confidence threshold for suggestions (default: 0.7) */
  confidenceThreshold: number;
}

/**
 * Default thresholds
 */
const DEFAULT_THRESHOLDS: IDelegationThresholds = {
  minOperationCount: MIN_OPERATION_COUNT,
  confidenceThreshold: 0.7
};

/**
 * Service that detects multi-step workflow patterns and suggests delegation
 */
export class DelegationDetector {
  private interactionStore: InteractionStore;
  private thresholds: IDelegationThresholds;

  /**
   * Initialize delegation detector
   *
   * @param interactionStore - InteractionStore for pattern storage
   * @param thresholds - Detection thresholds (optional)
   */
  constructor(
    interactionStore: InteractionStore,
    thresholds?: Partial<IDelegationThresholds>
  ) {
    this.interactionStore = interactionStore;
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds
    };
  }

  /**
   * Detect if orchestrator should delegate to an agent
   *
   * From TECH-ORC-001 lines 840-851
   *
   * @param operationSequence - Sequence of operations performed
   * @returns Delegation pattern with suggestion
   */
  detectDelegationNeed(operationSequence: string[]): IDelegationPattern {
    const operationCount = operationSequence.length;
    const timestamp = Date.now();

    // If below threshold, no delegation needed
    if (operationCount < this.thresholds.minOperationCount) {
      return {
        id: `delegation-${timestamp}`,
        operationSequence,
        operationCount,
        suggestedAgent: '',
        confidence: 0,
        delegated: false,
        timestamp,
        promptDisplayed: false
      };
    }

    // Analyze operations to suggest agent
    const { agent, confidence } = this.analyzeOperations(operationSequence);

    // Only display prompt if confidence meets threshold
    const promptDisplayed = confidence >= this.thresholds.confidenceThreshold;

    return {
      id: `delegation-${timestamp}`,
      operationSequence,
      operationCount,
      suggestedAgent: agent,
      confidence,
      delegated: false, // Will be set by orchestrator
      timestamp,
      promptDisplayed
    };
  }

  /**
   * Store delegation pattern to InteractionStore for learning
   *
   * From TECH-ORC-001 lines 857-862
   *
   * @param pattern - Delegation pattern to store
   */
  async storePattern(pattern: IDelegationPattern): Promise<void> {
    try {
      await this.interactionStore.addKnowledge({
        id: pattern.id,
        domain: 'system/delegation',
        type: 'pattern',
        content: JSON.stringify({
          operationSequence: pattern.operationSequence,
          suggestedAgent: pattern.suggestedAgent,
          confidence: pattern.confidence,
          delegated: pattern.delegated,
          orchestratorChoice: pattern.orchestratorChoice
        }),
        tags: ['delegation', 'pattern', pattern.suggestedAgent],
        quality: pattern.delegated ? 1.0 : 0.5, // Higher quality if acted upon
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });
    } catch (error) {
      // Non-fatal: Log warning and continue
      console.warn('[DelegationDetector] Failed to store pattern:', error);
    }
  }

  /**
   * Analyze operation types and suggest appropriate agent
   *
   * From TECH-ORC-001 lines 1122-1126, 1231-1250
   *
   * @param operations - Operation sequence
   * @returns Suggested agent and confidence score
   * @private
   */
  private analyzeOperations(operations: string[]): {
    agent: string;
    confidence: number;
  } {
    // Score each operation type
    const typeScores: Record<string, number> = {};

    for (const operation of operations) {
      const opLower = operation.toLowerCase();

      // Check against each operation type mapping
      for (const [type, mapping] of Object.entries(OPERATION_AGENT_MAPPING)) {
        let matches = 0;

        // Check keyword matches
        for (const keyword of mapping.keywords) {
          if (opLower.includes(keyword)) {
            matches++;
          }
        }

        // Check file pattern matches
        for (const pattern of mapping.filePatterns) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          if (regex.test(opLower)) {
            matches++;
          }
        }

        if (matches > 0) {
          typeScores[type] = (typeScores[type] || 0) + matches;
        }
      }

      // Check delegation keywords
      for (const keyword of DELEGATION_KEYWORDS) {
        if (opLower.includes(keyword)) {
          // Specific keyword mappings
          if (keyword.includes('implement') || keyword.includes('build')) {
            typeScores['backend'] = (typeScores['backend'] || 0) + 2;
          } else if (keyword.includes('test')) {
            typeScores['testing'] = (typeScores['testing'] || 0) + 2;
          } else if (keyword.includes('analyze') || keyword.includes('review')) {
            typeScores['analysis'] = (typeScores['analysis'] || 0) + 2;
          } else if (keyword.includes('frontend')) {
            typeScores['frontend'] = (typeScores['frontend'] || 0) + 2;
          } else if (keyword.includes('schema') || keyword.includes('API')) {
            typeScores['schema'] = (typeScores['schema'] || 0) + 2;
          }
        }
      }
    }

    // Find highest scoring type
    let maxScore = 0;
    let bestType = '';

    for (const [type, score] of Object.entries(typeScores)) {
      if (score > maxScore) {
        maxScore = score;
        bestType = type;
      }
    }

    // If no clear match, default to coder
    if (!bestType || maxScore === 0) {
      return { agent: 'coder', confidence: 0.5 };
    }

    // Get agent and confidence from mapping
    const mapping = OPERATION_AGENT_MAPPING[bestType as keyof typeof OPERATION_AGENT_MAPPING];
    const confidence = Math.min(
      mapping.confidence * (maxScore / operations.length),
      1.0
    );

    return {
      agent: mapping.suggestedAgent,
      confidence
    };
  }
}
