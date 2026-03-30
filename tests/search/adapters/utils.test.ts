/**
 * Search Utility Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-SEARCH-004
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TimeoutError,
  withTimeout,
  computeContentHash,
  measureTime,
  generateResultId,
  normalizeScore,
} from '../../../src/god-agent/core/search/utils.js';

describe('search utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TimeoutError', () => {
    it('should create error with correct properties', () => {
      const error = new TimeoutError('Test timeout', 500, 'vector');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.name).toBe('TimeoutError');
      expect(error.message).toBe('Test timeout');
      expect(error.timeoutMs).toBe(500);
      expect(error.source).toBe('vector');
    });

    it('should work without source parameter', () => {
      const error = new TimeoutError('Test timeout', 400);

      expect(error.timeoutMs).toBe(400);
      expect(error.source).toBeUndefined();
    });

    it('should maintain prototype chain', () => {
      const error = new TimeoutError('Test', 100);

      expect(Object.getPrototypeOf(error)).toBe(TimeoutError.prototype);
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes before timeout', async () => {
      vi.useRealTimers();
      const promise = Promise.resolve('success');
      const result = await withTimeout(promise, 1000, 'test');

      expect(result).toBe('success');
    });

    it('should reject with TimeoutError if promise exceeds timeout', async () => {
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('delayed'), 1000);
      });

      const resultPromise = withTimeout(promise, 100, 'test');
      vi.advanceTimersByTime(150);

      // withTimeout wraps all errors (including TimeoutError) in a regular Error with context
      await expect(resultPromise).rejects.toThrow(/Operation from "test" failed or timed out/);
      await expect(resultPromise).rejects.toThrow(/timed out after 100ms/);
    });

    it('should propagate original error if promise rejects before timeout', async () => {
      vi.useRealTimers();
      const error = new Error('Original error');
      const promise = Promise.reject(error);

      await expect(withTimeout(promise, 1000)).rejects.toThrow('Original error');
    });

    it('should clear timeout on success', async () => {
      vi.useRealTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const promise = Promise.resolve('success');

      await withTimeout(promise, 1000);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error', async () => {
      vi.useRealTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const promise = Promise.reject(new Error('test'));

      await expect(withTimeout(promise, 1000)).rejects.toThrow();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('computeContentHash', () => {
    it('should return 16-character hex string', () => {
      const hash = computeContentHash('test content');

      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should produce deterministic results', () => {
      const content = 'hello world';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = computeContentHash('content1');
      const hash2 = computeContentHash('content2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = computeContentHash('');

      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should handle unicode content', () => {
      const hash = computeContentHash('Hello 世界 🌍');

      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('measureTime', () => {
    it('should return result and duration', async () => {
      vi.useRealTimers();
      const { result, durationMs } = await measureTime(async () => 'success');

      expect(result).toBe('success');
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should measure actual execution time', async () => {
      vi.useRealTimers();
      const { durationMs } = await measureTime(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'done';
      });

      expect(durationMs).toBeGreaterThanOrEqual(9);
    });

    it('should propagate errors', async () => {
      vi.useRealTimers();
      const fn = async (): Promise<string> => {
        throw new Error('test error');
      };

      await expect(measureTime(fn)).rejects.toThrow('test error');
    });
  });

  describe('generateResultId', () => {
    it('should include source in ID', () => {
      const id = generateResultId('vector', 0);

      expect(id).toContain('vector');
    });

    it('should include index in ID', () => {
      const id1 = generateResultId('vector', 0);
      const id2 = generateResultId('vector', 1);

      expect(id1).toContain('_0');
      expect(id2).toContain('_1');
    });

    it('should generate unique IDs with different indices', () => {
      const id1 = generateResultId('graph', 0);
      const id2 = generateResultId('graph', 1);

      // IDs should be different due to different index
      expect(id1).not.toBe(id2);
    });

    it('should generate unique IDs with different sources', () => {
      const id1 = generateResultId('graph', 0);
      const id2 = generateResultId('vector', 0);

      // IDs should be different due to different source
      expect(id1).not.toBe(id2);
    });
  });

  describe('normalizeScore', () => {
    it('should normalize value to [0, 1] range', () => {
      expect(normalizeScore(50, 0, 100)).toBe(0.5);
      expect(normalizeScore(0, 0, 100)).toBe(0);
      expect(normalizeScore(100, 0, 100)).toBe(1);
    });

    it('should handle negative ranges', () => {
      expect(normalizeScore(0, -100, 100)).toBe(0.5);
      expect(normalizeScore(-50, -100, 0)).toBe(0.5);
    });

    it('should clamp values outside range', () => {
      expect(normalizeScore(150, 0, 100)).toBe(1);
      expect(normalizeScore(-50, 0, 100)).toBe(0);
    });

    it('should return 0.5 when min equals max', () => {
      expect(normalizeScore(50, 50, 50)).toBe(0.5);
    });

    it('should handle cosine similarity range [-1, 1]', () => {
      // Common use case for vector similarity
      expect(normalizeScore(-1, -1, 1)).toBe(0);
      expect(normalizeScore(0, -1, 1)).toBe(0.5);
      expect(normalizeScore(1, -1, 1)).toBe(1);
    });
  });
});
