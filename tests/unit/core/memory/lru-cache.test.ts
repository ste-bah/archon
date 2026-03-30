/**
 * LRU Cache Unit Tests
 * Tests O(1) operations, eviction order, capacity limits, and memory pressure handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../../../../src/god-agent/core/memory/lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string, string>;

  beforeEach(() => {
    cache = new LRUCache<string, string>(3); // Small capacity for testing
  });

  describe('Basic Operations (O(1))', () => {
    it('should set and get values correctly', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should update existing values', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
      expect(cache.size()).toBe(1);
    });

    it('should delete values correctly', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeNull();
      expect(cache.size()).toBe(0);
    });

    it('should return false when deleting non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('key1')).toBeNull();
    });

    it('should track size correctly', () => {
      expect(cache.size()).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
    });

    it('should check key existence with has()', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });
  });

  describe('LRU Eviction Order', () => {
    it('should evict least recently used item when capacity exceeded', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should evict key1

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should update LRU order on get()', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.get('key1'); // Move key1 to front
      cache.set('key4', 'value4'); // Should evict key2 (oldest)

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should update LRU order on set() for existing keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.set('key1', 'value1-updated'); // Move key1 to front
      cache.set('key4', 'value4'); // Should evict key2

      expect(cache.get('key1')).toBe('value1-updated');
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });
  });

  describe('Capacity Limits', () => {
    it('should respect default capacity of 1000', () => {
      const largeCache = new LRUCache<number, string>();

      for (let i = 0; i < 1500; i++) {
        largeCache.set(i, `value${i}`);
      }

      expect(largeCache.size()).toBe(1000);

      // First 500 should be evicted
      expect(largeCache.get(0)).toBeNull();
      expect(largeCache.get(499)).toBeNull();

      // Last 1000 should exist
      expect(largeCache.get(500)).toBe('value500');
      expect(largeCache.get(1499)).toBe('value1499');
    });

    it('should respect custom capacity', () => {
      const smallCache = new LRUCache<string, string>(5);

      for (let i = 0; i < 10; i++) {
        smallCache.set(`key${i}`, `value${i}`);
      }

      expect(smallCache.size()).toBe(5);
      expect(smallCache.get('key0')).toBeNull();
      expect(smallCache.get('key5')).toBe('value5');
    });
  });

  describe('Memory Pressure Eviction', () => {
    it('should evict 50% of entries during memory pressure', () => {
      const testCache = new LRUCache<string, string>(100);

      // Fill cache
      for (let i = 0; i < 100; i++) {
        testCache.set(`key${i}`, `value${i}`);
      }

      expect(testCache.size()).toBe(100);

      // Simulate memory pressure by directly calling private method
      // In real scenario, this is triggered by checkMemoryPressure()
      (testCache as any).evictBatch(50);

      expect(testCache.size()).toBe(50);

      // First 50 entries should be evicted (LRU order)
      expect(testCache.get('key0')).toBeNull();
      expect(testCache.get('key49')).toBeNull();

      // Last 50 should remain
      expect(testCache.get('key50')).toBe('value50');
      expect(testCache.get('key99')).toBe('value99');
    });

    it('should handle batch eviction correctly', () => {
      const testCache = new LRUCache<string, string>(10);

      for (let i = 0; i < 10; i++) {
        testCache.set(`key${i}`, `value${i}`);
      }

      (testCache as any).evictBatch(7);

      expect(testCache.size()).toBe(3);
      expect(testCache.get('key7')).toBe('value7');
      expect(testCache.get('key8')).toBe('value8');
      expect(testCache.get('key9')).toBe('value9');
    });

    it('should not crash when evicting more than cache size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      (cache as any).evictBatch(100);

      expect(cache.size()).toBe(0);
    });
  });

  describe('Cache Hit/Miss Scenarios', () => {
    it('should handle cache hits efficiently', () => {
      cache.set('hit', 'value');

      // Multiple hits should work
      for (let i = 0; i < 100; i++) {
        expect(cache.get('hit')).toBe('value');
      }
    });

    it('should handle cache misses efficiently', () => {
      // Multiple misses should work
      for (let i = 0; i < 100; i++) {
        expect(cache.get(`miss${i}`)).toBeNull();
      }
    });

    it('should handle mixed hit/miss patterns', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.get('key1')).toBe('value1'); // hit
      expect(cache.get('miss')).toBeNull(); // miss
      expect(cache.get('key2')).toBe('value2'); // hit
      expect(cache.get('miss2')).toBeNull(); // miss
    });
  });

  describe('Statistics', () => {
    it('should return accurate cache statistics', () => {
      const testCache = new LRUCache<string, string>(100);

      for (let i = 0; i < 50; i++) {
        testCache.set(`key${i}`, `value${i}`);
      }

      const stats = testCache.getStats();
      expect(stats.size).toBe(50);
      expect(stats.capacity).toBe(100);
      expect(stats.utilizationPercent).toBe(50);
    });

    it('should show 100% utilization when full', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const stats = cache.getStats();
      expect(stats.utilizationPercent).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single item capacity', () => {
      const tinyCache = new LRUCache<string, string>(1);

      tinyCache.set('key1', 'value1');
      expect(tinyCache.get('key1')).toBe('value1');

      tinyCache.set('key2', 'value2');
      expect(tinyCache.get('key1')).toBeNull();
      expect(tinyCache.get('key2')).toBe('value2');
    });

    it('should handle complex object values', () => {
      const objCache = new LRUCache<string, { data: string; count: number }>();

      const value = { data: 'test', count: 42 };
      objCache.set('key', value);

      const retrieved = objCache.get('key');
      expect(retrieved).toEqual(value);
      expect(retrieved?.count).toBe(42);
    });

    it('should maintain correct pointers after multiple operations', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.delete('b');
      cache.set('d', '4'); // Should not evict anything

      expect(cache.size()).toBe(3);
      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBeNull();
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });
  });
});
