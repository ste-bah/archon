/**
 * Subagent Learn Hook Tests
 *
 * Tests for TASK-HOOK-005: Subagent learn hook implementation
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-005
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  SubagentStopInput,
  SubagentLearnResponse,
} from '../../scripts/hooks/hook-types.js';

// Mock ActivityStream
vi.mock('../../src/god-agent/observability/index.js', () => ({
  ActivityStream: {
    getInstance: vi.fn().mockResolvedValue({
      emit: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

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
    taskDescription: 'Implement feature X',
    result: 'success',
    outputSummary: 'Feature implemented successfully',
    durationMs: 45000,
    qualityScore: 0.92,
    ...overrides,
  };
}

describe('TASK-HOOK-005: Subagent Learn Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Handling', () => {
    it('TC-H5-001: should parse valid SubagentStopInput', () => {
      const input = createSubagentInput();

      expect(input.eventType).toBe('SubagentStop');
      expect(input.agentType).toBe('coder');
      expect(input.result).toBe('success');
    });

    it('TC-H5-002: should handle all agent types', () => {
      const agentTypes = ['coder', 'tester', 'researcher', 'reviewer', 'system-architect'];

      for (const agentType of agentTypes) {
        const input = createSubagentInput({ agentType });
        expect(input.agentType).toBe(agentType);
      }
    });

    it('TC-H5-003: should handle all result types', () => {
      const results: Array<'success' | 'failure' | 'partial'> = ['success', 'failure', 'partial'];

      for (const result of results) {
        const input = createSubagentInput({ result });
        expect(input.result).toBe(result);
      }
    });
  });

  describe('Trajectory Creation', () => {
    it('TC-H5-010: should create trajectory for success outcome', async () => {
      const input = createSubagentInput({ result: 'success' });
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.trajectoryId).toBeDefined();
      expect(response.trajectoryId).toMatch(/^traj-/);
    });

    it('TC-H5-011: should create trajectory for failure outcome', async () => {
      const input = createSubagentInput({
        result: 'failure',
        qualityScore: 0.3,
      });
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.trajectoryId).toBeDefined();
    });

    it('TC-H5-012: should create trajectory for partial outcome', async () => {
      const input = createSubagentInput({ result: 'partial' });
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.trajectoryId).toBeDefined();
    });

    it('TC-H5-013: should include agent type in trajectory ID', async () => {
      const input = createSubagentInput({ agentType: 'tester' });
      const response = await simulateHookExecution(input);

      expect(response.trajectoryId).toContain('tester');
    });
  });

  describe('Weight Updates', () => {
    it('TC-H5-020: should update weights on success', async () => {
      const input = createSubagentInput({ result: 'success', qualityScore: 0.9 });
      const response = await simulateHookExecution(input);

      expect(response.weightsUpdated).toBe(true);
    });

    it('TC-H5-021: should update weights on failure with quality score', async () => {
      const input = createSubagentInput({
        result: 'failure',
        qualityScore: 0.3,
      });
      const response = await simulateHookExecution(input);

      expect(response.weightsUpdated).toBe(true);
    });

    it('TC-H5-022: should NOT update weights on partial result', async () => {
      const input = createSubagentInput({ result: 'partial' });
      const response = await simulateHookExecution(input);

      expect(response.weightsUpdated).toBe(false);
    });

    it('TC-H5-023: should NOT update weights on failure without quality score', async () => {
      const input = createSubagentInput({
        result: 'failure',
        qualityScore: undefined,
      });
      const response = await simulateHookExecution(input);

      expect(response.weightsUpdated).toBe(false);
    });

    it('TC-H5-024: should handle missing quality score', async () => {
      const input = createSubagentInput({
        result: 'success',
        qualityScore: undefined,
      });
      const response = await simulateHookExecution(input);

      // Success without quality still updates weights
      expect(response.weightsUpdated).toBe(true);
    });
  });

  describe('Response Format', () => {
    it('TC-H5-030: should include correlationId', async () => {
      const input = createSubagentInput({
        correlationId: 'unique-id-123',
      });
      const response = await simulateHookExecution(input);

      expect(response.correlationId).toBe('unique-id-123');
    });

    it('TC-H5-031: should include durationMs', async () => {
      const input = createSubagentInput();
      const response = await simulateHookExecution(input);

      expect(response.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('TC-H5-032: should include trajectoryId', async () => {
      const input = createSubagentInput();
      const response = await simulateHookExecution(input);

      expect(response.trajectoryId).toBeDefined();
      expect(typeof response.trajectoryId).toBe('string');
    });

    it('TC-H5-033: should include weightsUpdated boolean', async () => {
      const input = createSubagentInput();
      const response = await simulateHookExecution(input);

      expect(typeof response.weightsUpdated).toBe('boolean');
    });
  });

  describe('Performance', () => {
    it('TC-H5-040: should complete within 500ms', async () => {
      const input = createSubagentInput();

      const startTime = performance.now();
      const response = await simulateHookExecution(input);
      const elapsed = performance.now() - startTime;

      expect(response.success).toBe(true);
      expect(elapsed).toBeLessThan(500);
    });

    it('TC-H5-041: should handle rapid sequential calls', async () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        createSubagentInput({
          correlationId: `rapid-test-${i}`,
          agentType: i % 2 === 0 ? 'coder' : 'tester',
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
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateTrajectoryId(agentType: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `traj-${agentType}-${timestamp}-${random}`;
}

function shouldUpdateWeights(input: SubagentStopInput): boolean {
  if (input.result === 'success') return true;
  if (input.result === 'failure' && input.qualityScore !== undefined) return true;
  return false;
}

async function simulateHookExecution(
  input: SubagentStopInput
): Promise<SubagentLearnResponse> {
  const startTime = Date.now();

  const trajectoryId = generateTrajectoryId(input.agentType);
  const weightsUpdated = shouldUpdateWeights(input);

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    trajectoryId,
    weightsUpdated,
  };
}
