/**
 * T-EC-011: PipelinePromptFacade.initialize() failure handling
 * Verifies descriptive errors when orchestrator creation fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PipelinePromptFacade — initialize error handling', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws descriptive error mentioning agent registry on agent-related failure', async () => {
    // Mock the CLI module to throw an agent-related error
    vi.doMock('../../../src/god-agent/cli/coding-pipeline-cli.js', () => ({
      createSequentialOrchestrator: vi.fn().mockRejectedValue(new Error('Agent definition file not found: task-analyzer.md')),
      init: vi.fn(),
      next: vi.fn(),
      complete: vi.fn(),
    }));

    const { PipelinePromptFacade } = await import('../../../src/god-agent/cli/sdk-prompt-facade.js');
    const facade = new PipelinePromptFacade();

    await expect(facade.initialize('/project')).rejects.toThrow(/agent registry\/loader error/);
    await expect(facade.initialize('/project')).rejects.toThrow(/Agent definition file not found/);
  });

  it('throws descriptive error mentioning database on sqlite failure', async () => {
    vi.doMock('../../../src/god-agent/cli/coding-pipeline-cli.js', () => ({
      createSequentialOrchestrator: vi.fn().mockRejectedValue(new Error('sqlite3: unable to open database')),
      init: vi.fn(),
      next: vi.fn(),
      complete: vi.fn(),
    }));

    const { PipelinePromptFacade } = await import('../../../src/god-agent/cli/sdk-prompt-facade.js');
    const facade = new PipelinePromptFacade();

    await expect(facade.initialize('/project')).rejects.toThrow(/database connection error/);
  });

  it('throws descriptive error mentioning DAG on dependency cycle', async () => {
    vi.doMock('../../../src/god-agent/cli/coding-pipeline-cli.js', () => ({
      createSequentialOrchestrator: vi.fn().mockRejectedValue(new Error('DAG cycle detected in dependency graph')),
      init: vi.fn(),
      next: vi.fn(),
      complete: vi.fn(),
    }));

    const { PipelinePromptFacade } = await import('../../../src/god-agent/cli/sdk-prompt-facade.js');
    const facade = new PipelinePromptFacade();

    await expect(facade.initialize('/project')).rejects.toThrow(/DAG builder error/);
  });

  it('throws generic orchestrator error for unknown failures', async () => {
    vi.doMock('../../../src/god-agent/cli/coding-pipeline-cli.js', () => ({
      createSequentialOrchestrator: vi.fn().mockRejectedValue(new Error('ENOMEM')),
      init: vi.fn(),
      next: vi.fn(),
      complete: vi.fn(),
    }));

    const { PipelinePromptFacade } = await import('../../../src/god-agent/cli/sdk-prompt-facade.js');
    const facade = new PipelinePromptFacade();

    await expect(facade.initialize('/project')).rejects.toThrow(/orchestrator creation error/);
    await expect(facade.initialize('/project')).rejects.toThrow(/ENOMEM/);
  });

  it('throws if methods called before initialize', async () => {
    const { PipelinePromptFacade } = await import('../../../src/god-agent/cli/sdk-prompt-facade.js');
    const facade = new PipelinePromptFacade();

    await expect(facade.initSession('test task')).rejects.toThrow(/not initialized/);
    await expect(facade.getNextAgent('sid')).rejects.toThrow(/not initialized/);
    await expect(facade.processCompletion('sid', 'key', '/path')).rejects.toThrow(/not initialized/);
  });
});
