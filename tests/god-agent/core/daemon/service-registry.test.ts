/**
 * Service Registry Tests
 * TASK-DAEMON-003: Service Registry & Integration
 *
 * Tests for ServiceRegistry with all 8 services (6 real + 2 placeholders)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry, createServiceHandler, ServiceRegistryError } from '../../../../src/god-agent/core/daemon/service-registry.js';
import { RpcErrorCode } from '../../../../src/god-agent/core/daemon/protocol-types.js';

// Import service factories
import {
  createVectorService,
  createGraphService,
  createSearchService,
  createSonaService,
  createReasoningService,
  createGNNService,
  createEpisodeService,
  createHyperedgeService,
} from '../../../../src/god-agent/core/daemon/services/index.js';

// Import actual implementations for testing
import { FallbackHNSW } from '../../../../src/god-agent/core/vector-db/fallback-hnsw.js';
import { GraphDB } from '../../../../src/god-agent/core/graph-db/graph-db.js';
import { FallbackGraph } from '../../../../src/god-agent/core/graph-db/fallback-graph.js';
import { UnifiedSearch } from '../../../../src/god-agent/core/search/unified-search.js';
import { SonaEngine } from '../../../../src/god-agent/core/learning/sona-engine.js';
import { ReasoningBank } from '../../../../src/god-agent/core/reasoning/reasoning-bank.js';
import { GNNEnhancer } from '../../../../src/god-agent/core/reasoning/gnn-enhancer.js';
import { PatternMatcher } from '../../../../src/god-agent/core/reasoning/pattern-matcher.js';
import { CausalMemory } from '../../../../src/god-agent/core/reasoning/causal-memory.js';
import { VectorDB } from '../../../../src/god-agent/core/vector-db/vector-db.js';
import { MemoryClient } from '../../../../src/god-agent/core/memory-server/memory-client.js';
import { DistanceMetric } from '../../../../src/god-agent/core/vector-db/types.js';

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Basic Operations', () => {
    it('should register a service', () => {
      const handler = createServiceHandler({
        hello: async () => 'world',
      });

      registry.registerService('test', handler);
      expect(registry.hasService('test')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should list registered services', () => {
      const handler1 = createServiceHandler({ method: async () => 'result' });
      const handler2 = createServiceHandler({ method: async () => 'result' });

      registry.registerService('service1', handler1);
      registry.registerService('service2', handler2);

      const services = registry.listServices();
      expect(services).toEqual(['service1', 'service2']);
    });

    it('should unregister a service', () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      registry.registerService('test', handler);

      const removed = registry.unregisterService('test');
      expect(removed).toBe(true);
      expect(registry.hasService('test')).toBe(false);
    });

    it('should call a service method', async () => {
      const handler = createServiceHandler({
        add: async (params: { a: number; b: number }) => params.a + params.b,
      });

      registry.registerService('math', handler);
      const result = await registry.callService('math', 'add', { a: 2, b: 3 });
      expect(result).toBe(5);
    });

    it('should throw error for non-existent service', async () => {
      await expect(
        registry.callService('nonexistent', 'method', {})
      ).rejects.toThrow(ServiceRegistryError);

      try {
        await registry.callService('nonexistent', 'method', {});
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceRegistryError);
        expect((error as ServiceRegistryError).code).toBe(RpcErrorCode.METHOD_NOT_FOUND);
      }
    });

    it('should throw error for non-existent method', async () => {
      const handler = createServiceHandler({ hello: async () => 'world' });
      registry.registerService('test', handler);

      await expect(
        registry.callService('test', 'goodbye', {})
      ).rejects.toThrow(ServiceRegistryError);
    });

    it('should normalize service names to lowercase', () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      registry.registerService('MyService', handler);

      expect(registry.hasService('myservice')).toBe(true);
      expect(registry.hasService('MyService')).toBe(true);
      expect(registry.hasService('MYSERVICE')).toBe(true);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track call counts', async () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      registry.registerService('test', handler);

      await registry.callService('test', 'method', {});
      await registry.callService('test', 'method', {});

      const metrics = registry.getServiceMetrics('test');
      expect(metrics?.callCount).toBe(2);
    });

    it('should track error counts', async () => {
      const handler = createServiceHandler({
        fail: async () => {
          throw new Error('Test error');
        },
      });
      registry.registerService('test', handler);

      await expect(registry.callService('test', 'fail', {})).rejects.toThrow();

      const metrics = registry.getServiceMetrics('test');
      expect(metrics?.errorCount).toBe(1);
    });

    it('should track total duration', async () => {
      const handler = createServiceHandler({
        slow: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        },
      });
      registry.registerService('test', handler);

      await registry.callService('test', 'slow', {});

      const metrics = registry.getServiceMetrics('test');
      expect(metrics?.totalDurationMs).toBeGreaterThan(0);
      expect(metrics?.avgDurationMs).toBeGreaterThan(0);
    });

    it('should update lastCalledAt timestamp', async () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      registry.registerService('test', handler);

      const before = Date.now();
      await registry.callService('test', 'method', {});
      const after = Date.now();

      const metrics = registry.getServiceMetrics('test');
      expect(metrics?.lastCalledAt).toBeGreaterThanOrEqual(before);
      expect(metrics?.lastCalledAt).toBeLessThanOrEqual(after);
    });

    it('should provide registry-wide metrics', async () => {
      const handler1 = createServiceHandler({ m1: async () => 'r1' });
      const handler2 = createServiceHandler({ m2: async () => 'r2' });

      registry.registerService('service1', handler1);
      registry.registerService('service2', handler2);

      await registry.callService('service1', 'm1', {});
      await registry.callService('service2', 'm2', {});

      const metrics = registry.getMetrics();
      expect(metrics.totalCalls).toBe(2);
      expect(metrics.servicesRegistered).toBe(2);
      expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(metrics.serviceMetrics.size).toBe(2);
    });

    it('should reset metrics', async () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      registry.registerService('test', handler);

      await registry.callService('test', 'method', {});
      expect(registry.getMetrics().totalCalls).toBe(1);

      registry.resetMetrics();
      expect(registry.getMetrics().totalCalls).toBe(0);

      const metrics = registry.getServiceMetrics('test');
      expect(metrics?.callCount).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should reject empty service name', () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      expect(() => registry.registerService('', handler)).toThrow(ServiceRegistryError);
    });

    it('should reject duplicate service registration', () => {
      const handler = createServiceHandler({ method: async () => 'result' });
      registry.registerService('test', handler);

      expect(() => registry.registerService('test', handler)).toThrow(ServiceRegistryError);
    });

    it('should reject invalid handler', () => {
      expect(() => registry.registerService('test', {} as any)).toThrow(ServiceRegistryError);
    });

    it('should wrap unknown errors in ServiceRegistryError', async () => {
      const handler = createServiceHandler({
        weird: async () => {
          throw { strange: 'object' };
        },
      });
      registry.registerService('test', handler);

      try {
        await registry.callService('test', 'weird', {});
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceRegistryError);
        expect((error as ServiceRegistryError).code).toBe(RpcErrorCode.INTERNAL_ERROR);
      }
    });
  });

  describe('Performance', () => {
    it('should handle stats operations in <10ms (p95)', async () => {
      const handler = createServiceHandler({ stats: async () => ({ count: 42 }) });
      registry.registerService('perf', handler);

      const iterations = 100;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await registry.callService('perf', 'stats', {});
        durations.push(performance.now() - start);
      }

      // Sort and get p95
      durations.sort((a, b) => a - b);
      const p95 = durations[Math.floor(iterations * 0.95)];

      expect(p95).toBeLessThan(10);
    });
  });

  describe('Service Method Builder', () => {
    it('should create handler from method map', async () => {
      const methods = {
        add: async (params: { a: number; b: number }) => params.a + params.b,
        multiply: async (params: { a: number; b: number }) => params.a * params.b,
      };

      const handler = createServiceHandler(methods);
      expect(handler.methods.size).toBe(2);
      expect(handler.methods.has('add')).toBe(true);
      expect(handler.methods.has('multiply')).toBe(true);
    });

    it('should skip non-function values', () => {
      const methods = {
        valid: async () => 'result',
        invalid: 'not a function' as any,
      };

      const handler = createServiceHandler(methods);
      expect(handler.methods.size).toBe(1);
      expect(handler.methods.has('valid')).toBe(true);
      expect(handler.methods.has('invalid')).toBe(false);
    });
  });

  describe('Vector Service Integration', () => {
    let vectorService: ReturnType<typeof createVectorService>;
    let backend: FallbackHNSW;

    beforeEach(() => {
      backend = new FallbackHNSW(1536, DistanceMetric.COSINE);
      vectorService = createVectorService(backend);
      registry.registerService('vector', vectorService);
    });

    it('should add vector via service', async () => {
      const result = await registry.callService('vector', 'add', {
        id: 'test1',
        vector: new Array(1536).fill(0.5),
      });
      expect(result).toEqual({ success: true });
      expect(backend.count()).toBe(1);
    });

    it('should search vectors via service', async () => {
      await registry.callService('vector', 'add', {
        id: 'test1',
        vector: new Array(1536).fill(0.5),
      });

      const results = await registry.callService('vector', 'search', {
        query: new Array(1536).fill(0.5),
        k: 1,
      });

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('test1');
    });

    it('should get vector stats via service', async () => {
      await registry.callService('vector', 'add', {
        id: 'test1',
        vector: new Array(1536).fill(0.5),
      });

      const stats = await registry.callService('vector', 'stats', {});
      expect(stats).toEqual({ count: 1, dimension: 1536 });
    });
  });

  describe('Graph Service Integration', () => {
    let graphService: ReturnType<typeof createGraphService>;
    let graphDB: GraphDB;

    beforeEach(async () => {
      const fallbackGraph = new FallbackGraph();
      graphDB = new GraphDB(fallbackGraph);
      await graphDB.initialize();
      graphService = createGraphService(graphDB);
      registry.registerService('graph', graphService);
    });

    it('should add node via service', async () => {
      // First node with root-level key (auto-links to graph:root)
      const result = await registry.callService('graph', 'addNode', {
        type: 'concept',
        properties: { key: 'test', name: 'test' },
      });

      expect(result).toHaveProperty('nodeId');
      const stats = await registry.callService('graph', 'stats', {});
      expect(stats.nodeCount).toBeGreaterThan(0);
    });

    it('should add edge via service', async () => {
      // First node with root-level key
      const node1 = await registry.callService('graph', 'addNode', {
        type: 'concept',
        properties: { key: 'node1', name: 'node1' },
      });
      // Second node linked to first
      const node2 = await registry.callService('graph', 'addNode', {
        type: 'concept',
        properties: { key: 'node2', name: 'node2' },
        linkTo: node1.nodeId,
      });

      const edge = await registry.callService('graph', 'addEdge', {
        source: node1.nodeId,
        target: node2.nodeId,
        type: 'related',
      });

      expect(edge).toHaveProperty('edgeId');
    });

    it('should query nodes via service', async () => {
      // Create first node with project namespace (root namespace auto-links)
      await registry.callService('graph', 'addNode', {
        type: 'concept',
        properties: { key: 'project/node1', namespace: 'project' },
      });

      const result = await registry.callService('graph', 'query', {
        namespace: 'project',
      });

      expect(result).toHaveProperty('nodes');
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('Search Service Integration', () => {
    it('should create search service placeholder', () => {
      // Search service requires complex dependencies - create minimal mock
      const mockSearch = {
        search: async () => ({
          query: 'test',
          results: [],
          metadata: { totalDurationMs: 0, sourcesResponded: 0, sourcesTimedOut: 0, rawResultCount: 0, dedupedResultCount: 0, correlationId: 'test' },
          sourceStats: { vector: { responded: false, durationMs: 0, resultCount: 0, timedOut: false }, graph: { responded: false, durationMs: 0, resultCount: 0, timedOut: false }, memory: { responded: false, durationMs: 0, resultCount: 0, timedOut: false }, pattern: { responded: false, durationMs: 0, resultCount: 0, timedOut: false } }
        }),
        updateWeights: () => {},
        getOptions: () => ({ weights: { vector: 0.25, graph: 0.25, memory: 0.25, pattern: 0.25 }, topK: 10, sourceTimeoutMs: 5000, graphDepth: 3, memoryNamespace: 'default', minPatternConfidence: 0.7 }),
      } as any;

      const searchService = createSearchService(mockSearch);
      registry.registerService('search', searchService);

      expect(registry.hasService('search')).toBe(true);
    });
  });

  describe('Sona Service Integration', () => {
    let sonaService: ReturnType<typeof createSonaService>;
    let sonaEngine: SonaEngine;

    beforeEach(async () => {
      sonaEngine = new SonaEngine();
      await sonaEngine.initialize();
      sonaService = createSonaService(sonaEngine);
      registry.registerService('sona', sonaService);
    });

    it('should create trajectory via service', async () => {
      const result = await registry.callService('sona', 'createTrajectory', {
        route: 'test.route',
        patterns: ['pattern1', 'pattern2'],
        context: ['context1'],
      });

      expect(result).toHaveProperty('trajectoryId');
      expect(typeof result.trajectoryId).toBe('string');
    });

    it('should get SONA stats via service', async () => {
      await registry.callService('sona', 'createTrajectory', {
        route: 'test.route',
        patterns: ['pattern1'],
      });

      const stats = await registry.callService('sona', 'getStats', {});
      expect(stats.trajectoryCount).toBeGreaterThan(0);
    });

    it('should provide feedback via service', async () => {
      const traj = await registry.callService('sona', 'createTrajectory', {
        route: 'test.route',
        patterns: ['pattern1'],
      });

      const result = await registry.callService('sona', 'provideFeedback', {
        trajectoryId: traj.trajectoryId,
        quality: 0.9,
      });

      expect(result).toHaveProperty('trajectoryId');
      expect(result.patternsUpdated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Reasoning Service Integration', () => {
    it('should create reasoning service placeholder', async () => {
      // Create minimal reasoning bank for testing
      const vectorDB = new VectorDB({ dimension: 1536, metric: DistanceMetric.COSINE });
      await vectorDB.initialize();

      const patternMatcher = new PatternMatcher(vectorDB);
      const causalMemory = new CausalMemory();

      const reasoningBank = new ReasoningBank({
        patternMatcher,
        causalMemory,
        vectorDB,
      });
      await reasoningBank.initialize();

      const reasoningService = createReasoningService(reasoningBank);
      registry.registerService('reasoning', reasoningService);

      expect(registry.hasService('reasoning')).toBe(true);

      const stats = await registry.callService('reasoning', 'stats', {});
      expect(stats).toHaveProperty('initialized');
    });
  });

  describe('GNN Service Integration', () => {
    let gnnService: ReturnType<typeof createGNNService>;
    let gnnEnhancer: GNNEnhancer;

    beforeEach(() => {
      gnnEnhancer = new GNNEnhancer();
      gnnService = createGNNService(gnnEnhancer);
      registry.registerService('gnn', gnnService);
    });

    it('should enhance embedding via service', async () => {
      const result = await registry.callService('gnn', 'enhance', {
        embedding: new Array(1536).fill(0.5),
      });

      expect(result).toHaveProperty('enhanced');
      expect(result.enhanced.length).toBe(1536);
      expect(result).toHaveProperty('enhancementTime');
    });

    it('should get GNN metrics via service', async () => {
      await registry.callService('gnn', 'enhance', {
        embedding: new Array(1536).fill(0.5),
      });

      const metrics = await registry.callService('gnn', 'getMetrics', {});
      expect(metrics.totalEnhancements).toBeGreaterThan(0);
    });

    it('should clear cache via service', async () => {
      await registry.callService('gnn', 'enhance', {
        embedding: new Array(1536).fill(0.5),
      });

      const result = await registry.callService('gnn', 'clearCache', {});
      expect(result).toEqual({ success: true });
    });
  });

  describe('Episode Service (Real Implementation)', () => {
    beforeEach(() => {
      // Create a mock EpisodeStore that satisfies the service interface
      const mockEpisodeStore = {
        createEpisode: async () => 'episode-test-id',
        queryByTimeRange: async () => [],
        searchBySimilarity: async () => [],
        getById: async () => null,
        update: async () => {},
        delete: async () => {},
        getLinks: async () => [],
        save: async () => {},
        getStats: () => ({ episodeCount: 0, vectorCount: 0, dbSizeBytes: 0 }),
      } as any;
      const episodeService = createEpisodeService(mockEpisodeStore);
      registry.registerService('episode', episodeService);
    });

    it('should create an episode via service', async () => {
      const result = await registry.callService('episode', 'create', {
        taskId: 'test-task',
        embedding: new Array(1536).fill(0.1),
        metadata: { type: 'test' },
      });
      expect(result).toHaveProperty('episodeId');
      expect(result.episodeId).toBe('episode-test-id');
    });

    it('should return empty results for time range query', async () => {
      const result = await registry.callService('episode', 'query', {
        queryType: 'timeRange',
        timeRange: { startTime: 0, endTime: Date.now() },
      });
      expect(result.episodes).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should return zero stats', async () => {
      const stats = await registry.callService('episode', 'stats', {});
      expect(stats.episodeCount).toBe(0);
      expect(stats.vectorCount).toBe(0);
    });
  });

  describe('Hyperedge Service (Real Implementation)', () => {
    beforeEach(async () => {
      // Use a real GraphDB with FallbackGraph backend for hyperedge operations
      // Disable persistence to avoid cross-test contamination via shared disk state
      const fallbackGraph = new FallbackGraph('.test-hyperedge-graphs', 5000, false);
      const graphDB = new GraphDB(fallbackGraph);
      await graphDB.initialize();
      const hyperedgeService = createHyperedgeService(graphDB);
      registry.registerService('hyperedge', hyperedgeService);
    });

    it('should create a hyperedge via service', async () => {
      // GraphDB requires nodes to exist before creating a hyperedge
      // Disable persistence to avoid cross-test contamination
      const fallbackGraph2 = new FallbackGraph('.test-hyperedge-graphs2', 5000, false);
      const graphDB2 = new GraphDB(fallbackGraph2);
      await graphDB2.initialize();

      // Add nodes first using createNode (root-level keys auto-link to graph:root)
      const nodeA = await graphDB2.createNode({ type: 'test', properties: { key: 'node-a', name: 'a' } });
      const nodeB = await graphDB2.createNode({ type: 'test', properties: { key: 'node-b', name: 'b' }, linkTo: nodeA });
      const nodeC = await graphDB2.createNode({ type: 'test', properties: { key: 'node-c', name: 'c' }, linkTo: nodeA });

      // Register a fresh hyperedge service with this graph that has the nodes
      const registry2 = new ServiceRegistry();
      const hyperedgeService2 = createHyperedgeService(graphDB2);
      registry2.registerService('hyperedge', hyperedgeService2);

      const result = await registry2.callService('hyperedge', 'create', {
        nodes: [nodeA, nodeB, nodeC],
        type: 'test-relation',
      });
      expect(result).toHaveProperty('hyperedgeId');
      expect(typeof result.hyperedgeId).toBe('string');
    });

    it('should return empty results for query all', async () => {
      const result = await registry.callService('hyperedge', 'query', {
        queryType: 'all',
      });
      // New graph has no hyperedges initially (unless create was called first)
      expect(Array.isArray(result.hyperedges)).toBe(true);
      expect(result).toHaveProperty('count');
    });

    it('should return zero stats on empty graph', async () => {
      const stats = await registry.callService('hyperedge', 'stats', {});
      expect(stats.hyperedgeCount).toBe(0);
      expect(stats.temporalCount).toBe(0);
    });
  });

  describe('E2E All Services', () => {
    it('should register all 8 services', async () => {
      // Vector
      const vectorBackend = new FallbackHNSW(1536, DistanceMetric.COSINE);
      registry.registerService('vector', createVectorService(vectorBackend));

      // Graph
      const fallbackGraph = new FallbackGraph();
      const graphDB = new GraphDB(fallbackGraph);
      await graphDB.initialize();
      registry.registerService('graph', createGraphService(graphDB));

      // Search (mock)
      const mockSearch = {
        search: async () => ({ query: '', results: [], metadata: {} as any, sourceStats: {} as any }),
        updateWeights: () => {},
        getOptions: () => ({ weights: {}, topK: 10, sourceTimeoutMs: 5000, graphDepth: 3, memoryNamespace: '', minPatternConfidence: 0.7 } as any),
      } as any;
      registry.registerService('search', createSearchService(mockSearch));

      // Sona
      const sonaEngine = new SonaEngine();
      await sonaEngine.initialize();
      registry.registerService('sona', createSonaService(sonaEngine));

      // Reasoning (minimal)
      const vectorDB = new VectorDB({ dimension: 1536, metric: DistanceMetric.COSINE });
      await vectorDB.initialize();
      const reasoningBank = new ReasoningBank({
        patternMatcher: new PatternMatcher(vectorDB),
        causalMemory: new CausalMemory(),
        vectorDB,
      });
      await reasoningBank.initialize();
      registry.registerService('reasoning', createReasoningService(reasoningBank));

      // GNN
      registry.registerService('gnn', createGNNService(new GNNEnhancer()));

      // Episode (with mock store)
      const mockEpisodeStore = {
        createEpisode: async () => 'episode-test-id',
        queryByTimeRange: async () => [],
        searchBySimilarity: async () => [],
        getById: async () => null,
        update: async () => {},
        delete: async () => {},
        getLinks: async () => [],
        save: async () => {},
        getStats: () => ({ episodeCount: 0, vectorCount: 0, dbSizeBytes: 0 }),
      } as any;
      registry.registerService('episode', createEpisodeService(mockEpisodeStore));

      // Hyperedge (with real GraphDB)
      registry.registerService('hyperedge', createHyperedgeService(graphDB));

      const services = registry.listServices();
      expect(services).toHaveLength(8);
      expect(services).toContain('vector');
      expect(services).toContain('graph');
      expect(services).toContain('search');
      expect(services).toContain('sona');
      expect(services).toContain('reasoning');
      expect(services).toContain('gnn');
      expect(services).toContain('episode');
      expect(services).toContain('hyperedge');
    });

    it('should call one method from each service', async () => {
      // Setup all services
      const vectorBackend = new FallbackHNSW(1536, DistanceMetric.COSINE);
      registry.registerService('vector', createVectorService(vectorBackend));

      const fallbackGraph = new FallbackGraph();
      const graphDB = new GraphDB(fallbackGraph);
      await graphDB.initialize();
      registry.registerService('graph', createGraphService(graphDB));

      const mockSearch = {
        search: async () => ({ query: '', results: [], metadata: {} as any, sourceStats: {} as any }),
        updateWeights: () => {},
        getOptions: () => ({ weights: {}, topK: 10, sourceTimeoutMs: 5000, graphDepth: 3, memoryNamespace: '', minPatternConfidence: 0.7 } as any),
      } as any;
      registry.registerService('search', createSearchService(mockSearch));

      const sonaEngine = new SonaEngine();
      await sonaEngine.initialize();
      registry.registerService('sona', createSonaService(sonaEngine));

      const vectorDB = new VectorDB({ dimension: 1536, metric: DistanceMetric.COSINE });
      await vectorDB.initialize();
      const reasoningBank = new ReasoningBank({
        patternMatcher: new PatternMatcher(vectorDB),
        causalMemory: new CausalMemory(),
        vectorDB,
      });
      await reasoningBank.initialize();
      registry.registerService('reasoning', createReasoningService(reasoningBank));

      registry.registerService('gnn', createGNNService(new GNNEnhancer()));

      // Episode (with mock store)
      const mockEpisodeStore2 = {
        createEpisode: async () => 'episode-test-id',
        queryByTimeRange: async () => [],
        searchBySimilarity: async () => [],
        getById: async () => null,
        update: async () => {},
        delete: async () => {},
        getLinks: async () => [],
        save: async () => {},
        getStats: () => ({ episodeCount: 0, vectorCount: 0, dbSizeBytes: 0 }),
      } as any;
      registry.registerService('episode', createEpisodeService(mockEpisodeStore2));

      // Hyperedge (with real GraphDB)
      registry.registerService('hyperedge', createHyperedgeService(graphDB));

      // Call one method from each
      const vectorStats = await registry.callService('vector', 'stats', {});
      expect(vectorStats).toHaveProperty('count');

      const graphStats = await registry.callService('graph', 'stats', {});
      expect(graphStats).toHaveProperty('nodeCount');

      const searchOptions = await registry.callService('search', 'getOptions', {});
      expect(searchOptions).toHaveProperty('weights');

      const sonaStats = await registry.callService('sona', 'getStats', {});
      expect(sonaStats).toHaveProperty('trajectoryCount');

      const reasoningStats = await registry.callService('reasoning', 'stats', {});
      expect(reasoningStats).toHaveProperty('initialized');

      const gnnMetrics = await registry.callService('gnn', 'getMetrics', {});
      expect(gnnMetrics).toHaveProperty('totalEnhancements');

      const episodeStats = await registry.callService('episode', 'stats', {});
      expect(episodeStats).toHaveProperty('episodeCount');

      const hyperedgeStats = await registry.callService('hyperedge', 'stats', {});
      expect(hyperedgeStats).toHaveProperty('hyperedgeCount');

      // Verify metrics
      const metrics = registry.getMetrics();
      expect(metrics.totalCalls).toBe(8);
      expect(metrics.servicesRegistered).toBe(8);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle 100 concurrent requests', async () => {
      const handler = createServiceHandler({
        echo: async (params: { msg: string }) => params.msg,
      });
      registry.registerService('echo', handler);

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(registry.callService('echo', 'echo', { msg: `message${i}` }));
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);
      expect(results[0]).toBe('message0');
      expect(results[99]).toBe('message99');

      const metrics = registry.getServiceMetrics('echo');
      expect(metrics?.callCount).toBe(100);
    });

    it('should handle concurrent requests to different services', async () => {
      const handler1 = createServiceHandler({ m1: async () => 'r1' });
      const handler2 = createServiceHandler({ m2: async () => 'r2' });
      const handler3 = createServiceHandler({ m3: async () => 'r3' });

      registry.registerService('s1', handler1);
      registry.registerService('s2', handler2);
      registry.registerService('s3', handler3);

      const promises = [
        registry.callService('s1', 'm1', {}),
        registry.callService('s2', 'm2', {}),
        registry.callService('s3', 'm3', {}),
        registry.callService('s1', 'm1', {}),
        registry.callService('s2', 'm2', {}),
      ];

      const results = await Promise.all(promises);
      expect(results).toEqual(['r1', 'r2', 'r3', 'r1', 'r2']);
    });
  });

  describe('Service Call With Metrics', () => {
    it('should return result with timing metadata', async () => {
      const handler = createServiceHandler({
        slow: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        },
      });
      registry.registerService('test', handler);

      const result = await registry.callServiceWithMetrics('test', 'slow', {});
      expect(result.result).toBe('done');
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.serviceName).toBe('test');
      expect(result.methodName).toBe('slow');
    });
  });
});
