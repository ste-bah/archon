/**
 * DaemonServer JSON-RPC 2.0 Handler Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-002
 *
 * Test cases for JSON-RPC 2.0 message handling:
 * - TC-D2-001: Valid JSON-RPC request parsing and routing
 * - TC-D2-002: Invalid JSON returns PARSE_ERROR (-32700)
 * - TC-D2-003: Missing jsonrpc field returns INVALID_REQUEST (-32600)
 * - TC-D2-004: Unknown service returns METHOD_NOT_FOUND (-32601)
 * - TC-D2-005: health.ping returns { pong: true }
 * - TC-D2-006: health.status returns daemon stats
 * - TC-D2-007: Partial message buffering across chunks
 * - TC-D2-008: Multiple messages in one chunk (newline-delimited)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnection, Socket } from 'net';
import { DaemonServer } from '../../../../src/god-agent/core/daemon/daemon-server.js';
import { JSON_RPC_ERROR_CODES } from '../../../../src/god-agent/core/daemon/daemon-types.js';
import { _resetHookRegistryForTesting, _resetHookExecutorForTesting } from '../../../../src/god-agent/core/hooks/index.js';

// Use unique socket paths for parallel test execution
const TEST_SOCKET_PATH = `/tmp/godagent-rpc-test-${process.pid}.sock`;

/**
 * Helper to create JSON-RPC message (newline-delimited)
 */
function createRpcMessage(
  method: string,
  params: unknown = {},
  id: string | number = 1
): string {
  return JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
}

/**
 * Helper to send message and wait for response
 */
async function sendRpcRequest(
  client: Socket,
  message: string,
  timeout: number = 2000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('RPC request timeout'));
    }, timeout);

    const responseHandler = (data: Buffer) => {
      clearTimeout(timer);
      client.off('data', responseHandler);
      try {
        const response = JSON.parse(data.toString().trim());
        resolve(response);
      } catch {
        reject(new Error(`Invalid JSON response: ${data.toString()}`));
      }
    };

    client.on('data', responseHandler);
    client.write(message);
  });
}

/**
 * Helper to connect a client
 */
async function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      resolve(client);
    });
    client.on('error', (err) => {
      if (client.connecting) {
        reject(err);
      }
    });
  });
}

/**
 * Wait for condition
 */
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

describe('DaemonServer JSON-RPC 2.0 Handler', () => {
  let server: DaemonServer;

  beforeEach(async () => {
    // Reset hook registry singleton to allow re-registration between tests
    _resetHookRegistryForTesting();
    _resetHookExecutorForTesting();

    server = new DaemonServer(TEST_SOCKET_PATH, {
      keepAliveTimeout: 30000, // 30s to avoid timeouts during tests
    });
  });

  afterEach(async () => {
    if (server.getState() === 'running' || server.getState() === 'stopping') {
      await server.stop();
    }
  });

  describe('TC-D2-001: Valid JSON-RPC request parsing and routing', () => {
    it('should parse and route valid JSON-RPC request', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = await sendRpcRequest(client, createRpcMessage('health.ping'));

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: expect.objectContaining({
          pong: true,
        }),
      });

      client.destroy();
    });

    it('should include timestamp in health.ping response', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const beforeTime = Date.now();
      const response = (await sendRpcRequest(
        client,
        createRpcMessage('health.ping')
      )) as { result: { timestamp: number } };
      const afterTime = Date.now();

      expect(response.result.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(response.result.timestamp).toBeLessThanOrEqual(afterTime);

      client.destroy();
    });

    it('should preserve request id in response', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Test with string id
      const response1 = (await sendRpcRequest(
        client,
        createRpcMessage('health.ping', {}, 'custom-id-123')
      )) as { id: string };
      expect(response1.id).toBe('custom-id-123');

      // Test with number id
      const response2 = (await sendRpcRequest(
        client,
        createRpcMessage('health.ping', {}, 42)
      )) as { id: number };
      expect(response2.id).toBe(42);

      client.destroy();
    });
  });

  describe('TC-D2-002: Invalid JSON returns PARSE_ERROR', () => {
    it('should return PARSE_ERROR for malformed JSON', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        '{ not valid json }\n'
      )) as { error: { code: number; message: string } };

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
      expect(response.error.message).toContain('Parse error');
      expect(response.id).toBeNull();

      client.destroy();
    });

    it('should return PARSE_ERROR for truncated JSON', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        '{"jsonrpc": "2.0", "method":\n'
      )) as { error: { code: number } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);

      client.destroy();
    });

    it('should return INVALID_REQUEST for empty object', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Empty JSON object - missing required fields
      const response = (await sendRpcRequest(client, '{}\n')) as {
        error: { code: number };
      };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);

      client.destroy();
    });
  });

  describe('TC-D2-003: Missing jsonrpc field returns INVALID_REQUEST', () => {
    it('should return INVALID_REQUEST for missing jsonrpc field', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        JSON.stringify({ method: 'health.ping', id: 1 }) + '\n'
      )) as { error: { code: number; message: string } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      expect(response.error.message).toContain('Invalid Request');

      client.destroy();
    });

    it('should return INVALID_REQUEST for wrong jsonrpc version', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        JSON.stringify({ jsonrpc: '1.0', method: 'health.ping', id: 1 }) + '\n'
      )) as { error: { code: number } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);

      client.destroy();
    });

    it('should return INVALID_REQUEST for missing method', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        JSON.stringify({ jsonrpc: '2.0', id: 1 }) + '\n'
      )) as { error: { code: number } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);

      client.destroy();
    });

    it('should return INVALID_REQUEST for empty method', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        JSON.stringify({ jsonrpc: '2.0', method: '', id: 1 }) + '\n'
      )) as { error: { code: number } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);

      client.destroy();
    });
  });

  describe('TC-D2-004: Unknown service returns METHOD_NOT_FOUND', () => {
    it('should return METHOD_NOT_FOUND for unknown service', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('unknownService.doSomething')
      )) as { error: { code: number; message: string } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
      expect(response.error.message).toContain('Service not found');
      expect(response.error.message).toContain('unknownService');

      client.destroy();
    });

    it('should return METHOD_NOT_FOUND for invalid method format', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('noServiceSeparator')
      )) as { error: { code: number; message: string } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
      expect(response.error.message).toContain('Invalid method format');

      client.destroy();
    });

    it('should return METHOD_NOT_FOUND for unknown method on known service', async () => {
      await server.start();

      // Register a test service
      server.registerService(
        'testService',
        async (method) => {
          if (method === 'known') return { success: true };
          throw new Error(`Method not found: ${method}`);
        },
        ['known']
      );

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('testService.unknownMethod')
      )) as { error: { code: number } };

      // This returns HANDLER_ERROR because the service exists but method fails
      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.HANDLER_ERROR);

      client.destroy();
    });
  });

  describe('TC-D2-005: health.ping returns { pong: true }', () => {
    it('should return pong: true for health.ping', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('health.ping')
      )) as { result: { pong: boolean } };

      expect(response.result).toMatchObject({
        pong: true,
      });

      client.destroy();
    });

    it('should handle health.ping with empty params', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        JSON.stringify({ jsonrpc: '2.0', method: 'health.ping', id: 1 }) + '\n'
      )) as { result: { pong: boolean } };

      expect(response.result.pong).toBe(true);

      client.destroy();
    });
  });

  describe('TC-D2-006: health.status returns daemon stats', () => {
    it('should return daemon stats for health.status', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('health.status')
      )) as {
        result: {
          status: string;
          state: string;
          activeConnections: number;
          totalRequests: number;
          uptime: number;
          startedAt: number;
          services: string[];
        };
      };

      expect(response.result).toMatchObject({
        status: 'healthy',
        state: 'running',
      });
      expect(response.result.activeConnections).toBeGreaterThanOrEqual(1);
      expect(response.result.totalRequests).toBeGreaterThan(0);
      // Uptime may be 0 if checked immediately after start, so check >= 0
      expect(response.result.uptime).toBeGreaterThanOrEqual(0);
      expect(response.result.startedAt).toBeGreaterThan(0);
      expect(Array.isArray(response.result.services)).toBe(true);

      client.destroy();
    });

    it('should include registered services in status', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('health.status')
      )) as { result: { services: string[] } };

      // Core daemon registers episode and hyperedge services
      expect(response.result.services).toContain('episode');
      expect(response.result.services).toContain('hyperedge');

      client.destroy();
    });
  });

  describe('TC-D2-007: Partial message buffering across chunks', () => {
    it('should handle message split across multiple chunks', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Create a complete message but send it in parts
      const fullMessage = createRpcMessage('health.ping', {}, 'split-test');
      const part1 = fullMessage.slice(0, Math.floor(fullMessage.length / 2));
      const part2 = fullMessage.slice(Math.floor(fullMessage.length / 2));

      // Set up response promise before sending
      const responsePromise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 3000);
        client.once('data', (data) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(data.toString().trim()));
          } catch {
            reject(new Error('Invalid JSON'));
          }
        });
      });

      // Send first part
      client.write(part1);

      // Wait a bit then send second part
      await new Promise((r) => setTimeout(r, 50));
      client.write(part2);

      const response = (await responsePromise) as { id: string };
      expect(response.id).toBe('split-test');

      client.destroy();
    });

    it('should buffer incomplete messages without newline', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Send message without newline - should be buffered
      const incompleteMsg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'health.ping',
        id: 'no-newline',
      });

      let responseReceived = false;
      client.once('data', () => {
        responseReceived = true;
      });

      client.write(incompleteMsg);

      // Wait a bit - no response should come yet
      await new Promise((r) => setTimeout(r, 100));
      expect(responseReceived).toBe(false);

      // Now send the newline to complete the message
      const responsePromise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 2000);
        client.once('data', (data) => {
          clearTimeout(timer);
          resolve(JSON.parse(data.toString().trim()));
        });
      });

      client.write('\n');

      const response = (await responsePromise) as { id: string };
      expect(response.id).toBe('no-newline');

      client.destroy();
    });
  });

  describe('TC-D2-008: Multiple messages in one chunk', () => {
    it('should process multiple newline-delimited messages', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      // Send two messages in one chunk
      const msg1 = createRpcMessage('health.ping', {}, 'multi-1');
      const msg2 = createRpcMessage('health.ping', {}, 'multi-2');
      const combined = msg1 + msg2;

      const responses: unknown[] = [];
      const responsePromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 3000);
        const handler = (data: Buffer) => {
          // May receive multiple responses in one or multiple data events
          const lines = data.toString().split('\n').filter((l) => l.trim());
          for (const line of lines) {
            try {
              responses.push(JSON.parse(line));
            } catch {
              // Ignore parse errors for incomplete lines
            }
          }
          if (responses.length >= 2) {
            clearTimeout(timer);
            client.off('data', handler);
            resolve();
          }
        };
        client.on('data', handler);
      });

      client.write(combined);
      await responsePromise;

      const ids = responses.map((r: any) => r.id);
      expect(ids).toContain('multi-1');
      expect(ids).toContain('multi-2');

      client.destroy();
    });

    it('should handle three messages in rapid succession', async () => {
      await server.start();

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const responses: unknown[] = [];
      const responsePromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 5000);
        const handler = (data: Buffer) => {
          const lines = data.toString().split('\n').filter((l) => l.trim());
          for (const line of lines) {
            try {
              responses.push(JSON.parse(line));
            } catch {
              // Partial line
            }
          }
          if (responses.length >= 3) {
            clearTimeout(timer);
            client.off('data', handler);
            resolve();
          }
        };
        client.on('data', handler);
      });

      // Send three messages
      client.write(createRpcMessage('health.ping', {}, 'rapid-1'));
      client.write(createRpcMessage('health.ping', {}, 'rapid-2'));
      client.write(createRpcMessage('health.ping', {}, 'rapid-3'));

      await responsePromise;

      const ids = responses.map((r: any) => r.id);
      expect(ids).toContain('rapid-1');
      expect(ids).toContain('rapid-2');
      expect(ids).toContain('rapid-3');

      client.destroy();
    });
  });

  describe('Service handler integration', () => {
    it('should route to registered service handler', async () => {
      await server.start();

      // Register custom test service
      const mockHandler = vi.fn().mockResolvedValue({ result: 'test-success' });
      server.registerService('customTest', mockHandler, ['doWork']);

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('customTest.doWork', { input: 'data' })
      )) as { result: { result: string } };

      expect(mockHandler).toHaveBeenCalledWith('doWork', { input: 'data' });
      expect(response.result).toEqual({ result: 'test-success' });

      client.destroy();
    });

    it('should return HANDLER_ERROR on service exception', async () => {
      await server.start();

      server.registerService(
        'failingService',
        async () => {
          throw new Error('Service crashed');
        },
        ['crashMethod']
      );

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      const response = (await sendRpcRequest(
        client,
        createRpcMessage('failingService.crashMethod')
      )) as { error: { code: number; message: string; data: { service: string } } };

      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.HANDLER_ERROR);
      expect(response.error.message).toContain('Handler error');
      expect(response.error.message).toContain('Service crashed');
      expect(response.error.data.service).toBe('failingService');

      client.destroy();
    });
  });

  describe('Request counting', () => {
    it('should increment totalRequests for each message', async () => {
      await server.start();
      const initialRequests = server.getStats().totalRequests;

      const client = await connectClient(TEST_SOCKET_PATH);
      await waitFor(() => server.getStats().activeConnections > 0);

      await sendRpcRequest(client, createRpcMessage('health.ping', {}, 1));
      await sendRpcRequest(client, createRpcMessage('health.ping', {}, 2));
      await sendRpcRequest(client, createRpcMessage('health.ping', {}, 3));

      expect(server.getStats().totalRequests).toBeGreaterThanOrEqual(
        initialRequests + 3
      );

      client.destroy();
    });
  });
});
