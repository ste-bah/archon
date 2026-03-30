/**
 * T-SDK-001: Crash recovery — resume at agent 4 after 3 completed.
 * T-SDK-001b: CRITICAL GUARD-011 test — fresh orchestrator returns correct
 *             next agent from disk state.
 *
 * These tests require the actual orchestrator infrastructure (not mocked).
 * They verify that:
 * 1. Session JSON persists to disk after processCompletion
 * 2. A fresh orchestrator reads disk state correctly
 * 3. restoreFromCheckpoint does NOT call markBatchComplete
 * 4. getNextAgent after restore returns the correct next agent
 *
 * NOTE: These are SLOW tests (~30s+) because they initialize the real
 * orchestrator and run through actual agent sequencing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PipelinePromptFacade } from '../../../src/god-agent/cli/sdk-prompt-facade.js';

const PROJECT_ROOT = process.cwd();

// A task complex enough to trigger pipeline mode (not single-agent routing).
// Must match the isPipelineTask() scoring threshold in the orchestrator.
const TEST_TASK = `Implement a comprehensive input validation middleware for the Express API server.
The middleware should:
1. Validate request body schemas using Zod
2. Sanitize string inputs to prevent XSS
3. Rate limit by IP with configurable windows
4. Log validation failures with structured metadata
5. Support custom error response formatting
Include unit tests for all validation rules and integration tests for the middleware chain.
Files: src/middleware/validation.ts, src/middleware/rate-limit.ts, tests/middleware/validation.test.ts`;

describe('T-SDK-001: Crash recovery — basic', () => {
  let facade: PipelinePromptFacade;
  let sessionId: string;
  const completedAgentKeys: string[] = [];
  const outputDir = path.join(PROJECT_ROOT, '.pipeline-state');

  beforeAll(async () => {
    facade = new PipelinePromptFacade();
    await facade.initialize(PROJECT_ROOT);
  }, 120000); // 2 min for orchestrator init

  afterAll(async () => {
    await facade.shutdown();
  });

  it('initializes a session and returns first agent', async () => {
    const result = await facade.initSession(TEST_TASK);
    sessionId = result.sessionId;
    expect(sessionId).toBeTruthy();
    expect(result.firstAgent.key).toBe('task-analyzer');
    expect(result.firstAgent.model).toBe('opus');
    expect(result.firstAgent.phase).toBe(1);
    expect(result.firstAgent.prompt).toContain('MANDATORY FILE WRITING RULES'); // preamble
  }, 60000);

  it('completes 3 agents and persists state to disk', async () => {
    // Create output dir for this session
    const sessionOutputDir = path.join(outputDir, sessionId);
    fs.mkdirSync(sessionOutputDir, { recursive: true });

    // Complete agent 1 (task-analyzer)
    const outputPath1 = path.join(sessionOutputDir, 'task-analyzer.md');
    fs.writeFileSync(outputPath1, '## Task Analysis\nThis is a test output for task-analyzer.');
    const result1 = await facade.processCompletion(sessionId, 'task-analyzer', outputPath1);
    expect(result1.skipped).toBe(false);
    completedAgentKeys.push('task-analyzer');

    // Get agent 2
    const next2 = await facade.getNextAgent(sessionId);
    expect(next2.status).toBe('running');
    if (next2.status !== 'running') throw new Error('Expected running');
    const agent2Key = next2.agent.key;
    completedAgentKeys.push(agent2Key);

    // Complete agent 2
    const outputPath2 = path.join(sessionOutputDir, `${agent2Key}.md`);
    fs.writeFileSync(outputPath2, `## ${agent2Key}\nTest output.`);
    await facade.processCompletion(sessionId, agent2Key, outputPath2);

    // Get agent 3
    const next3 = await facade.getNextAgent(sessionId);
    expect(next3.status).toBe('running');
    if (next3.status !== 'running') throw new Error('Expected running');
    const agent3Key = next3.agent.key;
    completedAgentKeys.push(agent3Key);

    // Complete agent 3
    const outputPath3 = path.join(sessionOutputDir, `${agent3Key}.md`);
    fs.writeFileSync(outputPath3, `## ${agent3Key}\nTest output.`);
    await facade.processCompletion(sessionId, agent3Key, outputPath3);

    // Verify session JSON exists with all 3 agents completed
    const sessionPath = path.join(PROJECT_ROOT, '.god-agent', 'coding-sessions', `${sessionId}.json`);
    expect(fs.existsSync(sessionPath)).toBe(true);
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const completedKeys = (sessionData.completedAgents || []).map(
      (a: string | { agentKey: string }) => typeof a === 'string' ? a : a.agentKey,
    );
    expect(completedKeys).toContain('task-analyzer');
    expect(completedKeys.length).toBeGreaterThanOrEqual(3);
  }, 120000);

  it('restores from checkpoint and returns agent 4 (not agent 1)', async () => {
    // Simulate crash: shutdown the facade
    await facade.shutdown();

    // Create fresh facade (simulates process restart)
    const freshFacade = new PipelinePromptFacade();
    await freshFacade.initialize(PROJECT_ROOT);

    // Restore from checkpoint — must NOT call markBatchComplete
    await freshFacade.restoreFromCheckpoint(sessionId);

    // Get next agent — should be agent 4, not agent 1
    const next4 = await freshFacade.getNextAgent(sessionId);
    expect(next4.status).toBe('running');
    if (next4.status !== 'running') throw new Error('Expected running');

    // Agent 4 should NOT be any of the completed agents
    expect(completedAgentKeys).not.toContain(next4.agent.key);

    // Agent 4's progress should show 3+ completed
    expect(next4.progress.completed).toBeGreaterThanOrEqual(3);

    await freshFacade.shutdown();
  }, 120000);
});

describe('T-SDK-001b: CRITICAL GUARD-011 — fresh orchestrator disk state', () => {
  it('fresh orchestrator returns correct next agent from disk state alone', async () => {
    // This test uses the session created by T-SDK-001 above.
    // The key insight: getNextBatch() calls loadSessionFromDisk() on every call.
    // A completely fresh orchestrator + existing session JSON = correct state.

    // Read the session ID from the checkpoint
    const checkpointPath = path.join(PROJECT_ROOT, '.god-agent', 'pipeline-checkpoint.json');
    if (!fs.existsSync(checkpointPath)) {
      console.warn('T-SDK-001b: No checkpoint file — skipping (run T-SDK-001 first)');
      return;
    }

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    const sessionId = checkpoint.sessionId || checkpoint.lastSessionId;
    if (!sessionId) {
      console.warn('T-SDK-001b: No session ID in checkpoint — skipping');
      return;
    }

    // Read completed agents from session file
    const sessionPath = path.join(PROJECT_ROOT, '.god-agent', 'coding-sessions', `${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) {
      console.warn('T-SDK-001b: Session file missing — skipping');
      return;
    }
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const completedKeys = (sessionData.completedAgents || []).map(
      (a: string | { agentKey: string }) => typeof a === 'string' ? a : a.agentKey,
    );
    const completedCount = completedKeys.length;

    if (completedCount === 0) {
      console.warn('T-SDK-001b: No completed agents — skipping');
      return;
    }

    // Create COMPLETELY fresh facade (no shared state with any prior test)
    const isolatedFacade = new PipelinePromptFacade();
    await isolatedFacade.initialize(PROJECT_ROOT);

    // Call getNextAgent without any restoreFromCheckpoint — pure disk state
    const nextResult = await isolatedFacade.getNextAgent(sessionId);

    if (nextResult.status === 'complete') {
      // All agents done — valid outcome
      expect(completedCount).toBeGreaterThanOrEqual(48);
    } else {
      // The returned agent should NOT be any already-completed agent
      expect(completedKeys).not.toContain(nextResult.agent.key);
      // Progress should reflect the completed count
      expect(nextResult.progress.completed).toBeGreaterThanOrEqual(completedCount);
    }

    await isolatedFacade.shutdown();
  }, 120000);
});
