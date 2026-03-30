/**
 * MessageHandler Tests
 *
 * PRD: PRD-GOD-AGENT-001
 * Task: TASK-DAEMON-002
 *
 * Test cases as specified:
 * - TC-D2-001: Valid request parsing
 * - TC-D2-002: Invalid JSON handling
 * - TC-D2-003: Batch request support
 * - TC-D2-004: Error response format
 * - TC-D2-005: Notification handling
 * - TC-D2-006: Incomplete message buffering
 * - TC-D2-007: Invalid request structure
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageHandler } from '../../../../src/god-agent/core/daemon/message-handler.js';
import {
  RpcErrorCode,
  createRpcError,
  isValidRequest,
  isBatchRequest,
  isNotification,
  extractServiceName,
  extractMethodName,
  isValidMethodName,
  JSONRPC_VERSION,
  MAX_MESSAGE_SIZE,
  MESSAGE_DELIMITER,
} from '../../../../src/god-agent/core/daemon/protocol-types.js';

// Mock service registry
const createMockRegistry = () => {
  const handler = vi.fn().mockResolvedValue({ success: true });
  return {
    getService: vi.fn((name: string) => {
      if (name === 'search') {
        return {
          name: 'search',
          handler,
          methods: ['query', 'suggest'],
        };
      }
      if (name === 'echo') {
        return {
          name: 'echo',
          handler: vi.fn().mockImplementation((_method, params) => params),
          methods: [],
        };
      }
      return undefined;
    }),
    handler,
  };
};

describe('MessageHandler', () => {
  let handler: MessageHandler;
  let mockRegistry: ReturnType<typeof createMockRegistry>;

  beforeEach(() => {
    mockRegistry = createMockRegistry();
    handler = new MessageHandler(mockRegistry);
  });

  describe('TC-D2-001: Valid request parsing', () => {
    it('should parse valid JSON-RPC request', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'search.query',
        params: { query: 'test' },
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses).toHaveLength(1);
      expect(responses[0].jsonrpc).toBe('2.0');
      expect(responses[0].id).toBe(1);
      expect(responses[0].result).toEqual({ success: true });
      expect(responses[0].error).toBeUndefined();
    });

    it('should preserve request ID in response', async () => {
      const requestWithStringId = {
        jsonrpc: '2.0',
        method: 'search.query',
        id: 'request-123',
      };

      const responses = await handler.processMessage(
        JSON.stringify(requestWithStringId)
      );

      expect(responses[0].id).toBe('request-123');
    });

    it('should extract correct method name', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'search.query',
        params: { q: 'test' },
        id: 1,
      };

      await handler.processMessage(JSON.stringify(request));

      expect(mockRegistry.handler).toHaveBeenCalledWith('query', { q: 'test' });
    });

    it('should handle requests without params', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'search.query',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].result).toEqual({ success: true });
    });
  });

  describe('TC-D2-002: Invalid JSON handling', () => {
    it('should return parse error for invalid JSON', async () => {
      const responses = await handler.processMessage('{invalid json}');

      expect(responses).toHaveLength(1);
      expect(responses[0].error).toBeDefined();
      expect(responses[0].error?.code).toBe(RpcErrorCode.PARSE_ERROR);
      expect(responses[0].id).toBeNull();
    });

    it('should return parse error for truncated JSON', async () => {
      const responses = await handler.processMessage('{"jsonrpc": "2.0", "method":');

      expect(responses[0].error?.code).toBe(RpcErrorCode.PARSE_ERROR);
    });

    it('should include descriptive error message', async () => {
      const responses = await handler.processMessage('not json at all');

      expect(responses[0].error?.message).toContain('Invalid JSON');
    });
  });

  describe('TC-D2-003: Batch request support', () => {
    it('should process batch requests', async () => {
      const batch = [
        { jsonrpc: '2.0', method: 'search.query', id: 1 },
        { jsonrpc: '2.0', method: 'search.suggest', id: 2 },
      ];

      const responses = await handler.processMessage(JSON.stringify(batch));

      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe(1);
      expect(responses[1].id).toBe(2);
    });

    it('should preserve order in batch responses', async () => {
      const batch = [
        { jsonrpc: '2.0', method: 'search.query', id: 'first' },
        { jsonrpc: '2.0', method: 'search.query', id: 'second' },
        { jsonrpc: '2.0', method: 'search.query', id: 'third' },
      ];

      const responses = await handler.processMessage(JSON.stringify(batch));

      expect(responses.map((r) => r.id)).toEqual(['first', 'second', 'third']);
    });

    it('should handle empty batch', async () => {
      const responses = await handler.processMessage('[]');

      // Empty array is invalid request
      expect(responses[0].error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
    });

    it('should reject batch with invalid request', async () => {
      const batch = [
        { jsonrpc: '2.0', method: 'search.query', id: 1 },
        { jsonrpc: '1.0', method: 'invalid' }, // Wrong version
      ];

      const responses = await handler.processMessage(JSON.stringify(batch));

      expect(responses[0].error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
    });
  });

  describe('TC-D2-004: Error response format', () => {
    it('should format method not found error correctly', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'nonexistent.method',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].jsonrpc).toBe('2.0');
      expect(responses[0].error).toEqual({
        code: RpcErrorCode.METHOD_NOT_FOUND,
        message: expect.stringContaining('not found'),
      });
      expect(responses[0].id).toBe(1);
      expect(responses[0].result).toBeUndefined();
    });

    it('should preserve original request ID in error', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'unknown.method',
        id: 'error-test-123',
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].id).toBe('error-test-123');
    });

    it('should use proper error codes', async () => {
      expect(RpcErrorCode.PARSE_ERROR).toBe(-32700);
      expect(RpcErrorCode.INVALID_REQUEST).toBe(-32600);
      expect(RpcErrorCode.METHOD_NOT_FOUND).toBe(-32601);
      expect(RpcErrorCode.INVALID_PARAMS).toBe(-32602);
      expect(RpcErrorCode.INTERNAL_ERROR).toBe(-32603);
    });
  });

  describe('TC-D2-005: Notification handling', () => {
    it('should process notification without returning response', async () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'search.query',
        params: { notify: true },
      };

      const responses = await handler.processMessage(
        JSON.stringify(notification)
      );

      expect(responses).toHaveLength(0);
    });

    it('should still execute notification handler', async () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'search.query',
        params: { data: 'notification-data' },
      };

      await handler.processMessage(JSON.stringify(notification));

      expect(mockRegistry.handler).toHaveBeenCalledWith('query', {
        data: 'notification-data',
      });
    });

    it('should handle notifications in batch', async () => {
      const batch = [
        { jsonrpc: '2.0', method: 'search.query' }, // notification
        { jsonrpc: '2.0', method: 'search.query', id: 1 }, // request
        { jsonrpc: '2.0', method: 'search.suggest' }, // notification
      ];

      const responses = await handler.processMessage(JSON.stringify(batch));

      // Only the request with id should have a response
      expect(responses).toHaveLength(1);
      expect(responses[0].id).toBe(1);
    });
  });

  describe('TC-D2-006: Incomplete message buffering', () => {
    it('should accumulate partial messages', async () => {
      const clientId = 'client-1';
      const fullMessage = '{"jsonrpc":"2.0","method":"search.query","id":1}';

      // Send first half
      const responses1 = await handler.processData(
        clientId,
        Buffer.from(fullMessage.substring(0, 20))
      );
      expect(responses1).toHaveLength(0);

      // Send second half with delimiter
      const responses2 = await handler.processData(
        clientId,
        Buffer.from(fullMessage.substring(20) + '\n')
      );
      expect(responses2).toHaveLength(1);
      expect(responses2[0].id).toBe(1);
    });

    it('should handle multiple messages in single buffer', async () => {
      const clientId = 'client-1';
      const messages = [
        '{"jsonrpc":"2.0","method":"search.query","id":1}',
        '{"jsonrpc":"2.0","method":"search.query","id":2}',
      ].join('\n') + '\n';

      const responses = await handler.processData(
        clientId,
        Buffer.from(messages)
      );

      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe(1);
      expect(responses[1].id).toBe(2);
    });

    it('should handle split across multiple writes', async () => {
      const clientId = 'client-1';
      const message = '{"jsonrpc":"2.0","method":"search.query","id":1}\n';

      // Split into 3 parts
      const part1 = message.substring(0, 15);
      const part2 = message.substring(15, 35);
      const part3 = message.substring(35);

      const r1 = await handler.processData(clientId, Buffer.from(part1));
      expect(r1).toHaveLength(0);

      const r2 = await handler.processData(clientId, Buffer.from(part2));
      expect(r2).toHaveLength(0);

      const r3 = await handler.processData(clientId, Buffer.from(part3));
      expect(r3).toHaveLength(1);
    });

    it('should clear buffer for client', () => {
      const clientId = 'client-1';
      handler.processData(clientId, Buffer.from('partial data'));
      handler.clearBuffer(clientId);
      // No error - buffer cleared successfully
    });
  });

  describe('TC-D2-007: Invalid request structure', () => {
    it('should reject request missing method field', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
    });

    it('should reject request with wrong jsonrpc version', async () => {
      const request = {
        jsonrpc: '1.0',
        method: 'search.query',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
    });

    it('should reject request without jsonrpc field', async () => {
      const request = {
        method: 'search.query',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
    });

    it('should reject request with empty method', async () => {
      const request = {
        jsonrpc: '2.0',
        method: '',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
    });
  });

  describe('service routing', () => {
    it('should route to correct service', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'search.query',
        id: 1,
      };

      await handler.processMessage(JSON.stringify(request));

      expect(mockRegistry.getService).toHaveBeenCalledWith('search');
    });

    it('should return error for unknown service', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'unknown.method',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.METHOD_NOT_FOUND);
      expect(responses[0].error?.message).toContain("'unknown'");
    });

    it('should return error for unsupported method', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'search.unsupported',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.METHOD_NOT_FOUND);
    });

    it('should handle service handler errors', async () => {
      mockRegistry.handler.mockRejectedValueOnce(new Error('Service error'));

      const request = {
        jsonrpc: '2.0',
        method: 'search.query',
        id: 1,
      };

      const responses = await handler.processMessage(JSON.stringify(request));

      expect(responses[0].error?.code).toBe(RpcErrorCode.INTERNAL_ERROR);
      expect(responses[0].error?.message).toContain('Service error');
    });
  });

  describe('response formatting', () => {
    it('should format single response with delimiter', () => {
      const response = {
        jsonrpc: '2.0' as const,
        result: { data: 'test' },
        id: 1,
      };

      const formatted = handler.formatResponse(response);

      expect(formatted).toContain('"jsonrpc":"2.0"');
      expect(formatted).toContain('"result":{"data":"test"}');
      expect(formatted.endsWith('\n')).toBe(true);
    });

    it('should format batch responses', () => {
      const responses = [
        { jsonrpc: '2.0' as const, result: 'a', id: 1 },
        { jsonrpc: '2.0' as const, result: 'b', id: 2 },
      ];

      const formatted = handler.formatBatchResponse(responses);

      expect(formatted.startsWith('[')).toBe(true);
      expect(formatted).toContain('"id":1');
      expect(formatted).toContain('"id":2');
      expect(formatted.endsWith('\n')).toBe(true);
    });

    it('should return empty string for empty batch', () => {
      expect(handler.formatBatchResponse([])).toBe('');
    });

    it('should format single item batch as single response', () => {
      const responses = [
        { jsonrpc: '2.0' as const, result: 'only', id: 1 },
      ];

      const formatted = handler.formatBatchResponse(responses);

      // Single response, not array
      expect(formatted.startsWith('[')).toBe(false);
      expect(formatted).toContain('"id":1');
    });
  });

  describe('static error helpers', () => {
    it('should create parse error', () => {
      const error = MessageHandler.createParseError();

      expect(error.error?.code).toBe(RpcErrorCode.PARSE_ERROR);
      expect(error.id).toBeNull();
    });

    it('should create invalid request error', () => {
      const error = MessageHandler.createInvalidRequestError(123);

      expect(error.error?.code).toBe(RpcErrorCode.INVALID_REQUEST);
      expect(error.id).toBe(123);
    });

    it('should create method not found error', () => {
      const error = MessageHandler.createMethodNotFoundError('test.method', 1);

      expect(error.error?.code).toBe(RpcErrorCode.METHOD_NOT_FOUND);
      expect(error.error?.message).toContain('test.method');
    });

    it('should create internal error', () => {
      const error = MessageHandler.createInternalError('Something broke', 1);

      expect(error.error?.code).toBe(RpcErrorCode.INTERNAL_ERROR);
      expect(error.error?.message).toBe('Something broke');
    });
  });
});

describe('protocol-types', () => {
  describe('constants', () => {
    it('should have correct JSONRPC_VERSION', () => {
      expect(JSONRPC_VERSION).toBe('2.0');
    });

    it('should have 10MB max message size', () => {
      expect(MAX_MESSAGE_SIZE).toBe(10 * 1024 * 1024);
    });

    it('should use newline as delimiter', () => {
      expect(MESSAGE_DELIMITER).toBe('\n');
    });
  });

  describe('isValidRequest', () => {
    it('should accept valid request', () => {
      expect(
        isValidRequest({
          jsonrpc: '2.0',
          method: 'test',
          id: 1,
        })
      ).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidRequest(null)).toBe(false);
    });

    it('should reject wrong version', () => {
      expect(
        isValidRequest({
          jsonrpc: '1.0',
          method: 'test',
        })
      ).toBe(false);
    });

    it('should reject missing method', () => {
      expect(
        isValidRequest({
          jsonrpc: '2.0',
          id: 1,
        })
      ).toBe(false);
    });
  });

  describe('isBatchRequest', () => {
    it('should accept non-empty array', () => {
      expect(isBatchRequest([{ test: true }])).toBe(true);
    });

    it('should reject empty array', () => {
      expect(isBatchRequest([])).toBe(false);
    });

    it('should reject non-array', () => {
      expect(isBatchRequest({ test: true })).toBe(false);
    });
  });

  describe('isNotification', () => {
    it('should return true for request without id', () => {
      expect(
        isNotification({
          jsonrpc: '2.0',
          method: 'test',
        })
      ).toBe(true);
    });

    it('should return false for request with id', () => {
      expect(
        isNotification({
          jsonrpc: '2.0',
          method: 'test',
          id: 1,
        })
      ).toBe(false);
    });
  });

  describe('extractServiceName', () => {
    it('should extract service from dotted method', () => {
      expect(extractServiceName('search.query')).toBe('search');
    });

    it('should return full method if no dot', () => {
      expect(extractServiceName('ping')).toBe('ping');
    });

    it('should handle multiple dots', () => {
      expect(extractServiceName('a.b.c')).toBe('a');
    });
  });

  describe('extractMethodName', () => {
    it('should extract method from dotted string', () => {
      expect(extractMethodName('search.query')).toBe('query');
    });

    it('should return full string if no dot', () => {
      expect(extractMethodName('ping')).toBe('ping');
    });

    it('should handle multiple dots', () => {
      expect(extractMethodName('a.b.c')).toBe('b.c');
    });
  });

  describe('isValidMethodName', () => {
    it('should accept simple name', () => {
      expect(isValidMethodName('test')).toBe(true);
    });

    it('should accept dotted name', () => {
      expect(isValidMethodName('search.query')).toBe(true);
    });

    it('should accept underscores', () => {
      expect(isValidMethodName('my_method')).toBe(true);
    });

    it('should reject starting with number', () => {
      expect(isValidMethodName('1method')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidMethodName('')).toBe(false);
    });
  });

  describe('createRpcError', () => {
    it('should create error with default message', () => {
      const error = createRpcError(RpcErrorCode.PARSE_ERROR);

      expect(error.code).toBe(RpcErrorCode.PARSE_ERROR);
      expect(error.message).toBe('Parse error');
    });

    it('should use custom message', () => {
      const error = createRpcError(
        RpcErrorCode.INTERNAL_ERROR,
        'Custom message'
      );

      expect(error.message).toBe('Custom message');
    });

    it('should include data if provided', () => {
      const error = createRpcError(
        RpcErrorCode.INVALID_PARAMS,
        'Bad params',
        { field: 'name' }
      );

      expect(error.data).toEqual({ field: 'name' });
    });
  });
});
