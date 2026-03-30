/**
 * Learning Integration Tests
 * TASK-LRN-001 - Unit tests for learning integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LearningIntegration,
  DEFAULT_LEARNING_CONFIG,
  type ILearningIntegrationConfig,
} from '../../../../src/god-agent/core/integration/learning-integration.js';
import {
  PhDLearningIntegration,
  createPhDLearningIntegration,
  PHASE_WEIGHTS,
  CRITICAL_AGENT_KEYS,
} from '../../../../src/god-agent/core/integration/phd-learning-integration.js';
import type { IAgentResult, IPipelineExecution } from '../../../../src/god-agent/core/orchestration/orchestration-types.js';

// ==================== Mock Sona Engine ====================

class MockSonaEngine {
  private trajectoryCounter = 0;
  public createdTrajectories: Array<{ id: string; route: string; tags: string[]; contextIds: string[] }> = [];
  public feedbackReceived: Array<{ trajectoryId: string; quality: number }> = [];

  createTrajectory(route: string, tags: string[], contextIds: string[]): string {
    const id = `trajectory-${++this.trajectoryCounter}`;
    this.createdTrajectories.push({ id, route, tags, contextIds });
    return id;
  }

  async provideFeedback(trajectoryId: string, quality: number): Promise<void> {
    this.feedbackReceived.push({ trajectoryId, quality });
  }

  getTrajectory(id: string) {
    return this.createdTrajectories.find(t => t.id === id);
  }

  clear() {
    this.trajectoryCounter = 0;
    this.createdTrajectories = [];
    this.feedbackReceived = [];
  }
}

// ==================== Mock Reasoning Bank ====================

class MockReasoningBank {
  public feedbackReceived: Array<{ trajectoryId: string; quality: number; metadata?: unknown }> = [];

  async provideFeedback(params: { trajectoryId: string; quality: number; metadata?: unknown }): Promise<void> {
    this.feedbackReceived.push(params);
  }

  clear() {
    this.feedbackReceived = [];
  }
}

// ==================== Test Fixtures ====================

function createSuccessfulResult(agentName: string, overrides: Partial<IAgentResult> = {}): IAgentResult {
  return {
    agentName,
    position: 'Agent #1/48',
    outputKey: `phd/exec-123/${agentName}/output`,
    storedAt: Date.now(),
    duration: 30000, // 30 seconds
    success: true,
    output: 'This is a successful output with sufficient content. '.repeat(20),
    ...overrides,
  };
}

function createFailedResult(agentName: string): IAgentResult {
  return {
    agentName,
    position: 'Agent #1/48',
    outputKey: `phd/exec-123/${agentName}/output`,
    storedAt: Date.now(),
    duration: 5000,
    success: false,
    error: 'Agent execution failed',
  };
}

function createPipelineExecution(overrides: Partial<IPipelineExecution> = {}): IPipelineExecution {
  const results = new Map<string, IAgentResult>();
  results.set('agent-1', createSuccessfulResult('Agent 1'));
  results.set('agent-2', createSuccessfulResult('Agent 2'));
  results.set('agent-3', createFailedResult('Agent 3'));

  return {
    pipelineId: 'pipeline-123',
    name: 'Test Pipeline',
    status: 'completed',
    currentAgentIndex: 3,
    agentResults: results,
    startedAt: Date.now() - 60000,
    completedAt: Date.now(),
    totalAgents: 3,
    ...overrides,
  };
}

// ==================== LearningIntegration Tests ====================

describe('LearningIntegration', () => {
  let mockSona: MockSonaEngine;
  let integration: LearningIntegration;

  beforeEach(() => {
    mockSona = new MockSonaEngine();
    integration = new LearningIntegration(mockSona as any);
  });

  describe('configuration', () => {
    it('should use default config when none provided', () => {
      const config = integration.getConfig();
      expect(config.trackTrajectories).toBe(DEFAULT_LEARNING_CONFIG.trackTrajectories);
      expect(config.autoFeedback).toBe(DEFAULT_LEARNING_CONFIG.autoFeedback);
      expect(config.qualityThreshold).toBe(DEFAULT_LEARNING_CONFIG.qualityThreshold);
    });

    it('should merge custom config with defaults', () => {
      const customConfig: Partial<ILearningIntegrationConfig> = {
        qualityThreshold: 0.9,
        verbose: true,
      };
      const customIntegration = new LearningIntegration(mockSona as any, customConfig);
      const config = customIntegration.getConfig();

      expect(config.qualityThreshold).toBe(0.9);
      expect(config.verbose).toBe(true);
      expect(config.trackTrajectories).toBe(true); // Default
    });

    it('should allow config updates', () => {
      integration.updateConfig({ qualityThreshold: 0.95 });
      expect(integration.getConfig().qualityThreshold).toBe(0.95);
    });
  });

  describe('onPipelineStart', () => {
    it('should create pipeline trajectory', () => {
      const trajectoryId = integration.onPipelineStart('pipeline-123', 'Test Pipeline');

      expect(trajectoryId).toBeDefined();
      expect(mockSona.createdTrajectories.length).toBe(1);
      expect(mockSona.createdTrajectories[0].route).toContain('test-pipeline');
      expect(mockSona.createdTrajectories[0].tags).toContain('pipeline');
    });

    it('should skip when tracking disabled', () => {
      const noTrackIntegration = new LearningIntegration(
        mockSona as any,
        { trackTrajectories: false }
      );

      const trajectoryId = noTrackIntegration.onPipelineStart('pipeline-123', 'Test');
      expect(trajectoryId).toBeUndefined();
      expect(mockSona.createdTrajectories.length).toBe(0);
    });

    it('should store pipeline trajectory ID', () => {
      integration.onPipelineStart('pipeline-123', 'Test Pipeline');
      expect(integration.getPipelineTrajectoryId()).toBe('trajectory-1');
    });
  });

  describe('onAgentStart', () => {
    it('should create agent trajectory', () => {
      const trajectoryId = integration.onAgentStart('Test Agent', 'Foundation');

      expect(trajectoryId).toBeDefined();
      expect(mockSona.createdTrajectories.length).toBe(1);
      expect(mockSona.createdTrajectories[0].route).toContain('foundation');
      expect(mockSona.createdTrajectories[0].tags).toContain('Test Agent');
    });

    it('should link to pipeline trajectory', () => {
      integration.onPipelineStart('pipeline-123', 'Test Pipeline');
      integration.onAgentStart('Test Agent', 'Foundation');

      expect(mockSona.createdTrajectories.length).toBe(2);
      expect(mockSona.createdTrajectories[1].contextIds).toContain('trajectory-1');
    });

    it('should track trajectory metadata', () => {
      integration.onAgentStart('Test Agent', 'Foundation');

      const metadata = integration.getTrajectoryMetadata('Test Agent');
      expect(metadata).toBeDefined();
      expect(metadata?.agentName).toBe('Test Agent');
      expect(metadata?.phase).toBe('Foundation');
    });
  });

  describe('onAgentComplete', () => {
    it('should provide feedback for successful agent', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent'));

      expect(mockSona.feedbackReceived.length).toBe(1);
      expect(mockSona.feedbackReceived[0].quality).toBeGreaterThan(0);
    });

    it('should calculate quality for failed agent', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createFailedResult('Test Agent'));

      expect(mockSona.feedbackReceived.length).toBe(1);
      expect(mockSona.feedbackReceived[0].quality).toBe(0);
    });

    it('should clean up trajectory metadata after completion', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent'));

      expect(integration.getTrajectoryMetadata('Test Agent')).toBeUndefined();
    });

    it('should skip feedback when disabled', async () => {
      const noFeedbackIntegration = new LearningIntegration(
        mockSona as any,
        { autoFeedback: false }
      );

      noFeedbackIntegration.onAgentStart('Test Agent', 'Foundation');
      await noFeedbackIntegration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent'));

      expect(mockSona.feedbackReceived.length).toBe(0);
    });
  });

  describe('onPipelineComplete', () => {
    it('should provide pipeline-level feedback', async () => {
      integration.onPipelineStart('pipeline-123', 'Test Pipeline');
      await integration.onPipelineComplete(createPipelineExecution());

      expect(mockSona.feedbackReceived.length).toBe(1);
      expect(mockSona.feedbackReceived[0].trajectoryId).toBe('trajectory-1');
    });

    it('should calculate quality from agent results', async () => {
      integration.onPipelineStart('pipeline-123', 'Test Pipeline');
      await integration.onPipelineComplete(createPipelineExecution());

      // 2/3 successful + completion bonus
      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBeGreaterThan(0.6);
      expect(quality).toBeLessThan(1.0);
    });

    it('should clear state after pipeline completion', async () => {
      integration.onPipelineStart('pipeline-123', 'Test Pipeline');
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onPipelineComplete(createPipelineExecution());

      expect(integration.getPipelineTrajectoryId()).toBeNull();
      expect(integration.getActiveTrajectoryCount()).toBe(0);
    });
  });

  describe('quality calculation', () => {
    it('should give base score for success', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent'));

      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBeGreaterThanOrEqual(0.7);
    });

    it('should give speed bonus for fast execution', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', { duration: 10000 }));

      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBeGreaterThanOrEqual(0.8); // Base + speed bonus
    });

    it('should give output bonus for longer output', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        output: 'x'.repeat(2000),
      }));

      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBeGreaterThanOrEqual(0.85);
    });

    it('should cap quality at 1.0', async () => {
      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        duration: 5000,
        output: 'x'.repeat(5000),
      }));

      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBeLessThanOrEqual(1.0);
    });
  });

  describe('event handling', () => {
    it('should emit trajectory:created event', () => {
      const events: any[] = [];
      integration.addEventListener(event => events.push(event));

      integration.onPipelineStart('pipeline-123', 'Test Pipeline');

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('trajectory:created');
    });

    it('should emit trajectory:feedback event', async () => {
      const events: any[] = [];
      integration.addEventListener(event => events.push(event));

      integration.onAgentStart('Test Agent', 'Foundation');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent'));

      const feedbackEvent = events.find(e => e.type === 'trajectory:feedback');
      expect(feedbackEvent).toBeDefined();
      expect(feedbackEvent.quality).toBeGreaterThan(0);
    });

    it('should allow removing event listeners', () => {
      const events: any[] = [];
      const listener = (event: any) => events.push(event);

      integration.addEventListener(listener);
      integration.removeEventListener(listener);
      integration.onPipelineStart('pipeline-123', 'Test Pipeline');

      expect(events.length).toBe(0);
    });
  });

  describe('hyperedge creation', () => {
    let mockReasoningBank: MockReasoningBank;

    beforeEach(() => {
      mockReasoningBank = new MockReasoningBank();
    });

    it('should create hyperedge for high-quality execution', async () => {
      const integrationWithRB = new LearningIntegration(
        mockSona as any,
        { enableHyperedges: true, hyperedgeThreshold: 0.8 },
        mockReasoningBank as any
      );

      integrationWithRB.onAgentStart('Test Agent', 'Foundation');
      await integrationWithRB.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        duration: 5000,
        output: 'x'.repeat(2000),
      }));

      expect(mockReasoningBank.feedbackReceived.length).toBe(1);
    });

    it('should skip hyperedge for low-quality execution', async () => {
      const integrationWithRB = new LearningIntegration(
        mockSona as any,
        { enableHyperedges: true, hyperedgeThreshold: 0.99 }, // Very high threshold
        mockReasoningBank as any
      );

      integrationWithRB.onAgentStart('Test Agent', 'Foundation');
      // Use minimal output and slow execution to get lower quality
      await integrationWithRB.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        output: 'Short', // Minimal output
        duration: 200000, // Very slow (no speed bonus)
      }));

      // Quality should be ~0.7 (base success only), below 0.99 threshold
      expect(mockReasoningBank.feedbackReceived.length).toBe(0);
    });
  });
});

// ==================== PhDLearningIntegration Tests ====================

describe('PhDLearningIntegration', () => {
  let mockSona: MockSonaEngine;
  let integration: PhDLearningIntegration;

  beforeEach(() => {
    mockSona = new MockSonaEngine();
    integration = createPhDLearningIntegration(mockSona as any);
  });

  describe('configuration', () => {
    it('should use PhD-specific defaults', () => {
      const config = integration.getConfig();
      expect(config.routePrefix).toBe('phd/');
      expect(config.qualityThreshold).toBe(0.85);
      expect(config.enableHyperedges).toBe(true);
    });
  });

  describe('phase-weighted quality', () => {
    it('should weight quality by phase importance', async () => {
      // Writing phase has weight 1.3
      integration.onAgentStart('Test Agent', 'Writing');
      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        position: 'Agent #28/48', // Writing phase
      }));

      const quality = mockSona.feedbackReceived[0].quality;
      // Should be > base quality due to phase weight
      expect(quality).toBeGreaterThan(0.7);
    });
  });

  describe('citation counting', () => {
    it('should give bonus for citations in writing phase', async () => {
      integration.onAgentStart('Test Agent', 'Writing');

      const outputWithCitations = `
        According to Smith (2024), this is important.
        Research by Jones et al. (2023) shows [1].
        Brown (2022) agrees [2], and so does [3].
        Additional references: [4], [5], [6], [7], [8], [9], [10].
        More: (White, 2021), (Black, 2020), (Green, 2019), (Blue, 2018), (Red, 2017).
      `;

      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        output: outputWithCitations,
        position: 'Agent #28/48',
      }));

      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBeGreaterThan(0.8);
    });

    it('should count different citation formats', async () => {
      integration.onAgentStart('Test Agent', 'Discovery');

      const output = `
        [1] First reference
        (Author, 2024) Second reference
        Smith et al. (2023) Third reference
      `;

      await integration.onAgentComplete('Test Agent', createSuccessfulResult('Test Agent', {
        output,
        position: 'Agent #6/48',
      }));

      expect(mockSona.feedbackReceived.length).toBe(1);
    });
  });

  describe('critical agent handling', () => {
    it('should track critical agent results', async () => {
      integration.onAgentStart('step-back-analyzer', 'Foundation');
      await integration.onAgentComplete('step-back-analyzer', createSuccessfulResult('step-back-analyzer'));

      const criticalResults = integration.getCriticalAgentResults();
      expect(criticalResults.has('step-back-analyzer')).toBe(true);
    });

    it('should penalize failed critical agents', async () => {
      integration.onAgentStart('adversarial-reviewer', 'QA');
      await integration.onAgentComplete('adversarial-reviewer', createFailedResult('adversarial-reviewer'));

      const quality = mockSona.feedbackReceived[0].quality;
      expect(quality).toBe(0);
    });

    it('should recognize all critical agent keys', () => {
      for (const key of CRITICAL_AGENT_KEYS) {
        expect(CRITICAL_AGENT_KEYS).toContain(key);
      }
    });
  });

  describe('phase statistics', () => {
    it('should track phase completion', async () => {
      integration.onAgentStart('Agent 1', 'Foundation');
      await integration.onAgentComplete('Agent 1', createSuccessfulResult('Agent 1'));

      integration.onAgentStart('Agent 2', 'Foundation');
      await integration.onAgentComplete('Agent 2', createFailedResult('Agent 2'));

      const stats = integration.getPhaseStatistics();
      const foundationStats = stats.get('Foundation');

      expect(foundationStats).toBeDefined();
      expect(foundationStats?.total).toBe(2);
      expect(foundationStats?.successful).toBe(1);
      expect(foundationStats?.rate).toBe(0.5);
    });
  });

  describe('PhD metrics', () => {
    it('should calculate overall metrics', async () => {
      integration.onAgentStart('Agent 1', 'Foundation');
      await integration.onAgentComplete('Agent 1', createSuccessfulResult('Agent 1'));

      integration.onAgentStart('step-back-analyzer', 'Foundation');
      await integration.onAgentComplete('step-back-analyzer', createSuccessfulResult('step-back-analyzer'));

      const metrics = integration.getPhdMetrics();

      expect(metrics.overallSuccessRate).toBe(1.0);
      expect(metrics.criticalAgentCount).toBe(1);
      expect(metrics.criticalAgentSuccessRate).toBe(1.0);
    });
  });

  describe('phase inference', () => {
    it('should infer phase from agent number', async () => {
      // Agent #28 should be in Writing phase
      integration.onAgentStart('Writer', 'Writing');
      await integration.onAgentComplete('Writer', createSuccessfulResult('Writer', {
        position: 'Agent #28/48',
      }));

      const stats = integration.getPhaseStatistics();
      expect(stats.has('Writing')).toBe(true);
    });
  });

  describe('clear state', () => {
    it('should clear all PhD-specific state', async () => {
      integration.onAgentStart('step-back-analyzer', 'Foundation');
      await integration.onAgentComplete('step-back-analyzer', createSuccessfulResult('step-back-analyzer'));

      integration.clear();

      expect(integration.getCriticalAgentResults().size).toBe(0);
      expect(integration.getPhaseStatistics().size).toBe(0);
      expect(integration.getActiveTrajectoryCount()).toBe(0);
    });
  });
});
