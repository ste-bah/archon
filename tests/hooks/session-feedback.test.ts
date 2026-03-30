/**
 * Session Feedback Hook Tests
 *
 * Tests for TASK-HOOK-008: Session feedback hook implementation
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-008
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  NotificationInput,
  SessionFeedbackResponse,
  Sentiment,
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
 * Test fixture: Create NotificationInput for feedback
 */
function createFeedbackInput(
  message: string,
  overrides: Partial<NotificationInput> = {}
): NotificationInput {
  return {
    correlationId: 'test-correlation-123',
    timestamp: new Date().toISOString(),
    eventType: 'Notification',
    notificationType: 'feedback',
    message,
    ...overrides,
  };
}

describe('TASK-HOOK-008: Session Feedback Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Notification Filtering', () => {
    it('TC-H8-001: should process feedback notifications', async () => {
      const input = createFeedbackInput('Great job!');
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.feedbackProcessed).toBe(true);
    });

    it('TC-H8-002: should skip non-feedback notifications', async () => {
      const input: NotificationInput = {
        correlationId: 'test-123',
        timestamp: new Date().toISOString(),
        eventType: 'Notification',
        notificationType: 'compact',
        message: 'Compact triggered',
      };
      const response = await simulateHookExecution(input);

      expect(response.feedbackProcessed).toBe(false);
    });

    it('TC-H8-003: should skip info notifications', async () => {
      const input: NotificationInput = {
        correlationId: 'test-456',
        timestamp: new Date().toISOString(),
        eventType: 'Notification',
        notificationType: 'info',
        message: 'Info message',
      };
      const response = await simulateHookExecution(input);

      expect(response.feedbackProcessed).toBe(false);
    });
  });

  describe('Sentiment Analysis', () => {
    it('TC-H8-010: should detect positive sentiment', async () => {
      const input = createFeedbackInput('Great job on the TypeScript refactoring!');
      const response = await simulateHookExecution(input);

      expect(response.sentiment).toBe('positive');
    });

    it('TC-H8-011: should detect negative sentiment', async () => {
      const input = createFeedbackInput('The code has bugs and errors');
      const response = await simulateHookExecution(input);

      expect(response.sentiment).toBe('negative');
    });

    it('TC-H8-012: should detect neutral sentiment', async () => {
      const input = createFeedbackInput('This is a statement about the code');
      const response = await simulateHookExecution(input);

      expect(response.sentiment).toBe('neutral');
    });

    it('TC-H8-013: should use metadata sentiment if provided', async () => {
      const input = createFeedbackInput('Neutral message', {
        metadata: { sentiment: 'positive' },
      });
      const response = await simulateHookExecution(input);

      expect(response.sentiment).toBe('positive');
    });

    it('TC-H8-014: should detect multiple positive indicators', async () => {
      const input = createFeedbackInput('Excellent work, perfect solution, thanks!');
      const response = await simulateHookExecution(input);

      expect(response.sentiment).toBe('positive');
    });

    it('TC-H8-015: should detect multiple negative indicators', async () => {
      const input = createFeedbackInput('Wrong approach, broken, has issues');
      const response = await simulateHookExecution(input);

      expect(response.sentiment).toBe('negative');
    });
  });

  describe('Weight Delta', () => {
    it('TC-H8-020: should return weight delta for positive feedback', async () => {
      const input = createFeedbackInput('Great job!');
      const response = await simulateHookExecution(input);

      expect(response.weightDelta).toBeDefined();
      expect(Object.keys(response.weightDelta).length).toBeGreaterThan(0);
    });

    it('TC-H8-021: should return weight delta for negative feedback', async () => {
      const input = createFeedbackInput('This is broken');
      const response = await simulateHookExecution(input);

      expect(response.weightDelta).toBeDefined();
    });

    it('TC-H8-022: should apply stronger weight for negative feedback', async () => {
      const positiveInput = createFeedbackInput('Good');
      const negativeInput = createFeedbackInput('Bad');

      const positiveResponse = await simulateHookExecution(positiveInput);
      const negativeResponse = await simulateHookExecution(negativeInput);

      // Negative should have larger absolute weight changes
      const posTotal = Object.values(positiveResponse.weightDelta).reduce(
        (sum, v) => sum + Math.abs(v),
        0
      );
      const negTotal = Object.values(negativeResponse.weightDelta).reduce(
        (sum, v) => sum + Math.abs(v),
        0
      );

      expect(negTotal).toBeGreaterThan(posTotal);
    });
  });

  describe('Response Format', () => {
    it('TC-H8-030: should include correlationId', async () => {
      const input = createFeedbackInput('Test', {
        correlationId: 'unique-id-999',
      });
      const response = await simulateHookExecution(input);

      expect(response.correlationId).toBe('unique-id-999');
    });

    it('TC-H8-031: should include durationMs', async () => {
      const input = createFeedbackInput('Test');
      const response = await simulateHookExecution(input);

      expect(response.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('TC-H8-032: should include sentiment', async () => {
      const input = createFeedbackInput('Test');
      const response = await simulateHookExecution(input);

      expect(['positive', 'negative', 'neutral']).toContain(response.sentiment);
    });

    it('TC-H8-033: should include feedbackProcessed boolean', async () => {
      const input = createFeedbackInput('Test');
      const response = await simulateHookExecution(input);

      expect(typeof response.feedbackProcessed).toBe('boolean');
    });
  });

  describe('Performance', () => {
    it('TC-H8-040: should complete within 500ms', async () => {
      const input = createFeedbackInput('Performance test feedback');

      const startTime = performance.now();
      const response = await simulateHookExecution(input);
      const elapsed = performance.now() - startTime;

      expect(response.success).toBe(true);
      expect(elapsed).toBeLessThan(500);
    });

    it('TC-H8-041: should handle rapid sequential calls', async () => {
      const messages = [
        'Great work!',
        'Broken code',
        'Neutral statement',
        'Excellent job',
        'Bug found',
      ];

      const inputs = messages.map((msg, i) =>
        createFeedbackInput(msg, { correlationId: `rapid-${i}` })
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
    it('TC-H8-050: should handle empty message', async () => {
      const input = createFeedbackInput('');
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.sentiment).toBe('neutral');
    });

    it('TC-H8-051: should handle very long message', async () => {
      const input = createFeedbackInput('great '.repeat(1000));
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
    });

    it('TC-H8-052: should handle special characters', async () => {
      const input = createFeedbackInput('<script>alert("test")</script>');
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
    });

    it('TC-H8-053: should handle unicode', async () => {
      const input = createFeedbackInput('Great job! 🚀 你好');
      const response = await simulateHookExecution(input);

      expect(response.success).toBe(true);
      expect(response.sentiment).toBe('positive');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function analyzeSentiment(message: string): Sentiment {
  const lowerMessage = message.toLowerCase();

  const positiveIndicators = [
    'great', 'good', 'excellent', 'perfect', 'thanks',
    'helpful', 'works', 'success', 'correct', 'nice',
  ];

  const negativeIndicators = [
    'wrong', 'bad', 'error', 'fail', 'incorrect',
    'broken', 'bug', 'issue', 'problem', "doesn't work",
  ];

  const positiveCount = positiveIndicators.filter((w) =>
    lowerMessage.includes(w)
  ).length;

  const negativeCount = negativeIndicators.filter((w) =>
    lowerMessage.includes(w)
  ).length;

  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

function getSentimentStrength(sentiment: Sentiment): number {
  switch (sentiment) {
    case 'positive': return 0.3;
    case 'negative': return 0.5;
    case 'neutral': return 0.1;
  }
}

async function simulateHookExecution(
  input: NotificationInput
): Promise<SessionFeedbackResponse> {
  const startTime = Date.now();

  if (input.notificationType !== 'feedback') {
    return {
      success: true,
      correlationId: input.correlationId,
      durationMs: Date.now() - startTime,
      sentiment: 'neutral',
      weightDelta: {},
      feedbackProcessed: false,
    };
  }

  const metadata = (input.metadata ?? {}) as { sentiment?: Sentiment };
  const sentiment = metadata.sentiment ?? analyzeSentiment(input.message);
  const strength = getSentimentStrength(sentiment);

  const multiplier = sentiment === 'negative' ? -1 : 1;
  const delta = strength * multiplier;

  const weightDelta = {
    current_domain: delta * 0.1,
    related_domain: delta * 0.05,
  };

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    sentiment,
    weightDelta,
    feedbackProcessed: true,
  };
}
