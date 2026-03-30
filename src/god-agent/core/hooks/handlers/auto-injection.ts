/**
 * Auto-Injection Hook
 * TASK-HOOK-004 - Auto-Injection into Task() Spawns
 *
 * A preToolUse hook that injects relevant god-agent context
 * (DESC episodes and SonaEngine patterns) into Task() prompts.
 *
 * CONSTITUTION COMPLIANCE:
 * - REQ-CONST-003: Auto-injection into ALL Task() spawns
 * - RULE-032: Hooks registered at daemon startup
 */

import {
  registerPreToolUseHook,
  DEFAULT_PRIORITIES,
  type IHookContext,
  type IHookResult
} from '../index.js';
import { createComponentLogger } from '../../observability/logger.js';

const logger = createComponentLogger('AutoInjectionHook');

// ============================================================================
// Service Interfaces (Late Binding)
// ============================================================================

/**
 * DESC Service interface for episode retrieval
 * Uses late binding to avoid circular dependencies
 */
export interface IDescServiceLike {
  retrieveRelevant(query: string, options?: { limit?: number }): Promise<Array<{
    id: string;
    summary?: string;
    content?: string;
  }>>;
}

/**
 * SonaEngine interface for pattern retrieval
 * Uses late binding to avoid circular dependencies
 */
export interface ISonaEngineLike {
  findPatterns(taskType: string, options?: { limit?: number }): Promise<Array<{
    name: string;
    action: string;
  }>>;
}

// ============================================================================
// Service Getters (Late Binding)
// ============================================================================

/** DESC service getter function (set during daemon init) */
let descServiceGetter: (() => IDescServiceLike | null) | null = null;

/** SonaEngine getter function (set during daemon init) */
let sonaEngineGetter: (() => ISonaEngineLike | null) | null = null;

/**
 * Set the DESC service getter
 * Called during daemon initialization to enable late binding
 *
 * @param getter - Function that returns the DESC service instance
 *
 * @example
 * ```typescript
 * import { setDescServiceGetter } from './hooks/handlers/auto-injection.js';
 * import { getDescService } from './desc/desc-service.js';
 *
 * // During daemon startup
 * setDescServiceGetter(() => getDescService());
 * ```
 */
export function setDescServiceGetter(getter: () => IDescServiceLike | null): void {
  descServiceGetter = getter;
  logger.debug('DESC service getter registered');
}

/**
 * Set the SonaEngine getter
 * Called during daemon initialization to enable late binding
 *
 * @param getter - Function that returns the SonaEngine instance
 *
 * @example
 * ```typescript
 * import { setSonaEngineGetter } from './hooks/handlers/auto-injection.js';
 * import { getSonaEngine } from './sona/sona-engine.js';
 *
 * // During daemon startup
 * setSonaEngineGetter(() => getSonaEngine());
 * ```
 */
export function setSonaEngineGetter(getter: () => ISonaEngineLike | null): void {
  sonaEngineGetter = getter;
  logger.debug('SonaEngine getter registered');
}

// ============================================================================
// Task Tool Input Types
// ============================================================================

/**
 * Task tool input structure
 * Matches the expected input format for Claude's Task tool
 */
interface TaskToolInput {
  /** The main prompt/instructions for the task */
  prompt: string;
  /** Optional task type identifier */
  taskType?: string;
  /** Optional task description */
  description?: string;
  /** Optional subagent type (alternative to taskType) */
  subagent_type?: string;
  /** Allow additional properties */
  [key: string]: unknown;
}

// ============================================================================
// Injection Helpers
// ============================================================================

/**
 * Retrieved episode structure
 */
interface RetrievedEpisode {
  id: string;
  summary?: string;
  content?: string;
}

/**
 * Retrieved pattern structure
 */
interface RetrievedPattern {
  name: string;
  action: string;
}

/**
 * Build injection block from retrieved episodes and patterns
 *
 * @param episodes - Retrieved DESC episodes
 * @param patterns - Retrieved SonaEngine patterns
 * @returns Formatted injection block or null if no content
 */
function buildInjectionBlock(
  episodes: RetrievedEpisode[],
  patterns: RetrievedPattern[]
): string | null {
  if (episodes.length === 0 && patterns.length === 0) {
    return null;
  }

  const parts: string[] = [];

  // Add relevant context section
  if (episodes.length > 0) {
    parts.push('## Relevant Context');
    for (const ep of episodes) {
      // Prefer summary, fall back to truncated content
      const text = ep.summary || (ep.content?.slice(0, 100) + '...');
      if (text) {
        parts.push(`- ${text}`);
      }
    }
  }

  // Add learned patterns section
  if (patterns.length > 0) {
    parts.push('## Learned Patterns');
    for (const pat of patterns) {
      parts.push(`- ${pat.name}: ${pat.action}`);
    }
  }

  return parts.join('\n');
}

// ============================================================================
// Hook Registration
// ============================================================================

/**
 * Register the auto-injection hook
 *
 * This hook injects relevant DESC episodes and SonaEngine patterns
 * into Task() prompts to provide context for spawned agents.
 *
 * Call during daemon startup BEFORE HookRegistry.initialize()
 *
 * Hook Details:
 * - id: 'auto-injection'
 * - type: 'preToolUse'
 * - toolName: 'Task' (only triggers for Task tool)
 * - priority: DEFAULT_PRIORITIES.INJECTION (20)
 *
 * @example
 * ```typescript
 * import { registerAutoInjectionHook, registerRequiredHooks } from './hooks';
 *
 * // During daemon startup
 * registerRequiredHooks();
 * registerAutoInjectionHook();
 * getHookRegistry().initialize();
 * ```
 */
export function registerAutoInjectionHook(): void {
  registerPreToolUseHook({
    id: 'auto-injection',
    toolName: 'Task',  // Only trigger for Task tool
    priority: DEFAULT_PRIORITIES.INJECTION,  // Priority 20
    description: 'Injects relevant DESC episodes and SonaEngine patterns into Task prompts',
    handler: async (context: IHookContext): Promise<IHookResult> => {
      try {
        const input = context.toolInput as TaskToolInput;

        // Skip if no prompt in input
        if (!input?.prompt) {
          logger.debug('No prompt in Task input, skipping injection');
          return { continue: true };
        }

        let relevantEpisodes: RetrievedEpisode[] = [];
        let relevantPatterns: RetrievedPattern[] = [];

        // Retrieve relevant episodes from DESC service
        const descService = descServiceGetter?.();
        if (descService) {
          try {
            relevantEpisodes = await descService.retrieveRelevant(input.prompt, { limit: 3 });
            logger.debug('Retrieved DESC episodes', {
              count: relevantEpisodes.length,
              query: input.prompt.slice(0, 50)
            });
          } catch (err) {
            logger.warn('Failed to retrieve DESC episodes', {
              error: err instanceof Error ? err.message : String(err)
            });
          }
        } else {
          logger.debug('DESC service not available, skipping episode retrieval');
        }

        // Retrieve relevant patterns from SonaEngine
        const sonaEngine = sonaEngineGetter?.();
        if (sonaEngine) {
          try {
            // Use taskType, subagent_type, or default to 'general'
            const taskType = input.taskType || input.subagent_type || 'general';
            relevantPatterns = await sonaEngine.findPatterns(taskType, { limit: 2 });
            logger.debug('Retrieved SonaEngine patterns', {
              count: relevantPatterns.length,
              taskType
            });
          } catch (err) {
            logger.warn('Failed to retrieve SonaEngine patterns', {
              error: err instanceof Error ? err.message : String(err)
            });
          }
        } else {
          logger.debug('SonaEngine not available, skipping pattern retrieval');
        }

        // Build the injection block
        const injectionBlock = buildInjectionBlock(relevantEpisodes, relevantPatterns);

        // If nothing to inject, continue without modification
        if (!injectionBlock) {
          logger.debug('No context to inject');
          return { continue: true };
        }

        // Inject context into the prompt
        // Format: [Injected Context]\n\n---\n\n[Original Prompt]
        const enhancedPrompt = `${injectionBlock}\n\n---\n\n${input.prompt}`;

        const addedChars = enhancedPrompt.length - input.prompt.length;

        logger.info('Auto-injection complete', {
          episodesInjected: relevantEpisodes.length,
          patternsInjected: relevantPatterns.length,
          originalLength: input.prompt.length,
          enhancedLength: enhancedPrompt.length,
          addedChars,
          trajectoryId: context.trajectoryId
        });

        return {
          continue: true,
          modifiedInput: {
            ...input,
            prompt: enhancedPrompt
          },
          metadata: {
            injected: true,
            episodeCount: relevantEpisodes.length,
            patternCount: relevantPatterns.length,
            addedChars,
            episodeIds: relevantEpisodes.map(e => e.id),
            patternNames: relevantPatterns.map(p => p.name)
          }
        };
      } catch (error) {
        // Log error but don't throw - hook errors shouldn't break the chain
        // Per hook system design, we fail gracefully and continue
        logger.error('Auto-injection failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          trajectoryId: context.trajectoryId
        });
        return { continue: true };
      }
    }
  });

  logger.debug('Auto-injection hook registered', {
    priority: DEFAULT_PRIORITIES.INJECTION,
    toolName: 'Task'
  });
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Reset auto-injection state for testing
 * Clears service getters to allow fresh test configuration
 *
 * @internal Should only be used in test files
 */
export function _resetAutoInjectionForTesting(): void {
  descServiceGetter = null;
  sonaEngineGetter = null;
  logger.debug('Auto-injection state reset for testing');
}
