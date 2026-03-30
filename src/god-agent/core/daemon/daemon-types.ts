/**
 * Daemon Types - TypeScript interfaces for IPC daemon
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-001
 *
 * @module src/god-agent/core/daemon/daemon-types
 */

import type { Socket } from 'net';

/**
 * Default socket path for daemon
 */
export const DEFAULT_SOCKET_PATH = '/tmp/godagent-db.sock';

/**
 * Maximum concurrent client connections
 */
export const MAX_CLIENTS = 10;

/**
 * Default keepalive timeout in milliseconds
 */
export const DEFAULT_KEEPALIVE_TIMEOUT_MS = 30_000;

/**
 * Maximum graceful shutdown wait time in milliseconds
 */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Daemon server configuration
 */
export interface DaemonConfig {
  /** Path to Unix socket file */
  socketPath: string;
  /** Maximum concurrent client connections */
  maxClients: number;
  /** Keepalive timeout in milliseconds */
  keepAliveTimeout: number;
}

/**
 * Connected client information
 */
export interface ClientConnection {
  /** Unique client identifier */
  id: string;
  /** Client socket */
  socket: Socket;
  /** Timestamp when client connected (ms since epoch) */
  connectedAt: number;
  /** Timestamp of last activity (ms since epoch) */
  lastActivity: number;
}

/**
 * Daemon server statistics
 */
export interface DaemonStats {
  /** Number of currently active connections */
  activeConnections: number;
  /** Total requests processed since startup */
  totalRequests: number;
  /** Uptime in milliseconds */
  uptime: number;
  /** Server start time (ms since epoch) */
  startedAt: number;
}

/**
 * Service handler function type
 */
export type ServiceHandler = (
  method: string,
  params: unknown
) => Promise<unknown>;

/**
 * Registered service info
 */
export interface RegisteredService {
  /** Service name */
  name: string;
  /** Service handler function */
  handler: ServiceHandler;
  /** Methods supported by service */
  methods: string[];
}

/**
 * Daemon server state
 */
export type DaemonState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping';

/**
 * Daemon event types
 */
export type DaemonEventType =
  | 'start'
  | 'stop'
  | 'client_connect'
  | 'client_disconnect'
  | 'client_rejected'
  | 'error';

/**
 * Daemon event payload
 */
export interface DaemonEvent {
  /** Event type */
  type: DaemonEventType;
  /** Timestamp (ms since epoch) */
  timestamp: number;
  /** Event-specific data */
  data?: Record<string, unknown>;
}

/**
 * Client rejection reason
 */
export enum ClientRejectionReason {
  /** Maximum clients reached */
  MAX_CLIENTS_EXCEEDED = 'MAX_CLIENTS_EXCEEDED',
  /** Server is shutting down */
  SERVER_SHUTTING_DOWN = 'SERVER_SHUTTING_DOWN',
  /** Invalid client state */
  INVALID_STATE = 'INVALID_STATE',
}

/**
 * Daemon error codes
 */
export enum DaemonErrorCode {
  /** Socket file already exists */
  SOCKET_EXISTS = 'EADDRINUSE',
  /** Permission denied */
  PERMISSION_DENIED = 'EACCES',
  /** Connection error */
  CONNECTION_ERROR = 'ECONNREFUSED',
  /** Timeout error */
  TIMEOUT = 'ETIMEDOUT',
  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Daemon error with code
 */
export interface DaemonError extends Error {
  /** Error code */
  code: DaemonErrorCode;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Create a daemon error
 */
export function createDaemonError(
  code: DaemonErrorCode,
  message: string,
  context?: Record<string, unknown>
): DaemonError {
  const error = new Error(message) as DaemonError;
  error.code = code;
  error.context = context;
  error.name = 'DaemonError';
  return error;
}

/**
 * Default daemon configuration
 */
export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  socketPath: DEFAULT_SOCKET_PATH,
  maxClients: MAX_CLIENTS,
  keepAliveTimeout: DEFAULT_KEEPALIVE_TIMEOUT_MS,
};

/**
 * Generate unique client ID
 */
export function generateClientId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if error is a daemon error
 */
export function isDaemonError(error: unknown): error is DaemonError {
  return (
    error instanceof Error &&
    'code' in error &&
    Object.values(DaemonErrorCode).includes((error as DaemonError).code)
  );
}

/**
 * JSON-RPC 2.0 Request - TASK-DAEMON-002
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: string | number | null;
}

/**
 * JSON-RPC 2.0 Response - TASK-DAEMON-002
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

/**
 * JSON-RPC 2.0 Error - TASK-DAEMON-002
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Standard JSON-RPC 2.0 Error Codes - TASK-DAEMON-002
 */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVICE_UNAVAILABLE: -32000,
  HANDLER_ERROR: -32001,
} as const;
