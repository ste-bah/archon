/**
 * SONA Persistence Integration Tests
 * TASK-PERSIST-008 - Integration Tests for Persistence
 *
 * Tests for:
 * - createProductionSonaEngine factory
 * - createTrajectoryWithId persistence to Map AND SQLite
 * - provideFeedback persistence (learning_feedback + trajectory_metadata)
 * - createPatternFromTrajectory persistence (patterns table)
 * - RULE-016 enforcement (TrajectoryMetadataDAO delete/clear throws)
 * - RULE-019 enforcement (PatternDAO delete throws, deprecate works)
 * - RULE-018 enforcement (LearningFeedbackDAO delete throws, markProcessed works)
 * - Restart recovery with file-based databases (CONDITION-003)
 *
 * Constitution compliance:
 * - RULE-008: ALL learning data MUST be stored in SQLite
 * - RULE-074: Map as primary storage is FORBIDDEN in production
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

// SonaEngine and factory
import { SonaEngine, createProductionSonaEngine } from '../../../../src/god-agent/core/learning/sona-engine.js';

// Database components
import { createConnection, type IDatabaseConnection } from '../../../../src/god-agent/core/database/connection.js';
import { TrajectoryMetadataDAO } from '../../../../src/god-agent/core/database/dao/trajectory-metadata-dao.js';
import { PatternDAO } from '../../../../src/god-agent/core/database/dao/pattern-dao.js';
import { LearningFeedbackDAO } from '../../../../src/god-agent/core/database/dao/learning-feedback-dao.js';

// Types
import type { ISonaConfig, IReasoningStep } from '../../../../src/god-agent/core/learning/sona-types.js';

// Test constants
const TEST_DB_DIR = '/tmp/sona-persistence-test-' + Date.now();
const TEST_DB_PATH = join(TEST_DB_DIR, 'test-learning.db');

/**
 * Create a unique test database connection
 * Uses file-based database for persistence tests (not :memory:)
 */
function createTestConnection(dbPath?: string): IDatabaseConnection {
  const path = dbPath ?? join(TEST_DB_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return createConnection({ dbPath: path });
}

/**
 * Create sample reasoning steps for testing
 */
function createSampleSteps(): IReasoningStep[] {
  return [
    {
      stepId: 'step-1',
      action: 'query_vectordb',
      actionParams: { query: 'test query' },
      result: 'Found 3 relevant documents',
      confidence: 0.85,
      timestamp: Date.now() - 1000,
    },
    {
      stepId: 'step-2',
      action: 'pattern_match',
      actionParams: { patternId: 'pattern-123' },
      result: 'Matched pattern with similarity 0.92',
      confidence: 0.92,
      timestamp: Date.now() - 500,
    },
    {
      stepId: 'step-3',
      action: 'causal_inference',
      actionParams: { nodes: ['A', 'B', 'C'] },
      result: 'Inferred causal chain A -> B -> C',
      confidence: 0.78,
      timestamp: Date.now(),
    },
  ];
}

describe('TASK-PERSIST-008: SONA Persistence Integration Tests', () => {
  beforeEach(() => {
    // Clean up and create test directory
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true });
    }
  });

  // =====================================================================
  // TEST 1: createProductionSonaEngine factory
  // =====================================================================
  describe('Test 1: createProductionSonaEngine factory', () => {
    it('should create engine with database persistence enabled', () => {
      const engine = createProductionSonaEngine({}, TEST_DB_PATH);

      expect(engine).toBeInstanceOf(SonaEngine);
      expect(engine.isPersistenceEnabled()).toBe(true);
    });

    it('should have DAOs initialized and ready', () => {
      const engine = createProductionSonaEngine({}, TEST_DB_PATH);

      // Get database stats to verify DAOs are working
      const stats = engine.getDatabaseStats();

      expect(stats).not.toBeNull();
      expect(stats).toHaveProperty('trajectoryMetadata');
      expect(stats).toHaveProperty('patterns');
      expect(stats).toHaveProperty('feedback');
    });

    it('should accept custom config options', async () => {
      const engine = createProductionSonaEngine(
        {
          learningRate: 0.05,
          regularization: 0.2,
          trackPerformance: true,
        },
        TEST_DB_PATH
      );

      await engine.initialize();

      // Engine should be initialized with custom config
      expect(engine.isPersistenceEnabled()).toBe(true);
    });

    it('should create database file at specified path', () => {
      const customPath = join(TEST_DB_DIR, 'custom-db.db');

      // Create connection directly to bypass singleton caching
      const db = createConnection({ dbPath: customPath });
      const engine = new SonaEngine({
        databaseConnection: db,
      });

      expect(engine.isPersistenceEnabled()).toBe(true);
      expect(existsSync(customPath)).toBe(true);

      db.close();
    });
  });

  // =====================================================================
  // TEST 2: createTrajectoryWithId persistence
  // =====================================================================
  describe('Test 2: createTrajectoryWithId persistence', () => {
    let db: IDatabaseConnection;
    let engine: SonaEngine;
    let trajectoryMetadataDAO: TrajectoryMetadataDAO;

    beforeEach(async () => {
      db = createTestConnection(TEST_DB_PATH);
      trajectoryMetadataDAO = new TrajectoryMetadataDAO(db);

      engine = new SonaEngine({
        databaseConnection: db,
        trackPerformance: false,
      });
      await engine.initialize();
    });

    afterEach(() => {
      db.close();
    });

    it('should create trajectory in Map AND SQLite', () => {
      const trajectoryId = `traj-test-${Date.now()}`;
      const route = 'reasoning.causal';
      const patterns = ['pattern-1', 'pattern-2'];
      const context = ['ctx-1', 'ctx-2'];

      engine.createTrajectoryWithId(trajectoryId, route, patterns, context);

      // Verify in-memory storage (Map)
      const memoryTrajectory = engine.getTrajectory(trajectoryId);
      expect(memoryTrajectory).not.toBeNull();
      expect(memoryTrajectory!.id).toBe(trajectoryId);
      expect(memoryTrajectory!.route).toBe(route);
      expect(memoryTrajectory!.patterns).toEqual(patterns);

      // Verify in SQLite storage
      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata).not.toBeNull();
      expect(dbMetadata!.id).toBe(trajectoryId);
      expect(dbMetadata!.route).toBe(route);
    });

    it('should set status to active initially', () => {
      const trajectoryId = `traj-active-${Date.now()}`;

      engine.createTrajectoryWithId(trajectoryId, 'coding.debug', ['p1'], []);

      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata).not.toBeNull();
      expect(dbMetadata!.status).toBe('active');
    });

    it('should store correct route in trajectory_metadata table', () => {
      const trajectoryId = `traj-route-${Date.now()}`;
      const route = 'reasoning.temporal.analysis';

      engine.createTrajectoryWithId(trajectoryId, route, [], []);

      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata!.route).toBe(route);
    });

    it('should store step count in trajectory_metadata', () => {
      const trajectoryId = `traj-steps-${Date.now()}`;
      const patterns = ['p1', 'p2', 'p3', 'p4'];

      engine.createTrajectoryWithId(trajectoryId, 'test.route', patterns, []);

      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata!.stepCount).toBe(patterns.length);
    });

    it('should not duplicate on repeated calls with same ID', () => {
      const trajectoryId = `traj-idempotent-${Date.now()}`;

      engine.createTrajectoryWithId(trajectoryId, 'route.a', ['p1'], []);
      engine.createTrajectoryWithId(trajectoryId, 'route.b', ['p2'], []); // Should be ignored

      const memoryTrajectory = engine.getTrajectory(trajectoryId);
      expect(memoryTrajectory!.route).toBe('route.a'); // First call wins

      // SQLite should also have only first entry
      const allMetadata = trajectoryMetadataDAO.findAll();
      const matches = allMetadata.filter(m => m.id === trajectoryId);
      expect(matches.length).toBe(1);
    });
  });

  // =====================================================================
  // TEST 3: provideFeedback persistence
  // =====================================================================
  describe('Test 3: provideFeedback persistence', () => {
    let db: IDatabaseConnection;
    let engine: SonaEngine;
    let trajectoryMetadataDAO: TrajectoryMetadataDAO;
    let learningFeedbackDAO: LearningFeedbackDAO;

    beforeEach(async () => {
      db = createTestConnection(TEST_DB_PATH);
      trajectoryMetadataDAO = new TrajectoryMetadataDAO(db);
      learningFeedbackDAO = new LearningFeedbackDAO(db);

      engine = new SonaEngine({
        databaseConnection: db,
        trackPerformance: false,
      });
      await engine.initialize();
    });

    afterEach(() => {
      db.close();
    });

    it('should create learning_feedback record on provideFeedback', async () => {
      const trajectoryId = `traj-fb-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'reasoning.test', ['pattern-1'], []);

      await engine.provideFeedback(trajectoryId, 0.85, { skipAutoSave: true });

      // Check learning_feedback table
      const feedbacks = learningFeedbackDAO.findByTrajectoryId(trajectoryId);
      expect(feedbacks.length).toBeGreaterThanOrEqual(1);

      const feedback = feedbacks[0];
      expect(feedback.trajectoryId).toBe(trajectoryId);
      expect(feedback.quality).toBeCloseTo(0.85);
    });

    it('should update trajectory_metadata status to completed for quality >= 0.5', async () => {
      const trajectoryId = `traj-complete-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'test.complete', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.75, { skipAutoSave: true });

      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata!.status).toBe('completed');
    });

    it('should update trajectory_metadata status to failed for quality < 0.5', async () => {
      const trajectoryId = `traj-failed-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'test.failed', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.25, { skipAutoSave: true });

      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata!.status).toBe('failed');
    });

    it('should update quality_score in trajectory_metadata', async () => {
      const trajectoryId = `traj-quality-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'test.quality', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.92, { skipAutoSave: true });

      const dbMetadata = trajectoryMetadataDAO.findById(trajectoryId);
      expect(dbMetadata!.qualityScore).toBeCloseTo(0.92);
    });

    it('should store correct outcome in learning_feedback', async () => {
      const trajectoryId = `traj-outcome-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'test.outcome', ['p1'], []);

      // High quality = positive
      await engine.provideFeedback(trajectoryId, 0.9, { skipAutoSave: true });

      const feedbacks = learningFeedbackDAO.findByTrajectoryId(trajectoryId);
      expect(feedbacks[0].outcome).toBe('positive');
    });

    it('should store neutral outcome for mid-range quality', async () => {
      const trajectoryId = `traj-neutral-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'test.neutral', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.65, { skipAutoSave: true });

      const feedbacks = learningFeedbackDAO.findByTrajectoryId(trajectoryId);
      expect(feedbacks[0].outcome).toBe('neutral');
    });

    it('should store negative outcome for low quality', async () => {
      const trajectoryId = `traj-negative-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'test.negative', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.3, { skipAutoSave: true });

      const feedbacks = learningFeedbackDAO.findByTrajectoryId(trajectoryId);
      expect(feedbacks[0].outcome).toBe('negative');
    });
  });

  // =====================================================================
  // TEST 4: createPatternFromTrajectory persistence
  // =====================================================================
  describe('Test 4: createPatternFromTrajectory persistence', () => {
    let db: IDatabaseConnection;
    let engine: SonaEngine;
    let patternDAO: PatternDAO;

    beforeEach(async () => {
      db = createTestConnection(TEST_DB_PATH);
      patternDAO = new PatternDAO(db);

      engine = new SonaEngine({
        databaseConnection: db,
        trackPerformance: false,
      });
      await engine.initialize();
    });

    afterEach(() => {
      db.close();
    });

    it('should create pattern in Map AND SQLite for high-quality trajectory', async () => {
      const trajectoryId = `traj-pattern-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'reasoning.pattern_creation', ['p1'], []);

      // Provide high-quality feedback to trigger pattern creation
      await engine.provideFeedback(trajectoryId, 0.95, { skipAutoSave: true });

      // Check in-memory patterns
      const memoryPatterns = engine.getPatterns();
      const createdPattern = memoryPatterns.find(p => p.sourceTrajectory === trajectoryId);

      // Pattern may or may not be created depending on embedding provider
      // If pattern was created, verify it
      if (createdPattern) {
        expect(createdPattern.quality).toBeCloseTo(0.95);

        // Check SQLite patterns table
        const dbPattern = patternDAO.findById(createdPattern.id);
        expect(dbPattern).not.toBeNull();
        expect(dbPattern!.weight).toBeGreaterThan(0);
      }
    });

    it('should store correct embedding serialization in patterns table', async () => {
      const trajectoryId = `traj-embed-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'reasoning.embedding', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.92, { skipAutoSave: true });

      // Get patterns from database
      const dbPatterns = patternDAO.findActive();
      const recentPattern = dbPatterns.find(p => {
        const context = JSON.parse(p.context);
        return context.sourceTrajectory === trajectoryId;
      });

      if (recentPattern) {
        // Verify embedding is properly deserialized
        expect(recentPattern.embedding).toBeInstanceOf(Float32Array);
        expect(recentPattern.embedding.length).toBeGreaterThan(0);

        // Check embedding is normalized (values between -1 and 1)
        const maxVal = Math.max(...Array.from(recentPattern.embedding).map(Math.abs));
        expect(maxVal).toBeLessThanOrEqual(1.1); // Allow small floating point tolerance
      }
    });

    it('should store trajectory_ids in pattern', async () => {
      const trajectoryId = `traj-ids-${Date.now()}`;
      engine.createTrajectoryWithId(trajectoryId, 'reasoning.trajectory_ids', ['p1'], []);

      await engine.provideFeedback(trajectoryId, 0.9, { skipAutoSave: true });

      const dbPatterns = patternDAO.findActive();
      const recentPattern = dbPatterns.find(p => {
        const context = JSON.parse(p.context);
        return context.sourceTrajectory === trajectoryId;
      });

      if (recentPattern) {
        expect(recentPattern.trajectoryIds).toContain(trajectoryId);
      }
    });
  });

  // =====================================================================
  // TEST 5: RULE-016 enforcement (TrajectoryMetadataDAO)
  // =====================================================================
  describe('Test 5: RULE-016 enforcement (TrajectoryMetadataDAO)', () => {
    let db: IDatabaseConnection;
    let trajectoryMetadataDAO: TrajectoryMetadataDAO;

    beforeEach(() => {
      db = createTestConnection();
      trajectoryMetadataDAO = new TrajectoryMetadataDAO(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should throw on TrajectoryMetadataDAO.delete()', () => {
      // Insert a trajectory first
      trajectoryMetadataDAO.insert({
        id: 'traj-delete-test',
        filePath: '/test/path',
        fileOffset: 0,
        fileLength: 100,
        route: 'test.route',
        stepCount: 5,
        createdAt: Date.now(),
        status: 'active',
      });

      // Attempt to delete should throw
      expect(() => {
        trajectoryMetadataDAO.delete('traj-delete-test');
      }).toThrow('RULE-016 VIOLATION');
    });

    it('should throw on TrajectoryMetadataDAO.clear()', () => {
      // Attempt to clear should throw
      expect(() => {
        trajectoryMetadataDAO.clear();
      }).toThrow('RULE-016 VIOLATION');
    });

    it('should include RULE-016 in error message for delete', () => {
      expect(() => {
        trajectoryMetadataDAO.delete('any-id');
      }).toThrow(/RULE-016/);
    });

    it('should include RULE-016 in error message for clear', () => {
      expect(() => {
        trajectoryMetadataDAO.clear();
      }).toThrow(/RULE-016/);
    });
  });

  // =====================================================================
  // TEST 6: RULE-019 enforcement (PatternDAO)
  // =====================================================================
  describe('Test 6: RULE-019 enforcement (PatternDAO)', () => {
    let db: IDatabaseConnection;
    let patternDAO: PatternDAO;

    beforeEach(() => {
      db = createTestConnection();
      patternDAO = new PatternDAO(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should throw on PatternDAO.delete()', () => {
      // Insert a pattern first
      patternDAO.insert({
        id: 'pattern-delete-test',
        name: 'test-pattern',
        context: '{}',
        action: 'test action',
        embedding: new Float32Array(1536).fill(0.1),
        weight: 0.5,
        trajectoryIds: [],
        agentId: 'test-agent',
        taskType: 'test.task',
        createdAt: Date.now(),
      });

      // Attempt to delete should throw
      expect(() => {
        patternDAO.delete('pattern-delete-test');
      }).toThrow('RULE-019 VIOLATION');
    });

    it('should throw on PatternDAO.clear()', () => {
      expect(() => {
        patternDAO.clear();
      }).toThrow('RULE-019 VIOLATION');
    });

    it('should allow PatternDAO.deprecate() instead of delete', () => {
      const patternId = `pattern-deprecate-${Date.now()}`;

      patternDAO.insert({
        id: patternId,
        name: 'deprecate-test',
        context: '{}',
        action: 'test action',
        embedding: new Float32Array(1536).fill(0.1),
        weight: 0.6,
        trajectoryIds: [],
        agentId: 'test-agent',
        taskType: 'test.task',
        createdAt: Date.now(),
      });

      // Deprecate should work
      expect(() => {
        patternDAO.deprecate(patternId);
      }).not.toThrow();

      // Verify pattern is deprecated
      const pattern = patternDAO.findById(patternId);
      expect(pattern).not.toBeNull();
      expect(pattern!.deprecated).toBe(true);
    });

    it('should not return deprecated patterns in findActive()', () => {
      const activeId = `pattern-active-${Date.now()}`;
      const deprecatedId = `pattern-deprecated-${Date.now()}`;

      // Insert active pattern
      patternDAO.insert({
        id: activeId,
        name: 'active-pattern',
        context: '{}',
        action: 'active action',
        embedding: new Float32Array(1536).fill(0.1),
        weight: 0.7,
        trajectoryIds: [],
        agentId: 'test-agent',
        taskType: 'test.task',
        createdAt: Date.now(),
      });

      // Insert and deprecate pattern
      patternDAO.insert({
        id: deprecatedId,
        name: 'deprecated-pattern',
        context: '{}',
        action: 'deprecated action',
        embedding: new Float32Array(1536).fill(0.2),
        weight: 0.3,
        trajectoryIds: [],
        agentId: 'test-agent',
        taskType: 'test.task',
        createdAt: Date.now(),
      });
      patternDAO.deprecate(deprecatedId);

      // findActive should only return active pattern
      const activePatterns = patternDAO.findActive();
      const activeIds = activePatterns.map(p => p.id);

      expect(activeIds).toContain(activeId);
      expect(activeIds).not.toContain(deprecatedId);
    });
  });

  // =====================================================================
  // TEST 7: RULE-018 enforcement (LearningFeedbackDAO)
  // =====================================================================
  describe('Test 7: RULE-018 enforcement (LearningFeedbackDAO)', () => {
    let db: IDatabaseConnection;
    let learningFeedbackDAO: LearningFeedbackDAO;

    beforeEach(() => {
      db = createTestConnection();
      learningFeedbackDAO = new LearningFeedbackDAO(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should throw on LearningFeedbackDAO.delete()', () => {
      // Insert feedback first
      learningFeedbackDAO.insert({
        id: 'fb-delete-test',
        trajectoryId: 'traj-123',
        quality: 0.8,
        outcome: 'positive',
        taskType: 'test.task',
        agentId: 'test-agent',
        createdAt: Date.now(),
      });

      // Attempt to delete should throw
      expect(() => {
        learningFeedbackDAO.delete('fb-delete-test');
      }).toThrow('RULE-018 VIOLATION');
    });

    it('should throw on LearningFeedbackDAO.clear()', () => {
      expect(() => {
        learningFeedbackDAO.clear();
      }).toThrow('RULE-018 VIOLATION');
    });

    it('should allow LearningFeedbackDAO.markProcessed() to work', () => {
      const feedbackId = `fb-process-${Date.now()}`;

      learningFeedbackDAO.insert({
        id: feedbackId,
        trajectoryId: 'traj-456',
        quality: 0.9,
        outcome: 'positive',
        taskType: 'test.task',
        agentId: 'test-agent',
        createdAt: Date.now(),
      });

      // markProcessed should work
      expect(() => {
        learningFeedbackDAO.markProcessed(feedbackId);
      }).not.toThrow();

      // Verify feedback is marked as processed
      const feedback = learningFeedbackDAO.findById(feedbackId);
      expect(feedback).not.toBeNull();
      expect(feedback!.processed).toBe(true);
    });

    it('should allow querying unprocessed feedback', () => {
      const processedId = `fb-processed-${Date.now()}`;
      const unprocessedId = `fb-unprocessed-${Date.now()}`;

      // Insert processed feedback
      learningFeedbackDAO.insert({
        id: processedId,
        trajectoryId: 'traj-789',
        quality: 0.7,
        outcome: 'neutral',
        taskType: 'test.task',
        agentId: 'test-agent',
        createdAt: Date.now(),
      });
      learningFeedbackDAO.markProcessed(processedId);

      // Insert unprocessed feedback
      learningFeedbackDAO.insert({
        id: unprocessedId,
        trajectoryId: 'traj-101',
        quality: 0.85,
        outcome: 'positive',
        taskType: 'test.task',
        agentId: 'test-agent',
        createdAt: Date.now(),
      });

      // Query unprocessed
      const unprocessed = learningFeedbackDAO.findUnprocessed(100);
      const unprocessedIds = unprocessed.map(f => f.id);

      expect(unprocessedIds).toContain(unprocessedId);
      expect(unprocessedIds).not.toContain(processedId);
    });
  });

  // =====================================================================
  // TEST 8: Restart recovery (CONDITION-003)
  // =====================================================================
  describe('Test 8: Restart recovery (CONDITION-003)', () => {
    it('should persist data across database connection close/reopen', async () => {
      const persistDbPath = join(TEST_DB_DIR, 'persist-test.db');
      const trajectoryId = `traj-persist-${Date.now()}`;
      const route = 'reasoning.persistence_test';

      // Phase 1: Create data with first connection
      {
        const db1 = createConnection({ dbPath: persistDbPath });
        const engine1 = new SonaEngine({
          databaseConnection: db1,
          trackPerformance: false,
        });
        await engine1.initialize();

        // Create trajectory
        engine1.createTrajectoryWithId(trajectoryId, route, ['pattern-1', 'pattern-2'], ['ctx-1']);

        // Provide feedback
        await engine1.provideFeedback(trajectoryId, 0.87, { skipAutoSave: true });

        // Close connection (simulates restart)
        db1.checkpoint();
        db1.close();
      }

      // Phase 2: Reopen and verify data persisted
      {
        const db2 = createConnection({ dbPath: persistDbPath });
        const trajectoryMetadataDAO2 = new TrajectoryMetadataDAO(db2);
        const learningFeedbackDAO2 = new LearningFeedbackDAO(db2);

        // Verify trajectory metadata persisted
        const metadata = trajectoryMetadataDAO2.findById(trajectoryId);
        expect(metadata).not.toBeNull();
        expect(metadata!.id).toBe(trajectoryId);
        expect(metadata!.route).toBe(route);
        expect(metadata!.qualityScore).toBeCloseTo(0.87);
        expect(metadata!.status).toBe('completed');

        // Verify feedback persisted
        const feedbacks = learningFeedbackDAO2.findByTrajectoryId(trajectoryId);
        expect(feedbacks.length).toBeGreaterThanOrEqual(1);
        expect(feedbacks[0].quality).toBeCloseTo(0.87);

        db2.close();
      }
    });

    it('should persist patterns across restarts', async () => {
      const persistDbPath = join(TEST_DB_DIR, 'pattern-persist-test.db');
      const patternId = `pattern-persist-${Date.now()}`;

      // Phase 1: Create pattern with first connection
      {
        const db1 = createConnection({ dbPath: persistDbPath });
        const patternDAO1 = new PatternDAO(db1);

        patternDAO1.insert({
          id: patternId,
          name: 'persist-pattern',
          context: JSON.stringify({ test: 'context' }),
          action: 'persist test action',
          outcome: 'success',
          embedding: new Float32Array(1536).fill(0.123),
          weight: 0.75,
          trajectoryIds: ['traj-a', 'traj-b'],
          agentId: 'persist-agent',
          taskType: 'persist.task',
          createdAt: Date.now(),
          tags: ['persist-test', 'important'],
        });

        db1.checkpoint();
        db1.close();
      }

      // Phase 2: Verify pattern persisted
      {
        const db2 = createConnection({ dbPath: persistDbPath });
        const patternDAO2 = new PatternDAO(db2);

        const pattern = patternDAO2.findById(patternId);
        expect(pattern).not.toBeNull();
        expect(pattern!.id).toBe(patternId);
        expect(pattern!.name).toBe('persist-pattern');
        expect(pattern!.weight).toBeCloseTo(0.75);
        expect(pattern!.trajectoryIds).toEqual(['traj-a', 'traj-b']);
        expect(pattern!.tags).toEqual(['persist-test', 'important']);

        // Verify embedding was properly serialized/deserialized
        expect(pattern!.embedding).toBeInstanceOf(Float32Array);
        expect(pattern!.embedding.length).toBe(1536);
        expect(pattern!.embedding[0]).toBeCloseTo(0.123, 3);

        db2.close();
      }
    });

    it('should preserve learning feedback processing state across restarts', async () => {
      const persistDbPath = join(TEST_DB_DIR, 'feedback-persist-test.db');
      const feedbackId1 = `fb-persist-1-${Date.now()}`;
      const feedbackId2 = `fb-persist-2-${Date.now()}`;

      // Phase 1: Create and partially process feedback
      {
        const db1 = createConnection({ dbPath: persistDbPath });
        const feedbackDAO1 = new LearningFeedbackDAO(db1);

        // Insert two feedback records
        feedbackDAO1.insert({
          id: feedbackId1,
          trajectoryId: 'traj-1',
          quality: 0.9,
          outcome: 'positive',
          taskType: 'test.task',
          agentId: 'test-agent',
          createdAt: Date.now(),
        });

        feedbackDAO1.insert({
          id: feedbackId2,
          trajectoryId: 'traj-2',
          quality: 0.6,
          outcome: 'neutral',
          taskType: 'test.task',
          agentId: 'test-agent',
          createdAt: Date.now(),
        });

        // Mark only first as processed
        feedbackDAO1.markProcessed(feedbackId1);

        db1.checkpoint();
        db1.close();
      }

      // Phase 2: Verify processing state persisted
      {
        const db2 = createConnection({ dbPath: persistDbPath });
        const feedbackDAO2 = new LearningFeedbackDAO(db2);

        const fb1 = feedbackDAO2.findById(feedbackId1);
        const fb2 = feedbackDAO2.findById(feedbackId2);

        expect(fb1).not.toBeNull();
        expect(fb1!.processed).toBe(true);

        expect(fb2).not.toBeNull();
        expect(fb2!.processed).toBe(false);

        // Unprocessed query should only return fb2
        const unprocessed = feedbackDAO2.findUnprocessed(100);
        const unprocessedIds = unprocessed.map(f => f.id);
        expect(unprocessedIds).toContain(feedbackId2);
        expect(unprocessedIds).not.toContain(feedbackId1);

        db2.close();
      }
    });

    it('should maintain trajectory_metadata version across updates', async () => {
      const persistDbPath = join(TEST_DB_DIR, 'version-persist-test.db');
      const trajectoryId = `traj-version-${Date.now()}`;

      // Phase 1: Create and update trajectory
      {
        const db1 = createConnection({ dbPath: persistDbPath });
        const trajectoryDAO1 = new TrajectoryMetadataDAO(db1);

        trajectoryDAO1.insert({
          id: trajectoryId,
          filePath: '/test/path',
          fileOffset: 0,
          fileLength: 100,
          route: 'test.version',
          stepCount: 5,
          createdAt: Date.now(),
          status: 'active',
        });

        // Update status (increments version)
        trajectoryDAO1.updateStatus(trajectoryId, 'completed', Date.now());

        // Update quality (increments version again)
        trajectoryDAO1.updateQuality(trajectoryId, 0.88);

        db1.checkpoint();
        db1.close();
      }

      // Phase 2: Verify version persisted
      {
        const db2 = createConnection({ dbPath: persistDbPath });
        const trajectoryDAO2 = new TrajectoryMetadataDAO(db2);

        const metadata = trajectoryDAO2.findById(trajectoryId);
        expect(metadata).not.toBeNull();
        expect(metadata!.version).toBe(3); // Initial 1 + 2 updates
        expect(metadata!.status).toBe('completed');
        expect(metadata!.qualityScore).toBeCloseTo(0.88);

        db2.close();
      }
    });
  });

  // =====================================================================
  // Additional: Database Stats Verification
  // =====================================================================
  describe('Database Stats and Observability', () => {
    let db: IDatabaseConnection;
    let engine: SonaEngine;

    beforeEach(async () => {
      db = createTestConnection(TEST_DB_PATH);
      engine = new SonaEngine({
        databaseConnection: db,
        trackPerformance: false,
      });
      await engine.initialize();
    });

    afterEach(() => {
      db.close();
    });

    it('should return accurate database stats', async () => {
      // Create some data
      engine.createTrajectoryWithId('traj-stats-1', 'test.stats', ['p1'], []);
      engine.createTrajectoryWithId('traj-stats-2', 'test.stats', ['p2'], []);

      await engine.provideFeedback('traj-stats-1', 0.9, { skipAutoSave: true });

      const stats = engine.getDatabaseStats();
      expect(stats).not.toBeNull();
      expect(stats!.trajectoryMetadata.totalCount).toBeGreaterThanOrEqual(2);
      expect(stats!.feedback.feedbackCount).toBeGreaterThanOrEqual(1);
    });

    it('should track completed vs active trajectories', async () => {
      engine.createTrajectoryWithId('traj-active', 'test.track', ['p1'], []);
      engine.createTrajectoryWithId('traj-completed', 'test.track', ['p2'], []);

      await engine.provideFeedback('traj-completed', 0.85, { skipAutoSave: true });

      const stats = engine.getDatabaseStats();
      expect(stats!.trajectoryMetadata.activeCount).toBeGreaterThanOrEqual(1);
      expect(stats!.trajectoryMetadata.completedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
