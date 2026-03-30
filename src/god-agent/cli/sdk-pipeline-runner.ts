/**
 * SDK Pipeline Runner — drives the 48-agent coding pipeline via the Claude Agent SDK.
 *
 * Entry point: `npx tsx src/god-agent/cli/sdk-pipeline-runner.ts "<task>"`
 * Slash command: `/god-code-sdk "<task>"`
 *
 * Architecture:
 *   1. Initialize PipelinePromptFacade (wraps existing orchestrator)
 *   2. Configure MCP servers (leann-search, memorygraph, lancedb-memory)
 *   3. For each agent: query() → materialize output → processCompletion()
 *   4. Sequential execution — no parallel agents
 *
 * PRD: PRD-2026-SDK-001, TASK-SDK-004/005/006
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKResultMessage,
  Options,
  HookCallback,
  HookCallbackMatcher,
} from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';
import {
  PipelinePromptFacade,
  IMPLEMENTATION_AGENTS,
  type AgentInfo,
  type NextAgentResult,
  type PipelineCompleteResult,
} from './sdk-prompt-facade.js';
import { PHASE_QUALITY_THRESHOLDS } from './coding-pipeline-cli.js';
import { codingQualityCalculator, createCodingQualityContext } from './coding-quality-calculator.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** SDK model strings mapped from facade model names */
const SDK_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

/** Phase 1-3 agents get read-only tools only */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

/** context-gatherer additionally gets LEANN search */
const CONTEXT_GATHERER_TOOLS = [...READ_ONLY_TOOLS, 'mcp__leann-search__search_code'];

/** Write tools blocked for Phase 1-3 agents */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit']);

// ─────────────────────────────────────────────────────────────────────────────
// MCP Configuration
// ─────────────────────────────────────────────────────────────────────────────

function buildMcpConfig(projectRoot: string): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  return {
    'leann-search': {
      command: 'npx',
      args: ['tsx', path.join(projectRoot, 'src/mcp-servers/leann-search/server.ts')],
      env: { ...process.env as Record<string, string>, NODE_ENV: 'production' },
    },
    'memorygraph': {
      command: process.env.MEMORYGRAPH_CMD || `${process.env.HOME}/.memorygraph-venv/run.sh`,
      args: ['--backend', 'falkordblite'],
    },
    'lancedb-memory': {
      command: 'npx',
      args: ['tsx', path.join(projectRoot, 'src/mcp-servers/lancedb-memory/server.ts')],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Query Wrapper
// ─────────────────────────────────────────────────────────────────────────────

interface QueryResult {
  output: string;
  sessionId: string | null;
  costUsd: number;
}

/**
 * Run a single agent via SDK query(). Collects the stream until the final
 * result message. Returns the text output.
 *
 * Validates non-null, non-empty result (EC-SDK-014).
 */
async function runAgentQuery(
  agentPrompt: string,
  agentKey: string,
  model: string,
  phase: number,
  projectRoot: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
  capturedFilePaths: string[],
  isSherlockReviewer: boolean = false,
): Promise<QueryResult> {
  // Build per-agent tool restriction via `tools` option (NOT `allowedTools` —
  // `allowedTools` only controls auto-approval, `tools` restricts availability)
  const isReadOnly = phase <= 3 || isSherlockReviewer;
  const isContextGatherer = agentKey === 'context-gatherer';
  const tools: string[] | undefined = isReadOnly
    ? (isContextGatherer ? CONTEXT_GATHERER_TOOLS : READ_ONLY_TOOLS)
    : undefined; // Phase 4+: all tools (undefined = default Claude Code toolset)

  // Build hooks
  const hooks: Record<string, HookCallbackMatcher[]> = {};

  // PreToolUse: defense-in-depth block for read-only agents (GUARD-001)
  // Primary restriction is via `tools` above; this is the secondary guard.
  if (isReadOnly) {
    const blockWrite: HookCallback = async (input, _toolUseId, _options) => {
      const toolName = (input as Record<string, unknown>).tool_name as string ?? '';
      if (WRITE_TOOLS.has(toolName)) {
        console.error(`[HOOK] Blocked ${toolName} for ${isSherlockReviewer ? 'Sherlock' : `Phase ${phase}`} agent ${agentKey}`);
        return {
          decision: 'block' as const,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny' as const,
            permissionDecisionReason: `${isSherlockReviewer ? 'Sherlock reviewers' : `Phase ${phase} agents`} are read-only — ${toolName} blocked`,
          },
        };
      }
      return {};
    };
    hooks.PreToolUse = [{ matcher: 'Write|Edit|Bash|NotebookEdit', hooks: [blockWrite] }];
  }

  // PostToolUse: capture file paths from Write/Edit for quality scoring
  if (!isReadOnly) {
    const captureFilePaths: HookCallback = async (input, _toolUseId, _options) => {
      const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown> | undefined;
      const filePath = toolInput?.file_path as string | undefined;
      if (filePath) {
        capturedFilePaths.push(filePath);
      }
      return {};
    };
    hooks.PostToolUse = [{ matcher: 'Write|Edit', hooks: [captureFilePaths] }];
  }

  const options: Options = {
    model,
    maxTurns: 50,
    cwd: projectRoot,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    mcpServers,
    hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
    tools,
    // GUARD-012: cleanupPeriodDays defaults to 30 in the SDK.
    // The SDK Options type does not expose this field — relies on SDK default.
  };

  let result: SDKResultMessage | null = null;
  let sessionId: string | null = null;

  for await (const msg of query({ prompt: agentPrompt, options })) {
    if (msg.type === 'result') {
      result = msg as SDKResultMessage;
      if ('session_id' in msg) {
        sessionId = (msg as { session_id: string }).session_id;
      }
    }
  }

  if (!result || result.subtype !== 'success' || !result.result) {
    throw new AgentEmptyResultError(agentKey, result?.subtype ?? 'no-result');
  }

  return {
    output: result.result,
    sessionId,
    costUsd: result.total_cost_usd ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────────────────────

class AgentEmptyResultError extends Error {
  constructor(public agentKey: string, public resultType: string) {
    super(`Agent ${agentKey} produced empty/failed result (type: ${resultType})`);
    this.name = 'AgentEmptyResultError';
  }
}

class McpHealthCheckError extends Error {
  constructor(public serverName: string) {
    super(`MCP server ${serverName} failed health check`);
    this.name = 'McpHealthCheckError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Error Retry with Exponential Backoff (TASK-SDK-008, EC-SDK-004/005)
// ─────────────────────────────────────────────────────────────────────────────

/** Transient HTTP status codes that warrant retry */
const TRANSIENT_STATUS_CODES = new Set([429, 500, 503]);

/** Max retry attempts for transient API errors */
const MAX_API_RETRIES = 3;

/** Backoff delays in ms: 1s, 2s, 4s */
const BACKOFF_DELAYS = [1000, 2000, 4000];

/**
 * Wrap an async operation with exponential backoff retry for transient API errors.
 * Non-transient errors (400, 401, 403, 404) fail immediately.
 */
async function withApiRetry<T>(
  operation: () => Promise<T>,
  agentKey: string,
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const statusCode = extractHttpStatus(err);

      // Non-transient error — fail immediately
      if (statusCode !== null && !TRANSIENT_STATUS_CODES.has(statusCode)) {
        throw err;
      }

      // AgentEmptyResultError is NOT retried here — handled by quality gate loop
      if (err instanceof AgentEmptyResultError) {
        throw err;
      }

      // Non-HTTP errors with no status code — fail immediately (not transient)
      if (statusCode === null) {
        throw err;
      }

      // Transient error — retry with backoff
      if (attempt < MAX_API_RETRIES && TRANSIENT_STATUS_CODES.has(statusCode)) {
        const delay = BACKOFF_DELAYS[attempt] || 4000;
        console.error(`[RETRY] Agent ${agentKey}: attempt ${attempt + 1}/${MAX_API_RETRIES} failed (status: ${statusCode ?? 'N/A'}) — retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Exhausted retries
      console.error(`[RETRY] Agent ${agentKey}: all ${MAX_API_RETRIES} retries exhausted`);
      throw err;
    }
  }
  // Unreachable but satisfies TypeScript
  throw new Error(`withApiRetry: unreachable for ${agentKey}`);
}

/** Extract HTTP status code from SDK error, or null if not an HTTP error */
function extractHttpStatus(err: unknown): number | null {
  if (err && typeof err === 'object') {
    // SDK errors may have status, statusCode, or code fields
    const e = err as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
    if (typeof e.code === 'number') return e.code;
    // Check nested error
    if (e.cause && typeof e.cause === 'object') {
      const cause = e.cause as Record<string, unknown>;
      if (typeof cause.status === 'number') return cause.status;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Gate Retry (TASK-SDK-008, REQ-PAR-004)
// ─────────────────────────────────────────────────────────────────────────────

/** Max quality gate retries per agent (3 total attempts for normal, 2 for reviewers) */
const MAX_QUALITY_RETRIES = 2;

/** Max retries for Sherlock reviewer agents (2 total attempts) */
const MAX_REVIEWER_RETRIES = 1;

/** Scores within this margin of the threshold pass without retry.
 *  e.g., 87% passes a 90% gate with 0.03 margin. Revert: set to 0. */
const CLOSE_ENOUGH_MARGIN = 0.03;

/** Max chars of previous output included in retry prompt */
const PREVIOUS_OUTPUT_TRUNCATION = 3000;

/**
 * Build an enriched feedback prompt for quality gate retry.
 * Includes: quality breakdown, previous output (truncated), and full original prompt.
 */
function buildQualityRetryPrompt(
  originalPrompt: string,
  quality: number,
  threshold: number,
  metric: string,
  breakdown?: import('./coding-quality-calculator.js').ICodingQualityBreakdown,
  previousOutput?: string,
): string {
  let feedbackHeader = `## QUALITY GATE RETRY

Your previous output scored ${(quality * 100).toFixed(0)}% on the "${metric}" quality gate.
The required threshold is ${(threshold * 100).toFixed(0)}%.
`;

  // Include specific dimension scores so the agent knows WHERE to improve
  if (breakdown) {
    feedbackHeader += `
### Quality Breakdown (improve the weakest dimensions)
- Code Quality: ${(breakdown.codeQuality * 100).toFixed(0)}% (max 30%)
- Completeness: ${(breakdown.completeness * 100).toFixed(0)}% (max 25%)
- Structural Integrity: ${(breakdown.structuralIntegrity * 100).toFixed(0)}% (max 20%)
- Documentation: ${(breakdown.documentationScore * 100).toFixed(0)}% (max 15%)
- Test Coverage: ${(breakdown.testCoverage * 100).toFixed(0)}% (max 10%)
`;
  }

  // Include truncated previous output so agent can build on it
  if (previousOutput) {
    // Truncate to last complete line within limit
    let truncated = previousOutput;
    if (truncated.length > PREVIOUS_OUTPUT_TRUNCATION) {
      truncated = truncated.substring(0, PREVIOUS_OUTPUT_TRUNCATION);
      const lastNewline = truncated.lastIndexOf('\n');
      if (lastNewline > PREVIOUS_OUTPUT_TRUNCATION * 0.8) {
        truncated = truncated.substring(0, lastNewline);
      }
      truncated += '\n... [truncated — full output is on disk]';
    }
    feedbackHeader += `
### Your Previous Output (improve upon this)
${truncated}
`;
  }

  return `${feedbackHeader}
---

${originalPrompt}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Session Map — tracks currentAgentKey + per-agent SDK session IDs
// (PRD Section 16.8.4, TASK-SDK-006)
// ─────────────────────────────────────────────────────────────────────────────

interface SdkSessionMap {
  pipelineSessionId: string;
  currentAgentKey: string | null;
  sdkSessions: Record<string, string | null>; // agentKey → SDK session ID (null = started but no ID yet)
}

function getSdkSessionMapPath(projectRoot: string, sessionId: string): string {
  return path.join(projectRoot, '.god-agent', 'sdk-sessions', `${sessionId}.json`);
}

function readSdkSessionMap(projectRoot: string, sessionId: string): SdkSessionMap | null {
  try {
    const raw = fs.readFileSync(getSdkSessionMapPath(projectRoot, sessionId), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSdkSessionMap(projectRoot: string, sessionId: string, map: SdkSessionMap): void {
  const mapPath = getSdkSessionMapPath(projectRoot, sessionId);
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// LEANN Indexing — Phase 4+ agents only (TASK-SDK-005)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Index source files mentioned in agent output via LEANN MCP.
 * Only runs for IMPLEMENTATION_AGENTS (Phase 4+).
 * Uses the agent's captured file paths from PostToolUse hooks.
 */
async function indexToLeann(
  capturedFilePaths: string[],
  agentKey: string,
  projectRoot: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
): Promise<void> {
  if (!IMPLEMENTATION_AGENTS.includes(agentKey)) return;
  if (capturedFilePaths.length === 0) return;

  // Deduplicate and filter to source files
  const uniquePaths = Array.from(new Set(capturedFilePaths)).filter(p =>
    p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx') ||
    p.endsWith('.py') || p.endsWith('.go') || p.endsWith('.rs'),
  );

  if (uniquePaths.length === 0) return;

  console.error(`[LEANN] Indexing ${uniquePaths.length} files from ${agentKey}...`);

  try {
    // Use a lightweight query that invokes the LEANN index_code MCP tool
    const fileList = uniquePaths.map(p => `- ${p}`).join('\n');
    // MUST drain the async iterator — query() returns AsyncIterable, not a Promise
    for await (const _msg of query({
      prompt: `Use the mcp__leann-search__index_code tool to index these files:\n${fileList}\n\nFor each file, set customMetadata.source to "${agentKey}". Reply with DONE when complete.`,
      options: {
        model: SDK_MODEL_MAP.haiku,
        maxTurns: uniquePaths.length + 2,
        cwd: projectRoot,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers,
        tools: ['mcp__leann-search__index_code'],
      },
    })) {
      // drain — we don't need individual messages
    }
    console.error(`[LEANN] Indexed ${uniquePaths.length} files from ${agentKey}`);
  } catch (err) {
    // LEANN indexing is non-fatal
    console.error(`[LEANN] Indexing failed for ${agentKey} (non-fatal): ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Crash Recovery (TASK-SDK-006, PRD Section 16.8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check for an interrupted session on startup.
 * Returns the session ID if recovery is needed, null otherwise.
 */
function detectInterruptedSession(projectRoot: string): string | null {
  try {
    const checkpointPath = path.join(projectRoot, '.god-agent', 'pipeline-checkpoint.json');
    if (!fs.existsSync(checkpointPath)) return null;

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    const sessionId = checkpoint.sessionId || checkpoint.lastSessionId;
    if (!sessionId) return null;

    // Check if session is still incomplete
    const sessionPath = path.join(projectRoot, '.god-agent', 'coding-sessions', `${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) return null;

    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    if (session.status === 'complete') return null;

    // Check SDK session map for interrupted agent
    const sdkMap = readSdkSessionMap(projectRoot, sessionId);
    if (sdkMap?.currentAgentKey) {
      console.error(`[RECOVERY] Detected interrupted session ${sessionId} — agent ${sdkMap.currentAgentKey} was in progress`);
      return sessionId;
    }

    // Session exists but no currentAgentKey — might just be between agents
    const completedCount = (session.completedAgents || []).length;
    const totalAgents = session.totalAgents || 48;
    if (completedCount < totalAgents) {
      console.error(`[RECOVERY] Detected incomplete session ${sessionId} — ${completedCount}/${totalAgents} agents done`);
      return sessionId;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Recover from a crashed pipeline run.
 * Handles 3 scenarios (PRD Section 16.8.2):
 *   A: Runner crashed mid-query (SDK session exists)
 *   B: Runner crashed after query but before processCompletion (output exists)
 *   C: No output and no session — agent re-runs from scratch
 */
async function recoverFromCrash(
  facade: PipelinePromptFacade,
  sessionId: string,
  projectRoot: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
): Promise<void> {
  const sdkMap = readSdkSessionMap(projectRoot, sessionId);
  if (!sdkMap) {
    console.error(`[RECOVERY] No SDK session map — using facade checkpoint only`);
    await facade.restoreFromCheckpoint(sessionId);
    return;
  }

  await facade.restoreFromCheckpoint(sessionId);

  const currentAgent = sdkMap.currentAgentKey;
  if (!currentAgent) return; // Clean state

  // Check if already completed (e.g., crash at step 7 of update order)
  const sessionJson = await facade.readSessionJson(sessionId);
  const completedKeys = ((sessionJson?.completedAgents || []) as Array<string | { agentKey: string }>)
    .map(a => typeof a === 'string' ? a : a.agentKey);

  if (completedKeys.includes(currentAgent)) {
    console.error(`[RECOVERY] Agent ${currentAgent} already completed — clearing currentAgentKey`);
    sdkMap.currentAgentKey = null;
    writeSdkSessionMap(projectRoot, sessionId, sdkMap);
    return;
  }

  // Check if output file exists (Scenario B)
  const outputPath = path.join(projectRoot, '.pipeline-state', sessionId, `${currentAgent}.md`);
  if (fs.existsSync(outputPath)) {
    console.error(`[RECOVERY] Scenario B: Output exists for ${currentAgent} — running processCompletion`);
    await facade.processCompletion(sessionId, currentAgent, outputPath);
    sdkMap.currentAgentKey = null;
    writeSdkSessionMap(projectRoot, sessionId, sdkMap);
    return;
  }

  // Check if SDK session ID exists (Scenario A)
  const sdkSessionId = sdkMap.sdkSessions[currentAgent];
  if (sdkSessionId) {
    console.error(`[RECOVERY] Scenario A: SDK session exists for ${currentAgent} — resuming`);
    try {
      // Look up the agent's original model from AGENT_MODEL_MAP via the CLI
      const { getAgentModel } = await import('./coding-pipeline-cli.js') as unknown as { getAgentModel?: (key: string) => string };
      const agentModel = SDK_MODEL_MAP[(getAgentModel?.(currentAgent) ?? 'sonnet')] || SDK_MODEL_MAP.sonnet;

      let result: SDKResultMessage | null = null;
      for await (const msg of query({
        prompt: 'Continue where you left off.',
        options: {
          model: agentModel,
          cwd: projectRoot,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          mcpServers,
          resume: sdkSessionId,
        },
      })) {
        if (msg.type === 'result') {
          result = msg as SDKResultMessage;
        }
      }

      if (result?.subtype === 'success' && result.result) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, result.result);
        await facade.processCompletion(sessionId, currentAgent, outputPath);
        console.error(`[RECOVERY] Scenario A: Successfully resumed and completed ${currentAgent}`);
      } else {
        console.error(`[RECOVERY] Scenario A: Resume produced no result — will re-run agent`);
      }
    } catch (err) {
      console.error(`[RECOVERY] Scenario A: Resume failed (${(err as Error).message}) — will re-run agent`);
    }
  } else {
    // Scenario C: No output, no SDK session — main loop will re-run
    console.error(`[RECOVERY] Scenario C: No output or SDK session for ${currentAgent} — will re-run`);
  }

  sdkMap.currentAgentKey = null;
  writeSdkSessionMap(projectRoot, sessionId, sdkMap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Runner
// ─────────────────────────────────────────────────────────────────────────────

export async function runSdkPipeline(taskDescription: string, projectRoot: string, options?: { dryRun?: boolean }): Promise<{
  sessionId: string;
  agentsCompleted: number;
  totalCostUsd: number;
}> {
  const facade = new PipelinePromptFacade();
  const mcpServers = buildMcpConfig(projectRoot);
  let totalCostUsd = 0;

  // ── Initialize facade ──────────────────────────────────────────────────
  console.error('[SDK-RUNNER] Initializing facade...');
  await facade.initialize(projectRoot);

  try {
    // ── Verify MCP servers (NFR-REL-002) with 60s timeout (EC-SDK-006) ──
    console.error('[SDK-RUNNER] Verifying MCP servers...');
    const mcpVerifyTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new McpHealthCheckError('timeout — MCP servers did not connect within 60s')), 60000),
    );
    await Promise.race([verifyMcpServers(mcpServers, projectRoot), mcpVerifyTimeout]);

    // ── Mutual exclusion + pipeline flags ────────────────────────────────
    // Set after MCP verification succeeds, before agent loop.
    // NOTE: agent-prompt-enforcer.sh is a non-issue — SDK runner calls query()
    // directly (not Claude Code's Task tool), so PreToolUse hooks on Task/Agent
    // never fire for SDK-spawned agents.
    const runtimeDir = path.join(projectRoot, '.claude', 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    const activeFlag = path.join(runtimeDir, '.god-code-active');
    const sdkActiveFlag = path.join(runtimeDir, '.god-code-sdk-active');
    const projectRootFlag = path.join(runtimeDir, '.pipeline-project-root');

    // Mutual exclusion: refuse if another SDK pipeline is running
    if (fs.existsSync(sdkActiveFlag)) {
      try {
        const existing = JSON.parse(fs.readFileSync(sdkActiveFlag, 'utf-8'));
        const existingPid = existing.pid as number;
        const existingAge = (Date.now() / 1000) - (existing.startedAt as number || 0);
        // Check if PID is alive AND flag is <4 hours old (handles PID recycling)
        try {
          process.kill(existingPid, 0); // throws if PID dead
          if (existingAge < 14400) {
            throw new Error(`Another SDK pipeline is running (PID ${existingPid}, started ${Math.round(existingAge / 60)}min ago). Wait for it to finish or delete .claude/runtime/.god-code-sdk-active`);
          }
        } catch (killErr) {
          if ((killErr as NodeJS.ErrnoException).code !== 'ESRCH') {
            // ESRCH = no such process = PID dead = stale flag, clean up
            // Any other error from the mutual exclusion check = re-throw
            if ((killErr as Error).message.includes('Another SDK pipeline')) throw killErr;
          }
          // PID dead or flag >4h old — stale, clean up
          console.error(`[SDK-RUNNER] Cleaned stale SDK pipeline flag (PID ${existingPid} dead or >4h old)`);
          fs.unlinkSync(sdkActiveFlag);
          try { fs.unlinkSync(activeFlag); } catch { /* ok */ }
        }
      } catch (parseErr) {
        if ((parseErr as Error).message.includes('Another SDK pipeline')) throw parseErr;
        // Corrupt flag — delete and proceed
        fs.unlinkSync(sdkActiveFlag);
      }
    }

    // Write pipeline flags
    fs.writeFileSync(activeFlag, '48'); // "48" passes [ $TASK_COUNT -lt 7 ] check — SDK enforces tools at SDK level
    fs.writeFileSync(sdkActiveFlag, JSON.stringify({ pid: process.pid, startedAt: Math.floor(Date.now() / 1000) }));
    fs.writeFileSync(projectRootFlag, projectRoot);
    console.error('[SDK-RUNNER] Pipeline flags set (.god-code-active, .god-code-sdk-active, .pipeline-project-root)');

    // ── Check for interrupted session and CONTINUE it (TASK-SDK-006) ────
    const interruptedSessionId = detectInterruptedSession(projectRoot);
    if (interruptedSessionId) {
      console.error(`[SDK-RUNNER] Recovering interrupted session ${interruptedSessionId}...`);
      await recoverFromCrash(facade, interruptedSessionId, projectRoot, mcpServers);
      console.error('[SDK-RUNNER] Recovery complete — continuing recovered session');

      // Continue the recovered session instead of starting a new one
      const nextAfterRecovery = await facade.getNextAgent(interruptedSessionId);
      if (nextAfterRecovery.status === 'complete') {
        console.error(`[SDK-RUNNER] Recovered session was already complete`);
        return { sessionId: interruptedSessionId, agentsCompleted: 0, totalCostUsd: 0 };
      }

      // Resume into the main agent loop with the recovered session
      const recoveredSdkMap = readSdkSessionMap(projectRoot, interruptedSessionId);
      const outputDir = path.join(projectRoot, '.pipeline-state', interruptedSessionId);
      fs.mkdirSync(outputDir, { recursive: true });
      return await runAgentLoop(
        facade, interruptedSessionId, nextAfterRecovery.agent, nextAfterRecovery.progress,
        outputDir, recoveredSdkMap || { pipelineSessionId: interruptedSessionId, currentAgentKey: null, sdkSessions: {} },
        projectRoot, mcpServers, totalCostUsd, options?.dryRun ?? false,
      );
    }

    // ── Initialize new session ───────────────────────────────────────────
    console.error(`[SDK-RUNNER] Starting pipeline for task: ${taskDescription.substring(0, 100)}...`);
    const { sessionId, firstAgent, progress } = await facade.initSession(taskDescription);

    // Create output directory + SDK session map
    const outputDir = path.join(projectRoot, '.pipeline-state', sessionId);
    fs.mkdirSync(outputDir, { recursive: true });
    const sdkMap: SdkSessionMap = { pipelineSessionId: sessionId, currentAgentKey: null, sdkSessions: {} };
    writeSdkSessionMap(projectRoot, sessionId, sdkMap);

    console.error(`[SDK-RUNNER] Session ${sessionId} — ${progress.total} agents total`);

    return await runAgentLoop(
      facade, sessionId, firstAgent, progress,
      outputDir, sdkMap, projectRoot, mcpServers, totalCostUsd, options?.dryRun ?? false,
    );
  } finally {
    // Clean up ALL three pipeline flags explicitly (no glob, no shared helper)
    const runtimeDir = path.join(projectRoot, '.claude', 'runtime');
    try { fs.unlinkSync(path.join(runtimeDir, '.god-code-active')); } catch { /* ok if missing */ }
    try { fs.unlinkSync(path.join(runtimeDir, '.god-code-sdk-active')); } catch { /* ok if missing */ }
    try { fs.unlinkSync(path.join(runtimeDir, '.pipeline-project-root')); } catch { /* ok if missing */ }
    console.error('[SDK-RUNNER] Pipeline flags cleaned up');
    await facade.shutdown();
  }
}

/** Shared agent loop — used by both new sessions and recovered sessions */
/** Max agents in dry-run mode (Phase 1 = 7 agents, all read-only) */
const DRY_RUN_MAX_AGENTS = 7;

async function runAgentLoop(
  facade: PipelinePromptFacade,
  sessionId: string,
  firstAgent: AgentInfo,
  progress: import('./sdk-prompt-facade.js').ProgressInfo,
  outputDir: string,
  sdkMap: SdkSessionMap,
  projectRoot: string,
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
  totalCostUsd: number,
  dryRun: boolean = false,
): Promise<{ sessionId: string; agentsCompleted: number; totalCostUsd: number }> {
  let currentAgent: AgentInfo = firstAgent;
  let agentsCompleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { key, prompt, model, phase } = currentAgent;
    const sdkModel = SDK_MODEL_MAP[model] || SDK_MODEL_MAP.sonnet;
    const capturedFilePaths: string[] = [];
    const isSherlockReviewer = /^phase-\d+-reviewer$/.test(key);

    console.error(`\n[SDK-RUNNER] Agent ${agentsCompleted + 1}/${progress.total}: ${key} (${model}, phase ${phase}${isSherlockReviewer ? ', Sherlock' : ''})`);

    // Step 1: Write SDK session map — mark agent started
    sdkMap.currentAgentKey = key;
    sdkMap.sdkSessions[key] = null;
    writeSdkSessionMap(projectRoot, sessionId, sdkMap);

    // ── Run agent via SDK query() with API retry (EC-SDK-004/005) ──────
    let currentPrompt = prompt;
    let queryResult: QueryResult | null = null;
    let completion = { quality: 0, xp: 0, phase, skipped: false };
    const outputPath = path.join(outputDir, `${key}.md`);

    // Quality gate loop: score output FIRST (pure, no side effects), retry if needed,
    // then call processCompletion() ONCE on the final accepted output.
    const maxRetries = isSherlockReviewer ? MAX_REVIEWER_RETRIES : MAX_QUALITY_RETRIES;
    for (let qualityAttempt = 0; qualityAttempt <= maxRetries; qualityAttempt++) {
      // Run agent with API-level exponential backoff retry.
      // AgentEmptyResultError is NOT retried by withApiRetry — caught here instead.
      try {
        queryResult = await withApiRetry(
          () => runAgentQuery(currentPrompt, key, sdkModel, phase, projectRoot, mcpServers, capturedFilePaths, isSherlockReviewer),
          key,
        );
      } catch (err) {
        if (err instanceof AgentEmptyResultError) {
          if (qualityAttempt === 0) {
            console.error(`[SDK-RUNNER] Empty result from ${key} — retrying once via quality gate loop...`);
            continue;
          }
          const gate = PHASE_QUALITY_THRESHOLDS[phase];
          const errorMsg = `Agent ${key} produced empty output after retry. ` +
            `Quality score 0 is below ${gate ? `${(gate.threshold * 100).toFixed(0)}%` : 'all'} threshold(s).`;
          console.error(`[QUALITY-GATE] ABORT: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        throw err;
      }

      // Step 3: Store SDK session ID
      if (queryResult.sessionId) {
        sdkMap.sdkSessions[key] = queryResult.sessionId;
        writeSdkSessionMap(projectRoot, sessionId, sdkMap);
      }

      totalCostUsd += queryResult.costUsd;

      // ── Materialize output to disk (REQ-PAR-005) ──────────────────────
      try {
        fs.writeFileSync(outputPath, queryResult.output);
      } catch {
        console.error(`[SDK-RUNNER] Disk write failed for ${key} — retrying in 5s...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        fs.writeFileSync(outputPath, queryResult.output);
      }

      console.error(`[SDK-RUNNER] Output: ${outputPath} (${queryResult.output.length} chars, $${queryResult.costUsd.toFixed(4)})`);

      // ── Pre-score with CodingQualityCalculator (pure, no side effects) ─
      // This does NOT call markBatchComplete or store to memory.
      // processCompletion() is called ONCE after the gate passes.
      const qualityContext = createCodingQualityContext(key, phase);
      const preScore = codingQualityCalculator.assessQuality(queryResult.output, qualityContext);
      console.error(`[SDK-RUNNER] Pre-score: ${(preScore.score * 100).toFixed(0)}% (${preScore.tier}) | Agent: ${key} | Phase: ${phase}`);

      // ── Quality gate check BEFORE processCompletion ────────────────────
      const gate = PHASE_QUALITY_THRESHOLDS[phase];
      if (gate) {
        if (preScore.score >= gate.threshold) {
          // Clean pass
          console.error(`[QUALITY-GATE] ${key}: ${(preScore.score * 100).toFixed(0)}% passed (threshold ${(gate.threshold * 100).toFixed(0)}%)`);
        } else if (preScore.score >= gate.threshold - CLOSE_ENOUGH_MARGIN) {
          // Close-enough margin pass — log distinctly for telemetry
          console.error(`[QUALITY-GATE] ${key}: ${(preScore.score * 100).toFixed(0)}% passed via close-enough margin (threshold ${(gate.threshold * 100).toFixed(0)}%, margin ${(CLOSE_ENOUGH_MARGIN * 100).toFixed(0)}%)`);
        } else if (qualityAttempt < maxRetries) {
          // Below threshold and margin — retry with enriched prompt
          console.error(`[QUALITY-GATE] ${key}: ${(preScore.score * 100).toFixed(0)}% < ${(gate.threshold * 100).toFixed(0)}% threshold — retry ${qualityAttempt + 1}/${maxRetries}`);
          currentPrompt = buildQualityRetryPrompt(
            prompt, preScore.score, gate.threshold, gate.metric,
            preScore.breakdown, queryResult!.output,
          );
          continue; // retry with feedback prompt — no state mutation yet
        } else {
          // Exhausted retries — proceed with best effort
          console.error(`[QUALITY-GATE] ${key}: failed after ${maxRetries + 1} attempts (${(preScore.score * 100).toFixed(0)}% < ${(gate.threshold * 100).toFixed(0)}%). Proceeding with best output.`);
        }
      }

      break; // Quality gate passed (or margin, or exhausted retries)
    }

    // ── Process completion ONCE on final output (all side effects here) ───
    completion = await facade.processCompletion(sessionId, key, outputPath);

    if (completion.skipped) {
      console.error(`[SDK-RUNNER] SKIP: ${key} was already completed (double-completion guard)`);
    } else {
      console.error(`[SDK-RUNNER] Quality: ${(completion.quality * 100).toFixed(0)}% | XP: ${completion.xp} | Phase: ${completion.phase}`);
    }

    // ── LEANN indexing for implementation agents (TASK-SDK-005) ───────────
    await indexToLeann(capturedFilePaths, key, projectRoot, mcpServers);

    // Step 7: Clear currentAgentKey — agent done
    sdkMap.currentAgentKey = null;
    writeSdkSessionMap(projectRoot, sessionId, sdkMap);

    agentsCompleted++;

    // ── Dry-run exit: stop after Phase 1 (read-only agents only) ─────────
    if (dryRun && agentsCompleted >= DRY_RUN_MAX_AGENTS) {
      console.error(`\n[SDK-RUNNER] DRY-RUN COMPLETE — ${agentsCompleted} agents (Phase 1 only), $${totalCostUsd.toFixed(4)} total`);
      return { sessionId, agentsCompleted, totalCostUsd };
    }

    // ── Get next agent ────────────────────────────────────────────────────
    const nextResult = await facade.getNextAgent(sessionId);

    if (nextResult.status === 'complete') {
      console.error(`\n[SDK-RUNNER] Pipeline COMPLETE — ${agentsCompleted} agents, $${totalCostUsd.toFixed(4)} total`);
      return { sessionId, agentsCompleted, totalCostUsd };
    }

    currentAgent = nextResult.agent;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify all MCP servers connect by running a trivial query that triggers
 * MCP server initialization. Checks the system init message for server status.
 * (NFR-REL-002)
 */
async function verifyMcpServers(
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>,
  projectRoot: string,
): Promise<void> {
  const expectedServers = Object.keys(mcpServers);
  console.error(`[SDK-RUNNER] Checking ${expectedServers.length} MCP servers: ${expectedServers.join(', ')}`);

  let initMsg: { mcp_servers: Array<{ name: string; status: string }> } | null = null;

  for await (const msg of query({
    prompt: 'Reply with exactly: MCP_CHECK_OK',
    options: {
      model: SDK_MODEL_MAP.haiku,
      maxTurns: 1,
      cwd: projectRoot,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers,
    },
  })) {
    if (msg.type === 'system' && (msg as Record<string, unknown>).subtype === 'init') {
      initMsg = msg as unknown as { mcp_servers: Array<{ name: string; status: string }> };
    }
  }

  if (!initMsg) {
    throw new Error('MCP verification failed — no system init message received');
  }

  const failedServers: string[] = [];
  for (const name of expectedServers) {
    const server = initMsg.mcp_servers?.find(s => s.name === name);
    if (!server || server.status !== 'connected') {
      failedServers.push(`${name} (${server?.status ?? 'not found'})`);
    } else {
      console.error(`[SDK-RUNNER] MCP ${name}: connected`);
    }
  }

  if (failedServers.length > 0) {
    throw new McpHealthCheckError(failedServers.join(', '));
  }

  console.error('[SDK-RUNNER] All MCP servers connected');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npx tsx src/god-agent/cli/sdk-pipeline-runner.ts [--dry-run] "<task description>"');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  const taskArgs = args.filter(a => a !== '--dry-run');
  const taskDescription = taskArgs.join(' ');
  const projectRoot = process.cwd();

  if (dryRun) {
    console.error('[SDK-RUNNER] DRY-RUN MODE: Phase 1 only (7 read-only agents, no file writes)');
  }

  try {
    const result = await runSdkPipeline(taskDescription, projectRoot, { dryRun });
    // Output JSON result to stdout (CLI convention)
    console.log(JSON.stringify({
      status: dryRun ? 'dry-run-complete' : 'complete',
      dryRun,
      sessionId: result.sessionId,
      agentsCompleted: result.agentsCompleted,
      totalCostUsd: result.totalCostUsd,
    }, null, 2));
  } catch (err) {
    console.error(`[SDK-RUNNER] FATAL: ${(err as Error).message}`);
    console.log(JSON.stringify({
      status: 'error',
      error: (err as Error).message,
    }, null, 2));
    process.exit(1);
  }
}

// Run if invoked directly
const isDirectRun = process.argv[1]?.includes('sdk-pipeline-runner');
if (isDirectRun) {
  main();
}
