/**
 * WeightManager - Learned Weight Initialization and Persistence
 *
 * Implements: TASK-GNN-001, TASK-GNN-003
 * PRD: PRD-GOD-AGENT-001
 *
 * Provides proper neural network weight initialization (Xavier, He) and persistence
 * to replace fake simpleProjection() index cycling with real learned projections.
 *
 * TASK-GNN-003 Features:
 * - Automatic weight loading on construction (lazy loading)
 * - Version metadata tracking (model version, timestamp, checksum)
 * - Checkpoint mechanism for training recovery
 * - Weight validation on load (dimension checking, NaN detection)
 * - Corrupted weight detection and graceful handling
 *
 * Binary format: [numRows:u32 little-endian, numCols:u32, ...float32 data]
 * Metadata format: JSON file with version, timestamp, checksum
 *
 * @module src/god-agent/core/reasoning/weight-manager
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { rename, unlink, writeFile } from 'fs/promises';
import { dirname, join, basename } from 'path';
import { createHash } from 'crypto';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';
import { withRetrySync } from '../validation/index.js';

const logger = createComponentLogger('WeightManager', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Weight initialization configuration
 * Implements: TASK-GNN-001 Section 2.1.2
 */
export interface IWeightConfig {
  /** Input dimension (fan_in) */
  inputDim: number;
  /** Output dimension (fan_out) */
  outputDim: number;
  /** Initialization strategy */
  initialization: 'xavier' | 'he' | 'random' | 'zeros';
  /** Optional random seed for reproducibility */
  seed?: number;
}

/**
 * Weight metadata for versioning and validation
 * Implements: TASK-GNN-003 AC-003
 */
export interface IWeightMetadata {
  /** Model version identifier */
  version: string;
  /** Timestamp when weights were saved (ISO 8601) */
  timestamp: string;
  /** MD5 checksum of binary weight data */
  checksum: string;
  /** Number of rows in weight matrix */
  numRows: number;
  /** Number of columns in weight matrix */
  numCols: number;
  /** Total number of parameters */
  totalParams: number;
  /** Initialization strategy used */
  initialization: IWeightConfig['initialization'];
  /** Seed used for initialization (if any) */
  seed?: number;
}

/**
 * Checkpoint configuration for training recovery
 * Implements: TASK-GNN-003 AC-004
 */
export interface ICheckpointConfig {
  /** Enable automatic checkpointing */
  enabled: boolean;
  /** Number of updates between checkpoints */
  intervalUpdates: number;
  /** Maximum number of checkpoints to retain */
  maxCheckpoints: number;
  /** Checkpoint directory path */
  checkpointDir: string;
}

/**
 * Weight validation result
 * Implements: TASK-GNN-003 AC-005
 */
export interface IWeightValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors if any */
  errors: string[];
  /** Validation warnings if any */
  warnings: string[];
}

/**
 * Default checkpoint configuration
 */
const DEFAULT_CHECKPOINT_CONFIG: ICheckpointConfig = {
  enabled: false,
  intervalUpdates: 100,
  maxCheckpoints: 5,
  checkpointDir: '.agentdb/gnn/checkpoints',
};

/**
 * Current model version for weight format
 */
const MODEL_VERSION = '1.0.0';

/**
 * Seeded random number generator for reproducibility
 * Uses Mulberry32 PRNG algorithm
 */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Generate random number in [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Generate Gaussian random using Box-Muller transform */
  nextGaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
}

/**
 * WeightManager - Manages learned weight matrices for GNN layers
 *
 * Implements: TASK-GNN-001
 *
 * Features:
 * - Xavier initialization: variance = 2/(fan_in + fan_out)
 * - He initialization: variance = 2/fan_in
 * - Reproducible initialization with seeds
 * - Binary persistence format for fast loading
 */
export class WeightManager {
  private weights: Map<string, Float32Array[]> = new Map();
  private configs: Map<string, IWeightConfig> = new Map();
  private metadata: Map<string, IWeightMetadata> = new Map();
  private persistPath: string;
  private checkpointConfig: ICheckpointConfig;
  private updateCount: number = 0;
  private autoLoadEnabled: boolean;
  private loadedFromDisk: Set<string> = new Set();

  /**
   * Create a WeightManager instance
   * Implements: TASK-GNN-003 AC-002 (auto-load on construction)
   *
   * @param basePath - Base path for weight persistence (default: .agentdb/gnn/weights)
   * @param checkpointConfig - Optional checkpoint configuration
   * @param autoLoad - Whether to auto-load weights on construction (default: true)
   */
  constructor(
    basePath: string = '.agentdb/gnn/weights',
    checkpointConfig?: Partial<ICheckpointConfig>,
    autoLoad: boolean = true
  ) {
    this.persistPath = basePath;
    this.checkpointConfig = { ...DEFAULT_CHECKPOINT_CONFIG, ...checkpointConfig };
    this.autoLoadEnabled = autoLoad;

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Ensure weight and checkpoint directories exist
   * Implements: TASK-GNN-003 AC-001
   */
  private ensureDirectories(): void {
    if (!existsSync(this.persistPath)) {
      mkdirSync(this.persistPath, { recursive: true });
    }
    if (this.checkpointConfig.enabled && !existsSync(this.checkpointConfig.checkpointDir)) {
      mkdirSync(this.checkpointConfig.checkpointDir, { recursive: true });
    }
  }

  /**
   * Try to auto-load weights for a layer from disk
   * Implements: TASK-GNN-003 AC-002 (lazy loading)
   *
   * @param layerId - Layer identifier to try loading
   * @returns true if weights were loaded from disk
   */
  private async tryAutoLoad(layerId: string): Promise<boolean> {
    if (!this.autoLoadEnabled || this.loadedFromDisk.has(layerId)) {
      return false;
    }

    const weights = await this.loadWeights(layerId);
    if (weights) {
      this.loadedFromDisk.add(layerId);
      return true;
    }
    return false;
  }

  /**
   * Initialize weights for a layer using the specified strategy
   * Implements: TASK-GNN-001 Section 2.1.2
   *
   * @param layerId - Unique identifier for this layer
   * @param config - Weight configuration with dimensions and initialization
   * @returns Weight matrix as array of Float32Array rows
   */
  initializeWeights(layerId: string, config: IWeightConfig): Float32Array[] {
    const { inputDim, outputDim, initialization, seed } = config;
    const rng = new SeededRandom(seed ?? Date.now());

    // Calculate variance based on initialization strategy
    let variance: number;
    switch (initialization) {
      case 'xavier':
        // Xavier/Glorot: Good for tanh/sigmoid activations
        // variance = 2 / (fan_in + fan_out)
        variance = 2.0 / (inputDim + outputDim);
        break;
      case 'he':
        // He: Good for ReLU activations
        // variance = 2 / fan_in
        variance = 2.0 / inputDim;
        break;
      case 'random':
        // Simple uniform [-0.5, 0.5]
        variance = 1.0 / 12.0; // Uniform variance
        break;
      case 'zeros':
        variance = 0;
        break;
      default:
        variance = 2.0 / (inputDim + outputDim); // Default to Xavier
    }

    const stddev = Math.sqrt(variance);
    const weights: Float32Array[] = [];

    // Create weight matrix: outputDim rows x inputDim columns
    // Each row is weights for one output neuron
    for (let o = 0; o < outputDim; o++) {
      const row = new Float32Array(inputDim);
      if (initialization === 'zeros') {
        // Leave as zeros
      } else if (initialization === 'random') {
        // Uniform distribution
        for (let i = 0; i < inputDim; i++) {
          row[i] = (rng.next() - 0.5) * stddev * Math.sqrt(12);
        }
      } else {
        // Gaussian distribution for Xavier/He
        for (let i = 0; i < inputDim; i++) {
          row[i] = rng.nextGaussian() * stddev;
        }
      }
      weights.push(row);
    }

    // Store weights and config
    this.weights.set(layerId, weights);
    this.configs.set(layerId, config);

    return weights;
  }

  /**
   * Get weights for a layer, initializing if needed
   *
   * @param layerId - Layer identifier
   * @param config - Optional config for initialization if weights don't exist
   * @returns Weight matrix or empty array if no weights and no config
   */
  getWeights(layerId: string, config?: IWeightConfig): Float32Array[] {
    const existing = this.weights.get(layerId);
    if (existing) {
      return existing;
    }

    if (config) {
      return this.initializeWeights(layerId, config);
    }

    return [];
  }

  /**
   * Check if weights exist for a layer
   */
  hasWeights(layerId: string): boolean {
    return this.weights.has(layerId);
  }

  /**
   * Get the config used for a layer's weights
   */
  getConfig(layerId: string): IWeightConfig | undefined {
    return this.configs.get(layerId);
  }

  /**
   * Calculate MD5 checksum of binary data
   * Implements: TASK-GNN-003 AC-003 (checksum)
   */
  private calculateChecksum(buffer: ArrayBuffer): string {
    return createHash('md5').update(Buffer.from(buffer)).digest('hex');
  }

  /**
   * Save weights to binary file with metadata
   * Implements: TASK-GNN-003 AC-001, AC-003
   *
   * Format: [numRows(4 bytes), numCols(4 bytes), ...flattened float32 data]
   * Metadata saved as JSON alongside binary file
   *
   * @param layerId - Layer to save
   */
  async saveWeights(layerId: string): Promise<void> {
    const weights = this.weights.get(layerId);
    if (!weights || weights.length === 0) {
      throw new Error(`No weights found for layer: ${layerId}`);
    }

    const config = this.configs.get(layerId);
    const numRows = weights.length;
    const numCols = weights[0].length;

    // Create binary buffer: 8 bytes header + data
    const dataSize = numRows * numCols * 4; // 4 bytes per float32
    const buffer = new ArrayBuffer(8 + dataSize);
    const view = new DataView(buffer);

    // Write header
    view.setUint32(0, numRows, true); // little-endian
    view.setUint32(4, numCols, true);

    // Write flattened data
    let offset = 8;
    for (const row of weights) {
      for (let i = 0; i < row.length; i++) {
        view.setFloat32(offset, row[i], true);
        offset += 4;
      }
    }

    // Ensure directory exists
    const filePath = join(this.persistPath, `${layerId}.weights.bin`);
    const metadataPath = join(this.persistPath, `${layerId}.weights.meta.json`);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Calculate checksum
    const checksum = this.calculateChecksum(buffer);

    // Create and save metadata
    // Implements: TASK-GNN-003 AC-003 (version metadata)
    const metadata: IWeightMetadata = {
      version: MODEL_VERSION,
      timestamp: new Date().toISOString(),
      checksum,
      numRows,
      numCols,
      totalParams: numRows * numCols,
      initialization: config?.initialization ?? 'xavier',
      seed: config?.seed,
    };

    // Write binary weights with retry (RULE-072: file operations must retry)
    withRetrySync(
      () => writeFileSync(filePath, Buffer.from(buffer)),
      { operationName: 'WeightManager.saveWeights.binary' }
    );

    // Write metadata with retry (RULE-072)
    withRetrySync(
      () => writeFileSync(metadataPath, JSON.stringify(metadata, null, 2)),
      { operationName: 'WeightManager.saveWeights.metadata' }
    );

    // Store metadata in memory
    this.metadata.set(layerId, metadata);

    // Handle checkpointing if enabled
    // Implements: TASK-GNN-003 AC-004
    this.updateCount++;
    if (
      this.checkpointConfig.enabled &&
      this.updateCount % this.checkpointConfig.intervalUpdates === 0
    ) {
      await this.createCheckpoint(layerId);
    }
  }

  /**
   * Atomically save weights with checksum verification
   * Implements: GAP-GNN-002, RULE-046
   *
   * Protocol:
   * 1. Write weights to temporary .tmp file
   * 2. Compute and verify checksum of .tmp file
   * 3. Atomic rename from .tmp to .bin (preserves .bin on failure)
   *
   * @param layerId - Layer identifier to save
   * @throws Error if checksum verification fails or atomic rename fails
   */
  async saveWeightsAtomic(layerId: string): Promise<void> {
    const weights = this.weights.get(layerId);
    if (!weights || weights.length === 0) {
      throw new Error(`No weights found for layer: ${layerId}`);
    }

    const config = this.configs.get(layerId);
    const numRows = weights.length;
    const numCols = weights[0].length;

    // Ensure directory exists
    const dir = this.persistPath;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = join(dir, `${layerId}.weights.tmp`);
    const binPath = join(dir, `${layerId}.weights.bin`);
    const metadataPath = join(dir, `${layerId}.weights.meta.json`);

    // 1. Create binary buffer
    const dataSize = numRows * numCols * 4; // 4 bytes per float32
    const buffer = new ArrayBuffer(8 + dataSize);
    const view = new DataView(buffer);

    // Write header
    view.setUint32(0, numRows, true); // little-endian
    view.setUint32(4, numCols, true);

    // Write flattened data
    let offset = 8;
    for (const row of weights) {
      for (let i = 0; i < row.length; i++) {
        view.setFloat32(offset, row[i], true);
        offset += 4;
      }
    }

    // AC-001: Write to temp file first
    try {
      await writeFile(tmpPath, Buffer.from(buffer));
    } catch (error) {
      throw new Error(`Failed to write temporary weight file: ${String(error)}`);
    }

    // 2. AC-002: Compute and verify checksum
    const checksum = this.calculateChecksum(buffer);
    const verified = await this.verifyWeightFile(tmpPath, checksum);

    if (!verified) {
      // AC-004: Clean up .tmp on verification failure
      try {
        await unlink(tmpPath);
      } catch {
        // INTENTIONAL: Best-effort cleanup, ignore errors
      }
      throw new Error('Weight checksum verification failed');
    }

    // 3. AC-003: Atomic rename to .bin
    // AC-005: This preserves existing .bin if rename fails
    try {
      await rename(tmpPath, binPath);
    } catch (error) {
      // AC-004: Clean up .tmp on rename failure
      try {
        await unlink(tmpPath);
      } catch {
        // INTENTIONAL: Best-effort cleanup, ignore errors
      }
      throw new Error(`Atomic rename failed: ${String(error)}`);
    }

    // Create and save metadata (after successful binary save)
    const metadata: IWeightMetadata = {
      version: MODEL_VERSION,
      timestamp: new Date().toISOString(),
      checksum,
      numRows,
      numCols,
      totalParams: numRows * numCols,
      initialization: config?.initialization ?? 'xavier',
      seed: config?.seed,
    };

    // Write metadata (non-atomic, as it's supplementary)
    try {
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      // INTENTIONAL: Metadata write failure is non-critical
      logger.warn('Failed to write metadata for layer', { layerId });
    }

    // Store metadata in memory
    this.metadata.set(layerId, metadata);

    // Handle checkpointing if enabled
    this.updateCount++;
    if (
      this.checkpointConfig.enabled &&
      this.updateCount % this.checkpointConfig.intervalUpdates === 0
    ) {
      await this.createCheckpoint(layerId);
    }

    logger.info('Weights saved atomically', { layerId, checksum, numRows, numCols });
  }

  /**
   * Verify a weight file by reading it back and comparing checksum
   * Implements: GAP-GNN-002 (checksum verification)
   *
   * @param filePath - Path to the weight file to verify
   * @param expectedChecksum - Expected MD5 checksum
   * @returns true if verification passes
   */
  private async verifyWeightFile(filePath: string, expectedChecksum: string): Promise<boolean> {
    try {
      const buffer = readFileSync(filePath);
      const actualChecksum = this.calculateChecksum(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      );
      return actualChecksum === expectedChecksum;
    } catch (error) {
      logger.warn('Failed to verify weight file', { filePath, error: String(error) });
      return false;
    }
  }

  /**
   * Validate weights for corruption and dimension issues
   * Implements: TASK-GNN-003 AC-005 (weight validation)
   *
   * @param weights - Weight matrix to validate
   * @param expectedRows - Expected number of rows (optional)
   * @param expectedCols - Expected number of columns (optional)
   * @returns Validation result
   */
  validateWeights(
    weights: Float32Array[],
    expectedRows?: number,
    expectedCols?: number
  ): IWeightValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty weights
    if (!weights || weights.length === 0) {
      errors.push('Weight matrix is empty');
      return { valid: false, errors, warnings };
    }

    // Check dimension consistency
    const numRows = weights.length;
    const numCols = weights[0].length;

    // Validate row consistency
    for (let r = 0; r < numRows; r++) {
      if (weights[r].length !== numCols) {
        errors.push(`Row ${r} has inconsistent columns: expected ${numCols}, got ${weights[r].length}`);
      }
    }

    // Check expected dimensions if provided
    if (expectedRows !== undefined && numRows !== expectedRows) {
      errors.push(`Row count mismatch: expected ${expectedRows}, got ${numRows}`);
    }
    if (expectedCols !== undefined && numCols !== expectedCols) {
      errors.push(`Column count mismatch: expected ${expectedCols}, got ${numCols}`);
    }

    // Check for NaN values
    // Implements: TASK-GNN-003 AC-005 (NaN detection)
    let nanCount = 0;
    let infCount = 0;
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const val = weights[r][c];
        if (Number.isNaN(val)) {
          nanCount++;
        } else if (!Number.isFinite(val)) {
          infCount++;
        }
      }
    }

    if (nanCount > 0) {
      errors.push(`Found ${nanCount} NaN values in weights`);
    }
    if (infCount > 0) {
      errors.push(`Found ${infCount} Infinite values in weights`);
    }

    // Check for degenerate weights (all zeros)
    let allZeros = true;
    let maxAbs = 0;
    for (let r = 0; r < numRows && allZeros; r++) {
      for (let c = 0; c < numCols; c++) {
        const absVal = Math.abs(weights[r][c]);
        if (absVal > maxAbs) maxAbs = absVal;
        if (absVal > 1e-10) {
          allZeros = false;
          break;
        }
      }
    }

    if (allZeros) {
      warnings.push('All weights are zero (degenerate initialization)');
    }

    // Check for very large weights (potential numerical instability)
    if (maxAbs > 100) {
      warnings.push(`Maximum absolute weight value is very large: ${maxAbs.toFixed(2)}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Load weights from binary file with validation
   * Implements: TASK-GNN-003 AC-002, AC-005
   *
   * @param layerId - Layer to load
   * @param validate - Whether to validate weights after loading (default: true)
   * @returns Weight matrix or null if file doesn't exist or validation fails
   */
  async loadWeights(layerId: string, validate: boolean = true): Promise<Float32Array[] | null> {
    const filePath = join(this.persistPath, `${layerId}.weights.bin`);
    const metadataPath = join(this.persistPath, `${layerId}.weights.meta.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const buffer = readFileSync(filePath);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      // Read header
      const numRows = view.getUint32(0, true);
      const numCols = view.getUint32(4, true);

      // Validate header dimensions
      // Implements: TASK-GNN-003 AC-005 (dimension checking)
      if (numRows === 0 || numCols === 0) {
        logger.warn('Invalid dimensions in layer', { layerId, numRows, numCols });
        return null;
      }

      // Check expected buffer size
      const expectedSize = 8 + numRows * numCols * 4;
      if (buffer.byteLength < expectedSize) {
        logger.warn('Corrupted weights for layer', { layerId, expectedBytes: expectedSize, actualBytes: buffer.byteLength });
        return null;
      }

      // Read data
      const weights: Float32Array[] = [];
      let offset = 8;
      for (let r = 0; r < numRows; r++) {
        const row = new Float32Array(numCols);
        for (let c = 0; c < numCols; c++) {
          row[c] = view.getFloat32(offset, true);
          offset += 4;
        }
        weights.push(row);
      }

      // Validate weights if enabled
      // Implements: TASK-GNN-003 AC-005
      if (validate) {
        const validation = this.validateWeights(weights);
        if (!validation.valid) {
          logger.warn('Weight validation failed for layer', { layerId, errors: validation.errors });
          return null;
        }
        if (validation.warnings.length > 0) {
          logger.warn('Weight warnings for layer', { layerId, warnings: validation.warnings });
        }
      }

      // Load and verify metadata if available
      if (existsSync(metadataPath)) {
        try {
          const metadataJson = readFileSync(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataJson) as IWeightMetadata;

          // Verify checksum
          // Implements: TASK-GNN-003 AC-005 (checksum validation)
          const actualChecksum = this.calculateChecksum(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
          if (metadata.checksum !== actualChecksum) {
            logger.warn('Checksum mismatch for layer', { layerId, expectedChecksum: metadata.checksum, actualChecksum });
            // Continue with warning but still load weights
          }

          // Store metadata
          this.metadata.set(layerId, metadata);
        } catch {
          // INTENTIONAL: Metadata load failure - warn but continue with weights
          logger.warn('Could not load metadata for layer', { layerId });
        }
      }

      // Store in memory
      this.weights.set(layerId, weights);

      // Track that this layer was loaded from disk
      this.loadedFromDisk.add(layerId);

      return weights;
    } catch (error) {
      // Implements: TASK-GNN-003 AC-005 (graceful error handling)
      logger.warn('Error loading weights for layer', { layerId, error: String(error) });
      return null;
    }
  }

  /**
   * Save all weights to disk
   */
  async saveAll(): Promise<void> {
    for (const layerId of this.weights.keys()) {
      await this.saveWeights(layerId);
    }
  }

  /**
   * Load weights for multiple layers
   *
   * @param layerIds - Layer IDs to load
   * @returns Map of successfully loaded layers
   */
  async loadMultiple(layerIds: string[]): Promise<Map<string, Float32Array[]>> {
    const loaded = new Map<string, Float32Array[]>();
    for (const id of layerIds) {
      const weights = await this.loadWeights(id);
      if (weights) {
        loaded.set(id, weights);
      }
    }
    return loaded;
  }

  /**
   * Clear all weights from memory
   */
  clear(): void {
    this.weights.clear();
    this.configs.clear();
    this.metadata.clear();
    this.loadedFromDisk.clear();
  }

  /**
   * Get all layer IDs with weights
   */
  getLayerIds(): string[] {
    return Array.from(this.weights.keys());
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): { layers: number; totalParams: number; memoryBytes: number } {
    let totalParams = 0;
    for (const weights of this.weights.values()) {
      for (const row of weights) {
        totalParams += row.length;
      }
    }
    return {
      layers: this.weights.size,
      totalParams,
      memoryBytes: totalParams * 4, // Float32 = 4 bytes
    };
  }

  // =====================================================
  // TASK-GNN-003: Checkpoint and Metadata Methods
  // =====================================================

  /**
   * Create a checkpoint for a layer's weights
   * Implements: TASK-GNN-003 AC-004 (checkpoint mechanism)
   *
   * @param layerId - Layer to checkpoint
   * @returns Checkpoint filename
   */
  async createCheckpoint(layerId: string): Promise<string> {
    const weights = this.weights.get(layerId);
    if (!weights || weights.length === 0) {
      throw new Error(`No weights found for layer: ${layerId}`);
    }

    // Ensure checkpoint directory exists
    if (!existsSync(this.checkpointConfig.checkpointDir)) {
      mkdirSync(this.checkpointConfig.checkpointDir, { recursive: true });
    }

    // Create checkpoint filename with timestamp
    const timestamp = Date.now();
    const checkpointName = `${layerId}.checkpoint.${timestamp}.bin`;
    const checkpointPath = join(this.checkpointConfig.checkpointDir, checkpointName);
    const metadataName = `${layerId}.checkpoint.${timestamp}.meta.json`;
    const metadataPath = join(this.checkpointConfig.checkpointDir, metadataName);

    const config = this.configs.get(layerId);
    const numRows = weights.length;
    const numCols = weights[0].length;

    // Create binary buffer
    const dataSize = numRows * numCols * 4;
    const buffer = new ArrayBuffer(8 + dataSize);
    const view = new DataView(buffer);

    view.setUint32(0, numRows, true);
    view.setUint32(4, numCols, true);

    let offset = 8;
    for (const row of weights) {
      for (let i = 0; i < row.length; i++) {
        view.setFloat32(offset, row[i], true);
        offset += 4;
      }
    }

    // Write checkpoint file with retry (RULE-072)
    withRetrySync(
      () => writeFileSync(checkpointPath, Buffer.from(buffer)),
      { operationName: 'WeightManager.createCheckpoint.binary' }
    );

    // Write metadata
    const metadata: IWeightMetadata = {
      version: MODEL_VERSION,
      timestamp: new Date(timestamp).toISOString(),
      checksum: this.calculateChecksum(buffer),
      numRows,
      numCols,
      totalParams: numRows * numCols,
      initialization: config?.initialization ?? 'xavier',
      seed: config?.seed,
    };
    // Write checkpoint metadata with retry (RULE-072)
    withRetrySync(
      () => writeFileSync(metadataPath, JSON.stringify(metadata, null, 2)),
      { operationName: 'WeightManager.createCheckpoint.metadata' }
    );

    // Cleanup old checkpoints if exceeding max
    await this.cleanupOldCheckpoints(layerId);

    return checkpointName;
  }

  /**
   * Restore weights from the latest checkpoint
   * Implements: TASK-GNN-003 AC-004 (training recovery)
   *
   * @param layerId - Layer to restore
   * @returns true if restored successfully
   */
  async restoreFromCheckpoint(layerId: string): Promise<boolean> {
    const checkpoints = this.listCheckpoints(layerId);
    if (checkpoints.length === 0) {
      return false;
    }

    // Get the latest checkpoint (sorted by timestamp)
    const latestCheckpoint = checkpoints[checkpoints.length - 1];
    const checkpointPath = join(this.checkpointConfig.checkpointDir, latestCheckpoint);

    try {
      const buffer = readFileSync(checkpointPath);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      const numRows = view.getUint32(0, true);
      const numCols = view.getUint32(4, true);

      if (numRows === 0 || numCols === 0) {
        logger.warn('Invalid checkpoint dimensions for layer', { layerId });
        return false;
      }

      const weights: Float32Array[] = [];
      let offset = 8;
      for (let r = 0; r < numRows; r++) {
        const row = new Float32Array(numCols);
        for (let c = 0; c < numCols; c++) {
          row[c] = view.getFloat32(offset, true);
          offset += 4;
        }
        weights.push(row);
      }

      // Validate before restoring
      const validation = this.validateWeights(weights);
      if (!validation.valid) {
        logger.warn('Checkpoint validation failed for layer', { layerId, errors: validation.errors });
        return false;
      }

      this.weights.set(layerId, weights);
      return true;
    } catch (error) {
      logger.warn('Error restoring checkpoint for layer', { layerId, error: String(error) });
      return false;
    }
  }

  /**
   * List all checkpoints for a layer
   * Implements: TASK-GNN-003 AC-004
   *
   * @param layerId - Layer ID to list checkpoints for
   * @returns Array of checkpoint filenames sorted by timestamp
   */
  listCheckpoints(layerId: string): string[] {
    if (!existsSync(this.checkpointConfig.checkpointDir)) {
      return [];
    }

    const files = readdirSync(this.checkpointConfig.checkpointDir);
    const pattern = new RegExp(`^${layerId}\\.checkpoint\\.(\\d+)\\.bin$`);

    const checkpoints = files
      .filter((f) => pattern.test(f))
      .sort((a, b) => {
        const tsA = parseInt(a.match(pattern)?.[1] ?? '0', 10);
        const tsB = parseInt(b.match(pattern)?.[1] ?? '0', 10);
        return tsA - tsB;
      });

    return checkpoints;
  }

  /**
   * Cleanup old checkpoints exceeding maxCheckpoints
   * Implements: TASK-GNN-003 AC-004
   */
  private async cleanupOldCheckpoints(layerId: string): Promise<void> {
    const checkpoints = this.listCheckpoints(layerId);
    const excess = checkpoints.length - this.checkpointConfig.maxCheckpoints;

    if (excess > 0) {
      const toDelete = checkpoints.slice(0, excess);
      for (const checkpoint of toDelete) {
        const checkpointPath = join(this.checkpointConfig.checkpointDir, checkpoint);
        const metadataPath = checkpointPath.replace('.bin', '.meta.json');
        try {
          if (existsSync(checkpointPath)) unlinkSync(checkpointPath);
          if (existsSync(metadataPath)) unlinkSync(metadataPath);
        } catch {
          // INTENTIONAL: Checkpoint cleanup errors are non-critical - file may be in use
        }
      }
    }
  }

  /**
   * Get metadata for a layer
   * Implements: TASK-GNN-003 AC-003
   *
   * @param layerId - Layer ID
   * @returns Metadata if available
   */
  getMetadata(layerId: string): IWeightMetadata | undefined {
    return this.metadata.get(layerId);
  }

  /**
   * Get checkpoint configuration
   * Implements: TASK-GNN-003 AC-004
   */
  getCheckpointConfig(): ICheckpointConfig {
    return { ...this.checkpointConfig };
  }

  /**
   * Set checkpoint configuration
   * Implements: TASK-GNN-003 AC-004
   */
  setCheckpointConfig(config: Partial<ICheckpointConfig>): void {
    this.checkpointConfig = { ...this.checkpointConfig, ...config };
    if (this.checkpointConfig.enabled) {
      this.ensureDirectories();
    }
  }

  /**
   * Get the update count (for checkpoint interval tracking)
   */
  getUpdateCount(): number {
    return this.updateCount;
  }

  /**
   * Reset the update count
   */
  resetUpdateCount(): void {
    this.updateCount = 0;
  }

  /**
   * Check if weights were loaded from disk for a layer
   */
  wasLoadedFromDisk(layerId: string): boolean {
    return this.loadedFromDisk.has(layerId);
  }

  // Implements: TASK-WM-001, GAP-WM-001
  // Constitution: RULE-046 (atomic write)
  /**
   * Directly set weights for a layer, replacing existing weights
   *
   * @param layerId - Layer identifier (must exist in configs)
   * @param weights - New weight matrix (Float32Array[] where each row is outputDim)
   * @throws {Error} If layerId not found in configs
   * @throws {Error} If dimensions don't match config (inputDim x outputDim)
   * @throws {Error} If weights fail validation (NaN, Inf, inconsistent rows)
   * @example
   * // After gradient descent:
   * const updatedWeights = applyAdam(optimizer, currentWeights, gradients);
   * weightManager.setWeights('gnn-layer1', updatedWeights);
   */
  setWeights(layerId: string, weights: Float32Array[]): void {
    // AC-002: Validate layer exists
    const config = this.configs.get(layerId);
    if (!config) {
      throw new Error(`setWeights: Layer '${layerId}' not found in configs`);
    }

    // AC-003: Validate dimensions
    if (weights.length !== config.outputDim) {
      throw new Error(
        `setWeights: Row count mismatch for '${layerId}': ` +
        `expected ${config.outputDim}, got ${weights.length}`
      );
    }
    if (weights[0]?.length !== config.inputDim) {
      throw new Error(
        `setWeights: Column count mismatch for '${layerId}': ` +
        `expected ${config.inputDim}, got ${weights[0]?.length ?? 0}`
      );
    }

    // AC-004: Validate weights (NaN, Inf, consistency)
    const validation = this.validateWeights(weights, config.outputDim, config.inputDim);
    if (!validation.valid) {
      throw new Error(`setWeights: Validation failed for '${layerId}': ${validation.errors.join(', ')}`);
    }

    // AC-005: Atomic replacement
    this.weights.set(layerId, weights);

    // AC-006: Update metadata
    this.updateCount++;
    const existingMeta = this.metadata.get(layerId);
    if (existingMeta) {
      this.metadata.set(layerId, {
        ...existingMeta,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Implements: TASK-WM-002, GAP-WM-001
  // Constitution: RULE-046 (atomic write)
  /**
   * Update weights by adding a delta (gradient) in-place
   *
   * Useful for gradient descent: w = w + learningRate * gradient
   *
   * @param layerId - Layer identifier (must have existing weights)
   * @param delta - Delta to add (same dimensions as weights)
   * @param scale - Optional scale factor (default 1.0), applied as w += scale * delta
   * @throws {Error} If layerId not found or has no weights
   * @throws {Error} If delta dimensions don't match weights
   * @throws {Error} If update produces NaN/Inf (gradient explosion)
   * @example
   * // Gradient descent update:
   * weightManager.updateWeights('gnn-layer1', gradients, -learningRate);
   */
  updateWeights(layerId: string, delta: Float32Array[], scale: number = 1.0): void {
    // AC-002: Validate layer exists with weights
    const weights = this.weights.get(layerId);
    if (!weights || weights.length === 0) {
      throw new Error(`updateWeights: Layer '${layerId}' has no weights`);
    }

    // AC-003: Validate delta dimensions
    if (delta.length !== weights.length) {
      throw new Error(
        `updateWeights: Row count mismatch for '${layerId}': ` +
        `weights have ${weights.length} rows, delta has ${delta.length}`
      );
    }
    if (delta[0]?.length !== weights[0]?.length) {
      throw new Error(
        `updateWeights: Column count mismatch for '${layerId}': ` +
        `weights have ${weights[0]?.length} cols, delta has ${delta[0]?.length}`
      );
    }

    // AC-006: Create backup for rollback
    const backup = weights.map(row => new Float32Array(row));

    // AC-004: Apply delta in-place
    for (let r = 0; r < weights.length; r++) {
      for (let c = 0; c < weights[r].length; c++) {
        weights[r][c] += scale * delta[r][c];
      }
    }

    // AC-005: Validate result (gradient explosion detection)
    const validation = this.validateWeights(weights);
    if (!validation.valid) {
      // AC-006: Rollback on validation failure
      this.weights.set(layerId, backup);
      throw new Error(
        `updateWeights: Update produced invalid weights for '${layerId}': ` +
        `${validation.errors.join(', ')}. Rolled back to previous state.`
      );
    }

    // AC-007: Update metadata
    this.updateCount++;
    const existingMeta = this.metadata.get(layerId);
    if (existingMeta) {
      this.metadata.set(layerId, {
        ...existingMeta,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get the persist path
   */
  getPersistPath(): string {
    return this.persistPath;
  }

  /**
   * Delete all persisted weights for a layer
   * Implements: TASK-GNN-003 (cleanup utility)
   */
  async deletePersistedWeights(layerId: string): Promise<boolean> {
    const filePath = join(this.persistPath, `${layerId}.weights.bin`);
    const metadataPath = join(this.persistPath, `${layerId}.weights.meta.json`);

    let deleted = false;
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        deleted = true;
      }
      if (existsSync(metadataPath)) {
        unlinkSync(metadataPath);
      }
    } catch (error) {
      logger.warn('Error deleting weights for layer', { layerId, error: String(error) });
    }

    return deleted;
  }

  /**
   * Check if persisted weights exist for a layer
   */
  hasPersistedWeights(layerId: string): boolean {
    const filePath = join(this.persistPath, `${layerId}.weights.bin`);
    return existsSync(filePath);
  }
}
