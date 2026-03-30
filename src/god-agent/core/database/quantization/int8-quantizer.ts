/**
 * Int8 Quantizer Implementation
 *
 * Implements: TASK-PERF-002 (Int8 quantization for 4x memory reduction)
 * Referenced by: QuantizedVectorStorage, HNSWIndex
 *
 * Provides Int8 quantization/dequantization for vector embeddings.
 * Supports symmetric and asymmetric quantization methods.
 *
 * Memory reduction: Float32 (4 bytes) -> Int8 (1 byte) = 4x reduction
 * Quality target: < 2% recall degradation
 *
 * Algorithm:
 * - Symmetric: value_int8 = round(value_float / scale)
 *   where scale = max(|values|) / 127
 * - Asymmetric: value_int8 = round((value_float - zero_point) / scale)
 *   where scale = (max - min) / 255, zero_point = min
 */

import {
  QuantizationConfig,
  DEFAULT_QUANTIZATION_CONFIG,
  QuantizedVector,
  QuantizedVectorBatch,
  QuantizationQualityMetrics,
} from './quantization-types.js';

/**
 * Int8 Quantizer for vector compression
 *
 * Converts Float32 vectors to Int8 representation with 4x memory reduction.
 * Maintains search quality through calibrated quantization parameters.
 */
export class Int8Quantizer {
  /** Quantization configuration */
  readonly config: QuantizationConfig;

  /** Int8 range constants */
  private readonly INT8_MIN = -128;
  private readonly INT8_MAX = 127;
  private readonly UINT8_RANGE = 255;

  /**
   * Create a new Int8Quantizer
   *
   * @param config - Optional quantization configuration
   */
  constructor(config?: Partial<QuantizationConfig>) {
    this.config = {
      ...DEFAULT_QUANTIZATION_CONFIG,
      ...config,
    };
  }

  /**
   * Quantize a Float32 vector to Int8
   *
   * @param vector - Float32 vector to quantize
   * @returns Quantized Int8 array with scale and zero point
   */
  quantize(vector: Float32Array): QuantizedVector {
    const dimension = vector.length;
    const quantized = new Int8Array(dimension);

    if (this.config.method === 'symmetric') {
      return this.quantizeSymmetric(vector, quantized);
    } else {
      return this.quantizeAsymmetric(vector, quantized);
    }
  }

  /**
   * Symmetric quantization: maps [-max, +max] to [-127, +127]
   * Zero point is always 0, simplifies distance computation
   */
  private quantizeSymmetric(
    vector: Float32Array,
    quantized: Int8Array
  ): QuantizedVector {
    // Find maximum absolute value
    let maxAbs = 0;
    for (let i = 0; i < vector.length; i++) {
      const abs = Math.abs(vector[i]);
      if (abs > maxAbs) maxAbs = abs;
    }

    // Compute scale (avoid division by zero)
    const scale = maxAbs > 0 ? maxAbs / this.INT8_MAX : 1;
    const invScale = 1 / scale;

    // Quantize
    for (let i = 0; i < vector.length; i++) {
      const scaled = vector[i] * invScale;
      // Round and clamp to Int8 range
      quantized[i] = Math.max(
        this.INT8_MIN,
        Math.min(this.INT8_MAX, Math.round(scaled))
      );
    }

    return {
      quantized,
      scale,
      zeroPoint: 0,
    };
  }

  /**
   * Asymmetric quantization: maps [min, max] to [0, 255] then shifts to Int8
   * Provides better precision for non-symmetric distributions
   */
  private quantizeAsymmetric(
    vector: Float32Array,
    quantized: Int8Array
  ): QuantizedVector {
    // Find min and max
    let min = vector[0];
    let max = vector[0];
    for (let i = 1; i < vector.length; i++) {
      if (vector[i] < min) min = vector[i];
      if (vector[i] > max) max = vector[i];
    }

    // Compute scale and zero point
    const range = max - min;
    const scale = range > 0 ? range / this.UINT8_RANGE : 1;
    const invScale = 1 / scale;
    const zeroPoint = min;

    // Quantize: map [min, max] to [-128, 127]
    for (let i = 0; i < vector.length; i++) {
      const normalized = (vector[i] - zeroPoint) * invScale;
      // Map [0, 255] to [-128, 127]
      const shifted = normalized - 128;
      quantized[i] = Math.max(
        this.INT8_MIN,
        Math.min(this.INT8_MAX, Math.round(shifted))
      );
    }

    return {
      quantized,
      scale,
      zeroPoint,
    };
  }

  /**
   * Dequantize Int8 vector back to Float32
   *
   * @param quantized - Int8 quantized vector
   * @param scale - Scale factor from quantization
   * @param zeroPoint - Zero point from quantization
   * @returns Reconstructed Float32 vector
   */
  dequantize(
    quantized: Int8Array,
    scale: number,
    zeroPoint: number
  ): Float32Array {
    const dimension = quantized.length;
    const result = new Float32Array(dimension);

    if (this.config.method === 'symmetric' || zeroPoint === 0) {
      // Symmetric dequantization
      for (let i = 0; i < dimension; i++) {
        result[i] = quantized[i] * scale;
      }
    } else {
      // Asymmetric dequantization
      for (let i = 0; i < dimension; i++) {
        // Shift back from [-128, 127] to [0, 255]
        const normalized = quantized[i] + 128;
        result[i] = normalized * scale + zeroPoint;
      }
    }

    return result;
  }

  /**
   * Quantize multiple vectors in batch
   *
   * @param vectors - Array of Float32 vectors
   * @returns Batch of quantized vectors with metadata
   */
  quantizeBatch(vectors: Float32Array[]): QuantizedVectorBatch {
    if (vectors.length === 0) {
      return {
        vectors: [],
        scales: new Float32Array(0),
        zeroPoints: new Float32Array(0),
        dimension: 0,
        count: 0,
      };
    }

    const count = vectors.length;
    const dimension = vectors[0].length;
    const quantizedVectors: Int8Array[] = new Array(count);
    const scales = new Float32Array(count);
    const zeroPoints = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const result = this.quantize(vectors[i]);
      quantizedVectors[i] = result.quantized;
      scales[i] = result.scale;
      zeroPoints[i] = result.zeroPoint;
    }

    return {
      vectors: quantizedVectors,
      scales,
      zeroPoints,
      dimension,
      count,
    };
  }

  /**
   * Compute approximate distance directly on quantized vectors
   *
   * Uses integer arithmetic for speed, then scales result.
   * For cosine distance on normalized vectors, we use dot product.
   *
   * @param a - First quantized vector
   * @param scaleA - Scale of first vector
   * @param zpA - Zero point of first vector
   * @param b - Second quantized vector
   * @param scaleB - Scale of second vector
   * @param zpB - Zero point of second vector
   * @returns Approximate distance
   */
  quantizedDistance(
    a: Int8Array,
    scaleA: number,
    zpA: number,
    b: Int8Array,
    scaleB: number,
    zpB: number
  ): number {
    // For symmetric quantization (common case), compute dot product in Int32
    // then scale. This approximates cosine distance for normalized vectors.
    if (zpA === 0 && zpB === 0) {
      return this.symmetricQuantizedDistance(a, scaleA, b, scaleB);
    }

    // For asymmetric, fall back to dequantize and compute
    const vecA = this.dequantize(a, scaleA, zpA);
    const vecB = this.dequantize(b, scaleB, zpB);
    return this.cosineDistance(vecA, vecB);
  }

  /**
   * Fast symmetric quantized distance computation
   * Uses integer dot product with delayed scaling
   */
  private symmetricQuantizedDistance(
    a: Int8Array,
    scaleA: number,
    b: Int8Array,
    scaleB: number
  ): number {
    // Compute integer dot product
    let intDot = 0;
    const len = a.length;

    // Unroll for performance
    let i = 0;
    for (; i + 7 < len; i += 8) {
      intDot += a[i] * b[i];
      intDot += a[i + 1] * b[i + 1];
      intDot += a[i + 2] * b[i + 2];
      intDot += a[i + 3] * b[i + 3];
      intDot += a[i + 4] * b[i + 4];
      intDot += a[i + 5] * b[i + 5];
      intDot += a[i + 6] * b[i + 6];
      intDot += a[i + 7] * b[i + 7];
    }
    for (; i < len; i++) {
      intDot += a[i] * b[i];
    }

    // Scale the result
    const dotProduct = intDot * scaleA * scaleB;

    // For normalized vectors: cosine distance = 1 - dot_product
    // Clamp to handle numerical errors
    return Math.max(0, Math.min(2, 1 - dotProduct));
  }

  /**
   * Cosine distance for Float32 vectors
   */
  private cosineDistance(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    if (norm === 0) return 1;

    const similarity = dotProduct / norm;
    return Math.max(0, Math.min(2, 1 - similarity));
  }

  /**
   * Compute squared Euclidean distance on quantized vectors
   * Faster than cosine when only ranking matters
   */
  quantizedSquaredEuclidean(
    a: Int8Array,
    scaleA: number,
    zpA: number,
    b: Int8Array,
    scaleB: number,
    zpB: number
  ): number {
    let sum = 0;
    const len = a.length;

    if (zpA === 0 && zpB === 0) {
      // Symmetric case: direct integer arithmetic
      for (let i = 0; i < len; i++) {
        const diff = a[i] * scaleA - b[i] * scaleB;
        sum += diff * diff;
      }
    } else {
      // Asymmetric: need to account for zero points
      for (let i = 0; i < len; i++) {
        const valA = (a[i] + 128) * scaleA + zpA;
        const valB = (b[i] + 128) * scaleB + zpB;
        const diff = valA - valB;
        sum += diff * diff;
      }
    }

    return sum;
  }

  /**
   * Measure quantization quality by computing round-trip error
   *
   * @param vector - Original Float32 vector
   * @returns Quality metrics
   */
  measureQuality(vector: Float32Array): QuantizationQualityMetrics {
    // Quantize
    const { quantized, scale, zeroPoint } = this.quantize(vector);

    // Dequantize
    const reconstructed = this.dequantize(quantized, scale, zeroPoint);

    // Compute errors
    let mse = 0;
    let mae = 0;
    let maxError = 0;
    let signalPower = 0;
    let noisePower = 0;

    for (let i = 0; i < vector.length; i++) {
      const error = vector[i] - reconstructed[i];
      const absError = Math.abs(error);

      mse += error * error;
      mae += absError;
      if (absError > maxError) maxError = absError;

      signalPower += vector[i] * vector[i];
      noisePower += error * error;
    }

    const n = vector.length;
    mse /= n;
    mae /= n;

    // Signal-to-Quantization-Noise Ratio (SQNR) in dB
    const sqnr = noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : Infinity;

    return {
      mse,
      maxError,
      mae,
      sqnr,
    };
  }

  /**
   * Batch quality measurement
   *
   * @param vectors - Array of original vectors
   * @returns Aggregated quality metrics
   */
  measureBatchQuality(vectors: Float32Array[]): QuantizationQualityMetrics {
    if (vectors.length === 0) {
      return { mse: 0, maxError: 0, mae: 0, sqnr: Infinity };
    }

    let totalMse = 0;
    let totalMae = 0;
    let maxMaxError = 0;
    let totalSignalPower = 0;
    let totalNoisePower = 0;

    for (const vector of vectors) {
      const metrics = this.measureQuality(vector);
      totalMse += metrics.mse;
      totalMae += metrics.mae;
      if (metrics.maxError > maxMaxError) maxMaxError = metrics.maxError;

      // Recompute for total SQNR
      const { quantized, scale, zeroPoint } = this.quantize(vector);
      const reconstructed = this.dequantize(quantized, scale, zeroPoint);
      for (let i = 0; i < vector.length; i++) {
        totalSignalPower += vector[i] * vector[i];
        const error = vector[i] - reconstructed[i];
        totalNoisePower += error * error;
      }
    }

    const n = vectors.length;
    const sqnr = totalNoisePower > 0
      ? 10 * Math.log10(totalSignalPower / totalNoisePower)
      : Infinity;

    return {
      mse: totalMse / n,
      mae: totalMae / n,
      maxError: maxMaxError,
      sqnr,
    };
  }
}
