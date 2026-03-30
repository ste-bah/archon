/**
 * Recovery Service (SVC-003)
 * JSON-RPC 2.0 service for compaction recovery operations
 *
 * METHODS:
 * - recovery.check: Check for compaction events
 * - recovery.reconstruct: Reconstruct context after compaction
 * - recovery.status: Get recovery system status
 *
 * CONSTITUTION RULES: RULE-055 to RULE-062
 */

import type {
  IReconstructedContext,
  IRecoveryMetrics
} from '../types.js';
import { CompactionDetector } from '../recovery/compaction-detector.js';
import { MemoryReconstructor } from '../recovery/memory-reconstructor.js';
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
// Request Parameter Types
// ============================================================================

interface CheckParams {
  conversationContext: string;
}

interface ReconstructParams {
  autoRecover?: boolean;
  descFallback?: boolean;
}

interface RecoveryCheckResult {
  compactionDetected: boolean;
  compactionTimestamp: string | null;
  inRecoveryMode: boolean;
  requiresReconstruction: boolean;
}

interface RecoveryStatusResult {
  enabled: boolean;
  inRecoveryMode: boolean;
  lastCompactionTimestamp: string | null;
  lastRecoveryMetrics: IRecoveryMetrics | null;
  totalCompactionEvents: number;
  totalRecoveries: number;
  successRate: number;
}

// ============================================================================
// Recovery Service
// ============================================================================

export class RecoveryService {
  private compactionDetector: CompactionDetector;
  private memoryReconstructor: MemoryReconstructor;
  private recoveryHistory: IRecoveryMetrics[] = [];
  private compactionCount = 0;
  private enabled = true;

  constructor(
    compactionDetector?: CompactionDetector,
    memoryReconstructor?: MemoryReconstructor
  ) {
    this.compactionDetector = compactionDetector ?? new CompactionDetector();
    this.memoryReconstructor = memoryReconstructor ?? new MemoryReconstructor();
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
        case 'recovery.check':
          result = await this.handleCheck(params);
          break;

        case 'recovery.reconstruct':
          result = await this.handleReconstruct(params);
          break;

        case 'recovery.status':
          result = await this.handleStatus(params);
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
   * Handle recovery.check method
   * Check for compaction events in conversation context
   * RULE-055: Detect Claude Code compaction markers
   */
  private async handleCheck(params: unknown): Promise<RecoveryCheckResult> {
    if (!this.isCheckParams(params)) {
      throw new ServiceError(
        ERROR_CODES.INVALID_PARAMS,
        'Invalid params: expected { conversationContext: string }'
      );
    }

    const { conversationContext } = params;

    const compactionDetected = this.compactionDetector.detectCompaction(conversationContext);
    const compactionTimestamp = this.compactionDetector.getCompactionTimestamp();
    const inRecoveryMode = this.compactionDetector.isInRecoveryMode();

    if (compactionDetected) {
      this.compactionCount++;
    }

    return {
      compactionDetected,
      compactionTimestamp: compactionTimestamp
        ? new Date(typeof compactionTimestamp === 'object' && compactionTimestamp !== null
            ? (compactionTimestamp as Date).getTime()
            : compactionTimestamp as number).toISOString()
        : null,
      inRecoveryMode,
      requiresReconstruction: compactionDetected && !inRecoveryMode
    };
  }

  /**
   * Handle recovery.reconstruct method
   * Reconstruct context after compaction using memory tiers
   * RULE-056: Reconstruct from AgentDB + DESC fallback
   */
  private async handleReconstruct(params: unknown): Promise<IReconstructedContext> {
    if (!this.isReconstructParams(params)) {
      throw new ServiceError(
        ERROR_CODES.INVALID_PARAMS,
        'Invalid params: expected { autoRecover?, descFallback? }'
      );
    }

    // Perform reconstruction
    const reconstructedContext = await this.memoryReconstructor.reconstructContext();

    // Store metrics
    this.recoveryHistory.push(reconstructedContext.metrics);

    // Limit history to last 100 entries
    if (this.recoveryHistory.length > 100) {
      this.recoveryHistory.shift();
    }

    return reconstructedContext;
  }

  /**
   * Handle recovery.status method
   * Get recovery system status and statistics
   */
  private async handleStatus(params: unknown): Promise<RecoveryStatusResult> {
    const lastMetrics = this.recoveryHistory.length > 0
      ? this.recoveryHistory[this.recoveryHistory.length - 1]
      : null;

    const totalRecoveries = this.recoveryHistory.length;
    const successfulRecoveries = this.recoveryHistory.filter(
      m => m.completeness >= 0.95
    ).length;

    const successRate = totalRecoveries > 0
      ? successfulRecoveries / totalRecoveries
      : 1.0;

    return {
      enabled: this.enabled,
      inRecoveryMode: this.compactionDetector.isInRecoveryMode(),
      lastCompactionTimestamp: (() => {
        const ts = this.compactionDetector.getCompactionTimestamp();
        if (!ts) return null;
        return new Date(typeof ts === 'object' && ts !== null ? (ts as Date).getTime() : ts as number).toISOString();
      })(),
      lastRecoveryMetrics: lastMetrics,
      totalCompactionEvents: this.compactionCount,
      totalRecoveries,
      successRate
    };
  }

  /**
   * Enable/disable recovery system
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // ============================================================================
  // Type Guards
  // ============================================================================

  private isCheckParams(params: unknown): params is CheckParams {
    if (!params || typeof params !== 'object') return false;
    const p = params as Record<string, unknown>;
    return typeof p.conversationContext === 'string';
  }

  private isReconstructParams(params: unknown): params is ReconstructParams {
    // Reconstruction params are optional
    if (!params) return true;
    if (typeof params !== 'object') return false;
    return true;
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
