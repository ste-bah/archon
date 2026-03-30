/**
 * Trajectory Test Fixtures
 * ANTI-007: Centralized trajectory test data factories
 * TASK-VEC-001-008: Updated to use VECTOR_DIM (1536D)
 *
 * Provides factory functions for creating test trajectory data.
 */

import type {
  ITrajectory,
  TrajectoryID,
  PatternID,
} from '../../src/god-agent/core/learning/sona-types.js';
import { VECTOR_DIM } from '../../src/god-agent/core/validation/constants.js';

// Define TrajectoryStep locally since it may not be exported
interface TrajectoryStep {
  input: string;
  action: string;
  output: string;
  reasoning?: string;
  confidence: number;
  timestamp: number;
}

// ==================== Trajectory Step Fixtures ====================

/**
 * Default trajectory step values
 */
const DEFAULT_TRAJECTORY_STEP: TrajectoryStep = {
  input: 'Test input',
  action: 'test_action',
  output: 'Test output',
  reasoning: 'Test reasoning',
  confidence: 0.85,
  timestamp: Date.now(),
};

/**
 * Create a test trajectory step with optional overrides
 */
export function createTestTrajectoryStep(
  overrides?: Partial<TrajectoryStep>
): TrajectoryStep {
  return {
    ...DEFAULT_TRAJECTORY_STEP,
    ...overrides,
    timestamp: overrides?.timestamp ?? Date.now(),
  };
}

/**
 * Create multiple test trajectory steps
 */
export function createTestTrajectorySteps(
  count: number,
  baseOverrides?: Partial<TrajectoryStep>
): TrajectoryStep[] {
  return Array.from({ length: count }, (_, i) =>
    createTestTrajectoryStep({
      ...baseOverrides,
      input: baseOverrides?.input ?? `Test input ${i + 1}`,
      output: baseOverrides?.output ?? `Test output ${i + 1}`,
      timestamp: Date.now() + i * 1000,
    })
  );
}

// ==================== Trajectory Fixtures ====================

/**
 * Generate a test trajectory ID
 */
export function createTestTrajectoryId(suffix?: string): TrajectoryID {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `trj_test_${timestamp}_${random}${suffix ? `_${suffix}` : ''}` as TrajectoryID;
}

/**
 * Default trajectory values
 */
const DEFAULT_TRAJECTORY: ITrajectory = {
  id: 'trj_test_default' as TrajectoryID,
  domain: 'test',
  task: 'Test task',
  steps: [],
  outcome: 'success',
  quality: 0.9,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Create a test trajectory with optional overrides
 */
export function createTestTrajectory(
  overrides?: Partial<ITrajectory> & {
    stepCount?: number;
    stepOverrides?: Partial<TrajectoryStep>;
  }
): ITrajectory {
  const { stepCount, stepOverrides, ...rest } = overrides ?? {};

  const now = Date.now();
  const steps =
    rest.steps ??
    (stepCount !== undefined
      ? createTestTrajectorySteps(stepCount, stepOverrides)
      : [createTestTrajectoryStep(stepOverrides)]);

  return {
    ...DEFAULT_TRAJECTORY,
    ...rest,
    id: rest.id ?? createTestTrajectoryId(),
    steps,
    createdAt: rest.createdAt ?? now,
    updatedAt: rest.updatedAt ?? now,
  };
}

// ==================== Pattern Fixtures ====================

/**
 * Generate a test pattern ID
 */
export function createTestPatternId(suffix?: string): PatternID {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `pat_test_${timestamp}_${random}${suffix ? `_${suffix}` : ''}` as PatternID;
}

/**
 * Pre-built trajectories for common test scenarios
 */
export const TEST_TRAJECTORIES = {
  /**
   * Simple successful trajectory with 3 steps
   */
  simpleSuccess: () =>
    createTestTrajectory({
      domain: 'code',
      task: 'Implement feature',
      stepCount: 3,
      outcome: 'success',
      quality: 0.95,
    }),

  /**
   * Failed trajectory with error
   */
  simpleFailed: () =>
    createTestTrajectory({
      domain: 'code',
      task: 'Implement feature',
      stepCount: 2,
      outcome: 'failure',
      quality: 0.3,
      stepOverrides: {
        confidence: 0.4,
      },
    }),

  /**
   * Research trajectory with multiple steps
   */
  research: () =>
    createTestTrajectory({
      domain: 'research',
      task: 'Research topic',
      stepCount: 5,
      outcome: 'success',
      quality: 0.88,
    }),

  /**
   * Empty trajectory (no steps yet)
   */
  empty: () =>
    createTestTrajectory({
      domain: 'test',
      task: 'Pending task',
      steps: [],
      outcome: 'pending',
      quality: 0,
    }),
};

// ==================== Embedding Fixtures ====================

/**
 * Create a test embedding vector
 * TASK-VEC-001-008: Updated default dimension to VECTOR_DIM (1536)
 */
export function createTestEmbedding(
  dimension: number = VECTOR_DIM,
  options?: {
    normalized?: boolean;
    seed?: number;
  }
): Float32Array {
  const { normalized = true, seed = 42 } = options ?? {};

  // Seeded pseudo-random for reproducibility
  let current = seed;
  const random = () => {
    current = (current * 1103515245 + 12345) & 0x7fffffff;
    return current / 0x7fffffff;
  };

  const embedding = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    embedding[i] = random() * 2 - 1; // Range [-1, 1]
  }

  if (normalized) {
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < dimension; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < dimension; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

/**
 * Create multiple test embeddings
 * TASK-VEC-001-008: Updated default dimension to VECTOR_DIM (1536)
 */
export function createTestEmbeddings(
  count: number,
  dimension: number = VECTOR_DIM
): Float32Array[] {
  return Array.from({ length: count }, (_, i) =>
    createTestEmbedding(dimension, { seed: 42 + i })
  );
}
