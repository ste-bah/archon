/**
 * Memory IPC Protocol
 * MEM-001 - Serialization and message handling for multi-process memory
 *
 * Protocol: Newline-delimited JSON (NDJSON) over stream
 * Each message is a single JSON object followed by \n
 */

import { randomUUID } from 'crypto';
import type {
  IMemoryRequest,
  IMemoryResponse,
  MemoryMethod,
  IMemoryErrorInfo,
  IStoreKnowledgeParams,
  IGetKnowledgeByDomainParams,
  IGetKnowledgeByTagsParams,
  IDeleteKnowledgeParams,
  IProvideFeedbackParams,
  IQueryPatternsParams,
} from '../types/memory-types.js';
import { InvalidRequestError, ValidationError } from './memory-errors.js';

// ==================== Message Creation ====================

/**
 * Create a new request message
 */
export function createRequest<T>(method: MemoryMethod, params: T): IMemoryRequest<T> {
  return {
    id: randomUUID(),
    type: 'request',
    method,
    params,
  };
}

/**
 * Create a success response
 */
export function createSuccessResponse<T>(requestId: string, result: T): IMemoryResponse<T> {
  return {
    id: requestId,
    type: 'response',
    success: true,
    result,
    error: null,
  };
}

/**
 * Create an error response
 */
export function createErrorResponse(
  requestId: string,
  error: IMemoryErrorInfo
): IMemoryResponse<null> {
  return {
    id: requestId,
    type: 'response',
    success: false,
    result: null,
    error,
  };
}

// ==================== Serialization ====================

/**
 * Serialize message to NDJSON format (with trailing newline)
 */
export function serializeMessage<T>(message: IMemoryRequest<T> | IMemoryResponse<T>): string {
  return JSON.stringify(message) + '\n';
}

/**
 * Parse a single message from JSON string
 * Throws InvalidRequestError if malformed
 */
export function parseMessage(data: string): IMemoryRequest | IMemoryResponse {
  const trimmed = data.trim();
  if (!trimmed) {
    throw new InvalidRequestError('Empty message');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new InvalidRequestError(`Invalid JSON: ${(e as Error).message}`, {
      data: trimmed.slice(0, 100),
    });
  }

  if (!isValidMessage(parsed)) {
    throw new InvalidRequestError('Invalid message structure', { data: parsed });
  }

  return parsed;
}

/**
 * Type guard for valid message structure
 */
function isValidMessage(data: unknown): data is IMemoryRequest | IMemoryResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;

  if (typeof msg.id !== 'string' || typeof msg.type !== 'string') {
    return false;
  }

  if (msg.type === 'request') {
    return typeof msg.method === 'string' && 'params' in msg;
  }

  if (msg.type === 'response') {
    return typeof msg.success === 'boolean' && ('result' in msg || 'error' in msg);
  }

  return false;
}

/**
 * Check if message is a request
 */
export function isRequest(message: IMemoryRequest | IMemoryResponse): message is IMemoryRequest {
  return message.type === 'request';
}

/**
 * Check if message is a response
 */
export function isResponse(
  message: IMemoryRequest | IMemoryResponse
): message is IMemoryResponse {
  return message.type === 'response';
}

// ==================== Stream Parsing ====================

/**
 * Message buffer for parsing NDJSON stream
 * Handles partial messages and multiple messages per chunk
 */
export class MessageBuffer {
  private buffer = '';

  /**
   * Add data to buffer and extract complete messages
   */
  push(chunk: string): (IMemoryRequest | IMemoryResponse)[] {
    this.buffer += chunk;
    const messages: (IMemoryRequest | IMemoryResponse)[] = [];

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        messages.push(parseMessage(line));
      }
    }

    return messages;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Check if buffer has partial data
   */
  hasPartial(): boolean {
    return this.buffer.trim().length > 0;
  }
}

// ==================== Parameter Validation ====================

const VALID_METHODS: Set<MemoryMethod> = new Set([
  'storeKnowledge',
  'getKnowledgeByDomain',
  'getKnowledgeByTags',
  'deleteKnowledge',
  'provideFeedback',
  'queryPatterns',
  'getStatus',
  'ping',
]);

/**
 * Check if method name is valid
 */
export function isValidMethod(method: string): method is MemoryMethod {
  return VALID_METHODS.has(method as MemoryMethod);
}

/**
 * Validate request parameters based on method
 */
export function validateParams(method: MemoryMethod, params: unknown): void {
  switch (method) {
    case 'storeKnowledge':
      validateStoreKnowledgeParams(params);
      break;
    case 'getKnowledgeByDomain':
      validateGetKnowledgeByDomainParams(params);
      break;
    case 'getKnowledgeByTags':
      validateGetKnowledgeByTagsParams(params);
      break;
    case 'deleteKnowledge':
      validateDeleteKnowledgeParams(params);
      break;
    case 'provideFeedback':
      validateProvideFeedbackParams(params);
      break;
    case 'queryPatterns':
      validateQueryPatternsParams(params);
      break;
    case 'getStatus':
    case 'ping':
      // No params required
      break;
    default:
      // TypeScript ensures exhaustive check
      throw new ValidationError(`Unknown method: ${method}`);
  }
}

function validateStoreKnowledgeParams(params: unknown): asserts params is IStoreKnowledgeParams {
  if (typeof params !== 'object' || params === null) {
    throw new ValidationError('params must be an object');
  }

  const p = params as Record<string, unknown>;

  if (typeof p.content !== 'string' || !p.content.trim()) {
    throw new ValidationError('content is required and must be a non-empty string');
  }
  if (typeof p.category !== 'string' || !p.category.trim()) {
    throw new ValidationError('category is required and must be a non-empty string');
  }
  if (typeof p.domain !== 'string' || !p.domain.trim()) {
    throw new ValidationError('domain is required and must be a non-empty string');
  }
  if (p.tags !== undefined && !Array.isArray(p.tags)) {
    throw new ValidationError('tags must be an array if provided');
  }
  if (p.quality !== undefined && (typeof p.quality !== 'number' || p.quality < 0 || p.quality > 1)) {
    throw new ValidationError('quality must be a number between 0 and 1');
  }
}

function validateGetKnowledgeByDomainParams(
  params: unknown
): asserts params is IGetKnowledgeByDomainParams {
  if (typeof params !== 'object' || params === null) {
    throw new ValidationError('params must be an object');
  }

  const p = params as Record<string, unknown>;

  if (typeof p.domain !== 'string' || !p.domain.trim()) {
    throw new ValidationError('domain is required and must be a non-empty string');
  }
  if (p.limit !== undefined && (typeof p.limit !== 'number' || p.limit < 1)) {
    throw new ValidationError('limit must be a positive number');
  }
}

function validateGetKnowledgeByTagsParams(
  params: unknown
): asserts params is IGetKnowledgeByTagsParams {
  if (typeof params !== 'object' || params === null) {
    throw new ValidationError('params must be an object');
  }

  const p = params as Record<string, unknown>;

  if (!Array.isArray(p.tags) || p.tags.length === 0) {
    throw new ValidationError('tags is required and must be a non-empty array');
  }
  if (!p.tags.every((t: unknown) => typeof t === 'string')) {
    throw new ValidationError('tags must be an array of strings');
  }
  if (p.limit !== undefined && (typeof p.limit !== 'number' || p.limit < 1)) {
    throw new ValidationError('limit must be a positive number');
  }
}

function validateDeleteKnowledgeParams(
  params: unknown
): asserts params is IDeleteKnowledgeParams {
  if (typeof params !== 'object' || params === null) {
    throw new ValidationError('params must be an object');
  }

  const p = params as Record<string, unknown>;

  if (typeof p.id !== 'string' || !p.id.trim()) {
    throw new ValidationError('id is required and must be a non-empty string');
  }
}

function validateProvideFeedbackParams(
  params: unknown
): asserts params is IProvideFeedbackParams {
  if (typeof params !== 'object' || params === null) {
    throw new ValidationError('params must be an object');
  }

  const p = params as Record<string, unknown>;

  if (typeof p.trajectoryId !== 'string' || !p.trajectoryId.trim()) {
    throw new ValidationError('trajectoryId is required and must be a non-empty string');
  }
  if (typeof p.quality !== 'number' || p.quality < 0 || p.quality > 1) {
    throw new ValidationError('quality is required and must be a number between 0 and 1');
  }
  if (!['positive', 'negative', 'neutral'].includes(p.outcome as string)) {
    throw new ValidationError('outcome must be "positive", "negative", or "neutral"');
  }
}

function validateQueryPatternsParams(
  params: unknown
): asserts params is IQueryPatternsParams {
  if (typeof params !== 'object' || params === null) {
    throw new ValidationError('params must be an object');
  }

  const p = params as Record<string, unknown>;

  if (typeof p.query !== 'string' && !Array.isArray(p.query)) {
    throw new ValidationError('query is required and must be a string or number array');
  }
  if (Array.isArray(p.query) && !p.query.every((n: unknown) => typeof n === 'number')) {
    throw new ValidationError('query array must contain only numbers');
  }
  if (p.type !== undefined && !['semantic', 'hybrid', 'pattern-match'].includes(p.type as string)) {
    throw new ValidationError('type must be "semantic", "hybrid", or "pattern-match"');
  }
  if (p.maxResults !== undefined && (typeof p.maxResults !== 'number' || p.maxResults < 1)) {
    throw new ValidationError('maxResults must be a positive number');
  }
  if (
    p.confidenceThreshold !== undefined &&
    (typeof p.confidenceThreshold !== 'number' ||
      p.confidenceThreshold < 0 ||
      p.confidenceThreshold > 1)
  ) {
    throw new ValidationError('confidenceThreshold must be a number between 0 and 1');
  }
}
