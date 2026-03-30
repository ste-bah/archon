/**
 * ContextInjector - Prior Context Retrieval and Injection
 *
 * Implements: TASK-ORC-006 (TECH-ORC-001 lines 680-756)
 *
 * Queries InteractionStore for relevant prior knowledge and injects it
 * into task prompts as a "## PRIOR CONTEXT" section with token limit enforcement.
 *
 * @module orchestration/services/context-injector
 */

import type { InteractionStore } from '../../universal/interaction-store.js';
import type { KnowledgeEntry } from '../../universal/universal-agent.js';
import type { IContextInjection } from '../types.js';

/**
 * ContextInjector - Injects prior context into task prompts
 */
export class ContextInjector {
  private interactionStore: InteractionStore;
  private maxContextTokens: number;

  /**
   * Initialize with InteractionStore
   *
   * @param interactionStore - InteractionStore instance
   * @param maxContextTokens - Maximum tokens for context (default: 8000)
   */
  constructor(interactionStore: InteractionStore, maxContextTokens: number = 8000) {
    this.interactionStore = interactionStore;
    this.maxContextTokens = maxContextTokens;
  }

  /**
   * Inject context into prompt
   *
   * @param prompt - Original prompt
   * @param domain - Domain to query
   * @param tags - Tags for filtering
   * @returns Context injection result
   */
  async injectContext(
    prompt: string,
    domain: string,
    tags: string[]
  ): Promise<IContextInjection> {
    try {
      // 1. Query InteractionStore by domain
      const entries = this.interactionStore.getKnowledgeByDomain(domain);

      // 2. Filter by tags (OR logic: entry matches if ANY tag matches)
      const filteredEntries = this.filterByTags(entries, tags);

      // 3. Sort by quality (desc), then lastUsed (desc)
      const sortedEntries = this.sortEntries(filteredEntries);

      // 4. Summarize to fit maxContextTokens
      const contextText = this.summarizeContext(sortedEntries, this.maxContextTokens);
      const contextTokens = this.estimateTokens(contextText);

      // 5. Check if context is empty
      if (contextText.trim().length === 0) {
        return {
          originalPrompt: prompt,
          enhancedPrompt: prompt,
          contextEntryCount: 0,
          contextTokens: 0,
          domainsQueried: [domain],
          tagsUsed: tags,
          contextLimitExceeded: false,
          timestamp: Date.now()
        };
      }

      // 6. Merge with existing "## CONTEXT" section
      const enhancedPrompt = this.mergeContextSections(prompt, contextText);

      return {
        originalPrompt: prompt,
        enhancedPrompt,
        contextEntryCount: filteredEntries.length,
        contextTokens,
        domainsQueried: [domain],
        tagsUsed: tags,
        contextLimitExceeded: contextTokens > this.maxContextTokens,
        timestamp: Date.now()
      };
    } catch (error) {
      console.warn('[ContextInjector] Context injection failed (non-fatal):', error);
      // Return original prompt on failure
      return {
        originalPrompt: prompt,
        enhancedPrompt: prompt,
        contextEntryCount: 0,
        contextTokens: 0,
        domainsQueried: [domain],
        tagsUsed: tags,
        contextLimitExceeded: true,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Filter entries by tags (OR logic)
   *
   * @param entries - Knowledge entries
   * @param tags - Tags to filter by
   * @returns Filtered entries
   */
  private filterByTags(entries: KnowledgeEntry[], tags: string[]): KnowledgeEntry[] {
    if (tags.length === 0) {
      return entries;
    }

    return entries.filter(entry => {
      if (!entry.tags || entry.tags.length === 0) {
        return false;
      }
      // OR logic: match if ANY tag matches
      return entry.tags.some(tag => tags.includes(tag));
    });
  }

  /**
   * Sort entries by quality (desc), then lastUsed (desc)
   *
   * @param entries - Knowledge entries
   * @returns Sorted entries
   */
  private sortEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
    return [...entries].sort((a, b) => {
      // First by quality (desc)
      if (b.quality !== a.quality) {
        return b.quality - a.quality;
      }
      // Then by lastUsed (desc)
      return b.lastUsed - a.lastUsed;
    });
  }

  /**
   * Summarize context entries to fit token limit
   *
   * @param entries - Knowledge entries
   * @param maxTokens - Maximum tokens
   * @returns Summarized context string
   */
  private summarizeContext(entries: KnowledgeEntry[], maxTokens: number): string {
    if (entries.length === 0) {
      return '';
    }

    const contextLines: string[] = [
      '## PRIOR CONTEXT',
      '',
      'From previous tasks in workflow:',
      ''
    ];

    let currentTokens = this.estimateTokens(contextLines.join('\n'));
    let addedEntries = 0;

    for (const entry of entries) {
      // Format entry
      const tagsStr = entry.tags ? entry.tags.join(', ') : '';
      const entryText = [
        `${addedEntries + 1}. [Domain: ${entry.domain}] Tags: [${tagsStr}]`,
        `   ${this.truncateContent(entry.content, 200)}`
      ].join('\n');

      const entryTokens = this.estimateTokens(entryText);

      // Check if adding this entry would exceed limit
      if (currentTokens + entryTokens > maxTokens) {
        break;
      }

      contextLines.push(entryText);
      contextLines.push('');
      currentTokens += entryTokens;
      addedEntries++;
    }

    return contextLines.join('\n');
  }

  /**
   * Estimate token count for text
   *
   * Algorithm (from spec lines 1070-1076):
   * - Base: text.length * 0.75
   * - Non-ASCII chars: 1.5x weight
   * - Code blocks: 0.9x weight
   * - Special chars: 1.0x weight
   * - Error tolerance: ±15%
   *
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  private estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    let tokens = 0;

    // Check for code blocks
    const hasCodeBlocks = /```[\s\S]*?```/.test(text);

    // Count characters with weighting
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = char.charCodeAt(0);

      if (code > 127) {
        // Non-ASCII: 1.5x weight
        tokens += hasCodeBlocks ? 0.9 * 1.5 : 1.5;
      } else if (hasCodeBlocks) {
        // Code blocks: 0.9x weight
        tokens += 0.9;
      } else {
        // Regular ASCII: 1.0x weight
        tokens += 1.0;
      }
    }

    // Apply base factor of 0.75
    return Math.round(tokens * 0.75);
  }

  /**
   * Truncate content to max length
   *
   * @param content - Content to truncate
   * @param maxLength - Maximum length
   * @returns Truncated content
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  /**
   * Merge with existing context section
   *
   * @param prompt - Prompt with existing context
   * @param newContext - New context to add
   * @returns Merged prompt
   */
  private mergeContextSections(prompt: string, newContext: string): string {
    // Check if prompt already has "## CONTEXT" or "## PRIOR CONTEXT"
    const hasContext = /##\s*(PRIOR\s+)?CONTEXT/i.test(prompt);

    if (!hasContext) {
      // No existing context - prepend new context
      return `${newContext}\n\n${prompt}`;
    }

    // Has existing context - merge by replacing the context header
    // Find the context section and insert new content after it
    const contextPattern = /(##\s*(PRIOR\s+)?CONTEXT[\s\S]*?)(?=\n##[^#]|\n\n##|$)/i;
    const match = prompt.match(contextPattern);

    if (match) {
      // Insert new context after existing context section
      const existingContext = match[0];
      const replacement = `${existingContext}\n\n${newContext}`;
      return prompt.replace(contextPattern, replacement);
    }

    // Fallback: prepend
    return `${newContext}\n\n${prompt}`;
  }
}
