/**
 * Memory Server Module
 * MEM-001 - Multi-process memory system exports
 *
 * This module provides:
 * - MemoryServer: Daemon process for centralized memory operations
 * - MemoryClient: Client for agents to access memory server
 * - MemoryHealthMonitor: Health checking and diagnostics
 * - Protocol utilities for IPC message handling
 */

// ==================== Server Exports ====================

export {
  MemoryServer,
  getMemoryServer,
  startMemoryServer,
  stopMemoryServer,
} from './memory-server.js';

// ==================== Client Exports ====================

export {
  MemoryClient,
  getMemoryClient,
  createMemoryClient,
} from './memory-client.js';

// ==================== Health Exports ====================

export {
  MemoryHealthMonitor,
  getHealthMonitor,
  isMemoryServerHealthy,
  discoverMemoryServer,
  type IDiagnosticReport,
} from './memory-health.js';

// ==================== Daemon Launcher Exports ====================

export {
  launchDaemon,
  stopDaemon,
  getDaemonStatus,
  ensureDaemonRunning,
  startMemoryDaemon,
  stopMemoryDaemon,
  getMemoryDaemonStatus,
  ensureMemoryDaemonRunning,
  type IDaemonLaunchResult,
  type IDaemonStopResult,
  type IDaemonStatus,
} from './daemon-launcher.js';

// ==================== Error Exports ====================

export {
  MemoryError,
  InvalidRequestError,
  UnknownMethodError,
  ValidationError,
  StorageError,
  ServerShuttingDownError,
  TimeoutError,
  MaxConnectionsError,
  ServerNotRunningError,
  ServerDisconnectedError,
  errorFromInfo,
  isMemoryError,
  wrapError,
} from './memory-errors.js';

// ==================== Protocol Exports ====================

export {
  createRequest,
  createSuccessResponse,
  createErrorResponse,
  serializeMessage,
  parseMessage,
  isRequest,
  isResponse,
  isValidMethod,
  validateParams,
  MessageBuffer,
} from './memory-protocol.js';

// ==================== Type Re-exports ====================

export type {
  // IPC Message Types
  MemoryMethod,
  IMemoryRequest,
  IMemoryResponse,
  IMemoryErrorInfo,
  MemoryErrorCode,
  // Knowledge Types
  IKnowledgeEntry,
  IStoreKnowledgeParams,
  IGetKnowledgeByDomainParams,
  IGetKnowledgeByTagsParams,
  IDeleteKnowledgeParams,
  // Feedback Types
  IProvideFeedbackParams,
  IProvideFeedbackResult,
  // Query Types
  IQueryPatternsParams,
  IQueryPatternsResult,
  IPatternMatch,
  // Status Types
  IServerStatus,
  IStorageStats,
  IPingResult,
  ServerState,
  // Server Config
  IMemoryServerConfig,
  IPidFileContent,
  // Client Config
  IMemoryClientConfig,
  ClientState,
  IClientConnection,
  // Health Config
  IHealthCheckResult,
  IHealthMonitorConfig,
} from '../types/memory-types.js';

// ==================== Constants Re-exports ====================

export {
  DEFAULT_SOCKET_PATH,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RECONNECT_DELAY_MS,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  DEFAULT_FAILURE_THRESHOLD,
  MEMORY_SERVER_VERSION,
} from '../types/memory-types.js';
