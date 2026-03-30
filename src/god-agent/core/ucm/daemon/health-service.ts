/**
 * Health Service (SVC-004)
 * JSON-RPC 2.0 service for UCM health monitoring and metrics
 *
 * METHODS:
 * - health.check: Basic health check
 * - health.metrics: Detailed system metrics
 *
 * CONSTITUTION RULES: RULE-051 to RULE-054 (performance tracking)
 */

import type { IEmbeddingProvider } from '../types.js';
import { ServiceError } from '../errors.js';

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: string | number | null;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

// ============================================================================
// Result Types
// ============================================================================

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    embedding: boolean;
    context: boolean;
    desc: boolean;
    recovery: boolean;
  };
  version: string;
}

interface MetricsResult {
  timestamp: string;
  uptime: number;
  performance: {
    tokenEstimationAvgMs: number;
    contextBuildAvgMs: number;
    descRetrievalAvgMs: number;
    recoveryCheckAvgMs: number;
  };
  usage: {
    totalTokensEstimated: number;
    totalContextBuilds: number;
    totalEpisodesStored: number;
    totalRecoveries: number;
  };
  embedding: {
    available: boolean;
    endpoint: string;
    model: string;
    dimension: number;
    totalEmbeddings: number;
    avgLatencyMs: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
}

// ============================================================================
// Health Service
// ============================================================================

export class HealthService {
  private startTime: number;
  private embeddingProvider: IEmbeddingProvider | null;

  // Metrics tracking
  private metrics = {
    tokenEstimations: { count: 0, totalMs: 0 },
    contextBuilds: { count: 0, totalMs: 0 },
    descRetrievals: { count: 0, totalMs: 0 },
    recoveryChecks: { count: 0, totalMs: 0 },
    episodesStored: 0,
    recoveries: 0,
    embeddings: { count: 0, totalMs: 0 }
  };

  private version = '1.0.0';
  private embeddingEndpoint = 'http://127.0.0.1:8000/embed';
  private embeddingModel = 'gte-Qwen2-1.5B-instruct';
  private embeddingDimension = 1536;

  constructor(embeddingProvider?: IEmbeddingProvider) {
    this.startTime = Date.now();
    this.embeddingProvider = embeddingProvider ?? null;
  }

  /**
   * Handle JSON-RPC 2.0 request
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params, id } = request;

    try {
      if (request.jsonrpc !== '2.0') {
        return this.errorResponse(
          ERROR_CODES.INVALID_REQUEST,
          'Invalid JSON-RPC version',
          id
        );
      }

      let result: unknown;

      switch (method) {
        case 'health.check':
          result = await this.handleHealthCheck(params);
          break;

        case 'health.metrics':
          result = await this.handleMetrics(params);
          break;

        default:
          return this.errorResponse(
            ERROR_CODES.METHOD_NOT_FOUND,
            `Method not found: ${method}`,
            id
          );
      }

      return this.successResponse(result, id);

    } catch (error) {
      return this.handleError(error, id);
    }
  }

  /**
   * Handle health.check method
   * Basic health check with service availability
   */
  private async handleHealthCheck(params: unknown): Promise<HealthCheckResult> {
    const uptime = Date.now() - this.startTime;

    // Check embedding service availability
    let embeddingAvailable = false;
    if (this.embeddingProvider) {
      try {
        embeddingAvailable = await this.embeddingProvider.isAvailable();
      } catch {
        // INTENTIONAL: Embedding availability check failure - treat as unavailable
        embeddingAvailable = false;
      }
    }

    // All other services are always available (in-memory)
    const services = {
      embedding: embeddingAvailable,
      context: true,
      desc: embeddingAvailable, // DESC requires embeddings
      recovery: true
    };

    // Determine overall status
    const allHealthy = Object.values(services).every(s => s);
    const anyHealthy = Object.values(services).some(s => s);

    const status = allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime,
      services,
      version: this.version
    };
  }

  /**
   * Handle health.metrics method
   * Detailed system metrics and performance statistics
   */
  private async handleMetrics(params: unknown): Promise<MetricsResult> {
    const uptime = Date.now() - this.startTime;

    // Calculate averages
    const tokenEstimationAvg = this.metrics.tokenEstimations.count > 0
      ? this.metrics.tokenEstimations.totalMs / this.metrics.tokenEstimations.count
      : 0;

    const contextBuildAvg = this.metrics.contextBuilds.count > 0
      ? this.metrics.contextBuilds.totalMs / this.metrics.contextBuilds.count
      : 0;

    const descRetrievalAvg = this.metrics.descRetrievals.count > 0
      ? this.metrics.descRetrievals.totalMs / this.metrics.descRetrievals.count
      : 0;

    const recoveryCheckAvg = this.metrics.recoveryChecks.count > 0
      ? this.metrics.recoveryChecks.totalMs / this.metrics.recoveryChecks.count
      : 0;

    const embeddingLatencyAvg = this.metrics.embeddings.count > 0
      ? this.metrics.embeddings.totalMs / this.metrics.embeddings.count
      : 0;

    // Check embedding availability
    let embeddingAvailable = false;
    if (this.embeddingProvider) {
      try {
        embeddingAvailable = await this.embeddingProvider.isAvailable();
      } catch {
        // INTENTIONAL: Embedding availability check failure - treat as unavailable
        embeddingAvailable = false;
      }
    }

    // Get memory usage
    const memUsage = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      uptime,
      performance: {
        tokenEstimationAvgMs: Math.round(tokenEstimationAvg * 100) / 100,
        contextBuildAvgMs: Math.round(contextBuildAvg * 100) / 100,
        descRetrievalAvgMs: Math.round(descRetrievalAvg * 100) / 100,
        recoveryCheckAvgMs: Math.round(recoveryCheckAvg * 100) / 100
      },
      usage: {
        totalTokensEstimated: this.metrics.tokenEstimations.count,
        totalContextBuilds: this.metrics.contextBuilds.count,
        totalEpisodesStored: this.metrics.episodesStored,
        totalRecoveries: this.metrics.recoveries
      },
      embedding: {
        available: embeddingAvailable,
        endpoint: this.embeddingEndpoint,
        model: this.embeddingModel,
        dimension: this.embeddingDimension,
        totalEmbeddings: this.metrics.embeddings.count,
        avgLatencyMs: Math.round(embeddingLatencyAvg * 100) / 100
      },
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100, // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
        external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
        rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100
      }
    };
  }

  /**
   * Record operation timing for metrics
   */
  recordOperation(
    type: 'tokenEstimation' | 'contextBuild' | 'descRetrieval' | 'recoveryCheck' | 'embedding',
    durationMs: number
  ): void {
    switch (type) {
      case 'tokenEstimation':
        this.metrics.tokenEstimations.count++;
        this.metrics.tokenEstimations.totalMs += durationMs;
        break;
      case 'contextBuild':
        this.metrics.contextBuilds.count++;
        this.metrics.contextBuilds.totalMs += durationMs;
        break;
      case 'descRetrieval':
        this.metrics.descRetrievals.count++;
        this.metrics.descRetrievals.totalMs += durationMs;
        break;
      case 'recoveryCheck':
        this.metrics.recoveryChecks.count++;
        this.metrics.recoveryChecks.totalMs += durationMs;
        break;
      case 'embedding':
        this.metrics.embeddings.count++;
        this.metrics.embeddings.totalMs += durationMs;
        break;
    }
  }

  /**
   * Increment counters
   */
  incrementCounter(type: 'episodeStored' | 'recovery'): void {
    if (type === 'episodeStored') {
      this.metrics.episodesStored++;
    } else if (type === 'recovery') {
      this.metrics.recoveries++;
    }
  }

  /**
   * Set configuration values
   */
  setEmbeddingConfig(endpoint: string, model: string, dimension: number): void {
    this.embeddingEndpoint = endpoint;
    this.embeddingModel = model;
    this.embeddingDimension = dimension;
  }

  // ============================================================================
  // Response Helpers
  // ============================================================================

  private successResponse(result: unknown, id: string | number | null): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      result,
      id
    };
  }

  private errorResponse(
    code: number,
    message: string,
    id: string | number | null,
    data?: unknown
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      error: { code, message, data },
      id
    };
  }

  private handleError(error: unknown, id: string | number | null): JsonRpcResponse {
    if (error instanceof ServiceError) {
      return this.errorResponse(Number(error.code) || ERROR_CODES.INTERNAL_ERROR, error.message, id, error.details);
    }

    const message = error instanceof Error ? error.message : 'Internal error';
    return this.errorResponse(ERROR_CODES.INTERNAL_ERROR, message, id);
  }
}
