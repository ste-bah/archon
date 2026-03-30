#!/usr/bin/env node
/**
 * Universal Self-Learning God Agent CLI
 *
 * Usage:
 *   npx tsx src/god-agent/universal/cli.ts ask "How do I..."
 *   npx tsx src/god-agent/universal/cli.ts code "Implement a..."
 *   npx tsx src/god-agent/universal/cli.ts research "What is..."
 *   npx tsx src/god-agent/universal/cli.ts write "Essay about..."
 *   npx tsx src/god-agent/universal/cli.ts learn "Knowledge" --domain "patterns" --category "fact"
 *   npx tsx src/god-agent/universal/cli.ts learn --file ./learnings.md --domain "docs"
 *   npx tsx src/god-agent/universal/cli.ts feedback <id> <rating> --notes "Success"
 *   npx tsx src/god-agent/universal/cli.ts query --domain "project/api" --tags "schema"
 *   npx tsx src/god-agent/universal/cli.ts status
 */

import { UniversalAgent, type ICodeTaskPreparation, type IWriteTaskPreparation, type IMarketAnalysisTaskPreparation } from './universal-agent.js';
import { promises as fs } from 'fs';
import * as path from 'path';

// Import CodingQualityCalculator for code-feedback command
import {
  calculateCodingQuality,
  assessCodingQuality,
  createCodingQualityContext,
  type ICodingQualityAssessment,
} from '../cli/coding-quality-calculator.js';

// Import SonaEngine for trajectory management and feedback
import { createProductionSonaEngine } from '../core/learning/sona-engine.js';
import type { SonaEngine } from '../core/learning/sona-engine.js';
import type { TrajectoryID, Route } from '../core/learning/sona-types.js';

// Import CommandTaskBridge for sophisticated pipeline detection (fixes isPipeline: false bug)
import {
  CommandTaskBridge,
  DEFAULT_PIPELINE_THRESHOLD,
} from '../core/pipeline/command-task-bridge.js';

// Import hook registry for standalone mode initialization (TASK-HOOK-008)
import {
  getHookRegistry,
  registerRequiredHooks,
  setDescServiceGetter,
  setSonaEngineGetter
} from '../core/hooks/index.js';

// ==================== JSON Output Types (DAI-002) ====================

/**
 * JSON output format for CLI commands.
 * Used when --json flag is provided.
 *
 * @example
 * ```typescript
 * npx tsx src/god-agent/universal/cli.ts ask "How do I..." --json
 * // Outputs:
 * // {
 * //   "command": "ask",
 * //   "selectedAgent": "assistant",
 * //   "prompt": "How do I...",
 * //   "isPipeline": false,
 * //   "result": { ... },
 * //   "success": true
 * // }
 * ```
 */
export interface ICLIJsonOutput {
  /** Command that was executed */
  command: string;
  /** Agent that was selected for execution (DAI-001 integration) */
  selectedAgent: string;
  /** Prompt/input that was provided */
  prompt: string;
  /** Whether this is a multi-agent pipeline task */
  isPipeline: boolean;
  /** Command-specific result data */
  result: unknown;
  /** Whether command succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Trajectory ID for feedback (if applicable) */
  trajectoryId?: string;
  /** Quality score from the response (0-1 range) */
  qualityScore?: number;
  /**
   * TASK-LOOPFIX-001: Orphan warning if orphaned trajectories exist.
   * Included to notify programmatic consumers about learning loop gaps.
   */
  orphanWarning?: {
    orphanCount: number;
    warning: string;
  };
}

// ==================== Argument Parsing ====================

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parse CLI arguments into structured format
 * Supports: --flag value, --flag=value, -f value, --boolean-flag
 */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] || '';
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 1;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      if (val !== undefined) {
        flags[key] = val;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { command, positional, flags };
}

/**
 * Get flag value with short/long aliases
 */
function getFlag(flags: Record<string, string | boolean>, ...names: string[]): string | boolean | undefined {
  for (const name of names) {
    if (flags[name] !== undefined) return flags[name];
  }
  return undefined;
}

/**
 * Output result as JSON (DAI-002: FR-016)
 */
function outputJson(output: ICLIJsonOutput): void {
  console.log('__GODAGENT_JSON_START__');
  console.log(JSON.stringify(output, null, 2));
  console.log('__GODAGENT_JSON_END__');
}

/**
 * Detect if task requires multi-agent pipeline using CommandTaskBridge scoring
 *
 * Uses sophisticated complexity analysis with weighted scoring:
 * - Phase keywords (understand, design, implement, test): +0.15 each
 * - Document keywords (paper, thesis, dissertation): +0.2 each
 * - Multi-step patterns (then, after, finally): +0.25
 * - Connector words (and, with, also): +0.1 each
 * - Multiple action verbs (>=2): +(verbCount-1) * 0.1
 * - Word count >15: +0.1
 *
 * Pipeline triggers when score >= DEFAULT_PIPELINE_THRESHOLD (0.6)
 */
function isPipelineTask(input: string): boolean {
  const bridge = new CommandTaskBridge();
  const analysis = bridge.analyzeTaskComplexity(input);
  const isPipeline = analysis.score >= DEFAULT_PIPELINE_THRESHOLD;

  // Log decision for debugging (visible in CLI output)
  if (isPipeline) {
    console.error(`[Pipeline] TRIGGERED: score=${analysis.score.toFixed(2)} >= threshold=${DEFAULT_PIPELINE_THRESHOLD}`);
    console.error(`[Pipeline] Reason: ${analysis.reasoning}`);
  } else {
    console.error(`[Pipeline] Single agent: score=${analysis.score.toFixed(2)} < threshold=${DEFAULT_PIPELINE_THRESHOLD}`);
  }

  return isPipeline;
}

/**
 * Get selected agent based on command type (DAI-001 integration)
 */
function getSelectedAgent(command: string): string {
  const agentMap: Record<string, string> = {
    ask: 'god-ask',
    a: 'god-ask',
    code: 'god-code',
    c: 'god-code',
    research: 'god-research',
    r: 'god-research',
    write: 'god-write',
    w: 'god-write',
    status: 'status-agent',
    s: 'status-agent',
    learn: 'learn-agent',
    l: 'learn-agent',
    feedback: 'feedback-agent',
    f: 'feedback-agent',
    'code-feedback': 'code-feedback-agent',
    cf: 'code-feedback-agent',
    'auto-complete-coding': 'auto-complete-agent',
    acc: 'auto-complete-agent',
    'batch-learn': 'batch-learn-agent',
    bl: 'batch-learn-agent',
    query: 'query-agent',
    q: 'query-agent',
    'market-analysis': 'god-market-analysis',
    ma: 'god-market-analysis',
  };
  return agentMap[command.toLowerCase()] || 'unknown';
}

/**
 * Initialize hooks for CLI standalone mode
 *
 * TASK-HOOK-008: Idempotent hook registration for CLI standalone execution.
 * When the daemon is not available, the CLI must register hooks itself.
 * This function is idempotent - safe to call multiple times.
 *
 * CONSTITUTION COMPLIANCE:
 * - RULE-032: All hooks MUST be registered at daemon startup
 * - GAP-ADV-HOOK-003: CLI standalone execution must also register hooks
 *
 * @param verbose - Whether to log hook registration messages
 */
function initializeCliHooks(verbose: boolean): void {
  const hookRegistry = getHookRegistry();

  // Idempotent check - don't double-register if daemon already did it
  if (hookRegistry.isInitialized()) {
    if (verbose) {
      console.log('[CLI] Hooks already initialized (daemon mode)');
    }
    return;
  }

  // Register all required hooks for standalone mode
  registerRequiredHooks();

  // Wire service getters to null - no daemon = no DESC service available
  // The hooks will gracefully handle null services
  setDescServiceGetter(() => null);
  setSonaEngineGetter(() => null);

  // Initialize the registry
  hookRegistry.initialize();

  if (verbose) {
    const counts = hookRegistry.getHookCount();
    console.log(`[CLI] Hooks registered (standalone mode): ${counts.total} hooks`);
  }
}

// ==================== SonaEngine Lazy Initialization ====================

/**
 * Lazy-initialized SonaEngine for trajectory tracking and feedback
 * Used by code-feedback and auto-complete-coding commands
 */
let sonaEngine: SonaEngine | null = null;

/**
 * Get or create SonaEngine instance with SQLite persistence
 * Implements lazy initialization pattern to avoid startup overhead
 */
function getSonaEngine(): SonaEngine | null {
  if (!sonaEngine) {
    try {
      sonaEngine = createProductionSonaEngine({
        learningRate: 0.01,
        trackPerformance: true,
      });
      if (sonaEngine.isPersistenceEnabled()) {
        console.error('[CLI] SonaEngine initialized with persistence enabled');
      } else {
        console.error('[CLI] Warning: SonaEngine persistence not enabled');
      }
    } catch (error) {
      console.error('[CLI] Failed to initialize SonaEngine:', error);
      return null;
    }
  }
  return sonaEngine;
}

// ==================== Code Feedback Functions ====================

/**
 * Result from code feedback submission
 */
interface CodeFeedbackResult {
  trajectoryId: string;
  quality: number;
  assessment: ICodingQualityAssessment;
  weightUpdates: number;
  patternCreated: boolean;
}

/**
 * Submit feedback for a coding trajectory with quality calculation
 *
 * @param trajectoryId - The trajectory ID to provide feedback for
 * @param output - The code output to assess (string or object)
 * @param context - Optional context (agentKey, phase)
 * @returns CodeFeedbackResult with quality assessment
 */
async function submitCodeFeedback(
  trajectoryId: string,
  output: unknown,
  context?: { agentKey?: string; phase?: number }
): Promise<CodeFeedbackResult> {
  const engine = getSonaEngine();
  if (!engine) {
    throw new Error('SonaEngine not available - cannot submit feedback');
  }

  // Calculate quality using CodingQualityCalculator
  const qualityContext = context?.agentKey
    ? createCodingQualityContext(context.agentKey, context.phase)
    : undefined;
  const assessment = assessCodingQuality(output, qualityContext);

  // Get pattern count before feedback
  const statsBefore = engine.getStats();
  const patternsBefore = statsBefore.totalPatterns;

  // Submit feedback to SonaEngine
  try {
    await engine.provideFeedback(trajectoryId, assessment.score, {
      skipAutoSave: false, // Ensure persistence to SQLite
    });
  } catch (error) {
    throw new Error(`Failed to submit feedback: ${error}`);
  }

  // Check if new pattern was created
  const statsAfter = engine.getStats();
  const patternsAfter = statsAfter.totalPatterns;

  return {
    trajectoryId,
    quality: assessment.score,
    assessment,
    weightUpdates: 1,
    patternCreated: patternsAfter > patternsBefore,
  };
}

/**
 * Auto-complete orphaned coding trajectories
 *
 * Finds trajectories without quality scores (orphaned) and assigns quality
 * based on available output or a default minimum quality score.
 *
 * @param route - Optional route filter (e.g., 'code', 'code-pipeline')
 * @param dryRun - If true, only report what would be done without making changes
 * @returns Object with count of completed trajectories and details
 */
async function autoCompleteCodingTrajectories(
  route?: string,
  dryRun: boolean = false
): Promise<{
  totalFound: number;
  completed: number;
  skipped: number;
  errors: string[];
  details: Array<{
    trajectoryId: string;
    route: string;
    quality: number;
    status: 'completed' | 'skipped' | 'error';
    reason?: string;
  }>;
}> {
  const engine = getSonaEngine();
  if (!engine) {
    return {
      totalFound: 0,
      completed: 0,
      skipped: 0,
      errors: ['SonaEngine not available'],
      details: [],
    };
  }

  // Get all trajectories (optionally filtered by route)
  const allTrajectories = engine.listTrajectories(route as Route | undefined);

  // Find orphaned trajectories (those without quality scores)
  const orphanedTrajectories = allTrajectories.filter(t => t.quality === undefined || t.quality === null);

  const result = {
    totalFound: orphanedTrajectories.length,
    completed: 0,
    skipped: 0,
    errors: [] as string[],
    details: [] as Array<{
      trajectoryId: string;
      route: string;
      quality: number;
      status: 'completed' | 'skipped' | 'error';
      reason?: string;
    }>,
  };

  // Filter to only coding-related routes
  const codingRoutes = ['code', 'code-pipeline', 'implementation', 'code-generation'];

  for (const trajectory of orphanedTrajectories) {
    // Check if this is a coding trajectory
    const isCodingTrajectory = !route || codingRoutes.some(r =>
      trajectory.route?.toLowerCase().includes(r) ||
      trajectory.id.toLowerCase().includes('code')
    );

    if (!isCodingTrajectory && !route) {
      result.skipped++;
      result.details.push({
        trajectoryId: trajectory.id,
        route: trajectory.route || 'unknown',
        quality: 0,
        status: 'skipped',
        reason: 'Not a coding trajectory',
      });
      continue;
    }

    if (dryRun) {
      // In dry-run mode, calculate quality but don't persist
      const quality = 0.5; // Default quality for orphaned trajectories
      result.completed++;
      result.details.push({
        trajectoryId: trajectory.id,
        route: trajectory.route || 'unknown',
        quality,
        status: 'completed',
        reason: 'Would be auto-completed (dry run)',
      });
      continue;
    }

    try {
      // Calculate quality based on trajectory steps if available
      let quality = 0.5; // Default quality

      // Check if trajectory has steps with result (IReasoningStep uses 'result' field)
      if (trajectory.steps && trajectory.steps.length > 0) {
        const lastStep = trajectory.steps[trajectory.steps.length - 1];
        if (lastStep.result) {
          const assessment = assessCodingQuality(lastStep.result);
          quality = assessment.score;
        }
      }

      // Submit feedback to complete the trajectory
      await engine.provideFeedback(trajectory.id, quality, {
        skipAutoSave: false,
      });

      result.completed++;
      result.details.push({
        trajectoryId: trajectory.id,
        route: trajectory.route || 'unknown',
        quality,
        status: 'completed',
      });
    } catch (error) {
      result.errors.push(`Failed to complete ${trajectory.id}: ${error}`);
      result.details.push({
        trajectoryId: trajectory.id,
        route: trajectory.route || 'unknown',
        quality: 0,
        status: 'error',
        reason: String(error),
      });
    }
  }

  return result;
}

// ==================== Learning Loop Gap Fix (TASK-LOOPFIX-001) ====================

/**
 * Check for orphaned trajectories and warn at CLI startup
 *
 * TASK-LOOPFIX-001: Addresses the learning loop gap where feedback submission
 * relies on Claude following instructions rather than being programmatic.
 *
 * CONSTITUTION COMPLIANCE:
 * - ERR-001: No silent failures - warn users about orphaned trajectories
 * - RULE-035: All agent results MUST be assessed for quality
 *
 * @param verbose - If true, print warnings to stderr
 * @returns Object with orphan count and details
 */
function checkOrphanedTrajectories(verbose: boolean = true): {
  orphanCount: number;
  recentOrphans: Array<{ id: string; route: string; createdAt: number }>;
} {
  const engine = getSonaEngine();
  if (!engine) {
    return { orphanCount: 0, recentOrphans: [] };
  }

  try {
    // Get all trajectories
    const allTrajectories = engine.listTrajectories();

    // Find orphaned trajectories (those without quality scores)
    const orphanedTrajectories = allTrajectories.filter(
      t => t.quality === undefined || t.quality === null
    );

    // Filter to recent orphans (last 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentOrphans = orphanedTrajectories
      .filter(t => {
        const createdAt = t.createdAt || (t.steps?.[0]?.timestamp) || 0;
        return createdAt > oneDayAgo;
      })
      .map(t => ({
        id: t.id,
        route: t.route || 'unknown',
        createdAt: t.createdAt || (t.steps?.[0]?.timestamp) || 0,
      }))
      .slice(0, 5); // Show only first 5

    if (verbose && recentOrphans.length > 0) {
      console.error('\n\x1b[33m[WARNING] Learning Loop Gap Detected!\x1b[0m');
      console.error(`Found ${orphanedTrajectories.length} orphaned trajectories without feedback.`);
      console.error('Recent orphans (last 24h):');
      for (const orphan of recentOrphans) {
        const age = Math.round((Date.now() - orphan.createdAt) / (60 * 1000));
        console.error(`  - ${orphan.id.slice(0, 20)}... (${orphan.route}) - ${age} min ago`);
      }
      console.error('\nTo fix, run one of:');
      console.error('  npx tsx src/god-agent/universal/cli.ts auto-complete-coding');
      console.error('  npx tsx src/god-agent/universal/cli.ts feedback <trajectoryId> <rating> --trajectory\n');
    }

    return { orphanCount: orphanedTrajectories.length, recentOrphans };
  } catch (error) {
    // ERR-001 compliance: Log error, don't silently swallow
    console.debug('[checkOrphanedTrajectories] Failed:', (error as Error).message);
    return { orphanCount: 0, recentOrphans: [] };
  }
}

/**
 * Get orphan warning for JSON output
 *
 * TASK-LOOPFIX-001: Include orphan warning in JSON output for programmatic consumers.
 * This allows skills and automated systems to detect and handle orphaned trajectories.
 *
 * @returns Warning object if orphans exist, undefined otherwise
 */
function getOrphanWarningForJson(): { orphanCount: number; warning: string } | undefined {
  const { orphanCount } = checkOrphanedTrajectories(false);
  if (orphanCount > 0) {
    return {
      orphanCount,
      warning: `${orphanCount} trajectories without feedback. Run 'auto-complete-coding' to fix.`,
    };
  }
  return undefined;
}

// ==================== Embedding Service Health Check (TASK-EMBED-HEALTH-001) ====================

/**
 * Check if the embedding service is available at localhost:8000
 *
 * TASK-EMBED-HEALTH-001: Startup health check for embedding service.
 * DESC episodic memory requires the embedding service to function.
 * This check warns users early if the service is unavailable.
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
 * Display embedding service health warning
 *
 * TASK-EMBED-HEALTH-001: Clear warning message with fix instructions.
 * Uses ANSI colors for visibility in terminal.
 *
 * @param verbose - Whether to display the warning (false in JSON mode)
 */
async function displayEmbeddingHealthWarning(verbose: boolean): Promise<void> {
  if (!verbose) return;

  const isAvailable = await checkEmbeddingServiceHealth();

  if (!isAvailable) {
    console.error('\n\x1b[33m========================================\x1b[0m');
    console.error('\x1b[33m  WARNING: Embedding Service Unavailable\x1b[0m');
    console.error('\x1b[33m========================================\x1b[0m');
    console.error('\x1b[31mEmbedding service not running at localhost:8000\x1b[0m');
    console.error('DESC episodic memory will NOT work.');
    console.error('');
    console.error('To start the embedding service:');
    console.error('  \x1b[36m./embedding-api/api-embed.sh start\x1b[0m');
    console.error('');
    console.error('To check status:');
    console.error('  \x1b[36m./embedding-api/api-embed.sh status\x1b[0m');
    console.error('\x1b[33m========================================\x1b[0m\n');
  }
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);
  const input = positional.join(' ');
  const jsonMode = getFlag(flags, 'json', 'j') === true;

  // TASK-HOOK-008: Initialize hooks for CLI standalone mode (idempotent)
  // This ensures hooks work even when CLI runs standalone without daemon
  initializeCliHooks(!jsonMode);

  // TASK-LOOPFIX-001: Check for orphaned trajectories at CLI startup
  // Only show warning in non-JSON mode to avoid breaking machine parsing
  // This addresses the learning loop gap where feedback relies on Claude following instructions
  if (!jsonMode) {
    checkOrphanedTrajectories(true);
  }

  // TASK-EMBED-HEALTH-001: Check embedding service health at CLI startup
  // Warns users if DESC episodic memory will not work due to missing embedding service
  // Non-blocking: CLI continues to work for basic operations without embedding service
  await displayEmbeddingHealthWarning(!jsonMode);

  if (!command) {
    if (jsonMode) {
      outputJson({
        command: 'help',
        selectedAgent: 'help-agent',
        prompt: '',
        isPipeline: false,
        result: { message: 'No command provided. Use --help for usage.' },
        success: false,
        error: 'No command provided',
      });
    } else {
      printHelp();
    }
    process.exit(0);
  }

  // ==================== Handle commands that don't need full agent ====================
  // These commands only need SonaEngine, not the full agent with CapabilityIndex/embeddings
  const lightweightCommands = ['code-feedback', 'cf', 'verify-feedback', 'vf', 'auto-complete-coding', 'acc'];

  if (lightweightCommands.includes(command.toLowerCase())) {
    // Handle lightweight commands without full agent initialization
    switch (command.toLowerCase()) {
      case 'code-feedback':
      case 'cf': {
        const trajectoryId = positional[0];
        if (!trajectoryId) {
          if (jsonMode) {
            outputJson({
              command: 'code-feedback',
              selectedAgent: 'code-feedback-agent',
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'Trajectory ID required',
            });
          } else {
            console.error('Error: Please provide trajectory ID');
            console.error('Usage: code-feedback <trajectoryId> [--output <code>] [--file <path>] [--agent <key>] [--phase <num>]');
          }
          process.exit(1);
        }

        let codeOutput: string;
        const outputFlag = getFlag(flags, 'output', 'o') as string | undefined;
        const fileFlag = getFlag(flags, 'file', 'f') as string | undefined;

        if (outputFlag) {
          codeOutput = outputFlag;
        } else if (fileFlag) {
          try {
            const filePath = path.resolve(fileFlag);
            codeOutput = await fs.readFile(filePath, 'utf-8');
            if (!jsonMode) console.log(`Reading output from: ${filePath}`);
          } catch (err) {
            if (jsonMode) {
              outputJson({
                command: 'code-feedback',
                selectedAgent: 'code-feedback-agent',
                prompt: trajectoryId,
                isPipeline: false,
                result: null,
                success: false,
                error: `Error reading file: ${fileFlag}`,
              });
            } else {
              console.error(`Error reading file: ${fileFlag}`);
            }
            process.exit(1);
          }
        } else {
          codeOutput = positional.slice(1).join(' ') || '';
        }

        const agentKey = getFlag(flags, 'agent', 'a') as string | undefined;
        const phaseStr = getFlag(flags, 'phase', 'p') as string | undefined;
        const phase = phaseStr ? parseInt(phaseStr, 10) : undefined;

        try {
          const result = await submitCodeFeedback(trajectoryId, codeOutput, { agentKey, phase });
          if (jsonMode) {
            outputJson({
              command: 'code-feedback',
              selectedAgent: 'code-feedback-agent',
              prompt: trajectoryId,
              isPipeline: false,
              result: {
                trajectoryId: result.trajectoryId,
                quality: result.quality,
                tier: result.assessment.tier,
                breakdown: result.assessment.breakdown,
                summary: result.assessment.summary,
                meetsPatternThreshold: result.assessment.meetsPatternThreshold,
                weightUpdates: result.weightUpdates,
                patternCreated: result.patternCreated,
              },
              success: true,
              qualityScore: result.quality,
            });
          } else {
            console.log(`\n--- Code Feedback Recorded ---`);
            console.log(`Trajectory: ${result.trajectoryId}`);
            console.log(`Quality: ${(result.quality * 100).toFixed(1)}% (${result.assessment.tier})`);
            console.log(`Summary: ${result.assessment.summary}`);
            console.log(`Weight updates: ${result.weightUpdates}`);
            console.log(`Pattern created: ${result.patternCreated}`);
          }
          process.exit(0);
        } catch (error) {
          if (jsonMode) {
            outputJson({
              command: 'code-feedback',
              selectedAgent: 'code-feedback-agent',
              prompt: trajectoryId,
              isPipeline: false,
              result: null,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            console.error(`Error submitting code feedback: ${error}`);
          }
          process.exit(1);
        }
      }

      case 'verify-feedback':
      case 'vf': {
        const trajectoryId = positional[0];
        if (!trajectoryId) {
          console.error('Error: Please provide trajectory ID');
          process.exit(1);
        }
        const engine = getSonaEngine();
        if (!engine) {
          console.error('SonaEngine not available');
          process.exit(1);
        }
        const trajectory = engine.getTrajectory(trajectoryId);
        if (trajectory && trajectory.quality !== undefined) {
          console.log(`VERIFIED: Trajectory ${trajectoryId} has feedback (quality: ${(trajectory.quality * 100).toFixed(1)}%)`);
          process.exit(0);
        } else {
          console.error(`FEEDBACK_VERIFICATION_FAILED: No feedback found for ${trajectoryId}`);
          process.exit(1);
        }
      }

      case 'feedback-health':
      case 'fh': {
        // Diagnostic command to check feedback system health (TRAJECTORY-ORPHAN-FIX)
        const engine = getSonaEngine();
        if (!engine) {
          console.error('SonaEngine not available');
          process.exit(1);
        }
        const health = engine.getFeedbackHealth();
        if (jsonMode) {
          outputJson({
            command: 'feedback-health',
            selectedAgent: getSelectedAgent(command),
            prompt: '',
            isPipeline: false,
            result: health,
            success: true,
          });
        } else {
          console.log('\n--- Feedback System Health ---\n');
          console.log(`Status: ${health.status.toUpperCase()}`);
          console.log(`Total Trajectories: ${health.totalTrajectories}`);
          console.log(`Hook Trajectories: ${health.hookTrajectories}`);
          console.log(`Session-End Trajectories: ${health.sessionEndTrajectories}`);
          console.log(`On-Demand Created: ${health.onDemandCreatedCount}`);
          console.log(`Feedback Success Rate: ${(health.feedbackSuccessRate * 100).toFixed(1)}%`);
          if (health.recommendations.length > 0) {
            console.log('\nRecommendations:');
            health.recommendations.forEach((rec, i) => {
              console.log(`  ${i + 1}. ${rec}`);
            });
          }
        }
        break;
      }

      default:
        // Fall through to full agent initialization for other lightweight commands
        break;
    }
  }

  // Suppress verbose output in JSON mode
  const agent = new UniversalAgent({ verbose: !jsonMode });

  try {
    await agent.initialize();

    switch (command.toLowerCase()) {
      case 'ask':
      case 'a':
        if (!input) {
          if (jsonMode) {
            outputJson({
              command: 'ask',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'No input provided',
            });
          } else {
            console.error('Error: Please provide input text');
          }
          process.exit(1);
        }
        // TASK-GODASK-001: Use returnResult to get trajectoryId for feedback tracking
        const askResult = await agent.ask(input, { returnResult: true });
        if (jsonMode) {
          outputJson({
            command: 'ask',
            selectedAgent: askResult.selectedAgent ?? getSelectedAgent(command),
            prompt: input,
            isPipeline: isPipelineTask(input),
            result: { response: askResult.output },
            success: true,
            trajectoryId: askResult.trajectoryId,
            qualityScore: askResult.qualityScore,
          });
        } else {
          console.log('\n--- Response ---\n');
          console.log(askResult.output);
          if (askResult.trajectoryId) {
            console.log(`\nTrajectory: ${askResult.trajectoryId}`);
            console.log(`Provide feedback: npx tsx src/god-agent/universal/cli.ts feedback ${askResult.trajectoryId} <rating> --trajectory`);
          }
        }
        break;

      case 'code':
      case 'c': {
        // TASK-GODCODE-001: Two-phase execution model
        // Implements [REQ-GODCODE-001]: CLI does NOT attempt task execution
        // Implements [REQ-GODCODE-002]: CLI returns builtPrompt in JSON
        // Implements [REQ-GODCODE-006]: CLI exits immediately after JSON output
        if (!input) {
          if (jsonMode) {
            outputJson({
              command: 'code',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'No coding task provided',
            });
          } else {
            console.error('Error: Please provide coding task');
          }
          process.exit(1);
        }

        // Check for --execute flag for backward compatibility
        const executeFlag = getFlag(flags, 'execute', 'e') === true;

        if (executeFlag) {
          // Legacy behavior: Full execution via agent.code()
          const codeResult = await agent.code(input);
          if (jsonMode) {
            outputJson({
              command: 'code',
              selectedAgent: getSelectedAgent(command),
              prompt: input,
              isPipeline: isPipelineTask(input),
              result: {
                code: codeResult.code,
                language: codeResult.language,
                patternsUsed: codeResult.patterns_used.length,
                learned: codeResult.learned,
              },
              success: true,
              trajectoryId: codeResult.trajectoryId,
            });
          } else {
            console.log('\n--- Generated Code ---\n');
            console.log(codeResult.code);
            console.log('\n--- Details ---');
            console.log(`Language: ${codeResult.language}`);
            console.log(`Patterns used: ${codeResult.patterns_used.length}`);
            console.log(`Learned: ${codeResult.learned}`);
            if (codeResult.trajectoryId) {
              console.log(`Trajectory: ${codeResult.trajectoryId}`);
              console.log(`\nProvide feedback: npx tsx src/god-agent/universal/cli.ts feedback ${codeResult.trajectoryId} <rating>`);
            }
          }
        } else {
          // Implements [REQ-GODCODE-001]: New two-phase behavior (default)
          // Phase 1: Prepare task (agent selection, DESC injection, prompt building)
          // Phase 2: Skill executes Task() with builtPrompt
          const languageFlag = getFlag(flags, 'language', 'l') as string | undefined;
          const preparation = await agent.prepareCodeTask(input, { language: languageFlag });

          // Implements [REQ-GODCODE-002]: Output structured JSON with builtPrompt
          if (jsonMode) {
            // TASK-LOOPFIX-001: Build feedback command for programmatic enforcement
            const trajectoryId = preparation.trajectoryId ?? undefined;
            const feedbackCommand = trajectoryId
              ? `npx tsx src/god-agent/universal/cli.ts code-feedback "${trajectoryId}" --output "[TASK_OUTPUT]" --agent "${preparation.agentType}"`
              : undefined;

            // Machine-readable output for skill consumption
            outputJson({
              command: 'code',
              selectedAgent: preparation.selectedAgent,
              prompt: input,
              isPipeline: preparation.isPipeline,
              result: {
                // Implements [REQ-GODCODE-002]: builtPrompt field
                builtPrompt: preparation.builtPrompt,
                // Implements [REQ-GODCODE-003]: agentType for Task()
                agentType: preparation.agentType,
                agentCategory: preparation.agentCategory,
                descContext: preparation.descContext,
                memoryContext: preparation.memoryContext,
                language: preparation.language,
                pipeline: preparation.pipeline,
                // TASK-LOOPFIX-001: Feedback enforcement fields
                feedbackRequired: true,
                feedbackCommand,
              },
              success: true,
              trajectoryId,
              // TASK-LOOPFIX-001: Include orphan warning if any exist
              orphanWarning: getOrphanWarningForJson(),
            });
          } else {
            // Human-readable output
            console.log('\n--- Code Task Preparation ---\n');
            console.log(`Task: ${input}`);
            console.log(`Selected Agent: ${preparation.selectedAgent}`);
            console.log(`Agent Type: ${preparation.agentType}`);
            console.log(`Agent Category: ${preparation.agentCategory}`);
            console.log(`Pipeline: ${preparation.isPipeline}`);
            if (preparation.descContext) {
              console.log(`DESC Context: ${preparation.descContext.substring(0, 100)}...`);
            }
            if (preparation.trajectoryId) {
              console.log(`Trajectory: ${preparation.trajectoryId}`);
            }
            console.log('\n--- Built Prompt ---\n');
            console.log(preparation.builtPrompt);
            console.log('\n--- Execution Instructions ---');
            console.log('Execute via Task() in /god-code skill with:');
            console.log(`  agentType: "${preparation.agentType}"`);
            console.log(`  prompt: [builtPrompt above]`);
          }
        }

        // Implements [REQ-GODCODE-006]: Shutdown and exit immediately
        await agent.shutdown();
        process.exit(0);
      }

      case 'code-pipeline': {
        // Execute the coding pipeline via CodingPipelineOrchestrator
        // Wires all dependencies and runs the 7-phase pipeline with
        // trajectory persistence, Sherlock reviews, and embedding-backed learning
        if (!input) {
          if (jsonMode) {
            console.log('__GODAGENT_JSON_START__');
            console.log(JSON.stringify({
              command: 'code-pipeline', success: false,
              error: 'No coding task provided for pipeline execution',
            }));
            console.log('__GODAGENT_JSON_END__');
          } else {
            console.error('Error: Please provide a coding task for pipeline execution');
          }
          process.exit(1);
        }

        const pipelineLangFlag = getFlag(flags, 'language', 'l') as string | undefined;
        const preparation = await agent.prepareCodeTask(input, { language: pipelineLangFlag });

        if (!preparation.isPipeline || !preparation.pipeline?.config) {
          if (jsonMode) {
            console.log('__GODAGENT_JSON_START__');
            console.log(JSON.stringify({
              command: 'code-pipeline', success: false,
              error: 'Task does not require pipeline execution. Use "code" subcommand instead.',
            }));
            console.log('__GODAGENT_JSON_END__');
          } else {
            console.error('Task does not require pipeline execution. Use "code" subcommand instead.');
          }
          process.exit(1);
        }

        const pipelineResult = await agent.executePipeline(preparation.pipeline.config);

        if (jsonMode) {
          console.log('__GODAGENT_JSON_START__');
          console.log(JSON.stringify({
            command: 'code-pipeline',
            success: pipelineResult.success,
            completedPhases: pipelineResult.completedPhases,
            totalXP: pipelineResult.totalXP,
            executionTimeMs: pipelineResult.executionTimeMs,
            trajectoryId: preparation.trajectoryId ?? undefined,
          }));
          console.log('__GODAGENT_JSON_END__');
        } else {
          console.log('\n--- Pipeline Execution Result ---\n');
          console.log(`Success: ${pipelineResult.success}`);
          console.log(`Completed Phases: ${pipelineResult.completedPhases.join(', ')}`);
          console.log(`Total XP: ${pipelineResult.totalXP}`);
          console.log(`Execution Time: ${pipelineResult.executionTimeMs}ms`);
          if (preparation.trajectoryId) {
            console.log(`Trajectory: ${preparation.trajectoryId}`);
          }
        }

        await agent.shutdown();
        process.exit(0);
      }

      case 'research':
      case 'r':
        if (!input) {
          if (jsonMode) {
            outputJson({
              command: 'research',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'No research query provided',
            });
          } else {
            console.error('Error: Please provide research query');
          }
          process.exit(1);
        }
        const researchResult = await agent.research(input, { depth: 'deep' });
        if (jsonMode) {
          outputJson({
            command: 'research',
            selectedAgent: getSelectedAgent(command),
            prompt: input,
            isPipeline: isPipelineTask(input),
            result: {
              synthesis: researchResult.synthesis,
              findingsCount: researchResult.findings.length,
              knowledgeStored: researchResult.knowledgeStored,
            },
            success: true,
          });
        } else {
          console.log('\n--- Research Results ---\n');
          console.log(researchResult.synthesis);
          console.log(`\nFindings: ${researchResult.findings.length}`);
          console.log(`Knowledge stored: ${researchResult.knowledgeStored}`);
        }
        break;

      case 'write':
      case 'w': {
        // TASK-GODWRITE-001: Two-phase execution model
        // Implements [REQ-GODWRITE-001]: CLI does NOT attempt task execution
        // Implements [REQ-GODWRITE-002]: CLI returns builtPrompt in JSON
        // Implements [REQ-GODWRITE-006]: CLI exits immediately after JSON output
        if (!input) {
          if (jsonMode) {
            outputJson({
              command: 'write',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'No topic provided',
            });
          } else {
            console.error('Error: Please provide topic');
          }
          process.exit(1);
        }

        // Parse writing options from flags
        const style = getFlag(flags, 'style', 's') as 'academic' | 'professional' | 'casual' | 'technical' | undefined;
        const length = getFlag(flags, 'length', 'l') as 'short' | 'medium' | 'long' | 'comprehensive' | undefined;
        const format = getFlag(flags, 'format', 'f') as 'essay' | 'report' | 'article' | 'paper' | undefined;
        const styleProfileId = getFlag(flags, 'style-profile', 'p') as string | undefined;

        // Check for --execute flag for backward compatibility
        // Implements [REQ-GODWRITE-011]: Backward compatibility with --execute flag
        const executeFlag = getFlag(flags, 'execute', 'e') === true;

        if (executeFlag) {
          // Legacy behavior: Full execution via agent.write()
          const writeResult = await agent.write(input, { style, length, format, styleProfileId });
          if (jsonMode) {
            outputJson({
              command: 'write',
              selectedAgent: getSelectedAgent(command),
              prompt: input,
              isPipeline: isPipelineTask(input),
              result: {
                content: writeResult.content,
                style: writeResult.style,
                wordCount: writeResult.wordCount,
                sourcesCount: writeResult.sources.length,
              },
              success: true,
              trajectoryId: writeResult.trajectoryId,
            });
          } else {
            console.log('\n--- Generated Content ---\n');
            console.log(writeResult.content);
            console.log(`\n--- Details ---`);
            console.log(`Style: ${writeResult.style}`);
            console.log(`Word count: ${writeResult.wordCount}`);
            console.log(`Sources: ${writeResult.sources.length}`);
            if (writeResult.trajectoryId) {
              console.log(`Trajectory: ${writeResult.trajectoryId}`);
              console.log(`\nProvide feedback: npx tsx src/god-agent/universal/cli.ts feedback ${writeResult.trajectoryId} <rating> --trajectory`);
            }
          }
        } else {
          // Implements [REQ-GODWRITE-001]: New two-phase behavior (default)
          // Phase 1: Prepare task (agent selection, DESC injection, prompt building)
          // Phase 2: Skill executes Task() with builtPrompt
          const preparation = await agent.prepareWriteTask(input, {
            style,
            length,
            format,
            styleProfileId,
          });

          // Implements [REQ-GODWRITE-002]: Output structured JSON with builtPrompt
          if (jsonMode) {
            // TASK-LOOPFIX-001: Build feedback command for programmatic enforcement
            const trajectoryId = preparation.trajectoryId ?? undefined;
            const feedbackCommand = trajectoryId
              ? `npx tsx src/god-agent/universal/cli.ts feedback "${trajectoryId}" [quality_score] --trajectory --notes "Write task completed"`
              : undefined;

            // Machine-readable output for skill consumption
            outputJson({
              command: 'write',
              selectedAgent: preparation.selectedAgent,
              prompt: input,
              isPipeline: preparation.isPipeline,
              result: {
                // Implements [REQ-GODWRITE-002]: builtPrompt field
                builtPrompt: preparation.builtPrompt,
                // Implements [REQ-GODWRITE-003]: agentType for Task()
                agentType: preparation.agentType,
                agentCategory: preparation.agentCategory,
                style: preparation.style,
                format: preparation.format,
                length: preparation.length,
                styleProfileId: preparation.styleProfileId,
                styleProfileApplied: preparation.styleProfileApplied,
                descContext: preparation.descContext,
                memoryContext: preparation.memoryContext,
                pipeline: preparation.pipeline,
                // TASK-LOOPFIX-001: Feedback enforcement fields
                feedbackRequired: true,
                feedbackCommand,
              },
              success: true,
              trajectoryId,
              // TASK-LOOPFIX-001: Include orphan warning if any exist
              orphanWarning: getOrphanWarningForJson(),
            });
          } else {
            // Human-readable output
            console.log('\n--- Write Task Preparation ---\n');
            console.log(`Topic: ${input}`);
            console.log(`Selected Agent: ${preparation.selectedAgent}`);
            console.log(`Agent Type: ${preparation.agentType}`);
            console.log(`Agent Category: ${preparation.agentCategory}`);
            console.log(`Style: ${preparation.style}`);
            console.log(`Format: ${preparation.format}`);
            console.log(`Length: ${preparation.length}`);
            console.log(`Pipeline: ${preparation.isPipeline}`);
            if (preparation.styleProfileApplied) {
              console.log(`Style Profile Applied: ${preparation.styleProfileId ?? 'active'}`);
            }
            if (preparation.descContext) {
              console.log(`DESC Context: ${preparation.descContext.substring(0, 100)}...`);
            }
            if (preparation.trajectoryId) {
              console.log(`Trajectory: ${preparation.trajectoryId}`);
            }
            console.log('\n--- Built Prompt ---\n');
            console.log(preparation.builtPrompt);
            console.log('\n--- Execution Instructions ---');
            console.log('Execute via Task() in /god-write skill with:');
            console.log(`  agentType: "${preparation.agentType}"`);
            console.log(`  prompt: [builtPrompt above]`);
          }
        }

        // Implements [REQ-GODWRITE-006]: Shutdown and exit immediately
        await agent.shutdown();
        process.exit(0);
      }

      case 'market-analysis':
      case 'ma': {
        // TASK-GOD-002: Market analysis command - two-phase execution model
        // Implements [REQ-MA-001]: CLI does NOT attempt task execution
        // Implements [REQ-MA-002]: CLI returns builtPrompt in JSON
        // Implements [REQ-MA-006]: CLI exits immediately after JSON output

        // Parse sub-command from first positional argument
        const maSubCommand = positional[0] as 'analyze' | 'scan' | 'compare' | undefined;
        const validSubCommands = ['analyze', 'scan', 'compare'];

        if (!maSubCommand || !validSubCommands.includes(maSubCommand)) {
          if (jsonMode) {
            outputJson({
              command: 'market-analysis',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: maSubCommand
                ? `Invalid sub-command: '${maSubCommand}'. Valid: analyze, scan, compare`
                : 'No sub-command provided. Usage: market-analysis <analyze|scan|compare> [options]',
            });
          } else {
            console.error(maSubCommand
              ? `Error: Invalid sub-command '${maSubCommand}'. Valid sub-commands: analyze, scan, compare`
              : 'Error: No sub-command provided. Usage: market-analysis <analyze|scan|compare> [options]');
          }
          process.exit(1);
        }

        // Parse market analysis flags
        const maTicker = getFlag(flags, 'ticker', 't') as string | undefined;
        const maCompareTicker = getFlag(flags, 'compare', 'c') as string | undefined;
        const maMethodology = getFlag(flags, 'methodology', 'm') as string | undefined;
        const maSignalFilter = getFlag(flags, 'signal', 's') as string | undefined;

        // Validate required flags per sub-command
        if (maSubCommand === 'analyze' && !maTicker) {
          if (jsonMode) {
            outputJson({
              command: 'market-analysis',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'The analyze sub-command requires --ticker/-t flag',
            });
          } else {
            console.error('Error: The analyze sub-command requires --ticker/-t flag');
          }
          process.exit(1);
        }

        if (maSubCommand === 'compare' && (!maTicker || !maCompareTicker)) {
          if (jsonMode) {
            outputJson({
              command: 'market-analysis',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'The compare sub-command requires both --ticker/-t and --compare/-c flags',
            });
          } else {
            console.error('Error: The compare sub-command requires both --ticker/-t and --compare/-c flags');
          }
          process.exit(1);
        }

        // Build task text from sub-command and options
        const maTaskParts: string[] = [`market-analysis ${maSubCommand}`];
        if (maTicker) maTaskParts.push(`ticker:${maTicker}`);
        if (maCompareTicker) maTaskParts.push(`compare:${maCompareTicker}`);
        if (maMethodology) maTaskParts.push(`methodology:${maMethodology}`);
        if (maSignalFilter) maTaskParts.push(`signal:${maSignalFilter}`);
        // Include remaining positional args as additional context
        if (positional.length > 1) {
          maTaskParts.push(positional.slice(1).join(' '));
        }
        const maTask = maTaskParts.join(' ');

        // Phase 1: Prepare task (agent selection, DESC injection, prompt building)
        const maPreparation = await agent.prepareMarketAnalysisTask(maTask, {
          subCommand: maSubCommand,
          ticker: maTicker,
          compareTicker: maCompareTicker,
          methodology: maMethodology,
          signalFilter: maSignalFilter,
        });

        // Implements [REQ-MA-002]: Output structured JSON with builtPrompt
        if (jsonMode) {
          // TASK-LOOPFIX-001: Build feedback command for programmatic enforcement
          const maTrajectoryId = maPreparation.trajectoryId ?? undefined;
          const maFeedbackCommand = maTrajectoryId
            ? `npx tsx src/god-agent/universal/cli.ts feedback "${maTrajectoryId}" [quality_score] --trajectory --notes "Market analysis task completed"`
            : undefined;

          // Machine-readable output for skill consumption
          outputJson({
            command: 'market-analysis',
            selectedAgent: maPreparation.selectedAgent,
            prompt: maTask,
            isPipeline: maPreparation.isPipeline,
            result: {
              // Implements [REQ-MA-002]: builtPrompt field
              builtPrompt: maPreparation.builtPrompt,
              // Implements [REQ-MA-003]: agentType for Task()
              agentType: maPreparation.agentType,
              agentCategory: maPreparation.agentCategory,
              subCommand: maPreparation.subCommand,
              ticker: maPreparation.ticker,
              compareTicker: maPreparation.compareTicker,
              methodology: maPreparation.methodology,
              signalFilter: maPreparation.signalFilter,
              descContext: maPreparation.descContext,
              memoryContext: maPreparation.memoryContext,
              // TASK-LOOPFIX-001: Feedback enforcement fields
              feedbackRequired: true,
              feedbackCommand: maFeedbackCommand,
            },
            success: true,
            trajectoryId: maTrajectoryId,
            // TASK-LOOPFIX-001: Include orphan warning if any exist
            orphanWarning: getOrphanWarningForJson(),
          });
        } else {
          // Human-readable output
          console.log('\n--- Market Analysis Task Preparation ---\n');
          console.log(`Sub-command: ${maPreparation.subCommand}`);
          if (maPreparation.ticker) console.log(`Ticker: ${maPreparation.ticker}`);
          if (maPreparation.compareTicker) console.log(`Compare Ticker: ${maPreparation.compareTicker}`);
          if (maPreparation.methodology) console.log(`Methodology: ${maPreparation.methodology}`);
          if (maPreparation.signalFilter) console.log(`Signal Filter: ${maPreparation.signalFilter}`);
          console.log(`Selected Agent: ${maPreparation.selectedAgent}`);
          console.log(`Agent Type: ${maPreparation.agentType}`);
          console.log(`Agent Category: ${maPreparation.agentCategory}`);
          console.log(`Pipeline: ${maPreparation.isPipeline}`);
          if (maPreparation.descContext) {
            console.log(`DESC Context: ${maPreparation.descContext.substring(0, 100)}...`);
          }
          if (maPreparation.trajectoryId) {
            console.log(`Trajectory: ${maPreparation.trajectoryId}`);
          }
          console.log('\n--- Built Prompt ---\n');
          console.log(maPreparation.builtPrompt);
          console.log('\n--- Execution Instructions ---');
          console.log('Execute via Task() in /god-market-analysis skill with:');
          console.log(`  agentType: "${maPreparation.agentType}"`);
          console.log(`  prompt: [builtPrompt above]`);
        }

        // Implements [REQ-MA-006]: Shutdown and exit immediately
        await agent.shutdown();
        process.exit(0);
      }

      case 'status':
      case 's': {
        const status = agent.getStatus();
        const stats = agent.getStats();
        if (jsonMode) {
          outputJson({
            command: 'status',
            selectedAgent: getSelectedAgent(command),
            prompt: '',
            isPipeline: false,
            result: {
              initialized: status.initialized,
              runtime: status.runtime,
              health: status.health,
              stats: {
                totalInteractions: stats.totalInteractions,
                knowledgeEntries: stats.knowledgeEntries,
                domainExpertise: stats.domainExpertise,
              },
            },
            success: true,
          });
        } else {
          console.log('\n--- Universal Agent Status ---\n');
          console.log(`Initialized: ${status.initialized}`);
          console.log(`Runtime: ${status.runtime}`);
          console.log(`Health: ${JSON.stringify(status.health)}`);
          console.log('\n--- Learning Stats ---\n');
          console.log(`Total interactions: ${stats.totalInteractions}`);
          console.log(`Knowledge entries: ${stats.knowledgeEntries}`);
          console.log(`Domain expertise: ${JSON.stringify(stats.domainExpertise)}`);
        }
        break;
      }

      case 'feedback':
      case 'f': {
        const id = positional[0];
        const rating = positional[1];
        const notes = getFlag(flags, 'notes', 'n') as string | undefined;
        const isTrajectory = getFlag(flags, 'trajectory', 't') !== undefined;

        if (!id || !rating) {
          if (jsonMode) {
            outputJson({
              command: 'feedback',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'ID and rating required',
            });
          } else {
            console.error('Error: Please provide ID and rating (0-1)');
            console.error('Usage: feedback <id> <rating> [--notes "..."] [--trajectory]');
          }
          process.exit(1);
        }

        const feedbackResult = await agent.feedback(id, parseFloat(rating), {
          notes,
          isTrajectoryId: isTrajectory,
        });
        if (jsonMode) {
          outputJson({
            command: 'feedback',
            selectedAgent: getSelectedAgent(command),
            prompt: `${id} ${rating}`,
            isPipeline: false,
            result: {
              id,
              rating: parseFloat(rating),
              notes,
              weightUpdates: feedbackResult.weightUpdates,
              patternCreated: feedbackResult.patternCreated,
            },
            success: true,
          });
        } else {
          console.log(`\n--- Feedback Recorded ---`);
          console.log(`ID: ${id}`);
          console.log(`Rating: ${rating}`);
          if (notes) console.log(`Notes: ${notes}`);
          console.log(`Weight updates: ${feedbackResult.weightUpdates}`);
          console.log(`Pattern created: ${feedbackResult.patternCreated}`);
        }
        break;
      }

      case 'code-feedback':
      case 'cf': {
        // code-feedback <trajectoryId> [--output <code>] [--file <path>] [--agent <key>] [--phase <num>]
        const trajectoryId = positional[0];

        if (!trajectoryId) {
          if (jsonMode) {
            outputJson({
              command: 'code-feedback',
              selectedAgent: 'code-feedback-agent',
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'Trajectory ID required',
            });
          } else {
            console.error('Error: Please provide trajectory ID');
            console.error('Usage: code-feedback <trajectoryId> [--output <code>] [--file <path>] [--agent <key>] [--phase <num>]');
          }
          process.exit(1);
        }

        // Get output from --output flag, --file flag, or stdin
        let codeOutput: string;
        const outputFlag = getFlag(flags, 'output', 'o') as string | undefined;
        const fileFlag = getFlag(flags, 'file', 'f') as string | undefined;

        if (outputFlag) {
          codeOutput = outputFlag;
        } else if (fileFlag) {
          try {
            const filePath = path.resolve(fileFlag);
            codeOutput = await fs.readFile(filePath, 'utf-8');
            if (!jsonMode) console.log(`Reading output from: ${filePath}`);
          } catch (err) {
            if (jsonMode) {
              outputJson({
                command: 'code-feedback',
                selectedAgent: 'code-feedback-agent',
                prompt: trajectoryId,
                isPipeline: false,
                result: null,
                success: false,
                error: `Error reading file: ${fileFlag}`,
              });
            } else {
              console.error(`Error reading file: ${fileFlag}`);
            }
            process.exit(1);
          }
        } else {
          // Use remaining positional args as output
          codeOutput = positional.slice(1).join(' ') || '';
        }

        // Get optional context
        const agentKey = getFlag(flags, 'agent', 'a') as string | undefined;
        const phaseStr = getFlag(flags, 'phase', 'p') as string | undefined;
        const phase = phaseStr ? parseInt(phaseStr, 10) : undefined;

        try {
          const result = await submitCodeFeedback(trajectoryId, codeOutput, { agentKey, phase });

          if (jsonMode) {
            outputJson({
              command: 'code-feedback',
              selectedAgent: 'code-feedback-agent',
              prompt: trajectoryId,
              isPipeline: false,
              result: {
                trajectoryId: result.trajectoryId,
                quality: result.quality,
                tier: result.assessment.tier,
                breakdown: result.assessment.breakdown,
                summary: result.assessment.summary,
                meetsPatternThreshold: result.assessment.meetsPatternThreshold,
                weightUpdates: result.weightUpdates,
                patternCreated: result.patternCreated,
              },
              success: true,
              qualityScore: result.quality,
            });
          } else {
            console.log(`\n--- Code Feedback Recorded ---`);
            console.log(`Trajectory: ${result.trajectoryId}`);
            console.log(`Quality: ${(result.quality * 100).toFixed(1)}% (${result.assessment.tier})`);
            console.log(`Summary: ${result.assessment.summary}`);
            console.log(`\n--- Breakdown ---`);
            console.log(`  Code Quality: ${(result.assessment.breakdown.codeQuality * 100).toFixed(1)}% / 30%`);
            console.log(`  Completeness: ${(result.assessment.breakdown.completeness * 100).toFixed(1)}% / 25%`);
            console.log(`  Structure: ${(result.assessment.breakdown.structuralIntegrity * 100).toFixed(1)}% / 20%`);
            console.log(`  Documentation: ${(result.assessment.breakdown.documentationScore * 100).toFixed(1)}% / 15%`);
            console.log(`  Test Coverage: ${(result.assessment.breakdown.testCoverage * 100).toFixed(1)}% / 10%`);
            console.log(`\n--- Learning ---`);
            console.log(`Weight updates: ${result.weightUpdates}`);
            console.log(`Pattern created: ${result.patternCreated}`);
            console.log(`Meets pattern threshold (80%): ${result.assessment.meetsPatternThreshold}`);
          }
        } catch (error) {
          if (jsonMode) {
            outputJson({
              command: 'code-feedback',
              selectedAgent: 'code-feedback-agent',
              prompt: trajectoryId,
              isPipeline: false,
              result: null,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            console.error(`Error submitting code feedback: ${error}`);
          }
          process.exit(1);
        }
        break;
      }

      case 'auto-complete-coding':
      case 'acc': {
        // auto-complete-coding [--route <route>] [--dry-run]
        const routeFilter = getFlag(flags, 'route', 'r') as string | undefined;
        const dryRun = getFlag(flags, 'dry-run', 'd') === true;

        try {
          const result = await autoCompleteCodingTrajectories(routeFilter, dryRun);

          if (jsonMode) {
            outputJson({
              command: 'auto-complete-coding',
              selectedAgent: 'auto-complete-agent',
              prompt: routeFilter || 'all-coding',
              isPipeline: false,
              result: {
                totalFound: result.totalFound,
                completed: result.completed,
                skipped: result.skipped,
                errorCount: result.errors.length,
                errors: result.errors,
                details: result.details,
                dryRun,
              },
              success: result.errors.length === 0,
            });
          } else {
            console.log(`\n--- Auto-Complete Coding Trajectories ---`);
            if (dryRun) {
              console.log(`[DRY RUN - No changes made]`);
            }
            console.log(`Route filter: ${routeFilter || 'all coding routes'}`);
            console.log(`\n--- Summary ---`);
            console.log(`  Orphaned found: ${result.totalFound}`);
            console.log(`  Completed: ${result.completed}`);
            console.log(`  Skipped: ${result.skipped}`);
            console.log(`  Errors: ${result.errors.length}`);

            if (result.details.length > 0) {
              console.log(`\n--- Details ---`);
              for (const detail of result.details) {
                const statusIcon = detail.status === 'completed' ? '[OK]' :
                                   detail.status === 'skipped' ? '[SKIP]' : '[ERR]';
                console.log(`  ${statusIcon} ${detail.trajectoryId.slice(0, 16)}... (${detail.route}) - ${detail.status}`);
                if (detail.status === 'completed') {
                  console.log(`       Quality: ${(detail.quality * 100).toFixed(1)}%`);
                }
                if (detail.reason) {
                  console.log(`       Reason: ${detail.reason}`);
                }
              }
            }

            if (result.errors.length > 0) {
              console.log(`\n--- Errors ---`);
              for (const error of result.errors) {
                console.log(`  - ${error}`);
              }
            }
          }
        } catch (error) {
          if (jsonMode) {
            outputJson({
              command: 'auto-complete-coding',
              selectedAgent: 'auto-complete-agent',
              prompt: routeFilter || 'all-coding',
              isPipeline: false,
              result: null,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            console.error(`Error auto-completing trajectories: ${error}`);
          }
          process.exit(1);
        }
        break;
      }

      case 'batch-learn':
      case 'bl': {
        // batch-learn [--limit <num>] [--dry-run]
        // Process unprocessed feedback records for batch learning
        const limitStr = getFlag(flags, 'limit', 'n') as string | undefined;
        const batchLimit = limitStr ? parseInt(limitStr, 10) : 100;
        const dryRun = getFlag(flags, 'dry-run', 'd') === true;

        try {
          const engine = getSonaEngine();
          if (!engine) {
            if (jsonMode) {
              outputJson({
                command: 'batch-learn',
                selectedAgent: 'batch-learn-agent',
                prompt: `limit=${batchLimit}`,
                isPipeline: false,
                result: null,
                success: false,
                error: 'SonaEngine not available',
              });
            } else {
              console.error('Error: SonaEngine not available');
            }
            process.exit(1);
          }

          // Initialize engine if needed
          await engine.initialize();

          // Check unprocessed count first
          const unprocessedCount = engine.getUnprocessedFeedbackCount();

          if (dryRun) {
            // Dry run: just report what would be done
            if (jsonMode) {
              outputJson({
                command: 'batch-learn',
                selectedAgent: 'batch-learn-agent',
                prompt: `limit=${batchLimit}`,
                isPipeline: false,
                result: {
                  dryRun: true,
                  unprocessedCount,
                  wouldProcess: Math.min(unprocessedCount, batchLimit),
                  message: `Would process up to ${Math.min(unprocessedCount, batchLimit)} of ${unprocessedCount} unprocessed records`,
                },
                success: true,
              });
            } else {
              console.log('\n--- Batch Learn (Dry Run) ---');
              console.log(`Unprocessed feedback records: ${unprocessedCount}`);
              console.log(`Would process: up to ${Math.min(unprocessedCount, batchLimit)} records`);
              console.log(`\nTo execute, run without --dry-run flag`);
            }
          } else {
            // Execute batch processing
            const result = await engine.processUnprocessedFeedback(batchLimit);

            if (jsonMode) {
              outputJson({
                command: 'batch-learn',
                selectedAgent: 'batch-learn-agent',
                prompt: `limit=${batchLimit}`,
                isPipeline: false,
                result: {
                  processed: result.processed,
                  patternsCreated: result.patternsCreated,
                  errors: result.errors,
                  details: result.details,
                  remainingUnprocessed: engine.getUnprocessedFeedbackCount(),
                },
                success: result.errors === 0,
              });
            } else {
              console.log('\n--- Batch Learn Results ---');
              console.log(`Processed: ${result.processed} feedback records`);
              console.log(`Patterns created: ${result.patternsCreated}`);
              console.log(`Errors: ${result.errors}`);

              if (result.details.length > 0 && result.details.length <= 10) {
                console.log('\n--- Details ---');
                for (const detail of result.details) {
                  const statusIcon = detail.status === 'pattern_created' ? '[PATTERN]' :
                                    detail.status === 'processed' ? '[OK]' :
                                    detail.status === 'skipped' ? '[SKIP]' : '[ERR]';
                  console.log(`  ${statusIcon} ${detail.feedbackId.slice(0, 20)}... - quality: ${(detail.quality * 100).toFixed(1)}%`);
                  if (detail.reason) {
                    console.log(`       Reason: ${detail.reason}`);
                  }
                }
              } else if (result.details.length > 10) {
                console.log(`\n(${result.details.length} details omitted for brevity, use --json for full output)`);
              }

              const remaining = engine.getUnprocessedFeedbackCount();
              if (remaining > 0) {
                console.log(`\nRemaining unprocessed: ${remaining}`);
                console.log('Run again to process more records.');
              } else {
                console.log('\nAll feedback records have been processed.');
              }
            }
          }
        } catch (error) {
          if (jsonMode) {
            outputJson({
              command: 'batch-learn',
              selectedAgent: 'batch-learn-agent',
              prompt: `limit=${batchLimit}`,
              isPipeline: false,
              result: null,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            console.error(`Error in batch learning: ${error}`);
          }
          process.exit(1);
        }
        break;
      }

      case 'learn':
      case 'l': {
        // Get content from positional args OR file
        const fileArg = getFlag(flags, 'file') as string | undefined;
        let content: string;

        if (fileArg) {
          // Read from file
          const filePath = path.resolve(fileArg);
          try {
            content = await fs.readFile(filePath, 'utf-8');
            if (!jsonMode) console.log(`Reading from: ${filePath}`);
          } catch (err) {
            if (jsonMode) {
              outputJson({
                command: 'learn',
                selectedAgent: getSelectedAgent(command),
                prompt: '',
                isPipeline: false,
                result: null,
                success: false,
                error: `Error reading file: ${filePath}`,
              });
            } else {
              console.error(`Error reading file: ${filePath}`);
            }
            process.exit(1);
          }
        } else if (input) {
          content = input;
        } else {
          if (jsonMode) {
            outputJson({
              command: 'learn',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: 'No content provided',
            });
          } else {
            console.error('Error: Please provide knowledge content or --file path');
            console.error('Usage: learn "content" [--domain name] [--category type] [--tags a,b,c]');
            console.error('       learn --file ./file.md [--domain name] [--category type]');
          }
          process.exit(1);
        }

        // Get metadata options
        const domain = (getFlag(flags, 'domain', 'd') as string) || 'general';
        const category = (getFlag(flags, 'category', 'c') as string) || 'fact';
        const tagsStr = getFlag(flags, 'tags', 't') as string | undefined;
        const tags = tagsStr
          ? tagsStr.split(',').map(t => t.trim())
          : content.split(' ').filter(w => w.length > 4 && !w.includes('/') && !w.includes('.')).slice(0, 5);

        const id = await agent.storeKnowledge({
          content,
          type: category as 'fact' | 'pattern' | 'procedure' | 'example' | 'insight',
          domain,
          tags,
        });

        if (jsonMode) {
          outputJson({
            command: 'learn',
            selectedAgent: getSelectedAgent(command),
            prompt: content.slice(0, 100),
            isPipeline: false,
            result: {
              id,
              domain,
              category,
              tags,
              contentLength: content.length,
            },
            success: true,
          });
        } else {
          console.log(`\n--- Knowledge Stored ---`);
          console.log(`ID: ${id}`);
          console.log(`Domain: ${domain}`);
          console.log(`Category: ${category}`);
          console.log(`Tags: ${tags.join(', ')}`);
          console.log(`Content length: ${content.length} chars`);
        }
        break;
      }

      case 'query':
      case 'q': {
        const queryDomain = getFlag(flags, 'domain', 'd') as string | undefined;
        const tagsStr = getFlag(flags, 'tags', 't') as string | undefined;
        const limit = parseInt((getFlag(flags, 'limit', 'n') as string) || '10', 10);

        if (!queryDomain) {
          if (jsonMode) {
            outputJson({
              command: 'query',
              selectedAgent: getSelectedAgent(command),
              prompt: '',
              isPipeline: false,
              result: null,
              success: false,
              error: '--domain required',
            });
          } else {
            console.error('Error: Please provide --domain');
            console.error('Usage: query --domain "project/api" [--tags "schema,api"] [--limit 10]');
          }
          process.exit(1);
        }

        // Access InteractionStore directly for queries
        const interactionStore = (agent as any).interactionStore;
        if (!interactionStore) {
          if (jsonMode) {
            outputJson({
              command: 'query',
              selectedAgent: getSelectedAgent(command),
              prompt: queryDomain,
              isPipeline: false,
              result: null,
              success: false,
              error: 'InteractionStore not available',
            });
          } else {
            console.error('Error: InteractionStore not available');
          }
          process.exit(1);
        }

        let results = interactionStore.getKnowledgeByDomain(queryDomain);

        // Filter by tags if provided
        if (tagsStr) {
          const filterTags = tagsStr.split(',').map(t => t.trim());
          results = results.filter((k: any) =>
            k.tags?.some((t: string) => filterTags.includes(t))
          );
        }

        // Limit results
        results = results.slice(0, limit);

        if (jsonMode) {
          outputJson({
            command: 'query',
            selectedAgent: getSelectedAgent(command),
            prompt: queryDomain,
            isPipeline: false,
            result: {
              domain: queryDomain,
              tagsFilter: tagsStr || null,
              count: results.length,
              entries: results.map((e: any) => ({
                id: e.id,
                category: e.category,
                tags: e.tags,
                contentPreview: e.content.slice(0, 200),
              })),
            },
            success: true,
          });
        } else {
          console.log(`\n--- Query Results ---`);
          console.log(`Domain: ${queryDomain}`);
          if (tagsStr) console.log(`Tags filter: ${tagsStr}`);
          console.log(`Found: ${results.length} entries\n`);

          for (const entry of results) {
            console.log(`[${entry.id}] (${entry.category})`);
            console.log(`  Tags: ${entry.tags?.join(', ') || 'none'}`);
            console.log(`  Content: ${entry.content.slice(0, 100)}${entry.content.length > 100 ? '...' : ''}`);
            console.log();
          }
        }
        break;
      }

      case 'help':
      case 'h':
      case '--help':
      case '-h':
        if (jsonMode) {
          outputJson({
            command: 'help',
            selectedAgent: 'help-agent',
            prompt: '',
            isPipeline: false,
            result: {
              commands: ['ask', 'code', 'research', 'write', 'market-analysis', 'status', 'learn', 'feedback', 'code-feedback', 'auto-complete-coding', 'batch-learn', 'query', 'help'],
              usage: 'npx tsx src/god-agent/universal/cli.ts <command> [input] [options]',
            },
            success: true,
          });
        } else {
          printHelp();
        }
        break;

      default:
        if (jsonMode) {
          outputJson({
            command,
            selectedAgent: 'unknown',
            prompt: input,
            isPipeline: false,
            result: null,
            success: false,
            error: `Unknown command: ${command}`,
          });
        } else {
          console.error(`Unknown command: ${command}`);
          printHelp();
        }
        process.exit(1);
    }

    await agent.shutdown();

    // Explicitly exit to ensure all timers/handles are cleaned up
    process.exit(0);
  } catch (error) {
    if (jsonMode) {
      outputJson({
        command,
        selectedAgent: getSelectedAgent(command),
        prompt: input,
        isPipeline: false,
        result: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      console.error('Error:', error);
    }
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║          Universal Self-Learning God Agent CLI                   ║
╚══════════════════════════════════════════════════════════════════╝

USAGE:
  npx tsx src/god-agent/universal/cli.ts <command> [input] [options]

COMMANDS:
  ask, a      <text>                    Ask anything - auto-detects mode
  code, c     <task>                    Generate code with pattern learning
  research, r <query>                   Research a topic deeply
  write, w    <topic> [options]         Write documents/articles/papers
  market-analysis, ma <sub-cmd> [opts] Analyze tickers (analyze/scan/compare)
  status, s                             Show agent status and learning stats
  learn, l    <content> [options]       Store knowledge (text or file)
  feedback, f <id> <rating> [options]   Provide feedback (0-1) for learning
  code-feedback, cf <trajectoryId>      Code-specific feedback with quality analysis
  auto-complete-coding, acc             Auto-complete orphaned coding trajectories
  batch-learn, bl [options]             Process unprocessed feedback for batch learning
  query, q    --domain <name> [options] Query stored knowledge
  help, h                               Show this help

LEARN OPTIONS:
  --file, -f <path>      Read content from file (markdown, text, etc.)
  --domain, -d <name>    Domain namespace (default: "general")
  --category, -c <type>  Category: fact, pattern, experience, concept
  --tags, -t <a,b,c>     Comma-separated tags for filtering

FEEDBACK OPTIONS:
  --notes, -n <text>     Additional notes about the feedback
  --trajectory, -t       ID is a trajectory ID (not interaction ID)

CODE-FEEDBACK OPTIONS:
  --output, -o <code>    Code output to analyze (inline)
  --file, -f <path>      Read code output from file
  --agent, -a <key>      Agent key for context-aware scoring (e.g., "code-generator")
  --phase, -p <num>      Pipeline phase number (1-7) for phase weighting

AUTO-COMPLETE-CODING OPTIONS:
  --route, -r <route>    Filter by route (e.g., "code", "code-pipeline")
  --dry-run, -d          Show what would be done without making changes

BATCH-LEARN OPTIONS:
  --limit, -n <num>      Max records to process per batch (default: 100)
  --dry-run, -d          Show unprocessed count without processing

QUERY OPTIONS:
  --domain, -d <name>    Domain to query (required)
  --tags, -t <a,b,c>     Filter by tags (comma-separated)
  --limit, -n <num>      Max results (default: 10)

WRITE OPTIONS:
  --style, -s <type>     academic, professional, casual, technical
  --length, -l <size>    short, medium, long, comprehensive
  --format, -f <type>    essay, report, article, paper
  --style-profile, -p <id>  Style profile ID for learned writing styles
  --execute, -e          Execute full write (legacy mode, bypasses two-phase)

MARKET-ANALYSIS OPTIONS:
  --ticker, -t <sym>     Ticker symbol to analyze (required for analyze/compare)
  --compare, -c <sym>    Comparison ticker (required for compare sub-command)
  --methodology, -m <m>  Methodology filter (e.g., wyckoff, elliott, ict, canslim)
  --signal, -s <filter>  Signal filter (e.g., bullish, bearish, neutral)

GLOBAL OPTIONS:
  --json, -j             Output results as JSON (DAI-002: machine-readable)
                         JSON includes: command, selectedAgent, prompt, isPipeline, result, success

EXAMPLES:
  # Store knowledge directly
  npx tsx src/god-agent/universal/cli.ts learn "REST APIs should use proper HTTP status codes"

  # Store knowledge with metadata
  npx tsx src/god-agent/universal/cli.ts learn "Factory pattern enables..." -d "patterns" -c "pattern" -t "design,factory"

  # Store knowledge from file
  npx tsx src/god-agent/universal/cli.ts learn -f ./docs/learnings.md -d "project/docs" -c "fact"

  # Provide feedback with notes
  npx tsx src/god-agent/universal/cli.ts feedback abc123 0.95 --notes "Implementation successful"

  # Query stored knowledge
  npx tsx src/god-agent/universal/cli.ts query -d "project/api" -t "schema" -n 5

  # Generate code (outputs trajectory ID for feedback)
  npx tsx src/god-agent/universal/cli.ts code "Implement a cache with LRU eviction"

  # Write with options
  npx tsx src/god-agent/universal/cli.ts write "Machine Learning" --style academic --format paper

  # Check status
  npx tsx src/god-agent/universal/cli.ts status

  # Get JSON output for machine processing (DAI-002)
  npx tsx src/god-agent/universal/cli.ts status --json
  npx tsx src/god-agent/universal/cli.ts code "Implement a linked list" --json

  # Code-specific feedback with quality analysis
  npx tsx src/god-agent/universal/cli.ts code-feedback traj_abc123 --file ./output.ts --agent code-generator --phase 4
  npx tsx src/god-agent/universal/cli.ts cf traj_abc123 --output "export function hello() { return 'world'; }"

  # Auto-complete orphaned coding trajectories
  npx tsx src/god-agent/universal/cli.ts auto-complete-coding --dry-run
  npx tsx src/god-agent/universal/cli.ts acc --route code-pipeline
  npx tsx src/god-agent/universal/cli.ts acc --json

  # Batch process unprocessed feedback for learning
  npx tsx src/god-agent/universal/cli.ts batch-learn --dry-run
  npx tsx src/god-agent/universal/cli.ts batch-learn --limit 50
  npx tsx src/god-agent/universal/cli.ts bl --json

  # Market analysis commands
  npx tsx src/god-agent/universal/cli.ts market-analysis analyze --ticker AAPL --methodology wyckoff
  npx tsx src/god-agent/universal/cli.ts ma scan --signal bullish --methodology ict
  npx tsx src/god-agent/universal/cli.ts ma compare --ticker AAPL --compare MSFT
  npx tsx src/god-agent/universal/cli.ts ma analyze -t TSLA -m canslim --json

SELF-LEARNING:
  The agent automatically learns from every interaction:
  - Successful patterns are reinforced via feedback
  - Knowledge accumulates in InteractionStore
  - Domain expertise grows with usage
  - ReasoningBank improves pattern matching

DOMAIN CONVENTIONS:
  project/events      Event schemas and structures
  project/api         API contracts and endpoints
  project/frontend    Frontend components and patterns
  project/database    Database schemas
  project/tests       Test documentation
  project/docs        General documentation
  patterns            Reusable implementation patterns
  general             Uncategorized knowledge

`);
}

main().catch(console.error);
