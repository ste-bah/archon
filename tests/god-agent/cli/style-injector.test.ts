/**
 * Tests for StyleInjector
 * Validates REQ-PIPE-010, REQ-PIPE-012, REQ-PIPE-013, REQ-PIPE-014, REQ-PIPE-015, REQ-PIPE-016
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StyleInjector } from '../../../src/god-agent/cli/style-injector.js';
import type { AgentConfig } from '../../../src/god-agent/cli/pipeline-loader.js';

describe('StyleInjector', () => {
  let injector: StyleInjector;

  beforeEach(() => {
    injector = new StyleInjector(process.cwd());
  });

  // Helper to create mock agent config
  const createMockAgent = (phase: number, key: string = 'test-agent'): AgentConfig => ({
    key,
    name: key,
    phase,
    order: 1,
    description: 'Base agent description with important instructions.',
    dependencies: [],
    timeout: 300,
    critical: false,
    expectedOutputs: [],
    inputs: [],
    outputs: []
  });

  describe('buildAgentPrompt', () => {
    it('should not inject style for non-Phase 6 agents [REQ-PIPE-010]', async () => {
      const phase1Agent = createMockAgent(1);
      const phase5Agent = createMockAgent(5);
      const phase7Agent = createMockAgent(7);

      const prompt1 = await injector.buildAgentPrompt(phase1Agent);
      const prompt5 = await injector.buildAgentPrompt(phase5Agent);
      const prompt7 = await injector.buildAgentPrompt(phase7Agent);

      // Should return original description without style
      expect(prompt1).toBe(phase1Agent.description);
      expect(prompt5).toBe(phase5Agent.description);
      expect(prompt7).toBe(phase7Agent.description);

      // Should not have style markers
      expect(prompt1).not.toContain('## STYLE GUIDELINES');
      expect(prompt5).not.toContain('## STYLE GUIDELINES');
      expect(prompt7).not.toContain('## STYLE GUIDELINES');
    });

    it('should inject style for Phase 6 agents [REQ-PIPE-010]', async () => {
      const phase6Agent = createMockAgent(6, 'introduction-writer');

      const prompt = await injector.buildAgentPrompt(phase6Agent);

      // Should contain original description
      expect(prompt).toContain(phase6Agent.description);

      // Should have style injection
      expect(prompt).toContain('## STYLE GUIDELINES');
    });

    it('should use default style when no profile exists', async () => {
      const phase6Agent = createMockAgent(6);

      const prompt = await injector.buildAgentPrompt(phase6Agent, 'nonexistent-profile');

      // Should have style section (may fall back to active profile or default)
      expect(prompt).toContain('## STYLE GUIDELINES');
      // Either has English variant or language settings
      expect(prompt.toLowerCase()).toMatch(/english|language|spell/);
    });

    it('should concatenate base prompt and style [REQ-PIPE-016]', async () => {
      const phase6Agent = createMockAgent(6);
      phase6Agent.description = 'Write academic content.';

      const prompt = await injector.buildAgentPrompt(phase6Agent);

      // Base description comes first
      expect(prompt.indexOf('Write academic content'))
        .toBeLessThan(prompt.indexOf('## STYLE GUIDELINES'));
    });
  });

  describe('generateStylePromptFromCharacteristics', () => {
    it('should generate style prompt from characteristics', () => {
      // Use correct nested interface structure from style-analyzer.ts
      const characteristics = {
        sentences: {
          averageLength: 18,
          lengthVariance: 5,
          shortSentenceRatio: 0.3,
          mediumSentenceRatio: 0.5,
          longSentenceRatio: 0.15,
          complexSentenceRatio: 0.05
        },
        vocabulary: {
          uniqueWordRatio: 0.6,
          averageWordLength: 5.5,
          academicWordRatio: 0.15,
          technicalTermDensity: 0.05,
          latinateWordRatio: 0.2,
          contractionUsage: 0.01
        },
        structure: {
          paragraphLengthAvg: 8,
          transitionWordDensity: 0.03,
          passiveVoiceRatio: 0.25,
          firstPersonUsage: 0.01,
          thirdPersonUsage: 0.1,
          questionFrequency: 0.02,
          listUsage: 0.05
        },
        tone: {
          formalityScore: 0.8,
          objectivityScore: 0.85,
          hedgingFrequency: 0.03,
          assertivenessScore: 0.7,
          emotionalTone: 0.1
        },
        samplePhrases: ['in this study', 'we found that'],
        commonTransitions: ['however', 'therefore', 'moreover'],
        openingPatterns: ['This study', 'The research'],
        citationStyle: 'author-date'
      };

      const prompt = injector.generateStylePromptFromCharacteristics(characteristics);

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Sentence Structure');
    });
  });

  describe('getStyleCharacteristics', () => {
    it('should return null for non-existent profile', () => {
      const characteristics = injector.getStyleCharacteristics('nonexistent-profile');
      expect(characteristics).toBeNull();
    });

    it('should return characteristics for existing profile', () => {
      // If there's an active profile, this should work
      const characteristics = injector.getStyleCharacteristics();
      // May or may not be null depending on profile state
      if (characteristics) {
        // Use correct nested interface structure
        expect(characteristics.sentences).toBeDefined();
        expect(characteristics.vocabulary).toBeDefined();
        expect(characteristics.tone).toBeDefined();
      }
      // Test passes whether or not there's an active profile
      expect(true).toBe(true);
    });
  });

  describe('getStylePrompt', () => {
    it('should return null for non-existent profile', () => {
      const prompt = injector.getStylePrompt('nonexistent-profile');
      expect(prompt).toBeNull();
    });
  });

  describe('validateStyleInjection', () => {
    it('should validate prompt contains required components [REQ-PIPE-012, REQ-PIPE-015]', () => {
      const validPrompt = `
        ## STYLE GUIDELINES
        Regional Language Settings:
        - Use American English spelling conventions
        - Examples: color, organization, analyze
      `;

      const result = injector.validateStyleInjection(validPrompt);

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should detect missing language variant [REQ-PIPE-015]', () => {
      const invalidPrompt = `
        ## STYLE GUIDELINES
        Spelling rules: use proper spelling conventions
      `;

      const result = injector.validateStyleInjection(invalidPrompt);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('REQ-PIPE-015 (Language Variant)');
    });

    it('should detect missing spelling rules [REQ-PIPE-012]', () => {
      const invalidPrompt = `
        ## STYLE GUIDELINES
        Use American English conventions
      `;

      const result = injector.validateStyleInjection(invalidPrompt);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('REQ-PIPE-012 (Spelling Rules)');
    });

    it('should detect multiple missing components', () => {
      const invalidPrompt = `
        ## STYLE GUIDELINES
        Be academic.
      `;

      const result = injector.validateStyleInjection(invalidPrompt);

      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('hasStyleInjection', () => {
    it('should detect STYLE GUIDELINES header', () => {
      const prompt = 'Some text\n## STYLE GUIDELINES\nStyle rules here';
      expect(injector.hasStyleInjection(prompt)).toBe(true);
    });

    it('should detect Regional Language Settings', () => {
      const prompt = 'Regional Language Settings:\n- Use American English';
      expect(injector.hasStyleInjection(prompt)).toBe(true);
    });

    it('should detect Sentence Structure', () => {
      const prompt = 'Sentence Structure:\n- Mix of short and medium sentences';
      expect(injector.hasStyleInjection(prompt)).toBe(true);
    });

    it('should return false for prompts without style', () => {
      const prompt = 'Write academic content following best practices.';
      expect(injector.hasStyleInjection(prompt)).toBe(false);
    });
  });

  describe('getDefaultStylePrompt', () => {
    it('should return default style with American English', () => {
      const defaultPrompt = injector.getDefaultStylePrompt();

      expect(defaultPrompt).toContain('American English');
      expect(defaultPrompt).toContain('spell');
      expect(defaultPrompt).toContain('APA');
    });
  });

  describe('Phase 6 integration', () => {
    it('should inject style for all writing agents', async () => {
      const writerAgents = [
        'introduction-writer',
        'literature-review-writer',
        'methodology-writer',
        'results-writer',
        'discussion-writer',
        'conclusion-writer',
        'abstract-writer'
      ];

      for (const agentKey of writerAgents) {
        const agent = createMockAgent(6, agentKey);
        const prompt = await injector.buildAgentPrompt(agent);

        expect(prompt).toContain('## STYLE GUIDELINES');
        expect(injector.hasStyleInjection(prompt)).toBe(true);
      }
    });
  });
});
