/**
 * Compression Utilities
 * TASK-CMP-001 - 5-Tier Compression Lifecycle
 *
 * Provides encoding/decoding utilities for:
 * - Float32 ↔ Float16 conversion
 * - Product Quantization (PQ8, PQ4)
 * - Binary quantization
 *
 * Target: <1ms compression/decompression for real-time use
 */

import type { IPQCodebook, IBinaryThresholds } from './compression-types.js';

// ==================== Float16 Codec ====================

/**
 * Convert Float32 to Float16 (half precision)
 * IEEE 754 half-precision format
 */
export function float32ToFloat16(value: number): number {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);

  floatView[0] = value;
  const x = int32View[0];

  // Extract components
  const sign = (x >> 31) & 0x1;
  let exponent = (x >> 23) & 0xff;
  let mantissa = x & 0x7fffff;

  // Handle special cases
  if (exponent === 0xff) {
    // Infinity or NaN
    return (sign << 15) | 0x7c00 | (mantissa ? 0x200 : 0);
  }

  if (exponent === 0) {
    // Denormalized or zero
    return sign << 15;
  }

  // Adjust exponent bias (127 -> 15)
  exponent = exponent - 127 + 15;

  if (exponent >= 31) {
    // Overflow to infinity
    return (sign << 15) | 0x7c00;
  }

  if (exponent <= 0) {
    // Underflow to zero
    return sign << 15;
  }

  // Round mantissa (23 bits -> 10 bits)
  mantissa = (mantissa + 0x1000) >> 13;

  return (sign << 15) | (exponent << 10) | mantissa;
}

/**
 * Convert Float16 to Float32
 */
export function float16ToFloat32(half: number): number {
  const sign = (half >> 15) & 0x1;
  const exponent = (half >> 10) & 0x1f;
  const mantissa = half & 0x3ff;

  let result: number;

  if (exponent === 0) {
    if (mantissa === 0) {
      // Zero
      result = 0;
    } else {
      // Denormalized
      result = mantissa / 1024 * Math.pow(2, -14);
    }
  } else if (exponent === 31) {
    // Infinity or NaN
    result = mantissa === 0 ? Infinity : NaN;
  } else {
    // Normalized
    result = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
  }

  return sign ? -result : result;
}

/**
 * Encode Float32Array to Float16 (Uint16Array)
 */
export function encodeFloat16(vector: Float32Array): Uint16Array {
  const encoded = new Uint16Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    encoded[i] = float32ToFloat16(vector[i]);
  }
  return encoded;
}

/**
 * Decode Float16 (Uint16Array) to Float32Array
 */
export function decodeFloat16(encoded: Uint16Array): Float32Array {
  const decoded = new Float32Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    decoded[i] = float16ToFloat32(encoded[i]);
  }
  return decoded;
}

// ==================== Product Quantization ====================

/**
 * Train PQ codebook using k-means clustering
 * @param vectors Training vectors
 * @param numSubvectors Number of subvectors to split into
 * @param numCentroids Number of centroids per subvector (256 for PQ8, 16 for PQ4)
 * @param maxIterations Maximum k-means iterations
 */
export function trainPQCodebook(
  vectors: Float32Array[],
  numSubvectors: number,
  numCentroids: number,
  maxIterations: number = 20
): IPQCodebook {
  if (vectors.length === 0) {
    throw new Error('Cannot train codebook with empty vectors');
  }

  const dim = vectors[0].length;
  const subvectorDim = Math.ceil(dim / numSubvectors);

  // Initialize centroids for each subvector
  const centroids: Float32Array[] = [];

  for (let sv = 0; sv < numSubvectors; sv++) {
    const start = sv * subvectorDim;
    const end = Math.min(start + subvectorDim, dim);
    const actualDim = end - start;

    // Extract subvectors from training data
    const subvectors: Float32Array[] = vectors.map(v => {
      const sub = new Float32Array(actualDim);
      for (let i = 0; i < actualDim; i++) {
        sub[i] = v[start + i];
      }
      return sub;
    });

    // k-means clustering
    const svCentroids = kMeansClustering(subvectors, numCentroids, maxIterations);
    centroids.push(svCentroids);
  }

  return {
    numSubvectors,
    subvectorDim,
    numCentroids,
    centroids,
    trainedAt: Date.now(),
    trainingSize: vectors.length,
  };
}

/**
 * Simple k-means clustering
 */
function kMeansClustering(
  vectors: Float32Array[],
  k: number,
  maxIterations: number
): Float32Array {
  const dim = vectors[0].length;

  // Initialize centroids randomly from data points
  const indices = new Set<number>();
  while (indices.size < Math.min(k, vectors.length)) {
    indices.add(Math.floor(Math.random() * vectors.length));
  }

  let centroids = new Float32Array(k * dim);
  let centroidIdx = 0;
  for (const idx of indices) {
    for (let d = 0; d < dim; d++) {
      centroids[centroidIdx * dim + d] = vectors[idx][d];
    }
    centroidIdx++;
  }

  // Fill remaining with zeros if not enough unique vectors
  while (centroidIdx < k) {
    for (let d = 0; d < dim; d++) {
      centroids[centroidIdx * dim + d] = 0;
    }
    centroidIdx++;
  }

  // k-means iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign vectors to nearest centroid
    const assignments: number[] = [];
    for (const vec of vectors) {
      let minDist = Infinity;
      let bestCentroid = 0;

      for (let c = 0; c < k; c++) {
        let dist = 0;
        for (let d = 0; d < dim; d++) {
          const diff = vec[d] - centroids[c * dim + d];
          dist += diff * diff;
        }
        if (dist < minDist) {
          minDist = dist;
          bestCentroid = c;
        }
      }
      assignments.push(bestCentroid);
    }

    // Update centroids
    const newCentroids = new Float32Array(k * dim);
    const counts = new Uint32Array(k);

    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) {
        newCentroids[c * dim + d] += vectors[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dim; d++) {
          newCentroids[c * dim + d] /= counts[c];
        }
      } else {
        // Keep old centroid if no assignments
        for (let d = 0; d < dim; d++) {
          newCentroids[c * dim + d] = centroids[c * dim + d];
        }
      }
    }

    centroids = newCentroids;
  }

  return centroids;
}

/**
 * Encode vector using PQ codebook (PQ8 - 8-bit codes)
 */
export function encodePQ8(vector: Float32Array, codebook: IPQCodebook): Uint8Array {
  const codes = new Uint8Array(codebook.numSubvectors);
  const dim = vector.length;

  for (let sv = 0; sv < codebook.numSubvectors; sv++) {
    const start = sv * codebook.subvectorDim;
    const end = Math.min(start + codebook.subvectorDim, dim);
    const actualDim = end - start;

    // Find nearest centroid
    let minDist = Infinity;
    let bestCode = 0;

    const centroids = codebook.centroids[sv];
    for (let c = 0; c < codebook.numCentroids; c++) {
      let dist = 0;
      for (let d = 0; d < actualDim; d++) {
        const diff = vector[start + d] - centroids[c * actualDim + d];
        dist += diff * diff;
      }
      if (dist < minDist) {
        minDist = dist;
        bestCode = c;
      }
    }

    codes[sv] = bestCode;
  }

  return codes;
}

/**
 * Decode PQ8 codes back to approximate vector
 */
export function decodePQ8(codes: Uint8Array, codebook: IPQCodebook, originalDim: number): Float32Array {
  const vector = new Float32Array(originalDim);

  for (let sv = 0; sv < codebook.numSubvectors; sv++) {
    const start = sv * codebook.subvectorDim;
    const end = Math.min(start + codebook.subvectorDim, originalDim);
    const actualDim = end - start;

    const centroidIdx = codes[sv];
    const centroids = codebook.centroids[sv];

    for (let d = 0; d < actualDim; d++) {
      vector[start + d] = centroids[centroidIdx * actualDim + d];
    }
  }

  return vector;
}

/**
 * Encode vector using PQ4 (4-bit codes, packed into bytes)
 */
export function encodePQ4(vector: Float32Array, codebook: IPQCodebook): Uint8Array {
  // Each byte holds 2 4-bit codes
  const numBytes = Math.ceil(codebook.numSubvectors / 2);
  const codes = new Uint8Array(numBytes);
  const dim = vector.length;

  for (let sv = 0; sv < codebook.numSubvectors; sv++) {
    const start = sv * codebook.subvectorDim;
    const end = Math.min(start + codebook.subvectorDim, dim);
    const actualDim = end - start;

    // Find nearest centroid (max 16 for 4-bit)
    let minDist = Infinity;
    let bestCode = 0;

    const centroids = codebook.centroids[sv];
    const maxCentroids = Math.min(codebook.numCentroids, 16);

    for (let c = 0; c < maxCentroids; c++) {
      let dist = 0;
      for (let d = 0; d < actualDim; d++) {
        const diff = vector[start + d] - centroids[c * actualDim + d];
        dist += diff * diff;
      }
      if (dist < minDist) {
        minDist = dist;
        bestCode = c;
      }
    }

    // Pack into bytes (2 codes per byte)
    const byteIdx = Math.floor(sv / 2);
    if (sv % 2 === 0) {
      codes[byteIdx] = bestCode;
    } else {
      codes[byteIdx] |= bestCode << 4;
    }
  }

  return codes;
}

/**
 * Decode PQ4 codes back to approximate vector
 */
export function decodePQ4(codes: Uint8Array, codebook: IPQCodebook, originalDim: number): Float32Array {
  const vector = new Float32Array(originalDim);

  for (let sv = 0; sv < codebook.numSubvectors; sv++) {
    const start = sv * codebook.subvectorDim;
    const end = Math.min(start + codebook.subvectorDim, originalDim);
    const actualDim = end - start;

    // Unpack from bytes
    const byteIdx = Math.floor(sv / 2);
    const centroidIdx = (sv % 2 === 0)
      ? codes[byteIdx] & 0x0f
      : (codes[byteIdx] >> 4) & 0x0f;

    const centroids = codebook.centroids[sv];

    for (let d = 0; d < actualDim; d++) {
      vector[start + d] = centroids[centroidIdx * actualDim + d];
    }
  }

  return vector;
}

// ==================== Binary Quantization ====================

/**
 * Train binary thresholds from vectors (per-dimension median)
 */
export function trainBinaryThresholds(vectors: Float32Array[]): IBinaryThresholds {
  if (vectors.length === 0) {
    throw new Error('Cannot train thresholds with empty vectors');
  }

  const dim = vectors[0].length;
  const thresholds = new Float32Array(dim);

  for (let d = 0; d < dim; d++) {
    // Collect values for this dimension
    const values = vectors.map(v => v[d]).sort((a, b) => a - b);
    // Use median as threshold
    thresholds[d] = values[Math.floor(values.length / 2)];
  }

  return {
    thresholds,
    trainedAt: Date.now(),
    trainingSize: vectors.length,
  };
}

/**
 * Encode vector to binary (1 bit per dimension)
 */
export function encodeBinary(vector: Float32Array, thresholds: IBinaryThresholds): Uint8Array {
  const numBytes = Math.ceil(vector.length / 8);
  const encoded = new Uint8Array(numBytes);

  for (let i = 0; i < vector.length; i++) {
    if (vector[i] >= thresholds.thresholds[i]) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      encoded[byteIdx] |= 1 << bitIdx;
    }
  }

  return encoded;
}

/**
 * Decode binary back to approximate vector
 * Uses threshold values as reconstruction targets
 */
export function decodeBinary(encoded: Uint8Array, thresholds: IBinaryThresholds): Float32Array {
  const dim = thresholds.thresholds.length;
  const vector = new Float32Array(dim);

  for (let i = 0; i < dim; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    const bit = (encoded[byteIdx] >> bitIdx) & 1;

    // Use threshold +/- offset for reconstruction
    const offset = Math.abs(thresholds.thresholds[i]) * 0.5 + 0.1;
    vector[i] = bit ? thresholds.thresholds[i] + offset : thresholds.thresholds[i] - offset;
  }

  return vector;
}

// ==================== Error Measurement ====================

/**
 * Calculate reconstruction error (MSE)
 */
export function calculateReconstructionError(original: Float32Array, reconstructed: Float32Array): number {
  if (original.length !== reconstructed.length) {
    throw new Error('Dimension mismatch');
  }

  let sumSquaredError = 0;
  for (let i = 0; i < original.length; i++) {
    const diff = original[i] - reconstructed[i];
    sumSquaredError += diff * diff;
  }

  return sumSquaredError / original.length;
}

/**
 * Calculate cosine similarity between vectors
 */
export function cosineSimilarityCompression(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Dimension mismatch');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dotProduct / denom : 0;
}

// ==================== Utility Functions ====================

/**
 * Convert Uint8Array to Uint16Array (for Float16)
 */
export function uint8ToUint16(data: Uint8Array): Uint16Array {
  const uint16 = new Uint16Array(data.length / 2);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < uint16.length; i++) {
    uint16[i] = view.getUint16(i * 2, true); // little-endian
  }
  return uint16;
}

/**
 * Convert Uint16Array to Uint8Array
 */
export function uint16ToUint8(data: Uint16Array): Uint8Array {
  const uint8 = new Uint8Array(data.length * 2);
  const view = new DataView(uint8.buffer);
  for (let i = 0; i < data.length; i++) {
    view.setUint16(i * 2, data[i], true); // little-endian
  }
  return uint8;
}
