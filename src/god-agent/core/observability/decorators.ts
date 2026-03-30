/**
 * Instrumentation Decorators
 * TASK-OBS-001 - Observability Stack
 *
 * Provides TypeScript decorators for automatic instrumentation:
 * - @Instrumented: Automatic metrics and tracing
 * - @Timed: Measure execution time
 * - @Logged: Automatic logging
 * - @Traced: Automatic span creation
 *
 * NOTE: All rethrows in decorators are INTENTIONAL transparent rethrows.
 * Decorators wrap methods to provide observability but should NOT modify
 * error behavior - errors must bubble up unchanged to preserve stack traces
 * and allow proper error handling by the wrapped method's caller.
 */

import { metricsCollector, type MetricLabels, Histogram, Counter } from './metrics.js';
import { logger, type LogContext } from './logger.js';
import { tracer, type SpanContext } from './tracer.js';

// ==================== Types ====================

/**
 * Instrumentation options
 */
export interface InstrumentedOptions {
  /** Metric name to record (optional) */
  metricName?: string;
  /** Static labels to add to metrics */
  labels?: MetricLabels;
  /** Whether to enable tracing (default: true) */
  tracing?: boolean;
  /** Whether to enable logging (default: true) */
  logging?: boolean;
  /** Log level for success (default: 'debug') */
  successLogLevel?: 'debug' | 'info';
  /** Log level for errors (default: 'error') */
  errorLogLevel?: 'error' | 'warn';
}

/**
 * Timed decorator options
 */
export interface TimedOptions {
  /** Histogram metric name */
  metricName: string;
  /** Static labels */
  labels?: MetricLabels;
  /** Buckets for histogram */
  buckets?: number[];
}

/**
 * Logged decorator options
 */
export interface LoggedOptions {
  /** Component name for log context */
  component?: string;
  /** Log level for entry (default: 'debug') */
  entryLevel?: 'debug' | 'info';
  /** Log level for exit (default: 'debug') */
  exitLevel?: 'debug' | 'info';
  /** Whether to log arguments (default: false) */
  logArgs?: boolean;
  /** Whether to log result (default: false) */
  logResult?: boolean;
}

/**
 * Traced decorator options
 */
export interface TracedOptions {
  /** Operation name (default: method name) */
  operationName?: string;
  /** Static tags to add to span */
  tags?: Record<string, string | number | boolean>;
}

// ==================== Decorator Implementations ====================

/**
 * @Instrumented decorator
 *
 * Automatically instruments a method with:
 * - Metrics recording (latency histogram)
 * - Distributed tracing
 * - Structured logging
 *
 * @example
 * class MyService {
 *   @Instrumented({ metricName: 'my_operation_seconds' })
 *   async doWork(): Promise<void> { ... }
 * }
 */
export function Instrumented(options: InstrumentedOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const component = target.constructor.name;
    const operation = propertyKey;

    // Create histogram if metric name provided
    let histogram: Histogram | undefined;
    if (options.metricName) {
      histogram = metricsCollector.createHistogram(
        options.metricName,
        `Latency for ${component}.${operation}`,
        ['status', ...(options.labels ? Object.keys(options.labels) : [])]
      );
    }

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const enableTracing = options.tracing !== false;
      const enableLogging = options.logging !== false;

      // Start trace if enabled
      const span = enableTracing
        ? tracer.startTrace(`${component}.${operation}`)
        : null;

      if (span) {
        span.setTag('component', component);
        span.setTag('operation', operation);
      }

      const startTime = performance.now();

      try {
        // Execute original method
        const result = await originalMethod.apply(this, args);
        const durationMs = performance.now() - startTime;

        // Record success metrics
        if (histogram) {
          histogram.observe(durationMs / 1000, {
            status: 'success',
            ...options.labels,
          });
        }

        // Log success
        if (enableLogging) {
          const logFn =
            options.successLogLevel === 'info' ? logger.info.bind(logger) : logger.debug.bind(logger);
          logFn(`${component}.${operation} completed`, {
            component,
            operation,
            duration_ms: durationMs,
            trace_id: span?.getContext().traceId,
            span_id: span?.getContext().spanId,
          });
        }

        // Finish span
        if (span) {
          span.setOk();
          span.finish();
        }

        return result;
      } catch (error) {
        const durationMs = performance.now() - startTime;

        // Record error metrics
        if (histogram) {
          histogram.observe(durationMs / 1000, {
            status: 'error',
            ...options.labels,
          });
        }

        // Log error
        if (enableLogging) {
          const logFn =
            options.errorLogLevel === 'warn' ? logger.warn.bind(logger) : logger.error.bind(logger);
          logFn(
            `${component}.${operation} failed`,
            {
              component,
              operation,
              duration_ms: durationMs,
              trace_id: span?.getContext().traceId,
              span_id: span?.getContext().spanId,
              error_message: error instanceof Error ? error.message : String(error),
            }
          );
        }

        // Finish span with error
        if (span) {
          span.setError(error as Error);
          span.finish();
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * @Timed decorator
 *
 * Records execution time to a histogram metric.
 *
 * @example
 * class MyService {
 *   @Timed({ metricName: 'operation_duration_seconds' })
 *   async doWork(): Promise<void> { ... }
 * }
 */
export function Timed(options: TimedOptions) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    // Create histogram
    const histogram = metricsCollector.createHistogram(
      options.metricName,
      `Execution time for ${target.constructor.name}.${propertyKey}`,
      ['status', ...(options.labels ? Object.keys(options.labels) : [])],
      options.buckets
    );

    if (isAsync) {
      descriptor.value = async function (...args: unknown[]): Promise<unknown> {
        const start = performance.now();
        try {
          const result = await originalMethod.apply(this, args);
          histogram.observe((performance.now() - start) / 1000, {
            status: 'success',
            ...options.labels,
          });
          return result;
        } catch (error) {
          histogram.observe((performance.now() - start) / 1000, {
            status: 'error',
            ...options.labels,
          });
          throw error;
        }
      };
    } else {
      descriptor.value = function (...args: unknown[]): unknown {
        const start = performance.now();
        try {
          const result = originalMethod.apply(this, args);
          histogram.observe((performance.now() - start) / 1000, {
            status: 'success',
            ...options.labels,
          });
          return result;
        } catch (error) {
          histogram.observe((performance.now() - start) / 1000, {
            status: 'error',
            ...options.labels,
          });
          throw error;
        }
      };
    }

    return descriptor;
  };
}

/**
 * @Logged decorator
 *
 * Automatically logs method entry and exit.
 *
 * @example
 * class MyService {
 *   @Logged({ component: 'MyService' })
 *   async doWork(input: string): Promise<void> { ... }
 * }
 */
export function Logged(options: LoggedOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const component = options.component || target.constructor.name;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    const entryLog = options.entryLevel === 'info' ? logger.info.bind(logger) : logger.debug.bind(logger);
    const exitLog = options.exitLevel === 'info' ? logger.info.bind(logger) : logger.debug.bind(logger);

    if (isAsync) {
      descriptor.value = async function (...args: unknown[]): Promise<unknown> {
        const context: LogContext = { component, operation: propertyKey };
        if (options.logArgs) {
          context.args = args;
        }

        entryLog(`${propertyKey} started`, context);
        const start = performance.now();

        try {
          const result = await originalMethod.apply(this, args);
          const duration = performance.now() - start;

          const exitContext: LogContext = { ...context, duration_ms: duration };
          if (options.logResult) {
            exitContext.result = result;
          }
          exitLog(`${propertyKey} completed`, exitContext);

          return result;
        } catch (error) {
          const duration = performance.now() - start;
          logger.error(`${propertyKey} failed`, error, { ...context, duration_ms: duration });
          throw error;
        }
      };
    } else {
      descriptor.value = function (...args: unknown[]): unknown {
        const context: LogContext = { component, operation: propertyKey };
        if (options.logArgs) {
          context.args = args;
        }

        entryLog(`${propertyKey} started`, context);
        const start = performance.now();

        try {
          const result = originalMethod.apply(this, args);
          const duration = performance.now() - start;

          const exitContext: LogContext = { ...context, duration_ms: duration };
          if (options.logResult) {
            exitContext.result = result;
          }
          exitLog(`${propertyKey} completed`, exitContext);

          return result;
        } catch (error) {
          const duration = performance.now() - start;
          logger.error(`${propertyKey} failed`, error, { ...context, duration_ms: duration });
          throw error;
        }
      };
    }

    return descriptor;
  };
}

/**
 * @Traced decorator
 *
 * Automatically creates a span for the method execution.
 *
 * @example
 * class MyService {
 *   @Traced({ operationName: 'custom_operation' })
 *   async doWork(): Promise<void> { ... }
 * }
 */
export function Traced(options: TracedOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';
    const operationName =
      options.operationName || `${target.constructor.name}.${propertyKey}`;

    if (isAsync) {
      descriptor.value = async function (...args: unknown[]): Promise<unknown> {
        const span = tracer.startTrace(operationName);

        // Apply static tags
        if (options.tags) {
          for (const [key, value] of Object.entries(options.tags)) {
            span.setTag(key, value);
          }
        }

        try {
          const result = await originalMethod.apply(this, args);
          span.setOk();
          return result;
        } catch (error) {
          span.setError(error as Error);
          throw error;
        } finally {
          span.finish();
        }
      };
    } else {
      descriptor.value = function (...args: unknown[]): unknown {
        const span = tracer.startTrace(operationName);

        // Apply static tags
        if (options.tags) {
          for (const [key, value] of Object.entries(options.tags)) {
            span.setTag(key, value);
          }
        }

        try {
          const result = originalMethod.apply(this, args);
          span.setOk();
          return result;
        } catch (error) {
          span.setError(error as Error);
          throw error;
        } finally {
          span.finish();
        }
      };
    }

    return descriptor;
  };
}

// ==================== Counter Decorator ====================

/**
 * @Counted decorator
 *
 * Increments a counter on method execution.
 *
 * @example
 * class MyService {
 *   @Counted({ metricName: 'requests_total' })
 *   async handleRequest(): Promise<void> { ... }
 * }
 */
export function Counted(options: { metricName: string; labels?: MetricLabels }) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const isAsync = originalMethod.constructor.name === 'AsyncFunction';

    // Create counter
    const counter = metricsCollector.createCounter(
      options.metricName,
      `Invocation count for ${target.constructor.name}.${propertyKey}`,
      ['status', ...(options.labels ? Object.keys(options.labels) : [])]
    );

    if (isAsync) {
      descriptor.value = async function (...args: unknown[]): Promise<unknown> {
        try {
          const result = await originalMethod.apply(this, args);
          counter.inc({ status: 'success', ...options.labels });
          return result;
        } catch (error) {
          counter.inc({ status: 'error', ...options.labels });
          throw error;
        }
      };
    } else {
      descriptor.value = function (...args: unknown[]): unknown {
        try {
          const result = originalMethod.apply(this, args);
          counter.inc({ status: 'success', ...options.labels });
          return result;
        } catch (error) {
          counter.inc({ status: 'error', ...options.labels });
          throw error;
        }
      };
    }

    return descriptor;
  };
}
