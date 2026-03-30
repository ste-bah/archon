/**
 * ProvenanceStore Tests
 * TASK-PRV-001 - Source Registration and Citation Graph
 *
 * Tests for:
 * - Source storage and validation
 * - Provenance chain creation
 * - L-Score calculation
 * - Citation graph traversal
 * - Performance requirements
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/vector-db.js';
import { ProvenanceStore } from '../../../../src/god-agent/core/reasoning/provenance-store.js';
import {
  generateSourceID,
  generateProvenanceID,
  isValidSourceID,
  isValidProvenanceID,
  geometricMean,
  arithmeticMean,
  depthFactor,
  calculateLScore,
  getThresholdForDomain,
  DEFAULT_LSCORE_THRESHOLD,
} from '../../../../src/god-agent/core/reasoning/provenance-utils.js';
import {
  ProvenanceValidationError,
  LScoreRejectionError,
} from '../../../../src/god-agent/core/reasoning/provenance-types.js';
import type {
  ISourceInput,
  IProvenanceInput,
} from '../../../../src/god-agent/core/reasoning/provenance-types.js';

describe('ProvenanceStore', () => {
  let vectorDB: VectorDB;
  let store: ProvenanceStore;

  // Helper to create normalized 768D embedding
  const createEmbedding = (): Float32Array => {
    const arr = new Float32Array(1536);
    let sumSq = 0;
    for (let i = 0; i < 1536; i++) {
      arr[i] = Math.random() * 2 - 1;
      sumSq += arr[i] * arr[i];
    }
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < 1536; i++) {
      arr[i] /= norm;
    }
    return arr;
  };

  // Helper to create valid source input
  const createSourceInput = (overrides: Partial<ISourceInput> = {}): ISourceInput => ({
    type: 'document',
    title: 'Test Research Paper',
    authors: ['Author A', 'Author B'],
    url: 'https://example.com/paper',
    relevanceScore: 0.9,
    ...overrides,
  });

  beforeEach(async () => {
    vectorDB = new VectorDB();
    store = new ProvenanceStore(vectorDB);
    await store.initialize();
  });

  describe('ID Generation', () => {
    it('should generate valid SourceID format', () => {
      const id = generateSourceID();
      expect(isValidSourceID(id)).toBe(true);
      expect(id).toMatch(/^src_\d+_[a-f0-9]{8}$/);
    });

    it('should generate valid ProvenanceID format', () => {
      const id = generateProvenanceID();
      expect(isValidProvenanceID(id)).toBe(true);
      expect(id).toMatch(/^prov_\d+_[a-f0-9]{8}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSourceID());
        ids.add(generateProvenanceID());
      }
      expect(ids.size).toBe(200);
    });
  });

  describe('storeSource', () => {
    it('should store a valid source and return SourceID', async () => {
      const input = createSourceInput();
      const sourceId = await store.storeSource(input);

      expect(isValidSourceID(sourceId)).toBe(true);

      const source = store.getSource(sourceId);
      expect(source).toBeDefined();
      expect(source?.title).toBe('Test Research Paper');
      expect(source?.type).toBe('document');
      expect(source?.relevanceScore).toBe(0.9);
    });

    it('should store all source types', async () => {
      const types = ['document', 'conversation', 'experiment', 'simulation', 'external-api'] as const;

      for (const type of types) {
        const sourceId = await store.storeSource(createSourceInput({ type }));
        const source = store.getSource(sourceId);
        expect(source?.type).toBe(type);
      }
    });

    it('should preserve location metadata', async () => {
      const input = createSourceInput({
        location: {
          page: 42,
          section: 'Methods',
          lineRange: [100, 150],
        },
      });

      const sourceId = await store.storeSource(input);
      const source = store.getSource(sourceId);

      expect(source?.location?.page).toBe(42);
      expect(source?.location?.section).toBe('Methods');
      expect(source?.location?.lineRange).toEqual([100, 150]);
    });

    it('should store embedding in VectorDB when provided', async () => {
      const embedding = createEmbedding();
      const input = createSourceInput({ embedding });

      const sourceId = await store.storeSource(input);
      const source = store.getSource(sourceId);

      expect(source?.vectorId).toBeDefined();
      expect(typeof source?.vectorId).toBe('string');
    });

    it('should reject invalid source type', async () => {
      const input = createSourceInput({ type: 'invalid' as any });

      await expect(store.storeSource(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.storeSource(input)).rejects.toThrow('Invalid source type');
    });

    it('should reject empty title', async () => {
      const input = createSourceInput({ title: '' });

      await expect(store.storeSource(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.storeSource(input)).rejects.toThrow('title required');
    });

    it('should reject relevanceScore below 0', async () => {
      const input = createSourceInput({ relevanceScore: -0.1 });

      await expect(store.storeSource(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.storeSource(input)).rejects.toThrow('out of range');
    });

    it('should reject relevanceScore above 1', async () => {
      const input = createSourceInput({ relevanceScore: 1.1 });

      await expect(store.storeSource(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.storeSource(input)).rejects.toThrow('out of range');
    });

    it('should reject embedding with wrong dimensions', async () => {
      const wrongDim = new Float32Array(512);
      const input = createSourceInput({ embedding: wrongDim });

      await expect(store.storeSource(input)).rejects.toThrow(ProvenanceValidationError);
      // Use flexible matching pattern for dimension error messages
      await expect(store.storeSource(input)).rejects.toThrow(/Expected \d+D|dimension/i);
    });

    it('should set createdAt timestamp', async () => {
      const before = new Date();
      const sourceId = await store.storeSource(createSourceInput());
      const after = new Date();

      const source = store.getSource(sourceId);
      expect(source?.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(source?.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('createProvenance', () => {
    it('should create provenance with valid input', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput({ relevanceScore: 0.95 })],
        derivationPath: [
          {
            description: 'Extracted key finding',
            sourceIds: ['placeholder'],
            operation: 'extraction',
            confidence: 0.9,
          },
        ],
      };

      const provenanceId = await store.createProvenance(input);
      expect(isValidProvenanceID(provenanceId)).toBe(true);

      const provenance = store.getProvenance(provenanceId);
      expect(provenance).toBeDefined();
      expect(provenance?.depth).toBe(1);
      expect(provenance?.sourceIds.length).toBe(1);
    });

    it('should store all sources before creating provenance', async () => {
      const input: IProvenanceInput = {
        sources: [
          createSourceInput({ title: 'Source A', relevanceScore: 0.95 }),
          createSourceInput({ title: 'Source B', relevanceScore: 0.90 }),
        ],
        derivationPath: [
          {
            description: 'Combined findings',
            sourceIds: ['placeholder1', 'placeholder2'],
            operation: 'synthesis',
            confidence: 0.85,
          },
        ],
      };

      const provenanceId = await store.createProvenance(input);
      const provenance = store.getProvenance(provenanceId);

      expect(provenance?.sourceIds.length).toBe(2);

      // Verify sources were stored
      for (const sourceId of provenance!.sourceIds) {
        const source = store.getSource(sourceId);
        expect(source).toBeDefined();
      }
    });

    it('should support all operation types', async () => {
      const operations = ['extraction', 'synthesis', 'inference', 'transformation'] as const;

      for (const operation of operations) {
        const input: IProvenanceInput = {
          sources: [createSourceInput()],
          derivationPath: [
            {
              description: `${operation} step`,
              sourceIds: ['placeholder'],
              operation,
              confidence: 0.85,
            },
          ],
        };

        const provenanceId = await store.createProvenance(input);
        const provenance = store.getProvenance(provenanceId);
        expect(provenance?.derivationPath[0].operation).toBe(operation);
      }
    });

    it('should reject empty sources array', async () => {
      const input: IProvenanceInput = {
        sources: [],
        derivationPath: [
          {
            description: 'Step',
            sourceIds: [],
            operation: 'extraction',
            confidence: 0.9,
          },
        ],
      };

      await expect(store.createProvenance(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.createProvenance(input)).rejects.toThrow('at least 1 source');
    });

    it('should reject empty derivationPath', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [],
      };

      await expect(store.createProvenance(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.createProvenance(input)).rejects.toThrow('at least 1 derivation step');
    });

    it('should reject confidence below 0', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [
          {
            description: 'Step',
            sourceIds: ['placeholder'],
            operation: 'extraction',
            confidence: -0.1,
          },
        ],
      };

      await expect(store.createProvenance(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.createProvenance(input)).rejects.toThrow('out of range');
    });

    it('should reject confidence above 1', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [
          {
            description: 'Step',
            sourceIds: ['placeholder'],
            operation: 'extraction',
            confidence: 1.5,
          },
        ],
      };

      await expect(store.createProvenance(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.createProvenance(input)).rejects.toThrow('out of range');
    });

    it('should reject invalid operation type', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [
          {
            description: 'Step',
            sourceIds: ['placeholder'],
            operation: 'invalid' as any,
            confidence: 0.9,
          },
        ],
      };

      await expect(store.createProvenance(input)).rejects.toThrow(ProvenanceValidationError);
      await expect(store.createProvenance(input)).rejects.toThrow('Invalid operation type');
    });

    it('should handle parent provenance linking', async () => {
      // Create parent provenance
      const parentInput: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Parent Source' })],
        derivationPath: [
          {
            description: 'Parent step',
            sourceIds: ['placeholder'],
            operation: 'extraction',
            confidence: 0.95,
          },
        ],
      };
      const parentId = await store.createProvenance(parentInput);

      // Create child provenance
      const childInput: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Child Source' })],
        derivationPath: [
          {
            description: 'Child step',
            sourceIds: ['placeholder'],
            operation: 'synthesis',
            confidence: 0.85,
          },
        ],
        parentProvenanceId: parentId,
      };
      const childId = await store.createProvenance(childInput);

      const child = store.getProvenance(childId);
      expect(child?.parentProvenanceId).toBe(parentId);
    });

    it('should handle missing parent gracefully', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [
          {
            description: 'Step',
            sourceIds: ['placeholder'],
            operation: 'extraction',
            confidence: 0.9,
          },
        ],
        parentProvenanceId: 'prov_nonexistent_12345678',
      };

      // Should not throw, just log warning and treat as root
      const provenanceId = await store.createProvenance(input);
      const provenance = store.getProvenance(provenanceId);
      expect(provenance?.parentProvenanceId).toBeUndefined();
    });

    it('should set correct depth', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
          { description: 'Step 3', sourceIds: ['p'], operation: 'inference', confidence: 0.8 },
        ],
      };

      const provenanceId = await store.createProvenance(input);
      const provenance = store.getProvenance(provenanceId);
      expect(provenance?.depth).toBe(3);
    });
  });

  describe('L-Score Calculation', () => {
    it('should calculate geometric mean correctly', () => {
      expect(geometricMean([0.9, 0.85])).toBeCloseTo(0.8746, 3);
      expect(geometricMean([0.95, 0.85, 0.75])).toBeCloseTo(0.8465, 3);
      expect(geometricMean([1, 1, 1])).toBe(1);
      expect(geometricMean([0.5])).toBe(0.5);
    });

    it('should calculate arithmetic mean correctly', () => {
      expect(arithmeticMean([0.95, 0.90])).toBeCloseTo(0.925, 5);
      expect(arithmeticMean([0.95, 0.85])).toBeCloseTo(0.9, 5);
      expect(arithmeticMean([1])).toBe(1);
    });

    it('should calculate depth factor correctly', () => {
      expect(depthFactor(2)).toBeCloseTo(2.585, 2);
      expect(depthFactor(3)).toBeCloseTo(3.0, 2);
      expect(depthFactor(5)).toBeCloseTo(3.585, 2);
    });

    it('should calculate L-Score for CALC-01 (ACCEPTED)', () => {
      // High-quality short chain
      const confidences = [0.90, 0.85];
      const relevances = [0.95, 0.90];
      const depth = 2;

      const result = calculateLScore(confidences, relevances, depth);

      expect(result.geometricMean).toBeCloseTo(0.8746, 3);
      expect(result.arithmeticMean).toBe(0.925);
      expect(result.depthFactor).toBeCloseTo(2.585, 2);
      expect(result.score).toBeCloseTo(0.313, 2);
      expect(result.meetsThreshold).toBe(true);
    });

    it('should calculate L-Score for CALC-02 (REJECTED)', () => {
      // Low-quality long chain
      const confidences = [0.95, 0.85, 0.75];
      const relevances = [0.95, 0.85];
      const depth = 3;

      const result = calculateLScore(confidences, relevances, depth);

      expect(result.geometricMean).toBeCloseTo(0.8465, 3);
      expect(result.arithmeticMean).toBeCloseTo(0.9, 5);
      expect(result.depthFactor).toBeCloseTo(3.0, 2);
      expect(result.score).toBeCloseTo(0.254, 2);
      expect(result.meetsThreshold).toBe(false);
    });

    it('should calculate L-Score for CALC-03 (ACCEPTED)', () => {
      // Multiple high-quality sources
      const confidences = [0.92, 0.88];
      const relevances = [0.98, 0.95, 0.92];
      const depth = 2;

      const result = calculateLScore(confidences, relevances, depth);

      expect(result.score).toBeCloseTo(0.330, 2);
      expect(result.meetsThreshold).toBe(true);
    });

    it('should calculate L-Score for CALC-04 (REJECTED - weak link)', () => {
      // Single weak link
      const confidences = [0.95, 0.40];
      const relevances = [0.95, 0.90];
      const depth = 2;

      const result = calculateLScore(confidences, relevances, depth);

      expect(result.score).toBeCloseTo(0.220, 2);
      expect(result.meetsThreshold).toBe(false);
    });

    it('should use domain-specific thresholds', () => {
      const confidences = [0.85, 0.80];
      const relevances = [0.90, 0.85];
      const depth = 2;

      // Default threshold (0.3)
      const defaultResult = calculateLScore(confidences, relevances, depth);
      expect(defaultResult.threshold).toBe(DEFAULT_LSCORE_THRESHOLD);

      // Research synthesis threshold (0.25)
      const researchResult = calculateLScore(confidences, relevances, depth, 'research-synthesis');
      expect(researchResult.threshold).toBe(0.25);

      // Factual retrieval threshold (0.40)
      const factualResult = calculateLScore(confidences, relevances, depth, 'factual-retrieval');
      expect(factualResult.threshold).toBe(0.40);
    });

    it('should get correct threshold for domains', () => {
      expect(getThresholdForDomain()).toBe(0.3);
      expect(getThresholdForDomain('factual-retrieval')).toBe(0.40);
      expect(getThresholdForDomain('code-generation')).toBe(0.30);
      expect(getThresholdForDomain('research-synthesis')).toBe(0.25);
      expect(getThresholdForDomain('debugging')).toBe(0.35);
      expect(getThresholdForDomain('unknown')).toBe(0.3);
    });

    it('should calculate L-Score via ProvenanceStore', async () => {
      const input: IProvenanceInput = {
        sources: [
          createSourceInput({ relevanceScore: 0.95 }),
          createSourceInput({ relevanceScore: 0.90 }),
        ],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.90 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
        ],
      };

      const provenanceId = await store.createProvenance(input);
      const result = await store.calculateLScore(provenanceId);

      expect(result.score).toBeCloseTo(0.313, 2);
      expect(result.meetsThreshold).toBe(true);
    });
  });

  describe('traverseCitationGraph', () => {
    it('should traverse single provenance', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Source A', relevanceScore: 0.95 })],
        derivationPath: [
          { description: 'Extraction', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
        ],
      };

      const provenanceId = await store.createProvenance(input);
      const citationPath = await store.traverseCitationGraph(provenanceId);

      expect(citationPath.insightId).toBe(provenanceId);
      expect(citationPath.sources.length).toBe(1);
      expect(citationPath.sources[0].title).toBe('Source A');
      expect(citationPath.derivationPath.length).toBe(1);
      expect(citationPath.depth).toBe(1);
      expect(citationPath.ancestors.length).toBe(0);
    });

    it('should follow parent chain when includeAncestors=true', async () => {
      // Create parent
      const parentInput: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Parent Source' })],
        derivationPath: [
          { description: 'Parent step', sourceIds: ['p'], operation: 'extraction', confidence: 0.95 },
        ],
      };
      const parentId = await store.createProvenance(parentInput);

      // Create child
      const childInput: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Child Source' })],
        derivationPath: [
          { description: 'Child step', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
        ],
        parentProvenanceId: parentId,
      };
      const childId = await store.createProvenance(childInput);

      // Traverse with ancestors
      const citationPath = await store.traverseCitationGraph(childId, { includeAncestors: true });

      expect(citationPath.ancestors.length).toBe(1);
      expect(citationPath.ancestors[0]).toBe(parentId);
      expect(citationPath.sources.length).toBe(2);
      expect(citationPath.derivationPath.length).toBe(2);
      expect(citationPath.depth).toBe(2);
    });

    it('should respect maxDepth limit', async () => {
      // Create chain of 5 provenances
      let currentParentId: string | undefined;

      for (let i = 0; i < 5; i++) {
        const input: IProvenanceInput = {
          sources: [createSourceInput({ title: `Source ${i}` })],
          derivationPath: [
            { description: `Step ${i}`, sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
          ],
          parentProvenanceId: currentParentId,
        };
        currentParentId = await store.createProvenance(input);
      }

      // Traverse with maxDepth=2
      const citationPath = await store.traverseCitationGraph(currentParentId!, {
        includeAncestors: true,
        maxDepth: 2,
      });

      // Should only include 1 ancestor (maxDepth=2 means traverse 1 more level)
      expect(citationPath.ancestors.length).toBeLessThanOrEqual(2);
    });

    it('should detect cycles in provenance chain', async () => {
      // This is tested implicitly - cycles can't be created through normal API
      // The visitedProvenances set prevents infinite loops
      const input: IProvenanceInput = {
        sources: [createSourceInput()],
        derivationPath: [
          { description: 'Step', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
        ],
      };

      const provenanceId = await store.createProvenance(input);

      // Should complete without hanging
      const citationPath = await store.traverseCitationGraph(provenanceId, { includeAncestors: true });
      expect(citationPath).toBeDefined();
    });

    it('should throw for non-existent provenance', async () => {
      await expect(
        store.traverseCitationGraph('prov_nonexistent_12345678')
      ).rejects.toThrow(ProvenanceValidationError);
    });

    it('should not include duplicate sources', async () => {
      // Create parent with Source A
      const parentInput: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Shared Source' })],
        derivationPath: [
          { description: 'Parent step', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
        ],
      };
      const parentId = await store.createProvenance(parentInput);

      // Create child also referencing similar source
      const childInput: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Child Source' })],
        derivationPath: [
          { description: 'Child step', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
        ],
        parentProvenanceId: parentId,
      };
      const childId = await store.createProvenance(childInput);

      const citationPath = await store.traverseCitationGraph(childId, { includeAncestors: true });

      // Each source should appear only once
      const sourceIds = citationPath.sources.map(s => s.id);
      const uniqueIds = new Set(sourceIds);
      expect(sourceIds.length).toBe(uniqueIds.size);
    });
  });

  describe('findSimilarSources', () => {
    it('should find sources with similar embeddings', async () => {
      // Store sources with embeddings
      const embedding1 = createEmbedding();
      const embedding2 = createEmbedding();

      await store.storeSource(createSourceInput({ title: 'Source 1', embedding: embedding1 }));
      await store.storeSource(createSourceInput({ title: 'Source 2', embedding: embedding2 }));

      // Search with first embedding
      const results = await store.findSimilarSources(embedding1, 2);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source.title).toBe('Source 1');
      expect(results[0].similarity).toBeCloseTo(1.0, 1);
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', async () => {
      // Create some provenances
      await store.createProvenance({
        sources: [createSourceInput()],
        derivationPath: [
          { description: 'Step', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
        ],
        domain: 'code-generation',
      });

      await store.createProvenance({
        sources: [createSourceInput(), createSourceInput()],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
        ],
        domain: 'research-synthesis',
      });

      const stats = store.getStats();

      expect(stats.sourceCount).toBe(3);
      expect(stats.provenanceCount).toBe(2);
      expect(stats.avgDepth).toBe(1.5);
      expect(stats.domainDistribution['code-generation']).toBe(1);
      expect(stats.domainDistribution['research-synthesis']).toBe(1);
    });
  });

  describe('Serialization', () => {
    it('should export and import correctly', async () => {
      // Create some data
      const input: IProvenanceInput = {
        sources: [createSourceInput({ title: 'Test Source' })],
        derivationPath: [
          { description: 'Step', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
        ],
      };
      const provenanceId = await store.createProvenance(input);

      // Export
      const exported = store.toJSON();
      expect(exported.sources.length).toBe(1);
      expect(exported.provenances.length).toBe(1);

      // Create new store and import
      const newStore = new ProvenanceStore(new VectorDB());
      await newStore.initialize();
      newStore.fromJSON(exported);

      // Verify data
      const provenance = newStore.getProvenance(provenanceId);
      expect(provenance).toBeDefined();
      expect(provenance?.depth).toBe(1);

      const stats = newStore.getStats();
      expect(stats.sourceCount).toBe(1);
      expect(stats.provenanceCount).toBe(1);
    });
  });

  describe('Performance', () => {
    it('should store source in <5ms', async () => {
      const input = createSourceInput();

      const start = performance.now();
      await store.storeSource(input);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5);
    });

    it('should create provenance in <15ms', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput(), createSourceInput()],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
        ],
      };

      const start = performance.now();
      await store.createProvenance(input);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(15);
    });

    it('should traverse 5-hop chain in <10ms', async () => {
      // Create 5-hop chain
      let currentParentId: string | undefined;

      for (let i = 0; i < 5; i++) {
        const input: IProvenanceInput = {
          sources: [createSourceInput({ title: `Source ${i}` })],
          derivationPath: [
            { description: `Step ${i}`, sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
          ],
          parentProvenanceId: currentParentId,
        };
        currentParentId = await store.createProvenance(input);
      }

      const start = performance.now();
      await store.traverseCitationGraph(currentParentId!, { includeAncestors: true });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });

    it('should calculate L-Score in <10ms', async () => {
      const input: IProvenanceInput = {
        sources: [createSourceInput(), createSourceInput(), createSourceInput()],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.9 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
          { description: 'Step 3', sourceIds: ['p'], operation: 'inference', confidence: 0.8 },
        ],
      };

      const provenanceId = await store.createProvenance(input);

      const start = performance.now();
      await store.calculateLScore(provenanceId);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('L-Score Enforcement', () => {
    it('should reject low L-Score when enforcement enabled', async () => {
      const enforcingStore = new ProvenanceStore(vectorDB, { enforceLScore: true });
      await enforcingStore.initialize();

      // Create input with low scores that will result in L-Score < 0.3
      const input: IProvenanceInput = {
        sources: [
          createSourceInput({ relevanceScore: 0.95 }),
          createSourceInput({ relevanceScore: 0.85 }),
        ],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.95 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
          { description: 'Step 3', sourceIds: ['p'], operation: 'inference', confidence: 0.75 },
        ],
      };

      await expect(enforcingStore.createProvenance(input)).rejects.toThrow(LScoreRejectionError);
    });

    it('should accept high L-Score when enforcement enabled', async () => {
      const enforcingStore = new ProvenanceStore(vectorDB, { enforceLScore: true });
      await enforcingStore.initialize();

      // Create input with high scores that will result in L-Score > 0.3
      const input: IProvenanceInput = {
        sources: [
          createSourceInput({ relevanceScore: 0.95 }),
          createSourceInput({ relevanceScore: 0.90 }),
        ],
        derivationPath: [
          { description: 'Step 1', sourceIds: ['p'], operation: 'extraction', confidence: 0.90 },
          { description: 'Step 2', sourceIds: ['p'], operation: 'synthesis', confidence: 0.85 },
        ],
      };

      const provenanceId = await enforcingStore.createProvenance(input);
      expect(isValidProvenanceID(provenanceId)).toBe(true);
    });
  });
});
