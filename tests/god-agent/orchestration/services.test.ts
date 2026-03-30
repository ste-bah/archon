/**
 * Layer 2 Services Tests
 *
 * Tests for TASK-ORC-004, ORC-005, ORC-006, ORC-007
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExtractorService } from '../../../src/god-agent/orchestration/services/extractor-service.js';
import { ContextInjector } from '../../../src/god-agent/orchestration/services/context-injector.js';
import { FeedbackGenerator } from '../../../src/god-agent/orchestration/services/feedback-generator.js';
import { InteractionStore } from '../../../src/god-agent/universal/interaction-store.js';
import * as path from 'path';

describe('ExtractorService (TASK-ORC-004)', () => {
  let extractor: ExtractorService;

  beforeEach(() => {
    extractor = new ExtractorService();
  });

  it('should extract code blocks with language tags', () => {
    const output = "Here's the code:\n```typescript\nconst x = 1;\n```";
    const findings = extractor.extractFindings(output);

    expect(findings.codeBlocks).toHaveLength(1);
    expect(findings.codeBlocks[0].language).toBe('typescript');
    expect(findings.codeBlocks[0].code).toBe('const x = 1;');
  });

  it('should extract TypeScript interfaces', () => {
    const output = 'interface User { id: string; name: string; }';
    const findings = extractor.extractFindings(output);

    expect(findings.schemas).toHaveLength(1);
    expect(findings.schemas[0].type).toBe('interface');
    expect(findings.schemas[0].name).toBe('User');
  });

  it('should extract API contracts', () => {
    const output = '@Get(\'/api/users\')';
    const findings = extractor.extractFindings(output);

    expect(findings.apiContracts).toHaveLength(1);
    expect(findings.apiContracts[0].method).toBe('GET');
    expect(findings.apiContracts[0].path).toBe('/api/users');
  });

  it('should extract errors', () => {
    const output = 'Error: Test failed';
    const findings = extractor.extractFindings(output);

    expect(findings.errors).toHaveLength(1);
    expect(findings.errors[0]).toContain('Error: Test failed');
  });

  it('should handle empty output', () => {
    const findings = extractor.extractFindings('');

    expect(findings.codeBlocks).toHaveLength(0);
    expect(findings.schemas).toHaveLength(0);
    expect(findings.apiContracts).toHaveLength(0);
  });
});

describe('ContextInjector (TASK-ORC-006)', () => {
  let injector: ContextInjector;
  let store: InteractionStore;

  beforeEach(() => {
    store = new InteractionStore({
      storageDir: path.join(process.cwd(), '.agentdb-test-context')
    });
    injector = new ContextInjector(store, 8000);
  });

  it('should inject context from InteractionStore', async () => {
    // Add knowledge to store
    store.addKnowledge({
      id: 'test-1',
      domain: 'project/test',
      category: 'schema',
      content: 'Test schema content',
      tags: ['schema', 'api'],
      quality: 1.0,
      usageCount: 0,
      lastUsed: Date.now(),
      createdAt: Date.now()
    });

    const result = await injector.injectContext('Implement X', 'project/test', ['schema']);

    expect(result.enhancedPrompt).toContain('## PRIOR CONTEXT');
    expect(result.contextEntryCount).toBeGreaterThan(0);
  });

  it('should respect token limits', async () => {
    const smallInjector = new ContextInjector(store, 100);

    // Add large knowledge entry
    store.addKnowledge({
      id: 'test-large',
      domain: 'project/test',
      category: 'implementation',
      content: 'A'.repeat(1000), // Large content
      tags: ['test'],
      quality: 1.0,
      usageCount: 0,
      lastUsed: Date.now(),
      createdAt: Date.now()
    });

    const result = await smallInjector.injectContext('Test', 'project/test', []);

    expect(result.contextTokens).toBeLessThanOrEqual(100);
  });

  it('should handle empty knowledge base', async () => {
    const result = await injector.injectContext('Test', 'project/nonexistent', []);

    expect(result.contextEntryCount).toBe(0);
    expect(result.enhancedPrompt).toBe('Test');
  });
});

describe('FeedbackGenerator (TASK-ORC-008)', () => {
  let generator: FeedbackGenerator;

  beforeEach(() => {
    generator = new FeedbackGenerator();
  });

  it('should generate positive feedback for successful tasks', () => {
    const estimate = generator.generateQualityEstimate(
      'Task completed successfully. Files created: auth.ts, auth.test.ts',
      {
        agentType: 'backend-dev',
        taskType: 'implementation',
        success: true
      }
    );

    expect(estimate.quality).toBeGreaterThan(0.7);
    expect(estimate.outcome).toBe('positive');
    expect(estimate.indicators.hasCompletionMarkers).toBe(true);
  });

  it('should generate negative feedback for failed tasks', () => {
    const estimate = generator.generateQualityEstimate(
      'Error: Test failed. Exception thrown.',
      {
        agentType: 'tester',
        taskType: 'testing',
        success: false,
        error: 'Test failed'
      }
    );

    expect(estimate.quality).toBeLessThan(0.4);
    expect(estimate.outcome).toBe('negative');
    expect(estimate.indicators.hasErrors).toBe(true);
  });

  it('should detect deliverables', () => {
    const estimate = generator.generateQualityEstimate(
      'Created file: app.ts\n```typescript\nconst x = 1;\n```',
      {
        agentType: 'coder',
        taskType: 'implementation',
        success: true
      }
    );

    expect(estimate.indicators.hasExpectedDeliverables).toBe(true);
  });

  it('should handle short output', () => {
    const estimate = generator.generateQualityEstimate(
      'Done',
      {
        agentType: 'coder',
        taskType: 'implementation',
        success: true
      }
    );

    expect(estimate.indicators.outputLengthAdequate).toBe(false);
  });
});
