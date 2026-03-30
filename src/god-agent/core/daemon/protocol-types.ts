/**
 * JSON-RPC 2.0 Protocol Types
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-002
 *
 * @module src/god-agent/core/daemon/protocol-types
 */

/**
 * JSON-RPC 2.0 version constant
 */
export const JSONRPC_VERSION = '2.0' as const;

/**
 * Maximum message size in bytes (10MB)
 */
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;

/**
 * Message delimiter
 */
export const MESSAGE_DELIMITER = '\n';

/**
 * JSON-RPC error codes per spec
 */
export enum RpcErrorCode {
  /** Invalid JSON was received by the server */
  PARSE_ERROR = -32700,
  /** The JSON sent is not a valid Request object */
  INVALID_REQUEST = -32600,
  /** The method does not exist / is not available */
  METHOD_NOT_FOUND = -32601,
  /** Invalid method parameter(s) */
  INVALID_PARAMS = -32602,
  /** Internal JSON-RPC error */
  INTERNAL_ERROR = -32603,
  /** Reserved for implementation-defined server-errors (-32000 to -32099) */
  SERVER_ERROR = -32000,
}

/**
 * JSON-RPC error object
 */
export interface JsonRpcError {
  /** Error code */
  code: number;
  /** Error message */
  message: string;
  /** Additional error data */
  data?: unknown;
}

/**
 * JSON-RPC 2.0 request object
 */
export interface JsonRpcRequest {
  /** Protocol version - must be exactly "2.0" */
  jsonrpc: '2.0';
  /** Method name to invoke */
  method: string;
  /** Method parameters (optional) */
  params?: unknown;
  /** Request ID (optional - omit for notifications) */
  id?: string | number;
}

/**
 * JSON-RPC 2.0 response object
 */
export interface JsonRpcResponse {
  /** Protocol version - always "2.0" */
  jsonrpc: '2.0';
  /** Result on success (mutually exclusive with error) */
  result?: unknown;
  /** Error on failure (mutually exclusive with result) */
  error?: JsonRpcError;
  /** Request ID (null for parse errors) */
  id: string | number | null;
}

/**
 * JSON-RPC 2.0 notification (request without id)
 */
export interface JsonRpcNotification {
  /** Protocol version - must be exactly "2.0" */
  jsonrpc: '2.0';
  /** Method name to invoke */
  method: string;
  /** Method parameters (optional) */
  params?: unknown;
}

/**
 * Batch request - array of requests
 */
export type JsonRpcBatchRequest = JsonRpcRequest[];

/**
 * Batch response - array of responses
 */
export type JsonRpcBatchResponse = JsonRpcResponse[];

/**
 * Parsed message result
 */
export type ParsedMessage =
  | { type: 'request'; request: JsonRpcRequest }
  | { type: 'notification'; notification: JsonRpcNotification }
  | { type: 'batch'; requests: (JsonRpcRequest | JsonRpcNotification)[] }
  | { type: 'error'; error: JsonRpcError };

/**
 * Error messages for standard error codes
 */
export const RPC_ERROR_MESSAGES: Record<RpcErrorCode, string> = {
  [RpcErrorCode.PARSE_ERROR]: 'Parse error',
  [RpcErrorCode.INVALID_REQUEST]: 'Invalid Request',
  [RpcErrorCode.METHOD_NOT_FOUND]: 'Method not found',
  [RpcErrorCode.INVALID_PARAMS]: 'Invalid params',
  [RpcErrorCode.INTERNAL_ERROR]: 'Internal error',
  [RpcErrorCode.SERVER_ERROR]: 'Server error',
};

/**
 * Create a JSON-RPC error object
 */
export function createRpcError(
  code: RpcErrorCode | number,
  message?: string,
  data?: unknown
): JsonRpcError {
  return {
    code,
    message: message || RPC_ERROR_MESSAGES[code as RpcErrorCode] || 'Unknown error',
    data,
  };
}

/**
 * Create a JSON-RPC success response
 */
export function createSuccessResponse(
  result: unknown,
  id: string | number | null
): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    result,
    id,
  };
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(
  error: JsonRpcError,
  id: string | number | null
): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    error,
    id,
  };
}

/**
 * Check if request is a notification (no id field)
 */
export function isNotification(
  request: JsonRpcRequest | JsonRpcNotification
): request is JsonRpcNotification {
  return !('id' in request) || request.id === undefined;
}

/**
 * Check if message is a valid JSON-RPC request structure
 */
export function isValidRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return (
    obj.jsonrpc === JSONRPC_VERSION &&
    typeof obj.method === 'string' &&
    obj.method.length > 0
  );
}

/**
 * Check if message is a batch request
 */
export function isBatchRequest(msg: unknown): msg is unknown[] {
  return Array.isArray(msg) && msg.length > 0;
}

/**
 * Validate method name format
 * Methods should be lowercase with optional dots for namespacing
 */
export function isValidMethodName(method: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(method);
}

/**
 * Extract service name from method (e.g., "search.query" -> "search")
 */
export function extractServiceName(method: string): string {
  const dotIndex = method.indexOf('.');
  return dotIndex > 0 ? method.substring(0, dotIndex) : method;
}

/**
 * Extract method name from full method (e.g., "search.query" -> "query")
 */
export function extractMethodName(method: string): string {
  const dotIndex = method.indexOf('.');
  return dotIndex > 0 ? method.substring(dotIndex + 1) : method;
}
