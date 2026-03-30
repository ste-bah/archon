/**
 * Int8 Quantizer Tests
 * TASK-VEC-001-008: Updated to use VECTOR_DIM (1536D)
 *
 * Implements: TASK-PERF-002 (Int8 quantization for 4x memory reduction)
 *
 * Tests:
 * - Quantization accuracy (symmetric and asymmetric)
 * - Round-trip error measurement
 * - Memory usage verification
 * - Search quality comparison
 * - Batch operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Int8Quantizer,
  QuantizedVectorStorage,
  HNSWIndex,
} from '../../../../../src/god-agent/core/database/index.js';
import { VECTOR_DIM } from '../../../../../src/god-agent/core/validation/constants.js';

describe('Int8Quantizer', () => {
  let quantizer: Int8Quantizer;

  beforeEach(() => {
    quantizer = new Int8Quantizer({ method: 'symmetric', scaleType: 'per-vector' });
  });

  describe('Symmetric Quantization', () => {
    it('should quantize and dequantize with low error', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vector = createNormalizedVector(VECTOR_DIM);

      // Quantize
      const { quantized, scale, zeroPoint } = quantizer.quantize(vector);

      // Verify Int8 bounds
      for (let i = 0; i < quantized.length; i++) {
        expect(quantized[i]).toBeGreaterThanOrEqual(-128);
        expect(quantized[i]).toBeLessThanOrEqual(127);
      }

      // Zero point should be 0 for symmetric
      expect(zeroPoint).toBe(0);

      // Dequantize
      const reconstructed = quantizer.dequantize(quantized, scale, zeroPoint);

      // Measure error
      const mse = computeMSE(vector, reconstructed);

      // MSE should be very low for normalized vectors
      expect(mse).toBeLessThan(0.001);
    });

    it('should maintain vector direction after round-trip', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vector = createNormalizedVector(VECTOR_DIM);
      const { quantized, scale, zeroPoint } = quantizer.quantize(vector);
      const reconstructed = quantizer.dequantize(quantized, scale, zeroPoint);

      // Cosine similarity should be very high
      const cosineSim = computeCosineSimilarity(vector, reconstructed);
      expect(cosineSim).toBeGreaterThan(0.999);
    });

    it('should handle edge cases', () => {
      // Zero vector
      const zeroVec = new Float32Array(100);
      const { quantized: qZero, scale: sZero } = quantizer.quantize(zeroVec);
      expect(qZero.every(v => v === 0)).toBe(true);

      // Single large value
      const singleLarge = new Float32Array(100);
      singleLarge[50] = 1.0;
      const { quantized: qSingle, scale } = quantizer.quantize(singleLarge);
      expect(qSingle[50]).toBe(127); // Should be max
    });
  });

  describe('Asymmetric Quantization', () => {
    let asymmetricQuantizer: Int8Quantizer;

    beforeEach(() => {
      asymmetricQuantizer = new Int8Quantizer({
        method: 'asymmetric',
        scaleType: 'per-vector',
      });
    });

    it('should quantize non-centered distributions well', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vector = new Float32Array(VECTOR_DIM);
      for (let i = 0; i < vector.length; i++) {
        vector[i] = Math.random() * 0.5 + 0.25; // [0.25, 0.75]
      }

      const { quantized, scale, zeroPoint } = asymmetricQuantizer.quantize(vector);
      const reconstructed = asymmetricQuantizer.dequantize(quantized, scale, zeroPoint);

      // Zero point should capture the offset
      expect(zeroPoint).toBeGreaterThan(0);

      // Measure error
      const mse = computeMSE(vector, reconstructed);
      expect(mse).toBeLessThan(0.001);
    });
  });

  describe('Batch Operations', () => {
    it('should quantize multiple vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vectors = Array.from({ length: 100 }, () => createNormalizedVector(VECTOR_DIM));

      const batch = quantizer.quantizeBatch(vectors);

      expect(batch.count).toBe(100);
      expect(batch.dimension).toBe(VECTOR_DIM);
      expect(batch.vectors.length).toBe(100);
      expect(batch.scales.length).toBe(100);
      expect(batch.zeroPoints.length).toBe(100);
    });
  });

  describe('Quantized Distance', () => {
    it('should approximate cosine distance accurately', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vecA = createNormalizedVector(VECTOR_DIM);
      const vecB = createNormalizedVector(VECTOR_DIM);

      // Compute exact distance
      const exactDist = computeCosineDistance(vecA, vecB);

      // Quantize both
      const qA = quantizer.quantize(vecA);
      const qB = quantizer.quantize(vecB);

      // Compute quantized distance
      const approxDist = quantizer.quantizedDistance(
        qA.quantized, qA.scale, qA.zeroPoint,
        qB.quantized, qB.scale, qB.zeroPoint
      );

      // Should be within 5% of exact
      const relError = Math.abs(approxDist - exactDist) / Math.max(exactDist, 0.001);
      expect(relError).toBeLessThan(0.05);
    });

    it('should preserve distance ordering', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const query = createNormalizedVector(VECTOR_DIM);
      const vectors = Array.from({ length: 100 }, () => createNormalizedVector(VECTOR_DIM));

      // Compute exact distances
      const exactDists = vectors.map(v => computeCosineDistance(query, v));

      // Compute quantized distances
      const qQuery = quantizer.quantize(query);
      const quantizedDists = vectors.map(v => {
        const qV = quantizer.quantize(v);
        return quantizer.quantizedDistance(
          qQuery.quantized, qQuery.scale, qQuery.zeroPoint,
          qV.quantized, qV.scale, qV.zeroPoint
        );
      });

      // Sort by distances
      const exactOrder = exactDists
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .map(x => x.i);

      const quantOrder = quantizedDists
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d - b.d)
        .map(x => x.i);

      // Top 10 should overlap significantly (recall > 0.8)
      const top10Exact = new Set(exactOrder.slice(0, 10));
      const top10Quant = quantOrder.slice(0, 10);
      const overlap = top10Quant.filter(i => top10Exact.has(i)).length;

      expect(overlap).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Quality Metrics', () => {
    it('should measure quantization quality accurately', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vector = createNormalizedVector(VECTOR_DIM);
      const metrics = quantizer.measureQuality(vector);

      expect(metrics.mse).toBeLessThan(0.001);
      expect(metrics.maxError).toBeLessThan(0.05);
      expect(metrics.mae).toBeLessThan(0.01);
      expect(metrics.sqnr).toBeGreaterThan(20); // > 20 dB is good quality
    });

    it('should measure batch quality', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vectors = Array.from({ length: 50 }, () => createNormalizedVector(VECTOR_DIM));
      const metrics = quantizer.measureBatchQuality(vectors);

      expect(metrics.mse).toBeLessThan(0.001);
      expect(metrics.sqnr).toBeGreaterThan(20);
    });
  });
});

describe('QuantizedVectorStorage', () => {
  let storage: QuantizedVectorStorage;

  beforeEach(() => {
    storage = new QuantizedVectorStorage(VECTOR_DIM);
  });

  describe('Storage Operations', () => {
    it('should store and retrieve vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vector = createNormalizedVector(VECTOR_DIM);
      storage.store('vec-1', vector);

      expect(storage.size).toBe(1);
      expect(storage.has('vec-1')).toBe(true);

      const retrieved = storage.retrieve('vec-1');
      expect(retrieved).not.toBeNull();

      // Should be similar but not identical (quantization error)
      const cosineSim = computeCosineSimilarity(vector, retrieved!);
      expect(cosineSim).toBeGreaterThan(0.999);
    });

    it('should remove vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      storage.store('vec-1', createNormalizedVector(VECTOR_DIM));
      expect(storage.has('vec-1')).toBe(true);

      storage.remove('vec-1');
      expect(storage.has('vec-1')).toBe(false);
      expect(storage.retrieve('vec-1')).toBeNull();
    });

    it('should clear all vectors', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      for (let i = 0; i < 10; i++) {
        storage.store(`vec-${i}`, createNormalizedVector(VECTOR_DIM));
      }
      expect(storage.size).toBe(10);

      storage.clear();
      expect(storage.size).toBe(0);
    });
  });

  describe('Memory Usage', () => {
    it('should achieve 4x compression ratio', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      for (let i = 0; i < 1000; i++) {
        storage.store(`vec-${i}`, createNormalizedVector(VECTOR_DIM));
      }

      const stats = storage.getMemoryUsage();

      // Compression ratio should be close to 4x
      // (accounting for metadata overhead)
      expect(stats.compressionRatio).toBeGreaterThan(3.5);
      expect(stats.compressionRatio).toBeLessThan(4.5);

      // Vector bytes should be 1 byte per component
      expect(stats.vectorBytes).toBe(1000 * VECTOR_DIM);
    });
  });

  describe('Search', () => {
    it('should search with reasonable accuracy', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vectors: Float32Array[] = [];
      for (let i = 0; i < 100; i++) {
        const vec = createNormalizedVector(VECTOR_DIM);
        vectors.push(vec);
        storage.store(`vec-${i}`, vec);
      }

      // Query with one of the stored vectors
      const queryIdx = 42;
      const results = storage.search(vectors[queryIdx], 10);

      // The query vector should be the closest
      expect(results[0].id).toBe(`vec-${queryIdx}`);
      expect(results[0].distance).toBeLessThan(0.01);
    });

    it('should re-rank with full precision', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      for (let i = 0; i < 100; i++) {
        storage.store(`vec-${i}`, createNormalizedVector(VECTOR_DIM));
      }

      const query = createNormalizedVector(VECTOR_DIM);
      const results = storage.searchWithRerank(query, 10);

      // Results should have both distances
      expect(results.length).toBe(10);
      for (const result of results) {
        expect(result.distance).toBeDefined();
        expect(result.approximateDistance).toBeDefined();
      }
    });
  });

  describe('Export/Import', () => {
    it('should serialize and deserialize', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const originalVectors: Map<string, Float32Array> = new Map();

      for (let i = 0; i < 10; i++) {
        const vec = createNormalizedVector(VECTOR_DIM);
        originalVectors.set(`vec-${i}`, vec);
        storage.store(`vec-${i}`, vec);
      }

      // Export
      const exported = storage.export();
      expect(exported.length).toBe(10);

      // Create new storage and import
      const newStorage = new QuantizedVectorStorage(VECTOR_DIM);
      newStorage.import(exported);

      expect(newStorage.size).toBe(10);

      // Verify vectors are similar
      for (const [id, original] of originalVectors) {
        const retrieved = newStorage.retrieve(id);
        expect(retrieved).not.toBeNull();
        const cosineSim = computeCosineSimilarity(original, retrieved!);
        expect(cosineSim).toBeGreaterThan(0.999);
      }
    });
  });
});

describe('HNSW with Quantization', () => {
  describe('Quantized HNSW Index', () => {
    it('should create index with quantization enabled', () => {
      const index = new HNSWIndex(VECTOR_DIM, {
        quantize: true,
        M: 16,
        efConstruction: 100,
        efSearch: 50,
      });

      expect(index.quantizationEnabled).toBe(true);
    });

    it('should maintain recall > 0.96 with quantization', () => {
      // Create index with quantization
      const quantizedIndex = new HNSWIndex(VECTOR_DIM, {
        quantize: true,
        M: 16,
        efConstruction: 200,
        efSearch: 100,
        rerankCandidates: 20,
      });

      // Create reference index without quantization
      const referenceIndex = new HNSWIndex(VECTOR_DIM, {
        quantize: false,
        M: 16,
        efConstruction: 200,
        efSearch: 100,
      });

      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const vectors: Map<string, Float32Array> = new Map();
      for (let i = 0; i < 1000; i++) {
        const vec = createNormalizedVector(VECTOR_DIM);
        vectors.set(`vec-${i}`, vec);
        quantizedIndex.add(`vec-${i}`, vec);
        referenceIndex.add(`vec-${i}`, vec);
      }

      // Test recall over multiple queries
      let totalRecall = 0;
      const numQueries = 50;
      const k = 10;
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      for (let q = 0; q < numQueries; q++) {
        const query = createNormalizedVector(VECTOR_DIM);

        const quantizedResults = quantizedIndex.search(query, k);
        const referenceResults = referenceIndex.search(query, k);

        // Compute recall
        const refSet = new Set(referenceResults.map(r => r.id));
        const overlap = quantizedResults.filter(r => refSet.has(r.id)).length;
        totalRecall += overlap / k;
      }

      const avgRecall = totalRecall / numQueries;

      // Recall should be > 0.96 with re-ranking
      expect(avgRecall).toBeGreaterThan(0.96);
    });

    it('should report memory savings with quantization', () => {
      const index = new HNSWIndex(VECTOR_DIM, { quantize: true });

      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      for (let i = 0; i < 1000; i++) {
        index.add(`vec-${i}`, createNormalizedVector(VECTOR_DIM));
      }

      const stats = index.getStats();

      expect(stats.quantizationEnabled).toBe(true);
      expect(stats.compressionRatio).toBeGreaterThan(3.5);
      expect(stats.quantizedMemoryEstimate).toBeDefined();
      expect(stats.quantizedMemoryEstimate!).toBeLessThan(stats.memoryEstimate);
    });

    it('should compute quantized distance', () => {
      // TASK-VEC-001-008: Use VECTOR_DIM (1536)
      const index = new HNSWIndex(VECTOR_DIM, { quantize: true });

      const vecA = createNormalizedVector(VECTOR_DIM);
      const vecB = createNormalizedVector(VECTOR_DIM);

      index.add('a', vecA);
      index.add('b', vecB);

      const quantizedDist = index.getQuantizedDistance('a', 'b');
      expect(quantizedDist).not.toBeNull();
      expect(quantizedDist).toBeGreaterThanOrEqual(0);
      expect(quantizedDist).toBeLessThanOrEqual(2);
    });

    it('should report quantization quality metrics', () => {
      const index = new HNSWIndex(VECTOR_DIM, { quantize: true });

      for (let i = 0; i < 100; i++) {
        index.add(`vec-${i}`, createNormalizedVector(VECTOR_DIM));
      }

      const quality = index.getQuantizationQuality();

      expect(quality).not.toBeNull();
      expect(quality!.mse).toBeLessThan(0.001);
      expect(quality!.sqnr).toBeGreaterThan(20);
    });
  });
});

// Helper functions

/**
 * Create normalized vector for testing
 * TASK-VEC-001-008: Updated default to VECTOR_DIM (1536)
 */
function createNormalizedVector(dim: number = VECTOR_DIM): Float32Array {
  const vector = new Float32Array(dim);
  let norm = 0;

  for (let i = 0; i < dim; i++) {
    vector[i] = (Math.random() - 0.5) * 2;
    norm += vector[i] * vector[i];
  }

  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    vector[i] /= norm;
  }

  return vector;
}

function computeMSE(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum / a.length;
}

function computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function computeCosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - computeCosineSimilarity(a, b);
}
