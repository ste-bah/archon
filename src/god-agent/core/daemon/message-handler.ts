/**
 * JSON-RPC 2.0 Message Handler
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-002
 *
 * @module src/god-agent/core/daemon/message-handler
 */

import type { RegisteredService } from './daemon-types.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  ParsedMessage,
} from './protocol-types.js';
import {
  MAX_MESSAGE_SIZE,
  MESSAGE_DELIMITER,
  RpcErrorCode,
  createRpcError,
  createSuccessResponse,
  createErrorResponse,
  isValidRequest,
  isBatchRequest,
  isNotification,
  extractServiceName,
  extractMethodName,
} from './protocol-types.js';

/**
 * Service registry interface (minimal for message handler)
 */
export interface IServiceRegistry {
  getService(name: string): RegisteredService | undefined;
}

/**
 * Buffer state for accumulating incomplete messages
 */
interface BufferState {
  data: string;
  size: number;
}

/**
 * Message Handler for JSON-RPC 2.0 protocol
 */
export class MessageHandler {
  private readonly serviceRegistry: IServiceRegistry;
  private buffers: Map<string, BufferState> = new Map();

  constructor(serviceRegistry: IServiceRegistry) {
    this.serviceRegistry = serviceRegistry;
  }

  /**
   * Process incoming data buffer
   *
   * @param clientId - Client connection ID
   * @param data - Raw data buffer
   * @returns Array of responses to send back
   */
  async processData(
    clientId: string,
    data: Buffer
  ): Promise<JsonRpcResponse[]> {
    // Accumulate buffer
    const complete = this.accumulateBuffer(clientId, data);
    if (complete.length === 0) {
      return [];
    }

    // Process all complete messages
    const responses: JsonRpcResponse[] = [];
    for (const message of complete) {
      const result = await this.processMessage(message);
      responses.push(...result);
    }

    return responses;
  }

  /**
   * Accumulate buffer and return complete messages
   */
  private accumulateBuffer(clientId: string, data: Buffer): string[] {
    const incoming = data.toString('utf-8');
    let state = this.buffers.get(clientId);

    if (!state) {
      state = { data: '', size: 0 };
      this.buffers.set(clientId, state);
    }

    // Check max buffer size
    if (state.size + data.length > MAX_MESSAGE_SIZE) {
      // Discard buffer and return error
      this.clearBuffer(clientId);
      return ['{"jsonrpc":"2.0","error":{"code":-32600,"message":"Message too large"},"id":null}'];
    }

    state.data += incoming;
    state.size += data.length;

    // Split on delimiter
    const parts = state.data.split(MESSAGE_DELIMITER);
    const complete: string[] = [];

    // All but the last part are complete messages
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i].trim();
      if (part.length > 0) {
        complete.push(part);
      }
    }

    // Keep the last part in buffer (may be incomplete)
    const remaining = parts[parts.length - 1];
    if (remaining.length === 0) {
      this.clearBuffer(clientId);
    } else {
      state.data = remaining;
      state.size = Buffer.byteLength(remaining, 'utf-8');
    }

    return complete;
  }

  /**
   * Clear buffer for client
   */
  clearBuffer(clientId: string): void {
    this.buffers.delete(clientId);
  }

  /**
   * Parse a single JSON message
   */
  parseMessage(message: string): ParsedMessage {
    let parsed: unknown;

    try {
      parsed = JSON.parse(message);
    } catch {
      // INTENTIONAL: Invalid JSON is a client error - return parse error response
      return {
        type: 'error',
        error: createRpcError(RpcErrorCode.PARSE_ERROR, 'Invalid JSON'),
      };
    }

    // Check for batch request
    if (isBatchRequest(parsed)) {
      const requests: (JsonRpcRequest | JsonRpcNotification)[] = [];
      for (const item of parsed) {
        if (!isValidRequest(item)) {
          return {
            type: 'error',
            error: createRpcError(
              RpcErrorCode.INVALID_REQUEST,
              'Invalid request in batch'
            ),
          };
        }
        requests.push(item as JsonRpcRequest | JsonRpcNotification);
      }
      return { type: 'batch', requests };
    }

    // Single request
    if (!isValidRequest(parsed)) {
      return {
        type: 'error',
        error: createRpcError(
          RpcErrorCode.INVALID_REQUEST,
          'Invalid Request object'
        ),
      };
    }

    const request = parsed as JsonRpcRequest | JsonRpcNotification;
    if (isNotification(request)) {
      return { type: 'notification', notification: request };
    }

    return { type: 'request', request: request as JsonRpcRequest };
  }

  /**
   * Process a complete message string
   */
  async processMessage(message: string): Promise<JsonRpcResponse[]> {
    const parsed = this.parseMessage(message);

    switch (parsed.type) {
      case 'error':
        return [createErrorResponse(parsed.error, null)];

      case 'notification':
        // Process notification but don't return response
        await this.routeRequest(parsed.notification);
        return [];

      case 'request':
        return [await this.routeRequest(parsed.request)];

      case 'batch':
        return this.processBatch(parsed.requests);
    }
  }

  /**
   * Route request to appropriate service handler
   */
  async routeRequest(
    request: JsonRpcRequest | JsonRpcNotification
  ): Promise<JsonRpcResponse> {
    const id = 'id' in request ? request.id ?? null : null;

    try {
      // Extract service and method names
      const serviceName = extractServiceName(request.method);
      const methodName = extractMethodName(request.method);

      // Find service
      const service = this.serviceRegistry.getService(serviceName);
      if (!service) {
        return createErrorResponse(
          createRpcError(
            RpcErrorCode.METHOD_NOT_FOUND,
            `Service '${serviceName}' not found`
          ),
          id
        );
      }

      // Check if method is supported
      if (service.methods.length > 0 && !service.methods.includes(methodName)) {
        return createErrorResponse(
          createRpcError(
            RpcErrorCode.METHOD_NOT_FOUND,
            `Method '${request.method}' not found`
          ),
          id
        );
      }

      // Call service handler
      const result = await service.handler(methodName, request.params);
      return createSuccessResponse(result, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(
        createRpcError(RpcErrorCode.INTERNAL_ERROR, message),
        id
      );
    }
  }

  /**
   * Process batch of requests
   */
  async processBatch(
    requests: (JsonRpcRequest | JsonRpcNotification)[]
  ): Promise<JsonRpcResponse[]> {
    const responses: JsonRpcResponse[] = [];

    for (const request of requests) {
      if (isNotification(request)) {
        // Process notification but don't add to responses
        await this.routeRequest(request);
      } else {
        responses.push(await this.routeRequest(request));
      }
    }

    return responses;
  }

  /**
   * Format response to string
   */
  formatResponse(response: JsonRpcResponse): string {
    return JSON.stringify(response) + MESSAGE_DELIMITER;
  }

  /**
   * Format batch responses to string
   */
  formatBatchResponse(responses: JsonRpcResponse[]): string {
    if (responses.length === 0) {
      return '';
    }
    if (responses.length === 1) {
      return this.formatResponse(responses[0]);
    }
    return JSON.stringify(responses) + MESSAGE_DELIMITER;
  }

  /**
   * Create parse error response (for invalid JSON)
   */
  static createParseError(): JsonRpcResponse {
    return createErrorResponse(
      createRpcError(RpcErrorCode.PARSE_ERROR),
      null
    );
  }

  /**
   * Create invalid request error response
   */
  static createInvalidRequestError(
    id: string | number | null = null
  ): JsonRpcResponse {
    return createErrorResponse(
      createRpcError(RpcErrorCode.INVALID_REQUEST),
      id
    );
  }

  /**
   * Create method not found error response
   */
  static createMethodNotFoundError(
    method: string,
    id: string | number | null
  ): JsonRpcResponse {
    return createErrorResponse(
      createRpcError(
        RpcErrorCode.METHOD_NOT_FOUND,
        `Method '${method}' not found`
      ),
      id
    );
  }

  /**
   * Create internal error response
   */
  static createInternalError(
    message: string,
    id: string | number | null
  ): JsonRpcResponse {
    return createErrorResponse(
      createRpcError(RpcErrorCode.INTERNAL_ERROR, message),
      id
    );
  }
}
