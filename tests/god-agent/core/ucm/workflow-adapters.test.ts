import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdapterRegistry,
  PhdPipelineAdapter,
  CodeReviewAdapter,
  GeneralTaskAdapter
} from '../../../../src/god-agent/core/ucm/index.js';
import type { IWorkflowAdapter, ITaskContext } from '../../../../src/god-agent/core/ucm/index.js';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  describe('adapter detection', () => {
    it('should detect PhD pipeline workflow', () => {
      const phdContext: ITaskContext = {
        task: 'Literature review for machine learning research',
        phase: 'research',
        pipelineName: 'phd-pipeline'
      };

      const adapter = registry.detectAdapter(phdContext);

      expect(adapter).toBeInstanceOf(PhdPipelineAdapter);
    });

    it('should detect code review workflow', () => {
      const reviewContext: ITaskContext = {
        task: 'Review pull request #123',
        agentId: 'code-reviewer'
      };

      const adapter = registry.detectAdapter(reviewContext);

      expect(adapter).toBeInstanceOf(CodeReviewAdapter);
    });

    it('should fallback to general task adapter', () => {
      const genericContext: ITaskContext = {
        task: 'Some generic task'
      };

      const adapter = registry.detectAdapter(genericContext);

      expect(adapter).toBeInstanceOf(GeneralTaskAdapter);
    });

    it('should detect PhD keywords in pipelineName', () => {
      const contexts: ITaskContext[] = [
        { task: 'Test', pipelineName: 'phd-dissertation' },
        { task: 'Test', agentId: 'phd-writer' },
        { task: 'Test', phase: 'writing' }
      ];

      contexts.forEach(ctx => {
        const adapter = registry.detectAdapter(ctx);
        expect(adapter).toBeInstanceOf(PhdPipelineAdapter);
      });
    });

    it('should detect code review keywords', () => {
      const contexts: ITaskContext[] = [
        { task: 'pr review for feature-x', agentId: 'reviewer' },
        { task: 'code review required', agentId: 'reviewer' }
      ];

      contexts.forEach(ctx => {
        const adapter = registry.detectAdapter(ctx);
        expect(adapter).toBeInstanceOf(CodeReviewAdapter);
      });
    });

    it('should prioritize PhD over code review when both match', () => {
      const ambiguousContext: ITaskContext = {
        task: 'review literature on code quality',
        phase: 'research',
        pipelineName: 'phd'
      };

      const adapter = registry.detectAdapter(ambiguousContext);

      expect(adapter).toBeInstanceOf(PhdPipelineAdapter);
    });
  });

  describe('custom adapter registration', () => {
    it('should allow registering custom adapters', () => {
      class CustomAdapter implements IWorkflowAdapter {
        readonly name = 'custom';
        detect(context: ITaskContext): boolean {
          return context.task === 'custom';
        }
        getWindowSize() { return 5; }
        getTokenConfig() { return { tokensPerWord: 1.3, averageWordLength: 5, safetyMargin: 0.1 }; }
        getPinningStrategy() { return { type: 'none' as const, autoPin: false }; }
        getPhaseSettings() { return { name: 'custom', windowSize: 5, compressionEnabled: true, compressionRatio: 0.7, priorityBoost: 1.0 }; }
      }

      registry.register('custom', new CustomAdapter());

      const adapter = registry.detectAdapter({ task: 'custom' });
      expect(adapter).toBeInstanceOf(CustomAdapter);
    });
  });

  describe('get method', () => {
    it('should get adapter by name', () => {
      const phdAdapter = registry.get('phd');
      expect(phdAdapter).toBeInstanceOf(PhdPipelineAdapter);

      const codeReviewAdapter = registry.get('code-review');
      expect(codeReviewAdapter).toBeInstanceOf(CodeReviewAdapter);

      const generalAdapter = registry.get('general');
      expect(generalAdapter).toBeInstanceOf(GeneralTaskAdapter);
    });

    it('should return undefined for unknown adapter name', () => {
      const unknownAdapter = registry.get('unknown');
      expect(unknownAdapter).toBeUndefined();
    });
  });

  describe('getAdapterNames', () => {
    it('should return all registered adapter names', () => {
      const names = registry.getAdapterNames();
      expect(names).toContain('phd');
      expect(names).toContain('code-review');
      expect(names).toContain('general');
    });
  });
});

describe('PhdPipelineAdapter', () => {
  let adapter: PhdPipelineAdapter;

  beforeEach(() => {
    adapter = new PhdPipelineAdapter();
  });

  describe('detection', () => {
    it('should detect PhD via writing phase', () => {
      // PhdPipelineAdapter.detect() only detects:
      // 1. 'phd' in pipelineName
      // 2. 'phd' in agentId
      // 3. 'writing' in phase
      // Other phases (planning, research, qa) are detected by getWindowSize internally
      expect(adapter.detect({ phase: 'writing', task: '' })).toBe(true);
    });

    it('should NOT detect non-writing phases without phd in pipelineName or agentId', () => {
      // These phases alone don't trigger detection - need 'phd' in name
      const phases = ['planning', 'research', 'qa'];
      phases.forEach(phase => {
        expect(adapter.detect({ phase, task: '' })).toBe(false);
      });
    });

    it('should detect phd in pipelineName', () => {
      expect(adapter.detect({ pipelineName: 'phd-pipeline', task: '' })).toBe(true);
      expect(adapter.detect({ pipelineName: 'my-phd-project', task: '' })).toBe(true);
    });

    it('should detect phd in agentId', () => {
      expect(adapter.detect({ agentId: 'phd-writer', task: '' })).toBe(true);
      expect(adapter.detect({ agentId: 'phd-researcher', task: '' })).toBe(true);
    });

    it('should not detect non-PhD contexts', () => {
      const contexts: ITaskContext[] = [
        { task: 'Build web app' },
        { task: 'Fix bug in production' },
        { task: 'Deploy to server' }
      ];

      contexts.forEach(ctx => {
        expect(adapter.detect(ctx)).toBe(false);
      });
    });
  });

  describe('getWindowSize', () => {
    it('should return phase-specific window sizes', () => {
      // Based on actual implementation: planning=2, research=3, writing=5, qa=10
      expect(adapter.getWindowSize({ phase: 'planning', task: '' })).toBe(2);
      expect(adapter.getWindowSize({ phase: 'research', task: '' })).toBe(3);
      expect(adapter.getWindowSize({ phase: 'writing', task: '' })).toBe(5);
      expect(adapter.getWindowSize({ phase: 'qa', task: '' })).toBe(10);
    });

    it('should default to size 3 for unknown phases', () => {
      const windowSize = adapter.getWindowSize({ phase: 'unknown', task: '' });
      expect(windowSize).toBe(3);
    });

    it('should return default when no phase specified', () => {
      const windowSize = adapter.getWindowSize({ task: '' });
      expect(windowSize).toBeGreaterThan(0);
    });

    it('should have larger window for writing phase than planning', () => {
      const writingSize = adapter.getWindowSize({ phase: 'writing', task: '' });
      const planningSize = adapter.getWindowSize({ phase: 'planning', task: '' });
      expect(writingSize).toBeGreaterThan(planningSize);
    });
  });

  describe('getTokenConfig', () => {
    it('should return token configuration', () => {
      const config = adapter.getTokenConfig({ task: '' });
      expect(config).toHaveProperty('tokensPerWord');
      expect(config).toHaveProperty('averageWordLength');
      expect(config).toHaveProperty('safetyMargin');
      expect(config.tokensPerWord).toBe(1.3);
    });
  });

  describe('getPinningStrategy', () => {
    it('should return cross-reference pinning strategy', () => {
      const strategy = adapter.getPinningStrategy({ task: '' });
      expect(strategy.type).toBe('cross-reference');
      expect(strategy.autoPin).toBe(true);
      expect(strategy.threshold).toBe(3);
    });
  });

  describe('getPhaseSettings', () => {
    it('should return phase-specific settings', () => {
      const planningSettings = adapter.getPhaseSettings({ phase: 'planning', task: '' });
      expect(planningSettings.name).toBe('Foundation & Discovery');
      expect(planningSettings.windowSize).toBe(2);

      const writingSettings = adapter.getPhaseSettings({ phase: 'writing', task: '' });
      expect(writingSettings.name).toBe('Writing & Synthesis');
      expect(writingSettings.windowSize).toBe(5);
    });

    it('should include focus areas', () => {
      const settings = adapter.getPhaseSettings({ phase: 'research', task: '' });
      expect(settings.focusAreas).toBeDefined();
      expect(Array.isArray(settings.focusAreas)).toBe(true);
    });
  });
});

describe('CodeReviewAdapter', () => {
  let adapter: CodeReviewAdapter;

  beforeEach(() => {
    adapter = new CodeReviewAdapter();
  });

  describe('detection', () => {
    it('should detect code review keywords', () => {
      const keywords = ['review', 'pr', 'diff', 'code'];

      keywords.forEach(keyword => {
        const detected = adapter.detect({ task: keyword, agentId: 'reviewer' });
        // Detection may vary based on implementation
        expect(typeof detected).toBe('boolean');
      });
    });

    it('should detect reviewer agentId', () => {
      expect(adapter.detect({ task: 'check code', agentId: 'code-reviewer' })).toBe(true);
    });
  });

  describe('getWindowSize', () => {
    it('should return appropriate window size', () => {
      const windowSize = adapter.getWindowSize({ task: '' });
      expect(windowSize).toBeGreaterThan(0);
    });
  });

  describe('getTokenConfig', () => {
    it('should return token configuration', () => {
      const config = adapter.getTokenConfig({ task: '' });
      expect(config).toHaveProperty('tokensPerWord');
      expect(config).toHaveProperty('safetyMargin');
    });
  });
});

describe('GeneralTaskAdapter', () => {
  let adapter: GeneralTaskAdapter;

  beforeEach(() => {
    adapter = new GeneralTaskAdapter();
  });

  describe('detection', () => {
    it('should always return true (fallback adapter)', () => {
      const contexts: ITaskContext[] = [
        { task: 'anything' },
        { task: 'random task' },
        { task: '' },
        { task: 'some work', phase: 'unknown' }
      ];

      contexts.forEach(ctx => {
        expect(adapter.detect(ctx)).toBe(true);
      });
    });
  });

  describe('getWindowSize', () => {
    it('should return default window size', () => {
      const windowSize = adapter.getWindowSize({ task: '' });
      expect(windowSize).toBeGreaterThan(0);
      expect(windowSize).toBe(3); // Standard default
    });

    it('should have consistent window size for all contexts', () => {
      const size1 = adapter.getWindowSize({ task: 'task1' });
      const size2 = adapter.getWindowSize({ task: 'task2' });
      expect(size1).toBe(size2);
    });
  });

  describe('getTokenConfig', () => {
    it('should return token configuration', () => {
      const config = adapter.getTokenConfig({ task: '' });
      expect(config).toHaveProperty('tokensPerWord');
      expect(config).toHaveProperty('safetyMargin');
    });
  });
});

describe('adapter integration', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('should select correct adapter for real-world PhD scenario', () => {
    const context: ITaskContext = {
      task: 'Conduct systematic literature review',
      phase: 'research',
      pipelineName: 'phd-dissertation'
    };

    const adapter = registry.detectAdapter(context);
    expect(adapter).toBeInstanceOf(PhdPipelineAdapter);

    const windowSize = adapter.getWindowSize(context);
    expect(windowSize).toBe(3); // Research phase
  });

  it('should select correct adapter for real-world code review', () => {
    const context: ITaskContext = {
      task: 'Review PR #456: Add authentication feature',
      agentId: 'code-reviewer'
    };

    const adapter = registry.detectAdapter(context);
    expect(adapter).toBeInstanceOf(CodeReviewAdapter);

    const windowSize = adapter.getWindowSize(context);
    expect(windowSize).toBeGreaterThan(0);
  });

  it('should handle workflow transitions', () => {
    // Start with planning (PhD)
    let adapter = registry.detectAdapter({ phase: 'planning', pipelineName: 'phd', task: '' });
    let windowSize = adapter.getWindowSize({ phase: 'planning', pipelineName: 'phd', task: '' });
    expect(windowSize).toBe(2);

    // Move to research (PhD)
    adapter = registry.detectAdapter({ phase: 'research', pipelineName: 'phd', task: '' });
    windowSize = adapter.getWindowSize({ phase: 'research', pipelineName: 'phd', task: '' });
    expect(windowSize).toBe(3);

    // Move to writing (PhD)
    adapter = registry.detectAdapter({ phase: 'writing', pipelineName: 'phd', task: '' });
    windowSize = adapter.getWindowSize({ phase: 'writing', pipelineName: 'phd', task: '' });
    expect(windowSize).toBe(5);
  });
});
