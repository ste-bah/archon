/**
 * Unit Tests for SpellingTransformer
 *
 * Tests UK/US English spelling transformation, variant detection,
 * case preservation, and exception handling.
 *
 * @module spelling-transformer.test
 * Validates [REQ-STYLE-002]: Spelling transformation
 * Validates [REQ-STYLE-006]: Variant detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SpellingTransformer,
  type SpellingRule,
  type GrammarRule,
  type VariantDetectionResult
} from '../../../src/god-agent/universal/spelling-transformer';

describe('SpellingTransformer', () => {
  describe('Constructor', () => {
    it('should create transformer with en-US variant', () => {
      const transformer = new SpellingTransformer('en-US');
      expect(transformer.getVariant()).toBe('en-US');
    });

    it('should create transformer with en-GB variant', () => {
      const transformer = new SpellingTransformer('en-GB');
      expect(transformer.getVariant()).toBe('en-GB');
    });
  });

  describe('transform() - en-US variant', () => {
    let transformer: SpellingTransformer;

    beforeEach(() => {
      transformer = new SpellingTransformer('en-US');
    });

    it('should return text unchanged for en-US variant', () => {
      const text = 'The organization will analyze the color and behavior.';
      const result = transformer.transform(text);
      expect(result).toBe(text);
    });

    it('should preserve UK spelling in en-US mode (no transformation)', () => {
      const text = 'The organisation will analyse the colour and behaviour.';
      const result = transformer.transform(text);
      expect(result).toBe(text);
    });
  });

  describe('transform() - en-GB variant', () => {
    let transformer: SpellingTransformer;

    beforeEach(() => {
      transformer = new SpellingTransformer('en-GB');
    });

    describe('Pattern 1: -ize → -ise', () => {
      it('should transform -ize to -ise', () => {
        const result = transformer.transform('organize realize customize');
        expect(result).toBe('organise realise customise');
      });

      it('should transform -ization to -isation', () => {
        const result = transformer.transform('organization realization');
        expect(result).toBe('organisation realisation');
      });

      it('should transform -izing to -ising', () => {
        const result = transformer.transform('organizing realizing');
        expect(result).toBe('organising realising');
      });

      it('should transform -ized to -ised', () => {
        const result = transformer.transform('organized realized');
        expect(result).toBe('organised realised');
      });

      it('should transform -izer to -iser', () => {
        const result = transformer.transform('organizer optimizer');
        expect(result).toBe('organiser optimiser');
      });

      it('should NOT transform exceptions: size, prize, seize, capsize', () => {
        const result = transformer.transform('size prize seize capsize');
        expect(result).toBe('size prize seize capsize');
      });
    });

    describe('Pattern 2: -or → -our', () => {
      it('should transform color variations', () => {
        expect(transformer.transform('color')).toBe('colour');
        expect(transformer.transform('colors')).toBe('colours');
        expect(transformer.transform('colored')).toBe('coloured');
        expect(transformer.transform('coloring')).toBe('colouring');
        expect(transformer.transform('colorful')).toBe('colourful');
      });

      it('should transform favor variations', () => {
        expect(transformer.transform('favor')).toBe('favour');
        expect(transformer.transform('favors')).toBe('favours');
        expect(transformer.transform('favored')).toBe('favoured');
        expect(transformer.transform('favoring')).toBe('favouring');
        expect(transformer.transform('favorite')).toBe('favourite');
        expect(transformer.transform('favorites')).toBe('favourites');
        expect(transformer.transform('favorable')).toBe('favourable');
      });

      it('should transform honor variations', () => {
        expect(transformer.transform('honor')).toBe('honour');
        expect(transformer.transform('honors')).toBe('honours');
        expect(transformer.transform('honored')).toBe('honoured');
        expect(transformer.transform('honoring')).toBe('honouring');
        expect(transformer.transform('honorable')).toBe('honourable');
      });

      it('should transform labor variations', () => {
        expect(transformer.transform('labor')).toBe('labour');
        expect(transformer.transform('labors')).toBe('labours');
        expect(transformer.transform('labored')).toBe('laboured');
        expect(transformer.transform('laboring')).toBe('labouring');
      });

      it('should transform neighbor variations', () => {
        expect(transformer.transform('neighbor')).toBe('neighbour');
        expect(transformer.transform('neighbors')).toBe('neighbours');
        expect(transformer.transform('neighboring')).toBe('neighbouring');
        expect(transformer.transform('neighborhood')).toBe('neighbourhood');
        expect(transformer.transform('neighborhoods')).toBe('neighbourhoods');
      });

      it('should transform behavior variations', () => {
        expect(transformer.transform('behavior')).toBe('behaviour');
        expect(transformer.transform('behaviors')).toBe('behaviours');
        expect(transformer.transform('behavioral')).toBe('behavioural');
      });

      it('should transform other -or words', () => {
        expect(transformer.transform('humor')).toBe('humour');
        expect(transformer.transform('rumor')).toBe('rumour');
        expect(transformer.transform('rumors')).toBe('rumours');
        expect(transformer.transform('savor')).toBe('savour');
        expect(transformer.transform('savors')).toBe('savours');
        expect(transformer.transform('odor')).toBe('odour');
        expect(transformer.transform('odors')).toBe('odours');
        expect(transformer.transform('vigor')).toBe('vigour');
      });
    });

    describe('Pattern 3: -er → -re', () => {
      it('should transform center variations', () => {
        expect(transformer.transform('center')).toBe('centre');
        expect(transformer.transform('centers')).toBe('centres');
        expect(transformer.transform('centered')).toBe('centred');
        expect(transformer.transform('centering')).toBe('centring');
      });

      it('should transform theater variations', () => {
        expect(transformer.transform('theater')).toBe('theatre');
        expect(transformer.transform('theaters')).toBe('theatres');
      });

      it('should transform fiber variations', () => {
        expect(transformer.transform('fiber')).toBe('fibre');
        expect(transformer.transform('fibers')).toBe('fibres');
      });

      it('should transform meter variations', () => {
        expect(transformer.transform('meter')).toBe('metre');
        expect(transformer.transform('meters')).toBe('metres');
      });

      it('should NOT transform meter exceptions', () => {
        const result = transformer.transform('parameter thermometer speedometer barometer');
        expect(result).toBe('parameter thermometer speedometer barometer');
      });

      it('should transform other -er words', () => {
        expect(transformer.transform('liter')).toBe('litre');
        expect(transformer.transform('liters')).toBe('litres');
        expect(transformer.transform('somber')).toBe('sombre');
        expect(transformer.transform('meager')).toBe('meagre');
        expect(transformer.transform('luster')).toBe('lustre');
        expect(transformer.transform('specter')).toBe('spectre');
        expect(transformer.transform('specters')).toBe('spectres');
      });
    });

    describe('Pattern 4: -yze → -yse', () => {
      it('should transform analyze variations', () => {
        expect(transformer.transform('analyze')).toBe('analyse');
        expect(transformer.transform('analyzes')).toBe('analyses');
        expect(transformer.transform('analyzed')).toBe('analysed');
        expect(transformer.transform('analyzing')).toBe('analysing');
      });

      it('should transform paralyze variations', () => {
        expect(transformer.transform('paralyze')).toBe('paralyse');
        expect(transformer.transform('paralyzes')).toBe('paralyses');
        expect(transformer.transform('paralyzed')).toBe('paralysed');
      });

      it('should transform catalyze variations', () => {
        expect(transformer.transform('catalyze')).toBe('catalyse');
        expect(transformer.transform('catalyzes')).toBe('catalyses');
      });
    });

    describe('Pattern 5: -ense → -ence', () => {
      it('should transform defense to defence', () => {
        expect(transformer.transform('defense')).toBe('defence');
      });

      it('should transform offense to offence', () => {
        expect(transformer.transform('offense')).toBe('offence');
      });

      it('should transform license to licence', () => {
        expect(transformer.transform('license')).toBe('licence');
      });

      it('should transform pretense to pretence', () => {
        expect(transformer.transform('pretense')).toBe('pretence');
      });

      it('should preserve defensive unchanged', () => {
        expect(transformer.transform('defensive')).toBe('defensive');
      });
    });

    describe('Pattern 6: -og → -ogue', () => {
      it('should transform dialog variations', () => {
        expect(transformer.transform('dialog')).toBe('dialogue');
        expect(transformer.transform('dialogs')).toBe('dialogues');
      });

      it('should transform catalog variations', () => {
        expect(transformer.transform('catalog')).toBe('catalogue');
        expect(transformer.transform('catalogs')).toBe('catalogues');
        expect(transformer.transform('cataloged')).toBe('catalogued');
      });

      it('should transform analog to analogue', () => {
        expect(transformer.transform('analog')).toBe('analogue');
      });

      it('should transform prolog variations', () => {
        expect(transformer.transform('prolog')).toBe('prologue');
        expect(transformer.transform('prologs')).toBe('prologues');
      });

      it('should transform epilog variations', () => {
        expect(transformer.transform('epilog')).toBe('epilogue');
        expect(transformer.transform('epilogs')).toBe('epilogues');
      });

      it('should transform monolog variations', () => {
        expect(transformer.transform('monolog')).toBe('monologue');
        expect(transformer.transform('monologs')).toBe('monologues');
      });
    });

    describe('Pattern 7: Special cases', () => {
      it('should transform gray to grey', () => {
        expect(transformer.transform('gray')).toBe('grey');
        expect(transformer.transform('grays')).toBe('greys');
      });

      it('should transform judgment variations', () => {
        expect(transformer.transform('judgment')).toBe('judgement');
        expect(transformer.transform('judgments')).toBe('judgements');
      });

      it('should transform acknowledgment variations', () => {
        expect(transformer.transform('acknowledgment')).toBe('acknowledgement');
        expect(transformer.transform('acknowledgments')).toBe('acknowledgements');
      });

      it('should transform fulfill variations', () => {
        expect(transformer.transform('fulfill')).toBe('fulfil');
        expect(transformer.transform('fulfills')).toBe('fulfils');
        expect(transformer.transform('fulfilled')).toBe('fulfilled'); // unchanged
        expect(transformer.transform('fulfillment')).toBe('fulfilment');
      });

      it('should transform enroll variations', () => {
        expect(transformer.transform('enroll')).toBe('enrol');
        expect(transformer.transform('enrolls')).toBe('enrols');
        expect(transformer.transform('enrolled')).toBe('enrolled'); // unchanged
        expect(transformer.transform('enrollment')).toBe('enrolment');
        expect(transformer.transform('enrollments')).toBe('enrolments');
      });

      it('should transform install variations', () => {
        expect(transformer.transform('install')).toBe('instal');
        expect(transformer.transform('installs')).toBe('instals');
        expect(transformer.transform('installed')).toBe('installed'); // unchanged
        expect(transformer.transform('installment')).toBe('instalment');
        expect(transformer.transform('installments')).toBe('instalments');
      });

      it('should transform skillful and wilful', () => {
        expect(transformer.transform('skillful')).toBe('skilful');
        expect(transformer.transform('wilful')).toBe('wilful');
      });

      it('should transform traveling variations', () => {
        expect(transformer.transform('traveling')).toBe('travelling');
        expect(transformer.transform('traveled')).toBe('travelled');
        expect(transformer.transform('traveler')).toBe('traveller');
        expect(transformer.transform('travelers')).toBe('travellers');
      });

      it('should transform canceled/canceling', () => {
        expect(transformer.transform('canceled')).toBe('cancelled');
        expect(transformer.transform('canceling')).toBe('cancelling');
      });

      it('should transform modeled/modeling', () => {
        expect(transformer.transform('modeled')).toBe('modelled');
        expect(transformer.transform('modeling')).toBe('modelling');
      });

      it('should transform labeled/labeling', () => {
        expect(transformer.transform('labeled')).toBe('labelled');
        expect(transformer.transform('labeling')).toBe('labelling');
      });

      it('should transform leveled/leveling', () => {
        expect(transformer.transform('leveled')).toBe('levelled');
        expect(transformer.transform('leveling')).toBe('levelling');
      });

      it('should transform signaled/signaling', () => {
        expect(transformer.transform('signaled')).toBe('signalled');
        expect(transformer.transform('signaling')).toBe('signalling');
      });

      it('should transform practice to practise (verb)', () => {
        expect(transformer.transform('practice')).toBe('practise');
      });

      it('should transform tire to tyre (wheel)', () => {
        expect(transformer.transform('tire')).toBe('tyre');
        expect(transformer.transform('tires')).toBe('tyres');
      });

      it('should NOT transform tire exceptions', () => {
        const result = transformer.transform('tired tiresome tireless');
        expect(result).toBe('tired tiresome tireless');
      });

      it('should transform pajamas to pyjamas', () => {
        expect(transformer.transform('pajamas')).toBe('pyjamas');
      });

      it('should transform cozy variations', () => {
        expect(transformer.transform('cozy')).toBe('cosy');
        expect(transformer.transform('cozier')).toBe('cosier');
      });
    });

    describe('Case preservation', () => {
      it('should preserve lowercase', () => {
        expect(transformer.transform('color')).toBe('colour');
        expect(transformer.transform('analyze')).toBe('analyse');
      });

      it('should preserve Title Case', () => {
        expect(transformer.transform('Color')).toBe('Colour');
        expect(transformer.transform('Analyze')).toBe('Analyse');
        expect(transformer.transform('Organization')).toBe('Organisation');
      });

      it('should preserve UPPERCASE', () => {
        expect(transformer.transform('COLOR')).toBe('COLOUR');
        expect(transformer.transform('ANALYZE')).toBe('ANALYSE');
        expect(transformer.transform('ORGANIZATION')).toBe('ORGANISATION');
      });

      it('should preserve mixed case in sentences', () => {
        const result = transformer.transform('The Organization will Analyze the Color.');
        expect(result).toBe('The Organisation will Analyse the Colour.');
      });
    });

    describe('Technical exceptions', () => {
      it('should NOT transform program variations', () => {
        const result = transformer.transform('program programs programming programmer programmed');
        expect(result).toBe('program programs programming programmer programmed');
      });

      it('should NOT transform size variations', () => {
        const result = transformer.transform('size sizes sized sizing');
        expect(result).toBe('size sizes sized sizing');
      });

      it('should NOT transform prize variations', () => {
        const result = transformer.transform('prize prizes prized');
        expect(result).toBe('prize prizes prized');
      });

      it('should NOT transform seize variations', () => {
        const result = transformer.transform('seize seizes seized seizing');
        expect(result).toBe('seize seizes seized seizing');
      });

      it('should NOT transform capsize variations', () => {
        const result = transformer.transform('capsize capsizes capsized');
        expect(result).toBe('capsize capsizes capsized');
      });
    });

    describe('Complex sentences', () => {
      it('should transform complete sentence', () => {
        const input = 'The organization will analyze the color and behavior of travelers in the theater.';
        const expected = 'The organisation will analyse the colour and behaviour of travellers in the theatre.';
        expect(transformer.transform(input)).toBe(expected);
      });

      it('should handle multiple transformations in one sentence', () => {
        const input = 'We need to organize, analyze, and optimize the program for our neighbors.';
        const expected = 'We need to organise, analyse, and optimise the program for our neighbours.';
        expect(transformer.transform(input)).toBe(expected);
      });
    });
  });

  describe('detectVariant()', () => {
    let transformer: SpellingTransformer;

    beforeEach(() => {
      transformer = new SpellingTransformer('en-US');
    });

    it('should detect UK English text', () => {
      const text = 'The organisation will analyse the colour and behaviour at the theatre.';
      const result = transformer.detectVariant(text);

      expect(result.variant).toBe('en-GB');
      expect(result.ukSpellingCount).toBeGreaterThan(0);
      expect(result.usSpellingCount).toBe(0);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.totalChecked).toBeGreaterThan(0);
    });

    it('should detect US English text', () => {
      const text = 'The organization will analyze the color and behavior at the theater.';
      const result = transformer.detectVariant(text);

      expect(result.variant).toBe('en-US');
      expect(result.usSpellingCount).toBeGreaterThan(0);
      expect(result.ukSpellingCount).toBe(0);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.totalChecked).toBeGreaterThan(0);
    });

    it('should detect mixed variant text', () => {
      const text = 'The organization will analyse the color and behaviour.';
      const result = transformer.detectVariant(text);

      expect(result.variant).toBe('mixed');
      expect(result.ukSpellingCount).toBeGreaterThan(0);
      expect(result.usSpellingCount).toBeGreaterThan(0);
      expect(result.totalChecked).toBeGreaterThan(0);
    });

    it('should return mixed with zero confidence for neutral text', () => {
      const text = 'The quick brown fox jumps over the lazy dog.';
      const result = transformer.detectVariant(text);

      expect(result.variant).toBe('mixed');
      expect(result.confidence).toBe(0);
      expect(result.ukSpellingCount).toBe(0);
      expect(result.usSpellingCount).toBe(0);
      expect(result.totalChecked).toBe(0);
    });

    it('should handle empty text', () => {
      const result = transformer.detectVariant('');

      expect(result.variant).toBe('mixed');
      expect(result.confidence).toBe(0);
      expect(result.ukSpellingCount).toBe(0);
      expect(result.usSpellingCount).toBe(0);
      expect(result.totalChecked).toBe(0);
    });

    it('should detect UK variant with high confidence', () => {
      const text = 'The organisation will analyse the colour, behaviour, honour, labour, neighbour, centre, theatre, fibre, defence, dialogue, and grey.';
      const result = transformer.detectVariant(text);

      expect(result.variant).toBe('en-GB');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect US variant with high confidence', () => {
      const text = 'The organization will analyze the color, behavior, honor, labor, neighbor, center, theater, fiber, defense, dialog, and gray.';
      const result = transformer.detectVariant(text);

      expect(result.variant).toBe('en-US');
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('getSpellingRules()', () => {
    it('should return empty array for en-US', () => {
      const rules = SpellingTransformer.getSpellingRules('en-US');
      expect(rules).toEqual([]);
    });

    it('should return array of rules for en-GB', () => {
      const rules = SpellingTransformer.getSpellingRules('en-GB');
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(20); // Should have many rules
    });

    it('should return rules with correct structure', () => {
      const rules = SpellingTransformer.getSpellingRules('en-GB');

      rules.forEach((rule: SpellingRule) => {
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('replacement');
        expect(rule).toHaveProperty('description');
        expect(rule.pattern).toBeInstanceOf(RegExp);
        expect(typeof rule.replacement).toBe('string');
        expect(typeof rule.description).toBe('string');
      });
    });

    it('should include -ize to -ise rules', () => {
      const rules = SpellingTransformer.getSpellingRules('en-GB');
      const izeRule = rules.find(r => r.description.includes('-ize to -ise'));
      expect(izeRule).toBeDefined();
    });

    it('should include -or to -our rules', () => {
      const rules = SpellingTransformer.getSpellingRules('en-GB');
      const colorRule = rules.find(r => r.description.includes('color to colour'));
      expect(colorRule).toBeDefined();
    });

    it('should include exceptions in rules', () => {
      const rules = SpellingTransformer.getSpellingRules('en-GB');
      const izeRule = rules.find(r => r.description.includes('-ize to -ise'));

      expect(izeRule?.exceptions).toBeDefined();
      expect(izeRule?.exceptions).toContain('size');
      expect(izeRule?.exceptions).toContain('prize');
    });
  });

  describe('getGrammarRules()', () => {
    it('should return empty array for en-US (Phase 2 placeholder)', () => {
      const rules = SpellingTransformer.getGrammarRules('en-US');
      expect(rules).toEqual([]);
    });

    it('should return empty array for en-GB (Phase 2 placeholder)', () => {
      const rules = SpellingTransformer.getGrammarRules('en-GB');
      expect(rules).toEqual([]);
    });
  });

  describe('getVariant()', () => {
    it('should return en-US for US transformer', () => {
      const transformer = new SpellingTransformer('en-US');
      expect(transformer.getVariant()).toBe('en-US');
    });

    it('should return en-GB for UK transformer', () => {
      const transformer = new SpellingTransformer('en-GB');
      expect(transformer.getVariant()).toBe('en-GB');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle real-world academic text transformation', () => {
      const transformer = new SpellingTransformer('en-GB');
      const input = 'The research organization will analyze the behavior patterns and optimize the program for color recognition.';
      const expected = 'The research organisation will analyse the behaviour patterns and optimise the program for colour recognition.';

      expect(transformer.transform(input)).toBe(expected);
    });

    it('should detect and transform mixed content', () => {
      const transformer = new SpellingTransformer('en-GB');
      const input = 'We will organize a meeting at the theater to analyze the color scheme.';
      const expected = 'We will organise a meeting at the theatre to analyse the colour scheme.';

      expect(transformer.transform(input)).toBe(expected);
    });

    it('should preserve technical terms while transforming surrounding text', () => {
      const transformer = new SpellingTransformer('en-GB');
      const input = 'The program will optimize the color buffer size.';
      const expected = 'The program will optimise the colour buffer size.';

      expect(transformer.transform(input)).toBe(expected);
    });
  });
});
