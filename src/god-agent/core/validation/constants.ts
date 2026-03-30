/**
 * God Agent Core Constants
 * ANTI-006: Magic Numbers Elimination
 *
 * All magic numbers > 10 MUST be defined here with rationale documentation.
 * Single source of truth for configurable values.
 *
 * Implements: REQ-VEC-01 (1536D requirement), CONST-ANTI-001 Rule 6
 * Referenced by: TASK-VEC-001, SPEC-ANTI-006
 */

// ==================== Vector/Embedding Constants ====================

/**
 * Fixed embedding dimension for all vectors
 * @rationale OpenAI text-embedding-3-large dimension for enhanced semantic capture
 * @ref https://platform.openai.com/docs/guides/embeddings
 * @updated 2024-12 - Upgraded from 768D to 1536D for improved quality
 */
export const VECTOR_DIM = 1536;

/**
 * Default number of attention heads
 * @rationale Multi-head attention configuration (1536 / 12 = 128 dims per head)
 * @ref https://arxiv.org/abs/1706.03762 "Attention is All You Need", Section 3.2.2
 * @updated 2024-12 - Increased to 12 heads for 1536D embeddings
 */
export const DEFAULT_NUM_HEADS = 12;

/**
 * Default dropout probability for attention mechanisms
 * @rationale Standard dropout rate for transformer models (prevents overfitting)
 * @ref https://arxiv.org/abs/1706.03762 "Attention is All You Need", Section 5.4
 */
export const ATTENTION_DROPOUT = 0.1;

/** Tolerance for L2 normalization check (norm must be within 1.0 ± epsilon) */
export const L2_NORM_TOLERANCE = 1e-6;

// ==================== HNSW Index Parameters ====================

/** HNSW index parameters per constitution.md */
export const HNSW_PARAMS = {
  M: 32,
  efConstruction: 200,
  efSearch: 50,
} as const;

// ==================== LoRA Parameters ====================

/** LoRA parameters per constitution.md */
export const LORA_PARAMS = {
  rank: 16,
  learningRate: 0.01,
  ewcLambda: 0.1,
} as const;

// ==================== Scoring Thresholds ====================

/** L-Score threshold for knowledge acceptance */
export const L_SCORE_THRESHOLD = 0.3;

// ==================== Temporal Thresholds ====================

/**
 * Temporal concurrency threshold in milliseconds
 * @rationale Events within 1 second are considered concurrent in causal reasoning
 * @ref Causal reasoning literature: sub-second events are perceptually simultaneous
 */
export const TEMPORAL_CONCURRENT_THRESHOLD_MS = 1000;

/**
 * Maximum temporal window for causal inference (milliseconds)
 * @rationale 1 hour window balances memory usage with causal context
 */
export const TEMPORAL_MAX_WINDOW_MS = 3600000; // 1 hour

/**
 * Rollback detection window in milliseconds
 * @rationale 5 minutes window for detecting rollback loops
 */
export const ROLLBACK_WINDOW_MS = 300000; // 5 minutes

// ==================== Timeout/Interval Constants ====================

/**
 * Default task execution timeout in milliseconds
 * @rationale 30 seconds balances responsiveness with task complexity
 * @tuning Based on p95 task completion times in production
 */
export const DEFAULT_TASK_TIMEOUT_MS = 30000;

/**
 * Maximum task execution timeout cap in milliseconds
 * @rationale 10 minutes prevents indefinite hangs while supporting complex tasks
 * @ref SPEC-EXE-001 executor specification
 */
export const MAX_TASK_TIMEOUT_MS = 600000; // 10 minutes

/**
 * Batch write interval for trajectory streaming in milliseconds
 * @rationale 5 seconds balances write throughput with durability
 * @ref SPEC-TRJ-001 trajectory streaming specification
 */
export const BATCH_WRITE_INTERVAL_MS = 5000;

/**
 * Compression tier transition check interval in milliseconds
 * @rationale 1 hour balances CPU overhead with timely compression
 * @ref SPEC-ANTI-005 compression tiers
 */
export const COMPRESSION_CHECK_INTERVAL_MS = 3600000; // 1 hour

/**
 * File lock timeout for graph database operations in milliseconds
 * @rationale 5 seconds prevents deadlocks while allowing slow I/O
 */
export const GRAPH_DB_LOCK_TIMEOUT_MS = 5000;

// ==================== Size Limits ====================

/**
 * Maximum task input length before truncation (characters)
 * @rationale 10KB balances context window with practical task descriptions
 * @tuning Tuned to fit within Claude API prompt limits
 */
export const MAX_TASK_LENGTH = 10240; // 10KB

/**
 * Default maximum results for query operations
 * @rationale 50 results balance comprehensiveness with performance
 */
export const DEFAULT_MAX_RESULTS = 50;

/**
 * Large query maximum results
 * @rationale 100 results for exhaustive searches
 */
export const LARGE_MAX_RESULTS = 100;

/**
 * Default cache size for pattern caching
 * @rationale 200 entries ≈ 30KB, balances hit rate with memory
 */
export const DEFAULT_CACHE_SIZE = 200;

/**
 * Large cache size for high-traffic caches
 * @rationale 500 entries ≈ 75KB for routing/embedding caches
 */
export const LARGE_CACHE_SIZE = 500;

/**
 * Maximum concurrent queries for trajectory streaming
 * @rationale 10 concurrent queries prevent disk I/O bottlenecks
 * @ref SPEC-TRJ-001 trajectory streaming specification
 */
export const MAX_CONCURRENT_QUERIES = 10;

/**
 * Minimum training size for compression codebook
 * @rationale 100 samples required for stable compression patterns
 */
export const MIN_TRAINING_SIZE = 100;

// ==================== Routing Constants ====================

/**
 * Maximum pipeline stages for DAI-002
 * @rationale 10 stages balance expressiveness with complexity
 * @ref SPEC-DAI-002 pipeline orchestration
 */
export const MAX_PIPELINE_STAGES = 10;

/**
 * Cold start minimum trajectory count threshold
 * @rationale 50 trajectories required for stable routing patterns
 * @ref TASK-003 cold start configuration
 */
export const COLD_START_THRESHOLD = 50;

/**
 * Default memory window size for trajectory streaming
 * @rationale 1000 trajectories balances memory usage with performance
 */
export const DEFAULT_MEMORY_WINDOW_SIZE = 1000;

/**
 * Maximum metadata entries for trajectory index
 * @rationale 10x memory window size for good cache hit rate
 * @ref ANTI-005 unbounded growth fix
 */
export const DEFAULT_MAX_METADATA_ENTRIES = 10000;
