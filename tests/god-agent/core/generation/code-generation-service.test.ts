/**
 * CodeGenerationService Tests
 * SPEC-COD-001.3: Test Code Generation Service
 *
 * Comprehensive tests for production-ready code generation service
 * using Anthropic SDK with quality assessment and pattern synthesis.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  CodeGenerationService,
  type ICodeGenerationRequest,
  type ICodeGenerationResult
} from '../../../../src/god-agent/core/generation/code-generation-service.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      }
    }))
  };
});

describe('CodeGenerationService', () => {
  let service: CodeGenerationService;
  let mockClient: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize without API key', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const serviceNoKey = new CodeGenerationService();

      expect(serviceNoKey).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No API key provided')
      );

      warnSpy.mockRestore();
    });

    it('should initialize with API key from constructor', () => {
      const serviceWithKey = new CodeGenerationService('test-api-key');

      expect(serviceWithKey).toBeDefined();
      expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    });

    it('should initialize with API key from environment', () => {
      process.env.ANTHROPIC_API_KEY = 'env-api-key';
      const serviceWithEnv = new CodeGenerationService();

      expect(serviceWithEnv).toBeDefined();
      expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'env-api-key' });

      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe('assessQuality', () => {
    beforeEach(() => {
      service = new CodeGenerationService();
    });

    it('should score well-formatted code highly', async () => {
      const wellFormattedCode = `
/**
 * User service for handling user operations
 */
export class UserService {
  /**
   * Create a new user
   */
  async createUser(userData: UserData): Promise<User> {
    try {
      // Validate input
      if (!userData.email) {
        throw new Error('Email is required');
      }

      // Create user
      const user = await this.repository.save(userData);
      return user;
    } catch (error) {
      throw new Error(\`Failed to create user: \${error}\`);
    }
  }
}
`.trim();

      const score = await service.assessQuality(wellFormattedCode, 'typescript');

      // Should have high score due to:
      // - Proper indentation
      // - Comments/documentation
      // - No debug logging
      // - Error handling (try/catch)
      // - Type annotations
      // - Reasonable length
      // - No hardcoded secrets
      // - Uses const/let (implicitly)
      // - Has class structure
      expect(score).toBeGreaterThan(0.8);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('should penalize code with debug logging', async () => {
      const codeWithDebug = `
function test() {
  console.log('debug message');
  console.debug('another debug');
  return true;
}
`.trim();

      const codeWithoutDebug = `
/**
 * Test function
 */
function test() {
  try {
    return true;
  } catch (error) {
    throw error;
  }
}
`.trim();

      const scoreWithDebug = await service.assessQuality(codeWithDebug, 'javascript');
      const scoreWithoutDebug = await service.assessQuality(codeWithoutDebug, 'javascript');

      // Code without debug logging should score higher (has comments, error handling, structure)
      expect(scoreWithoutDebug).toBeGreaterThan(scoreWithDebug);
    });

    it('should penalize code without error handling', async () => {
      const codeWithoutErrorHandling = `
function processData(data) {
  const result = data.map(x => x * 2);
  return result;
}
`.trim();

      const codeWithErrorHandling = `
function processData(data) {
  try {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array');
    }
    const result = data.map(x => x * 2);
    return result;
  } catch (error) {
    console.error('Error processing data:', error);
    throw error;
  }
}
`.trim();

      const scoreWithoutError = await service.assessQuality(codeWithoutErrorHandling, 'javascript');
      const scoreWithError = await service.assessQuality(codeWithErrorHandling, 'javascript');

      // Code with error handling should score higher
      expect(scoreWithError).toBeGreaterThan(scoreWithoutError);
    });

    it('should detect hardcoded secrets', async () => {
      const codeWithSecrets = `
const config = {
  apiKey: "sk-1234567890abcdef",
  password: "SuperSecret123!",
  api_key: "secret-token-here"
};
`.trim();

      const codeWithoutSecrets = `
const config = {
  apiKey: process.env.API_KEY,
  password: process.env.PASSWORD,
  api_key: process.env.API_KEY
};
`.trim();

      const scoreWithSecrets = await service.assessQuality(codeWithSecrets, 'javascript');
      const scoreWithoutSecrets = await service.assessQuality(codeWithoutSecrets, 'javascript');

      // Code without hardcoded secrets should score higher
      expect(scoreWithoutSecrets).toBeGreaterThan(scoreWithSecrets);
    });

    it('should reward type annotations', async () => {
      const typedCode = `
function add(a: number, b: number): number {
  return a + b;
}

interface User {
  name: string;
  age: number;
}

const getUser = (): User => {
  return { name: 'John', age: 30 };
};
`.trim();

      const untypedCode = `
function add(a, b) {
  return a + b;
}

const getUser = () => {
  return { name: 'John', age: 30 };
};
`.trim();

      const typedScore = await service.assessQuality(typedCode, 'typescript');
      const untypedScore = await service.assessQuality(untypedCode, 'javascript');

      // TypeScript code with types should score higher
      expect(typedScore).toBeGreaterThan(untypedScore);
    });

    it('should return score between 0 and 1', async () => {
      const testCases = [
        '', // Empty
        'const x = 1;', // Minimal
        'console.log("test");'.repeat(100), // Repetitive
        `
/**
 * Complex well-structured code
 */
export class Example {
  private readonly data: string[];

  constructor() {
    this.data = [];
  }

  /**
   * Process data with error handling
   */
  async process(): Promise<void> {
    try {
      // Implementation
    } catch (error) {
      throw new Error('Processing failed');
    }
  }
}
`.trim() // High quality
      ];

      for (const code of testCases) {
        const score = await service.assessQuality(code, 'typescript');
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('should handle empty code gracefully', async () => {
      const score = await service.assessQuality('', 'typescript');
      expect(score).toBe(0);
    });

    it('should handle Python type annotations', async () => {
      const pythonTypedCode = `
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b

class User:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age

    def get_info(self) -> str:
        return f"{self.name} ({self.age})"
`.trim();

      const score = await service.assessQuality(pythonTypedCode, 'python');

      // Should recognize Python type annotations
      expect(score).toBeGreaterThan(0.5);
    });
  });

  describe('synthesizeFromPatterns', () => {
    beforeEach(() => {
      service = new CodeGenerationService();
    });

    it('should generate TypeScript template', () => {
      const request: ICodeGenerationRequest = {
        prompt: 'Create a user authentication service',
        language: 'typescript'
      };

      const result = service.synthesizeFromPatterns([], request);

      expect(result.code).toContain('export class GeneratedClass');
      expect(result.code).toContain('constructor()');
      expect(result.code).toContain('public execute(): IExecutionResult');
      expect(result.code).toContain('export interface IExecutionResult');
      expect(result.language).toBe('typescript');
      expect(result.metadata.source).toBe('pattern');
      expect(result.metadata.model).toBe('pattern-synthesis');
    });

    it('should generate JavaScript template', () => {
      const request: ICodeGenerationRequest = {
        prompt: 'Create a data processor',
        language: 'javascript'
      };

      const result = service.synthesizeFromPatterns([], request);

      expect(result.code).toContain('class GeneratedClass');
      expect(result.code).toContain('constructor()');
      expect(result.code).toContain('execute()');
      expect(result.code).toContain('module.exports');
      expect(result.language).toBe('javascript');
    });

    it('should generate Python template', () => {
      const request: ICodeGenerationRequest = {
        prompt: 'Create a file processor',
        language: 'python'
      };

      const result = service.synthesizeFromPatterns([], request);

      expect(result.code).toContain('class GeneratedClass:');
      expect(result.code).toContain('def __init__(self):');
      expect(result.code).toContain('def execute(self) -> Dict[str, Any]:');
      expect(result.code).toContain('if __name__ == \'__main__\':');
      expect(result.code).toContain('from typing import Dict, Any');
      expect(result.language).toBe('python');
    });

    it('should include prompt context in output', () => {
      const prompt = 'Create a complex authentication system';
      const request: ICodeGenerationRequest = {
        prompt,
        language: 'typescript'
      };

      const result = service.synthesizeFromPatterns([], request);

      expect(result.code).toContain(prompt);
      expect(result.explanation).toContain('pattern synthesis');
    });

    it('should set source as pattern in metadata', () => {
      const request: ICodeGenerationRequest = {
        prompt: 'Test',
        language: 'typescript'
      };

      const result = service.synthesizeFromPatterns([], request);

      expect(result.metadata.source).toBe('pattern');
      expect(result.metadata.tokensUsed).toBe(0);
      expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should default to TypeScript for unknown languages', () => {
      const request: ICodeGenerationRequest = {
        prompt: 'Test',
        language: 'unknown-lang'
      };

      const result = service.synthesizeFromPatterns([], request);

      // Should use TypeScript template (has export, interface, result type)
      expect(result.code).toContain('export class GeneratedClass');
      expect(result.code).toContain('public execute(): IExecutionResult');
      expect(result.code).toContain('export default GeneratedClass');
    });

    it('should have lower quality score for synthesized code', () => {
      const request: ICodeGenerationRequest = {
        prompt: 'Test',
        language: 'typescript'
      };

      const result = service.synthesizeFromPatterns([], request);

      expect(result.qualityScore).toBe(0.4);
    });
  });

  describe('generateCode', () => {
    it('should call API when key available', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '```typescript\nfunction test() {\n  return true;\n}\n```'
          }
        ],
        model: 'claude-3-haiku-20240307',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      };

      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue(mockResponse)
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Create a test function',
        language: 'typescript',
        maxTokens: 2048
      };

      const result = await service.generateCode(request);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-haiku-20240307',
          max_tokens: 2048,
          system: expect.stringContaining('production-ready'),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Create a test function')
            })
          ])
        })
      );

      expect(result.code).toContain('function test()');
      expect(result.metadata.source).toBe('api');
      expect(result.metadata.tokensUsed).toBe(150); // 100 + 50
    });

    it('should fallback to pattern synthesis without key', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      service = new CodeGenerationService();

      const request: ICodeGenerationRequest = {
        prompt: 'Create a test function',
        language: 'typescript'
      };

      const result = await service.generateCode(request);

      expect(result.metadata.source).toBe('pattern');
      expect(result.code).toContain('GeneratedClass');
    });

    it('should handle API errors gracefully', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API Error'))
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Create a test function',
        language: 'typescript'
      };

      const result = await service.generateCode(request);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('API call failed'),
        expect.any(Error)
      );

      // Should fallback to pattern synthesis
      expect(result.metadata.source).toBe('pattern');
      expect(result.code).toBeDefined();

      errorSpy.mockRestore();
    });

    it('should include quality score in result', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `\`\`\`typescript
/**
 * Test function with proper docs
 */
export function test(): boolean {
  try {
    return true;
  } catch (error) {
    throw new Error('Test failed');
  }
}
\`\`\``
              }
            ],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 100,
              output_tokens: 50
            }
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Create a test function',
        language: 'typescript'
      };

      const result = await service.generateCode(request);

      expect(result.qualityScore).toBeGreaterThanOrEqual(0);
      expect(result.qualityScore).toBeLessThanOrEqual(1);
    });

    it('should track latency in metadata', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockImplementation(async () => {
            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: '```typescript\ncode\n```' }],
              model: 'claude-3-haiku-20240307',
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 5 }
            };
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Test',
        language: 'typescript'
      };

      const result = await service.generateCode(request);

      expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle context and constraints', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: '```typescript\ncode\n```' }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 }
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Create auth service',
        language: 'typescript',
        context: 'This is for a REST API',
        constraints: ['Must use JWT', 'Must validate input']
      };

      await service.generateCode(request);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringMatching(/This is for a REST API/)
            })
          ])
        })
      );

      const call = mockClient.messages.create.mock.calls[0][0];
      expect(call.messages[0].content).toContain('Must use JWT');
      expect(call.messages[0].content).toContain('Must validate input');
    });

    it('should use default maxTokens if not provided', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: '```typescript\ncode\n```' }],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 }
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Test',
        language: 'typescript'
      };

      await service.generateCode(request);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096 // Default value
        })
      );
    });

    it('should extract code from markdown blocks', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Here is the code:\n\n```typescript\nfunction test() {\n  return true;\n}\n```\n\nThis implements the requirement.'
              }
            ],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 20 }
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const request: ICodeGenerationRequest = {
        prompt: 'Test',
        language: 'typescript'
      };

      const result = await service.generateCode(request);

      expect(result.code).toContain('function test()');
      expect(result.code).not.toContain('Here is the code');
      expect(result.explanation).toContain('This implements the requirement');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      service = new CodeGenerationService();
    });

    it('should handle multiple code blocks in response', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '```typescript\nfunction first() {}\n```\n\n```typescript\nfunction second() {}\n```'
              }
            ],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 20 }
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const result = await service.generateCode({
        prompt: 'Test',
        language: 'typescript'
      });

      expect(result.code).toContain('function first()');
      expect(result.code).toContain('function second()');
    });

    it('should handle response without code blocks', async () => {
      mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'function test() { return true; }'
              }
            ],
            model: 'claude-3-haiku-20240307',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 }
          })
        }
      };

      (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

      service = new CodeGenerationService('test-api-key');

      const result = await service.generateCode({
        prompt: 'Test',
        language: 'typescript'
      });

      expect(result.code).toBe('function test() { return true; }');
    });

    it('should handle Java template generation', () => {
      const result = service.synthesizeFromPatterns([], {
        prompt: 'Test',
        language: 'java'
      });

      expect(result.code).toContain('public class GeneratedClass');
      expect(result.code).toContain('public Map<String, Object> execute()');
      expect(result.code).toContain('public static void main');
      expect(result.code).toContain('import java.util.Map');
    });
  });
});
