/**
 * Orchestration Memory Manager
 *
 * Implements: TASK-ORC-002 (TECH-ORC-001 lines 410-598)
 *
 * Primary orchestrator for all memory operations in the God Agent system.
 * Coordinates storage, retrieval, context injection, and feedback submission.
 *
 * @module orchestration/orchestration-memory-manager
 */

import type { InteractionStore } from '../universal/interaction-store.js';
import type { ReasoningBank } from '../core/reasoning/reasoning-bank.js';
import type { SonaEngine } from '../core/learning/sona-engine.js';
import type {
  IWorkflowState,
  IStorageResult,
  IContextInjection,
  IQualityEstimate,
  IOrchestrationMetrics,
  IExtractedFindings
} from './types.js';
import { ExtractorService } from './services/extractor-service.js';
import { ContextInjector } from './services/context-injector.js';
import { FeedbackGenerator } from './services/feedback-generator.js';

/**
 * Configuration for OrchestrationMemoryManager
 */
export interface IOrchestrationMemoryConfig {
  /** Storage directory for workflow state */
  storageDir: string;
  /** Enable automatic memory operations */
  enableAutoMemory: boolean;
  /** Enable verbose logging */
  verbose: boolean;
  /** Maximum context tokens for injection */
  maxContextTokens: number;
  /** Enable workflow state persistence */
  enablePersistence: boolean;
  /** Enable delegation detection */
  enableDelegation: boolean;
  /** Enable agent routing */
  enableRouting: boolean;
}

/**
 * Options for Task() wrapping
 */
export interface ITaskOptions {
  /** Skip all memory operations */
  skipMemory?: boolean;
  /** Workflow ID for context */
  workflowId?: string;
}

/**
 * Task metadata for storage and feedback
 */
export interface ITaskMetadata {
  workflowId: string;
  taskId: string;
  agentType: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Feedback metadata
 */
export interface IFeedbackMetadata {
  trajectoryId: string;
  agentType: string;
  taskType: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * OrchestrationMemoryManager - Main orchestration class
 *
 * Coordinates all memory operations including:
 * - Task output extraction and storage
 * - Context injection before task execution
 * - Quality feedback generation
 * - Workflow state persistence
 * - Delegation detection and routing
 */
/**
 * Feedback queue entry for retry logic
 */
interface IFeedbackQueueEntry {
  trajectoryId: string;
  quality: number;
  outcome: 'positive' | 'negative' | 'neutral';
  metadata: any;
  attempts: number;
  lastAttempt: number;
  createdAt: number;
}

export class OrchestrationMemoryManager {
  private config: IOrchestrationMemoryConfig;
  private interactionStore: InteractionStore;
  private reasoningBank: ReasoningBank;
  private sonaEngine: SonaEngine | null;
  private metrics: IOrchestrationMetrics;
  private extractorService: ExtractorService;
  private contextInjector: ContextInjector;
  private feedbackGenerator: FeedbackGenerator;
  private feedbackQueue: IFeedbackQueueEntry[] = [];
  private retryIntervalId?: NodeJS.Timeout;

  /**
   * Initialize the manager with dependencies
   *
   * @param config - Configuration options
   * @param interactionStore - InteractionStore instance
   * @param reasoningBank - ReasoningBank instance
   * @param sonaEngine - SonaEngine instance (optional, for direct feedback persistence)
   * @throws Error if dependencies are invalid
   */
  constructor(
    config: IOrchestrationMemoryConfig,
    interactionStore: InteractionStore,
    reasoningBank: ReasoningBank,
    sonaEngine?: SonaEngine
  ) {
    // Validate dependencies
    if (!interactionStore) {
      throw new Error('InteractionStore is required');
    }
    if (!reasoningBank) {
      throw new Error('ReasoningBank is required');
    }

    this.config = config;
    this.interactionStore = interactionStore;
    this.reasoningBank = reasoningBank;
    this.sonaEngine = sonaEngine || null;

    // Initialize services
    this.extractorService = new ExtractorService();
    this.contextInjector = new ContextInjector(interactionStore, config.maxContextTokens);
    this.feedbackGenerator = new FeedbackGenerator();

    // Initialize metrics
    this.metrics = {
      storageCount: 0,
      retrievalCount: 0,
      feedbackCount: 0,
      successRate: 0,
      averageQuality: 0,
      contextInjectionsCount: 0,
      averageContextTokens: 0,
      delegationPromptsCount: 0,
      delegationAcceptanceRate: 0,
      phaseDetectionAccuracy: 0,
      sessionStartedAt: Date.now(),
      lastActivityAt: Date.now()
    };

    if (this.config.verbose) {
      console.log('[OrchestrationMemoryManager] Initialized successfully');
    }
  }

  /**
   * Wrap Task() execution with automatic memory operations
   *
   * @param taskFn - Original Task() function
   * @param prompt - Task prompt
   * @param agentType - Agent type (optional, will be auto-selected if missing)
   * @param options - Task options including skipMemory flag
   * @returns Task output with memory operations applied
   *
   * @throws Error if Task() execution fails
   */
  async wrapTask(
    taskFn: (prompt: string, agent: string) => Promise<string>,
    prompt: string,
    agentType?: string,
    options?: ITaskOptions
  ): Promise<string> {
    const startTime = Date.now();
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const workflowId = options?.workflowId || 'default';
    const trajectoryId = `traj-${taskId}`;

    // Skip memory operations if requested
    if (options?.skipMemory) {
      return await taskFn(prompt, agentType || 'coder');
    }

    try {
      // === PRE-TASK PHASE ===

      // 1. Check delegation detection (only if enabled)
      if (this.config.enableDelegation && !agentType) {
        // Note: DelegationDetector needs to be initialized - deferred to caller
        if (this.config.verbose) {
          console.log('[OrchestrationMemoryManager] Delegation detection skipped (not implemented in wrapTask)');
        }
      }

      // 2. Route to appropriate agent (if not specified)
      let finalAgentType = agentType;
      if (!finalAgentType && this.config.enableRouting) {
        // Use AgentRouter to detect agent from prompt
        const { AgentRouter } = await import('./services/agent-router.js');
        const router = new AgentRouter();
        const routing = router.routeToAgent(prompt);
        finalAgentType = routing.actualAgent;

        if (this.config.verbose) {
          console.log('[OrchestrationMemoryManager] Agent routing:');
          console.log(`  Detected phase: ${routing.detectedPhase}, Confidence: ${routing.phaseConfidence.toFixed(2)}`);
          console.log(`  Selected agent: ${finalAgentType}`);
        }
      }

      // Default to coder if still not set
      if (!finalAgentType) {
        finalAgentType = 'coder';
      }

      // 3. Inject context from InteractionStore
      let enhancedPrompt = prompt;
      if (this.config.enableAutoMemory) {
        const workflowDomain = `project/${workflowId}`;
        const tags: string[] = []; // No specific tags - get all workflow knowledge

        const contextResult = await this.injectContext(prompt, workflowDomain, tags);
        enhancedPrompt = contextResult.enhancedPrompt;

        if (this.config.verbose && contextResult.contextEntryCount > 0) {
          console.log('[OrchestrationMemoryManager] Pre-task context injection complete');
        }
      }

      // 4. Update workflow state (if persistence enabled)
      if (this.config.enablePersistence) {
        const { WorkflowStateManager } = await import('./services/workflow-state-manager.js');
        const stateManager = new WorkflowStateManager({
          storageDir: `${this.config.storageDir}/workflows`,
          verbose: this.config.verbose
        });

        // Try to restore existing state
        let state = await stateManager.restoreWorkflowState(workflowId);
        if (!state) {
          // Create new state
          state = {
            id: workflowId,
            name: workflowId,
            completedPhases: [],
            pendingTasks: [taskId],
            storedDomains: [`project/${workflowId}`],
            currentPhase: 'active',
            startedAt: Date.now(),
            lastActivityAt: Date.now(),
            status: 'active'
          };
        } else {
          // Update existing state
          state.pendingTasks.push(taskId);
          state.lastActivityAt = Date.now();
        }

        await stateManager.persistWorkflowState(workflowId, state);
      }

      // === EXECUTE TASK ===
      if (this.config.verbose) {
        console.log(`[OrchestrationMemoryManager] Executing task with agent: ${finalAgentType}`);
      }

      const output = await taskFn(enhancedPrompt, finalAgentType);
      const durationMs = Date.now() - startTime;

      // === POST-TASK PHASE ===

      // 5. Extract findings
      const findings = this.extractorService.extractFindings(output);

      // 6. Store to InteractionStore
      if (this.config.enableAutoMemory) {
        const storageResult = await this.storeTaskOutput(output, {
          workflowId,
          taskId,
          agentType: finalAgentType,
          durationMs,
          success: true
        });

        if (this.config.verbose) {
          console.log('[OrchestrationMemoryManager] Post-task storage complete');
          console.log(`  Entry ID: ${storageResult.entryId}`);
        }
      }

      // 7. Generate and submit feedback
      const feedbackResult = await this.submitFeedback(output, {
        trajectoryId,
        agentType: finalAgentType,
        taskType: 'task-execution',
        durationMs,
        success: true
      });

      if (this.config.verbose) {
        console.log('[OrchestrationMemoryManager] Post-task feedback complete');
        console.log(`  Quality: ${feedbackResult.quality.toFixed(2)}, Outcome: ${feedbackResult.outcome}`);
      }

      // 8. Update workflow state (mark task complete)
      if (this.config.enablePersistence) {
        const { WorkflowStateManager } = await import('./services/workflow-state-manager.js');
        const stateManager = new WorkflowStateManager({
          storageDir: `${this.config.storageDir}/workflows`,
          verbose: this.config.verbose
        });

        const state = await stateManager.restoreWorkflowState(workflowId);
        if (state) {
          // Remove from pending, update activity
          state.pendingTasks = state.pendingTasks.filter(t => t !== taskId);
          state.lastActivityAt = Date.now();
          await stateManager.persistWorkflowState(workflowId, state);
        }
      }

      // 9. Process retry queue (non-blocking)
      this.processFeedbackQueue().catch(error => {
        console.warn('[OrchestrationMemoryManager] Background retry failed:', error);
      });

      return output;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Log error and submit negative feedback
      console.error('[OrchestrationMemoryManager] Task execution failed:', error);

      try {
        await this.submitFeedback('', {
          trajectoryId,
          agentType: agentType || 'unknown',
          taskType: 'task-execution',
          durationMs,
          success: false,
          error: (error as Error).message
        });
      } catch (feedbackError) {
        console.warn('[OrchestrationMemoryManager] Failed to submit error feedback:', feedbackError);
      }

      // Re-throw original error
      throw error;
    }
  }

  /**
   * Store task output to InteractionStore
   *
   * @param output - Task output string
   * @param metadata - Task metadata
   * @returns Storage result with entry ID and details
   *
   * @throws Error if storage fails
   */
  async storeTaskOutput(
    output: string,
    metadata: ITaskMetadata
  ): Promise<IStorageResult> {
    try {
      // 1. Extract findings using ExtractorService
      const findings = this.extractorService.extractFindings(output);

      // 2. Assign domain
      const domain = metadata.workflowId ? `project/${metadata.workflowId}` : 'project/general';

      // 3. Assign category based on agentType
      const category = this.assignCategory(metadata.agentType);

      // 4. Generate tags from findings
      const tags = this.generateTags(findings, metadata.agentType, category);

      // 5. Create entry ID
      const entryId = `task-${metadata.taskId}-${Date.now()}`;

      // 6. Store to InteractionStore
      this.interactionStore.addKnowledge({
        id: entryId,
        domain,
        type: category as 'pattern' | 'fact' | 'procedure' | 'example' | 'insight',
        content: JSON.stringify({
          output,
          findings,
          metadata
        }),
        tags,
        quality: metadata.success ? 0.8 : 0.4,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // 7. Update metrics
      this.metrics.storageCount++;
      this.metrics.lastActivityAt = Date.now();

      if (this.config.verbose) {
        console.log(`[OrchestrationMemoryManager] Stored task output: ${entryId}`);
        console.log(`  Domain: ${domain}, Category: ${category}, Tags: ${tags.join(', ')}`);
      }

      // 8. Return result
      return {
        success: true,
        domain,
        tags,
        category,
        contentSize: output.length,
        entryId
      };
    } catch (error) {
      console.error('[OrchestrationMemoryManager] Storage failed:', error);
      return {
        success: false,
        domain: 'unknown',
        tags: [],
        category: 'unknown',
        contentSize: output.length,
        entryId: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Assign category based on agent type
   */
  private assignCategory(agentType: string): string {
    const categoryMap: Record<string, string> = {
      'backend-dev': 'implementation',
      'coder': 'implementation',
      'system-architect': 'architecture',
      'tester': 'testing',
      'reviewer': 'review',
      'code-analyzer': 'analysis'
    };

    return categoryMap[agentType] || 'general';
  }

  /**
   * Generate tags from findings
   */
  private generateTags(findings: IExtractedFindings, agentType: string, category: string): string[] {
    const tags = new Set<string>();

    // Add agent type and category
    tags.add(agentType);
    tags.add(category);

    // Add code languages
    findings.codeBlocks.forEach(block => {
      tags.add(block.language);
    });

    // Add schema types
    findings.schemas.forEach(schema => {
      tags.add('schema');
      tags.add(schema.type);
    });

    // Add API methods
    findings.apiContracts.forEach(contract => {
      tags.add('api');
      tags.add(contract.method.toLowerCase());
    });

    // Add decision tag
    if (findings.decisions.length > 0) {
      tags.add('decision');
    }

    // Add test tag
    if (findings.testResults.length > 0) {
      tags.add('test');
    }

    // Limit to 10 tags
    return Array.from(tags).slice(0, 10);
  }

  /**
   * Inject context into task prompt
   *
   * @param prompt - Original prompt
   * @param workflowDomain - Domain to query
   * @param tags - Tags for filtering
   * @returns Context injection result with enhanced prompt
   *
   * @throws Error if context injection fails
   */
  async injectContext(
    prompt: string,
    workflowDomain: string,
    tags: string[]
  ): Promise<IContextInjection> {
    try {
      // Delegate to ContextInjector
      const result = await this.contextInjector.injectContext(prompt, workflowDomain, tags);

      // Update metrics on success
      if (result.contextEntryCount > 0) {
        this.metrics.contextInjectionsCount++;
        this.metrics.retrievalCount++;

        // Update rolling average for context tokens
        const totalTokens = this.metrics.averageContextTokens * (this.metrics.contextInjectionsCount - 1) + result.contextTokens;
        this.metrics.averageContextTokens = totalTokens / this.metrics.contextInjectionsCount;

        this.metrics.lastActivityAt = Date.now();
      }

      if (this.config.verbose && result.contextEntryCount > 0) {
        console.log('[OrchestrationMemoryManager] Context injected:');
        console.log(`  Entries: ${result.contextEntryCount}, Tokens: ${result.contextTokens}`);
        console.log(`  Domains: ${result.domainsQueried.join(', ')}`);
        console.log(`  Tags: ${result.tagsUsed.join(', ')}`);
      }

      return result;
    } catch (error) {
      console.warn('[OrchestrationMemoryManager] Context injection failed (non-fatal):', error);

      // Return original prompt on failure
      return {
        originalPrompt: prompt,
        enhancedPrompt: prompt,
        contextEntryCount: 0,
        contextTokens: 0,
        domainsQueried: [workflowDomain],
        tagsUsed: tags,
        contextLimitExceeded: true,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Generate and submit feedback to ReasoningBank
   *
   * @param output - Task output
   * @param metadata - Task metadata
   * @returns Quality estimate
   *
   * @throws Error if feedback submission fails (queues for retry)
   */
  async submitFeedback(
    output: string,
    metadata: IFeedbackMetadata
  ): Promise<IQualityEstimate> {
    // 1. Generate quality estimate
    const estimate = this.feedbackGenerator.generateQualityEstimate(output, {
      agentType: metadata.agentType,
      taskType: metadata.taskType,
      success: metadata.success,
      error: metadata.error
    });

    // 2. Try submitting feedback - prefer SonaEngine for direct SQLite persistence
    try {
      if (this.sonaEngine) {
        // Direct path to SonaEngine for guaranteed SQLite persistence
        await this.sonaEngine.provideFeedback(metadata.trajectoryId, estimate.quality, {
          skipAutoSave: false, // CRITICAL: Ensure persistence to SQLite
        });
      } else {
        // Fallback to ReasoningBank (indirect path)
        await this.reasoningBank.provideFeedback({
          trajectoryId: metadata.trajectoryId,
          quality: estimate.quality,
          feedback: estimate.reasoning,
          verdict: estimate.outcome === 'positive' ? 'correct' : estimate.outcome === 'negative' ? 'incorrect' : 'neutral'
        });
      }

      // 3. Success - update metrics
      this.metrics.feedbackCount++;
      this.metrics.lastActivityAt = Date.now();

      // Update rolling average quality
      const totalQuality = this.metrics.averageQuality * (this.metrics.feedbackCount - 1) + estimate.quality;
      this.metrics.averageQuality = totalQuality / this.metrics.feedbackCount;

      if (this.config.verbose) {
        console.log('[OrchestrationMemoryManager] Feedback submitted:');
        console.log(`  Trajectory: ${metadata.trajectoryId}`);
        console.log(`  Quality: ${estimate.quality.toFixed(2)}, Outcome: ${estimate.outcome}`);
      }

      return estimate;
    } catch (error) {
      // 4. Failure - add to retry queue
      console.warn('[OrchestrationMemoryManager] Feedback submission failed, queuing for retry:', error);

      this.feedbackQueue.push({
        trajectoryId: metadata.trajectoryId,
        quality: estimate.quality,
        outcome: estimate.outcome,
        metadata: {
          agentType: metadata.agentType,
          taskType: metadata.taskType,
          reasoning: estimate.reasoning
        },
        attempts: 0,
        lastAttempt: 0,
        createdAt: Date.now()
      });

      // Prune queue if needed
      this.pruneFeedbackQueue();

      // Save queue to disk
      await this.saveFeedbackQueue();

      return estimate;
    }
  }

  /**
   * Process feedback retry queue
   */
  private async processFeedbackQueue(): Promise<void> {
    const now = Date.now();
    const entriesToRetry: IFeedbackQueueEntry[] = [];

    // Find entries ready for retry
    for (const entry of this.feedbackQueue) {
      if (entry.attempts >= 3) {
        // Max retries exceeded - log to failure log
        await this.logFeedbackFailure(entry);
        continue;
      }

      // Calculate delay based on attempt (exponential backoff)
      const delays = [0, 1000, 2000, 4000]; // 0s, 1s, 2s, 4s
      const requiredDelay = delays[entry.attempts];

      if (now - entry.lastAttempt >= requiredDelay) {
        entriesToRetry.push(entry);
      }
    }

    // Process up to 10 entries per cycle
    const batch = entriesToRetry.slice(0, 10);

    for (const entry of batch) {
      try {
        // Prefer SonaEngine for direct SQLite persistence
        if (this.sonaEngine) {
          await this.sonaEngine.provideFeedback(entry.trajectoryId, entry.quality, {
            skipAutoSave: false, // CRITICAL: Ensure persistence to SQLite
          });
        } else {
          await this.reasoningBank.provideFeedback({
            trajectoryId: entry.trajectoryId,
            quality: entry.quality,
            feedback: entry.metadata.reasoning,
            verdict: entry.outcome === 'positive' ? 'correct' : entry.outcome === 'negative' ? 'incorrect' : 'neutral'
          });
        }

        // Success - remove from queue
        this.feedbackQueue = this.feedbackQueue.filter(e => e.trajectoryId !== entry.trajectoryId);

        this.metrics.feedbackCount++;

        if (this.config.verbose) {
          console.log(`[OrchestrationMemoryManager] Retry success: ${entry.trajectoryId}`);
        }
      } catch (error) {
        // Failure - increment attempts
        entry.attempts++;
        entry.lastAttempt = now;

        if (this.config.verbose) {
          console.warn(`[OrchestrationMemoryManager] Retry ${entry.attempts} failed: ${entry.trajectoryId}`);
        }
      }
    }

    // Save queue after processing
    await this.saveFeedbackQueue();
  }

  /**
   * Prune feedback queue (max 100 entries, max 24h age)
   */
  private pruneFeedbackQueue(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Remove entries older than 24h or with max retries
    this.feedbackQueue = this.feedbackQueue.filter(entry => {
      const age = now - entry.createdAt;
      return age < maxAge && entry.attempts < 3;
    });

    // Keep only newest 100 entries
    if (this.feedbackQueue.length > 100) {
      this.feedbackQueue.sort((a, b) => b.createdAt - a.createdAt);
      this.feedbackQueue = this.feedbackQueue.slice(0, 100);
    }
  }

  /**
   * Save feedback queue to disk
   */
  private async saveFeedbackQueue(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Ensure storage directory exists
      await fs.mkdir(this.config.storageDir, { recursive: true });

      const queuePath = path.join(this.config.storageDir, 'feedback-queue.json');
      await fs.writeFile(queuePath, JSON.stringify(this.feedbackQueue, null, 2), 'utf-8');
    } catch (error) {
      console.warn('[OrchestrationMemoryManager] Failed to save feedback queue:', error);
    }
  }

  /**
   * Load feedback queue from disk
   */
  private async loadFeedbackQueue(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const queuePath = path.join(this.config.storageDir, 'feedback-queue.json');
      const data = await fs.readFile(queuePath, 'utf-8');
      this.feedbackQueue = JSON.parse(data);

      // Prune old entries
      this.pruneFeedbackQueue();

      if (this.config.verbose) {
        console.log(`[OrchestrationMemoryManager] Loaded ${this.feedbackQueue.length} queued feedback entries`);
      }
    } catch (error) {
      // File doesn't exist or parse error - that's okay
      this.feedbackQueue = [];
    }
  }

  /**
   * Log feedback failure
   */
  private async logFeedbackFailure(entry: IFeedbackQueueEntry): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const logPath = path.join(this.config.storageDir, 'feedback-failures.log');
      const logEntry = `${new Date().toISOString()} - ${entry.trajectoryId} - ${entry.attempts} attempts\n`;

      await fs.appendFile(logPath, logEntry, 'utf-8');

      // Remove from queue
      this.feedbackQueue = this.feedbackQueue.filter(e => e.trajectoryId !== entry.trajectoryId);
    } catch (error) {
      console.warn('[OrchestrationMemoryManager] Failed to log feedback failure:', error);
    }
  }

  /**
   * Get feedback queue for testing
   */
  getFeedbackQueue(): IFeedbackQueueEntry[] {
    return [...this.feedbackQueue];
  }

  /**
   * Persist workflow state to disk
   *
   * @param workflowId - Workflow identifier
   * @param state - Workflow state to persist
   * @throws Error if write fails
   */
  async persistWorkflowState(
    workflowId: string,
    state: IWorkflowState
  ): Promise<void> {
    if (!this.config.enablePersistence) {
      return;
    }

    const { WorkflowStateManager } = await import('./services/workflow-state-manager.js');
    const stateManager = new WorkflowStateManager({
      storageDir: `${this.config.storageDir}/workflows`,
      verbose: this.config.verbose
    });

    await stateManager.persistWorkflowState(workflowId, state);
  }

  /**
   * Restore workflow state from disk
   *
   * @param workflowId - Workflow identifier
   * @returns Restored workflow state or null if not found
   * @throws Error if file is corrupted
   */
  async restoreWorkflowState(
    workflowId: string
  ): Promise<IWorkflowState | null> {
    if (!this.config.enablePersistence) {
      return null;
    }

    const { WorkflowStateManager } = await import('./services/workflow-state-manager.js');
    const stateManager = new WorkflowStateManager({
      storageDir: `${this.config.storageDir}/workflows`,
      verbose: this.config.verbose
    });

    return await stateManager.restoreWorkflowState(workflowId);
  }

  /**
   * Get orchestration metrics
   *
   * @returns Current session metrics
   */
  getMetrics(): IOrchestrationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset session metrics
   */
  resetMetrics(): void {
    this.metrics = {
      storageCount: 0,
      retrievalCount: 0,
      feedbackCount: 0,
      successRate: 0,
      averageQuality: 0,
      contextInjectionsCount: 0,
      averageContextTokens: 0,
      delegationPromptsCount: 0,
      delegationAcceptanceRate: 0,
      phaseDetectionAccuracy: 0,
      sessionStartedAt: Date.now(),
      lastActivityAt: Date.now()
    };

    if (this.config.verbose) {
      console.log('[OrchestrationMemoryManager] Metrics reset');
    }
  }

  /**
   * Initialize manager (load state, start background threads)
   */
  async initialize(): Promise<void> {
    if (this.config.verbose) {
      console.log('[OrchestrationMemoryManager] Initializing...');
    }

    // Load feedback queue from disk
    await this.loadFeedbackQueue();

    // Start background retry thread (every 30 seconds)
    this.retryIntervalId = setInterval(() => {
      this.processFeedbackQueue().catch(error => {
        console.warn('[OrchestrationMemoryManager] Background retry failed:', error);
      });
    }, 30000);

    if (this.config.verbose) {
      console.log('[OrchestrationMemoryManager] Initialization complete');
      console.log(`  Feedback queue: ${this.feedbackQueue.length} entries`);
    }
  }

  /**
   * Shutdown manager (save state, stop threads)
   */
  async shutdown(): Promise<void> {
    if (this.config.verbose) {
      console.log('[OrchestrationMemoryManager] Shutting down...');
    }

    // Stop background retry thread
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = undefined;
    }

    // Final queue processing
    await this.processFeedbackQueue();

    // Save feedback queue
    await this.saveFeedbackQueue();

    if (this.config.verbose) {
      console.log('[OrchestrationMemoryManager] Shutdown complete');
    }
  }
}
