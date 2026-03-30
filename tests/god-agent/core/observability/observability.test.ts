/**
 * Observability Stack Tests
 * TASK-OBS-001 - Metrics, Logging, and Tracing
 *
 * Tests for:
 * - Prometheus-style metrics (Counter, Gauge, Histogram, Summary)
 * - Structured logging with JSON output
 * - Distributed tracing with span hierarchy
 * - Instrumentation decorators
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  // Metrics
  MetricType,
  Counter,
  Gauge,
  Histogram,
  Summary,
  MetricsCollector,
  metricsCollector,
  METRICS,
  // Logging
  LogLevel,
  LogLevelNames,
  parseLogLevel,
  StructuredLogger,
  ConsoleLogHandler,
  MemoryLogHandler,
  SilentLogHandler,
  createComponentLogger,
  generateRequestId,
  generateCorrelationId,
  // Tracing
  SpanStatus,
  SpanBuilder,
  DistributedTracer,
  tracer,
  withTrace,
  withTraceSync,
  serializeSpanContext,
  deserializeSpanContext,
} from '../../../../src/god-agent/core/observability/index.js';

// ==================== Counter Tests ====================

describe('Counter', () => {
  let counter: Counter;

  beforeEach(() => {
    counter = new Counter('test_counter', 'Test counter', ['label1']);
  });

  it('should start at 0', () => {
    expect(counter.get()).toBe(0);
  });

  it('should increment by 1 by default', () => {
    counter.inc();
    expect(counter.get()).toBe(1);
  });

  it('should increment by specified amount', () => {
    counter.inc(undefined, 5);
    expect(counter.get()).toBe(5);
  });

  it('should track separate values by labels', () => {
    counter.inc({ label1: 'a' });
    counter.inc({ label1: 'a' });
    counter.inc({ label1: 'b' });

    expect(counter.get({ label1: 'a' })).toBe(2);
    expect(counter.get({ label1: 'b' })).toBe(1);
  });

  it('should throw on negative increment', () => {
    expect(() => counter.inc(undefined, -1)).toThrow();
  });

  it('should export in Prometheus format', () => {
    counter.inc({ label1: 'test' }, 5);
    const output = counter.export();

    expect(output).toContain('# HELP test_counter Test counter');
    expect(output).toContain('# TYPE test_counter counter');
    expect(output).toContain('test_counter{label1="test"} 5');
  });

  it('should reset values', () => {
    counter.inc(undefined, 10);
    expect(counter.get()).toBe(10);

    counter.reset();
    expect(counter.get()).toBe(0);
  });
});

// ==================== Gauge Tests ====================

describe('Gauge', () => {
  let gauge: Gauge;

  beforeEach(() => {
    gauge = new Gauge('test_gauge', 'Test gauge', ['env']);
  });

  it('should start at 0', () => {
    expect(gauge.get()).toBe(0);
  });

  it('should set value', () => {
    gauge.set(42);
    expect(gauge.get()).toBe(42);
  });

  it('should increment', () => {
    gauge.set(10);
    gauge.inc();
    expect(gauge.get()).toBe(11);
  });

  it('should decrement', () => {
    gauge.set(10);
    gauge.dec();
    expect(gauge.get()).toBe(9);
  });

  it('should increment/decrement by amount', () => {
    gauge.set(10);
    gauge.inc(undefined, 5);
    expect(gauge.get()).toBe(15);

    gauge.dec(undefined, 3);
    expect(gauge.get()).toBe(12);
  });

  it('should track separate values by labels', () => {
    gauge.set(100, { env: 'prod' });
    gauge.set(50, { env: 'dev' });

    expect(gauge.get({ env: 'prod' })).toBe(100);
    expect(gauge.get({ env: 'dev' })).toBe(50);
  });

  it('should export in Prometheus format', () => {
    gauge.set(42, { env: 'test' });
    const output = gauge.export();

    expect(output).toContain('# HELP test_gauge Test gauge');
    expect(output).toContain('# TYPE test_gauge gauge');
    expect(output).toContain('test_gauge{env="test"} 42');
  });
});

// ==================== Histogram Tests ====================

describe('Histogram', () => {
  let histogram: Histogram;

  beforeEach(() => {
    histogram = new Histogram(
      'test_histogram',
      'Test histogram',
      ['method'],
      [0.01, 0.05, 0.1, 0.5, 1]
    );
  });

  it('should observe values', () => {
    histogram.observe(0.05);
    histogram.observe(0.1);
    histogram.observe(0.2);

    expect(histogram.getCount()).toBe(3);
    expect(histogram.getSum()).toBeCloseTo(0.35, 5);
  });

  it('should calculate mean', () => {
    histogram.observe(0.1);
    histogram.observe(0.2);
    histogram.observe(0.3);

    expect(histogram.getMean()).toBeCloseTo(0.2, 5);
  });

  it('should calculate percentiles', () => {
    // Add 100 values from 0.01 to 1.0
    for (let i = 1; i <= 100; i++) {
      histogram.observe(i / 100);
    }

    const percentiles = histogram.getPercentiles();
    expect(percentiles.p50).toBeCloseTo(0.5, 1);
    expect(percentiles.p90).toBeCloseTo(0.9, 1);
    expect(percentiles.p95).toBeCloseTo(0.95, 1);
    expect(percentiles.p99).toBeCloseTo(0.99, 1);
  });

  it('should track separate values by labels', () => {
    histogram.observe(0.1, { method: 'GET' });
    histogram.observe(0.2, { method: 'GET' });
    histogram.observe(0.5, { method: 'POST' });

    expect(histogram.getCount({ method: 'GET' })).toBe(2);
    expect(histogram.getCount({ method: 'POST' })).toBe(1);
  });

  it('should export in Prometheus format with buckets', () => {
    histogram.observe(0.05, { method: 'GET' });
    const output = histogram.export();

    expect(output).toContain('# HELP test_histogram Test histogram');
    expect(output).toContain('# TYPE test_histogram histogram');
    expect(output).toContain('test_histogram_bucket');
    expect(output).toContain('le="+Inf"');
    expect(output).toContain('test_histogram_sum');
    expect(output).toContain('test_histogram_count');
  });

  it('should return zero percentiles for empty histogram', () => {
    const percentiles = histogram.getPercentiles();
    expect(percentiles.p50).toBe(0);
    expect(percentiles.p90).toBe(0);
    expect(percentiles.p95).toBe(0);
    expect(percentiles.p99).toBe(0);
  });
});

// ==================== Summary Tests ====================

describe('Summary', () => {
  let summary: Summary;

  beforeEach(() => {
    summary = new Summary('test_summary', 'Test summary', ['route']);
  });

  it('should observe values', () => {
    summary.observe(0.1);
    summary.observe(0.2);
    summary.observe(0.3);

    expect(summary.getCount()).toBe(3);
    expect(summary.getSum()).toBeCloseTo(0.6, 5);
  });

  it('should calculate quantiles', () => {
    for (let i = 1; i <= 100; i++) {
      summary.observe(i);
    }

    expect(summary.getQuantile(0.5)).toBeCloseTo(50, 0);
    expect(summary.getQuantile(0.9)).toBeCloseTo(90, 0);
  });

  it('should track by labels', () => {
    summary.observe(0.1, { route: '/api' });
    summary.observe(0.2, { route: '/api' });
    summary.observe(0.5, { route: '/health' });

    expect(summary.getCount({ route: '/api' })).toBe(2);
    expect(summary.getCount({ route: '/health' })).toBe(1);
  });

  it('should export in Prometheus format', () => {
    summary.observe(0.1);
    const output = summary.export();

    expect(output).toContain('# HELP test_summary Test summary');
    expect(output).toContain('# TYPE test_summary summary');
    expect(output).toContain('quantile="0.5"');
    expect(output).toContain('quantile="0.99"');
    expect(output).toContain('test_summary_sum');
    expect(output).toContain('test_summary_count');
  });
});

// ==================== MetricsCollector Tests ====================

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it('should create and retrieve counter', () => {
    const counter = collector.createCounter('my_counter', 'My counter');
    expect(collector.get('my_counter')).toBe(counter);
  });

  it('should create and retrieve gauge', () => {
    const gauge = collector.createGauge('my_gauge', 'My gauge');
    expect(collector.get('my_gauge')).toBe(gauge);
  });

  it('should create and retrieve histogram', () => {
    const histogram = collector.createHistogram('my_histogram', 'My histogram');
    expect(collector.get('my_histogram')).toBe(histogram);
  });

  it('should create and retrieve summary', () => {
    const summary = collector.createSummary('my_summary', 'My summary');
    expect(collector.get('my_summary')).toBe(summary);
  });

  it('should return existing metric if already created', () => {
    const counter1 = collector.createCounter('dup_counter', 'Counter');
    const counter2 = collector.createCounter('dup_counter', 'Counter');
    expect(counter1).toBe(counter2);
  });

  it('should list all metric names', () => {
    collector.createCounter('counter1', 'C1');
    collector.createGauge('gauge1', 'G1');
    collector.createHistogram('histogram1', 'H1');

    const names = collector.list();
    expect(names).toContain('counter1');
    expect(names).toContain('gauge1');
    expect(names).toContain('histogram1');
  });

  it('should export all metrics in Prometheus format', () => {
    collector.createCounter('requests', 'Request count');
    collector.createGauge('connections', 'Connection count');

    const output = collector.export();
    expect(output).toContain('# HELP requests');
    expect(output).toContain('# HELP connections');
  });

  it('should check if metric exists', () => {
    collector.createCounter('exists', 'Exists');

    expect(collector.has('exists')).toBe(true);
    expect(collector.has('not_exists')).toBe(false);
  });

  it('should remove metrics', () => {
    collector.createCounter('to_remove', 'Remove me');
    expect(collector.has('to_remove')).toBe(true);

    collector.remove('to_remove');
    expect(collector.has('to_remove')).toBe(false);
  });

  it('should clear all metrics', () => {
    collector.createCounter('c1', 'C1');
    collector.createGauge('g1', 'G1');
    expect(collector.size()).toBe(2);

    collector.clear();
    expect(collector.size()).toBe(0);
  });
});

// ==================== Predefined Metrics Tests ====================

describe('Predefined Metrics (METRICS)', () => {
  it('should have vectordb metrics defined', () => {
    expect(METRICS.vectordbSearchLatency).toBeDefined();
    expect(METRICS.vectordbSearchCount).toBeDefined();
  });

  it('should have memory cache metrics defined', () => {
    expect(METRICS.memoryCacheHit).toBeDefined();
    expect(METRICS.memoryCacheMiss).toBeDefined();
    expect(METRICS.memoryCacheSize).toBeDefined();
  });

  it('should have compression metrics defined', () => {
    expect(METRICS.compressionTierCount).toBeDefined();
    expect(METRICS.compressionRatio).toBeDefined();
    expect(METRICS.compressionLatency).toBeDefined();
  });

  it('should have orchestration metrics defined', () => {
    expect(METRICS.agentCompletionRate).toBeDefined();
    expect(METRICS.agentExecutionTime).toBeDefined();
    expect(METRICS.pipelineExecutionCount).toBeDefined();
  });

  it('should have attention metrics defined', () => {
    expect(METRICS.attentionSelectionTime).toBeDefined();
    expect(METRICS.attentionForwardTime).toBeDefined();
  });
});

// ==================== Logger Tests ====================

describe('StructuredLogger', () => {
  let handler: MemoryLogHandler;
  let testLogger: StructuredLogger;

  beforeEach(() => {
    handler = new MemoryLogHandler();
    testLogger = new StructuredLogger({
      minLevel: LogLevel.DEBUG,
      handlers: [handler],
    });
  });

  it('should log at different levels', () => {
    testLogger.debug('Debug message');
    testLogger.info('Info message');
    testLogger.warn('Warn message');
    testLogger.error('Error message');

    const entries = handler.getEntries();
    expect(entries.length).toBe(4);
    expect(entries[0].level).toBe('DEBUG');
    expect(entries[1].level).toBe('INFO');
    expect(entries[2].level).toBe('WARN');
    expect(entries[3].level).toBe('ERROR');
  });

  it('should filter by minimum level', () => {
    testLogger.setLevel(LogLevel.WARN);

    testLogger.debug('Debug message');
    testLogger.info('Info message');
    testLogger.warn('Warn message');
    testLogger.error('Error message');

    const entries = handler.getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].level).toBe('WARN');
    expect(entries[1].level).toBe('ERROR');
  });

  it('should include context in log entries', () => {
    testLogger.info('Test message', { component: 'test', operation: 'run' });

    const entry = handler.getEntries()[0];
    expect(entry.context.component).toBe('test');
    expect(entry.context.operation).toBe('run');
  });

  it('should include error details in error logs', () => {
    const error = new Error('Test error');
    testLogger.error('Something failed', error);

    const entry = handler.getEntries()[0];
    expect(entry.context.error_message).toBe('Test error');
    expect(entry.context.error_name).toBe('Error');
    expect(entry.context.error_stack).toBeDefined();
  });

  it('should create child logger with inherited context', () => {
    const parent = new StructuredLogger({
      context: { service: 'main' },
      handlers: [handler],
    });

    const child = parent.child({ component: 'sub' });
    child.info('Child log');

    const entry = handler.getEntries()[0];
    expect(entry.context.service).toBe('main');
    expect(entry.context.component).toBe('sub');
  });

  it('should output valid JSON', () => {
    testLogger.info('Test message', { key: 'value' });

    const entry = handler.getEntries()[0];
    expect(() => JSON.stringify(entry)).not.toThrow();
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should time async operations', async () => {
    const result = await testLogger.time('test_operation', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'done';
    });

    expect(result).toBe('done');
    const entry = handler.getEntries()[0];
    expect(entry.context.operation).toBe('test_operation');
    expect(entry.context.duration_ms).toBeGreaterThan(0);
    expect(entry.context.status).toBe('success');
  });

  it('should log errors from timed operations', async () => {
    await expect(
      testLogger.time('failing_operation', async () => {
        throw new Error('Test failure');
      })
    ).rejects.toThrow('Test failure');

    const entry = handler.getEntries()[0];
    expect(entry.level).toBe('ERROR');
    expect(entry.context.status).toBe('error');
  });
});

describe('Log Level Parsing', () => {
  it('should parse log level names', () => {
    expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG);
    expect(parseLogLevel('INFO')).toBe(LogLevel.INFO);
    expect(parseLogLevel('WARN')).toBe(LogLevel.WARN);
    expect(parseLogLevel('WARNING')).toBe(LogLevel.WARN);
    expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR);
    expect(parseLogLevel('FATAL')).toBe(LogLevel.FATAL);
    expect(parseLogLevel('CRITICAL')).toBe(LogLevel.FATAL);
  });

  it('should be case insensitive', () => {
    expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG);
    expect(parseLogLevel('Info')).toBe(LogLevel.INFO);
  });

  it('should default to INFO for unknown levels', () => {
    expect(parseLogLevel('unknown')).toBe(LogLevel.INFO);
  });
});

describe('Log Handlers', () => {
  it('should use console handler', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = new ConsoleLogHandler();

    handler.write({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: 'Test',
      context: {},
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should use memory handler with max entries', () => {
    const handler = new MemoryLogHandler({ maxEntries: 3 });

    for (let i = 0; i < 5; i++) {
      handler.write({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `Message ${i}`,
        context: {},
      });
    }

    expect(handler.getEntries().length).toBe(3);
    expect(handler.getEntries()[0].message).toBe('Message 2');
  });

  it('should filter entries by level in memory handler', () => {
    const handler = new MemoryLogHandler();

    handler.write({ timestamp: '', level: 'INFO', message: 'Info', context: {} });
    handler.write({ timestamp: '', level: 'ERROR', message: 'Error', context: {} });
    handler.write({ timestamp: '', level: 'INFO', message: 'Info 2', context: {} });

    expect(handler.getEntriesByLevel('INFO').length).toBe(2);
    expect(handler.getEntriesByLevel('ERROR').length).toBe(1);
  });

  it('should filter entries by component in memory handler', () => {
    const handler = new MemoryLogHandler();

    handler.write({ timestamp: '', level: 'INFO', message: 'A', context: { component: 'A' } });
    handler.write({ timestamp: '', level: 'INFO', message: 'B', context: { component: 'B' } });

    expect(handler.getEntriesByComponent('A').length).toBe(1);
  });
});

describe('Logger Utilities', () => {
  it('should create component logger', () => {
    const handler = new MemoryLogHandler();
    const componentLogger = createComponentLogger('TestComponent', { handlers: [handler] });

    componentLogger.info('Test message');

    const entry = handler.getEntries()[0];
    expect(entry.context.component).toBe('TestComponent');
  });

  it('should generate unique request IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();

    expect(id1).toMatch(/^req-/);
    expect(id2).toMatch(/^req-/);
    expect(id1).not.toBe(id2);
  });

  it('should generate unique correlation IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();

    expect(id1).toMatch(/^corr-/);
    expect(id2).toMatch(/^corr-/);
    expect(id1).not.toBe(id2);
  });
});

// ==================== Tracer Tests ====================

describe('DistributedTracer', () => {
  let testTracer: DistributedTracer;

  beforeEach(() => {
    testTracer = new DistributedTracer();
  });

  it('should start a new trace', () => {
    const span = testTracer.startTrace('test_operation');
    const context = span.getContext();

    expect(context.traceId).toBeDefined();
    expect(context.spanId).toBeDefined();
    expect(context.parentSpanId).toBeUndefined();
  });

  it('should start child spans', () => {
    const parentSpan = testTracer.startTrace('parent');
    const parentContext = parentSpan.getContext();

    const childSpan = testTracer.startSpan('child', parentContext);
    const childContext = childSpan.getContext();

    expect(childContext.traceId).toBe(parentContext.traceId);
    expect(childContext.parentSpanId).toBe(parentContext.spanId);
    expect(childContext.spanId).not.toBe(parentContext.spanId);
  });

  it('should finish spans and record duration', () => {
    const span = testTracer.startTrace('test');

    // Simulate some work
    const start = performance.now();
    while (performance.now() - start < 5) {
      // busy wait
    }

    span.finish();

    const trace = testTracer.getTrace(span.getContext().traceId);
    expect(trace).toBeDefined();
    expect(trace!.length).toBe(1);
    expect(trace![0].durationMs).toBeGreaterThan(0);
  });

  it('should set tags on spans', () => {
    const span = testTracer.startTrace('test');
    span.setTag('component', 'my-service');
    span.setTag('http.status', 200);
    span.finish();

    const trace = testTracer.getTrace(span.getContext().traceId);
    expect(trace![0].tags.component).toBe('my-service');
    expect(trace![0].tags['http.status']).toBe(200);
  });

  it('should add logs to spans', () => {
    const span = testTracer.startTrace('test');
    span.log('Event happened', { detail: 'info' });
    span.finish();

    const trace = testTracer.getTrace(span.getContext().traceId);
    expect(trace![0].logs.length).toBe(1);
    expect(trace![0].logs[0].message).toBe('Event happened');
  });

  it('should set span status', () => {
    const successSpan = testTracer.startTrace('success');
    successSpan.setOk();
    successSpan.finish();

    const errorSpan = testTracer.startTrace('error');
    errorSpan.setError(new Error('Test error'));
    errorSpan.finish();

    const successTrace = testTracer.getTrace(successSpan.getContext().traceId);
    const errorTrace = testTracer.getTrace(errorSpan.getContext().traceId);

    expect(successTrace![0].status).toBe(SpanStatus.OK);
    expect(errorTrace![0].status).toBe(SpanStatus.ERROR);
    expect(errorTrace![0].tags['error.message']).toBe('Test error');
  });

  it('should export trace in Jaeger format', () => {
    const span = testTracer.startTrace('test');
    span.setTag('key', 'value');
    span.finish();

    const exported = testTracer.exportTrace(span.getContext().traceId);

    expect(exported).not.toBeNull();
    expect(exported!.traceId).toBe(span.getContext().traceId);
    expect(exported!.spans.length).toBe(1);
    expect(exported!.spanCount).toBe(1);
    expect(exported!.spans[0].tags.key).toBe('value');
  });

  it('should list all traces', () => {
    const span1 = testTracer.startTrace('trace1');
    const span2 = testTracer.startTrace('trace2');
    span1.finish();
    span2.finish();

    const traces = testTracer.listTraces();
    expect(traces.length).toBe(2);
  });

  it('should get tracer statistics', () => {
    const span1 = testTracer.startTrace('test1');
    const span2 = testTracer.startTrace('test2');
    span1.finish();
    span2.finish();

    const stats = testTracer.getStats();
    expect(stats.activeSpans).toBe(0);
    expect(stats.completedTraces).toBe(2);
    expect(stats.totalSpans).toBe(2);
  });

  it('should sample traces based on rate', () => {
    const sampledTracer = new DistributedTracer({ samplingRate: 0 });

    // With 0% sampling, spans should be no-ops
    const span = sampledTracer.startTrace('test');
    span.finish();

    expect(sampledTracer.listTraces().length).toBe(0);
  });

  it('should clear all traces', () => {
    const span = testTracer.startTrace('test');
    span.finish();

    expect(testTracer.listTraces().length).toBe(1);

    testTracer.clear();
    expect(testTracer.listTraces().length).toBe(0);
  });
});

describe('Span Context Serialization', () => {
  it('should serialize span context', () => {
    const context = { traceId: 'trace123', spanId: 'span456' };
    const serialized = serializeSpanContext(context);

    expect(serialized).toBe('trace123:span456:');
  });

  it('should serialize span context with parent', () => {
    const context = { traceId: 'trace123', spanId: 'span456', parentSpanId: 'parent789' };
    const serialized = serializeSpanContext(context);

    expect(serialized).toBe('trace123:span456:parent789');
  });

  it('should deserialize span context', () => {
    const deserialized = deserializeSpanContext('trace123:span456:');

    expect(deserialized).not.toBeNull();
    expect(deserialized!.traceId).toBe('trace123');
    expect(deserialized!.spanId).toBe('span456');
    expect(deserialized!.parentSpanId).toBeUndefined();
  });

  it('should deserialize span context with parent', () => {
    const deserialized = deserializeSpanContext('trace123:span456:parent789');

    expect(deserialized).not.toBeNull();
    expect(deserialized!.parentSpanId).toBe('parent789');
  });

  it('should return null for invalid format', () => {
    expect(deserializeSpanContext('invalid')).toBeNull();
  });
});

describe('withTrace Helper', () => {
  let testTracer: DistributedTracer;

  beforeEach(() => {
    testTracer = new DistributedTracer();
  });

  it('should trace successful async operations', async () => {
    const result = await withTrace('test_operation', async span => {
      span.setTag('custom', 'tag');
      return 'result';
    });

    expect(result).toBe('result');
  });

  it('should trace failed async operations', async () => {
    await expect(
      withTrace('failing_operation', async () => {
        throw new Error('Test failure');
      })
    ).rejects.toThrow('Test failure');
  });

  it('should trace sync operations', () => {
    const result = withTraceSync('test_operation', span => {
      span.setTag('sync', true);
      return 42;
    });

    expect(result).toBe(42);
  });
});

// ==================== Performance Tests ====================

describe('Performance', () => {
  it('should have low overhead for counter increments', () => {
    const counter = new Counter('perf_counter', 'Performance test');
    const iterations = 100000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      counter.inc();
    }
    const duration = performance.now() - start;

    // Should complete 100k increments in under 100ms
    expect(duration).toBeLessThan(100);
    expect(counter.get()).toBe(iterations);
  });

  it('should have low overhead for histogram observations', () => {
    const histogram = new Histogram('perf_histogram', 'Performance test');
    const iterations = 10000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      histogram.observe(Math.random());
    }
    const duration = performance.now() - start;

    // Should complete 10k observations in under 100ms
    expect(duration).toBeLessThan(100);
    expect(histogram.getCount()).toBe(iterations);
  });

  it('should export metrics efficiently', () => {
    const collector = new MetricsCollector();

    // Create many metrics
    for (let i = 0; i < 100; i++) {
      const counter = collector.createCounter(`counter_${i}`, `Counter ${i}`);
      counter.inc(undefined, i);
    }

    const start = performance.now();
    const output = collector.export();
    const duration = performance.now() - start;

    // Should export 100 metrics in under 50ms
    expect(duration).toBeLessThan(50);
    expect(output.length).toBeGreaterThan(0);
  });

  it('should have low overhead for span creation', () => {
    const testTracer = new DistributedTracer();
    const iterations = 10000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const span = testTracer.startTrace('perf_test');
      span.finish();
    }
    const duration = performance.now() - start;

    // Should complete 10k span operations in under 500ms (CI environments have variable load)
    expect(duration).toBeLessThan(500);
  });
});

// ==================== Integration Tests ====================

describe('Integration', () => {
  it('should correlate logs with traces', () => {
    const handler = new MemoryLogHandler();
    const logger = new StructuredLogger({
      minLevel: LogLevel.DEBUG,
      handlers: [handler],
    });

    const testTracer = new DistributedTracer();
    const span = testTracer.startTrace('integrated_operation');
    const context = span.getContext();

    logger.info('Operation started', {
      trace_id: context.traceId,
      span_id: context.spanId,
    });

    span.log('Internal event');
    span.finish();

    logger.info('Operation completed', {
      trace_id: context.traceId,
      span_id: context.spanId,
    });

    const entries = handler.getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].context.trace_id).toBe(context.traceId);
    expect(entries[1].context.trace_id).toBe(context.traceId);
  });

  it('should track end-to-end workflow metrics', () => {
    // Simulate a workflow with multiple components
    const collector = new MetricsCollector();

    const requestCounter = collector.createCounter('requests_total', 'Total requests');
    const latencyHist = collector.createHistogram('request_latency_seconds', 'Request latency');
    const activeGauge = collector.createGauge('active_requests', 'Active requests');

    // Simulate multiple requests
    for (let i = 0; i < 10; i++) {
      activeGauge.inc();
      const latency = Math.random() * 0.1; // 0-100ms
      latencyHist.observe(latency);
      requestCounter.inc();
      activeGauge.dec();
    }

    expect(requestCounter.get()).toBe(10);
    expect(latencyHist.getCount()).toBe(10);
    expect(activeGauge.get()).toBe(0);

    // Export should contain all metrics
    const output = collector.export();
    expect(output).toContain('requests_total');
    expect(output).toContain('request_latency_seconds');
    expect(output).toContain('active_requests');
  });
});
