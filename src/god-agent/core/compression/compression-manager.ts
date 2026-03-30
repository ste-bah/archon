/**
 * Compression Manager
 * TASK-CMP-001 - 5-Tier Compression Lifecycle
 *
 * Manages adaptive vector compression with:
 * - Automatic tier transitions based on access patterns
 * - Heat score tracking (recency + frequency)
 * - One-way compression (Hot → Frozen only)
 *
 * Target: 90%+ memory reduction for 1M vectors (3GB → 297MB)
 */

import {
  CompressionTier,
  TIER_CONFIGS,
  TIER_HIERARCHY,
  DEFAULT_COMPRESSION_CONFIG,
  CompressionError,
  TierTransitionError,
  getTierForHeatScore,
  isValidTransition,
  type VectorID,
  type ICompressedEmbedding,
  type IAccessRecord,
  type IMemoryUsageStats,
  type ICompressionConfig,
  type IPQCodebook,
  type IBinaryThresholds,
} from './compression-types.js';

import {
  encodeFloat16,
  decodeFloat16,
  encodePQ8,
  decodePQ8,
  encodePQ4,
  decodePQ4,
  encodeBinary,
  decodeBinary,
  trainPQCodebook,
  trainBinaryThresholds,
  uint16ToUint8,
  uint8ToUint16,
  calculateReconstructionError,
} from './compression-utils.js';

/**
 * Compression Manager - Handles 5-tier adaptive compression
 */
export class CompressionManager {
  private readonly config: Required<ICompressionConfig>;

  // Storage
  private embeddings: Map<VectorID, ICompressedEmbedding> = new Map();
  private accessRecords: Map<VectorID, IAccessRecord> = new Map();
  private originalVectors: Map<VectorID, Float32Array> = new Map(); // For error measurement

  // Codebooks (trained from data)
  private pq8Codebook: IPQCodebook | null = null;
  private pq4Codebook: IPQCodebook | null = null;
  private binaryThresholds: IBinaryThresholds | null = null;

  // Training data buffer
  private trainingBuffer: Float32Array[] = [];
  private readonly minTrainingSize = 100;

  // Auto-transition timer
  private transitionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ICompressionConfig = {}) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };

    if (this.config.autoTransition) {
      this.startAutoTransition();
    }
  }

  // ==================== Core Operations ====================

  /**
   * Store a new vector (starts at HOT tier)
   */
  store(vectorId: VectorID, vector: Float32Array): void {
    if (vector.length !== this.config.dimension) {
      throw new CompressionError(
        `Dimension mismatch: expected ${this.config.dimension}, got ${vector.length}`,
        'DIMENSION_MISMATCH'
      );
    }

    // Store at HOT tier (no compression)
    const data = new Uint8Array(vector.buffer.slice(0));

    this.embeddings.set(vectorId, {
      vectorId,
      tier: CompressionTier.HOT,
      data,
      originalDim: vector.length,
      compressedAt: Date.now(),
    });

    // Initialize access record
    const now = Date.now();
    this.accessRecords.set(vectorId, {
      vectorId,
      tier: CompressionTier.HOT,
      accessTimestamps: [now],
      totalAccesses: 1,
      heatScore: 1.0, // Start hot
      lastAccessAt: now,
      createdAt: now,
    });

    // Add to training buffer and store original for error measurement
    const originalCopy = new Float32Array(vector);
    this.trainingBuffer.push(originalCopy);
    this.originalVectors.set(vectorId, originalCopy);

    if (this.config.verbose) {
      console.log(`[CMP] Stored ${vectorId} at HOT tier`);
    }
  }

  /**
   * Retrieve a vector (decompresses and updates access)
   */
  retrieve(vectorId: VectorID): Float32Array | null {
    const embedding = this.embeddings.get(vectorId);
    if (!embedding) {
      return null;
    }

    // Update access record
    this.recordAccess(vectorId);

    // Decompress based on tier
    return this.decompress(embedding);
  }

  /**
   * Check if a vector exists
   */
  has(vectorId: VectorID): boolean {
    return this.embeddings.has(vectorId);
  }

  /**
   * Delete a vector
   */
  delete(vectorId: VectorID): boolean {
    const existed = this.embeddings.delete(vectorId);
    this.accessRecords.delete(vectorId);
    return existed;
  }

  /**
   * Get current tier of a vector
   */
  getTier(vectorId: VectorID): CompressionTier | null {
    return this.embeddings.get(vectorId)?.tier ?? null;
  }

  /**
   * Get access record for a vector
   */
  getAccessRecord(vectorId: VectorID): IAccessRecord | null {
    return this.accessRecords.get(vectorId) ?? null;
  }

  // ==================== Compression/Decompression ====================

  /**
   * Compress vector to target tier
   */
  private compress(vector: Float32Array, tier: CompressionTier): Uint8Array {
    switch (tier) {
      case CompressionTier.HOT:
        // No compression - raw Float32
        return new Uint8Array(vector.buffer.slice(0));

      case CompressionTier.WARM:
        // Float16 compression
        return uint16ToUint8(encodeFloat16(vector));

      case CompressionTier.COOL:
        // PQ8 compression
        if (!this.pq8Codebook) {
          throw new CompressionError('PQ8 codebook not trained', 'CODEC_NOT_TRAINED');
        }
        return encodePQ8(vector, this.pq8Codebook);

      case CompressionTier.COLD:
        // PQ4 compression
        if (!this.pq4Codebook) {
          throw new CompressionError('PQ4 codebook not trained', 'CODEC_NOT_TRAINED');
        }
        return encodePQ4(vector, this.pq4Codebook);

      case CompressionTier.FROZEN:
        // Binary compression
        if (!this.binaryThresholds) {
          throw new CompressionError('Binary thresholds not trained', 'CODEC_NOT_TRAINED');
        }
        return encodeBinary(vector, this.binaryThresholds);

      default:
        throw new CompressionError(`Invalid tier: ${tier}`, 'INVALID_TIER');
    }
  }

  /**
   * Decompress embedding back to Float32
   */
  private decompress(embedding: ICompressedEmbedding): Float32Array {
    switch (embedding.tier) {
      case CompressionTier.HOT:
        // No decompression needed
        return new Float32Array(embedding.data.buffer.slice(
          embedding.data.byteOffset,
          embedding.data.byteOffset + embedding.data.byteLength
        ));

      case CompressionTier.WARM:
        // Float16 decompression
        return decodeFloat16(uint8ToUint16(embedding.data));

      case CompressionTier.COOL:
        // PQ8 decompression
        if (!this.pq8Codebook) {
          throw new CompressionError('PQ8 codebook not trained', 'CODEC_NOT_TRAINED');
        }
        return decodePQ8(embedding.data, this.pq8Codebook, embedding.originalDim);

      case CompressionTier.COLD:
        // PQ4 decompression
        if (!this.pq4Codebook) {
          throw new CompressionError('PQ4 codebook not trained', 'CODEC_NOT_TRAINED');
        }
        return decodePQ4(embedding.data, this.pq4Codebook, embedding.originalDim);

      case CompressionTier.FROZEN:
        // Binary decompression
        if (!this.binaryThresholds) {
          throw new CompressionError('Binary thresholds not trained', 'CODEC_NOT_TRAINED');
        }
        return decodeBinary(embedding.data, this.binaryThresholds);

      default:
        throw new CompressionError(`Invalid tier: ${embedding.tier}`, 'INVALID_TIER');
    }
  }

  // ==================== Tier Transitions ====================

  /**
   * Manually transition a vector to a new tier
   * Only forward transitions allowed (Hot → Frozen direction)
   */
  transitionTier(vectorId: VectorID, targetTier: CompressionTier): void {
    const embedding = this.embeddings.get(vectorId);
    if (!embedding) {
      throw new CompressionError(`Vector not found: ${vectorId}`, 'INVALID_DATA');
    }

    if (!isValidTransition(embedding.tier, targetTier)) {
      throw new TierTransitionError(embedding.tier, targetTier);
    }

    // Decompress current data
    const vector = this.decompress(embedding);

    // Compress to new tier
    const newData = this.compress(vector, targetTier);

    // Update embedding
    embedding.tier = targetTier;
    embedding.data = newData;
    embedding.compressedAt = Date.now();

    // Update access record tier
    const record = this.accessRecords.get(vectorId);
    if (record) {
      record.tier = targetTier;
    }

    if (this.config.verbose) {
      console.log(`[CMP] Transitioned ${vectorId} to ${targetTier}`);
    }
  }

  /**
   * Check and transition vectors based on heat scores
   */
  checkTransitions(): number {
    let transitionCount = 0;

    for (const [vectorId, record] of this.accessRecords) {
      const targetTier = getTierForHeatScore(record.heatScore);
      const currentTier = record.tier;

      if (isValidTransition(currentTier, targetTier)) {
        try {
          this.transitionTier(vectorId, targetTier);
          transitionCount++;
        } catch (error) {
          // Skip if codebook not trained
          if (this.config.verbose && error instanceof CompressionError) {
            console.warn(`[CMP] Skipping transition for ${vectorId}: ${error.message}`);
          }
        }
      }
    }

    return transitionCount;
  }

  // ==================== Heat Score Management ====================

  /**
   * Record an access to a vector
   */
  private recordAccess(vectorId: VectorID): void {
    const record = this.accessRecords.get(vectorId);
    if (!record) return;

    const now = Date.now();

    // Add timestamp
    record.accessTimestamps.push(now);
    record.totalAccesses++;
    record.lastAccessAt = now;

    // Prune old timestamps
    const cutoff = now - this.config.accessWindow;
    record.accessTimestamps = record.accessTimestamps.filter(t => t >= cutoff);

    // Recalculate heat score
    record.heatScore = this.calculateHeatScore(record);
  }

  /**
   * Calculate heat score based on access patterns
   * Combines recency and frequency
   */
  private calculateHeatScore(record: IAccessRecord): number {
    const now = Date.now();

    // Recency factor (exponential decay)
    const timeSinceAccess = (now - record.lastAccessAt) / 3600000; // hours
    const recencyScore = Math.exp(-this.config.heatDecayRate * timeSinceAccess);

    // Frequency factor (accesses per day)
    const recentAccesses = record.accessTimestamps.length;
    const frequencyScore = Math.min(1.0, recentAccesses / 10); // Cap at 10 accesses/day

    // Combined score
    return Math.max(0, Math.min(1, recencyScore * 0.6 + frequencyScore * 0.4));
  }

  /**
   * Decay all heat scores (call periodically)
   */
  decayHeatScores(): void {
    for (const record of this.accessRecords.values()) {
      record.heatScore = this.calculateHeatScore(record);
    }
  }

  // ==================== Codebook Training ====================

  /**
   * Train all codebooks from stored vectors
   */
  trainCodebooks(): void {
    if (this.trainingBuffer.length < this.minTrainingSize) {
      if (this.config.verbose) {
        console.log(`[CMP] Not enough training data (${this.trainingBuffer.length}/${this.minTrainingSize})`);
      }
      return;
    }

    // Train PQ8 (96 subvectors, 256 centroids)
    this.pq8Codebook = trainPQCodebook(this.trainingBuffer, 96, 256, 10);

    // Train PQ4 (96 subvectors, 16 centroids)
    this.pq4Codebook = trainPQCodebook(this.trainingBuffer, 96, 16, 10);

    // Train binary thresholds
    this.binaryThresholds = trainBinaryThresholds(this.trainingBuffer);

    if (this.config.verbose) {
      console.log(`[CMP] Trained codebooks with ${this.trainingBuffer.length} vectors`);
    }
  }

  /**
   * Check if codebooks are trained
   */
  areCodebooksTrained(): boolean {
    return this.pq8Codebook !== null &&
           this.pq4Codebook !== null &&
           this.binaryThresholds !== null;
  }

  // ==================== Statistics ====================

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): IMemoryUsageStats {
    const byTier: Record<CompressionTier, number> = {
      [CompressionTier.HOT]: 0,
      [CompressionTier.WARM]: 0,
      [CompressionTier.COOL]: 0,
      [CompressionTier.COLD]: 0,
      [CompressionTier.FROZEN]: 0,
    };

    let totalBytes = 0;

    for (const embedding of this.embeddings.values()) {
      byTier[embedding.tier]++;
      totalBytes += embedding.data.byteLength;
    }

    const totalVectors = this.embeddings.size;
    const uncompressedBytes = totalVectors * TIER_CONFIGS[CompressionTier.HOT].bytesPerVector;
    const compressionRatio = totalBytes > 0 ? uncompressedBytes / totalBytes : 1;
    const bytesSaved = uncompressedBytes - totalBytes;

    return {
      totalVectors,
      byTier,
      totalBytes,
      compressionRatio,
      bytesSaved,
      uncompressedBytes,
    };
  }

  /**
   * Get tier distribution
   */
  getTierDistribution(): Map<CompressionTier, number> {
    const distribution = new Map<CompressionTier, number>();

    for (const tier of TIER_HIERARCHY) {
      distribution.set(tier, 0);
    }

    for (const embedding of this.embeddings.values()) {
      const count = distribution.get(embedding.tier) ?? 0;
      distribution.set(embedding.tier, count + 1);
    }

    return distribution;
  }

  /**
   * Get all vector IDs
   */
  getAllVectorIds(): VectorID[] {
    return Array.from(this.embeddings.keys());
  }

  /**
   * Get count of vectors
   */
  get size(): number {
    return this.embeddings.size;
  }

  // ==================== Auto-Transition ====================

  /**
   * Start automatic tier transitions
   */
  private startAutoTransition(): void {
    if (this.transitionTimer) return;

    this.transitionTimer = setInterval(() => {
      this.decayHeatScores();
      const count = this.checkTransitions();
      if (this.config.verbose && count > 0) {
        console.log(`[CMP] Auto-transitioned ${count} vectors`);
      }
    }, this.config.transitionCheckInterval);
  }

  /**
   * Stop automatic tier transitions
   */
  stopAutoTransition(): void {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  // ==================== Cleanup ====================

  /**
   * Clear all data
   */
  clear(): void {
    this.embeddings.clear();
    this.accessRecords.clear();
    this.trainingBuffer = [];
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopAutoTransition();
    this.clear();
  }

  // ==================== Testing/Debugging ====================

  /**
   * Measure compression error for a vector (MSE between original and reconstructed)
   */
  measureCompressionError(vectorId: VectorID): number | null {
    const embedding = this.embeddings.get(vectorId);
    if (!embedding || embedding.tier === CompressionTier.HOT) {
      return 0; // No compression = no error
    }

    // Get decompressed version
    const decompressed = this.decompress(embedding);
    if (!decompressed) {
      return null; // Decompression failed
    }

    // Get original vector for comparison
    const original = this.originalVectors.get(vectorId);
    if (!original) {
      // Fallback to theoretical estimates if original not available
      switch (embedding.tier) {
        case CompressionTier.WARM:
          return 0.001; // Float16: ~0.1% max error
        case CompressionTier.COOL:
          return 0.01; // PQ8: ~1% typical error
        case CompressionTier.COLD:
          return 0.05; // PQ4: ~5% typical error
        case CompressionTier.FROZEN:
          return 0.15; // Binary: ~15% typical error
        default:
          return null;
      }
    }

    // Calculate actual reconstruction error (MSE)
    return calculateReconstructionError(original, decompressed);
  }

  /**
   * Force train codebooks with custom data
   * (Used for testing)
   */
  forceTrainCodebooks(vectors: Float32Array[]): void {
    this.trainingBuffer = vectors;
    this.trainCodebooks();
  }
}
