/**
 * ReasoningBank - Main Unified Reasoning Interface
 *
 * Orchestrates all 4 reasoning modes:
 * 1. Pattern-Match: Template-based reasoning from historical patterns
 * 2. Causal-Inference: Graph-based cause-effect reasoning
 * 3. Contextual: GNN-enhanced semantic similarity
 * 4. Hybrid: Weighted combination of all modes
 *
 * Integrates with Sona for continuous learning through feedback.
 *
 * Performance targets:
 * - Pattern-match: <10ms
 * - Causal-inference: <20ms
 * - Contextual: <30ms
 * - Hybrid: <30ms (without GNN)
 */

import { PatternMatcher } from './pattern-matcher.js';
import { CausalMemory } from './causal-memory.js';
import { GNNEnhancer } from './gnn-enhancer.js';
import { TrajectoryTracker } from './trajectory-tracker.js';
import { ModeSelector } from './mode-selector.js';
import type { TrainingTriggerController } from './training-trigger.js';
import type { VectorDB } from '../vector-db/vector-db.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { ISonaEngine, IWeightUpdateResult, ITrajectory } from '../learning/sona-types.js';
import type { ProvenanceStore } from './provenance-store.js';
import {
  ReasoningMode,
  type IReasoningRequest,
  type IReasoningResponse,
  type IPatternMatch,
  type IInferenceResult,
  type IProvenanceInfo,
  type ILearningFeedback,
  type ReasoningBankConfig,
  type TrajectoryRecord
} from './reasoning-types.js';
import { TaskType } from './pattern-types.js';
import type { NodeID, CausalNode } from './causal-types.js';
import { assertDimensions } from '../validation/index.js';
import { VECTOR_DIM } from '../validation/constants.js';
import { ObservabilityBus } from '../observability/bus.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('ReasoningBank', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Dependencies required to construct ReasoningBank
 */
export interface ReasoningBankDependencies {
  patternMatcher: PatternMatcher;
  causalMemory: CausalMemory;
  vectorDB: VectorDB;
  sonaEngine?: SonaEngine;
  provenanceStore?: ProvenanceStore;
  config?: Partial<ReasoningBankConfig>;
}

/**
 * Parameters for building a reasoning response
 */
interface ResponseParams {
  query: Float32Array;
  type: ReasoningMode;
  patterns: IPatternMatch[];
  causalInferences: IInferenceResult[];
  confidence: number;
  provenanceInfo: IProvenanceInfo;
  trajectoryId?: string;
}

/**
 * Default configuration for ReasoningBank
 */
const DEFAULT_CONFIG: ReasoningBankConfig = {
  enableGNN: true,
  defaultMaxResults: 10,
  defaultConfidenceThreshold: 0.7,
  defaultMinLScore: 0.5,
  patternWeight: 0.3,
  causalWeight: 0.3,
  contextualWeight: 0.4,
  enableTrajectoryTracking: true,
  enableAutoModeSelection: true
};

/**
 * ReasoningBank - Unified reasoning orchestrator
 *
 * Main entry point for all reasoning operations in the God Agent.
 * Coordinates pattern matching, causal inference, contextual reasoning,
 * and hybrid approaches while tracking learning trajectories.
 */
export class ReasoningBank {
  private patternMatcher: PatternMatcher;
  private causalMemory: CausalMemory;
  private vectorDB: VectorDB;
  private gnnEnhancer: GNNEnhancer;
  private trajectoryTracker: TrajectoryTracker;
  private _modeSelector: ModeSelector; // Reserved for future auto-selection feature
  private config: ReasoningBankConfig;
  private initialized: boolean = false;
  private sonaEngine?: SonaEngine;
  private provenanceStore?: ProvenanceStore;
  private trainingTrigger?: TrainingTriggerController;

  constructor(deps: ReasoningBankDependencies) {
    this.patternMatcher = deps.patternMatcher;
    this.causalMemory = deps.causalMemory;
    this.vectorDB = deps.vectorDB;
    this.sonaEngine = deps.sonaEngine;
    this.provenanceStore = deps.provenanceStore;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };

    // Initialize GNN enhancer with proper config
    // Per CONSTITUTION RULE-089: Use VECTOR_DIM constant for dimension consistency
    this.gnnEnhancer = new GNNEnhancer({
      inputDim: VECTOR_DIM,
      outputDim: VECTOR_DIM,
      numLayers: 3,
      attentionHeads: 8,
      dropout: 0.1,
      maxNodes: 50
    });

    // Initialize trajectory tracker with config
    // Per CONSTITUTION RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference
    // Note: sonaEngine may be undefined at construction time (late binding via setSonaEngine)
    // We use a proxy that defers to this.sonaEngine to support late binding
    this.trajectoryTracker = new TrajectoryTracker({
      sonaEngine: this.createSonaEngineProxy(),
      maxTrajectories: 10000,
      autoPrune: true
    });

    // Initialize mode selector with thresholds
    this._modeSelector = new ModeSelector({
      patternMatchThreshold: 0.6,
      causalInferenceThreshold: 0.6,
      contextualThreshold: 0.6,
      hybridThreshold: 0.15
    });
  }

  /**
   * Initialize all components
   * Must be called before using reason()
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Components are ready to use after construction
    // No async initialization needed for current implementations
    this.initialized = true;
  }

  /**
   * Set SonaEngine for feedback loop integration (late binding)
   * Called after SonaEngine is initialized to break circular dependency
   */
  setSonaEngine(engine: SonaEngine): void {
    this.sonaEngine = engine;

    // FIX: Register callback to sync SonaEngine patterns to PatternStore
    // This connects the learning system to the reasoning system
    engine.onPatternCreated(async (pattern) => {
      try {
        const mappedTaskType = this.mapSonaTaskType(pattern);
        await this.patternMatcher.createPattern({
          taskType: mappedTaskType,
          template: pattern.template ?? `Pattern from trajectory ${pattern.sourceTrajectory ?? 'unknown'}`,
          embedding: pattern.embedding,
          successRate: pattern.successRate ?? 0.9,
          metadata: { ...pattern.metadata, originalTaskType: pattern.taskType },
        });
        logger.info('Synced pattern to PatternStore', { patternId: pattern.id, taskType: mappedTaskType });
      } catch (error) {
        const errMsg = String(error);
        if (errMsg.includes('duplicate') || errMsg.includes('already exists')) {
          logger.debug('Pattern sync skipped (duplicate)', { error: errMsg });
        } else {
          logger.warn('Pattern sync failed', { error: errMsg });
        }
      }
    });
  }

  /**
   * Map SONA pattern task types to PatternMatcher TaskType enum values.
   * SONA hardcodes taskType='learning' which doesn't match any TaskType enum value.
   * This bridge translates based on phase tags or route-based heuristics.
   */
  private mapSonaTaskType(pattern: any): TaskType {
    const tags: string[] = pattern.metadata?.tags ?? [];
    const phaseTag = tags.find((t: string) => t.startsWith('phase:'));
    if (phaseTag) {
      const phase = parseInt(phaseTag.split(':')[1]);
      const phaseMap: Record<number, TaskType> = {
        1: TaskType.ANALYSIS, 2: TaskType.ANALYSIS, 3: TaskType.PLANNING,
        4: TaskType.CODING, 5: TaskType.TESTING, 6: TaskType.OPTIMIZATION, 7: TaskType.CODING,
      };
      if (phaseMap[phase]) return phaseMap[phase];
    }
    const route = pattern.metadata?.domain || pattern.taskType || '';
    if (route.includes('coding') || route.includes('implementation')) return TaskType.CODING;
    if (route.includes('test')) return TaskType.TESTING;
    if (route.includes('research') || route.includes('phd')) return TaskType.ANALYSIS;
    if (route.includes('optim')) return TaskType.OPTIMIZATION;
    if (route.includes('plan') || route.includes('architect')) return TaskType.PLANNING;
    return TaskType.ANALYSIS;
  }

  /**
   * Set TrainingTriggerController for GNN training triggers
   *
   * Implements: TASK-GNN-009
   * The training trigger monitors feedback and automatically triggers
   * GNN training when threshold is reached (default: 50 samples)
   *
   * @param trigger - TrainingTriggerController instance
   */
  setTrainingTrigger(trigger: TrainingTriggerController): void {
    this.trainingTrigger = trigger;
    logger.info('TrainingTriggerController set on ReasoningBank');
  }

  /**
   * Get the TrainingTriggerController instance
   *
   * @returns TrainingTriggerController or undefined if not set
   */
  getTrainingTrigger(): TrainingTriggerController | undefined {
    return this.trainingTrigger;
  }

  /**
   * Get L-Score for a pattern or inference
   * Uses ProvenanceStore lookup with fallback to default
   *
   * @param id - Pattern ID or inference node ID
   * @returns L-Score value (0-1), defaults to 0.5 if not found
   */
  private getLScoreForId(id: string): number {
    if (!this.provenanceStore) {
      return this.config.defaultMinLScore; // Default 0.5
    }

    // Attempt to lookup provenance by ID
    // Pattern IDs may map to provenance IDs in some cases
    const provenance = this.provenanceStore.getProvenance(id);
    if (provenance) {
      // Calculate L-Score from provenance depth (deeper = lower trust)
      // This is a simplified heuristic - full implementation would use calculateLScore
      const depthPenalty = Math.max(0.1, 1 - (provenance.depth * 0.1));
      return Math.min(1.0, depthPenalty);
    }

    return this.config.defaultMinLScore; // Default fallback
  }

  /**
   * Main reasoning API entry point
   *
   * Executes reasoning based on the request type (or auto-selects mode).
   * Tracks trajectories for learning and applies GNN enhancement if requested.
   *
   * @param request - Reasoning request with query and parameters
   * @returns Reasoning response with patterns, inferences, and metadata
   */
  async reason(request: IReasoningRequest): Promise<IReasoningResponse> {
    const startTime = performance.now();

    // 1. Validate request
    await this.validateRequest(request);

    // 2. Use explicit mode or default to PATTERN_MATCH
    // (ModeSelector expects string query, but we have embedding)
    const mode = request.type ?? ReasoningMode.PATTERN_MATCH;

    // Emit reasoning query start event
    ObservabilityBus.getInstance().emit({
      component: 'reasoning',
      operation: 'reasoning_query_executed',
      status: 'running',
      metadata: {
        mode,
        queryDimension: request.query.length,
        enhanceWithGNN: request.enhanceWithGNN ?? false,
        maxResults: request.maxResults ?? this.config.defaultMaxResults,
        confidenceThreshold: request.confidenceThreshold ?? this.config.defaultConfidenceThreshold,
      },
    });

    // 3. Apply GNN enhancement if requested
    let enhancedEmbedding: Float32Array | undefined;
    if (request.enhanceWithGNN && this.config.enableGNN) {
      const gnnStart = performance.now();
      enhancedEmbedding = await this.applyGNNEnhancement(request.query);
      const gnnDuration = performance.now() - gnnStart;

      // Emit GNN enhancement event
      ObservabilityBus.getInstance().emit({
        component: 'reasoning',
        operation: 'reasoning_gnn_enhanced',
        status: enhancedEmbedding ? 'success' : 'warning',
        durationMs: gnnDuration,
        metadata: {
          inputDim: request.query.length,
          outputDim: enhancedEmbedding?.length ?? 0,
          success: !!enhancedEmbedding,
        },
      });
    }

    // 4. Execute reasoning based on mode
    let result: IReasoningResponse;
    switch (mode) {
      case ReasoningMode.PATTERN_MATCH:
        result = await this.patternMatchReasoning(request);
        break;
      case ReasoningMode.CAUSAL_INFERENCE:
        result = await this.causalInferenceReasoning(request);
        break;
      case ReasoningMode.CONTEXTUAL:
        result = await this.contextualReasoning(request);
        break;
      case ReasoningMode.HYBRID:
        result = await this.hybridReasoning(request);
        break;
      default:
        throw new Error(`Unknown reasoning mode: ${mode}`);
    }

    // 5. Add enhanced embedding if available
    if (enhancedEmbedding) {
      result.enhancedEmbedding = enhancedEmbedding;
    }

    // 6. Track trajectory if enabled
    if (this.config.enableTrajectoryTracking) {
      const trajectoryStart = performance.now();
      const trajectory = await this.trajectoryTracker.createTrajectory(
        request,
        result,
        request.query,
        enhancedEmbedding
      );
      result.trajectoryId = trajectory.id;

      // Emit trajectory stored event
      ObservabilityBus.getInstance().emit({
        component: 'reasoning',
        operation: 'reasoning_trajectory_stored',
        status: 'success',
        durationMs: performance.now() - trajectoryStart,
        metadata: {
          trajectoryId: trajectory.id,
          mode,
          patternCount: result.patterns.length,
          inferenceCount: result.causalInferences.length,
          confidence: result.confidence,
          lScore: trajectory.lScore,
        },
      });
    } else {
      result.trajectoryId = `traj_${Date.now()}_untracked`;
    }

    // 7. Set processing time
    result.processingTimeMs = performance.now() - startTime;

    // Emit reasoning query completed event
    ObservabilityBus.getInstance().emit({
      component: 'reasoning',
      operation: 'reasoning_query_executed',
      status: 'success',
      durationMs: result.processingTimeMs,
      metadata: {
        mode,
        trajectoryId: result.trajectoryId,
        patternCount: result.patterns.length,
        inferenceCount: result.causalInferences.length,
        confidence: result.confidence,
        combinedLScore: result.provenanceInfo.combinedLScore,
        hasEnhancedEmbedding: !!result.enhancedEmbedding,
      },
    });

    return result;
  }

  /**
   * Pattern-match reasoning mode
   *
   * Finds historical patterns similar to the query embedding.
   * Filters by confidence and L-Score thresholds.
   */
  private async patternMatchReasoning(request: IReasoningRequest): Promise<IReasoningResponse> {
    const startTime = performance.now();

    const patterns = await this.patternMatcher.findPatterns({
      embedding: request.query,
      taskType: this.inferTaskType(request),
      topK: request.maxResults ?? this.config.defaultMaxResults,
      minConfidence: request.confidenceThreshold ?? this.config.defaultConfidenceThreshold
    });

    // Map to IPatternMatch (PatternResult has pattern and confidence)
    const patternMatches: IPatternMatch[] = patterns.map(p => ({
      patternId: p.pattern.id,
      confidence: p.confidence,
      template: p.pattern.template,
      taskType: p.pattern.taskType,
      lScore: this.getLScoreForId(p.pattern.id)
    }));

    // Filter by L-Score
    const minLScore = request.minLScore ?? this.config.defaultMinLScore;
    const filteredPatterns = patternMatches.filter(p => p.lScore >= minLScore);

    // Emit pattern match event
    ObservabilityBus.getInstance().emit({
      component: 'reasoning',
      operation: 'reasoning_pattern_matched',
      status: 'success',
      durationMs: performance.now() - startTime,
      metadata: {
        totalCandidates: patterns.length,
        filteredCount: filteredPatterns.length,
        topConfidence: filteredPatterns[0]?.confidence ?? 0,
        minLScore,
        taskType: this.inferTaskType(request),
      },
    });

    return this.buildResponse({
      query: request.query,
      type: ReasoningMode.PATTERN_MATCH,
      patterns: filteredPatterns,
      causalInferences: [],
      confidence: filteredPatterns[0]?.confidence ?? 0,
      provenanceInfo: this.calculateProvenanceInfo(filteredPatterns)
    });
  }

  /**
   * Causal-inference reasoning mode
   *
   * Uses VectorDB to find relevant nodes, then infers consequences
   * through the causal graph using edge weights and transitivity.
   */
  private async causalInferenceReasoning(request: IReasoningRequest): Promise<IReasoningResponse> {
    const startTime = performance.now();

    // Use VectorDB to find relevant nodes based on query embedding
    const searchResults = await this.vectorDB.search(
      request.query,
      request.maxResults ?? this.config.defaultMaxResults
    );
    const nodeIds = searchResults.map(r => r.id as NodeID);

    if (nodeIds.length === 0) {
      // Emit event for empty result
      ObservabilityBus.getInstance().emit({
        component: 'reasoning',
        operation: 'reasoning_causal_inference',
        status: 'warning',
        durationMs: performance.now() - startTime,
        metadata: {
          nodeCount: 0,
          effectCount: 0,
          reason: 'no_matching_nodes',
        },
      });

      return this.buildResponse({
        query: request.query,
        type: ReasoningMode.CAUSAL_INFERENCE,
        patterns: [],
        causalInferences: [],
        confidence: 0,
        provenanceInfo: { lScores: [], totalSources: 0, combinedLScore: 0 }
      });
    }

    // Infer consequences (default depth: 3)
    const inference = await this.causalMemory.inferConsequences(nodeIds, 3);

    // Map to IInferenceResult - effects are NodeIDs, chains provide paths
    const inferences: IInferenceResult[] = inference.effects.map((effectId, index) => {
      const chain = inference.chains[index];
      // Extract node IDs from chain path (CausalLink[] -> string[])
      const pathNodeIds: string[] = chain?.path
        ? chain.path.flatMap(link => link.effects) // Use effect nodes from each link
        : [effectId];

      return {
        nodeId: effectId,
        probability: 1.0, // Default probability
        confidence: chain?.totalConfidence ?? inference.confidence,
        chain: pathNodeIds,
        lScore: this.getLScoreForId(effectId)
      };
    });

    // Filter by confidence threshold
    const filtered = inferences.filter(i =>
      i.confidence >= (request.confidenceThreshold ?? this.config.defaultConfidenceThreshold)
    );

    // Emit causal inference event
    ObservabilityBus.getInstance().emit({
      component: 'reasoning',
      operation: 'reasoning_causal_inference',
      status: 'success',
      durationMs: performance.now() - startTime,
      metadata: {
        nodeCount: nodeIds.length,
        effectCount: inference.effects.length,
        filteredCount: filtered.length,
        topConfidence: filtered[0]?.confidence ?? 0,
        inferenceDepth: 3,
      },
    });

    return this.buildResponse({
      query: request.query,
      type: ReasoningMode.CAUSAL_INFERENCE,
      patterns: [],
      causalInferences: filtered,
      confidence: filtered[0]?.confidence ?? 0,
      provenanceInfo: this.calculateProvenanceInfo(filtered)
    });
  }

  /**
   * Contextual reasoning mode
   *
   * Uses GNN-enhanced embeddings for semantic similarity search.
   * Leverages graph structure to improve context understanding.
   */
  private async contextualReasoning(request: IReasoningRequest): Promise<IReasoningResponse> {
    // Per CONSTITUTION RULE-079 & RULE-089: Embeddings must be correct dimension
    // No slicing allowed - all vectors must be VECTOR_DIM
    const searchEmbedding = request.query.length === VECTOR_DIM
      ? request.query
      : (() => { throw new Error(`Query embedding must be ${VECTOR_DIM}D, got ${request.query.length}D`); })();

    // Search VectorDB for similar contexts
    const results = await this.vectorDB.search(
      new Float32Array(searchEmbedding),
      request.maxResults ?? this.config.defaultMaxResults
    );

    // Filter by similarity threshold
    const minConfidence = request.confidenceThreshold ?? this.config.defaultConfidenceThreshold;
    const filtered = results.filter(r => r.similarity >= minConfidence);

    // Map to IPatternMatch (contextual matches use pattern-like structure)
    const patterns: IPatternMatch[] = filtered.map(r => ({
      patternId: r.id,
      confidence: r.similarity,
      template: '', // Would need metadata lookup for actual content
      taskType: TaskType.ANALYSIS, // Default for contextual
      lScore: this.getLScoreForId(r.id)
    }));

    return this.buildResponse({
      query: request.query,
      type: ReasoningMode.CONTEXTUAL,
      patterns,
      causalInferences: [],
      confidence: patterns[0]?.confidence ?? 0,
      provenanceInfo: this.calculateProvenanceInfo(patterns)
    });
  }

  /**
   * Hybrid reasoning mode
   *
   * Combines all reasoning modes with configurable weights.
   * Executes modes in parallel for optimal performance.
   */
  private async hybridReasoning(request: IReasoningRequest): Promise<IReasoningResponse> {
    // Execute all modes in parallel
    const [patternResult, causalResult, contextualResult] = await Promise.all([
      this.patternMatchReasoning(request).catch(() => null),
      this.causalInferenceReasoning(request).catch(() => null),
      this.contextualReasoning(request).catch(() => null)
    ]);

    // Combine results with weights
    const weights = {
      pattern: this.config.patternWeight,
      causal: this.config.causalWeight,
      contextual: this.config.contextualWeight
    };

    // Merge patterns and inferences
    const allPatterns = [
      ...(patternResult?.patterns ?? []),
      ...(contextualResult?.patterns ?? [])
    ];
    const allInferences = causalResult?.causalInferences ?? [];

    // Calculate weighted confidence
    let totalWeight = 0;
    let weightedConfidence = 0;
    if (patternResult) {
      weightedConfidence += patternResult.confidence * weights.pattern;
      totalWeight += weights.pattern;
    }
    if (causalResult) {
      weightedConfidence += causalResult.confidence * weights.causal;
      totalWeight += weights.causal;
    }
    if (contextualResult) {
      weightedConfidence += contextualResult.confidence * weights.contextual;
      totalWeight += weights.contextual;
    }

    return this.buildResponse({
      query: request.query,
      type: ReasoningMode.HYBRID,
      patterns: allPatterns,
      causalInferences: allInferences,
      confidence: totalWeight > 0 ? weightedConfidence / totalWeight : 0,
      provenanceInfo: this.calculateProvenanceInfo([...allPatterns, ...allInferences])
    });
  }

  /**
   * Provide feedback for a trajectory (Sona integration)
   *
   * Updates trajectory with feedback quality.
   * High quality (>= 0.8) triggers pattern creation.
   *
   * @param feedback - Learning feedback with quality score
   */
  async provideFeedback(feedback: ILearningFeedback): Promise<void> {
    const startTime = performance.now();

    // Implements [REQ-OBS-17]: Emit learning_feedback event
    ObservabilityBus.getInstance().emit({
      component: 'learning',
      operation: 'learning_feedback',
      status: 'success',
      metadata: {
        trajectoryId: feedback.trajectoryId,
        quality: feedback.quality,
        outcome: feedback.outcome,
        hasFeedbackText: !!feedback.userFeedback,
      },
    });

    // Update trajectory with feedback
    await this.trajectoryTracker.updateFeedback(feedback.trajectoryId, feedback);

    // Emit verdict event for the trajectory feedback
    ObservabilityBus.getInstance().emit({
      component: 'reasoning',
      operation: 'reasoning_verdict_issued',
      status: 'success',
      durationMs: performance.now() - startTime,
      metadata: {
        trajectoryId: feedback.trajectoryId,
        quality: feedback.quality,
        outcome: feedback.outcome,
        isHighQuality: (feedback.quality ?? 0) >= 0.8,
      },
    });

    // Call SonaEngine for weight updates if available
    if (this.sonaEngine && feedback.quality !== undefined) {
      const trajectory = await this.trajectoryTracker.getTrajectory(feedback.trajectoryId);
      if (trajectory) {
        try {
          // FIX: Ensure trajectory exists in SonaEngine before providing feedback
          // TrajectoryTracker and SonaEngine have separate trajectory stores
          const existingTrajectory = this.sonaEngine.getTrajectory(feedback.trajectoryId);
          if (!existingTrajectory) {
            // Create trajectory in SonaEngine with pattern IDs from TrajectoryTracker
            const route = this.inferRouteFromReasoningMode(trajectory.request.type);
            const patternIds = trajectory.response.patterns.map(p => p.patternId);
            const contextIds = trajectory.response.causalInferences?.map(c => c.nodeId) ?? [];

            // Always create trajectory - enables route-level learning even without patterns
            // This fixes the chicken-egg problem where patterns can't accumulate without trajectories
            this.sonaEngine.createTrajectoryWithId(feedback.trajectoryId, route, patternIds, contextIds);
            logger.info('Created SonaEngine trajectory', { trajectoryId: feedback.trajectoryId, patternCount: patternIds.length, route })
          }

          // Only provide feedback if trajectory exists in SonaEngine
          // (prevents FeedbackValidationError when no patterns were available)
          const trajectoryInSona = this.sonaEngine.getTrajectory(feedback.trajectoryId);
          if (trajectoryInSona) {
            await this.sonaEngine.provideFeedback(
              feedback.trajectoryId,
              feedback.quality,
              { lScore: trajectory.lScore ?? 1.0 }
            );
            logger.info('SonaEngine updated for trajectory', { trajectoryId: feedback.trajectoryId });
          } else {
            logger.info('Skipping SonaEngine feedback (no trajectory)', { trajectoryId: feedback.trajectoryId });
          }
        } catch (error) {
          logger.warn('SonaEngine feedback failed', { error: String(error) });
        }
      }
    }

    // Get high-quality trajectories for hyperedge creation
    // Implements [REQ-TRAJ-009]: Null-safe response access
    if (feedback.quality !== undefined && feedback.quality >= 0.8) {
      const trajectory = await this.trajectoryTracker.getTrajectory(feedback.trajectoryId);
      if (trajectory) {
        // Implements [REQ-TRAJ-010]: Skip hyperedge creation for SQLite-loaded trajectories with minimal data
        if (!trajectory.response || !trajectory.response.patterns || !trajectory.response.causalInferences) {
          logger.warn('Skipping hyperedge creation: trajectory has minimal data (loaded from SQLite)', {
            trajectoryId: feedback.trajectoryId,
            hasResponse: !!trajectory.response,
            hasPatterns: !!trajectory.response?.patterns,
            hasCausalInferences: !!trajectory.response?.causalInferences,
          });
        } else {
          logger.info('High-quality trajectory eligible for hyperedge creation', { trajectoryId: feedback.trajectoryId, quality: feedback.quality });
          // Create causal hyperedge from high-quality trajectory
          await this.createCausalHyperedge(trajectory);

          // Emit trajectory retrieved event for high-quality extraction
          ObservabilityBus.getInstance().emit({
            component: 'reasoning',
            operation: 'reasoning_trajectory_retrieved',
            status: 'success',
            metadata: {
              trajectoryId: feedback.trajectoryId,
              purpose: 'hyperedge_creation',
              quality: feedback.quality,
              patternCount: trajectory.response.patterns.length,
              inferenceCount: trajectory.response.causalInferences.length,
            },
          });
        }
      }
    }

    // TASK-GNN-009: Forward trajectory to TrainingTriggerController for GNN training
    if (this.trainingTrigger && feedback.quality !== undefined) {
      const trajectory = await this.trajectoryTracker.getTrajectory(feedback.trajectoryId);
      if (trajectory) {
        // Add trajectory to training buffer
        this.trainingTrigger.addTrajectory({
          id: trajectory.id,
          embedding: trajectory.embedding,
          enhancedEmbedding: trajectory.enhancedEmbedding,
          quality: feedback.quality,
          feedback: feedback,
        });

        // Emit training trigger event
        ObservabilityBus.getInstance().emit({
          component: 'reasoning',
          operation: 'training_trigger_trajectory_added',
          status: 'success',
          metadata: {
            trajectoryId: feedback.trajectoryId,
            quality: feedback.quality,
            bufferSize: this.trainingTrigger.getBufferSize(),
            shouldTrigger: this.trainingTrigger.shouldTrigger(),
          },
        });

        // Check if training should trigger (auto-check also runs on timer)
        if (this.trainingTrigger.shouldTrigger()) {
          logger.info('Training trigger threshold reached, initiating training');
          this.trainingTrigger.checkAndTrain().catch(error => {
            logger.error('Training trigger failed', { error: String(error) });
          });
        }
      }
    }
  }

  /**
   * Close and cleanup resources
   */
  async close(): Promise<void> {
    // Reserved for future cleanup
    this.initialized = false;
  }

  /**
   * Validate reasoning request
   */
  private async validateRequest(request: IReasoningRequest): Promise<void> {
    if (!this.initialized) {
      throw new Error('ReasoningBank not initialized. Call initialize() first.');
    }

    if (!request.query || request.query.length === 0) {
      throw new Error('Query embedding is required');
    }

    // Per CONSTITUTION RULE-089: All embeddings must be VECTOR_DIM
    if (request.query.length !== VECTOR_DIM) {
      assertDimensions(request.query, VECTOR_DIM, 'Query embedding');
    }

    if (request.maxResults !== undefined && request.maxResults <= 0) {
      throw new Error('maxResults must be positive');
    }

    if (request.confidenceThreshold !== undefined &&
        (request.confidenceThreshold < 0 || request.confidenceThreshold > 1)) {
      throw new Error('confidenceThreshold must be between 0 and 1');
    }

    if (request.minLScore !== undefined &&
        (request.minLScore < 0 || request.minLScore > 1)) {
      throw new Error('minLScore must be between 0 and 1');
    }
  }

  /**
   * Apply GNN enhancement to embedding
   */
  private async applyGNNEnhancement(embedding: Float32Array): Promise<Float32Array | undefined> {
    try {
      const result = await this.gnnEnhancer.enhance(embedding);
      return result.enhanced;
    } catch (error) {
      logger.warn('GNN enhancement failed', { error: String(error) });
      return undefined;
    }
  }

  /**
   * Calculate provenance information from results
   *
   * Uses geometric mean for combined L-Score to account for
   * multiplicative uncertainty across sources.
   */
  private calculateProvenanceInfo(results: Array<{lScore: number}>): IProvenanceInfo {
    const lScores = results.map(r => r.lScore);
    const totalSources = results.length;

    // Geometric mean for combined L-Score
    const combinedLScore = totalSources > 0
      ? Math.pow(lScores.reduce((a, b) => a * b, 1), 1 / totalSources)
      : 0;

    return { lScores, totalSources, combinedLScore };
  }

  /**
   * Build standardized reasoning response
   */
  private buildResponse(params: ResponseParams): IReasoningResponse {
    return {
      query: params.query,
      type: params.type,
      patterns: params.patterns,
      causalInferences: params.causalInferences,
      trajectoryId: params.trajectoryId ?? '',
      confidence: params.confidence,
      provenanceInfo: params.provenanceInfo,
      processingTimeMs: 0 // Will be set by reason()
    };
  }

  /**
   * Generate deterministic node ID from trajectory data
   */
  private generateCausalNodeId(prefix: string, data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    return `${prefix}_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Ensure a causal node exists, create if missing
   */
  private async ensureNodeExists(node: CausalNode): Promise<void> {
    try {
      const existing = this.causalMemory.getNode(node.id);
      if (!existing) {
        await this.causalMemory.addNode(node);
      }
    } catch {
      // INTENTIONAL: Node might already exist - duplicate add is safe to ignore
    }
  }

  /**
   * Create causal hyperedge from high-quality trajectory
   * Called when feedback.quality >= 0.8
   * Implements [REQ-TRAJ-009]: Null-safe response access
   */
  private async createCausalHyperedge(trajectory: TrajectoryRecord): Promise<void> {
    // Implements [REQ-TRAJ-010]: Early return for trajectories with minimal data
    if (!trajectory.response || !trajectory.response.patterns || !trajectory.response.causalInferences) {
      logger.warn('Cannot create hyperedge: trajectory has minimal data', {
        trajectoryId: trajectory.id,
        hasResponse: !!trajectory.response,
      });
      return;
    }

    const startTime = performance.now();

    // Emit distillation started event
    ObservabilityBus.getInstance().emit({
      component: 'reasoning',
      operation: 'reasoning_distillation_started',
      status: 'running',
      metadata: {
        trajectoryId: trajectory.id,
        quality: trajectory.feedback?.quality,
        patternCount: trajectory.response.patterns.length,
        inferenceCount: trajectory.response.causalInferences.length,
      },
    });

    try {
      const now = Date.now();

      // 1. Create query node (cause)
      const queryNodeId = this.generateCausalNodeId('query', trajectory.id);
      await this.ensureNodeExists({
        id: queryNodeId,
        label: `Query: ${trajectory.request.type}`,
        type: 'concept',
        metadata: {
          trajectoryId: trajectory.id,
          reasoningMode: trajectory.request.type,
          timestamp: trajectory.timestamp
        },
        createdAt: now
      });

      // 2. Create pattern nodes (additional causes) - limit to top 3
      const patternNodeIds: string[] = [];
      for (const pattern of trajectory.response.patterns.slice(0, 3)) {
        const patternNodeId = this.generateCausalNodeId('pattern', pattern.patternId);
        await this.ensureNodeExists({
          id: patternNodeId,
          label: `Pattern: ${pattern.patternId}`,
          type: 'concept',
          metadata: {
            patternId: pattern.patternId,
            confidence: pattern.confidence,
            taskType: pattern.taskType
          },
          createdAt: now
        });
        patternNodeIds.push(patternNodeId);
      }

      // 3. Create effect nodes from causal inferences - limit to top 3
      const effectNodeIds: string[] = [];
      for (const inference of trajectory.response.causalInferences.slice(0, 3)) {
        const effectNodeId = this.generateCausalNodeId('effect', inference.nodeId);
        await this.ensureNodeExists({
          id: effectNodeId,
          label: `Effect: ${inference.nodeId}`,
          type: 'state',
          metadata: {
            nodeId: inference.nodeId,
            probability: inference.probability,
            confidence: inference.confidence
          },
          createdAt: now
        });
        effectNodeIds.push(effectNodeId);
      }

      // 4. Create outcome node (final effect representing success)
      const outcomeNodeId = this.generateCausalNodeId('outcome', trajectory.id);
      await this.ensureNodeExists({
        id: outcomeNodeId,
        label: `Outcome: Quality ${trajectory.feedback?.quality?.toFixed(2)}`,
        type: 'state',
        metadata: {
          trajectoryId: trajectory.id,
          quality: trajectory.feedback?.quality,
          lScore: trajectory.lScore
        },
        createdAt: now
      });

      // 5. Create hyperedge linking causes to effects
      const allCauses = [queryNodeId, ...patternNodeIds];
      const allEffects = [...effectNodeIds, outcomeNodeId];

      // Only create if we have valid causes and effects
      if (allCauses.length >= 1 && allEffects.length >= 1) {
        await this.causalMemory.addCausalLink({
          causes: allCauses,
          effects: allEffects,
          confidence: trajectory.feedback?.quality ?? 0.8,
          strength: trajectory.lScore ?? 0.8,
          metadata: {
            source: 'high-quality-feedback',
            trajectoryId: trajectory.id,
            reasoningMode: trajectory.request.type,
            createdAt: now
          }
        });

        logger.info('Created causal hyperedge', { causesCount: allCauses.length, effectsCount: allEffects.length });

        // Emit distillation completed event
        ObservabilityBus.getInstance().emit({
          component: 'reasoning',
          operation: 'reasoning_distillation_completed',
          status: 'success',
          durationMs: performance.now() - startTime,
          metadata: {
            trajectoryId: trajectory.id,
            causesCount: allCauses.length,
            effectsCount: allEffects.length,
            nodesCreated: 1 + patternNodeIds.length + effectNodeIds.length + 1, // query + patterns + effects + outcome
            hyperedgeCreated: true,
          },
        });
      }

    } catch (error) {
      // Don't fail feedback on hyperedge creation error
      logger.warn('Hyperedge creation failed', { error: String(error) });

      // Emit distillation error event
      ObservabilityBus.getInstance().emit({
        component: 'reasoning',
        operation: 'reasoning_distillation_completed',
        status: 'error',
        durationMs: performance.now() - startTime,
        metadata: {
          trajectoryId: trajectory.id,
          error: String(error),
          hyperedgeCreated: false,
        },
      });
    }
  }

  /**
   * Infer task type from request context
   *
   * Uses heuristics to determine task type when not explicitly provided.
   * Can be extended with more sophisticated classification.
   */
  private inferTaskType(_request: IReasoningRequest): TaskType {
    // Default to ANALYSIS for now
    // Future: Use request.context or embedding classification
    return TaskType.ANALYSIS;
  }

  /**
   * Convert ReasoningMode to SonaEngine route string
   *
   * Maps reasoning modes to route identifiers for trajectory tracking.
   * Routes are used by SonaEngine for per-task-type weight management.
   */
  private inferRouteFromReasoningMode(mode: ReasoningMode): string {
    switch (mode) {
      case ReasoningMode.PATTERN_MATCH:
        return 'reasoning.pattern';
      case ReasoningMode.CAUSAL_INFERENCE:
        return 'reasoning.causal';
      case ReasoningMode.CONTEXTUAL:
        return 'reasoning.contextual';
      case ReasoningMode.HYBRID:
        return 'reasoning.hybrid';
      default:
        return 'reasoning.general';
    }
  }

  /**
   * Create a proxy for SonaEngine that supports late binding
   *
   * Per CONSTITUTION RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference.
   * This proxy defers to this.sonaEngine, supporting late binding via setSonaEngine().
   *
   * Implements: RULE-031, RULE-025
   */
  private createSonaEngineProxy(): ISonaEngine {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return {
      createTrajectoryWithId(
        trajectoryId: string,
        route: string,
        patterns: string[],
        context?: string[]
      ): void {
        if (self.sonaEngine) {
          self.sonaEngine.createTrajectoryWithId(trajectoryId, route, patterns, context ?? []);
        } else {
          console.debug('[ReasoningBank] SonaEngine not yet bound, skipping createTrajectoryWithId');
        }
      },

      async provideFeedback(
        trajectoryId: string,
        quality: number,
        options?: { lScore?: number; similarities?: Map<string, number>; skipAutoSave?: boolean }
      ): Promise<IWeightUpdateResult> {
        if (self.sonaEngine) {
          return self.sonaEngine.provideFeedback(trajectoryId, quality, options);
        }
        // Return no-op result when SonaEngine not bound
        return {
          trajectoryId,
          patternsUpdated: 0,
          reward: 0,
          patternAutoCreated: false,
          elapsedMs: 0
        };
      },

      async getWeight(patternId: string, route: string): Promise<number> {
        if (self.sonaEngine) {
          return self.sonaEngine.getWeight(patternId, route);
        }
        return 0.0;
      },

      getTrajectory(trajectoryId: string): ITrajectory | null {
        if (self.sonaEngine) {
          return self.sonaEngine.getTrajectory(trajectoryId);
        }
        return null;
      },

      /**
       * Check if trajectory exists in persistent storage (SQLite)
       * Implements: REQ-TRAJ-006
       */
      hasTrajectoryInStorage(trajectoryId: string): boolean {
        if (self.sonaEngine) {
          return self.sonaEngine.hasTrajectoryInStorage(trajectoryId);
        }
        return false;
      },

      /**
       * Load trajectory from persistent storage (SQLite)
       * Implements: REQ-TRAJ-006
       */
      getTrajectoryFromStorage(trajectoryId: string): ITrajectory | null {
        if (self.sonaEngine) {
          return self.sonaEngine.getTrajectoryFromStorage(trajectoryId);
        }
        return null;
      }
    };
  }
}
