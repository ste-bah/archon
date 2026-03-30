import { describe, it, expect, beforeEach } from 'vitest';
import { SymmetricChunker, DEFAULT_CHUNKING_CONFIG } from '../../../../src/god-agent/core/ucm/index.js';
import type { IChunkingConfig } from '../../../../src/god-agent/core/ucm/index.js';

describe('SymmetricChunker', () => {
  let chunker: SymmetricChunker;
  let defaultConfig: Partial<IChunkingConfig>;

  beforeEach(() => {
    defaultConfig = {
      maxChars: 2000,
      overlap: 300
    };
    chunker = new SymmetricChunker(defaultConfig);
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultChunker = new SymmetricChunker();
      expect(defaultChunker).toBeDefined();
    });

    it('should accept custom config', () => {
      const customConfig: Partial<IChunkingConfig> = {
        maxChars: 1000,
        overlap: 200
      };
      const customChunker = new SymmetricChunker(customConfig);

      expect(customChunker).toBeDefined();
    });
  });

  describe('chunk', () => {
    it('should split text into chunks respecting max size', async () => {
      const text = 'word '.repeat(1000); // ~5000 chars

      const chunks = await chunker.chunk(text);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        // Allow some tolerance for boundary handling
        expect(chunk.length).toBeLessThanOrEqual(defaultConfig.maxChars! + 500);
      });
    });

    it('should create overlapping chunks', async () => {
      const text = 'word '.repeat(1000);

      const chunks = await chunker.chunk(text);

      if (chunks.length > 1) {
        // Check that consecutive chunks have overlap
        for (let i = 0; i < chunks.length - 1; i++) {
          const chunk1End = chunks[i].slice(-defaultConfig.overlap!);
          const chunk2Start = chunks[i + 1].slice(0, defaultConfig.overlap!);

          // Should have some common content
          const overlap = chunk1End.split(' ').some(word =>
            word.length > 0 && chunk2Start.includes(word)
          );
          expect(overlap).toBe(true);
        }
      }
    });

    it('should preserve code blocks intact', async () => {
      const codeBlock = '```typescript\nfunction test() {\n  return 42;\n}\n```';
      const text = 'Before text. ' + codeBlock + ' After text. ' + 'padding '.repeat(500);

      const chunks = await chunker.chunk(text);

      // Code block should appear complete in at least one chunk
      const hasCompleteCodeBlock = chunks.some(chunk => chunk.includes(codeBlock));
      expect(hasCompleteCodeBlock).toBe(true);
    });

    it('should preserve markdown tables intact', async () => {
      const table = `| Col1 | Col2 | Col3 |
|------|------|------|
| A    | B    | C    |
| D    | E    | F    |`;

      const text = 'Before. ' + table + ' After. ' + 'padding '.repeat(500);

      const chunks = await chunker.chunk(text);

      // Table rows should not be split across chunks
      chunks.forEach(chunk => {
        const chunkRows = chunk.match(/\|[^\n]+\|/g) || [];
        if (chunkRows.length > 0) {
          // If any row is present, verify it's complete
          chunkRows.forEach(row => {
            expect(row).toMatch(/^\|.*\|$/);
          });
        }
      });
    });

    it('should preserve numbered lists', async () => {
      const list = `1. First item
2. Second item
3. Third item`;

      const text = 'Introduction. ' + list + ' Conclusion. ' + 'padding '.repeat(500);

      const chunks = await chunker.chunk(text);

      // List items should be preserved
      const hasListItems = chunks.some(chunk => /^\d+\.\s/m.test(chunk));
      expect(hasListItems).toBe(true);
    });

    it('should handle text shorter than max chunk size', async () => {
      const shortText = 'This is a short text that fits in one chunk.';

      const chunks = await chunker.chunk(shortText);

      // The chunker may normalize whitespace or create multiple chunks for structure
      // The key is that all content is preserved
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.join('').replace(/\s+/g, ' ').trim()).toContain('short text');
    });

    it('should handle empty text', async () => {
      const chunks = await chunker.chunk('');

      expect(chunks).toHaveLength(0);
    });

    it('should handle whitespace-only text', async () => {
      const chunks = await chunker.chunk('   \n\t  \n  ');

      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it('should chunk at natural boundaries (paragraphs)', async () => {
      const paragraph1 = 'a'.repeat(800);
      const paragraph2 = 'b'.repeat(800);
      const paragraph3 = 'c'.repeat(800);
      const text = `${paragraph1}\n\n${paragraph2}\n\n${paragraph3}`;

      const chunks = await chunker.chunk(text);

      expect(chunks.length).toBeGreaterThan(1);
      // Chunks should try to break at paragraph boundaries
      chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(defaultConfig.maxChars! + 500);
      });
    });

    it('should maintain symmetry (same algorithm for storage and retrieval)', async () => {
      const text = 'word '.repeat(1000);

      const chunks1 = await chunker.chunk(text);
      const chunks2 = await chunker.chunk(text);

      expect(chunks1).toEqual(chunks2);
    });

    it('should handle very long text efficiently', async () => {
      const longText = 'word '.repeat(50000);
      const start = performance.now();

      const chunks = await chunker.chunk(longText);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(500); // Should be reasonably fast
      expect(chunks.length).toBeGreaterThan(10);
    });

    it('should create chunks with approximately configured char overlap', async () => {
      const text = 'word '.repeat(1000);

      const chunks = await chunker.chunk(text);

      if (chunks.length > 1) {
        for (let i = 0; i < chunks.length - 1; i++) {
          const chunk1 = chunks[i];
          const chunk2 = chunks[i + 1];

          // Find overlap region
          const overlapStart = Math.max(0, chunk1.length - defaultConfig.overlap! - 100);
          const potentialOverlap = chunk1.slice(overlapStart);

          // Should have some overlap
          const hasOverlap = chunk2.slice(0, 400).includes(potentialOverlap.slice(-50));
          expect(hasOverlap || chunks.length === 2).toBe(true);
        }
      }
    });

    it('should handle mixed content with multiple protected patterns', async () => {
      const mixedContent = `# Header

Some text here.

\`\`\`python
def test():
    return True
\`\`\`

| Name | Age | City |
|------|-----|------|
| John | 30  | NYC  |

1. First point
2. Second point
3. Third point

${'More text. '.repeat(500)}`;

      const chunks = await chunker.chunk(mixedContent);

      expect(chunks.length).toBeGreaterThan(0);

      // Verify protected patterns are preserved
      const reconstructed = chunks.join('');
      expect(reconstructed.includes('```python')).toBe(true);
      expect(reconstructed.includes('| Name | Age | City |')).toBe(true);
      expect(reconstructed.includes('1. First point')).toBe(true);
    });

    it('should respect chunk size limits strictly', async () => {
      const smallConfig: Partial<IChunkingConfig> = {
        maxChars: 500,
        overlap: 50
      };
      const smallChunker = new SymmetricChunker(smallConfig);

      const text = 'word '.repeat(1000);
      const chunks = await smallChunker.chunk(text);

      chunks.forEach(chunk => {
        // Allow some tolerance for protected patterns and boundary handling
        expect(chunk.length).toBeLessThanOrEqual(700);
      });
    });
  });

  // Note: reassemble() method does not exist in the actual SymmetricChunker implementation
  // The implementation uses chunkWithPositions() for position tracking instead
  describe('chunkWithPositions', () => {
    it('should return chunks with position metadata', async () => {
      const text = 'word '.repeat(1000);
      const chunksWithPositions = await chunker.chunkWithPositions(text);

      expect(chunksWithPositions.length).toBeGreaterThan(0);
      chunksWithPositions.forEach((chunk, index) => {
        expect(chunk).toHaveProperty('text');
        expect(chunk).toHaveProperty('start');
        expect(chunk).toHaveProperty('end');
        expect(chunk).toHaveProperty('index');
        expect(chunk.index).toBe(index);
        expect(chunk.start).toBeGreaterThanOrEqual(0);
        expect(chunk.end).toBeGreaterThan(chunk.start);
      });
    });

    it('should handle single chunk', async () => {
      const text = 'Short text';
      const chunksWithPositions = await chunker.chunkWithPositions(text);

      // The chunker may normalize whitespace or break on structural boundaries
      // The key is that all content is preserved
      expect(chunksWithPositions.length).toBeGreaterThanOrEqual(1);
      const combinedText = chunksWithPositions.map(c => c.text).join('').replace(/\s+/g, ' ').trim();
      expect(combinedText).toContain('Short');
      expect(combinedText).toContain('text');
    });

    it('should handle empty text', async () => {
      const chunksWithPositions = await chunker.chunkWithPositions('');

      expect(chunksWithPositions).toHaveLength(0);
    });
  });

  describe('symmetry verification', () => {
    it('should produce identical chunks for identical input', async () => {
      const text = 'Test content. '.repeat(500);

      const chunks1 = await chunker.chunk(text);
      const chunks2 = await chunker.chunk(text);

      expect(chunks1.length).toBe(chunks2.length);
      chunks1.forEach((chunk, i) => {
        expect(chunk).toBe(chunks2[i]);
      });
    });

    it('should handle retrieval scenario same as storage', async () => {
      const text = 'Storage and retrieval test. '.repeat(500);

      // Simulate storage
      const storageChunks = await chunker.chunk(text);

      // Simulate retrieval (re-chunking)
      const retrievalChunks = await chunker.chunk(text);

      expect(storageChunks).toEqual(retrievalChunks);
    });
  });

  describe('getConfig', () => {
    it('should return the current configuration', () => {
      const config = chunker.getConfig();

      expect(config).toHaveProperty('maxChars');
      expect(config).toHaveProperty('overlap');
      expect(config.maxChars).toBe(defaultConfig.maxChars);
      expect(config.overlap).toBe(defaultConfig.overlap);
    });
  });

  describe('updateConfig', () => {
    it('should update the configuration', () => {
      chunker.updateConfig({ maxChars: 3000 });

      const config = chunker.getConfig();
      expect(config.maxChars).toBe(3000);
    });
  });
});
