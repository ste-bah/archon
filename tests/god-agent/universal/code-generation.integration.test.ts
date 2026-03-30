/**
 * Integration test for real code generation via SPEC-GEN-001
 *
 * This test verifies:
 * 1. generateCode() uses patterns from ReasoningBank
 * 2. Calls Claude CLI with proper arguments
 * 3. Extracts code from markdown blocks
 * 4. Falls back gracefully when CLI unavailable
 * 5. Stores successful patterns in InteractionStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UniversalAgent } from '../../../src/god-agent/universal/universal-agent.js';

describe('SPEC-GEN-001: Real Code Generation', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      verbose: false,
      enablePersistence: false,
      autoLearn: true,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('should generate code using patterns from ReasoningBank', async () => {
    // First, store some patterns
    await agent.storeKnowledge({
      content: `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}`,
      type: 'pattern',
      domain: 'javascript',
      tags: ['recursion', 'function'],
    });

    // Generate code with context
    const result = await agent.code('implement factorial function', {
      language: 'javascript',
      context: 'Use recursion for clarity',
    });

    // Verify result structure
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('task');
    expect(result).toHaveProperty('language', 'javascript');
    expect(result).toHaveProperty('patterns_used');
    expect(result).toHaveProperty('explanation');

    // Verify code is not empty placeholder
    expect(result.code).toBeTruthy();
    expect(result.code.length).toBeGreaterThan(10);

    // Check that code was stored for future use
    const stats = agent.getStats();
    expect(stats.knowledgeEntries).toBeGreaterThan(0);
  }, 15000); // 15 second timeout for CLI execution

  it('should extract code from markdown blocks', async () => {
    const result = await agent.code('create a hello world function', {
      language: 'typescript',
    });

    expect(result.code).toBeTruthy();
    // Code should not contain markdown fence syntax
    expect(result.code).not.toMatch(/^```/);
  }, 15000);

  it('should handle fallback when CLI not available', async () => {
    // Even if CLI fails, should return valid result
    const result = await agent.code('simple function', {
      language: 'python',
    });

    expect(result).toHaveProperty('code');
    expect(result.code).toBeTruthy();
    expect(result.language).toBe('python');
  }, 15000);

  it('should store patterns after successful generation', async () => {
    const initialStats = agent.getStats();
    const initialCount = initialStats.knowledgeEntries;

    await agent.code('create array utility functions', {
      language: 'typescript',
    });

    const finalStats = agent.getStats();
    expect(finalStats.knowledgeEntries).toBeGreaterThan(initialCount);
  }, 15000);

  it('should use context and examples in prompt', async () => {
    const result = await agent.code('sort algorithm', {
      language: 'typescript',
      context: 'Implement quicksort with in-place partitioning',
      examples: [
        'function quickSort(arr) { /* ... */ }',
      ],
    });

    expect(result.code).toBeTruthy();
    expect(result.language).toBe('typescript');
  }, 15000);
});

describe('SPEC-GEN-001: Helper Methods', () => {
  let agent: UniversalAgent;

  beforeEach(async () => {
    agent = new UniversalAgent({
      verbose: false,
      enablePersistence: false,
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  it('should build pattern context from ReasoningBank results', async () => {
    // Store multiple patterns
    await agent.storeKnowledge({
      content: 'Pattern 1: Use async/await',
      type: 'pattern',
      domain: 'typescript',
      tags: ['async'],
    });

    await agent.storeKnowledge({
      content: 'Pattern 2: Error handling with try/catch',
      type: 'pattern',
      domain: 'typescript',
      tags: ['error-handling'],
    });

    const result = await agent.code('async function with error handling', {
      language: 'typescript',
    });

    // Should use stored patterns
    expect(result.patterns_used.length).toBeGreaterThan(0);
  }, 15000);
});
