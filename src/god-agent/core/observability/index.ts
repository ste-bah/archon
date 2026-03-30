/**
 * Observability Module
 * TASK-OBS-001 - Observability Stack
 *
 * Provides three-pillar observability:
 * - Metrics: Prometheus-style counters, gauges, histograms
 * - Logging: Structured JSON logging with correlation IDs
 * - Tracing: Distributed tracing with span hierarchy
 */

// ===== METRICS =====

export {
  // Types
  MetricType,
  type MetricLabels,
  type MetricValue,
  type PercentileResult,
  // Classes
  Metric,
  Counter,
  Gauge,
  Histogram,
  Summary,
  MetricsCollector,
  // Global instance
  metricsCollector,
  // Predefined metrics
  METRICS,
} from './metrics.js';

// ===== LOGGING =====

export {
  // Types
  LogLevel,
  LogLevelNames,
  parseLogLevel,
  type LogContext,
  type LogEntry,
  type LogHandler,
  // Handlers
  ConsoleLogHandler,
  MemoryLogHandler,
  SilentLogHandler,
  // Classes
  StructuredLogger,
  StructuredLogger as Logger, // Alias for backwards compatibility
  // Global instance
  logger,
  // Utilities
  createComponentLogger,
  generateRequestId,
  generateCorrelationId,
} from './logger.js';

// ===== TRACING =====

export {
  // Types
  type SpanContext,
  type SpanLog,
  type SpanTags,
  SpanStatus,
  type Span,
  type TraceExport,
  type TraceStats,
  // Classes
  SpanBuilder,
  DistributedTracer,
  // Global instance
  tracer,
  // Utilities
  withTrace,
  withTraceSync,
  createSpanContext,
  serializeSpanContext,
  deserializeSpanContext,
} from './tracer.js';

// ===== DECORATORS =====

export {
  // Types
  type InstrumentedOptions,
  type TimedOptions,
  type LoggedOptions,
  type TracedOptions,
  // Decorators
  Instrumented,
  Timed,
  Logged,
  Traced,
  Counted,
} from './decorators.js';
