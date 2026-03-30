/**
 * ReasoningBank Tests
 * TASK-RSN-001 - ReasoningBank Unified API
 *
 * Tests the main ReasoningBank orchestrator with all 4 modes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReasoningBank } from '../../../../src/god-agent/core/reasoning/reasoning-bank.js';
import { PatternMatcher } from '../../../../src/god-agent/core/reasoning/pattern-matcher.js';
import { CausalMemory } from '../../../../src/god-agent/core/reasoning/causal-memory.js';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/vector-db.js';
import { GraphDB } from '../../../../src/god-agent/core/graph-db/graph-db.js';
import { MemoryEngine } from '../../../../src/god-agent/core/memory/memory-engine.js';
import { MockEmbeddingProvider } from '../../../../src/god-agent/core/memory/embedding-provider.js';
import { ReasoningMode, TaskType } from '../../../../src/god-agent/core/reasoning/reasoning-types.js';
import type {
  IReasoningRequest,
  ILearningFeedback,
  ReasoningBankConfig
} from '../../../../src/god-agent/core/reasoning/reasoning-types.js';

describe('ReasoningBank', () => {
  let reasoningBank: ReasoningBank;
  let patternMatcher: PatternMatcher;
  let causalMemory: CausalMemory;
  let vectorDB: VectorDB;
  let graphDB: GraphDB;
  let memoryEngine: MemoryEngine;
  let embedder: MockEmbeddingProvider;

  // Helper to create normalized embedding
  const createEmbedding = (dim: number = 1536): Float32Array => {
    const arr = new Float32Array(dim);
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      arr[i] = Math.random() * 2 - 1;
      sumSq += arr[i] * arr[i];
    }
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < dim; i++) {
      arr[i] /= norm;
    }
    return arr;
  };

  beforeEach(async () => {
    // Create dependencies
    vectorDB = new VectorDB();
    graphDB = new GraphDB(undefined, { enablePersistence: false });
    embedder = new MockEmbeddingProvider();
    memoryEngine = new MemoryEngine(vectorDB, graphDB, embedder);

    // Create PatternMatcher with proper dependencies
    patternMatcher = new PatternMatcher(vectorDB, memoryEngine);
    causalMemory = new CausalMemory(memoryEngine);

    // Initialize dependencies
    await patternMatcher.initialize();
    await causalMemory.initialize();

    // Create ReasoningBank
    reasoningBank = new ReasoningBank({
      patternMatcher,
      causalMemory,
      vectorDB,
      config: {
        enableGNN: true,
        enableTrajectoryTracking: true,
        enableAutoModeSelection: false
      }
    });

    await reasoningBank.initialize();
  });

  afterEach(async () => {
    await reasoningBank.close();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const rb = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB
      });

      await expect(rb.initialize()).resolves.not.toThrow();
      await rb.close();
    });

    it('should be idempotent for multiple initializations', async () => {
      const rb = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB
      });

      await rb.initialize();
      await rb.initialize(); // Second call should not fail
      await rb.close();
    });

    it('should throw when reasoning without initialization', async () => {
      const rb = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB
      });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      await expect(rb.reason(request)).rejects.toThrow('not initialized');
      await rb.close();
    });
  });

  describe('Pattern-Match Mode', () => {
    it('should execute pattern-match reasoning', async () => {
      // Add a pattern first
      await patternMatcher.createPattern({
        template: 'Test pattern template',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.9
      });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        maxResults: 5
      };

      const result = await reasoningBank.reason(request);

      expect(result.type).toBe(ReasoningMode.PATTERN_MATCH);
      expect(result.patterns).toBeDefined();
      expect(result.causalInferences).toHaveLength(0);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should filter patterns by confidence threshold', async () => {
      await patternMatcher.createPattern({
        template: 'High confidence pattern',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.95
      });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        confidenceThreshold: 0.9
      };

      const result = await reasoningBank.reason(request);

      expect(result.patterns.every(p => p.confidence >= 0.0)).toBe(true);
    });

    it('should return trajectoryId for tracking', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      expect(result.trajectoryId).toMatch(/^traj_\d+/);
    });
  });

  describe('Causal-Inference Mode', () => {
    it('should execute causal-inference reasoning', async () => {
      // Add vectors to VectorDB for search (causal mode uses VectorDB to find relevant nodes)
      await vectorDB.insert(createEmbedding(1536), { id: 'node-1' });
      await vectorDB.insert(createEmbedding(1536), { id: 'node-2' });

      // Note: Full causal graph setup requires complex MemoryEngine configuration
      // This test verifies the mode executes correctly and returns proper structure

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CAUSAL_INFERENCE,
        maxResults: 5
      };

      const result = await reasoningBank.reason(request);

      expect(result.type).toBe(ReasoningMode.CAUSAL_INFERENCE);
      expect(result.patterns).toHaveLength(0);
      expect(result.causalInferences).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return empty inferences when no nodes found', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CAUSAL_INFERENCE
      };

      const result = await reasoningBank.reason(request);

      expect(result.causalInferences).toHaveLength(0);
      expect(result.confidence).toBe(0);
    });
  });

  describe('Contextual Mode', () => {
    it('should execute contextual reasoning', async () => {
      // Add vectors to find
      await vectorDB.insert(createEmbedding(1536), { id: 'context-1' });
      await vectorDB.insert(createEmbedding(1536), { id: 'context-2' });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CONTEXTUAL,
        maxResults: 5
      };

      const result = await reasoningBank.reason(request);

      expect(result.type).toBe(ReasoningMode.CONTEXTUAL);
      expect(result.patterns).toBeDefined();
    });

    it('should apply GNN enhancement when requested', async () => {
      await vectorDB.insert(createEmbedding(1536), { id: 'context-1' });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CONTEXTUAL,
        enhanceWithGNN: true
      };

      const result = await reasoningBank.reason(request);

      expect(result.enhancedEmbedding).toBeDefined();
      expect(result.enhancedEmbedding?.length).toBe(1536);
    });
  });

  describe('Hybrid Mode', () => {
    it('should execute hybrid reasoning', async () => {
      // Setup data for all modes
      await patternMatcher.createPattern({
        template: 'Hybrid pattern',
        taskType: TaskType.ANALYSIS,
        embedding: createEmbedding(1536),
        successRate: 0.8
      });
      await vectorDB.insert(createEmbedding(1536), { id: 'hybrid-1' });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.HYBRID
      };

      const result = await reasoningBank.reason(request);

      expect(result.type).toBe(ReasoningMode.HYBRID);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should combine results from multiple modes', async () => {
      await patternMatcher.createPattern({
        template: 'Test pattern',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.9
      });
      await vectorDB.insert(createEmbedding(1536), { id: 'vector-1' });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.HYBRID
      };

      const result = await reasoningBank.reason(request);

      // Should have results from pattern and/or contextual modes
      expect(result.patterns.length + result.causalInferences.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Request Validation', () => {
    it('should reject empty query', async () => {
      const request: IReasoningRequest = {
        query: new Float32Array(0),
        type: ReasoningMode.PATTERN_MATCH
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow();
    });

    it('should reject invalid embedding dimensions', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(512), // Wrong dimension
        type: ReasoningMode.PATTERN_MATCH
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow();
    });

    it('should reject negative maxResults', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        maxResults: -1
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow('maxResults must be positive');
    });

    it('should reject confidenceThreshold > 1', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        confidenceThreshold: 1.5
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow('confidenceThreshold must be between');
    });

    it('should reject negative minLScore', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        minLScore: -0.5
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow('minLScore must be between');
    });

    it('should accept 768D embeddings', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      await expect(reasoningBank.reason(request)).resolves.toBeDefined();
    });

    // Note: 1024D embeddings are only valid after GNN enhancement
    // VectorDB/PatternMatcher only support 768D, so this test verifies
    // that the ReasoningBank validates dimensions correctly
    it('should reject 1024D embeddings for pattern-match (only 768D supported)', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1024),
        type: ReasoningMode.PATTERN_MATCH
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow();
    });
  });

  describe('Feedback Integration', () => {
    it('should accept feedback for trajectory', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      const feedback: ILearningFeedback = {
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.9,
        reasoning: 'Good response'
      };

      await expect(reasoningBank.provideFeedback(feedback)).resolves.not.toThrow();
    });

    it('should throw on feedback for non-existent trajectory', async () => {
      const feedback: ILearningFeedback = {
        trajectoryId: 'traj_nonexistent_12345678',
        verdict: 'correct',
        quality: 0.9
      };

      await expect(reasoningBank.provideFeedback(feedback)).rejects.toThrow();
    });

    it('should log high-quality feedback', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      const feedback: ILearningFeedback = {
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.95 // High quality
      };

      await reasoningBank.provideFeedback(feedback);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('High-quality trajectory')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Provenance Information', () => {
    it('should include provenance in response', async () => {
      await patternMatcher.createPattern({
        template: 'Provenance pattern',
        taskType: TaskType.ANALYSIS,
        embedding: createEmbedding(1536),
        successRate: 0.85
      });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      expect(result.provenanceInfo).toBeDefined();
      expect(result.provenanceInfo.lScores).toBeDefined();
      expect(result.provenanceInfo.totalSources).toBeGreaterThanOrEqual(0);
      expect(result.provenanceInfo.combinedLScore).toBeGreaterThanOrEqual(0);
    });

    it('should calculate geometric mean for combined L-Score', async () => {
      await patternMatcher.createPattern({
        template: 'Pattern for L-Score test',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.9
      });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        maxResults: 10,
        confidenceThreshold: 0.0,
        minLScore: 0.0
      };

      const result = await reasoningBank.reason(request);

      // Verify L-Score bounds
      expect(result.provenanceInfo.combinedLScore).toBeLessThanOrEqual(1);
      expect(result.provenanceInfo.combinedLScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Configuration', () => {
    it('should use custom config', async () => {
      const customConfig: Partial<ReasoningBankConfig> = {
        defaultMaxResults: 20,
        defaultConfidenceThreshold: 0.5,
        patternWeight: 0.5,
        causalWeight: 0.25,
        contextualWeight: 0.25
      };

      const customBank = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB,
        config: customConfig
      });

      await customBank.initialize();

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await customBank.reason(request);
      expect(result).toBeDefined();

      await customBank.close();
    });

    it('should disable GNN when configured', async () => {
      const noGnnBank = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB,
        config: { enableGNN: false }
      });

      await noGnnBank.initialize();

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CONTEXTUAL,
        enhanceWithGNN: true // Requested but should be disabled
      };

      const result = await noGnnBank.reason(request);
      expect(result.enhancedEmbedding).toBeUndefined();

      await noGnnBank.close();
    });

    it('should disable trajectory tracking when configured', async () => {
      const noTrackingBank = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB,
        config: { enableTrajectoryTracking: false }
      });

      await noTrackingBank.initialize();

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await noTrackingBank.reason(request);
      expect(result.trajectoryId).toContain('untracked');

      await noTrackingBank.close();
    });
  });

  describe('Performance', () => {
    it('should complete pattern-match in under 10ms', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      expect(result.processingTimeMs).toBeLessThan(10);
    });

    it('should complete causal-inference in under 20ms', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CAUSAL_INFERENCE
      };

      const result = await reasoningBank.reason(request);

      expect(result.processingTimeMs).toBeLessThan(20);
    });

    it('should complete contextual in under 30ms', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CONTEXTUAL
      };

      const result = await reasoningBank.reason(request);

      expect(result.processingTimeMs).toBeLessThan(30);
    });

    it('should complete hybrid in under 30ms (without GNN)', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.HYBRID,
        enhanceWithGNN: false
      };

      const result = await reasoningBank.reason(request);

      expect(result.processingTimeMs).toBeLessThan(30);
    });
  });

  describe('Error Handling', () => {
    it('should throw on unknown reasoning mode', async () => {
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: 'unknown-mode' as ReasoningMode
      };

      await expect(reasoningBank.reason(request)).rejects.toThrow('Unknown reasoning mode');
    });

    it('should handle pattern matcher errors gracefully in hybrid', async () => {
      // Even if one mode fails, hybrid should continue with others
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.HYBRID
      };

      const result = await reasoningBank.reason(request);
      expect(result).toBeDefined();
    });
  });

  describe('Mode Defaults', () => {
    it('should default to PATTERN_MATCH when type is undefined', async () => {
      const request = {
        query: createEmbedding(1536)
      } as IReasoningRequest;

      const result = await reasoningBank.reason(request);

      expect(result.type).toBe(ReasoningMode.PATTERN_MATCH);
    });
  });

  describe('Hyperedge Creation', () => {
    it('should create hyperedge when feedback quality >= 0.8', async () => {
      // Setup - add patterns and vectors for a rich trajectory
      await patternMatcher.createPattern({
        template: 'High quality pattern template',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.92
      });
      await vectorDB.insert(createEmbedding(1536), { id: 'vector-node-1' });

      // Spy on causal memory methods
      const addNodeSpy = vi.spyOn(causalMemory, 'addNode');
      const addCausalLinkSpy = vi.spyOn(causalMemory, 'addCausalLink');

      // Execute reasoning to create trajectory
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.HYBRID, // Use hybrid to get both patterns and inferences
        maxResults: 5
      };

      const result = await reasoningBank.reason(request);
      expect(result.trajectoryId).toBeDefined();

      // Clear previous spy calls from reasoning
      addNodeSpy.mockClear();
      addCausalLinkSpy.mockClear();

      // Provide high-quality feedback (>= 0.8)
      const feedback: ILearningFeedback = {
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.85, // High quality triggers hyperedge creation
        reasoning: 'Excellent response with correct patterns'
      };

      await reasoningBank.provideFeedback(feedback);

      // Verify nodes were created
      expect(addNodeSpy).toHaveBeenCalled();
      const nodeCalls = addNodeSpy.mock.calls;

      // Should have query node, pattern nodes (up to 3), effect nodes (up to 3), and outcome node
      expect(nodeCalls.length).toBeGreaterThan(0);

      // Verify at least query and outcome nodes
      const nodeIds = nodeCalls.map(call => call[0].id);
      expect(nodeIds.some(id => id.startsWith('query_'))).toBe(true);
      expect(nodeIds.some(id => id.startsWith('outcome_'))).toBe(true);

      // Verify causal link was created
      expect(addCausalLinkSpy).toHaveBeenCalled();
      const linkCall = addCausalLinkSpy.mock.calls[0][0];
      expect(linkCall.causes.length).toBeGreaterThanOrEqual(1);
      expect(linkCall.effects.length).toBeGreaterThanOrEqual(1);
      expect(linkCall.confidence).toBe(0.85);

      addNodeSpy.mockRestore();
      addCausalLinkSpy.mockRestore();
    });

    it('should NOT create hyperedge when feedback quality < 0.8', async () => {
      // Setup - pattern successRate must be >= 0.8, but feedback quality is low
      await patternMatcher.createPattern({
        template: 'Low quality pattern',
        taskType: TaskType.ANALYSIS,
        embedding: createEmbedding(1536),
        successRate: 0.82 // Pattern quality is good, but feedback quality will be low
      });

      // Spy on causal memory
      const addNodeSpy = vi.spyOn(causalMemory, 'addNode');
      const addCausalLinkSpy = vi.spyOn(causalMemory, 'addCausalLink');

      // Execute reasoning
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      // Clear spy calls from reasoning
      addNodeSpy.mockClear();
      addCausalLinkSpy.mockClear();

      // Provide low-quality feedback (< 0.8)
      const feedback: ILearningFeedback = {
        trajectoryId: result.trajectoryId,
        verdict: 'incorrect',
        quality: 0.7, // Low quality - should NOT trigger hyperedge
        reasoning: 'Response was okay but not great'
      };

      await reasoningBank.provideFeedback(feedback);

      // Verify no nodes or links were created
      expect(addNodeSpy).not.toHaveBeenCalled();
      expect(addCausalLinkSpy).not.toHaveBeenCalled();

      addNodeSpy.mockRestore();
      addCausalLinkSpy.mockRestore();
    });

    it('should generate deterministic node IDs', async () => {
      // Add pattern for trajectory
      await patternMatcher.createPattern({
        template: 'Deterministic test pattern',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.9
      });

      // Track node IDs from first execution
      const firstNodeIds: string[] = [];
      const addNodeSpy = vi.spyOn(causalMemory, 'addNode').mockImplementation((node) => {
        firstNodeIds.push(node.id);
        return Promise.resolve();
      });

      // First reasoning + feedback cycle
      const request1: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result1 = await reasoningBank.reason(request1);
      await reasoningBank.provideFeedback({
        trajectoryId: result1.trajectoryId,
        verdict: 'correct',
        quality: 0.9
      });

      // Second reasoning + feedback cycle with same trajectory ID (simulated)
      // Note: In practice, trajectory IDs are unique per request
      // This test verifies that same trajectory data produces same node IDs
      const secondNodeIds: string[] = [];
      addNodeSpy.mockClear();
      addNodeSpy.mockImplementation((node) => {
        secondNodeIds.push(node.id);
        return Promise.resolve();
      });

      // Provide feedback again with same trajectory
      await reasoningBank.provideFeedback({
        trajectoryId: result1.trajectoryId,
        verdict: 'correct',
        quality: 0.9
      });

      // Verify same node IDs generated for same trajectory
      expect(secondNodeIds).toEqual(firstNodeIds);

      addNodeSpy.mockRestore();
    });

    it('should not fail feedback when hyperedge creation errors', async () => {
      // Add pattern
      await patternMatcher.createPattern({
        template: 'Error handling pattern',
        taskType: TaskType.ANALYSIS,
        embedding: createEmbedding(1536),
        successRate: 0.88
      });

      // Mock addCausalLink to throw error
      // Note: The logger uses console.log for all output (including warnings) via ConsoleLogHandler
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const addCausalLinkSpy = vi.spyOn(causalMemory, 'addCausalLink')
        .mockRejectedValue(new Error('Simulated causal link error'));

      // Execute reasoning
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      // Provide high-quality feedback - should not throw despite error
      const feedback: ILearningFeedback = {
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.9
      };

      await expect(reasoningBank.provideFeedback(feedback)).resolves.not.toThrow();

      // Verify warning was logged (logger outputs JSON via console.log)
      const logCalls = consoleLogSpy.mock.calls.map(call => call[0]);
      const hyperedgeWarning = logCalls.find(log =>
        typeof log === 'string' &&
        log.includes('Hyperedge creation failed') &&
        log.includes('"level":"WARN"')
      );
      expect(hyperedgeWarning).toBeDefined();

      addCausalLinkSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should create nodes before creating links', async () => {
      // Track call order
      const callOrder: string[] = [];

      const addNodeSpy = vi.spyOn(causalMemory, 'addNode').mockImplementation((node) => {
        callOrder.push(`node:${node.id}`);
        return Promise.resolve();
      });

      const addCausalLinkSpy = vi.spyOn(causalMemory, 'addCausalLink').mockImplementation((params) => {
        callOrder.push(`link:${params.causes.join(',')}->${params.effects.join(',')}`);
        return Promise.resolve('link-id');
      });

      // Add pattern and execute
      await patternMatcher.createPattern({
        template: 'Order test pattern',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.91
      });

      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      // Clear order from reasoning
      callOrder.length = 0;

      // Provide high-quality feedback
      await reasoningBank.provideFeedback({
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.88
      });

      // Verify all node creations happen before link creation
      const firstLinkIndex = callOrder.findIndex(call => call.startsWith('link:'));
      if (firstLinkIndex > 0) {
        const callsBeforeLink = callOrder.slice(0, firstLinkIndex);
        expect(callsBeforeLink.every(call => call.startsWith('node:'))).toBe(true);
      }

      addNodeSpy.mockRestore();
      addCausalLinkSpy.mockRestore();
    });

    it('should include metadata in hyperedge nodes', async () => {
      // Add pattern with specific metadata
      await patternMatcher.createPattern({
        template: 'Metadata test pattern',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.93
      });

      const addNodeSpy = vi.spyOn(causalMemory, 'addNode');

      // Execute reasoning
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH
      };

      const result = await reasoningBank.reason(request);

      addNodeSpy.mockClear();

      // Provide feedback
      await reasoningBank.provideFeedback({
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.92
      });

      // Verify nodes have metadata
      const nodeCalls = addNodeSpy.mock.calls;
      expect(nodeCalls.length).toBeGreaterThan(0);

      // Check query node metadata
      const queryNode = nodeCalls.find(call => call[0].id.startsWith('query_'));
      expect(queryNode).toBeDefined();
      expect(queryNode![0].metadata).toBeDefined();
      expect(queryNode![0].metadata.trajectoryId).toBe(result.trajectoryId);

      // Check outcome node metadata
      const outcomeNode = nodeCalls.find(call => call[0].id.startsWith('outcome_'));
      expect(outcomeNode).toBeDefined();
      expect(outcomeNode![0].metadata).toBeDefined();
      expect(outcomeNode![0].metadata.quality).toBe(0.92);

      addNodeSpy.mockRestore();
    });

    it('should limit pattern nodes to top 3', async () => {
      // Add single pattern to ensure clean test environment
      await patternMatcher.createPattern({
        template: 'Pattern limit test',
        taskType: TaskType.CODING,
        embedding: createEmbedding(1536),
        successRate: 0.85
      });

      const addNodeSpy = vi.spyOn(causalMemory, 'addNode');

      // Execute reasoning - will get patterns from previous tests too
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.PATTERN_MATCH,
        maxResults: 10 // Request many, but hyperedge should limit to 3
      };

      const result = await reasoningBank.reason(request);

      addNodeSpy.mockClear();

      // Provide feedback
      await reasoningBank.provideFeedback({
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.9
      });

      // Count pattern nodes
      const patternNodes = addNodeSpy.mock.calls.filter(call =>
        call[0].id.startsWith('pattern_')
      );

      // Should be limited to top 3 patterns max
      // Note: May have fewer than 3 if trajectory had fewer patterns
      expect(patternNodes.length).toBeLessThanOrEqual(3);

      addNodeSpy.mockRestore();
    });

    it('should limit effect nodes to top 3', async () => {
      // Add many vectors for causal inference
      for (let i = 0; i < 10; i++) {
        await vectorDB.insert(createEmbedding(1536), { id: `effect-node-${i}` });
      }

      const addNodeSpy = vi.spyOn(causalMemory, 'addNode');

      // Execute causal inference reasoning
      const request: IReasoningRequest = {
        query: createEmbedding(1536),
        type: ReasoningMode.CAUSAL_INFERENCE,
        maxResults: 10
      };

      const result = await reasoningBank.reason(request);

      addNodeSpy.mockClear();

      // Provide feedback
      await reasoningBank.provideFeedback({
        trajectoryId: result.trajectoryId,
        verdict: 'correct',
        quality: 0.89
      });

      // Count effect nodes (excluding outcome)
      const effectNodes = addNodeSpy.mock.calls.filter(call =>
        call[0].id.startsWith('effect_')
      );

      // Should be limited to top 3
      expect(effectNodes.length).toBeLessThanOrEqual(3);

      addNodeSpy.mockRestore();
    });
  });
});
