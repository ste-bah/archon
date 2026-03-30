/**
 * Session Feedback Hook Handler
 *
 * Triggers on Notification (feedback) event to call SoNA.provideFeedback()
 * with sentiment analysis for weight adjustment.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-HOOK-008
 *
 * @module scripts/hooks/session-feedback
 */

import {
  NotificationInput,
  SessionFeedbackResponse,
  Sentiment,
  EXIT_CODES,
} from './hook-types.js';
import { ActivityStream } from '../../src/god-agent/observability/index.js';

interface FeedbackMetadata {
  sentiment?: Sentiment;
  context?: string;
  strength?: number;
}

/**
 * Parse input from stdin
 */
async function readInput(): Promise<NotificationInput | null> {
  const chunks: string[] = [];

  process.stdin.setEncoding('utf-8');

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const input = chunks.join('');
  if (!input || input.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(input) as NotificationInput;
  } catch {
    return null;
  }
}

/**
 * Simple sentiment analysis from message text
 */
function analyzeSentiment(message: string): Sentiment {
  const lowerMessage = message.toLowerCase();

  const positiveIndicators = [
    'great',
    'good',
    'excellent',
    'perfect',
    'thanks',
    'helpful',
    'works',
    'success',
    'correct',
    'nice',
    'awesome',
    'love',
    'amazing',
  ];

  const negativeIndicators = [
    'wrong',
    'bad',
    'error',
    'fail',
    'incorrect',
    'broken',
    'bug',
    'issue',
    'problem',
    "doesn't work",
    'not working',
    'crash',
    'terrible',
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

/**
 * Get default strength for sentiment
 */
function getSentimentStrength(sentiment: Sentiment): number {
  switch (sentiment) {
    case 'positive':
      return 0.3;
    case 'negative':
      return 0.5; // Negative feedback has stronger effect
    case 'neutral':
      return 0.1;
  }
}

/**
 * Simulate providing feedback to SoNA
 * In full implementation, this would call SoNAEngine.provideFeedback()
 */
async function provideFeedback(
  sentiment: Sentiment,
  _context: string,
  strength: number
): Promise<Record<string, number>> {
  // Simplified weight delta calculation
  // Full implementation would use SoNAEngine.getInstance().provideFeedback()

  const multiplier = sentiment === 'negative' ? -1 : 1;
  const delta = strength * multiplier;

  return {
    current_domain: delta * 0.1,
    related_domain: delta * 0.05,
  };
}

/**
 * Handle session feedback hook
 */
async function handleSessionFeedback(
  input: NotificationInput
): Promise<SessionFeedbackResponse> {
  const startTime = Date.now();

  // Only process feedback notifications
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

  // Extract feedback metadata
  const metadata = (input.metadata ?? {}) as FeedbackMetadata;

  // Analyze sentiment from message if not provided
  const sentiment = metadata.sentiment ?? analyzeSentiment(input.message);
  const strength = metadata.strength ?? getSentimentStrength(sentiment);
  const context = metadata.context ?? input.message;

  // Provide feedback to SoNA
  const weightDelta = await provideFeedback(sentiment, context, strength);

  // Emit observability event
  try {
    const bus = await ActivityStream.getInstance();
    await bus.emit({
      type: 'hook.executed',
      correlationId: input.correlationId,
      payload: {
        hookName: 'session-feedback',
        success: true,
        durationMs: Date.now() - startTime,
        sentiment,
        strength,
        domainsAffected: Object.keys(weightDelta).length,
      },
    });
  } catch {
    // Observability failure shouldn't fail the hook
  }

  return {
    success: true,
    correlationId: input.correlationId,
    durationMs: Date.now() - startTime,
    sentiment,
    weightDelta,
    feedbackProcessed: true,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const input = await readInput();

    if (!input) {
      const response: SessionFeedbackResponse = {
        success: true,
        correlationId: 'no-input',
        durationMs: 0,
        sentiment: 'neutral',
        weightDelta: {},
        feedbackProcessed: false,
      };
      console.log(JSON.stringify(response));
      process.exit(EXIT_CODES.SUCCESS);
      return;
    }

    const response = await handleSessionFeedback(input);
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const response: SessionFeedbackResponse = {
      success: false,
      correlationId: 'error',
      durationMs: 0,
      error: errorMessage,
      sentiment: 'neutral',
      weightDelta: {},
      feedbackProcessed: false,
    };
    console.log(JSON.stringify(response));
    process.exit(EXIT_CODES.ERROR);
  }
}

main();
