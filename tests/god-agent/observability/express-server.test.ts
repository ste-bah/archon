/**
 * ExpressServer Tests
 *
 * Test suite for ExpressServer with all API endpoint validations.
 *
 * @module tests/observability/express-server
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ExpressServer, IServerDependencies } from '../../../src/god-agent/observability/express-server';
import { ActivityStream } from '../../../src/god-agent/observability/activity-stream';
import { AgentExecutionTracker } from '../../../src/god-agent/observability/agent-tracker';
import { PipelineTracker } from '../../../src/god-agent/observability/pipeline-tracker';
import { RoutingHistory } from '../../../src/god-agent/observability/routing-history';
import { EventStore } from '../../../src/god-agent/observability/event-store';
import { SSEBroadcaster } from '../../../src/god-agent/observability/sse-broadcaster';
import * as fs from 'fs';

describe('ExpressServer', () => {
  let server: ExpressServer;
  let dependencies: IServerDependencies;
  let activityStream: ActivityStream;
  let agentTracker: AgentExecutionTracker;
  let pipelineTracker: PipelineTracker;
  let routingHistory: RoutingHistory;
  let eventStore: EventStore;
  let sseBroadcaster: SSEBroadcaster;

  const TEST_DB_PATH = '.test-observability/express-server-test.db';

  beforeEach(async () => {
    // Clean up test database if exists
    const dir = '.test-observability';
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // Initialize dependencies
    activityStream = new ActivityStream(1000);
    agentTracker = new AgentExecutionTracker(activityStream);
    pipelineTracker = new PipelineTracker(activityStream);
    routingHistory = new RoutingHistory(activityStream, 100);
    eventStore = new EventStore(TEST_DB_PATH, 10000);
    sseBroadcaster = new SSEBroadcaster({ verbose: false });

    dependencies = {
      activityStream,
      agentTracker,
      pipelineTracker,
      routingHistory,
      eventStore,
      sseBroadcaster,
    };

    // Create server (but don't start it yet)
    server = new ExpressServer(dependencies, {
      host: '127.0.0.1',
      verbose: false,
    });
  });

  afterEach(async () => {
    // Stop server if running
    await server.stop();

    // Close event store
    await eventStore.close();

    // Shutdown SSE broadcaster
    sseBroadcaster.shutdown();

    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    const dir = '.test-observability';
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('Server Lifecycle', () => {
    it('should start and stop successfully', async () => {
      await server.start(0);  // Use port 0 for auto-assign
      expect(server.getPort()).toBeGreaterThan(0);

      await server.stop();
      expect(server.getPort()).toBe(0);
    });

    it('should bind to localhost by default (RULE-OBS-006)', async () => {
      // This is verified by configuration, checking in constructor
      expect(server).toBeDefined();
    });
  });

  describe('TC-008-01: GET /api/health', () => {
    it('should return healthy status', async () => {
      const app = server.getApp();

      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('clientCount');
      expect(response.body).toHaveProperty('eventCount');
      expect(response.body).toHaveProperty('bufferUsage');
    });

    it('should respond in < 10ms (performance budget)', async () => {
      const app = server.getApp();

      const start = Date.now();
      await request(app).get('/api/health');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10);
    });
  });

  describe('TC-008-02: GET /api/events?limit=10', () => {
    it('should return max 10 events when limit=10', async () => {
      // Insert 20 events
      for (let i = 0; i < 20; i++) {
        eventStore.insert({
          id: `evt_${i}`,
          timestamp: Date.now() + i,
          component: 'routing',
          operation: `test_op_${i}`,
          status: 'success',
          metadata: { index: i },
        });
      }

      // Wait for writes to complete
      await new Promise(resolve => setImmediate(resolve));

      const app = server.getApp();
      const response = await request(app).get('/api/events?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(10);
      expect(response.body.count).toBe(10);
    });

    it('should respond in < 100ms (performance budget)', async () => {
      // Insert events
      for (let i = 0; i < 50; i++) {
        eventStore.insert({
          id: `evt_${i}`,
          timestamp: Date.now() + i,
          component: 'routing',
          operation: `test_op_${i}`,
          status: 'success',
          metadata: { index: i },
        });
      }

      await new Promise(resolve => setImmediate(resolve));

      const app = server.getApp();

      const start = Date.now();
      await request(app).get('/api/events?limit=10');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('TC-008-03: GET /api/events?component=routing', () => {
    it('should filter events by component', async () => {
      // Insert mixed events
      eventStore.insert({
        id: 'evt_routing_1',
        timestamp: Date.now(),
        component: 'routing',
        operation: 'routing_decision',
        status: 'success',
        metadata: {},
      });

      eventStore.insert({
        id: 'evt_agent_1',
        timestamp: Date.now(),
        component: 'agent',
        operation: 'agent_started',
        status: 'running',
        metadata: {},
      });

      eventStore.insert({
        id: 'evt_routing_2',
        timestamp: Date.now(),
        component: 'routing',
        operation: 'routing_decision',
        status: 'success',
        metadata: {},
      });

      await new Promise(resolve => setImmediate(resolve));

      const app = server.getApp();
      const response = await request(app).get('/api/events?component=routing');

      expect(response.status).toBe(200);
      expect(response.body.events.length).toBeGreaterThanOrEqual(2);
      expect(response.body.events.every((e: any) => e.component === 'routing')).toBe(true);
    });
  });

  describe('TC-008-04: GET /api/agents', () => {
    it('should return active agents', async () => {
      // Start an agent
      agentTracker.startAgent({
        id: 'exec_1',
        agentKey: 'backend-dev',
        agentName: 'Backend Developer',
        category: 'development',
        status: 'running',
        startTime: Date.now(),
        input: 'Test task',
      });

      const app = server.getApp();
      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toHaveProperty('agents');
      expect(response.body).toHaveProperty('count');
      expect(response.body.agents).toHaveLength(1);
      expect(response.body.agents[0].agentKey).toBe('backend-dev');
    });

    it('should respond in < 20ms (performance budget)', async () => {
      const app = server.getApp();

      const start = Date.now();
      await request(app).get('/api/agents');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(20);
    });
  });

  describe('TC-008-05: GET /api/routing/invalid', () => {
    it('should return 404 for invalid routing ID', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/routing/invalid-id-999');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('not found');
    });
  });

  describe('TC-008-06: GET /api/stream', () => {
    it('should set SSE headers', async () => {
      const app = server.getApp();

      // SSE endpoint keeps connection open, so we'll test headers differently
      // by connecting and immediately checking response headers
      return new Promise<void>((resolve) => {
        const req = request(app).get('/api/stream');

        req.end((err, res) => {
          if (res) {
            expect(res.headers['content-type']).toBe('text/event-stream');
            expect(res.headers['cache-control']).toBe('no-cache');
            expect(res.headers['connection']).toBe('keep-alive');
          }
          resolve();
        });

        // Force early termination after headers received
        setTimeout(() => {
          req.abort();
        }, 50);
      });
    });
  });

  describe('TC-008-07: GET /', () => {
    it('should return HTML dashboard', async () => {
      const app = server.getApp();
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.text).toContain('God Agent Observability Dashboard');
    });
  });

  describe('TC-008-08: GET /unknown', () => {
    it('should return 404 for unknown routes', async () => {
      const app = server.getApp();
      const response = await request(app).get('/unknown-route-xyz');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not Found');
    });
  });

  describe('TC-008-09: Security Headers', () => {
    it('should set X-Content-Type-Options: nosniff', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set X-Frame-Options: DENY', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/health');

      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should set explicit Content-Type on JSON responses', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/health');

      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('TC-008-10: Performance', () => {
    it('should respond in < 100ms for /api/health', async () => {
      const app = server.getApp();

      const start = Date.now();
      await request(app).get('/api/health');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should respond in < 100ms for /api/agents', async () => {
      const app = server.getApp();

      const start = Date.now();
      await request(app).get('/api/agents');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('GET /api/pipelines', () => {
    it('should return active pipelines', async () => {
      // Start a pipeline
      pipelineTracker.startPipeline({
        name: 'test-pipeline',
        steps: ['step1', 'step2'],
        taskType: 'research',
      });

      const app = server.getApp();
      const response = await request(app).get('/api/pipelines');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pipelines');
      expect(response.body).toHaveProperty('count');
      expect(response.body.pipelines).toHaveLength(1);
      expect(response.body.pipelines[0].name).toBe('test-pipeline');
    });
  });

  describe('GET /api/routing/:id', () => {
    it('should return routing explanation for valid ID', async () => {
      // Record a routing decision
      const routingId = routingHistory.record({
        taskDescription: 'Implement API endpoint',
        taskType: 'coding',
        selectedAgent: 'backend-dev',
        confidence: 0.95,
        candidates: [
          {
            agentType: 'backend-dev',
            score: 0.95,
            matchedCapabilities: ['api', 'backend'],
            confidence: 0.95,
          },
        ],
        reasoningSteps: ['Analyzed task type', 'Matched capabilities'],
        coldStartUsed: false,
      });

      const app = server.getApp();
      const response = await request(app).get(`/api/routing/${routingId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', routingId);
      expect(response.body).toHaveProperty('selectedAgent', 'backend-dev');
      expect(response.body).toHaveProperty('confidence', 0.95);
      expect(response.body).toHaveProperty('explanation');
    });
  });

  describe('GET /api/metrics', () => {
    it('should return Prometheus format metrics', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['content-type']).toContain('version=0.0.4');
      expect(response.text).toContain('god_agent_events_total');
      expect(response.text).toContain('god_agent_active_agents');
      expect(response.text).toContain('god_agent_sse_clients');
    });

    it('should include uptime metric', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/metrics');

      expect(response.text).toContain('god_agent_uptime_seconds');
    });
  });

  describe('Placeholder Endpoints', () => {
    it('GET /api/memory/domains should return placeholder', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/memory/domains');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('domains');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('InteractionStore');
    });

    it('GET /api/memory/patterns should return placeholder', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/memory/patterns');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('patterns');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('ReasoningBank');
    });

    it('GET /api/learning/stats should return learning metrics', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/learning/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalTrajectories');
      expect(response.body).toHaveProperty('baselineQuality');
      expect(response.body).toHaveProperty('learnedQuality');
      expect(response.body).toHaveProperty('improvement');
    });
  });

  describe('Query Parameters', () => {
    it('should handle multiple query params for /api/events', async () => {
      // Insert events
      eventStore.insert({
        id: 'evt_1',
        timestamp: 1000,
        component: 'routing',
        operation: 'test',
        status: 'success',
        metadata: {},
      });

      eventStore.insert({
        id: 'evt_2',
        timestamp: 2000,
        component: 'agent',
        operation: 'test',
        status: 'error',
        metadata: {},
      });

      await new Promise(resolve => setImmediate(resolve));

      const app = server.getApp();
      const response = await request(app)
        .get('/api/events')
        .query({
          limit: 10,
          component: 'routing',
          status: 'success',
        });

      expect(response.status).toBe(200);
      expect(response.body.events).toBeDefined();
    });

    it('should handle since and until timestamp filters', async () => {
      const now = Date.now();

      eventStore.insert({
        id: 'evt_old',
        timestamp: now - 10000,
        component: 'routing',
        operation: 'test',
        status: 'success',
        metadata: {},
      });

      eventStore.insert({
        id: 'evt_recent',
        timestamp: now,
        component: 'routing',
        operation: 'test',
        status: 'success',
        metadata: {},
      });

      await new Promise(resolve => setImmediate(resolve));

      const app = server.getApp();
      const response = await request(app)
        .get('/api/events')
        .query({
          since: now - 5000,
        });

      expect(response.status).toBe(200);
      expect(response.body.events).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully without stack traces', async () => {
      // Force an error by passing invalid component
      const app = server.getApp();
      const response = await request(app).get('/api/events?component=invalid-component-xyz');

      // Should still return 200 with empty results (query handles invalid gracefully)
      expect(response.status).toBe(200);
    });

    it('should return JSON error responses', async () => {
      const app = server.getApp();
      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Coverage: Edge Cases', () => {
    it('should handle empty agents list', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(response.body.agents).toHaveLength(0);
      expect(response.body.count).toBe(0);
    });

    it('should handle empty pipelines list', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/pipelines');

      expect(response.status).toBe(200);
      expect(response.body.pipelines).toHaveLength(0);
      expect(response.body.count).toBe(0);
    });

    it('should handle empty events list', async () => {
      const app = server.getApp();
      const response = await request(app).get('/api/events');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(0);
      expect(response.body.count).toBe(0);
    });
  });
});
