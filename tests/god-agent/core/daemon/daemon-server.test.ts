/**
 * DaemonServer Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-001
 *
 * Test cases as specified:
 * - TC-D1-001: Server start/stop lifecycle
 * - TC-D1-002: Connection acceptance
 * - TC-D1-003: Max client limit enforcement
 * - TC-D1-004: Graceful shutdown
 * - TC-D1-005: Keepalive timeout
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnection, Socket } from 'net';
import { existsSync } from 'fs';
import { DaemonServer } from '../../../../src/god-agent/core/daemon/daemon-server.js';
import {
  DEFAULT_SOCKET_PATH,
  MAX_CLIENTS,
  DaemonErrorCode,
  ClientRejectionReason,
  isDaemonError,
} from '../../../../src/god-agent/core/daemon/daemon-types.js';
import { _resetHookRegistryForTesting } from '../../../../src/god-agent/core/hooks/hook-registry.js';

// Use unique socket paths for parallel test execution
const TEST_SOCKET_PATH = `/tmp/godagent-test-${process.pid}.sock`;

describe('DaemonServer', () => {
  let server: DaemonServer;

  beforeEach(() => {
    _resetHookRegistryForTesting();
    server = new DaemonServer(TEST_SOCKET_PATH);
  });

  afterEach(async () => {
    // Ensure server is stopped after each test
    if (server.getState() === 'running' || server.getState() === 'stopping') {
      await server.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default socket path', () => {
      const defaultServer = new DaemonServer();
      expect(defaultServer.getConfig().socketPath).toBe(DEFAULT_SOCKET_PATH);
    });

    it('should create instance with custom socket path', () => {
      expect(server.getConfig().socketPath).toBe(TEST_SOCKET_PATH);
    });

    it('should use default max clients', () => {
      expect(server.getConfig().maxClients).toBe(MAX_CLIENTS);
    });

    it('should accept custom configuration', () => {
      const customServer = new DaemonServer(TEST_SOCKET_PATH, {
        maxClients: 5,
        keepAliveTimeout: 60_000,
      });
      expect(customServer.getConfig().maxClients).toBe(5);
      expect(customServer.getConfig().keepAliveTimeout).toBe(60_000);
    });

    it('should start in stopped state', () => {
      expect(server.getState()).toBe('stopped');
    });
  });

  describe('TC-D1-001: Server start/stop lifecycle', () => {
    it('should start server successfully', async () => {
      await server.start();
      expect(server.getState()).toBe('running');
    });

    it('should create socket file on start', async () => {
      await server.start();
      expect(existsSync(TEST_SOCKET_PATH)).toBe(true);
    });

    it('should stop server gracefully', async () => {
      await server.start();
      await server.stop();
      expect(server.getState()).toBe('stopped');
    });

    it('should remove socket file on stop', async () => {
      await server.start();
      await server.stop();
      expect(existsSync(TEST_SOCKET_PATH)).toBe(false);
    });

    it('should emit start event on startup', async () => {
      const startHandler = vi.fn();
      server.on('start', startHandler);
      await server.start();
      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start',
          data: expect.objectContaining({ socketPath: TEST_SOCKET_PATH }),
        })
      );
    });

    it('should emit stop event on shutdown', async () => {
      const stopHandler = vi.fn();
      server.on('stop', stopHandler);
      await server.start();
      await server.stop();
      expect(stopHandler).toHaveBeenCalledTimes(1);
      expect(stopHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stop',
        })
      );
    });

    it('should throw when starting already running server', async () => {
      await server.start();
      await expect(server.start()).rejects.toThrow(/Cannot start server/);
    });

    it('should be safe to stop already stopped server', async () => {
      await server.stop(); // Should not throw
      expect(server.getState()).toBe('stopped');
    });

    it('should clean up existing socket on start', async () => {
      // Start and stop to create file
      await server.start();
      await server.stop();

      // Create new server with same path (reset hooks to avoid registration error)
      _resetHookRegistryForTesting();
      const newServer = new DaemonServer(TEST_SOCKET_PATH);
      await newServer.start();
      expect(newServer.getState()).toBe('running');
      await newServer.stop();
    });
  });

  describe('TC-D1-002: Connection acceptance', () => {
    it('should accept client connection', async () => {
      await server.start();

      const connectHandler = vi.fn();
      server.on('client_connect', connectHandler);

      const client = await connectClient(TEST_SOCKET_PATH);

      // Wait for connection event
      await waitFor(() => connectHandler.mock.calls.length > 0);

      expect(connectHandler).toHaveBeenCalledTimes(1);
      expect(server.getClients()).toHaveLength(1);

      client.destroy();
    });

    it('should track connection in active connections', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);

      await waitFor(() => server.getClients().length > 0);

      const clients = server.getClients();
      expect(clients).toHaveLength(1);
      expect(clients[0]).toHaveProperty('id');
      expect(clients[0]).toHaveProperty('connectedAt');

      client.destroy();
    });

    it('should generate unique connection IDs', async () => {
      await server.start();

      const client1 = await connectClient(TEST_SOCKET_PATH);
      const client2 = await connectClient(TEST_SOCKET_PATH);

      await waitFor(() => server.getClients().length >= 2);

      const clients = server.getClients();
      expect(clients[0].id).not.toBe(clients[1].id);

      client1.destroy();
      client2.destroy();
    });

    it('should update stats on connection', async () => {
      await server.start();
      expect(server.getStats().activeConnections).toBe(0);

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      expect(server.getStats().activeConnections).toBe(1);

      client.destroy();
    });
  });

  describe('TC-D1-003: Max client limit enforcement', () => {
    it('should accept up to max clients', async () => {
      const maxServer = new DaemonServer(TEST_SOCKET_PATH, { maxClients: 3 });
      await maxServer.start();

      const clients: Socket[] = [];
      for (let i = 0; i < 3; i++) {
        clients.push(await connectClient(TEST_SOCKET_PATH));
      }

      await waitFor(() => maxServer.getStats().activeConnections >= 3);
      expect(maxServer.getStats().activeConnections).toBe(3);

      clients.forEach((c) => c.destroy());
      await maxServer.stop();
    });

    it('should reject connection when at max clients', async () => {
      const maxServer = new DaemonServer(TEST_SOCKET_PATH, { maxClients: 2 });
      await maxServer.start();

      const rejectHandler = vi.fn();
      maxServer.on('client_rejected', rejectHandler);

      // Connect max clients
      const client1 = await connectClient(TEST_SOCKET_PATH);
      const client2 = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => maxServer.getStats().activeConnections >= 2);

      // Try to connect one more - use connectClientWithErrorHandling for rejection
      const client3 = await connectClientWithErrorHandling(TEST_SOCKET_PATH);
      await waitFor(() => rejectHandler.mock.calls.length > 0);

      expect(rejectHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'client_rejected',
          data: { reason: ClientRejectionReason.MAX_CLIENTS_EXCEEDED },
        })
      );

      client1.destroy();
      client2.destroy();
      client3.destroy();
      await maxServer.stop();
    });

    it('should accept new connection after disconnection', async () => {
      const maxServer = new DaemonServer(TEST_SOCKET_PATH, { maxClients: 1 });
      await maxServer.start();

      // Connect first client
      const client1 = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => maxServer.getStats().activeConnections >= 1);

      // Disconnect first client
      client1.destroy();
      await waitFor(() => maxServer.getStats().activeConnections === 0);

      // Should be able to connect new client
      const client2 = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => maxServer.getStats().activeConnections >= 1);

      expect(maxServer.getStats().activeConnections).toBe(1);

      client2.destroy();
      await maxServer.stop();
    });
  });

  describe('TC-D1-004: Graceful shutdown', () => {
    it('should notify all clients on shutdown', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Set up data handler to receive shutdown notification
      const dataPromise = new Promise<string>((resolve) => {
        client.on('data', (data) => resolve(data.toString()));
      });

      // Stop server
      await server.stop();

      const message = await dataPromise;
      expect(message).toContain('shutdown');
    });

    it('should close all connections on shutdown', async () => {
      await server.start();

      const clients = await Promise.all([
        connectClient(TEST_SOCKET_PATH),
        connectClient(TEST_SOCKET_PATH),
      ]);
      await waitFor(() => server.getStats().activeConnections >= 2);

      await server.stop();

      expect(server.getClients()).toHaveLength(0);

      clients.forEach((c) => c.destroy());
    });

    it('should complete shutdown within timeout', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const startTime = Date.now();
      await server.stop();
      const duration = Date.now() - startTime;

      // Should complete within graceful shutdown timeout
      expect(duration).toBeLessThan(6000); // 5s + some margin

      client.destroy();
    });

    it('should emit disconnect events for all clients', async () => {
      await server.start();

      const disconnectHandler = vi.fn();
      server.on('client_disconnect', disconnectHandler);

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      await server.stop();

      expect(disconnectHandler).toHaveBeenCalled();

      client.destroy();
    });
  });

  describe('TC-D1-005: Keepalive timeout', () => {
    it('should close idle connections after timeout', async () => {
      // Use short timeout for testing
      const shortTimeoutServer = new DaemonServer(TEST_SOCKET_PATH, {
        keepAliveTimeout: 100, // 100ms for testing
      });
      await shortTimeoutServer.start();

      const disconnectHandler = vi.fn();
      shortTimeoutServer.on('client_disconnect', disconnectHandler);

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => shortTimeoutServer.getStats().activeConnections > 0);

      // Wait for timeout
      await waitFor(
        () => shortTimeoutServer.getStats().activeConnections === 0,
        200
      );

      expect(disconnectHandler).toHaveBeenCalled();

      client.destroy();
      await shortTimeoutServer.stop();
    });

    it('should reset timeout on activity', async () => {
      const shortTimeoutServer = new DaemonServer(TEST_SOCKET_PATH, {
        keepAliveTimeout: 150, // 150ms
      });
      await shortTimeoutServer.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => shortTimeoutServer.getStats().activeConnections > 0);

      // Send data to reset timeout
      await new Promise((r) => setTimeout(r, 75));
      client.write('ping');

      await new Promise((r) => setTimeout(r, 75));
      client.write('ping');

      // Connection should still be active
      expect(shortTimeoutServer.getStats().activeConnections).toBe(1);

      client.destroy();
      await shortTimeoutServer.stop();
    });
  });

  describe('service registration', () => {
    it('should register a service', () => {
      const handler = vi.fn().mockResolvedValue({});
      server.registerService('testService', handler, ['method1', 'method2']);

      const service = server.getService('testService');
      expect(service).toBeDefined();
      expect(service?.name).toBe('testService');
      expect(service?.methods).toEqual(['method1', 'method2']);
    });

    it('should unregister a service', () => {
      const handler = vi.fn().mockResolvedValue({});
      server.registerService('testService', handler);

      expect(server.unregisterService('testService')).toBe(true);
      expect(server.getService('testService')).toBeUndefined();
    });

    it('should return false when unregistering non-existent service', () => {
      expect(server.unregisterService('nonExistent')).toBe(false);
    });

    it('should list all registered services', () => {
      const handler = vi.fn().mockResolvedValue({});
      server.registerService('service1', handler);
      server.registerService('service2', handler);

      const services = server.getServices();
      expect(services).toHaveLength(2);
      expect(services.map((s) => s.name)).toContain('service1');
      expect(services.map((s) => s.name)).toContain('service2');
    });
  });

  describe('statistics', () => {
    it('should track uptime', async () => {
      await server.start();
      await new Promise((r) => setTimeout(r, 50));

      const stats = server.getStats();
      expect(stats.uptime).toBeGreaterThan(0);
    });

    it('should track startedAt timestamp', async () => {
      const before = Date.now();
      await server.start();
      const after = Date.now();

      const stats = server.getStats();
      expect(stats.startedAt).toBeGreaterThanOrEqual(before);
      expect(stats.startedAt).toBeLessThanOrEqual(after);
    });

    it('should report zero uptime when stopped', () => {
      expect(server.getStats().uptime).toBe(0);
    });

    it('should track total requests', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      client.write('request1');
      await new Promise((r) => setTimeout(r, 10));

      expect(server.getStats().totalRequests).toBeGreaterThan(0);

      client.destroy();
    });
  });

  describe('error handling', () => {
    it('should handle socket errors gracefully', async () => {
      await server.start();

      const errorHandler = vi.fn();
      server.on('error', errorHandler);

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Force disconnect (simulates error)
      client.destroy();

      await waitFor(() => server.getStats().activeConnections === 0);

      // Should have cleaned up the connection
      expect(server.getClients()).toHaveLength(0);
    });

    it('should return daemon error for isDaemonError check', () => {
      const error = new Error('test') as any;
      error.code = DaemonErrorCode.SOCKET_EXISTS;
      expect(isDaemonError(error)).toBe(true);
    });

    it('should return false for non-daemon errors', () => {
      const error = new Error('test');
      expect(isDaemonError(error)).toBe(false);
    });
  });

  describe('event emission', () => {
    it('should emit event through generic handler', async () => {
      const eventHandler = vi.fn();
      server.on('event', eventHandler);

      await server.start();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start',
          timestamp: expect.any(Number),
        })
      );
    });
  });
});

// Helper functions

async function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      resolve(client);
    });
    client.on('error', (err) => {
      // If already connected, ignore ECONNRESET/EPIPE on close
      if (client.connecting) {
        reject(err);
      }
      // Otherwise swallow the error - expected during tests when connections close
    });
  });
}

/**
 * Connect client that handles errors silently (for rejection tests)
 */
async function connectClientWithErrorHandling(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      resolve(client);
    });
    // Handle all errors silently - expected during rejection tests
    client.on('error', () => {
      // Swallow ECONNRESET and other errors during rejection tests
    });
    // Handle connection failure
    client.on('close', () => {
      if (client.connecting) {
        reject(new Error('Connection closed before established'));
      }
    });
    // Resolve after short timeout even if not fully connected (for rejection cases)
    setTimeout(() => {
      if (client.connecting) {
        resolve(client);
      }
    }, 50);
  });
}

async function waitFor(
  condition: () => boolean,
  timeout: number = 1000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
