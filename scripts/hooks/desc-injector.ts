#!/usr/bin/env node
/**
 * DESC Injector Hook - IDESC v2 Integration
 * TASK-IDESC-INT-001: Update DESC Injector Hook with All Features
 * Sprint 7: Integration
 *
 * PreToolUse hook for Task tool that injects prior solutions with:
 * - Confidence levels (REQ-IDESC-006, REQ-IDESC-007, REQ-IDESC-008)
 * - Negative example warnings (REQ-IDESC-003, REQ-IDESC-004)
 * - Reasoning traces (TASK-IDESC-RB-003)
 * - Success rate metadata (REQ-IDESC-001, REQ-IDESC-002)
 */

import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import type {
  ITaskContext,
  IEnhancedRetrievalResult,
  IRetrievalOptions,
  ConfidenceLevel
} from '../../src/god-agent/core/ucm/types.js';

// ============================================================================
// Hook Types
// ============================================================================

interface IHookInput {
  tool_name: string;
  tool_input: {
    prompt: string;
    subagent_type?: string;
    [key: string]: unknown;
  };
  session_id: string;
}

interface IHookOutput {
  decision: 'allow' | 'deny';
  reason: string;
  modify_tool_input?: {
    prompt: string;
    [key: string]: unknown;
  };
}

export interface IDescInjectorConfig {
  maxEpisodes: number;          // Default 3
  minConfidence: ConfidenceLevel; // Default 'LOW'
  includeWarnings: boolean;     // Default true
  includeReasoningTraces: boolean; // Default true
  threshold: number;            // Default 0.7
}

export interface IDescInjectionResult {
  injectedContent: string;
  episodeIds: string[];
  totalEpisodes: number;
  confidenceLevels: ConfidenceLevel[];
  warningsIncluded: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: IDescInjectorConfig = {
  maxEpisodes: 3,
  minConfidence: 'LOW',
  includeWarnings: true,
  includeReasoningTraces: true,
  threshold: 0.7
};

// ============================================================================
// Dynamic Import Helpers
// ============================================================================

/**
 * Get the project root directory
 */
function getProjectRoot(): string {
  // For hooks, we're in scripts/hooks/, so go up two levels to project root
  return path.resolve(process.cwd());
}

/**
 * Lazy-load UCM modules to avoid circular dependencies
 */
async function getUCMModules() {
  const projectRoot = getProjectRoot();
  const ucmPath = path.join(projectRoot, 'src/god-agent/core/ucm/desc/index.js');

  try {
    const ucm = await import(ucmPath);
    return ucm;
  } catch (error) {
    console.error('[DESC-Injector] Failed to load UCM modules:', error);
    throw error;
  }
}

/**
 * Get database connection for UCM
 */
async function getDatabaseConnection() {
  const projectRoot = getProjectRoot();
  const dbPath = path.join(projectRoot, '.god-agent/events.db');

  // Lazy-load better-sqlite3
  try {
    const sqlite3Module = await import('better-sqlite3');
    const BetterSqlite3 = sqlite3Module.default || sqlite3Module;
    const db = new (BetterSqlite3 as any)(dbPath);

    return {
      prepare: (sql: string) => db.prepare(sql),
      exec: (sql: string) => db.exec(sql),
      close: () => db.close()
    };
  } catch (error) {
    console.error('[DESC-Injector] Failed to connect to database:', error);
    throw error;
  }
}

// ============================================================================
// DESC Injection Logic
// ============================================================================

/**
 * Inject similar solutions using IDESC v2 features
 */
async function descInjectorHook(
  taskContext: ITaskContext,
  config: IDescInjectorConfig = DEFAULT_CONFIG
): Promise<IDescInjectionResult> {
  try {
    // 1. Load UCM modules
    const ucm = await getUCMModules();
    const db = await getDatabaseConnection();

    // 2. Create services
    const retriever = new ucm.EpisodeRetriever(db);
    const outcomeTracker = ucm.createOutcomeTracker(db);
    const negativeProvider = ucm.createNegativeExampleProvider(outcomeTracker, {
      minimumOutcomes: 3,
      warningThreshold: 0.50
    });
    const injectionFilter = ucm.createEnhancedInjectionFilter(outcomeTracker);
    const traceSummarizer = ucm.createTraceSummarizer();

    // 3. Retrieve similar episodes
    const retrievalOptions: IRetrievalOptions = {
      maxResults: config.maxEpisodes,
      threshold: config.threshold
    };

    const results = await retriever.retrieve(
      taskContext.task || '',
      retrievalOptions
    );

    if (results.length === 0) {
      return {
        injectedContent: '',
        episodeIds: [],
        totalEpisodes: 0,
        confidenceLevels: [],
        warningsIncluded: false
      };
    }

    // 4. Enhance with negative example info
    const enhanced = await negativeProvider.enhanceResults(results);

    // 5. Filter by confidence
    const filtered: Array<IEnhancedRetrievalResult & { confidence: ConfidenceLevel }> = [];

    for (const result of enhanced) {
      const decision = await injectionFilter.shouldInjectEnhanced(
        result,
        result.maxSimilarity,
        taskContext
      );

      if (decision.inject && shouldIncludeByConfidence(decision.confidence, config.minConfidence)) {
        filtered.push({
          ...result,
          confidence: decision.confidence
        });
      }
    }

    // 6. Format injection content
    let injectedContent = '';
    const confidenceLevels: ConfidenceLevel[] = [];
    let hasWarnings = false;

    for (const episode of filtered) {
      const formattedEpisode = await formatEpisodeForInjection(
        episode,
        traceSummarizer,
        config
      );

      injectedContent += formattedEpisode;
      confidenceLevels.push(episode.confidence);

      if (episode.warning) {
        hasWarnings = true;
      }
    }

    // Close database connection
    db.close();

    return {
      injectedContent,
      episodeIds: filtered.map(e => e.episodeId),
      totalEpisodes: filtered.length,
      confidenceLevels,
      warningsIncluded: hasWarnings
    };

  } catch (error) {
    console.error('[DESC-Injector] Error during injection:', error);
    return {
      injectedContent: '',
      episodeIds: [],
      totalEpisodes: 0,
      confidenceLevels: [],
      warningsIncluded: false
    };
  }
}

/**
 * Check if confidence level meets minimum threshold
 */
function shouldIncludeByConfidence(
  confidence: ConfidenceLevel,
  minConfidence: ConfidenceLevel
): boolean {
  const confidenceOrder: ConfidenceLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  const confidenceIndex = confidenceOrder.indexOf(confidence);
  const minConfidenceIndex = confidenceOrder.indexOf(minConfidence);

  return confidenceIndex >= minConfidenceIndex;
}

/**
 * Format episode for injection with all IDESC v2 features
 */
async function formatEpisodeForInjection(
  episode: IEnhancedRetrievalResult & { confidence: ConfidenceLevel },
  traceSummarizer: any,
  config: IDescInjectorConfig
): Promise<string> {
  const parts: string[] = [];

  // Opening tag with metadata
  parts.push(
    `<!-- prior_solution ` +
    `episode="${episode.episodeId}" ` +
    `confidence="${episode.confidence}" ` +
    `similarity="${episode.maxSimilarity.toFixed(3)}" ` +
    `success_rate="${episode.successRate !== null ? episode.successRate.toFixed(3) : 'n/a'}" ` +
    `outcomes="${episode.outcomeCount}" ` +
    `-->`
  );

  // Add warning if present and enabled
  if (config.includeWarnings && episode.warning) {
    parts.push('');
    parts.push('### ⚠️ Warning: Prior Failures Detected');
    parts.push(episode.warning.warningText);
    parts.push('');
  }

  // Add main content
  parts.push('');
  parts.push('### Prior Solution');
  parts.push(episode.answerText);
  parts.push('');

  // Add reasoning trace if available and enabled
  if (config.includeReasoningTraces && episode.metadata?.reasoningTrace) {
    const reasoningTrace = episode.metadata.reasoningTrace as string;
    const formatted = await traceSummarizer.formatForInjection(
      reasoningTrace,
      episode.answerText.substring(0, 100) + '...'
    );

    if (formatted) {
      parts.push(formatted);
      parts.push('');
    }
  }

  parts.push('<!-- /prior_solution -->');
  parts.push('');

  return parts.join('\n');
}

// ============================================================================
// Hook Entry Point
// ============================================================================

/**
 * Main hook logic for Claude Code PreToolUse
 */
async function processHook(input: IHookInput): Promise<IHookOutput> {
  // Only process Task tool calls
  if (input.tool_name !== 'Task') {
    return {
      decision: 'allow',
      reason: 'Not a Task tool call'
    };
  }

  const { prompt, subagent_type } = input.tool_input;

  if (!prompt || typeof prompt !== 'string') {
    return {
      decision: 'allow',
      reason: 'No prompt to augment'
    };
  }

  try {
    // Build task context for filtering
    const taskContext: ITaskContext = {
      agentId: subagent_type as string | undefined,
      task: prompt,
      sessionId: input.session_id,
      metadata: input.tool_input
    };

    // Use default configuration
    const config = DEFAULT_CONFIG;

    // Perform DESC injection
    const result = await descInjectorHook(taskContext, config);

    if (!result.injectedContent || result.totalEpisodes === 0) {
      return {
        decision: 'allow',
        reason: 'No similar solutions found'
      };
    }

    // Inject prior solutions into prompt
    const augmentedPrompt = `${prompt}

---

## Context: Prior Solutions from DESC (${result.totalEpisodes} episodes)

${result.injectedContent}

**Note**: Use these solutions as reference. Confidence levels indicate reliability.
${result.warningsIncluded ? '**⚠️ Some episodes have warnings - review carefully before using.**' : ''}

---
`;

    // Log injection results
    console.error(
      `[DESC-Injector] Injected ${result.totalEpisodes} episodes for ${subagent_type || 'agent'} ` +
      `(confidence: ${result.confidenceLevels.join(', ')}, warnings: ${result.warningsIncluded})`
    );

    return {
      decision: 'allow',
      reason: 'Prompt augmented with DESC prior solutions',
      modify_tool_input: {
        ...input.tool_input,
        prompt: augmentedPrompt
      }
    };

  } catch (error) {
    console.error('[DESC-Injector] Error during injection:', error);
    return {
      decision: 'allow',
      reason: 'Failed to inject solutions, proceeding with original prompt'
    };
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    try {
      const input: IHookInput = JSON.parse(line);
      const output = await processHook(input);
      console.log(JSON.stringify(output));
    } catch (error) {
      console.error('[DESC-Injector] Error processing hook:', error);
      console.log(
        JSON.stringify({
          decision: 'allow',
          reason: 'Hook processing error'
        })
      );
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[DESC-Injector] Fatal error:', error);
  process.exit(1);
});
