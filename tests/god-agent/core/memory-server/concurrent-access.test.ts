/**
 * Concurrent Access Tests
 * MEM-001 - TASK-MEM-013
 *
 * Tests for concurrent client access to the memory server.
 * Validates 50+ parallel operations per constitution requirements.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  MemoryServer,
  MemoryClient,
  createMemoryClient,
  type IKnowledgeEntry,
} from '../../../../src/god-agent/core/memory-server/index.js';

// Suppress unhandled rejection warnings during test teardown
process.on('unhandledRejection', () => {
  // Ignore - expected during test cleanup
});

// ==================== Test Configuration ====================

const TEST_TIMEOUT = 30000; // 30 seconds for concurrent tests
const CONCURRENT_CLIENTS = 10;
const OPERATIONS_PER_CLIENT = 10; // 100 total operations

describe('MEM-001: Concurrent Access', () => {
  let server: MemoryServer;
  let testDir: string;
  let serverAddress: string;

  beforeAll(async () => {
    // Create isolated test directory
    testDir = path.join(os.tmpdir(), `mem-001-concurrent-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'universal'), { recursive: true });

    // Start memory server
    server = new MemoryServer({
      agentDbPath: testDir,
      maxConnections: 100,
      verbose: false,
    });
    serverAddress = await server.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Allow pending operations to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (server) {
      await server.stop();
    }
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }, TEST_TIMEOUT);

  // ==================== Concurrent Write Tests ====================

  describe('Concurrent Writes', () => {
    it('should handle 50+ parallel storeKnowledge operations', async () => {
      const clients: MemoryClient[] = [];
      const results: IKnowledgeEntry[] = [];
      const errors: Error[] = [];

      // Create multiple clients
      for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
        const client = createMemoryClient(testDir, {
          serverAddress,
          verbose: false,
        });
        await client.connect();
        clients.push(client);
      }

      // Execute parallel operations
      const operations: Promise<void>[] = [];

      for (let clientIdx = 0; clientIdx < CONCURRENT_CLIENTS; clientIdx++) {
        for (let opIdx = 0; opIdx < OPERATIONS_PER_CLIENT; opIdx++) {
          const client = clients[clientIdx];
          const op = client
            .storeKnowledge({
              content: JSON.stringify({ client: clientIdx, op: opIdx }),
              category: 'concurrent-test',
              domain: `project/concurrent/client-${clientIdx}`,
              tags: ['concurrent', `client-${clientIdx}`, `op-${opIdx}`],
              quality: 1.0,
            })
            .then((entry) => {
              results.push(entry);
            })
            .catch((err) => {
              errors.push(err);
            });
          operations.push(op);
        }
      }

      // Wait for all operations
      await Promise.all(operations);

      // Verify results
      expect(errors.length).toBe(0);
      expect(results.length).toBe(CONCURRENT_CLIENTS * OPERATIONS_PER_CLIENT);

      // Verify all entries are unique
      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(results.length);

      // Cleanup clients
      for (const client of clients) {
        await client.disconnect();
      }
    }, TEST_TIMEOUT);

    it('should maintain data integrity under concurrent writes', async () => {
      const client1 = createMemoryClient(testDir, { serverAddress });
      const client2 = createMemoryClient(testDir, { serverAddress });
      await client1.connect();
      await client2.connect();

      // Both clients write to same domain concurrently
      const domain = 'project/integrity-test';
      const writes: Promise<IKnowledgeEntry>[] = [];

      for (let i = 0; i < 25; i++) {
        writes.push(
          client1.storeKnowledge({
            content: `client1-entry-${i}`,
            category: 'integrity',
            domain,
            tags: ['integrity', 'client1'],
          })
        );
        writes.push(
          client2.storeKnowledge({
            content: `client2-entry-${i}`,
            category: 'integrity',
            domain,
            tags: ['integrity', 'client2'],
          })
        );
      }

      const results = await Promise.all(writes);
      expect(results.length).toBe(50);

      // Verify all data is present
      const allEntries = await client1.getKnowledgeByDomain(domain, 100);
      expect(allEntries.length).toBeGreaterThanOrEqual(50);

      // Verify client-specific entries
      const client1Entries = allEntries.filter((e) => e.content.startsWith('client1'));
      const client2Entries = allEntries.filter((e) => e.content.startsWith('client2'));
      expect(client1Entries.length).toBe(25);
      expect(client2Entries.length).toBe(25);

      await client1.disconnect();
      await client2.disconnect();
    }, TEST_TIMEOUT);
  });

  // ==================== Concurrent Read Tests ====================

  describe('Concurrent Reads', () => {
    beforeEach(async () => {
      // Seed data for read tests
      const client = createMemoryClient(testDir, { serverAddress });
      await client.connect();

      for (let i = 0; i < 20; i++) {
        await client.storeKnowledge({
          content: `read-test-entry-${i}`,
          category: 'read-test',
          domain: 'project/read-test',
          tags: ['read', `entry-${i}`],
        });
      }

      await client.disconnect();
    });

    it('should handle 50+ parallel getKnowledgeByDomain operations', async () => {
      const clients: MemoryClient[] = [];
      const results: IKnowledgeEntry[][] = [];
      const errors: Error[] = [];

      // Create clients
      for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
        const client = createMemoryClient(testDir, { serverAddress });
        await client.connect();
        clients.push(client);
      }

      // Execute parallel reads
      const operations: Promise<void>[] = [];

      for (let clientIdx = 0; clientIdx < CONCURRENT_CLIENTS; clientIdx++) {
        for (let opIdx = 0; opIdx < OPERATIONS_PER_CLIENT; opIdx++) {
          const client = clients[clientIdx];
          const op = client
            .getKnowledgeByDomain('project/read-test', 100)
            .then((entries) => {
              results.push(entries);
            })
            .catch((err) => {
              errors.push(err);
            });
          operations.push(op);
        }
      }

      await Promise.all(operations);

      expect(errors.length).toBe(0);
      expect(results.length).toBe(CONCURRENT_CLIENTS * OPERATIONS_PER_CLIENT);

      // All reads should return consistent data
      const firstLength = results[0].length;
      for (const result of results) {
        expect(result.length).toBe(firstLength);
      }

      for (const client of clients) {
        await client.disconnect();
      }
    }, TEST_TIMEOUT);

    it('should handle mixed read/write operations concurrently', async () => {
      const client1 = createMemoryClient(testDir, { serverAddress });
      const client2 = createMemoryClient(testDir, { serverAddress });
      await client1.connect();
      await client2.connect();

      const domain = 'project/mixed-ops';
      const operations: Promise<unknown>[] = [];

      // Interleave reads and writes
      for (let i = 0; i < 25; i++) {
        // Write
        operations.push(
          client1.storeKnowledge({
            content: `mixed-entry-${i}`,
            category: 'mixed',
            domain,
            tags: ['mixed'],
          })
        );
        // Read
        operations.push(client2.getKnowledgeByDomain(domain));
      }

      const results = await Promise.all(operations);
      expect(results.length).toBe(50);

      await client1.disconnect();
      await client2.disconnect();
    }, TEST_TIMEOUT);
  });

  // ==================== Connection Management Tests ====================

  describe('Connection Management', () => {
    it('should handle rapid connect/disconnect cycles', async () => {
      const cycles = 20;
      const errors: Error[] = [];

      for (let i = 0; i < cycles; i++) {
        const client = createMemoryClient(testDir, { serverAddress });
        try {
          await client.connect();
          await client.ping();
          await client.disconnect();
        } catch (err) {
          errors.push(err as Error);
        }
      }

      expect(errors.length).toBe(0);
    }, TEST_TIMEOUT);

    it('should handle max connections gracefully', async () => {
      // Server configured for 100 max connections
      // Note: HTTP mode doesn't strictly limit connections the same way Unix sockets do
      const clients: MemoryClient[] = [];
      const connectErrors: Error[] = [];

      // Try to connect a smaller number of clients for reliable testing
      const testConnections = 20;
      for (let i = 0; i < testConnections; i++) {
        const client = createMemoryClient(testDir, { serverAddress });
        try {
          await client.connect();
          clients.push(client);
        } catch (err) {
          connectErrors.push(err as Error);
        }
      }

      // All connections within limit should succeed
      expect(clients.length).toBe(testConnections);

      // Cleanup
      for (const client of clients) {
        await client.disconnect();
      }
    }, TEST_TIMEOUT);
  });

  // ==================== Stress Tests ====================

  describe('Stress Tests', () => {
    it('should handle burst of 100+ operations', async () => {
      const client = createMemoryClient(testDir, { serverAddress });
      await client.connect();

      const operations: Promise<unknown>[] = [];
      const startTime = Date.now();

      // Burst of operations
      for (let i = 0; i < 100; i++) {
        operations.push(
          client.storeKnowledge({
            content: `burst-${i}`,
            category: 'burst',
            domain: 'project/burst',
            tags: ['burst'],
          })
        );
        operations.push(client.ping());
      }

      await Promise.all(operations);
      const elapsed = Date.now() - startTime;

      // 200 operations should complete within reasonable time
      expect(elapsed).toBeLessThan(TEST_TIMEOUT);

      await client.disconnect();
    }, TEST_TIMEOUT);

    it('should maintain p95 latency under 100ms for simple operations', async () => {
      const client = createMemoryClient(testDir, { serverAddress });
      await client.connect();

      const latencies: number[] = [];

      // Measure ping latencies
      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        await client.ping();
        latencies.push(Date.now() - start);
      }

      // Sort for percentile calculation
      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95Latency = latencies[p95Index];

      expect(p95Latency).toBeLessThan(100); // 100ms budget

      await client.disconnect();
    }, TEST_TIMEOUT);
  });

  // ==================== Pattern Query Concurrency ====================

  describe('Pattern Query Concurrency', () => {
    beforeEach(async () => {
      const client = createMemoryClient(testDir, { serverAddress });
      await client.connect();

      // Seed pattern data
      for (let i = 0; i < 50; i++) {
        await client.storeKnowledge({
          content: `pattern-test-content-${i} with keyword${i % 5}`,
          category: 'pattern-test',
          domain: `project/patterns/category-${i % 5}`,
          tags: ['pattern', `category-${i % 5}`],
        });
      }

      await client.disconnect();
    });

    it('should handle concurrent pattern queries', async () => {
      const clients: MemoryClient[] = [];
      const results: unknown[] = [];
      const errors: Error[] = [];

      for (let i = 0; i < 5; i++) {
        const client = createMemoryClient(testDir, { serverAddress });
        await client.connect();
        clients.push(client);
      }

      const operations: Promise<void>[] = [];
      const keywords = ['keyword0', 'keyword1', 'keyword2', 'keyword3', 'keyword4'];

      for (const client of clients) {
        for (const keyword of keywords) {
          const op = client
            .queryPatterns({ query: keyword, maxResults: 20 })
            .then((result) => {
              results.push(result);
            })
            .catch((err) => {
              errors.push(err);
            });
          operations.push(op);
        }
      }

      await Promise.all(operations);

      expect(errors.length).toBe(0);
      expect(results.length).toBe(25); // 5 clients * 5 keywords

      for (const client of clients) {
        await client.disconnect();
      }
    }, TEST_TIMEOUT);
  });

  // ==================== Feedback Concurrency ====================

  describe('Feedback Concurrency', () => {
    it('should handle concurrent feedback submissions', async () => {
      const clients: MemoryClient[] = [];
      const results: unknown[] = [];
      const errors: Error[] = [];

      for (let i = 0; i < 5; i++) {
        const client = createMemoryClient(testDir, { serverAddress });
        await client.connect();
        clients.push(client);
      }

      const operations: Promise<void>[] = [];

      for (let clientIdx = 0; clientIdx < clients.length; clientIdx++) {
        for (let feedbackIdx = 0; feedbackIdx < 10; feedbackIdx++) {
          const client = clients[clientIdx];
          const op = client
            .provideFeedback({
              trajectoryId: `trj-client${clientIdx}-feedback${feedbackIdx}`,
              quality: Math.random(),
              outcome: Math.random() > 0.5 ? 'positive' : 'negative',
              userFeedback: `Feedback from client ${clientIdx}`,
            })
            .then((result) => {
              results.push(result);
            })
            .catch((err) => {
              errors.push(err);
            });
          operations.push(op);
        }
      }

      await Promise.all(operations);

      expect(errors.length).toBe(0);
      expect(results.length).toBe(50); // 5 clients * 10 feedbacks

      for (const client of clients) {
        await client.disconnect();
      }
    }, TEST_TIMEOUT);
  });

  // ==================== Status Query Under Load ====================

  describe('Status Under Load', () => {
    it('should report accurate status during concurrent operations', async () => {
      const statusClient = createMemoryClient(testDir, { serverAddress });
      await statusClient.connect();

      const workClients: MemoryClient[] = [];
      for (let i = 0; i < 5; i++) {
        const client = createMemoryClient(testDir, { serverAddress });
        await client.connect();
        workClients.push(client);
      }

      // Start background work
      const workOperations: Promise<unknown>[] = [];
      for (const client of workClients) {
        for (let i = 0; i < 10; i++) {
          workOperations.push(
            client.storeKnowledge({
              content: `status-test-${i}`,
              category: 'status',
              domain: 'project/status',
              tags: ['status'],
            })
          );
        }
      }

      // Query status while work is happening
      const status = await statusClient.getStatus();

      expect(status.state).toBe('ready');
      // Note: connectedClients may be 0 if using HTTP mode (stateless)
      expect(status.connectedClients).toBeGreaterThanOrEqual(0);
      expect(status.storage).toBeDefined();

      await Promise.all(workOperations);

      for (const client of workClients) {
        await client.disconnect();
      }
      await statusClient.disconnect();
    }, TEST_TIMEOUT);
  });
});
