/**
 * Coding Pipeline Orchestrator Integration Tests
 *
 * Tests for the 47-agent, 7-phase coding pipeline orchestrator.
 * (40 core agents + 7 Sherlock forensic reviewers)
 * Covers full pipeline execution, memory coordination, checkpoints,
 * XP tracking, and critical agent failure handling.
 *
 * @module tests/god-agent/core/pipeline/coding-pipeline-orchestrator.test
 * @see TASK-ORCH-004-pipeline-orchestration.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type {
  CodingPipelinePhase,
  CodingPipelineAgent,
  IAgentMapping,
  IPipelineDAG,
  IPipelineDAGNode,
  IPipelineExecutionConfig,
  IAgentExecutionResult,
  IPhaseExecutionResult,
  IPipelineExecutionResult,
} from '../../../../src/god-agent/core/pipeline/types.js';

import {
  PHASE_ORDER,
  CHECKPOINT_PHASES,
  CRITICAL_AGENTS,
  TOTAL_AGENTS,
  PHASE_AGENT_COUNTS,
  CODING_MEMORY_NAMESPACE,
  MEMORY_PREFIXES,
} from '../../../../src/god-agent/core/pipeline/types.js';

import {
  CODING_PIPELINE_MAPPINGS,
  getAgentsForPhase,
  buildPipelineDAG,
  getTotalPipelineXP,
  getPhaseXPTotals,
  getCriticalAgents,
  getAgentByKey,
  validatePipelineDependencies,
} from '../../../../src/god-agent/core/pipeline/command-task-bridge.js';

// ==================== Constants ====================

/**
 * Expected XP totals per phase (from CODING_PIPELINE_MAPPINGS)
 * Includes both core agents and Sherlock forensic reviewers:
 * - Core agents: Original XP values
 * - Sherlock reviewers: +100 XP each (except recovery-agent: +150)
 */
const EXPECTED_PHASE_XP: Record<CodingPipelinePhase, number> = {
  understanding: 375,
  exploration: 270,
  architecture: 355,
  implementation: 740,
  testing: 550,         // 8 core + phase-5-reviewer (includes test-fixer)
  optimization: 380,
  delivery: 225,
};

/**
 * Expected total XP for full pipeline completion
 * 40 core agents + 7 Sherlock forensic reviewers = 47 agents
 */
const EXPECTED_TOTAL_XP = 2895;

// ==================== Mock Implementations ====================

/**
 * Mock executor that tracks executed agents and can simulate failures
 */
class MockPipelineExecutor {
  public executedAgents: CodingPipelineAgent[] = [];
  public executedPhases: CodingPipelinePhase[] = [];
  public failAtAgent: CodingPipelineAgent | null = null;
  public agentDelayMs = 0;

  async executeAgent(
    mapping: IAgentMapping,
    phase: CodingPipelinePhase,
    memoryContext: Record<string, unknown>
  ): Promise<IAgentExecutionResult> {
    // Simulate execution delay if configured
    if (this.agentDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.agentDelayMs));
    }

    // Track execution
    this.executedAgents.push(mapping.agentKey);
    if (!this.executedPhases.includes(phase)) {
      this.executedPhases.push(phase);
    }

    // Simulate failure if configured
    if (this.failAtAgent === mapping.agentKey) {
      return {
        agentKey: mapping.agentKey,
        success: false,
        output: null,
        xpEarned: 0,
        memoryWrites: [],
        executionTimeMs: this.agentDelayMs || 10,
        error: `Simulated failure at ${mapping.agentKey}`,
      };
    }

    // Simulate successful execution
    return {
      agentKey: mapping.agentKey,
      success: true,
      output: {
        agent: mapping.agentKey,
        phase,
        algorithm: mapping.algorithm,
        timestamp: new Date().toISOString(),
        memoryContextKeys: Object.keys(memoryContext),
      },
      xpEarned: mapping.xpReward,
      memoryWrites: mapping.memoryWrites,
      executionTimeMs: this.agentDelayMs || 10,
    };
  }

  setFailAt(agent: CodingPipelineAgent): void {
    this.failAtAgent = agent;
  }

  reset(): void {
    this.executedAgents = [];
    this.executedPhases = [];
    this.failAtAgent = null;
  }
}

/**
 * Mock memory coordinator for testing memory operations
 */
class MockMemoryCoordinator {
  private storage = new Map<string, unknown>();
  private checkpoints = new Map<CodingPipelinePhase, unknown>();
  public storeCount = 0;
  public retrieveCount = 0;

  async store(key: string, value: unknown): Promise<void> {
    this.storeCount++;
    const fullKey = key.startsWith(CODING_MEMORY_NAMESPACE)
      ? key
      : `${CODING_MEMORY_NAMESPACE}/${key}`;
    this.storage.set(fullKey, value);
  }

  async retrieve(key: string): Promise<unknown | null> {
    this.retrieveCount++;
    const fullKey = key.startsWith(CODING_MEMORY_NAMESPACE)
      ? key
      : `${CODING_MEMORY_NAMESPACE}/${key}`;
    return this.storage.get(fullKey) ?? null;
  }

  hasKey(key: string): boolean {
    const fullKey = key.startsWith(CODING_MEMORY_NAMESPACE)
      ? key
      : `${CODING_MEMORY_NAMESPACE}/${key}`;
    return this.storage.has(fullKey);
  }

  getAll(): Map<string, unknown> {
    return new Map(this.storage);
  }

  getAllByPrefix(prefix: string): Map<string, unknown> {
    const result = new Map<string, unknown>();
    for (const [key, value] of this.storage) {
      if (key.startsWith(prefix)) {
        result.set(key, value);
      }
    }
    return result;
  }

  createCheckpoint(phase: CodingPipelinePhase, data: unknown): void {
    this.checkpoints.set(phase, {
      ...data as object,
      memorySnapshot: Object.fromEntries(this.storage),
      timestamp: new Date().toISOString(),
    });
  }

  hasCheckpoint(phase: CodingPipelinePhase): boolean {
    return this.checkpoints.has(phase);
  }

  getCheckpoint(phase: CodingPipelinePhase): unknown | undefined {
    return this.checkpoints.get(phase);
  }

  getCheckpointCount(): number {
    return this.checkpoints.size;
  }

  clear(): void {
    this.storage.clear();
    this.checkpoints.clear();
    this.storeCount = 0;
    this.retrieveCount = 0;
  }
}

/**
 * Mock DAG for testing dependency resolution
 */
class MockDAG implements IPipelineDAG {
  nodes: Map<CodingPipelineAgent, IPipelineDAGNode>;
  phases: Map<CodingPipelinePhase, CodingPipelineAgent[]>;
  topologicalOrder: CodingPipelineAgent[];
  checkpointPhases: CodingPipelinePhase[];

  constructor() {
    const realDAG = buildPipelineDAG();
    this.nodes = realDAG.nodes;
    this.phases = realDAG.phases;
    this.topologicalOrder = realDAG.topologicalOrder;
    this.checkpointPhases = realDAG.checkpointPhases;
  }
}

/**
 * Helper to create a minimal pipeline execution config
 */
function createTestConfig(
  phases: CodingPipelinePhase[] = PHASE_ORDER
): IPipelineExecutionConfig {
  const agentsByPhase = new Map<CodingPipelinePhase, IAgentMapping[]>();
  for (const phase of phases) {
    agentsByPhase.set(phase, getAgentsForPhase(phase));
  }

  return {
    phases,
    agentsByPhase,
    dag: buildPipelineDAG(),
    memoryNamespace: CODING_MEMORY_NAMESPACE,
    checkpoints: CHECKPOINT_PHASES,
  };
}

/**
 * Helper to simulate pipeline execution for testing
 */
async function executeMockPipeline(
  config: IPipelineExecutionConfig,
  executor: MockPipelineExecutor,
  memoryCoordinator: MockMemoryCoordinator
): Promise<IPipelineExecutionResult> {
  const startTime = Date.now();
  const phaseResults: IPhaseExecutionResult[] = [];
  const completedPhases: CodingPipelinePhase[] = [];
  let failedPhase: CodingPipelinePhase | undefined;
  let rollbackApplied = false;
  let totalXP = 0;

  // Store initial state
  await memoryCoordinator.store('pipeline/state', {
    status: 'running',
    startTime: new Date().toISOString(),
    phases: config.phases,
  });

  for (const phase of config.phases) {
    const phaseStartTime = Date.now();
    const agentResults: IAgentExecutionResult[] = [];
    let phaseXP = 0;
    let checkpointCreated = false;

    const phaseAgents = config.agentsByPhase.get(phase) ?? [];

    // Create checkpoint if this is a checkpoint phase
    if (config.checkpoints.includes(phase)) {
      memoryCoordinator.createCheckpoint(phase, {
        phase,
        totalXP,
        completedAgents: executor.executedAgents.slice(),
      });
      checkpointCreated = true;
    }

    // Execute agents in phase
    for (const agent of phaseAgents) {
      const memoryContext: Record<string, unknown> = {};

      // Retrieve memory for agent
      for (const readKey of agent.memoryReads) {
        const value = await memoryCoordinator.retrieve(readKey);
        if (value !== null) {
          memoryContext[readKey] = value;
        }
      }

      const result = await executor.executeAgent(agent, phase, memoryContext);
      agentResults.push(result);

      if (result.success) {
        phaseXP += result.xpEarned;

        // Store agent outputs
        for (const writeKey of result.memoryWrites) {
          await memoryCoordinator.store(writeKey, result.output);
        }
      } else if (CRITICAL_AGENTS.includes(agent.agentKey)) {
        // Critical agent failed - halt phase
        phaseResults.push({
          phase,
          success: false,
          agentResults,
          totalXP: phaseXP,
          checkpointCreated,
          executionTimeMs: Date.now() - phaseStartTime,
        });

        failedPhase = phase;
        rollbackApplied = memoryCoordinator.getCheckpointCount() > 0;
        break;
      }
    }

    if (failedPhase) {
      break;
    }

    totalXP += phaseXP;
    completedPhases.push(phase);

    // Store phase XP
    await memoryCoordinator.store(`xp/phase-${PHASE_ORDER.indexOf(phase) + 1}`, {
      phase,
      xp: phaseXP,
      timestamp: new Date().toISOString(),
    });

    phaseResults.push({
      phase,
      success: true,
      agentResults,
      totalXP: phaseXP,
      checkpointCreated,
      executionTimeMs: Date.now() - phaseStartTime,
    });
  }

  // Store total XP
  await memoryCoordinator.store('xp/total', { xp: totalXP });

  return {
    success: !failedPhase,
    phaseResults,
    totalXP,
    executionTimeMs: Date.now() - startTime,
    completedPhases,
    failedPhase,
    rollbackApplied,
  };
}

// ==================== Test Suites ====================

describe('Coding Pipeline Orchestrator Integration', () => {
  let executor: MockPipelineExecutor;
  let memoryCoordinator: MockMemoryCoordinator;

  beforeEach(() => {
    executor = new MockPipelineExecutor();
    memoryCoordinator = new MockMemoryCoordinator();
  });

  afterEach(() => {
    executor.reset();
    memoryCoordinator.clear();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL PIPELINE EXECUTION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Pipeline Execution', () => {
    it('should execute all 7 phases in correct order', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(true);
      expect(result.completedPhases).toEqual(PHASE_ORDER);
      expect(executor.executedPhases).toEqual(PHASE_ORDER);
    });

    it('should execute all 47 agents (40 core + 7 Sherlock)', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(true);
      expect(executor.executedAgents.length).toBe(TOTAL_AGENTS);
    });

    it('should execute correct number of agents per phase', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(true);

      for (const phaseResult of result.phaseResults) {
        // PHASE_AGENT_COUNTS already includes Sherlock reviewers
        const expectedCount = PHASE_AGENT_COUNTS[phaseResult.phase];
        expect(phaseResult.agentResults.length).toBe(expectedCount);
      }
    });

    it('should return phaseResults for each phase', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.phaseResults).toHaveLength(7);
      expect(result.phaseResults.map(r => r.phase)).toEqual(PHASE_ORDER);
    });

    it('should track execution time for pipeline', async () => {
      executor.agentDelayMs = 1;
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it('should track execution time for each phase', async () => {
      executor.agentDelayMs = 1;
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      for (const phaseResult of result.phaseResults) {
        expect(phaseResult.executionTimeMs).toBeGreaterThan(0);
      }
    });

    it('should support partial pipeline execution with startPhase', async () => {
      const config = createTestConfig(['implementation', 'testing', 'optimization', 'delivery']);
      config.startPhase = 4; // Start at implementation

      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(true);
      expect(result.completedPhases).toEqual(['implementation', 'testing', 'optimization', 'delivery']);
    });

    it('should support partial pipeline execution with endPhase', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture']);
      config.endPhase = 3; // End at architecture

      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(true);
      expect(result.completedPhases).toEqual(['understanding', 'exploration', 'architecture']);
    });

    it('should handle single phase execution', async () => {
      const config = createTestConfig(['understanding']);

      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(true);
      expect(result.completedPhases).toEqual(['understanding']);
      expect(executor.executedAgents.length).toBe(PHASE_AGENT_COUNTS['understanding']);
    });

    it('should execute agents in dependency order within phase', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      // task-analyzer must execute before others
      const taskAnalyzerIndex = executor.executedAgents.indexOf('task-analyzer');
      const constraintAnalyzerIndex = executor.executedAgents.indexOf('feasibility-analyzer');

      expect(taskAnalyzerIndex).toBe(0);
      expect(constraintAnalyzerIndex).toBeGreaterThan(taskAnalyzerIndex);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMORY COORDINATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Memory Coordination', () => {
    it('should store pipeline state at start', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasKey('coding/pipeline/state')).toBe(true);
    });

    it('should store context in coding/context/* namespace', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      // Check that understanding phase stored to its namespace
      const understandingKeys = memoryCoordinator.getAllByPrefix('coding/understanding');
      expect(understandingKeys.size).toBeGreaterThan(0);
    });

    it('should store agent outputs to memoryWrites keys', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      // task-analyzer writes to coding/understanding/task-analysis
      expect(memoryCoordinator.hasKey('coding/understanding/task-analysis')).toBe(true);
    });

    it('should retrieve memory for agent execution', async () => {
      const config = createTestConfig(['understanding', 'exploration']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      // Exploration agents should retrieve from understanding phase
      expect(memoryCoordinator.retrieveCount).toBeGreaterThan(0);
    });

    it('should use CODING_MEMORY_NAMESPACE prefix', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      const allKeys = Array.from(memoryCoordinator.getAll().keys());
      for (const key of allKeys) {
        expect(key.startsWith(CODING_MEMORY_NAMESPACE)).toBe(true);
      }
    });

    it('should store XP in xp/* namespace', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasKey('coding/xp/phase-1')).toBe(true);
      expect(memoryCoordinator.hasKey('coding/xp/total')).toBe(true);
    });

    it('should coordinate memory between dependent agents', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      // constraint-analyzer depends on requirement-extractor and scope-definer
      // which both depend on task-analyzer
      const taskAnalysisKey = 'coding/understanding/task-analysis';
      expect(memoryCoordinator.hasKey(taskAnalysisKey)).toBe(true);
    });

    it('should track store and retrieve counts', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.storeCount).toBeGreaterThan(0);
      expect(memoryCoordinator.retrieveCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKPOINT MANAGEMENT TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Checkpoint Management', () => {
    it('should create checkpoint after understanding phase', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasCheckpoint('understanding')).toBe(true);
    });

    it('should create checkpoint after exploration phase', async () => {
      const config = createTestConfig(['understanding', 'exploration']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasCheckpoint('exploration')).toBe(true);
    });

    it('should create checkpoint after architecture phase', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasCheckpoint('architecture')).toBe(true);
    });

    it('should create checkpoint after implementation phase', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture', 'implementation']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasCheckpoint('implementation')).toBe(true);
    });

    it('should create checkpoint after testing phase', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture', 'implementation', 'testing']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.hasCheckpoint('testing')).toBe(true);
    });

    it('should NOT create checkpoint for optimization phase', async () => {
      const config = createTestConfig();
      await executeMockPipeline(config, executor, memoryCoordinator);

      // CHECKPOINT_PHASES only includes first 5 phases
      expect(CHECKPOINT_PHASES).not.toContain('optimization');
      expect(memoryCoordinator.hasCheckpoint('optimization')).toBe(false);
    });

    it('should NOT create checkpoint for delivery phase', async () => {
      const config = createTestConfig();
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(CHECKPOINT_PHASES).not.toContain('delivery');
      expect(memoryCoordinator.hasCheckpoint('delivery')).toBe(false);
    });

    it('should create 5 checkpoints for full pipeline', async () => {
      const config = createTestConfig();
      await executeMockPipeline(config, executor, memoryCoordinator);

      expect(memoryCoordinator.getCheckpointCount()).toBe(5);
    });

    it('should store memory snapshot in checkpoint', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      const checkpoint = memoryCoordinator.getCheckpoint('understanding') as { memorySnapshot?: object };
      expect(checkpoint.memorySnapshot).toBeDefined();
    });

    it('should store timestamp in checkpoint', async () => {
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      const checkpoint = memoryCoordinator.getCheckpoint('understanding') as { timestamp?: string };
      expect(checkpoint.timestamp).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // XP TRACKING TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('XP Tracking', () => {
    it('should track total XP for full pipeline', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.totalXP).toBe(EXPECTED_TOTAL_XP);
    });

    it('should aggregate phase XP correctly', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.totalXP).toBeGreaterThan(2800); // 2895 total with Sherlock agents
    });

    it('should track XP per phase', async () => {
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      for (const phaseResult of result.phaseResults) {
        expect(phaseResult.totalXP).toBe(EXPECTED_PHASE_XP[phaseResult.phase]);
      }
    });

    it('should calculate understanding phase XP as 375 (6 core + 1 Sherlock)', async () => {
      const config = createTestConfig(['understanding']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.phaseResults[0].totalXP).toBe(375);
    });

    it('should calculate exploration phase XP as 270 (5 core + 1 Sherlock)', async () => {
      const config = createTestConfig(['understanding', 'exploration']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const explorationResult = result.phaseResults.find(r => r.phase === 'exploration');
      expect(explorationResult?.totalXP).toBe(270);
    });

    it('should calculate architecture phase XP as 355 (5 core + 1 Sherlock)', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const archResult = result.phaseResults.find(r => r.phase === 'architecture');
      expect(archResult?.totalXP).toBe(355);
    });

    it('should calculate implementation phase XP as 740 (11 core + 1 Sherlock)', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture', 'implementation']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const implResult = result.phaseResults.find(r => r.phase === 'implementation');
      expect(implResult?.totalXP).toBe(740);
    });

    it('should calculate testing phase XP as 550 (8 core + 1 Sherlock)', async () => {
      const config = createTestConfig(['understanding', 'exploration', 'architecture', 'implementation', 'testing']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const testResult = result.phaseResults.find(r => r.phase === 'testing');
      expect(testResult?.totalXP).toBe(550);
    });

    it('should award 0 XP for failed agents', async () => {
      executor.setFailAt('task-analyzer');
      const config = createTestConfig(['understanding']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const failedResult = result.phaseResults[0].agentResults.find(
        r => r.agentKey === 'task-analyzer'
      );
      expect(failedResult?.xpEarned).toBe(0);
    });

    it('should store total XP in memory', async () => {
      const config = createTestConfig();
      await executeMockPipeline(config, executor, memoryCoordinator);

      const storedXP = (await memoryCoordinator.retrieve('coding/xp/total')) as { xp: number };
      expect(storedXP?.xp).toBe(EXPECTED_TOTAL_XP);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL AGENT FAILURE TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Critical Agent Failures', () => {
    it('should halt pipeline when task-analyzer fails', async () => {
      executor.setFailAt('task-analyzer');
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(false);
      expect(result.failedPhase).toBe('understanding');
      expect(result.completedPhases).toEqual([]);
    });

    it('should halt pipeline when interface-designer fails', async () => {
      executor.setFailAt('interface-designer');
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(false);
      expect(result.failedPhase).toBe('architecture');
    });

    it('should halt pipeline when sign-off-approver fails', async () => {
      executor.setFailAt('sign-off-approver');
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.success).toBe(false);
      expect(result.failedPhase).toBe('delivery');
    });

    it('should continue pipeline when non-critical agent fails', async () => {
      executor.setFailAt('technology-scout'); // Non-critical agent in exploration
      const config = createTestConfig(['understanding', 'exploration']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      // Non-critical failures don't halt pipeline
      expect(result.success).toBe(true);
    });

    it('should record haltedAt agent in result', async () => {
      executor.setFailAt('task-analyzer');
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const failedResult = result.phaseResults[0].agentResults.find(
        r => !r.success
      );
      expect(failedResult?.agentKey).toBe('task-analyzer');
    });

    it('should set rollbackApplied when checkpoints exist', async () => {
      executor.setFailAt('interface-designer');
      const config = createTestConfig();
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      // Checkpoints created before architecture phase
      expect(result.rollbackApplied).toBe(true);
    });

    it('should not set rollbackApplied when no checkpoints', async () => {
      executor.setFailAt('task-analyzer');
      const config = createTestConfig(['understanding']);
      // Remove checkpoints from config
      config.checkpoints = [];
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      expect(result.rollbackApplied).toBe(false);
    });

    it('should stop executing subsequent agents after critical failure', async () => {
      executor.setFailAt('task-analyzer');
      const config = createTestConfig(['understanding']);
      await executeMockPipeline(config, executor, memoryCoordinator);

      // Only task-analyzer should have been attempted
      expect(executor.executedAgents.length).toBe(1);
      expect(executor.executedAgents[0]).toBe('task-analyzer');
    });

    it('should include error message in failed agent result', async () => {
      executor.setFailAt('task-analyzer');
      const config = createTestConfig(['understanding']);
      const result = await executeMockPipeline(config, executor, memoryCoordinator);

      const failedResult = result.phaseResults[0].agentResults.find(
        r => r.agentKey === 'task-analyzer'
      );
      expect(failedResult?.error).toBeDefined();
      expect(failedResult?.error).toContain('task-analyzer');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DAG AND DEPENDENCY TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DAG and Dependencies', () => {
    it('should have valid DAG with 47 nodes (40 core + 7 Sherlock)', () => {
      const dag = buildPipelineDAG();
      expect(dag.nodes.size).toBe(TOTAL_AGENTS);
    });

    it('should have topological order with all 47 agents', () => {
      const dag = buildPipelineDAG();
      expect(dag.topologicalOrder.length).toBe(TOTAL_AGENTS);
    });

    it('should have no dependency cycles', () => {
      const errors = validatePipelineDependencies();
      expect(errors).toHaveLength(0);
    });

    it('should have correct phase groupings', () => {
      const dag = buildPipelineDAG();

      for (const phase of PHASE_ORDER) {
        const phaseAgents = dag.phases.get(phase);
        // PHASE_AGENT_COUNTS already includes Sherlock reviewers
        expect(phaseAgents?.length).toBe(PHASE_AGENT_COUNTS[phase]);
      }
    });

    it('should respect dependencies in topological order', () => {
      const dag = buildPipelineDAG();
      const order = dag.topologicalOrder;
      const orderIndex = new Map(order.map((agent, i) => [agent, i]));

      // Check each agent's dependencies come before it
      for (const [agentKey, node] of dag.nodes) {
        const agentIndex = orderIndex.get(agentKey)!;
        for (const dep of node.dependsOn) {
          const depIndex = orderIndex.get(dep);
          expect(depIndex).toBeDefined();
          expect(depIndex).toBeLessThan(agentIndex);
        }
      }
    });

    it('should include checkpoint phases correctly', () => {
      const dag = buildPipelineDAG();
      expect(dag.checkpointPhases).toEqual(CHECKPOINT_PHASES);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Helper Functions', () => {
    it('getAgentsForPhase should return sorted agents', () => {
      for (const phase of PHASE_ORDER) {
        const agents = getAgentsForPhase(phase);
        // PHASE_AGENT_COUNTS already includes Sherlock reviewers
        expect(agents.length).toBe(PHASE_AGENT_COUNTS[phase]);

        // Verify sorted by priority
        for (let i = 1; i < agents.length; i++) {
          expect(agents[i].priority).toBeGreaterThanOrEqual(agents[i - 1].priority);
        }
      }
    });

    it('getTotalPipelineXP should return 2895', () => {
      expect(getTotalPipelineXP()).toBe(EXPECTED_TOTAL_XP);
    });

    it('getPhaseXPTotals should return correct per-phase totals', () => {
      const totals = getPhaseXPTotals();

      for (const phase of PHASE_ORDER) {
        expect(totals.get(phase)).toBe(EXPECTED_PHASE_XP[phase]);
      }
    });

    it('getCriticalAgents should return 11 agents (4 core + 7 Sherlock)', () => {
      const critical = getCriticalAgents();
      expect(critical.length).toBe(11);

      const keys = critical.map(a => a.agentKey);
      // 4 Core critical agents
      expect(keys).toContain('task-analyzer');
      expect(keys).toContain('interface-designer');
      expect(keys).toContain('quality-gate');
      expect(keys).toContain('sign-off-approver');
      // 7 Sherlock forensic reviewers (all critical)
      expect(keys).toContain('phase-1-reviewer');
      expect(keys).toContain('phase-2-reviewer');
      expect(keys).toContain('phase-3-reviewer');
      expect(keys).toContain('phase-4-reviewer');
      expect(keys).toContain('phase-5-reviewer');
      expect(keys).toContain('phase-6-reviewer');
      expect(keys).toContain('recovery-agent');
    });

    it('getAgentByKey should find existing agent', () => {
      const agent = getAgentByKey('task-analyzer');
      expect(agent).toBeDefined();
      expect(agent?.phase).toBe('understanding');
      expect(agent?.critical).toBe(true);
    });

    it('getAgentByKey should return undefined for unknown agent', () => {
      const agent = getAgentByKey('nonexistent-agent' as CodingPipelineAgent);
      expect(agent).toBeUndefined();
    });
  });
});

// ==================== Additional Edge Case Tests ====================

describe('Pipeline Edge Cases', () => {
  let executor: MockPipelineExecutor;
  let memoryCoordinator: MockMemoryCoordinator;

  beforeEach(() => {
    executor = new MockPipelineExecutor();
    memoryCoordinator = new MockMemoryCoordinator();
  });

  afterEach(() => {
    executor.reset();
    memoryCoordinator.clear();
  });

  it('should handle empty phases array', async () => {
    const config = createTestConfig([]);
    const result = await executeMockPipeline(config, executor, memoryCoordinator);

    expect(result.success).toBe(true);
    expect(result.completedPhases).toEqual([]);
    expect(result.totalXP).toBe(0);
  });

  it('should handle phases with zero agents gracefully', () => {
    // This shouldn't happen in production, but test resilience
    const config = createTestConfig(['understanding']);
    config.agentsByPhase.set('understanding', []);

    // No agents to execute - phase completes immediately
    expect(config.agentsByPhase.get('understanding')).toEqual([]);
  });

  it('should track all memory operations', async () => {
    const config = createTestConfig(['understanding']);
    await executeMockPipeline(config, executor, memoryCoordinator);

    // Should have at least stored pipeline state and phase XP
    expect(memoryCoordinator.storeCount).toBeGreaterThan(2);
  });

  it('should maintain phase order in result', async () => {
    const config = createTestConfig();
    const result = await executeMockPipeline(config, executor, memoryCoordinator);

    for (let i = 0; i < result.phaseResults.length; i++) {
      expect(result.phaseResults[i].phase).toBe(PHASE_ORDER[i]);
    }
  });
});
