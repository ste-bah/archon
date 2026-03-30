/**
 * Sherlock-Quality Gate Integration
 *
 * Connects CodingQualityGateValidator to SherlockPhaseReviewer for unified
 * phase boundary validation. Quality Gate failures trigger Sherlock INVESTIGATION tier.
 *
 * @module src/god-agent/core/pipeline/sherlock-quality-gate-integration
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3
 */
import { z } from 'zod';
import {
  CodingQualityGateValidator,
  createCodingQualityGateValidator,
} from './coding-quality-gate-validator.js';

import {
  type ILScoreBreakdown,
  type IGateValidationContext,
  type IGateValidationResult,
  GateResult,
  PipelinePhase,
} from './coding-quality-gate-types.js';

import {
  SherlockPhaseReviewer,
  createSherlockPhaseReviewer,
  type IMemoryRetriever,
  type ISherlockPhaseReviewerConfig,
} from './sherlock-phase-reviewer.js';

import {
  type IPhaseReviewResult,
  InvestigationTier,
  Verdict,
} from './sherlock-phase-reviewer-types.js';

import {
  SherlockLearningIntegration,
  createSherlockLearningIntegration,
  type ISherlockLearningConfig,
  SherlockLearningConfigSchema,
} from './sherlock-learning-integration.js';

import type { ISonaEngine } from '../learning/sona-types.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';

// TYPE DEFINITIONS
/**
 * Supported pipeline types for isolation validation.
 * This module is ONLY for /god-code pipeline, NOT PhD pipeline.
 */
export type PipelineType = 'coding' | 'phd';

/**
 * Configuration for the integrated validator.
 */
export interface IIntegratedValidatorConfig {
  /** Memory retriever for Sherlock */
  readonly memoryRetriever: IMemoryRetriever;
  /** Enable verbose logging */
  readonly verbose?: boolean;
  /** Auto-trigger Sherlock on gate failure */
  readonly autoTriggerSherlock?: boolean;
  /** Default tier for standard reviews */
  readonly defaultTier?: InvestigationTier;
  /** Pipeline type - MUST be 'coding' (PhD uses PhDQualityGateValidator) @default 'coding' */
  readonly pipelineType?: PipelineType;
  /** SonaEngine instance for learning integration (verdicts feed into RLM/LEANN) */
  readonly sonaEngine?: ISonaEngine | null;
  /** ReasoningBank instance for pattern storage (high-quality verdicts create patterns) */
  readonly reasoningBank?: ReasoningBank | null;
  /** Configuration for learning integration */
  readonly learningConfig?: Partial<ISherlockLearningConfig>;
}

/**
 * Zod schema for configuration validation (TS-004).
 */
const IntegratedValidatorConfigSchema = z.object({
  memoryRetriever: z.object({
    retrieve: z.function(),
    store: z.function(),
  }),
  verbose: z.boolean().optional(),
  autoTriggerSherlock: z.boolean().optional().default(true),
  defaultTier: z.nativeEnum(InvestigationTier).optional(),
  pipelineType: z.enum(['coding', 'phd']).optional().default('coding'),
  // TS-004: Added missing fields to match IIntegratedValidatorConfig interface
  sonaEngine: z.any().nullable().optional(),
  reasoningBank: z.any().nullable().optional(),
  learningConfig: SherlockLearningConfigSchema.partial().optional(),
});

/**
 * Combined validation result from both systems.
 */
export interface IIntegratedValidationResult {
  /** Gate validation result */
  readonly gateResult: IGateValidationResult;
  /** Sherlock review result (if triggered) */
  readonly sherlockResult?: IPhaseReviewResult;
  /** Whether pipeline can proceed */
  readonly canProceed: boolean;
  /** Combined remediation actions */
  readonly remediations: readonly string[];
  /** Effective investigation tier used */
  readonly investigationTier?: InvestigationTier;
  /** Timestamp */
  readonly timestamp: Date;
}

/**
 * Maximum history entries to retain (prevents memory leaks).
 */
const MAX_HISTORY_SIZE = 100;

/**
 * Phase-to-gate ID mapping.
 */
const PHASE_GATE_MAP: Record<number, { gateId: string; phase: PipelinePhase }> = {
  1: { gateId: 'GATE-01-UNDERSTANDING', phase: PipelinePhase.UNDERSTANDING },
  2: { gateId: 'GATE-02-EXPLORATION', phase: PipelinePhase.EXPLORATION },
  3: { gateId: 'GATE-03-ARCHITECTURE', phase: PipelinePhase.ARCHITECTURE },
  4: { gateId: 'GATE-04-IMPLEMENTATION', phase: PipelinePhase.IMPLEMENTATION },
  5: { gateId: 'GATE-05-TESTING', phase: PipelinePhase.TESTING },
  6: { gateId: 'GATE-06-OPTIMIZATION', phase: PipelinePhase.OPTIMIZATION },
  7: { gateId: 'GATE-07-DELIVERY', phase: PipelinePhase.DELIVERY },
};

// ERROR CLASS (ERR-002 Compliance)
/**
 * Error codes for integration errors.
 */
export type IntegrationErrorCode =
  | 'CONFIG_INVALID'
  | 'PHASE_INVALID'
  | 'VALIDATION_FAILED'
  | 'SHERLOCK_FAILED';

/**
 * Custom error class for integration errors.
 */
export class IntegratedValidatorError extends Error {
  constructor(
    public readonly code: IntegrationErrorCode,
    message: string,
    public readonly phase?: number
  ) {
    super(message);
    this.name = 'IntegratedValidatorError';
    Object.setPrototypeOf(this, IntegratedValidatorError.prototype);
  }
}

// INTEGRATED VALIDATOR CLASS
/**
 * Integrated validator combining Quality Gate and Sherlock Phase Review.
 *
 * When a Quality Gate fails (SOFT_REJECT or HARD_REJECT), automatically
 * triggers a Sherlock INVESTIGATION tier review for detailed forensics.
 *
 * @example
 * ```typescript
 * const validator = createIntegratedValidator({
 *   memoryRetriever: myMemory,
 *   autoTriggerSherlock: true,
 * });
 *
 * const result = await validator.validatePhase(3, lScore, context);
 * if (!result.canProceed) {
 *   console.log('Remediations:', result.remediations);
 * }
 * ```
 */
export class IntegratedValidator {
  private readonly _gateValidator: CodingQualityGateValidator;
  private readonly _sherlockReviewer: SherlockPhaseReviewer;
  private readonly _learningIntegration: SherlockLearningIntegration;
  private readonly _autoTriggerSherlock: boolean;
  private readonly _verbose: boolean;
  private readonly _validationHistory: IIntegratedValidationResult[] = [];

  constructor(config: IIntegratedValidatorConfig) {
    // Validate config (TS-004)
    const parsed = IntegratedValidatorConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new IntegratedValidatorError(
        'CONFIG_INVALID',
        `Invalid configuration: ${parsed.error.message}`
      );
    }

    // PhD pipeline isolation check (prevents contamination)
    // This validator is ONLY for /god-code coding pipeline
    const pipelineType = config.pipelineType ?? 'coding';
    if (pipelineType === 'phd') {
      throw new IntegratedValidatorError(
        'CONFIG_INVALID',
        'IntegratedValidator is for /god-code coding pipeline only. ' +
        'PhD pipeline must use PhDQualityGateValidator instead.'
      );
    }

    this._gateValidator = createCodingQualityGateValidator();
    this._sherlockReviewer = createSherlockPhaseReviewer({
      memoryRetriever: config.memoryRetriever,
      verbose: config.verbose,
      defaultTier: config.defaultTier,
    });

    // Initialize learning integration for RLM/LEANN feedback
    this._learningIntegration = createSherlockLearningIntegration({
      sonaEngine: config.sonaEngine,
      reasoningBank: config.reasoningBank,
      config: {
        ...config.learningConfig,
        verbose: config.verbose,
      },
    });

    this._autoTriggerSherlock = config.autoTriggerSherlock ?? true;
    this._verbose = config.verbose ?? false;
  }

  /** Validate phase boundary with integrated Quality Gate and Sherlock review. */
  async validatePhase(
    phase: number,
    lScore: ILScoreBreakdown,
    context: IGateValidationContext,
    retryCount: number = 0
  ): Promise<IIntegratedValidationResult> {
    // Validate phase
    const phaseInfo = PHASE_GATE_MAP[phase];
    if (!phaseInfo) {
      throw new IntegratedValidatorError('PHASE_INVALID', `Invalid phase: ${phase}`, phase);
    }

    this._log(`Validating phase ${phase} with integrated validator`);

    // Step 1: Run Quality Gate validation
    const gateResult = await this._gateValidator.validateGate(
      phaseInfo.gateId,
      lScore,
      context
    );

    // Step 2: Determine if Sherlock review is needed
    let sherlockResult: IPhaseReviewResult | undefined;
    let investigationTier: InvestigationTier | undefined;

    if (this._shouldTriggerSherlock(gateResult)) {
      investigationTier = this._selectTier(gateResult, retryCount);
      this._log(`Triggering Sherlock ${investigationTier} review for phase ${phase}`);

      sherlockResult = await this._sherlockReviewer.reviewPhase(
        phase,
        investigationTier,
        retryCount
      );

      // Feed verdict into learning system (RLM/LEANN)
      await this._recordLearningFeedback(sherlockResult);
    }

    // Step 3: Combine results
    const canProceed = this._determineCanProceed(gateResult, sherlockResult);
    const remediations = this._combineRemediations(gateResult, sherlockResult);

    const result: IIntegratedValidationResult = {
      gateResult,
      sherlockResult,
      canProceed,
      remediations,
      investigationTier,
      timestamp: new Date(),
    };

    // Record in history (bounded to prevent memory leaks)
    this._validationHistory.push(result);
    this._trimHistory();

    this._log(`Phase ${phase} validation complete: canProceed=${canProceed}`);
    return result;
  }

  /** Run Sherlock review directly (without gate validation). */
  async reviewPhase(
    phase: number,
    tier?: InvestigationTier,
    retryCount: number = 0
  ): Promise<IPhaseReviewResult> {
    const result = await this._sherlockReviewer.reviewPhase(phase, tier, retryCount);

    // Feed verdict into learning system (RLM/LEANN)
    await this._recordLearningFeedback(result);

    return result;
  }

  /**
   * Quick gate check without Sherlock.
   *
   * @param phase - Phase number
   * @param lScore - L-Score breakdown
   * @returns Whether gate passes
   */
  quickGateCheck(phase: number, lScore: ILScoreBreakdown): boolean {
    const phaseInfo = PHASE_GATE_MAP[phase];
    if (!phaseInfo) return false;
    return this._gateValidator.quickCheck(phaseInfo.gateId, lScore);
  }

  /**
   * Get validation history.
   */
  getValidationHistory(): IIntegratedValidationResult[] {
    return [...this._validationHistory];
  }

  /**
   * Get underlying gate validator.
   */
  getGateValidator(): CodingQualityGateValidator {
    return this._gateValidator;
  }

  /**
   * Get underlying Sherlock reviewer.
   */
  getSherlockReviewer(): SherlockPhaseReviewer {
    return this._sherlockReviewer;
  }

  /**
   * Get underlying learning integration.
   */
  getLearningIntegration(): SherlockLearningIntegration {
    return this._learningIntegration;
  }

  /**
   * Clear all validation history.
   */
  clearHistory(): void {
    this._validationHistory.length = 0;
    this._gateValidator.clearHistory();
    this._sherlockReviewer.clearHistory();
    this._learningIntegration.clearPatterns();
  }

  /**
   * Determine if Sherlock review should be triggered.
   *
   * Per PRD Section 2.3: "Each phase concludes with a **mandatory forensic review**
   * by the sherlock-holmes agent before proceeding to the next phase."
   *
   * This implements the "Guilty Until Proven Innocent" verification model where
   * ALL phases are reviewed, not just failures. The investigation tier is
   * selected based on gate result severity via _selectTier().
   *
   * @private
   */
  private _shouldTriggerSherlock(_gateResult: IGateValidationResult): boolean {
    if (!this._autoTriggerSherlock) {
      return false;
    }

    // MANDATORY review after EVERY phase per PRD Section 2.3
    // Investigation tier escalates based on gate result (see _selectTier)
    return true;
  }

  /**
   * Select investigation tier based on gate result.
   * @private
   */
  private _selectTier(gateResult: IGateValidationResult, retryCount: number): InvestigationTier {
    // HARD_REJECT or multiple retries → DEEP_DIVE
    if (gateResult.result === GateResult.HARD_REJECT || retryCount >= 2) {
      return InvestigationTier.DEEP_DIVE;
    }

    // SOFT_REJECT → INVESTIGATION
    if (gateResult.result === GateResult.SOFT_REJECT || retryCount >= 1) {
      return InvestigationTier.INVESTIGATION;
    }

    // CONDITIONAL_PASS → SCAN
    if (gateResult.result === GateResult.CONDITIONAL_PASS) {
      return InvestigationTier.SCAN;
    }

    return InvestigationTier.GLANCE;
  }

  /**
   * Determine if pipeline can proceed based on both results.
   * @private
   */
  private _determineCanProceed(
    gateResult: IGateValidationResult,
    sherlockResult?: IPhaseReviewResult
  ): boolean {
    // If no Sherlock review, use gate result
    if (!sherlockResult) {
      return gateResult.passed;
    }

    // Both must pass: gate (PASSED or CONDITIONAL_PASS) AND Sherlock (INNOCENT)
    const gateOk = gateResult.result === GateResult.PASSED ||
      gateResult.result === GateResult.CONDITIONAL_PASS ||
      gateResult.result === GateResult.EMERGENCY_BYPASS;

    const sherlockOk = sherlockResult.verdict === Verdict.INNOCENT;

    return gateOk && sherlockOk;
  }

  /**
   * Combine remediations from both systems.
   * @private
   */
  private _combineRemediations(
    gateResult: IGateValidationResult,
    sherlockResult?: IPhaseReviewResult
  ): readonly string[] {
    const remediations: string[] = [...gateResult.remediationActions];

    if (sherlockResult && sherlockResult.verdict === Verdict.GUILTY) {
      // Prefix Sherlock remediations
      for (const r of sherlockResult.remediations) {
        remediations.push(`[SHERLOCK] ${r}`);
      }
    }

    return [...new Set(remediations)]; // Dedupe
  }

  /**
   * Trim history to bounded size (prevents memory leaks).
   * @private
   */
  private _trimHistory(): void {
    while (this._validationHistory.length > MAX_HISTORY_SIZE) {
      this._validationHistory.shift(); // Remove oldest entries
    }
  }

  /**
   * Record Sherlock verdict in learning system.
   * @private
   */
  private async _recordLearningFeedback(result: IPhaseReviewResult): Promise<void> {
    try {
      await this._learningIntegration.recordVerdict(result);
      this._log(`Recorded verdict in learning system: phase=${result.phase}, verdict=${result.verdict}`);
    } catch (error) {
      this._log(`Failed to record learning feedback: ${error}`);
    }
  }

  /**
   * Log message if verbose mode enabled.
   * @private
   */
  private _log(message: string): void {
    if (this._verbose) {
      process.stderr.write(`[INTEGRATED-VALIDATOR] ${message}\n`);
    }
  }
}

// FACTORY FUNCTIONS
/**
 * Create an integrated validator instance.
 *
 * @param config - Configuration options
 * @returns New IntegratedValidator instance
 */
export function createIntegratedValidator(
  config: IIntegratedValidatorConfig
): IntegratedValidator {
  return new IntegratedValidator(config);
}

/** Create a minimal integrated validator for testing. */
export function createTestIntegratedValidator(
  memoryRetriever: IMemoryRetriever
): IntegratedValidator {
  return new IntegratedValidator({
    memoryRetriever,
    verbose: false,
    autoTriggerSherlock: true,
  });
}
