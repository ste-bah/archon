/**
 * Step Capture Service
 * SPEC-SON-001 - Captures reasoning steps during trajectory execution
 *
 * Production-ready implementation with:
 * - Thread-safe step buffer per trajectory
 * - Automatic result compression
 * - Configurable limits
 * - Memory-efficient storage
 */

import type { IReasoningStep, ReasoningStepAction, IStepCaptureConfig } from './sona-types.js';

/** Trajectory ID type */
export type TrajectoryID = string;

/** Default configuration */
const DEFAULT_CONFIG: Required<IStepCaptureConfig> = {
  maxResultSize: 1000,
  maxSteps: 100,
  verbose: false,
};

/**
 * Service for capturing reasoning steps during trajectory execution
 * Designed for production use with proper resource management
 */
export class StepCaptureService {
  private readonly config: Required<IStepCaptureConfig>;
  private readonly stepBuffer: Map<TrajectoryID, IReasoningStep[]>;
  private currentTrajectory: TrajectoryID | null = null;

  constructor(config: IStepCaptureConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stepBuffer = new Map();
  }

  /**
   * Begin capturing steps for a trajectory
   * @param trajectoryId - Unique trajectory identifier
   */
  beginCapture(trajectoryId: TrajectoryID): void {
    if (this.stepBuffer.has(trajectoryId)) {
      console.warn(`[StepCapture] Trajectory ${trajectoryId} already has capture in progress`);
    }
    this.currentTrajectory = trajectoryId;
    this.stepBuffer.set(trajectoryId, []);

    if (this.config.verbose) {
      console.log(`[StepCapture] Started capture for trajectory: ${trajectoryId}`);
    }
  }

  /**
   * Capture a reasoning step
   * @param step - Step data (without auto-generated fields)
   */
  captureStep(step: Omit<IReasoningStep, 'stepId' | 'timestamp'>): void {
    if (!this.currentTrajectory) {
      console.warn('[StepCapture] No active trajectory for step capture');
      return;
    }

    const steps = this.stepBuffer.get(this.currentTrajectory);
    if (!steps) {
      console.warn(`[StepCapture] No buffer for trajectory: ${this.currentTrajectory}`);
      return;
    }

    // Check step limit
    if (steps.length >= this.config.maxSteps) {
      console.warn(`[StepCapture] Max steps (${this.config.maxSteps}) reached for trajectory`);
      return;
    }

    const fullStep: IReasoningStep = {
      ...step,
      stepId: `step_${steps.length + 1}_${Date.now().toString(36)}`,
      timestamp: Date.now(),
    };

    // Compress large results
    if (fullStep.result && fullStep.result.length > this.config.maxResultSize) {
      const truncated = fullStep.result.slice(0, this.config.maxResultSize);
      fullStep.resultRef = {
        type: 'memory',
        id: `result_${fullStep.stepId}`,
      };
      fullStep.result = truncated + `... [truncated ${fullStep.result.length - this.config.maxResultSize} chars]`;
    }

    steps.push(fullStep);

    if (this.config.verbose) {
      console.log(`[StepCapture] Captured step: ${fullStep.action} (${fullStep.stepId})`);
    }
  }

  /**
   * Capture step with timing measurement
   * @param action - Action type
   * @param actionParams - Action parameters
   * @param executor - Async function to execute and time
   * @returns Result of executor
   */
  async captureWithTiming<T>(
    action: ReasoningStepAction,
    actionParams: Record<string, unknown>,
    executor: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let result: T;
    let error: string | undefined;
    let confidence = 0.8;

    try {
      result = await executor();
      confidence = this.estimateConfidence(result);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      confidence = 0;
      // RULE-070: Re-throw with step capture context
      throw new Error(
        `Step capture failed for action "${action}": ${error}`,
        { cause: err }
      );
    } finally {
      const duration = Date.now() - startTime;

      this.captureStep({
        action,
        actionParams,
        result: error ? `Error: ${error}` : this.serializeResult(result!),
        confidence,
        metadata: {
          duration,
          error,
        },
      });
    }

    return result!;
  }

  /**
   * Finish capturing and return steps
   * @param trajectoryId - Trajectory to finalize
   * @returns Array of captured steps
   */
  endCapture(trajectoryId: TrajectoryID): IReasoningStep[] {
    const steps = this.stepBuffer.get(trajectoryId) || [];
    this.stepBuffer.delete(trajectoryId);

    if (this.currentTrajectory === trajectoryId) {
      this.currentTrajectory = null;
    }

    if (this.config.verbose) {
      console.log(`[StepCapture] Ended capture for ${trajectoryId}: ${steps.length} steps`);
    }

    return steps;
  }

  /**
   * Get captured steps for trajectory (without ending capture)
   * @param trajectoryId - Trajectory ID
   * @returns Current captured steps
   */
  getSteps(trajectoryId: TrajectoryID): IReasoningStep[] {
    return [...(this.stepBuffer.get(trajectoryId) || [])];
  }

  /**
   * Get current active trajectory
   */
  getCurrentTrajectory(): TrajectoryID | null {
    return this.currentTrajectory;
  }

  /**
   * Check if trajectory has active capture
   */
  hasActiveCapture(trajectoryId: TrajectoryID): boolean {
    return this.stepBuffer.has(trajectoryId);
  }

  /**
   * Get statistics about capture service
   */
  getStats(): {
    activeCaptures: number;
    currentTrajectory: TrajectoryID | null;
    totalStepsCaptured: number;
    totalTrajectories?: number;
  } {
    let totalSteps = 0;
    // Convert to array to avoid iteration issues
    const bufferValues = Array.from(this.stepBuffer.values());
    for (const steps of bufferValues) {
      totalSteps += steps.length;
    }

    return {
      activeCaptures: this.stepBuffer.size,
      currentTrajectory: this.currentTrajectory,
      totalStepsCaptured: totalSteps,
      totalTrajectories: this.stepBuffer.size,
    };
  }

  /**
   * Clear all captures (for cleanup/testing)
   */
  clear(): void {
    this.stepBuffer.clear();
    this.currentTrajectory = null;
  }

  /**
   * Estimate confidence from result
   */
  private estimateConfidence(result: unknown): number {
    if (result === null || result === undefined) return 0.1;
    if (typeof result === 'boolean') return result ? 0.9 : 0.3;
    if (Array.isArray(result)) {
      return result.length > 0 ? Math.min(0.95, 0.5 + result.length * 0.05) : 0.2;
    }
    if (typeof result === 'object') {
      const keys = Object.keys(result);
      return keys.length > 0 ? Math.min(0.9, 0.6 + keys.length * 0.03) : 0.3;
    }
    return 0.7;
  }

  /**
   * Serialize result to string for storage
   */
  private serializeResult(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result === null || result === undefined) return '';
    try {
      return JSON.stringify(result);
    } catch {
      // INTENTIONAL: JSON serialization failure - convert to string as fallback
      return String(result);
    }
  }
}

/**
 * Singleton instance for global step capture
 * Use this for simple cases; create instances for complex scenarios
 */
let globalCaptureService: StepCaptureService | null = null;

export function getGlobalStepCapture(): StepCaptureService {
  if (!globalCaptureService) {
    globalCaptureService = new StepCaptureService();
  }
  return globalCaptureService;
}

export function resetGlobalStepCapture(): void {
  globalCaptureService?.clear();
  globalCaptureService = null;
}
