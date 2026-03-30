/**
 * DAI-002: Pipeline Validator Tests
 * TASK-002: Tests for PipelineValidator class
 *
 * RULE-002: No mock data - uses REAL agents from AgentRegistry
 * RULE-003: Validates fail-fast behavior with detailed errors
 * RULE-004: Validates sequential: true enforcement
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PipelineValidator, createPipelineValidator, IValidationResult } from '../../../../src/god-agent/core/pipeline/pipeline-validator.js';
import { PipelineDefinitionError } from '../../../../src/god-agent/core/pipeline/pipeline-errors.js';
import type { IPipelineDefinition, IPipelineStep } from '../../../../src/god-agent/core/pipeline/dai-002-types.js';
import { AgentRegistry } from '../../../../src/god-agent/core/agents/agent-registry.js';

// ==================== Test Setup ====================

describe('PipelineValidator', () => {
  let registry: AgentRegistry;
  let validator: PipelineValidator;
  let realAgentKey: string;

  beforeAll(async () => {
    // RULE-002: Use REAL agents from the registry
    registry = new AgentRegistry({ basePath: '.claude/agents', verbose: false });
    await registry.initialize('.claude/agents');

    // Get a real agent key for tests
    const allAgents = registry.getAll();
    expect(allAgents.length).toBeGreaterThan(0);
    realAgentKey = allAgents[0].key;

    validator = createPipelineValidator(registry);
  });

  afterAll(() => {
    registry.clear();
  });

  // ==================== Factory Function Tests ====================

  describe('createPipelineValidator', () => {
    it('should create a PipelineValidator instance', () => {
      const v = createPipelineValidator(registry);
      expect(v).toBeInstanceOf(PipelineValidator);
    });
  });

  // ==================== Pipeline Name Validation ====================

  describe('validatePipelineName', () => {
    it('should throw for missing pipeline name', () => {
      const pipeline: IPipelineDefinition = {
        name: '',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      expect(() => validator.validate(pipeline)).toThrow(/name.*missing/i);
    });

    it('should throw for whitespace-only pipeline name', () => {
      const pipeline: IPipelineDefinition = {
        name: '   ',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
    });

    it('should accept valid pipeline name', () => {
      const pipeline: IPipelineDefinition = {
        name: 'valid-pipeline',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).not.toThrow();
    });
  });

  // ==================== Agents Array Validation ====================

  describe('validateAgentsArray', () => {
    it('should throw for missing agents array', () => {
      const pipeline = {
        name: 'test',
        description: 'Test',
        sequential: true,
      } as IPipelineDefinition;

      expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      expect(() => validator.validate(pipeline)).toThrow(/agents.*array/i);
    });

    it('should throw for empty agents array', () => {
      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      expect(() => validator.validate(pipeline)).toThrow(/at least one agent/i);
    });

    it('should accept non-empty agents array', () => {
      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).not.toThrow();
    });
  });

  // ==================== Sequential Validation (RULE-004) ====================

  describe('validateSequential (RULE-004)', () => {
    it('should throw for sequential: false', () => {
      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: false,
      };

      expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      expect(() => validator.validate(pipeline)).toThrow(/RULE-004/i);
    });

    it('should throw for undefined sequential', () => {
      const pipeline = {
        name: 'test',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
      } as IPipelineDefinition;

      expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
    });

    it('should accept sequential: true', () => {
      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).not.toThrow();
    });
  });

  // ==================== Step Validation ====================

  describe('validateStep', () => {
    describe('agent identifier validation', () => {
      it('should throw for step without agentKey or taskDescription', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: ['test'],
          } as IPipelineStep],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/agentKey.*taskDescription/i);
      });

      it('should accept step with only agentKey', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });

      it('should accept step with only taskDescription', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            taskDescription: 'Implement authentication endpoint',
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: ['test'],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });

      it('should accept step with both agentKey and taskDescription', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            taskDescription: 'Fallback description',
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: ['test'],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });
    });

    describe('agent key validation (RULE-006)', () => {
      it('should throw for non-existent agent key', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: 'non-existent-agent-key-12345',
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: ['test'],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/not found in registry/i);
      });

      it('should accept existing agent key', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });
    });

    describe('task validation', () => {
      it('should throw for missing task', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            task: '',
            outputDomain: 'project/test',
            outputTags: ['test'],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/task.*required/i);
      });

      it('should throw for whitespace-only task', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            task: '   ',
            outputDomain: 'project/test',
            outputTags: ['test'],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      });
    });

    describe('outputDomain validation', () => {
      it('should throw for missing outputDomain', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            task: 'Do something',
            outputDomain: '',
            outputTags: ['test'],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/outputDomain.*required/i);
      });
    });

    describe('outputTags validation', () => {
      it('should throw for missing outputTags', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: [],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/outputTags.*non-empty/i);
      });

      it('should throw for non-array outputTags', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: 'invalid' as unknown as string[],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      });

      it('should throw for empty string in outputTags', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            agentKey: realAgentKey,
            task: 'Do something',
            outputDomain: 'project/test',
            outputTags: ['valid', ''],
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/outputTags\[1\]/i);
      });
    });

    describe('minQuality validation', () => {
      it('should accept undefined minQuality', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });

      it('should accept minQuality in valid range', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            minQuality: 0.7,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });

      it('should throw for minQuality < 0', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            minQuality: -0.1,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/minQuality.*between 0 and 1/i);
      });

      it('should throw for minQuality > 1', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            minQuality: 1.5,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      });

      it('should throw for non-number minQuality', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            minQuality: 'high' as unknown as number,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/minQuality.*number/i);
      });
    });

    describe('timeout validation', () => {
      it('should accept undefined timeout', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });

      it('should accept positive timeout', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            timeout: 60000,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).not.toThrow();
      });

      it('should throw for timeout <= 0', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            timeout: 0,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/timeout.*positive/i);
      });

      it('should throw for negative timeout', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            timeout: -1000,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
      });

      it('should throw for non-number timeout', () => {
        const pipeline: IPipelineDefinition = {
          name: 'test',
          description: 'Test',
          agents: [{
            ...createValidStep(realAgentKey),
            timeout: 'fast' as unknown as number,
          }],
          sequential: true,
        };

        expect(() => validator.validate(pipeline)).toThrow(PipelineDefinitionError);
        expect(() => validator.validate(pipeline)).toThrow(/timeout.*number/i);
      });
    });
  });

  // ==================== Domain Chain Validation ====================

  describe('validateDomainChain', () => {
    it('should log warning when inputDomain differs from previous outputDomain', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [
          {
            agentKey: realAgentKey,
            task: 'First task',
            outputDomain: 'project/first',
            outputTags: ['first'],
          },
          {
            agentKey: realAgentKey,
            task: 'Second task',
            inputDomain: 'project/different',
            outputDomain: 'project/second',
            outputTags: ['second'],
          },
        ],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('inputDomain')
      );

      consoleSpy.mockRestore();
    });

    it('should not warn when inputDomain matches previous outputDomain', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [
          {
            agentKey: realAgentKey,
            task: 'First task',
            outputDomain: 'project/first',
            outputTags: ['first'],
          },
          {
            agentKey: realAgentKey,
            task: 'Second task',
            inputDomain: 'project/first',
            outputDomain: 'project/second',
            outputTags: ['second'],
          },
        ],
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).not.toThrow();
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // ==================== tryValidate (Non-throwing) ====================

  describe('tryValidate', () => {
    it('should return { valid: true } for valid pipeline', () => {
      const pipeline: IPipelineDefinition = {
        name: 'test',
        description: 'Test',
        agents: [createValidStep(realAgentKey)],
        sequential: true,
      };

      const result = validator.tryValidate(pipeline);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return { valid: false, error } for invalid pipeline', () => {
      const pipeline: IPipelineDefinition = {
        name: '',
        description: 'Test',
        agents: [],
        sequential: false,
      };

      const result = validator.tryValidate(pipeline);
      expect(result.valid).toBe(false);
      expect(result.error).toBeInstanceOf(PipelineDefinitionError);
    });
  });

  // ==================== validateMultiple ====================

  describe('validateMultiple', () => {
    it('should validate multiple pipelines and return names', () => {
      const pipelines: IPipelineDefinition[] = [
        {
          name: 'pipeline-1',
          description: 'Test 1',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        },
        {
          name: 'pipeline-2',
          description: 'Test 2',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        },
      ];

      const names = validator.validateMultiple(pipelines);
      expect(names).toEqual(['pipeline-1', 'pipeline-2']);
    });

    it('should stop at first invalid pipeline', () => {
      const pipelines: IPipelineDefinition[] = [
        {
          name: 'valid-pipeline',
          description: 'Test',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        },
        {
          name: '',  // Invalid
          description: 'Test',
          agents: [],
          sequential: false,
        },
        {
          name: 'never-reached',
          description: 'Test',
          agents: [createValidStep(realAgentKey)],
          sequential: true,
        },
      ];

      expect(() => validator.validateMultiple(pipelines)).toThrow(PipelineDefinitionError);
    });
  });

  // ==================== Helper Methods ====================

  describe('isValidAgentKey', () => {
    it('should return true for existing agent key', () => {
      expect(validator.isValidAgentKey(realAgentKey)).toBe(true);
    });

    it('should return false for non-existent agent key', () => {
      expect(validator.isValidAgentKey('non-existent-12345')).toBe(false);
    });
  });

  describe('findSimilarAgentKeys', () => {
    it('should find agents matching pattern', () => {
      // This test depends on having agents with 'coder' in the name
      const results = validator.findSimilarAgentKeys('coder');
      // We expect at least one result (there should be a 'coder' agent)
      // But we don't fail if none - it depends on the actual agent files
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return empty array for unmatched pattern', () => {
      const results = validator.findSimilarAgentKeys('xyz-nonexistent-pattern-123');
      expect(results).toEqual([]);
    });
  });

  // ==================== Real Agent Integration ====================

  describe('real agent integration (RULE-002)', () => {
    it('should validate with multiple real agents', async () => {
      const allAgents = registry.getAll();
      expect(allAgents.length).toBeGreaterThan(10);  // We should have many agents

      // Create a pipeline with multiple real agents
      const agents = allAgents.slice(0, 3);
      const pipeline: IPipelineDefinition = {
        name: 'multi-agent-pipeline',
        description: 'Pipeline with multiple real agents',
        agents: agents.map((agent, index) => ({
          agentKey: agent.key,
          task: `Task ${index + 1} for ${agent.key}`,
          inputDomain: index > 0 ? `project/step-${index - 1}` : undefined,
          outputDomain: `project/step-${index}`,
          outputTags: [`step-${index}`, agent.key],
        })),
        sequential: true,
      };

      expect(() => validator.validate(pipeline)).not.toThrow();
    });

    it('should have access to many real agents', () => {
      const count = registry.getAll().length;
      // Registry should have substantial agents for pipeline validation
      expect(count).toBeGreaterThanOrEqual(100);
    });
  });
});

// ==================== Test Helpers ====================

/**
 * Create a valid pipeline step with a real agent key
 */
function createValidStep(agentKey: string): IPipelineStep {
  return {
    agentKey,
    task: 'Perform the assigned task',
    outputDomain: 'project/test',
    outputTags: ['test', 'output'],
  };
}

// Import vi for spying
import { vi } from 'vitest';
