/**
 * UCM Daemon Module
 * SPRINT 6 - Daemon Services
 *
 * Exports all daemon components for Universal Context Management:
 * - ContextService: Token estimation, context archival, context building
 * - DescService: Episode storage, retrieval, prompt injection
 * - RecoveryService: Compaction detection, context reconstruction
 * - HealthService: Health checks, system metrics
 * - DaemonServer: Main Unix socket server
 *
 * ARCHITECTURE:
 * - JSON-RPC 2.0 protocol over Unix sockets
 * - IPC endpoint: /tmp/godagent-db.sock (configurable)
 * - Service-oriented architecture with clear separation
 * - Performance monitoring and metrics tracking
 */

// Services
export { ContextService } from './context-service.js';
export { DescService, type IDescServiceConfig } from './desc-service.js';
export { RecoveryService } from './recovery-service.js';
export { HealthService } from './health-service.js';

// Server
export { DaemonServer, startDaemon } from './daemon-server.js';

// Re-export relevant types for daemon consumers
export type {
  IUniversalContextConfig,
  ITokenEstimate,
  IComposedContext,
  IEstimationHints,
  IEpisodeInput,
  IRetrievalResult,
  IRetrievalOptions,
  IReconstructedContext,
  IRecoveryMetrics
} from '../types.js';
