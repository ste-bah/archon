/**
 * PipelinePromptFacade — Thin wrapper over the existing coding-pipeline-cli
 * functions (init, next, complete) for use by the SDK pipeline runner.
 *
 * Design: delegates to the SAME code that the CLI uses, via the shared
 * OrchestratorBundle parameter. Does NOT reimplement augmentation logic.
 * This guarantees prompt parity by construction.
 *
 * PRD: PRD-2026-SDK-001, TASK-SDK-001/002
 */

import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentInfo {
  key: string;
  prompt: string;
  model: 'opus' | 'sonnet' | 'haiku';
  phase: number;
}

export interface InitSessionResult {
  sessionId: string;
  firstAgent: AgentInfo;
  progress: ProgressInfo;
}

export interface ProgressInfo {
  completed: number;
  total: number;
  percentage: number;
}

export interface NextAgentResult {
  status: 'running';
  agent: AgentInfo;
  isLastAgent: boolean;
  progress: ProgressInfo;
}

export interface PipelineCompleteResult {
  status: 'complete';
}

export interface CompletionResult {
  quality: number;
  xp: number;
  phase: number;
  skipped: boolean;
}

// Re-export constants for SDK runner consumption
export { IMPLEMENTATION_AGENTS } from './coding-quality-calculator.js';

// ─────────────────────────────────────────────────────────────────────────────
// Facade
// ─────────────────────────────────────────────────────────────────────────────

// Import the canonical type from the CLI module — no local redefinition.
// createSequentialOrchestrator and OrchestratorBundle are both exported from the CLI.
type CliModule = typeof import('./coding-pipeline-cli.js');
type OrchestratorBundle = import('./coding-pipeline-cli.js').OrchestratorBundle;

export class PipelinePromptFacade {
  private bundle: OrchestratorBundle | null = null;
  private projectRoot: string = '';

  /**
   * Initialize the facade by creating the shared OrchestratorBundle.
   * Must be called before any other method.
   *
   * Throws descriptive error on failure identifying the failing component
   * (EC-SDK-011).
   */
  async initialize(projectRoot: string): Promise<void> {
    this.projectRoot = projectRoot;
    try {
      const cli = await this.loadCli();
      this.bundle = await cli.createSequentialOrchestrator();
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (msg.includes('agent') || msg.includes('Agent')) {
        throw new Error(`PipelinePromptFacade.initialize failed — agent registry/loader error: ${msg}`);
      }
      if (msg.includes('database') || msg.includes('Database') || msg.includes('sqlite')) {
        throw new Error(`PipelinePromptFacade.initialize failed — database connection error: ${msg}`);
      }
      if (msg.includes('DAG') || msg.includes('dependency') || msg.includes('cycle')) {
        throw new Error(`PipelinePromptFacade.initialize failed — DAG builder error: ${msg}`);
      }
      throw new Error(`PipelinePromptFacade.initialize failed — orchestrator creation error: ${msg}`);
    }
  }

  /**
   * Start a new pipeline session. Calls batch-learn (first), stores hook context,
   * cleans stale output dirs, initializes RLM, returns first agent with
   * all 11 augmentation layers applied.
   */
  async initSession(taskDescription: string): Promise<InitSessionResult> {
    this.ensureInitialized();
    const cli = await this.loadCli();

    // init() handles: batch-learn (first), hook context, output dir cleanup,
    // RLM init, pipeline_started event. Passing bundle avoids cold start.
    const result = await cli.init(taskDescription, this.bundle!);

    if (result.status === 'complete') {
      throw new Error('Pipeline returned complete immediately — task may not be complex enough for pipeline mode');
    }

    const agent = result.agent as { key: string; prompt: string; model: string };
    const progress = result.progress as ProgressInfo;
    const sessionId = result.sessionId as string;

    const phase = await this.readCurrentPhase(sessionId);

    return {
      sessionId,
      firstAgent: {
        key: agent.key,
        prompt: agent.prompt,
        model: agent.model as AgentInfo['model'],
        phase,
      },
      progress,
    };
  }

  /**
   * Get the next agent with all 11 augmentation layers applied.
   * Calls orchestrator.getNextBatch() (the state machine) and applies
   * all enrichments (RLM, DESC, SONA, PatternMatcher, Reflexion,
   * Sherlock verdicts, Sherlock forensic, algorithm, 120K cap).
   */
  async getNextAgent(sessionId: string): Promise<NextAgentResult | PipelineCompleteResult> {
    this.ensureInitialized();
    const cli = await this.loadCli();

    // next() applies all 11 augmentation layers and emits agent_started.
    const result = await cli.next(sessionId, this.bundle!);

    if (result.status === 'complete') {
      return { status: 'complete' };
    }

    const agent = result.agent as { key: string; prompt: string; model: string };
    const progress = result.progress as ProgressInfo;

    const phase = await this.readCurrentPhase(sessionId);
    const isLastAgent = progress.completed + 1 >= progress.total;

    return {
      status: 'running',
      agent: {
        key: agent.key,
        prompt: agent.prompt,
        model: agent.model as AgentInfo['model'],
        phase,
      },
      isLastAgent,
      progress,
    };
  }

  /**
   * Mark an agent as complete with quality scoring and memory storage.
   * Handles: double-completion guard, CodingQualityCalculator, markBatchComplete,
   * DESC episode, SONA trajectory, RLM context, LEANN indexing (Phase 4+ only),
   * XP, ObservabilityBus events.
   *
   * CRITICAL: markBatchComplete() is NOT idempotent (spike T15).
   * The double-completion guard checks completedAgents BEFORE any side effects.
   */
  async processCompletion(
    sessionId: string,
    agentKey: string,
    outputFilePath: string,
  ): Promise<CompletionResult> {
    this.ensureInitialized();
    const cli = await this.loadCli();

    // Read phase BEFORE complete() calls markBatchComplete (which advances state)
    const phase = await this.readCurrentPhase(sessionId);

    const result = await cli.complete(sessionId, agentKey, { file: outputFilePath }, this.bundle!);

    const quality = ((result.quality as { score?: number })?.score) ?? 0;
    const xp = ((result.xp as { earned?: number })?.earned) ?? 0;
    const skipped = (result.skipped as boolean) ?? false;

    return { quality, xp, phase, skipped };
  }

  /**
   * Restore from a crash by re-initializing the orchestrator.
   *
   * CRITICAL (spike T15): markBatchComplete() is NOT idempotent.
   * This method NEVER calls markBatchComplete(). Instead, it relies on
   * getNextBatch() reading session JSON from disk on every call
   * (confirmed at line 752 of coding-pipeline-orchestrator.ts).
   *
   * A fresh orchestrator + existing session JSON = correct state.
   */
  async restoreFromCheckpoint(sessionId: string): Promise<void> {
    const sessionJson = await this.readSessionJson(sessionId);
    if (!sessionJson) {
      throw new Error(`Cannot restore session ${sessionId} — session file missing or corrupt`);
    }

    // Re-initialize orchestrator (fresh bundle, no replayed state)
    await this.initialize(this.projectRoot);

    console.error(`[FACADE] Restored from checkpoint for session ${sessionId} — ` +
      `${(sessionJson.completedAgents as unknown[])?.length ?? 0} agents already completed`);
  }

  /**
   * Check whether all agents in a given phase have completed.
   * Used by SDK runner to detect phase boundaries for Sherlock reviewer spawning.
   */
  async isPhaseComplete(sessionId: string, phase: number): Promise<boolean> {
    const { promises: fsP } = await import('fs');
    try {
      const sessionPath = path.join(this.projectRoot, '.god-agent', 'coding-sessions', `${sessionId}.json`);
      const raw = await fsP.readFile(sessionPath, 'utf-8');
      const session = JSON.parse(raw);
      const completedKeys = ((session.completedAgents || []) as Array<string | { agentKey: string }>)
        .map(a => typeof a === 'string' ? a : a.agentKey);

      const phaseAgents = await this.getAgentKeysForPhase(phase);
      return phaseAgents.every(key => completedKeys.includes(key));
    } catch {
      return false;
    }
  }

  /**
   * Shut down the orchestrator and release resources.
   */
  async shutdown(): Promise<void> {
    if (this.bundle) {
      try {
        await (this.bundle.godAgent as unknown as { shutdown?: () => Promise<void> }).shutdown?.();
      } catch { /* best effort */ }
      this.bundle = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.bundle) {
      throw new Error('PipelinePromptFacade not initialized — call initialize() first');
    }
  }

  /**
   * Dynamic import of the CLI module. Uses the canonical exported
   * createSequentialOrchestrator — no local duplication.
   */
  private async loadCli(): Promise<CliModule> {
    return await import('./coding-pipeline-cli.js');
  }

  private async readCurrentPhase(sessionId: string): Promise<number> {
    const { promises: fsP } = await import('fs');
    try {
      const sessionPath = path.join(this.projectRoot, '.god-agent', 'coding-sessions', `${sessionId}.json`);
      const raw = await fsP.readFile(sessionPath, 'utf-8');
      const session = JSON.parse(raw);
      return ((session.currentPhaseIndex as number) ?? 0) + 1;
    } catch {
      return 1;
    }
  }

  /**
   * Read session JSON with .bak fallback for corrupt files (EC-SDK-003).
   */
  async readSessionJson(sessionId: string): Promise<Record<string, unknown> | null> {
    const { promises: fsP } = await import('fs');
    const { existsSync } = await import('fs');
    const sessionPath = path.join(this.projectRoot, '.god-agent', 'coding-sessions', `${sessionId}.json`);

    // Try primary file
    try {
      const raw = await fsP.readFile(sessionPath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[FACADE] Primary session file unreadable: ${(err as Error).message}`);
    }

    // Try .bak fallback
    const bakPath = sessionPath + '.bak';
    if (existsSync(bakPath)) {
      try {
        const raw = await fsP.readFile(bakPath, 'utf-8');
        const parsed = JSON.parse(raw);
        console.error(`[FACADE] Using .bak fallback for session ${sessionId} (may be 1 agent behind)`);
        return parsed;
      } catch (bakErr) {
        console.error(`[FACADE] .bak file also corrupt: ${(bakErr as Error).message}`);
      }
    }

    return null;
  }

  /**
   * Get agent keys belonging to a specific phase.
   */
  private async getAgentKeysForPhase(phase: number): Promise<string[]> {
    try {
      if (phase <= 3) {
        const mod = await import('../core/pipeline/coding-pipeline-agents-phase1-3.js');
        const phases = (mod as unknown as { CODING_PHASES?: Array<{ agents: Array<{ key: string }> }> }).CODING_PHASES;
        if (phases && phases[phase - 1]) {
          return phases[phase - 1].agents
            .map(a => a.key)
            .filter(k => !k.includes('reviewer'));
        }
      } else {
        const mod = await import('../core/pipeline/coding-pipeline-agents-phase4-7.js');
        const phases = (mod as unknown as { CODING_PHASES_4_7?: Array<{ agents: Array<{ key: string }> }> }).CODING_PHASES_4_7;
        const idx = phase - 4;
        if (phases && phases[idx]) {
          return phases[idx].agents
            .map(a => a.key)
            .filter(k => !k.includes('reviewer'));
        }
      }
    } catch { /* fall through */ }
    return [];
  }
}
