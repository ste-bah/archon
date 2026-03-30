/**
 * Orchestration Memory System - Constants
 *
 * Implements: TASK-ORC-003 (TECH-ORC-001 lines 1190-1250)
 *
 * @module orchestration/constants
 */

import { WorkflowPhase, type IWorkflowRule, type IPhaseAgentMapping } from './types.js';

/**
 * Default workflow rules enforcing sequential phase dependencies
 *
 * From TECH-ORC-001 lines 1190-1229
 */
export const DEFAULT_WORKFLOW_RULES: readonly IWorkflowRule[] = [
  {
    id: 'RULE-001',
    description: 'Backend implementation required before Frontend',
    requires: WorkflowPhase.IMPLEMENTATION,
    dependentPhase: WorkflowPhase.IMPLEMENTATION,
    severity: 'error',
    violationMessage: 'Backend API must be implemented before frontend components. Ensure backend tasks are completed first.'
  },
  {
    id: 'RULE-002',
    description: 'Schema definition required before Implementation',
    requires: WorkflowPhase.SPECIFICATION,
    dependentPhase: WorkflowPhase.IMPLEMENTATION,
    severity: 'error',
    violationMessage: 'API/Database schema must be defined in specification phase before implementation begins.'
  },
  {
    id: 'RULE-003',
    description: 'Implementation required before Testing',
    requires: WorkflowPhase.IMPLEMENTATION,
    dependentPhase: WorkflowPhase.TESTING,
    severity: 'warning',
    violationMessage: 'Implementation should exist before testing phase. Consider implementing features before writing tests.'
  },
  {
    id: 'RULE-004',
    description: 'Testing recommended before Review',
    requires: WorkflowPhase.TESTING,
    dependentPhase: WorkflowPhase.REVIEW,
    severity: 'warning',
    violationMessage: 'Tests should pass before code review. Run test suite and fix failures first.'
  }
] as const;

/**
 * Phase to agent mapping for routing
 *
 * From TECH-ORC-001 lines 1143-1153
 */
export const PHASE_AGENT_MAPPING: readonly IPhaseAgentMapping[] = [
  {
    phase: WorkflowPhase.PLANNING,
    primaryAgent: 'planner',
    fallbackAgents: ['system-architect'],
    description: 'Planning and architecture design'
  },
  {
    phase: WorkflowPhase.SPECIFICATION,
    primaryAgent: 'system-architect',
    fallbackAgents: ['backend-dev'],
    description: 'API/schema specification and contracts'
  },
  {
    phase: WorkflowPhase.IMPLEMENTATION,
    primaryAgent: 'backend-dev',
    fallbackAgents: ['coder'],
    description: 'Backend and frontend implementation'
  },
  {
    phase: WorkflowPhase.TESTING,
    primaryAgent: 'tester',
    fallbackAgents: ['coder'],
    description: 'Test writing and validation'
  },
  {
    phase: WorkflowPhase.REVIEW,
    primaryAgent: 'reviewer',
    fallbackAgents: ['code-analyzer'],
    description: 'Code review and quality checks'
  },
  {
    phase: WorkflowPhase.AUDIT,
    primaryAgent: 'code-analyzer',
    fallbackAgents: ['reviewer'],
    description: 'Security and performance audits'
  },
  {
    phase: WorkflowPhase.GENERAL,
    primaryAgent: 'coder',
    fallbackAgents: [],
    description: 'General-purpose tasks'
  }
] as const;

/**
 * Token limits for context injection
 */
export const TOKEN_LIMITS = {
  /** Maximum context tokens (default) */
  MAX_CONTEXT_TOKENS: 8000,
  /** Minimum tokens before truncation warning */
  MIN_TOKENS_WARNING: 6800,
  /** Maximum tokens before hard limit */
  MAX_TOKENS_HARD: 9200,
  /** Token estimation multiplier (chars * 0.75) */
  TOKEN_ESTIMATION_MULTIPLIER: 0.75,
  /** Non-ASCII character weight */
  NON_ASCII_WEIGHT: 1.5,
  /** Code block weight */
  CODE_BLOCK_WEIGHT: 0.9
} as const;

/**
 * Delegation detection keywords
 *
 * From TECH-ORC-001 lines 1244-1250
 */
export const DELEGATION_KEYWORDS: readonly string[] = [
  'implement multiple',
  'build feature',
  'write tests for',
  'analyze codebase',
  'create API',
  'add frontend',
  'refactor',
  'optimize',
  'design schema',
  'review code'
] as const;

/**
 * Operation type mappings for delegation detection
 *
 * From TECH-ORC-001 lines 1231-1242
 */
export const OPERATION_AGENT_MAPPING = {
  backend: {
    keywords: ['read', 'modify', 'write', 'test'],
    filePatterns: ['*.ts', '*.js', 'backend/', 'server/'],
    suggestedAgent: 'backend-dev',
    confidence: 0.8
  },
  frontend: {
    keywords: ['read', 'modify', 'write'],
    filePatterns: ['*.tsx', '*.jsx', 'components/', 'frontend/'],
    suggestedAgent: 'coder',
    confidence: 0.8
  },
  schema: {
    keywords: ['create', 'define', 'schema', 'database', 'api-contract'],
    filePatterns: ['*.sql', 'schema/', 'migrations/'],
    suggestedAgent: 'system-architect',
    confidence: 0.7
  },
  testing: {
    keywords: ['test', 'verify', 'validate', 'assert', 'expect'],
    filePatterns: ['*.test.ts', '*.spec.ts', '__tests__/'],
    suggestedAgent: 'tester',
    confidence: 0.8
  },
  analysis: {
    keywords: ['analyze', 'review', 'search', 'grep', 'pattern'],
    filePatterns: ['*'],
    suggestedAgent: 'code-analyzer',
    confidence: 0.7
  },
  refactoring: {
    keywords: ['refactor', 'optimize', 'clean', 'restructure'],
    filePatterns: ['*'],
    suggestedAgent: 'coder',
    confidence: 0.7
  }
} as const;

/**
 * Phase detection keywords
 *
 * From TECH-ORC-001 lines 1155-1160
 */
export const PHASE_KEYWORDS = {
  [WorkflowPhase.PLANNING]: ['plan', 'design', 'architecture', 'scope'],
  [WorkflowPhase.SPECIFICATION]: ['spec', 'define', 'contract', 'schema'],
  [WorkflowPhase.IMPLEMENTATION]: ['implement', 'build', 'code', 'develop'],
  [WorkflowPhase.TESTING]: ['test', 'verify', 'validate', 'check'],
  [WorkflowPhase.REVIEW]: ['review', 'audit', 'examine', 'inspect'],
  [WorkflowPhase.AUDIT]: ['security', 'performance', 'compliance', 'vulnerability'],
  [WorkflowPhase.GENERAL]: []
} as const;

/**
 * Minimum operation count for delegation detection
 */
export const MIN_OPERATION_COUNT = 3;

/**
 * Phase detection confidence threshold
 */
export const PHASE_CONFIDENCE_THRESHOLD = 0.6;
