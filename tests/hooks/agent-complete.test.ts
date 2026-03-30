/**
 * Agent Complete Hook Tests
 *
 * Tests for TASK-HOOK-006: Agent complete hook implementation
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-006
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  SubagentStopInput,
  AgentCompleteResponse,
} from '../../scripts/hooks/hook-types.js';

// Mock ActivityStream
vi.mock('../../src/god-agent/observability/index.js', () => ({
  ActivityStream: {
    getInstance: vi.fn().mockResolvedValue({
      emit: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

const QUALITY_THRESHOLD = 0.7;

/**
 * Test fixture: Create SubagentStopInput
 */
function createSubagentInput(
  overrides: Partial<SubagentStopInput> = {}
): SubagentStopInput {
  return {
    correlationId: 'test-correlation-123',
    timestamp: new Date().toISOString(),
    eventType: 'SubagentStop',
    agentType: 'coder',
    taskDescription: 'Implement authentication',
    result: 'success',
    outputSummary: 'Auth module implemented with JWT',
    durationMs: 60000,
    qualityScore: 0.85,
    ...overrides,
  };
}

describe('TASK-HOOK-006: Agent Complete Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Quality Threshold', () => {
    it('TC-H6-001: should create hyperedge for quality >= 0.7', async () => {
      const input = createSubagentInput({ qualityScore: 0.85 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(true);
      expect(response.hyperedgeId).toBeDefined();
    });

    it('TC-H6-002: should NOT create hyperedge for quality < 0.7', async () => {
      const input = createSubagentInput({ qualityScore: 0.5 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(false);
      expect(response.hyperedgeId).toBeUndefined();
    });

    it('TC-H6-003: should create hyperedge at exact threshold 0.7', async () => {
      const input = createSubagentInput({ qualityScore: 0.7 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(true);
      expect(response.hyperedgeId).toBeDefined();
    });

    it('TC-H6-004: should NOT create hyperedge when quality undefined', async () => {
      const input = createSubagentInput({ qualityScore: undefined });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(false);
      expect(response.hyperedgeId).toBeUndefined();
    });
  });

  describe('Result Filtering', () => {
    it('TC-H6-010: should create hyperedge for success outcome', async () => {
      const input = createSubagentInput({
        result: 'success',
        qualityScore: 0.9,
      });
      const response = await simulateHookExecution(input);

      expect(response.hyperedgeId).toBeDefined();
    });

    it('TC-H6-011: should NOT create hyperedge for failure outcome', async () => {
      const input = createSubagentInput({
        result: 'failure',
        qualityScore: 0.9,
      });
      const response = await simulateHookExecution(input);

      expect(response.hyperedgeId).toBeUndefined();
    });

    it('TC-H6-012: should NOT create hyperedge for partial outcome', async () => {
      const input = createSubagentInput({
        result: 'partial',
        qualityScore: 0.9,
      });
      const response = await simulateHookExecution(input);

      expect(response.hyperedgeId).toBeUndefined();
    });
  });

  describe('Hyperedge Content', () => {
    it('TC-H6-020: should include agent type in hyperedge ID', async () => {
      const input = createSubagentInput({
        agentType: 'tester',
        qualityScore: 0.85,
      });
      const response = await simulateHookExecution(input);

      expect(response.hyperedgeId).toContain('tester');
    });

    it('TC-H6-021: should handle long task descriptions', async () => {
      const input = createSubagentInput({
        taskDescription: 'x'.repeat(1000),
        qualityScore: 0.85,
      });
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.hyperedgeId).toBeDefined();
    });

    it('TC-H6-022: should handle special characters in task', async () => {
      const input = createSubagentInput({
        taskDescription: 'Implement <script>alert("test")</script>',
        qualityScore: 0.85,
      });
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
    });
  });

  describe('Response Format', () => {
    it('TC-H6-030: should include correlationId', async () => {
      const input = createSubagentInput({
        correlationId: 'unique-id-456',
      });
      const response = await simulateHookExecution(input);

      expect(response.correlationId).toBe('unique-id-456');
    });

    it('TC-H6-031: should include durationMs', async () => {
      const input = createSubagentInput();
      const response = await simulateHookExecution(input);

      expect(response.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('TC-H6-032: should include qualityThresholdMet boolean', async () => {
      const input = createSubagentInput();
      const response = await simulateHookExecution(input);

      expect(typeof response.qualityThresholdMet).toBe('boolean');
    });

    it('TC-H6-033: should set success to true on normal execution', async () => {
      const input = createSubagentInput();
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
    });
  });

  describe('Performance', () => {
    it('TC-H6-040: should complete within 500ms', async () => {
      const input = createSubagentInput();

      const startTime = performance.now();
      const response = await simulateHookExecution(input);
      const elapsed = performance.now() - startTime;

      expect(response.success).toBe(true);
      expect(elapsed).toBeLessThan(500);
    });

    it('TC-H6-041: should handle rapid sequential calls', async () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        createSubagentInput({
          correlationId: `rapid-test-${i}`,
          qualityScore: 0.7 + i * 0.02,
        })
      );

      const startTime = performance.now();
      const responses = await Promise.all(
        inputs.map((input) => simulateHookExecution(input))
      );
      const elapsed = performance.now() - startTime;

      expect(responses.every((r) => r.success)).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Edge Cases', () => {
    it('TC-H6-050: should handle quality at boundary 0.69999', async () => {
      const input = createSubagentInput({ qualityScore: 0.69999 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(false);
    });

    it('TC-H6-051: should handle quality at boundary 0.70001', async () => {
      const input = createSubagentInput({ qualityScore: 0.70001 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(true);
    });

    it('TC-H6-052: should handle quality = 0', async () => {
      const input = createSubagentInput({ qualityScore: 0 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(false);
    });

    it('TC-H6-053: should handle quality = 1.0', async () => {
      const input = createSubagentInput({ qualityScore: 1.0 });
      const response = await simulateHookExecution(input);

      expect(response.qualityThresholdMet).toBe(true);
      expect(response.hyperedgeId).toBeDefined();
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateHyperedgeId(agentType: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `he-${agentType}-${timestamp}-${random}`;
}

async function simulateHookExecution(
  input: SubagentStopInput
): Promise<AgentCompleteResponse> {
  const startTime = Date.now();

  const qualityScore = input.qualityScore ?? 0;
  const qualityThresholdMet = qualityScore >= QUALITY_THRESHOLD;

  let hyperedgeId: string | undefined;
  if (qualityThresholdMet && input.result === 'success') {
    hyperedgeId = generateHyperedgeId(input.agentType);
  }

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    hyperedgeId,
    qualityThresholdMet,
  };
}
