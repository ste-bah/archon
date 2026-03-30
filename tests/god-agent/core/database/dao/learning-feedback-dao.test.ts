/**
 * LearningFeedbackDAO Tests - RLM Context Integration
 *
 * Implements: RULE-008, RULE-018, RULE-072, RULE-088
 * Tests the RLM (Relay Race Memory) context fields for learning feedback.
 *
 * Tests cover:
 * - Insert feedback with RLM context fields
 * - Retrieve feedback with RLM context fields
 * - Handle null RLM context fields
 * - Query by rlm_injection_success
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create unique test directory
 */
function createTestDir(prefix: string): string {
  const dir = path.join(tmpdir(), `${prefix}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clean up test directory
 */
function cleanupTestDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// LearningFeedbackDAO RLM Context Tests
// ============================================================

describe('LearningFeedbackDAO RLM Context', () => {
  let testDir: string;
  let dbConnection: any;
  let dao: any;

  beforeEach(async () => {
    testDir = createTestDir('learning-feedback-dao');

    // Dynamic import to avoid module resolution issues
    const { DatabaseConnection } = await import(
      '../../../../../src/god-agent/core/database/connection.js'
    );
    const { LearningFeedbackDAO } = await import(
      '../../../../../src/god-agent/core/database/dao/learning-feedback-dao.js'
    );

    // Create database connection
    dbConnection = new DatabaseConnection({
      dbPath: path.join(testDir, 'test.db'),
      verbose: false,
    });

    // Create DAO
    dao = new LearningFeedbackDAO(dbConnection);
  });

  afterEach(async () => {
    if (dbConnection) {
      await dbConnection.close();
    }
    cleanupTestDir(testDir);
  });

  describe('Insert feedback with RLM context fields', () => {
    it('should insert feedback with all RLM context fields', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.85,
        outcome: 'positive' as const,
        taskType: 'coding.implement',
        agentId: 'backend-dev',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'analyzer',
        rlmSourceStepIndex: 1,
        rlmSourceDomain: 'project/api/endpoints',
      };

      // Should not throw
      expect(() => dao.insert(feedback)).not.toThrow();

      // Verify inserted
      const retrieved = dao.findById(feedback.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved.rlmInjectionSuccess).toBe(true);
      expect(retrieved.rlmSourceAgent).toBe('analyzer');
      expect(retrieved.rlmSourceStepIndex).toBe(1);
      expect(retrieved.rlmSourceDomain).toBe('project/api/endpoints');
    });

    it('should insert feedback with rlmInjectionSuccess=true', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.9,
        outcome: 'positive' as const,
        taskType: 'coding.debug',
        agentId: 'coder',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'test-agent',
        rlmSourceStepIndex: 0,
        rlmSourceDomain: 'project/test',
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved.rlmInjectionSuccess).toBe(true);
    });

    it('should insert feedback with rlmInjectionSuccess=false', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.7,
        outcome: 'neutral' as const,
        taskType: 'coding.first',
        agentId: 'researcher',
        createdAt: Date.now(),
        rlmInjectionSuccess: false,
        // No source fields when injection fails
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved.rlmInjectionSuccess).toBe(false);
      expect(retrieved.rlmSourceAgent).toBeUndefined();
      expect(retrieved.rlmSourceStepIndex).toBeUndefined();
      expect(retrieved.rlmSourceDomain).toBeUndefined();
    });
  });

  describe('Retrieve feedback with RLM context fields', () => {
    it('should retrieve feedback by ID with RLM fields', () => {
      const id = `fb-${randomUUID()}`;
      const feedback = {
        id,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.92,
        outcome: 'positive' as const,
        taskType: 'coding.refactor',
        agentId: 'reviewer',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'coder',
        rlmSourceStepIndex: 2,
        rlmSourceDomain: 'project/backend/services',
      };

      dao.insert(feedback);
      const retrieved = dao.findById(id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(id);
      expect(retrieved.rlmInjectionSuccess).toBe(true);
      expect(retrieved.rlmSourceAgent).toBe('coder');
      expect(retrieved.rlmSourceStepIndex).toBe(2);
      expect(retrieved.rlmSourceDomain).toBe('project/backend/services');
    });

    it('should retrieve feedback by trajectory ID with RLM fields', () => {
      const trajectoryId = `trj-${randomUUID()}`;

      // Insert multiple feedbacks for same trajectory
      for (let i = 0; i < 3; i++) {
        dao.insert({
          id: `fb-${randomUUID()}`,
          trajectoryId,
          quality: 0.7 + i * 0.1,
          outcome: i === 0 ? 'negative' : 'positive',
          taskType: 'coding.test',
          agentId: 'tester',
          createdAt: Date.now() + i,
          rlmInjectionSuccess: i > 0,
          rlmSourceAgent: i > 0 ? `agent-${i}` : undefined,
          rlmSourceStepIndex: i > 0 ? i : undefined,
          rlmSourceDomain: i > 0 ? `project/step-${i}` : undefined,
        });
      }

      const feedbacks = dao.findByTrajectoryId(trajectoryId);

      expect(feedbacks.length).toBe(3);

      // First feedback (step 0) should have no injection
      const first = feedbacks.find(f => f.rlmInjectionSuccess === false);
      expect(first).toBeDefined();
      expect(first?.rlmSourceAgent).toBeUndefined();

      // Other feedbacks should have injection
      const withInjection = feedbacks.filter(f => f.rlmInjectionSuccess === true);
      expect(withInjection.length).toBe(2);
    });
  });

  describe('Handle null RLM context fields', () => {
    it('should handle feedback without RLM fields (all undefined)', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.8,
        outcome: 'positive' as const,
        taskType: 'coding.legacy',
        agentId: 'migrator',
        createdAt: Date.now(),
        // No RLM fields
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.rlmInjectionSuccess).toBeUndefined();
      expect(retrieved.rlmSourceAgent).toBeUndefined();
      expect(retrieved.rlmSourceStepIndex).toBeUndefined();
      expect(retrieved.rlmSourceDomain).toBeUndefined();
    });

    it('should handle feedback with explicit undefined RLM fields', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.75,
        outcome: 'neutral' as const,
        taskType: 'coding.explore',
        agentId: 'planner',
        createdAt: Date.now(),
        rlmInjectionSuccess: undefined,
        rlmSourceAgent: undefined,
        rlmSourceStepIndex: undefined,
        rlmSourceDomain: undefined,
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.rlmInjectionSuccess).toBeUndefined();
    });

    it('should handle partial RLM fields (only injectionSuccess)', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.6,
        outcome: 'negative' as const,
        taskType: 'coding.fix',
        agentId: 'debugger',
        createdAt: Date.now(),
        rlmInjectionSuccess: false,
        // Partial: no source fields
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.rlmInjectionSuccess).toBe(false);
      expect(retrieved.rlmSourceAgent).toBeUndefined();
      expect(retrieved.rlmSourceStepIndex).toBeUndefined();
      expect(retrieved.rlmSourceDomain).toBeUndefined();
    });

    it('should preserve RLM fields through findUnprocessed', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.88,
        outcome: 'positive' as const,
        taskType: 'coding.optimize',
        agentId: 'optimizer',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'analyzer',
        rlmSourceStepIndex: 3,
        rlmSourceDomain: 'project/performance',
      };

      dao.insert(feedback);

      const unprocessed = dao.findUnprocessed(10);
      expect(unprocessed.length).toBeGreaterThan(0);

      const found = unprocessed.find(f => f.id === feedback.id);
      expect(found).toBeDefined();
      expect(found?.rlmInjectionSuccess).toBe(true);
      expect(found?.rlmSourceAgent).toBe('analyzer');
      expect(found?.rlmSourceStepIndex).toBe(3);
      expect(found?.rlmSourceDomain).toBe('project/performance');
    });
  });

  describe('Query by rlm_injection_success', () => {
    beforeEach(() => {
      // Insert test data with various RLM injection statuses
      const testData = [
        { success: true, quality: 0.9, agentId: 'agent-1' },
        { success: true, quality: 0.85, agentId: 'agent-2' },
        { success: false, quality: 0.6, agentId: 'agent-3' },
        { success: true, quality: 0.95, agentId: 'agent-4' },
        { success: false, quality: 0.5, agentId: 'agent-5' },
        { success: undefined, quality: 0.75, agentId: 'agent-6' }, // Legacy feedback
      ];

      for (const data of testData) {
        dao.insert({
          id: `fb-${randomUUID()}`,
          trajectoryId: `trj-${randomUUID()}`,
          quality: data.quality,
          outcome: data.quality >= 0.7 ? 'positive' : 'negative',
          taskType: 'coding.test',
          agentId: data.agentId,
          createdAt: Date.now(),
          rlmInjectionSuccess: data.success,
          rlmSourceAgent: data.success ? 'source-agent' : undefined,
          rlmSourceStepIndex: data.success ? 1 : undefined,
          rlmSourceDomain: data.success ? 'project/test' : undefined,
        });
      }
    });

    it('should count feedback by injection status via stats', () => {
      const stats = dao.getStats();

      // All 6 feedbacks should be counted
      expect(stats.feedbackCount).toBe(6);
    });

    it('should retrieve unprocessed feedback with mixed RLM status', () => {
      const unprocessed = dao.findUnprocessed(100);

      // Should have all 6
      expect(unprocessed.length).toBe(6);

      // Count by injection status
      const withSuccess = unprocessed.filter(f => f.rlmInjectionSuccess === true);
      const withFailure = unprocessed.filter(f => f.rlmInjectionSuccess === false);
      const withNull = unprocessed.filter(f => f.rlmInjectionSuccess === undefined);

      expect(withSuccess.length).toBe(3);
      expect(withFailure.length).toBe(2);
      expect(withNull.length).toBe(1);
    });

    it('should preserve RLM context when marking processed', () => {
      // Get an unprocessed feedback with RLM context
      const unprocessed = dao.findUnprocessed(1);
      expect(unprocessed.length).toBe(1);

      const feedback = unprocessed[0];
      const originalRlmSuccess = feedback.rlmInjectionSuccess;
      const originalSourceAgent = feedback.rlmSourceAgent;

      // Mark as processed
      dao.markProcessed(feedback.id);

      // Retrieve again - RLM fields should be preserved
      const retrieved = dao.findById(feedback.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved.processed).toBe(true);
      expect(retrieved.rlmInjectionSuccess).toBe(originalRlmSuccess);
      expect(retrieved.rlmSourceAgent).toBe(originalSourceAgent);
    });
  });

  describe('RLM context validation', () => {
    it('should accept rlmSourceStepIndex=0 (first step retrieval)', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.82,
        outcome: 'positive' as const,
        taskType: 'coding.chain',
        agentId: 'chainer',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'first-agent',
        rlmSourceStepIndex: 0, // Step 0 retrieval (second agent retrieving from first)
        rlmSourceDomain: 'project/step-0',
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved.rlmSourceStepIndex).toBe(0);
    });

    it('should handle high step indices', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.78,
        outcome: 'positive' as const,
        taskType: 'coding.long-pipeline',
        agentId: 'final-agent',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'penultimate-agent',
        rlmSourceStepIndex: 99, // Large pipeline
        rlmSourceDomain: 'project/step-99',
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved.rlmSourceStepIndex).toBe(99);
    });

    it('should handle long domain names', () => {
      const longDomain = 'project/deeply/nested/domain/structure/for/complex/workflows';
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.88,
        outcome: 'positive' as const,
        taskType: 'coding.complex',
        agentId: 'complex-agent',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'previous-complex-agent',
        rlmSourceStepIndex: 5,
        rlmSourceDomain: longDomain,
      };

      dao.insert(feedback);
      const retrieved = dao.findById(feedback.id);

      expect(retrieved.rlmSourceDomain).toBe(longDomain);
    });
  });

  describe('RULE-018: Append-only compliance', () => {
    it('should not allow delete of feedback with RLM context', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.9,
        outcome: 'positive' as const,
        taskType: 'coding.test',
        agentId: 'test-agent',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
        rlmSourceAgent: 'source',
        rlmSourceStepIndex: 1,
        rlmSourceDomain: 'project/test',
      };

      dao.insert(feedback);

      // Attempt to delete should throw
      expect(() => dao.delete(feedback.id)).toThrow('RULE-018 VIOLATION');
    });

    it('should not allow clear of feedback with RLM context', () => {
      const feedback = {
        id: `fb-${randomUUID()}`,
        trajectoryId: `trj-${randomUUID()}`,
        quality: 0.85,
        outcome: 'positive' as const,
        taskType: 'coding.test',
        agentId: 'test-agent',
        createdAt: Date.now(),
        rlmInjectionSuccess: true,
      };

      dao.insert(feedback);

      // Attempt to clear should throw
      expect(() => dao.clear()).toThrow('RULE-018 VIOLATION');
    });
  });
});
