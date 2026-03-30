/**
 * Tests for DynamicAgentGenerator
 * Validates REQ-PIPE-040, REQ-PIPE-041, REQ-PIPE-043, REQ-PIPE-044, REQ-PIPE-045
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DynamicAgentGenerator } from '../../../src/god-agent/cli/dynamic-agent-generator.js';
import type { ChapterStructure } from '../../../src/god-agent/cli/chapter-structure-loader.js';
import type { StyleCharacteristics } from '../../../src/god-agent/universal/style-analyzer.js';

describe('DynamicAgentGenerator', () => {
  let generator: DynamicAgentGenerator;

  beforeEach(() => {
    generator = new DynamicAgentGenerator(process.cwd());
  });

  // Helper to create mock chapter structure
  const createMockStructure = (chapterCount: number): ChapterStructure => ({
    locked: true,
    generatedAt: new Date().toISOString(),
    totalChapters: chapterCount,
    estimatedTotalWords: chapterCount * 5000,
    chapters: Array.from({ length: chapterCount }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
      writerAgent: i === 0 ? 'introduction-writer' : `chapter-${i + 1}-writer`,
      targetWords: 5000,
      sections: ['Section A', 'Section B'],
      outputFile: `chapters/ch${String(i + 1).padStart(2, '0')}.md`
    })),
    writerMapping: {}
  });

  const createMockStyleCharacteristics = (): StyleCharacteristics => ({
    sentences: {
      averageLength: 18,
      lengthVariance: 5,
      shortSentenceRatio: 0.25,
      mediumSentenceRatio: 0.55,
      longSentenceRatio: 0.15,
      complexSentenceRatio: 0.05
    },
    vocabulary: {
      uniqueWordRatio: 0.55,
      averageWordLength: 5.5,
      academicWordRatio: 0.12,
      technicalTermDensity: 0.05,
      latinateWordRatio: 0.2,
      contractionUsage: 0.01
    },
    structure: {
      paragraphLengthAvg: 6,
      transitionWordDensity: 0.03,
      passiveVoiceRatio: 0.2,
      firstPersonUsage: 0.01,
      thirdPersonUsage: 0.1,
      questionFrequency: 0.02,
      listUsage: 0.05
    },
    tone: {
      formalityScore: 0.8,
      objectivityScore: 0.85,
      hedgingFrequency: 0.03,
      assertivenessScore: 0.6,
      emotionalTone: 0.1
    },
    samplePhrases: ['in this study', 'the research demonstrates'],
    commonTransitions: ['however', 'therefore', 'moreover'],
    openingPatterns: ['This study', 'The research'],
    citationStyle: 'author-date'
  });

  describe('generatePhase6Agents', () => {
    it('should generate one agent per chapter plus abstract [REQ-PIPE-041]', async () => {
      const structure = createMockStructure(5);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      // 5 chapters + 1 abstract = 6 agents
      expect(agents).toHaveLength(6);
    });

    it('should handle 3-12+ chapters without arbitrary limits [REQ-PIPE-045]', async () => {
      // Test with 3 chapters (minimum)
      const structure3 = createMockStructure(3);
      const agents3 = await generator.generatePhase6Agents(structure3, null, 'test-slug');
      expect(agents3).toHaveLength(4); // 3 + abstract

      // Test with 12 chapters
      const structure12 = createMockStructure(12);
      const agents12 = await generator.generatePhase6Agents(structure12, null, 'test-slug');
      expect(agents12).toHaveLength(13); // 12 + abstract

      // Test with more than 12 chapters
      const structure15 = createMockStructure(15);
      const agents15 = await generator.generatePhase6Agents(structure15, null, 'test-slug');
      expect(agents15).toHaveLength(16); // 15 + abstract
    });

    it('should assign correct indices starting after Phase 5 [REQ-PIPE-040]', async () => {
      const structure = createMockStructure(5);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      // Phase 5 ends at index 30, Phase 6 starts at 31
      expect(agents[0].index).toBe(31);
      expect(agents[1].index).toBe(32);
      expect(agents[4].index).toBe(35);
      expect(agents[5].index).toBe(36); // Abstract
    });

    it('should include chapter context in generated agents [REQ-PIPE-043]', async () => {
      const structure = createMockStructure(3);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      const firstChapterAgent = agents[0];
      expect(firstChapterAgent.chapterContext).toBeDefined();
      expect(firstChapterAgent.chapterContext?.number).toBe(1);
      expect(firstChapterAgent.chapterContext?.title).toBe('Chapter 1');
    });

    it('should inject style characteristics into prompts', async () => {
      const structure = createMockStructure(2);
      const style = createMockStyleCharacteristics();
      const agents = await generator.generatePhase6Agents(structure, style, 'test-slug');

      // All agents should have style injection in prompt
      for (const agent of agents) {
        expect(agent.prompt).toContain('## STYLE GUIDELINES');
      }
    });

    it('should use default style when no characteristics provided', async () => {
      const structure = createMockStructure(2);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      // All agents should have default style
      for (const agent of agents) {
        expect(agent.prompt).toContain('## STYLE GUIDELINES');
        expect(agent.prompt).toContain('American English');
      }
    });

    it('should set correct dependencies for chapters', async () => {
      const structure = createMockStructure(4);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      // First chapter depends on phase-5-complete
      expect(agents[0].dependencies).toContain('phase-5-complete');

      // Subsequent chapters depend on previous chapter
      expect(agents[1].dependencies).toContain('chapter-1');
      expect(agents[2].dependencies).toContain('chapter-2');
      expect(agents[3].dependencies).toContain('chapter-3');

      // Abstract depends on last chapter
      expect(agents[4].dependencies).toContain('chapter-4');
    });

    it('should set phase 6 for all generated agents', async () => {
      const structure = createMockStructure(5);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      for (const agent of agents) {
        expect(agent.phase).toBe(6);
        expect(agent.phaseName).toBe('Writing');
      }
    });

    it('should set correct expected outputs', async () => {
      const structure = createMockStructure(2);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      expect(agents[0].expectedOutputs).toContain('chapters/ch01.md');
      expect(agents[1].expectedOutputs).toContain('chapters/ch02.md');
      expect(agents[2].expectedOutputs).toContain('chapters/ch00-abstract.md');
    });

    it('should include chapter specification in prompt [REQ-PIPE-043]', async () => {
      const structure = createMockStructure(1);
      structure.chapters[0].title = 'Introduction';
      structure.chapters[0].targetWords = 6000;
      structure.chapters[0].sections = ['Background', 'Problem Statement'];

      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      expect(agents[0].prompt).toContain('Chapter Number');
      expect(agents[0].prompt).toContain('Introduction');
      expect(agents[0].prompt).toContain('6,000');
      expect(agents[0].prompt).toContain('Background');
    });

    it('should handle unknown writer agents gracefully [REQ-PIPE-044]', async () => {
      const structure = createMockStructure(1);
      structure.chapters[0].writerAgent = 'nonexistent-writer';

      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      // Should still generate agent with generic template
      expect(agents).toHaveLength(2);
      expect(agents[0].prompt).toContain('scholarly');
    });
  });

  describe('isEnteringPhase6', () => {
    it('should return true when transitioning from Phase 5 to Phase 6 [REQ-PIPE-042]', () => {
      expect(generator.isEnteringPhase6(31, 30)).toBe(true);
      expect(generator.isEnteringPhase6(32, 30)).toBe(true);
    });

    it('should return false when already in Phase 6', () => {
      expect(generator.isEnteringPhase6(32, 31)).toBe(false);
      expect(generator.isEnteringPhase6(35, 34)).toBe(false);
    });

    it('should return false when in earlier phases', () => {
      expect(generator.isEnteringPhase6(10, 9)).toBe(false);
      expect(generator.isEnteringPhase6(30, 29)).toBe(false);
    });
  });

  describe('isInPhase6', () => {
    it('should return true for Phase 6 indices', () => {
      expect(generator.isInPhase6(31, 5)).toBe(true);
      expect(generator.isInPhase6(35, 5)).toBe(true);
      expect(generator.isInPhase6(36, 5)).toBe(true); // Abstract
    });

    it('should return false for Phase 5 indices', () => {
      expect(generator.isInPhase6(30, 5)).toBe(false);
      expect(generator.isInPhase6(25, 5)).toBe(false);
    });

    it('should return false for Phase 7 indices', () => {
      expect(generator.isInPhase6(37, 5)).toBe(false);
      expect(generator.isInPhase6(40, 5)).toBe(false);
    });
  });

  describe('isInPhase7', () => {
    it('should return true for Phase 7 indices', () => {
      // With 5 chapters: Phase 6 ends at 36, Phase 7 starts at 37
      expect(generator.isInPhase7(37, 5)).toBe(true);
      expect(generator.isInPhase7(45, 5)).toBe(true);
    });

    it('should return false for Phase 6 indices', () => {
      expect(generator.isInPhase7(31, 5)).toBe(false);
      expect(generator.isInPhase7(36, 5)).toBe(false);
    });
  });

  describe('getPhase6Range', () => {
    it('should return correct range for 5 chapters', () => {
      const range = generator.getPhase6Range(5);
      expect(range.start).toBe(31);
      expect(range.end).toBe(36); // 31 + 5 chapters + 1 abstract - 1
    });

    it('should return correct range for 10 chapters', () => {
      const range = generator.getPhase6Range(10);
      expect(range.start).toBe(31);
      expect(range.end).toBe(41);
    });

    it('should return correct range for 3 chapters', () => {
      const range = generator.getPhase6Range(3);
      expect(range.start).toBe(31);
      expect(range.end).toBe(34);
    });
  });

  describe('getTotalAgentCount', () => {
    it('should calculate correct total for 5 chapters [REQ-PIPE-041]', () => {
      // Formula: 31 (Phases 1-5) + N (chapters) + 1 (abstract) + 9 (Phase 7)
      const total = generator.getTotalAgentCount(5);
      expect(total).toBe(31 + 5 + 1 + 9); // 46
    });

    it('should calculate correct total for 10 chapters', () => {
      const total = generator.getTotalAgentCount(10);
      expect(total).toBe(31 + 10 + 1 + 9); // 51
    });

    it('should calculate correct total for 3 chapters', () => {
      const total = generator.getTotalAgentCount(3);
      expect(total).toBe(31 + 3 + 1 + 9); // 44
    });
  });

  describe('getPhase5EndIndex', () => {
    it('should return 30', () => {
      expect(generator.getPhase5EndIndex()).toBe(30);
    });
  });

  describe('getQAAgentsCount', () => {
    it('should return 9', () => {
      expect(generator.getQAAgentsCount()).toBe(9);
    });
  });

  describe('abstract writer', () => {
    it('should always be last Phase 6 agent', async () => {
      const structure = createMockStructure(5);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      const lastAgent = agents[agents.length - 1];
      expect(lastAgent.key).toBe('abstract-writer');
      expect(lastAgent.name).toBe('Abstract Writer');
    });

    it('should output to ch00-abstract.md', async () => {
      const structure = createMockStructure(3);
      const agents = await generator.generatePhase6Agents(structure, null, 'test-slug');

      const abstractAgent = agents.find(a => a.key === 'abstract-writer');
      expect(abstractAgent?.expectedOutputs).toContain('chapters/ch00-abstract.md');
    });

    it('should have style injection', async () => {
      const structure = createMockStructure(2);
      const style = createMockStyleCharacteristics();
      const agents = await generator.generatePhase6Agents(structure, style, 'test-slug');

      const abstractAgent = agents.find(a => a.key === 'abstract-writer');
      expect(abstractAgent?.prompt).toContain('## STYLE GUIDELINES');
    });
  });
});
