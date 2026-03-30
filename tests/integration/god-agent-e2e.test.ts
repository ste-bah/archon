/**
 * God Agent End-to-End Integration Test
 *
 * Verifies the complete store → query → learn cycle works
 * TASK-VEC-001-007: Updated to use VECTOR_DIM constant
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GodAgent } from '../../src/god-agent/core/god-agent.js';
import { VECTOR_DIM } from '../../src/god-agent/core/validation/constants.js';

describe('God Agent E2E Integration', () => {
  let agent: GodAgent;

  beforeEach(async () => {
    agent = new GodAgent({
      enableObservability: true,
      verbose: false,
    });
    const result = await agent.initialize();
    if (!result.success) {
      console.error('Init failed:', result.warnings);
    }
    expect(result.success).toBe(true);
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  function createRandomEmbedding(): Float32Array {
    const embedding = new Float32Array(VECTOR_DIM);
    for (let i = 0; i < VECTOR_DIM; i++) {
      embedding[i] = (Math.random() - 0.5) * 2;
    }
    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < VECTOR_DIM; i++) {
      embedding[i] /= norm;
    }
    return embedding;
  }

  it('should complete store → query → learn cycle', async () => {
    // 1. Store knowledge
    const patterns = [
      { content: 'Machine learning model training patterns', tags: ['ml', 'training'] },
      { content: 'Neural network architecture decisions', tags: ['nn', 'architecture'] },
      { content: 'Data preprocessing best practices', tags: ['data', 'preprocessing'] },
    ];

    const storedIds: string[] = [];
    for (const pattern of patterns) {
      const embedding = createRandomEmbedding();
      const result = await agent.store(
        { content: pattern.content, embedding, metadata: pattern },
        { trackProvenance: true }
      );
      expect(result.id).toBeDefined();
      expect(result.vectorId).toBeDefined();
      storedIds.push(result.id);
    }

    expect(storedIds.length).toBe(3);

    // 2. Query knowledge
    const queryEmbedding = createRandomEmbedding();
    const queryResult = await agent.query(queryEmbedding, {
      k: 3,
      includeProvenance: true,
      applyAttention: true,
    });

    expect(queryResult.queryId).toBeDefined();
    expect(queryResult.patterns).toBeDefined();
    expect(queryResult.latencyMs).toBeGreaterThan(0);
    expect(queryResult.reasoningMode).toBeDefined();

    // 3. Provide learning feedback
    if (queryResult.patterns.length > 0) {
      await agent.learn({
        queryId: queryResult.queryId,
        patternId: queryResult.patterns[0].id,
        verdict: 'positive',
        score: 0.95,
      });
    }

    // 4. Check status
    const status = agent.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.runtime).toBeDefined();
  });

  it('should report correct status', async () => {
    const status = agent.getStatus();

    expect(status.initialized).toBe(true);
    expect(['native', 'wasm', 'javascript']).toContain(status.runtime);
    expect(status.health.vectorDB).toBe('healthy');
    expect(status.health.graphDB).toBe('healthy');
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle multiple store/query cycles', async () => {
    // Store 10 items
    for (let i = 0; i < 10; i++) {
      const embedding = createRandomEmbedding();
      await agent.store({
        content: `Pattern ${i}`,
        embedding,
        metadata: { index: i },
      });
    }

    // Query 5 times
    for (let i = 0; i < 5; i++) {
      const queryEmbedding = createRandomEmbedding();
      const result = await agent.query(queryEmbedding, { k: 5 });
      expect(result.patterns).toBeDefined();
    }

    const status = agent.getStatus();
    // Vector count is async, check health instead
    expect(status.initialized).toBe(true);
    expect(status.health.vectorDB).toBe('healthy');
  });
});
