/**
 * Constants Tests
 *
 * Tests for TASK-ORC-003 (Workflow Rules Constants)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WORKFLOW_RULES,
  PHASE_AGENT_MAPPING,
  TOKEN_LIMITS,
  DELEGATION_KEYWORDS,
  MIN_OPERATION_COUNT,
  PHASE_CONFIDENCE_THRESHOLD,
  WorkflowPhase
} from '../../../src/god-agent/orchestration/index.js';

describe('DEFAULT_WORKFLOW_RULES', () => {
  it('should contain 4 default rules', () => {
    expect(DEFAULT_WORKFLOW_RULES).toHaveLength(4);
  });

  it('should have unique rule IDs', () => {
    const ids = DEFAULT_WORKFLOW_RULES.map(r => r.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('should have correct rule IDs', () => {
    expect(DEFAULT_WORKFLOW_RULES[0].id).toBe('RULE-001');
    expect(DEFAULT_WORKFLOW_RULES[1].id).toBe('RULE-002');
    expect(DEFAULT_WORKFLOW_RULES[2].id).toBe('RULE-003');
    expect(DEFAULT_WORKFLOW_RULES[3].id).toBe('RULE-004');
  });

  it('should have correct severity levels', () => {
    expect(DEFAULT_WORKFLOW_RULES[0].severity).toBe('error');
    expect(DEFAULT_WORKFLOW_RULES[1].severity).toBe('error');
    expect(DEFAULT_WORKFLOW_RULES[2].severity).toBe('warning');
    expect(DEFAULT_WORKFLOW_RULES[3].severity).toBe('warning');
  });

  it('should have violation messages', () => {
    DEFAULT_WORKFLOW_RULES.forEach(rule => {
      expect(rule.violationMessage).toBeDefined();
      expect(rule.violationMessage.length).toBeGreaterThan(0);
    });
  });

  it('should have workflow phase dependencies', () => {
    DEFAULT_WORKFLOW_RULES.forEach(rule => {
      expect(rule.requires).toBeDefined();
      expect(rule.dependentPhase).toBeDefined();
      expect(Object.values(WorkflowPhase)).toContain(rule.requires);
      expect(Object.values(WorkflowPhase)).toContain(rule.dependentPhase);
    });
  });
});

describe('PHASE_AGENT_MAPPING', () => {
  it('should contain mappings for all workflow phases', () => {
    const phases = PHASE_AGENT_MAPPING.map(m => m.phase);
    expect(phases).toContain(WorkflowPhase.PLANNING);
    expect(phases).toContain(WorkflowPhase.SPECIFICATION);
    expect(phases).toContain(WorkflowPhase.IMPLEMENTATION);
    expect(phases).toContain(WorkflowPhase.TESTING);
    expect(phases).toContain(WorkflowPhase.REVIEW);
    expect(phases).toContain(WorkflowPhase.AUDIT);
    expect(phases).toContain(WorkflowPhase.GENERAL);
  });

  it('should have primary agent for each phase', () => {
    PHASE_AGENT_MAPPING.forEach(mapping => {
      expect(mapping.primaryAgent).toBeDefined();
      expect(mapping.primaryAgent.length).toBeGreaterThan(0);
    });
  });

  it('should have fallback agents array', () => {
    PHASE_AGENT_MAPPING.forEach(mapping => {
      expect(Array.isArray(mapping.fallbackAgents)).toBe(true);
    });
  });

  it('should have descriptions', () => {
    PHASE_AGENT_MAPPING.forEach(mapping => {
      expect(mapping.description).toBeDefined();
      expect(mapping.description.length).toBeGreaterThan(0);
    });
  });
});

describe('TOKEN_LIMITS', () => {
  it('should have MAX_CONTEXT_TOKENS set to 8000', () => {
    expect(TOKEN_LIMITS.MAX_CONTEXT_TOKENS).toBe(8000);
  });

  it('should have token estimation multiplier', () => {
    expect(TOKEN_LIMITS.TOKEN_ESTIMATION_MULTIPLIER).toBe(0.75);
  });

  it('should have weight constants', () => {
    expect(TOKEN_LIMITS.NON_ASCII_WEIGHT).toBe(1.5);
    expect(TOKEN_LIMITS.CODE_BLOCK_WEIGHT).toBe(0.9);
  });

  it('should have warning and hard limits', () => {
    expect(TOKEN_LIMITS.MIN_TOKENS_WARNING).toBe(6800);
    expect(TOKEN_LIMITS.MAX_TOKENS_HARD).toBe(9200);
  });
});

describe('DELEGATION_KEYWORDS', () => {
  it('should contain delegation trigger phrases', () => {
    expect(DELEGATION_KEYWORDS).toContain('implement multiple');
    expect(DELEGATION_KEYWORDS).toContain('build feature');
    expect(DELEGATION_KEYWORDS).toContain('write tests for');
    expect(DELEGATION_KEYWORDS).toContain('analyze codebase');
    expect(DELEGATION_KEYWORDS).toContain('create API');
    expect(DELEGATION_KEYWORDS).toContain('add frontend');
  });

  it('should be an array of strings', () => {
    expect(Array.isArray(DELEGATION_KEYWORDS)).toBe(true);
    expect(DELEGATION_KEYWORDS.length).toBeGreaterThan(0);
  });
});

describe('Configuration Constants', () => {
  it('MIN_OPERATION_COUNT should be 3', () => {
    expect(MIN_OPERATION_COUNT).toBe(3);
  });

  it('PHASE_CONFIDENCE_THRESHOLD should be 0.6', () => {
    expect(PHASE_CONFIDENCE_THRESHOLD).toBe(0.6);
  });
});
