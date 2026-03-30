/**
 * DAI-003: Pipeline Generator Implementation
 *
 * TASK-008: Pipeline Generator
 * Constitution: US-005, US-006, INT-004, INT-008
 *
 * Generates DAI-002 pipeline definitions from natural language multi-step tasks.
 *
 * Features:
 * - Splits multi-step tasks at sequence markers (then, after, finally, etc.)
 * - Routes each stage via RoutingEngine with real capability matching
 * - Generates valid IPipelineDefinition format for DAI-002
 * - Validates 2-10 stage limits
 * - Estimates duration (30s per stage)
 * - Calculates overall confidence (min of stage confidences)
 * - NO external LLM calls (pure deterministic generation)
 *
 * Performance target: < 600ms (P95) per INT-008
 *
 * @module src/god-agent/core/routing/pipeline-generator
 */

import type {
  IPipelineGenerator,
  IGeneratedPipeline,
  IGeneratedStage,
  IRoutingConfig,
} from './routing-types.js';
import { DEFAULT_ROUTING_CONFIG } from './routing-types.js';
import { PipelineGenerationError } from './routing-errors.js';
import { RoutingEngine } from './routing-engine.js';
import { TaskAnalyzer } from './task-analyzer.js';
import { CapabilityIndex } from './capability-index.js';

// ==================== Configuration ====================

/**
 * Configuration for PipelineGenerator
 */
export interface IPipelineGeneratorConfig {
  /** Routing engine instance (optional, creates one if not provided) */
  routingEngine?: RoutingEngine;

  /** Task analyzer instance (optional, creates one if not provided) */
  taskAnalyzer?: TaskAnalyzer;

  /** Routing configuration (optional, uses defaults) */
  routingConfig?: IRoutingConfig;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;

  /** Capability index configuration overrides (optional, passed through to CapabilityIndex) */
  capabilityIndexConfig?: Record<string, unknown>;
}

// ==================== Sequence Markers ====================

/**
 * Sequence markers that indicate multi-step tasks
 * Used to split task descriptions into stages
 */
const SEQUENCE_MARKERS = [
  'then',
  'after',
  'after that',
  'finally',
  'and then',
  'next',
  'subsequently',
  'following that',
  'once complete',
  'afterwards',
] as const;

// ==================== Pipeline Generator Implementation ====================

/**
 * Pipeline generator for multi-step task orchestration
 * Implements deterministic pipeline generation with routing integration
 *
 * @implements IPipelineGenerator
 */
export class PipelineGenerator implements IPipelineGenerator {
  private routingEngine: RoutingEngine;
  private taskAnalyzer: TaskAnalyzer;
  private capabilityIndex: CapabilityIndex | null;
  private readonly config: IRoutingConfig;
  private readonly verbose: boolean;
  private initialized: boolean = false;

  constructor(config: IPipelineGeneratorConfig = {}) {
    // Create shared capability index if routing engine not provided
    if (!config.routingEngine) {
      this.capabilityIndex = new CapabilityIndex({ verbose: config.verbose, ...config.capabilityIndexConfig });
      this.routingEngine = new RoutingEngine({
        capabilityIndex: this.capabilityIndex,
        routingConfig: config.routingConfig,
        verbose: config.verbose
      });
    } else {
      this.capabilityIndex = null;
      this.routingEngine = config.routingEngine;
    }

    this.taskAnalyzer = config.taskAnalyzer ?? new TaskAnalyzer({ verbose: config.verbose });
    this.config = config.routingConfig ?? DEFAULT_ROUTING_CONFIG;
    this.verbose = config.verbose ?? false;
  }

  /**
   * Initialize the pipeline generator
   * Initializes capability index for routing engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize capability index if we own it
    if (this.capabilityIndex) {
      await this.capabilityIndex.initialize();
      if (this.verbose) {
        console.log('[PipelineGenerator] Capability index initialized');
      }
    }

    this.initialized = true;

    if (this.verbose) {
      console.log('[PipelineGenerator] Initialized');
    }
  }

  /**
   * Generate a pipeline from natural language multi-step task
   * Per INT-004: Multi-step task → pipeline stages
   * Per INT-008: Generation completes in < 600ms (P95)
   *
   * @param task - Multi-step task description
   * @returns Generated pipeline definition
   * @throws PipelineGenerationError if generation fails
   */
  async generate(task: string): Promise<IGeneratedPipeline> {
    const startTime = performance.now();

    // Ensure initialized
    await this.initialize();

    // Validate task is not empty
    if (!task || task.trim().length === 0) {
      throw new PipelineGenerationError(
        'Task description cannot be empty',
        task,
        'validation',
        0,
        0
      );
    }

    const normalizedTask = task.trim();

    try {
      // Step 1: Split task into segments
      const segments = this.splitIntoSegments(normalizedTask);

      // Step 2: Validate segment count (2-10 stages)
      if (segments.length < 2) {
        throw new PipelineGenerationError(
          'Use routeTask for single-step tasks',
          normalizedTask,
          'validation',
          0,
          1
        );
      }

      if (segments.length > this.config.maxPipelineStages) {
        throw new PipelineGenerationError(
          `Pipeline exceeds maximum of ${this.config.maxPipelineStages} stages`,
          normalizedTask,
          'validation',
          0,
          segments.length
        );
      }

      if (this.verbose) {
        console.log(`[PipelineGenerator] Generating pipeline with ${segments.length} stages`);
      }

      // Step 3: Generate stages
      const stages = await this.generateStages(segments, normalizedTask);

      // Step 4: Build pipeline definition
      const pipeline = this.buildPipelineDefinition(
        normalizedTask,
        stages,
        startTime
      );

      if (this.verbose) {
        console.log(
          `[PipelineGenerator] Generated pipeline "${pipeline.name}" in ${pipeline.generationTimeMs.toFixed(2)}ms`
        );
      }

      return pipeline;
    } catch (error) {
      if (error instanceof PipelineGenerationError) {
        throw error;
      }

      throw new PipelineGenerationError(
        `Pipeline generation failed: ${error}`,
        normalizedTask,
        'definition-building',
        0,
        0,
        undefined,
        error as Error
      );
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Split task into segments using sequence markers
   * Normalizes whitespace and filters empty segments
   *
   * @param task - Task description
   * @returns Array of task segments
   */
  private splitIntoSegments(task: string): string[] {
    const taskLower = task.toLowerCase();

    // Build regex pattern for all sequence markers
    // Sort by length (longest first) to match multi-word markers before single-word
    const sortedMarkers = [...SEQUENCE_MARKERS].sort((a, b) => b.length - a.length);
    const markerPattern = sortedMarkers
      .map(marker => {
        // Escape special regex characters
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use word boundaries for single-word markers
        return marker.indexOf(' ') === -1 ? `\\b${escaped}\\b` : escaped;
      })
      .join('|');

    const regex = new RegExp(markerPattern, 'gi');

    // Split on markers
    const segments = task
      .split(regex)
      .map(segment => segment.trim())
      .filter(segment => segment.length > 0);

    return segments;
  }

  /**
   * Extract primary verb from task segment
   * Uses task analyzer verb extraction
   *
   * @param segment - Task segment
   * @returns Primary verb
   */
  private extractVerb(segment: string): string {
    const segmentLower = segment.toLowerCase();
    const words = segmentLower.split(/\s+/);

    // Common action verbs
    const actionVerbs = new Set([
      'analyze', 'research', 'study', 'investigate', 'explore',
      'test', 'verify', 'validate', 'check',
      'implement', 'create', 'build', 'develop', 'write', 'code',
      'document', 'describe', 'explain', 'draft',
      'design', 'architect', 'plan', 'structure',
      'review', 'audit', 'inspect', 'evaluate',
      'fix', 'refactor', 'optimize', 'update',
      'add', 'remove', 'delete', 'modify',
    ]);

    // Find first action verb
    for (const word of words) {
      const cleanWord = word.replace(/[^a-z]/g, '');
      if (actionVerbs.has(cleanWord)) {
        return cleanWord;
      }
    }

    // Default to first word if no verb found
    return words[0]?.replace(/[^a-z]/g, '') || 'execute';
  }

  /**
   * Generate stages from task segments
   * Routes each segment via RoutingEngine
   *
   * @param segments - Task segments
   * @param fullTask - Full task description (for context)
   * @returns Array of generated stages
   */
  private async generateStages(
    segments: string[],
    fullTask: string
  ): Promise<IGeneratedStage[]> {
    const stages: IGeneratedStage[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      try {
        // Extract verb for this stage
        const verb = this.extractVerb(segment);

        // Analyze segment
        const analysis = await this.taskAnalyzer.analyze(segment);

        // Route segment
        const routing = await this.routingEngine.route(analysis);

        // Generate stage name from segment (first 5 words)
        const nameWords = segment.split(/\s+/).slice(0, 5);
        const name = nameWords.join(' ');

        // Build stage
        const stage: IGeneratedStage = {
          index: i,
          name,
          taskSegment: segment,
          verb,
          agentKey: routing.selectedAgent,
          agentName: routing.selectedAgentName,
          confidence: routing.confidence,
          outputDomain: this.generateOutputDomain(i, fullTask),
          dependsOn: i === 0 ? [] : [i - 1], // Linear dependency chain
          estimatedDurationMs: this.config.estimatedTimePerStageMs,
        };

        stages.push(stage);

        if (this.verbose) {
          console.log(
            `  [Stage ${i}] ${name} → ${routing.selectedAgentName} (${(routing.confidence * 100).toFixed(0)}%)`
          );
        }
      } catch (error) {
        throw new PipelineGenerationError(
          `Failed to generate stage ${i}: ${error}`,
          fullTask,
          'routing',
          i,
          segments.length,
          undefined,
          error as Error
        );
      }
    }

    return stages;
  }

  /**
   * Generate unique output domain for stage
   * Format: pipeline/{pipelineId}/stage_{index}
   *
   * @param stageIndex - Stage index
   * @param task - Task description
   * @returns Output domain path
   */
  private generateOutputDomain(stageIndex: number, task: string): string {
    // Generate unique pipeline ID (timestamp + random suffix)
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const pipelineId = `pipeline_${timestamp}_${randomSuffix}`;

    return `pipeline/${pipelineId}/stage_${stageIndex}`;
  }

  /**
   * Build pipeline definition from stages
   * Calculates overall confidence and duration
   *
   * @param task - Original task description
   * @param stages - Generated stages
   * @param startTime - Generation start time
   * @returns Complete pipeline definition
   */
  private buildPipelineDefinition(
    task: string,
    stages: readonly IGeneratedStage[],
    startTime: number
  ): IGeneratedPipeline {
    // Calculate overall confidence (minimum of stage confidences)
    const overallConfidence = this.calculateOverallConfidence(stages);

    // Calculate estimated duration (sum of stage durations)
    const estimatedDurationMs = stages.reduce(
      (total, stage) => total + stage.estimatedDurationMs,
      0
    );

    // Determine if confirmation required (confidence < 0.7)
    const requiresConfirmation = overallConfidence < this.config.showDecisionThreshold;

    // Generate unique pipeline ID
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const pipelineId = `pipeline_${timestamp}_${randomSuffix}`;

    // Generate pipeline name (first 10 words of task)
    const nameWords = task.split(/\s+/).slice(0, 10);
    const name = nameWords.join(' ');

    const generationTimeMs = performance.now() - startTime;

    const pipeline: IGeneratedPipeline = {
      task,
      pipelineId,
      name,
      stages,
      estimatedDurationMs,
      overallConfidence,
      requiresConfirmation,
      generatedAt: Date.now(),
      generationTimeMs,
    };

    return pipeline;
  }

  /**
   * Calculate overall confidence from stage confidences
   * Uses minimum confidence (weakest link determines overall confidence)
   *
   * @param stages - Pipeline stages
   * @returns Overall confidence (0-1)
   */
  private calculateOverallConfidence(stages: readonly IGeneratedStage[]): number {
    if (stages.length === 0) {
      return 0;
    }

    // Overall confidence is minimum of stage confidences (weakest link)
    const minConfidence = Math.min(...stages.map(s => s.confidence));

    return minConfidence;
  }
}
