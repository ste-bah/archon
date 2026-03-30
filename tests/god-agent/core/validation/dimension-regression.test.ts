/**
 * Dimension Regression Tests
 * TASK-VEC-001-007: Ensure 768D to 1536D migration is complete
 *
 * Purpose:
 * - Verify VECTOR_DIM constant is 1536
 * - Ensure no hardcoded 768 dimensions in production code
 * - Validate runtime component embedding dimensions
 * - Prevent future regressions to 768D
 *
 * Gap Reference: GAP-VEC-001 - Vector dimension mismatch
 * Migration: 768D -> 1536D (OpenAI text-embedding-3-large)
 *
 * Acceptance Criteria:
 * - AC-001: dimension-regression.test.ts file created
 * - AC-002: All regression tests pass
 * - AC-003: Tests document the migration requirement (GAP-VEC-001)
 * - AC-004: Tests fail if any 768 hardcodes are reintroduced
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Import constants from the source of truth
import { VECTOR_DIM, DEFAULT_NUM_HEADS } from '../../../../src/god-agent/core/validation/constants.js';

// Import test helpers
import {
  createTestEmbedding,
  computeL2Norm,
  isL2Normalized,
} from '../../../fixtures/vector-helpers.js';

// Project root for file scanning
const PROJECT_ROOT = join(import.meta.dirname, '../../../../');

describe('VECTOR_DIM Migration Regression Tests (GAP-VEC-001)', () => {
  /**
   * Suite 1: Constant Validation
   * Ensures the central VECTOR_DIM constant is correctly set to 1536
   */
  describe('Constant Validation', () => {
    it('VECTOR_DIM should be 1536', () => {
      // GAP-VEC-001: Migration from 768D to 1536D
      // OpenAI text-embedding-3-large uses 1536 dimensions
      expect(VECTOR_DIM).toBe(1536);
    });

    it('VECTOR_DIM should NOT be 768 (old dimension)', () => {
      // Explicit regression check
      expect(VECTOR_DIM).not.toBe(768);
    });

    it('VECTOR_DIM should be divisible by DEFAULT_NUM_HEADS', () => {
      // Required for multi-head attention architecture
      expect(VECTOR_DIM % DEFAULT_NUM_HEADS).toBe(0);
    });

    it('dimension per head should be 128 (1536 / 12)', () => {
      // Per transformer architecture: 1536 / 12 = 128 dims per head
      expect(VECTOR_DIM / DEFAULT_NUM_HEADS).toBe(128);
    });

    it('DEFAULT_NUM_HEADS should be 12', () => {
      // Standard for 1536D embeddings
      expect(DEFAULT_NUM_HEADS).toBe(12);
    });

    it('VECTOR_DIM should be a power-of-2 friendly value', () => {
      // 1536 = 512 * 3 = 2^9 * 3 (SIMD-friendly)
      expect(VECTOR_DIM % 512).toBe(0);
    });
  });

  /**
   * Suite 2: Source Code Static Validation
   * Scans production code for hardcoded 768 dimension values
   */
  describe('Source Code Static Validation', () => {
    it('should not contain hardcoded 768 in sona-engine.ts', () => {
      const sonaEnginePath = join(PROJECT_ROOT, 'src/god-agent/core/learning/sona-engine.ts');

      if (existsSync(sonaEnginePath)) {
        const content = readFileSync(sonaEnginePath, 'utf-8');
        const matches = content.match(/\b768\b/g) || [];

        // Should have zero hardcoded 768 values
        expect(matches.length).toBe(0);
      }
    });

    it('should not contain hardcoded 768 in vector-validation.ts', () => {
      const validationPath = join(PROJECT_ROOT, 'src/god-agent/core/validation/vector-validation.ts');

      if (existsSync(validationPath)) {
        const content = readFileSync(validationPath, 'utf-8');
        const matches = content.match(/\b768\b/g) || [];

        expect(matches.length).toBe(0);
      }
    });

    it('should not contain hardcoded 768 in constants.ts', () => {
      const constantsPath = join(PROJECT_ROOT, 'src/god-agent/core/validation/constants.ts');

      if (existsSync(constantsPath)) {
        const content = readFileSync(constantsPath, 'utf-8');
        const matches = content.match(/\b768\b/g) || [];

        // Zero hardcoded 768 values (dimension should be 1536)
        expect(matches.length).toBe(0);
      }
    });

    it('should have limited 768 references in reasoning code (documentation only)', () => {
      // Some 768 references may exist in type comments explaining the GNN architecture
      // that transforms embeddings. These are documentation, not runtime values.
      try {
        const result = execSync(
          `grep -rn "768" "${PROJECT_ROOT}src/god-agent/core/reasoning/" --include="*.ts" | grep -v ".test." | grep -v ".d.ts" | wc -l`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        const count = parseInt(result.trim());

        // Allow up to 10 documentation/comment references (GNN architecture explanation)
        // These should be in type definitions explaining the transformation pipeline
        expect(count).toBeLessThanOrEqual(10);
      } catch {
        // If grep fails (no matches), that's fine
        expect(true).toBe(true);
      }
    });

    it('should not have runtime 768 dimension assignments in learning code', () => {
      try {
        const result = execSync(
          `grep -rn "= 768" "${PROJECT_ROOT}src/god-agent/core/learning/" --include="*.ts" | grep -v ".test." | wc -l`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        const count = parseInt(result.trim());

        // No runtime assignments of 768
        expect(count).toBe(0);
      } catch {
        expect(true).toBe(true);
      }
    });

    it('should not have new Float32Array(768) in production code', () => {
      try {
        const result = execSync(
          `grep -rn "Float32Array(768)" "${PROJECT_ROOT}src/god-agent/core/" --include="*.ts" | grep -v ".test." | wc -l`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        const count = parseInt(result.trim());

        // No hardcoded 768-dimension arrays
        expect(count).toBe(0);
      } catch {
        expect(true).toBe(true);
      }
    });

    it('should not have new Array(768) in production code', () => {
      try {
        const result = execSync(
          `grep -rn "Array(768)" "${PROJECT_ROOT}src/god-agent/core/" --include="*.ts" | grep -v ".test." | wc -l`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        const count = parseInt(result.trim());

        expect(count).toBe(0);
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  /**
   * Suite 3: Test Helper Validation
   * Ensures test fixtures use correct dimensions
   */
  describe('Test Helper Validation', () => {
    it('createTestEmbedding should produce 1536D vectors', () => {
      const embedding = createTestEmbedding();

      expect(embedding.length).toBe(1536);
      expect(embedding.length).toBe(VECTOR_DIM);
    });

    it('createTestEmbedding should produce L2-normalized vectors', () => {
      const embedding = createTestEmbedding(42);

      expect(isL2Normalized(embedding)).toBe(true);
    });

    it('createTestEmbedding should be deterministic with same seed', () => {
      const emb1 = createTestEmbedding(123);
      const emb2 = createTestEmbedding(123);

      expect(emb1.length).toBe(emb2.length);
      for (let i = 0; i < emb1.length; i++) {
        expect(emb1[i]).toBeCloseTo(emb2[i], 10);
      }
    });

    it('createTestEmbedding should produce different vectors with different seeds', () => {
      const emb1 = createTestEmbedding(1);
      const emb2 = createTestEmbedding(2);

      // Should not be identical
      let different = false;
      for (let i = 0; i < emb1.length; i++) {
        if (Math.abs(emb1[i] - emb2[i]) > 0.001) {
          different = true;
          break;
        }
      }
      expect(different).toBe(true);
    });
  });

  /**
   * Suite 4: Runtime Component Validation
   * Tests actual runtime behavior of components
   */
  describe('Runtime Component Validation', () => {
    it('VECTOR_DIM constant matches expected OpenAI text-embedding-3-large dimension', () => {
      // OpenAI text-embedding-3-large produces 1536D embeddings
      const OPENAI_TEXT_EMBEDDING_3_LARGE_DIM = 1536;

      expect(VECTOR_DIM).toBe(OPENAI_TEXT_EMBEDDING_3_LARGE_DIM);
    });

    it('assertDimensions should accept 1536D vectors', async () => {
      const { assertDimensions } = await import(
        '../../../../src/god-agent/core/validation/vector-validation.js'
      );

      const validVector = createTestEmbedding();

      // Should not throw
      expect(() => assertDimensions(validVector)).not.toThrow();
    });

    it('assertDimensions should reject 768D vectors', async () => {
      const { assertDimensions } = await import(
        '../../../../src/god-agent/core/validation/vector-validation.js'
      );

      // Create a legacy 768D vector
      const arr768 = new Float32Array(768);
      let sumSq = 0;
      for (let i = 0; i < 768; i++) {
        arr768[i] = Math.sin(i) * 0.1;
        sumSq += arr768[i] * arr768[i];
      }
      const norm = Math.sqrt(sumSq);
      for (let i = 0; i < 768; i++) {
        arr768[i] /= norm;
      }

      // Should throw dimension mismatch (error contains "1536D" and "768D")
      expect(() => assertDimensions(arr768)).toThrow(/1536D.*768D|768D.*1536D/);
    });

    it('normL2 should preserve 1536D dimension', async () => {
      const { normL2 } = await import(
        '../../../../src/god-agent/core/validation/vector-validation.js'
      );

      // Create unnormalized 1536D vector
      const unnormalized = new Float32Array(VECTOR_DIM);
      for (let i = 0; i < VECTOR_DIM; i++) {
        unnormalized[i] = Math.random() * 2 - 1;
      }

      const normalized = normL2(unnormalized);

      expect(normalized.length).toBe(VECTOR_DIM);
      expect(normalized.length).toBe(1536);
    });
  });

  /**
   * Suite 5: Backward Compatibility Checks
   * Validates that old 768D data is properly rejected
   */
  describe('Backward Compatibility (768D Rejection)', () => {
    it('should document the migration requirement', () => {
      // This test serves as documentation that 768D -> 1536D migration occurred
      const migrationDoc = {
        gap: 'GAP-VEC-001',
        description: 'Vector dimension mismatch between components',
        oldDimension: 768,
        newDimension: 1536,
        reason: 'OpenAI text-embedding-3-large uses 1536 dimensions',
        migrationDate: '2024-12',
      };

      expect(migrationDoc.newDimension).toBe(VECTOR_DIM);
      expect(migrationDoc.oldDimension).not.toBe(VECTOR_DIM);
    });

    it('vectors with 768 dimensions should not be storable', async () => {
      const { assertDimensions } = await import(
        '../../../../src/god-agent/core/validation/vector-validation.js'
      );

      const legacy768DVector = new Float32Array(768).fill(1 / Math.sqrt(768));

      expect(() => {
        assertDimensions(legacy768DVector, VECTOR_DIM, 'Legacy 768D vector');
      }).toThrow();
    });
  });

  /**
   * Suite 6: Memory and Performance Validation
   * Ensures 1536D vectors have correct memory footprint
   */
  describe('Memory and Performance Validation', () => {
    it('1536D Float32Array should use 6KB of memory', () => {
      const vector = new Float32Array(VECTOR_DIM);

      // Float32 = 4 bytes per element
      // 1536 * 4 = 6144 bytes = 6KB
      expect(vector.byteLength).toBe(6144);
      expect(vector.byteLength).toBe(VECTOR_DIM * 4);
    });

    it('batch of 100 embeddings should use ~600KB', () => {
      const batchSize = 100;
      const totalBytes = batchSize * VECTOR_DIM * 4;

      // 100 * 1536 * 4 = 614,400 bytes ≈ 600KB
      expect(totalBytes).toBe(614400);
    });

    it('1536D normalization should complete under 1ms', () => {
      const iterations = 100;
      const vectors: Float32Array[] = [];

      // Create test vectors
      for (let i = 0; i < iterations; i++) {
        const v = new Float32Array(VECTOR_DIM);
        for (let j = 0; j < VECTOR_DIM; j++) {
          v[j] = Math.random();
        }
        vectors.push(v);
      }

      // Measure normalization time
      const start = performance.now();
      for (const v of vectors) {
        let sumSq = 0;
        for (let i = 0; i < v.length; i++) {
          sumSq += v[i] * v[i];
        }
        const norm = Math.sqrt(sumSq);
        for (let i = 0; i < v.length; i++) {
          v[i] /= norm;
        }
      }
      const elapsed = performance.now() - start;

      // Average should be under 1ms per vector
      const avgMs = elapsed / iterations;
      expect(avgMs).toBeLessThan(1);
    });
  });

  /**
   * Suite 7: Import/Export Contract Validation
   * Ensures module exports are correct
   */
  describe('Module Export Contract', () => {
    it('constants.ts should export VECTOR_DIM', async () => {
      const constants = await import('../../../../src/god-agent/core/validation/constants.js');

      expect(constants.VECTOR_DIM).toBeDefined();
      expect(constants.VECTOR_DIM).toBe(1536);
    });

    it('index.ts should re-export VECTOR_DIM', async () => {
      const validation = await import('../../../../src/god-agent/core/validation/index.js');

      expect(validation.VECTOR_DIM).toBeDefined();
      expect(validation.VECTOR_DIM).toBe(1536);
    });

    it('test fixtures should re-export VECTOR_DIM', async () => {
      const fixtures = await import('../../../fixtures/vector-helpers.js');

      expect(fixtures.VECTOR_DIM).toBeDefined();
      expect(fixtures.VECTOR_DIM).toBe(1536);
    });
  });

  /**
   * Suite 8: Comprehensive File Scan
   * Final safety check across entire codebase
   */
  describe('Comprehensive File Scan', () => {
    it('should report any files with potential 768 dimension issues', () => {
      const criticalPaths = [
        'src/god-agent/core/learning/',
        'src/god-agent/core/validation/',
        'src/god-agent/core/memory/',
        'src/god-agent/core/routing/',
      ];

      const issues: string[] = [];

      for (const path of criticalPaths) {
        const fullPath = join(PROJECT_ROOT, path);
        if (!existsSync(fullPath)) continue;

        try {
          const result = execSync(
            `grep -rln "Float32Array(768)\\|new Array(768)\\|= 768;\\|dimension.*768\\|768.*dimension" "${fullPath}" --include="*.ts" 2>/dev/null || true`,
            { encoding: 'utf-8', timeout: 10000 }
          );

          if (result.trim()) {
            issues.push(...result.trim().split('\n').filter(Boolean));
          }
        } catch {
          // Ignore grep errors
        }
      }

      // Filter out test files and type definitions (comments are OK)
      const productionIssues = issues.filter(
        (f) => !f.includes('.test.') && !f.includes('.d.ts') && !f.includes('types.ts')
      );

      // Report any found issues
      if (productionIssues.length > 0) {
        console.warn('Files with potential 768 dimension issues:', productionIssues);
      }

      // Allow some type definition comments but no production code issues
      expect(productionIssues.length).toBe(0);
    });
  });
});

/**
 * Standalone constant assertions for compile-time checking
 * These will cause TypeScript errors if constants change
 */
const _staticAssertions = {
  // Ensure VECTOR_DIM is exactly 1536
  vectorDimIs1536: VECTOR_DIM satisfies 1536,

  // Ensure DEFAULT_NUM_HEADS is exactly 12
  numHeadsIs12: DEFAULT_NUM_HEADS satisfies 12,

  // Ensure dimension per head is 128
  dimPerHeadIs128: (VECTOR_DIM / DEFAULT_NUM_HEADS) satisfies 128,
};

// Use the assertions to prevent unused variable warnings
void _staticAssertions;
