/**
 * Distributed Tracer
 * TASK-OBS-001 - Observability Stack
 *
 * Provides distributed tracing with:
 * - Trace IDs for end-to-end request tracking
 * - Span IDs for individual operations
 * - Parent-child span relationships
 * - Timing and metadata for each span
 * - Jaeger-compatible export format
 */

// ==================== Types ====================

/**
 * Span context containing trace and span IDs
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Span log entry
 */
export interface SpanLog {
  timestamp: number;
  message: string;
  fields?: Record<string, unknown>;
}

/**
 * Span tags
 */
export interface SpanTags {
  [key: string]: string | number | boolean;
}

/**
 * Span status
 */
export enum SpanStatus {
  UNSET = 'unset',
  OK = 'ok',
  ERROR = 'error',
}

/**
 * Complete span information
 */
export interface Span {
  context: SpanContext;
  operationName: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  tags: SpanTags;
  logs: SpanLog[];
  status: SpanStatus;
}

/**
 * Trace export format (Jaeger-compatible)
 */
export interface TraceExport {
  traceId: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    operationName: string;
    startTime: number;
    durationMs: number;
    tags: SpanTags;
    logs: SpanLog[];
    status: string;
  }>;
  totalDurationMs: number;
  spanCount: number;
}

/**
 * Trace statistics
 */
export interface TraceStats {
  activeSpans: number;
  completedTraces: number;
  totalSpans: number;
}

// ==================== Span Builder ====================

/**
 * Fluent builder for spans
 */
export class SpanBuilder {
  private span: Span;
  private tracer: DistributedTracer;

  constructor(tracer: DistributedTracer, span: Span) {
    this.tracer = tracer;
    this.span = span;
  }

  /**
   * Set a tag on the span
   */
  setTag(key: string, value: string | number | boolean): SpanBuilder {
    this.span.tags[key] = value;
    return this;
  }

  /**
   * Add a log entry to the span
   */
  log(message: string, fields?: Record<string, unknown>): SpanBuilder {
    this.span.logs.push({
      timestamp: Date.now(),
      message,
      fields,
    });
    return this;
  }

  /**
   * Set span status to OK
   */
  setOk(): SpanBuilder {
    this.span.status = SpanStatus.OK;
    return this;
  }

  /**
   * Set span status to ERROR
   */
  setError(error?: Error | string): SpanBuilder {
    this.span.status = SpanStatus.ERROR;
    if (error) {
      const errorMessage = error instanceof Error ? error.message : error;
      this.setTag('error', true);
      this.setTag('error.message', errorMessage);
      if (error instanceof Error && error.stack) {
        this.setTag('error.stack', error.stack);
      }
    }
    return this;
  }

  /**
   * Get span context for creating child spans
   */
  getContext(): SpanContext {
    return { ...this.span.context };
  }

  /**
   * Finish the span
   */
  finish(): void {
    this.span.endTime = performance.now();
    this.span.durationMs = this.span.endTime - this.span.startTime;

    if (this.span.status === SpanStatus.UNSET) {
      this.span.status = SpanStatus.OK;
    }

    this.tracer.finishSpan(this.span);
  }

  /**
   * Get the underlying span
   */
  getSpan(): Span {
    return this.span;
  }
}

// ==================== Distributed Tracer ====================

/**
 * Distributed tracing implementation
 */
export class DistributedTracer {
  private activeSpans: Map<string, Span> = new Map();
  private completedTraces: Map<string, Span[]> = new Map();
  private samplingRate: number;
  private maxTracesRetained: number;

  constructor(
    options: {
      samplingRate?: number;
      maxTracesRetained?: number;
    } = {}
  ) {
    this.samplingRate = options.samplingRate ?? 1.0; // 100% by default
    this.maxTracesRetained = options.maxTracesRetained ?? 1000;
  }

  /**
   * Start a new trace
   */
  startTrace(operationName: string): SpanBuilder {
    // Sampling decision
    if (Math.random() > this.samplingRate) {
      // Return a no-op span builder for sampled-out traces
      return this.createNoOpSpanBuilder();
    }

    const traceId = this.generateId();
    const spanId = this.generateId();

    const span: Span = {
      context: { traceId, spanId },
      operationName,
      startTime: performance.now(),
      tags: {},
      logs: [],
      status: SpanStatus.UNSET,
    };

    this.activeSpans.set(spanId, span);
    return new SpanBuilder(this, span);
  }

  /**
   * Start a child span within an existing trace
   */
  startSpan(operationName: string, parentContext: SpanContext): SpanBuilder {
    // Sampling decision based on trace
    if (Math.random() > this.samplingRate) {
      return this.createNoOpSpanBuilder();
    }

    const spanId = this.generateId();

    const span: Span = {
      context: {
        traceId: parentContext.traceId,
        spanId,
        parentSpanId: parentContext.spanId,
      },
      operationName,
      startTime: performance.now(),
      tags: {},
      logs: [],
      status: SpanStatus.UNSET,
    };

    this.activeSpans.set(spanId, span);
    return new SpanBuilder(this, span);
  }

  /**
   * Finish a span (called by SpanBuilder)
   */
  finishSpan(span: Span): void {
    this.activeSpans.delete(span.context.spanId);

    // Add to completed traces
    const traceId = span.context.traceId;
    if (!this.completedTraces.has(traceId)) {
      this.completedTraces.set(traceId, []);
    }
    this.completedTraces.get(traceId)!.push(span);

    // Trim old traces if over limit
    if (this.completedTraces.size > this.maxTracesRetained) {
      const oldestTraceId = this.completedTraces.keys().next().value;
      if (oldestTraceId) {
        this.completedTraces.delete(oldestTraceId);
      }
    }
  }

  /**
   * Set a tag on an active span
   */
  setTag(context: SpanContext, key: string, value: string | number | boolean): void {
    const span = this.activeSpans.get(context.spanId);
    if (span) {
      span.tags[key] = value;
    }
  }

  /**
   * Add a log to an active span
   */
  log(context: SpanContext, message: string, fields?: Record<string, unknown>): void {
    const span = this.activeSpans.get(context.spanId);
    if (span) {
      span.logs.push({
        timestamp: Date.now(),
        message,
        fields,
      });
    }
  }

  /**
   * Get a completed trace by ID
   */
  getTrace(traceId: string): Span[] | undefined {
    return this.completedTraces.get(traceId);
  }

  /**
   * Export a trace in Jaeger-compatible format
   */
  exportTrace(traceId: string): TraceExport | null {
    const spans = this.completedTraces.get(traceId);
    if (!spans || spans.length === 0) return null;

    // Calculate total duration
    const startTimes = spans.map(s => s.startTime);
    const endTimes = spans.map(s => s.endTime || s.startTime);
    const totalDuration = Math.max(...endTimes) - Math.min(...startTimes);

    return {
      traceId,
      spans: spans.map(span => ({
        spanId: span.context.spanId,
        parentSpanId: span.context.parentSpanId,
        operationName: span.operationName,
        startTime: span.startTime,
        durationMs: span.durationMs || 0,
        tags: span.tags,
        logs: span.logs,
        status: span.status,
      })),
      totalDurationMs: totalDuration,
      spanCount: spans.length,
    };
  }

  /**
   * Get all trace IDs
   */
  listTraces(): string[] {
    return Array.from(this.completedTraces.keys());
  }

  /**
   * Get tracer statistics
   */
  getStats(): TraceStats {
    let totalSpans = 0;
    for (const spans of this.completedTraces.values()) {
      totalSpans += spans.length;
    }

    return {
      activeSpans: this.activeSpans.size,
      completedTraces: this.completedTraces.size,
      totalSpans,
    };
  }

  /**
   * Clear all traces
   */
  clear(): void {
    this.activeSpans.clear();
    this.completedTraces.clear();
  }

  /**
   * Set sampling rate (0.0 to 1.0)
   */
  setSamplingRate(rate: number): void {
    this.samplingRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Get current sampling rate
   */
  getSamplingRate(): number {
    return this.samplingRate;
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 18);
  }

  /**
   * Create a no-op span builder for sampled-out traces
   */
  private createNoOpSpanBuilder(): SpanBuilder {
    const noOpSpan: Span = {
      context: { traceId: 'noop', spanId: 'noop' },
      operationName: 'noop',
      startTime: 0,
      tags: {},
      logs: [],
      status: SpanStatus.UNSET,
    };

    const noOpBuilder = new SpanBuilder(
      {
        finishSpan: () => {},
      } as unknown as DistributedTracer,
      noOpSpan
    );

    return noOpBuilder;
  }
}

// ==================== Global Instance ====================

/**
 * Global tracer instance
 */
export const tracer = new DistributedTracer();

// ==================== Utility Functions ====================

/**
 * Execute a function with tracing
 */
export async function withTrace<T>(
  operationName: string,
  fn: (span: SpanBuilder) => Promise<T>,
  parentContext?: SpanContext
): Promise<T> {
  const span = parentContext
    ? tracer.startSpan(operationName, parentContext)
    : tracer.startTrace(operationName);

  try {
    const result = await fn(span);
    span.setOk();
    return result;
  } catch (error) {
    span.setError(error as Error);
    // INTENTIONAL: transparent rethrow - tracing wrapper should not modify errors
    throw error;
  } finally {
    span.finish();
  }
}

/**
 * Execute a sync function with tracing
 */
export function withTraceSync<T>(
  operationName: string,
  fn: (span: SpanBuilder) => T,
  parentContext?: SpanContext
): T {
  const span = parentContext
    ? tracer.startSpan(operationName, parentContext)
    : tracer.startTrace(operationName);

  try {
    const result = fn(span);
    span.setOk();
    return result;
  } catch (error) {
    span.setError(error as Error);
    // INTENTIONAL: transparent rethrow - tracing wrapper should not modify errors
    throw error;
  } finally {
    span.finish();
  }
}

/**
 * Create a span context from trace/span IDs
 */
export function createSpanContext(
  traceId: string,
  spanId: string,
  parentSpanId?: string
): SpanContext {
  return { traceId, spanId, parentSpanId };
}

/**
 * Serialize span context to header value
 */
export function serializeSpanContext(context: SpanContext): string {
  return `${context.traceId}:${context.spanId}:${context.parentSpanId || ''}`;
}

/**
 * Deserialize span context from header value
 */
export function deserializeSpanContext(value: string): SpanContext | null {
  const parts = value.split(':');
  if (parts.length < 2) return null;

  return {
    traceId: parts[0],
    spanId: parts[1],
    parentSpanId: parts[2] || undefined,
  };
}
