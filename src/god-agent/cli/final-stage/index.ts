/**
 * Phase 8 Final Stage - Public API
 *
 * Re-exports all public APIs for the PhD Pipeline Final Assembly stage.
 * Implements SPEC-TECH-001 and SPEC-FUNC-001.
 */

// ============================================
// Type Exports
// ============================================

export type {
  // State types
  FinalStageState,
  PhaseStatus,
  ChapterNumber,

  // Error types
  FinalStageErrorCode,

  // Options and configuration
  FinalStageOptions,
  SemanticMapperInput,
  OutputScannerInput,

  // Chapter and source types
  ChapterDefinition,
  AgentOutputSummary,
  CitationRef,

  // Mapping types
  ChapterMapping,
  SemanticMapperOutput,
  OutputScannerOutput,

  // Chapter output types
  CrossReference,
  SectionInfo,
  QualityMetrics,
  ChapterWriterOutput,

  // Final paper types
  PaperMetadata,
  FinalPaper,

  // Result types
  FinalStageResult,

  // Progress and monitoring types
  ProgressReport,
  ProgressCallback,

  // Token budget types
  TokenBudget,

  // Metadata types
  PhaseResult,
  ExecutionMetadata,

  // Chapter structure types
  ChapterStructureReaderOutput,

  // Input types
  ChapterWriterInput,

  // Validation types
  MappingValidationResult,
  StyleValidationResult,

  // Re-exported from universal
  StyleCharacteristics,
  RegionalSettings
} from './types.js';

// ============================================
// Class Exports
// ============================================

export { FinalStageError } from './types.js';

// ============================================
// Module Exports
// ============================================

// TASK-002: FinalStageOrchestrator - IMPLEMENTED
export { FinalStageOrchestrator } from './final-stage-orchestrator.js';

// TASK-004: SummaryExtractor - IMPLEMENTED
export { SummaryExtractor } from './summary-extractor.js';

// TASK-005: SemanticMapper - IMPLEMENTED
export { SemanticMapper } from './semantic-mapper.js';

// TASK-006: ChapterWriterAgent - IMPLEMENTED
export { ChapterWriterAgent, getAgentForChapter } from './chapter-writer-agent.js';
export type { ChapterSynthesisPrompt, ChapterAgentType } from './chapter-writer-agent.js';

// TASK-007: PaperCombiner - IMPLEMENTED
export { PaperCombiner } from './paper-combiner.js';

// TASK-008: StyleApplier - IMPLEMENTED
export { StyleApplier } from './style-applier.js';
export type { StyleApplierInput, StyleApplierOutput } from './style-applier.js';

// TASK-010: ProgressLogger - IMPLEMENTED
export { ProgressLogger, PROGRESS_MILESTONES } from './progress-logger.js';
export type { LogLevel, LogEntry } from './progress-logger.js';
