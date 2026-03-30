/**
 * Sona Engine Utilities
 * TASK-SON-001 - ID Generation and Validation
 *
 * Provides utility functions for trajectory management and validation.
 */

import { randomBytes } from 'crypto';
import type {
  TrajectoryID,
  PatternID,
  Route,
  Weight,
  ITrajectoryInput,
  ISonaConfig,
} from './sona-types.js';
import { TrajectoryValidationError } from './sona-types.js';

// ==================== Constants ====================

/** Default learning rate */
export const DEFAULT_LEARNING_RATE = 0.01;

/** Default EWC++ regularization strength */
export const DEFAULT_REGULARIZATION = 0.1;

/** Default drift alert threshold */
export const DEFAULT_DRIFT_ALERT_THRESHOLD = 0.3;

/** Default drift reject threshold */
export const DEFAULT_DRIFT_REJECT_THRESHOLD = 0.5;

/** Default auto-save interval (ms) */
export const DEFAULT_AUTO_SAVE_INTERVAL = 100;

/** Default maximum checkpoints to keep */
export const DEFAULT_MAX_CHECKPOINTS = 10;

/** Default initial weight for new patterns */
export const DEFAULT_INITIAL_WEIGHT = 0.0;

/** Weight minimum value */
export const WEIGHT_MIN = -1.0;

/** Weight maximum value */
export const WEIGHT_MAX = 1.0;

// ==================== ID Generation ====================

/**
 * Generate a unique TrajectoryID
 * Format: "traj-{timestamp}-{random8hex}"
 */
export function generateTrajectoryID(): TrajectoryID {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `traj-${timestamp}-${random}`;
}

/**
 * Validate TrajectoryID format
 */
export function isValidTrajectoryID(id: string): boolean {
  return /^traj-\d+-[a-f0-9]{8}$/.test(id);
}

/**
 * Generate a unique checkpoint ID
 * Format: "ckpt-{timestamp}-{random8hex}"
 */
export function generateCheckpointID(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `ckpt-${timestamp}-${random}`;
}

/**
 * Validate checkpoint ID format
 */
export function isValidCheckpointID(id: string): boolean {
  return /^ckpt-\d+-[a-f0-9]{8}$/.test(id);
}

// ==================== Validation ====================

/**
 * Validate route string
 * @throws TrajectoryValidationError if invalid
 */
export function validateRoute(route: Route): void {
  if (!route || typeof route !== 'string') {
    throw new TrajectoryValidationError('Trajectory route required');
  }
  if (route.trim().length === 0) {
    throw new TrajectoryValidationError('Trajectory route cannot be empty');
  }
}

/**
 * Validate trajectory input
 * @throws TrajectoryValidationError if validation fails
 */
export function validateTrajectoryInput(input: ITrajectoryInput): void {
  validateRoute(input.route);

  // patterns can be empty (graceful handling)
  if (!Array.isArray(input.patterns)) {
    throw new TrajectoryValidationError('Trajectory patterns must be an array');
  }

  // context can be empty (optional)
  if (!Array.isArray(input.context)) {
    throw new TrajectoryValidationError('Trajectory context must be an array');
  }
}

/**
 * Validate quality score
 * @throws TrajectoryValidationError if invalid
 */
export function validateQuality(quality: number): void {
  if (typeof quality !== 'number' || isNaN(quality)) {
    throw new TrajectoryValidationError('Quality must be a valid number');
  }
  if (quality < 0.0 || quality > 1.0) {
    throw new TrajectoryValidationError(
      `Quality ${quality} out of range [0.0, 1.0]`
    );
  }
}

/**
 * Validate learning rate
 * @throws TrajectoryValidationError if invalid
 */
export function validateLearningRate(rate: number): void {
  if (rate < 0.001 || rate > 0.1) {
    throw new TrajectoryValidationError(
      `Learning rate ${rate} out of range [0.001, 0.1]`
    );
  }
}

/**
 * Validate regularization strength
 * @throws TrajectoryValidationError if invalid
 */
export function validateRegularization(lambda: number): void {
  if (lambda < 0.01 || lambda > 1.0) {
    throw new TrajectoryValidationError(
      `Regularization ${lambda} out of range [0.01, 1.0]`
    );
  }
}

/**
 * Validate Sona configuration
 * @returns Validated config with defaults applied
 */
/**
 * Configuration type with databaseConnection optional (not Required)
 * TASK-PERSIST-004: Database connection is optional in config
 */
export type ValidatedSonaConfig = Omit<Required<ISonaConfig>, 'databaseConnection'> &
  Pick<ISonaConfig, 'databaseConnection'>;

export function validateAndApplyConfig(config: ISonaConfig = {}): ValidatedSonaConfig {
  const validated: ValidatedSonaConfig = {
    learningRate: config.learningRate ?? DEFAULT_LEARNING_RATE,
    regularization: config.regularization ?? DEFAULT_REGULARIZATION,
    driftAlertThreshold: config.driftAlertThreshold ?? DEFAULT_DRIFT_ALERT_THRESHOLD,
    driftRejectThreshold: config.driftRejectThreshold ?? DEFAULT_DRIFT_REJECT_THRESHOLD,
    autoSaveInterval: config.autoSaveInterval ?? DEFAULT_AUTO_SAVE_INTERVAL,
    trackPerformance: config.trackPerformance ?? false,
    maxCheckpoints: config.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS,
    checkpointsDir: config.checkpointsDir ?? '.agentdb/universal/checkpoints',
    databaseConnection: config.databaseConnection, // TASK-PERSIST-004: Optional
  };

  // Validate ranges
  if (validated.learningRate < 0.001 || validated.learningRate > 0.1) {
    throw new TrajectoryValidationError(
      `Learning rate ${validated.learningRate} out of range [0.001, 0.1]`
    );
  }
  if (validated.regularization < 0.01 || validated.regularization > 1.0) {
    throw new TrajectoryValidationError(
      `Regularization ${validated.regularization} out of range [0.01, 1.0]`
    );
  }
  if (validated.driftAlertThreshold <= 0 || validated.driftAlertThreshold >= 1) {
    throw new TrajectoryValidationError(
      `Drift alert threshold ${validated.driftAlertThreshold} out of range (0, 1)`
    );
  }
  if (validated.driftRejectThreshold <= validated.driftAlertThreshold) {
    throw new TrajectoryValidationError(
      `Drift reject threshold ${validated.driftRejectThreshold} must be greater than alert threshold ${validated.driftAlertThreshold}`
    );
  }

  return validated;
}

// ==================== Weight Operations ====================

/**
 * Clamp weight to valid range [-1, 1]
 */
export function clampWeight(weight: Weight): Weight {
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weight));
}

/**
 * Check if weight is valid (not NaN, within range)
 */
export function isValidWeight(weight: Weight): boolean {
  return !isNaN(weight) && isFinite(weight) && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX;
}

/**
 * Calculate cosine similarity between two weight vectors
 * Returns value in [-1, 1] range
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length for cosine similarity');
  }
  if (a.length === 0) {
    return 1.0; // Empty vectors are identical
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 1.0; // Zero vectors considered identical
  }

  return dotProduct / magnitude;
}

/**
 * Calculate drift score (1 - cosine similarity)
 * Returns value in [0, 2] range (0 = identical, 2 = opposite)
 */
export function calculateDrift(current: Float32Array, baseline: Float32Array): number {
  const similarity = cosineSimilarity(current, baseline);
  return 1 - similarity;
}

// ==================== Statistics ====================

/**
 * Calculate arithmetic mean of an array
 */
export function arithmeticMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate standard deviation
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = arithmeticMean(values);
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  return Math.sqrt(arithmeticMean(squaredDiffs));
}

// ==================== Weight Update Formula ====================

/**
 * Calculate reward from trajectory quality and L-Score
 * reward = quality × lScore × trajectorySuccessRate
 */
export function calculateReward(
  quality: number,
  lScore: number,
  trajectorySuccessRate: number
): number {
  return quality * lScore * trajectorySuccessRate;
}

/**
 * Calculate gradient for weight update
 * gradient = (reward - 0.5) × similarity
 */
export function calculateGradient(reward: number, similarity: number): number {
  return (reward - 0.5) * similarity;
}

/**
 * Calculate EWC++ regularized weight update
 * weightChange = α × gradient / (1 + λ × importance)
 */
export function calculateWeightUpdate(
  gradient: number,
  learningRate: number,
  regularization: number,
  importance: number
): number {
  const denominator = 1 + regularization * importance;
  return learningRate * gradient / denominator;
}

// ==================== CRC32 for Binary Serialization (TASK-SON-002) ====================

/**
 * CRC32 lookup table
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

/**
 * Calculate CRC32 checksum for a buffer
 */
export function crc32(buffer: Buffer | Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Update Fisher Information using exponential moving average
 * newImportance = decay × oldImportance + (1 - decay) × gradient²
 */
export function updateFisherInformation(
  currentImportance: number,
  gradient: number,
  decay: number = 0.9
): number {
  return decay * currentImportance + (1 - decay) * (gradient * gradient);
}

/**
 * Calculate trajectory success rate (historical average quality for route)
 */
export function calculateSuccessRate(
  qualityScores: number[],
  defaultRate: number = 0.5
): number {
  if (qualityScores.length === 0) {
    return defaultRate;
  }
  return arithmeticMean(qualityScores);
}

/**
 * Validate feedback quality score
 * @throws TrajectoryValidationError if invalid
 */
export function validateFeedbackQuality(quality: number): void {
  if (typeof quality !== 'number' || isNaN(quality)) {
    throw new TrajectoryValidationError('Feedback quality must be a valid number');
  }
  if (quality < 0.0 || quality > 1.0) {
    throw new TrajectoryValidationError(
      `Feedback quality ${quality} out of range [0.0, 1.0]`
    );
  }
}

/**
 * Default Fisher Information for new patterns
 */
export const DEFAULT_FISHER_INFORMATION = 0.1;

/**
 * Fisher Information decay rate for EMA
 */
export const FISHER_DECAY_RATE = 0.9;

/**
 * Auto-save throttle interval in ms
 */
export const AUTO_SAVE_THROTTLE_MS = 100;

/**
 * Quality threshold for auto-creating patterns
 */
export const AUTO_PATTERN_QUALITY_THRESHOLD = 0.8;

/**
 * Binary weight file version
 */
export const WEIGHT_FILE_VERSION = 1;
