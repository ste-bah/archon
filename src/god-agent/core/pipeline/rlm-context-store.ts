/**
 * RLM Context Store — Context-as-Environment pattern (PRD Section 6)
 *
 * Implements:
 * - Namespace-based external context storage
 * - REPL operations (read/write/retrieve)
 * - Selective retrieval via LEANN for 10M+ token handling
 * - llm_query() recursive sub-call infrastructure
 * - Session persistence
 */

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export interface ILLMRequest {
  context: string;
  prompt: string;
  config: {
    model: 'opus' | 'sonnet' | 'haiku';
    maxTokens: number;
    temperature: number;
  };
  metadata?: {
    agentId: string;
    phase: number;
    taskId: string;
    parentRequestId?: string;
    depth?: number;
  };
}

export interface ILLMResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number };
  metadata: { requestId: string; model: string; latencyMs: number; finishReason: string; depth: number };
}

export interface IRLMContextStore {
  read(namespace: string): string | undefined;
  write(namespace: string, content: string): void;
  retrieve(query: string, namespaces: string[], maxTokens: number): Promise<string>;
  llmQuery(request: ILLMRequest): Promise<ILLMResponse>;
  save(path: string): Promise<void>;
  load(path: string): Promise<boolean>;
  getTokenCount(namespace: string): number;
  getTotalTokenCount(): number;
  getNamespaces(): string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class RLMContextStore implements IRLMContextStore {
  private store = new Map<string, string>();
  private leannService?: { buildSemanticContext: (opts: { taskDescription: string; phase: number; maxResults: number }) => Promise<{ codeContext: Array<{ content: string }> }> };

  constructor(private options?: {
    leannService?: typeof RLMContextStore.prototype.leannService;
    maxRecursionDepth?: number;
  }) {
    this.leannService = options?.leannService;
  }

  read(namespace: string): string | undefined {
    return this.store.get(namespace);
  }

  write(namespace: string, content: string): void {
    this.store.set(namespace, content);
  }

  async retrieve(query: string, namespaces: string[], maxTokens: number): Promise<string> {
    const parts: string[] = [];
    let tokenCount = 0;

    for (const ns of namespaces) {
      const content = this.store.get(ns);
      if (!content) continue;

      const nsTokens = this.estimateTokens(content);
      if (tokenCount + nsTokens <= maxTokens) {
        parts.push(`[${ns}]\n${content}`);
        tokenCount += nsTokens;
      } else {
        // Use LEANN for semantic selection if available and content exceeds budget
        if (this.leannService) {
          try {
            const context = await this.leannService.buildSemanticContext({
              taskDescription: query,
              phase: 0,
              maxResults: 3,
            });
            if (context.codeContext.length > 0) {
              const selected = context.codeContext
                .map((c) => c.content)
                .join('\n\n');
              const selTokens = this.estimateTokens(selected);
              if (tokenCount + selTokens <= maxTokens) {
                parts.push(`[${ns} — semantically selected]\n${selected}`);
                tokenCount += selTokens;
                continue;
              }
            }
          } catch { /* LEANN not available, truncate */ }
        }

        // Fallback: truncate to fit
        const remaining = maxTokens - tokenCount;
        if (remaining <= 0) break;
        const truncated = content.substring(0, remaining * 4); // ~4 chars per token
        parts.push(`[${ns} — truncated]\n${truncated}`);
        tokenCount += this.estimateTokens(truncated);
      }
    }
    return parts.join('\n\n---\n\n');
  }

  async llmQuery(request: ILLMRequest): Promise<ILLMResponse> {
    const maxDepth = this.options?.maxRecursionDepth ?? 3;
    const depth = request.metadata?.depth ?? 0;
    if (depth >= maxDepth) {
      return {
        content: `[RLM] Max recursion depth (${maxDepth}) reached. Returning partial context.`,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0 },
        metadata: { requestId: `rlm-${Date.now()}`, model: request.config.model, latencyMs: 0,
                    finishReason: 'max_depth', depth },
      };
    }

    // In CLI mode, llm_query delegates to the orchestrator's context.
    // Store the sub-query context so the executing agent can reference it.
    const requestId = `rlm-${Date.now()}-d${depth}`;
    const startTime = Date.now();

    this.write(`rlm/subquery/${requestId}`, JSON.stringify({
      prompt: request.prompt,
      context: request.context.substring(0, 5000),
      model: request.config.model,
      depth,
      parentRequestId: request.metadata?.parentRequestId,
    }));

    // In CLI mode, actual LLM execution happens via Task tool (not direct API call).
    // Return a reference that the orchestrating agent can resolve.
    return {
      content: `[RLM Sub-Query ${requestId}] Context stored at rlm/subquery/${requestId}. ` +
               `Orchestrator should spawn sub-agent with model=${request.config.model} to resolve.`,
      usage: { inputTokens: this.estimateTokens(request.context), outputTokens: 0,
               totalTokens: 0, contextTokens: this.estimateTokens(request.context) },
      metadata: { requestId, model: request.config.model, latencyMs: Date.now() - startTime,
                  finishReason: 'sub_query_stored', depth },
    };
  }

  async save(path: string): Promise<void> {
    const { promises: fs } = await import('fs');
    const { dirname: dirName } = await import('path');
    const data: Record<string, string> = {};
    for (const [k, v] of this.store) {
      data[k] = v;
    }
    await fs.mkdir(dirName(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify({ version: 1, namespaces: data }, null, 2));
  }

  async load(path: string): Promise<boolean> {
    try {
      const { promises: fs } = await import('fs');
      const raw = await fs.readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.version === 1 && parsed.namespaces) {
        for (const [k, v] of Object.entries(parsed.namespaces)) {
          this.store.set(k, v as string);
        }
        return true;
      }
    } catch { /* file doesn't exist or corrupt */ }
    return false;
  }

  getTokenCount(namespace: string): number {
    const content = this.store.get(namespace);
    return content ? this.estimateTokens(content) : 0;
  }

  getTotalTokenCount(): number {
    let total = 0;
    for (const content of this.store.values()) {
      total += this.estimateTokens(content);
    }
    return total;
  }

  getNamespaces(): string[] {
    return Array.from(this.store.keys());
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
