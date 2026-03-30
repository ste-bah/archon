/**
 * SPRINT 3 - DESC-001: Symmetric Chunker
 * RULE-064: Same chunking algorithm for storage AND retrieval
 *
 * Structure-aware chunking that preserves semantic boundaries
 * using protected patterns and configurable break points.
 */

import type {
  IChunkingConfig,
  IRange,
  ISymmetricChunker,
  IChunkWithPosition
} from '../types.js';
import {
  DEFAULT_CHUNKING_CONFIG,
  PROTECTED_PATTERNS,
  DEFAULT_BREAK_PATTERNS
} from '../config.js';
import { DESCChunkingError } from '../errors.js';

/**
 * Represents a chunk of text with metadata
 */
interface Chunk {
  text: string;
  start: number;
  end: number;
  index: number;
}

/**
 * SymmetricChunker - RULE-064 compliant chunking
 *
 * Key features:
 * - Same algorithm for storage and retrieval
 * - Structure-aware (respects code blocks, tables, Task() calls)
 * - Configurable break patterns for semantic boundaries
 * - Overlap for context preservation
 */
export class SymmetricChunker implements ISymmetricChunker {
  private config: IChunkingConfig;

  constructor(config?: Partial<IChunkingConfig>) {
    this.config = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...config
    };
  }

  /**
   * Chunk text using symmetric algorithm
   * RULE-064: This SAME method is used for both storage and retrieval
   */
  async chunk(text: string): Promise<string[]> {
    try {
      // Validate input
      if (!text || text.trim().length === 0) {
        return [];
      }

      // Find all protected regions that should not be split
      const protectedRegions = this.findProtectedRegions(text);

      // Perform chunking while respecting protected regions
      const chunks = this.performChunking(text, protectedRegions);

      // Enforce maximum chunk limit
      if (chunks.length > this.config.maxChunks) {
        throw new DESCChunkingError(
          `Text produced ${chunks.length} chunks, exceeding maximum of ${this.config.maxChunks}`,
          { chunkCount: chunks.length, maxChunks: this.config.maxChunks }
        );
      }

      return chunks.map(c => c.text);
    } catch (error) {
      if (error instanceof DESCChunkingError) {
        throw error;
      }
      throw new DESCChunkingError(
        `Chunking failed: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Chunk text with position metadata for reconstruction
   * Implements: REQ-CHUNK-003 (offset tracking)
   * RULE-064: Same algorithm as chunk(), returns positions for reconstruction
   */
  async chunkWithPositions(text: string): Promise<IChunkWithPosition[]> {
    try {
      // Validate input
      if (!text || text.trim().length === 0) {
        return [];
      }

      // Find all protected regions that should not be split
      const protectedRegions = this.findProtectedRegions(text);

      // Perform chunking while respecting protected regions
      const chunks = this.performChunking(text, protectedRegions);

      // Enforce minimum chunk size by merging tiny chunks [REQ-CHUNK-002]
      const mergedChunks = this.mergeTinyChunks(chunks);

      // Enforce maximum chunk limit
      if (mergedChunks.length > this.config.maxChunks) {
        throw new DESCChunkingError(
          `Text produced ${mergedChunks.length} chunks, exceeding maximum of ${this.config.maxChunks}`,
          { chunkCount: mergedChunks.length, maxChunks: this.config.maxChunks }
        );
      }

      // Convert to IChunkWithPosition with estimated tokens
      return mergedChunks.map((c, idx) => ({
        text: c.text,
        start: c.start,
        end: c.end,
        index: idx,
        estimatedTokens: Math.ceil(c.text.length / 4) // ~4 chars per token estimate
      }));
    } catch (error) {
      if (error instanceof DESCChunkingError) {
        throw error;
      }
      throw new DESCChunkingError(
        `Chunking with positions failed: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
  }

  /**
   * Merge chunks that are smaller than minChars with adjacent chunks
   * Implements: REQ-CHUNK-002 (minimum chunk size)
   */
  private mergeTinyChunks(chunks: Chunk[]): Chunk[] {
    if (chunks.length <= 1) {
      return chunks;
    }

    const minChars = this.config.minChars ?? 200;
    const result: Chunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      if (chunk.text.length < minChars && result.length > 0) {
        // Merge with previous chunk
        const prev = result[result.length - 1];
        prev.text = prev.text + '\n\n' + chunk.text;
        prev.end = chunk.end;
      } else if (chunk.text.length < minChars && i < chunks.length - 1) {
        // Merge with next chunk
        const next = chunks[i + 1];
        next.text = chunk.text + '\n\n' + next.text;
        next.start = chunk.start;
      } else {
        result.push({ ...chunk });
      }
    }

    // Reindex after merging
    return result.map((c, idx) => ({ ...c, index: idx }));
  }

  /**
   * Find regions that must not be split (code blocks, tables, Task() calls)
   */
  private findProtectedRegions(text: string): IRange[] {
    const regions: IRange[] = [];

    for (const regex of PROTECTED_PATTERNS) {
      // Reset lastIndex for global regexes
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        regions.push({
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Merge overlapping regions
    return this.mergeRanges(regions);
  }

  /**
   * Merge overlapping or adjacent ranges
   */
  private mergeRanges(ranges: IRange[]): IRange[] {
    if (ranges.length === 0) return [];

    // Sort by start position
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: IRange[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        // Overlapping or adjacent - merge
        last.end = Math.max(last.end, current.end);
      } else {
        // Non-overlapping - add new range
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Perform the actual chunking with overlap
   */
  private performChunking(text: string, protectedRegions: IRange[]): Chunk[] {
    const chunks: Chunk[] = [];
    let position = 0;
    let chunkIndex = 0;

    while (position < text.length) {
      // Find the end of this chunk
      const chunkEnd = this.findChunkEnd(
        text,
        position,
        protectedRegions
      );

      // Extract chunk text
      const chunkText = text.substring(position, chunkEnd).trim();

      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          start: position,
          end: chunkEnd,
          index: chunkIndex++
        });
      }

      // Move position forward, accounting for overlap
      if (chunkEnd >= text.length) {
        break;
      }

      // Calculate next position with overlap
      const overlapStart = Math.max(
        position,
        chunkEnd - this.config.overlap
      );

      // Find a good break point within the overlap region
      position = this.findBreakPoint(text, overlapStart, chunkEnd);
    }

    return chunks;
  }

  /**
   * Find the end of a chunk, respecting max size and protected regions
   */
  private findChunkEnd(
    text: string,
    start: number,
    protectedRegions: IRange[]
  ): number {
    const maxEnd = Math.min(start + this.config.maxChars, text.length);

    // Check if we're inside a protected region
    const inProtected = protectedRegions.find(
      r => start >= r.start && start < r.end
    );

    if (inProtected) {
      // We're inside a protected region - include the entire region
      return Math.min(inProtected.end, text.length);
    }

    // Find the ideal break point before maxEnd
    let breakPoint = this.findBreakPoint(text, start, maxEnd);

    // Check if break point would split a protected region
    const wouldSplitProtected = protectedRegions.find(
      r => breakPoint > r.start && breakPoint < r.end
    );

    if (wouldSplitProtected) {
      // Either include the whole region or stop before it
      if (wouldSplitProtected.start - start < this.config.maxChars / 2) {
        // Region is close to start - include it
        breakPoint = Math.min(wouldSplitProtected.end, text.length);
      } else {
        // Region is far - stop before it
        breakPoint = wouldSplitProtected.start;
      }
    }

    return breakPoint;
  }

  /**
   * Find a good break point using break patterns
   * RULE-064: Uses DEFAULT_BREAK_PATTERNS for semantic boundaries
   */
  private findBreakPoint(text: string, start: number, maxEnd: number): number {
    const searchText = text.substring(start, maxEnd);
    let bestBreak = maxEnd;
    let bestPriority = -1;

    // Try each break pattern in priority order
    for (const breakPattern of DEFAULT_BREAK_PATTERNS) {
      // Clone regex to reset lastIndex
      const regex = new RegExp(breakPattern.pattern.source, breakPattern.pattern.flags || 'g');
      let match: RegExpExecArray | null;
      let lastMatch: RegExpExecArray | null = null;

      while ((match = regex.exec(searchText)) !== null) {
        lastMatch = match;
      }

      if (lastMatch) {
        const breakPos = start + lastMatch.index + lastMatch[0].length;

        if (breakPattern.priority > bestPriority && breakPos < maxEnd) {
          bestBreak = breakPos;
          bestPriority = breakPattern.priority;
        }
      }
    }

    // If no good break point found, use maxEnd
    if (bestBreak === maxEnd) {
      return maxEnd;
    }

    return bestBreak;
  }

  /**
   * Get current chunking configuration
   */
  getConfig(): IChunkingConfig {
    return { ...this.config };
  }

  /**
   * Update chunking configuration
   */
  updateConfig(config: Partial<IChunkingConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
  }
}
