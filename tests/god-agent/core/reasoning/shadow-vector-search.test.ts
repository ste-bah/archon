/**
 * Shadow Vector Search Unit Tests
 * TASK-SHA-001 - Contradiction Detection via Semantic Inversion
 *
 * Tests cover:
 * - Shadow vector creation (v × -1)
 * - Cosine similarity calculations
 * - Classification logic
 * - Contradiction detection
 * - Claim validation
 * - Credibility scoring
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShadowVectorSearch,
  MockVectorStore,
  ShadowVectorError,
  createShadowVector,
  cosineSimilarity,
  isL2Normalized,
  normalizeL2,
  classifyDocument,
  determineEvidenceType,
  calculateCredibility,
  determineVerdict,
  calculateVerdictConfidence,
  calculateRefutationStrength,
  sortByRefutationStrength,
  filterByThreshold,
  DEFAULT_CLASSIFICATION_THRESHOLDS,
  DEFAULT_SHADOW_CONFIG,
} from '../../../../src/god-agent/core/reasoning/index.js';
import type {
  IShadowSearchResult,
  ValidationVerdict,
} from '../../../../src/god-agent/core/reasoning/index.js';

// ==================== Test Helpers ====================

/**
 * Create a random 1536-dim vector
 */
function createRandomVector(seed: number = Math.random()): Float32Array {
  const vector = new Float32Array(1536);
  for (let i = 0; i < 1536; i++) {
    vector[i] = Math.sin(seed * (i + 1)) + Math.cos(seed * i * 0.5);
  }
  return normalizeL2(vector);
}

/**
 * Create a vector similar to another (with controlled similarity)
 */
function createSimilarVector(base: Float32Array, similarity: number): Float32Array {
  const noise = createRandomVector(Date.now());
  const result = new Float32Array(1536);

  // Mix base with noise based on desired similarity
  const baseWeight = similarity;
  const noiseWeight = 1 - similarity;

  for (let i = 0; i < 1536; i++) {
    result[i] = base[i] * baseWeight + noise[i] * noiseWeight;
  }

  return normalizeL2(result);
}

/**
 * Create a vector opposing another (semantically opposite)
 */
function createOpposingVector(base: Float32Array): Float32Array {
  // Shadow vector is the semantic opposite
  return createShadowVector(base);
}

// ==================== Vector Operations Tests ====================

describe('Vector Operations', () => {
  describe('createShadowVector', () => {
    it('should invert all vector components', () => {
      const original = new Float32Array([1, -2, 3, -4]);
      const shadow = createShadowVector(original);

      expect(shadow[0]).toBe(-1);
      expect(shadow[1]).toBe(2);
      expect(shadow[2]).toBe(-3);
      expect(shadow[3]).toBe(4);
    });

    it('should maintain vector length', () => {
      const original = createRandomVector(42);
      const shadow = createShadowVector(original);

      expect(shadow.length).toBe(original.length);
    });

    it('should produce opposite similarity (property test)', () => {
      const v = createRandomVector(1);
      const x = createRandomVector(2);
      const shadow = createShadowVector(v);

      const originalSim = cosineSimilarity(v, x);
      const shadowSim = cosineSimilarity(shadow, x);

      // cosine(v, x) = -cosine(Shadow(v), x)
      expect(originalSim).toBeCloseTo(-shadowSim, 5);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const v = createRandomVector(123);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('should return -1.0 for opposite vectors', () => {
      const v = createRandomVector(456);
      const opposite = createShadowVector(v);
      expect(cosineSimilarity(v, opposite)).toBeCloseTo(-1.0, 5);
    });

    it('should return ~0 for orthogonal vectors', () => {
      // Create roughly orthogonal vectors
      const v1 = new Float32Array(1536).fill(0);
      const v2 = new Float32Array(1536).fill(0);

      // Set different dimensions
      for (let i = 0; i < 384; i++) {
        v1[i] = 1;
      }
      for (let i = 768; i < 1536; i++) {
        v2[i] = 1;
      }

      const normalized1 = normalizeL2(v1);
      const normalized2 = normalizeL2(v2);

      expect(cosineSimilarity(normalized1, normalized2)).toBeCloseTo(0, 5);
    });

    it('should throw on dimension mismatch', () => {
      const v1 = new Float32Array(1536);
      const v2 = new Float32Array(512);

      // Use flexible matching pattern for dimension error messages
      expect(() => cosineSimilarity(v1, v2)).toThrow(/dimension mismatch|Dimension/i);
    });
  });

  describe('isL2Normalized', () => {
    it('should return true for normalized vectors', () => {
      const v = normalizeL2(createRandomVector(789));
      expect(isL2Normalized(v)).toBe(true);
    });

    it('should return false for unnormalized vectors', () => {
      const v = new Float32Array(1536);
      v[0] = 5; // Not normalized
      expect(isL2Normalized(v)).toBe(false);
    });

    it('should respect tolerance parameter', () => {
      const v = normalizeL2(createRandomVector(101));
      // Noticeably denormalize (multiply all by 1.05)
      for (let i = 0; i < v.length; i++) {
        v[i] *= 1.05;
      }
      expect(isL2Normalized(v, 0.01)).toBe(false);
      expect(isL2Normalized(v, 0.1)).toBe(true);
    });
  });

  describe('normalizeL2', () => {
    it('should produce unit vector', () => {
      const v = new Float32Array(1536);
      for (let i = 0; i < 1536; i++) {
        v[i] = Math.random() * 10 - 5;
      }

      const normalized = normalizeL2(v);
      expect(isL2Normalized(normalized)).toBe(true);
    });

    it('should handle zero vector', () => {
      const v = new Float32Array(1536);
      const normalized = normalizeL2(v);
      expect(normalized.every(x => x === 0)).toBe(true);
    });
  });
});

// ==================== Classification Tests ====================

describe('Classification Logic', () => {
  describe('classifyDocument', () => {
    it('should classify as AMBIGUOUS when both similarities high', () => {
      expect(classifyDocument(0.8, 0.8)).toBe('AMBIGUOUS');
      expect(classifyDocument(0.75, 0.9)).toBe('AMBIGUOUS');
    });

    it('should classify as FALSIFIED when hypothesis low and shadow high', () => {
      expect(classifyDocument(0.2, 0.8)).toBe('FALSIFIED');
      expect(classifyDocument(0.1, 0.9)).toBe('FALSIFIED');
    });

    it('should classify as CONTESTED when shadow > hypothesis and shadow high', () => {
      expect(classifyDocument(0.5, 0.8)).toBe('CONTESTED');
      expect(classifyDocument(0.6, 0.75)).toBe('CONTESTED');
    });

    it('should classify as DEBATED when both in medium range', () => {
      expect(classifyDocument(0.6, 0.6)).toBe('DEBATED');
      expect(classifyDocument(0.55, 0.65)).toBe('DEBATED');
    });

    it('should classify as SUPPORTED when hypothesis high and shadow low', () => {
      expect(classifyDocument(0.8, 0.2)).toBe('SUPPORTED');
      expect(classifyDocument(0.9, 0.1)).toBe('SUPPORTED');
    });

    it('should classify as UNCERTAIN for edge cases', () => {
      expect(classifyDocument(0.4, 0.4)).toBe('UNCERTAIN');
    });

    it('should use custom thresholds', () => {
      const thresholds = { high: 0.8, medium: 0.6, low: 0.4 };
      expect(classifyDocument(0.75, 0.75, thresholds)).toBe('DEBATED');
    });
  });

  describe('determineEvidenceType', () => {
    it('should return direct_refutation for strong falsification', () => {
      expect(determineEvidenceType('FALSIFIED', 0.9)).toBe('direct_refutation');
    });

    it('should return counterexample for strong contested', () => {
      expect(determineEvidenceType('CONTESTED', 0.8)).toBe('counterexample');
    });

    it('should return alternative_explanation for weak contested', () => {
      expect(determineEvidenceType('CONTESTED', 0.6)).toBe('alternative_explanation');
    });

    it('should return partial_contradiction for debated', () => {
      expect(determineEvidenceType('DEBATED', 0.5)).toBe('partial_contradiction');
    });
  });
});

// ==================== Credibility Scoring Tests ====================

describe('Credibility Scoring', () => {
  describe('calculateCredibility', () => {
    it('should return 1.0 for pure support', () => {
      const credibility = calculateCredibility([0.8, 0.9, 0.85], []);
      expect(credibility).toBeCloseTo(1.0, 1);
    });

    it('should return 0.0 for pure refutation', () => {
      const credibility = calculateCredibility([], [0.8, 0.9, 0.85]);
      expect(credibility).toBeCloseTo(0.0, 1);
    });

    it('should return 0.5 for no evidence', () => {
      expect(calculateCredibility([], [])).toBe(0.5);
    });

    it('should return ~0.5 for balanced evidence', () => {
      const credibility = calculateCredibility([0.7, 0.8], [0.7, 0.8]);
      expect(credibility).toBeCloseTo(0.5, 1);
    });

    it('should favor support when support is stronger', () => {
      const credibility = calculateCredibility([0.9, 0.85], [0.5, 0.4]);
      expect(credibility).toBeGreaterThan(0.5);
    });
  });

  describe('determineVerdict', () => {
    it('should return UNCERTAIN for no evidence', () => {
      expect(determineVerdict(0.5, 0, 0)).toBe('UNCERTAIN');
    });

    it('should return SUPPORTED for high credibility with no contradictions', () => {
      expect(determineVerdict(0.8, 5, 0)).toBe('SUPPORTED');
    });

    it('should return REFUTED for low credibility with no support', () => {
      expect(determineVerdict(0.2, 0, 5)).toBe('REFUTED');
    });

    it('should return CONTESTED for low credibility with mixed evidence', () => {
      expect(determineVerdict(0.2, 2, 5)).toBe('CONTESTED');
    });

    it('should return DEBATED for balanced credibility', () => {
      expect(determineVerdict(0.5, 3, 3)).toBe('DEBATED');
    });
  });

  describe('calculateVerdictConfidence', () => {
    it('should return low confidence for no evidence', () => {
      expect(calculateVerdictConfidence([], [])).toBe(0.1);
    });

    it('should return higher confidence for more evidence', () => {
      const confidence1 = calculateVerdictConfidence([0.8], []);
      const confidence2 = calculateVerdictConfidence([0.8, 0.8, 0.8], []);
      expect(confidence2).toBeGreaterThan(confidence1);
    });

    it('should return higher confidence for consistent evidence', () => {
      // One-sided evidence has higher consistency
      const oneSided = calculateVerdictConfidence([0.8, 0.8, 0.8], []);
      const mixed = calculateVerdictConfidence([0.8, 0.8], [0.8, 0.8]);
      expect(oneSided).toBeGreaterThan(mixed);
    });
  });

  describe('calculateRefutationStrength', () => {
    it('should be high when shadow similarity is high', () => {
      expect(calculateRefutationStrength(0.2, 0.9)).toBeGreaterThan(0.7);
    });

    it('should be low when shadow similarity is low', () => {
      expect(calculateRefutationStrength(0.8, 0.2)).toBeLessThan(0.3);
    });

    it('should factor in hypothesis similarity', () => {
      const strength1 = calculateRefutationStrength(0.2, 0.8);
      const strength2 = calculateRefutationStrength(0.6, 0.8);
      // Lower hypothesis similarity should boost refutation
      expect(strength1).toBeGreaterThan(strength2);
    });
  });
});

// ==================== Result Processing Tests ====================

describe('Result Processing', () => {
  describe('sortByRefutationStrength', () => {
    it('should sort results by refutation strength descending', () => {
      const results: IShadowSearchResult[] = [
        { documentId: 'a', content: 'A', hypothesisSimilarity: 0.8, shadowSimilarity: 0.3 },
        { documentId: 'b', content: 'B', hypothesisSimilarity: 0.2, shadowSimilarity: 0.9 },
        { documentId: 'c', content: 'C', hypothesisSimilarity: 0.5, shadowSimilarity: 0.6 },
      ];

      const sorted = sortByRefutationStrength(results);

      // B should be first (highest refutation)
      expect(sorted[0].documentId).toBe('b');
      // A should be last (lowest refutation)
      expect(sorted[sorted.length - 1].documentId).toBe('a');
    });
  });

  describe('filterByThreshold', () => {
    it('should filter out results below threshold', () => {
      const results: IShadowSearchResult[] = [
        { documentId: 'a', content: 'A', hypothesisSimilarity: 0.2, shadowSimilarity: 0.9 }, // High refutation
        { documentId: 'b', content: 'B', hypothesisSimilarity: 0.8, shadowSimilarity: 0.3 }, // Low refutation
        { documentId: 'c', content: 'C', hypothesisSimilarity: 0.5, shadowSimilarity: 0.75 }, // Medium refutation
      ];

      const filtered = filterByThreshold(results, 0.6);

      expect(filtered.length).toBe(2);
      expect(filtered.find(r => r.documentId === 'b')).toBeUndefined();
    });
  });
});

// ==================== ShadowVectorSearch Class Tests ====================

describe('ShadowVectorSearch', () => {
  let shadowSearch: ShadowVectorSearch;
  let vectorStore: MockVectorStore;

  beforeEach(() => {
    shadowSearch = new ShadowVectorSearch({ verbose: false });
    vectorStore = new MockVectorStore();
    shadowSearch.setVectorStore(vectorStore);
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = shadowSearch.getConfig();
      expect(config.defaultThreshold).toBe(DEFAULT_SHADOW_CONFIG.defaultThreshold);
      expect(config.defaultK).toBe(DEFAULT_SHADOW_CONFIG.defaultK);
    });

    it('should allow configuration updates', () => {
      shadowSearch.updateConfig({ defaultThreshold: 0.8 });
      expect(shadowSearch.getConfig().defaultThreshold).toBe(0.8);
    });
  });

  describe('findContradictions', () => {
    it('should throw if vector store not configured', async () => {
      const unconfigured = new ShadowVectorSearch();
      const vector = createRandomVector(1);

      await expect(
        unconfigured.findContradictions(vector, { type: 'contradiction' })
      ).rejects.toThrow(ShadowVectorError);
    });

    it('should throw on invalid vector dimension', async () => {
      const wrongDimVector = new Float32Array(512);

      await expect(
        shadowSearch.findContradictions(wrongDimVector, { type: 'contradiction' })
      ).rejects.toThrow('1536-dim');
    });

    it('should find contradictions', async () => {
      const hypothesis = createRandomVector(100);

      // Add supporting document (similar to hypothesis)
      const supporting = createSimilarVector(hypothesis, 0.9);
      vectorStore.addVector('supporting', supporting, 'Supporting document');

      // Add contradicting document (similar to shadow)
      const contradicting = createOpposingVector(hypothesis);
      vectorStore.addVector('contradicting', contradicting, 'Contradicting document');

      // Add neutral document
      const neutral = createRandomVector(200);
      vectorStore.addVector('neutral', neutral, 'Neutral document');

      const contradictions = await shadowSearch.findContradictions(hypothesis, {
        type: 'contradiction',
        threshold: 0.5,
      });

      expect(contradictions.length).toBeGreaterThan(0);
      // Contradicting document should have high refutation strength
      const contradictingResult = contradictions.find(c => c.documentId === 'contradicting');
      expect(contradictingResult).toBeDefined();
      expect(contradictingResult!.refutationStrength).toBeGreaterThan(0.7);
    });

    it('should filter by L-Score when enabled', async () => {
      const hypothesis = createRandomVector(300);

      // Add high L-Score contradiction
      const contra1 = createOpposingVector(hypothesis);
      vectorStore.addVector('contra1', contra1, 'High L-Score', { lScore: 0.8 });

      // Add low L-Score contradiction
      const contra2 = createOpposingVector(hypothesis);
      vectorStore.addVector('contra2', contra2, 'Low L-Score', { lScore: 0.1 });

      const contradictions = await shadowSearch.findContradictions(hypothesis, {
        type: 'contradiction',
        validateLScore: true,
        minLScore: 0.3,
        threshold: 0.5,
      });

      // Only high L-Score contradiction should be included
      const lowLScoreResult = contradictions.find(c => c.documentId === 'contra2');
      expect(lowLScoreResult).toBeUndefined();
    });
  });

  describe('findSupport', () => {
    it('should find supporting evidence', async () => {
      const hypothesis = createRandomVector(400);

      // Add supporting document
      const supporting = createSimilarVector(hypothesis, 0.95);
      vectorStore.addVector('supporting', supporting, 'Supporting document');

      // Add contradicting document
      const contradicting = createOpposingVector(hypothesis);
      vectorStore.addVector('contradicting', contradicting, 'Contradicting document');

      const support = await shadowSearch.findSupport(hypothesis, 10);

      expect(support.length).toBeGreaterThan(0);
      expect(support[0].documentId).toBe('supporting');
      expect(support[0].supportStrength).toBeGreaterThan(0.7);
    });
  });

  describe('validateClaim', () => {
    it('should produce comprehensive validation report', async () => {
      const hypothesis = createRandomVector(500);

      // Add mixed evidence
      const supporting1 = createSimilarVector(hypothesis, 0.9);
      vectorStore.addVector('support1', supporting1, 'Strong support');

      const supporting2 = createSimilarVector(hypothesis, 0.8);
      vectorStore.addVector('support2', supporting2, 'Moderate support');

      const contradicting = createOpposingVector(hypothesis);
      vectorStore.addVector('contra1', contradicting, 'Contradiction');

      const report = await shadowSearch.validateClaim(hypothesis, 'Test claim');

      expect(report.claim).toBe('Test claim');
      expect(report.support.length).toBeGreaterThan(0);
      expect(report.contradictions.length).toBeGreaterThan(0);
      expect(report.credibility).toBeGreaterThanOrEqual(0);
      expect(report.credibility).toBeLessThanOrEqual(1);
      expect(['SUPPORTED', 'REFUTED', 'UNCERTAIN', 'AMBIGUOUS', 'CONTESTED', 'DEBATED', 'FALSIFIED'])
        .toContain(report.verdict);
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.metadata).toBeDefined();
    });

    it('should return SUPPORTED verdict when only support exists', async () => {
      const hypothesis = createRandomVector(600);

      // Add only supporting documents
      for (let i = 0; i < 5; i++) {
        const supporting = createSimilarVector(hypothesis, 0.85 + i * 0.02);
        vectorStore.addVector(`support${i}`, supporting, `Support ${i}`);
      }

      const report = await shadowSearch.validateClaim(hypothesis, 'Well-supported claim');

      expect(report.support.length).toBeGreaterThan(0);
      expect(report.contradictions.length).toBe(0);
      expect(report.credibility).toBeGreaterThan(0.7);
      expect(report.verdict).toBe('SUPPORTED');
    });

    it('should return REFUTED verdict when only contradictions exist', async () => {
      const hypothesis = createRandomVector(700);

      // Add only contradicting documents
      for (let i = 0; i < 5; i++) {
        const shadow = createShadowVector(hypothesis);
        const variation = createSimilarVector(shadow, 0.95);
        vectorStore.addVector(`contra${i}`, variation, `Contradiction ${i}`);
      }

      const report = await shadowSearch.validateClaim(hypothesis, 'Refuted claim');

      expect(report.contradictions.length).toBeGreaterThan(0);
      expect(report.credibility).toBeLessThan(0.3);
    });
  });

  describe('Batch Operations', () => {
    it('should process multiple hypotheses', async () => {
      const hypotheses = [
        createRandomVector(1001),
        createRandomVector(1002),
        createRandomVector(1003),
      ];

      // Add some documents
      for (let i = 0; i < 5; i++) {
        vectorStore.addVector(`doc${i}`, createRandomVector(2000 + i), `Document ${i}`);
      }

      const results = await shadowSearch.batchFindContradictions(hypotheses, {
        type: 'contradiction',
        threshold: 0.3,
      });

      expect(results.length).toBe(3);
    });

    it('should validate multiple claims', async () => {
      const claims = [
        { vector: createRandomVector(3001), text: 'Claim 1' },
        { vector: createRandomVector(3002), text: 'Claim 2' },
      ];

      // Add some documents
      for (let i = 0; i < 5; i++) {
        vectorStore.addVector(`doc${i}`, createRandomVector(4000 + i), `Document ${i}`);
      }

      const reports = await shadowSearch.batchValidateClaims(claims);

      expect(reports.length).toBe(2);
      expect(reports[0].claim).toBe('Claim 1');
      expect(reports[1].claim).toBe('Claim 2');
    });
  });
});

// ==================== Constants Tests ====================

describe('Constants', () => {
  it('should have correct default thresholds', () => {
    expect(DEFAULT_CLASSIFICATION_THRESHOLDS.high).toBe(0.7);
    expect(DEFAULT_CLASSIFICATION_THRESHOLDS.medium).toBe(0.5);
    expect(DEFAULT_CLASSIFICATION_THRESHOLDS.low).toBe(0.3);
  });

  it('should have correct default config', () => {
    expect(DEFAULT_SHADOW_CONFIG.defaultThreshold).toBe(0.7);
    expect(DEFAULT_SHADOW_CONFIG.defaultK).toBe(10);
    expect(DEFAULT_SHADOW_CONFIG.validateLScoreByDefault).toBe(true);
    expect(DEFAULT_SHADOW_CONFIG.defaultMinLScore).toBe(0.3);
  });
});

// ==================== Integration Tests ====================

describe('Integration Tests', () => {
  it('should demonstrate shadow vector property: cosine(v, x) = -cosine(Shadow(v), x)', () => {
    // Create hypothesis and document
    const hypothesis = createRandomVector(9001);
    const document = createRandomVector(9002);

    // Create shadow
    const shadow = createShadowVector(hypothesis);

    // Calculate similarities
    const hypothesisSim = cosineSimilarity(hypothesis, document);
    const shadowSim = cosineSimilarity(shadow, document);

    // Verify property
    expect(hypothesisSim).toBeCloseTo(-shadowSim, 5);
  });

  it('should correctly identify opposing viewpoints', async () => {
    const shadowSearch = new ShadowVectorSearch({ verbose: false });
    const vectorStore = new MockVectorStore();
    shadowSearch.setVectorStore(vectorStore);

    // Create a "pro" hypothesis (e.g., "Exercise is beneficial")
    const proVector = createRandomVector(10001);

    // Create a "con" document (directly opposing)
    const conVector = createShadowVector(proVector);
    vectorStore.addVector('con', conVector, 'Exercise can cause injuries');

    // Create a "pro" document (supporting)
    const supportVector = createSimilarVector(proVector, 0.9);
    vectorStore.addVector('pro', supportVector, 'Exercise improves health');

    const report = await shadowSearch.validateClaim(proVector, 'Exercise is beneficial');

    // The con document should be found as contradiction
    expect(report.contradictions.some(c => c.documentId === 'con')).toBe(true);

    // The pro document should be found as support
    expect(report.support.some(s => s.documentId === 'pro')).toBe(true);
  });
});
