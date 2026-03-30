/**
 * Dual Code Embedding Provider
 * Combines NLP encoder (for natural language queries) with Code encoder
 * for semantic code search optimization.
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-LEANN-003
 *
 * LEANN's paper emphasizes domain-specific embeddings. For code search:
 * - NLP Encoder: Understands natural language queries ("find function that validates email")
 * - Code Encoder: Understands code structure ("def validate_email(input: str)")
 * - Fusion: Combines both for optimal search
 *
 * @module src/god-agent/core/search/dual-code-embedding
 */

import type { IEmbeddingProvider } from '../memory/types.js';
import { VECTOR_DIM } from '../validation/index.js';
import { LocalEmbeddingProvider, EmbeddingProviderFactory } from '../memory/embedding-provider.js';

// ==================== Types ====================

/**
 * Content type detected from input text
 */
export type ContentType = 'code' | 'natural_language' | 'mixed';

/**
 * Configuration for dual code embedding provider
 */
export interface DualCodeEmbeddingConfig {
  /** Embedding dimension (default: 1536 to match existing vector DB) */
  dimension: number;
  /** Weight for NLP embedding in fusion (default: 0.4) */
  nlpWeight: number;
  /** Weight for code embedding in fusion (default: 0.6) */
  codeWeight: number;
  /** Enable LRU cache (default: true) */
  cacheEnabled: boolean;
  /** Maximum cache size (default: 1000) */
  cacheMaxSize: number;
  /** Embedding provider type (default: 'local') */
  provider: 'openai' | 'local';
  /** Code indicator patterns (custom language detection) */
  codeIndicators?: RegExp[];
  /** Minimum confidence for code detection (default: 0.6) */
  codeDetectionThreshold?: number;
  /** Embedding timeout in ms (default: 5000ms per PRD LATENCY-EMBEDDING) */
  embeddingTimeoutMs?: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current cache size */
  size: number;
  /** Cache hit ratio */
  hitRatio: number;
}

/**
 * Embedding result with metadata
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: Float32Array;
  /** Detected content type */
  contentType: ContentType;
  /** Whether this was a cache hit */
  fromCache: boolean;
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

// ==================== Default Configuration ====================

/**
 * Default dual code embedding configuration
 */
export const DEFAULT_DUAL_CODE_CONFIG: DualCodeEmbeddingConfig = {
  dimension: VECTOR_DIM, // 1536
  nlpWeight: 0.4,
  codeWeight: 0.6,
  cacheEnabled: true,
  cacheMaxSize: 1000,
  provider: 'local',
  codeDetectionThreshold: 0.6,
  embeddingTimeoutMs: 5000, // PRD LATENCY-EMBEDDING p99 requirement
};

/**
 * Timeout error for embedding operations
 */
export class EmbeddingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Embedding operation timed out after ${timeoutMs}ms`);
    this.name = 'EmbeddingTimeoutError';
  }
}

// ==================== Code Detection Patterns ====================

/**
 * Default patterns that indicate code content
 */
const DEFAULT_CODE_INDICATORS: RegExp[] = [
  // Function definitions
  /\b(function|def|fn|func|async\s+function|async\s+def)\s+\w+\s*\(/,
  // Class definitions
  /\b(class|struct|enum|interface|type|trait)\s+\w+/,
  // Import/export statements
  /\b(import|export|require|from|module)\s+/,
  // Variable declarations
  /\b(const|let|var|val|mut)\s+\w+\s*[=:]/,
  // Arrow functions
  /\(\s*[\w,\s:]*\)\s*=>/,
  // Common operators and syntax
  /[{}\[\]();]/,
  // Return statements
  /\breturn\s+/,
  // Type annotations
  /:\s*(string|number|boolean|int|float|void|any|Promise|Array|Map|Set)\b/,
  // Programming language keywords
  /\b(if|else|for|while|switch|case|try|catch|finally|throw|new|this|self|super)\b/,
  // Method calls with dots
  /\w+\.\w+\(/,
  // Common code patterns
  /[=!<>]=|&&|\|\||[+\-*/%]=?/,
  // Decorators/annotations
  /^[@#]\w+/m,
  // Template literals
  /`[^`]*\$\{[^}]*\}[^`]*`/,
  // Comments
  /\/\/.*$|\/\*[\s\S]*?\*\/|#.*$/m,
];

/**
 * Patterns that strongly indicate natural language
 */
const NLP_INDICATORS: RegExp[] = [
  // Sentence structure with punctuation
  /[A-Z][a-z]+.*[.!?]$/m,
  // Common English phrases
  /\b(the|and|or|but|because|however|therefore|moreover)\b/gi,
  // Questions
  /\b(what|where|when|why|how|who|which|can|could|would|should)\s+/i,
  // Natural language queries
  /\b(find|search|get|show|list|create|delete|update|explain)\s+(me|all|the)?\s*/i,
];

// ==================== LRU Cache Implementation ====================

/**
 * Simple LRU Cache with hash-based keys
 */
class LRUCache<K, V> {
  private readonly maxSize: number;
  private cache: Map<K, V>;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      this.hits++;
      return value;
    }
    this.misses++;
    return undefined;
  }

  set(key: K, value: V): void {
    // Delete if exists to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRatio: total > 0 ? this.hits / total : 0,
    };
  }
}

// ==================== Dual Code Embedding Provider ====================

/**
 * Dual Code Embedding Provider
 *
 * Provides optimized embeddings for code search by combining:
 * 1. NLP encoder for natural language query understanding
 * 2. Code encoder for code structure understanding
 * 3. Fusion strategy with configurable weights
 *
 * @implements IEmbeddingProvider
 */
export class DualCodeEmbeddingProvider implements IEmbeddingProvider {
  private readonly config: DualCodeEmbeddingConfig;
  private readonly cache: LRUCache<string, Float32Array>;
  private readonly codeIndicators: RegExp[];
  private baseProvider: IEmbeddingProvider | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Create a new DualCodeEmbeddingProvider
   *
   * @param config - Configuration options
   */
  constructor(config: Partial<DualCodeEmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_DUAL_CODE_CONFIG, ...config };

    // Normalize weights to ensure they sum to 1
    const totalWeight = this.config.nlpWeight + this.config.codeWeight;
    if (Math.abs(totalWeight - 1) > 0.001) {
      this.config.nlpWeight /= totalWeight;
      this.config.codeWeight /= totalWeight;
    }

    this.cache = new LRUCache<string, Float32Array>(this.config.cacheMaxSize);
    this.codeIndicators = config.codeIndicators ?? DEFAULT_CODE_INDICATORS;
  }

  /**
   * Initialize the base embedding provider lazily.
   * Thread-safe: uses promise caching pattern with error recovery.
   */
  private async ensureInitialized(): Promise<void> {
    // Fast path: already initialized
    if (this.baseProvider) return;

    // Synchronous check-and-set to prevent race condition
    // (JavaScript is single-threaded, so no race between check and assignment)
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((error) => {
        // Reset promise on failure to allow retry
        this.initPromise = null;
        throw error;
      });
    }

    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    if (this.config.provider === 'local') {
      this.baseProvider = await EmbeddingProviderFactory.getProvider(false);
    } else {
      // For OpenAI provider, would integrate with OpenAI API
      // Currently fallback to local
      this.baseProvider = await EmbeddingProviderFactory.getProvider(false);
    }
  }

  /**
   * Get the base provider, throwing if not initialized.
   * Call ensureInitialized() before this method.
   */
  private getProvider(): IEmbeddingProvider {
    if (!this.baseProvider) {
      throw new Error('DualCodeEmbeddingProvider not initialized. Call ensureInitialized() first.');
    }
    return this.baseProvider;
  }

  /**
   * Embed text with timeout protection.
   * Throws EmbeddingTimeoutError if operation exceeds configured timeout.
   */
  private async embedWithTimeout(text: string): Promise<Float32Array> {
    const timeoutMs = this.config.embeddingTimeoutMs ?? 5000;

    return Promise.race([
      this.getProvider().embed(text),
      new Promise<Float32Array>((_, reject) =>
        setTimeout(() => reject(new EmbeddingTimeoutError(timeoutMs)), timeoutMs)
      ),
    ]);
  }

  /**
   * Generate embedding for natural language query
   * Optimized for understanding user intent in search queries
   *
   * @param query - Natural language query text
   * @returns Embedding optimized for NLP understanding
   */
  async embedQuery(query: string): Promise<Float32Array> {
    await this.ensureInitialized();

    // Check cache
    const cacheKey = this.computeCacheKey(query, 'query');
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // Preprocess for NLP: enhance query understanding
    const processedQuery = this.preprocessForNLP(query);

    // Generate embedding
    const embedding = await this.embedWithTimeout(processedQuery);

    // Cache result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, embedding);
    }

    return embedding;
  }

  /**
   * Generate embedding for code content
   * Optimized for understanding code structure and semantics
   *
   * @param code - Code content to embed
   * @returns Embedding optimized for code understanding
   */
  async embedCode(code: string): Promise<Float32Array> {
    await this.ensureInitialized();

    // Check cache
    const cacheKey = this.computeCacheKey(code, 'code');
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // Preprocess for code: preserve structure, extract identifiers
    const processedCode = this.preprocessForCode(code);

    // Generate embedding
    const embedding = await this.embedWithTimeout(processedCode);

    // Cache result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, embedding);
    }

    return embedding;
  }

  /**
   * Generate fused embedding combining NLP and code understanding
   * Optimal for indexing code with docstrings/comments
   *
   * @param content - Content to embed (code or mixed)
   * @param isCode - Hint about content type (if known)
   * @returns Fused embedding balancing NLP and code understanding
   */
  async embedFused(content: string, isCode?: boolean): Promise<Float32Array> {
    await this.ensureInitialized();

    // Determine content type if not specified
    const contentType = isCode !== undefined
      ? (isCode ? 'code' : 'natural_language')
      : this.detectContentType(content);

    // For pure natural language, use query embedding
    if (contentType === 'natural_language') {
      return this.embedQuery(content);
    }

    // For pure code, use code embedding
    if (contentType === 'code') {
      return this.embedCode(content);
    }

    // For mixed content, generate fused embedding
    const cacheKey = this.computeCacheKey(content, 'fused');
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    // Generate both embeddings
    const [nlpEmbedding, codeEmbedding] = await Promise.all([
      this.generateNLPEmbedding(content),
      this.generateCodeEmbedding(content),
    ]);

    // Fuse embeddings with weighted combination
    const fusedEmbedding = this.fuseEmbeddings(nlpEmbedding, codeEmbedding);

    // Cache result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, fusedEmbedding);
    }

    return fusedEmbedding;
  }

  /**
   * Standard embedding implementation for IEmbeddingProvider interface
   * Uses smart detection to choose optimal embedding strategy
   *
   * @param text - Text to embed
   * @returns Optimal embedding based on content type
   */
  async embed(text: string): Promise<Float32Array> {
    return this.embedFused(text);
  }

  /**
   * Batch embedding for multiple texts
   *
   * @param texts - Array of texts to embed
   * @returns Array of embeddings
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  /**
   * Detect whether content is code, natural language, or mixed
   *
   * @param content - Content to analyze
   * @returns Detected content type
   */
  detectContentType(content: string): ContentType {
    const codeScore = this.calculateCodeScore(content);
    const nlpScore = this.calculateNLPScore(content);

    const threshold = this.config.codeDetectionThreshold ?? 0.6;

    // Determine type based on scores
    if (codeScore >= threshold && nlpScore < threshold * 0.5) {
      return 'code';
    } else if (nlpScore >= threshold && codeScore < threshold * 0.5) {
      return 'natural_language';
    }

    return 'mixed';
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      if (this.baseProvider?.isAvailable) {
        return this.baseProvider.isAvailable();
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get provider name for debugging/logging
   */
  getProviderName(): string {
    return 'dual-code-embedding';
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.config.dimension;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<DualCodeEmbeddingConfig> {
    return { ...this.config };
  }

  // ==================== Private Methods ====================

  /**
   * Generate NLP-focused embedding
   */
  private async generateNLPEmbedding(content: string): Promise<Float32Array> {
    const processed = this.preprocessForNLP(content);
    return this.embedWithTimeout(processed);
  }

  /**
   * Generate code-focused embedding
   */
  private async generateCodeEmbedding(content: string): Promise<Float32Array> {
    const processed = this.preprocessForCode(content);
    return this.embedWithTimeout(processed);
  }

  /**
   * Preprocess content for NLP embedding
   * Focuses on semantic meaning and natural language understanding
   */
  private preprocessForNLP(content: string): string {
    // Keep the original semantic content
    // Add context for query understanding
    let processed = content.trim();

    // Expand common abbreviations for better understanding
    processed = processed
      .replace(/\bfn\b/gi, 'function')
      .replace(/\bdef\b/gi, 'define function')
      .replace(/\breturn\b/gi, 'returns')
      .replace(/\bargs?\b/gi, 'arguments')
      .replace(/\bparams?\b/gi, 'parameters');

    return processed;
  }

  /**
   * Preprocess content for code embedding
   * Focuses on structure, identifiers, and code patterns
   */
  private preprocessForCode(content: string): string {
    let processed = content.trim();

    // Extract and emphasize identifiers
    // Split camelCase and snake_case for better understanding
    processed = processed
      // Split camelCase: validateEmail -> validate Email
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Split snake_case: validate_email -> validate email
      .replace(/_/g, ' ')
      // Preserve important code keywords
      .replace(/\b(async|await|class|function|const|let|var|return|import|export)\b/g, ' $1 ');

    // Remove excessive whitespace
    processed = processed.replace(/\s+/g, ' ').trim();

    return processed;
  }

  /**
   * Fuse two embeddings with weighted combination and L2 normalization
   */
  private fuseEmbeddings(
    nlpEmbedding: Float32Array,
    codeEmbedding: Float32Array
  ): Float32Array {
    const dimension = this.config.dimension;
    const fused = new Float32Array(dimension);

    // Weighted sum
    for (let i = 0; i < dimension; i++) {
      fused[i] =
        nlpEmbedding[i] * this.config.nlpWeight +
        codeEmbedding[i] * this.config.codeWeight;
    }

    // L2 normalize
    let sumSquares = 0;
    for (let i = 0; i < dimension; i++) {
      sumSquares += fused[i] * fused[i];
    }
    const magnitude = Math.sqrt(sumSquares);

    if (magnitude > 0) {
      for (let i = 0; i < dimension; i++) {
        fused[i] /= magnitude;
      }
    }

    return fused;
  }

  /**
   * Calculate how likely content is to be code
   */
  private calculateCodeScore(content: string): number {
    if (!content || content.length === 0) return 0;

    let matchCount = 0;
    const lines = content.split('\n');

    // Check for code indicators
    for (const pattern of this.codeIndicators) {
      if (pattern.test(content)) {
        matchCount++;
      }
    }

    // Additional heuristics
    // Indentation patterns (common in code)
    const indentedLines = lines.filter(line => /^\s{2,}/.test(line)).length;
    const indentRatio = lines.length > 0 ? indentedLines / lines.length : 0;

    // Special characters common in code
    const specialChars = (content.match(/[{}\[\]();:=<>]/g) || []).length;
    const specialRatio = specialChars / content.length;

    // Combine scores
    const patternScore = Math.min(matchCount / 5, 1); // Cap at 1
    const indentScore = indentRatio * 0.3;
    const specialScore = Math.min(specialRatio * 10, 0.3);

    return Math.min(patternScore + indentScore + specialScore, 1);
  }

  /**
   * Calculate how likely content is to be natural language
   */
  private calculateNLPScore(content: string): number {
    if (!content || content.length === 0) return 0;

    let matchCount = 0;

    // Check for NLP indicators
    for (const pattern of NLP_INDICATORS) {
      if (pattern.test(content)) {
        matchCount++;
      }
    }

    // Additional heuristics
    // Average word length (code tends to have longer "words" due to identifiers)
    const words = content.split(/\s+/);
    const avgWordLength =
      words.length > 0
        ? words.reduce((sum, w) => sum + w.length, 0) / words.length
        : 0;
    const wordLengthScore = avgWordLength < 8 ? 0.2 : 0;

    // Sentence-like structure
    const hasSentences = /[A-Z][^.!?]*[.!?]/.test(content);
    const sentenceScore = hasSentences ? 0.3 : 0;

    // Combine scores
    const patternScore = Math.min(matchCount / 3, 0.5);

    return Math.min(patternScore + wordLengthScore + sentenceScore, 1);
  }

  /**
   * Compute cache key for content
   */
  private computeCacheKey(content: string, type: 'query' | 'code' | 'fused'): string {
    // Simple hash function for cache key
    let hash = 0;
    const str = `${type}:${content}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${type}_${hash.toString(36)}`;
  }
}

// ==================== Factory Functions ====================

/**
 * Create a DualCodeEmbeddingProvider with default configuration
 *
 * @param config - Optional partial configuration
 * @returns Configured DualCodeEmbeddingProvider instance
 */
export function createDualCodeEmbeddingProvider(
  config?: Partial<DualCodeEmbeddingConfig>
): DualCodeEmbeddingProvider {
  return new DualCodeEmbeddingProvider(config);
}

/**
 * Create an embedding function compatible with LEANNSourceAdapter
 *
 * @param provider - DualCodeEmbeddingProvider instance
 * @returns Function that generates embeddings based on content type
 */
export function createLEANNEmbedder(
  provider: DualCodeEmbeddingProvider
): (text: string) => Promise<Float32Array> {
  return async (text: string): Promise<Float32Array> => {
    const contentType = provider.detectContentType(text);
    return provider.embedFused(text, contentType === 'code');
  };
}
