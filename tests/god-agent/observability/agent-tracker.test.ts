/**
 * Tests for AgentExecutionTracker
 *
 * @see TASK-OBS-003-AGENT-TRACKER.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentExecutionTracker, IAgentResult } from '../../../src/god-agent/observability/agent-tracker';
import { ActivityStream } from '../../../src/god-agent/observability/activity-stream';
import { IAgentExecution } from '../../../src/god-agent/observability/types';

describe('AgentExecutionTracker', () => {
  let tracker: AgentExecutionTracker;
  let activityStream: ActivityStream;

  beforeEach(() => {
    activityStream = new ActivityStream();
    tracker = new AgentExecutionTracker(activityStream);
  });

  // ===========================================================================
  // TC-003-01: startAgent() returns execution ID
  // ===========================================================================

  describe('startAgent()', () => {
    it('should generate execution ID matching format', () => {
      const executionId = tracker.startAgent({
        id: '', // Will be overwritten
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Analyze codebase structure',
      });

      // Format: exec_{agentKey}_{timestamp}_{random}
      expect(executionId).toMatch(/^exec_researcher_\d+_[a-z0-9]{6}$/);
    });

    it('should add execution to active list', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Generate API endpoint',
      });

      const active = tracker.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(executionId);
      expect(active[0].status).toBe('running');
    });

    it('should emit agent_started event', async () => {
      const events: any[] = [];
      activityStream.subscribe(event => events.push(event));

      tracker.startAgent({
        id: '',
        agentKey: 'tester',
        agentName: 'Test Generator',
        category: 'testing',
        startTime: Date.now(),
        input: 'Write unit tests',
      });

      // Wait for async event emission
      await new Promise(resolve => setImmediate(resolve));

      expect(events).toHaveLength(1);
      expect(events[0].component).toBe('agent');
      expect(events[0].operation).toBe('agent_started');
      expect(events[0].status).toBe('running');
      expect(events[0].metadata.agentKey).toBe('tester');
    });

    it('should support pipeline association', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'analyzer',
        agentName: 'Code Analyzer',
        category: 'analysis',
        pipelineId: 'pipeline_123',
        startTime: Date.now(),
        input: 'Analyze performance',
      });

      const execution = tracker.getById(executionId);
      expect(execution?.pipelineId).toBe('pipeline_123');
    });
  });

  // ===========================================================================
  // TC-003-02: completeAgent() sets status, duration
  // ===========================================================================

  describe('completeAgent()', () => {
    it('should set status to completed and calculate duration', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Find relevant papers',
      });

      // Simulate some time passing
      const startTime = Date.now();

      const result: IAgentResult = {
        output: 'Found 42 relevant papers',
        qualityScore: 0.95,
      };

      tracker.completeAgent(executionId, result);

      const execution = tracker.getById(executionId);
      expect(execution?.status).toBe('completed');
      expect(execution?.output).toBe('Found 42 relevant papers');
      expect(execution?.qualityScore).toBe(0.95);
      expect(execution?.durationMs).toBeGreaterThanOrEqual(0);
      expect(execution?.endTime).toBeGreaterThanOrEqual(startTime);
    });

    it('should move execution from active to completed', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Generate function',
      });

      expect(tracker.getActive()).toHaveLength(1);

      tracker.completeAgent(executionId, {
        output: 'Function generated',
      });

      expect(tracker.getActive()).toHaveLength(0);
      const execution = tracker.getById(executionId);
      expect(execution).toBeTruthy();
    });

    it('should emit agent_completed event', async () => {
      const events: any[] = [];
      activityStream.subscribe(event => events.push(event));

      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'tester',
        agentName: 'Test Generator',
        category: 'testing',
        startTime: Date.now(),
        input: 'Write tests',
      });

      tracker.completeAgent(executionId, {
        output: 'Tests written',
        qualityScore: 0.88,
      });

      // Wait for async event emission
      await new Promise(resolve => setImmediate(resolve));

      // Should have 2 events: started + completed
      expect(events).toHaveLength(2);
      const completedEvent = events[1];
      expect(completedEvent.operation).toBe('agent_completed');
      expect(completedEvent.status).toBe('success');
      expect(completedEvent.metadata.qualityScore).toBe(0.88);
      expect(completedEvent.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should capture memory stored information', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Research topic',
      });

      const memoryStored = [
        {
          id: 'mem_1',
          domain: 'project/research',
          category: 'findings',
          tags: ['paper', 'analysis'],
          contentPreview: 'Key findings...',
          timestamp: Date.now(),
        },
      ];

      tracker.completeAgent(executionId, {
        output: 'Research complete',
        memoryStored,
      });

      const execution = tracker.getById(executionId);
      expect(execution?.memoryStored).toEqual(memoryStored);
    });

    it('should handle unknown execution ID gracefully', () => {
      // Should not throw
      expect(() => {
        tracker.completeAgent('exec_unknown_123_abc', {
          output: 'Test',
        });
      }).not.toThrow();
    });
  });

  // ===========================================================================
  // TC-003-03: failAgent() captures error message
  // ===========================================================================

  describe('failAgent()', () => {
    it('should set status to failed and capture error', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Generate code',
      });

      const error = new Error('API timeout');
      tracker.failAgent(executionId, error);

      const execution = tracker.getById(executionId);
      expect(execution?.status).toBe('failed');
      expect(execution?.error).toBe('API timeout');
      expect(execution?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should move execution from active to completed', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'tester',
        agentName: 'Test Generator',
        category: 'testing',
        startTime: Date.now(),
        input: 'Generate tests',
      });

      expect(tracker.getActive()).toHaveLength(1);

      tracker.failAgent(executionId, new Error('Test generation failed'));

      expect(tracker.getActive()).toHaveLength(0);
    });

    it('should emit agent_failed event', async () => {
      const events: any[] = [];
      activityStream.subscribe(event => events.push(event));

      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Research topic',
      });

      tracker.failAgent(executionId, new Error('Search API unavailable'));

      // Wait for async event emission
      await new Promise(resolve => setImmediate(resolve));

      expect(events).toHaveLength(2);
      const failedEvent = events[1];
      expect(failedEvent.operation).toBe('agent_failed');
      expect(failedEvent.status).toBe('error');
      expect(failedEvent.metadata.error).toBe('Search API unavailable');
    });

    it('should handle unknown execution ID gracefully', () => {
      expect(() => {
        tracker.failAgent('exec_unknown_456_xyz', new Error('Test error'));
      }).not.toThrow();
    });
  });

  // ===========================================================================
  // TC-003-04: getActive() during execution
  // ===========================================================================

  describe('getActive()', () => {
    it('should return empty array when no active executions', () => {
      expect(tracker.getActive()).toEqual([]);
    });

    it('should return all running agents', () => {
      const id1 = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      const id2 = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Task 2',
      });

      const active = tracker.getActive();
      expect(active).toHaveLength(2);
      expect(active.map(e => e.id)).toContain(id1);
      expect(active.map(e => e.id)).toContain(id2);
    });

    it('should not include completed executions', () => {
      const id1 = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      const id2 = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Task 2',
      });

      tracker.completeAgent(id1, { output: 'Done' });

      const active = tracker.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(id2);
    });
  });

  // ===========================================================================
  // TC-003-05: getByType() filters by agent type
  // ===========================================================================

  describe('getByType()', () => {
    it('should filter by agent key', () => {
      tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Task 2',
      });

      const researcherExecs = tracker.getByType('researcher');
      expect(researcherExecs).toHaveLength(1);
      expect(researcherExecs[0].agentKey).toBe('researcher');
    });

    it('should include both active and completed executions', () => {
      const id1 = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      const id2 = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 2',
      });

      tracker.completeAgent(id1, { output: 'Done' });

      const researcherExecs = tracker.getByType('researcher');
      expect(researcherExecs).toHaveLength(2);
    });

    it('should return empty array for unknown agent type', () => {
      expect(tracker.getByType('unknown')).toEqual([]);
    });
  });

  // ===========================================================================
  // TC-003-06: Execution retrieval by ID
  // ===========================================================================

  describe('getById()', () => {
    it('should retrieve active execution by ID', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      const execution = tracker.getById(executionId);
      expect(execution).toBeTruthy();
      expect(execution?.id).toBe(executionId);
    });

    it('should retrieve completed execution by ID', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Task 1',
      });

      tracker.completeAgent(executionId, { output: 'Done' });

      const execution = tracker.getById(executionId);
      expect(execution).toBeTruthy();
      expect(execution?.id).toBe(executionId);
      expect(execution?.status).toBe('completed');
    });

    it('should return null for unknown ID', () => {
      expect(tracker.getById('exec_unknown_789_xyz')).toBeNull();
    });
  });

  // ===========================================================================
  // TC-003-07: FIFO eviction at 51st completion
  // ===========================================================================

  describe('FIFO eviction', () => {
    it('should keep max 50 completed executions', () => {
      const executionIds: string[] = [];

      // Create 55 executions
      for (let i = 0; i < 55; i++) {
        const id = tracker.startAgent({
          id: '',
          agentKey: 'researcher',
          agentName: 'Research Specialist',
          category: 'research',
          startTime: Date.now(),
          input: `Task ${i}`,
        });
        executionIds.push(id);
      }

      // Complete all 55
      for (const id of executionIds) {
        tracker.completeAgent(id, { output: `Result for ${id}` });
      }

      const stats = tracker.getStats();
      expect(stats.completedCount).toBe(50);
      expect(stats.activeCount).toBe(0);
    });

    it('should evict oldest executions first (FIFO)', () => {
      const executionIds: string[] = [];

      // Create and complete 52 executions
      for (let i = 0; i < 52; i++) {
        const id = tracker.startAgent({
          id: '',
          agentKey: 'coder',
          agentName: 'Code Generator',
          category: 'coding',
          startTime: Date.now(),
          input: `Task ${i}`,
        });
        executionIds.push(id);
        tracker.completeAgent(id, { output: `Result ${i}` });
      }

      // First 2 executions should be evicted
      expect(tracker.getById(executionIds[0])).toBeNull();
      expect(tracker.getById(executionIds[1])).toBeNull();

      // Last 50 should still exist
      for (let i = 2; i < 52; i++) {
        expect(tracker.getById(executionIds[i])).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // Additional Coverage Tests
  // ===========================================================================

  describe('getStats()', () => {
    it('should return tracker statistics', () => {
      tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      const id2 = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Task 2',
      });

      tracker.completeAgent(id2, { output: 'Done' });

      const stats = tracker.getStats();
      expect(stats.activeCount).toBe(1);
      expect(stats.completedCount).toBe(1);
      expect(stats.maxCompleted).toBe(50);
    });
  });

  describe('Event emission performance', () => {
    it('should not block on event emission', () => {
      // Slow listener should not block completion
      let slowListenerCalled = false;
      activityStream.subscribe(() => {
        slowListenerCalled = true;
      });

      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'researcher',
        agentName: 'Research Specialist',
        category: 'research',
        startTime: Date.now(),
        input: 'Task 1',
      });

      const startTime = Date.now();
      tracker.completeAgent(executionId, { output: 'Done' });
      const duration = Date.now() - startTime;

      // Should complete quickly (< 10ms) even with listener
      expect(duration).toBeLessThan(10);

      // Listener will be called asynchronously
      expect(slowListenerCalled).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle multiple completions of same ID', () => {
      const executionId = tracker.startAgent({
        id: '',
        agentKey: 'coder',
        agentName: 'Code Generator',
        category: 'coding',
        startTime: Date.now(),
        input: 'Task 1',
      });

      tracker.completeAgent(executionId, { output: 'First' });
      tracker.completeAgent(executionId, { output: 'Second' });

      const stats = tracker.getStats();
      expect(stats.completedCount).toBe(1); // Should only count once
    });

    it('should handle concurrent active executions', () => {
      const ids = [];
      for (let i = 0; i < 10; i++) {
        ids.push(
          tracker.startAgent({
            id: '',
            agentKey: `agent_${i}`,
            agentName: `Agent ${i}`,
            category: 'test',
            startTime: Date.now(),
            input: `Task ${i}`,
          })
        );
      }

      expect(tracker.getActive()).toHaveLength(10);
    });
  });
});
