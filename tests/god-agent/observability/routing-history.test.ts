/**
 * RoutingHistory Unit Tests
 *
 * Tests for TASK-OBS-005: RoutingHistory
 * @see TASK-OBS-005-ROUTING-HISTORY.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoutingHistory } from '../../../src/god-agent/observability/routing-history';
import { ActivityStream } from '../../../src/god-agent/observability/activity-stream';
import {
  IRoutingDecision,
  IAgentCandidate,
  IPatternMatch,
} from '../../../src/god-agent/observability/routing-history';
import { BUFFER_LIMITS } from '../../../src/god-agent/observability/types';

// Helper to create test routing decision
function createTestDecision(overrides: Partial<IRoutingDecision> = {}): IRoutingDecision {
  return {
    taskDescription: 'Test task',
    taskType: 'implementation',
    selectedAgent: 'backend-dev',
    confidence: 0.85,
    candidates: [
      {
        agentType: 'backend-dev',
        score: 0.85,
        matchedCapabilities: ['api', 'database'],
        confidence: 0.85,
      },
      {
        agentType: 'coder',
        score: 0.72,
        matchedCapabilities: ['typescript'],
        confidence: 0.72,
      },
    ],
    reasoningSteps: [
      'Analyzed task requirements',
      'Matched capabilities',
      'Selected best candidate',
    ],
    patternMatches: [
      {
        patternId: 'pattern_123',
        similarity: 0.9,
        source: 'reasoning-bank',
      },
    ],
    coldStartUsed: false,
    ...overrides,
  };
}

describe('RoutingHistory', () => {
  let history: RoutingHistory;
  let activityStream: ActivityStream;

  beforeEach(() => {
    activityStream = new ActivityStream();
    history = new RoutingHistory(activityStream);
  });

  describe('Constructor', () => {
    it('TC-005-01: creates with default max size (100)', () => {
      expect(history.size()).toBe(0);
      expect(history.isFull()).toBe(false);
    });

    it('TC-005-02: creates with custom max size', () => {
      const customHistory = new RoutingHistory(undefined, 50);
      expect(customHistory.size()).toBe(0);
    });

    it('TC-005-03: creates without activity stream', () => {
      const standalone = new RoutingHistory();
      const decision = createTestDecision();

      // Should work without activity stream
      const routingId = standalone.record(decision);
      expect(routingId).toBeTruthy();
    });
  });

  describe('record()', () => {
    it('TC-005-04: record returns unique routing ID with correct format', () => {
      const decision = createTestDecision();
      const routingId = history.record(decision);

      // Format: route_{timestamp}_{random}
      expect(routingId).toMatch(/^route_\d+_[a-z0-9]{6}$/);
    });

    it('TC-005-05: record generates human-readable summary', () => {
      const decision = createTestDecision({
        selectedAgent: 'backend-dev',
        confidence: 0.85,
        taskType: 'implementation',
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation).toBeTruthy();
      expect(explanation!.explanation.summary).toBe(
        'Selected backend-dev with 85% confidence for implementation task'
      );
    });

    it('TC-005-06: record stores complete routing explanation', () => {
      const decision = createTestDecision({
        taskDescription: 'Create API endpoint',
        taskType: 'backend',
        selectedAgent: 'backend-dev',
        confidence: 0.92,
        candidates: [
          {
            agentType: 'backend-dev',
            score: 0.92,
            matchedCapabilities: ['api', 'rest'],
            confidence: 0.92,
          },
        ],
        reasoningSteps: ['Step 1', 'Step 2'],
        patternMatches: [
          {
            patternId: 'p123',
            similarity: 0.88,
            source: 'reasoning-bank',
          },
        ],
        coldStartUsed: false,
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation).toBeTruthy();
      expect(explanation!.taskDescription).toBe('Create API endpoint');
      expect(explanation!.taskType).toBe('backend');
      expect(explanation!.selectedAgent).toBe('backend-dev');
      expect(explanation!.confidence).toBe(0.92);
      expect(explanation!.explanation.candidates).toHaveLength(1);
      expect(explanation!.explanation.reasoningSteps).toHaveLength(2);
      expect(explanation!.explanation.patternMatches).toHaveLength(1);
      expect(explanation!.explanation.coldStartUsed).toBe(false);
    });

    it('TC-005-07: record handles missing pattern matches', () => {
      const decision = createTestDecision({
        patternMatches: undefined,
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation!.explanation.patternMatches).toEqual([]);
    });

    it('TC-005-08: record emits routing_decision event to ActivityStream', async () => {
      const decision = createTestDecision({
        selectedAgent: 'backend-dev',
        taskType: 'implementation',
        confidence: 0.85,
        coldStartUsed: false,
      });

      const eventsReceived: any[] = [];
      activityStream.subscribe((event) => {
        eventsReceived.push(event);
      });

      history.record(decision);

      // Wait for async event emission
      await new Promise(resolve => setImmediate(resolve));

      expect(eventsReceived).toHaveLength(1);
      const event = eventsReceived[0];

      expect(event.component).toBe('routing');
      expect(event.operation).toBe('routing_decision');
      expect(event.status).toBe('success');
      expect(event.metadata.selectedAgent).toBe('backend-dev');
      expect(event.metadata.taskType).toBe('implementation');
      expect(event.metadata.confidence).toBe(0.85);
      expect(event.metadata.coldStartUsed).toBe(false);
    });
  });

  describe('Circular Buffer Behavior', () => {
    it('TC-005-09: enforces maximum 100 routing decisions (FIFO)', () => {
      const smallHistory = new RoutingHistory(undefined, 5);

      // Record 8 decisions into size-5 buffer
      const routingIds: string[] = [];
      for (let i = 1; i <= 8; i++) {
        const decision = createTestDecision({
          taskDescription: `Task ${i}`,
        });
        routingIds.push(smallHistory.record(decision));
      }

      expect(smallHistory.size()).toBe(5);

      // Should have decisions 4-8 (oldest 1-3 evicted)
      const recent = smallHistory.getRecent(10);
      expect(recent).toHaveLength(5);
      expect(recent[0].taskDescription).toBe('Task 4');
      expect(recent[4].taskDescription).toBe('Task 8');

      // Oldest decisions should be gone
      expect(smallHistory.getById(routingIds[0])).toBeNull();
      expect(smallHistory.getById(routingIds[1])).toBeNull();
      expect(smallHistory.getById(routingIds[2])).toBeNull();

      // Recent decisions should exist
      expect(smallHistory.getById(routingIds[7])).toBeTruthy();
    });

    it('TC-005-10: isFull returns true at capacity', () => {
      const smallHistory = new RoutingHistory(undefined, 3);

      expect(smallHistory.isFull()).toBe(false);

      smallHistory.record(createTestDecision());
      smallHistory.record(createTestDecision());
      expect(smallHistory.isFull()).toBe(false);

      smallHistory.record(createTestDecision());
      expect(smallHistory.isFull()).toBe(true);

      // Adding more should keep it full
      smallHistory.record(createTestDecision());
      expect(smallHistory.isFull()).toBe(true);
    });
  });

  describe('getById()', () => {
    it('TC-005-11: getById returns null for non-existent ID', () => {
      const result = history.getById('route_invalid_id');
      expect(result).toBeNull();
    });

    it('TC-005-12: getById returns correct routing explanation', () => {
      const decision = createTestDecision({
        taskDescription: 'Specific task',
        selectedAgent: 'specific-agent',
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation).toBeTruthy();
      expect(explanation!.id).toBe(routingId);
      expect(explanation!.taskDescription).toBe('Specific task');
      expect(explanation!.selectedAgent).toBe('specific-agent');
    });
  });

  describe('getRecent()', () => {
    it('TC-005-13: getRecent returns empty array when empty', () => {
      const recent = history.getRecent();
      expect(recent).toEqual([]);
    });

    it('TC-005-14: getRecent returns most recent decisions', () => {
      // Record 20 decisions
      for (let i = 1; i <= 20; i++) {
        history.record(createTestDecision({
          taskDescription: `Task ${i}`,
        }));
      }

      const recent = history.getRecent(5);

      expect(recent).toHaveLength(5);
      // Should be most recent 5 (16-20)
      expect(recent[0].taskDescription).toBe('Task 16');
      expect(recent[4].taskDescription).toBe('Task 20');
    });

    it('TC-005-15: getRecent defaults to 10', () => {
      // Record 15 decisions
      for (let i = 1; i <= 15; i++) {
        history.record(createTestDecision());
      }

      const recent = history.getRecent();
      expect(recent).toHaveLength(10);
    });

    it('TC-005-16: getRecent returns all when limit > size', () => {
      history.record(createTestDecision());
      history.record(createTestDecision());
      history.record(createTestDecision());

      const recent = history.getRecent(100);
      expect(recent).toHaveLength(3);
    });
  });

  describe('filterByTaskType()', () => {
    beforeEach(() => {
      // Record variety of task types
      history.record(createTestDecision({
        taskType: 'backend',
        taskDescription: 'Backend task 1',
      }));
      history.record(createTestDecision({
        taskType: 'frontend',
        taskDescription: 'Frontend task 1',
      }));
      history.record(createTestDecision({
        taskType: 'backend',
        taskDescription: 'Backend task 2',
      }));
      history.record(createTestDecision({
        taskType: 'testing',
        taskDescription: 'Testing task 1',
      }));
    });

    it('TC-005-17: filterByTaskType returns matching decisions', () => {
      const backendDecisions = history.filterByTaskType('backend');

      expect(backendDecisions).toHaveLength(2);
      expect(backendDecisions.every(d => d.taskType === 'backend')).toBe(true);
      expect(backendDecisions[0].taskDescription).toBe('Backend task 1');
      expect(backendDecisions[1].taskDescription).toBe('Backend task 2');
    });

    it('TC-005-18: filterByTaskType returns empty array for no matches', () => {
      const decisions = history.filterByTaskType('nonexistent');
      expect(decisions).toEqual([]);
    });
  });

  describe('filterByAgent()', () => {
    beforeEach(() => {
      // Record variety of agents
      history.record(createTestDecision({
        selectedAgent: 'backend-dev',
        taskDescription: 'Task 1',
      }));
      history.record(createTestDecision({
        selectedAgent: 'coder',
        taskDescription: 'Task 2',
      }));
      history.record(createTestDecision({
        selectedAgent: 'backend-dev',
        taskDescription: 'Task 3',
      }));
      history.record(createTestDecision({
        selectedAgent: 'tester',
        taskDescription: 'Task 4',
      }));
    });

    it('TC-005-19: filterByAgent returns matching decisions', () => {
      const backendDecisions = history.filterByAgent('backend-dev');

      expect(backendDecisions).toHaveLength(2);
      expect(backendDecisions.every(d => d.selectedAgent === 'backend-dev')).toBe(true);
      expect(backendDecisions[0].taskDescription).toBe('Task 1');
      expect(backendDecisions[1].taskDescription).toBe('Task 3');
    });

    it('TC-005-20: filterByAgent returns empty array for no matches', () => {
      const decisions = history.filterByAgent('nonexistent-agent');
      expect(decisions).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('TC-005-21: clear removes all routing decisions', () => {
      // Record some decisions
      for (let i = 0; i < 10; i++) {
        history.record(createTestDecision());
      }

      expect(history.size()).toBe(10);

      history.clear();

      expect(history.size()).toBe(0);
      expect(history.getRecent()).toEqual([]);
    });
  });

  describe('Routing ID Format', () => {
    it('TC-005-22: routing IDs are unique', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const routingId = history.record(createTestDecision());
        ids.add(routingId);
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);
    });

    it('TC-005-23: routing IDs follow format route_{timestamp}_{random}', () => {
      const routingId = history.record(createTestDecision());

      const parts = routingId.split('_');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('route');
      expect(Number(parts[1])).toBeGreaterThan(0);  // Valid timestamp
      expect(parts[2]).toMatch(/^[a-z0-9]{6}$/);    // 6-char random
    });
  });

  describe('Confidence Handling', () => {
    it('TC-005-24: correctly rounds confidence to percentage', () => {
      const testCases = [
        { confidence: 0.855, expected: 86 },
        { confidence: 0.854, expected: 85 },
        { confidence: 0.999, expected: 100 },
        { confidence: 0.001, expected: 0 },
        { confidence: 0.5, expected: 50 },
      ];

      for (const testCase of testCases) {
        const decision = createTestDecision({
          confidence: testCase.confidence,
          selectedAgent: 'test-agent',
          taskType: 'test',
        });

        const routingId = history.record(decision);
        const explanation = history.getById(routingId);

        expect(explanation!.explanation.summary).toContain(
          `${testCase.expected}% confidence`
        );
      }
    });
  });

  describe('Edge Cases', () => {
    it('TC-005-25: handles empty candidates array', () => {
      const decision = createTestDecision({
        candidates: [],
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation!.explanation.candidates).toEqual([]);
    });

    it('TC-005-26: handles empty reasoning steps', () => {
      const decision = createTestDecision({
        reasoningSteps: [],
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation!.explanation.reasoningSteps).toEqual([]);
    });

    it('TC-005-27: handles cold start flag correctly', () => {
      const coldStartDecision = createTestDecision({
        coldStartUsed: true,
      });

      const normalDecision = createTestDecision({
        coldStartUsed: false,
      });

      const id1 = history.record(coldStartDecision);
      const id2 = history.record(normalDecision);

      expect(history.getById(id1)!.explanation.coldStartUsed).toBe(true);
      expect(history.getById(id2)!.explanation.coldStartUsed).toBe(false);
    });
  });

  describe('Pattern Matching', () => {
    it('TC-005-28: stores multiple pattern matches', () => {
      const decision = createTestDecision({
        patternMatches: [
          {
            patternId: 'pattern_1',
            similarity: 0.9,
            source: 'reasoning-bank',
          },
          {
            patternId: 'pattern_2',
            similarity: 0.85,
            source: 'cold-start',
          },
          {
            patternId: 'pattern_3',
            similarity: 0.78,
            source: 'reasoning-bank',
          },
        ],
      });

      const routingId = history.record(decision);
      const explanation = history.getById(routingId);

      expect(explanation!.explanation.patternMatches).toHaveLength(3);
      expect(explanation!.explanation.patternMatches[0].patternId).toBe('pattern_1');
      expect(explanation!.explanation.patternMatches[1].source).toBe('cold-start');
      expect(explanation!.explanation.patternMatches[2].similarity).toBe(0.78);
    });
  });
});
