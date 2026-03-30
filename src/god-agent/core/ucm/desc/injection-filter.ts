/**
 * SPRINT 3 - DESC-004: Injection Filter
 *
 * Safety mechanisms for DESC injection to prevent stale/wrong prior solutions
 * from being injected into coding tasks.
 *
 * Key Safety Rules:
 * 1. CODING tasks: High threshold (0.92), strict file context matching
 * 2. RESEARCH tasks: Lower threshold (0.80), broader context matching
 * 3. Recency decay: Older episodes get lower weight (30-day half-life for code)
 * 4. Content type matching: Code episodes only inject into code tasks
 */

import type {
  IInjectionFilter,
  IInjectionDecision,
  IEnhancedInjectionDecision,
  IStoredEpisode,
  IEpisodeWithOutcomes,
  ITaskContext,
  WorkflowCategory,
  ContentType,
  ConfidenceLevel
} from '../types.js';
import { WorkflowCategory as WC } from '../types.js';
import type { OutcomeTracker } from './outcome-tracker.js';
import type { ConfidenceCalculator } from './confidence-calculator.js';
import type { NegativeExampleProvider } from './negative-example-provider.js';
import path from 'path';

/**
 * Workflow-specific similarity thresholds
 */
const THRESHOLDS: Record<WorkflowCategory, number> = {
  [WC.CODING]: 0.92,    // Very high - code must be nearly identical
  [WC.RESEARCH]: 0.80,  // Lower - related research is helpful
  [WC.GENERAL]: 0.85    // Medium - reasonable match
};

/**
 * Recency decay half-life in days
 */
const HALF_LIFE_DAYS: Record<WorkflowCategory, number> = {
  [WC.CODING]: 30,      // Code patterns age quickly (30 days)
  [WC.RESEARCH]: 90,    // Research is more timeless (90 days)
  [WC.GENERAL]: 60      // General tasks (60 days)
};

/**
 * Code file extensions
 */
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.java', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts',
  '.cs', '.fs', '.fsx', '.vb', '.scala', '.clj', '.cljs',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1',
  '.sql', '.graphql', '.proto', '.thrift'
]);

/**
 * Research/documentation file extensions
 */
const RESEARCH_EXTENSIONS = new Set([
  '.md', '.txt', '.pdf', '.doc', '.docx',
  '.tex', '.bib', '.rst', '.adoc'
]);

/**
 * Coding-related keywords
 */
const CODING_KEYWORDS = new Set([
  'code', 'implement', 'function', 'class', 'method', 'module',
  'api', 'endpoint', 'database', 'schema', 'test', 'debug',
  'refactor', 'optimize', 'bug', 'fix', 'feature', 'component'
]);

/**
 * Research-related keywords
 */
const RESEARCH_KEYWORDS = new Set([
  'research', 'phd', 'literature', 'review', 'analysis', 'study',
  'paper', 'article', 'citation', 'methodology', 'findings',
  'hypothesis', 'theory', 'abstract', 'introduction', 'conclusion'
]);

/**
 * InjectionFilter - Safety mechanism for DESC injection
 */
export class InjectionFilter implements IInjectionFilter {
  /**
   * Detect workflow category from task context
   */
  detectWorkflowCategory(taskContext: ITaskContext): WorkflowCategory {
    const agentId = taskContext.agentId?.toLowerCase() || '';
    const pipelineName = taskContext.pipelineName?.toLowerCase() || '';
    const task = taskContext.task?.toLowerCase() || '';
    const metadata = taskContext.metadata || {};

    // Check for research indicators
    if (
      agentId.includes('research') ||
      agentId.includes('phd') ||
      pipelineName.includes('phd') ||
      pipelineName.includes('research') ||
      this.hasKeywords(task, RESEARCH_KEYWORDS)
    ) {
      return WC.RESEARCH;
    }

    // Check for coding indicators
    if (
      agentId.includes('coder') ||
      agentId.includes('developer') ||
      agentId.includes('code') ||
      this.hasKeywords(task, CODING_KEYWORDS) ||
      this.hasCodeFiles(metadata)
    ) {
      return WC.CODING;
    }

    // Default to general
    return WC.GENERAL;
  }

  /**
   * Apply recency decay based on episode age
   */
  applyRecencyDecay(episode: IStoredEpisode, category: WorkflowCategory): number {
    const ageMs = Date.now() - episode.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const halfLifeDays = HALF_LIFE_DAYS[category];

    // Exponential decay: weight = 0.5^(age / half-life)
    const weight = Math.pow(0.5, ageDays / halfLifeDays);

    return weight;
  }

  /**
   * Check if episode content type matches task context
   */
  isContentTypeMatch(episodeMetadata: Record<string, unknown>, taskContext: ITaskContext): boolean {
    const category = this.detectWorkflowCategory(taskContext);
    const episodeContentType = episodeMetadata.contentType as ContentType | undefined;

    if (!episodeContentType) {
      // No content type specified - allow for backward compatibility
      return true;
    }

    switch (category) {
      case WC.CODING:
        // Code tasks only accept CODE type episodes
        return episodeContentType === 'code';

      case WC.RESEARCH:
        // Research tasks prefer PROSE and CITATION episodes
        return episodeContentType === 'prose' || episodeContentType === 'citation';

      case WC.GENERAL:
        // General tasks accept any content type
        return true;

      default:
        return true;
    }
  }

  /**
   * Check if episode file context is relevant
   */
  isFileContextRelevant(episodeMetadata: Record<string, unknown>, taskContext: ITaskContext): boolean {
    const episodeFiles = this.extractFiles(episodeMetadata);
    const taskFiles = this.extractFiles(taskContext.metadata || {});

    // If no file context in either, consider relevant
    if (episodeFiles.length === 0 || taskFiles.length === 0) {
      return true;
    }

    // Check for same directory/module
    const episodeDirs = new Set(episodeFiles.map(f => path.dirname(f)));
    const taskDirs = new Set(taskFiles.map(f => path.dirname(f)));

    // Same directory = relevant
    for (const dir of episodeDirs) {
      if (taskDirs.has(dir)) {
        return true;
      }
    }

    // Check for same module (parent directory)
    const episodeModules = new Set(episodeFiles.map(f => {
      const parts = path.dirname(f).split(path.sep);
      return parts.length > 0 ? parts[0] : '';
    }));
    const taskModules = new Set(taskFiles.map(f => {
      const parts = path.dirname(f).split(path.sep);
      return parts.length > 0 ? parts[0] : '';
    }));

    for (const module of episodeModules) {
      if (module && taskModules.has(module)) {
        return true;
      }
    }

    // Check for same file extension
    const episodeExts = new Set(episodeFiles.map(f => path.extname(f)));
    const taskExts = new Set(taskFiles.map(f => path.extname(f)));

    for (const ext of episodeExts) {
      if (ext && taskExts.has(ext)) {
        return true;
      }
    }

    // No context overlap
    return false;
  }

  /**
   * Determine if an episode should be injected
   */
  shouldInject(
    episode: IStoredEpisode,
    similarity: number,
    taskContext: ITaskContext
  ): IInjectionDecision {
    const category = this.detectWorkflowCategory(taskContext);
    const threshold = THRESHOLDS[category];
    const episodeMetadata = episode.metadata || {};

    // Apply recency decay
    const recencyWeight = this.applyRecencyDecay(episode, category);
    const adjustedScore = similarity * recencyWeight;

    // Check threshold with adjusted score
    if (adjustedScore < threshold) {
      return {
        inject: false,
        reason: `Adjusted similarity ${adjustedScore.toFixed(3)} below threshold ${threshold} (category: ${category})`,
        adjustedScore,
        category
      };
    }

    // For coding tasks, apply strict content and file context checks
    if (category === WC.CODING) {
      // Check content type match
      if (!this.isContentTypeMatch(episodeMetadata, taskContext)) {
        return {
          inject: false,
          reason: 'Content type mismatch for coding task',
          adjustedScore,
          category
        };
      }

      // Check file context relevance
      if (!this.isFileContextRelevant(episodeMetadata, taskContext)) {
        return {
          inject: false,
          reason: 'File context not relevant for coding task',
          adjustedScore,
          category
        };
      }
    }

    // For research tasks, prefer matching content types but don't require it
    if (category === WC.RESEARCH) {
      if (!this.isContentTypeMatch(episodeMetadata, taskContext)) {
        return {
          inject: false,
          reason: 'Content type mismatch for research task',
          adjustedScore,
          category
        };
      }
    }

    // All checks passed
    return {
      inject: true,
      reason: `Passed all filters (category: ${category}, adjusted score: ${adjustedScore.toFixed(3)})`,
      adjustedScore,
      category
    };
  }

  /**
   * Extract file paths from metadata
   */
  private extractFiles(metadata: Record<string, unknown>): string[] {
    const files: string[] = [];

    if (metadata.files && Array.isArray(metadata.files)) {
      files.push(...metadata.files.map(String));
    }

    if (metadata.file && typeof metadata.file === 'string') {
      files.push(metadata.file);
    }

    if (metadata.filePath && typeof metadata.filePath === 'string') {
      files.push(metadata.filePath);
    }

    return files;
  }

  /**
   * Check if text contains any of the given keywords
   */
  private hasKeywords(text: string, keywords: Set<string>): boolean {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if metadata contains code files
   */
  private hasCodeFiles(metadata: Record<string, unknown>): boolean {
    const files = this.extractFiles(metadata);
    return files.some(file => {
      const ext = path.extname(file);
      return CODE_EXTENSIONS.has(ext);
    });
  }
}

// ============================================================================
// IDESC-001: Enhanced Injection Filter with Confidence
// ============================================================================

/**
 * EnhancedInjectionFilter - Extends InjectionFilter with confidence calculation
 * TASK-IDESC-CONF-004: Update InjectionFilter with Confidence
 *
 * Implements: REQ-IDESC-005, NFR-IDESC-002
 * Constitution: REQ-IDESC-018 (backward compatible)
 *
 * Key enhancements:
 * - Calculates confidence level based on similarity, success rate, and recency
 * - Includes warning information for episodes with low success rates
 * - Returns IEnhancedInjectionDecision with full metadata
 * - Maintains backward compatibility with sync shouldInject()
 */
export class EnhancedInjectionFilter extends InjectionFilter {
  private readonly statsCache: Map<string, { successRate: number | null; outcomeCount: number; expiresAt: number }> = new Map();
  private readonly cacheDurationMs: number = 60000; // 1 minute

  constructor(
    private readonly outcomeTracker: OutcomeTracker,
    private readonly confidenceCalculator: ConfidenceCalculator,
    private readonly negativeExampleProvider?: NegativeExampleProvider
  ) {
    super();
  }

  /**
   * Enhanced shouldInject with confidence calculation
   * Implements: REQ-IDESC-005
   *
   * @param episode - Episode to evaluate (may have outcome data)
   * @param similarity - Maximum similarity score from retrieval
   * @param taskContext - Current task context
   * @returns Enhanced decision with confidence and warnings
   */
  async shouldInjectEnhanced(
    episode: IStoredEpisode | IEpisodeWithOutcomes,
    similarity: number,
    taskContext: ITaskContext
  ): Promise<IEnhancedInjectionDecision> {
    // Call base shouldInject for backward compatibility
    const baseDecision = this.shouldInject(episode, similarity, taskContext);

    // Get outcome stats
    const stats = await this.getEpisodeStats(episode.episodeId);

    // Calculate confidence level
    const confidence = this.confidenceCalculator.calculate(
      similarity,
      stats.successRate,
      stats.outcomeCount,
      episode.createdAt,
      baseDecision.category
    );

    // Get warnings if negative example provider is available
    const warnings: string[] = [];
    let trajectoryId: string | undefined;
    let reasoningTrace: string | undefined;

    if (this.negativeExampleProvider && stats.successRate !== null && stats.outcomeCount >= 3) {
      if (stats.successRate < 0.50) {
        const warning = await this.negativeExampleProvider.getWarning(episode.episodeId);
        if (warning) {
          warnings.push(warning.warningText);
        }
      }
    }

    // Check for trajectory ID in episode metadata
    const episodeMetadata = episode.metadata || {};
    if (episodeMetadata.trajectoryId) {
      trajectoryId = String(episodeMetadata.trajectoryId);
    }
    if (episodeMetadata.reasoningTrace) {
      reasoningTrace = String(episodeMetadata.reasoningTrace);
    }

    // Build enhanced decision
    const enhancedDecision: IEnhancedInjectionDecision = {
      ...baseDecision,
      confidence,
      successRate: stats.successRate,
      outcomeCount: stats.outcomeCount,
      warnings,
      trajectoryId,
      reasoningTrace
    };

    // Log decision for debugging
    if (enhancedDecision.inject) {
      console.error(
        `[EnhancedInjectionFilter] Episode ${episode.episodeId}: inject=true, ` +
        `confidence=${confidence}, successRate=${stats.successRate?.toFixed(2) ?? 'N/A'}, ` +
        `warnings=${warnings.length}`
      );
    }

    return enhancedDecision;
  }

  /**
   * Batch process multiple episodes
   * Performance optimization: batch stats lookups
   *
   * @param episodes - Episodes to evaluate
   * @param similarities - Similarity scores per episode
   * @param taskContext - Task context
   * @returns Array of enhanced decisions
   */
  async shouldInjectBatch(
    episodes: Array<{ episode: IStoredEpisode; similarity: number }>,
    taskContext: ITaskContext
  ): Promise<IEnhancedInjectionDecision[]> {
    // Get all episode IDs for batch lookup
    const episodeIds = episodes.map(e => e.episode.episodeId);

    // Batch fetch stats
    const statsMap = await this.outcomeTracker.getBatchSuccessRates(episodeIds);

    // Process each episode
    const decisions = await Promise.all(
      episodes.map(async ({ episode, similarity }) => {
        const successRate = statsMap.get(episode.episodeId) ?? null;
        const outcomeCount = await this.getOutcomeCount(episode.episodeId);

        // Update cache
        this.statsCache.set(episode.episodeId, {
          successRate,
          outcomeCount,
          expiresAt: Date.now() + this.cacheDurationMs
        });

        return this.shouldInjectEnhanced(episode, similarity, taskContext);
      })
    );

    return decisions;
  }

  /**
   * Get cached episode stats
   */
  private async getEpisodeStats(episodeId: string): Promise<{ successRate: number | null; outcomeCount: number }> {
    // Check cache first
    const cached = this.statsCache.get(episodeId);
    if (cached && Date.now() < cached.expiresAt) {
      return { successRate: cached.successRate, outcomeCount: cached.outcomeCount };
    }

    // Fetch from outcome tracker
    try {
      const stats = await this.outcomeTracker.getEpisodeStats(episodeId);
      const result = {
        successRate: stats.successRate,
        outcomeCount: stats.outcomeCount
      };

      // Cache the result
      this.statsCache.set(episodeId, {
        ...result,
        expiresAt: Date.now() + this.cacheDurationMs
      });

      return result;
    } catch {
      // INTENTIONAL: Graceful degradation - return default values on failure
      return { successRate: null, outcomeCount: 0 };
    }
  }

  /**
   * Get outcome count for an episode
   */
  private async getOutcomeCount(episodeId: string): Promise<number> {
    try {
      const stats = await this.outcomeTracker.getEpisodeStats(episodeId);
      return stats.outcomeCount;
    } catch {
      // INTENTIONAL: Outcome count query failure - return 0 as safe default
      return 0;
    }
  }
}

/**
 * Factory function for creating EnhancedInjectionFilter
 *
 * @param outcomeTracker - Outcome tracker for success rate data
 * @param confidenceCalculator - Confidence calculator
 * @param negativeExampleProvider - Optional negative example provider for warnings
 * @returns Configured EnhancedInjectionFilter
 */
export function createEnhancedInjectionFilter(
  outcomeTracker: OutcomeTracker,
  confidenceCalculator: ConfidenceCalculator,
  negativeExampleProvider?: NegativeExampleProvider
): EnhancedInjectionFilter {
  return new EnhancedInjectionFilter(
    outcomeTracker,
    confidenceCalculator,
    negativeExampleProvider
  );
}

// ============================================================================
// IDESC-001 Sprint 7: Backward Compatibility Helpers
// TASK-IDESC-INT-003: Backward Compatibility Layer
// ============================================================================

/**
 * Convert enhanced decision to legacy format
 * Implements: REQ-IDESC-018 (backward compatible)
 *
 * This helper strips enhanced fields (confidence, successRate, etc.)
 * to produce a decision compatible with legacy IInjectionDecision consumers.
 *
 * @param enhanced - Enhanced injection decision
 * @returns Legacy injection decision (base fields only)
 *
 * @example
 * const enhanced = await filter.shouldInjectEnhanced(episode, 0.95, taskContext);
 * const legacy = toLegacyDecision(enhanced);
 * // legacy has only: inject, reason, adjustedScore, category
 */
export function toLegacyDecision(enhanced: IEnhancedInjectionDecision): IInjectionDecision {
  return {
    inject: enhanced.inject,
    reason: enhanced.reason,
    adjustedScore: enhanced.adjustedScore,
    category: enhanced.category
  };
}

/**
 * Check if decision is enhanced format
 * Type guard to determine if a decision has enhanced fields
 *
 * @param decision - Injection decision (base or enhanced)
 * @returns True if decision has enhanced fields
 *
 * @example
 * if (isEnhancedDecision(decision)) {
 *   console.log(`Confidence: ${decision.confidence}`);
 * }
 */
export function isEnhancedDecision(decision: IInjectionDecision): decision is IEnhancedInjectionDecision {
  return 'confidence' in decision;
}
