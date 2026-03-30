/**
 * Memory Types
 * MEM-001 - Shared type definitions for multi-process memory system
 *
 * Provides types for:
 * - IPC message structures (request/response)
 * - Memory operations
 * - Server/client configuration
 * - Knowledge storage
 */

// ==================== IPC Message Types ====================

/**
 * All supported IPC method names
 */
export type MemoryMethod =
  | 'storeKnowledge'
  | 'getKnowledgeByDomain'
  | 'getKnowledgeByTags'
  | 'deleteKnowledge'
  | 'provideFeedback'
  | 'queryPatterns'
  | 'getStatus'
  | 'ping';

/**
 * IPC request message structure
 */
export interface IMemoryRequest<T = unknown> {
  /** Unique request identifier (UUID) */
  id: string;
  /** Message type discriminator */
  type: 'request';
  /** Method to invoke */
  method: MemoryMethod;
  /** Method parameters */
  params: T;
}

/**
 * IPC response message structure
 */
export interface IMemoryResponse<T = unknown> {
  /** Request ID this response corresponds to */
  id: string;
  /** Message type discriminator */
  type: 'response';
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data (null if failed) */
  result: T | null;
  /** Error information (null if succeeded) */
  error: IMemoryErrorInfo | null;
}

/**
 * Error information in IPC response
 */
export interface IMemoryErrorInfo {
  /** Error code (e.g., 'STORAGE_ERROR') */
  code: MemoryErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional error context */
  context?: Record<string, unknown>;
}

// ==================== Error Codes ====================

/**
 * All possible memory error codes
 * Per constitution.md IPC protocol requirements
 */
export type MemoryErrorCode =
  | 'INVALID_REQUEST'
  | 'UNKNOWN_METHOD'
  | 'VALIDATION_ERROR'
  | 'STORAGE_ERROR'
  | 'SERVER_SHUTTING_DOWN'
  | 'TIMEOUT'
  | 'MAX_CONNECTIONS'
  | 'SERVER_NOT_RUNNING'
  | 'SERVER_DISCONNECTED';

// ==================== Knowledge Types ====================

/**
 * Knowledge entry stored in memory
 */
export interface IKnowledgeEntry {
  /** Unique identifier */
  id: string;
  /** Content (typically JSON string) */
  content: string;
  /** Category (e.g., 'schema', 'analysis') */
  category: string;
  /** Domain namespace (e.g., 'project/api') */
  domain: string;
  /** Searchable tags */
  tags: string[];
  /** Quality score (0-1) */
  quality: number;
  /** Number of times retrieved */
  usageCount: number;
  /** Last usage timestamp */
  lastUsed: number;
  /** Creation timestamp */
  createdAt: number;
  /** Update timestamp */
  updatedAt?: number;
}

/**
 * Parameters for storing knowledge
 */
export interface IStoreKnowledgeParams {
  /** Content to store */
  content: string;
  /** Category for classification */
  category: string;
  /** Domain namespace */
  domain: string;
  /** Tags for searching */
  tags?: string[];
  /** Optional quality score (0-1) */
  quality?: number;
}

/**
 * Parameters for retrieving knowledge by domain
 */
export interface IGetKnowledgeByDomainParams {
  /** Domain to query */
  domain: string;
  /** Maximum results to return */
  limit?: number;
}

/**
 * Parameters for retrieving knowledge by tags
 */
export interface IGetKnowledgeByTagsParams {
  /** Tags to match (AND logic) */
  tags: string[];
  /** Maximum results to return */
  limit?: number;
}

/**
 * Parameters for deleting knowledge
 */
export interface IDeleteKnowledgeParams {
  /** Knowledge entry ID to delete */
  id: string;
}

// ==================== Feedback Types ====================

/**
 * Parameters for providing feedback
 */
export interface IProvideFeedbackParams {
  /** Trajectory ID to provide feedback for */
  trajectoryId: string;
  /** Quality score (0-1) */
  quality: number;
  /** Outcome classification */
  outcome: 'positive' | 'negative' | 'neutral';
  /** Optional user feedback notes */
  userFeedback?: string;
}

/**
 * Result of feedback operation
 */
export interface IProvideFeedbackResult {
  /** Whether feedback was stored */
  stored: boolean;
  /** Updated trajectory ID */
  trajectoryId: string;
  /** Updated quality score */
  newQuality: number;
}

// ==================== Query Types ====================

/**
 * Parameters for querying patterns
 */
export interface IQueryPatternsParams {
  /** Query text or embedding vector */
  query: string | number[];
  /** Query type */
  type?: 'semantic' | 'hybrid' | 'pattern-match';
  /** Maximum results */
  maxResults?: number;
  /** Minimum confidence threshold */
  confidenceThreshold?: number;
}

/**
 * Result of pattern query
 */
export interface IQueryPatternsResult {
  /** Matched patterns */
  patterns: IPatternMatch[];
  /** Total matches found */
  totalMatches: number;
  /** Query execution time in ms */
  queryTimeMs: number;
}

/**
 * A single pattern match result
 */
export interface IPatternMatch {
  /** Pattern ID */
  id: string;
  /** Match confidence score (0-1) */
  confidence: number;
  /** Pattern content */
  content: string;
  /** Pattern metadata */
  metadata?: Record<string, unknown>;
}

// ==================== Status Types ====================

/**
 * Server status information
 */
export interface IServerStatus {
  /** Server state */
  state: ServerState;
  /** Number of connected clients */
  connectedClients: number;
  /** Server uptime in milliseconds */
  uptimeMs: number;
  /** Total requests handled */
  totalRequests: number;
  /** Memory usage in bytes */
  memoryUsageBytes: number;
  /** Storage statistics */
  storage: IStorageStats;
}

/**
 * Storage statistics
 */
export interface IStorageStats {
  /** Total knowledge entries */
  knowledgeCount: number;
  /** Total patterns stored */
  patternCount: number;
  /** Total trajectories */
  trajectoryCount: number;
  /** Storage size in bytes */
  sizeBytes: number;
}

/**
 * Ping response
 */
export interface IPingResult {
  /** Pong response */
  pong: boolean;
  /** Server timestamp */
  timestamp: number;
  /** Server version */
  version: string;
}

// ==================== Server Types ====================

/**
 * Server state enum
 */
export type ServerState = 'starting' | 'ready' | 'shutting_down' | 'stopped';

/**
 * Server configuration
 */
export interface IMemoryServerConfig {
  /** Socket path for Unix domain socket (Linux/macOS) */
  socketPath?: string;
  /** HTTP port for localhost server (Windows fallback) */
  httpPort?: number;
  /** Maximum concurrent connections */
  maxConnections?: number;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
  /** Path to .agentdb directory */
  agentDbPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * PID file structure
 */
export interface IPidFileContent {
  /** Server process ID */
  pid: number;
  /** IPC address (socket path or http://localhost:port) */
  address: string;
  /** Server start timestamp */
  startedAt: number;
  /** Server version */
  version: string;
}

// ==================== Client Types ====================

/**
 * Client configuration
 */
export interface IMemoryClientConfig {
  /** Server address (auto-discovered if not provided) */
  serverAddress?: string;
  /** Connection timeout in milliseconds */
  connectTimeoutMs?: number;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
  /** Enable auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Reconnection delay in milliseconds */
  reconnectDelayMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Auto-start daemon if server not running (default: true) */
  autoStart?: boolean;
}

/**
 * Client connection state
 */
export type ClientState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Client connection info
 */
export interface IClientConnection {
  /** Current state */
  state: ClientState;
  /** Server address */
  serverAddress: string | null;
  /** Connection timestamp */
  connectedAt: number | null;
  /** Reconnection attempts */
  reconnectAttempts: number;
  /** Last error */
  lastError: string | null;
}

// ==================== Health Types ====================

/**
 * Health check result
 */
export interface IHealthCheckResult {
  /** Overall health status */
  healthy: boolean;
  /** Server reachable */
  serverReachable: boolean;
  /** Storage accessible */
  storageAccessible: boolean;
  /** Response time in ms */
  responseTimeMs: number;
  /** Last successful check timestamp */
  lastCheckAt: number;
  /** Error details if unhealthy */
  error?: string;
}

/**
 * Health monitor configuration
 */
export interface IHealthMonitorConfig {
  /** Check interval in milliseconds */
  intervalMs?: number;
  /** Health check timeout in milliseconds */
  timeoutMs?: number;
  /** Number of consecutive failures before unhealthy */
  failureThreshold?: number;
}

// ==================== Default Constants ====================

/** Default socket path for Unix domain socket */
export const DEFAULT_SOCKET_PATH = '/tmp/god-agent-memory.sock';

/** Default HTTP port for Windows fallback */
export const DEFAULT_HTTP_PORT = 47654;

/** Default maximum connections */
export const DEFAULT_MAX_CONNECTIONS = 100;

/** Default request timeout (30 seconds) */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/** Default connection timeout (5 seconds) */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** Default reconnection delay (1 second) */
export const DEFAULT_RECONNECT_DELAY_MS = 1000;

/** Default max reconnection attempts */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

/** Default health check interval (10 seconds) */
export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 10000;

/** Default health check timeout (5 seconds) */
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Default failure threshold */
export const DEFAULT_FAILURE_THRESHOLD = 3;

/** Memory server version */
export const MEMORY_SERVER_VERSION = '1.0.0';
