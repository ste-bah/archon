/**
 * IDESC-001 Sprint 5 - Reasoning Trace Summarizer
 * TASK-IDESC-RB-003: Create Reasoning Trace Summarizer
 *
 * Implements reasoning trace summarization for DESC injection.
 * Summarizes full reasoning traces to fit injection token budgets while preserving
 * key decision points and insights.
 *
 * Features:
 * - Token-budget aware summarization
 * - Key insight extraction from decision markers
 * - Formatted injection templates
 * - Graceful degradation (no errors thrown)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Trace summarizer configuration
 */
export interface ITraceSummarizerConfig {
  /** Default maximum tokens for summarized trace (default: 500) */
  defaultMaxTokens: number;
  /** Maximum number of insights to extract (default: 5) */
  maxInsights: number;
  /** Decision markers to look for in traces */
  decisionMarkers: string[];
}

/**
 * Default configuration following TASK-IDESC-RB-003 requirements
 */
export const DEFAULT_TRACE_CONFIG: ITraceSummarizerConfig = {
  defaultMaxTokens: 500,
  maxInsights: 5,
  decisionMarkers: ['decided:', 'because:', 'conclusion:', 'therefore:', 'reasoning:']
};

/**
 * Trace summarizer interface
 * Implements: TASK-IDESC-RB-003
 */
export interface ITraceSummarizer {
  /**
   * Summarize reasoning trace to fit token budget
   * @param fullTrace - Full reasoning trace from ReasoningBank
   * @param maxTokens - Maximum tokens (default: 500)
   * @returns Summarized trace string (empty string if trace is empty/null)
   */
  summarize(fullTrace: string, maxTokens?: number): Promise<string>;

  /**
   * Extract key insights from reasoning trace
   * @param trace - Reasoning trace to analyze
   * @returns Array of key insight strings (max 5)
   */
  extractKeyInsights(trace: string): Promise<string[]>;

  /**
   * Format trace for DESC injection prompt
   * @param trace - Reasoning trace
   * @param episodeContext - Episode context summary
   * @returns Formatted injection string
   */
  formatForInjection(trace: string, episodeContext: string): Promise<string>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Approximate token count (chars / 4)
 * Simple estimation following Claude's ~4 chars per token heuristic
 */
function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Smart truncation to fit token budget
 * Preserves complete sentences where possible
 */
function truncateToTokens(text: string, maxTokens: number): string {
  if (!text || maxTokens <= 0) return '';

  const targetChars = maxTokens * 4; // Approximate characters

  if (text.length <= targetChars) {
    return text;
  }

  // Truncate to target chars
  let truncated = text.slice(0, targetChars);

  // Try to end at a complete sentence
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const lastBreak = Math.max(lastPeriod, lastNewline);

  if (lastBreak > targetChars * 0.7) {
    // If we found a good break point (>70% of target), use it
    truncated = truncated.slice(0, lastBreak + 1);
  } else {
    // Otherwise just add ellipsis
    truncated = truncated.trimEnd() + '...';
  }

  return truncated;
}

// ============================================================================
// TraceSummarizer Implementation
// ============================================================================

/**
 * Reasoning trace summarizer
 * Implements: ITraceSummarizer
 */
export class TraceSummarizer implements ITraceSummarizer {
  private readonly config: ITraceSummarizerConfig;

  constructor(config: Partial<ITraceSummarizerConfig> = {}) {
    this.config = {
      ...DEFAULT_TRACE_CONFIG,
      ...config
    };
  }

  /**
   * Summarize reasoning trace to fit token budget
   * Implements: TASK-IDESC-RB-003 requirement
   */
  async summarize(fullTrace: string, maxTokens?: number): Promise<string> {
    // Graceful degradation: return empty string if trace is empty/null
    if (!fullTrace || fullTrace.trim().length === 0) {
      return '';
    }

    const targetTokens = maxTokens ?? this.config.defaultMaxTokens;
    const currentTokens = countTokens(fullTrace);

    // If already under budget, return as-is
    if (currentTokens <= targetTokens) {
      return fullTrace;
    }

    // Otherwise, intelligently truncate
    return truncateToTokens(fullTrace, targetTokens);
  }

  /**
   * Extract key insights from reasoning trace
   * Implements: TASK-IDESC-RB-003 requirement
   */
  async extractKeyInsights(trace: string): Promise<string[]> {
    // Graceful degradation
    if (!trace || trace.trim().length === 0) {
      return [];
    }

    const insights: string[] = [];
    const lines = trace.split('\n');
    const { decisionMarkers, maxInsights } = this.config;

    for (const line of lines) {
      // Stop if we've found enough insights
      if (insights.length >= maxInsights) {
        break;
      }

      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Check if line contains a decision marker
      const hasMarker = decisionMarkers.some(marker =>
        trimmedLine.toLowerCase().includes(marker.toLowerCase())
      );

      if (hasMarker) {
        // Extract the insight (remove marker prefix if present)
        let insight = trimmedLine;

        for (const marker of decisionMarkers) {
          const markerIndex = insight.toLowerCase().indexOf(marker.toLowerCase());
          if (markerIndex !== -1) {
            insight = insight.slice(markerIndex + marker.length).trim();
            break;
          }
        }

        // Add insight if it's substantive (>10 chars)
        if (insight.length > 10) {
          insights.push(insight);
        }
      }
    }

    // If we found no insights using markers, extract first few substantive lines
    if (insights.length === 0) {
      for (const line of lines) {
        if (insights.length >= maxInsights) break;

        const trimmed = line.trim();
        if (trimmed.length > 20) { // Substantive lines only
          insights.push(trimmed);
        }
      }
    }

    return insights.slice(0, maxInsights);
  }

  /**
   * Format trace for DESC injection prompt
   * Implements: TASK-IDESC-RB-003 template requirement
   */
  async formatForInjection(trace: string, episodeContext: string): Promise<string> {
    // Graceful degradation
    if (!trace || trace.trim().length === 0) {
      return '';
    }

    // Summarize the trace (use default max tokens)
    const summarizedTrace = await this.summarize(trace);

    // Extract insights
    const insights = await this.extractKeyInsights(trace);

    // Build formatted injection
    const parts: string[] = [
      '<!-- reasoning_trace -->',
      '## Prior Reasoning for Similar Task',
      `Context: ${episodeContext || 'Similar problem context'}`,
      '',
      '### Key Reasoning:',
      summarizedTrace,
      ''
    ];

    // Add insights if we found any
    if (insights.length > 0) {
      parts.push('### Insights:');
      insights.forEach(insight => {
        parts.push(`- ${insight}`);
      });
      parts.push('');
    }

    parts.push('<!-- /reasoning_trace -->');

    return parts.join('\n');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a TraceSummarizer instance
 * @param config - Optional configuration overrides
 * @returns TraceSummarizer instance
 */
export function createTraceSummarizer(
  config: Partial<ITraceSummarizerConfig> = {}
): ITraceSummarizer {
  return new TraceSummarizer(config);
}
