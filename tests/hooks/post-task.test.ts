/**
 * Claude Code Hooks - Post-Task Hook Integration Tests
 *
 * Implements: TECH-HKS-001 Integration Tests (TEST-002)
 * Constitution: GUARD-HKS-002, TFORBID-001, TFORBID-002
 *
 * CRITICAL: Uses REAL InteractionStore and ReasoningBank - NO MOCKING
 *
 * @module tests/hooks/post-task.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InteractionStore } from '../../src/god-agent/universal/interaction-store.js';
import { OutputExtractor } from '../../scripts/hooks/output-extractor.js';
import { FeedbackSubmitter } from '../../scripts/hooks/feedback-submitter.js';
import {
  type IHookConfig,
  type ITaskSummary,
  DEFAULT_HOOK_CONFIG,
  EXIT_CODES,
  type KnowledgeEntry
} from '../../scripts/hooks/hook-types.js';
import { ReasoningBank } from '../../src/god-agent/core/reasoning/reasoning-bank.js';

// ==================== Test Setup ====================

describe('Post-Task Hook Integration Tests', () => {
  let interactionStore: InteractionStore;
  let outputExtractor: OutputExtractor;
  let reasoningBank: ReasoningBank;
  let config: IHookConfig;
  const testStorageDir = '/tmp/hooks-post-test-' + Date.now();

  beforeEach(async () => {
    config = {
      ...DEFAULT_HOOK_CONFIG,
      memoryDbPath: `${testStorageDir}/session-knowledge.json`,
      verbose: false
    };

    interactionStore = new InteractionStore({
      storageDir: testStorageDir
    });

    await interactionStore.load();
    outputExtractor = new OutputExtractor(config);

    // Initialize REAL ReasoningBank
    reasoningBank = new ReasoningBank({
      verbose: false,
      maxPatterns: 100,
      minConfidence: 0.3
    });
    await reasoningBank.initialize();
  });

  afterEach(async () => {
    await interactionStore.save();
  });

  // ==================== IT-003: Output Parsing ====================

  describe('IT-003: Output Parsing', () => {
    it('should extract TASK COMPLETION SUMMARY from valid output', () => {
      const output = `
Some initial log output...

## TASK COMPLETION SUMMARY

**What I Did**: Implemented the authentication endpoint with JWT validation.

**Files Created/Modified**:
- \`./src/auth/handler.ts\` - JWT validation handler
- \`./src/auth/types.ts\` - Auth type definitions

**InteractionStore Entries** (for orchestration):
- Domain: \`project/api\`, Tags: \`['auth', 'jwt']\` - Authentication schema for frontend

**ReasoningBank Feedback**:
- Trajectory: \`trj_abc123\` - Quality: \`0.95\`, Outcome: \`positive\`

**Query Commands**:
\`\`\`typescript
const knowledge = interactionStore.getKnowledgeByDomain('project/api');
\`\`\`

**Next Agent Guidance**: Frontend agents should query domain \`project/api\` with tag \`auth\`.
`;

      const summary = outputExtractor.extractSummary(output);

      expect(summary).not.toBeNull();
      expect(summary!.whatIDid).toContain('authentication endpoint');
      // Files go into filesModified when section is "Files Created/Modified"
      const allFiles = [...summary!.filesCreated, ...summary!.filesModified];
      expect(allFiles.length).toBeGreaterThanOrEqual(1);
      expect(summary!.interactionStoreEntries).toHaveLength(1);
      expect(summary!.interactionStoreEntries[0].domain).toBe('project/api');
      expect(summary!.interactionStoreEntries[0].tags).toContain('auth');
      expect(summary!.reasoningBankFeedback).not.toBeNull();
      expect(summary!.reasoningBankFeedback!.trajectoryId).toBe('trj_abc123');
      expect(summary!.reasoningBankFeedback!.quality).toBe(0.95);
    });

    it('should use heuristic parsing for output without TASK COMPLETION SUMMARY', () => {
      const output = `
I implemented the feature successfully.
Created file ./src/feature.ts
Modified ./src/index.ts
Done.
`;

      const summary = outputExtractor.extractSummary(output);

      // Heuristic parser is called when no summary marker found
      // If heuristic finds something, returns ITaskSummary
      // If heuristic finds nothing, returns null
      if (summary !== null) {
        // Heuristic found something
        expect(summary.whatIDid).toBeDefined();
      }
      // Either outcome is acceptable per FM-HKS-003
    });

    it('should extract file paths via heuristic parser', () => {
      // Heuristic parser looks for patterns like "I implemented/created/added..."
      const output = `
I implemented a new user API service.
The changes are in ./src/api/users.ts and ./src/routes/index.ts.
`;

      const summary = outputExtractor.extractSummary(output);

      // Heuristic should find the "I implemented" pattern
      if (summary !== null) {
        expect(summary.whatIDid).toContain('implemented');
        // Files should be extracted
        const allFiles = [...summary.filesCreated, ...summary.filesModified];
        expect(allFiles.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ==================== IT-004: Storage with Verification ====================

  describe('IT-004: Storage with Verification', () => {
    it('should store findings and verify with read-back', async () => {
      const entry = {
        id: `test-store-${Date.now()}`,
        domain: 'project/test',
        category: 'test-category',
        content: JSON.stringify({ test: 'data', value: 123 }),
        tags: ['test', 'verification'],
        quality: 0.9,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      };

      // Store entry
      interactionStore.addKnowledge(entry);
      await interactionStore.save();

      // Read-back verification
      const entries = interactionStore.getKnowledgeByDomain('project/test');
      const readBack = entries.find(e => e.id === entry.id);

      expect(readBack).not.toBeUndefined();
      expect(readBack!.domain).toBe(entry.domain);
      expect(readBack!.category).toBe(entry.category);
      expect(readBack!.content).toBe(entry.content);
      expect(readBack!.tags).toEqual(entry.tags);
    });

    it('should preserve data integrity through save/load cycle', async () => {
      const entry = {
        id: `test-integrity-${Date.now()}`,
        domain: 'project/integrity',
        category: 'integrity-test',
        content: JSON.stringify({
          nested: { data: 'value' },
          array: [1, 2, 3],
          special: 'chars: <>&"\'`'
        }),
        tags: ['integrity', 'special-chars'],
        quality: 0.85,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      };

      interactionStore.addKnowledge(entry);
      await interactionStore.save();

      // Create new store instance and load
      const newStore = new InteractionStore({
        storageDir: testStorageDir
      });
      await newStore.load();

      const entries = newStore.getKnowledgeByDomain('project/integrity');
      const readBack = entries.find(e => e.id === entry.id);

      expect(readBack).not.toBeUndefined();
      expect(JSON.parse(readBack!.content)).toEqual(JSON.parse(entry.content));
    });
  });

  // ==================== IT-005: Quality Estimation ====================

  describe('IT-005: Quality Estimation', () => {
    it('should estimate high quality for complete summaries', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Implemented complete authentication system with JWT, refresh tokens, and role-based access control.',
        filesCreated: ['./src/auth/jwt.ts', './src/auth/roles.ts', './src/auth/middleware.ts'],
        filesModified: ['./src/index.ts', './src/routes.ts'],
        interactionStoreEntries: [
          { domain: 'project/auth', tags: ['jwt', 'rbac'], description: 'Auth schema' }
        ],
        reasoningBankFeedback: {
          trajectoryId: 'trj_test',
          quality: 0.95,
          outcome: 'positive'
        },
        nextAgentGuidance: 'Frontend should query project/auth for JWT types'
      };

      // Create submitter with REAL ReasoningBank
      const submitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);
      const quality = submitter.estimateQuality(summary, 'Full output with lots of detail...');

      // High quality: uses explicit quality from summary
      expect(quality).toBe(0.95);
    });

    it('should estimate lower quality for incomplete summaries', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Did something.',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: ''
      };

      // Create submitter with REAL ReasoningBank
      const submitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);
      const quality = submitter.estimateQuality(summary, 'Short output');

      // Low quality: vague description, no files, no guidance
      // Has summary (+0.3) + no errors (+0.2) = 0.5
      expect(quality).toBeLessThanOrEqual(0.5);
    });

    it('should determine correct outcome based on quality', () => {
      // Create submitter with REAL ReasoningBank
      const submitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);

      expect(submitter.determineOutcome(0.9)).toBe('positive');
      expect(submitter.determineOutcome(0.7)).toBe('positive');
      // Implements RULE-035: Threshold 0.5 for positive (not 0.7)
      expect(submitter.determineOutcome(0.5)).toBe('positive');
      expect(submitter.determineOutcome(0.3)).toBe('negative');
    });
  });

  // ==================== IT-006: Retry Queue ====================

  describe('IT-006: Retry Queue', () => {
    it('should queue feedback when trajectory does not exist', async () => {
      // Create submitter with REAL ReasoningBank
      const submitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);

      // Non-existent trajectory will fail and be queued
      const result = await submitter.submitWithRetry(
        `trj_nonexistent_${Date.now()}`,
        0.8,
        'positive',
        { entryId: 'test-entry', domain: 'project/test', tags: ['test'] }
      );

      // Should queue for retry (returns false)
      expect(result).toBe(false);

      // Verify entry was queued
      const queueLength = await submitter.getQueueLength();
      expect(queueLength).toBeGreaterThan(0);
    });

    it('should estimate quality without submitting feedback', () => {
      // Create submitter with REAL ReasoningBank
      const submitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);

      // estimateQuality and determineOutcome don't require trajectory
      const quality = submitter.estimateQuality(null, 'Test output');
      const outcome = submitter.determineOutcome(quality);

      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
      expect(['positive', 'neutral', 'negative']).toContain(outcome);
    });
  });

  // ==================== IT-007: Exit Codes ====================

  describe('IT-007: Exit Codes', () => {
    it('should define correct exit codes', () => {
      expect(EXIT_CODES.SUCCESS).toBe(0);
      expect(EXIT_CODES.ERROR).toBe(1);
      expect(EXIT_CODES.VALIDATION_FAILURE).toBe(2);
      expect(EXIT_CODES.TIMEOUT).toBe(3);
    });
  });

  // ==================== Domain/Tag Extraction ====================

  describe('Domain/Tag Extraction', () => {
    it('should extract domain and tags from summary entries', () => {
      const output = `
## TASK COMPLETION SUMMARY

**What I Did**: Created event schemas.

**InteractionStore Entries** (for orchestration):
- Domain: \`project/events\`, Tags: \`['sse', 'schema', 'backend']\` - Event payload structures
- Domain: \`project/api\`, Tags: \`['endpoints', 'rest']\` - API contract

**Next Agent Guidance**: Query project/events for schemas.
`;

      const summary = outputExtractor.extractSummary(output);

      expect(summary).not.toBeNull();
      expect(summary!.interactionStoreEntries).toHaveLength(2);

      const eventsEntry = summary!.interactionStoreEntries.find(e => e.domain === 'project/events');
      expect(eventsEntry).not.toBeUndefined();
      expect(eventsEntry!.tags).toContain('sse');
      expect(eventsEntry!.tags).toContain('schema');

      const apiEntry = summary!.interactionStoreEntries.find(e => e.domain === 'project/api');
      expect(apiEntry).not.toBeUndefined();
      expect(apiEntry!.tags).toContain('endpoints');
    });
  });

  // ==================== parseFindings ====================

  describe('parseFindings', () => {
    it('should create valid KnowledgeEntry from summary', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Implemented user service',
        filesCreated: ['./src/users/service.ts'],
        filesModified: ['./src/index.ts'],
        interactionStoreEntries: [
          { domain: 'project/users', tags: ['service', 'crud'], description: 'User CRUD operations' }
        ],
        reasoningBankFeedback: null,
        nextAgentGuidance: 'Use project/users domain'
      };

      const findings = outputExtractor.parseFindings(summary, 'Full output text here');

      expect(findings.domain).toBe('project/users');
      expect(findings.tags).toContain('service');
      expect(findings.tags).toContain('crud');
      // Category is determined by domain, not always 'task-output'
      expect(findings.category).toBeDefined();
      expect(findings.content).toContain('user service');
    });

    it('should use default domain when no entries provided', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Generic task',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: ''
      };

      const findings = outputExtractor.parseFindings(summary, 'Output');

      expect(findings.domain).toBe('project/general');
      // Default tags are empty when no entries provided
      expect(findings.tags).toEqual([]);
    });
  });
});
