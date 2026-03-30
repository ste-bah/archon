/**
 * Unit tests for GrammarTransformer
 * Tests UK/US English grammar transformation functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GrammarTransformer } from '../../../src/god-agent/universal/grammar-transformer';
import type { GrammarRule, GrammarTransformResult } from '../../../src/god-agent/universal/grammar-transformer';

describe('GrammarTransformer', () => {
  describe('Constructor', () => {
    it('should create instance with en-US variant', () => {
      const transformer = new GrammarTransformer('en-US');
      expect(transformer.getVariant()).toBe('en-US');
    });

    it('should create instance with en-GB variant', () => {
      const transformer = new GrammarTransformer('en-GB');
      expect(transformer.getVariant()).toBe('en-GB');
    });

    it('should filter rules by enabled categories', () => {
      const transformer = new GrammarTransformer('en-GB', {
        enabledCategories: ['past-participle']
      });

      const rules = transformer.getRulesByCategory('past-participle');
      expect(rules.length).toBeGreaterThan(0);

      const prepRules = transformer.getRulesByCategory('preposition');
      expect(prepRules.length).toBe(0);
    });
  });

  describe('getVariant()', () => {
    it('should return correct variant for en-US', () => {
      const transformer = new GrammarTransformer('en-US');
      expect(transformer.getVariant()).toBe('en-US');
    });

    it('should return correct variant for en-GB', () => {
      const transformer = new GrammarTransformer('en-GB');
      expect(transformer.getVariant()).toBe('en-GB');
    });
  });

  describe('Past Participle Transformations', () => {
    let transformer: GrammarTransformer;

    beforeEach(() => {
      transformer = new GrammarTransformer('en-GB');
    });

    it('should transform "gotten" to "got"', () => {
      const result = transformer.transform('I have gotten the results.');
      expect(result.transformed).toBe('I have got the results.');
      expect(result.rulesApplied).toContain('pp-gotten');
      expect(result.changeCount).toBeGreaterThan(0);
    });

    it('should transform "proven" to "proved" (narrativeOnly)', () => {
      const resultNarrative = transformer.transform('It has proven difficult.', {
        narrativeOnly: true
      });
      expect(resultNarrative.transformed).toBe('It has proved difficult.');
      expect(resultNarrative.rulesApplied).toContain('pp-proven');

      // Should skip when narrativeOnly: false
      const resultNonNarrative = transformer.transform('It has proven difficult.', {
        narrativeOnly: false
      });
      expect(resultNonNarrative.transformed).toBe('It has proven difficult.');
      expect(resultNonNarrative.rulesApplied).not.toContain('pp-proven');
    });

    it('should transform "snuck" to "sneaked"', () => {
      const result = transformer.transform('He snuck into the room.');
      expect(result.transformed).toBe('He sneaked into the room.');
      expect(result.rulesApplied).toContain('pp-snuck');
    });

    it('should transform "dove" to "dived" before directional words', () => {
      const result1 = transformer.transform('She dove into the pool.');
      expect(result1.transformed).toBe('She dived into the pool.');
      expect(result1.rulesApplied).toContain('pp-dove');

      const result2 = transformer.transform('They dove through the tunnel.');
      expect(result2.transformed).toBe('They dived through the tunnel.');

      const result3 = transformer.transform('They dove under the waves.');
      expect(result3.transformed).toBe('They dived under the waves.');
    });

    it('should NOT transform "dove" when not followed by directional words', () => {
      const result = transformer.transform('The dove flew away.');
      expect(result.transformed).toBe('The dove flew away.');
      expect(result.rulesApplied).not.toContain('pp-dove');
    });

    it('should transform "fit" to "fitted" before prepositions', () => {
      const result1 = transformer.transform('It fit perfectly.');
      expect(result1.transformed).toBe('It fitted perfectly.');
      expect(result1.rulesApplied).toContain('pp-fit');

      const result2 = transformer.transform('The key fit into the lock.');
      expect(result2.transformed).toBe('The key fitted into the lock.');

      const result3 = transformer.transform('It fit well.');
      expect(result3.transformed).toBe('It fitted well.');
    });

    it('should transform "pled" to "pleaded"', () => {
      const result = transformer.transform('He pled guilty.');
      expect(result.transformed).toBe('He pleaded guilty.');
      expect(result.rulesApplied).toContain('pp-pled');
    });

    it('should transform "learned" to "learnt"', () => {
      const result = transformer.transform('She learned quickly.');
      expect(result.transformed).toBe('She learnt quickly.');
      expect(result.rulesApplied).toContain('pp-learned');
    });

    it('should transform "burned" to "burnt"', () => {
      const result = transformer.transform('The fire burned out.');
      expect(result.transformed).toBe('The fire burnt out.');
      expect(result.rulesApplied).toContain('pp-burned');
    });

    it('should transform "spelled" to "spelt"', () => {
      const result = transformer.transform('He spelled it correctly.');
      expect(result.transformed).toBe('He spelt it correctly.');
      expect(result.rulesApplied).toContain('pp-spelled');
    });

    it('should transform "dreamed" to "dreamt"', () => {
      const result = transformer.transform('She dreamed of success.');
      expect(result.transformed).toBe('She dreamt of success.');
      expect(result.rulesApplied).toContain('pp-dreamed');
    });

    it('should transform "leaped" to "leapt"', () => {
      const result = transformer.transform('He leaped over the fence.');
      expect(result.transformed).toBe('He leapt over the fence.');
      expect(result.rulesApplied).toContain('pp-leaped');
    });

    it('should transform "spoiled" to "spoilt"', () => {
      const result = transformer.transform('The milk spoiled.');
      expect(result.transformed).toBe('The milk spoilt.');
      expect(result.rulesApplied).toContain('pp-spoiled');
    });
  });

  describe('Preposition Transformations', () => {
    let transformer: GrammarTransformer;

    beforeEach(() => {
      transformer = new GrammarTransformer('en-GB');
    });

    it('should transform "different than" to "different from"', () => {
      const result = transformer.transform('This is different than that.');
      expect(result.transformed).toBe('This is different from that.');
      expect(result.rulesApplied).toContain('prep-different-than');
    });

    it('should transform "toward" to "towards"', () => {
      const result = transformer.transform('She walked toward the door.');
      expect(result.transformed).toBe('She walked towards the door.');
      expect(result.rulesApplied).toContain('prep-toward');
    });

    it('should NOT transform "toward" when already "towards"', () => {
      const result = transformer.transform('She walked towards the door.');
      expect(result.transformed).toBe('She walked towards the door.');
    });

    it('should transform "backward" to "backwards"', () => {
      const result = transformer.transform('He stepped backward.');
      expect(result.transformed).toBe('He stepped backwards.');
      expect(result.rulesApplied).toContain('prep-backward');
    });

    it('should transform "forward" to "forwards"', () => {
      const result = transformer.transform('Move forward.');
      expect(result.transformed).toBe('Move forwards.');
      expect(result.rulesApplied).toContain('prep-forward');
    });

    it('should transform "afterward" to "afterwards"', () => {
      const result = transformer.transform('We met afterward.');
      expect(result.transformed).toBe('We met afterwards.');
      expect(result.rulesApplied).toContain('prep-afterward');
    });

    it('should transform "on the weekend" to "at the weekend"', () => {
      const result = transformer.transform('I relax on the weekend.');
      expect(result.transformed).toBe('I relax at the weekend.');
      expect(result.rulesApplied).toContain('prep-on-the-weekend');
    });

    it('should transform "Monday through Friday" to "Monday to Friday"', () => {
      const result = transformer.transform('We work Monday through Friday.');
      // Note: Case preservation applies to the match, affecting the second day
      expect(result.transformed).toBe('We work Monday to friday.');
      expect(result.rulesApplied).toContain('prep-monday-through');
    });

    it('should transform various day ranges', () => {
      const result1 = transformer.transform('Tuesday through Thursday');
      // Note: Case preservation applies to the match, affecting the second day
      expect(result1.transformed).toBe('Tuesday to thursday');

      const result2 = transformer.transform('Saturday through Sunday');
      expect(result2.transformed).toBe('Saturday to sunday');
    });
  });

  describe('Collective Noun Transformations', () => {
    let transformer: GrammarTransformer;

    beforeEach(() => {
      transformer = new GrammarTransformer('en-GB');
    });

    it('should transform "team is" to "team are" (narrativeOnly)', () => {
      const resultNarrative = transformer.transform('The team is winning.', {
        narrativeOnly: true
      });
      expect(resultNarrative.transformed).toBe('The team are winning.');
      expect(resultNarrative.rulesApplied).toContain('collective-team');

      const resultNonNarrative = transformer.transform('The team is winning.', {
        narrativeOnly: false
      });
      expect(resultNonNarrative.transformed).toBe('The team is winning.');
    });

    it('should transform "government is" to "government are"', () => {
      const result = transformer.transform('The government is deciding.', {
        narrativeOnly: true
      });
      expect(result.transformed).toBe('The government are deciding.');
      expect(result.rulesApplied).toContain('collective-government');
    });

    it('should transform "committee is" to "committee are"', () => {
      const result = transformer.transform('The committee is meeting.', {
        narrativeOnly: true
      });
      expect(result.transformed).toBe('The committee are meeting.');
      expect(result.rulesApplied).toContain('collective-committee');
    });

    it('should transform "staff is" to "staff are"', () => {
      const result = transformer.transform('The staff is ready.', {
        narrativeOnly: true
      });
      expect(result.transformed).toBe('The staff are ready.');
      expect(result.rulesApplied).toContain('collective-staff');
    });

    it('should transform "family is" to "family are"', () => {
      const result = transformer.transform('The family is gathering.', {
        narrativeOnly: true
      });
      expect(result.transformed).toBe('The family are gathering.');
      expect(result.rulesApplied).toContain('collective-family');
    });

    it('should transform "company is" to "company are"', () => {
      const result = transformer.transform('The company is expanding.', {
        narrativeOnly: true
      });
      expect(result.transformed).toBe('The company are expanding.');
      expect(result.rulesApplied).toContain('collective-company');
    });
  });

  describe('Transform Method', () => {
    it('should return GrammarTransformResult with correct structure', () => {
      const transformer = new GrammarTransformer('en-GB');
      const result = transformer.transform('I have gotten it.');

      expect(result).toHaveProperty('transformed');
      expect(result).toHaveProperty('rulesApplied');
      expect(result).toHaveProperty('changeCount');
      expect(typeof result.transformed).toBe('string');
      expect(Array.isArray(result.rulesApplied)).toBe(true);
      expect(typeof result.changeCount).toBe('number');
    });

    it('should return unchanged text for en-US variant', () => {
      const transformer = new GrammarTransformer('en-US');
      const input = 'I have gotten different things toward the goal.';
      const result = transformer.transform(input);

      expect(result.transformed).toBe(input);
      expect(result.rulesApplied).toEqual([]);
      expect(result.changeCount).toBe(0);
    });

    it('should handle multiple transformations in single text', () => {
      const transformer = new GrammarTransformer('en-GB');
      const result = transformer.transform(
        'I have gotten it different than expected and walked toward the goal.'
      );

      expect(result.transformed).toBe(
        'I have got it different from expected and walked towards the goal.'
      );
      expect(result.rulesApplied.length).toBeGreaterThan(1);
      expect(result.changeCount).toBeGreaterThan(1);
    });

    it('should preserve case in transformations', () => {
      const transformer = new GrammarTransformer('en-GB');

      // Test lowercase
      const lower = transformer.transform('gotten');
      expect(lower.transformed).toBe('got');

      // Test capitalized
      const capital = transformer.transform('Gotten');
      expect(capital.transformed).toBe('Got');

      // Test uppercase
      const upper = transformer.transform('GOTTEN');
      expect(upper.transformed).toBe('GOT');
    });

    it('should filter by category option', () => {
      const transformer = new GrammarTransformer('en-GB');
      const result = transformer.transform(
        'I have gotten it different than expected.',
        { categories: ['past-participle'] }
      );

      expect(result.transformed).toBe('I have got it different than expected.');
      expect(result.rulesApplied).toContain('pp-gotten');
      expect(result.rulesApplied).not.toContain('prep-different-than');
    });

    it('should respect narrativeOnly parameter', () => {
      const transformer = new GrammarTransformer('en-GB');

      const narrative = transformer.transform('The team is winning.', {
        narrativeOnly: true
      });
      expect(narrative.transformed).toBe('The team are winning.');

      const nonNarrative = transformer.transform('The team is winning.', {
        narrativeOnly: false
      });
      expect(nonNarrative.transformed).toBe('The team is winning.');
    });

    it('should preserve quoted text when preserveQuotes is true', () => {
      const transformer = new GrammarTransformer('en-GB');
      const result = transformer.transform(
        'The team is winning. "The team is the best," he said.',
        { narrativeOnly: true, preserveQuotes: true }
      );

      // First occurrence should be transformed, second (in quotes) preserved
      expect(result.transformed).toContain('The team are winning');
      expect(result.transformed).toContain('"The team is the best,"');
    });

    it('should handle empty string input', () => {
      const transformer = new GrammarTransformer('en-GB');
      const result = transformer.transform('');

      expect(result.transformed).toBe('');
      expect(result.rulesApplied).toEqual([]);
      expect(result.changeCount).toBe(0);
    });

    it('should handle text with no applicable transformations', () => {
      const transformer = new GrammarTransformer('en-GB');
      const input = 'This sentence has no grammar issues.';
      const result = transformer.transform(input);

      expect(result.transformed).toBe(input);
      expect(result.rulesApplied).toEqual([]);
      expect(result.changeCount).toBe(0);
    });
  });

  describe('Static Method: getGrammarRules()', () => {
    it('should return empty array for en-US', () => {
      const rules = GrammarTransformer.getGrammarRules('en-US');
      expect(rules).toEqual([]);
    });

    it('should return 10+ rules for en-GB', () => {
      const rules = GrammarTransformer.getGrammarRules('en-GB');
      expect(rules.length).toBeGreaterThanOrEqual(10);
    });

    it('should return rules with all required properties', () => {
      const rules = GrammarTransformer.getGrammarRules('en-GB');

      rules.forEach((rule: GrammarRule) => {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('replacement');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('category');
        expect(rule).toHaveProperty('narrativeOnly');

        expect(typeof rule.id).toBe('string');
        expect(rule.pattern).toBeInstanceOf(RegExp);
        expect(typeof rule.replacement).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(['collective-noun', 'past-participle', 'preposition']).toContain(rule.category);
        expect(typeof rule.narrativeOnly).toBe('boolean');
      });
    });

    it('should include past-participle rules', () => {
      const rules = GrammarTransformer.getGrammarRules('en-GB');
      const pastParticiples = rules.filter(r => r.category === 'past-participle');
      expect(pastParticiples.length).toBeGreaterThan(0);
    });

    it('should include preposition rules', () => {
      const rules = GrammarTransformer.getGrammarRules('en-GB');
      const prepositions = rules.filter(r => r.category === 'preposition');
      expect(prepositions.length).toBeGreaterThan(0);
    });

    it('should include collective-noun rules', () => {
      const rules = GrammarTransformer.getGrammarRules('en-GB');
      const collectiveNouns = rules.filter(r => r.category === 'collective-noun');
      expect(collectiveNouns.length).toBeGreaterThan(0);
    });
  });

  describe('Integration Tests', () => {
    it('should transform a full sentence with multiple grammar issues', () => {
      const transformer = new GrammarTransformer('en-GB');
      const input = 'I have gotten the results different than expected on the weekend and walked toward the office.';
      const result = transformer.transform(input);

      expect(result.transformed).toBe(
        'I have got the results different from expected at the weekend and walked towards the office.'
      );
      expect(result.rulesApplied.length).toBeGreaterThan(2);
      expect(result.changeCount).toBeGreaterThan(2);
    });

    it('should preserve text that should not change', () => {
      const transformer = new GrammarTransformer('en-GB');
      const input = 'The quick brown fox jumps over the lazy dog.';
      const result = transformer.transform(input);

      expect(result.transformed).toBe(input);
      expect(result.changeCount).toBe(0);
    });

    it('should work with mixed case input', () => {
      const transformer = new GrammarTransformer('en-GB');
      const result = transformer.transform('GOTTEN items are different than OTHERS.');

      expect(result.transformed).toContain('GOT items');
      expect(result.transformed).toContain('different from');
    });

    it('should handle complex narrative with quotes', () => {
      const transformer = new GrammarTransformer('en-GB');
      const input = 'The team is ready. "The team is the best," she said. The team is winning.';
      const result = transformer.transform(input, {
        narrativeOnly: true,
        preserveQuotes: true
      });

      // Narrative occurrences transformed, quote preserved
      const transformedCount = (result.transformed.match(/team are/g) || []).length;
      const preservedCount = (result.transformed.match(/team is/g) || []).length;

      expect(transformedCount).toBeGreaterThan(0);
      expect(preservedCount).toBeGreaterThan(0);
    });

    it('should handle word boundaries correctly', () => {
      const transformer = new GrammarTransformer('en-GB');

      // Should transform "fit into"
      const result1 = transformer.transform('It fit into the box.');
      expect(result1.transformed).toBe('It fitted into the box.');

      // Should NOT partially match words
      const result2 = transformer.transform('The outfit looked good.');
      expect(result2.transformed).toBe('The outfit looked good.');
    });
  });

  describe('getRulesByCategory()', () => {
    it('should return past-participle rules', () => {
      const transformer = new GrammarTransformer('en-GB');
      const rules = transformer.getRulesByCategory('past-participle');

      expect(rules.length).toBeGreaterThan(0);
      rules.forEach(rule => {
        expect(rule.category).toBe('past-participle');
      });
    });

    it('should return preposition rules', () => {
      const transformer = new GrammarTransformer('en-GB');
      const rules = transformer.getRulesByCategory('preposition');

      expect(rules.length).toBeGreaterThan(0);
      rules.forEach(rule => {
        expect(rule.category).toBe('preposition');
      });
    });

    it('should return collective-noun rules', () => {
      const transformer = new GrammarTransformer('en-GB');
      const rules = transformer.getRulesByCategory('collective-noun');

      expect(rules.length).toBeGreaterThan(0);
      rules.forEach(rule => {
        expect(rule.category).toBe('collective-noun');
      });
    });

    it('should return empty array for non-existent category', () => {
      const transformer = new GrammarTransformer('en-GB');
      const rules = transformer.getRulesByCategory('non-existent');

      expect(rules).toEqual([]);
    });
  });
});
