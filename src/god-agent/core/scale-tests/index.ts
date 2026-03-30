/**
 * Scale Tests Module
 * TASK-NFR-002 - Scalability Validation Suite
 *
 * Provides scalability validation infrastructure:
 * - NFR-4.1: Vector Scale Testing (1M vectors)
 * - NFR-4.2: Pipeline Scale Testing (48 agents)
 * - NFR-4.3: Memory Pressure Testing
 * - NFR-4.4: Graceful Degradation Testing
 * - NFR-4.5: Multi-Instance Testing
 */

// ===== UTILITIES =====

export {
  // Memory Monitor
  MemoryMonitor,
  type MemorySnapshot,
  type MemoryThreshold,
  type MemoryThresholdConfig,
  type MemoryTrend,
  DEFAULT_MEMORY_THRESHOLDS,
  memoryMonitor,
} from './utils/memory-monitor.js';

export {
  // Concurrency Tracker
  ConcurrencyTracker,
  AsyncSemaphore,
  RateLimiter,
  type ContentionEvent,
  type ConcurrencyStats,
  type OperationHandle,
  concurrencyTracker,
} from './utils/concurrency-tracker.js';

// ===== VECTOR SCALE TEST =====

export {
  VectorScaleTest,
  type VectorScaleConfig,
  DEFAULT_VECTOR_SCALE_CONFIG,
  type TierDistribution,
  type ScalePointResult,
  type NFR41ValidationResult,
  type VectorScaleReport,
  generateNormalizedVectors,
  vectorScaleTest,
} from './vector-scale-test.js';

// ===== PIPELINE SCALE TEST =====

export {
  PipelineScaleTest,
  type PipelineScaleConfig,
  DEFAULT_PIPELINE_SCALE_CONFIG,
  type AgentResult,
  type PipelineScaleReport,
  type ContentionReport,
  type PipelineAgent,
  generatePipelineAgents,
  pipelineScaleTest,
} from './pipeline-scale-test.js';

// ===== MEMORY PRESSURE TEST =====

export {
  MemoryPressureTest,
  type MemoryPressureConfig,
  DEFAULT_MEMORY_PRESSURE_CONFIG,
  type OperationResult,
  type MemoryPressureReport,
  type PressureTestSuiteReport,
  memoryPressureTest,
} from './memory-pressure-test.js';

// ===== DEGRADATION TEST =====

export {
  DegradationTest,
  CapacityManager,
  CapacityExceededError,
  type DegradationConfig,
  DEFAULT_DEGRADATION_CONFIG,
  type RejectionResult,
  type RecoveryResult,
  type CapacityResult,
  type DegradationReport,
  degradationTest,
} from './degradation-test.js';

// ===== MULTI-INSTANCE TEST =====

export {
  MultiInstanceTest,
  SimulatedInstance,
  type MultiInstanceConfig,
  DEFAULT_MULTI_INSTANCE_CONFIG,
  type Instance,
  type SyncResult,
  type LoadResult,
  type PartitionResult,
  type MultiInstanceReport,
  multiInstanceTest,
} from './multi-instance-test.js';

// ===== RUNNER =====

export {
  ScaleTestRunner,
  type ScaleTestRunnerConfig,
  DEFAULT_RUNNER_CONFIG,
  type NFR4Check,
  type NFR4Summary,
  type NFR4Report,
  scaleTestRunner,
} from './runner.js';
