#!/usr/bin/env node
/**
 * PhD Pipeline CLI - Guided orchestration tool
 * Implements REQ-PIPE-001 through REQ-PIPE-007
 */

import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs/promises';
import { StyleProfileManager } from '../universal/style-profile.js';
import type { StoredStyleProfile } from '../universal/style-profile.js';
import { SessionManager } from './session-manager.js';
import type {
  InitOptions,
  InitResponse,
  NextOptions,
  NextResponse,
  CompleteOptions,
  CompleteResponse,
  StatusOptions,
  StatusResponse,
  ListOptions,
  ListResponse,
  SessionListItem,
  ResumeOptions,
  ResumeResponse,
  AbortOptions,
  AbortResponse,
  ProgressInfo,
  CompletionSummary,
  AgentDetails,
  ErrorResponse,
} from './cli-types.js';
import { AgentMismatchError } from './cli-types.js';
import { getPhaseName } from './cli-types.js';
import {
  PHASE_1_5_AGENT_COUNT,
  PHASE_6_START_INDEX,
  PHASE_7_AGENT_COUNT,
  STATIC_PHASE_7_START_INDEX
} from './cli-types.js';
import { PipelineConfigLoader } from './pipeline-loader.js';
import type { AgentConfig } from './pipeline-loader.js';

// Import 46-agent configuration from phd-pipeline-config (TASK-CONFIG-002)
// These provide the canonical agent definitions and utility functions
import {
  PHD_AGENTS,
  PHD_PHASES,
  DEFAULT_CONFIG,
  getAgentByKey as getConfigAgentByKey,
  getAgentsByPhase as getConfigAgentsByPhase,
  getAgentIndex as getConfigAgentIndex,
  getAgentByIndex as getConfigAgentByIndex,
  validateConfiguration,
  getTotalAgentCount,
  getPhaseById,
  getAgentFilePath,
  type AgentConfig as PhdAgentConfig,
  type SessionState as PhdSessionState,
  type PhaseDefinition,
} from './phd-pipeline-config.js';
import { StyleInjector } from './style-injector.js';
import { SessionNotFoundError, SessionCorruptedError, SessionExpiredError } from './session-manager.js';
import { DynamicAgentGenerator } from './dynamic-agent-generator.js';
import { ChapterStructureLoader } from './chapter-structure-loader.js';
import { getUCMClient } from './ucm-daemon-client.js';
import { PhdPipelineAdapter } from '../core/ucm/adapters/phd-pipeline-adapter.js';
import { SocketClient } from '../observability/socket-client.js';
import { FinalStageOrchestrator, PROGRESS_MILESTONES, PaperCombiner } from './final-stage/index.js';
import type { FinalStageOptions, FinalStageResult, ProgressReport, FinalStageState } from './final-stage/index.js';
import type { ChapterWriterOutput, ChapterNumber } from './final-stage/types.js';
import type { IActivityEvent } from '../observability/types.js';
// Implements RULE-025, RULE-028, RULE-031: SonaEngine integration for trajectory tracking
import { createProductionSonaEngine } from '../core/learning/sona-engine.js';
import type { SonaEngine } from '../core/learning/sona-engine.js';
import type { TrajectoryID } from '../core/learning/sona-types.js';
// Import PhDQualityCalculator for discriminating quality assessment (RULE-033, RULE-034)
import { calculatePhDQuality, createQualityContext } from './phd-quality-calculator.js';

// Lazy-initialized socket client for event emission
let socketClient: SocketClient | null = null;

// Lazy-initialized SonaEngine for trajectory tracking (RULE-031)
let sonaEngine: SonaEngine | null = null;
// Active trajectory map: sessionId -> Map<agentKey -> trajectoryId>
const activeTrajectories: Map<string, Map<string, TrajectoryID>> = new Map();

// ============================================================================
// PHD PIPELINE CONFIGURATION CONSTANTS (TASK-CONFIG-002)
// ============================================================================

/**
 * Expected total agent count from phd-pipeline-config.ts
 * Used for validation and progress calculations
 * IMPORTANT: This is 46 agents (not 43 from the old incorrect mapping)
 */
const PHD_PIPELINE_AGENT_COUNT = getTotalAgentCount(); // 46 agents

/**
 * Validate pipeline configuration at module load
 * Ensures PHD_AGENTS and PHD_PHASES are consistent
 */
try {
  validateConfiguration();
  // Log validation success to stderr (not stdout to avoid JSON parsing issues)
  if (process.env.PHD_CLI_DEBUG) {
    console.error(`[PHD-CLI] Pipeline configuration validated: ${PHD_PIPELINE_AGENT_COUNT} agents across ${PHD_PHASES.length} phases`);
  }
} catch (configError) {
  // Configuration validation failed - this is a critical error
  console.error(`[PHD-CLI] CRITICAL: Pipeline configuration validation failed: ${configError}`);
  // Don't exit here - let the CLI continue and fail gracefully if needed
}

// ============================================================================
// TASK-CLI-004: MEMORY INTEGRATION HELPERS
// ============================================================================
// Implements RULE-021: Session must persist to `.phd-sessions/` and support resume
// Memory operations use local JSON file store at .god-agent/phd-memory/
// Previously used npx claude-flow memory commands — replaced with direct file I/O
// for reliability and removal of claude-flow dependency.

/**
 * Store data to local JSON file-based memory.
 * Non-blocking operation - errors are logged but don't fail the pipeline.
 *
 * @param key - Memory key (e.g., 'session/{sessionId}', 'research/agent/output')
 * @param value - JSON-serializable value to store
 * @param namespace - Memory namespace (default: 'project/research')
 * @returns Promise<boolean> - true if stored successfully
 */
async function storeToMemory(
  key: string,
  value: unknown,
  namespace: string = DEFAULT_CONFIG.memoryNamespace
): Promise<boolean> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const jsonValue = JSON.stringify(value);
    // Escape single quotes in JSON for shell safety
    const escapedValue = jsonValue.replace(/'/g, "'\\''");

    // Store to local JSON file: .god-agent/phd-memory/{namespace}/{key}.json
    const fs = await import('fs');
    const path = await import('path');
    const memDir = path.join(process.cwd(), '.god-agent', 'phd-memory', namespace.replace(/\//g, '_'));
    fs.mkdirSync(memDir, { recursive: true });
    const filePath = path.join(memDir, `${key.replace(/\//g, '_')}.json`);
    fs.writeFileSync(filePath, escapedValue.replace(/\\'/g, "'"));

    if (process.env.PHD_CLI_DEBUG) {
      console.error(`[MEMORY] Stored: ${key} -> ${filePath} (${jsonValue.length} bytes)`);
    }

    if (process.env.PHD_CLI_DEBUG) {
      console.error(`[MEMORY] Stored successfully: ${key}`);
    }

    return true;
  } catch (error) {
    // Non-blocking - log but don't fail
    console.error(`[MEMORY] Failed to store ${key}: ${error}`);
    return false;
  }
}

/**
 * Retrieve data from local JSON file-based memory.
 *
 * @param key - Memory key to retrieve
 * @param namespace - Memory namespace (default: 'project/research')
 * @returns Promise<unknown | null> - Retrieved value or null if not found
 */
async function retrieveFromMemory(
  key: string,
  namespace: string = DEFAULT_CONFIG.memoryNamespace
): Promise<unknown | null> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    // Retrieve from local JSON file: .god-agent/phd-memory/{namespace}/{key}.json
    const fs = await import('fs');
    const path = await import('path');
    const memDir = path.join(process.cwd(), '.god-agent', 'phd-memory', namespace.replace(/\//g, '_'));
    const filePath = path.join(memDir, `${key.replace(/\//g, '_')}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stdout = fs.readFileSync(filePath, 'utf-8');

    if (!stdout || stdout.trim() === '') {
      return null;
    }

    return JSON.parse(stdout.trim());
  } catch (error) {
    // Not found or error - return null
    if (process.env.PHD_CLI_DEBUG) {
      console.error(`[MEMORY] Failed to retrieve ${key}: ${error}`);
    }
    return null;
  }
}

/**
 * Build session state object for memory storage.
 * Creates a SessionState-compatible object from PipelineSession.
 *
 * @param session - Pipeline session from SessionManager
 * @returns SessionState for memory storage
 */
function buildSessionStateForMemory(session: {
  sessionId: string;
  query: string;
  currentPhase: number;
  currentAgentIndex: number;
  completedAgents: string[];
  startTime: number;
  lastActivityTime: number;
  status: string;
}): PhdSessionState {
  return {
    sessionId: session.sessionId,
    topic: session.query,
    currentPhase: session.currentPhase,
    currentAgentIndex: session.currentAgentIndex,
    completedAgents: [...session.completedAgents],
    startedAt: new Date(session.startTime).toISOString(),
    lastActivityAt: new Date(session.lastActivityTime).toISOString(),
    status: session.status as PhdSessionState['status'],
  };
}

// ============================================================================
// TASK-EMBED-HEALTH-001: EMBEDDING SERVICE HEALTH CHECK
// ============================================================================
// DESC episodic memory requires the embedding service at localhost:8000
// This health check warns users early if the service is unavailable

/**
 * Check if the embedding service is available at localhost:8000
 *
 * TASK-EMBED-HEALTH-001: Startup health check for embedding service.
 * DESC episodic memory requires the embedding service to function.
 *
 * @returns Promise<boolean> true if service is available
 */
async function checkEmbeddingServiceHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

    const response = await fetch('http://localhost:8000/', {
      signal: controller.signal,
      method: 'GET',
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      // api-embedder2.py returns {status: "online", model: "...", database_items: N}
      return data.status === 'online';
    }
    return false;
  } catch {
    // Network error, timeout, or service not running
    return false;
  }
}

/**
 * Display embedding service health warning if service is unavailable
 *
 * TASK-EMBED-HEALTH-001: Clear warning message with fix instructions.
 * Uses ANSI colors for visibility in terminal.
 *
 * @param verbose - Whether to display verbose output
 * @returns Promise<{ available: boolean; warned: boolean }> Health check result
 */
async function checkAndWarnEmbeddingService(verbose: boolean): Promise<{ available: boolean; warned: boolean }> {
  const isAvailable = await checkEmbeddingServiceHealth();

  if (!isAvailable) {
    // Always output warning to stderr (not stdout) to avoid breaking JSON parsing
    console.error('\n\x1b[33m========================================\x1b[0m');
    console.error('\x1b[33m  WARNING: Embedding Service Unavailable\x1b[0m');
    console.error('\x1b[33m========================================\x1b[0m');
    console.error('\x1b[31mEmbedding service not running at localhost:8000\x1b[0m');
    console.error('DESC episodic memory will NOT work.');
    console.error('PhD Pipeline agents will not have access to learned patterns.');
    console.error('');
    console.error('To start the embedding service:');
    console.error('  \x1b[36m./embedding-api/api-embed.sh start\x1b[0m');
    console.error('');
    console.error('To check status:');
    console.error('  \x1b[36m./embedding-api/api-embed.sh status\x1b[0m');
    console.error('\x1b[33m========================================\x1b[0m\n');
    return { available: false, warned: true };
  }

  if (verbose) {
    console.error('[PHD-CLI] Embedding service: online');
  }

  return { available: true, warned: false };
}

// ============================================================================
// TASK-CLI-001: AGENT FILE VALIDATION
// ============================================================================
// Implements RULE-018: Agent Key Validity - all agent keys must have corresponding .md files
// Implements RULE-001: Complete implementation with proper error handling
// Implements RULE-005: Actionable error messages (what failed, why, how to fix)

/**
 * Result of agent file validation.
 * Contains detailed information about which agent files exist and which are missing.
 */
export interface AgentValidationResult {
  /** Whether all agent files passed validation */
  valid: boolean;
  /** Total number of agents in PHD_AGENTS configuration */
  totalAgents: number;
  /** Number of agent files found on disk */
  foundAgents: number;
  /** Agent keys whose .md files are missing */
  missingAgents: string[];
  /** Agent keys whose .md files exist but are empty or malformed */
  invalidAgents: string[];
  /** Directory where agent files are expected */
  agentsDirectory: string;
  /** Detailed error messages for each issue */
  errors: string[];
}

/**
 * Validate that all 46 agent .md files exist in the agents directory.
 * Implements RULE-018: Agent Key Validity - all agent keys must have corresponding .md files.
 *
 * @returns Promise<AgentValidationResult> - Detailed validation results
 *
 * Validation checks:
 * 1. Each agent in PHD_AGENTS has a corresponding .md file at ${DEFAULT_CONFIG.agentsDirectory}/${agent.file}
 * 2. Each .md file is non-empty (at least 100 bytes - reasonable minimum for agent definition)
 * 3. Each .md file contains valid content (starts with # or ---)
 *
 * @example
 * const result = await validateAgentFiles();
 * if (!result.valid) {
 *   console.error('Missing agents:', result.missingAgents);
 *   process.exit(1);
 * }
 */
async function validateAgentFiles(): Promise<AgentValidationResult> {
  const fs = await import('fs/promises');
  const pathModule = await import('path');

  const result: AgentValidationResult = {
    valid: true,
    totalAgents: PHD_AGENTS.length,
    foundAgents: 0,
    missingAgents: [],
    invalidAgents: [],
    agentsDirectory: DEFAULT_CONFIG.agentsDirectory,
    errors: [],
  };

  // Resolve agents directory relative to project root
  const agentsDir = pathModule.resolve(process.cwd(), DEFAULT_CONFIG.agentsDirectory);

  // Check if agents directory exists
  try {
    const dirStat = await fs.stat(agentsDir);
    if (!dirStat.isDirectory()) {
      result.valid = false;
      result.errors.push(
        `[RULE-018] Agents path exists but is not a directory: ${agentsDir}. ` +
        `Expected a directory containing ${PHD_AGENTS.length} agent .md files.`
      );
      return result;
    }
  } catch (err) {
    result.valid = false;
    result.errors.push(
      `[RULE-018] Agents directory not found: ${agentsDir}. ` +
      `Create the directory and add agent .md files, or verify the path in DEFAULT_CONFIG.agentsDirectory.`
    );
    return result;
  }

  // Validate each agent file
  for (const agent of PHD_AGENTS) {
    const filePath = pathModule.join(agentsDir, agent.file);

    try {
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) {
        result.invalidAgents.push(agent.key);
        result.errors.push(
          `[RULE-018] Agent "${agent.key}": Path exists but is not a file: ${filePath}`
        );
        continue;
      }

      // Check file size - agent files should have meaningful content
      const MIN_AGENT_FILE_SIZE = 100; // bytes - reasonable minimum for agent definition
      if (stat.size < MIN_AGENT_FILE_SIZE) {
        result.invalidAgents.push(agent.key);
        result.errors.push(
          `[RULE-018] Agent "${agent.key}": File is too small (${stat.size} bytes). ` +
          `Expected at least ${MIN_AGENT_FILE_SIZE} bytes for a valid agent definition. ` +
          `File: ${filePath}`
        );
        continue;
      }

      // Read first 256 bytes to validate content structure
      const handle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(256);
      await handle.read(buffer, 0, 256, 0);
      await handle.close();

      const header = buffer.toString('utf-8').trim();

      // Agent files should start with markdown heading or YAML frontmatter
      if (!header.startsWith('#') && !header.startsWith('---')) {
        result.invalidAgents.push(agent.key);
        result.errors.push(
          `[RULE-018] Agent "${agent.key}": File does not start with valid markdown (# heading) ` +
          `or YAML frontmatter (---). File may be corrupted or have incorrect format. ` +
          `File: ${filePath}`
        );
        continue;
      }

      // File passed all checks
      result.foundAgents++;

    } catch (err) {
      // File does not exist
      result.missingAgents.push(agent.key);
      result.errors.push(
        `[RULE-018] Agent "${agent.key}": File not found at expected path: ${filePath}. ` +
        `Create the file or update the agent.file property in PHD_AGENTS configuration.`
      );
    }
  }

  // Set overall validity
  if (result.missingAgents.length > 0 || result.invalidAgents.length > 0) {
    result.valid = false;
  }

  return result;
}

// ============================================================================
// TASK-CLI-002: BUILD AGENT PROMPT FUNCTIONS
// ============================================================================
// Implements RULE-020: Complete 5-part prompts for PhD Pipeline subagents
// Implements RULE-012: TASK COMPLETION SUMMARY format
// Implements RULE-013: Workflow context with Agent #N/46, Previous, Next
// Implements RULE-025: Memory syntax with positional format
// Implements RULE-010: Single Responsibility - each helper under 50 lines

/**
 * Result of building an agent prompt with the 5-part template.
 * Contains the complete prompt along with metadata for tracing.
 */
export interface PromptBuildResult {
  /** The complete 5-part prompt string */
  prompt: string;
  /** Agent key (e.g., 'self-ask-decomposer') */
  agentKey: string;
  /** Human-readable agent name */
  agentDisplayName: string;
  /** Phase number (1-7) */
  phase: number;
  /** Memory keys to retrieve from previous agents */
  memoryRetrievalKeys: string[];
  /** Memory key to store this agent's output */
  memoryStorageKey: string;
  /** Word count of the generated prompt */
  wordCount: number;
}

/**
 * Extended session interface for prompt building operations.
 * Includes topic and session details needed for prompt generation.
 */
interface IPromptBuildSession {
  sessionId: string;
  query: string;
  currentPhase: number;
  currentAgentIndex: number;
  completedAgents: string[];
  dynamicPhase6Agents?: Array<{ key: string; phase: number }>;
  dynamicTotalAgents?: number;
}

/**
 * Build the YOUR TASK section of the 5-part prompt.
 * Contains agent-specific task from the .md file with research context.
 *
 * @param agent - Agent configuration from PHD_AGENTS
 * @param session - Current pipeline session
 * @param agentFileContent - Content read from the agent's .md file
 * @returns Formatted YOUR TASK section string
 *
 * Implements RULE-020: Section 1 of 5-part prompt
 */
function buildYourTaskSection(
  agent: PhdAgentConfig,
  session: IPromptBuildSession,
  agentFileContent: string
): string {
  const taskSection = `## YOUR TASK

${agentFileContent.trim()}

---
**Research Topic**: ${session.query}
**Session ID**: ${session.sessionId}
`;

  return taskSection;
}

/**
 * Build the WORKFLOW CONTEXT section of the 5-part prompt.
 * Shows agent position, phase info, and adjacent agents.
 *
 * @param agent - Agent configuration from PHD_AGENTS
 * @param session - Current pipeline session
 * @param agentIndex - 0-based index of current agent
 * @returns Formatted WORKFLOW CONTEXT section string
 *
 * Implements RULE-013: Agent #N/46, Previous, Next format
 * Implements RULE-020: Section 2 of 5-part prompt
 */
function buildWorkflowContextSection(
  agent: PhdAgentConfig,
  session: IPromptBuildSession,
  agentIndex: number
): string {
  const totalAgents = session.dynamicTotalAgents || PHD_PIPELINE_AGENT_COUNT;
  const phase = PHD_PHASES.find(p => p.id === agent.phase);
  const phaseName = phase?.name || getPhaseName(agent.phase);

  // Get previous agent info
  let previousAgentInfo = 'None (First Agent)';
  if (agentIndex > 0) {
    const prevAgent = getConfigAgentByIndex(agentIndex - 1);
    if (prevAgent) {
      previousAgentInfo = `${prevAgent.displayName} (${prevAgent.key})`;
    }
  }

  // Get next agent info
  let nextAgentInfo = 'Final Agent - Proceed to Phase 8';
  if (agentIndex < totalAgents - 1) {
    const nextAgent = getConfigAgentByIndex(agentIndex + 1);
    if (nextAgent) {
      nextAgentInfo = `${nextAgent.displayName} (${nextAgent.key})`;
    }
  }

  const workflowSection = `## WORKFLOW CONTEXT

**Agent**: ${agent.displayName} (Agent #${agentIndex + 1}/${totalAgents})
**Phase**: ${phaseName} (Phase ${agent.phase}/7)
**Previous Agent**: ${previousAgentInfo}
**Next Agent**: ${nextAgentInfo}
`;

  return workflowSection;
}

/**
 * Build the MEMORY RETRIEVAL section of the 5-part prompt.
 * Lists commands to retrieve data from previous agents.
 *
 * @param agent - Agent configuration with memoryKeys
 * @returns Formatted MEMORY RETRIEVAL section string
 *
 * Implements RULE-025: Memory syntax with positional format
 * Implements RULE-020: Section 3 of 5-part prompt
 */
function buildMemoryRetrievalSection(agent: PhdAgentConfig): string {
  const namespace = DEFAULT_CONFIG.memoryNamespace;

  // Build retrieval commands for each memory key the agent depends on
  const retrievalCommands = agent.memoryKeys
    .map(key => `mcp__memorygraph__recall_memories with query "${key}"`)
    .join('\n');

  const memorySection = `## MEMORY RETRIEVAL

Retrieve these keys from previous agents via MemoryGraph:
\`\`\`
${retrievalCommands || '# No memory dependencies for this agent'}
\`\`\`
`;

  return memorySection;
}

/**
 * Build the MEMORY STORAGE section of the 5-part prompt.
 * Shows the command to store this agent's outputs.
 *
 * @param agent - Agent configuration with memoryKeys
 * @returns Formatted MEMORY STORAGE section string
 *
 * Implements RULE-025: Memory syntax with positional format
 * Implements RULE-020: Section 4 of 5-part prompt
 */
function buildMemoryStorageSection(agent: PhdAgentConfig): string {
  const namespace = DEFAULT_CONFIG.memoryNamespace;
  const storageKey = agent.memoryKeys[0] || `research/output/${agent.key}`;

  const storageSection = `## MEMORY STORAGE

Store your outputs via MemoryGraph:
\`\`\`
mcp__memorygraph__store_memory with type "general", title "${storageKey}", content '<your-json-output>', tags ["phd-pipeline", "${namespace}"]
\`\`\`

**Expected Outputs**: ${agent.outputArtifacts.join(', ') || 'No specific artifacts'}
`;

  return storageSection;
}

/**
 * Build the TASK COMPLETION SUMMARY section of the 5-part prompt.
 * Defines the required output format for agent completion.
 *
 * @param agent - Agent configuration
 * @param session - Current pipeline session
 * @param nextAgentKey - Key of the next agent (or completion message)
 * @returns Formatted TASK COMPLETION SUMMARY section string
 *
 * Implements RULE-012: TASK COMPLETION SUMMARY format exactly as specified
 * Implements RULE-020: Section 5 of 5-part prompt
 */
function buildCompletionSummarySection(
  agent: PhdAgentConfig,
  session: IPromptBuildSession,
  nextAgentKey: string
): string {
  const completionSection = `## TASK COMPLETION SUMMARY

When complete, output:
\`\`\`
=== TASK COMPLETION SUMMARY ===
Agent: ${agent.key}
Status: COMPLETE | BLOCKED
Phase: ${agent.phase}
Session: ${session.sessionId}

**What I Did**: [1-2 sentence summary of work completed]

**Files Created/Modified**:
- \`path/to/file\` - Brief description

**Key Findings**: [If applicable - important discoveries or decisions made]

**Memory Stored**: ${agent.memoryKeys[0] || `research/output/${agent.key}`}

**Next Agent Guidance**: [Brief hint for ${nextAgentKey} about context they need]
=== END SUMMARY ===
\`\`\`
`;

  return completionSection;
}

/**
 * Build complete 5-part prompt for a PhD Pipeline agent.
 * Assembles all sections per RULE-020 Constitution compliance.
 *
 * @param agent - Agent configuration from PHD_AGENTS
 * @param session - Current pipeline session with topic and state
 * @param agentFileContent - Content read from agent's .md file
 * @returns PromptBuildResult with complete prompt and metadata
 *
 * Implements RULE-020: All 5 required sections must be present
 * Implements RULE-010: Single Responsibility - orchestrates helpers
 *
 * @example
 * const result = await buildAgentPrompt(agent, session, fileContent);
 * console.log(result.prompt);
 * console.log(`Word count: ${result.wordCount}`);
 */
async function buildAgentPrompt(
  agent: PhdAgentConfig,
  session: IPromptBuildSession,
  agentFileContent: string
): Promise<PromptBuildResult> {
  // Get agent index for workflow context
  const agentIndex = getConfigAgentIndex(agent.key);
  const totalAgents = session.dynamicTotalAgents || PHD_PIPELINE_AGENT_COUNT;

  // Determine next agent key for completion section
  let nextAgentKey = 'Phase 8 Orchestration';
  if (agentIndex < totalAgents - 1) {
    const nextAgent = getConfigAgentByIndex(agentIndex + 1);
    if (nextAgent) {
      nextAgentKey = nextAgent.key;
    }
  }

  // Build all 5 sections per RULE-020
  const yourTaskSection = buildYourTaskSection(agent, session, agentFileContent);
  const workflowContextSection = buildWorkflowContextSection(agent, session, agentIndex);
  const memoryRetrievalSection = buildMemoryRetrievalSection(agent);
  const memoryStorageSection = buildMemoryStorageSection(agent);
  const completionSummarySection = buildCompletionSummarySection(agent, session, nextAgentKey);

  // Assemble complete prompt
  const completePrompt = [
    yourTaskSection,
    workflowContextSection,
    memoryRetrievalSection,
    memoryStorageSection,
    completionSummarySection,
  ].join('\n---\n\n');

  // Calculate word count
  const wordCount = completePrompt.split(/\s+/).filter(word => word.length > 0).length;

  // Build result with metadata
  const result: PromptBuildResult = {
    prompt: completePrompt,
    agentKey: agent.key,
    agentDisplayName: agent.displayName,
    phase: agent.phase,
    memoryRetrievalKeys: [...agent.memoryKeys],
    memoryStorageKey: agent.memoryKeys[0] || `research/output/${agent.key}`,
    wordCount,
  };

  return result;
}

// ============================================================================
// TASK-CLI-003: GET NEXT AGENT FUNCTION
// ============================================================================
// Implements RULE-015: 99.9% Sequential execution - only return next agent in sequence
// Implements RULE-005: Actionable error messages (what failed, why, how to fix)
// Implements RULE-001: Complete implementation with proper error handling

/**
 * Result of getting the next agent in the pipeline.
 * Contains complete agent configuration, generated prompt, and metadata.
 *
 * This is the canonical return type for getNextAgent() and provides
 * all information needed to execute the next agent step.
 */
export interface NextAgentResult {
  /** Agent configuration from PHD_AGENTS */
  agent: PhdAgentConfig;

  /** Complete 5-part prompt generated by buildAgentPrompt() */
  prompt: string;

  /** 0-based index of this agent in the pipeline (0-45 for 46 agents) */
  agentIndex: number;

  /** Total number of agents in the pipeline (46 for standard, may vary with dynamic Phase 6) */
  totalAgents: number;

  /** Phase definition for this agent's phase */
  phase: PhaseDefinition;

  /** True if this is the last agent in the pipeline */
  isLastAgent: boolean;

  /** Full path to the agent's .md file */
  agentFilePath: string;
}

/**
 * Error thrown when an agent file cannot be found.
 * Provides actionable error message per RULE-005.
 */
export class AgentFileNotFoundError extends Error {
  constructor(
    public readonly agentKey: string,
    public readonly filePath: string,
    public readonly agentsDirectory: string
  ) {
    super(
      `[RULE-018] Agent file not found for "${agentKey}". ` +
      `Expected file at: ${filePath}. ` +
      `To fix: Create the file at ${filePath} OR verify agent.file property in PHD_AGENTS configuration. ` +
      `Agents directory: ${agentsDirectory}`
    );
    this.name = 'AgentFileNotFoundError';
  }
}

/**
 * Error thrown when prompt building fails.
 * Wraps underlying error with context per RULE-005.
 */
export class PromptBuildError extends Error {
  constructor(
    public readonly agentKey: string,
    public readonly phase: number,
    public readonly cause: Error
  ) {
    super(
      `[RULE-020] Failed to build prompt for agent "${agentKey}" (Phase ${phase}). ` +
      `Cause: ${cause.message}. ` +
      `To debug: Check agent file content, session state, and memory configuration.`
    );
    this.name = 'PromptBuildError';
  }
}

/**
 * Get the next agent to execute in the PhD Pipeline.
 * Implements RULE-015: Sequential execution - only returns next agent in sequence.
 *
 * @param session - Current pipeline session with state
 * @param options - Optional configuration for verbose logging
 * @returns NextAgentResult with agent config and prompt, or null if pipeline complete
 *
 * @throws {AgentFileNotFoundError} If agent .md file doesn't exist (RULE-005)
 * @throws {PromptBuildError} If prompt building fails (RULE-005)
 *
 * Pipeline Completion:
 * - Returns null when session.currentAgentIndex >= PHD_AGENTS.length (46)
 * - This indicates Phase 7 is complete and Phase 8 finalization should begin
 *
 * @example
 * const result = await getNextAgent(session, { verbose: true });
 * if (result === null) {
 *   console.log('Pipeline complete - proceed to Phase 8');
 * } else {
 *   console.log(`Next agent: ${result.agent.displayName}`);
 *   console.log(`Prompt length: ${result.prompt.length} chars`);
 * }
 */
async function getNextAgent(
  session: IPhdSession,
  options: { verbose?: boolean } = {}
): Promise<NextAgentResult | null> {
  const fs = await import('fs/promises');
  const pathModule = await import('path');

  // Determine total agents (dynamic if available, else static 46)
  const totalAgents = session.dynamicTotalAgents || PHD_PIPELINE_AGENT_COUNT;

  // RULE-015: Sequential check - if index >= total, pipeline is complete
  if (session.currentAgentIndex >= totalAgents) {
    if (options.verbose) {
      console.error(`[getNextAgent] Pipeline complete: currentAgentIndex (${session.currentAgentIndex}) >= totalAgents (${totalAgents})`);
    }
    return null;
  }

  // Get current agent index
  const agentIndex = session.currentAgentIndex;

  // Handle dynamic Phase 6 agents vs static agents
  let agent: PhdAgentConfig;

  if (session.dynamicPhase6Agents && session.dynamicPhase6Agents.length > 0) {
    // Dynamic agent routing for Phase 6
    const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

    if (agentIndex < PHASE_6_START_INDEX) {
      // Phase 1-5: use static agent from PHD_AGENTS
      const staticAgent = getConfigAgentByIndex(agentIndex);
      if (!staticAgent) {
        throw new Error(
          `[RULE-018] Invalid agent index ${agentIndex}. ` +
          `Expected index in range [0, ${PHASE_1_5_AGENT_COUNT - 1}] for Phases 1-5.`
        );
      }
      agent = staticAgent;
    } else if (agentIndex <= phase6End) {
      // Phase 6: use dynamic agent
      const phase6Index = agentIndex - PHASE_6_START_INDEX;
      const dynamicAgent = session.dynamicPhase6Agents[phase6Index];
      if (!dynamicAgent) {
        throw new Error(
          `[RULE-018] Invalid Phase 6 agent index ${phase6Index}. ` +
          `Expected index in range [0, ${session.dynamicPhase6Agents.length - 1}].`
        );
      }
      // Convert dynamic agent to PhdAgentConfig format
      agent = {
        key: dynamicAgent.key,
        displayName: dynamicAgent.key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        phase: 6,
        file: `${dynamicAgent.key.replace(/^chapter-\d+-/, '')}.md`,
        memoryKeys: [`research/writing/${dynamicAgent.key}`],
        outputArtifacts: [`${dynamicAgent.key}.md`],
      };
    } else {
      // Phase 7: map to static agents
      const phase7Offset = agentIndex - (phase6End + 1);
      const staticIndex = STATIC_PHASE_7_START_INDEX + phase7Offset;
      const staticAgent = getConfigAgentByIndex(staticIndex);
      if (!staticAgent) {
        throw new Error(
          `[RULE-018] Invalid Phase 7 agent index. Offset ${phase7Offset} from static index ${staticIndex} is out of bounds.`
        );
      }
      agent = staticAgent;
    }
  } else {
    // No dynamic agents - use standard PHD_AGENTS array
    const staticAgent = getConfigAgentByIndex(agentIndex);
    if (!staticAgent) {
      throw new Error(
        `[RULE-018] Invalid agent index ${agentIndex}. ` +
        `Expected index in range [0, ${PHD_PIPELINE_AGENT_COUNT - 1}].`
      );
    }
    agent = staticAgent;
  }

  if (options.verbose) {
    console.error(`[getNextAgent] Agent ${agentIndex + 1}/${totalAgents}: ${agent.key} (Phase ${agent.phase})`);
  }

  // Get phase definition
  const phase = getPhaseById(agent.phase);
  if (!phase) {
    throw new Error(
      `[RULE-019] Agent "${agent.key}" has invalid phase ${agent.phase}. ` +
      `Expected phase in range [1, 7]. Check PHD_AGENTS configuration.`
    );
  }

  // Build agent file path and read content
  const agentsDir = pathModule.resolve(process.cwd(), DEFAULT_CONFIG.agentsDirectory);
  const agentFilePath = pathModule.join(agentsDir, agent.file);

  let agentFileContent: string;
  try {
    agentFileContent = await fs.readFile(agentFilePath, 'utf-8');

    if (options.verbose) {
      console.error(`[getNextAgent] Read agent file: ${agentFilePath} (${agentFileContent.length} bytes)`);
    }
  } catch (err) {
    // RULE-005: Actionable error message
    throw new AgentFileNotFoundError(agent.key, agentFilePath, agentsDir);
  }

  // Build prompt session context
  const promptSession: IPromptBuildSession = {
    sessionId: session.sessionId,
    query: (session as unknown as { query: string }).query || '',
    currentPhase: session.currentPhase,
    currentAgentIndex: session.currentAgentIndex,
    completedAgents: [...session.completedAgents],
    dynamicPhase6Agents: session.dynamicPhase6Agents,
    dynamicTotalAgents: session.dynamicTotalAgents,
  };

  // Build complete 5-part prompt using buildAgentPrompt
  let promptResult: PromptBuildResult;
  try {
    promptResult = await buildAgentPrompt(agent, promptSession, agentFileContent);

    if (options.verbose) {
      console.error(`[getNextAgent] Built prompt: ${promptResult.wordCount} words`);
    }
  } catch (err) {
    // RULE-005: Wrap error with context
    throw new PromptBuildError(agent.key, agent.phase, err instanceof Error ? err : new Error(String(err)));
  }

  // Calculate if this is the last agent
  const isLastAgent = agentIndex >= totalAgents - 1;

  if (options.verbose && isLastAgent) {
    console.error(`[getNextAgent] This is the LAST agent in the pipeline`);
  }

  // Return complete NextAgentResult
  return {
    agent,
    prompt: promptResult.prompt,
    agentIndex,
    totalAgents,
    phase,
    isLastAgent,
    agentFilePath,
  };
}

// ============================================================================
// TASK-CONFIG-003: PHASE VALIDATION FUNCTIONS
// ============================================================================
// Implements RULE-019: All 46 agents must be assigned to exactly one phase (1-7)
// Implements RULE-022: Phase N must complete before Phase N+1 begins
// Implements RULE-015: 99.9% sequential execution within phases

/**
 * Phase progress information returned by getPhaseProgress
 */
interface PhaseProgress {
  /** Number of agents completed in this phase */
  completed: number;
  /** Total number of agents in this phase */
  total: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Array of completed agent keys in this phase */
  completedAgents: string[];
  /** Array of remaining agent keys in this phase */
  remainingAgents: string[];
}

/**
 * Extended session interface for phase-aware operations
 * Mirrors PipelineSession but typed for phase validation functions
 */
interface IPhdSession {
  sessionId: string;
  currentPhase: number;
  currentAgentIndex: number;
  completedAgents: string[];
  dynamicPhase6Agents?: Array<{ key: string; phase: number }>;
  dynamicTotalAgents?: number;
}

/**
 * Validate phase transition is allowed
 * Implements RULE-022: Phase N must complete before Phase N+1 begins
 *
 * @param currentPhase - Current phase number (1-7)
 * @param nextPhase - Target phase number to transition to
 * @returns true if transition is valid, false otherwise
 *
 * Valid transitions:
 * - Same phase (currentPhase === nextPhase): always allowed
 * - Next phase (nextPhase === currentPhase + 1): allowed (will be validated by isPhaseComplete)
 * - Skip phases (nextPhase > currentPhase + 1): NOT allowed (violates RULE-022)
 * - Previous phases (nextPhase < currentPhase): NOT allowed (no backward transitions)
 */
function validatePhaseTransition(currentPhase: number, nextPhase: number): boolean {
  // Validate phase ranges (1-7 for main phases, 8 for finalization)
  if (currentPhase < 1 || currentPhase > 8) {
    console.error(`[PHASE-VALIDATION] Invalid current phase: ${currentPhase}`);
    return false;
  }

  if (nextPhase < 1 || nextPhase > 8) {
    console.error(`[PHASE-VALIDATION] Invalid next phase: ${nextPhase}`);
    return false;
  }

  // Same phase transition is always valid
  if (currentPhase === nextPhase) {
    return true;
  }

  // Only allow forward transition by exactly one phase (RULE-022)
  if (nextPhase === currentPhase + 1) {
    return true;
  }

  // Disallow backward transitions and phase skipping
  if (nextPhase < currentPhase) {
    console.error(`[PHASE-VALIDATION] Backward transition not allowed: Phase ${currentPhase} -> ${nextPhase}`);
    return false;
  }

  if (nextPhase > currentPhase + 1) {
    console.error(`[PHASE-VALIDATION] Phase skipping not allowed (RULE-022): Phase ${currentPhase} -> ${nextPhase}`);
    return false;
  }

  return false;
}

/**
 * Check if all agents in a specific phase are complete
 * Implements RULE-022: Phase N must complete before Phase N+1 begins
 *
 * @param session - Pipeline session with completion state
 * @param phaseId - Phase number to check (1-7)
 * @returns true if all agents in the phase have completed
 */
function isPhaseComplete(session: IPhdSession, phaseId: number): boolean {
  // Validate phase ID
  if (phaseId < 1 || phaseId > 7) {
    console.error(`[PHASE-VALIDATION] Invalid phase ID: ${phaseId}`);
    return false;
  }

  // Get agents for the specified phase
  const phaseAgents = getCanonicalAgentsByPhase(phaseId);

  // Handle dynamic Phase 6 agents
  if (phaseId === 6 && session.dynamicPhase6Agents && session.dynamicPhase6Agents.length > 0) {
    // For dynamic Phase 6, check if all dynamic agents are completed
    const phase6AgentKeys = session.dynamicPhase6Agents.map(a => a.key);
    const completedSet = new Set(session.completedAgents);

    for (const agentKey of phase6AgentKeys) {
      if (!completedSet.has(agentKey)) {
        return false;
      }
    }
    return true;
  }

  // Check if all phase agents are in completedAgents
  const completedSet = new Set(session.completedAgents);

  for (const agent of phaseAgents) {
    if (!completedSet.has(agent.key)) {
      return false;
    }
  }

  return true;
}

/**
 * Get agent configurations for the current phase of a session
 * Supports both static (Phases 1-5, 7) and dynamic (Phase 6) agents
 *
 * @param session - Pipeline session with current phase info
 * @returns Array of AgentConfig objects for the current phase
 */
function getCurrentPhaseAgents(session: IPhdSession): PhdAgentConfig[] {
  const currentPhase = session.currentPhase;

  // Validate phase
  if (currentPhase < 1 || currentPhase > 7) {
    console.error(`[PHASE-VALIDATION] Invalid current phase: ${currentPhase}`);
    return [];
  }

  // Handle dynamic Phase 6 agents
  if (currentPhase === 6 && session.dynamicPhase6Agents && session.dynamicPhase6Agents.length > 0) {
    // Convert dynamic agents to PhdAgentConfig format
    return session.dynamicPhase6Agents.map((dynamicAgent) => ({
      key: dynamicAgent.key,
      displayName: dynamicAgent.key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      phase: 6,
      file: `${dynamicAgent.key}.md`,
      memoryKeys: [`research/writing/${dynamicAgent.key}`],
      outputArtifacts: [`${dynamicAgent.key}.md`],
    }));
  }

  // Get static agents for the phase
  const staticAgents = getCanonicalAgentsByPhase(currentPhase);

  // Convert readonly array to mutable (for return type compatibility)
  return [...staticAgents];
}

/**
 * Get detailed progress information for a specific phase
 * Shows completed vs remaining agents with percentage
 *
 * @param session - Pipeline session with completion state
 * @param phaseId - Phase number to get progress for (1-7)
 * @returns PhaseProgress object with completion details
 */
function getPhaseProgress(session: IPhdSession, phaseId: number): PhaseProgress {
  // Default empty result for invalid phases
  if (phaseId < 1 || phaseId > 7) {
    return {
      completed: 0,
      total: 0,
      percentage: 0,
      completedAgents: [],
      remainingAgents: [],
    };
  }

  // Get all agents for this phase
  let phaseAgentKeys: string[];

  if (phaseId === 6 && session.dynamicPhase6Agents && session.dynamicPhase6Agents.length > 0) {
    // Use dynamic Phase 6 agents
    phaseAgentKeys = session.dynamicPhase6Agents.map(a => a.key);
  } else {
    // Use static agents from PHD_PHASES
    const phaseAgents = getCanonicalAgentsByPhase(phaseId);
    phaseAgentKeys = phaseAgents.map(a => a.key);
  }

  // Build completion sets
  const completedSet = new Set(session.completedAgents);
  const completedInPhase: string[] = [];
  const remainingInPhase: string[] = [];

  for (const agentKey of phaseAgentKeys) {
    if (completedSet.has(agentKey)) {
      completedInPhase.push(agentKey);
    } else {
      remainingInPhase.push(agentKey);
    }
  }

  const total = phaseAgentKeys.length;
  const completed = completedInPhase.length;
  const percentage = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

  return {
    completed,
    total,
    percentage,
    completedAgents: completedInPhase,
    remainingAgents: remainingInPhase,
  };
}

/**
 * Get progress information for all phases
 * Returns array of phase progress for display in status command
 *
 * @param session - Pipeline session with completion state
 * @returns Array of PhaseProgress objects indexed by phase (0-6 for phases 1-7)
 */
function getAllPhaseProgress(session: IPhdSession): Array<{ phaseId: number; phaseName: string; progress: PhaseProgress }> {
  const results: Array<{ phaseId: number; phaseName: string; progress: PhaseProgress }> = [];

  for (let phaseId = 1; phaseId <= 7; phaseId++) {
    const phase = PHD_PHASES.find(p => p.id === phaseId);
    const progress = getPhaseProgress(session, phaseId);

    results.push({
      phaseId,
      phaseName: phase?.name || getPhaseName(phaseId),
      progress,
    });
  }

  return results;
}

/**
 * Determine the phase for a given agent index
 * Handles both static and dynamic agent configurations
 *
 * @param agentIndex - 0-based agent index
 * @param session - Optional session for dynamic Phase 6 handling
 * @returns Phase number (1-7) for the agent
 */
function getPhaseForAgentIndex(agentIndex: number, session?: IPhdSession): number {
  // Handle dynamic Phase 6 scenario
  if (session?.dynamicPhase6Agents && session.dynamicPhase6Agents.length > 0) {
    const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

    if (agentIndex < PHASE_6_START_INDEX) {
      // Phase 1-5: use static lookup
      const agent = getConfigAgentByIndex(agentIndex);
      return agent?.phase ?? 1;
    } else if (agentIndex <= phase6End) {
      // Phase 6: dynamic agents
      return 6;
    } else {
      // Phase 7: validation agents
      return 7;
    }
  }

  // Static configuration: direct lookup
  const agent = getConfigAgentByIndex(agentIndex);
  return agent?.phase ?? 1;
}

/**
 * Check if the session is ready for Phase 8 (final orchestration)
 * Phase 8 runs synthesis across all outputs after Phase 7 completion
 *
 * @param session - Pipeline session to check
 * @returns true if all Phase 1-7 agents are complete and Phase 8 can begin
 */
function isReadyForPhase8(session: IPhdSession): boolean {
  // All phases 1-7 must be complete
  for (let phaseId = 1; phaseId <= 7; phaseId++) {
    if (!isPhaseComplete(session, phaseId)) {
      return false;
    }
  }

  return true;
}

/**
 * Get canonical agent configuration by key from PHD_AGENTS (46 agents)
 * This is the preferred lookup method for agent metadata
 * @param key - Agent key (e.g., 'self-ask-decomposer')
 * @returns PhdAgentConfig from the canonical 46-agent configuration, or undefined
 */
function getCanonicalAgentByKey(key: string): PhdAgentConfig | undefined {
  return getConfigAgentByKey(key);
}

/**
 * Get canonical agents for a specific phase from PHD_AGENTS (46 agents)
 * @param phaseId - Phase number (1-7)
 * @returns Array of PhdAgentConfig for the specified phase
 */
function getCanonicalAgentsByPhase(phaseId: number): readonly PhdAgentConfig[] {
  return getConfigAgentsByPhase(phaseId);
}

/**
 * Get index of an agent in the canonical PHD_AGENTS array (46 agents)
 * @param key - Agent key to look up
 * @returns 0-based index or -1 if not found
 */
function getCanonicalAgentIndex(key: string): number {
  return getConfigAgentIndex(key);
}

/**
 * Check if an agent key exists in the canonical PHD_AGENTS configuration
 * @param key - Agent key to validate
 * @returns true if the agent exists in the 46-agent configuration
 */
function isValidCanonicalAgent(key: string): boolean {
  return getConfigAgentByKey(key) !== undefined;
}

/**
 * Get or initialize SonaEngine instance (lazy initialization)
 * Implements RULE-008: All learning data MUST persist to SQLite
 * Implements RULE-031: TrajectoryTracker MUST receive injected SonaEngine reference
 */
function getSonaEngine(): SonaEngine | null {
  if (!sonaEngine) {
    try {
      // Use production factory to ensure persistence (RULE-008, RULE-074)
      sonaEngine = createProductionSonaEngine({
        learningRate: 0.01,
        trackPerformance: true,
      });
      if (sonaEngine.isPersistenceEnabled()) {
        console.error('[PHD-CLI] SonaEngine initialized with persistence enabled');
      } else {
        console.error('[PHD-CLI] Warning: SonaEngine persistence not enabled');
      }
    } catch (error) {
      console.error(`[PHD-CLI] Failed to initialize SonaEngine: ${error}`);
      return null;
    }
  }
  return sonaEngine;
}

/**
 * Create trajectory for agent execution start
 * Implements RULE-025: TrajectoryTracker MUST call SonaEngine.createTrajectoryWithId()
 * @param sessionId - Pipeline session ID
 * @param agentKey - Agent being executed
 * @param agentIndex - Agent index in pipeline
 * @param query - Original research query
 * @returns TrajectoryID if created, null otherwise
 */
function createAgentTrajectory(
  sessionId: string,
  agentKey: string,
  agentIndex: number,
  query: string
): TrajectoryID | null {
  const engine = getSonaEngine();
  if (!engine) return null;

  try {
    // Generate trajectory ID: phd-{sessionId}-{agentIndex}-{agentKey}
    const trajectoryId: TrajectoryID = `phd-${sessionId.slice(0, 8)}-${agentIndex}-${agentKey}`;
    const route = `phd.pipeline.${agentKey}`;
    const patterns: string[] = [`agent:${agentKey}`, `phase:${Math.floor(agentIndex / 10) + 1}`];
    const context: string[] = [sessionId, query.slice(0, 100)];

    // Create trajectory with explicit ID (RULE-025)
    engine.createTrajectoryWithId(trajectoryId, route, patterns, context);

    // Store in active trajectories map for feedback later
    if (!activeTrajectories.has(sessionId)) {
      activeTrajectories.set(sessionId, new Map());
    }
    activeTrajectories.get(sessionId)!.set(agentKey, trajectoryId);

    return trajectoryId;
  } catch (error) {
    console.error(`[PHD-CLI] Failed to create trajectory for ${agentKey}: ${error}`);
    return null;
  }
}

/**
 * Record feedback for completed agent
 * Implements RULE-028: All feedback MUST be persisted before acknowledgment
 * @param sessionId - Pipeline session ID
 * @param agentKey - Agent that completed
 * @param output - Agent output (for quality assessment)
 * @param phase - Pipeline phase the agent belongs to (for context-aware quality)
 * @returns Promise<boolean> - true if feedback recorded
 */
async function recordAgentFeedback(
  sessionId: string,
  agentKey: string,
  output: unknown,
  phase?: number,
  agentIndex?: number
): Promise<boolean> {
  const engine = getSonaEngine();
  if (!engine) return false;

  // Get trajectory ID from active map (fast path)
  let trajectoryId: TrajectoryID | undefined;
  const sessionTrajectories = activeTrajectories.get(sessionId);
  if (sessionTrajectories) {
    trajectoryId = sessionTrajectories.get(agentKey);
  }

  // FIX: If not in memory map (e.g., after CLI restart), reconstruct the ID
  // Trajectory ID pattern: phd-{sessionId.slice(0,8)}-{agentIndex}-{agentKey}
  if (!trajectoryId && agentIndex !== undefined) {
    trajectoryId = `phd-${sessionId.slice(0, 8)}-${agentIndex}-${agentKey}` as TrajectoryID;
    console.error(`[PHD-CLI] Reconstructed trajectory ID: ${trajectoryId}`);

    // Verify trajectory exists in database before providing feedback
    if (!engine.hasTrajectoryInStorage(trajectoryId)) {
      console.error(`[PHD-CLI] Trajectory ${trajectoryId} not found in database`);
      return false;
    }
  }

  if (!trajectoryId) {
    console.error(`[PHD-CLI] No trajectory found for agent ${agentKey} (no agentIndex provided for reconstruction)`);
    return false;
  }

  try {
    // Calculate quality using PhDQualityCalculator with context (RULE-033, RULE-034)
    const context = createQualityContext(agentKey, phase);
    const quality = calculatePhDQuality(output, context);

    // Record feedback (RULE-028: persist before acknowledgment)
    await engine.provideFeedback(trajectoryId, quality, {
      skipAutoSave: false, // Ensure immediate persistence
    });

    // Remove from active trajectories after feedback (only if present in map)
    if (sessionTrajectories) {
      sessionTrajectories.delete(agentKey);
      if (sessionTrajectories.size === 0) {
        activeTrajectories.delete(sessionId);
      }
    }

    console.error(`[PHD-CLI] Recorded feedback for ${agentKey}: quality=${quality.toFixed(2)}`);
    return true;
  } catch (error) {
    console.error(`[PHD-CLI] Failed to record feedback for ${agentKey}: ${error}`);
    return false;
  }
}

/**
 * Assess output quality for feedback
 * Implements RULE-033, RULE-034: Quality assessment on results
 * @deprecated Use calculatePhDQuality with createQualityContext for context-aware scoring
 * @param output - The output to assess
 * @param agentKey - Optional agent key for context-aware scoring
 * @param phase - Optional phase number for context-aware scoring
 * @returns Quality score between 0.30 and 0.95
 */
function assessOutputQuality(output: unknown, agentKey?: string, phase?: number): number {
  // Delegate to PhDQualityCalculator for discriminating quality assessment
  const context = agentKey ? createQualityContext(agentKey, phase) : undefined;
  return calculatePhDQuality(output, context);
}

/**
 * Pattern insight from past learnings
 * Implements RULE-031: Use learned patterns to improve behavior
 */
interface PatternInsight {
  patternId: string;
  weight: number;
  description: string;
}

/**
 * Query top-weighted patterns for an agent route
 * Implements RULE-031: TrajectoryTracker integration with SonaEngine
 * @param agentKey - Agent key to query patterns for
 * @param limit - Maximum patterns to return (default 3)
 * @returns Array of pattern insights sorted by weight
 */
async function getTopPatternsForAgent(
  agentKey: string,
  limit: number = 3
): Promise<PatternInsight[]> {
  const engine = getSonaEngine();
  if (!engine) return [];

  try {
    const route = `phd.pipeline.${agentKey}`;
    const weightsWithIds = await engine.getWeightsWithIds(route);

    if (weightsWithIds.length === 0) {
      return [];
    }

    // Sort by weight descending, take top N
    const sorted = weightsWithIds
      .filter(w => w.weight > 0) // Only positive weights (successful patterns)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);

    // Get pattern details
    const patterns = engine.getPatterns();
    const patternMap = new Map(patterns.map(p => [p.id, p]));

    return sorted.map(({ patternId, weight }) => {
      const pattern = patternMap.get(patternId);
      return {
        patternId,
        weight,
        description: pattern?.metadata?.description ||
                     pattern?.metadata?.domain ||
                     `Pattern from ${patternId}`,
      };
    });
  } catch (error) {
    console.error(`[PHD-CLI] Failed to query patterns for ${agentKey}: ${error}`);
    return [];
  }
}

/**
 * Format pattern insights for prompt injection
 * Implements RULE-031: Close the learning loop by using past patterns
 * @param patterns - Pattern insights to format
 * @returns Formatted string for prompt injection
 */
function formatPatternsForPrompt(patterns: PatternInsight[]): string {
  if (patterns.length === 0) {
    return '';
  }

  const lines = [
    '\n## LEARNED PATTERNS (from past successful executions)',
    'The following patterns have been learned from high-quality past outputs:',
    '',
  ];

  patterns.forEach((p, i) => {
    const confidence = Math.round(p.weight * 100);
    lines.push(`${i + 1}. **${p.patternId}** (confidence: ${confidence}%)`);
    lines.push(`   ${p.description}`);
    lines.push('');
  });

  lines.push('Consider these patterns when executing your task.\n');

  return lines.join('\n');
}

/**
 * Auto-complete orphaned trajectories from previous agents
 * Implements RULE-028-AUTO: Ensure no trajectories get stuck in "active" state
 *
 * This function is called at the start of commandNext() to auto-complete any
 * trajectories that were created but never had feedback recorded (e.g., due to
 * process interruption or commandComplete() not being called).
 *
 * @param sessionId - Pipeline session ID
 * @param researchDir - Directory where agent outputs are stored
 * @param previousAgentIndex - The agent index that just completed (current - 1)
 * @param query - Original research query for context
 * @returns Number of trajectories auto-completed
 */
async function autoCompleteOrphanedTrajectories(
  sessionId: string,
  researchDir: string,
  previousAgentIndex: number,
  query: string
): Promise<number> {
  const engine = getSonaEngine();
  if (!engine) return 0;

  // Get active trajectories for this session
  const sessionTrajectories = activeTrajectories.get(sessionId);
  if (!sessionTrajectories || sessionTrajectories.size === 0) {
    return 0;
  }

  let completedCount = 0;
  const trajectoriesList = Array.from(sessionTrajectories.entries());

  for (const [agentKey, trajectoryId] of trajectoriesList) {
    try {
      // Try to find output file for this agent
      const outputResult = await tryReadAgentOutput(researchDir, previousAgentIndex, agentKey);

      let quality: number;
      let output: unknown;

      if (outputResult) {
        // Output file exists - calculate quality based on content
        output = {
          status: 'auto-completed',
          content: outputResult.content,
          output_file: outputResult.outputPath,
          auto_captured: true,
          word_count: outputResult.content.split(/\s+/).length,
        };

        // Calculate quality using PhDQualityCalculator with context
        // Estimate phase from agent index (roughly 10 agents per phase for phases 1-5)
        const estimatedPhase = Math.min(7, Math.floor(previousAgentIndex / 10) + 1);
        const context = createQualityContext(agentKey, estimatedPhase);
        quality = calculatePhDQuality(output, context);

        console.error(`[Auto-Complete] Found output for ${agentKey}: ${outputResult.outputPath} (quality: ${quality.toFixed(2)})`);
      } else {
        // No output file found - assign minimum quality for incomplete work
        output = {
          status: 'auto-completed-no-output',
          auto_captured: false,
          reason: 'No output file found during auto-completion',
        };
        quality = 0.30; // Minimum quality for missing output

        console.error(`[Auto-Complete] No output found for ${agentKey}, using minimum quality: ${quality.toFixed(2)}`);
      }

      // Record feedback with skipAutoSave: false to ensure persistence (RULE-028)
      await engine.provideFeedback(trajectoryId, quality, {
        skipAutoSave: false,
      });

      // Remove from active trajectories after feedback
      sessionTrajectories.delete(agentKey);
      completedCount++;

      console.error(`[Auto-Complete] Completed orphaned trajectory ${trajectoryId} for ${agentKey} with quality=${quality.toFixed(2)}`);
    } catch (error) {
      console.error(`[Auto-Complete] Failed to auto-complete trajectory for ${agentKey}: ${error}`);
      // Continue with other trajectories even if one fails
    }
  }

  // Clean up session entry if no more active trajectories
  if (sessionTrajectories.size === 0) {
    activeTrajectories.delete(sessionId);
  }

  if (completedCount > 0) {
    console.error(`[Auto-Complete] Auto-completed ${completedCount} orphaned trajectories for session ${sessionId.slice(0, 8)}`);
  }

  return completedCount;
}

async function getSocketClient(): Promise<SocketClient | null> {
  if (!socketClient) {
    try {
      socketClient = new SocketClient({ verbose: false });
      await socketClient.connect();
    } catch {
      // INTENTIONAL: Non-blocking - observability socket connection is optional for CLI operation
      return null;
    }
  }
  return socketClient;
}

function emitPipelineEvent(event: Omit<IActivityEvent, 'id' | 'timestamp'>): void {
  getSocketClient().then(client => {
    if (!client) return;
    try {
      const fullEvent: IActivityEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        ...event,
      };
      client.send(fullEvent);
    } catch { /* INTENTIONAL: Best-effort event emission - observability failures must not block CLI */ }
  });
}

const program = new Command();

program
  .name('phd-cli')
  .description('PhD Pipeline CLI-guided orchestration tool')
  .version('1.0.0');

// ============================================================================
// TASK-CLI-001: validate-agents command
// ============================================================================

/**
 * CLI options interface for validate-agents command
 */
interface ValidateAgentsOptions {
  /** Output as JSON (default: true) */
  json?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * validate-agents command - Validate all 46 agent .md files exist
 * [RULE-018] Agent Key Validity - all agent keys must have corresponding .md files
 *
 * Usage: phd-cli validate-agents [--verbose] [--json]
 *
 * Exit codes:
 * - 0: All agent files valid
 * - 1: One or more agent files missing or invalid
 */
program
  .command('validate-agents')
  .description('Validate all 46 agent .md files exist in the agents directory')
  .option('--verbose', 'Enable verbose logging')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (options: ValidateAgentsOptions) => {
    try {
      const result = await validateAgentFiles();

      if (options.verbose) {
        console.error(`[PHD-CLI] Validating agent files in: ${result.agentsDirectory}`);
        console.error(`[PHD-CLI] Total agents in configuration: ${result.totalAgents}`);
      }

      // Always output JSON for programmatic consumption
      console.log(JSON.stringify({
        valid: result.valid,
        totalAgents: result.totalAgents,
        foundAgents: result.foundAgents,
        missingAgents: result.missingAgents,
        invalidAgents: result.invalidAgents,
        agentsDirectory: result.agentsDirectory,
        errors: result.errors,
        summary: result.valid
          ? `All ${result.totalAgents} agent files validated successfully`
          : `Validation failed: ${result.missingAgents.length} missing, ${result.invalidAgents.length} invalid`
      }, null, 2));

      // Exit with appropriate code
      process.exit(result.valid ? 0 : 1);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * init command - Initialize new pipeline session
 * [REQ-PIPE-001]
 */
program
  .command('init <query>')
  .description('Initialize new pipeline session')
  .option('--style-profile <id>', 'Style profile ID to use')
  .option('--config <path>', 'Custom pipeline config path')
  .option('--verbose', 'Enable verbose logging')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (query: string, options: InitOptions) => {
    try {
      const response = await commandInit(query, options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Execute init command
 * [REQ-PIPE-001, REQ-PIPE-011, REQ-PIPE-020, REQ-PIPE-021, REQ-PIPE-023]
 * [RULE-018] Agent Key Validity - validates all agent files before session creation
 */
async function commandInit(
  query: string,
  options: InitOptions,
  sessionBasePath?: string
): Promise<InitResponse> {
  // [RULE-018] Validate agent files before proceeding
  // This ensures all 46 agent .md files exist before creating a session
  const agentValidation = await validateAgentFiles();
  if (!agentValidation.valid) {
    const missingCount = agentValidation.missingAgents.length;
    const invalidCount = agentValidation.invalidAgents.length;
    const errorDetail = agentValidation.errors.slice(0, 5).join('\n'); // Show first 5 errors

    throw new Error(
      `[RULE-018] Agent file validation failed: ${missingCount} missing, ${invalidCount} invalid.\n` +
      `Agents directory: ${agentValidation.agentsDirectory}\n` +
      `Missing agents: ${agentValidation.missingAgents.slice(0, 10).join(', ')}${missingCount > 10 ? ` ... and ${missingCount - 10} more` : ''}\n` +
      `Invalid agents: ${agentValidation.invalidAgents.slice(0, 10).join(', ')}${invalidCount > 10 ? ` ... and ${invalidCount - 10} more` : ''}\n` +
      `First errors:\n${errorDetail}\n` +
      `Run 'phd-cli validate-agents' for full details.\n` +
      `Fix: Ensure all agent .md files exist in ${agentValidation.agentsDirectory}/`
    );
  }

  if (options.verbose) {
    console.error(`[PHD-CLI] Agent file validation passed: ${agentValidation.foundAgents}/${agentValidation.totalAgents} agents verified`);
  }

  // TASK-EMBED-HEALTH-001: Check embedding service health at pipeline init
  // This warns users early if DESC episodic memory won't work
  // Non-blocking: pipeline continues but without DESC capabilities
  await checkAndWarnEmbeddingService(options.verbose || false);

  // [REQ-PIPE-001] Validate query
  if (!query || query.trim() === '') {
    throw new Error('Query cannot be empty');
  }

  // [REQ-PIPE-023] Generate UUID v4 session ID
  const sessionId = uuidv4();

  // Generate pipeline ID from query hash
  const pipelineId = generatePipelineId(query);

  // [REQ-PIPE-011] Determine style profile
  const styleProfileId = await determineStyleProfile(options.styleProfile);
  const styleProfile = await loadStyleProfile(styleProfileId);

  // [REQ-PIPE-020] Create and persist session using SessionManager
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();

  // Create session object [REQ-PIPE-021]
  const slug = generateSlug(query);
  const session = sessionManager.createSession(
    sessionId,
    query,
    styleProfile.metadata.id,
    pipelineId
  );
  session.slug = slug;
  session.researchDir = path.join(process.cwd(), 'docs/research', slug);

  // Persist to disk with atomic write pattern [RULE-021]
  await sessionManager.saveSession(session);

  // TASK-CLI-004: Log pipeline initialization with 46 agent count
  console.error(`[PHD-CLI] Pipeline initialized with ${PHD_PIPELINE_AGENT_COUNT} agents across ${PHD_PHASES.length} phases`);

  if (options.verbose) {
    console.error(`[DEBUG] Session created: ${sessionId}`);
    console.error(`[DEBUG] Style profile: ${styleProfile.metadata.name}`);
    console.error(`[DEBUG] Session saved to: ${sessionManager.getSessionDirectory()}`);
  }

  // TASK-CLI-004: Store initial session state to memory [RULE-021, RULE-025]
  // This enables cross-session persistence and resume capabilities
  const initialSessionState = buildSessionStateForMemory(session);
  const sessionMemoryKey = `session/${sessionId}`;

  // Store session state asynchronously (non-blocking)
  storeToMemory(sessionMemoryKey, initialSessionState).then((stored) => {
    if (stored && options.verbose) {
      console.error(`[MEMORY] Session state stored: ${sessionMemoryKey}`);
    }
  });

  // Also store session index for lookup by topic
  const sessionIndexKey = `session/index/${slug}`;
  storeToMemory(sessionIndexKey, {
    sessionId,
    topic: query,
    createdAt: new Date().toISOString(),
    status: 'running',
  }).catch(() => {
    // Silent fail for index storage
  });

  // Load first agent from pipeline config (always use project root, not session path)
  // sessionBasePath is only for session storage, not for agent definitions
  const pipelineLoader = new PipelineConfigLoader(process.cwd());
  const styleInjector = new StyleInjector(process.cwd());

  const firstAgentConfig = await pipelineLoader.getAgentByIndex(0);
  const pipelineConfig = await pipelineLoader.loadPipelineConfig();
  const totalAgentCount = pipelineConfig.agents.length;

  // Build prompt with style injection (Phase 6 only), query injection, and output context
  const prompt = await styleInjector.buildAgentPrompt(
    firstAgentConfig,
    styleProfile.metadata.id,
    query,
    { researchDir: session.researchDir!, agentIndex: 0, agentKey: firstAgentConfig.key }
  );

  // Build first agent details using pipeline loader (not hardcoded)
  const firstAgent: AgentDetails = {
    index: 0,
    key: firstAgentConfig.key,
    name: firstAgentConfig.name,
    phase: firstAgentConfig.phase,
    phaseName: getPhaseName(firstAgentConfig.phase),
    prompt,
    dependencies: firstAgentConfig.dependencies,
    timeout: firstAgentConfig.timeout,
    critical: firstAgentConfig.critical,
    expectedOutputs: firstAgentConfig.expectedOutputs
  };

  return {
    sessionId,
    pipelineId,
    query,
    styleProfile: {
      id: styleProfile.metadata.id,
      name: styleProfile.metadata.name,
      languageVariant: styleProfile.characteristics.regional?.languageVariant || 'en-GB'
    },
    totalAgents: totalAgentCount,
    agent: firstAgent
  };
}

/**
 * Determine which style profile to use
 * [REQ-PIPE-011]
 */
async function determineStyleProfile(profileId?: string): Promise<string> {
  // If profile ID provided, use it
  if (profileId) {
    return profileId;
  }

  // Otherwise, get active profile
  try {
    const spm = new StyleProfileManager();
    const activeProfile = spm.getActiveProfile();

    if (activeProfile) {
      return activeProfile.metadata.id;
    }
  } catch {
    // INTENTIONAL: StyleProfileManager may not have profiles yet - fallback to default is valid
  }

  // Fall back to a default identifier
  return 'default-academic';
}

/**
 * Load style profile by ID
 */
async function loadStyleProfile(profileId: string): Promise<StoredStyleProfile> {
  try {
    const spm = new StyleProfileManager();

    // Try to get specified profile
    const profile = spm.getProfile(profileId);
    if (profile) {
      return profile;
    }

    // Try active profile
    const activeProfile = spm.getActiveProfile();
    if (activeProfile) {
      return activeProfile;
    }
  } catch {
    // INTENTIONAL: StyleProfileManager may fail if no profiles exist - fallback to default profile
  }

  // Return minimal default profile
  return {
    metadata: {
      id: 'default-academic',
      name: 'Default Academic',
      description: 'Default UK English academic style',
      sourceType: 'text',
      sourceCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: ['academic', 'uk-english']
    },
    characteristics: {
      sentences: {
        averageLength: 25,
        lengthVariance: 8,
        shortSentenceRatio: 0.15,
        mediumSentenceRatio: 0.65,
        longSentenceRatio: 0.2,
        complexSentenceRatio: 0.3
      },
      vocabulary: {
        uniqueWordRatio: 0.7,
        averageWordLength: 5.5,
        academicWordRatio: 0.15,
        technicalTermDensity: 0.1,
        latinateWordRatio: 0.2,
        contractionUsage: 0.02
      },
      structure: {
        paragraphLengthAvg: 150,
        transitionWordDensity: 0.12,
        passiveVoiceRatio: 0.25,
        firstPersonUsage: 0.05,
        thirdPersonUsage: 0.4,
        questionFrequency: 0.02,
        listUsage: 0.05
      },
      tone: {
        formalityScore: 0.85,
        objectivityScore: 0.9,
        hedgingFrequency: 0.1,
        assertivenessScore: 0.6,
        emotionalTone: 0.1
      },
      samplePhrases: [],
      commonTransitions: ['however', 'therefore', 'moreover', 'furthermore'],
      openingPatterns: [],
      citationStyle: 'APA',
      regional: {
        languageVariant: 'en-GB',
        spellingRules: [],
        grammarRules: [],
        dateFormat: 'DD/MM/YYYY',
        primaryQuoteMark: "'"
      }
    },
    sampleTexts: []
  };
}

/**
 * Generate pipeline ID from query
 */
function generatePipelineId(query: string): string {
  // Simple hash-based ID generation
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    const char = query.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `pipeline-${Math.abs(hash).toString(16)}`;
}

/**
 * Generate research folder slug from query
 */
function generateSlug(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

/**
 * Get expected output path for an agent
 * [REQ-PIPE-025] Consistent file naming: {index:02d}-{agent-key}.md
 */
function getExpectedOutputPath(researchDir: string, agentIndex: number, agentKey: string): string {
  const paddedIndex = String(agentIndex).padStart(2, '0');
  return path.join(researchDir, `${paddedIndex}-${agentKey}.md`);
}

/**
 * Try to find and read agent output file with fallback paths
 * [REQ-PIPE-026] Auto-capture output from expected locations
 */
async function tryReadAgentOutput(
  researchDir: string,
  agentIndex: number,
  agentKey: string
): Promise<{ content: string; outputPath: string } | null> {
  const fs = await import('fs/promises');

  // Transform agent key to common file name patterns
  const baseKey = agentKey.replace(/-/g, '-');
  const keyWithoutSuffix = agentKey
    .replace(/-analyst$/, '')
    .replace(/-analyzer$/, '')
    .replace(/-hunter$/, '')
    .replace(/-manager$/, '')
    .replace(/-definer$/, '');

  // Priority order of paths to check
  const pathsToTry = [
    // Standard numbered path: 00-agent-key.md
    getExpectedOutputPath(researchDir, agentIndex, agentKey),
    // Unnumbered: agent-key.md
    path.join(researchDir, `${agentKey}.md`),
    // Common variations: *-analysis.md, *-tiers.md, etc.
    path.join(researchDir, `${keyWithoutSuffix}-analysis.md`),
    path.join(researchDir, `${keyWithoutSuffix}-tiers.md`),
    path.join(researchDir, `${keyWithoutSuffix}s.md`),
    path.join(researchDir, `${keyWithoutSuffix}.md`),
    // Legacy patterns from fourth-turning
    path.join(researchDir, `${baseKey}-analysis.md`),
    path.join(researchDir, 'risk-analysis-fmea.md'), // specific risk-analyst fallback
    // In synthesis subfolder (legacy)
    path.join(researchDir, 'synthesis', `${String(agentIndex).padStart(2, '0')}-${agentKey}.md`),
    path.join(researchDir, 'synthesis', `${agentKey}.md`),
    path.join(researchDir, 'synthesis', `${keyWithoutSuffix}.md`),
  ];

  for (const filePath of pathsToTry) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { content, outputPath: filePath };
    } catch {
      // INTENTIONAL: File doesn't exist at this path - try next location in search order
    }
  }

  return null;
}


// ============================================================================
// TASK-PIPE-004: Next Command
// ============================================================================

/**
 * next command - Get next agent details for session
 * [REQ-PIPE-002]
 */
program
  .command('next <session-id>')
  .description('Get next agent details for session')
  .option('--json', 'Output as JSON (default: true)', true)
  .option('--verbose', 'Enable verbose logging')
  .action(async (sessionId: string, options: NextOptions) => {
    try {
      const response = await commandNext(sessionId, options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Execute next command
 * [REQ-PIPE-002]
 *
 * @param sessionId - Session ID to get next agent for
 * @param options - Command options
 * @param sessionBasePath - Optional base path for session storage (for testing)
 */
async function commandNext(
  sessionId: string,
  options: NextOptions,
  sessionBasePath?: string
): Promise<NextResponse> {
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();
  const pipelineLoader = new PipelineConfigLoader();
  const styleInjector = new StyleInjector();
  const dynamicGenerator = new DynamicAgentGenerator();
  const structureLoader = new ChapterStructureLoader();

  // [REQ-PIPE-002] Load session from disk
  const session = await sessionManager.loadSession(sessionId);

  // Check session not expired
  if (sessionManager.isSessionExpired(session)) {
    throw new SessionExpiredError(sessionId);
  }

  // [RULE-028-AUTO] Auto-complete orphaned trajectories from previous agents
  // This ensures no trajectories get stuck in "active" state without quality scores
  // Must run before processing the next phase to close the learning loop
  if (session.currentAgentIndex > 0) {
    const researchDir = session.researchDir ||
      path.join(process.cwd(), 'docs/research', session.slug || generateSlug(session.query));
    const previousAgentIndex = session.currentAgentIndex - 1;

    const autoCompletedCount = await autoCompleteOrphanedTrajectories(
      sessionId,
      researchDir,
      previousAgentIndex,
      session.query
    );

    if (autoCompletedCount > 0 && options.verbose) {
      console.error(`[RULE-028-AUTO] Auto-completed ${autoCompletedCount} orphaned trajectory(ies)`);
    }
  }

  // Load static pipeline config (for legacy compatibility)
  const staticConfig = await pipelineLoader.loadPipelineConfig();

  // CRITICAL: Detect Phase 6 entry and generate dynamic agents [DYNAMIC-001, DYNAMIC-002]
  if (!session.dynamicPhase6Agents && session.currentAgentIndex >= PHASE_6_START_INDEX) {
    const slug = session.slug || generateSlug(session.query);

    try {
      // Load locked chapter structure [DYNAMIC-002]
      const chapterStructure = await structureLoader.loadChapterStructure(slug);

      // Generate dynamic Phase 6 agents [DYNAMIC-001, DYNAMIC-004]
      const styleChars = styleInjector.getStyleCharacteristics(session.styleProfileId);
      const phase6Agents = await dynamicGenerator.generatePhase6Agents(
        chapterStructure,
        styleChars,
        slug
      );

      // Calculate total [DYNAMIC-007]
      const dynamicTotal = PHASE_1_5_AGENT_COUNT + phase6Agents.length + PHASE_7_AGENT_COUNT;

      // Store in session
      session.slug = slug;
      session.chapterStructure = chapterStructure;
      session.dynamicPhase6Agents = phase6Agents;
      session.dynamicTotalAgents = dynamicTotal;

      await sessionManager.saveSession(session);

      if (options.verbose) {
        console.error(`[DEBUG] Generated ${phase6Agents.length} dynamic Phase 6 agents`);
        console.error(`[DEBUG] Total agents: ${dynamicTotal}`);
      }
    } catch (error) {
      // Chapter structure not ready - fall back to static agents
      if (options.verbose) {
        console.error(`[DEBUG] Chapter structure not found, using static agents: ${error}`);
      }
    }
  }

  // Determine total agents (dynamic if available, else static)
  const totalAgents = session.dynamicTotalAgents || staticConfig.agents.length;

  if (options.verbose) {
    console.error(`[DEBUG] Session: ${sessionId}`);
    console.error(`[DEBUG] Current agent index: ${session.currentAgentIndex}`);
    console.error(`[DEBUG] Total agents: ${totalAgents}`);
    console.error(`[DEBUG] Using dynamic agents: ${!!session.dynamicPhase6Agents}`);
  }

  // =========================================================================
  // TASK-CLI-003: Use getNextAgent() for agent resolution and prompt building
  // Implements RULE-015: Sequential execution via getNextAgent()
  // =========================================================================

  // Build session interface for getNextAgent
  const phdSession: IPhdSession = {
    sessionId: session.sessionId,
    currentPhase: session.currentPhase,
    currentAgentIndex: session.currentAgentIndex,
    completedAgents: [...session.completedAgents],
    dynamicPhase6Agents: session.dynamicPhase6Agents,
    dynamicTotalAgents: session.dynamicTotalAgents,
  };

  // Add query property to session for prompt building
  (phdSession as unknown as { query: string }).query = session.query;

  // Call getNextAgent() to get agent config and prompt
  const nextAgentResult = await getNextAgent(phdSession, { verbose: options.verbose });

  // Check if pipeline is complete (getNextAgent returns null)
  if (nextAgentResult === null) {
    const duration = Date.now() - session.startTime;
    const summary: CompletionSummary = {
      duration,
      agentsCompleted: session.completedAgents.length,
      errors: session.errors.length
    };

    return {
      sessionId: session.sessionId,
      status: 'complete',
      progress: {
        completed: totalAgents,
        total: totalAgents,
        percentage: 100,
        currentPhase: 7,
        phaseName: getPhaseName(7)
      },
      summary
    };
  }

  // Extract agent config from NextAgentResult
  const { agent: phdAgent, prompt: basePrompt, agentIndex, phase, isLastAgent, agentFilePath } = nextAgentResult;

  // Convert PhdAgentConfig to legacy AgentConfig for compatibility with existing code
  // This maintains backward compatibility with styleInjector and other components
  const agentConfig: AgentConfig = {
    key: phdAgent.key,
    name: phdAgent.displayName,
    phase: phdAgent.phase,
    order: agentIndex,
    description: '',
    dependencies: [],
    timeout: 600000,
    critical: false,
    expectedOutputs: [...phdAgent.outputArtifacts],
    inputs: [],
    outputs: [...phdAgent.outputArtifacts],
  };

  if (options.verbose) {
    console.error(`[TASK-CLI-003] Using getNextAgent() result:`);
    console.error(`  - Agent: ${phdAgent.displayName} (${phdAgent.key})`);
    console.error(`  - Phase: ${phase.name} (Phase ${phase.id})`);
    console.error(`  - Index: ${agentIndex + 1}/${totalAgents}`);
    console.error(`  - Agent File: ${agentFilePath}`);
    console.error(`  - Is Last Agent: ${isLastAgent}`);
  }

  // Use the prompt from getNextAgent() which already includes the 5-part template
  // The basePrompt includes: YOUR TASK, WORKFLOW CONTEXT, MEMORY RETRIEVAL, MEMORY STORAGE, TASK COMPLETION SUMMARY
  let prompt = basePrompt;

  // [UCM-DESC] Inject prior solutions from DESC episodic memory
  // Use PhdPipelineAdapter for phase-aware window sizes (RULE-010 to RULE-014)
  let descInjectionResult: { episodesUsed: number; episodeIds: string[]; windowSize: number } = { episodesUsed: 0, episodeIds: [], windowSize: 3 };
  try {
    const ucmClient = getUCMClient();
    if (await ucmClient.isHealthy()) {
      // Use PhdPipelineAdapter to get phase-aware window size
      const pipelineAdapter = new PhdPipelineAdapter();
      const phaseName = getPhaseName(agentConfig.phase);

      // Map numeric phase to adapter's phase detection context
      // Phase 1: Foundation -> planning (2 messages, RULE-011)
      // Phase 2: Discovery -> research (3 messages, RULE-012)
      // Phase 3-5: Architecture/Synthesis/Design -> default (3 messages, RULE-010)
      // Phase 6: Writing -> writing (5 messages, RULE-013)
      // Phase 7: Validation -> qa (10 messages, RULE-014)
      const phaseContext = {
        pipelineName: 'phd-pipeline',
        agentId: agentConfig.key,
        phase: phaseName.toLowerCase(),
        task: session.query
      };

      const windowSize = pipelineAdapter.getWindowSize(phaseContext);

      const injection = await ucmClient.injectSolutions(prompt, {
        threshold: 0.80, // Per task requirements
        maxEpisodes: windowSize,
        agentType: agentConfig.key,
        metadata: {
          sessionId: session.sessionId,
          phase: agentConfig.phase,
          phaseName,
          agentIndex: session.currentAgentIndex,
          totalAgents,
          windowSize, // Include for traceability
        },
      });

      if (injection.episodesUsed > 0) {
        prompt = injection.augmentedPrompt;
        descInjectionResult = {
          episodesUsed: injection.episodesUsed,
          episodeIds: injection.episodeIds,
          windowSize
        };

        if (options.verbose) {
          console.error(`[UCM-DESC] Injected ${injection.episodesUsed} prior solutions for ${agentConfig.key} (window: ${windowSize}, phase: ${phaseName})`);
        }
      } else if (options.verbose) {
        console.error(`[UCM-DESC] No matching episodes found for ${agentConfig.key} (window: ${windowSize}, phase: ${phaseName})`);
      }
    }
  } catch (error) {
    // DESC injection is optional - continue without it (graceful fallback)
    if (options.verbose) {
      console.error(`[UCM-DESC] Injection skipped: ${error}`);
    }
  }

  // [SONA-PATTERNS] Inject learned patterns from past successful executions
  // Queries SonaEngine for top-weighted patterns and appends to prompt
  let patternsInjectionResult: { patternsUsed: number; patternIds: string[]; totalWeight: number } = { patternsUsed: 0, patternIds: [], totalWeight: 0 };
  try {
    const patterns = await getTopPatternsForAgent(agentConfig.key, 3);
    if (patterns.length > 0) {
      const patternsPrompt = formatPatternsForPrompt(patterns);
      prompt = prompt + patternsPrompt;
      patternsInjectionResult = {
        patternsUsed: patterns.length,
        patternIds: patterns.map(p => p.patternId),
        totalWeight: patterns.reduce((sum, p) => sum + p.weight, 0),
      };

      if (options.verbose) {
        console.error(`[SONA-PATTERNS] Injected ${patterns.length} learned patterns for ${agentConfig.key} (total weight: ${patternsInjectionResult.totalWeight.toFixed(2)})`);
      }
    } else if (options.verbose) {
      console.error(`[SONA-PATTERNS] No learned patterns found for ${agentConfig.key}`);
    }
  } catch (error) {
    // Pattern injection is optional - continue without it (graceful fallback)
    if (options.verbose) {
      console.error(`[SONA-PATTERNS] Injection skipped: ${error}`);
    }
  }

  // Build AgentDetails using data from getNextAgent() result (TASK-CLI-003)
  const agentDetails: AgentDetails = {
    index: agentIndex,  // From nextAgentResult
    key: agentConfig.key,
    name: agentConfig.name,
    phase: phase.id,  // From nextAgentResult.phase
    phaseName: phase.name,  // From nextAgentResult.phase
    prompt,
    dependencies: agentConfig.dependencies,
    timeout: agentConfig.timeout,
    critical: agentConfig.critical,
    expectedOutputs: agentConfig.expectedOutputs
  };

  // Calculate progress using data from getNextAgent() result
  const progress: ProgressInfo = {
    completed: session.completedAgents.length,
    total: nextAgentResult.totalAgents,  // From nextAgentResult
    percentage: Math.round((session.completedAgents.length / nextAgentResult.totalAgents) * 1000) / 10,
    currentPhase: phase.id,  // From nextAgentResult.phase
    phaseName: phase.name  // From nextAgentResult.phase
  };

  // Update session activity time
  await sessionManager.updateActivity(session);

  // [RULE-025] Create trajectory for agent execution tracking
  const trajectoryId = createAgentTrajectory(
    session.sessionId,
    agentConfig.key,
    session.currentAgentIndex,
    session.query
  );
  if (trajectoryId) {
    console.error(`[PHD-CLI] Created trajectory ${trajectoryId} for ${agentConfig.key}`);
  }

  // Emit step_started event for dashboard observability
  emitPipelineEvent({
    component: 'pipeline',
    operation: 'step_started',
    status: 'running',
    metadata: {
      pipelineId: session.pipelineId,
      stepId: `step_${session.pipelineId}_${session.currentAgentIndex}`,
      stepName: agentConfig.key,
      stepIndex: session.currentAgentIndex,
      agentType: agentConfig.key,
      phase: getPhaseName(agentConfig.phase),
      totalSteps: totalAgents,
      progress: progress.percentage,
    },
  });

  if (options.verbose) {
    console.error(`[DEBUG] Next agent: ${agentConfig.key}`);
    console.error(`[DEBUG] Phase: ${agentConfig.phase} (${getPhaseName(agentConfig.phase)})`);
    console.error(`[DEBUG] Progress: ${progress.percentage}%`);
  }

  return {
    sessionId: session.sessionId,
    status: 'next',
    progress,
    agent: agentDetails,
    desc: descInjectionResult.episodesUsed > 0 ? {
      episodesInjected: descInjectionResult.episodesUsed,
      episodeIds: descInjectionResult.episodeIds,
      windowSize: descInjectionResult.windowSize,
    } : undefined,
    patterns: patternsInjectionResult.patternsUsed > 0 ? {
      patternsInjected: patternsInjectionResult.patternsUsed,
      patternIds: patternsInjectionResult.patternIds,
      totalWeight: patternsInjectionResult.totalWeight,
    } : undefined,
  };
}

// ============================================================================
// TASK-PIPE-005: Complete Command
// ============================================================================

/**
 * complete command - Mark agent as complete and optionally store output
 * [REQ-PIPE-003, REQ-PIPE-024]
 */
program
  .command('complete <session-id> <agent-key>')
  .description('Mark agent as complete and optionally store output')
  .option('--result <json>', 'Agent output as JSON string')
  .option('--file <path>', 'Agent output from file')
  .option('--force', 'Mark complete even without output (not recommended)')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (sessionId: string, agentKey: string, options: CompleteOptions) => {
    try {
      const response = await commandComplete(sessionId, agentKey, options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Execute complete command
 * [REQ-PIPE-003, REQ-PIPE-024]
 *
 * @param sessionId - Session ID to update
 * @param agentKey - Agent key being completed
 * @param options - Command options
 * @param sessionBasePath - Optional base path for session storage (for testing)
 */
async function commandComplete(
  sessionId: string,
  agentKey: string,
  options: CompleteOptions,
  sessionBasePath?: string
): Promise<CompleteResponse> {
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();
  const pipelineLoader = new PipelineConfigLoader();

  // Load session
  const session = await sessionManager.loadSession(sessionId);

  // Check not expired
  if (sessionManager.isSessionExpired(session)) {
    throw new SessionExpiredError(sessionId);
  }

  // Load static pipeline config
  const pipelineConfig = await pipelineLoader.loadPipelineConfig();

  // Determine total agents (dynamic if available, else static)
  const totalAgents = session.dynamicTotalAgents || pipelineConfig.agents.length;

  // Check if pipeline already complete
  if (session.currentAgentIndex >= totalAgents) {
    throw new Error('Pipeline already complete');
  }

  // Get current agent key using dynamic routing [DYNAMIC-004]
  let expectedAgentKey: string;

  if (session.dynamicPhase6Agents) {
    const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

    if (session.currentAgentIndex < PHASE_6_START_INDEX) {
      // Phase 1-5: use static agent
      const staticAgent = pipelineConfig.agents[session.currentAgentIndex];
      expectedAgentKey = staticAgent?.key || '';
    } else if (session.currentAgentIndex <= phase6End) {
      // Phase 6: use dynamic agent
      const phase6Index = session.currentAgentIndex - PHASE_6_START_INDEX;
      const dynamicAgent = session.dynamicPhase6Agents[phase6Index];
      expectedAgentKey = dynamicAgent?.key || '';
    } else {
      // Phase 7: map to static agents
      const phase7Offset = session.currentAgentIndex - (phase6End + 1);
      const staticIndex = STATIC_PHASE_7_START_INDEX + phase7Offset;
      const staticAgent = await pipelineLoader.getAgentByIndex(staticIndex);
      expectedAgentKey = staticAgent?.key || '';
    }
  } else {
    // No dynamic agents, use static
    const staticAgent = pipelineConfig.agents[session.currentAgentIndex];
    expectedAgentKey = staticAgent?.key || '';
  }

  if (!expectedAgentKey) {
    throw new Error('Pipeline already complete');
  }

  // [REQ-PIPE-003] Validate agent-key matches current agent
  if (expectedAgentKey !== agentKey) {
    throw new AgentMismatchError(expectedAgentKey, agentKey);
  }

  // [REQ-PIPE-024] Parse and store output if provided
  let output: unknown = null;

  if (options.result) {
    try {
      output = JSON.parse(options.result);
    } catch {
      // INTENTIONAL: JSON parse error - still complete agent, but warn user (logged via console.error)
      console.error(JSON.stringify({
        warning: 'Invalid JSON in --result parameter; agent marked complete without output'
      }));
    }
  } else if (options.file) {
    const fs = await import('fs/promises');
    try {
      const content = await fs.readFile(options.file, 'utf-8');
      try {
        output = JSON.parse(content);
      } catch {
        // INTENTIONAL: JSON parse error in file - warn user but still complete agent
        console.error(JSON.stringify({
          warning: 'Invalid JSON in file; agent marked complete without output'
        }));
      }
    } catch (err) {
      console.error(JSON.stringify({
        warning: `Could not read file ${options.file}; agent marked complete without output`
      }));
    }
  }

  // [REQ-PIPE-026] Auto-read output from expected location if not explicitly provided
  if (output === null) {
    // Compute researchDir from session or generate from slug
    const researchDir = session.researchDir ||
      path.join(process.cwd(), 'docs/research', session.slug || generateSlug(session.query));

    // Store researchDir in session if not already set (for legacy sessions)
    if (!session.researchDir) {
      session.researchDir = researchDir;
    }

    const autoRead = await tryReadAgentOutput(researchDir, session.currentAgentIndex, agentKey);
    if (autoRead) {
      output = {
        status: 'complete',
        content: autoRead.content,
        output_file: autoRead.outputPath,
        auto_captured: true,
        word_count: autoRead.content.split(/\s+/).length,
      };
      console.error(JSON.stringify({
        info: `[REQ-PIPE-026] Auto-captured output from: ${autoRead.outputPath}`
      }));
    } else {
      console.error(JSON.stringify({
        warning: `[REQ-PIPE-026] No output file found for ${agentKey} at index ${session.currentAgentIndex}`
      }));
    }
  }

  // Update session state - ONLY mark complete if output was captured
  // [BUG-FIX-001] Prevent state/file desync by requiring output verification
  if (output === null && !options.force) {
    // Output is required unless --force flag is used
    throw new Error(
      `[PIPELINE-ERROR] Agent "${agentKey}" cannot be marked complete: no output captured.\n` +
      `Expected output file at index ${session.currentAgentIndex} or via --result/--file options.\n` +
      `Use --force to mark complete without output (not recommended).`
    );
  }

  session.completedAgents.push(agentKey);

  if (output !== null) {
    session.agentOutputs[agentKey] = output;
  } else {
    // Log warning when --force is used without output
    console.error(JSON.stringify({
      warning: `[BUG-FIX-001] Agent "${agentKey}" marked complete without output (--force used)`
    }));
  }

  // TASK-CLI-004: Get agent config for memory key lookup
  // Uses canonical PHD_AGENTS configuration for 46-agent pipeline
  const completedAgentConfig = getCanonicalAgentByKey(agentKey);
  const agentMemoryKey = completedAgentConfig?.memoryKeys[0] || `research/output/${agentKey}`;

  // TASK-CLI-004: Store agent completion data to memory [RULE-025]
  // Store using the agent's configured memoryKey for retrieval by subsequent agents
  if (output !== null) {
    const agentCompletionData = {
      agentKey,
      phase: session.currentPhase,
      completedAt: new Date().toISOString(),
      sessionId: session.sessionId,
      output,
      outputSummary: typeof output === 'object' && output !== null
        ? (output as Record<string, unknown>).summary || (output as Record<string, unknown>).result || 'Completed'
        : String(output).substring(0, 200),
    };

    // Store to agent's memory key (non-blocking)
    storeToMemory(agentMemoryKey, agentCompletionData).then((stored) => {
      if (stored) {
        console.error(`[MEMORY] Agent output stored: ${agentMemoryKey}`);
      }
    });

    // Also store to agent-specific completion key for task completion tracking
    const completionKey = `completion/${session.sessionId}/${agentKey}`;
    storeToMemory(completionKey, {
      status: 'complete',
      agentKey,
      agentIndex: session.currentAgentIndex,
      phase: session.currentPhase,
      timestamp: Date.now(),
    }).catch(() => {
      // Silent fail for completion tracking
    });
  }

  // TASK-CONFIG-003: Track current phase BEFORE incrementing
  const previousPhase = session.currentPhase;

  // Increment to next agent
  session.currentAgentIndex += 1;

  // TASK-CONFIG-003: Calculate next phase with validation
  let nextPhase = session.currentPhase;

  // Update phase based on new index using dynamic routing
  if (session.currentAgentIndex < totalAgents) {
    if (session.dynamicPhase6Agents) {
      const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

      if (session.currentAgentIndex < PHASE_6_START_INDEX) {
        const nextAgent = pipelineConfig.agents[session.currentAgentIndex];
        nextPhase = nextAgent?.phase || session.currentPhase;
      } else if (session.currentAgentIndex <= phase6End) {
        nextPhase = 6; // Writing phase
      } else {
        nextPhase = 7; // Validation phase
      }
    } else if (session.currentAgentIndex < pipelineConfig.agents.length) {
      const nextAgent = pipelineConfig.agents[session.currentAgentIndex];
      nextPhase = nextAgent?.phase || session.currentPhase;
    }
  }

  // TASK-CONFIG-003: Validate phase transition (RULE-022)
  // Phase transitions must be sequential - no skipping phases
  if (nextPhase !== previousPhase) {
    // Validate the transition is allowed
    if (!validatePhaseTransition(previousPhase, nextPhase)) {
      console.error(`[PHASE-VALIDATION] WARNING: Invalid phase transition detected (${previousPhase} -> ${nextPhase})`);
      // In production, this should not happen as agents are ordered by phase
      // Log but continue - don't throw to avoid breaking the pipeline
    }

    // TASK-CONFIG-003: Verify current phase is complete before transitioning (RULE-022)
    if (!isPhaseComplete(session, previousPhase)) {
      console.error(`[PHASE-VALIDATION] WARNING: Phase ${previousPhase} incomplete, but transitioning to Phase ${nextPhase}`);
      // Log progress for debugging
      const progress = getPhaseProgress(session, previousPhase);
      console.error(`[PHASE-VALIDATION] Phase ${previousPhase} progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
      console.error(`[PHASE-VALIDATION] Remaining in Phase ${previousPhase}: ${progress.remainingAgents.join(', ')}`);
    } else {
      console.error(`[PHASE-VALIDATION] Phase ${previousPhase} complete. Transitioning to Phase ${nextPhase}.`);
    }
  }

  // Apply the validated phase
  session.currentPhase = nextPhase;

  // Update activity time
  session.lastActivityTime = Date.now();

  // Persist updated session
  await sessionManager.saveSession(session);

  // [RULE-028] Record feedback for completed agent BEFORE acknowledgment
  // Pass previousPhase for context-aware quality assessment (RULE-033, RULE-034)
  // Pass agentIndex for trajectory ID reconstruction after CLI restart
  const completedAgentIndex = session.currentAgentIndex - 1;
  const feedbackRecorded = await recordAgentFeedback(
    session.sessionId,
    agentKey,
    output,
    previousPhase,
    completedAgentIndex
  );
  if (feedbackRecorded) {
    console.error(`[PHD-CLI] Feedback persisted for ${agentKey}`);
  }

  // Emit step_completed event for dashboard observability
  emitPipelineEvent({
    component: 'pipeline',
    operation: 'step_completed',
    status: 'success',
    durationMs: Date.now() - session.lastActivityTime,
    metadata: {
      pipelineId: session.pipelineId,
      stepId: `step_${session.pipelineId}_${session.currentAgentIndex - 1}`,
      stepName: agentKey,
      agentType: agentKey,
      phase: getPhaseName(session.currentPhase),
      completedSteps: session.completedAgents.length,
      totalSteps: totalAgents,
      progress: Math.round((session.completedAgents.length / totalAgents) * 100),
    },
  });

  // [UCM-DESC] Store completed agent result as episode for future retrieval
  if (output !== null && typeof output === 'object') {
    try {
      const ucmClient = getUCMClient();
      if (await ucmClient.isHealthy()) {
        // Extract answer text from output (look for common summary fields)
        const outputObj = output as Record<string, unknown>;
        let answerText = '';

        if (typeof outputObj.summary === 'string') {
          answerText = outputObj.summary;
        } else if (typeof outputObj.result === 'string') {
          answerText = outputObj.result;
        } else if (typeof outputObj.output === 'string') {
          answerText = outputObj.output;
        } else if (typeof outputObj.content === 'string') {
          answerText = outputObj.content;
        } else {
          // Use JSON representation as answer
          answerText = JSON.stringify(output, null, 2);
        }

        // Get the original prompt from the current agent
        const agentConfig = session.dynamicPhase6Agents
          ? (session.currentAgentIndex - 1 < PHASE_6_START_INDEX
              ? pipelineConfig.agents[session.currentAgentIndex - 1]
              : session.dynamicPhase6Agents[session.currentAgentIndex - 1 - PHASE_6_START_INDEX])
          : pipelineConfig.agents[session.currentAgentIndex - 1];

        const queryText = agentConfig
          ? `Agent: ${agentConfig.name}\nPhase: ${getPhaseName(agentConfig.phase)}\nTask: ${session.query}`
          : `Agent: ${agentKey}\nTask: ${session.query}`;

        await ucmClient.storeEpisode(queryText, answerText, {
          sessionId: session.sessionId,
          agentKey,
          phase: session.currentPhase,
          pipelineId: session.pipelineId,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      // DESC storage is optional - continue without it
      console.error(`[UCM-DESC] Failed to store episode: ${error}`);
    }
  }

  // Determine next agent key (if any) using dynamic routing
  let nextAgentKey: string | undefined;

  if (session.currentAgentIndex < totalAgents) {
    if (session.dynamicPhase6Agents) {
      const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

      if (session.currentAgentIndex < PHASE_6_START_INDEX) {
        nextAgentKey = pipelineConfig.agents[session.currentAgentIndex]?.key;
      } else if (session.currentAgentIndex <= phase6End) {
        const phase6Index = session.currentAgentIndex - PHASE_6_START_INDEX;
        nextAgentKey = session.dynamicPhase6Agents[phase6Index]?.key;
      } else {
        const phase7Offset = session.currentAgentIndex - (phase6End + 1);
        const staticIndex = STATIC_PHASE_7_START_INDEX + phase7Offset;
        const staticAgent = await pipelineLoader.getAgentByIndex(staticIndex);
        nextAgentKey = staticAgent?.key;
      }
    } else if (session.currentAgentIndex < pipelineConfig.agents.length) {
      nextAgentKey = pipelineConfig.agents[session.currentAgentIndex]?.key;
    }
  }

  // [PHASE-8-AUTO] Check if pipeline is complete and trigger Phase 8 automatically
  // TASK-CONFIG-003: Use isReadyForPhase8 for proper validation
  const pipelineComplete = !nextAgentKey && session.currentAgentIndex >= totalAgents;
  const readyForPhase8 = isReadyForPhase8(session);

  if (pipelineComplete) {
    // TASK-CONFIG-003: Verify all phases are complete before triggering Phase 8
    if (!readyForPhase8) {
      console.error('[PHASE-VALIDATION] WARNING: Pipeline marked complete but not all phases verified complete');
      // Log which phases are incomplete
      for (let phaseId = 1; phaseId <= 7; phaseId++) {
        if (!isPhaseComplete(session, phaseId)) {
          const progress = getPhaseProgress(session, phaseId);
          console.error(`[PHASE-VALIDATION] Phase ${phaseId} incomplete: ${progress.completed}/${progress.total}`);
        }
      }
    }

    console.error('[Pipeline] All Phase 1-7 agents complete. Triggering Phase 8 (finalize)...');

    // TASK-CLI-004: Update session for Phase 8 triggering [RULE-021]
    session.lastActivityTime = Date.now();
    await sessionManager.saveSession(session);

    // TASK-CLI-004: Store session state update to memory before Phase 8
    // Build new object with phase8 status (PhdSessionState has readonly properties)
    const phase8SessionState: PhdSessionState = {
      ...buildSessionStateForMemory(session),
      status: 'phase8',
    };
    const sessionMemoryKey = `session/${session.sessionId}`;
    storeToMemory(sessionMemoryKey, phase8SessionState).then((stored) => {
      if (stored) {
        console.error(`[MEMORY] Session status updated to phase8: ${sessionMemoryKey}`);
      }
    });

    // Emit pipeline completion event
    emitPipelineEvent({
      component: 'pipeline',
      operation: 'phases_1_7_complete',
      status: 'success',
      metadata: {
        pipelineId: session.pipelineId,
        completedAgents: session.completedAgents.length,
        totalAgents,
        triggeringPhase8: true,
      },
    });

    // Extract slug from session (stored during init)
    const slug = session.slug || session.pipelineId;

    // [PHASE-8-AUTO-FIX] Execute Phase 8 FULLY AUTOMATICALLY
    // RULE-022: Phase 7 → Phase 8 automatic with full execution
    // Calls execute() which runs: MAPPING → WRITING → COMBINING → VALIDATING → COMPLETED
    try {
      const phase8Result = await executePhase8Automatically(slug, session.styleProfileId);

      if (phase8Result.success) {
        console.error('[Phase 8] COMPLETED AUTOMATICALLY');
        console.error(`[Phase 8] Chapters generated: ${phase8Result.chaptersGenerated}`);
        console.error(`[Phase 8] Total words: ${phase8Result.totalWords}`);
        console.error(`[Phase 8] Final paper: ${phase8Result.outputPath}`);

        return {
          success: true,
          nextAgent: nextAgentKey,
          pipelineComplete,
          phase8Triggered: true,
          phase8Completed: true,
          phase8Result: {
            outputPath: phase8Result.outputPath,
            chaptersGenerated: phase8Result.chaptersGenerated,
            totalWords: phase8Result.totalWords,
            totalCitations: phase8Result.totalCitations
          }
        };
      } else {
        console.error(`[Phase 8] Automatic execution failed. Warnings: ${phase8Result.warnings.join(', ')}`);
        console.error('[Phase 8] Run manually: npx tsx src/god-agent/cli/phd-cli.ts finalize --slug ' + slug);
      }
    } catch (error) {
      console.error(`[Phase 8] Automatic execution failed: ${error}`);
      console.error('[Phase 8] Run manually: npx tsx src/god-agent/cli/phd-cli.ts finalize --slug ' + slug);
    }
  }

  return {
    success: true,
    nextAgent: nextAgentKey,
    pipelineComplete,
    phase8Triggered: pipelineComplete
  };
}

/**
 * Prepare Phase 8 for Claude Code execution
 * Returns Phase8PrepareResult with prompts for Claude Code Task tool
 * Called SYNCHRONOUSLY so prompts are included in the pipeline response
 *
 * @param slug - Research session slug
 * @param styleProfileId - Optional style profile ID
 * @returns Phase8PrepareResult with chapter prompts for Claude Code
 */
async function preparePhase8ForClaudeCode(
  slug: string,
  styleProfileId?: string
): Promise<import('./final-stage/types.js').Phase8PrepareResult> {
  console.error(`[Phase 8] Preparing for Claude Code execution: ${slug}`);
  console.error('[Phase 8] Using ClaudeFlow methodology with DYNAMIC agents per chapter');

  const basePath = process.cwd();
  const orchestrator = new FinalStageOrchestrator(basePath, slug);

  // Set up progress callback
  orchestrator.onProgress((report: ProgressReport) => {
    const progress = report.total > 0 ? Math.round((report.current / report.total) * 100) : 0;
    console.error(`[Phase 8] ${report.phase}: ${report.message} (${progress}%)`);
  });

  // Call prepareForClaudeCode which:
  // - Scans research outputs
  // - Summarizes sources
  // - Maps to chapters
  // - Generates 4-part ClaudeFlow prompts
  // - Uses DYNAMIC agent assignment from dissertation-architect
  const result = await orchestrator.prepareForClaudeCode({
    force: false,
    verbose: false,
    threshold: 0.30,
    styleProfileId,
  });

  if (result.success) {
    // Write prompts to file as backup
    const promptsFilePath = path.join(basePath, 'docs', 'research', slug, 'phase8-prompts.json');
    await fs.mkdir(path.dirname(promptsFilePath), { recursive: true });
    await fs.writeFile(promptsFilePath, JSON.stringify(result, null, 2), 'utf-8');
    console.error(`[Phase 8] Prompts also saved to: ${promptsFilePath}`);
  }

  return result;
}

/**
 * Execute Phase 8 FULLY AUTOMATICALLY without manual Task tool intervention
 * [PHASE-8-AUTO-FIX] Implements RULE-022: Phase 7 → Phase 8 automatic
 *
 * This function calls the full execute() pipeline which:
 * - INITIALIZING: Loads chapter structure and style profile
 * - SCANNING: Scans for research output files from phases 1-7
 * - SUMMARIZING: Extracts summaries from all agent outputs
 * - MAPPING: Maps sources to chapters semantically
 * - WRITING: Writes all chapters using the ChapterWriterAgent
 * - COMBINING: Combines chapters into final paper via PaperCombiner
 * - VALIDATING: Validates the combined output
 * - COMPLETED: Final paper written to output path
 *
 * @param slug - Research session slug
 * @param styleProfileId - Optional style profile ID
 * @returns FinalStageResult with outputPath to final combined paper
 */
async function executePhase8Automatically(
  slug: string,
  styleProfileId?: string
): Promise<import('./final-stage/types.js').FinalStageResult> {
  console.error(`[Phase 8] AUTOMATIC EXECUTION starting for: ${slug}`);
  console.error('[Phase 8] State machine: MAPPING → WRITING → COMBINING → VALIDATING → COMPLETED');

  const basePath = process.cwd();
  const orchestrator = new FinalStageOrchestrator(basePath, slug);

  // Set up progress callback for real-time updates
  orchestrator.onProgress((report: ProgressReport) => {
    const progress = report.total > 0 ? Math.round((report.current / report.total) * 100) : 0;
    console.error(`[Phase 8] ${report.phase}: ${report.message} (${progress}%)`);
  });

  // Call execute() which runs the FULL pipeline including WRITING and COMBINING
  // This produces the final combined paper automatically
  const result = await orchestrator.execute({
    force: false,
    verbose: process.env.PHD_CLI_DEBUG === 'true',
    threshold: 0.30,
    sequential: true, // RULE-015: Sequential execution
    styleProfileId,
  });

  if (result.success && result.outputPath) {
    console.error(`[Phase 8] AUTOMATIC EXECUTION COMPLETE`);
    console.error(`[Phase 8] Final paper: ${result.outputPath}`);
    console.error(`[Phase 8] Total words: ${result.totalWords}`);
    console.error(`[Phase 8] Chapters: ${result.chaptersGenerated}`);
  }

  return result;
}

/**
 * Trigger Phase 8 finalize after pipeline completion (LEGACY - kept for backward compatibility)
 * [PHASE-8-AUTO] Automatic integration with main pipeline
 *
 * @param slug - Research session slug
 * @param styleProfileId - Optional style profile ID
 * @deprecated Use executePhase8Automatically() for full auto execution
 */
async function triggerPhase8Finalize(slug: string, styleProfileId?: string): Promise<void> {
  console.error(`[Phase 8] Starting Claude Code preparation for: ${slug}`);
  console.error('[Phase 8] Using ClaudeFlow methodology with DYNAMIC agents per chapter');

  const basePath = process.cwd();
  const orchestrator = new FinalStageOrchestrator(basePath, slug);

  // Set up progress callback
  orchestrator.onProgress((report: ProgressReport) => {
    const progress = report.total > 0 ? Math.round((report.current / report.total) * 100) : 0;
    console.error(`[Phase 8] ${report.phase}: ${report.message} (${progress}%)`);
  });

  try {
    // Use prepareForClaudeCode() which:
    // - Uses DYNAMIC agent assignment from dissertation-architect structure
    // - Generates 4-part ClaudeFlow prompts
    // - Returns Phase8PrepareResult for Claude Code Task tool execution
    const result = await orchestrator.prepareForClaudeCode({
      force: false, // Don't overwrite existing final output
      verbose: false,
      threshold: 0.30,
      styleProfileId,
    });

    if (result.success) {
      console.error('[Phase 8] SUCCESS: Preparation complete for Claude Code');
      console.error(`[Phase 8] Total chapters: ${result.totalChapters}`);
      console.error('[Phase 8] DYNAMIC agents assigned per chapter:');
      result.chapterPrompts.forEach(cp => {
        console.error(`  - Chapter ${cp.chapterNumber} (${cp.chapterTitle}): ${cp.subagentType}`);
      });

      // Write prepared prompts to file for Claude Code to consume
      const promptsFilePath = path.join(basePath, 'docs', 'research', slug, 'phase8-prompts.json');
      await fs.mkdir(path.dirname(promptsFilePath), { recursive: true });
      await fs.writeFile(promptsFilePath, JSON.stringify(result, null, 2), 'utf-8');
      console.error(`[Phase 8] Prompts written to: ${promptsFilePath}`);

      // TASK-CLI-004: Store phase 8 prep state to memory [RULE-021]
      const prepData = {
        sessionSlug: slug,
        status: 'phase8_prepared',
        preparedAt: new Date().toISOString(),
        promptsFilePath,
        totalChapters: result.totalChapters,
        agentsAssigned: result.chapterPrompts.map(cp => ({
          chapter: cp.chapterNumber,
          agent: cp.subagentType
        })),
        memoryNamespace: result.memoryNamespace,
        phase8Ready: true,
      };
      storeToMemory(`session/${slug}/phase8prep`, prepData).then((stored) => {
        if (stored) {
          console.error(`[MEMORY] Phase 8 preparation state stored for: ${slug}`);
        }
      });

      // TASK-CLI-004: Update session status to "phase8_ready" in memory
      storeToMemory(`session/${slug}`, {
        status: 'phase8_ready',
        preparedAt: new Date().toISOString(),
        phase8PromptsPath: promptsFilePath,
      }).then((stored) => {
        if (stored) {
          console.error(`[MEMORY] Session status updated to phase8_ready: ${slug}`);
        }
      });

      // Emit Phase 8 preparation event
      emitPipelineEvent({
        component: 'pipeline',
        operation: 'phase8_prepared_for_claude_code',
        status: 'success',
        metadata: {
          slug,
          promptsFilePath,
          totalChapters: result.totalChapters,
          dynamicAgents: true,
        },
      });

      console.error('');
      console.error('====================================================================');
      console.error('PHASE 8 READY FOR CLAUDE CODE TASK TOOL EXECUTION');
      console.error('====================================================================');
      console.error(`Prompts file: ${promptsFilePath}`);
      console.error('');
      console.error('Execute in Claude Code with SEQUENTIAL chapter processing:');
      console.error('For each chapter in phase8-prompts.json.chapterPrompts:');
      console.error('  1. Task(subagent_type=chapterPrompts[i].subagentType, prompt=chapterPrompts[i].prompt)');
      console.error('  2. Wait for completion before starting next chapter');
      console.error('  3. Verify output written to chapterPrompts[i].outputPath');
      console.error('====================================================================');
    } else {
      console.error(`[Phase 8] FAILED: ${result.errors?.join(', ')}`);
      console.error(`[Phase 8] Warnings: ${result.warnings?.join(', ')}`);

      // TASK-CLI-004: Store failure state to memory
      storeToMemory(`session/${slug}/phase8prep`, {
        sessionSlug: slug,
        status: 'failed',
        failedAt: new Date().toISOString(),
        errors: result.errors,
        warnings: result.warnings,
        phase8Ready: false,
      }).then((stored) => {
        if (stored) {
          console.error(`[MEMORY] Phase 8 failure state stored for: ${slug}`);
        }
      });
    }
  } catch (error) {
    console.error(`[Phase 8] Error during preparation:`, error);
    throw error;
  }
}

// ============================================================================
// TASK-PIPE-006: Status/List/Resume/Abort Commands
// ============================================================================

/**
 * status command - Show detailed session progress
 * [REQ-PIPE-004]
 */
program
  .command('status <session-id>')
  .description('Show detailed session progress')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (sessionId: string, options: StatusOptions) => {
    try {
      const response = await commandStatus(sessionId, options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Extended status response with phase-by-phase progress
 * TASK-CONFIG-003: Enhanced phase progress reporting
 */
interface ExtendedStatusResponse extends StatusResponse {
  /** Phase-by-phase progress breakdown (TASK-CONFIG-003) */
  phaseProgress?: Array<{
    phaseId: number;
    phaseName: string;
    progress: PhaseProgress;
    isComplete: boolean;
    isCurrent: boolean;
  }>;
  /** Remaining agents in current phase */
  remainingInCurrentPhase?: string[];
  /** Ready for Phase 8 finalization */
  readyForPhase8?: boolean;
}

/**
 * Execute status command
 * [REQ-PIPE-004]
 * TASK-CONFIG-003: Enhanced with phase-by-phase progress reporting
 *
 * @param sessionId - Session ID to get status for
 * @param options - Command options
 * @param sessionBasePath - Optional base path for session storage (for testing)
 */
async function commandStatus(
  sessionId: string,
  options: StatusOptions,
  sessionBasePath?: string
): Promise<ExtendedStatusResponse> {
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();
  const pipelineLoader = new PipelineConfigLoader();

  // Load session
  const session = await sessionManager.loadSession(sessionId);

  // Load pipeline config
  const pipelineConfig = await pipelineLoader.loadPipelineConfig();

  // Determine total agents (dynamic if available, else static)
  const totalAgents = session.dynamicTotalAgents || pipelineConfig.agents.length;

  // Get current agent based on dynamic routing (TASK-CONFIG-003)
  let currentAgentConfig: AgentConfig | null = null;

  if (session.currentAgentIndex < totalAgents) {
    if (session.dynamicPhase6Agents) {
      const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

      if (session.currentAgentIndex < PHASE_6_START_INDEX) {
        // Phase 1-5: use static agent
        currentAgentConfig = pipelineConfig.agents[session.currentAgentIndex];
      } else if (session.currentAgentIndex <= phase6End) {
        // Phase 6: use dynamic agent
        const phase6Index = session.currentAgentIndex - PHASE_6_START_INDEX;
        const dynamicAgent = session.dynamicPhase6Agents[phase6Index];
        currentAgentConfig = {
          ...dynamicAgent,
          order: session.currentAgentIndex,
          description: '',
          inputs: [],
          outputs: dynamicAgent.expectedOutputs || []
        };
      } else {
        // Phase 7: map to static agents
        const phase7Offset = session.currentAgentIndex - (phase6End + 1);
        const staticIndex = STATIC_PHASE_7_START_INDEX + phase7Offset;
        currentAgentConfig = pipelineConfig.agents[staticIndex];
      }
    } else {
      // No dynamic agents, use static
      currentAgentConfig = pipelineConfig.agents[session.currentAgentIndex];
    }
  }

  // Build current agent details (simplified for status)
  const currentAgent: AgentDetails = currentAgentConfig ? {
    index: session.currentAgentIndex,
    key: currentAgentConfig.key,
    name: currentAgentConfig.name,
    phase: currentAgentConfig.phase,
    phaseName: getPhaseName(currentAgentConfig.phase),
    prompt: '', // Not needed for status
    dependencies: currentAgentConfig.dependencies,
    timeout: currentAgentConfig.timeout,
    critical: currentAgentConfig.critical,
    expectedOutputs: currentAgentConfig.expectedOutputs
  } : {
    index: totalAgents,
    key: 'complete',
    name: 'Pipeline Complete',
    phase: 7,
    phaseName: getPhaseName(7),
    prompt: '',
    dependencies: [],
    timeout: 0,
    critical: false,
    expectedOutputs: []
  };

  // Calculate progress
  const completed = session.completedAgents.length;
  const percentage = Math.round((completed / totalAgents) * 1000) / 10;

  // Calculate elapsed time
  const elapsedTime = Date.now() - session.startTime;

  // Truncate query for display (200 chars)
  const displayQuery = session.query.length > 200
    ? session.query.substring(0, 197) + '...'
    : session.query;

  // TASK-CONFIG-003: Build phase-by-phase progress
  const allPhaseProgress = getAllPhaseProgress(session);
  const phaseProgressWithStatus = allPhaseProgress.map(({ phaseId, phaseName, progress }) => ({
    phaseId,
    phaseName,
    progress,
    isComplete: isPhaseComplete(session, phaseId),
    isCurrent: phaseId === session.currentPhase,
  }));

  // Get remaining agents in current phase
  const currentPhaseProgress = getPhaseProgress(session, session.currentPhase);
  const remainingInCurrentPhase = currentPhaseProgress.remainingAgents;

  // Check if ready for Phase 8
  const readyForPhase8 = isReadyForPhase8(session);

  return {
    sessionId: session.sessionId,
    pipelineId: session.pipelineId,
    query: displayQuery,
    status: session.status,
    currentPhase: currentAgent.phase,
    phaseName: currentAgent.phaseName,
    currentAgent,
    progress: {
      completed,
      total: totalAgents,
      percentage
    },
    startTime: session.startTime,
    lastActivityTime: session.lastActivityTime,
    elapsedTime,
    errors: session.errors,
    // TASK-CONFIG-003: Phase progress reporting
    phaseProgress: phaseProgressWithStatus,
    remainingInCurrentPhase,
    readyForPhase8,
  };
}

/**
 * list command - List all active/recent sessions
 * [REQ-PIPE-005]
 */
program
  .command('list')
  .description('List all active/recent sessions')
  .option('--all', 'Include completed/expired sessions')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (options: ListOptions) => {
    try {
      const response = await commandList(options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Execute list command
 * [REQ-PIPE-005]
 *
 * @param options - Command options
 * @param sessionBasePath - Optional base path for session storage (for testing)
 */
async function commandList(
  options: ListOptions,
  sessionBasePath?: string
): Promise<ListResponse> {
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();

  // Get sessions - SessionManager.listSessions already filters by default
  const sessions = await sessionManager.listSessions({
    includeAll: options.all,
    maxAgeDays: options.all ? 365 : 7 // 7 days default, 1 year if --all
  });

  // Map to session list items
  const sessionItems: SessionListItem[] = sessions.map(session => ({
    sessionId: session.sessionId,
    pipelineId: session.pipelineId,
    query: session.query.length > 50
      ? session.query.substring(0, 47) + '...'
      : session.query,
    status: session.status,
    progress: Math.round((session.completedAgents.length / PHD_PIPELINE_AGENT_COUNT) * 1000) / 10, // 46 agents from phd-pipeline-config
    startTime: session.startTime,
    lastActivityTime: session.lastActivityTime
  }));

  return {
    sessions: sessionItems,
    total: sessionItems.length
  };
}

/**
 * resume command - Resume interrupted session
 * [REQ-PIPE-006]
 */
program
  .command('resume <session-id>')
  .description('Resume interrupted session')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (sessionId: string, options: ResumeOptions) => {
    try {
      const response = await commandResume(sessionId, options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Execute resume command
 * [REQ-PIPE-006]
 *
 * @param sessionId - Session ID to resume
 * @param options - Command options
 * @param sessionBasePath - Optional base path for session storage (for testing)
 */
async function commandResume(
  sessionId: string,
  options: ResumeOptions,
  sessionBasePath?: string
): Promise<ResumeResponse> {
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();
  const pipelineLoader = new PipelineConfigLoader();
  const styleInjector = new StyleInjector();
  const dynamicGenerator = new DynamicAgentGenerator();
  const structureLoader = new ChapterStructureLoader();

  // Load session
  const session = await sessionManager.loadSession(sessionId);

  // Check not expired
  if (sessionManager.isSessionExpired(session)) {
    throw new SessionExpiredError(sessionId);
  }

  // Load static pipeline config
  const staticConfig = await pipelineLoader.loadPipelineConfig();

  // CRITICAL: Detect Phase 6 entry and generate dynamic agents [DYNAMIC-001, DYNAMIC-002]
  if (!session.dynamicPhase6Agents && session.currentAgentIndex >= PHASE_6_START_INDEX) {
    const slug = session.slug || generateSlug(session.query);

    try {
      // Load locked chapter structure [DYNAMIC-002]
      const chapterStructure = await structureLoader.loadChapterStructure(slug);

      // Generate dynamic Phase 6 agents [DYNAMIC-001, DYNAMIC-004]
      const styleChars = styleInjector.getStyleCharacteristics(session.styleProfileId);
      const phase6Agents = await dynamicGenerator.generatePhase6Agents(
        chapterStructure,
        styleChars,
        slug
      );

      // Calculate total [DYNAMIC-007]
      const dynamicTotal = PHASE_1_5_AGENT_COUNT + phase6Agents.length + PHASE_7_AGENT_COUNT;

      // Store in session
      session.slug = slug;
      session.chapterStructure = chapterStructure;
      session.dynamicPhase6Agents = phase6Agents;
      session.dynamicTotalAgents = dynamicTotal;

      await sessionManager.saveSession(session);
    } catch (error) {
      // Chapter structure not ready - fall back to static agents
      // Silent fallback for resume
    }
  }

  // Determine total agents (dynamic if available, else static)
  const totalAgents = session.dynamicTotalAgents || staticConfig.agents.length;

  // Check if pipeline is complete
  if (session.currentAgentIndex >= totalAgents) {
    throw new Error('Pipeline already complete, cannot resume');
  }

  // Get appropriate agent based on current index
  let agentConfig: AgentConfig;

  if (session.dynamicPhase6Agents) {
    const phase6End = PHASE_6_START_INDEX + session.dynamicPhase6Agents.length - 1;

    if (session.currentAgentIndex < PHASE_6_START_INDEX) {
      // Phase 1-5: use static agent
      agentConfig = await pipelineLoader.getAgentByIndex(session.currentAgentIndex);
    } else if (session.currentAgentIndex <= phase6End) {
      // Phase 6: use dynamic agent [DYNAMIC-004]
      const phase6Index = session.currentAgentIndex - PHASE_6_START_INDEX;
      const dynamicAgent = session.dynamicPhase6Agents[phase6Index];
      // Convert DynamicAgentDetails to AgentConfig
      agentConfig = {
        ...dynamicAgent,
        order: session.currentAgentIndex,
        description: dynamicAgent.prompt || '',
        inputs: [],
        outputs: dynamicAgent.expectedOutputs || []
      };
    } else {
      // Phase 7: map to static agents
      const phase7Offset = session.currentAgentIndex - (phase6End + 1);
      const staticIndex = STATIC_PHASE_7_START_INDEX + phase7Offset;
      agentConfig = await pipelineLoader.getAgentByIndex(staticIndex);
    }
  } else {
    // No dynamic agents, use static
    agentConfig = await pipelineLoader.getAgentByIndex(session.currentAgentIndex);
  }

  // Compute researchDir (handle legacy sessions without it)
  const researchDir = session.researchDir ||
    path.join(process.cwd(), 'docs/research', session.slug || generateSlug(session.query));

  // Build prompt with style injection, query injection, and output context
  const prompt = await styleInjector.buildAgentPrompt(
    agentConfig,
    session.styleProfileId,
    session.query,
    { researchDir, agentIndex: session.currentAgentIndex, agentKey: agentConfig.key }
  );

  // Build agent details
  const agentDetails: AgentDetails = {
    index: session.currentAgentIndex,
    key: agentConfig.key,
    name: agentConfig.name,
    phase: agentConfig.phase,
    phaseName: getPhaseName(agentConfig.phase),
    prompt,
    dependencies: agentConfig.dependencies,
    timeout: agentConfig.timeout,
    critical: agentConfig.critical,
    expectedOutputs: agentConfig.expectedOutputs
  };

  // Calculate progress
  const progress = {
    completed: session.completedAgents.length,
    total: totalAgents,
    percentage: Math.round((session.completedAgents.length / totalAgents) * 1000) / 10
  };

  // Update activity time
  await sessionManager.updateActivity(session);

  return {
    sessionId: session.sessionId,
    resumed: true,
    agent: agentDetails,
    progress
  };
}

/**
 * abort command - Cancel session
 * [REQ-PIPE-007]
 */
program
  .command('abort <session-id>')
  .description('Cancel session and clean up')
  .option('--force', 'Force abort without confirmation')
  .option('--json', 'Output as JSON (default: true)', true)
  .action(async (sessionId: string, options: AbortOptions) => {
    try {
      const response = await commandAbort(sessionId, options);
      console.log(JSON.stringify(response, null, 2));
      process.exit(0);
    } catch (error) {
      handleError(error);
    }
  });

/**
 * Execute abort command
 * [REQ-PIPE-007]
 *
 * @param sessionId - Session ID to abort
 * @param options - Command options
 * @param sessionBasePath - Optional base path for session storage (for testing)
 */
async function commandAbort(
  sessionId: string,
  options: AbortOptions,
  sessionBasePath?: string
): Promise<AbortResponse> {
  const sessionManager = sessionBasePath ? new SessionManager(sessionBasePath) : new SessionManager();

  // Load session
  const session = await sessionManager.loadSession(sessionId);

  // Store completed count before update
  const completedCount = session.completedAgents.length;

  // Update session status to failed
  await sessionManager.updateStatus(session, 'failed');

  return {
    sessionId: session.sessionId,
    aborted: true,
    finalStatus: 'failed',
    completedAgents: completedCount
  };
}

// ============================================================================
// TASK-003: Finalize Command (Phase 8 Final Assembly)
// ============================================================================

/**
 * CLI options interface for finalize command
 */
interface FinalizeCliOptions {
  slug: string;
  force?: boolean;
  dryRun?: boolean;
  threshold?: string;
  verbose?: boolean;
  sequential?: boolean;
  skipValidation?: boolean;
  /** Generate synthesis prompts for Claude Code instead of writing chapters */
  generatePrompts?: boolean;
  /** Style profile ID to use (overrides session lookup) */
  styleProfile?: string;
  /** Generate PDF from existing synthesized chapters (skips prompt generation) */
  generatePdf?: boolean;
}

/**
 * finalize command - Run Phase 8 final paper assembly
 * [REQ-PIPE-008] Per SPEC-FUNC-001 Section 3.1, CONSTITUTION Appendix B
 * Aliases: final, phase8
 */
program
  .command('finalize')
  .alias('final')
  .alias('phase8')
  .description('Run Phase 8 final paper assembly - generates dissertation from research outputs')
  .requiredOption('--slug <slug>', 'Research task slug (directory name)')
  .option('--force', 'Overwrite existing final/ outputs', false)
  .option('--dry-run', 'Preview mapping without generating chapters', false)
  .option('--threshold <n>', 'Semantic matching threshold 0-1 (default: 0.30)', '0.30')
  .option('--verbose', 'Enable detailed logging', false)
  .option('--sequential', 'Write chapters sequentially (safer, slower)', false)
  .option('--skip-validation', 'Skip quality validation (debug only)', false)
  .option('--generate-prompts', 'Output synthesis prompts for Claude Code agents', false)
  .option('--generate-pdf', 'Generate PDF from existing synthesized chapters', false)
  .option('--style-profile <id>', 'Style profile ID to use (overrides session lookup)')
  .action(async (options: FinalizeCliOptions) => {
    try {
      const basePath = process.cwd();
      const researchDir = path.join(basePath, 'docs', 'research', options.slug);
      const finalDir = path.join(researchDir, 'final');
      const archiveDir = path.join(researchDir, 'final-archive');

      // If --generate-prompts is set, output synthesis prompts for Claude Code
      if (options.generatePrompts) {
        const prompts = await commandGeneratePrompts(options);
        // Output prompts as JSON for Claude Code to consume
        console.log(JSON.stringify({
          success: true,
          mode: 'generate-prompts',
          totalPrompts: prompts.length,
          prompts: prompts.map(p => ({
            chapterNumber: p.chapterNumber,
            chapterTitle: p.chapterTitle,
            wordTarget: p.wordTarget,
            sections: p.sections,
            styleProfileId: p.styleProfileId,
            outputPath: p.outputPath,
            agentType: p.agentType,
            prompt: p.prompt
          }))
        }, null, 2));
        process.exit(0);
        return;
      }

      // Check for existing synthesized chapters (in archive or final/chapters)
      const findSynthesizedChapters = async (): Promise<string | null> => {
        // First check archive for most recent synthesized chapters
        try {
          const archiveExists = await fs.stat(archiveDir).then(() => true).catch(() => false);
          if (archiveExists) {
            const archiveDirs = await fs.readdir(archiveDir);
            // Sort by date descending (most recent first)
            const sortedDirs = archiveDirs.sort().reverse();
            for (const dir of sortedDirs) {
              const chaptersPath = path.join(archiveDir, dir, 'chapters');
              try {
                const files = await fs.readdir(chaptersPath);
                const chapterFiles = files.filter(f => f.startsWith('chapter-') && f.endsWith('.md'));
                if (chapterFiles.length >= 8) {
                  console.error(`[Phase 8] Found ${chapterFiles.length} synthesized chapters in archive: ${dir}`);
                  return chaptersPath;
                }
              } catch { /* continue */ }
            }
          }
        } catch { /* no archive */ }

        // Check final/chapters for chapter-X.md files (synthesized format)
        const finalChaptersPath = path.join(finalDir, 'chapters');
        try {
          const files = await fs.readdir(finalChaptersPath);
          const synthChapterFiles = files.filter(f => f.startsWith('chapter-') && f.endsWith('.md'));
          if (synthChapterFiles.length >= 8) {
            console.error(`[Phase 8] Found ${synthChapterFiles.length} synthesized chapters in final/chapters`);
            return finalChaptersPath;
          }
        } catch { /* no final/chapters */ }

        return null;
      };

      // If --generate-pdf OR checking for existing chapters
      const synthesizedChaptersPath = await findSynthesizedChapters();

      if (options.generatePdf || synthesizedChaptersPath) {
        if (!synthesizedChaptersPath) {
          console.error('[Phase 8] ERROR: No synthesized chapters found. Run Claude Code agents first.');
          console.error('[Phase 8] Use: npx tsx src/god-agent/cli/phd-cli.ts finalize --slug ' + options.slug);
          process.exit(2);
          return;
        }

        // Generate PDF from synthesized chapters
        console.error(`[Phase 8] Generating PDF from synthesized chapters...`);

        // Read all chapter files and combine using PaperCombiner
        const chapterFiles = (await fs.readdir(synthesizedChaptersPath))
          .filter(f => f.startsWith('chapter-') && f.endsWith('.md'))
          .sort((a, b) => {
            const numA = parseInt(a.match(/chapter-(\d+)/)?.[1] || '0');
            const numB = parseInt(b.match(/chapter-(\d+)/)?.[1] || '0');
            return numA - numB;
          });

        const chapters = await buildChapterOutputsFromFiles(synthesizedChaptersPath, chapterFiles);
        const combiner = new PaperCombiner();
        const metadata = combiner.generateMetadata(options.slug, chapters);
        const finalPaper = await combiner.combine(chapters, metadata);

        await fs.mkdir(finalDir, { recursive: true });
        await combiner.writeOutputFiles(finalPaper, finalDir, { generatePdf: options.generatePdf });

        const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
        const finalPaperPath = path.join(finalDir, 'final-paper.md');
        console.error(`[Phase 8] Combined paper written: ${finalPaperPath} (${totalWords} words)`);

        // Convert to HTML using pandoc
        const htmlPath = path.join(finalDir, 'final-paper.html');
        const pdfPath = path.join(finalDir, 'final-paper.pdf');

        try {
          const { execSync } = await import('child_process');
          execSync(`pandoc "${finalPaperPath}" -o "${htmlPath}" --standalone --toc --metadata title="Research Paper"`, {
            stdio: ['pipe', 'pipe', 'pipe']
          });
          console.error(`[Phase 8] HTML generated: ${htmlPath}`);

          // Try to generate PDF using playwright
          try {
            const playwrightScript = path.join(basePath, 'scripts', 'html-to-pdf.mjs');
            execSync(`node "${playwrightScript}" "${htmlPath}" "${pdfPath}"`, {
              stdio: ['pipe', 'pipe', 'pipe']
            });
            console.error(`[Phase 8] PDF generated: ${pdfPath}`);
          } catch (pdfErr) {
            console.error(`[Phase 8] PDF generation failed (playwright not available), HTML output available`);
          }
        } catch (pandocErr) {
          console.error(`[Phase 8] Pandoc conversion failed, markdown output available`);
        }

        console.log(JSON.stringify({
          success: true,
          mode: 'generate-pdf',
          outputPath: pdfPath,
          markdownPath: finalPaperPath,
          totalWords,
          chaptersProcessed: chapterFiles.length
        }, null, 2));
        process.exit(0);
        return;
      }

      // DEFAULT: Prepare prompts for Claude Code LLM synthesis
      // This outputs phase8-prompts.json for Claude Code Task tool execution
      console.error('[Phase 8] No synthesized chapters found. Generating synthesis prompts...');
      const result = await commandPrepareForClaudeCode(options);
      // Output Phase8PrepareResult as JSON for Claude Code Task tool execution
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      handleFinalizeError(error);
    }
  });

// ============================================================================
// COMBINE COMMAND - Assemble chapters into final paper via PaperCombiner
// ============================================================================

/**
 * Build ChapterWriterOutput[] from chapter markdown files on disk.
 * Parses headings, word counts, and inline citations to construct
 * the typed objects that PaperCombiner.combine() expects.
 */
async function buildChapterOutputsFromFiles(
  chaptersDir: string,
  chapterFiles: string[]
): Promise<ChapterWriterOutput[]> {
  const chapters: ChapterWriterOutput[] = [];

  for (const file of chapterFiles) {
    const chapterNum = parseInt(file.match(/chapter-(\d+)/)?.[1] || '0');
    if (chapterNum < 1 || chapterNum > 12) continue;

    const content = await fs.readFile(path.join(chaptersDir, file), 'utf-8');
    const words = content.split(/\s+/).filter(w => w.length > 0);

    // Extract title from first H1 heading
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : `Chapter ${chapterNum}`;

    // Extract sections from H2 headings
    const sectionPattern = /^##\s+(\d+\.\d+)?\s*(.+)/gm;
    const sections: { id: string; title: string; wordCount: number }[] = [];
    let sMatch;
    while ((sMatch = sectionPattern.exec(content)) !== null) {
      sections.push({
        id: sMatch[1] || `${chapterNum}.${sections.length + 1}`,
        title: sMatch[2].trim(),
        wordCount: 0
      });
    }

    // Extract inline citations — pattern: (Author, Year) or (Author et al., Year)
    const citationPattern = /\(([A-Z][a-zA-Z\s&.,]+(?:et al\.)?,\s*\d{4}[a-z]?(?:;\s*[A-Z][a-zA-Z\s&.,]+(?:et al\.)?,\s*\d{4}[a-z]?)*)\)/g;
    const citations: { raw: string; parsed: null }[] = [];
    const seenCitations = new Set<string>();
    let cMatch;
    while ((cMatch = citationPattern.exec(content)) !== null) {
      const raw = cMatch[1].trim();
      if (!seenCitations.has(raw)) {
        seenCitations.add(raw);
        citations.push({ raw, parsed: null });
      }
    }

    chapters.push({
      chapterNumber: chapterNum as ChapterNumber,
      title,
      content,
      wordCount: words.length,
      citations,
      crossReferences: [],
      sections,
      qualityMetrics: {
        wordCountCompliance: 1.0,
        citationCount: citations.length,
        uniqueSourcesUsed: citations.length,
        styleViolations: 0
      },
      generationStatus: 'success',
      warnings: [],
      tokensUsed: 0
    });
  }

  return chapters;
}

program
  .command('combine')
  .description('Combine chapter files into final paper with ToC, title page, and consolidated references')
  .requiredOption('--slug <slug>', 'Research task slug (directory name)')
  .option('--no-pdf', 'Skip PDF generation')
  .option('--verbose', 'Enable detailed logging', false)
  .action(async (options: { slug: string; pdf: boolean; verbose: boolean }) => {
    try {
      const basePath = process.cwd();
      const finalDir = path.join(basePath, 'docs', 'research', options.slug, 'final');
      const chaptersDir = path.join(finalDir, 'chapters');

      // Read chapter files
      let files: string[];
      try {
        files = (await fs.readdir(chaptersDir))
          .filter(f => f.startsWith('chapter-') && f.endsWith('.md'))
          .sort((a, b) => {
            const numA = parseInt(a.match(/chapter-(\d+)/)?.[1] || '0');
            const numB = parseInt(b.match(/chapter-(\d+)/)?.[1] || '0');
            return numA - numB;
          });
      } catch {
        console.error(`[combine] ERROR: No chapters directory found at ${chaptersDir}`);
        process.exit(2);
        return;
      }

      if (files.length === 0) {
        console.error(`[combine] ERROR: No chapter-*.md files found in ${chaptersDir}`);
        process.exit(2);
        return;
      }

      console.error(`[combine] Found ${files.length} chapters in ${chaptersDir}`);

      const chapters = await buildChapterOutputsFromFiles(chaptersDir, files);
      const combiner = new PaperCombiner();
      const metadata = combiner.generateMetadata(options.slug, chapters);
      const finalPaper = await combiner.combine(chapters, metadata);

      await combiner.writeOutputFiles(finalPaper, finalDir, { generatePdf: options.pdf });

      const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
      const totalCitations = new Set(chapters.flatMap(c => c.citations.map(ci => ci.raw))).size;

      console.error(`[combine] Final paper written to ${path.join(finalDir, 'final-paper.md')}`);
      console.error(`[combine] ${files.length} chapters | ${totalWords.toLocaleString()} words | ${totalCitations} unique citations`);

      console.log(JSON.stringify({
        success: true,
        outputPath: path.join(finalDir, 'final-paper.md'),
        chaptersProcessed: files.length,
        totalWords,
        totalCitations
      }, null, 2));

      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[combine] ERROR: ${message}`);
      console.log(JSON.stringify({ success: false, error: message }));
      process.exit(1);
    }
  });

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 0) return 'unknown';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Create a simple progress bar
 */
function createProgressBar(progress: number, width: number = 20): string {
  const filled = Math.floor((progress / 100) * width);
  const empty = width - filled;
  return '[' + '='.repeat(filled) + (filled < width ? '>' : '') + ' '.repeat(Math.max(0, empty - 1)) + ']';
}

/**
 * Execute finalize command
 * [REQ-PIPE-008] Per SPEC-FUNC-001 Section 3.1
 *
 * Exit Codes per CONSTITUTION Appendix B:
 * 0 - SUCCESS: All phases completed successfully
 * 1 - GENERAL_ERROR: Unspecified error
 * 2 - MISSING_FILES: Required input files missing
 * 3 - TOKEN_OVERFLOW: Context limit exceeded
 * 4 - MAPPING_FAILURE: Chapter with zero sources
 * 5 - VALIDATION_FAILURE: Output quality validation failed
 * 6 - SECURITY_VIOLATION: SE-xxx rule violated
 * 7 - CONSTITUTION_VIOLATION: Critical DI-xxx or FS-xxx rule violated
 *
 * @param cliOptions - Command line options
 * @returns FinalStageResult with output details
 */
async function commandFinalize(cliOptions: FinalizeCliOptions): Promise<FinalStageResult> {
  const basePath = process.cwd();

  // Parse threshold (string from CLI to number)
  const threshold = parseFloat(cliOptions.threshold ?? '0.30');
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Threshold must be a number between 0 and 1');
  }

  // Create orchestrator
  const orchestrator = new FinalStageOrchestrator(basePath, cliOptions.slug);

  // Track last phase for progress display
  let lastPhase = '';
  let phaseStartTime = Date.now();

  // Set up progress callback [EX-004]
  orchestrator.onProgress((report: ProgressReport) => {
    // Detect phase change
    if (report.phase !== lastPhase) {
      if (lastPhase && cliOptions.verbose) {
        // Print phase completion
        const phaseDuration = Date.now() - phaseStartTime;
        console.error(`  Completed in ${formatDuration(phaseDuration)}`);
        console.error('');
      }
      lastPhase = report.phase;
      phaseStartTime = Date.now();

      // Print new phase header
      if (cliOptions.verbose) {
        console.error(`Phase: ${report.phase}`);
      }
    }

    if (cliOptions.verbose) {
      // Verbose mode: detailed output per SPEC-FUNC-001 Section 4.3
      const progressStr = report.current >= 0 && report.total >= 0
        ? ` (${report.current}/${report.total})`
        : '';

      // Calculate phase progress percentage
      let phaseProgress = 0;
      if (report.current >= 0 && report.total > 0) {
        phaseProgress = Math.round((report.current / report.total) * 100);
      }

      // Calculate overall progress using milestones (for future use in estimated time)
      const milestone = PROGRESS_MILESTONES[report.phase as FinalStageState];
      if (milestone) {
        const phaseRange = milestone.end - milestone.start;
        // Could be used for estimated remaining time calculation
        const _overallProgress = milestone.start + (phaseRange * (phaseProgress / 100));
        void _overallProgress; // Suppress unused warning
      }

      const progressBar = createProgressBar(phaseProgress);
      const elapsed = formatDuration(report.elapsedMs);

      console.error(`  ${progressBar} ${phaseProgress}%${progressStr}`);
      console.error(`  ${report.message}`);
      console.error(`  Elapsed: ${elapsed}`);
    } else {
      // Simple mode: just dots
      process.stdout.write('.');
    }
  });

  // Build orchestrator options
  const options: FinalStageOptions = {
    force: cliOptions.force ?? false,
    dryRun: cliOptions.dryRun ?? false,
    threshold,
    verbose: cliOptions.verbose ?? false,
    sequential: cliOptions.sequential ?? false,
    skipValidation: cliOptions.skipValidation ?? false
  };

  // Emit pipeline event for observability
  emitPipelineEvent({
    component: 'pipeline',
    operation: 'phase8_started',
    status: 'running',
    metadata: {
      slug: cliOptions.slug,
      options: {
        force: options.force,
        dryRun: options.dryRun,
        threshold: options.threshold,
        sequential: options.sequential
      }
    }
  });

  // Execute Phase 8
  const result = await orchestrator.execute(options);

  // Emit completion event
  emitPipelineEvent({
    component: 'pipeline',
    operation: 'phase8_completed',
    status: result.success ? 'success' : 'error',
    metadata: {
      slug: cliOptions.slug,
      success: result.success,
      exitCode: result.exitCode,
      chaptersGenerated: result.chaptersGenerated,
      totalWords: result.totalWords,
      totalCitations: result.totalCitations,
      warningCount: result.warnings.length,
      errorCount: result.errors.length
    }
  });

  // Verbose output for success/failure
  if (cliOptions.verbose) {
    console.error(''); // Newline after progress dots

    if (result.success) {
      console.error('='.repeat(60));
      console.error('[SUCCESS] Final paper generated');
      console.error('='.repeat(60));
      console.error('');
      console.error(`  Output: ${result.outputPath}`);
      console.error(`  Total words: ${result.totalWords?.toLocaleString() ?? 0}`);
      console.error(`  Total citations: ${result.totalCitations ?? 0}`);
      console.error(`  Chapters generated: ${result.chaptersGenerated}`);

      // Show phase timings
      const phaseTimings = orchestrator.getPhaseTimings();
      if (Object.keys(phaseTimings).length > 0) {
        console.error('');
        console.error('Phase Timings:');
        for (const [key, value] of Object.entries(phaseTimings)) {
          if (key.endsWith('_duration')) {
            const phaseName = key.replace('_duration', '');
            console.error(`  ${phaseName}: ${formatDuration(value)}`);
          }
        }
      }

      // Show token usage
      const tokenBudget = orchestrator.getTokenBudget();
      if (tokenBudget) {
        console.error('');
        console.error(`Token Usage: ${tokenBudget.total.used.toLocaleString()} / ${tokenBudget.total.budget.toLocaleString()} (${tokenBudget.total.utilization})`);
      }

      if (result.warnings.length > 0) {
        console.error('');
        console.error(`Warnings (${result.warnings.length}):`);
        for (const warning of result.warnings) {
          console.error(`  - ${warning}`);
        }
      }
    } else {
      console.error('='.repeat(60));
      console.error(`[FAILED] Exit code: ${result.exitCode}`);
      console.error('='.repeat(60));
      for (const err of result.errors) {
        console.error(`  Error: ${err}`);
      }
    }
  } else if (!cliOptions.verbose) {
    // End the dots line for non-verbose mode
    console.log('');
  }

  return result;
}

/**
 * Generate synthesis prompts for Claude Code to spawn chapter-synthesizer agents
 *
 * This is the PREFERRED method for high-quality chapter generation.
 * Instead of basic concatenation, it outputs prompts that Claude Code
 * uses to spawn the chapter-synthesizer agent for each chapter.
 *
 * @param cliOptions - Command line options
 * @returns Array of synthesis prompts for Claude Code Task tool
 */
async function commandGeneratePrompts(
  cliOptions: FinalizeCliOptions
): Promise<import('./final-stage/chapter-writer-agent.js').ChapterSynthesisPrompt[]> {
  const basePath = process.cwd();
  const threshold = parseFloat(cliOptions.threshold ?? '0.30');

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Threshold must be a number between 0 and 1');
  }

  console.error('[Phase 8 - Generate Prompts] Initializing...');

  // Find session to get style profile ID
  const sessionManager = new SessionManager();
  const sessions = await sessionManager.listSessions();
  const matchingSession = sessions.find(
    (s: { slug?: string; query?: string; styleProfileId?: string }) =>
      s.slug === cliOptions.slug ||
      s.query?.toLowerCase().includes(cliOptions.slug.toLowerCase().replace(/-/g, ' '))
  );

  // Use explicitly passed style profile, or fall back to session lookup
  const styleProfileId = cliOptions.styleProfile || matchingSession?.styleProfileId;
  if (styleProfileId) {
    const source = cliOptions.styleProfile ? 'CLI option' : 'session';
    console.error(`[Phase 8] Using style profile: ${styleProfileId} (from ${source})`);
  } else {
    console.error('[Phase 8] WARNING: No style profile found - using UK English defaults');
  }

  // Create orchestrator (styleProfileId passed to execute())
  const orchestrator = new FinalStageOrchestrator(
    basePath,
    cliOptions.slug
  );

  // Initialize and run scanning/mapping phases
  console.error('[Phase 8] Scanning and mapping research outputs...');
  // Run dry-run mode which executes SCANNING -> SUMMARIZING -> MAPPING phases
  // This populates the cached structure, summaries, and mapping
  const dryRunResult = await orchestrator.execute({
    dryRun: true,
    force: cliOptions.force ?? false,
    verbose: cliOptions.verbose ?? false,
    threshold,
    styleProfileId
  });

  if (!dryRunResult.success) {
    throw new Error(`Dry run failed: ${dryRunResult.errors?.join(', ') || 'unknown error'}`);
  }

  // Get the internal data we need
  const structure = orchestrator.getChapterStructure();
  const summaries = orchestrator.getSummaries();
  const mapping = orchestrator.getMapping();

  if (!structure || !summaries || !mapping) {
    throw new Error('Failed to initialize - missing structure, summaries, or mapping');
  }

  // Generate synthesis prompts
  console.error(`[Phase 8] Generating ${structure.totalChapters} synthesis prompts...`);
  const prompts = await orchestrator.generateSynthesisPrompts(structure, summaries, mapping);

  console.error('[Phase 8] Prompts generated successfully');
  console.error('');
  console.error('Use these prompts with Claude Code Task tool to spawn chapter-synthesizer agents.');

  return prompts;
}

/**
 * Prepare Phase 8 for Claude Code Task tool execution
 * Uses DYNAMIC agent assignment from dissertation-architect structure
 *
 * Per ClaudeFlow methodology from /docs2/claudeflow.md:
 * - 4-part prompt pattern (YOUR TASK, WORKFLOW CONTEXT, MEMORY RETRIEVAL, MEMORY STORAGE)
 * - 99.9% sequential execution (one chapter at a time)
 * - Each chapter uses its specialized writing agent from dissertation structure
 *
 * @param cliOptions - CLI options including slug and threshold
 * @returns Phase8PrepareResult with prompts for Claude Code Task tool execution
 */
async function commandPrepareForClaudeCode(
  cliOptions: FinalizeCliOptions
): Promise<import('./final-stage/types.js').Phase8PrepareResult> {
  const basePath = process.cwd();
  const threshold = parseFloat(cliOptions.threshold ?? '0.30');

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    return {
      success: false,
      slug: cliOptions.slug,
      basePath,
      finalOutputDir: '',
      totalChapters: 0,
      chapterPrompts: [],
      scanSummary: { totalFiles: 0, foundFiles: 0, missingFiles: [] },
      mappingSummary: { algorithm: '', threshold: 0, orphanedSources: [], coverage: 0 },
      errors: ['Threshold must be a number between 0 and 1'],
      warnings: [],
      memoryNamespace: '',
      executionInstructions: ''
    };
  }

  console.error('[Phase 8 - Claude Code Prep] Initializing with DYNAMIC agent assignment...');

  // Find session to get style profile ID
  const sessionManager = new SessionManager();
  const sessions = await sessionManager.listSessions();
  const matchingSession = sessions.find(
    (s: { slug?: string; query?: string; styleProfileId?: string }) =>
      s.slug === cliOptions.slug ||
      s.query?.toLowerCase().includes(cliOptions.slug.toLowerCase().replace(/-/g, ' '))
  );

  // Use explicitly passed style profile, or fall back to session lookup
  const styleProfileId = cliOptions.styleProfile || matchingSession?.styleProfileId;
  if (styleProfileId) {
    const source = cliOptions.styleProfile ? 'CLI option' : 'session';
    console.error(`[Phase 8] Using style profile: ${styleProfileId} (from ${source})`);
  } else {
    console.error('[Phase 8] WARNING: No style profile found - using UK English defaults');
  }

  // Create orchestrator
  const orchestrator = new FinalStageOrchestrator(
    basePath,
    cliOptions.slug
  );

  // Set up progress callback
  orchestrator.onProgress((report: ProgressReport) => {
    const progress = report.total > 0 ? Math.round((report.current / report.total) * 100) : 0;
    console.error(`[Phase 8] ${report.phase}: ${report.message} (${progress}%)`);
  });

  console.error('[Phase 8] Preparing for Claude Code with DYNAMIC agents per chapter...');
  console.error('[Phase 8] Each chapter will use its assigned specialized agent from dissertation structure');

  // Call the new prepareForClaudeCode method which:
  // - Scans research outputs
  // - Summarizes sources
  // - Maps to chapters
  // - Generates 4-part ClaudeFlow prompts
  // - Uses DYNAMIC agent assignment from dissertation-architect
  const result = await orchestrator.prepareForClaudeCode({
    force: cliOptions.force ?? false,
    verbose: cliOptions.verbose ?? false,
    threshold,
    styleProfileId
  });

  if (result.success) {
    console.error('[Phase 8] Preparation complete!');
    console.error(`[Phase 8] Total chapters: ${result.totalChapters}`);
    console.error('[Phase 8] DYNAMIC agents assigned per chapter:');
    result.chapterPrompts.forEach(cp => {
      console.error(`  - Chapter ${cp.chapterNumber} (${cp.chapterTitle}): ${cp.subagentType}`);
    });

    // Write prompts to file for Claude Code to consume
    const promptsFilePath = path.join(basePath, 'docs', 'research', cliOptions.slug, 'phase8-prompts.json');
    await fs.mkdir(path.dirname(promptsFilePath), { recursive: true });
    await fs.writeFile(promptsFilePath, JSON.stringify(result, null, 2), 'utf-8');
    console.error(`[Phase 8] Prompts written to: ${promptsFilePath}`);
    console.error('');
    console.error('[Phase 8] Use Claude Code Task tool to execute chapters SEQUENTIALLY');
  } else {
    console.error('[Phase 8] Preparation FAILED');
    result.errors.forEach(err => console.error(`  ERROR: ${err}`));
  }

  return result;
}

/**
 * Handle finalize command errors with appropriate exit codes
 * Per CONSTITUTION Appendix B
 */
function handleFinalizeError(error: unknown): never {
  const err = error as Error;

  // Map error messages to exit codes per CONSTITUTION Appendix B
  let exitCode = 1; // Default: GENERAL_ERROR

  if (err.message.includes('Security') || err.message.includes('Invalid research slug')) {
    exitCode = 6; // SECURITY_VIOLATION
  } else if (err.message.includes('not found') || err.message.includes('missing')) {
    exitCode = 2; // MISSING_FILES
  } else if (err.message.includes('Token') || err.message.includes('overflow')) {
    exitCode = 3; // TOKEN_OVERFLOW
  } else if (err.message.includes('mapping') || err.message.includes('zero sources')) {
    exitCode = 4; // MAPPING_FAILURE
  } else if (err.message.includes('validation') || err.message.includes('quality')) {
    exitCode = 5; // VALIDATION_FAILURE
  } else if (err.message.includes('Constitution') || err.message.includes('DI-') || err.message.includes('FS-')) {
    exitCode = 7; // CONSTITUTION_VIOLATION
  }

  console.error(JSON.stringify({
    error: err.message,
    exitCode,
    suggestion: exitCode === 2
      ? 'Ensure research directory exists with 05-chapter-structure.md'
      : exitCode === 6
      ? 'Slug must be lowercase alphanumeric with dashes only'
      : 'Check logs for details'
  }));

  process.exit(exitCode);
}

/**
 * Handle CLI errors
 */
function handleError(error: unknown): never {
  const err = error as Error;

  // Handle specific error types
  if (err instanceof SessionNotFoundError) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }

  if (err instanceof SessionExpiredError) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }

  if (err instanceof SessionCorruptedError) {
    console.error(JSON.stringify({
      error: err.message,
      suggestion: 'Delete session file manually or use phd-cli abort <session-id>'
    }));
    process.exit(1);
  }

  if (err instanceof AgentMismatchError) {
    console.error(JSON.stringify({
      error: err.message,
      expected: err.expected,
      got: err.got,
      suggestion: 'Use phd-cli status <session-id> to verify current agent'
    }));
    process.exit(1);
  }

  // Unknown error
  const response: ErrorResponse = {
    error: err.message
  };
  console.error(JSON.stringify(response));
  process.exit(1);
}

// Export for testing
export {
  commandInit,
  commandNext,
  commandComplete,
  commandStatus,
  commandList,
  commandResume,
  commandAbort,
  commandFinalize,
  determineStyleProfile,
  loadStyleProfile,
  generatePipelineId,
  generateSlug,
  // Re-export phd-pipeline-config utilities for external use (TASK-CONFIG-002)
  PHD_PIPELINE_AGENT_COUNT,
  getCanonicalAgentByKey,
  getCanonicalAgentsByPhase,
  getCanonicalAgentIndex,
  isValidCanonicalAgent,
  // TASK-CONFIG-003: Phase validation functions for external use
  validatePhaseTransition,
  isPhaseComplete,
  getCurrentPhaseAgents,
  getPhaseProgress,
  getAllPhaseProgress,
  getPhaseForAgentIndex,
  isReadyForPhase8,
  // TASK-CLI-001: Agent file validation for external use
  validateAgentFiles,
  // TASK-CLI-003: getNextAgent function export
  // Note: AgentFileNotFoundError, PromptBuildError are already exported as 'export class'
  // Note: NextAgentResult is already exported as 'export interface'
  getNextAgent,
};

// TASK-CONFIG-003: Export phase-related types
// Note: AgentValidationResult is already exported with its interface declaration (line 121)
export type { PhaseProgress, IPhdSession, ExtendedStatusResponse };

// Re-export canonical configuration for consumers (TASK-CONFIG-002)
export {
  PHD_AGENTS,
  PHD_PHASES,
  DEFAULT_CONFIG,
} from './phd-pipeline-config.js';

// Run if called directly (not when imported as a module)
// Check if this is the main module using import.meta.url
const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('phd-cli.ts') ||
   process.argv[1].endsWith('phd-cli.js') ||
   process.argv[1].includes('phd-cli'));

if (isMainModule) {
  program.parse(process.argv);
}
