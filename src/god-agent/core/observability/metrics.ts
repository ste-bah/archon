/**
 * Prometheus-style Metrics
 * TASK-OBS-001 - Observability Stack
 *
 * Provides Prometheus-compatible metric types:
 * - Counter: monotonically increasing values
 * - Gauge: point-in-time values (can go up/down)
 * - Histogram: value distributions with buckets
 * - Summary: pre-aggregated statistics
 */

// ==================== Types ====================

/**
 * Metric type enumeration
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

/**
 * Metric labels (dimensions)
 */
export interface MetricLabels {
  [key: string]: string | number;
}

/**
 * Metric value with labels and timestamp
 */
export interface MetricValue {
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

/**
 * Histogram percentile result
 */
export interface PercentileResult {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

// ==================== Base Metric Class ====================

/**
 * Abstract base metric class
 */
export abstract class Metric {
  constructor(
    protected readonly name: string,
    protected readonly help: string,
    protected readonly type: MetricType,
    protected readonly labelNames: string[] = []
  ) {}

  /**
   * Record a value
   */
  abstract record(value: number, labels?: MetricLabels): void;

  /**
   * Export in Prometheus format
   */
  abstract export(): string;

  /**
   * Get metric name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get metric type
   */
  getType(): MetricType {
    return this.type;
  }

  /**
   * Get metric help text
   */
  getHelp(): string {
    return this.help;
  }

  /**
   * Validate labels match expected label names
   */
  protected validateLabels(labels?: MetricLabels): void {
    if (!labels) return;

    for (const labelName of this.labelNames) {
      if (!(labelName in labels)) {
        throw new Error(`Missing required label: ${labelName}`);
      }
    }
  }

  /**
   * Format labels as Prometheus label string
   */
  protected formatLabels(labels?: MetricLabels): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }

    const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
    return `{${pairs.join(',')}}`;
  }

  /**
   * Generate label key for internal storage
   */
  protected labelKey(labels?: MetricLabels): string {
    return this.formatLabels(labels);
  }
}

// ==================== Counter ====================

/**
 * Counter: monotonically increasing value
 * Use for: request counts, error counts, completed tasks
 */
export class Counter extends Metric {
  private values: Map<string, number> = new Map();

  constructor(name: string, help: string, labelNames: string[] = []) {
    super(name, help, MetricType.COUNTER, labelNames);
  }

  /**
   * Increment counter by amount (default 1)
   */
  inc(labels?: MetricLabels, amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Counter can only be incremented');
    }
    this.validateLabels(labels);
    const key = this.labelKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + amount);
  }

  /**
   * Record a value (alias for inc)
   */
  record(value: number, labels?: MetricLabels): void {
    this.inc(labels, value);
  }

  /**
   * Get current value for labels
   */
  get(labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    return this.values.get(key) || 0;
  }

  /**
   * Reset counter (use sparingly, typically only in tests)
   */
  reset(): void {
    this.values.clear();
  }

  /**
   * Export in Prometheus format
   */
  export(): string {
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} ${this.type}\n`;

    for (const [labelStr, value] of this.values.entries()) {
      output += `${this.name}${labelStr} ${value}\n`;
    }

    return output;
  }
}

// ==================== Gauge ====================

/**
 * Gauge: point-in-time value (can increase or decrease)
 * Use for: memory usage, queue depth, active connections
 */
export class Gauge extends Metric {
  private values: Map<string, number> = new Map();

  constructor(name: string, help: string, labelNames: string[] = []) {
    super(name, help, MetricType.GAUGE, labelNames);
  }

  /**
   * Set gauge to specific value
   */
  set(value: number, labels?: MetricLabels): void {
    this.validateLabels(labels);
    const key = this.labelKey(labels);
    this.values.set(key, value);
  }

  /**
   * Increment gauge by amount (default 1)
   */
  inc(labels?: MetricLabels, amount: number = 1): void {
    const key = this.labelKey(labels);
    const current = this.values.get(key) || 0;
    this.set(current + amount, labels);
  }

  /**
   * Decrement gauge by amount (default 1)
   */
  dec(labels?: MetricLabels, amount: number = 1): void {
    this.inc(labels, -amount);
  }

  /**
   * Record a value (alias for set)
   */
  record(value: number, labels?: MetricLabels): void {
    this.set(value, labels);
  }

  /**
   * Get current value for labels
   */
  get(labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    return this.values.get(key) || 0;
  }

  /**
   * Reset gauge
   */
  reset(): void {
    this.values.clear();
  }

  /**
   * Export in Prometheus format
   */
  export(): string {
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} ${this.type}\n`;

    for (const [labelStr, value] of this.values.entries()) {
      output += `${this.name}${labelStr} ${value}\n`;
    }

    return output;
  }
}

// ==================== Histogram ====================

/**
 * Histogram: bucketed value distribution
 * Use for: latency measurements, request sizes
 */
export class Histogram extends Metric {
  private buckets: number[];
  private counts: Map<string, number[]> = new Map();
  private sums: Map<string, number> = new Map();
  private totals: Map<string, number> = new Map();
  private allValues: Map<string, number[]> = new Map(); // For percentile calculation

  constructor(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets: number[] = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]
  ) {
    super(name, help, MetricType.HISTOGRAM, labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  /**
   * Observe a value
   */
  observe(value: number, labels?: MetricLabels): void {
    this.validateLabels(labels);
    const key = this.labelKey(labels);

    // Initialize if needed
    if (!this.counts.has(key)) {
      this.counts.set(key, new Array(this.buckets.length + 1).fill(0));
      this.sums.set(key, 0);
      this.totals.set(key, 0);
      this.allValues.set(key, []);
    }

    // Update sum and count
    this.sums.set(key, (this.sums.get(key) || 0) + value);
    this.totals.set(key, (this.totals.get(key) || 0) + 1);

    // Store value for percentile calculation
    const values = this.allValues.get(key)!;
    values.push(value);

    // Update buckets
    const bucketCounts = this.counts.get(key)!;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        bucketCounts[i]++;
      }
    }
    bucketCounts[this.buckets.length]++; // +Inf bucket
  }

  /**
   * Record a value (alias for observe)
   */
  record(value: number, labels?: MetricLabels): void {
    this.observe(value, labels);
  }

  /**
   * Get count for labels
   */
  getCount(labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    return this.totals.get(key) || 0;
  }

  /**
   * Get sum for labels
   */
  getSum(labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    return this.sums.get(key) || 0;
  }

  /**
   * Get mean for labels
   */
  getMean(labels?: MetricLabels): number {
    const count = this.getCount(labels);
    if (count === 0) return 0;
    return this.getSum(labels) / count;
  }

  /**
   * Get percentiles for labels
   */
  getPercentiles(labels?: MetricLabels): PercentileResult {
    const key = this.labelKey(labels);
    const values = this.allValues.get(key) || [];

    if (values.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
    };
  }

  /**
   * Reset histogram
   */
  reset(): void {
    this.counts.clear();
    this.sums.clear();
    this.totals.clear();
    this.allValues.clear();
  }

  /**
   * Export in Prometheus format
   */
  export(): string {
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} ${this.type}\n`;

    for (const [labelStr, bucketCounts] of this.counts.entries()) {
      // Export each bucket
      for (let i = 0; i < this.buckets.length; i++) {
        const bucketLabel = labelStr
          ? labelStr.slice(0, -1) + `,le="${this.buckets[i]}"}`
          : `{le="${this.buckets[i]}"}`;
        output += `${this.name}_bucket${bucketLabel} ${bucketCounts[i]}\n`;
      }

      // +Inf bucket
      const infLabel = labelStr
        ? labelStr.slice(0, -1) + ',le="+Inf"}'
        : '{le="+Inf"}';
      output += `${this.name}_bucket${infLabel} ${bucketCounts[this.buckets.length]}\n`;

      // Sum
      output += `${this.name}_sum${labelStr} ${this.sums.get(labelStr) || 0}\n`;

      // Count
      output += `${this.name}_count${labelStr} ${this.totals.get(labelStr) || 0}\n`;
    }

    return output;
  }
}

// ==================== Summary ====================

/**
 * Summary: pre-aggregated statistics (quantiles)
 * Use for: pre-calculated percentiles without bucket overhead
 */
export class Summary extends Metric {
  private values: Map<string, number[]> = new Map();
  // Note: maxAge/ageBucketCount reserved for future time-based windowing
  // Currently using maxValues for simple memory bounding
  private _maxAge: number;
  private _ageBucketCount: number;
  private maxValues: number;

  constructor(
    name: string,
    help: string,
    labelNames: string[] = [],
    options: { maxAge?: number; ageBucketCount?: number; maxValues?: number } = {}
  ) {
    super(name, help, MetricType.SUMMARY, labelNames);
    this._maxAge = options.maxAge || 600000; // 10 minutes default (reserved)
    this._ageBucketCount = options.ageBucketCount || 5; // (reserved)
    this.maxValues = options.maxValues || 10000; // Prevent unbounded growth
  }

  /**
   * Observe a value
   */
  observe(value: number, labels?: MetricLabels): void {
    this.validateLabels(labels);
    const key = this.labelKey(labels);

    if (!this.values.has(key)) {
      this.values.set(key, []);
    }

    const vals = this.values.get(key)!;
    vals.push(value);

    // Prevent unbounded growth - remove oldest values when limit exceeded
    if (vals.length > this.maxValues) {
      vals.splice(0, vals.length - this.maxValues);
    }
  }

  /**
   * Record a value (alias for observe)
   */
  record(value: number, labels?: MetricLabels): void {
    this.observe(value, labels);
  }

  /**
   * Get count for labels
   */
  getCount(labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    return (this.values.get(key) || []).length;
  }

  /**
   * Get sum for labels
   */
  getSum(labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    const vals = this.values.get(key) || [];
    return vals.reduce((a, b) => a + b, 0);
  }

  /**
   * Get quantile for labels
   */
  getQuantile(quantile: number, labels?: MetricLabels): number {
    const key = this.labelKey(labels);
    const vals = this.values.get(key) || [];

    if (vals.length === 0) return 0;

    const sorted = [...vals].sort((a, b) => a - b);
    const index = Math.ceil(quantile * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Reset summary
   */
  reset(): void {
    this.values.clear();
  }

  /**
   * Export in Prometheus format
   */
  export(): string {
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} ${this.type}\n`;

    const quantiles = [0.5, 0.9, 0.95, 0.99];

    for (const [labelStr] of this.values.entries()) {
      // Export each quantile
      for (const q of quantiles) {
        const qLabel = labelStr
          ? labelStr.slice(0, -1) + `,quantile="${q}"}`
          : `{quantile="${q}"}`;
        output += `${this.name}${qLabel} ${this.getQuantile(q)}\n`;
      }

      // Sum
      output += `${this.name}_sum${labelStr} ${this.getSum()}\n`;

      // Count
      output += `${this.name}_count${labelStr} ${this.getCount()}\n`;
    }

    return output;
  }
}

// ==================== Metrics Collector ====================

/**
 * Central registry for all metrics
 */
export class MetricsCollector {
  private metrics: Map<string, Metric> = new Map();

  /**
   * Create and register a counter
   */
  createCounter(name: string, help: string, labelNames: string[] = []): Counter {
    if (this.metrics.has(name)) {
      return this.metrics.get(name) as Counter;
    }
    const counter = new Counter(name, help, labelNames);
    this.metrics.set(name, counter);
    return counter;
  }

  /**
   * Create and register a gauge
   */
  createGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    if (this.metrics.has(name)) {
      return this.metrics.get(name) as Gauge;
    }
    const gauge = new Gauge(name, help, labelNames);
    this.metrics.set(name, gauge);
    return gauge;
  }

  /**
   * Create and register a histogram
   */
  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[]
  ): Histogram {
    if (this.metrics.has(name)) {
      return this.metrics.get(name) as Histogram;
    }
    const histogram = new Histogram(name, help, labelNames, buckets);
    this.metrics.set(name, histogram);
    return histogram;
  }

  /**
   * Create and register a summary
   */
  createSummary(
    name: string,
    help: string,
    labelNames: string[] = [],
    options?: { maxAge?: number; ageBucketCount?: number }
  ): Summary {
    if (this.metrics.has(name)) {
      return this.metrics.get(name) as Summary;
    }
    const summary = new Summary(name, help, labelNames, options);
    this.metrics.set(name, summary);
    return summary;
  }

  /**
   * Get a specific metric by name
   */
  get<T extends Metric>(name: string): T | undefined {
    return this.metrics.get(name) as T | undefined;
  }

  /**
   * List all registered metric names
   */
  list(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Check if a metric exists
   */
  has(name: string): boolean {
    return this.metrics.has(name);
  }

  /**
   * Remove a metric
   */
  remove(name: string): boolean {
    return this.metrics.delete(name);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Export all metrics in Prometheus format
   */
  export(): string {
    let output = '';
    for (const metric of this.metrics.values()) {
      output += metric.export() + '\n';
    }
    return output;
  }

  /**
   * Get metrics count
   */
  size(): number {
    return this.metrics.size;
  }

  /**
   * Get a snapshot of all current metric values
   * Useful for status reporting and debugging
   */
  getSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};

    for (const [name, metric] of this.metrics.entries()) {
      const type = metric.getType();

      switch (type) {
        case MetricType.COUNTER:
          snapshot[name] = {
            type: 'counter',
            value: (metric as Counter).get(),
          };
          break;
        case MetricType.GAUGE:
          snapshot[name] = {
            type: 'gauge',
            value: (metric as Gauge).get(),
          };
          break;
        case MetricType.HISTOGRAM:
          const histogram = metric as Histogram;
          snapshot[name] = {
            type: 'histogram',
            count: histogram.getCount(),
            sum: histogram.getSum(),
            mean: histogram.getMean(),
            percentiles: histogram.getPercentiles(),
          };
          break;
        case MetricType.SUMMARY:
          const summary = metric as Summary;
          snapshot[name] = {
            type: 'summary',
            count: summary.getCount(),
            sum: summary.getSum(),
            p50: summary.getQuantile(0.5),
            p90: summary.getQuantile(0.9),
            p99: summary.getQuantile(0.99),
          };
          break;
      }
    }

    return snapshot;
  }

  /**
   * Flush metrics (export and optionally reset)
   * Called during shutdown to ensure metrics are persisted
   */
  async flush(): Promise<string> {
    // Export all metrics in Prometheus format
    const exported = this.export();

    // In a production environment, this would send metrics to a monitoring backend
    // For now, we just return the exported data
    return exported;
  }
}

// ==================== Global Instance ====================

/**
 * Global metrics collector instance
 */
export const metricsCollector = new MetricsCollector();

// ==================== Predefined Metrics ====================

/**
 * Predefined metrics for God Agent components
 */
export const METRICS = {
  // VectorDB metrics
  vectordbSearchLatency: metricsCollector.createHistogram(
    'vectordb_search_latency_seconds',
    'VectorDB search latency in seconds',
    ['operation', 'index'],
    [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1]
  ),

  vectordbSearchCount: metricsCollector.createCounter(
    'vectordb_search_total',
    'Total number of VectorDB searches',
    ['operation', 'status']
  ),

  // Memory cache metrics
  memoryCacheHit: metricsCollector.createCounter(
    'memory_cache_hit_total',
    'Total cache hits',
    ['cache_type', 'tier']
  ),

  memoryCacheMiss: metricsCollector.createCounter(
    'memory_cache_miss_total',
    'Total cache misses',
    ['cache_type', 'tier']
  ),

  memoryCacheSize: metricsCollector.createGauge(
    'memory_cache_size_bytes',
    'Current cache size in bytes',
    ['cache_type']
  ),

  // Compression metrics
  compressionTierCount: metricsCollector.createGauge(
    'compression_tier_count',
    'Number of vectors in each compression tier',
    ['tier']
  ),

  compressionRatio: metricsCollector.createHistogram(
    'compression_ratio',
    'Compression ratio achieved',
    ['codec'],
    [2, 4, 8, 16, 32]
  ),

  compressionLatency: metricsCollector.createHistogram(
    'compression_latency_seconds',
    'Compression operation latency',
    ['operation', 'tier'],
    [0.001, 0.005, 0.01, 0.05, 0.1, 0.5]
  ),

  // Orchestration metrics
  agentCompletionRate: metricsCollector.createGauge(
    'orchestration_agent_completion_rate',
    'Percentage of agents completing successfully',
    ['pipeline']
  ),

  agentExecutionTime: metricsCollector.createHistogram(
    'orchestration_agent_execution_seconds',
    'Agent execution time in seconds',
    ['agent_key', 'status'],
    [0.1, 0.5, 1, 5, 10, 30, 60]
  ),

  pipelineExecutionCount: metricsCollector.createCounter(
    'orchestration_pipeline_execution_total',
    'Total pipeline executions',
    ['pipeline', 'status']
  ),

  // Attention mechanism metrics
  attentionSelectionTime: metricsCollector.createHistogram(
    'attention_mechanism_selection_seconds',
    'Time to select attention mechanism',
    ['selected_mechanism'],
    [0.0001, 0.0005, 0.001, 0.005, 0.01]
  ),

  attentionForwardTime: metricsCollector.createHistogram(
    'attention_forward_seconds',
    'Attention forward pass latency',
    ['mechanism'],
    [0.01, 0.05, 0.1, 0.5, 1, 5]
  ),

  // Shadow Vector metrics
  shadowVectorContradictions: metricsCollector.createCounter(
    'shadow_vector_contradictions_total',
    'Total contradictions detected',
    ['severity']
  ),

  // Relay Race metrics
  relayRaceHandoffs: metricsCollector.createCounter(
    'relay_race_handoffs_total',
    'Total handoffs between agents',
    ['from_agent', 'to_agent', 'status']
  ),

  // Neural Router metrics
  neuralRouterDecisions: metricsCollector.createCounter(
    'neural_router_decisions_total',
    'Total routing decisions',
    ['route', 'confidence_bucket']
  ),

  // Hyperedge Q&A Store metrics
  qaStoreCreated: metricsCollector.createCounter(
    'qa_store_created_total',
    'Total Q&A hyperedges created',
    ['quality']
  ),

  qaStoreCreateLatency: metricsCollector.createHistogram(
    'qa_store_create_latency_ms',
    'Q&A hyperedge creation latency in milliseconds',
    [],
    [5, 10, 20, 30, 50, 100]
  ),

  qaStoreSearchLatency: metricsCollector.createHistogram(
    'qa_store_search_latency_ms',
    'Q&A search latency in milliseconds',
    [],
    [10, 20, 30, 50, 100, 200]
  ),

  // Hyperedge Causal Store metrics
  causalStoreChainCreated: metricsCollector.createCounter(
    'causal_store_chain_created_total',
    'Total causal chains created',
    ['nodeCount']
  ),

  causalStoreCreateLatency: metricsCollector.createHistogram(
    'causal_store_create_latency_ms',
    'Causal chain creation latency in milliseconds',
    [],
    [5, 10, 20, 50, 100, 200]
  ),

  causalStoreRootCauseLatency: metricsCollector.createHistogram(
    'causal_store_root_cause_latency_ms',
    'Root cause analysis latency in milliseconds',
    [],
    [20, 50, 100, 200, 500]
  ),

  causalStoreLoopsDetected: metricsCollector.createCounter(
    'causal_store_loops_detected_total',
    'Total causal loops detected',
    ['count']
  ),

  causalStoreLoopDetectionLatency: metricsCollector.createHistogram(
    'causal_store_loop_detection_latency_ms',
    'Loop detection latency in milliseconds',
    [],
    [10, 20, 50, 100, 200]
  ),

  // ===========================================
  // UCM (Unbounded Context Memory) metrics
  // ===========================================

  ucmEpisodeStored: metricsCollector.createCounter(
    'ucm_episode_stored_total',
    'Total episodes stored in UCM',
    ['type', 'quality']
  ),

  ucmEpisodeRetrieved: metricsCollector.createCounter(
    'ucm_episode_retrieved_total',
    'Total episodes retrieved from UCM',
    ['source', 'confidence']
  ),

  ucmContextSize: metricsCollector.createGauge(
    'ucm_context_size_tokens',
    'Current context size in tokens',
    ['tier']
  ),

  ucmRollingWindowSize: metricsCollector.createGauge(
    'ucm_rolling_window_size',
    'Current rolling window size',
    []
  ),

  // ===========================================
  // IDESC v2 (Intelligent Dual Embedding) metrics
  // ===========================================

  idescOutcomeRecorded: metricsCollector.createCounter(
    'idesc_outcome_recorded_total',
    'Total outcomes recorded by IDESC',
    ['outcome', 'confidence']
  ),

  idescOutcomeLatency: metricsCollector.createHistogram(
    'idesc_outcome_latency_ms',
    'IDESC outcome recording latency in milliseconds',
    [],
    [1, 2, 5, 10, 20, 50]
  ),

  idescInjectionDecisions: metricsCollector.createCounter(
    'idesc_injection_decisions_total',
    'Total injection decisions made',
    ['decision', 'reason']
  ),

  idescShouldInjectLatency: metricsCollector.createHistogram(
    'idesc_should_inject_latency_ms',
    'shouldInject decision latency in milliseconds',
    [],
    [5, 10, 20, 30, 50, 100]
  ),

  idescNegativeWarnings: metricsCollector.createCounter(
    'idesc_negative_warnings_total',
    'Total negative example warnings issued',
    ['severity']
  ),

  idescThresholdAdjustments: metricsCollector.createCounter(
    'idesc_threshold_adjustments_total',
    'Total threshold adjustments made',
    ['direction']
  ),

  // ===========================================
  // Episode System metrics
  // ===========================================

  episodeLinked: metricsCollector.createCounter(
    'episode_linked_total',
    'Total episodes linked to trajectories',
    ['link_type']
  ),

  episodeLinkLatency: metricsCollector.createHistogram(
    'episode_link_latency_ms',
    'Episode linking latency in milliseconds',
    [],
    [1, 5, 10, 20, 50]
  ),

  episodeTimeIndexSize: metricsCollector.createGauge(
    'episode_time_index_size',
    'Current size of episode time index',
    []
  ),

  // ===========================================
  // Embedding System metrics (1536D)
  // ===========================================

  embeddingDimensions: metricsCollector.createGauge(
    'embedding_dimensions',
    'Current embedding dimensions (1536 for gte-Qwen2)',
    []
  ),

  embeddingGenerated: metricsCollector.createCounter(
    'embedding_generated_total',
    'Total embeddings generated',
    ['model', 'source']
  ),

  embeddingLatency: metricsCollector.createHistogram(
    'embedding_latency_ms',
    'Embedding generation latency in milliseconds',
    ['model'],
    [5, 10, 20, 50, 100, 200]
  ),

  embeddingCacheHit: metricsCollector.createCounter(
    'embedding_cache_hit_total',
    'Total embedding cache hits',
    []
  ),

  // ===========================================
  // Agent Registry metrics
  // ===========================================

  agentRegistryTotal: metricsCollector.createGauge(
    'agent_registry_total',
    'Total agents registered (264 agents across 30 categories)',
    []
  ),

  agentCategoryCount: metricsCollector.createGauge(
    'agent_category_count',
    'Agents per category',
    ['category']
  ),

  agentSelectionCount: metricsCollector.createCounter(
    'agent_selection_total',
    'Total agent selections by routing',
    ['agent_key', 'confidence_bucket']
  ),

  // ===========================================
  // Token Budget metrics
  // ===========================================

  tokenBudgetUsage: metricsCollector.createGauge(
    'token_budget_usage_percent',
    'Current token budget usage percentage',
    ['tier']
  ),

  tokenBudgetWarnings: metricsCollector.createCounter(
    'token_budget_warnings_total',
    'Total token budget warning events',
    ['severity']
  ),

  summarizationTriggered: metricsCollector.createCounter(
    'summarization_triggered_total',
    'Total summarization triggers',
    ['reason']
  ),

  // ===========================================
  // Daemon System metrics
  // ===========================================

  daemonHealth: metricsCollector.createGauge(
    'daemon_health_status',
    'Daemon health status (1=healthy, 0.5=degraded, 0=unhealthy)',
    ['daemon_type']
  ),

  daemonUptime: metricsCollector.createGauge(
    'daemon_uptime_seconds',
    'Daemon uptime in seconds',
    ['daemon_type']
  ),

  daemonEventProcessed: metricsCollector.createCounter(
    'daemon_event_processed_total',
    'Total events processed by daemon',
    ['daemon_type', 'event_type']
  ),
};
