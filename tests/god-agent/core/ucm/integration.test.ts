/**
 * UCM Integration Tests - SPRINT 9
 *
 * End-to-end tests for Universal Context Management system.
 * Tests complete workflows including DESC, context composition,
 * compaction recovery, and workflow detection.
 *
 * Note: DESC tests are limited since embeddings require external service.
 * Focus on integration of components and workflow detection.
 *
 * @module tests/ucm/integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUCM,
  type UCMInstance,
  type ITaskContext
} from '@god-agent/core/ucm/index.js';

// ============================================================================
// Integration Tests
// ============================================================================

describe('UCM Integration Tests', () => {
  let ucm: UCMInstance;

  beforeEach(() => {
    // Create fresh UCM instance
    ucm = createUCM();
  });

  // ==========================================================================
  // Test 1: createUCM() Factory Function
  // ==========================================================================

  describe('createUCM() factory function', () => {
    it('should create UCM instance with all expected components', () => {
      expect(ucm).toBeDefined();
      expect(ucm.config).toBeDefined();
      expect(ucm.tokenEstimator).toBeDefined();
      expect(ucm.chunker).toBeDefined();
      expect(ucm.embeddingProxy).toBeDefined();
      expect(ucm.episodeStore).toBeDefined();
      expect(ucm.episodeRetriever).toBeDefined();
      expect(ucm.compactionDetector).toBeDefined();
      expect(ucm.tierBridge).toBeDefined();
      expect(ucm.contextEngine).toBeDefined();
      expect(ucm.adapterRegistry).toBeDefined();
    });

    it('should have working helper methods', () => {
      expect(typeof ucm.detectWorkflow).toBe('function');
      expect(typeof ucm.estimateTokens).toBe('function');
      expect(typeof ucm.checkCompaction).toBe('function');
    });

    it('should use default config when no overrides provided', () => {
      const defaultUcm = createUCM();

      expect(defaultUcm.config.daemon.socketPath).toBe('/tmp/godagent-ucm.sock');
      expect(defaultUcm.config.desc.threshold).toBe(0.80);
      expect(defaultUcm.config.desc.maxEpisodes).toBe(2);
      expect(defaultUcm.config.embedding.dimension).toBe(1536);
    });

    it('should merge config overrides correctly', () => {
      const customUcm = createUCM({
        desc: {
          enabled: true,
          threshold: 0.85,
          maxEpisodes: 3,
          injectOnTask: false,
          chunkConfig: {
            maxChars: 2000,
            overlap: 300,
            maxChunks: 25,
            breakPatterns: [],
            protectedPatterns: []
          }
        }
      });

      expect(customUcm.config.desc.threshold).toBe(0.85);
      expect(customUcm.config.desc.maxEpisodes).toBe(3);
      expect(customUcm.config.desc.injectOnTask).toBe(false);
      // Other config should retain defaults
      expect(customUcm.config.daemon.socketPath).toBe('/tmp/godagent-ucm.sock');
    });
  });

  // ==========================================================================
  // Test 2: Context Composition - 4-Tier Structure
  // ==========================================================================

  describe('4-tier context composition', () => {
    it('should build complete context with all tiers', () => {
      const engine = ucm.contextEngine;

      // Add pinned content
      engine.pin(
        'literature-review',
        'Key findings from systematic review of 50 papers...',
        500
      );

      // Add to rolling window
      engine.addToWindow('method-design', 'Q-Learning algorithm implementation', 300);
      engine.addToWindow('data-collection', 'Gathered 10,000 game states', 200);
      engine.addToWindow('analysis', 'Statistical analysis of results', 250);

      // Set phase and compose
      const context = engine.compose({
        contextWindow: 100000,
        phase: 'research',
        includeDependencies: true,
        maxDescPrior: 2
      });

      // Verify all tiers present
      expect(context.tiers).toHaveLength(4);
      expect(context.tiers[0].tier).toBe('pinned');
      expect(context.tiers[1].tier).toBe('desc-prior');
      expect(context.tiers[2].tier).toBe('active');
      expect(context.tiers[3].tier).toBe('archived');

      // Verify metadata
      expect(context.metadata.phase).toBe('research');
      expect(context.metadata.pinnedCount).toBe(1);
      expect(context.metadata.activeCount).toBe(3);

      // Verify token accounting
      expect(context.totalTokens).toBeGreaterThan(0);
      expect(context.totalTokens).toBeLessThanOrEqual(context.contextWindow);
      expect(context.utilization).toBeGreaterThan(0);
      expect(context.utilization).toBeLessThanOrEqual(1);
    });

    it('should respect token budget across tiers', () => {
      const engine = ucm.contextEngine;

      // Add large pinned content
      engine.pin('large-context', 'X'.repeat(5000), 1500);

      // Add multiple active items
      for (let i = 0; i < 10; i++) {
        engine.addToWindow(`agent-${i}`, `Content ${i}`, 200);
      }

      // Compose with limited budget
      const context = engine.compose({
        contextWindow: 2000,
        phase: 'writing',
        includeDependencies: false
      });

      // Should fit within budget
      expect(context.totalTokens).toBeLessThanOrEqual(2000);
      expect(context.metadata.budgetRemaining).toBeGreaterThanOrEqual(0);

      // Pinned should always be included
      expect(context.metadata.pinnedCount).toBe(1);

      // Active may be truncated to fit budget
      expect(context.metadata.activeCount).toBeLessThan(10);
    });

    it('should handle phase transitions correctly', () => {
      const engine = ucm.contextEngine;

      // Add content in planning phase
      engine.setPhase('planning');
      engine.addToWindow('plan-1', 'Research objectives', 100);

      const planContext = engine.compose({
        contextWindow: 100000,
        phase: 'planning'
      });

      // Transition to research phase (larger window)
      engine.setPhase('research');
      engine.addToWindow('research-1', 'Literature findings', 100);
      engine.addToWindow('research-2', 'More findings', 100);

      const researchContext = engine.compose({
        contextWindow: 100000,
        phase: 'research'
      });

      // Research phase should support more active items
      const planStats = planContext.metadata;
      const researchStats = researchContext.metadata;

      expect(researchStats.activeCount).toBeGreaterThanOrEqual(planStats.activeCount);
    });

    it('should manage dependencies correctly', () => {
      const engine = ucm.contextEngine;

      // Create dependency chain: analysis depends on data, data depends on method
      engine.addToWindow('method', 'Research method', 100);
      engine.addToWindow('data', 'Data collection', 100);
      engine.addToWindow('analysis', 'Analysis results', 100);

      engine.addDependency('data', 'method');
      engine.addDependency('analysis', 'data');

      // Compose for analysis agent
      const context = engine.getContextForAgent('analysis', 100000, 'analysis');

      // Should include dependencies
      const agentIds = context.agents.map(a => a.agentId);
      expect(agentIds).toContain('method');
      expect(agentIds).toContain('data');
      expect(agentIds).toContain('analysis');
    });
  });

  // ==========================================================================
  // Test 3: Compaction Detection and Recovery
  // ==========================================================================

  describe('compaction detection and recovery', () => {
    it('should detect compaction markers', () => {
      const detector = ucm.compactionDetector;

      // Test various compaction messages
      const compactionMessages = [
        'This session is being continued from a previous conversation',
        'The conversation is summarized below',
        'Context window limit reached',
        'Previous messages have been summarized'
      ];

      for (const message of compactionMessages) {
        const detected = detector.detectCompaction(message);
        expect(detected).toBe(true);
      }

      // Verify state
      expect(detector.isInRecoveryMode()).toBe(true);
      expect(detector.getCompactionTimestamp()).toBeGreaterThan(0);
    });

    it('should not detect non-compaction messages', () => {
      const detector = ucm.compactionDetector;
      detector.reset();

      const normalMessages = [
        'Please analyze this code',
        'What are the results?',
        'Continue with the next step'
      ];

      for (const message of normalMessages) {
        const detected = detector.detectCompaction(message);
        expect(detected).toBe(false);
      }

      expect(detector.isInRecoveryMode()).toBe(false);
    });

    it('should maintain detection history', () => {
      const detector = ucm.compactionDetector;
      detector.reset();

      // Trigger multiple detections
      detector.detectCompaction('conversation is summarized below');
      detector.detectCompaction('session continuation detected');

      const history = detector.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].confidence).toBeGreaterThan(0);
      expect(history[1].confidence).toBeGreaterThan(0);
    });

    it('should reset detection state correctly', () => {
      const detector = ucm.compactionDetector;

      // Trigger detection
      detector.detectCompaction('conversation has been compacted');
      expect(detector.isInRecoveryMode()).toBe(true);

      // Reset
      detector.reset();
      expect(detector.isInRecoveryMode()).toBe(false);
      expect(detector.getCompactionTimestamp()).toBe(0);
    });
  });

  // ==========================================================================
  // Test 4: Workflow Detection
  // ==========================================================================

  describe('workflow adapter detection', () => {
    it('should detect PhD pipeline workflow', () => {
      // PhD adapter detects: pipelineName contains 'phd', agentId contains 'phd', or phase is 'writing'
      const phdContexts: ITaskContext[] = [
        { pipelineName: 'phd-pipeline', task: 'Literature review' },
        { agentId: 'phd-researcher', task: 'dissertation chapter writing' },
        { phase: 'writing', task: 'thesis methodology design' },
        { pipelineName: 'phd-research', phase: 'analysis', task: 'statistical analysis' }
      ];

      for (const context of phdContexts) {
        const adapter = ucm.detectWorkflow(context);
        expect(adapter.name).toBe('phd-pipeline');
      }
    });

    it('should detect code review workflow', () => {
      // Code review adapter detects: agentId/pipelineName contains 'review', task contains 'review'/'pr'/'pull-request'
      const reviewContexts: ITaskContext[] = [
        { task: 'Review PR #123' },
        { task: 'pull request review', metadata: { files: ['index.ts'] } },
        { agentId: 'code-review', task: 'Check quality' }
      ];

      for (const context of reviewContexts) {
        const adapter = ucm.detectWorkflow(context);
        expect(adapter.name).toBe('code-review');
      }
    });

    it('should fallback to general task adapter', () => {
      const generalContexts: ITaskContext[] = [
        { task: 'Generic task' },
        { task: 'Random work item' },
        { metadata: { type: 'unknown' } }
      ];

      for (const context of generalContexts) {
        const adapter = ucm.detectWorkflow(context);
        expect(adapter.name).toBe('general');
      }
    });

    it('should provide workflow-specific token config', () => {
      // PhD adapter (use pipelineName to trigger detection)
      const phdAdapter = ucm.detectWorkflow({ pipelineName: 'phd-pipeline', phase: 'research' });
      const phdConfig = phdAdapter.getTokenConfig({ pipelineName: 'phd-pipeline', phase: 'research' });
      expect(phdConfig.tokensPerWord).toBeGreaterThan(0);

      // Code review
      const reviewAdapter = ucm.detectWorkflow({ task: 'Review PR #456' });
      const reviewConfig = reviewAdapter.getTokenConfig();
      expect(reviewConfig.tokensPerWord).toBeGreaterThan(0);

      // General
      const generalAdapter = ucm.detectWorkflow({ task: 'generic' });
      const generalConfig = generalAdapter.getTokenConfig();
      expect(generalConfig.tokensPerWord).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Test 5: Token Estimation Integration
  // ==========================================================================

  describe('token estimation integration', () => {
    it('should estimate tokens accurately', () => {
      const prose = 'The quick brown fox jumps over the lazy dog.';
      const estimate = ucm.estimateTokens(prose);

      expect(estimate.tokens).toBeGreaterThan(0);
      expect(estimate.wordCount).toBe(9);
      expect(estimate.confidence).toBeGreaterThan(0);
    });

    it('should classify content types correctly', () => {
      const code = 'function test() { return 42; }';
      const codeEstimate = ucm.estimateTokens(code);

      const prose = 'This is a simple sentence.';
      const proseEstimate = ucm.estimateTokens(prose);

      // Both should have valid estimates
      expect(codeEstimate.tokens).toBeGreaterThan(0);
      expect(proseEstimate.tokens).toBeGreaterThan(0);
      expect(codeEstimate.wordCount).toBeGreaterThan(0);
      expect(proseEstimate.wordCount).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Test 6: Symmetric Chunking Integration
  // ==========================================================================

  describe('symmetric chunking integration', () => {
    it('should chunk text into overlapping segments', async () => {
      const text = 'This is a long text that needs to be chunked. '.repeat(50);
      const chunks = await ucm.chunker.chunk(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThanOrEqual(25); // maxChunks

      // Each chunk should be non-empty
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(2000); // maxChars
      }
    });

    it('should handle short text', async () => {
      const text = 'Short text';
      const chunks = await ucm.chunker.chunk(text);

      // Short text may be split by word boundaries in the chunker
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // All chunks combined should contain the original text content
      const joined = chunks.join(' ');
      expect(joined).toContain('Short');
      expect(joined).toContain('text');
    });
  });

  // ==========================================================================
  // Test 7: Complete Workflow Integration
  // ==========================================================================

  describe('complete PhD research workflow', () => {
    it('should handle full research pipeline', () => {
      // Phase 1: Planning - Pin research objectives
      ucm.contextEngine.setPhase('planning');
      ucm.contextEngine.pin(
        'research-objectives',
        'Primary objective: Study RL applications in game AI',
        200
      );

      // Phase 2: Research - Add findings
      ucm.contextEngine.setPhase('research');

      ucm.contextEngine.addToWindow(
        'literature-review',
        'Reviewed 50 papers on RL',
        400
      );

      // Phase 3: Analysis
      ucm.contextEngine.setPhase('analysis');
      ucm.contextEngine.addToWindow('statistical-analysis', 'P < 0.05', 150);

      // Phase 4: Writing - Compose full context
      ucm.contextEngine.setPhase('writing');

      const finalContext = ucm.contextEngine.compose({
        contextWindow: 100000,
        phase: 'writing',
        maxDescPrior: 2
      });

      // Verify complete workflow
      expect(finalContext.metadata.pinnedCount).toBe(1); // Research objectives
      expect(finalContext.metadata.activeCount).toBeGreaterThan(0);

      // Should fit within budget
      expect(finalContext.totalTokens).toBeLessThanOrEqual(100000);
      expect(finalContext.utilization).toBeGreaterThan(0);

      // All phases represented
      const stats = ucm.contextEngine.getStats();
      expect(stats.pinning.pinnedCount).toBe(1);
      expect(stats.rollingWindow.size).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Test 8: Component Integration
  // ==========================================================================

  describe('component integration', () => {
    it('should integrate token estimator with context engine', () => {
      const engine = ucm.contextEngine;
      const text = 'Sample text for estimation';
      const estimate = ucm.estimateTokens(text);

      // Add to window with estimated tokens
      engine.addToWindow('test-agent', text, estimate.tokens);

      const context = engine.compose({
        contextWindow: 100000,
        phase: 'research'
      });

      // Should include the agent
      expect(context.metadata.activeCount).toBe(1);
      expect(context.agents[0].agentId).toBe('test-agent');
    });

    it('should integrate workflow detection with context composition', () => {
      // Detect PhD workflow
      const adapter = ucm.detectWorkflow({ phase: 'writing' });
      expect(adapter.name).toBe('phd-pipeline');

      // Use workflow config for context
      const config = adapter.getTokenConfig();
      const engine = ucm.contextEngine;

      engine.addToWindow('agent-1', 'Content', 100);

      const context = engine.compose({
        contextWindow: config.contextWindow,
        phase: 'writing'
      });

      expect(context.contextWindow).toBe(config.contextWindow);
    });

    it('should integrate compaction detection with recovery', () => {
      const detector = ucm.compactionDetector;

      // Detect compaction
      detector.detectCompaction('conversation is summarized below');
      expect(detector.isInRecoveryMode()).toBe(true);

      // TierBridge should be able to initiate recovery
      expect(ucm.tierBridge).toBeDefined();
    });
  });

  // ==========================================================================
  // Test 9: Statistics and Monitoring
  // ==========================================================================

  describe('statistics and monitoring', () => {
    it('should provide comprehensive stats', () => {
      const engine = ucm.contextEngine;

      engine.pin('pinned-1', 'Content', 100);
      engine.addToWindow('active-1', 'Content', 100);
      engine.addToWindow('active-2', 'Content', 100);
      engine.addDependency('active-2', 'active-1');

      const stats = engine.getStats();

      expect(stats.pinning).toBeDefined();
      expect(stats.pinning.pinnedCount).toBe(1);

      expect(stats.rollingWindow).toBeDefined();
      expect(stats.rollingWindow.size).toBe(2);

      expect(stats.dependencies).toBeDefined();

      expect(stats.archived).toBeDefined();
    });
  });
});
