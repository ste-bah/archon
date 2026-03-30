/**
 * Pipeline Daemon Service Handler
 *
 * Wraps the coding pipeline CLI functions with a warm orchestrator bundle.
 * Holds UniversalAgent, orchestrator, agentRegistry, and patternMatcher
 * in memory so RPC calls avoid the ~1-30s cold-start penalty.
 *
 * Used by pipeline-daemon.ts via DaemonServer's registerService() pattern.
 */

import {
  init,
  next,
  complete,
  completeAndNext,
  status,
  resume,
} from './coding-pipeline-cli.js';
import { UniversalAgent } from '../universal/universal-agent.js';
import type { PatternMatcher } from '../core/reasoning/pattern-matcher.js';

/** Orchestrator bundle type — matches createSequentialOrchestrator() return */
interface OrchestratorBundle {
  godAgent: UniversalAgent;
  orchestrator: ReturnType<UniversalAgent['getCodingOrchestrator']> extends Promise<infer T> ? T : never;
  agentRegistry: ReturnType<UniversalAgent['getAgentRegistry']>;
  patternMatcher: PatternMatcher | undefined;
}

/**
 * Pipeline service handler for daemon registration.
 *
 * Lifecycle:
 *   1. `initialize()` — creates warm orchestrator bundle (call once at daemon startup)
 *   2. RPC methods — thin wrappers that pass the warm bundle to CLI functions
 *   3. `getHealthInfo()` — returns memory usage + request counts for monitoring
 */
export class PipelineDaemonService {
  private bundle: OrchestratorBundle | null = null;
  private requestCount = 0;
  private lastRequestAt = 0;
  private initStartedAt = 0;

  /**
   * Initialize the warm orchestrator bundle.
   * This is the expensive operation (~1-30s) that the daemon amortizes.
   */
  async initialize(): Promise<void> {
    this.initStartedAt = Date.now();
    console.error('[PipelineService] Initializing warm orchestrator bundle...');

    // Reduce embedding health check timeout for daemon startup
    process.env.EMBEDDING_HEALTH_TIMEOUT = '2000';

    const godAgent = new UniversalAgent({ verbose: false });
    await godAgent.initialize();

    const orchestrator = await godAgent.getCodingOrchestrator({
      enableParallelExecution: false,
      maxParallelAgents: 1,
    });

    const agentRegistry = godAgent.getAgentRegistry();
    const patternMatcher = (godAgent as unknown as { agent?: { getPatternMatcher?: () => unknown } })
      .agent?.getPatternMatcher?.() as PatternMatcher | undefined;

    this.bundle = { godAgent, orchestrator, agentRegistry, patternMatcher } as OrchestratorBundle;

    const elapsed = Date.now() - this.initStartedAt;
    console.error(`[PipelineService] Bundle ready in ${elapsed}ms`);
  }

  /**
   * Re-initialize the orchestrator bundle (for memory leak recovery).
   */
  async reinitialize(): Promise<void> {
    console.error('[PipelineService] Reinitializing bundle...');
    this.bundle = null;
    await this.initialize();
  }

  /**
   * Create the service handler function for DaemonServer.registerService().
   * Returns a function that routes `method` strings to the appropriate handler.
   */
  createHandler(): (method: string, params: unknown) => Promise<unknown> {
    return async (method: string, params: unknown): Promise<unknown> => {
      if (!this.bundle) {
        throw new Error('Pipeline service not initialized — call initialize() first');
      }

      this.requestCount++;
      this.lastRequestAt = Date.now();
      const p = params as Record<string, unknown> ?? {};

      switch (method) {
        case 'init':
          return this.handleInit(p);
        case 'next':
          return this.handleNext(p);
        case 'complete':
          return this.handleComplete(p);
        case 'completeAndNext':
          return this.handleCompleteAndNext(p);
        case 'status':
          return this.handleStatus(p);
        case 'resume':
          return this.handleResume(p);
        case 'health':
          return this.getHealthInfo();
        case 'restart':
          await this.reinitialize();
          return { restarted: true, timestamp: Date.now() };
        default:
          throw new Error(`Unknown pipeline method: ${method}`);
      }
    };
  }

  /**
   * List of methods supported by this service (for registerService()).
   */
  getMethods(): string[] {
    return ['init', 'next', 'complete', 'completeAndNext', 'status', 'resume', 'health', 'restart'];
  }

  // ── RPC Method Handlers ────────────────────────────────────────────────

  private async handleInit(params: Record<string, unknown>): Promise<unknown> {
    const task = params.task as string;
    if (!task) throw new Error('Missing required parameter: task');
    return init(task, this.bundle!);
  }

  private async handleNext(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = params.sessionId as string;
    if (!sessionId) throw new Error('Missing required parameter: sessionId');
    return next(sessionId, this.bundle!);
  }

  private async handleComplete(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = params.sessionId as string;
    const agentKey = params.agentKey as string;
    if (!sessionId || !agentKey) throw new Error('Missing required parameters: sessionId, agentKey');
    const file = params.file as string | undefined;
    return complete(sessionId, agentKey, file ? { file } : undefined, this.bundle!);
  }

  private async handleCompleteAndNext(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = params.sessionId as string;
    const agentKey = params.agentKey as string;
    if (!sessionId || !agentKey) throw new Error('Missing required parameters: sessionId, agentKey');
    const file = params.file as string | undefined;

    // Use the daemon's warm bundle directly (bypasses completeAndNext's own bundle creation)
    const completedData = await complete(sessionId, agentKey, file ? { file } : undefined, this.bundle!);
    const nextData = await next(sessionId, this.bundle!);
    return { completed: completedData, next: nextData };
  }

  private async handleStatus(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = params.sessionId as string;
    if (!sessionId) throw new Error('Missing required parameter: sessionId');
    // status() reads disk directly, doesn't need the bundle
    // Capture its console.log output
    return this.captureStatusOutput(sessionId);
  }

  private async handleResume(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = params.sessionId as string;
    if (!sessionId) throw new Error('Missing required parameter: sessionId');
    return resume(sessionId, this.bundle!);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * status() writes to console.log directly. Capture its output.
   */
  private async captureStatusOutput(sessionId: string): Promise<unknown> {
    // status() is a simple disk read — call it directly but capture output
    const { promises: fsP } = await import('fs');
    const sessionPath = `.god-agent/coding-sessions/${sessionId}.json`;
    const data = JSON.parse(await fsP.readFile(sessionPath, 'utf-8'));
    const total = data.batches.flat().flat().length;
    const phase = data.config.phases[data.currentPhaseIndex] || 'complete';
    const currentAgentKey = data.status !== 'complete'
      ? data.batches[data.currentPhaseIndex]?.[data.currentBatchIndex]?.[0]?.agentKey || null
      : null;
    const xpBreakdown: Array<{ quality: number; total: number; agentKey: string }> = data.xp?.breakdown || [];
    const avgQuality = xpBreakdown.length > 0
      ? xpBreakdown.reduce((sum: number, b: { quality: number }) => sum + b.quality, 0) / xpBreakdown.length
      : 0;
    const topAgent = xpBreakdown.length > 0
      ? xpBreakdown.reduce((best: { total: number; agentKey: string }, b: { total: number; agentKey: string }) =>
          b.total > best.total ? b : best, xpBreakdown[0])
      : null;
    return {
      sessionId: data.sessionId,
      status: data.status,
      currentPhase: phase,
      currentAgent: currentAgentKey,
      completedAgents: data.completedAgents.length,
      totalAgents: total,
      percentage: Math.round((data.completedAgents.length / total) * 100),
      xp: {
        total: data.xp?.total || 0,
        agentsScored: xpBreakdown.length,
        avgQuality: avgQuality.toFixed(2),
        topAgent: topAgent ? { key: topAgent.agentKey, xp: topAgent.total } : null,
      },
    };
  }

  /**
   * Health info for monitoring (memory leaks, request stats).
   */
  getHealthInfo(): Record<string, unknown> {
    const mem = process.memoryUsage();
    return {
      status: this.bundle ? 'ready' : 'uninitialized',
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
      initDurationMs: this.bundle ? Date.now() - this.initStartedAt : 0,
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      uptime: Math.round(process.uptime()),
    };
  }
}
