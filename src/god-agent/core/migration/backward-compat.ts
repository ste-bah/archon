/**
 * Backward Compatibility Layer for Vector Dimension Migration
 *
 * Implements: TASK-VEC-001-009 (Data Migration Strategy)
 * Constitution: RULE-009 (zero data loss), RULE-046 (atomic operations)
 *
 * Provides runtime compatibility for mixed 768D/1536D vector environments:
 * - Automatic dimension detection on read
 * - Transparent conversion to 1536D
 * - Warning logs for unconverted data
 * - Statistics tracking
 */

import { VECTOR_DIM, L2_NORM_TOLERANCE } from '../validation/constants.js';

/**
 * Legacy embedding dimension (text-embedding-ada-002)
 */
export const LEGACY_VECTOR_DIM = 768;

/**
 * Statistics for backward compatibility operations
 */
export interface BackwardCompatStats {
  /** Total vectors processed */
  totalVectorsProcessed: number;
  /** Vectors that needed conversion (768D -> 1536D) */
  legacyVectorsConverted: number;
  /** Vectors already in target dimension */
  nativeVectors: number;
  /** Conversion warnings emitted */
  warningsEmitted: number;
  /** Last warning timestamp */
  lastWarningTime: number | null;
  /** Files with unconverted data */
  unconvertedSources: Set<string>;
}

/**
 * Options for backward compatibility layer
 */
export interface BackwardCompatOptions {
  /** Log warnings when converting legacy vectors */
  warnOnConversion: boolean;
  /** Maximum warnings to emit (prevents log spam) */
  maxWarnings: number;
  /** Warn if conversions exceed this percentage */
  conversionThreshold: number;
  /** Source identifier for tracking */
  sourceId?: string;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: BackwardCompatOptions = {
  warnOnConversion: true,
  maxWarnings: 100,
  conversionThreshold: 0.1, // Warn if >10% of vectors need conversion
  sourceId: undefined,
};

/**
 * Backward Compatibility Layer
 *
 * Provides transparent conversion between 768D and 1536D vectors
 * during the migration transition period.
 */
export class BackwardCompatLayer {
  private options: BackwardCompatOptions;
  private stats: BackwardCompatStats;

  constructor(options: Partial<BackwardCompatOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stats = {
      totalVectorsProcessed: 0,
      legacyVectorsConverted: 0,
      nativeVectors: 0,
      warningsEmitted: 0,
      lastWarningTime: null,
      unconvertedSources: new Set(),
    };
  }

  /**
   * Detect vector dimension
   */
  detectDimension(vector: Float32Array | number[]): number {
    return Array.isArray(vector) ? vector.length : vector.length;
  }

  /**
   * Check if vector needs conversion
   */
  needsConversion(vector: Float32Array | number[]): boolean {
    return this.detectDimension(vector) === LEGACY_VECTOR_DIM;
  }

  /**
   * Check if vector is already in target dimension
   */
  isNativeDimension(vector: Float32Array | number[]): boolean {
    return this.detectDimension(vector) === VECTOR_DIM;
  }

  /**
   * Convert a legacy 768D vector to 1536D
   *
   * Strategy: Zero-padding with L2 re-normalization
   * This preserves relative similarities between converted vectors
   * but may reduce similarity with native 1536D vectors.
   *
   * @param vector - Input vector (768D or 1536D)
   * @param sourceId - Optional source identifier for tracking
   * @returns Converted vector (always 1536D)
   */
  convert(
    vector: Float32Array | number[],
    sourceId?: string
  ): Float32Array {
    this.stats.totalVectorsProcessed++;

    const dim = this.detectDimension(vector);

    // Already correct dimension
    if (dim === VECTOR_DIM) {
      this.stats.nativeVectors++;
      return vector instanceof Float32Array
        ? vector
        : new Float32Array(vector);
    }

    // Unexpected dimension - not 768 or 1536
    if (dim !== LEGACY_VECTOR_DIM) {
      throw new Error(
        `Unexpected vector dimension: ${dim}. Expected ${LEGACY_VECTOR_DIM} or ${VECTOR_DIM}.`
      );
    }

    // Track conversion
    this.stats.legacyVectorsConverted++;

    // Track source
    const source = sourceId || this.options.sourceId || 'unknown';
    this.stats.unconvertedSources.add(source);

    // Emit warning
    this.maybeWarn(source);

    // Convert: zero-pad and re-normalize
    return this.zeroPadAndNormalize(vector);
  }

  /**
   * Zero-pad a 768D vector to 1536D and L2-normalize
   */
  private zeroPadAndNormalize(vector: Float32Array | number[]): Float32Array {
    const result = new Float32Array(VECTOR_DIM);

    // Copy original values
    for (let i = 0; i < LEGACY_VECTOR_DIM; i++) {
      result[i] = Array.isArray(vector) ? vector[i] : vector[i];
    }

    // Remaining values are already 0 (Float32Array initialization)

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < VECTOR_DIM; i++) {
      norm += result[i] * result[i];
    }
    norm = Math.sqrt(norm);

    if (norm > L2_NORM_TOLERANCE) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        result[i] /= norm;
      }
    }

    return result;
  }

  /**
   * Conditionally emit warning about legacy vector conversion
   */
  private maybeWarn(source: string): void {
    if (!this.options.warnOnConversion) return;
    if (this.stats.warningsEmitted >= this.options.maxWarnings) return;

    // Rate limit warnings (max 1 per second)
    const now = Date.now();
    if (this.stats.lastWarningTime && now - this.stats.lastWarningTime < 1000) {
      return;
    }

    this.stats.warningsEmitted++;
    this.stats.lastWarningTime = now;

    const conversionRate =
      this.stats.legacyVectorsConverted / this.stats.totalVectorsProcessed;

    if (conversionRate > this.options.conversionThreshold) {
      console.warn(
        `[BackwardCompat] Converting 768D -> 1536D vectors. ` +
          `Rate: ${(conversionRate * 100).toFixed(1)}%, ` +
          `Source: ${source}. ` +
          `Consider running migration script.`
      );
    }
  }

  /**
   * Batch convert multiple vectors
   */
  convertBatch(
    vectors: Array<Float32Array | number[]>,
    sourceId?: string
  ): Float32Array[] {
    return vectors.map((v) => this.convert(v, sourceId));
  }

  /**
   * Ensure a vector is in the target dimension
   * Returns the original vector if already correct, or converts if needed
   */
  ensure(
    vector: Float32Array | number[],
    sourceId?: string
  ): Float32Array {
    if (this.isNativeDimension(vector)) {
      return vector instanceof Float32Array
        ? vector
        : new Float32Array(vector);
    }
    return this.convert(vector, sourceId);
  }

  /**
   * Get statistics
   */
  getStats(): Readonly<BackwardCompatStats> {
    return {
      ...this.stats,
      unconvertedSources: new Set(this.stats.unconvertedSources),
    };
  }

  /**
   * Get a summary report
   */
  getSummary(): string {
    const stats = this.stats;
    const conversionRate = stats.totalVectorsProcessed > 0
      ? (stats.legacyVectorsConverted / stats.totalVectorsProcessed * 100).toFixed(1)
      : '0';

    return `
BackwardCompat Summary:
  Total vectors processed: ${stats.totalVectorsProcessed}
  Native (1536D): ${stats.nativeVectors}
  Converted (768D -> 1536D): ${stats.legacyVectorsConverted} (${conversionRate}%)
  Warnings emitted: ${stats.warningsEmitted}
  Unconverted sources: ${stats.unconvertedSources.size > 0
    ? Array.from(stats.unconvertedSources).join(', ')
    : 'none'}
`;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalVectorsProcessed: 0,
      legacyVectorsConverted: 0,
      nativeVectors: 0,
      warningsEmitted: 0,
      lastWarningTime: null,
      unconvertedSources: new Set(),
    };
  }

  /**
   * Check if migration is recommended based on stats
   */
  isMigrationRecommended(): boolean {
    if (this.stats.totalVectorsProcessed < 100) {
      return false; // Not enough data
    }

    const conversionRate =
      this.stats.legacyVectorsConverted / this.stats.totalVectorsProcessed;

    return conversionRate > this.options.conversionThreshold;
  }

  /**
   * Get migration recommendation message
   */
  getMigrationRecommendation(): string | null {
    if (!this.isMigrationRecommended()) {
      return null;
    }

    const sources = Array.from(this.stats.unconvertedSources);
    return `
Migration Recommended:
  ${this.stats.legacyVectorsConverted} vectors (${
    (this.stats.legacyVectorsConverted / this.stats.totalVectorsProcessed * 100).toFixed(1)
  }%) are being converted at runtime.

  Affected sources:
    ${sources.map(s => `- ${s}`).join('\n    ')}

  Run migration:
    npx tsx scripts/migration/migrate-768-to-1536.ts --dry-run
    npx tsx scripts/migration/migrate-768-to-1536.ts
`;
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let globalInstance: BackwardCompatLayer | null = null;

/**
 * Get the global backward compatibility layer instance
 */
export function getBackwardCompatLayer(
  options?: Partial<BackwardCompatOptions>
): BackwardCompatLayer {
  if (!globalInstance) {
    globalInstance = new BackwardCompatLayer(options);
  }
  return globalInstance;
}

/**
 * Reset the global instance (for testing)
 */
export function resetBackwardCompatLayer(): void {
  globalInstance = null;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Detect if a vector is legacy dimension
 */
export function isLegacyVector(vector: Float32Array | number[]): boolean {
  return (Array.isArray(vector) ? vector.length : vector.length) === LEGACY_VECTOR_DIM;
}

/**
 * Detect if a vector is current dimension
 */
export function isCurrentVector(vector: Float32Array | number[]): boolean {
  return (Array.isArray(vector) ? vector.length : vector.length) === VECTOR_DIM;
}

/**
 * Quick conversion function (uses global instance)
 */
export function ensureVectorDimension(
  vector: Float32Array | number[],
  sourceId?: string
): Float32Array {
  return getBackwardCompatLayer().ensure(vector, sourceId);
}

/**
 * Check if any vectors need conversion (uses global instance)
 */
export function checkVectorsNeedMigration(
  vectors: Array<Float32Array | number[]>
): {
  needsMigration: boolean;
  legacyCount: number;
  nativeCount: number;
} {
  let legacyCount = 0;
  let nativeCount = 0;

  for (const vector of vectors) {
    if (isLegacyVector(vector)) {
      legacyCount++;
    } else if (isCurrentVector(vector)) {
      nativeCount++;
    }
  }

  return {
    needsMigration: legacyCount > 0,
    legacyCount,
    nativeCount,
  };
}

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Type guard for legacy vectors
 */
export function assertLegacyDimension(
  vector: Float32Array | number[],
  context?: string
): void {
  const dim = Array.isArray(vector) ? vector.length : vector.length;
  if (dim !== LEGACY_VECTOR_DIM) {
    throw new Error(
      `Expected legacy dimension (${LEGACY_VECTOR_DIM}), got ${dim}${
        context ? ` in ${context}` : ''
      }`
    );
  }
}

/**
 * Type guard for current vectors
 */
export function assertCurrentDimension(
  vector: Float32Array | number[],
  context?: string
): void {
  const dim = Array.isArray(vector) ? vector.length : vector.length;
  if (dim !== VECTOR_DIM) {
    throw new Error(
      `Expected current dimension (${VECTOR_DIM}), got ${dim}${
        context ? ` in ${context}` : ''
      }`
    );
  }
}

/**
 * Type guard for either dimension (valid for migration period)
 */
export function assertValidDimension(
  vector: Float32Array | number[],
  context?: string
): void {
  const dim = Array.isArray(vector) ? vector.length : vector.length;
  if (dim !== LEGACY_VECTOR_DIM && dim !== VECTOR_DIM) {
    throw new Error(
      `Expected dimension ${LEGACY_VECTOR_DIM} or ${VECTOR_DIM}, got ${dim}${
        context ? ` in ${context}` : ''
      }`
    );
  }
}
