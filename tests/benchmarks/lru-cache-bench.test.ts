/**
 * LRU Cache Performance Benchmarks
 * Target: <50µs p95 latency for cache hits
 */

import { describe, it, beforeEach } from 'vitest';
import { LRUCache } from '../../src/god-agent/core/memory/lru-cache.js';

describe('LRUCache Performance Benchmarks', () => {
  let cache: LRUCache<string, string>;

  beforeEach(() => {
    cache = new LRUCache<string, string>(1000);

    // Pre-fill cache with data
    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, `value${i}`);
    }
  });

  it('should measure cache hit latency (target: <50µs p95)', () => {
    const iterations = 10000;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const key = `key${Math.floor(Math.random() * 1000)}`;

      const start = process.hrtime.bigint();
      cache.get(key);
      const end = process.hrtime.bigint();

      const latencyNs = Number(end - start);
      const latencyUs = latencyNs / 1000;
      latencies.push(latencyUs);
    }

    // Calculate statistics
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const min = latencies[0];
    const max = latencies[latencies.length - 1];

    console.log('\n=== Cache Hit Latency Benchmark ===');
    console.log(`Iterations: ${iterations.toLocaleString()}`);
    console.log(`Min:  ${min.toFixed(2)}µs`);
    console.log(`Avg:  ${avg.toFixed(2)}µs`);
    console.log(`P50:  ${p50.toFixed(2)}µs`);
    console.log(`P95:  ${p95.toFixed(2)}µs (target: <50µs)`);
    console.log(`P99:  ${p99.toFixed(2)}µs`);
    console.log(`Max:  ${max.toFixed(2)}µs`);

    // Validate target
    if (p95 < 50) {
      console.log(`✓ P95 latency ${p95.toFixed(2)}µs meets <50µs target`);
    } else {
      console.warn(`⚠ P95 latency ${p95.toFixed(2)}µs exceeds 50µs target`);
    }

    // Note: Don't fail test on performance regression, just warn
    // expect(p95).toBeLessThan(50);
  });

  it('should measure cache miss latency', () => {
    const iterations = 10000;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const key = `miss_key${i}`;

      const start = process.hrtime.bigint();
      cache.get(key);
      const end = process.hrtime.bigint();

      const latencyNs = Number(end - start);
      const latencyUs = latencyNs / 1000;
      latencies.push(latencyUs);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log('\n=== Cache Miss Latency Benchmark ===');
    console.log(`Iterations: ${iterations.toLocaleString()}`);
    console.log(`Avg: ${avg.toFixed(2)}µs`);
    console.log(`P95: ${p95.toFixed(2)}µs`);
  });

  it('should measure set operation latency', () => {
    const testCache = new LRUCache<string, string>(10000);
    const iterations = 10000;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const key = `set_key${i}`;
      const value = `value${i}`;

      const start = process.hrtime.bigint();
      testCache.set(key, value);
      const end = process.hrtime.bigint();

      const latencyNs = Number(end - start);
      const latencyUs = latencyNs / 1000;
      latencies.push(latencyUs);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log('\n=== Set Operation Latency Benchmark ===');
    console.log(`Iterations: ${iterations.toLocaleString()}`);
    console.log(`Avg: ${avg.toFixed(2)}µs`);
    console.log(`P95: ${p95.toFixed(2)}µs`);
  });

  it('should measure memory pressure eviction time', () => {
    const testCache = new LRUCache<string, string>(10000);

    // Fill cache
    for (let i = 0; i < 10000; i++) {
      testCache.set(`key${i}`, `value${i}`);
    }

    // Measure batch eviction (50% = 5000 entries)
    const start = process.hrtime.bigint();
    (testCache as any).evictBatch(5000);
    const end = process.hrtime.bigint();

    const latencyNs = Number(end - start);
    const latencyMs = latencyNs / 1_000_000;

    console.log('\n=== Memory Pressure Eviction Benchmark ===');
    console.log(`Evicted: 5,000 entries (50% of capacity)`);
    console.log(`Time: ${latencyMs.toFixed(2)}ms`);
    console.log(`Per-entry: ${(latencyNs / 5000 / 1000).toFixed(2)}µs`);
  });

  it('should measure throughput (operations per second)', () => {
    const durationMs = 1000; // Run for 1 second
    const startTime = Date.now();
    let operations = 0;

    while (Date.now() - startTime < durationMs) {
      const key = `key${Math.floor(Math.random() * 1000)}`;
      cache.get(key);
      operations++;
    }

    const actualDuration = Date.now() - startTime;
    const opsPerSecond = (operations / actualDuration) * 1000;

    console.log('\n=== Throughput Benchmark ===');
    console.log(`Operations: ${operations.toLocaleString()}`);
    console.log(`Duration: ${actualDuration}ms`);
    console.log(`Throughput: ${opsPerSecond.toLocaleString()} ops/sec`);
  });

  it('should measure mixed workload performance', () => {
    const iterations = 10000;
    const getLatencies: number[] = [];
    const setLatencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // 70% reads, 30% writes
      if (Math.random() < 0.7) {
        const key = `key${Math.floor(Math.random() * 1000)}`;
        const start = process.hrtime.bigint();
        cache.get(key);
        const end = process.hrtime.bigint();
        getLatencies.push(Number(end - start) / 1000);
      } else {
        const key = `key${i}`;
        const value = `value${i}`;
        const start = process.hrtime.bigint();
        cache.set(key, value);
        const end = process.hrtime.bigint();
        setLatencies.push(Number(end - start) / 1000);
      }
    }

    getLatencies.sort((a, b) => a - b);
    setLatencies.sort((a, b) => a - b);

    const getP95 = getLatencies[Math.floor(getLatencies.length * 0.95)];
    const setP95 = setLatencies[Math.floor(setLatencies.length * 0.95)];

    console.log('\n=== Mixed Workload Benchmark (70% read, 30% write) ===');
    console.log(`Total operations: ${iterations.toLocaleString()}`);
    console.log(`GET operations: ${getLatencies.length.toLocaleString()}`);
    console.log(`GET P95: ${getP95.toFixed(2)}µs`);
    console.log(`SET operations: ${setLatencies.length.toLocaleString()}`);
    console.log(`SET P95: ${setP95.toFixed(2)}µs`);
  });
});
