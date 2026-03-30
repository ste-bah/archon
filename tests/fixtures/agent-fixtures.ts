/**
 * Agent Test Fixtures
 * ANTI-007: Centralized agent test data factories
 *
 * Provides factory functions for creating test agent data.
 * All factories accept partial overrides for customization.
 */

import type { ILoadedAgentDefinition } from '../../src/god-agent/core/agents/agent-types.js';
import type { IAgentDefinition, IAgentExecutor } from '../../src/god-agent/core/orchestration/orchestration-types.js';
import type { AgentRegistry } from '../../src/god-agent/core/agents/agent-registry.js';
import { vi } from 'vitest';

// ==================== Agent Definition Fixtures ====================

/**
 * Default agent definition values
 */
const DEFAULT_AGENT_DEFINITION: ILoadedAgentDefinition = {
  key: 'test-agent',
  category: 'core',
  filePath: '/test/agents/core/test-agent.md',
  frontmatter: {
    name: 'Test Agent',
    description: 'A test agent for unit testing',
    priority: 'medium',
    type: 'general',
    capabilities: ['general'],
    tools: ['Read'],
  },
  promptContent: '# Test Agent\n\nTest prompt content.',
  loadedAt: Date.now(),
};

/**
 * Create a test agent definition with optional overrides
 */
export function createTestAgentDefinition(
  overrides?: Partial<ILoadedAgentDefinition> & {
    frontmatterOverrides?: Partial<ILoadedAgentDefinition['frontmatter']>;
  }
): ILoadedAgentDefinition {
  const { frontmatterOverrides, ...rest } = overrides ?? {};

  return {
    ...DEFAULT_AGENT_DEFINITION,
    ...rest,
    frontmatter: {
      ...DEFAULT_AGENT_DEFINITION.frontmatter,
      ...frontmatterOverrides,
    },
    loadedAt: Date.now(),
  };
}

/**
 * Pre-built agent definitions for common test scenarios
 */
export const TEST_AGENTS = {
  coder: createTestAgentDefinition({
    key: 'coder',
    filePath: '/test/agents/core/coder.md',
    frontmatterOverrides: {
      name: 'Coder',
      description: 'Implementation specialist for writing clean, efficient code',
      priority: 'high',
      type: 'developer',
      capabilities: ['code_generation', 'refactoring'],
      tools: ['Read', 'Write', 'Edit'],
    },
    promptContent: '# Coder Agent\n\nImplement code...',
  }),

  tester: createTestAgentDefinition({
    key: 'tester',
    filePath: '/test/agents/core/tester.md',
    frontmatterOverrides: {
      name: 'Tester',
      description: 'Comprehensive testing and quality assurance specialist',
      priority: 'high',
      type: 'validator',
      capabilities: ['unit_testing', 'integration_testing'],
      tools: ['Read', 'Bash'],
    },
    promptContent: '# Tester Agent\n\nWrite tests...',
  }),

  reviewer: createTestAgentDefinition({
    key: 'reviewer',
    filePath: '/test/agents/core/reviewer.md',
    frontmatterOverrides: {
      name: 'Reviewer',
      description: 'Code review and quality assurance specialist',
      priority: 'medium',
      type: 'validator',
      capabilities: ['code_review', 'security_review'],
      tools: ['Read', 'Grep'],
    },
    promptContent: '# Reviewer Agent\n\nReview code...',
  }),

  researcher: createTestAgentDefinition({
    key: 'researcher',
    filePath: '/test/agents/core/researcher.md',
    frontmatterOverrides: {
      name: 'Researcher',
      description: 'Deep research and information gathering specialist',
      priority: 'medium',
      type: 'analyst',
      capabilities: ['research', 'analysis'],
      tools: ['Read', 'WebSearch', 'WebFetch'],
    },
    promptContent: '# Researcher Agent\n\nResearch...',
  }),
};

// ==================== Agent Registry Fixtures ====================

/**
 * Create a test agent registry with specified agents
 */
export function createTestAgentRegistry(
  agents: ILoadedAgentDefinition[] = [TEST_AGENTS.coder]
): AgentRegistry {
  const agentMap = new Map(agents.map(a => [a.key, a]));

  return {
    getByKey: vi.fn((key: string) => agentMap.get(key) ?? null),
    getAll: vi.fn(() => agents),
    getByCategory: vi.fn((category: string) =>
      agents.filter(a => a.category === category)
    ),
    getByCapability: vi.fn((cap: string) =>
      agents.filter(a => a.frontmatter.capabilities?.some(c => c.includes(cap)))
    ),
    getCategoryNames: vi.fn(() => Array.from(new Set(agents.map(a => a.category)))),
    size: agents.length,
  } as unknown as AgentRegistry;
}

// ==================== Agent Executor Fixtures ====================

/**
 * Create a test agent executor with configurable response
 */
export function createTestAgentExecutor(
  options?: {
    response?: string;
    shouldFail?: boolean;
    failureError?: Error;
    delayMs?: number;
  }
): IAgentExecutor {
  const {
    response = 'Agent output',
    shouldFail = false,
    failureError = new Error('Execution failed'),
    delayMs = 0,
  } = options ?? {};

  return {
    execute: vi.fn(async (_prompt: string, _agentDef: IAgentDefinition) => {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      if (shouldFail) {
        throw failureError;
      }

      return response;
    }),
  } as unknown as IAgentExecutor;
}

// ==================== Convenience Functions ====================

/**
 * Create a full test environment with registry and executor
 */
export function createTestAgentEnvironment(
  options?: {
    agents?: ILoadedAgentDefinition[];
    executorResponse?: string;
    executorShouldFail?: boolean;
  }
) {
  const agents = options?.agents ?? [TEST_AGENTS.coder, TEST_AGENTS.tester];

  return {
    registry: createTestAgentRegistry(agents),
    executor: createTestAgentExecutor({
      response: options?.executorResponse,
      shouldFail: options?.executorShouldFail,
    }),
    agents,
  };
}
