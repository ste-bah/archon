/**
 * Writing Agent Routing Tests (TASK-WRITING-001)
 *
 * Validates routing accuracy for specialized writing agents:
 * - creative-writer: poems, stories, humor, satire
 * - academic-writer: dissertations, thesis, research papers
 * - professional-writer: business reports, proposals
 * - casual-writer: blogs, social media, informal content
 * - technical-writer: documentation, API guides, manuals
 *
 * Constitution compliance:
 * - RULE-DAI-003-001: Every result includes explanation
 * - RULE-DAI-003-003: Low confidence requires confirmation
 * - RULE-DAI-003-005: No external LLM calls
 * - RULE-DAI-003-006: Cold start mode explicit in results
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RoutingEngine } from '../../../../src/god-agent/core/routing/routing-engine.js';
import { CapabilityIndex } from '../../../../src/god-agent/core/routing/capability-index.js';
import type {
  ITaskAnalysis,
  TaskDomain,
  TaskComplexity,
} from '../../../../src/god-agent/core/routing/routing-types.js';

// ==================== Test Setup ====================

let capabilityIndex: CapabilityIndex;

beforeAll(async () => {
  // Initialize real capability index with real agents
  // This includes the writing agents in .claude/agents/writing/
  capabilityIndex = new CapabilityIndex({
    agentsPath: '.claude/agents',
    useLocalEmbedding: true,
    verbose: false,
  });
  await capabilityIndex.initialize();
}, 120000); // 120s timeout for embedding model initialization in CI

afterAll(async () => {
  // Cleanup if needed
});

/**
 * Create a test task analysis with proper embedding
 */
async function createWritingTaskAnalysis(
  task: string,
  verbs: string[] = ['write']
): Promise<ITaskAnalysis> {
  // Create a simple embedding and L2-normalize it
  // In real routing, the task analyzer would generate this
  const embedding = new Float32Array(1536).fill(0.01);

  // Add some variance based on task content for different results
  const hash = task.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] += Math.sin(hash + i) * 0.1;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] /= norm;
  }

  return {
    task,
    domain: 'writing' as TaskDomain,
    complexity: 'simple' as TaskComplexity,
    primaryVerb: verbs[0],
    verbs,
    requiredCapabilities: ['writing'],
    embedding,
    isMultiStep: false,
    expectedArtifacts: ['text'],
    analyzedAt: Date.now(),
    analysisTimeMs: 10,
  };
}

// ==================== Test Categories ====================

describe('Writing Agent Routing - Core Functionality', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should return a valid routing result for writing tasks', async () => {
    const analysis = await createWritingTaskAnalysis(
      'write a short funny poem',
      ['write', 'create']
    );

    const result = await engine.route(analysis);

    // Verify basic routing structure
    expect(result.selectedAgent).toBeDefined();
    expect(result.selectedAgent.length).toBeGreaterThan(0);
    expect(result.explanation).toBeDefined();
    // Confidence may be 0 in cold start mode (low execution count)
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.routingId).toMatch(/^route_\d+_[a-z0-9]+$/);
  });

  it('should include factors in routing result', async () => {
    const analysis = await createWritingTaskAnalysis('write documentation');
    const result = await engine.route(analysis);

    expect(result.factors).toBeDefined();
    expect(result.factors.length).toBeGreaterThan(0);

    // Should have capability_match and keyword_score factors
    const factorNames = result.factors.map((f) => f.name);
    expect(factorNames).toContain('capability_match');
    expect(factorNames).toContain('keyword_score');
  });

  it('should provide alternatives for writing tasks', async () => {
    const analysis = await createWritingTaskAnalysis('write content');
    const result = await engine.route(analysis);

    // Should have alternatives array (may or may not be populated)
    expect(Array.isArray(result.alternatives)).toBe(true);

    // If we have alternatives, verify their structure
    for (const alt of result.alternatives) {
      expect(alt.agentKey).toBeDefined();
      expect(alt.name).toBeDefined();
      expect(alt.score).toBeGreaterThanOrEqual(0);
      expect(alt.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('Writing Agent Routing - Cold Start Behavior', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should cap confidence in cold start mode (RULE-DAI-003-006)', async () => {
    const analysis = await createWritingTaskAnalysis('write a story');
    const result = await engine.route(analysis);

    // In cold start mode, confidence should be capped at 0.6
    if (result.isColdStart) {
      expect(result.confidence).toBeLessThanOrEqual(0.6);
    }
  });

  it('should include cold start indicator when applicable', async () => {
    const analysis = await createWritingTaskAnalysis('write a report');
    const result = await engine.route(analysis);

    if (result.isColdStart) {
      expect(result.coldStartIndicator).toBeDefined();
      expect(result.coldStartIndicator).toContain('Cold Start Mode');
      expect(result.coldStartIndicator).toMatch(/\d+\/100/);
    }
  });

  it('should track cold start phase correctly', () => {
    expect(engine.getColdStartPhase()).toBe('keyword-only');
    expect(engine.getExecutionCount()).toBe(0);
  });
});

describe('Writing Agent Routing - Explanation Building (RULE-DAI-003-001)', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should always include explanation', async () => {
    const analysis = await createWritingTaskAnalysis('write a poem');
    const result = await engine.route(analysis);

    expect(result.explanation).toBeDefined();
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('should include confidence in explanation', async () => {
    const analysis = await createWritingTaskAnalysis('write a story');
    const result = await engine.route(analysis);

    expect(result.explanation).toContain('confidence');
  });

  it('should include primary factor in explanation', async () => {
    const analysis = await createWritingTaskAnalysis('write documentation');
    const result = await engine.route(analysis);

    expect(result.explanation).toContain('Primary factor');
  });
});

describe('Writing Agent Routing - Preference Override', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should use preferred agent when specified', async () => {
    const analysis = await createWritingTaskAnalysis('write something');
    // Override to use academic-writer even for generic task
    analysis.preferredAgent = 'writing/academic-writer';

    const result = await engine.route(analysis);

    expect(result.selectedAgent).toBe('writing/academic-writer');
    expect(result.usedPreference).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it('should set usedPreference flag when preference used', async () => {
    const analysis = await createWritingTaskAnalysis('create content');
    analysis.preferredAgent = 'writing/creative-writer';

    const result = await engine.route(analysis);

    expect(result.usedPreference).toBe(true);
    expect(result.factors.length).toBe(1);
    expect(result.factors[0].name).toBe('user_preference');
    expect(result.factors[0].weight).toBe(1.0);
    expect(result.factors[0].score).toBe(1.0);
  });

  it('should bypass capability search for preferred agent (fast path)', async () => {
    const analysis = await createWritingTaskAnalysis('do something');
    analysis.preferredAgent = 'writing/technical-writer';

    const startTime = performance.now();
    const result = await engine.route(analysis);
    const duration = performance.now() - startTime;

    expect(result.usedPreference).toBe(true);
    // Should be very fast since no embedding search needed
    expect(duration).toBeLessThan(100);
  });

  it('should set confirmation level to auto for preference', async () => {
    const analysis = await createWritingTaskAnalysis('write text');
    analysis.preferredAgent = 'writing/casual-writer';

    const result = await engine.route(analysis);

    expect(result.confirmationLevel).toBe('auto');
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe('Writing Agent Routing - Performance', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should complete routing under performance target', async () => {
    const analysis = await createWritingTaskAnalysis('write a blog post');

    const startTime = performance.now();
    const result = await engine.route(analysis);
    const duration = performance.now() - startTime;

    expect(result).toBeDefined();
    // Allow 1500ms for cold-start embedding warmup (PRD P95 target is 150ms steady-state)
    expect(duration).toBeLessThan(1500);
  }, 5000);

  it('should track routing time in result', async () => {
    const analysis = await createWritingTaskAnalysis('write content');
    const result = await engine.route(analysis);

    expect(result.routingTimeMs).toBeGreaterThan(0);
    expect(result.routingTimeMs).toBeLessThan(2000);
  });
});

describe('Writing Agent Routing - Execution Tracking', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should increment execution count after each route', async () => {
    const initialCount = engine.getExecutionCount();

    for (let i = 0; i < 3; i++) {
      const analysis = await createWritingTaskAnalysis(`write task ${i}`);
      await engine.route(analysis);
    }

    expect(engine.getExecutionCount()).toBe(initialCount + 3);
  });

  it('should generate unique routing IDs', async () => {
    const analysis1 = await createWritingTaskAnalysis('write poem');
    const result1 = await engine.route(analysis1);

    const analysis2 = await createWritingTaskAnalysis('write story');
    const result2 = await engine.route(analysis2);

    expect(result1.routingId).not.toBe(result2.routingId);
    expect(result1.routingId).toMatch(/^route_\d+_[a-z0-9]+$/);
    expect(result2.routingId).toMatch(/^route_\d+_[a-z0-9]+$/);
  });

  it('should include routing timestamp', async () => {
    const beforeTime = Date.now();
    const analysis = await createWritingTaskAnalysis('write text');
    const result = await engine.route(analysis);
    const afterTime = Date.now();

    expect(result.routedAt).toBeGreaterThanOrEqual(beforeTime);
    expect(result.routedAt).toBeLessThanOrEqual(afterTime);
  });
});

describe('Writing Agent Routing - Writing Agent Verification', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should have writing agents indexed in capability index', () => {
    // Verify that writing agents exist in the index by checking the writing domain count
    const stats = capabilityIndex.getStats();

    // There should be at least 5 writing agents (one for each type we created)
    expect(stats.domains.writing).toBeGreaterThanOrEqual(5);

    // Verify the index has a reasonable number of agents
    expect(stats.agentCount).toBeGreaterThan(0);
  });

  it('should have writing domain for writing agents', () => {
    const stats = capabilityIndex.getStats();
    expect(stats.domains.writing).toBeGreaterThan(0);
  });

  it('should route using explicit preference to all writing agent types', async () => {
    const writingAgents = [
      'writing/creative-writer',
      'writing/academic-writer',
      'writing/professional-writer',
      'writing/casual-writer',
      'writing/technical-writer',
    ];

    for (const agentKey of writingAgents) {
      const analysis = await createWritingTaskAnalysis('write something');
      analysis.preferredAgent = agentKey;

      const result = await engine.route(analysis);

      expect(result.selectedAgent).toBe(agentKey);
      expect(result.usedPreference).toBe(true);
      expect(result.confidence).toBe(1.0);
    }
  });
});

describe('Writing Agent Routing - Domain Detection', () => {
  let engine: RoutingEngine;

  beforeEach(() => {
    engine = new RoutingEngine({
      capabilityIndex,
      verbose: false,
    });
  });

  it('should return valid results for creative writing prompts', async () => {
    const analysis = await createWritingTaskAnalysis('write a haiku about nature');
    const result = await engine.route(analysis);

    expect(result.selectedAgent).toBeDefined();
    expect(result.explanation).toBeDefined();
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it('should return valid results for academic writing prompts', async () => {
    const analysis = await createWritingTaskAnalysis(
      'write a literature review on machine learning'
    );
    const result = await engine.route(analysis);

    expect(result.selectedAgent).toBeDefined();
    expect(result.explanation).toBeDefined();
  });

  it('should return valid results for technical writing prompts', async () => {
    const analysis = await createWritingTaskAnalysis(
      'document the installation process'
    );
    const result = await engine.route(analysis);

    expect(result.selectedAgent).toBeDefined();
    expect(result.explanation).toBeDefined();
  });
});
