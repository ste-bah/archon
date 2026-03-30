/**
 * Claude Code Hooks - End-to-End Integration Tests
 *
 * Implements: TECH-HKS-001 E2E Tests (TEST-003)
 * Constitution: GUARD-HKS-002, TFORBID-001, TFORBID-002
 *
 * CRITICAL: Uses REAL components throughout - NO MOCKING
 *
 * Tests the complete hook workflow:
 * 1. Pre-task: Prompt → Context Injection → Enhanced Prompt
 * 2. Post-task: Output → Extraction → Storage → Verification → Feedback
 *
 * @module tests/hooks/e2e.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InteractionStore } from '../../src/god-agent/universal/interaction-store.js';
import { ContextInjector } from '../../scripts/hooks/context-injector.js';
import { OutputExtractor } from '../../scripts/hooks/output-extractor.js';
import { FeedbackSubmitter } from '../../scripts/hooks/feedback-submitter.js';
import {
  type IHookConfig,
  type KnowledgeEntry,
  DEFAULT_HOOK_CONFIG
} from '../../scripts/hooks/hook-types.js';
import { ReasoningBank } from '../../src/god-agent/core/reasoning/reasoning-bank.js';
import * as crypto from 'crypto';

// ==================== Test Setup ====================

describe('E2E Hook Integration Tests', () => {
  let interactionStore: InteractionStore;
  let contextInjector: ContextInjector;
  let outputExtractor: OutputExtractor;
  let config: IHookConfig;
  const testStorageDir = '/tmp/hooks-e2e-test-' + Date.now();

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
    contextInjector = new ContextInjector(interactionStore, config);
    outputExtractor = new OutputExtractor(config);
  });

  afterEach(async () => {
    await interactionStore.save();
  });

  // ==================== E2E-001: Full Pre-Task Flow ====================

  describe('E2E-001: Full Pre-Task Flow', () => {
    it('should complete full pre-task workflow: seed → inject → verify', async () => {
      // Step 1: Seed InteractionStore with prior knowledge
      const priorKnowledge: KnowledgeEntry = {
        id: 'e2e-prior-1',
        domain: 'project/api',
        category: 'schema',
        content: JSON.stringify({
          endpoint: '/users',
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          auth: 'jwt'
        }),
        tags: ['api', 'users', 'crud'],
        quality: 0.95,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      };

      interactionStore.addKnowledge(priorKnowledge);

      // Step 2: Simulate incoming Task() prompt
      const originalPrompt = 'Implement the user profile update endpoint';

      // Step 3: Pre-task hook injects context
      const result = await contextInjector.inject(
        originalPrompt,
        'project/api',
        ['users']
      );

      // Step 4: Verify injection
      expect(result.enhancedPrompt).toContain(originalPrompt);
      expect(result.enhancedPrompt).toContain('## MEMORY CONTEXT');
      expect(result.enhancedPrompt).toContain('/users');
      expect(result.enhancedPrompt).toContain('jwt');
      expect(result.entryCount).toBe(1);
      expect(result.wasTruncated).toBe(false);
    });

    it('should handle multi-domain context injection', async () => {
      // Seed multiple domains
      interactionStore.addKnowledge({
        id: 'e2e-multi-1',
        domain: 'project/api',
        category: 'schema',
        content: JSON.stringify({ endpoint: '/auth/login' }),
        tags: ['api', 'auth'],
        quality: 0.9,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      interactionStore.addKnowledge({
        id: 'e2e-multi-2',
        domain: 'project/database',
        category: 'schema',
        content: JSON.stringify({ table: 'users', columns: ['id', 'email'] }),
        tags: ['database', 'users'],
        quality: 0.85,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // Query API domain
      const apiResult = await contextInjector.inject(
        'Add authentication',
        'project/api',
        ['auth']
      );

      expect(apiResult.entryCount).toBe(1);
      expect(apiResult.enhancedPrompt).toContain('/auth/login');

      // Query database domain
      const dbResult = await contextInjector.inject(
        'Update user schema',
        'project/database',
        ['users']
      );

      expect(dbResult.entryCount).toBe(1);
      expect(dbResult.enhancedPrompt).toContain('users');
    });
  });

  // ==================== E2E-002: Full Post-Task Flow ====================

  describe('E2E-002: Full Post-Task Flow', () => {
    it('should complete full post-task workflow: extract → store → verify', async () => {
      // Step 1: Simulate Task() output with TASK COMPLETION SUMMARY
      const taskOutput = `
Building the authentication system...
Compiling TypeScript...
Tests passing...

## TASK COMPLETION SUMMARY

**What I Did**: Implemented JWT authentication with refresh token support and role-based access control.

**Files Created/Modified**:
- \`./src/auth/jwt.ts\` - JWT generation and validation
- \`./src/auth/refresh.ts\` - Refresh token handling
- \`./src/auth/rbac.ts\` - Role-based access control

**InteractionStore Entries** (for orchestration):
- Domain: \`project/auth\`, Tags: \`['jwt', 'rbac', 'tokens']\` - Complete auth schema for frontend integration

**ReasoningBank Feedback**:
- Trajectory: \`trj_e2e_001\` - Quality: \`0.92\`, Outcome: \`positive\`

**Query Commands**:
\`\`\`typescript
const auth = interactionStore.getKnowledgeByDomain('project/auth');
\`\`\`

**Next Agent Guidance**: Frontend agents should query domain \`project/auth\` with tag \`jwt\` for token handling types.
`;

      // Step 2: Extract summary
      const summary = outputExtractor.extractSummary(taskOutput);
      expect(summary).not.toBeNull();

      // Step 3: Parse findings
      const findings = outputExtractor.parseFindings(summary!, taskOutput);
      expect(findings.domain).toBe('project/auth');
      expect(findings.tags).toContain('jwt');

      // Step 4: Store in InteractionStore
      const entryId = `e2e-store-${Date.now()}`;
      const entry: KnowledgeEntry = {
        id: entryId,
        ...findings,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      };

      interactionStore.addKnowledge(entry);
      await interactionStore.save();

      // Step 5: Verify with read-back
      const entries = interactionStore.getKnowledgeByDomain('project/auth');
      const readBack = entries.find(e => e.id === entryId);

      expect(readBack).not.toBeUndefined();
      expect(readBack!.domain).toBe(entry.domain);

      // Verify content hash
      const originalHash = crypto.createHash('sha256').update(entry.content).digest('hex');
      const readBackHash = crypto.createHash('sha256').update(readBack!.content).digest('hex');
      expect(originalHash).toBe(readBackHash);
    });
  });

  // ==================== E2E-003: Round-Trip Integration ====================

  describe('E2E-003: Round-Trip Integration', () => {
    it('should complete full round-trip: pre-task → task → post-task → next pre-task', async () => {
      // === PHASE 1: First Task (Backend) ===

      // Pre-task: Query fresh domain with no prior data
      const backendPrompt = 'Create user API endpoints';
      const freshDomain = `project/fresh-${Date.now()}`; // Unique domain
      const preResult1 = await contextInjector.inject(
        backendPrompt,
        freshDomain,
        ['users']
      );

      // Should have no injected context (fresh domain)
      expect(preResult1.entryCount).toBe(0);
      expect(preResult1.enhancedPrompt).toBe(backendPrompt);

      // Simulate backend task completing
      const backendOutput = `
## TASK COMPLETION SUMMARY

**What I Did**: Created REST API endpoints for user management with CRUD operations.

**Files Created/Modified**:
- \`./src/api/users.ts\` - User CRUD endpoints

**InteractionStore Entries** (for orchestration):
- Domain: \`project/api\`, Tags: \`['users', 'crud', 'endpoints']\` - User API schema for frontend

**Next Agent Guidance**: Frontend should query project/api for endpoint schemas.
`;

      // Post-task: Extract and store
      const backendSummary = outputExtractor.extractSummary(backendOutput);
      const backendFindings = outputExtractor.parseFindings(backendSummary!, backendOutput);

      const backendEntryId = `e2e-backend-${Date.now()}`;
      interactionStore.addKnowledge({
        id: backendEntryId,
        ...backendFindings,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // === PHASE 2: Second Task (Frontend) - Uses Backend Context ===

      // Pre-task: Should inject backend context
      const frontendPrompt = 'Create React components for user management';
      const preResult2 = await contextInjector.inject(
        frontendPrompt,
        'project/api',
        ['users']
      );

      // Should have injected backend context (may have 1-2 entries depending on test isolation)
      expect(preResult2.entryCount).toBeGreaterThanOrEqual(1);
      expect(preResult2.enhancedPrompt).toContain('## MEMORY CONTEXT');
      expect(preResult2.enhancedPrompt).toContain('CRUD');

      // Simulate frontend task completing
      const frontendOutput = `
## TASK COMPLETION SUMMARY

**What I Did**: Created React components with TypeScript types matching API schema.

**Files Created/Modified**:
- \`./src/components/UserList.tsx\` - User list component
- \`./src/types/user.ts\` - TypeScript types

**InteractionStore Entries** (for orchestration):
- Domain: \`project/frontend\`, Tags: \`['react', 'users', 'components']\` - Frontend component schema for tests

**Next Agent Guidance**: Test agents should query project/frontend and project/api for integration tests.
`;

      // Post-task: Extract and store
      const frontendSummary = outputExtractor.extractSummary(frontendOutput);
      const frontendFindings = outputExtractor.parseFindings(frontendSummary!, frontendOutput);

      const frontendEntryId = `e2e-frontend-${Date.now()}`;
      interactionStore.addKnowledge({
        id: frontendEntryId,
        ...frontendFindings,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      });

      // === PHASE 3: Third Task (Tests) - Uses Both Contexts ===

      // Pre-task for API context
      const testPrompt1 = await contextInjector.inject(
        'Write integration tests',
        'project/api',
        ['users']
      );
      // Multiple entries accumulated throughout test (backend + frontend both use project/api)
      expect(testPrompt1.entryCount).toBeGreaterThanOrEqual(1);

      // Pre-task for frontend context
      const testPrompt2 = await contextInjector.inject(
        'Write integration tests',
        'project/frontend',
        ['users']
      );
      expect(testPrompt2.entryCount).toBeGreaterThanOrEqual(1);

      // Verify both contexts are independently available
      const apiEntries = interactionStore.getKnowledgeByDomain('project/api');
      const frontendEntries = interactionStore.getKnowledgeByDomain('project/frontend');

      expect(apiEntries.length).toBeGreaterThanOrEqual(1);
      expect(frontendEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== E2E-004: Quality Estimation Round-Trip ====================

  describe('E2E-004: Quality Estimation', () => {
    it('should estimate quality consistently through workflow', async () => {
      // Initialize REAL ReasoningBank for this test
      const testReasoningBank = new ReasoningBank({
        verbose: false,
        maxPatterns: 100,
        minConfidence: 0.3
      });
      await testReasoningBank.initialize();

      const highQualityOutput = `
## TASK COMPLETION SUMMARY

**What I Did**: Implemented comprehensive payment processing system with Stripe integration, webhook handling, refund support, and detailed audit logging for compliance.

**Files Created/Modified**:
- \`./src/payments/stripe.ts\` - Stripe API integration
- \`./src/payments/webhooks.ts\` - Webhook handlers
- \`./src/payments/refunds.ts\` - Refund processing
- \`./src/payments/audit.ts\` - Audit logging
- \`./src/types/payment.ts\` - TypeScript definitions

**InteractionStore Entries** (for orchestration):
- Domain: \`project/payments\`, Tags: \`['stripe', 'webhooks', 'refunds']\` - Payment system schema

**ReasoningBank Feedback**:
- Trajectory: \`trj_payment_001\` - Quality: \`0.95\`, Outcome: \`positive\`

**Next Agent Guidance**: Integration tests should cover all webhook event types and refund scenarios.
`;

      const summary = outputExtractor.extractSummary(highQualityOutput);
      const submitter = new FeedbackSubmitter(testReasoningBank, config, testStorageDir);

      const quality = submitter.estimateQuality(summary, highQualityOutput);

      // High quality: uses explicit quality from summary (0.95)
      expect(quality).toBe(0.95);
      expect(submitter.determineOutcome(quality)).toBe('positive');
    });
  });

  // ==================== E2E-005: Error Recovery ====================

  describe('E2E-005: Error Recovery', () => {
    it('should gracefully handle malformed output', () => {
      const malformedOutput = `
Random text without any structure
No summary section at all
Just some logs and gibberish
ERROR: Something failed
`;

      // extractSummary uses heuristic when no marker found
      // Heuristic returns null if it finds nothing useful
      const summary = outputExtractor.extractSummary(malformedOutput);

      // Per FM-HKS-003: graceful handling - null is acceptable
      // The output has no "I implemented/created/added" pattern and no file paths
      expect(summary).toBeNull();
    });

    it('should handle partial summary', () => {
      const partialOutput = `
## TASK COMPLETION SUMMARY

**What I Did**: Something incomplete...

(Rest of output is missing)
`;

      const summary = outputExtractor.extractSummary(partialOutput);

      // Should extract what's available
      expect(summary).not.toBeNull();
      expect(summary!.whatIDid).toContain('incomplete');
      expect(summary!.filesCreated).toEqual([]);
    });
  });

  // ==================== E2E-006: Performance Budget ====================

  describe('E2E-006: Performance Budget', () => {
    it('should complete pre-task injection within budget', async () => {
      // Seed some data
      for (let i = 0; i < 10; i++) {
        interactionStore.addKnowledge({
          id: `perf-test-${i}`,
          domain: 'project/perf',
          category: 'test',
          content: `Test content ${i}`,
          tags: ['perf', 'test'],
          quality: 0.8,
          usageCount: 0,
          lastUsed: Date.now(),
          createdAt: Date.now()
        });
      }

      const startTime = Date.now();

      await contextInjector.inject(
        'Performance test prompt',
        'project/perf',
        ['test']
      );

      const duration = Date.now() - startTime;

      // Should complete within pre-task budget (500ms default)
      expect(duration).toBeLessThan(config.preTaskTimeoutMs);
    });

    it('should complete post-task extraction within budget', () => {
      const output = `
## TASK COMPLETION SUMMARY

**What I Did**: Performance test task.

**Files Created/Modified**:
- \`./src/test.ts\` - Test file

**InteractionStore Entries** (for orchestration):
- Domain: \`project/test\`, Tags: \`['test']\` - Test data
`;

      const startTime = Date.now();

      outputExtractor.extractSummary(output);
      outputExtractor.heuristicParse(output);

      const duration = Date.now() - startTime;

      // Extraction should be fast (< 100ms)
      expect(duration).toBeLessThan(100);
    });
  });

  // ==================== E2E-007: Data Integrity ====================

  describe('E2E-007: Data Integrity', () => {
    it('should preserve special characters through round-trip', async () => {
      const specialContent = {
        html: '<div class="test">Content</div>',
        sql: "SELECT * FROM users WHERE name = 'O''Brien'",
        regex: '/^[a-z]+\\d+$/gi',
        unicode: '日本語 emoji 🚀 ñoño'
      };

      const entry: KnowledgeEntry = {
        id: 'e2e-special-chars',
        domain: 'project/special',
        category: 'test',
        content: JSON.stringify(specialContent),
        tags: ['special', 'chars'],
        quality: 1.0,
        usageCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
      };

      interactionStore.addKnowledge(entry);
      await interactionStore.save();

      // Reload and verify
      const newStore = new InteractionStore({ storageDir: testStorageDir });
      await newStore.load();

      const entries = newStore.getKnowledgeByDomain('project/special');
      const readBack = entries.find(e => e.id === 'e2e-special-chars');

      expect(readBack).not.toBeUndefined();
      const parsed = JSON.parse(readBack!.content);

      expect(parsed.html).toBe(specialContent.html);
      expect(parsed.sql).toBe(specialContent.sql);
      expect(parsed.regex).toBe(specialContent.regex);
      expect(parsed.unicode).toBe(specialContent.unicode);
    });
  });
});
