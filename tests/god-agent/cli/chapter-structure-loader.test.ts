/**
 * Tests for ChapterStructureLoader
 * Validates REQ-PIPE-041, REQ-PIPE-042, REQ-PIPE-043
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  ChapterStructureLoader,
  ChapterStructureNotFoundError,
  ChapterStructureNotLockedError,
  type ChapterStructure
} from '../../../src/god-agent/cli/chapter-structure-loader.js';

describe('ChapterStructureLoader', () => {
  const testBasePath = '/tmp/test-chapter-loader';
  const testSlug = 'test-research-session';
  const structurePath = path.join(process.cwd(), 'docs/research', testSlug, '05-chapter-structure.md');
  let loader: ChapterStructureLoader;

  beforeEach(async () => {
    loader = new ChapterStructureLoader(testBasePath);
    // Create test directory structure
    await fs.mkdir(path.dirname(structurePath), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(path.join(process.cwd(), 'docs/research', testSlug), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadChapterStructure', () => {
    it('should throw ChapterStructureNotFoundError when file does not exist', async () => {
      await expect(loader.loadChapterStructure('nonexistent-slug'))
        .rejects.toThrow(ChapterStructureNotFoundError);
    });

    it('should throw ChapterStructureNotLockedError when structure is not locked', async () => {
      const unlocked: ChapterStructure = {
        locked: false,
        generatedAt: new Date().toISOString(),
        totalChapters: 5,
        estimatedTotalWords: 25000,
        chapters: [
          {
            number: 1,
            title: 'Introduction',
            writerAgent: 'introduction-writer',
            targetWords: 5000,
            sections: ['Background', 'Problem Statement'],
            outputFile: 'chapters/ch01-introduction.md'
          }
        ],
        writerMapping: { 'introduction-writer': 'Introduction Writer' }
      };

      await fs.writeFile(
        structurePath,
        `# Chapter Structure\n\n\`\`\`json\n${JSON.stringify(unlocked, null, 2)}\n\`\`\``
      );

      await expect(loader.loadChapterStructure(testSlug))
        .rejects.toThrow(ChapterStructureNotLockedError);
    });

    it('should parse locked structure from JSON code block', async () => {
      const structure: ChapterStructure = {
        locked: true,
        generatedAt: new Date().toISOString(),
        totalChapters: 3,
        estimatedTotalWords: 15000,
        chapters: [
          {
            number: 1,
            title: 'Introduction',
            writerAgent: 'introduction-writer',
            targetWords: 5000,
            sections: ['Background', 'Problem Statement'],
            outputFile: 'chapters/ch01-introduction.md'
          },
          {
            number: 2,
            title: 'Literature Review',
            writerAgent: 'literature-review-writer',
            targetWords: 6000,
            sections: ['Prior Work', 'Theoretical Framework'],
            outputFile: 'chapters/ch02-literature-review.md'
          },
          {
            number: 3,
            title: 'Conclusion',
            writerAgent: 'conclusion-writer',
            targetWords: 4000,
            sections: ['Summary', 'Future Work'],
            outputFile: 'chapters/ch03-conclusion.md'
          }
        ],
        writerMapping: {
          'introduction-writer': 'Introduction Writer',
          'literature-review-writer': 'Literature Review Writer',
          'conclusion-writer': 'Conclusion Writer'
        }
      };

      await fs.writeFile(
        structurePath,
        `# Chapter Structure\n\n\`\`\`json\n${JSON.stringify(structure, null, 2)}\n\`\`\``
      );

      const result = await loader.loadChapterStructure(testSlug);
      expect(result.locked).toBe(true);
      expect(result.totalChapters).toBe(3);
      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0].title).toBe('Introduction');
    });

    it('should parse structure from raw JSON object', async () => {
      const structure: ChapterStructure = {
        locked: true,
        generatedAt: new Date().toISOString(),
        totalChapters: 2,
        estimatedTotalWords: 10000,
        chapters: [
          {
            number: 1,
            title: 'Introduction',
            writerAgent: 'introduction-writer',
            targetWords: 5000,
            sections: [],
            outputFile: 'chapters/ch01-introduction.md'
          },
          {
            number: 2,
            title: 'Conclusion',
            writerAgent: 'conclusion-writer',
            targetWords: 5000,
            sections: [],
            outputFile: 'chapters/ch02-conclusion.md'
          }
        ],
        writerMapping: {}
      };

      await fs.writeFile(structurePath, JSON.stringify(structure, null, 2));

      const result = await loader.loadChapterStructure(testSlug);
      expect(result.locked).toBe(true);
      expect(result.chapters).toHaveLength(2);
    });

    it('should throw error when no chapters defined', async () => {
      const structure: ChapterStructure = {
        locked: true,
        generatedAt: new Date().toISOString(),
        totalChapters: 0,
        estimatedTotalWords: 0,
        chapters: [],
        writerMapping: {}
      };

      await fs.writeFile(
        structurePath,
        `\`\`\`json\n${JSON.stringify(structure, null, 2)}\n\`\`\``
      );

      await expect(loader.loadChapterStructure(testSlug))
        .rejects.toThrow('No chapters defined');
    });

    it('should apply defaults when chapter missing optional fields', async () => {
      const structure = {
        locked: true,
        generatedAt: new Date().toISOString(),
        totalChapters: 1,
        estimatedTotalWords: 5000,
        chapters: [
          {
            number: 1,
            title: 'Introduction'
            // Missing writerAgent and outputFile - should get defaults
          }
        ],
        writerMapping: {}
      };

      await fs.writeFile(
        structurePath,
        `\`\`\`json\n${JSON.stringify(structure, null, 2)}\n\`\`\``
      );

      const result = await loader.loadChapterStructure(testSlug);
      // normalizeStructure provides defaults for missing fields
      expect(result.chapters[0].writerAgent).toBe('chapter-synthesizer');
      expect(result.chapters[0].outputFile).toBe('chapter-01.md');
    });

    it('should set default targetWords when not specified', async () => {
      const structure = {
        locked: true,
        generatedAt: new Date().toISOString(),
        totalChapters: 1,
        estimatedTotalWords: 5000,
        chapters: [
          {
            number: 1,
            title: 'Introduction',
            writerAgent: 'introduction-writer',
            outputFile: 'chapters/ch01-introduction.md'
            // Missing targetWords and sections
          }
        ],
        writerMapping: {}
      };

      await fs.writeFile(
        structurePath,
        `\`\`\`json\n${JSON.stringify(structure, null, 2)}\n\`\`\``
      );

      const result = await loader.loadChapterStructure(testSlug);
      expect(result.chapters[0].targetWords).toBe(5000);
      expect(result.chapters[0].sections).toEqual([]);
    });
  });

  describe('writerAgentExists', () => {
    it('should return true for existing agent files', async () => {
      // Check for an actual agent file that should exist
      const realLoader = new ChapterStructureLoader(process.cwd());
      const exists = await realLoader.writerAgentExists('introduction-writer');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent agent files', async () => {
      const exists = await loader.writerAgentExists('nonexistent-agent');
      expect(exists).toBe(false);
    });
  });

  describe('getAgentPath', () => {
    it('should return correct path for agent', () => {
      const agentPath = loader.getAgentPath('introduction-writer');
      expect(agentPath).toContain('.claude/agents/phdresearch/introduction-writer.md');
    });
  });

  describe('ChapterStructureNotFoundError', () => {
    it('should include path in error', () => {
      const error = new ChapterStructureNotFoundError('/some/path');
      expect(error.path).toBe('/some/path');
      expect(error.message).toContain('/some/path');
      expect(error.message).toContain('dissertation-architect');
    });
  });

  describe('ChapterStructureNotLockedError', () => {
    it('should have correct message', () => {
      const error = new ChapterStructureNotLockedError();
      expect(error.message).toContain('not locked');
      expect(error.message).toContain('dissertation-architect');
    });
  });
});
