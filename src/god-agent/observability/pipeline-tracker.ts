/**
 * PipelineTracker - Track DAI-002 pipeline execution with step-by-step progress
 *
 * Implements pipeline execution tracking with per-step timing, status, and overall progress.
 * Maintains bounded list of active and completed pipelines with FIFO eviction.
 *
 * @module observability/pipeline-tracker
 * @see TASK-OBS-004-PIPELINE-TRACKER.md
 * @see TECH-OBS-001-IMPLEMENTATION.md Section 3.5
 */

import {
  ActivityEventComponent,
  ActivityEventStatus,
} from './types.js';
import { IActivityStream } from './activity-stream.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('PipelineTracker', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Pipeline start configuration
 */
export interface IPipelineStart {
  /** Pipeline name */
  name: string;
  /** Ordered step names */
  steps: string[];
  /** Task type (e.g., 'research', 'code', 'analysis') */
  taskType: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Step start configuration
 */
export interface IStepStart {
  /** Step name */
  name: string;
  /** Agent type executing this step (optional) */
  agentType?: string;
}

/**
 * Step result after completion
 */
export interface IStepResult {
  /** Step output data */
  output?: unknown;
  /** Files modified during step */
  filesModified?: string[];
}

/**
 * Pipeline result after completion
 */
export interface IPipelineResult {
  /** Pipeline output */
  output: unknown;
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

/**
 * Step status tracking
 */
export interface IStepStatus {
  /** Unique step ID */
  id: string;
  /** Step name */
  name: string;
  /** Step execution status */
  status: 'pending' | 'running' | 'success' | 'error';
  /** Start time (Unix epoch ms) */
  startTime?: number;
  /** End time (Unix epoch ms) */
  endTime?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Agent type executing this step */
  agentType?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Pipeline status tracking
 */
export interface IPipelineStatus {
  /** Unique pipeline ID */
  id: string;
  /** Pipeline name */
  name: string;
  /** Pipeline status */
  status: 'running' | 'success' | 'error';
  /** Start time (Unix epoch ms) */
  startTime: number;
  /** End time (Unix epoch ms) */
  endTime?: number;
  /** Total steps in pipeline */
  totalSteps: number;
  /** Number of completed steps */
  completedSteps: number;
  /** Current step name (if running) */
  currentStep?: string;
  /** Steps status array */
  steps: IStepStatus[];
  /** Progress percentage 0-100 */
  progress: number;
}

/**
 * PipelineTracker interface
 * Implements [REQ-OBS-06]: Pipeline execution monitoring
 */
export interface IPipelineTracker {
  /**
   * Start tracking a new pipeline
   * @param pipeline Pipeline start configuration
   * @returns Unique pipeline ID
   */
  startPipeline(pipeline: IPipelineStart): string;

  /**
   * Start a pipeline step
   * @param pipelineId Pipeline ID
   * @param step Step start configuration
   * @returns Unique step ID
   */
  startStep(pipelineId: string, step: IStepStart): string;

  /**
   * Mark a step as completed
   * @param pipelineId Pipeline ID
   * @param stepId Step ID
   * @param result Step result data
   */
  completeStep(pipelineId: string, stepId: string, result: IStepResult): void;

  /**
   * Mark a step as failed
   * @param pipelineId Pipeline ID
   * @param stepId Step ID
   * @param error Error that caused failure
   */
  failStep(pipelineId: string, stepId: string, error: Error): void;

  /**
   * Mark pipeline as completed
   * @param pipelineId Pipeline ID
   * @param result Pipeline result data
   */
  completePipeline(pipelineId: string, result: IPipelineResult): void;

  /**
   * Mark pipeline as failed
   * @param pipelineId Pipeline ID
   * @param error Error that caused failure
   */
  failPipeline(pipelineId: string, error: Error): void;

  /**
   * Get all active pipelines
   * @returns Array of active pipeline statuses
   */
  getActive(): IPipelineStatus[];

  /**
   * Get a pipeline by ID
   * @param pipelineId Pipeline ID
   * @returns Pipeline status or null if not found
   */
  getById(pipelineId: string): IPipelineStatus | null;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * PipelineTracker implementation
 *
 * Implements:
 * - [REQ-OBS-06]: Pipeline execution monitoring
 * - [REQ-OBS-10]: Pipeline status and per-step execution tracking
 * - [RULE-OBS-004]: Memory bounds enforcement (20 completed max)
 */
export class PipelineTracker implements IPipelineTracker {
  // Active pipelines by ID
  private active: Map<string, IPipelineStatus> = new Map();

  // Completed pipelines (FIFO, max 20)
  private completed: IPipelineStatus[] = [];

  // Maximum completed pipelines to retain
  private readonly MAX_COMPLETED = 20;

  /**
   * Create a new PipelineTracker
   * @param activityStream ActivityStream for event emission
   */
  constructor(private activityStream: IActivityStream) {}

  /**
   * Start tracking a new pipeline
   * Implements [REQ-OBS-10]: Track pipeline start
   *
   * @param pipeline Pipeline start configuration
   * @returns Unique pipeline ID (format: pipe_{name}_{timestamp}_{random})
   */
  public startPipeline(pipeline: IPipelineStart): string {
    // Generate pipeline ID
    const pipelineId = this.generatePipelineId(pipeline.name);

    // Initialize steps as pending
    const steps: IStepStatus[] = pipeline.steps.map((stepName) => ({
      id: '',  // Will be set when step starts
      name: stepName,
      status: 'pending',
    }));

    // Create pipeline status
    const pipelineStatus: IPipelineStatus = {
      id: pipelineId,
      name: pipeline.name,
      status: 'running',
      startTime: Date.now(),
      totalSteps: pipeline.steps.length,
      completedSteps: 0,
      steps,
      progress: 0,
    };

    // Store in active map
    this.active.set(pipelineId, pipelineStatus);

    // Emit pipeline_started event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'pipeline' as ActivityEventComponent,
      operation: 'pipeline_started',
      status: 'running' as ActivityEventStatus,
      metadata: {
        pipelineId,
        name: pipeline.name,
        taskType: pipeline.taskType,
        totalSteps: pipeline.steps.length,
        steps: pipeline.steps,
        ...pipeline.metadata,
      },
    });

    return pipelineId;
  }

  /**
   * Start a pipeline step
   *
   * @param pipelineId Pipeline ID
   * @param step Step start configuration
   * @returns Unique step ID
   */
  public startStep(pipelineId: string, step: IStepStart): string {
    const pipeline = this.active.get(pipelineId);

    if (!pipeline) {
      logger.warn('Attempted to start step in unknown pipeline', { pipelineId });
      return '';
    }

    // Find the step by name
    const stepIndex = pipeline.steps.findIndex((s) => s.name === step.name && s.status === 'pending');

    if (stepIndex === -1) {
      logger.warn('Step not found or already started in pipeline', { stepName: step.name, pipelineId });
      return '';
    }

    // Generate step ID
    const stepId = this.generateStepId(pipelineId, stepIndex);

    // Update step status
    pipeline.steps[stepIndex] = {
      id: stepId,
      name: step.name,
      status: 'running',
      startTime: Date.now(),
      agentType: step.agentType,
    };

    // Update current step
    pipeline.currentStep = step.name;

    // Emit step_started event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'pipeline' as ActivityEventComponent,
      operation: 'step_started',
      status: 'running' as ActivityEventStatus,
      metadata: {
        pipelineId,
        stepId,
        stepName: step.name,
        stepIndex,
        agentType: step.agentType,
      },
    });

    return stepId;
  }

  /**
   * Mark a step as completed
   *
   * @param pipelineId Pipeline ID
   * @param stepId Step ID
   * @param result Step result data
   */
  public completeStep(pipelineId: string, stepId: string, result: IStepResult): void {
    const pipeline = this.active.get(pipelineId);

    if (!pipeline) {
      logger.warn('Attempted to complete step in unknown pipeline', { pipelineId });
      return;
    }

    // Find the step by ID
    const step = pipeline.steps.find((s) => s.id === stepId);

    if (!step) {
      logger.warn('Step not found in pipeline (complete)', { stepId, pipelineId });
      return;
    }

    // Calculate duration
    const endTime = Date.now();
    const durationMs = step.startTime ? endTime - step.startTime : 0;

    // Update step status
    step.status = 'success';
    step.endTime = endTime;
    step.durationMs = durationMs;

    // Update pipeline progress
    pipeline.completedSteps++;
    pipeline.progress = (pipeline.completedSteps / pipeline.totalSteps) * 100;

    // Clear current step if all completed
    if (pipeline.completedSteps === pipeline.totalSteps) {
      pipeline.currentStep = undefined;
    } else {
      // Set current step to next pending step
      const nextStep = pipeline.steps.find((s) => s.status === 'pending');
      pipeline.currentStep = nextStep?.name;
    }

    // Emit step_completed event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'pipeline' as ActivityEventComponent,
      operation: 'step_completed',
      status: 'success' as ActivityEventStatus,
      durationMs,
      metadata: {
        pipelineId,
        stepId,
        stepName: step.name,
        progress: pipeline.progress,
        completedSteps: pipeline.completedSteps,
        totalSteps: pipeline.totalSteps,
        filesModified: result.filesModified,
      },
    });
  }

  /**
   * Mark a step as failed
   *
   * @param pipelineId Pipeline ID
   * @param stepId Step ID
   * @param error Error that caused failure
   */
  public failStep(pipelineId: string, stepId: string, error: Error): void {
    const pipeline = this.active.get(pipelineId);

    if (!pipeline) {
      logger.warn('Attempted to fail step in unknown pipeline', { pipelineId });
      return;
    }

    // Find the step by ID
    const step = pipeline.steps.find((s) => s.id === stepId);

    if (!step) {
      logger.warn('Step not found in pipeline (fail)', { stepId, pipelineId });
      return;
    }

    // Calculate duration
    const endTime = Date.now();
    const durationMs = step.startTime ? endTime - step.startTime : 0;

    // Update step status
    step.status = 'error';
    step.endTime = endTime;
    step.durationMs = durationMs;
    step.error = error.message;

    // Emit step_failed event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'pipeline' as ActivityEventComponent,
      operation: 'step_failed',
      status: 'error' as ActivityEventStatus,
      durationMs,
      metadata: {
        pipelineId,
        stepId,
        stepName: step.name,
        error: error.message,
      },
    });
  }

  /**
   * Mark pipeline as completed
   *
   * @param pipelineId Pipeline ID
   * @param result Pipeline result data
   */
  public completePipeline(pipelineId: string, result: IPipelineResult): void {
    const pipeline = this.active.get(pipelineId);

    if (!pipeline) {
      logger.warn('Attempted to complete unknown pipeline', { pipelineId });
      return;
    }

    // Update pipeline status
    const endTime = Date.now();
    pipeline.status = 'success';
    pipeline.endTime = endTime;
    pipeline.currentStep = undefined;

    // Move from active to completed
    this.active.delete(pipelineId);
    this.addCompleted(pipeline);

    // Emit pipeline_completed event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'pipeline' as ActivityEventComponent,
      operation: 'pipeline_completed',
      status: 'success' as ActivityEventStatus,
      durationMs: result.totalDurationMs,
      metadata: {
        pipelineId,
        name: pipeline.name,
        totalSteps: pipeline.totalSteps,
        completedSteps: pipeline.completedSteps,
        progress: pipeline.progress,
      },
    });
  }

  /**
   * Mark pipeline as failed
   *
   * @param pipelineId Pipeline ID
   * @param error Error that caused failure
   */
  public failPipeline(pipelineId: string, error: Error): void {
    const pipeline = this.active.get(pipelineId);

    if (!pipeline) {
      logger.warn('Attempted to fail unknown pipeline', { pipelineId });
      return;
    }

    // Calculate duration
    const endTime = Date.now();
    const durationMs = endTime - pipeline.startTime;

    // Update pipeline status
    pipeline.status = 'error';
    pipeline.endTime = endTime;
    pipeline.currentStep = undefined;

    // Move from active to completed
    this.active.delete(pipelineId);
    this.addCompleted(pipeline);

    // Emit pipeline_failed event
    this.activityStream.push({
      id: `evt_${Date.now()}_${this.randomId()}`,
      timestamp: Date.now(),
      component: 'pipeline' as ActivityEventComponent,
      operation: 'pipeline_failed',
      status: 'error' as ActivityEventStatus,
      durationMs,
      metadata: {
        pipelineId,
        name: pipeline.name,
        error: error.message,
        completedSteps: pipeline.completedSteps,
        totalSteps: pipeline.totalSteps,
      },
    });
  }

  /**
   * Get all active pipelines
   * @returns Array of active pipeline statuses
   */
  public getActive(): IPipelineStatus[] {
    return Array.from(this.active.values());
  }

  /**
   * Get a pipeline by ID
   * @param pipelineId Pipeline ID
   * @returns Pipeline status or null if not found
   */
  public getById(pipelineId: string): IPipelineStatus | null {
    // Check active first
    const activePipeline = this.active.get(pipelineId);
    if (activePipeline) {
      return activePipeline;
    }

    // Check completed
    const completedPipeline = this.completed.find((p) => p.id === pipelineId);
    return completedPipeline || null;
  }

  /**
   * Get statistics about tracker state
   */
  public getStats(): {
    activeCount: number;
    completedCount: number;
    maxCompleted: number;
  } {
    return {
      activeCount: this.active.size,
      completedCount: this.completed.length,
      maxCompleted: this.MAX_COMPLETED,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate a unique pipeline ID
   * Format: pipe_{name}_{timestamp}_{random}
   *
   * @param name Pipeline name
   * @returns Unique pipeline ID
   */
  private generatePipelineId(name: string): string {
    const timestamp = Date.now();
    const random = this.randomId();
    return `pipe_${name}_${timestamp}_${random}`;
  }

  /**
   * Generate a unique step ID
   * Format: step_{pipelineId}_{stepIndex}_{random}
   *
   * @param pipelineId Pipeline ID
   * @param stepIndex Step index
   * @returns Unique step ID
   */
  private generateStepId(pipelineId: string, stepIndex: number): string {
    const random = this.randomId();
    return `step_${pipelineId}_${stepIndex}_${random}`;
  }

  /**
   * Generate a random 6-character ID
   * @returns Random alphanumeric string
   */
  private randomId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  /**
   * Add a completed pipeline to the completed list
   * Implements FIFO eviction when exceeding MAX_COMPLETED
   *
   * @param pipeline The completed pipeline
   */
  private addCompleted(pipeline: IPipelineStatus): void {
    // Add to end of array
    this.completed.push(pipeline);

    // Evict oldest if exceeding max
    if (this.completed.length > this.MAX_COMPLETED) {
      this.completed.shift();  // Remove first (oldest)
    }
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default PipelineTracker;
