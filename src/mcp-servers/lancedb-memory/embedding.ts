/**
 * Embedding Pipeline for LanceDB Memory Server
 *
 * Provides two backends for generating vector embeddings from text:
 * - OpenAI text-embedding-3-small (1536 dimensions) — used when OPENAI_API_KEY is set
 * - Local @xenova/transformers all-MiniLM-L6-v2 (384 dimensions) — fallback
 *
 * The factory function `createEmbeddingProvider()` auto-selects based on env.
 *
 * @module mcp-servers/lancedb-memory/embedding
 */

// ============================================================================
// Interface
// ============================================================================

export interface EmbeddingProvider {
  /** Generate an embedding vector from text content. */
  embed(text: string): Promise<Float32Array>;
  /** Dimensionality of the output vectors. */
  dimensions: number;
  /** Human-readable name of the provider backend. */
  name: string;
}

// ============================================================================
// OpenAI Embedding Provider
// ============================================================================

/** Maximum characters to send to OpenAI (text-embedding-3-small context ~8191 tokens). */
const OPENAI_MAX_INPUT_CHARS = 32_000;

/** Rate-limit retry delay in ms. */
const RATE_LIMIT_RETRY_MS = 1_000;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public readonly dimensions = 1536;
  public readonly name = 'openai/text-embedding-3-small';

  private client: any = null;

  /**
   * Lazily initialize the OpenAI client on first use so the import only
   * happens when this provider is actually selected.
   */
  private async getClient(): Promise<any> {
    if (!this.client) {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI(); // reads OPENAI_API_KEY from env
    }
    return this.client;
  }

  async embed(text: string): Promise<Float32Array> {
    // Handle empty / whitespace-only input → zero vector
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return new Float32Array(this.dimensions);
    }

    // Truncate to stay within token budget
    const input = trimmed.length > OPENAI_MAX_INPUT_CHARS
      ? trimmed.slice(0, OPENAI_MAX_INPUT_CHARS)
      : trimmed;

    const client = await this.getClient();

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input,
        });

        const raw: number[] = response.data[0].embedding;
        return new Float32Array(raw);
      } catch (error: any) {
        lastError = error;

        // Retry once on rate-limit (HTTP 429)
        const isRateLimit =
          error?.status === 429 ||
          error?.code === 'rate_limit_exceeded' ||
          (error?.message && typeof error.message === 'string' && error.message.includes('rate limit'));

        if (attempt === 0 && isRateLimit) {
          console.error(
            `[lancedb-memory][WARN] OpenAI rate limit hit, retrying in ${RATE_LIMIT_RETRY_MS}ms...`,
          );
          await sleep(RATE_LIMIT_RETRY_MS);
          continue;
        }

        // Not a rate-limit or already retried — throw
        break;
      }
    }

    throw lastError;
  }
}

// ============================================================================
// Local Embedding Provider (@xenova/transformers)
// ============================================================================

const LOCAL_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  public readonly dimensions = 384;
  public readonly name = 'local/all-MiniLM-L6-v2';

  private pipeline: any = null;
  private loadingPromise: Promise<any> | null = null;

  /**
   * Lazy-load the transformers pipeline on first call.
   * Concurrent calls share the same loading promise to avoid double-loading.
   */
  private async getPipeline(): Promise<any> {
    if (this.pipeline) return this.pipeline;

    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        console.error('[lancedb-memory][INFO] Loading local embedding model (first use)...');
        const { pipeline } = await import('@xenova/transformers');
        const pipe = await pipeline('feature-extraction', LOCAL_MODEL_NAME);
        console.error('[lancedb-memory][INFO] Local embedding model loaded');
        return pipe;
      })();
    }

    this.pipeline = await this.loadingPromise;
    return this.pipeline;
  }

  async embed(text: string): Promise<Float32Array> {
    // Handle empty / whitespace-only input → zero vector
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return new Float32Array(this.dimensions);
    }

    const pipe = await this.getPipeline();

    // The pipeline returns a Tensor; we need the mean-pooled Float32Array.
    const output = await pipe(trimmed, { pooling: 'mean', normalize: true });

    // output.data is a Float32Array (or can be converted)
    const data = output.data;
    if (data instanceof Float32Array) {
      return data.slice(0, this.dimensions);
    }

    // Fallback: convert to Float32Array
    return new Float32Array(Array.from(data).slice(0, this.dimensions) as number[]);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an embedding provider based on environment configuration.
 *
 * - If `OPENAI_API_KEY` is set and non-empty → OpenAIEmbeddingProvider (1536 dims)
 * - Otherwise → LocalEmbeddingProvider (384 dims)
 *
 * Logs the selected backend to stderr.
 */
export function createEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey && apiKey.trim().length > 0) {
    const provider = new OpenAIEmbeddingProvider();
    console.error(
      `[lancedb-memory][INFO] Embedding provider: ${provider.name} (${provider.dimensions} dims)`,
    );
    return provider;
  }

  const provider = new LocalEmbeddingProvider();
  console.error(
    `[lancedb-memory][INFO] Embedding provider: ${provider.name} (${provider.dimensions} dims) — no OPENAI_API_KEY set`,
  );
  return provider;
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
