/**
 * Layer 3 Advanced Features - Unit Tests
 *
 * Tests: TASK-ORC-010, ORC-011, ORC-012
 *
 * @module tests/orchestration/layer3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { DelegationDetector } from '../../../src/god-agent/orchestration/services/delegation-detector.js';
import { AgentRouter } from '../../../src/god-agent/orchestration/services/agent-router.js';
import { WorkflowStateManager } from '../../../src/god-agent/orchestration/services/workflow-state-manager.js';
import { WorkflowPhase, type IWorkflowState } from '../../../src/god-agent/orchestration/types.js';
import { InteractionStore } from '../../../src/god-agent/universal/interaction-store.js';

describe('Layer 3: Advanced Features', () => {
  const testStorageDir = './.test-storage-layer3';

  beforeEach(async () => {
    await fs.mkdir(testStorageDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('DelegationDetector (TASK-ORC-010)', () => {
    let detector: DelegationDetector;
    let interactionStore: InteractionStore;

    beforeEach(() => {
      interactionStore = new InteractionStore({
        storageDir: path.join(testStorageDir, 'interactions'),
        maxInteractions: 100,
        highQualityThreshold: 0.7,
        rollingWindowDays: 7
      });
      detector = new DelegationDetector(interactionStore);
    });

    it('should detect backend delegation need', () => {
      const pattern = detector.detectDelegationNeed([
        'read_file',
        'modify_code',
        'write_file',
        'run_tests'
      ]);

      expect(pattern.operationCount).toBe(4);
      expect(pattern.suggestedAgent).toBe('backend-dev');
      expect(pattern.confidence).toBeGreaterThanOrEqual(0.7);
      expect(pattern.promptDisplayed).toBe(true);
    });

    it('should detect frontend delegation need', () => {
      const pattern = detector.detectDelegationNeed([
        'read components/Button.tsx',
        'modify components/Button.tsx',
        'write components/Button.tsx'
      ]);

      expect(pattern.operationCount).toBe(3);
      expect(pattern.suggestedAgent).toBe('coder');
      expect(pattern.confidence).toBeGreaterThan(0);
    });

    it('should detect testing delegation need', () => {
      const pattern = detector.detectDelegationNeed([
        'test auth.service',
        'verify login',
        'validate response',
        'assert success'
      ]);

      expect(pattern.operationCount).toBe(4);
      expect(pattern.suggestedAgent).toBe('tester');
      expect(pattern.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should not trigger for < 3 operations', () => {
      const pattern = detector.detectDelegationNeed([
        'read_file',
        'write_file'
      ]);

      expect(pattern.operationCount).toBe(2);
      expect(pattern.confidence).toBe(0);
      expect(pattern.promptDisplayed).toBe(false);
    });

    it('should detect schema design delegation', () => {
      const pattern = detector.detectDelegationNeed([
        'create schema',
        'define api-contract',
        'database migration'
      ]);

      expect(pattern.operationCount).toBe(3);
      expect(pattern.suggestedAgent).toBe('system-architect');
    });

    it('should store delegation pattern', async () => {
      const pattern = detector.detectDelegationNeed([
        'read_file',
        'modify_code',
        'write_file'
      ]);

      pattern.delegated = true;
      await detector.storePattern(pattern);

      // Verify stored in InteractionStore
      const knowledge = interactionStore.getKnowledgeByDomain('system/delegation');
      expect(knowledge.length).toBeGreaterThan(0);
      expect(knowledge[0].type).toBe('pattern');
    });

    it('should handle delegation keywords', () => {
      const pattern = detector.detectDelegationNeed([
        'implement multiple features',
        'build feature X',
        'write tests for feature'
      ]);

      expect(pattern.operationCount).toBe(3);
      expect(pattern.confidence).toBeGreaterThan(0);
    });
  });

  describe('AgentRouter (TASK-ORC-011)', () => {
    let router: AgentRouter;

    beforeEach(() => {
      router = new AgentRouter();
    });

    it('should detect implementation phase', () => {
      const routing = router.routeToAgent('Implement user authentication');

      expect(routing.detectedPhase).toBe(WorkflowPhase.IMPLEMENTATION);
      expect(routing.suggestedAgent).toBe('backend-dev');
      expect(routing.actualAgent).toBe('backend-dev');
      expect(routing.overridden).toBe(false);
    });

    it('should detect specification phase', () => {
      const routing = router.routeToAgent('Define API schema and contracts');

      expect(routing.detectedPhase).toBe(WorkflowPhase.SPECIFICATION);
      expect(routing.suggestedAgent).toBe('system-architect');
    });

    it('should detect testing phase', () => {
      const routing = router.routeToAgent('Test authentication endpoints');

      expect(routing.detectedPhase).toBe(WorkflowPhase.TESTING);
      expect(routing.suggestedAgent).toBe('tester');
    });

    it('should detect review phase', () => {
      const routing = router.routeToAgent('Review and audit the codebase for quality');

      expect(routing.detectedPhase).toBe(WorkflowPhase.REVIEW);
      expect(routing.suggestedAgent).toBe('reviewer');
    });

    it('should detect planning phase', () => {
      const routing = router.routeToAgent('Plan architecture and design system');

      expect(routing.detectedPhase).toBe(WorkflowPhase.PLANNING);
      expect(routing.suggestedAgent).toBe('planner');
    });

    it('should handle ambiguous descriptions', () => {
      const routing = router.routeToAgent('Do something');

      expect(routing.phaseConfidence).toBeLessThan(0.6);
      expect(routing.detectedPhase).toBe(WorkflowPhase.GENERAL);
      expect(routing.actualAgent).toBe('coder');
    });

    it('should handle preferred agent override', () => {
      const routing = router.routeToAgent(
        'Implement feature',
        { preferredAgent: 'custom-agent' }
      );

      expect(routing.suggestedAgent).toBe('custom-agent');
      expect(routing.actualAgent).toBe('custom-agent');
      expect(routing.overridden).toBe(true);
      expect(routing.overrideReason).toContain('Preferred agent');
    });

    it('should return default mappings', () => {
      const mappings = AgentRouter.getDefaultMappings();

      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings.find(m => m.phase === WorkflowPhase.IMPLEMENTATION)).toBeDefined();
      expect(mappings.find(m => m.phase === WorkflowPhase.TESTING)).toBeDefined();
    });

    it('should detect multiple keywords for higher confidence', () => {
      const routing = router.routeToAgent(
        'Implement and develop the authentication code'
      );

      expect(routing.detectedPhase).toBe(WorkflowPhase.IMPLEMENTATION);
      expect(routing.phaseConfidence).toBeGreaterThan(0.5);
    });
  });

  describe('WorkflowStateManager (TASK-ORC-012)', () => {
    let manager: WorkflowStateManager;
    const workflowsDir = path.join(testStorageDir, 'workflows');

    beforeEach(async () => {
      manager = new WorkflowStateManager({
        storageDir: workflowsDir,
        verbose: false
      });
    });

    it('should persist workflow state', async () => {
      const state: IWorkflowState = {
        id: 'test-001',
        name: 'Test Workflow',
        completedPhases: ['planning'],
        pendingTasks: ['task-1', 'task-2'],
        storedDomains: ['project/test'],
        currentPhase: 'implementation',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active'
      };

      await manager.persistWorkflowState('test-001', state);

      // Verify file exists
      const filePath = path.join(workflowsDir, 'test-001.json');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should restore workflow state', async () => {
      const state: IWorkflowState = {
        id: 'test-002',
        name: 'Test Workflow 2',
        completedPhases: ['planning', 'specification'],
        pendingTasks: [],
        storedDomains: ['project/test'],
        currentPhase: 'implementation',
        startedAt: Date.now() - 1000,
        lastActivityAt: Date.now(),
        status: 'active'
      };

      await manager.persistWorkflowState('test-002', state);

      const restored = await manager.restoreWorkflowState('test-002');

      expect(restored).toBeDefined();
      expect(restored?.id).toBe('test-002');
      expect(restored?.name).toBe('Test Workflow 2');
      expect(restored?.completedPhases).toEqual(['planning', 'specification']);
      expect(restored?.status).toBe('active');
    });

    it('should archive completed workflows', async () => {
      const state: IWorkflowState = {
        id: 'test-003',
        name: 'Completed Workflow',
        completedPhases: ['planning', 'implementation', 'testing'],
        pendingTasks: [],
        storedDomains: ['project/test'],
        currentPhase: 'completed',
        startedAt: Date.now() - 10000,
        lastActivityAt: Date.now(),
        status: 'completed'
      };

      await manager.persistWorkflowState('test-003', state);

      // Check file is in archive
      const archivePath = path.join(workflowsDir, 'archive', 'test-003.json');
      const exists = await fs.access(archivePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Should still be restorable from archive
      const restored = await manager.restoreWorkflowState('test-003');
      expect(restored?.status).toBe('completed');
    });

    it('should return null for non-existent workflow', async () => {
      const restored = await manager.restoreWorkflowState('non-existent');
      expect(restored).toBeNull();
    });

    it('should handle corrupted files gracefully', async () => {
      // Create corrupted file
      const corruptedPath = path.join(workflowsDir, 'corrupted-001.json');
      await fs.mkdir(workflowsDir, { recursive: true });
      await fs.writeFile(corruptedPath, '{ invalid json }', 'utf-8');

      const restored = await manager.restoreWorkflowState('corrupted-001');
      expect(restored).toBeNull();

      // Check file was archived
      const corruptedDir = path.join(workflowsDir, 'corrupted');
      const files = await fs.readdir(corruptedDir);
      expect(files.some(f => f.startsWith('corrupted-001-'))).toBe(true);
    });

    it('should validate state structure', async () => {
      const invalidState = {
        id: 'invalid',
        name: 'Invalid'
        // Missing required fields
      } as any;

      await expect(
        manager.persistWorkflowState('invalid', invalidState)
      ).rejects.toThrow(/Invalid workflow state/);
    });

    it('should list active workflows', async () => {
      const state1: IWorkflowState = {
        id: 'active-001',
        name: 'Active 1',
        completedPhases: [],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'planning',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active'
      };

      const state2: IWorkflowState = {
        id: 'active-002',
        name: 'Active 2',
        completedPhases: [],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'implementation',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active'
      };

      await manager.persistWorkflowState('active-001', state1);
      await manager.persistWorkflowState('active-002', state2);

      const workflows = await manager.listActiveWorkflows();
      expect(workflows).toContain('active-001');
      expect(workflows).toContain('active-002');
    });

    it('should list archived workflows', async () => {
      const state: IWorkflowState = {
        id: 'archived-001',
        name: 'Archived',
        completedPhases: ['planning', 'implementation'],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'completed',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'completed'
      };

      await manager.persistWorkflowState('archived-001', state);

      const archived = await manager.listArchivedWorkflows();
      expect(archived).toContain('archived-001');
    });

    it('should delete workflow state', async () => {
      const state: IWorkflowState = {
        id: 'delete-001',
        name: 'To Delete',
        completedPhases: [],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'planning',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active'
      };

      await manager.persistWorkflowState('delete-001', state);
      await manager.deleteWorkflowState('delete-001');

      const restored = await manager.restoreWorkflowState('delete-001');
      expect(restored).toBeNull();
    });

    it('should use atomic writes', async () => {
      const state: IWorkflowState = {
        id: 'atomic-001',
        name: 'Atomic Test',
        completedPhases: [],
        pendingTasks: [],
        storedDomains: [],
        currentPhase: 'planning',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        status: 'active'
      };

      await manager.persistWorkflowState('atomic-001', state);

      // Check temp file doesn't exist
      const tempPath = path.join(workflowsDir, 'atomic-001.tmp.json');
      const tempExists = await fs.access(tempPath).then(() => true).catch(() => false);
      expect(tempExists).toBe(false);

      // Final file should exist
      const finalPath = path.join(workflowsDir, 'atomic-001.json');
      const finalExists = await fs.access(finalPath).then(() => true).catch(() => false);
      expect(finalExists).toBe(true);
    });
  });
});
