/**
 * Pattern Source Adapter Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PatternSourceAdapter } from '../../../src/god-agent/core/search/adapters/pattern-adapter.js';
import type { ReasoningBank } from '../../../src/god-agent/core/reasoning/reasoning-bank.js';
import type { IReasoningResponse, IPatternMatch } from '../../../src/god-agent/core/reasoning/reasoning-types.js';
import { ReasoningMode } from '../../../src/god-agent/core/reasoning/reasoning-types.js';

describe('PatternSourceAdapter', () => {
  let mockReasoningBank: ReasoningBank;
  let adapter: PatternSourceAdapter;

  const mockPatterns: IPatternMatch[] = [
    {
      patternId: 'pat1',
      confidence: 0.85,
      template: 'Pattern template 1',
      taskType: 'coding',
      lScore: 0.7,
    },
    {
      patternId: 'pat2',
      confidence: 0.65,
      template: 'Pattern template 2',
      taskType: 'analysis',
      lScore: 0.5,
    },
  ];

  const mockResponse: IReasoningResponse = {
    query: new Float32Array(1536).fill(0.1),
    type: ReasoningMode.PATTERN_MATCH,
    patterns: mockPatterns,
    causalInferences: [],
    trajectoryId: 'traj_123',
    confidence: 0.85,
    processingTimeMs: 25,
    provenanceInfo: {
      sourcePatterns: [],
      causalChain: [],
      aggregatedLScore: 0.7,
      reliability: 0.8,
    },
  };

  beforeEach(() => {
    mockReasoningBank = {
      reason: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn(),
      provideFeedback: vi.fn(),
      setSonaEngine: vi.fn(),
    } as unknown as ReasoningBank;

    adapter = new PatternSourceAdapter(mockReasoningBank);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('search with Float32Array query', () => {
    it('should return success with patterns when search succeeds', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(2);
        expect(result.results[0].source).toBe('pattern');
        expect(result.results[0].content).toBe('Pattern template 1');
        expect(result.results[0].score).toBe(0.85);
      }
    });

    it('should filter patterns by minConfidence', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.7, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(1);
        expect(result.results[0].score).toBeGreaterThanOrEqual(0.7);
      }
    });

    it('should include pattern metadata in results', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results[0].metadata).toMatchObject({
          patternId: 'pat1',
          taskType: 'coding',
          lScore: 0.7,
        });
      }
    });

    it('should pass correct parameters to reasoningBank', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue({
        ...mockResponse,
        patterns: [],
      });
      const embedding = new Float32Array(1536).fill(0.1);

      await adapter.search(embedding, 0.6, 400);

      expect(mockReasoningBank.reason).toHaveBeenCalledWith(
        expect.objectContaining({
          query: embedding,
          type: ReasoningMode.PATTERN_MATCH,
          maxResults: 20,
          confidenceThreshold: 0.6,
          minLScore: 0.3,
          enhanceWithGNN: false,
          applyLearning: true,
        })
      );
    });
  });

  describe('search with string query', () => {
    it('should convert string to embedding', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);

      const result = await adapter.search('test query', 0.5, 400);

      expect(result.status).toBe('success');
      expect(mockReasoningBank.reason).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Float32Array),
        })
      );

      const call = vi.mocked(mockReasoningBank.reason).mock.calls[0][0];
      expect(call.query).toHaveLength(1536);
    });

    it('should produce consistent embeddings for same text', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);

      await adapter.search('consistent query', 0.5, 400);
      const call1 = vi.mocked(mockReasoningBank.reason).mock.calls[0][0];

      await adapter.search('consistent query', 0.5, 400);
      const call2 = vi.mocked(mockReasoningBank.reason).mock.calls[1][0];

      // Same text should produce same embedding
      for (let i = 0; i < 1536; i++) {
        expect(call1.query[i]).toBe(call2.query[i]);
      }
    });

    it('should L2 normalize generated embeddings', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);

      await adapter.search('normalize test', 0.5, 400);

      const call = vi.mocked(mockReasoningBank.reason).mock.calls[0][0];
      const embedding = call.query;

      // Calculate L2 norm
      let norm = 0;
      for (let i = 0; i < 1536; i++) {
        norm += embedding[i] * embedding[i];
      }
      norm = Math.sqrt(norm);

      // Norm should be close to 1 (within floating point tolerance)
      expect(Math.abs(norm - 1)).toBeLessThan(0.001);
    });
  });

  describe('edge cases', () => {
    it('should return empty results for empty string query', async () => {
      const result = await adapter.search('', 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
      expect(mockReasoningBank.reason).not.toHaveBeenCalled();
    });

    it('should return empty results for whitespace query', async () => {
      const result = await adapter.search('   ', 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should handle "not initialized" error gracefully', async () => {
      vi.mocked(mockReasoningBank.reason).mockRejectedValue(
        new Error('ReasoningBank not initialized')
      );
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should return error for other exceptions', async () => {
      vi.mocked(mockReasoningBank.reason).mockRejectedValue(
        new Error('Unexpected error')
      );
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Unexpected error');
      }
    });

    it('should handle empty patterns array', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue({
        ...mockResponse,
        patterns: [],
      });
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results).toHaveLength(0);
      }
    });

    it('should track duration accurately', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should generate unique result IDs', async () => {
      vi.mocked(mockReasoningBank.reason).mockResolvedValue(mockResponse);
      const embedding = new Float32Array(1536).fill(0.1);

      const result = await adapter.search(embedding, 0.5, 400);

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        const ids = result.results.map((r) => r.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }
    });
  });
});
