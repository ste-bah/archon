/**
 * UCM Performance Tests - SPRINT 9
 *
 * Validates performance requirements from Constitution:
 * - RULE-051: Token estimation under 10ms for 10K words
 * - RULE-052: Context build under 50ms
 * - RULE-053: DESC retrieval under 100ms
 *
 * @module tests/ucm/performance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUCM,
  type UCMInstance
} from '@god-agent/core/ucm/index.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Generate sample text of specified word count
 */
function generateText(wordCount: number): string {
  const words = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
    'machine', 'learning', 'neural', 'network', 'artificial', 'intelligence',
    'algorithm', 'optimization', 'gradient', 'descent', 'backpropagation',
    'reinforcement', 'supervised', 'unsupervised', 'classification'
  ];

  const result: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    result.push(words[i % words.length]);
  }

  return result.join(' ');
}

/**
 * Generate sample code
 */
function generateCode(lines: number): string {
  const codeLines = [
    'function processData(input: string[]): number[] {',
    '  const results: number[] = [];',
    '  for (const item of input) {',
    '    const value = parseInt(item);',
    '    if (!isNaN(value)) {',
    '      results.push(value * 2);',
    '    }',
    '  }',
    '  return results;',
    '}'
  ];

  const result: string[] = [];
  for (let i = 0; i < lines; i++) {
    result.push(codeLines[i % codeLines.length]);
  }

  return result.join('\n');
}

/**
 * Measure execution time in milliseconds
 */
async function measureTime(fn: () => Promise<void> | void): Promise<number> {
  const start = performance.now();
  await fn();
  const end = performance.now();
  return end - start;
}

// ============================================================================
// Performance Tests
// ============================================================================

describe('UCM Performance Tests', () => {
  let ucm: UCMInstance;

  beforeEach(() => {
    ucm = createUCM();
  });

  // ==========================================================================
  // RULE-051: Token Estimation Performance
  // ==========================================================================

  describe('RULE-051: Token estimation under 10ms for 10K words', () => {
    it('should estimate 10K words in under 10ms', async () => {
      const text = generateText(10000);

      const duration = await measureTime(() => {
        ucm.estimateTokens(text);
      });

      expect(duration).toBeLessThan(10);
    });

    it('should estimate 1K words in under 1ms', async () => {
      const text = generateText(1000);

      const duration = await measureTime(() => {
        ucm.estimateTokens(text);
      });

      expect(duration).toBeLessThan(1);
    });

    it('should maintain performance with multiple estimations', async () => {
      const samples = Array(10).fill(null).map(() => generateText(1000));

      const duration = await measureTime(() => {
        for (const sample of samples) {
          ucm.estimateTokens(sample);
        }
      });

      const avgTime = duration / 10;
      expect(avgTime).toBeLessThan(1);
    });

    it('should estimate mixed content efficiently', async () => {
      const prose = generateText(3000);
      const code = generateCode(100);
      const mixed = `${prose}\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n${prose}`;

      const duration = await measureTime(() => {
        ucm.estimateTokens(mixed);
      });

      expect(duration).toBeLessThan(5);
    });

    it('should handle large documents (50K words)', async () => {
      const text = generateText(50000);

      const duration = await measureTime(() => {
        ucm.estimateTokens(text);
      });

      // Proportionally larger, but should remain fast
      expect(duration).toBeLessThan(50); // 5x size, allow 5x time
    });
  });

  // ==========================================================================
  // RULE-052: Context Build Performance
  // ==========================================================================

  describe('RULE-052: Context build under 50ms', () => {
    it('should build simple context in under 50ms', async () => {
      const engine = ucm.contextEngine;

      // Add some content
      engine.addToWindow('agent-1', generateText(100), 130);
      engine.addToWindow('agent-2', generateText(100), 130);
      engine.addToWindow('agent-3', generateText(100), 130);

      const duration = await measureTime(() => {
        engine.compose({
          contextWindow: 100000,
          phase: 'research'
        });
      });

      expect(duration).toBeLessThan(50);
    });

    it('should build complex context with dependencies under 50ms', async () => {
      const engine = ucm.contextEngine;

      // Add multiple agents with dependencies
      for (let i = 0; i < 10; i++) {
        engine.addToWindow(`agent-${i}`, generateText(50), 65);
      }

      // Create dependency chain
      for (let i = 1; i < 10; i++) {
        engine.addDependency(`agent-${i}`, `agent-${i - 1}`);
      }

      const duration = await measureTime(() => {
        engine.getContextForAgent('agent-9', 100000, 'analysis');
      });

      expect(duration).toBeLessThan(50);
    });

    it('should build context with pinned content under 50ms', async () => {
      const engine = ucm.contextEngine;

      // Add pinned content
      engine.pin('pin-1', generateText(200), 260);
      engine.pin('pin-2', generateText(200), 260);

      // Add active content
      for (let i = 0; i < 5; i++) {
        engine.addToWindow(`active-${i}`, generateText(100), 130);
      }

      const duration = await measureTime(() => {
        engine.compose({
          contextWindow: 100000,
          phase: 'writing',
          maxDescPrior: 2
        });
      });

      expect(duration).toBeLessThan(50);
    });

    it('should handle phase transitions efficiently', async () => {
      const engine = ucm.contextEngine;

      for (let i = 0; i < 5; i++) {
        engine.addToWindow(`agent-${i}`, generateText(100), 130);
      }

      const duration = await measureTime(() => {
        engine.setPhase('planning');
        engine.compose({ contextWindow: 100000, phase: 'planning' });

        engine.setPhase('research');
        engine.compose({ contextWindow: 100000, phase: 'research' });

        engine.setPhase('writing');
        engine.compose({ contextWindow: 100000, phase: 'writing' });
      });

      const avgTime = duration / 3;
      expect(avgTime).toBeLessThan(50);
    });

    it('should scale well with content size', async () => {
      const engine = ucm.contextEngine;

      // Add varying sizes
      engine.addToWindow('small', generateText(50), 65);
      engine.addToWindow('medium', generateText(500), 650);
      engine.addToWindow('large', generateText(2000), 2600);

      const duration = await measureTime(() => {
        engine.compose({
          contextWindow: 100000,
          phase: 'analysis'
        });
      });

      expect(duration).toBeLessThan(50);
    });
  });

  // ==========================================================================
  // RULE-053: DESC Retrieval Performance
  // ==========================================================================

  describe('RULE-053: DESC retrieval under 100ms (requires embedding service)', () => {
    it.skip('DESC retrieval tests require external embedding service', () => {
      // These tests would require a real embedding service or complex mocking
      // For now, we test chunking performance which is part of DESC
      expect(true).toBe(true);
    });

    it('should chunk query text quickly for DESC', async () => {
      const text = generateText(200);

      const duration = await measureTime(() => {
        ucm.chunker.chunk(text);
      });

      expect(duration).toBeLessThan(10);
    });
  });

  // ==========================================================================
  // Additional Performance Tests
  // ==========================================================================

  describe('symmetric chunking performance', () => {
    it('should chunk 10K words efficiently', async () => {
      const text = generateText(10000);

      const duration = await measureTime(() => {
        ucm.chunker.chunk(text);
      });

      expect(duration).toBeLessThan(50);
    });

    it('should handle code chunking efficiently', async () => {
      const code = generateCode(500);

      const duration = await measureTime(() => {
        ucm.chunker.chunk(code);
      });

      expect(duration).toBeLessThan(20);
    });
  });

  describe('compaction detection performance', () => {
    it('should detect compaction in under 1ms', async () => {
      const message = 'This session is being continued from a previous conversation';

      const duration = await measureTime(() => {
        ucm.compactionDetector.detectCompaction(message);
      });

      expect(duration).toBeLessThan(1);
    });

    it('should handle batch detection efficiently', async () => {
      const messages = Array(100).fill(
        'conversation is summarized below'
      );

      const duration = await measureTime(() => {
        for (const msg of messages) {
          ucm.compactionDetector.detectCompaction(msg);
        }
      });

      const avgTime = duration / 100;
      expect(avgTime).toBeLessThan(0.5);
    });
  });

  describe('workflow detection performance', () => {
    it('should detect workflow in under 1ms', async () => {
      const context = { phase: 'research', task: 'Literature review' };

      const duration = await measureTime(() => {
        ucm.detectWorkflow(context);
      });

      expect(duration).toBeLessThan(1);
    });

    it('should handle batch detection efficiently', async () => {
      const contexts = Array(100).fill({
        task: 'Review PR #123'
      });

      const duration = await measureTime(() => {
        for (const ctx of contexts) {
          ucm.detectWorkflow(ctx);
        }
      });

      const avgTime = duration / 100;
      expect(avgTime).toBeLessThan(0.5);
    });
  });

  // ==========================================================================
  // RULE-020: Token Estimation Accuracy
  // ==========================================================================

  describe('RULE-020: Token estimation accuracy ±5%', () => {
    it('should estimate prose within 5% accuracy', () => {
      const text = generateText(1000);
      const estimate = ucm.estimateTokens(text);

      // Expected: 1000 words * 1.3 ratio = 1300 tokens
      const expected = 1000 * 1.3;
      const margin = expected * 0.05;

      expect(estimate.tokens).toBeGreaterThanOrEqual(expected - margin);
      expect(estimate.tokens).toBeLessThanOrEqual(expected + margin);
    });

    it('should estimate code within 5% accuracy', () => {
      const code = generateCode(100);
      const estimate = ucm.estimateTokens(code);

      // Code has ~4 words per line * 100 lines = 400 words
      // 400 words * 1.5 ratio = 600 tokens
      const wordCount = estimate.wordCount;
      const expected = wordCount * 1.5;
      const margin = expected * 0.05;

      expect(estimate.tokens).toBeGreaterThanOrEqual(expected - margin);
      expect(estimate.tokens).toBeLessThanOrEqual(expected + margin);
    });

    it('should provide confidence score > 0.8', () => {
      const samples = [
        generateText(100),
        generateCode(50),
        generateText(500)
      ];

      for (const sample of samples) {
        const estimate = ucm.estimateTokens(sample);
        expect(estimate.confidence).toBeGreaterThan(0.8);
      }
    });
  });

  // ==========================================================================
  // Stress Tests
  // ==========================================================================

  describe('stress tests', () => {
    it('should handle rapid successive estimations', async () => {
      const samples = Array(1000).fill(null).map(() => generateText(100));

      const duration = await measureTime(() => {
        for (const sample of samples) {
          ucm.estimateTokens(sample);
        }
      });

      const avgTime = duration / 1000;
      expect(avgTime).toBeLessThan(0.1); // < 0.1ms per estimation
    });

    it('should handle many context builds', async () => {
      const engine = ucm.contextEngine;

      for (let i = 0; i < 20; i++) {
        engine.addToWindow(`agent-${i}`, generateText(100), 130);
      }

      const duration = await measureTime(() => {
        for (let i = 0; i < 100; i++) {
          engine.compose({
            contextWindow: 100000,
            phase: 'research'
          });
        }
      });

      const avgTime = duration / 100;
      expect(avgTime).toBeLessThan(10);
    });

    it('should maintain performance under memory pressure', async () => {
      const engine = ucm.contextEngine;

      // Fill with lots of content
      for (let i = 0; i < 50; i++) {
        engine.addToWindow(`agent-${i}`, generateText(500), 650);
      }

      // Pin content
      for (let i = 0; i < 5; i++) {
        engine.pin(`pin-${i}`, generateText(200), 260);
      }

      const duration = await measureTime(() => {
        engine.compose({
          contextWindow: 100000,
          phase: 'writing'
        });
      });

      expect(duration).toBeLessThan(50);

      // Stats should be reasonable
      const stats = engine.getStats();
      expect(stats.rollingWindow.size).toBeGreaterThan(0);
      expect(stats.pinning.pinnedCount).toBe(5);
    });
  });

  // ==========================================================================
  // Memory Efficiency Tests
  // ==========================================================================

  describe('memory efficiency', () => {
    it('should not leak memory on repeated operations', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        ucm.estimateTokens(generateText(100));
      }

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const increase = finalMemory - initialMemory;

      // Memory increase should be reasonable (< 10MB)
      expect(increase).toBeLessThan(10 * 1024 * 1024);
    });

    it('should clean up archived agents efficiently', () => {
      const engine = ucm.contextEngine;

      // Add many agents (will cause archiving)
      for (let i = 0; i < 100; i++) {
        engine.addToWindow(`agent-${i}`, generateText(100), 130);
      }

      const stats = engine.getStats();

      // Should have archived old agents
      expect(stats.archived.count).toBeGreaterThan(0);

      // Clear should free memory
      engine.clear();
      const afterClearStats = engine.getStats();

      expect(afterClearStats.archived.count).toBe(0);
      expect(afterClearStats.rollingWindow.size).toBe(0);
    });
  });
});
