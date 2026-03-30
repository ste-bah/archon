/**
 * Pipeline Progress Store
 *
 * In-memory store tracking every agent's lifecycle and output summary.
 * Enables situational awareness for parallel agent execution - concurrent
 * agents can see what peers have completed, what's currently running,
 * and what decisions/files are in play.
 *
 * @module src/god-agent/core/pipeline/pipeline-progress-store
 */

// =============================================================================
// TYPES
// =============================================================================

export type AgentStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface IAgentOutputSummary {
  /** Key decisions made by the agent */
  decisions: string[];
  /** Files created by the agent */
  filesCreated: string[];
  /** Files modified by the agent */
  filesModified: string[];
  /** Key findings or outputs */
  keyFindings: string[];
  /** Length of raw output */
  outputLength: number;
}

export interface IAgentProgress {
  /** Agent key identifier */
  agentKey: string;
  /** Phase this agent belongs to */
  phase: string;
  /** Current status */
  status: AgentStatus;
  /** Timestamp when agent started (ms) */
  startedAt?: number;
  /** Timestamp when agent completed (ms) */
  completedAt?: number;
  /** Duration in ms */
  duration?: number;
  /** Parsed output summary (populated on completion) */
  outputSummary?: IAgentOutputSummary;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// PROGRESS STORE
// =============================================================================

/**
 * Tracks agent lifecycle and output summaries during pipeline execution.
 * Thread-safe for concurrent reads (JS single-threaded event loop).
 */
export class PipelineProgressStore {
  private agents = new Map<string, IAgentProgress>();

  /**
   * Register an agent as pending before execution begins.
   */
  registerAgent(agentKey: string, phase: string): void {
    this.agents.set(agentKey, {
      agentKey,
      phase,
      status: 'pending',
    });
  }

  /**
   * Mark an agent as actively running.
   */
  markActive(agentKey: string): void {
    const agent = this.agents.get(agentKey);
    if (agent) {
      agent.status = 'active';
      agent.startedAt = Date.now();
    }
  }

  /**
   * Mark an agent as completed with its output summary.
   */
  markCompleted(agentKey: string, outputSummary: IAgentOutputSummary): void {
    const agent = this.agents.get(agentKey);
    if (agent) {
      agent.status = 'completed';
      agent.completedAt = Date.now();
      agent.duration = agent.startedAt
        ? agent.completedAt - agent.startedAt
        : undefined;
      agent.outputSummary = outputSummary;
    }
  }

  /**
   * Mark an agent as failed with error message.
   */
  markFailed(agentKey: string, error: string): void {
    const agent = this.agents.get(agentKey);
    if (agent) {
      agent.status = 'failed';
      agent.completedAt = Date.now();
      agent.duration = agent.startedAt
        ? agent.completedAt - agent.startedAt
        : undefined;
      agent.error = error;
    }
  }

  /**
   * Get a single agent's progress.
   */
  getAgent(agentKey: string): IAgentProgress | undefined {
    return this.agents.get(agentKey);
  }

  /**
   * Get all agents in a specific phase.
   */
  getByPhase(phase: string): IAgentProgress[] {
    return Array.from(this.agents.values()).filter(a => a.phase === phase);
  }

  /**
   * Get all currently active agents.
   */
  getActive(): IAgentProgress[] {
    return Array.from(this.agents.values()).filter(a => a.status === 'active');
  }

  /**
   * Get all completed agents.
   */
  getCompleted(): IAgentProgress[] {
    return Array.from(this.agents.values()).filter(
      a => a.status === 'completed'
    );
  }

  /**
   * Get full snapshot of all agents.
   */
  getSnapshot(): IAgentProgress[] {
    return Array.from(this.agents.values());
  }

  // ===========================================================================
  // OUTPUT PARSING
  // ===========================================================================

  /**
   * Extract a structured output summary from raw agent output.
   *
   * Looks for structured markers in the output:
   * - Lines starting with "Created:" or "File created:" -> filesCreated
   * - Lines starting with "Modified:" or "File modified:" -> filesModified
   * - Lines starting with "Decision:" -> decisions
   * - Lines starting with "Finding:" or "Key finding:" -> keyFindings
   *
   * Falls back to first 3 non-empty lines as keyFindings if no markers found.
   */
  static extractOutputSummary(rawOutput: string): IAgentOutputSummary {
    const lines = rawOutput.split('\n');
    const decisions: string[] = [];
    const filesCreated: string[] = [];
    const filesModified: string[] = [];
    const keyFindings: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const lower = trimmed.toLowerCase();

      if (lower.startsWith('created:') || lower.startsWith('file created:')) {
        filesCreated.push(trimmed.replace(/^(file )?created:\s*/i, ''));
      } else if (
        lower.startsWith('modified:') ||
        lower.startsWith('file modified:')
      ) {
        filesModified.push(trimmed.replace(/^(file )?modified:\s*/i, ''));
      } else if (lower.startsWith('decision:')) {
        decisions.push(trimmed.replace(/^decision:\s*/i, ''));
      } else if (
        lower.startsWith('finding:') ||
        lower.startsWith('key finding:')
      ) {
        keyFindings.push(trimmed.replace(/^(key )?finding:\s*/i, ''));
      }
    }

    // Fallback: if no structured markers found, use first 3 non-empty lines
    if (
      decisions.length === 0 &&
      filesCreated.length === 0 &&
      filesModified.length === 0 &&
      keyFindings.length === 0
    ) {
      const nonEmpty = lines.map(l => l.trim()).filter(l => l.length > 0);
      keyFindings.push(...nonEmpty.slice(0, 3));
    }

    return {
      decisions,
      filesCreated,
      filesModified,
      keyFindings,
      outputLength: rawOutput.length,
    };
  }
}
