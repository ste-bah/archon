/**
 * Sherlock Flow Handler
 *
 * Handles verdict-based flow control for pipeline progression.
 * Extracted from sherlock-phase-reviewer.ts for constitution compliance (< 500 lines).
 *
 * @module src/god-agent/core/pipeline/sherlock-flow-handler
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.6
 */

import {
  type IPhaseReviewResult,
  Verdict,
  MAX_RETRY_COUNT,
} from './sherlock-phase-reviewer-types.js';

// ═══════════════════════════════════════════════════════════════════════════
// FLOW HANDLER CALLBACKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Callback handlers for phase review result flow control.
 */
export interface IPhaseReviewCallbacks {
  /**
   * Called when phase is INNOCENT - proceed to next phase.
   * @param nextPhase - Next phase number to execute
   */
  onInnocent: (nextPhase: number) => Promise<void>;

  /**
   * Called when phase is GUILTY - remediate and retry.
   * @param remediations - Required remediations to address
   * @param retryCount - New retry count for the phase
   */
  onGuilty: (remediations: readonly string[], retryCount: number) => Promise<void>;

  /**
   * Called when evidence is INSUFFICIENT - gather more evidence.
   * @param phase - Phase requiring more evidence
   */
  onInsufficientEvidence: (phase: number) => Promise<void>;

  /**
   * Called when max retries exceeded - escalate to human.
   * @param result - Full phase review result for escalation
   */
  onEscalate: (result: IPhaseReviewResult) => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle phase review result per PRD 2.3.6 verdict-based flow control.
 *
 * Flow control rules:
 * - INNOCENT: Proceed to next phase
 * - GUILTY (retries remaining): Remediate and retry current phase
 * - GUILTY (max retries): Escalate to human intervention
 * - INSUFFICIENT_EVIDENCE: Gather more evidence for current phase
 *
 * @param result - Phase review result from Sherlock
 * @param callbacks - Callback handlers for each verdict type
 * @returns Promise that resolves when flow control action is complete
 */
export async function handlePhaseReviewResult(
  result: IPhaseReviewResult,
  callbacks: IPhaseReviewCallbacks
): Promise<void> {
  switch (result.verdict) {
    case Verdict.INNOCENT:
      // Proceed to next phase
      await callbacks.onInnocent(result.phase + 1);
      break;

    case Verdict.GUILTY:
      if (result.retryCount < MAX_RETRY_COUNT) {
        // Remediate and retry
        await callbacks.onGuilty(result.remediations, result.retryCount + 1);
      } else {
        // Max retries exceeded - escalate
        await callbacks.onEscalate(result);
      }
      break;

    case Verdict.INSUFFICIENT_EVIDENCE:
      // Gather more evidence
      await callbacks.onInsufficientEvidence(result.phase);
      break;
  }
}
