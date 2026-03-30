/**
 * Universal Self-Learning God Agent - Public API
 *
 * Usage:
 *   import { UniversalAgent, universalAgent } from './src/god-agent/universal';
 *
 *   // Use singleton
 *   await universalAgent.initialize();
 *   const result = await universalAgent.ask("How do I implement a linked list?");
 *
 *   // Or create instance
 *   const agent = new UniversalAgent({ verbose: true });
 *   await agent.initialize();
 *
 *   // With trajectory tracking (FR-11)
 *   const { output, trajectoryId } = await agent.ask("Your question", { returnResult: true });
 *   await agent.feedback(trajectoryId, 0.9, { isTrajectoryId: true });
 */

export {
  UniversalAgent,
  universalAgent,
  type AgentMode,
  type UniversalConfig,
  type Interaction,
  type KnowledgeEntry,
  type ResearchResult,
  type CodeResult,
  type WriteResult,
  type AskOptions,
  type AskResult,
  // TASK-LEARN-007: Task execution result type
  type TaskExecutionResult,
  // DAI-003: Task Routing
  type ITaskOptions,
  type ITaskResult,
} from './universal-agent.js';

export {
  InteractionStore,
  type InteractionStoreConfig,
  type InteractionStats,
} from './interaction-store.js';

// Trajectory Bridge for auto-feedback (FR-11)
export {
  TrajectoryBridge,
  type TrajectoryResult,
  type FeedbackResult,
  type FeedbackOptions,
} from './trajectory-bridge.js';

// Quality Estimator for auto-feedback
export {
  estimateQuality,
  assessQuality,
  qualityToVerdict,
  calculateLScore,
  type QualityInteraction,
  type QualityAssessment,
} from './quality-estimator.js';

// Style Learning System
export {
  StyleAnalyzer,
  type StyleCharacteristics,
  type SentenceMetrics,
  type VocabularyMetrics,
  type StructureMetrics,
  type ToneMetrics,
  type RegionalSettings,
} from './style-analyzer.js';

export {
  SpellingTransformer,
  type SpellingRule,
  type VariantDetectionResult,
} from './spelling-transformer.js';

export {
  GrammarTransformer,
  type GrammarRule,
  type GrammarTransformResult,
} from './grammar-transformer.js';

export {
  StyleProfileManager,
  getStyleProfileManager,
  type StoredStyleProfile,
  type StyleProfileMetadata,
} from './style-profile.js';

export {
  PDFExtractor,
  getPDFExtractor,
  type PDFExtractionResult,
  type BatchExtractionResult,
} from './pdf-extractor.js';

// DAI-002: Multi-Agent Sequential Pipeline Types
// Re-export from pipeline module for convenience
export type {
  IPipelineDefinition,
  IPipelineStep,
  DAI002PipelineResult as IPipelineResult,
  DAI002PipelineOptions as IPipelineOptions,
  DAI002StepResult as IStepResult,
} from '../core/pipeline/index.js';
