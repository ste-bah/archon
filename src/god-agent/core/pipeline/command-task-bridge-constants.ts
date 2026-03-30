/**
 * DAI-002: Command Task Bridge Constants
 *
 * Constants for the command-task-bridge module.
 * Extracted for constitution compliance (< 500 lines per file).
 *
 * @see command-task-bridge.ts
 */

import type { IAgentMapping } from './command-task-bridge-types.js';

/**
 * Default complexity threshold for triggering pipeline.
 */
export const DEFAULT_PIPELINE_THRESHOLD = 0.6;

/**
 * Keywords indicating multiple phases.
 */
export const PHASE_KEYWORDS = [
  'plan', 'design', 'analyze', 'implement', 'test', 'validate',
  'review', 'document', 'deploy', 'refactor', 'optimize'
];

/**
 * Document creation keywords.
 */
export const DOCUMENT_KEYWORDS = [
  'prd', 'spec', 'specification', 'tech doc', 'technical document',
  'readme', 'documentation', 'architecture', 'design doc', 'api doc'
];

/**
 * Multi-step action patterns (regex).
 */
export const MULTI_STEP_PATTERNS = [
  /(\w+)\s+and\s+(\w+)(?:\s+and\s+(\w+))?/gi,  // "plan and implement and test"
  /first\s+(\w+).*then\s+(\w+)/gi,              // "first analyze, then implement"
  /step\s*\d+|phase\s*\d+/gi,                    // "step 1", "phase 2"
  /create\s+(\w+),?\s+(\w+)(?:,?\s+and\s+(\w+))?/gi  // "create PRD, spec, and docs"
];

/**
 * Connector words indicating sequential work.
 */
export const CONNECTOR_WORDS = [
  'then', 'after', 'before', 'once', 'following', 'next', 'finally',
  'first', 'second', 'third', 'lastly', 'subsequently'
];

/**
 * Default agent mappings for common phases.
 */
export const DEFAULT_PHASE_MAPPINGS: IAgentMapping[] = [
  {
    phase: 'plan',
    agentKey: 'planner',
    outputDomain: 'project/plans',
    outputTags: ['plan', 'strategy'],
    taskTemplate: 'Create a detailed plan for: {task}'
  },
  {
    phase: 'analyze',
    agentKey: 'code-analyzer',
    outputDomain: 'project/analysis',
    outputTags: ['analysis', 'review'],
    taskTemplate: 'Analyze and assess: {task}'
  },
  {
    phase: 'design',
    agentKey: 'system-architect',
    outputDomain: 'project/designs',
    outputTags: ['design', 'architecture'],
    taskTemplate: 'Design the architecture for: {task}'
  },
  {
    phase: 'implement',
    agentKey: 'backend-dev',
    outputDomain: 'project/implementations',
    outputTags: ['implementation', 'code'],
    taskTemplate: 'Implement: {task}'
  },
  {
    phase: 'test',
    agentKey: 'tester',
    outputDomain: 'project/tests',
    outputTags: ['test', 'validation'],
    taskTemplate: 'Write tests for: {task}'
  },
  {
    phase: 'document',
    agentKey: 'documentation-specialist',
    outputDomain: 'project/docs',
    outputTags: ['documentation', 'docs'],
    taskTemplate: 'Create documentation for: {task}'
  },
  {
    phase: 'review',
    agentKey: 'reviewer',
    outputDomain: 'project/reviews',
    outputTags: ['review', 'feedback'],
    taskTemplate: 'Review and validate: {task}'
  },
  {
    phase: 'research',
    agentKey: 'researcher',
    outputDomain: 'project/research',
    outputTags: ['research', 'findings'],
    taskTemplate: 'Research and investigate: {task}'
  }
];

/**
 * Document type to agent mapping.
 */
export const DOCUMENT_AGENT_MAPPING: Record<string, string> = {
  'prd': 'planner',
  'spec': 'system-architect',
  'specification': 'system-architect',
  'tech doc': 'documentation-specialist',
  'technical document': 'documentation-specialist',
  'readme': 'documentation-specialist',
  'documentation': 'documentation-specialist',
  'architecture': 'system-architect',
  'design doc': 'system-architect',
  'api doc': 'backend-dev'
};
