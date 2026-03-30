/**
 * Hybrid Search Provider
 *
 * Uses a hybrid approach for web search:
 * - quick: Native Claude Code WebSearch (fast, built-in)
 * - medium: Perplexity Ask MCP (conversational with citations)
 * - deep: Perplexity Research MCP (comprehensive research)
 *
 * Note: This provider returns structured instructions for tool invocation.
 * The actual tool calls must be made by the orchestrating Claude Code agent,
 * as MCP tools cannot be directly called from TypeScript runtime.
 */

import type { IWebSearchProvider, ISearchResult, ISearchOptions } from './web-search-provider.js';

export interface McpToolInvocation {
  tool: string;
  parameters: Record<string, unknown>;
  expectedFormat: string;
}

export class HybridSearchProvider implements IWebSearchProvider {
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose ?? false;
  }

  async search(query: string, options: ISearchOptions): Promise<ISearchResult[]> {
    const toolInfo = this.selectToolForDepth(query, options);

    if (this.verbose) {
      console.log(`[HybridSearchProvider] Depth: ${options.depth} → Tool: ${toolInfo.tool}`);
    }

    // Return a structured result indicating what tool should be invoked
    return [{
      content: this.formatToolInvocationMessage(toolInfo),
      source: 'hybrid-search-provider',
      relevance: 1.0,
      timestamp: new Date(),
      citations: [
        `Tool to invoke: ${toolInfo.tool}`,
        `Parameters: ${JSON.stringify(toolInfo.parameters)}`,
      ],
    }];
  }

  /**
   * Select the appropriate tool based on search depth
   */
  private selectToolForDepth(query: string, options: ISearchOptions): McpToolInvocation {
    switch (options.depth) {
      case 'quick':
        return this.getWebSearchInvocation(query, options);
      case 'medium':
        return this.getPerplexityAskInvocation(query, options);
      case 'deep':
        return this.getPerplexityResearchInvocation(query, options);
      default:
        return this.getWebSearchInvocation(query, options);
    }
  }

  /**
   * Get invocation details for native Claude Code WebSearch
   */
  private getWebSearchInvocation(query: string, options: ISearchOptions): McpToolInvocation {
    return {
      tool: 'WebSearch',
      parameters: {
        query,
        allowed_domains: options.domains,
        max_results: options.maxResults ?? 10,
      },
      expectedFormat: 'Array of search results with titles, URLs, and snippets',
    };
  }

  /**
   * Get invocation details for Perplexity Ask MCP tool
   */
  private getPerplexityAskInvocation(query: string, _options: ISearchOptions): McpToolInvocation {
    return {
      tool: 'mcp__perplexity__perplexity_ask',
      parameters: {
        messages: [{ role: 'user', content: query }],
      },
      expectedFormat: 'Conversational response with optional citations',
    };
  }

  /**
   * Get invocation details for Perplexity Research MCP tool
   */
  private getPerplexityResearchInvocation(query: string, _options: ISearchOptions): McpToolInvocation {
    return {
      tool: 'mcp__perplexity__perplexity_research',
      parameters: {
        messages: [{ role: 'user', content: query }],
        strip_thinking: true, // Save context tokens
      },
      expectedFormat: 'Comprehensive research response with citations',
    };
  }

  /**
   * Format a human-readable message about what tool should be invoked
   */
  private formatToolInvocationMessage(toolInfo: McpToolInvocation): string {
    return [
      `Web search required using: ${toolInfo.tool}`,
      `Query parameters: ${JSON.stringify(toolInfo.parameters, null, 2)}`,
      `Expected format: ${toolInfo.expectedFormat}`,
      '',
      'This search provider cannot directly invoke MCP tools from TypeScript.',
      'The orchestrating Claude Code agent must invoke the tool and process results.',
    ].join('\n');
  }

  getAvailableSources(): string[] {
    return ['websearch', 'perplexity-ask', 'perplexity-research'];
  }

  async isAvailable(): Promise<boolean> {
    // Native WebSearch is always available in Claude Code
    // Perplexity tools are configured in .mcp.json
    return true;
  }

  /**
   * Parse results from native WebSearch tool
   * This is a utility method for when the orchestrating agent processes results
   */
  static parseWebSearchResults(result: unknown): ISearchResult[] {
    if (Array.isArray(result)) {
      return result.map((r: Record<string, unknown>) => ({
        content: (r.snippet as string) || (r.description as string) || (r.title as string) || '',
        source: (r.url as string) || 'websearch',
        url: r.url as string | undefined,
        relevance: 0.9,
        timestamp: new Date(),
      }));
    }

    // Single result
    return [{
      content: typeof result === 'string' ? result : JSON.stringify(result),
      source: 'websearch',
      relevance: 1.0,
      timestamp: new Date(),
    }];
  }

  /**
   * Parse results from Perplexity MCP tools
   * This is a utility method for when the orchestrating agent processes results
   */
  static parsePerplexityResults(result: Record<string, unknown>, source: string): ISearchResult[] {
    return [{
      content: (result.content as string) || JSON.stringify(result),
      source,
      relevance: 1.0,
      timestamp: new Date(),
      citations: (result.citations as string[]) || [],
    }];
  }
}
