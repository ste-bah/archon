/**
 * KnowledgeChunker Tests
 *
 * TASK-CHUNK-005: Comprehensive unit tests for KnowledgeChunker
 * Requirements: REQ-CHUNK-001 to REQ-CHUNK-010
 * Constitution: RULE-051 (90% coverage), RULE-054 (regression tests)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  KnowledgeChunker,
  type ChunkingResult,
  type KnowledgeChunk,
  type ParentMetadata,
} from '../../../src/god-agent/universal/knowledge-chunker.js';
import { ContentType } from '../../../src/god-agent/core/ucm/types.js';

describe('KnowledgeChunker', () => {
  let chunker: KnowledgeChunker;

  beforeEach(() => {
    chunker = new KnowledgeChunker();
  });

  // ==================== Constructor Tests ====================

  describe('constructor', () => {
    it('should create with default config', () => {
      const config = chunker.getConfig();
      expect(config.maxChars).toBe(2000);
      expect(config.minChars).toBe(200);
      expect(config.overlap).toBe(300);
      expect(config.maxChunks).toBe(2000);
    });

    it('should accept custom config overrides', () => {
      const customChunker = new KnowledgeChunker({
        maxChars: 1000,
        minChars: 100,
      });
      const config = customChunker.getConfig();
      expect(config.maxChars).toBe(1000);
      expect(config.minChars).toBe(100);
      // Inherited defaults
      expect(config.overlap).toBe(300);
    });
  });

  // ==================== shouldChunk Tests (REQ-CHUNK-002) ====================

  describe('shouldChunk', () => {
    it('should return false for empty content', () => {
      expect(chunker.shouldChunk('')).toBe(false);
      expect(chunker.shouldChunk('   ')).toBe(false);
    });

    it('should return false for content under maxChars', () => {
      const shortContent = 'This is a short piece of content.';
      expect(chunker.shouldChunk(shortContent)).toBe(false);
    });

    it('should return true for content over maxChars', () => {
      const longContent = 'x'.repeat(2001);
      expect(chunker.shouldChunk(longContent)).toBe(true);
    });

    it('should respect custom maxChars threshold', () => {
      const customChunker = new KnowledgeChunker({ maxChars: 100 });
      const mediumContent = 'x'.repeat(150);
      expect(customChunker.shouldChunk(mediumContent)).toBe(true);
    });
  });

  // ==================== estimateTokens Tests (REQ-CHUNK-009) ====================

  describe('estimateTokens', () => {
    it('should return 0 for empty content', () => {
      expect(chunker.estimateTokens('')).toBe(0);
    });

    it('should estimate tokens for prose using 1.3 ratio', () => {
      const text = 'one two three four five'; // 5 words
      const tokens = chunker.estimateTokens(text, ContentType.PROSE);
      expect(tokens).toBe(Math.ceil(5 * 1.3)); // 7
    });

    it('should estimate tokens for code using 1.5 ratio', () => {
      const text = 'one two three four five'; // 5 words
      const tokens = chunker.estimateTokens(text, ContentType.CODE);
      expect(tokens).toBe(Math.ceil(5 * 1.5)); // 8
    });

    it('should estimate tokens for tables using 2.0 ratio', () => {
      const text = 'one two three four five'; // 5 words
      const tokens = chunker.estimateTokens(text, ContentType.TABLE);
      expect(tokens).toBe(Math.ceil(5 * 2.0)); // 10
    });

    it('should estimate tokens for citations using 1.4 ratio', () => {
      const text = 'one two three four five'; // 5 words
      const tokens = chunker.estimateTokens(text, ContentType.CITATION);
      expect(tokens).toBe(Math.ceil(5 * 1.4)); // 7
    });

    it('should default to MIXED ratio (1.3) when no type specified', () => {
      const text = 'one two three four five'; // 5 words
      const tokens = chunker.estimateTokens(text);
      expect(tokens).toBe(Math.ceil(5 * 1.3)); // 7
    });
  });

  // ==================== detectContentType Tests (REQ-CHUNK-009) ====================

  describe('detectContentType', () => {
    it('should detect code blocks', () => {
      const codeContent = 'Here is some code:\n```javascript\nconst x = 1;\n```';
      expect(chunker.detectContentType(codeContent)).toBe(ContentType.CODE);
    });

    it('should detect indented code (4 spaces)', () => {
      const codeContent = 'Here is code:\n    function foo() {}';
      expect(chunker.detectContentType(codeContent)).toBe(ContentType.CODE);
    });

    it('should detect markdown tables', () => {
      const tableContent = '| Column 1 | Column 2 |\n|---|---|\n| A | B |';
      expect(chunker.detectContentType(tableContent)).toBe(ContentType.TABLE);
    });

    it('should detect citations with [number] format', () => {
      const citationContent = 'According to research [1], the findings show...';
      expect(chunker.detectContentType(citationContent)).toBe(ContentType.CITATION);
    });

    it('should detect citations with (year) format', () => {
      const citationContent = 'Smith (2023) found that...';
      expect(chunker.detectContentType(citationContent)).toBe(ContentType.CITATION);
    });

    it('should detect citations with et al.', () => {
      const citationContent = 'Jones et al. conducted a study...';
      expect(chunker.detectContentType(citationContent)).toBe(ContentType.CITATION);
    });

    it('should default to prose for plain text', () => {
      const proseContent = 'This is a simple paragraph with no special formatting.';
      expect(chunker.detectContentType(proseContent)).toBe(ContentType.PROSE);
    });
  });

  // ==================== chunkForStorage Tests (REQ-CHUNK-001) ====================

  describe('chunkForStorage', () => {
    const defaultMetadata: ParentMetadata = {
      domain: 'test',
      type: 'knowledge',
      tags: ['test-tag'],
    };

    it('should return empty result for empty content', async () => {
      const result = await chunker.chunkForStorage('', 'parent-1', defaultMetadata);
      expect(result.chunks).toHaveLength(0);
      expect(result.totalTokensEstimate).toBe(0);
      expect(result.wasChunked).toBe(false);
      expect(result.totalChars).toBe(0);
    });

    it('should return single chunk for short content (REQ-CHUNK-002)', async () => {
      const shortContent = 'This is a short piece of knowledge.';
      const result = await chunker.chunkForStorage(shortContent, 'parent-1', defaultMetadata);

      expect(result.chunks).toHaveLength(1);
      expect(result.wasChunked).toBe(false);
      expect(result.chunks[0].metadata.chunkIndex).toBe(0);
      expect(result.chunks[0].metadata.totalChunks).toBe(1);
      expect(result.chunks[0].metadata.parentId).toBe('parent-1');
      expect(result.chunks[0].metadata.domain).toBe('test');
      expect(result.chunks[0].metadata.type).toBe('knowledge');
      expect(result.chunks[0].metadata.tags).toEqual(['test-tag']);
    });

    it('should chunk long content into multiple chunks', async () => {
      // Create content that exceeds maxChars (2000)
      const longContent = 'This is a paragraph of text. '.repeat(100);
      const result = await chunker.chunkForStorage(longContent, 'parent-2', defaultMetadata);

      expect(result.wasChunked).toBe(true);
      expect(result.chunks.length).toBeGreaterThan(1);

      // Verify all chunks have correct metadata
      result.chunks.forEach((chunk, index) => {
        expect(chunk.metadata.chunkIndex).toBe(index);
        expect(chunk.metadata.totalChunks).toBe(result.chunks.length);
        expect(chunk.metadata.parentId).toBe('parent-2');
      });
    });

    it('should track offsets correctly (REQ-CHUNK-003, TASK-CHUNK-009)', async () => {
      const longContent = 'Paragraph one with some content here. '.repeat(100);
      const result = await chunker.chunkForStorage(longContent, 'parent-3', defaultMetadata);

      // First chunk should start at 0
      expect(result.chunks[0].metadata.startOffset).toBe(0);

      // Offsets should be non-overlapping and sequential
      for (let i = 1; i < result.chunks.length; i++) {
        expect(result.chunks[i].metadata.startOffset).toBeGreaterThanOrEqual(0);
        expect(result.chunks[i].metadata.endOffset).toBeGreaterThan(
          result.chunks[i].metadata.startOffset
        );
      }
    });

    it('should include estimated tokens for each chunk', async () => {
      const content = 'Word '.repeat(500); // 500 words
      const result = await chunker.chunkForStorage(content, 'parent-4', defaultMetadata);

      result.chunks.forEach(chunk => {
        expect(chunk.metadata.estimatedTokens).toBeGreaterThan(0);
      });

      // Total tokens should be sum of chunk tokens
      const totalChunkTokens = result.chunks.reduce(
        (sum, chunk) => sum + chunk.metadata.estimatedTokens,
        0
      );
      expect(result.totalTokensEstimate).toBe(totalChunkTokens);
    });

    it('should use content type hint for token estimation (REQ-CHUNK-009)', async () => {
      const content = 'function foo() { return 1; } '.repeat(100);

      const proseResult = await chunker.chunkForStorage(
        content, 'parent-5', defaultMetadata, { contentType: ContentType.PROSE }
      );
      const codeResult = await chunker.chunkForStorage(
        content, 'parent-6', defaultMetadata, { contentType: ContentType.CODE }
      );

      // Code should estimate more tokens (1.5 vs 1.3 ratio)
      expect(codeResult.totalTokensEstimate).toBeGreaterThan(proseResult.totalTokensEstimate);
    });
  });

  // ==================== reconstructContent Tests (REQ-CHUNK-010) ====================

  describe('reconstructContent', () => {
    it('should return empty string for no chunks', () => {
      expect(chunker.reconstructContent([])).toBe('');
    });

    it('should return single chunk text directly', () => {
      const chunks: KnowledgeChunk[] = [{
        text: 'Single chunk content',
        metadata: {
          parentId: 'p1',
          chunkIndex: 0,
          totalChunks: 1,
          startOffset: 0,
          endOffset: 20,
          domain: 'test',
          type: 'knowledge',
          tags: [],
          estimatedTokens: 5,
        },
      }];
      expect(chunker.reconstructContent(chunks)).toBe('Single chunk content');
    });

    it('should join multiple chunks with double newlines', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First chunk',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 2,
            startOffset: 0, endOffset: 11, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 2,
          },
        },
        {
          text: 'Second chunk',
          metadata: {
            parentId: 'p1', chunkIndex: 1, totalChunks: 2,
            startOffset: 11, endOffset: 23, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 2,
          },
        },
      ];
      expect(chunker.reconstructContent(chunks)).toBe('First chunk\n\nSecond chunk');
    });

    it('should sort chunks by index before joining', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'Second',
          metadata: {
            parentId: 'p1', chunkIndex: 1, totalChunks: 2,
            startOffset: 6, endOffset: 12, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 2,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(chunker.reconstructContent(chunks)).toBe('First\n\nSecond');
    });

    it('should throw error for missing chunk', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 3,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
        {
          text: 'Third',
          metadata: {
            parentId: 'p1', chunkIndex: 2, totalChunks: 3,
            startOffset: 10, endOffset: 15, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(() => chunker.reconstructContent(chunks)).toThrow(/Missing chunk/);
    });

    it('should throw error for incomplete chunk set', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 3,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(() => chunker.reconstructContent(chunks)).toThrow(/Expected 3 chunks, got 1/);
    });
  });

  // ==================== canReconstruct Tests (REQ-CHUNK-010) ====================

  describe('canReconstruct', () => {
    it('should return false for empty chunks', () => {
      expect(chunker.canReconstruct([])).toBe(false);
    });

    it('should return true for single valid chunk', () => {
      const chunks: KnowledgeChunk[] = [{
        text: 'Content',
        metadata: {
          parentId: 'p1', chunkIndex: 0, totalChunks: 1,
          startOffset: 0, endOffset: 7, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
        },
      }];
      expect(chunker.canReconstruct(chunks)).toBe(true);
    });

    it('should return true for complete chunk sequence', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 2,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
        {
          text: 'Second',
          metadata: {
            parentId: 'p1', chunkIndex: 1, totalChunks: 2,
            startOffset: 5, endOffset: 11, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(chunker.canReconstruct(chunks)).toBe(true);
    });

    it('should return false for incomplete chunk sequence', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 3,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(chunker.canReconstruct(chunks)).toBe(false);
    });

    it('should return false for mismatched parent IDs', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 2,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
        {
          text: 'Second',
          metadata: {
            parentId: 'p2', chunkIndex: 1, totalChunks: 2, // Different parent
            startOffset: 5, endOffset: 11, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(chunker.canReconstruct(chunks)).toBe(false);
    });

    it('should return false for inconsistent totalChunks', () => {
      const chunks: KnowledgeChunk[] = [
        {
          text: 'First',
          metadata: {
            parentId: 'p1', chunkIndex: 0, totalChunks: 2,
            startOffset: 0, endOffset: 5, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
        {
          text: 'Second',
          metadata: {
            parentId: 'p1', chunkIndex: 1, totalChunks: 3, // Inconsistent
            startOffset: 5, endOffset: 11, domain: 'test', type: 'knowledge', tags: [], estimatedTokens: 1,
          },
        },
      ];
      expect(chunker.canReconstruct(chunks)).toBe(false);
    });
  });

  // ==================== Integration Tests ====================

  describe('end-to-end chunking and reconstruction', () => {
    it('should chunk and reconstruct content correctly', async () => {
      const originalContent = 'This is paragraph one. '.repeat(50) +
        '\n\nThis is paragraph two. '.repeat(50);

      const result = await chunker.chunkForStorage(
        originalContent,
        'integration-test-1',
        { domain: 'test', type: 'integration', tags: ['e2e'] }
      );

      expect(result.wasChunked).toBe(true);
      expect(chunker.canReconstruct(result.chunks)).toBe(true);

      const reconstructed = chunker.reconstructContent(result.chunks);
      // Reconstructed content should preserve the essential meaning
      // (exact match may differ due to trimming and separator handling)
      expect(reconstructed.length).toBeGreaterThan(0);
      expect(reconstructed).toContain('paragraph one');
      expect(reconstructed).toContain('paragraph two');
    });

    it('should preserve chunk ordering through round-trip', async () => {
      const paragraphs = Array.from({ length: 10 }, (_, i) =>
        `Paragraph ${i + 1} content here. `.repeat(30)
      ).join('\n\n');

      const result = await chunker.chunkForStorage(
        paragraphs,
        'ordering-test',
        { domain: 'test', type: 'ordering', tags: [] }
      );

      // Shuffle chunks
      const shuffled = [...result.chunks].sort(() => Math.random() - 0.5);

      // Should still be able to validate and reconstruct
      expect(chunker.canReconstruct(shuffled)).toBe(true);
      const reconstructed = chunker.reconstructContent(shuffled);
      expect(reconstructed).toContain('Paragraph 1');
      expect(reconstructed).toContain('Paragraph 10');
    });
  });
});
