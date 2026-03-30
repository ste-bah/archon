/**
 * Claude Code Hooks - FeedbackSubmitter Unit Tests
 *
 * Implements: RULE-051 (90% coverage requirement)
 * Tests: Unified quality estimator integration per RULE-033, RULE-034, RULE-035
 *
 * Test Coverage:
 * - estimateQuality() unified delegation to assessQuality
 * - detectMode() agent mode detection
 * - determineOutcome() with RULE-035 compliant thresholds (0.5 not 0.7)
 * - Regression test for IT Governance prose response bug
 *
 * @module tests/hooks/feedback-submitter.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FeedbackSubmitter } from '../../scripts/hooks/feedback-submitter.js';
import {
  type IHookConfig,
  type ITaskSummary,
  DEFAULT_HOOK_CONFIG,
} from '../../scripts/hooks/hook-types.js';
import { ReasoningBank } from '../../src/god-agent/core/reasoning/reasoning-bank.js';
import type { IPostToolUseContext } from '../../src/god-agent/core/hooks/types.js';

// ==================== Test Setup ====================

describe('FeedbackSubmitter', () => {
  let reasoningBank: ReasoningBank;
  let config: IHookConfig;
  let submitter: FeedbackSubmitter;
  const testStorageDir = '/tmp/feedback-submitter-test-' + Date.now();

  beforeEach(async () => {
    config = {
      ...DEFAULT_HOOK_CONFIG,
      memoryDbPath: `${testStorageDir}/session-knowledge.json`,
      verbose: false,
    };

    // Initialize REAL ReasoningBank (no mocking per GUARD-HKS-002)
    reasoningBank = new ReasoningBank({
      verbose: false,
      maxPatterns: 100,
      minConfidence: 0.3,
    });
    await reasoningBank.initialize();

    submitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== Constructor Tests ====================

  describe('constructor', () => {
    it('should throw error if ReasoningBank is null', () => {
      expect(() => {
        new FeedbackSubmitter(null as unknown as ReasoningBank, config, testStorageDir);
      }).toThrow('[FeedbackSubmitter] ReasoningBank is required');
    });

    it('should throw error if ReasoningBank is undefined', () => {
      expect(() => {
        new FeedbackSubmitter(undefined as unknown as ReasoningBank, config, testStorageDir);
      }).toThrow('[FeedbackSubmitter] ReasoningBank is required');
    });

    it('should create instance with valid dependencies', () => {
      const instance = new FeedbackSubmitter(reasoningBank, config, testStorageDir);
      expect(instance).toBeInstanceOf(FeedbackSubmitter);
    });
  });

  // ==================== estimateQuality() Tests ====================

  describe('estimateQuality unified', () => {
    it('should return explicit quality from summary.reasoningBankFeedback.quality', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Test task',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: {
          trajectoryId: 'trj_test',
          quality: 0.95,
          outcome: 'positive',
        },
        nextAgentGuidance: '',
      };

      const quality = submitter.estimateQuality(summary, 'Test output');
      expect(quality).toBe(0.95);
    });

    it('should respect explicit quality of 0 (edge case)', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Failed task',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: {
          trajectoryId: 'trj_fail',
          quality: 0,
          outcome: 'negative',
        },
        nextAgentGuidance: '',
      };

      const quality = submitter.estimateQuality(summary, 'Error output');
      expect(quality).toBe(0);
    });

    it('should ignore explicit quality > 1 (invalid)', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Test task',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: {
          trajectoryId: 'trj_test',
          quality: 1.5, // Invalid - should be ignored
          outcome: 'positive',
        },
        nextAgentGuidance: '',
      };

      const quality = submitter.estimateQuality(summary, 'Test output');
      // Should delegate to assessQuality since explicit quality is invalid
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
      expect(quality).not.toBe(1.5);
    });

    it('should ignore explicit quality < 0 (invalid)', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Test task',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: {
          trajectoryId: 'trj_test',
          quality: -0.5, // Invalid - should be ignored
          outcome: 'negative',
        },
        nextAgentGuidance: '',
      };

      const quality = submitter.estimateQuality(summary, 'Test output');
      // Should delegate to assessQuality since explicit quality is invalid
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });

    it('should delegate to assessQuality for prose output (research/ask)', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Research on IT Governance frameworks',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: '',
      };

      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Research IT Governance best practices',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'researcher',
        },
      };

      // Long research output
      const output = `
## IT Governance Framework Analysis

IT Governance is a framework that ensures IT investments align with business objectives.
It encompasses several key components:

1. **Strategic Alignment** - Ensuring IT strategy supports business strategy
2. **Value Delivery** - Optimizing IT investments for business value
3. **Risk Management** - Managing IT-related risks effectively
4. **Resource Management** - Efficiently using IT resources
5. **Performance Measurement** - Monitoring and reporting IT performance

### Key Frameworks

According to industry standards, the most widely adopted frameworks include:
- COBIT (Control Objectives for Information Technology)
- ITIL (Information Technology Infrastructure Library)
- ISO/IEC 38500

These frameworks provide structured approaches to IT governance with different focus areas.

### Recommendations

Based on the research, organizations should:
1. Assess current IT governance maturity
2. Select appropriate frameworks
3. Implement incremental improvements
4. Measure outcomes regularly
`;

      const quality = submitter.estimateQuality(summary, output, context);

      // Research mode with long structured output should score well
      expect(quality).toBeGreaterThanOrEqual(0.5);
      expect(quality).toBeLessThanOrEqual(1);
    });

    it('should delegate to assessQuality for code output', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Implemented authentication handler',
        filesCreated: ['./src/auth.ts'],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: '',
      };

      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Implement JWT authentication',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'coder',
        },
      };

      const output = `
## TASK COMPLETION SUMMARY

**What I Did**: Implemented JWT authentication handler with refresh token support.

**Files Created/Modified**:
- \`./src/auth.ts\` - JWT validation handler

\`\`\`typescript
export async function validateToken(token: string): Promise<User> {
  const decoded = jwt.verify(token, SECRET);
  return await User.findById(decoded.userId);
}

export async function refreshToken(refreshToken: string): Promise<TokenPair> {
  const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
  const user = await User.findById(decoded.userId);
  return generateTokenPair(user);
}
\`\`\`

**Next Agent Guidance**: Frontend should implement token refresh logic.
`;

      const quality = submitter.estimateQuality(summary, output, context);

      // Code mode with TASK COMPLETION SUMMARY should score above baseline
      expect(quality).toBeGreaterThanOrEqual(0.3);
    });

    it('should score prose response > 0.5 (not 0.2 like before)', () => {
      // This tests the fix for the original bug
      const summary: ITaskSummary = {
        whatIDid: 'Analyzed IT governance frameworks and provided recommendations',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: '',
      };

      // Context with research mode for proper scoring
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Research IT governance frameworks',
        toolOutput: {},
        sessionId: 'test-prose',
        metadata: {
          agentType: 'researcher',
        },
      };

      // Simulating a comprehensive prose response (the kind that was scoring 0.2)
      // Must be long enough to trigger length bonus in research mode (> 2000 chars)
      const output = `
IT Governance is a critical framework for ensuring that information technology investments
align with and support business objectives. It provides a structured approach to managing
IT resources, risks, and opportunities in a way that maximizes value and minimizes potential
negative impacts. According to industry research, organizations that implement effective
IT governance see significant improvements in their ability to deliver value through technology.

## Key Components of IT Governance:

1. **Strategic Alignment** - IT decisions should directly support business goals
2. **Value Delivery** - IT investments should generate measurable business value
3. **Risk Management** - Identify and mitigate IT-related risks
4. **Resource Management** - Optimize the use of IT resources
5. **Performance Measurement** - Track and report on IT performance metrics

### Implementation Recommendations:

Organizations should start by assessing their current IT governance maturity level,
then progressively implement improvements based on recognized frameworks such as
COBIT, ITIL, or ISO 38500. Regular audits and continuous improvement cycles are
essential for maintaining effective IT governance over time.

According to Gartner and other industry sources, the most successful IT governance
implementations follow a phased approach that includes stakeholder engagement,
process documentation, and continuous monitoring.

Key success factors include executive sponsorship, clear communication of policies,
and integration with existing business processes.
`;

      const quality = submitter.estimateQuality(summary, output, context);

      // CRITICAL: Must score >= 0.5 (was previously scoring ~0.2)
      // With research context and longer structured output, should meet threshold
      expect(quality).toBeGreaterThanOrEqual(0.5);
    });

    it('should handle missing context gracefully', () => {
      const summary: ITaskSummary = {
        whatIDid: 'Completed task',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: '',
      };

      // No context provided - should use default context
      const quality = submitter.estimateQuality(summary, 'Task output text');

      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });

    it('should handle null summary gracefully', () => {
      const quality = submitter.estimateQuality(null, 'Some output text');

      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });

    it('should return 0.5 on error (not throw)', () => {
      // Create a submitter with a broken setup to trigger error path
      const brokenSubmitter = new FeedbackSubmitter(reasoningBank, config, testStorageDir);

      // Mock buildQualityInteraction to throw
      vi.spyOn(brokenSubmitter as any, 'buildQualityInteraction').mockImplementation(() => {
        throw new Error('Test error');
      });

      const quality = brokenSubmitter.estimateQuality(null, 'output');

      // Should return default 0.5 on error
      expect(quality).toBe(0.5);
    });

    it('should handle empty output string', () => {
      const quality = submitter.estimateQuality(null, '');

      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });
  });

  // ==================== detectMode() Tests ====================

  describe('detectMode', () => {
    it('should detect code mode from coder agent type', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Build the component',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'coder',
        },
      };

      // Access private method via reflection for testing
      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('code');
    });

    it('should detect code mode from code in agent type', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'code-analyzer',
        },
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('code');
    });

    it('should detect code mode from implement keyword in input', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Please implement the authentication service',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {},
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('code');
    });

    it('should detect research mode from analyst agent type', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Analyze the codebase',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'analyst',
        },
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('research');
    });

    it('should detect research mode from research in agent type', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'researcher',
        },
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('research');
    });

    it('should detect write mode from writer agent type', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'writer',
        },
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('write');
    });

    it('should detect write mode from document agent type', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentType: 'documenter',
        },
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('write');
    });

    it('should use agentCategory as fallback', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {
          agentCategory: 'coder',
        },
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('code');
    });

    it('should default to general mode', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Just do something',
        toolOutput: {},
        sessionId: 'test-session',
        metadata: {},
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('general');
    });

    it('should default to general when no metadata', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: {},
        toolOutput: {},
        sessionId: 'test-session',
      };

      const mode = (submitter as any).detectMode(context);
      expect(mode).toBe('general');
    });
  });

  // ==================== determineOutcome() Tests ====================

  describe('determineOutcome RULE-035', () => {
    it('should return positive for quality >= 0.5 (not 0.7)', () => {
      // RULE-035: threshold is 0.5, not 0.7
      expect(submitter.determineOutcome(0.5)).toBe('positive');
      expect(submitter.determineOutcome(0.51)).toBe('positive');
      expect(submitter.determineOutcome(0.6)).toBe('positive');
      expect(submitter.determineOutcome(0.7)).toBe('positive');
      expect(submitter.determineOutcome(0.8)).toBe('positive');
      expect(submitter.determineOutcome(0.9)).toBe('positive');
      expect(submitter.determineOutcome(1.0)).toBe('positive');
    });

    it('should return negative for quality <= 0.3', () => {
      expect(submitter.determineOutcome(0.3)).toBe('negative');
      expect(submitter.determineOutcome(0.29)).toBe('negative');
      expect(submitter.determineOutcome(0.2)).toBe('negative');
      expect(submitter.determineOutcome(0.1)).toBe('negative');
      expect(submitter.determineOutcome(0.0)).toBe('negative');
    });

    it('should return neutral for quality between 0.3 and 0.5', () => {
      expect(submitter.determineOutcome(0.31)).toBe('neutral');
      expect(submitter.determineOutcome(0.35)).toBe('neutral');
      expect(submitter.determineOutcome(0.4)).toBe('neutral');
      expect(submitter.determineOutcome(0.45)).toBe('neutral');
      expect(submitter.determineOutcome(0.49)).toBe('neutral');
    });

    it('should handle edge case at 0.5 boundary (positive)', () => {
      // Exactly 0.5 should be positive per RULE-035
      expect(submitter.determineOutcome(0.5)).toBe('positive');
    });

    it('should handle edge case at 0.3 boundary (negative)', () => {
      // Exactly 0.3 should be negative
      expect(submitter.determineOutcome(0.3)).toBe('negative');
    });
  });

  // ==================== buildQualityInteraction() Tests ====================

  describe('buildQualityInteraction', () => {
    it('should build interaction with mode from context', () => {
      const context: IPostToolUseContext = {
        timestamp: 1234567890,
        toolName: 'Task',
        toolInput: 'Test input',
        toolOutput: {},
        sessionId: 'session-123',
        metadata: {
          agentType: 'coder',
        },
      };

      const interaction = (submitter as any).buildQualityInteraction(null, 'Test output', context);

      expect(interaction.id).toBe('session-123');
      expect(interaction.mode).toBe('code');
      expect(interaction.input).toBe('Test input');
      expect(interaction.output).toBe('Test output');
      expect(interaction.timestamp).toBe(1234567890);
    });

    it('should handle object toolInput by stringifying', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: { command: 'test', args: ['a', 'b'] },
        toolOutput: {},
        sessionId: 'session-456',
      };

      const interaction = (submitter as any).buildQualityInteraction(null, 'output', context);

      expect(interaction.input).toContain('command');
      expect(interaction.input).toContain('test');
    });

    it('should truncate long toolInput to 500 chars', () => {
      const longInput = { data: 'x'.repeat(1000) };
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: longInput,
        toolOutput: {},
        sessionId: 'session-789',
      };

      const interaction = (submitter as any).buildQualityInteraction(null, 'output', context);

      expect(interaction.input.length).toBeLessThanOrEqual(500);
    });

    it('should generate UUID for missing sessionId', () => {
      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: '',
        toolOutput: {},
        sessionId: '', // Empty
      };

      const interaction = (submitter as any).buildQualityInteraction(null, 'output', context);

      // Should have some ID generated (UUID format)
      expect(interaction.id).toBeTruthy();
      expect(interaction.id.length).toBeGreaterThan(0);
    });
  });

  // ==================== Regression Tests ====================

  describe('REGRESSION: IT Governance prose response', () => {
    it('should score comprehensive prose response >= 0.5 (was 0.2)', () => {
      // The IT Governance response that triggered this fix
      const proseOutput = `IT Governance is a framework for ensuring that information technology
investments support business objectives. It encompasses strategic alignment, value delivery,
risk management, resource management, and performance measurement.

Key frameworks include:
- COBIT (Control Objectives for Information Technology)
- ITIL (Information Technology Infrastructure Library)
- ISO/IEC 38500 (Corporate Governance of IT)

Strategic Alignment ensures IT strategy is integrated with business strategy. This requires:
1. Clear communication between IT and business leadership
2. Shared understanding of goals and priorities
3. Regular review of IT portfolio against business needs

Value Delivery focuses on optimizing IT investments to generate maximum business value.
Organizations should track return on investment, total cost of ownership, and business
outcomes achieved through IT initiatives.

Risk Management involves identifying, assessing, and mitigating IT-related risks including:
- Security threats and vulnerabilities
- Regulatory compliance requirements
- Technology obsolescence
- Vendor dependencies

Resource Management optimizes the allocation and utilization of IT resources including
human capital, infrastructure, and applications. Effective resource management requires
capacity planning, skill development, and portfolio rationalization.

Performance Measurement establishes metrics and reporting to track IT effectiveness.
Key performance indicators should align with business objectives and provide actionable
insights for continuous improvement.

Implementation recommendations:
1. Assess current governance maturity
2. Define target state based on organizational needs
3. Develop roadmap with prioritized initiatives
4. Establish governance structures and processes
5. Monitor progress and adapt approach as needed`;

      const summary: ITaskSummary = {
        whatIDid: 'Researched and documented IT Governance frameworks',
        filesCreated: [],
        filesModified: [],
        interactionStoreEntries: [],
        reasoningBankFeedback: null,
        nextAgentGuidance: '',
      };

      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Research IT Governance best practices',
        toolOutput: {},
        sessionId: 'regression-test',
        metadata: {
          agentType: 'researcher',
        },
      };

      const quality = submitter.estimateQuality(summary, proseOutput, context);

      // CRITICAL ASSERTION: This was the bug - prose was scoring ~0.2
      // After fix, should score >= 0.5
      expect(quality).toBeGreaterThanOrEqual(0.5);

      // Verify outcome is now positive (was negative due to low score)
      const outcome = submitter.determineOutcome(quality);
      expect(outcome).toBe('positive');
    });

    it('should score short/low-quality response appropriately', () => {
      // Ensure we dont over-score poor responses
      const poorOutput = 'Done.';

      const quality = submitter.estimateQuality(null, poorOutput);

      // Short responses should score lower
      expect(quality).toBeLessThan(0.5);
    });
  });

  // ==================== submitFeedback() Tests ====================

  describe('submitFeedback', () => {
    it('should throw error for empty trajectoryId', async () => {
      await expect(submitter.submitFeedback('', 0.8, 'positive')).rejects.toThrow(
        'trajectoryId must be non-empty'
      );
    });

    it('should throw error for whitespace-only trajectoryId', async () => {
      await expect(submitter.submitFeedback('   ', 0.8, 'positive')).rejects.toThrow(
        'trajectoryId must be non-empty'
      );
    });

    it('should throw error for quality < 0', async () => {
      await expect(submitter.submitFeedback('trj_test', -0.1, 'negative')).rejects.toThrow(
        'quality must be in range 0-1'
      );
    });

    it('should throw error for quality > 1', async () => {
      await expect(submitter.submitFeedback('trj_test', 1.1, 'positive')).rejects.toThrow(
        'quality must be in range 0-1'
      );
    });
  });

  // ==================== submitWithRetry() Tests ====================

  describe('submitWithRetry', () => {
    it('should return false and queue when submission fails', async () => {
      // Non-existent trajectory will fail
      const result = await submitter.submitWithRetry(
        `trj_nonexistent_${Date.now()}`,
        0.8,
        'positive',
        { test: true }
      );

      expect(result).toBe(false);

      const queueLength = await submitter.getQueueLength();
      expect(queueLength).toBeGreaterThan(0);
    });
  });

  // ==================== Integration: Full Flow Test ====================

  describe('Integration: Full Quality Assessment Flow', () => {
    it('should assess TASK COMPLETION SUMMARY output correctly', () => {
      const output = `
## TASK COMPLETION SUMMARY

**What I Did**: Implemented comprehensive authentication system with JWT tokens.

**Files Created/Modified**:
- \`./src/auth/jwt-handler.ts\` - JWT validation and generation
- \`./src/auth/middleware.ts\` - Express middleware for auth
- \`./src/auth/types.ts\` - TypeScript interfaces

\`\`\`typescript
export interface AuthToken {
  userId: string;
  role: string;
  exp: number;
}

export async function validateToken(token: string): Promise<AuthToken> {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded as AuthToken;
}
\`\`\`

**Quality Indicators**:
- Full test coverage implemented
- Type-safe implementation
- Error handling for all edge cases

**Next Agent Guidance**: Frontend team should implement token refresh logic using the exported interfaces.
`;

      const summary: ITaskSummary = {
        whatIDid: 'Implemented authentication system',
        filesCreated: ['./src/auth/jwt-handler.ts', './src/auth/middleware.ts', './src/auth/types.ts'],
        filesModified: [],
        interactionStoreEntries: [
          { domain: 'project/auth', tags: ['jwt', 'middleware'], description: 'Auth implementation' },
        ],
        reasoningBankFeedback: null,
        nextAgentGuidance: 'Frontend should implement token refresh',
      };

      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Task',
        toolInput: 'Implement JWT authentication',
        toolOutput: {},
        sessionId: 'integration-test',
        metadata: {
          agentType: 'coder',
        },
      };

      const quality = submitter.estimateQuality(summary, output, context);
      const outcome = submitter.determineOutcome(quality);

      // Well-structured Task output should score above baseline
      expect(quality).toBeGreaterThanOrEqual(0.4);
      // Outcome depends on threshold (neutral if < 0.5)
      expect(['positive', 'neutral']).toContain(outcome);
    });

    it('should handle general mode with basic output', () => {
      const output = 'The task has been completed successfully.';

      const context: IPostToolUseContext = {
        timestamp: Date.now(),
        toolName: 'Bash',
        toolInput: 'echo hello',
        toolOutput: {},
        sessionId: 'general-test',
        metadata: {},
      };

      const quality = submitter.estimateQuality(null, output, context);

      // Basic output should score lower but still valid
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });
  });
});
