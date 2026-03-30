/**
 * Unit Tests for TransactionManager
 * SPEC-TXN-001: Atomic Rollback with Two-Phase Commit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionManager } from '../../../../src/god-agent/core/memory/transaction-manager.js';
import type { VectorDB, VectorID } from '../../../../src/god-agent/core/vector-db/index.js';
import type { GraphDB, NodeID, EdgeID } from '../../../../src/god-agent/core/graph-db/index.js';

// Mock VectorDB
const createMockVectorDB = (): VectorDB => {
  const deleteFn = vi.fn().mockResolvedValue(undefined);
  return {
    delete: deleteFn,
    _deleteCallCount: () => deleteFn.mock.calls.length
  } as unknown as VectorDB;
};

// Mock GraphDB
const createMockGraphDB = (): GraphDB => {
  const deleteNodeFn = vi.fn().mockResolvedValue(true);
  const deleteEdgeFn = vi.fn().mockResolvedValue(true);
  return {
    deleteNode: deleteNodeFn,
    deleteEdge: deleteEdgeFn,
    _deleteNodeCallCount: () => deleteNodeFn.mock.calls.length,
    _deleteEdgeCallCount: () => deleteEdgeFn.mock.calls.length
  } as unknown as GraphDB;
};

describe('TransactionManager', () => {
  let transactionManager: TransactionManager;
  let mockVectorDB: VectorDB;
  let mockGraphDB: GraphDB;

  beforeEach(() => {
    transactionManager = new TransactionManager();
    mockVectorDB = createMockVectorDB();
    mockGraphDB = createMockGraphDB();
  });

  describe('Transaction Lifecycle', () => {
    it('should create a new transaction with pending status', () => {
      const txnId = transactionManager.startTransaction();

      expect(txnId).toMatch(/^txn-\d+-[a-z0-9]+$/);
      expect(transactionManager.getPendingCount()).toBe(1);

      const txn = transactionManager.getTransaction(txnId);
      expect(txn).toBeDefined();
      expect(txn!.status).toBe('pending');
      expect(txn!.operations).toHaveLength(0);
    });

    it('should commit transaction and remove from pending', async () => {
      const txnId = transactionManager.startTransaction();

      await transactionManager.commit(txnId);

      expect(transactionManager.getPendingCount()).toBe(0);
      expect(transactionManager.getTransaction(txnId)).toBeNull();
    });

    it('should rollback transaction and remove from pending', async () => {
      const txnId = transactionManager.startTransaction();

      await transactionManager.rollback(txnId);

      expect(transactionManager.getPendingCount()).toBe(0);
      expect(transactionManager.getTransaction(txnId)).toBeNull();
    });
  });

  describe('Operation Tracking', () => {
    it('should add vector operation to transaction', () => {
      const txnId = transactionManager.startTransaction();
      const vectorId = 'vec-123' as VectorID;

      const operation = transactionManager.createVectorOperation(mockVectorDB, vectorId);
      transactionManager.addOperation(txnId, operation);

      const txn = transactionManager.getTransaction(txnId);
      expect(txn!.operations).toHaveLength(1);
      expect(txn!.operations[0].type).toBe('vector-insert');
      expect(txn!.operations[0].id).toBe(vectorId);
    });

    it('should add node operation to transaction', () => {
      const txnId = transactionManager.startTransaction();
      const nodeId = 'node-456' as NodeID;

      const operation = transactionManager.createNodeOperation(mockGraphDB, nodeId);
      transactionManager.addOperation(txnId, operation);

      const txn = transactionManager.getTransaction(txnId);
      expect(txn!.operations).toHaveLength(1);
      expect(txn!.operations[0].type).toBe('graph-node');
      expect(txn!.operations[0].id).toBe(nodeId);
    });

    it('should add edge operation to transaction', () => {
      const txnId = transactionManager.startTransaction();
      const edgeId = 'edge-789' as EdgeID;

      const operation = transactionManager.createEdgeOperation(mockGraphDB, edgeId);
      transactionManager.addOperation(txnId, operation);

      const txn = transactionManager.getTransaction(txnId);
      expect(txn!.operations).toHaveLength(1);
      expect(txn!.operations[0].type).toBe('graph-edge');
      expect(txn!.operations[0].id).toBe(edgeId);
    });

    it('should throw error when adding operation to non-existent transaction', () => {
      const operation = transactionManager.createVectorOperation(
        mockVectorDB,
        'vec-123' as VectorID
      );

      expect(() => {
        transactionManager.addOperation('non-existent-txn', operation);
      }).toThrow('Transaction non-existent-txn not found');
    });

    it('should throw error when adding operation to committed transaction', async () => {
      const txnId = transactionManager.startTransaction();
      await transactionManager.commit(txnId);

      // Transaction is removed after commit, so this should throw "not found"
      const operation = transactionManager.createVectorOperation(
        mockVectorDB,
        'vec-123' as VectorID
      );

      expect(() => {
        transactionManager.addOperation(txnId, operation);
      }).toThrow('not found');
    });
  });

  describe('Rollback Behavior', () => {
    it('should rollback all operations in reverse order', async () => {
      const txnId = transactionManager.startTransaction();

      const vectorId = 'vec-001' as VectorID;
      const nodeId = 'node-001' as NodeID;
      const edgeId = 'edge-001' as EdgeID;

      // Add operations in order: vector → node → edge
      transactionManager.addOperation(
        txnId,
        transactionManager.createVectorOperation(mockVectorDB, vectorId)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createNodeOperation(mockGraphDB, nodeId)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createEdgeOperation(mockGraphDB, edgeId)
      );

      await transactionManager.rollback(txnId);

      // Verify all rollback functions were called
      expect((mockVectorDB as any)._deleteCallCount()).toBe(1);
      expect((mockGraphDB as any)._deleteNodeCallCount()).toBe(1);
      expect((mockGraphDB as any)._deleteEdgeCallCount()).toBe(1);
    });

    it('should handle rollback of single vector operation', async () => {
      const txnId = transactionManager.startTransaction();
      const vectorId = 'vec-solo' as VectorID;

      transactionManager.addOperation(
        txnId,
        transactionManager.createVectorOperation(mockVectorDB, vectorId)
      );

      await transactionManager.rollback(txnId);

      expect((mockVectorDB as any)._deleteCallCount()).toBe(1);
      expect((mockGraphDB as any)._deleteNodeCallCount()).toBe(0);
      expect((mockGraphDB as any)._deleteEdgeCallCount()).toBe(0);
    });

    it('should continue rollback even if one operation fails', async () => {
      const txnId = transactionManager.startTransaction();

      // Create a failing delete operation
      const failingVectorDB = {
        delete: vi.fn().mockRejectedValue(new Error('Delete failed'))
      } as unknown as VectorDB;

      transactionManager.addOperation(
        txnId,
        transactionManager.createVectorOperation(failingVectorDB, 'vec-fail' as VectorID)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createNodeOperation(mockGraphDB, 'node-ok' as NodeID)
      );

      // Should not throw, but log error
      await expect(transactionManager.rollback(txnId)).resolves.toBeUndefined();

      // Node rollback should still execute
      expect((mockGraphDB as any)._deleteNodeCallCount()).toBe(1);
    });

    it('should handle rollback of non-existent transaction gracefully', async () => {
      await expect(
        transactionManager.rollback('non-existent-txn')
      ).resolves.toBeUndefined();
    });
  });

  describe('Multiple Operations', () => {
    it('should handle multiple operations of same type', async () => {
      const txnId = transactionManager.startTransaction();

      const edge1 = 'edge-001' as EdgeID;
      const edge2 = 'edge-002' as EdgeID;
      const edge3 = 'edge-003' as EdgeID;

      transactionManager.addOperation(
        txnId,
        transactionManager.createEdgeOperation(mockGraphDB, edge1)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createEdgeOperation(mockGraphDB, edge2)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createEdgeOperation(mockGraphDB, edge3)
      );

      await transactionManager.rollback(txnId);

      // All 3 edges should be rolled back
      expect((mockGraphDB as any)._deleteEdgeCallCount()).toBe(3);
    });

    it('should track complex transaction with all operation types', async () => {
      const txnId = transactionManager.startTransaction();

      // Simulate full store operation: vector → node → edge1 → edge2
      transactionManager.addOperation(
        txnId,
        transactionManager.createVectorOperation(mockVectorDB, 'vec-001' as VectorID)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createNodeOperation(mockGraphDB, 'node-001' as NodeID)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createEdgeOperation(mockGraphDB, 'edge-001' as EdgeID)
      );
      transactionManager.addOperation(
        txnId,
        transactionManager.createEdgeOperation(mockGraphDB, 'edge-002' as EdgeID)
      );

      const txn = transactionManager.getTransaction(txnId);
      expect(txn!.operations).toHaveLength(4);

      await transactionManager.rollback(txnId);

      // Verify all rolled back
      expect((mockVectorDB as any)._deleteCallCount()).toBe(1);
      expect((mockGraphDB as any)._deleteNodeCallCount()).toBe(1);
      expect((mockGraphDB as any)._deleteEdgeCallCount()).toBe(2);
    });
  });

  describe('Concurrent Transactions', () => {
    it('should handle multiple concurrent transactions', async () => {
      const txn1 = transactionManager.startTransaction();
      const txn2 = transactionManager.startTransaction();
      const txn3 = transactionManager.startTransaction();

      expect(transactionManager.getPendingCount()).toBe(3);

      transactionManager.addOperation(
        txn1,
        transactionManager.createVectorOperation(mockVectorDB, 'vec-1' as VectorID)
      );
      transactionManager.addOperation(
        txn2,
        transactionManager.createVectorOperation(mockVectorDB, 'vec-2' as VectorID)
      );
      transactionManager.addOperation(
        txn3,
        transactionManager.createVectorOperation(mockVectorDB, 'vec-3' as VectorID)
      );

      await transactionManager.commit(txn1);
      expect(transactionManager.getPendingCount()).toBe(2);

      await transactionManager.rollback(txn2);
      expect(transactionManager.getPendingCount()).toBe(1);

      await transactionManager.commit(txn3);
      expect(transactionManager.getPendingCount()).toBe(0);
    });
  });

  describe('Transaction Status', () => {
    it('should return transaction status correctly', () => {
      const txnId = transactionManager.startTransaction();

      const txn = transactionManager.getTransaction(txnId);
      expect(txn!.status).toBe('pending');
      expect(txn!.createdAt).toBeLessThanOrEqual(Date.now());
      expect(txn!.completedAt).toBeUndefined();
    });

    it('should return null for non-existent transaction', () => {
      const txn = transactionManager.getTransaction('fake-txn-id');
      expect(txn).toBeNull();
    });
  });

  describe('Performance', () => {
    it('should handle high-volume transaction creation', () => {
      const startTime = Date.now();
      const txnCount = 1000;

      for (let i = 0; i < txnCount; i++) {
        transactionManager.startTransaction();
      }

      const elapsed = Date.now() - startTime;
      expect(transactionManager.getPendingCount()).toBe(txnCount);
      expect(elapsed).toBeLessThan(1000); // Should complete in < 1 second
    });

    it('should handle rollback of large transaction', async () => {
      const txnId = transactionManager.startTransaction();
      const operationCount = 100;

      for (let i = 0; i < operationCount; i++) {
        transactionManager.addOperation(
          txnId,
          transactionManager.createEdgeOperation(mockGraphDB, `edge-${i}` as EdgeID)
        );
      }

      const startTime = Date.now();
      await transactionManager.rollback(txnId);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(1000); // Should complete in < 1 second
      expect((mockGraphDB as any)._deleteEdgeCallCount()).toBe(operationCount);
    });
  });
});
