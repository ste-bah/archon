/**
 * Claude Code Hooks - Feedback Submitter Service
 *
 * Implements: TECH-HKS-001 FeedbackSubmitter contract
 * Constitution: REQ-HKS-008, REQ-HKS-009, REQ-HKS-019, REQ-HKS-020, FM-HKS-002
 *
 * Estimates quality and submits feedback to ReasoningBank.
 *
 * @module scripts/hooks/feedback-submitter
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ReasoningBank } from '../../src/god-agent/core/reasoning/reasoning-bank.js';
import type { ITaskSummary, IHookConfig, IHookLogger, IFeedbackQueueEntry, ILearningFeedback } from './hook-types.js';
import { createHookLogger } from './hook-logger.js';
// Implements [REQ-QUAL-001]: Import universal quality estimator (RULE-034)
import { assessQuality, type QualityInteraction } from '../../src/god-agent/universal/quality-estimator.js';
// FIX: Import CodingQualityCalculator for proper code-specific quality assessment
import {
  CodingQualityCalculator,
  createCodingQualityContext,
} from '../../src/god-agent/cli/coding-quality-calculator.js';
import type { IPostToolUseContext } from '../../src/god-agent/core/hooks/types.js';
import type { AgentMode } from '../../src/god-agent/universal/universal-agent.js';

/**
 * Feedback queue file paths
 */
const FEEDBACK_QUEUE_FILE = 'feedback-queue.json';
const FAILED_FEEDBACK_FILE = 'failed-feedback.jsonl';

/**
 * FeedbackSubmitter - Service for estimating quality and submitting feedback
 *
 * Implements: TECH-HKS-001 FeedbackSubmitter Service contract
 */
export class FeedbackSubmitter {
  private readonly reasoningBank: ReasoningBank;
  private readonly config: IHookConfig;
  private readonly logger: IHookLogger;
  private readonly storageDir: string;
  private readonly codingCalculator: CodingQualityCalculator;

  /**
   * Create a FeedbackSubmitter instance
   *
   * @param reasoningBank - ReasoningBank instance (MUST NOT be null)
   * @param config - Hook configuration
   * @param storageDir - Directory for queue files (default: .claude/hooks)
   */
  constructor(reasoningBank: ReasoningBank, config: IHookConfig, storageDir: string = '.claude/hooks') {
    // Validate dependencies - NO fallbacks (AP-001)
    if (!reasoningBank) {
      throw new Error('[FeedbackSubmitter] ReasoningBank is required - no fallback allowed');
    }

    this.reasoningBank = reasoningBank;
    this.config = config;
    this.logger = createHookLogger('post-task', config.verbose);
    this.storageDir = storageDir;
    this.codingCalculator = new CodingQualityCalculator();
  }

  /**
   * Build QualityInteraction from hook context
   *
   * Implements [REQ-QUAL-002]: Build QualityInteraction from hook context (RULE-033)
   *
   * @param summary - Parsed task summary (may be null)
   * @param output - Raw task output
   * @param context - Post-tool-use context
   * @returns QualityInteraction object for universal estimator
   */
  private buildQualityInteraction(
    summary: ITaskSummary | null,
    output: string,
    context: IPostToolUseContext
  ): QualityInteraction {
    // Detect mode from context
    const mode = this.detectMode(context);

    return {
      id: context.sessionId || crypto.randomUUID(),
      mode: mode,
      input: typeof context.toolInput === 'string'
        ? context.toolInput
        : JSON.stringify(context.toolInput).substring(0, 500),
      output: output,
      timestamp: context.timestamp || Date.now(),
    };
  }

  /**
   * Detect agent mode from context metadata
   *
   * Implements [REQ-QUAL-002]: Mode detection for quality assessment (RULE-033)
   *
   * @param context - Post-tool-use context
   * @returns Detected agent mode
   */
  private detectMode(context: IPostToolUseContext): AgentMode {
    const agentType = (context.metadata?.agentType as string) ||
                      (context.metadata?.agentCategory as string) || '';
    const input = typeof context.toolInput === 'string' ? context.toolInput : '';

    if (agentType.includes('code') || agentType.includes('coder') || input.includes('implement')) {
      return 'code';
    }
    if (agentType.includes('research') || agentType.includes('analyst')) {
      return 'research';
    }
    if (agentType.includes('writ') || agentType.includes('document')) {
      return 'write';
    }
    return 'general';
  }

  /**
   * Estimate quality score from task summary and output
   *
   * Implements: REQ-HKS-008, [REQ-QUAL-003]: Mode-aware quality assessment
   * - Uses CodingQualityCalculator for 'code' mode (proper 5-factor scoring)
   * - Falls back to generic assessQuality for other modes
   *
   * @param summary - Parsed task summary (may be null)
   * @param output - Raw task output
   * @param context - Optional post-tool-use context for mode detection
   * @returns Quality score 0-1
   */
  estimateQuality(summary: ITaskSummary | null, output: string, context?: IPostToolUseContext): number {
    try {
      // If explicit quality provided in summary, trust it
      if (summary?.reasoningBankFeedback?.quality !== undefined) {
        const explicitQuality = summary.reasoningBankFeedback.quality;
        if (explicitQuality >= 0 && explicitQuality <= 1) {
          this.logger.debug('Using explicit quality from summary', { quality: explicitQuality });
          return explicitQuality;
        }
      }

      // Detect mode
      const mode = context ? this.detectMode(context) : 'general';

      // FIX: Use CodingQualityCalculator for code mode (proper 5-factor scoring)
      if (mode === 'code') {
        const agentKey = (context?.metadata?.agentType as string) ||
                         (context?.metadata?.agentKey as string) || '';
        const phase = this.extractPhase(agentKey);

        const codingContext = createCodingQualityContext(agentKey, phase);
        const assessment = this.codingCalculator.assessQuality(output, codingContext);

        this.logger.info('Quality assessed via CodingQualityCalculator', {
          quality: assessment.score,
          tier: assessment.tier,
          agentKey,
          phase,
          meetsPatternThreshold: assessment.meetsPatternThreshold
        });

        return assessment.score;
      }

      // Fallback to generic for non-code modes (research, write, general)
      const defaultContext: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: crypto.randomUUID()
      };

      const interaction = this.buildQualityInteraction(
        summary,
        output,
        context || defaultContext
      );

      const assessment = assessQuality(interaction, 0.5);
      this.logger.info('Quality assessed via generic estimator', {
        quality: assessment.score,
        mode: mode,
        factors: assessment.factors
      });

      return assessment.score;
    } catch (error) {
      this.logger.error('Quality assessment failed, returning default 0.5', {
        error: (error as Error).message,
        summaryPresent: summary !== null,
        outputLength: output.length
      });
      return 0.5;
    }
  }

  /**
   * Extract phase number from agent key for the 47-agent coding pipeline
   */
  private extractPhase(agentKey: string): number {
    // Phase 1: Understanding
    if (['task-analyzer', 'requirement-extractor', 'requirement-prioritizer',
         'scope-definer', 'context-gatherer', 'phase-1-reviewer'].includes(agentKey)) return 1;
    // Phase 2: Exploration
    if (['codebase-analyzer', 'pattern-explorer', 'technology-scout',
         'feasibility-analyzer', 'phase-2-reviewer'].includes(agentKey)) return 2;
    // Phase 3: Architecture
    if (['system-designer', 'component-designer', 'interface-designer',
         'data-architect', 'security-architect', 'integration-architect',
         'performance-architect', 'phase-3-reviewer'].includes(agentKey)) return 3;
    // Phase 4: Implementation (default for unknown coding agents)
    if (['code-generator', 'type-implementer', 'api-implementer',
         'frontend-implementer', 'data-layer-implementer', 'service-implementer',
         'unit-implementer', 'error-handler-implementer', 'config-implementer',
         'logger-implementer', 'dependency-manager', 'phase-4-reviewer'].includes(agentKey)) return 4;
    // Phase 5: Testing
    if (['test-generator', 'test-runner', 'integration-tester', 'security-tester',
         'coverage-analyzer', 'regression-tester', 'phase-5-reviewer'].includes(agentKey)) return 5;
    // Phase 6: Optimization
    if (['code-quality-improver', 'performance-optimizer', 'final-refactorer',
         'phase-6-reviewer'].includes(agentKey)) return 6;
    // Phase 7: Delivery
    if (['implementation-coordinator', 'sign-off-approver', 'recovery-agent'].includes(agentKey)) return 7;

    return 4; // Default to implementation phase
  }

  /**
   * Determine outcome from quality score
   *
   * Implements [REQ-QUAL-004]: RULE-035 compliant thresholds (0.5, not 0.7)
   */
  determineOutcome(quality: number): 'positive' | 'negative' | 'neutral' {
    // Implements [REQ-QUAL-004]: Changed from 0.7 to 0.5 per RULE-035
    if (quality >= 0.5) return 'positive';
    if (quality <= 0.3) return 'negative';
    return 'neutral';
  }

  /**
   * Submit feedback to ReasoningBank
   *
   * Implements: REQ-HKS-009
   *
   * @param trajectoryId - Trajectory identifier (must be non-empty)
   * @param quality - Quality score (0-1)
   * @param outcome - Outcome classification
   * @throws Error if submission fails (caller should handle retry)
   */
  async submitFeedback(
    trajectoryId: string,
    quality: number,
    outcome: 'positive' | 'negative' | 'neutral'
  ): Promise<void> {
    // Validate inputs
    if (!trajectoryId || trajectoryId.trim() === '') {
      throw new Error('[FeedbackSubmitter] trajectoryId must be non-empty');
    }

    if (quality < 0 || quality > 1) {
      throw new Error(`[FeedbackSubmitter] quality must be in range 0-1, got: ${quality}`);
    }

    this.logger.debug('Submitting feedback', { trajectoryId, quality, outcome });

    // Build feedback payload
    const feedback: ILearningFeedback = {
      trajectoryId,
      quality,
      userFeedback: '', // Auto-generated feedback has no user text
      outcome
    };

    // Submit to ReasoningBank
    await this.reasoningBank.provideFeedback(feedback);

    this.logger.info('Feedback submitted successfully', { trajectoryId, quality, outcome });
  }

  /**
   * Submit feedback with automatic retry queue on failure
   *
   * Implements: REQ-HKS-019
   *
   * @param trajectoryId - Trajectory identifier
   * @param quality - Quality score
   * @param outcome - Outcome classification
   * @param metadata - Additional metadata to store with retry entry
   * @returns true if submitted immediately, false if queued for retry
   */
  async submitWithRetry(
    trajectoryId: string,
    quality: number,
    outcome: 'positive' | 'negative' | 'neutral',
    metadata: Record<string, unknown> = {}
  ): Promise<boolean> {
    try {
      await this.submitFeedback(trajectoryId, quality, outcome);
      return true;
    } catch (error) {
      this.logger.warn('Feedback submission failed, queuing for retry', {
        trajectoryId,
        error: (error as Error).message
      });

      // Queue for retry
      await this.queueForRetry({
        trajectoryId,
        quality,
        outcome,
        metadata,
        attempts: 0,
        lastAttempt: 0,
        createdAt: Date.now()
      });

      return false;
    }
  }

  /**
   * Add entry to retry queue
   */
  private async queueForRetry(entry: IFeedbackQueueEntry): Promise<void> {
    try {
      await this.ensureStorageDir();

      // Load existing queue
      const queue = await this.loadQueue();

      // Add new entry
      queue.push(entry);

      // Prune queue if needed (max 100 entries, max 24h age)
      const pruned = this.pruneQueue(queue);

      // Save queue
      await this.saveQueue(pruned);

      this.logger.debug('Feedback queued for retry', { trajectoryId: entry.trajectoryId });
    } catch (error) {
      // Log but don't throw - queue is non-critical
      this.logger.warn('Failed to queue feedback for retry', {
        trajectoryId: entry.trajectoryId,
        error: (error as Error).message
      });
    }
  }

  /**
   * Process retry queue (background, non-blocking)
   *
   * Implements: REQ-HKS-019, REQ-HKS-020
   */
  async processRetryQueue(): Promise<void> {
    try {
      await this.ensureStorageDir();

      const queue = await this.loadQueue();
      if (queue.length === 0) {
        return;
      }

      this.logger.debug('Processing retry queue', { queueLength: queue.length });

      const now = Date.now();
      const updated: IFeedbackQueueEntry[] = [];
      let processed = 0;

      for (const entry of queue) {
        // Limit to 10 entries per cycle
        if (processed >= 10) {
          updated.push(entry);
          continue;
        }

        // Check if max retries exceeded
        if (entry.attempts >= this.config.retryAttempts) {
          await this.logFailure(entry);
          continue; // Don't add back to queue
        }

        // Calculate exponential backoff delay
        const delay = this.config.retryDelayMs * Math.pow(2, entry.attempts);
        if (now - entry.lastAttempt < delay) {
          updated.push(entry);
          continue; // Not ready for retry yet
        }

        // Attempt retry
        try {
          await this.submitFeedback(entry.trajectoryId, entry.quality, entry.outcome);
          this.logger.info('Retry successful', { trajectoryId: entry.trajectoryId, attempt: entry.attempts + 1 });
          // Don't add back to queue - success!
        } catch (error) {
          // Increment attempts and add back to queue
          entry.attempts++;
          entry.lastAttempt = now;
          updated.push(entry);

          this.logger.warn('Retry failed', {
            trajectoryId: entry.trajectoryId,
            attempt: entry.attempts,
            error: (error as Error).message
          });
        }

        processed++;
      }

      // Save updated queue
      await this.saveQueue(updated);

      this.logger.debug('Retry queue processed', {
        processed,
        remaining: updated.length
      });
    } catch (error) {
      // Log but don't throw - retry processing is non-critical
      this.logger.error('Failed to process retry queue', {
        error: (error as Error).message
      });
    }
  }

  /**
   * Log failed feedback to failure log
   *
   * Implements: REQ-HKS-020
   */
  private async logFailure(entry: IFeedbackQueueEntry): Promise<void> {
    try {
      await this.ensureStorageDir();

      const logPath = path.join(this.storageDir, FAILED_FEEDBACK_FILE);
      const logEntry = JSON.stringify({
        ...entry,
        failedAt: new Date().toISOString()
      }) + '\n';

      await fs.appendFile(logPath, logEntry, 'utf-8');

      this.logger.error('Feedback exhausted all retries', {
        trajectoryId: entry.trajectoryId,
        attempts: entry.attempts
      });
    } catch (error) {
      this.logger.error('Failed to log feedback failure', {
        trajectoryId: entry.trajectoryId,
        error: (error as Error).message
      });
    }
  }

  /**
   * Load retry queue from disk
   */
  private async loadQueue(): Promise<IFeedbackQueueEntry[]> {
    try {
      const queuePath = path.join(this.storageDir, FEEDBACK_QUEUE_FILE);
      const data = await fs.readFile(queuePath, 'utf-8');
      return JSON.parse(data) as IFeedbackQueueEntry[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // File doesn't exist yet
      }
      this.logger.warn('Failed to load retry queue', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Save retry queue to disk
   */
  private async saveQueue(queue: IFeedbackQueueEntry[]): Promise<void> {
    const queuePath = path.join(this.storageDir, FEEDBACK_QUEUE_FILE);
    await fs.writeFile(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
  }

  /**
   * Prune queue (max 100 entries, max 24h age)
   */
  private pruneQueue(queue: IFeedbackQueueEntry[]): IFeedbackQueueEntry[] {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove entries older than 24h or with max retries
    let pruned = queue.filter(entry => {
      const age = now - entry.createdAt;
      return age < maxAge && entry.attempts < this.config.retryAttempts;
    });

    // Keep only newest 100 entries
    if (pruned.length > 100) {
      pruned.sort((a, b) => b.createdAt - a.createdAt);
      pruned = pruned.slice(0, 100);
    }

    return pruned;
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  /**
   * Get queue length for testing
   */
  async getQueueLength(): Promise<number> {
    const queue = await this.loadQueue();
    return queue.length;
  }
}
