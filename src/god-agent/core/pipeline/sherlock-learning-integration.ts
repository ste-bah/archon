/**
 * Sherlock-Learning Integration
 *
 * Connects Sherlock forensic verdicts to the RLM/LEANN learning system.
 * ONLY for /god-code coding pipeline - NOT for PhD pipeline.
 *
 * @module src/god-agent/core/pipeline/sherlock-learning-integration
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3.5
 */

import { z } from 'zod';
import type { ISonaEngine, IWeightUpdateResult, TrajectoryID } from '../learning/sona-types.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import {
  type IPhaseReviewResult,
  type ICaseFile,
  type IAdversarialFinding,
  Verdict,
  VerdictConfidence,
  FORENSIC_MEMORY_NAMESPACE,
} from './sherlock-phase-reviewer-types.js';
import { getDatabaseConnection } from '../database/connection.js';
import { TrajectoryMetadataDAO } from '../database/dao/trajectory-metadata-dao.js';

// TYPE DEFINITIONS

/**
 * Configuration for Sherlock-Learning integration.
 */
export interface ISherlockLearningConfig {
  /** Enable learning from verdicts */
  readonly enabled: boolean;
  /** Quality threshold for pattern creation (0-1) */
  readonly patternThreshold: number;
  /** Enable verbose logging */
  readonly verbose?: boolean;
  /** Route prefix for forensic trajectories */
  readonly routePrefix: string;
}

/**
 * Zod schema for configuration validation (TS-004).
 */
export const SherlockLearningConfigSchema = z.object({
  enabled: z.boolean().default(true),
  patternThreshold: z.number().min(0).max(1).default(0.75),
  verbose: z.boolean().optional().default(false),
  routePrefix: z.string().default('coding/forensics/'),
});

/**
 * Default configuration.
 */
export const DEFAULT_SHERLOCK_LEARNING_CONFIG: ISherlockLearningConfig = {
  enabled: true,
  patternThreshold: 0.75,
  verbose: false,
  routePrefix: 'coding/forensics/',
};

/**
 * Learning event types for Sherlock integration.
 */
export type SherlockLearningEventType =
  | 'verdict:recorded'
  | 'pattern:created'
  | 'trajectory:feedback';

/**
 * Learning event payload.
 */
export interface ISherlockLearningEvent {
  readonly type: SherlockLearningEventType;
  readonly timestamp: Date;
  readonly phase: number;
  readonly verdict: Verdict;
  readonly quality?: number;
  readonly trajectoryId?: string;
  readonly data?: Record<string, unknown>;
}

/**
 * Listener for learning events.
 */
export type SherlockLearningEventListener = (event: ISherlockLearningEvent) => void;

/**
 * Pattern extracted from forensic investigation.
 */
export interface IForensicPattern {
  /** Pattern ID */
  readonly id: string;
  /** Phase number */
  readonly phase: number;
  /** Verdict that created this pattern */
  readonly verdict: Verdict;
  /** Key findings */
  readonly findings: readonly string[];
  /** Confidence level */
  readonly confidence: VerdictConfidence;
  /** Quality score used for learning */
  readonly quality: number;
  /** Timestamp */
  readonly timestamp: Date;
}

// ERROR CLASS (ERR-002 Compliance)

/**
 * Error codes for Sherlock-Learning integration.
 */
export type SherlockLearningErrorCode =
  | 'CONFIG_INVALID'
  | 'LEARNING_DISABLED'
  | 'TRAJECTORY_FAILED'
  | 'FEEDBACK_FAILED';

/**
 * Custom error class for Sherlock-Learning integration.
 */
export class SherlockLearningError extends Error {
  constructor(
    public readonly code: SherlockLearningErrorCode,
    message: string,
    public readonly phase?: number
  ) {
    super(message);
    this.name = 'SherlockLearningError';
    Object.setPrototypeOf(this, SherlockLearningError.prototype);
  }
}

// QUALITY CALCULATION HELPERS

/**
 * Convert verdict to quality score for learning.
 * INNOCENT = high quality (execution was correct)
 * GUILTY = low quality (execution had issues)
 */
function verdictToQuality(verdict: Verdict, confidence: VerdictConfidence): number {
  const baseScore = verdict === Verdict.INNOCENT
    ? 0.9
    : verdict === Verdict.GUILTY
      ? 0.3
      : 0.5; // INSUFFICIENT_EVIDENCE

  const confidenceMultiplier = confidence === VerdictConfidence.HIGH
    ? 1.0
    : confidence === VerdictConfidence.MEDIUM
      ? 0.85
      : 0.7; // LOW

  return Math.min(1.0, baseScore * confidenceMultiplier);
}

/**
 * Extract key findings from adversarial analysis.
 */
function extractFindings(findings: readonly IAdversarialFinding[]): string[] {
  return findings
    .filter((f) => f.severity === 'critical' || f.severity === 'warning')
    .map((f) => `[${f.persona}] ${f.findings}`)
    .slice(0, 5); // Limit to 5 most important
}

/**
 * Generate pattern ID from case file.
 */
function generatePatternId(caseFile: ICaseFile): string {
  return `forensic-${caseFile.phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build route string for forensic trajectory.
 */
function buildForensicRoute(routePrefix: string, phase: number): string {
  return `${routePrefix}phase-${phase}/verdict`;
}

// SHERLOCK LEARNING INTEGRATION CLASS

/**
 * Integrates Sherlock forensic verdicts with the learning system.
 *
 * When a Sherlock review completes:
 * 1. Creates trajectory for the forensic investigation
 * 2. Provides quality feedback based on verdict
 * 3. Stores high-quality patterns in pattern library
 *
 * CODING PIPELINE ONLY - PhD pipeline uses separate quality validation.
 *
 * @example
 * ```typescript
 * const integration = new SherlockLearningIntegration({
 *   sonaEngine,
 *   reasoningBank,
 * });
 *
 * // After Sherlock review completes
 * await integration.recordVerdict(reviewResult);
 * ```
 */
/**
 * Maximum patterns to retain (prevents memory leaks).
 */
const MAX_PATTERNS_SIZE = 500;

export class SherlockLearningIntegration {
  private readonly _sonaEngine: ISonaEngine | null;
  private readonly _reasoningBank: ReasoningBank | null;
  private readonly _config: ISherlockLearningConfig;
  private readonly _listeners: SherlockLearningEventListener[] = [];
  private readonly _patterns: Map<string, IForensicPattern> = new Map();

  constructor(options: {
    sonaEngine?: ISonaEngine | null;
    reasoningBank?: ReasoningBank | null;
    config?: Partial<ISherlockLearningConfig>;
  }) {
    this._sonaEngine = options.sonaEngine ?? null;
    this._reasoningBank = options.reasoningBank ?? null;

    // Validate config (TS-004)
    const parsed = SherlockLearningConfigSchema.safeParse(
      options.config ?? DEFAULT_SHERLOCK_LEARNING_CONFIG
    );
    if (!parsed.success) {
      throw new SherlockLearningError(
        'CONFIG_INVALID',
        `Invalid configuration: ${parsed.error.message}`
      );
    }
    this._config = parsed.data;
  }

  /**
   * Record a Sherlock verdict and feed into learning system.
   *
   * @param result - Phase review result from Sherlock
   * @returns Weight update result if learning occurred
   */
  async recordVerdict(result: IPhaseReviewResult): Promise<IWeightUpdateResult | null> {
    if (!this._config.enabled) {
      this._log(`Learning disabled, skipping verdict for phase ${result.phase}`);
      return null;
    }

    if (!this._sonaEngine) {
      this._log(`No SonaEngine available, skipping learning for phase ${result.phase}`);
      return null;
    }

    const quality = verdictToQuality(result.verdict, result.confidence);
    this._log(`Recording verdict: phase=${result.phase}, verdict=${result.verdict}, quality=${quality.toFixed(2)}`);

    // Create trajectory for this forensic investigation
    const trajectoryId = this._createTrajectory(result);

    // Emit event
    this._emitEvent({
      type: 'verdict:recorded',
      timestamp: new Date(),
      phase: result.phase,
      verdict: result.verdict,
      quality,
      trajectoryId,
    });

    // Provide feedback to SonaEngine
    const updateResult = await this._provideFeedback(trajectoryId, quality, result);

    // Store pattern if quality is high enough
    if (quality >= this._config.patternThreshold) {
      await this._storePattern(result, quality);
    }

    return updateResult;
  }

  /**
   * Create trajectory for forensic investigation.
   */
  private _createTrajectory(result: IPhaseReviewResult): TrajectoryID {
    const trajectoryId = `sherlock-${result.caseFile.caseId}`;
    const route = buildForensicRoute(this._config.routePrefix, result.phase);

    // Get pattern IDs from verification results
    const patterns = result.caseFile.verificationResults
      .filter((v) => v.passed)
      .map((v) => `verification-${v.check}`);

    // Context includes the case file ID
    const context = [result.caseFile.caseId];

    if (this._sonaEngine) {
      this._sonaEngine.createTrajectoryWithId(trajectoryId, route, patterns, context);

      // Persist verdict to SQLite for future injection into agent prompts.
      // INSERT a new trajectory_metadata row — SonaEngine stores trajectories
      // in memory only, so dao.exists() would return false. We create the
      // SQLite record ourselves with verdict data attached.
      try {
        const db = getDatabaseConnection();
        const dao = new TrajectoryMetadataDAO(db);
        if (dao.exists(trajectoryId)) {
          // Row already exists (e.g. from a prior run) — just update verdict
          dao.updateVerdict(
            trajectoryId,
            result.verdict,
            result.confidence,
            result.remediations.length
          );
        } else {
          // Create new trajectory_metadata row with verdict
          dao.insert({
            id: trajectoryId,
            filePath: '',           // no binary trajectory file for Sherlock
            fileOffset: 0,
            fileLength: 0,
            route,
            stepCount: result.caseFile.verificationResults.length,
            qualityScore: verdictToQuality(result.verdict, result.confidence),
            createdAt: Date.now(),
            status: 'completed',
            verdict: result.verdict,
            verdictConfidence: result.confidence,
            remediationCount: result.remediations.length,
          });
        }
        this._log(`Persisted verdict ${result.verdict} (${result.confidence}) to SQLite`);
      } catch (err) {
        this._log(`Warning: Failed to persist verdict to SQLite: ${err}`);
      }
    }

    return trajectoryId;
  }

  /**
   * Provide feedback to SonaEngine.
   */
  private async _provideFeedback(
    trajectoryId: TrajectoryID,
    quality: number,
    result: IPhaseReviewResult
  ): Promise<IWeightUpdateResult | null> {
    if (!this._sonaEngine) return null;

    try {
      const updateResult = await this._sonaEngine.provideFeedback(trajectoryId, quality, {
        lScore: quality,
        rlmContext: {
          injectionSuccess: true,
          sourceAgentKey: `sherlock-phase-${result.phase}`,
          sourceStepIndex: result.phase,
          sourceDomain: FORENSIC_MEMORY_NAMESPACE.caseFile(result.phase),
        },
      });

      this._emitEvent({
        type: 'trajectory:feedback',
        timestamp: new Date(),
        phase: result.phase,
        verdict: result.verdict,
        quality,
        trajectoryId,
        data: { patternsUpdated: updateResult.patternsUpdated },
      });

      return updateResult;
    } catch (error) {
      this._log(`Failed to provide feedback: ${error}`);
      return null;
    }
  }

  /**
   * Store high-quality pattern in pattern library.
   */
  private async _storePattern(result: IPhaseReviewResult, quality: number): Promise<void> {
    const patternId = generatePatternId(result.caseFile);
    const findings = extractFindings(result.caseFile.adversarialFindings);

    const pattern: IForensicPattern = {
      id: patternId,
      phase: result.phase,
      verdict: result.verdict,
      findings,
      confidence: result.confidence,
      quality,
      timestamp: new Date(),
    };

    // Store locally with bounded size (prevents memory leaks)
    this._trimPatterns();
    this._patterns.set(patternId, pattern);

    // Store in ReasoningBank if available
    if (this._reasoningBank && result.verdict === Verdict.INNOCENT) {
      try {
        await this._reasoningBank.provideFeedback({
          trajectoryId: `sherlock-${result.caseFile.caseId}`,
          verdict: 'correct',
          quality,
        });

        this._emitEvent({
          type: 'pattern:created',
          timestamp: new Date(),
          phase: result.phase,
          verdict: result.verdict,
          quality,
          data: { patternId, findings },
        });
      } catch (error) {
        this._log(`Failed to store pattern in ReasoningBank: ${error}`);
      }
    }
  }

  /**
   * Add event listener.
   */
  addEventListener(listener: SherlockLearningEventListener): void {
    this._listeners.push(listener);
  }

  /**
   * Remove event listener.
   */
  removeEventListener(listener: SherlockLearningEventListener): void {
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
    }
  }

  /**
   * Get all stored patterns.
   */
  getPatterns(): IForensicPattern[] {
    return Array.from(this._patterns.values());
  }

  /**
   * Get patterns for a specific phase.
   */
  getPatternsForPhase(phase: number): IForensicPattern[] {
    return this.getPatterns().filter((p) => p.phase === phase);
  }

  /**
   * Clear all patterns.
   */
  clearPatterns(): void {
    this._patterns.clear();
  }

  /**
   * Check if learning is enabled.
   */
  isEnabled(): boolean {
    return this._config.enabled && this._sonaEngine !== null;
  }

  /**
   * Get configuration.
   */
  getConfig(): ISherlockLearningConfig {
    return { ...this._config };
  }

  /**
   * Emit learning event.
   */
  private _emitEvent(event: ISherlockLearningEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        this._log(`Event listener error: ${error}`);
      }
    }
  }

  /**
   * Trim patterns to bounded size (prevents memory leaks).
   */
  private _trimPatterns(): void {
    while (this._patterns.size >= MAX_PATTERNS_SIZE) {
      const oldest = this._patterns.keys().next().value;
      if (oldest) {
        this._patterns.delete(oldest);
      } else {
        break;
      }
    }
  }

  /**
   * Log message if verbose mode enabled.
   */
  private _log(message: string): void {
    if (this._config.verbose) {
      process.stderr.write(`[SHERLOCK-LEARNING] ${message}\n`);
    }
  }
}

// FACTORY FUNCTIONS

/**
 * Create a Sherlock-Learning integration instance.
 *
 * @param options - Integration options
 * @returns New SherlockLearningIntegration instance
 */
export function createSherlockLearningIntegration(options: {
  sonaEngine?: ISonaEngine | null;
  reasoningBank?: ReasoningBank | null;
  config?: Partial<ISherlockLearningConfig>;
}): SherlockLearningIntegration {
  return new SherlockLearningIntegration(options);
}

/**
 * Create a minimal Sherlock-Learning integration for testing.
 *
 * @returns New SherlockLearningIntegration instance with no backing engines
 */
export function createTestSherlockLearningIntegration(): SherlockLearningIntegration {
  return new SherlockLearningIntegration({
    config: { enabled: true, patternThreshold: 0.75 },
  });
}
