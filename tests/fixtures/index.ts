/**
 * Test Fixtures Index
 * ANTI-007: Centralized test data factories
 *
 * Provides reusable test data factories for all test files.
 * Import from this file instead of creating inline mock objects.
 *
 * @example
 * ```typescript
 * import { createTestAgentDefinition, createTestTrajectory } from '../../fixtures/index.js';
 *
 * const agent = createTestAgentDefinition({ key: 'coder' });
 * const trajectory = createTestTrajectory({ domain: 'code' });
 * ```
 */

// Agent fixtures
export * from './agent-fixtures.js';

// Trajectory fixtures
export * from './trajectory-fixtures.js';

// Memory fixtures
export * from './memory-fixtures.js';

// Pipeline fixtures
export * from './pipeline-fixtures.js';

// GNN fixtures
export * from './gnn-fixtures.js';

// Vector helpers (TASK-VEC-001-008)
export * from './vector-helpers.js';
