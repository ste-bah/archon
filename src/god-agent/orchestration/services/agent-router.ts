/**
 * Agent Router Service
 *
 * Implements: TASK-ORC-011 (TECH-ORC-001 lines 879-941, 1130-1175)
 *
 * Routes tasks to appropriate agents based on detected workflow phase
 * using keyword matching with confidence scoring.
 *
 * @module orchestration/services/agent-router
 */

import type { IAgentRouting, IPhaseAgentMapping } from '../types.js';
import { WorkflowPhase } from '../types.js';
import {
  PHASE_AGENT_MAPPING,
  PHASE_KEYWORDS,
  PHASE_CONFIDENCE_THRESHOLD
} from '../constants.js';

/**
 * Routing options
 */
export interface IRoutingOptions {
  /** Preferred agent type (overrides detection) */
  preferredAgent?: string;
  /** Enable fallback to default agent if unavailable */
  fallbackEnabled?: boolean;
}

/**
 * Service that routes tasks to appropriate agent types
 */
export class AgentRouter {
  private phaseMapping: IPhaseAgentMapping[];

  /**
   * Initialize agent router
   *
   * @param phaseMapping - Custom phase mappings (optional)
   */
  constructor(phaseMapping?: IPhaseAgentMapping[]) {
    this.phaseMapping = phaseMapping || [...PHASE_AGENT_MAPPING];
  }

  /**
   * Route task to appropriate agent based on phase detection
   *
   * From TECH-ORC-001 lines 895-911
   *
   * @param taskDescription - Task description
   * @param options - Routing options
   * @returns Agent routing decision
   */
  routeToAgent(
    taskDescription: string,
    options?: IRoutingOptions
  ): IAgentRouting {
    const timestamp = Date.now();

    // Detect phase from description
    const { phase, confidence } = this.detectPhase(taskDescription);

    // Find mapping for detected phase
    const mapping = this.phaseMapping.find(m => m.phase === phase);

    if (!mapping) {
      // Fallback to GENERAL phase
      return this.createFallbackRouting(taskDescription, timestamp);
    }

    // Check for preferred agent override
    if (options?.preferredAgent) {
      return {
        taskDescription,
        detectedPhase: phase,
        suggestedAgent: options.preferredAgent,
        phaseConfidence: confidence,
        overridden: true,
        actualAgent: options.preferredAgent,
        overrideReason: 'Preferred agent specified',
        timestamp
      };
    }

    // Check if primary agent is available
    const primaryAvailable = this.isAgentAvailable(mapping.primaryAgent);

    let suggestedAgent = mapping.primaryAgent;
    let actualAgent = mapping.primaryAgent;
    let overridden = false;
    let overrideReason: string | undefined;

    // Use fallback if primary unavailable and fallback enabled
    if (!primaryAvailable && options?.fallbackEnabled !== false) {
      const fallbackAgent = mapping.fallbackAgents[0];
      if (fallbackAgent && this.isAgentAvailable(fallbackAgent)) {
        actualAgent = fallbackAgent;
        overridden = true;
        overrideReason = `Primary agent ${mapping.primaryAgent} unavailable, using fallback`;
      }
    }

    // Handle low confidence with fallback
    if (confidence < PHASE_CONFIDENCE_THRESHOLD) {
      console.warn(
        `[AgentRouter] Low confidence phase detection (${confidence.toFixed(2)}). ` +
        `Defaulting to general-purpose agent.`
      );

      // Store ambiguity for learning (non-blocking)
      this.storeRoutingAmbiguity(taskDescription, phase, confidence).catch(() => {
        // Ignore storage errors
      });

      return this.createFallbackRouting(taskDescription, timestamp, confidence);
    }

    return {
      taskDescription,
      detectedPhase: phase,
      suggestedAgent,
      phaseConfidence: confidence,
      overridden,
      actualAgent,
      overrideReason,
      timestamp
    };
  }

  /**
   * Detect workflow phase from task description
   *
   * From TECH-ORC-001 lines 914-922
   *
   * @param description - Task description
   * @returns Detected phase and confidence score
   * @private
   */
  private detectPhase(description: string): {
    phase: WorkflowPhase;
    confidence: number;
  } {
    const descLower = description.toLowerCase();
    const phaseScores: Record<WorkflowPhase, number> = {
      [WorkflowPhase.PLANNING]: 0,
      [WorkflowPhase.SPECIFICATION]: 0,
      [WorkflowPhase.IMPLEMENTATION]: 0,
      [WorkflowPhase.TESTING]: 0,
      [WorkflowPhase.REVIEW]: 0,
      [WorkflowPhase.AUDIT]: 0,
      [WorkflowPhase.GENERAL]: 0
    };

    // Score each phase based on keyword matches
    for (const [phase, keywords] of Object.entries(PHASE_KEYWORDS)) {
      let matches = 0;
      for (const keyword of keywords) {
        if (descLower.includes(keyword)) {
          matches++;
        }
      }
      phaseScores[phase as WorkflowPhase] = matches;
    }

    // Find highest scoring phase
    let maxScore = 0;
    let detectedPhase = WorkflowPhase.GENERAL;

    for (const [phase, score] of Object.entries(phaseScores)) {
      if (score > maxScore) {
        maxScore = score;
        detectedPhase = phase as WorkflowPhase;
      }
    }

    // Calculate confidence
    // If no matches at all, low confidence
    if (maxScore === 0) {
      return { phase: WorkflowPhase.GENERAL, confidence: 0.5 };
    }

    // Confidence based on match count
    // Use a more lenient calculation: even 1 match gives decent confidence
    // Confidence = min(0.6 + (matches * 0.1), 1.0)
    const confidence = Math.min(0.6 + (maxScore * 0.1), 1.0);

    return { phase: detectedPhase, confidence };
  }

  /**
   * Check if agent is available
   *
   * From TECH-ORC-001 lines 925-931
   *
   * @param agentType - Agent type to check
   * @returns Whether agent is available
   * @private
   */
  private isAgentAvailable(agentType: string): boolean {
    // Mock implementation - always returns true for now
    // In production, this would check actual agent availability
    return true;
  }

  /**
   * Create fallback routing for low confidence or errors
   *
   * @param taskDescription - Task description
   * @param timestamp - Timestamp
   * @param confidence - Detection confidence (optional)
   * @returns Fallback routing decision
   * @private
   */
  private createFallbackRouting(
    taskDescription: string,
    timestamp: number,
    confidence?: number
  ): IAgentRouting {
    return {
      taskDescription,
      detectedPhase: WorkflowPhase.GENERAL,
      suggestedAgent: 'coder',
      phaseConfidence: confidence ?? 0,
      overridden: true,
      actualAgent: 'coder',
      overrideReason: 'Low confidence or phase detection failed',
      timestamp
    };
  }

  /**
   * Store routing ambiguity for learning
   *
   * From TECH-ORC-001 lines 1162-1174
   *
   * @param taskDescription - Task description
   * @param detectedPhase - Detected phase
   * @param confidence - Confidence score
   * @private
   */
  private async storeRoutingAmbiguity(
    taskDescription: string,
    detectedPhase: WorkflowPhase,
    confidence: number
  ): Promise<void> {
    // This would store to InteractionStore if available
    // For now, just log - implementation would require InteractionStore dependency
    console.warn(
      `[AgentRouter] Routing ambiguity: phase=${detectedPhase}, confidence=${confidence.toFixed(2)}`
    );
  }

  /**
   * Get default phase-agent mappings
   *
   * From TECH-ORC-001 lines 934-940
   *
   * @returns Array of phase mappings
   * @static
   */
  static getDefaultMappings(): IPhaseAgentMapping[] {
    return [...PHASE_AGENT_MAPPING];
  }
}
