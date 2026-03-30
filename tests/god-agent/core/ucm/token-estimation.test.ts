import { describe, it, expect, beforeEach } from 'vitest';
import {
  WordCounter,
  ContentClassifier,
  TokenEstimationService,
  TOKEN_RATIOS,
  ContentType
} from '@god-agent/core/ucm/index.js';

describe('WordCounter', () => {
  let counter: WordCounter;

  beforeEach(() => {
    counter = new WordCounter();
  });

  describe('count', () => {
    it('should count words accurately in prose', () => {
      const text = 'The quick brown fox jumps over the lazy dog.';
      const result = counter.count(text);

      // count() returns a number (word count)
      expect(result).toBe(9);
    });

    it('should count words in code correctly', () => {
      const code = `function test() {\n  return 42;\n}`;
      const result = counter.count(code);

      expect(result).toBeGreaterThan(0);
    });

    it('should handle empty text', () => {
      const result = counter.count('');

      expect(result).toBe(0);
    });

    it('should handle whitespace-only text', () => {
      const result = counter.count('   \n\t  \n  ');

      expect(result).toBe(0);
    });

    it('should count hyphenated words correctly', () => {
      const text = 'state-of-the-art machine-learning algorithms';
      const result = counter.count(text);

      expect(result).toBe(3);
    });

    it('should count contractions as one word', () => {
      const text = "don't can't won't shouldn't";
      const result = counter.count(text);

      expect(result).toBe(4);
    });

    it('should handle numbers and punctuation', () => {
      const text = 'The year 2024 has 365 days.';
      const result = counter.count(text);

      expect(result).toBe(6);
    });

    it('should handle unicode characters', () => {
      const text = 'Hello 世界 مرحبا дума';
      const result = counter.count(text);

      expect(result).toBe(4);
    });

    it('should process 10K words in under 10ms', () => {
      const largeText = 'word '.repeat(10000);
      const start = performance.now();

      counter.count(largeText);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(10);
    });
  });
});

describe('ContentClassifier', () => {
  let classifier: ContentClassifier;

  beforeEach(() => {
    classifier = new ContentClassifier();
  });

  describe('classify', () => {
    it('should detect prose content', () => {
      const prose = `This is a paragraph of regular text. It contains multiple sentences
        with normal punctuation and spacing. The content flows naturally like
        an essay or article would.`;

      const result = classifier.classify(prose);

      // classify() returns a ContentType enum value
      expect(result).toBe(ContentType.PROSE);
    });

    it('should detect code content with high confidence', () => {
      const code = '```typescript\nfunction calculateSum(a: number, b: number): number {\n  const result = a + b;\n  return result;\n}\n\nexport default calculateSum;\n```';

      const result = classifier.classify(code);

      expect(result).toBe(ContentType.CODE);
    });

    it('should detect markdown tables', () => {
      const table = `| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Value A  | Value B  | Value C  |`;

      const result = classifier.classify(table);

      expect(result).toBe(ContentType.TABLE);
    });

    it('should handle empty content', () => {
      const result = classifier.classify('');

      expect(result).toBe(ContentType.PROSE);
    });

    it('should detect JSON/structured data as code when in code blocks', () => {
      const json = '```json\n{\n  "name": "test",\n  "version": "1.0.0"\n}\n```';

      const result = classifier.classify(json);

      expect(result).toBe(ContentType.CODE);
    });
  });

  describe('classifyDetailed', () => {
    it('should return breakdown array', () => {
      const text = 'This is some prose text with multiple words.';
      const result = classifier.classifyDetailed(text);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return entries with correct structure', () => {
      const text = 'This is some prose text with multiple words.';
      const result = classifier.classifyDetailed(text);

      for (const entry of result) {
        expect(entry).toHaveProperty('contentType');
        expect(entry).toHaveProperty('wordCount');
        expect(entry).toHaveProperty('tokenCount');
        expect(entry).toHaveProperty('percentage');
      }
    });

    it('should handle empty content', () => {
      const result = classifier.classifyDetailed('');

      expect(result).toHaveLength(1);
      expect(result[0].contentType).toBe(ContentType.PROSE);
      expect(result[0].wordCount).toBe(0);
    });
  });
});

describe('TokenEstimationService', () => {
  let service: TokenEstimationService;

  beforeEach(() => {
    service = new TokenEstimationService();
  });

  describe('estimate', () => {
    it('should estimate tokens for prose using correct ratio', () => {
      const prose = 'The quick brown fox jumps over the lazy dog. This is a test sentence.';

      const result = service.estimate(prose);

      // The actual API returns result.tokens (not result.estimatedTokens)
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.contentType).toBe(ContentType.PROSE);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should estimate tokens for code using correct ratio', () => {
      const code = '```typescript\nfunction test() {\n  const x = 42;\n  return x * 2;\n}\n```';

      const result = service.estimate(code);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.contentType).toBe(ContentType.CODE);
    });

    it('should estimate tokens for tables using correct ratio', () => {
      const table = `| Col1 | Col2 | Col3 |
|------|------|------|
| A    | B    | C    |`;

      const result = service.estimate(table);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.contentType).toBe(ContentType.TABLE);
    });

    it('should handle empty content', () => {
      const result = service.estimate('');

      expect(result.tokens).toBe(0);
      expect(result.wordCount).toBe(0);
    });

    it('should include word count', () => {
      const text = 'Hello world test';

      const result = service.estimate(text);

      expect(result.wordCount).toBeGreaterThan(0);
    });

    it('should perform estimation in under 10ms for 10K words', () => {
      const largeText = 'word '.repeat(10000);
      const start = performance.now();

      service.estimate(largeText);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(10);
    });

    it('should apply different ratios for different content types', () => {
      const prose = 'This is a simple sentence with ten words in it now.';
      const code = '```typescript\nconst x = function() { return 42; }\n```';

      const proseResult = service.estimate(prose);
      const codeResult = service.estimate(code);

      // Both should produce tokens
      expect(proseResult.tokens).toBeGreaterThan(0);
      expect(codeResult.tokens).toBeGreaterThan(0);

      // Code should have higher token-to-word ratio when word counts are comparable
      if (proseResult.wordCount > 0 && codeResult.wordCount > 0) {
        const proseRatio = proseResult.tokens / proseResult.wordCount;
        const codeRatio = codeResult.tokens / codeResult.wordCount;
        expect(codeRatio).toBeGreaterThan(proseRatio);
      }
    });

    it('should handle very long content', () => {
      const longText = 'word '.repeat(100000);

      const result = service.estimate(longText);

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.wordCount).toBe(100000);
    });

    it('should return consistent results for same input', () => {
      const text = 'Consistent test input for verification';

      const result1 = service.estimate(text);
      const result2 = service.estimate(text);

      expect(result1.tokens).toBe(result2.tokens);
      expect(result1.contentType).toBe(result2.contentType);
      expect(result1.confidence).toBe(result2.confidence);
    });

    it('should include estimated latency', () => {
      const text = 'Some text for latency measurement';

      const result = service.estimate(text);

      expect(result.estimatedLatencyMs).toBeDefined();
      expect(result.estimatedLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('TOKEN_RATIOS', () => {
    it('should have all required content type ratios', () => {
      expect(TOKEN_RATIOS[ContentType.PROSE]).toBeDefined();
      expect(TOKEN_RATIOS[ContentType.CODE]).toBeDefined();
      expect(TOKEN_RATIOS[ContentType.TABLE]).toBeDefined();
      expect(TOKEN_RATIOS[ContentType.CITATION]).toBeDefined();
    });

    it('should have reasonable ratio values', () => {
      expect(TOKEN_RATIOS[ContentType.PROSE]).toBeGreaterThan(0);
      expect(TOKEN_RATIOS[ContentType.PROSE]).toBeLessThan(5);

      expect(TOKEN_RATIOS[ContentType.CODE]).toBeGreaterThan(TOKEN_RATIOS[ContentType.PROSE]);
      expect(TOKEN_RATIOS[ContentType.TABLE]).toBeGreaterThan(0);
      expect(TOKEN_RATIOS[ContentType.CITATION]).toBeGreaterThan(0);
    });
  });
});
