/**
 * Int8 Quantization Type Definitions
 *
 * Implements: TASK-PERF-002 (Int8 quantization for 4x memory reduction)
 * Referenced by: Int8Quantizer, QuantizedVectorStorage
 *
 * Type definitions for Int8 vector quantization system.
 */

/**
 * Quantization method configuration
 */
export interface QuantizationConfig {
  /** Quantization method: symmetric or asymmetric */
  method: 'symmetric' | 'asymmetric';

  /** Scale computation scope */
  scaleType: 'per-vector' | 'per-dimension';
}

/**
 * Default quantization configuration
 */
export const DEFAULT_QUANTIZATION_CONFIG: QuantizationConfig = {
  method: 'symmetric',
  scaleType: 'per-vector',
};

/**
 * Result of quantizing a single vector
 */
export interface QuantizedVector {
  /** Quantized Int8 representation */
  quantized: Int8Array;

  /** Scale factor for dequantization */
  scale: number;

  /** Zero point offset (0 for symmetric quantization) */
  zeroPoint: number;
}

/**
 * Batch of quantized vectors with shared metadata
 */
export interface QuantizedVectorBatch {
  /** Batch of quantized vectors */
  vectors: Int8Array[];

  /** Scale factors (one per vector for per-vector scaling) */
  scales: Float32Array;

  /** Zero points (one per vector for per-vector scaling) */
  zeroPoints: Float32Array;

  /** Original dimension */
  dimension: number;

  /** Number of vectors */
  count: number;
}

/**
 * Memory usage statistics
 */
export interface QuantizationMemoryStats {
  /** Total bytes used */
  totalBytes: number;

  /** Bytes used for vector data */
  vectorBytes: number;

  /** Bytes used for metadata (scales, zero points) */
  metadataBytes: number;

  /** Compression ratio compared to Float32 */
  compressionRatio: number;
}

/**
 * Quantization quality metrics
 */
export interface QuantizationQualityMetrics {
  /** Mean squared error between original and dequantized */
  mse: number;

  /** Maximum absolute error */
  maxError: number;

  /** Mean absolute error */
  mae: number;

  /** Signal-to-quantization-noise ratio (dB) */
  sqnr: number;
}

/**
 * Stored quantized vector entry
 */
export interface StoredQuantizedVector {
  id: string;
  quantized: Int8Array;
  scale: number;
  zeroPoint: number;
}

/**
 * Search result from quantized storage
 */
export interface QuantizedSearchResult {
  id: string;
  distance: number;
  approximateDistance: number;
}
