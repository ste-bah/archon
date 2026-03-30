/**
 * Daemon Module - Unix socket IPC for God Agent services
 *
 * PRD: PRD-GOD-AGENT-001
 * Tasks: TASK-DAEMON-001, TASK-DAEMON-002
 *
 * @module src/god-agent/core/daemon
 */

// Daemon Types (TASK-DAEMON-001)
export type {
  DaemonConfig,
  ClientConnection,
  DaemonStats,
  RegisteredService,
  ServiceHandler,
  DaemonState,
  DaemonEventType,
  DaemonEvent,
  DaemonError,
} from './daemon-types.js';

export {
  // Constants
  DEFAULT_SOCKET_PATH,
  MAX_CLIENTS,
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_DAEMON_CONFIG,
  // Enums
  ClientRejectionReason,
  DaemonErrorCode,
  // Functions
  createDaemonError,
  generateClientId,
  isDaemonError,
} from './daemon-types.js';

// Protocol Types (TASK-DAEMON-002)
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
  ParsedMessage,
} from './protocol-types.js';

export {
  // Constants
  JSONRPC_VERSION,
  MAX_MESSAGE_SIZE,
  MESSAGE_DELIMITER,
  RPC_ERROR_MESSAGES,
  // Enums
  RpcErrorCode,
  // Functions
  createRpcError,
  createSuccessResponse,
  createErrorResponse,
  isNotification,
  isValidRequest,
  isBatchRequest,
  isValidMethodName,
  extractServiceName,
  extractMethodName,
} from './protocol-types.js';

// Server (TASK-DAEMON-001)
export { DaemonServer } from './daemon-server.js';

// Message Handler (TASK-DAEMON-002)
export type { IServiceRegistry } from './message-handler.js';
export { MessageHandler } from './message-handler.js';
