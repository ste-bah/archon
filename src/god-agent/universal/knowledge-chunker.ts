/**
 * KnowledgeChunker - Adapts SymmetricChunker for knowledge storage
 *
 * Implements: TASK-CHUNK-001 (Sprint 13)
 * Requirements: REQ-CHUNK-001 to REQ-CHUNK-009
 * Constitution: RULE-003 (requirement comments), RULE-064 (symmetric chunking)
 *
 * RULE-064: Uses same chunking as DESC service for consistency
 */

import { SymmetricChunker } from '../core/ucm/desc/symmetric-chunker.js';
import type {
  IChunkingConfig,
  IChunkWithPosition,
  ContentType
} from '../core/ucm/types.js';
import { TOKEN_RATIOS, ContentType as ContentTypeEnum } from '../core/ucm/types.js';
import { DEFAULT_CHUNKING_CONFIG } from '../core/ucm/config.js';

/**
 * Chunk metadata for knowledge entries
 * Implements: REQ-CHUNK-004 (parent tracking), REQ-CHUNK-007 (offset tracking)
 */
export interface KnowledgeChunkMetadata {
  /** Parent knowledge entry ID (for chunk reconstruction) */
  parentId: string;
  /** Zero-indexed position in chunk sequence */
  chunkIndex: number;
  /** Total number of chunks for this knowledge entry */
  totalChunks: number;
  /** Start character offset in original content (tracked BEFORE trim per TASK-CHUNK-009) */
  startOffset: number;
  /** End character offset in original content (tracked BEFORE trim per TASK-CHUNK-009) */
  endOffset: number;
  /** Domain namespace from parent knowledge entry */
  domain: string;
  /** Category type from parent knowledge entry */
  type: string;
  /** Tags from parent knowledge entry */
  tags: string[];
  /** Estimated token count for this chunk */
  estimatedTokens: number;
}

/**
 * A chunk of knowledge content with its metadata
 */
export interface KnowledgeChunk {
  /** Chunk text content (trimmed for storage) */
  text: string;
  /** Full metadata for this chunk */
  metadata: KnowledgeChunkMetadata;
}

/**
 * Result of chunking a knowledge entry
 * Implements: REQ-CHUNK-001
 */
export interface ChunkingResult {
  /** Array of chunks with metadata */
  chunks: KnowledgeChunk[];
  /** Total estimated tokens across all chunks */
  totalTokensEstimate: number;
  /** True if content was chunked (more than 1 chunk), false if single chunk */
  wasChunked: boolean;
  /** Total character count of original content */
  totalChars: number;
}

/**
 * Options for chunking operation
 * Implements: REQ-CHUNK-009 (content-aware token estimation)
 */
export interface ChunkingOptions {
  /** Content type hint for accurate token estimation (default: MIXED) */
  contentType?: ContentType;
}

/**
 * Metadata required from parent knowledge entry
 */
export interface ParentMetadata {
  /** Domain namespace (e.g., 'project/api') */
  domain: string;
  /** Category type (e.g., 'schema', 'analysis') */
  type: string;
  /** Searchable tags */
  tags: string[];
}

/**
 * KnowledgeChunker - Wraps SymmetricChunker with knowledge-specific metadata handling
 *
 * RULE-064: Uses same chunking algorithm as DESC service for consistency
 * REQ-CHUNK-001: Chunk knowledge content using SymmetricChunker
 * REQ-CHUNK-009: Content-aware token estimation
 */
export class KnowledgeChunker {
  private chunker: SymmetricChunker;
  private config: IChunkingConfig;

  /**
   * Create a KnowledgeChunker with optional configuration overrides
   * @param config - Partial configuration to merge with defaults
   */
  constructor(config?: Partial<IChunkingConfig>) {
    this.config = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...config
    };
    this.chunker = new SymmetricChunker(this.config);
  }

  /**
   * Chunk content for knowledge storage
   * Implements: REQ-CHUNK-001 (chunking), REQ-CHUNK-003 (offset tracking), REQ-CHUNK-009 (token estimation)
   *
   * @param content - Raw text content to chunk
   * @param parentId - ID of parent KnowledgeEntry
   * @param metadata - Domain, type, tags from parent
   * @param options - Optional chunking options (contentType for token estimation)
   * @returns ChunkingResult with chunks and metadata
   */
  async chunkForStorage(
    content: string,
    parentId: string,
    metadata: ParentMetadata,
    options?: ChunkingOptions
  ): Promise<ChunkingResult> {
    // Handle empty or very small content
    if (!content || content.trim().length === 0) {
      return {
        chunks: [],
        totalTokensEstimate: 0,
        wasChunked: false,
        totalChars: 0
      };
    }

    // Check if content needs chunking (REQ-CHUNK-002: minChars threshold)
    if (!this.shouldChunk(content)) {
      // Single chunk - no need to split
      const estimatedTokens = this.estimateTokens(content, options?.contentType);
      return {
        chunks: [{
          text: content.trim(),
          metadata: {
            parentId,
            chunkIndex: 0,
            totalChunks: 1,
            startOffset: 0,
            endOffset: content.length,
            domain: metadata.domain,
            type: metadata.type,
            tags: metadata.tags,
            estimatedTokens
          }
        }],
        totalTokensEstimate: estimatedTokens,
        wasChunked: false,
        totalChars: content.length
      };
    }

    // Use SymmetricChunker with position tracking (TASK-CHUNK-009)
    const chunksWithPositions: IChunkWithPosition[] = await this.chunker.chunkWithPositions(content);

    // Convert to KnowledgeChunks with metadata
    const contentType = options?.contentType ?? ContentTypeEnum.MIXED;
    let totalTokensEstimate = 0;

    const knowledgeChunks: KnowledgeChunk[] = chunksWithPositions.map((chunk, idx) => {
      const estimatedTokens = this.estimateTokens(chunk.text, contentType);
      totalTokensEstimate += estimatedTokens;

      return {
        text: chunk.text,
        metadata: {
          parentId,
          chunkIndex: idx,
          totalChunks: chunksWithPositions.length,
          startOffset: chunk.start,
          endOffset: chunk.end,
          domain: metadata.domain,
          type: metadata.type,
          tags: metadata.tags,
          estimatedTokens
        }
      };
    });

    return {
      chunks: knowledgeChunks,
      totalTokensEstimate,
      wasChunked: knowledgeChunks.length > 1,
      totalChars: content.length
    };
  }

  /**
   * Estimate token count for content
   * Implements: REQ-CHUNK-009 (content-aware token estimation)
   *
   * @param text - Text to estimate tokens for
   * @param contentType - Content type for ratio selection (default: MIXED)
   * @returns Estimated token count
   */
  estimateTokens(text: string, contentType?: ContentType): number {
    if (!text) return 0;

    const type = contentType ?? ContentTypeEnum.MIXED;
    const ratio = TOKEN_RATIOS[type] ?? TOKEN_RATIOS[ContentTypeEnum.MIXED];

    // Count words (split on whitespace)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // Apply content-type specific ratio
    return Math.ceil(wordCount * ratio);
  }

  /**
   * Check if content should be chunked
   * Implements: REQ-CHUNK-002 (minChars threshold)
   *
   * @param content - Content to check
   * @returns True if content exceeds maxChars and should be chunked
   */
  shouldChunk(content: string): boolean {
    if (!content) return false;
    // Only chunk if content exceeds maxChars threshold
    return content.length > this.config.maxChars;
  }

  /**
   * Get current chunking configuration
   * @returns Current configuration
   */
  getConfig(): IChunkingConfig {
    return { ...this.config };
  }

  /**
   * Reconstruct content from chunks
   * Implements: REQ-CHUNK-010 (backward compatible retrieval)
   *
   * @param chunks - Array of KnowledgeChunks in order
   * @returns Reconstructed content string
   */
  reconstructContent(chunks: KnowledgeChunk[]): string {
    if (chunks.length === 0) return '';

    // For single chunk: validate totalChunks === 1 (TASK-CHUNK-005 fix)
    if (chunks.length === 1) {
      if (chunks[0].metadata.totalChunks !== 1) {
        throw new Error(
          `Expected ${chunks[0].metadata.totalChunks} chunks, got 1 for parent ${chunks[0].metadata.parentId}`
        );
      }
      return chunks[0].text;
    }

    // Sort by chunk index to ensure correct order
    const sorted = [...chunks].sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);

    // Validate chunk sequence
    const expectedTotal = sorted[0].metadata.totalChunks;
    const parentId = sorted[0].metadata.parentId;

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].metadata.chunkIndex !== i) {
        throw new Error(`Missing chunk at index ${i} for parent ${parentId}`);
      }
      if (sorted[i].metadata.totalChunks !== expectedTotal) {
        throw new Error(`Inconsistent totalChunks for parent ${parentId}`);
      }
    }

    if (sorted.length !== expectedTotal) {
      throw new Error(`Expected ${expectedTotal} chunks, got ${sorted.length} for parent ${parentId}`);
    }

    // Join chunks - use simple concatenation with paragraph separators
    // The overlap from chunking should make this seamless
    return sorted.map(c => c.text).join('\n\n');
  }

  /**
   * Validate that chunks can be reconstructed
   * Implements: REQ-CHUNK-010 (backward compatible retrieval)
   *
   * @param chunks - Array of KnowledgeChunks to validate
   * @returns True if chunks form a complete, valid sequence
   */
  canReconstruct(chunks: KnowledgeChunk[]): boolean {
    if (chunks.length === 0) return false;

    // For single chunk: validate totalChunks === 1 (TASK-CHUNK-005 fix)
    if (chunks.length === 1) {
      return chunks[0].metadata.totalChunks === 1;
    }

    try {
      const sorted = [...chunks].sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
      const expectedTotal = sorted[0].metadata.totalChunks;
      const parentId = sorted[0].metadata.parentId;

      // Check all chunks have same parent and total
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].metadata.chunkIndex !== i) return false;
        if (sorted[i].metadata.totalChunks !== expectedTotal) return false;
        if (sorted[i].metadata.parentId !== parentId) return false;
      }

      return sorted.length === expectedTotal;
    } catch {
      return false;
    }
  }

  /**
   * Detect content type from text for token estimation
   * Helper method for REQ-CHUNK-009
   *
   * @param text - Text to analyze
   * @returns Detected content type
   */
  detectContentType(text: string): ContentType {
    // Check for code blocks
    if (/```[\s\S]*?```/.test(text) || /^\s{4}[^\s]/m.test(text)) {
      return ContentTypeEnum.CODE;
    }

    // Check for tables
    if (/\|[^\n]+\|/m.test(text)) {
      return ContentTypeEnum.TABLE;
    }

    // Check for citations
    if (/\[\d+\]|\(\d{4}\)|et al\./i.test(text)) {
      return ContentTypeEnum.CITATION;
    }

    // Default to prose
    return ContentTypeEnum.PROSE;
  }
}

/**
 * Singleton instance for common use
 */
let defaultChunker: KnowledgeChunker | null = null;

/**
 * Get or create the default KnowledgeChunker instance
 * @returns Default KnowledgeChunker singleton
 */
export function getDefaultKnowledgeChunker(): KnowledgeChunker {
  if (!defaultChunker) {
    defaultChunker = new KnowledgeChunker();
  }
  return defaultChunker;
}

/**
 * Create a new KnowledgeChunker with custom configuration
 * @param config - Partial configuration to merge with defaults
 * @returns New KnowledgeChunker instance
 */
export function createKnowledgeChunker(config?: Partial<IChunkingConfig>): KnowledgeChunker {
  return new KnowledgeChunker(config);
}
