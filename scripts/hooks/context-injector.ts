/**
 * Claude Code Hooks - Context Injector Service
 *
 * Implements: TECH-HKS-001 ContextInjector contract
 * Constitution: REQ-HKS-001, REQ-HKS-002, GUARD-HKS-004
 *
 * Queries InteractionStore and injects context into Task() prompts.
 *
 * @module scripts/hooks/context-injector
 */

import type { InteractionStore } from '../../src/god-agent/universal/interaction-store.js';
import type { KnowledgeEntry, IHookConfig, IHookLogger } from './hook-types.js';
import { createHookLogger } from './hook-logger.js';

/**
 * Context injection result
 */
export interface IContextInjectionResult {
  /** Original prompt before injection */
  originalPrompt: string;
  /** Enhanced prompt with context */
  enhancedPrompt: string;
  /** Number of entries injected */
  entryCount: number;
  /** Estimated token count of injected context */
  tokenCount: number;
  /** Whether context was truncated */
  wasTruncated: boolean;
}

/**
 * ContextInjector - Service for querying InteractionStore and injecting context into prompts
 *
 * Implements: TECH-HKS-001 ContextInjector Service contract
 */
export class ContextInjector {
  private readonly interactionStore: InteractionStore;
  private readonly maxContextSize: number;
  private readonly logger: IHookLogger;

  /**
   * Create a ContextInjector instance
   *
   * @param interactionStore - InteractionStore instance (MUST NOT be null)
   * @param config - Hook configuration
   * @throws Error if interactionStore is null/undefined
   */
  constructor(interactionStore: InteractionStore, config: IHookConfig) {
    // Validate dependencies - NO fallbacks (AP-001)
    if (!interactionStore) {
      throw new Error('[ContextInjector] InteractionStore is required - no fallback allowed');
    }
    if (!config || config.maxContextSize <= 0) {
      throw new Error('[ContextInjector] config.maxContextSize must be > 0');
    }

    this.interactionStore = interactionStore;
    this.maxContextSize = config.maxContextSize;
    this.logger = createHookLogger('pre-task', config.verbose);
  }

  /**
   * Query InteractionStore for context by domain and tags
   *
   * Implements: REQ-HKS-001
   *
   * @param domain - Domain to query (e.g., "project/api")
   * @param tags - Tags to filter by (OR logic)
   * @returns Array of knowledge entries sorted by quality
   */
  async queryContext(domain: string, tags: string[]): Promise<KnowledgeEntry[]> {
    this.logger.debug('Starting memory query', { domain, tags });

    try {
      // Sanitize inputs to prevent SQL injection (SEC-HKS-004)
      const sanitizedDomain = this.sanitizeDomain(domain);
      const sanitizedTags = tags.map(tag => this.sanitizeTag(tag));

      // Query by domain
      const entries = this.interactionStore.getKnowledgeByDomain(sanitizedDomain);

      this.logger.debug('Initial query result', { entryCount: entries.length });

      // Filter by tags if provided (OR logic - match any tag)
      let filtered = entries;
      if (sanitizedTags.length > 0) {
        filtered = entries.filter(entry =>
          entry.tags?.some(entryTag => sanitizedTags.includes(entryTag))
        );
        this.logger.debug('After tag filter', { entryCount: filtered.length });
      }

      // Sort by quality (highest first), then by timestamp (most recent first)
      filtered.sort((a, b) => {
        if (b.quality !== a.quality) {
          return b.quality - a.quality;
        }
        return b.createdAt - a.createdAt;
      });

      // Limit to 50 entries to prevent context overflow
      const limited = filtered.slice(0, 50);

      this.logger.debug('Memory query complete', {
        domain: sanitizedDomain,
        tags: sanitizedTags,
        resultCount: limited.length
      });

      return limited;
    } catch (error) {
      // Log error and re-throw - NO silent failures (AP-003)
      this.logger.error('Memory query failed', {
        domain,
        tags,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Format knowledge entries for injection into prompt
   *
   * Implements: REQ-HKS-002
   *
   * @param entries - Knowledge entries to format
   * @returns Formatted context string
   */
  formatContextForInjection(entries: KnowledgeEntry[]): string {
    if (entries.length === 0) {
      return '';
    }

    const lines: string[] = [
      '## MEMORY CONTEXT (Retrieved from God Agent InteractionStore)',
      ''
    ];

    entries.forEach((entry, index) => {
      lines.push(`### Entry ${index + 1} (Quality: ${entry.quality.toFixed(2)})`);
      lines.push(`**Domain**: ${entry.domain}`);

      if (entry.tags && entry.tags.length > 0) {
        lines.push(`**Tags**: ${JSON.stringify(entry.tags)}`);
      }

      lines.push(`**Content**:`);

      // Try to parse content as JSON for pretty display
      try {
        const parsed = JSON.parse(entry.content);
        lines.push('```json');
        lines.push(JSON.stringify(parsed, null, 2));
        lines.push('```');
      } catch {
        // Content is not JSON - display as-is
        lines.push(entry.content);
      }

      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Inject context into the original prompt
   *
   * Implements: REQ-HKS-002, REQ-HKS-004
   *
   * @param originalPrompt - Original Task() prompt
   * @param context - Formatted context string
   * @returns Enhanced prompt with context
   */
  injectIntoPrompt(originalPrompt: string, context: string): string {
    if (!context || context.trim() === '') {
      return originalPrompt;
    }

    // Inject context after any existing context sections but before task instructions
    // Format: {original_prompt_header}\n\n{context}\n\n{original_task_instructions}
    return `${originalPrompt}\n\n${context}`;
  }

  /**
   * Truncate context to fit within token limit
   *
   * Implements: REQ-HKS-002
   *
   * @param context - Context string to truncate
   * @param maxTokens - Maximum tokens allowed
   * @returns Truncated context string
   */
  truncateToLimit(context: string, maxTokens: number = this.maxContextSize): { context: string; wasTruncated: boolean } {
    // Simple heuristic: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;

    if (context.length <= maxChars) {
      return { context, wasTruncated: false };
    }

    // Truncate from end (LIFO - keep most recent entries which are at the top)
    const truncated = context.substring(0, maxChars);

    // Find last complete entry marker (### Entry)
    const lastEntryMarker = truncated.lastIndexOf('### Entry');
    const cleanTruncated = lastEntryMarker > 0 ? truncated.substring(0, lastEntryMarker) : truncated;

    // Add truncation notice
    const truncationNotice = `\n\n[TRUNCATED: Context exceeded ${maxTokens} token limit]`;

    this.logger.warn('Context truncated', {
      originalLength: context.length,
      truncatedLength: cleanTruncated.length,
      maxTokens
    });

    return {
      context: cleanTruncated + truncationNotice,
      wasTruncated: true
    };
  }

  /**
   * Full context injection pipeline
   *
   * @param originalPrompt - Original Task() prompt
   * @param domain - Domain to query
   * @param tags - Tags to filter by
   * @returns Context injection result
   */
  async inject(
    originalPrompt: string,
    domain: string,
    tags: string[]
  ): Promise<IContextInjectionResult> {
    this.logger.debug('Starting context injection', { domain, tags, promptLength: originalPrompt.length });

    // 1. Query context
    const entries = await this.queryContext(domain, tags);

    // 2. Format context
    const formattedContext = this.formatContextForInjection(entries);

    // 3. Truncate if needed
    const { context: truncatedContext, wasTruncated } = this.truncateToLimit(formattedContext);

    // 4. Inject into prompt
    const enhancedPrompt = this.injectIntoPrompt(originalPrompt, truncatedContext);

    // Estimate token count
    const tokenCount = Math.ceil(truncatedContext.length / 4);

    this.logger.info('Context injection complete', {
      entryCount: entries.length,
      tokenCount,
      wasTruncated
    });

    return {
      originalPrompt,
      enhancedPrompt,
      entryCount: entries.length,
      tokenCount,
      wasTruncated
    };
  }

  /**
   * Sanitize domain string to prevent SQL injection
   */
  private sanitizeDomain(domain: string): string {
    // Remove dangerous characters
    return domain
      .replace(/[;'"\\]/g, '')
      .replace(/--/g, '')
      .trim();
  }

  /**
   * Sanitize tag string to prevent SQL injection
   */
  private sanitizeTag(tag: string): string {
    // Remove dangerous characters and limit length
    return tag
      .replace(/[;'"\\]/g, '')
      .replace(/--/g, '')
      .trim()
      .substring(0, 100);
  }
}
