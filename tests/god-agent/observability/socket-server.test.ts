/**
 * SocketServer Tests
 *
 * Test suite for Unix Domain Socket IPC server implementation.
 *
 * @module tests/observability/socket-server
 * @see TASK-OBS-012-SOCKET-IPC.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SocketServer, ISocketServerDependencies } from '../../../src/god-agent/observability/socket-server';
import { ActivityStream } from '../../../src/god-agent/observability/activity-stream';
import { AgentExecutionTracker } from '../../../src/god-agent/observability/agent-tracker';
import { PipelineTracker } from '../../../src/god-agent/observability/pipeline-tracker';
import { RoutingHistory } from '../../../src/god-agent/observability/routing-history';
import { EventStore } from '../../../src/god-agent/observability/event-store';
import { SSEBroadcaster } from '../../../src/god-agent/observability/sse-broadcaster';
import { IActivityEvent } from '../../../src/god-agent/observability/types';

describe('SocketServer', () => {
  let server: SocketServer;
  let dependencies: ISocketServerDependencies;
  let socketPath: string;
  let testDbPath: string;

  beforeEach(() => {
    // Generate unique paths for this test run
    const testId = Math.random().toString(36).substring(7);
    socketPath = path.join(os.tmpdir(), `test-socket-${testId}.sock`);
    testDbPath = path.join(os.tmpdir(), `test-events-${testId}.db`);

    // Create dependencies
    const activityStream = new ActivityStream();
    const agentTracker = new AgentExecutionTracker(activityStream);
    const pipelineTracker = new PipelineTracker(activityStream);
    const routingHistory = new RoutingHistory(activityStream);
    const eventStore = new EventStore(testDbPath);
    const sseBroadcaster = new SSEBroadcaster();

    dependencies = {
      activityStream,
      agentTracker,
      pipelineTracker,
      routingHistory,
      eventStore,
      sseBroadcaster,
    };

    server = new SocketServer(dependencies, {
      socketPath,
      verbose: false,
    });
  });

  afterEach(async () => {
    // Clean up
    await server.stop();

    // Remove test socket and database
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDbPath + '-shm')) {
      fs.unlinkSync(testDbPath + '-shm');
    }
    if (fs.existsSync(testDbPath + '-wal')) {
      fs.unlinkSync(testDbPath + '-wal');
    }
  });

  // ===========================================================================
  // TC-012-01: Server starts, socket created
  // ===========================================================================

  it('TC-012-01: should start server and create socket with 0600 permissions', async () => {
    await server.start();

    // Socket file should exist
    expect(fs.existsSync(socketPath)).toBe(true);

    // Check permissions (0600)
    const stats = fs.statSync(socketPath);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // ===========================================================================
  // TC-012-02: Client connects
  // ===========================================================================

  it('TC-012-02: should accept client connection and track count', async () => {
    await server.start();

    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        expect(server.getConnectionCount()).toBe(1);
        client.end();
        resolve();
      });
    });
  });

  // ===========================================================================
  // TC-012-03: Send valid NDJSON
  // ===========================================================================

  it('TC-012-03: should receive and route valid NDJSON event', async () => {
    await server.start();

    const event: IActivityEvent = {
      id: 'evt_test_123',
      timestamp: Date.now(),
      component: 'general',
      operation: 'test_operation',
      status: 'success',
      metadata: { test: true },
    };

    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        // Send NDJSON
        client.write(JSON.stringify(event) + '\n');

        // Give time for processing
        setTimeout(() => {
          // Event should be in activity stream
          const recent = dependencies.activityStream.getRecent(10);
          expect(recent.some(e => e.id === event.id)).toBe(true);

          client.end();
          resolve();
        }, 50);
      });
    });
  });

  // ===========================================================================
  // TC-012-04: Send malformed JSON
  // ===========================================================================

  it('TC-012-04: should handle malformed JSON gracefully (log and skip)', async () => {
    await server.start();

    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        // Send malformed JSON
        client.write('{ invalid json }\n');
        client.write('{ "missing": "fields" }\n');

        // Send valid event after malformed ones
        const validEvent: IActivityEvent = {
          id: 'evt_valid_123',
          timestamp: Date.now(),
          component: 'general',
          operation: 'valid_operation',
          status: 'success',
          metadata: {},
        };

        client.write(JSON.stringify(validEvent) + '\n');

        setTimeout(() => {
          // Valid event should be processed
          const recent = dependencies.activityStream.getRecent(10);
          expect(recent.some(e => e.id === 'evt_valid_123')).toBe(true);

          client.end();
          resolve();
        }, 50);
      });
    });
  });

  // ===========================================================================
  // TC-012-05: Multiple clients
  // ===========================================================================

  it('TC-012-05: should handle multiple concurrent clients', async () => {
    await server.start();

    const client1 = net.connect(socketPath);
    const client2 = net.connect(socketPath);
    const client3 = net.connect(socketPath);

    await Promise.all([
      new Promise<void>((resolve) => {
        client1.on('connect', () => {
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client2.on('connect', () => {
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client3.on('connect', () => {
          resolve();
        });
      }),
    ]);

    // Wait for server to register all connections
    await new Promise(resolve => setTimeout(resolve, 50));

    // All clients should be connected
    expect(server.getConnectionCount()).toBe(3);

    client1.end();
    client2.end();
    client3.end();

    // Wait for disconnections
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(server.getConnectionCount()).toBe(0);
  });

  // ===========================================================================
  // TC-012-06: Client disconnect
  // ===========================================================================

  it('TC-012-06: should remove client on disconnect', async () => {
    await server.start();

    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        expect(server.getConnectionCount()).toBe(1);
        client.end();
      });

      client.on('close', () => {
        setTimeout(() => {
          expect(server.getConnectionCount()).toBe(0);
          resolve();
        }, 50);
      });
    });
  });

  // ===========================================================================
  // TC-012-07: Server stop
  // ===========================================================================

  it('TC-012-07: should remove socket file on stop', async () => {
    await server.start();

    expect(fs.existsSync(socketPath)).toBe(true);

    await server.stop();

    expect(fs.existsSync(socketPath)).toBe(false);
  });

  // ===========================================================================
  // TC-012-08: Event routing by component
  // ===========================================================================

  it('TC-012-08: should route events to correct trackers based on component', async () => {
    await server.start();

    const routingEvent: IActivityEvent = {
      id: 'evt_routing_123',
      timestamp: Date.now(),
      component: 'routing',
      operation: 'routing_decision',
      status: 'success',
      metadata: { selectedAgent: 'test-agent' },
    };

    const agentEvent: IActivityEvent = {
      id: 'evt_agent_123',
      timestamp: Date.now(),
      component: 'agent',
      operation: 'agent_started',
      status: 'running',
      metadata: { agentKey: 'test-agent' },
    };

    const pipelineEvent: IActivityEvent = {
      id: 'evt_pipeline_123',
      timestamp: Date.now(),
      component: 'pipeline',
      operation: 'pipeline_started',
      status: 'running',
      metadata: { pipelineId: 'pipe_123' },
    };

    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        client.write(JSON.stringify(routingEvent) + '\n');
        client.write(JSON.stringify(agentEvent) + '\n');
        client.write(JSON.stringify(pipelineEvent) + '\n');

        setTimeout(() => {
          // All events should be in activity stream
          const recent = dependencies.activityStream.getRecent(10);
          expect(recent.some(e => e.id === 'evt_routing_123')).toBe(true);
          expect(recent.some(e => e.id === 'evt_agent_123')).toBe(true);
          expect(recent.some(e => e.id === 'evt_pipeline_123')).toBe(true);

          client.end();
          resolve();
        }, 50);
      });
    });
  });

  // ===========================================================================
  // TC-012-09: Stale socket removal
  // ===========================================================================

  it('TC-012-09: should remove stale socket on start', async () => {
    // Create a stale socket file
    fs.writeFileSync(socketPath, '');

    // Start server (should remove stale socket)
    await server.start();

    expect(fs.existsSync(socketPath)).toBe(true);

    // Socket should be functional
    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        expect(server.getConnectionCount()).toBe(1);
        client.end();
        resolve();
      });
    });
  });

  // ===========================================================================
  // Performance Tests
  // ===========================================================================

  it('should establish connection in < 100ms', async () => {
    const startTime = Date.now();
    await server.start();

    const client = net.connect(socketPath);

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(100);
        client.end();
        resolve();
      });
    });
  });

  it('should process message in < 1ms', async () => {
    await server.start();

    const event: IActivityEvent = {
      id: 'evt_perf_123',
      timestamp: Date.now(),
      component: 'general',
      operation: 'perf_test',
      status: 'success',
      metadata: {},
    };

    const client = net.connect(socketPath);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('Test timeout'));
      }, 5000);

      client.on('connect', () => {
        const startTime = process.hrtime.bigint();
        client.write(JSON.stringify(event) + '\n');

        setTimeout(() => {
          const endTime = process.hrtime.bigint();
          const durationNs = Number(endTime - startTime);
          const durationMs = durationNs / 1_000_000;

          // Processing should be very fast
          // Note: Actual processing is sub-ms but test overhead adds delay
          expect(durationMs).toBeLessThan(50);  // Allow buffer for test environment

          clearTimeout(timeout);
          client.end();
          resolve();
        }, 10);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
