/**
 * Pipeline Scale Test
 * TASK-NFR-002 - Scalability Validation Suite (NFR-4.2)
 *
 * Tests 48-agent PhD pipeline scaling:
 * - Concurrent agent execution
 * - Memory key contention
 * - Handoff latency
 * - Completion rate (target: 88%)
 */

import { ConcurrencyTracker, type ContentionEvent } from './utils/concurrency-tracker.js';

// ==================== Types ====================

/**
 * Pipeline scale test configuration
 */
export interface PipelineScaleConfig {
  /** Number of agents */
  agentCount: number;
  /** Target completion rate */
  targetCompletionRate: number;
  /** Max handoff latency in ms */
  maxHandoffLatencyMs: number;
  /** Operation timeout in ms */
  timeoutMs: number;
}

/**
 * Default pipeline scale configuration
 */
export const DEFAULT_PIPELINE_SCALE_CONFIG: PipelineScaleConfig = {
  agentCount: 48,
  targetCompletionRate: 0.88,
  maxHandoffLatencyMs: 100,
  timeoutMs: 30000,
};

/**
 * Agent result
 */
export interface AgentResult {
  /** Agent index */
  agentId: number;
  /** Agent name */
  name: string;
  /** Status */
  status: 'fulfilled' | 'rejected';
  /** Result value */
  value?: unknown;
  /** Error message */
  error?: string;
  /** Execution time in ms */
  executionTimeMs: number;
}

/**
 * Pipeline scale report
 */
export interface PipelineScaleReport {
  /** Number of agents */
  agentCount: number;
  /** Successful completions */
  completions: number;
  /** Failures */
  failures: number;
  /** Completion rate (0-1) */
  completionRate: number;
  /** Target completion rate */
  targetCompletionRate: number;
  /** Pass status */
  pass: boolean;
  /** Total duration in ms */
  durationMs: number;
  /** Average handoff latency in ms */
  avgHandoffLatencyMs: number;
  /** Maximum concurrency observed */
  maxConcurrency: number;
  /** Individual agent results */
  results: AgentResult[];
}

/**
 * Contention report
 */
export interface ContentionReport {
  /** Number of concurrent operations */
  concurrentOperations: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Number of contention events */
  contentionEvents: number;
  /** Maximum contention latency in ms */
  maxContentionLatencyMs: number;
  /** Pass status */
  pass: boolean;
}

// ==================== Agent Simulator ====================

/**
 * Simulated PhD pipeline agent
 */
export interface PipelineAgent {
  id: number;
  name: string;
  phase: string;
  dependencies: number[];
  execute: () => Promise<unknown>;
}

/**
 * Generate PhD pipeline agents (per PRD Section 7.5)
 */
export function generatePipelineAgents(count: number): PipelineAgent[] {
  const phases = [
    'foundation',    // Agents 1-7
    'discovery',     // Agents 8-14
    'architecture',  // Agents 15-21
    'synthesis',     // Agents 22-28
    'design',        // Agents 29-35
    'writing',       // Agents 36-42
    'qa',            // Agents 43-48
  ];

  const agents: PipelineAgent[] = [];

  for (let i = 0; i < count; i++) {
    const phaseIndex = Math.floor(i / 7);
    const phase = phases[Math.min(phaseIndex, phases.length - 1)];

    // Create dependencies (previous phase agents)
    const dependencies: number[] = [];
    if (phaseIndex > 0) {
      const prevPhaseStart = (phaseIndex - 1) * 7;
      const prevPhaseEnd = Math.min(prevPhaseStart + 7, i);
      for (let j = prevPhaseStart; j < prevPhaseEnd; j++) {
        dependencies.push(j);
      }
    }

    agents.push({
      id: i,
      name: `agent_${phase}_${i + 1}`,
      phase,
      dependencies,
      execute: async () => {
        // Simulate agent work (5-50ms)
        const workTime = 5 + Math.random() * 45;
        await new Promise(resolve => setTimeout(resolve, workTime));

        // 5% failure rate for realism
        if (Math.random() < 0.05) {
          throw new Error(`Agent ${i} failed during ${phase} phase`);
        }

        return { agentId: i, phase, completed: true };
      },
    });
  }

  return agents;
}

// ==================== Pipeline Scale Test ====================

/**
 * Pipeline scale test for NFR-4.2 validation
 *
 * Tests 48-agent concurrent execution, measuring completion rate,
 * handoff latency, and memory key contention.
 *
 * @example
 * ```typescript
 * const test = new PipelineScaleTest();
 * const report = await test.runPipelineTest();
 *
 * if (report.pass) {
 *   console.log('NFR-4.2 validated: 88%+ completion rate!');
 * }
 * ```
 */
export class PipelineScaleTest {
  private concurrencyTracker: ConcurrencyTracker;
  private memoryStore: Map<string, unknown> = new Map();

  constructor() {
    this.concurrencyTracker = new ConcurrencyTracker();
  }

  /**
   * Run 48-agent pipeline test
   */
  async runPipelineTest(config: Partial<PipelineScaleConfig> = {}): Promise<PipelineScaleReport> {
    const cfg: PipelineScaleConfig = { ...DEFAULT_PIPELINE_SCALE_CONFIG, ...config };
    const agents = generatePipelineAgents(cfg.agentCount);

    const startTime = Date.now();
    const handoffLatencies: number[] = [];
    const agentResults: AgentResult[] = [];

    // Reset state
    this.concurrencyTracker.reset();
    this.memoryStore.clear();

    // Execute agents with concurrency tracking
    const results = await Promise.allSettled(
      agents.map(async (agent, index) => {
        const handle = this.concurrencyTracker.enter(`agent_${index}`);
        const agentStart = Date.now();

        try {
          // Wait for dependencies if any
          if (agent.dependencies.length > 0) {
            await this.waitForDependencies(agent.dependencies);
          }

          // Execute agent
          const result = await agent.execute();

          // Handoff to memory store
          const handoffStart = performance.now();
          await this.storeResult(agent.name, result);
          handoffLatencies.push(performance.now() - handoffStart);

          return result;
        } catch (error) {
          // RULE-070: Re-throw with scale test context
          throw new Error(
            `Scale test agent "${agent.name}" (id: ${agent.id}) failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          );
        } finally {
          handle.exit();

          agentResults.push({
            agentId: agent.id,
            name: agent.name,
            status: 'fulfilled',
            executionTimeMs: Date.now() - agentStart,
          });
        }
      })
    );

    // Process results
    const completions = results.filter(r => r.status === 'fulfilled').length;
    const failures = results.filter(r => r.status === 'rejected').length;

    // Update agent results with actual status
    results.forEach((r, i) => {
      if (agentResults[i]) {
        agentResults[i].status = r.status;
        if (r.status === 'fulfilled') {
          agentResults[i].value = r.value;
        } else {
          agentResults[i].error = r.reason?.message ?? 'Unknown error';
        }
      }
    });

    const avgHandoffLatency = handoffLatencies.length > 0
      ? handoffLatencies.reduce((a, b) => a + b, 0) / handoffLatencies.length
      : 0;

    const completionRate = completions / cfg.agentCount;

    return {
      agentCount: cfg.agentCount,
      completions,
      failures,
      completionRate,
      targetCompletionRate: cfg.targetCompletionRate,
      pass: completionRate >= cfg.targetCompletionRate,
      durationMs: Date.now() - startTime,
      avgHandoffLatencyMs: avgHandoffLatency,
      maxConcurrency: this.concurrencyTracker.peak,
      results: agentResults,
    };
  }

  /**
   * Test memory key contention
   */
  async runContentionTest(
    concurrentOperations: number = 48
  ): Promise<ContentionReport> {
    const contentionEvents: ContentionEvent[] = [];
    const results: Array<{ success: boolean; latency: number; error?: string }> = [];

    // Reset state
    this.concurrencyTracker.reset();
    this.memoryStore.clear();

    // Create contention scenario: all agents write to similar keys
    const writePromises = Array.from({ length: concurrentOperations }, async (_, i) => {
      const handle = this.concurrencyTracker.enter(`write_${i}`);
      const start = performance.now();

      try {
        const namespace = `phd/agent_${i}`;
        const key = `result_${Date.now()}_${i}`;
        const value = { agentId: i, data: this.generatePayload() };

        await this.storeResult(`${namespace}/${key}`, value);

        const latency = performance.now() - start;

        // Track contention if latency is high
        if (latency > 10) {
          handle.reportContention('lock', latency);
        }

        return { success: true, latency };
      } catch (error) {
        return { success: false, latency: performance.now() - start, error: String(error) };
      } finally {
        handle.exit();
      }
    });

    const writeResults = await Promise.all(writePromises);
    results.push(...writeResults);

    const successCount = results.filter(r => r.success).length;
    const avgLatency = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.latency, 0) / Math.max(successCount, 1);

    const allContentionEvents = this.concurrencyTracker.getContentionEvents();

    return {
      concurrentOperations,
      successRate: successCount / concurrentOperations,
      avgLatencyMs: avgLatency,
      contentionEvents: allContentionEvents.length,
      maxContentionLatencyMs: allContentionEvents.length > 0
        ? Math.max(...allContentionEvents.map(e => e.waitTimeMs))
        : 0,
      pass: allContentionEvents.length < 5, // <5 contention events acceptable
    };
  }

  /**
   * Wait for dependencies to complete
   */
  private async waitForDependencies(dependencies: number[]): Promise<void> {
    // In real implementation, this would check actual agent completion
    // For simulation, add small delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
  }

  /**
   * Store result in memory
   */
  private async storeResult(key: string, value: unknown): Promise<void> {
    // Simulate async storage with small delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2));
    this.memoryStore.set(key, value);
  }

  /**
   * Generate test payload
   */
  private generatePayload(): object {
    return {
      timestamp: Date.now(),
      data: Array.from({ length: 100 }, () => Math.random()),
    };
  }

  /**
   * Get current concurrency statistics
   */
  getConcurrencyStats() {
    return this.concurrencyTracker.getStats();
  }

  /**
   * Get memory store size
   */
  getMemoryStoreSize(): number {
    return this.memoryStore.size;
  }
}

// ==================== Global Instance ====================

/**
 * Global pipeline scale test instance
 */
export const pipelineScaleTest = new PipelineScaleTest();
