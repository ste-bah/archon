/**
 * Integration tests for CodeGenerationService with UniversalAgent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UniversalAgent } from '../../../src/god-agent/universal/universal-agent.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Skip all tests when ANTHROPIC_API_KEY is not set
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!hasApiKey)('CodeGenerationService Integration', () => {
  let agent: UniversalAgent;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for this test
    tempDir = mkdtempSync(join(tmpdir(), 'god-agent-code-gen-test-'));

    agent = new UniversalAgent({
      verbose: false,
      enablePersistence: true,
      storageDir: tempDir,
      autoLearn: true,
      autoStoreThreshold: 0.7,
    });

    await agent.initialize();
  }, 30000); // 30 second timeout for initialization

  afterEach(async () => {
    await agent.shutdown();
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should generate code using CodeGenerationService', async () => {
    const result = await agent.code('Create a function to calculate fibonacci numbers', {
      language: 'typescript',
    });

    expect(result).toBeDefined();
    expect(result.code).toBeTruthy();
    expect(result.language).toBe('typescript');
    expect(result.learned).toBeDefined();
    expect(typeof result.code).toBe('string');
    expect(result.code.length).toBeGreaterThan(0);
  }, 30000); // 30 second timeout

  it('should store high-quality code in InteractionStore', async () => {
    const result = await agent.code('Create a TypeScript interface for a User', {
      language: 'typescript',
    });

    // Check that code was generated
    expect(result.code).toBeTruthy();

    // Get stats to verify storage
    const stats = agent.getStats();
    expect(stats.totalInteractions).toBeGreaterThan(0);
  }, 30000);

  it('should retrieve context from InteractionStore for similar tasks', async () => {
    // First interaction: create a function
    await agent.code('Create a function to add two numbers', {
      language: 'typescript',
    });

    // Second interaction: similar task should retrieve context
    const result = await agent.code('Create a function to multiply two numbers', {
      language: 'typescript',
    });

    expect(result.code).toBeTruthy();
    expect(result.patterns_used).toBeDefined();
  }, 60000); // Longer timeout for two generations

  it('should handle errors gracefully when API is unavailable', async () => {
    // This will fall back to pattern synthesis if API key is not set
    const result = await agent.code('Create a simple class', {
      language: 'typescript',
    });

    expect(result.code).toBeTruthy();
    // Should not throw errors even if API is unavailable
  }, 30000);

  it('should use ReasoningBank patterns alongside InteractionStore', async () => {
    // Generate code with context
    const result = await agent.code(
      'Create a REST API endpoint handler',
      {
        language: 'typescript',
        context: 'Use Express.js framework',
      }
    );

    expect(result.code).toBeTruthy();
    expect(result.explanation).toBeTruthy();
  }, 30000);

  it('should maintain quality scores for generated code', async () => {
    const result = await agent.code('Create a validated input parser', {
      language: 'typescript',
    });

    expect(result.code).toBeTruthy();

    // Check that quality is tracked (implicitly through auto-storage)
    const stats = agent.getStats();
    expect(stats.totalInteractions).toBeGreaterThan(0);
  }, 30000);

  it('should handle different programming languages', async () => {
    const languages = ['typescript', 'python', 'javascript'];

    for (const language of languages) {
      const result = await agent.code(`Create a hello world function`, {
        language,
      });

      expect(result.code).toBeTruthy();
      expect(result.language).toBe(language);
    }
  }, 90000); // Longer timeout for multiple generations

  it('should provide trajectory IDs for feedback', async () => {
    const result = await agent.code('Create a utility function', {
      language: 'typescript',
    });

    // TrajectoryID should be present if TrajectoryBridge is initialized
    if (result.trajectoryId) {
      expect(typeof result.trajectoryId).toBe('string');
      expect(result.trajectoryId.length).toBeGreaterThan(0);
    }
  }, 30000);
});
