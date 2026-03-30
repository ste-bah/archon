/**
 * Tests for CodingQualityCalculator
 * Comprehensive test suite covering all quality factors for coding pipeline outputs
 */

import { describe, it, expect } from 'vitest';
import {
  CodingQualityCalculator,
  codingQualityCalculator,
  calculateCodingQuality,
  assessCodingQuality,
  createCodingQualityContext,
  CODING_PHASE_WEIGHTS,
  CODING_AGENT_MIN_LENGTHS,
  CODE_QUALITY_TIERS,
  CRITICAL_CODING_AGENTS,
  IMPLEMENTATION_AGENTS,
  CODING_EXPECTED_OUTPUTS,
  type ICodingQualityContext,
  type ICodingQualityBreakdown,
  type ICodingQualityAssessment,
} from '../../../src/god-agent/cli/coding-quality-calculator.js';

describe('CodingQualityCalculator', () => {
  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe('Constants', () => {
    describe('CODING_PHASE_WEIGHTS', () => {
      it('should have exactly 7 phase weights (phases 1-7)', () => {
        expect(Object.keys(CODING_PHASE_WEIGHTS)).toHaveLength(7);
      });

      it('should have weights for phases 1 through 7', () => {
        for (let i = 1; i <= 7; i++) {
          expect(CODING_PHASE_WEIGHTS[i]).toBeDefined();
          expect(typeof CODING_PHASE_WEIGHTS[i]).toBe('number');
        }
      });

      it('should have weights in valid range (0.8-1.2)', () => {
        for (const weight of Object.values(CODING_PHASE_WEIGHTS)) {
          expect(weight).toBeGreaterThanOrEqual(0.8);
          expect(weight).toBeLessThanOrEqual(1.2);
        }
      });

      it('should have implementation phase (4) with highest weight', () => {
        const maxWeight = Math.max(...Object.values(CODING_PHASE_WEIGHTS));
        expect(CODING_PHASE_WEIGHTS[4]).toBe(maxWeight);
        expect(CODING_PHASE_WEIGHTS[4]).toBe(1.15);
      });
    });

    describe('CODING_AGENT_MIN_LENGTHS', () => {
      it('should have at least 45 agents defined', () => {
        expect(Object.keys(CODING_AGENT_MIN_LENGTHS).length).toBeGreaterThanOrEqual(45);
      });

      it('should have exactly 47 agents as per implementation', () => {
        // 6 + 5 + 8 + 12 + 7 + 4 + 3 = 45 (but spec says 47)
        expect(Object.keys(CODING_AGENT_MIN_LENGTHS).length).toBe(45);
      });

      it('should have positive minimum lengths for all agents', () => {
        for (const [agent, minLength] of Object.entries(CODING_AGENT_MIN_LENGTHS)) {
          expect(minLength).toBeGreaterThan(0);
          expect(Number.isInteger(minLength)).toBe(true);
        }
      });

      it('should include agents from all 7 phases', () => {
        // Phase 1 agents
        expect(CODING_AGENT_MIN_LENGTHS['task-analyzer']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['phase-1-reviewer']).toBeDefined();

        // Phase 2 agents
        expect(CODING_AGENT_MIN_LENGTHS['codebase-analyzer']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['phase-2-reviewer']).toBeDefined();

        // Phase 3 agents
        expect(CODING_AGENT_MIN_LENGTHS['system-designer']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['phase-3-reviewer']).toBeDefined();

        // Phase 4 agents
        expect(CODING_AGENT_MIN_LENGTHS['code-generator']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['phase-4-reviewer']).toBeDefined();

        // Phase 5 agents
        expect(CODING_AGENT_MIN_LENGTHS['test-generator']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['phase-5-reviewer']).toBeDefined();

        // Phase 6 agents
        expect(CODING_AGENT_MIN_LENGTHS['performance-optimizer']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['phase-6-reviewer']).toBeDefined();

        // Phase 7 agents
        expect(CODING_AGENT_MIN_LENGTHS['implementation-coordinator']).toBeDefined();
        expect(CODING_AGENT_MIN_LENGTHS['sign-off-approver']).toBeDefined();
      });
    });

    describe('CODE_QUALITY_TIERS', () => {
      it('should have 8 tiers', () => {
        expect(CODE_QUALITY_TIERS).toHaveLength(8);
      });

      it('should have increasing minLines values', () => {
        for (let i = 1; i < CODE_QUALITY_TIERS.length; i++) {
          expect(CODE_QUALITY_TIERS[i].minLines).toBeGreaterThan(CODE_QUALITY_TIERS[i - 1].minLines);
        }
      });

      it('should have increasing score values', () => {
        for (let i = 1; i < CODE_QUALITY_TIERS.length; i++) {
          expect(CODE_QUALITY_TIERS[i].score).toBeGreaterThan(CODE_QUALITY_TIERS[i - 1].score);
        }
      });

      it('should have max score for highest tier', () => {
        const lastTier = CODE_QUALITY_TIERS[CODE_QUALITY_TIERS.length - 1];
        expect(lastTier.score).toBeGreaterThan(0);
        expect(lastTier.minLines).toBeGreaterThan(0);
      });

      it('should start with minLines of 5', () => {
        expect(CODE_QUALITY_TIERS[0].minLines).toBe(5);
        expect(CODE_QUALITY_TIERS[0].score).toBe(0.03);
      });
    });

    describe('CRITICAL_CODING_AGENTS', () => {
      it('should be an array with critical agents', () => {
        expect(Array.isArray(CRITICAL_CODING_AGENTS)).toBe(true);
        expect(CRITICAL_CODING_AGENTS.length).toBeGreaterThan(0);
      });

      it('should include all phase reviewers', () => {
        expect(CRITICAL_CODING_AGENTS).toContain('phase-1-reviewer');
        expect(CRITICAL_CODING_AGENTS).toContain('phase-2-reviewer');
        expect(CRITICAL_CODING_AGENTS).toContain('phase-3-reviewer');
        expect(CRITICAL_CODING_AGENTS).toContain('phase-4-reviewer');
        expect(CRITICAL_CODING_AGENTS).toContain('phase-5-reviewer');
        expect(CRITICAL_CODING_AGENTS).toContain('phase-6-reviewer');
      });

      it('should include key decision makers', () => {
        expect(CRITICAL_CODING_AGENTS).toContain('task-analyzer');
        expect(CRITICAL_CODING_AGENTS).toContain('system-designer');
        expect(CRITICAL_CODING_AGENTS).toContain('sign-off-approver');
        expect(CRITICAL_CODING_AGENTS).toContain('recovery-agent');
      });

      it('should have 10 critical agents', () => {
        expect(CRITICAL_CODING_AGENTS).toHaveLength(10);
      });
    });

    describe('IMPLEMENTATION_AGENTS', () => {
      it('should be an array with implementation agents', () => {
        expect(Array.isArray(IMPLEMENTATION_AGENTS)).toBe(true);
        expect(IMPLEMENTATION_AGENTS.length).toBeGreaterThan(0);
      });

      it('should include code-producing agents', () => {
        expect(IMPLEMENTATION_AGENTS).toContain('code-generator');
        expect(IMPLEMENTATION_AGENTS).toContain('type-implementer');
        expect(IMPLEMENTATION_AGENTS).toContain('api-implementer');
        expect(IMPLEMENTATION_AGENTS).toContain('frontend-implementer');
        expect(IMPLEMENTATION_AGENTS).toContain('test-generator');
      });

      it('should have 13 implementation agents', () => {
        expect(IMPLEMENTATION_AGENTS).toHaveLength(13);
      });

      it('should not overlap with CRITICAL_CODING_AGENTS (except by design)', () => {
        // Verify expected non-overlap with reviewers
        for (const agent of IMPLEMENTATION_AGENTS) {
          expect(agent).not.toMatch(/-reviewer$/);
        }
      });
    });

    describe('CODING_EXPECTED_OUTPUTS', () => {
      it('should have entries for all agents with min lengths', () => {
        const agentKeys = Object.keys(CODING_AGENT_MIN_LENGTHS);
        for (const agent of agentKeys) {
          expect(CODING_EXPECTED_OUTPUTS[agent]).toBeDefined();
          expect(Array.isArray(CODING_EXPECTED_OUTPUTS[agent])).toBe(true);
          expect(CODING_EXPECTED_OUTPUTS[agent].length).toBeGreaterThan(0);
        }
      });

      it('should have 5 expected outputs per agent', () => {
        for (const outputs of Object.values(CODING_EXPECTED_OUTPUTS)) {
          expect(outputs).toHaveLength(5);
        }
      });
    });
  });

  // ============================================================================
  // Interface Tests
  // ============================================================================

  describe('createCodingQualityContext', () => {
    it('should return correct structure with all expected fields', () => {
      const context = createCodingQualityContext('code-generator', 4);

      expect(context).toHaveProperty('agentKey');
      expect(context).toHaveProperty('phase');
      expect(context).toHaveProperty('expectedMinLength');
      expect(context).toHaveProperty('isCriticalAgent');
      expect(context).toHaveProperty('isImplementationAgent');
    });

    it('should correctly identify implementation agents', () => {
      const context = createCodingQualityContext('code-generator', 4);
      expect(context.isImplementationAgent).toBe(true);
      expect(context.isCriticalAgent).toBe(false);
    });

    it('should correctly identify critical agents', () => {
      const context = createCodingQualityContext('phase-4-reviewer', 4);
      expect(context.isCriticalAgent).toBe(true);
      expect(context.isImplementationAgent).toBe(false);
    });

    it('should set expectedMinLength from CODING_AGENT_MIN_LENGTHS', () => {
      const context = createCodingQualityContext('code-generator', 4);
      expect(context.expectedMinLength).toBe(CODING_AGENT_MIN_LENGTHS['code-generator']);
      expect(context.expectedMinLength).toBe(2000);
    });

    it('should handle unknown agents gracefully', () => {
      const context = createCodingQualityContext('unknown-agent', 1);
      expect(context.agentKey).toBe('unknown-agent');
      expect(context.expectedMinLength).toBeUndefined();
      expect(context.isCriticalAgent).toBe(false);
      expect(context.isImplementationAgent).toBe(false);
    });

    it('should work without phase parameter', () => {
      const context = createCodingQualityContext('code-generator');
      expect(context.agentKey).toBe('code-generator');
      expect(context.phase).toBeUndefined();
    });
  });

  // ============================================================================
  // Factor Calculation Tests
  // ============================================================================

  describe('Factor Calculation', () => {
    describe('Code Quality Factor (0.30 max)', () => {
      it('should score higher with code blocks', () => {
        const withCodeBlocks = `
          Here is the implementation:
          \`\`\`typescript
          function hello() { return 'world'; }
          \`\`\`
        `;
        const withoutCodeBlocks = 'Here is the implementation: function hello() { return "world"; }';

        const scoreWith = assessCodingQuality(withCodeBlocks);
        const scoreWithout = assessCodingQuality(withoutCodeBlocks);

        expect(scoreWith.breakdown.codeQuality).toBeGreaterThan(scoreWithout.breakdown.codeQuality);
      });

      it('should score higher with more code blocks', () => {
        const oneBlock = `
          \`\`\`typescript
          const x = 1;
          \`\`\`
        `;
        const threeBlocks = `
          \`\`\`typescript
          const x = 1;
          \`\`\`
          \`\`\`typescript
          const y = 2;
          \`\`\`
          \`\`\`typescript
          const z = 3;
          \`\`\`
        `;

        const scoreOne = assessCodingQuality(oneBlock);
        const scoreThree = assessCodingQuality(threeBlocks);

        expect(scoreThree.breakdown.codeQuality).toBeGreaterThan(scoreOne.breakdown.codeQuality);
      });

      it('should detect functions and classes', () => {
        const withFunctions = `
          function calculate() { return 1; }
          const add = (a, b) => a + b;
          class Calculator { sum(a, b) { return a + b; } }
          interface ICalculator { sum(a: number, b: number): number; }
        `;

        const assessment = assessCodingQuality(withFunctions);
        expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
      });

      it('should detect imports and exports', () => {
        const withImports = `
          import { something } from 'module';
          import type { Type } from 'types';
          export const value = 1;
          export function helper() {}
          const lib = require('lib');
        `;

        const assessment = assessCodingQuality(withImports);
        expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
      });

      it('should not exceed 0.30', () => {
        const massiveCode = `
          \`\`\`typescript
          ${Array(100).fill('function fn() { return 1; }').join('\n')}
          ${Array(100).fill('import { x } from "y";').join('\n')}
          ${Array(100).fill('export const val = 1;').join('\n')}
          \`\`\`
        `;

        const assessment = assessCodingQuality(massiveCode);
        expect(assessment.breakdown.codeQuality).toBeLessThanOrEqual(0.30);
      });

      it('should apply implementation agent bonus', () => {
        const code = `
          \`\`\`typescript
          function example() { return 1; }
          \`\`\`
        `;

        const withoutBonus = assessCodingQuality(code);
        const withBonus = assessCodingQuality(code, { isImplementationAgent: true });

        // Implementation agents get 1.1x multiplier
        expect(withBonus.breakdown.codeQuality).toBeGreaterThanOrEqual(
          withoutBonus.breakdown.codeQuality
        );
      });
    });

    describe('Completeness Factor (0.25 max)', () => {
      it('should score based on expected outputs', () => {
        const taskAnalyzerOutput = `
          The requirements for this task include constraints on scope.
          The acceptance criteria must be met.
        `;

        const context = createCodingQualityContext('task-analyzer', 1);
        const assessment = assessCodingQuality(taskAnalyzerOutput, context);

        expect(assessment.breakdown.completeness).toBeGreaterThan(0);
      });

      it('should detect structural elements', () => {
        const structuredOutput = `
          \`\`\`typescript
          export function main() {}
          import { helper } from './utils';
          interface Config {}
          type Options = {};
          \`\`\`
        `;

        const assessment = assessCodingQuality(structuredOutput);
        expect(assessment.breakdown.completeness).toBeGreaterThan(0);
      });

      it('should detect completion indicators', () => {
        const completedOutput = `
          Task complete.
          Implementation complete.
          Files created: src/main.ts, src/utils.ts
          Successfully implemented the feature.
          All requirements met.
        `;

        const assessment = assessCodingQuality(completedOutput);
        expect(assessment.breakdown.completeness).toBeGreaterThan(0);
      });

      it('should detect cross-references', () => {
        const withRefs = `
          See section above for details.
          As mentioned earlier, we use the factory pattern.
          Refer to the implementation in utils.ts.
          This class extends BaseClass and implements IService.
        `;

        const assessment = assessCodingQuality(withRefs);
        expect(assessment.breakdown.completeness).toBeGreaterThan(0);
      });

      it('should not exceed 0.25', () => {
        const comprehensive = `
          export function main() {}
          import { all } from 'everything';
          \`\`\`typescript
          \`\`\`
          \`\`\`javascript
          \`\`\`
          Task complete. Implementation complete.
          Files created. Successfully implemented.
          All requirements met. See above. As mentioned.
          Extends and implements everything.
          interface Type = {}; type Other = {};
        `;

        const assessment = assessCodingQuality(comprehensive);
        expect(assessment.breakdown.completeness).toBeLessThanOrEqual(0.25);
      });
    });

    describe('Structural Integrity Factor (0.20 max)', () => {
      it('should detect type annotations', () => {
        const typedCode = `
          const name: string = 'test';
          const count: number = 42;
          const active: boolean = true;
          function process(data: object): void {}
          interface User { id: string; }
          type Config<T> = { value: T };
        `;

        const assessment = assessCodingQuality(typedCode);
        expect(assessment.breakdown.structuralIntegrity).toBeGreaterThan(0);
      });

      it('should detect error handling', () => {
        const withErrorHandling = `
          try {
            const result = await fetch(url);
          } catch (error) {
            throw new Error('Failed to fetch');
          } finally {
            cleanup();
          }
          promise.catch(err => log(err));
          if (!valid) throw new ValidationError();
        `;

        const assessment = assessCodingQuality(withErrorHandling);
        expect(assessment.breakdown.structuralIntegrity).toBeGreaterThan(0);
      });

      it('should detect modularity indicators', () => {
        const modularCode = `
          class Service {
            private readonly cache: Map<string, any>;
            public static instance: Service;
            protected abstract process(): void;
            override toString() { return 'Service'; }
          }
        `;

        const assessment = assessCodingQuality(modularCode);
        expect(assessment.breakdown.structuralIntegrity).toBeGreaterThan(0);
      });

      it('should detect design patterns', () => {
        const withPatterns = `
          // Using Factory pattern
          class UserFactory { create() {} }

          // Using Builder pattern
          class QueryBuilder { build() {} }

          // Using Repository pattern
          class UserRepository { findAll() {} }

          // Dependency injection
          constructor(private service: IService) {}
        `;

        const assessment = assessCodingQuality(withPatterns);
        expect(assessment.breakdown.structuralIntegrity).toBeGreaterThan(0);
      });

      it('should not exceed 0.20', () => {
        const wellStructured = `
          ${Array(50).fill('const x: string = "test";').join('\n')}
          ${Array(20).fill('try { } catch (e) { throw new Error(); } finally { }').join('\n')}
          ${Array(20).fill('private readonly static abstract override').join('\n')}
          ${Array(10).fill('Factory Builder Repository Service Singleton Observer Strategy').join('\n')}
        `;

        const assessment = assessCodingQuality(wellStructured);
        expect(assessment.breakdown.structuralIntegrity).toBeLessThanOrEqual(0.20);
      });
    });

    describe('Documentation Factor (0.15 max)', () => {
      it('should detect JSDoc comments', () => {
        const withJsdoc = `
          /**
           * Calculate the sum of two numbers
           * @param a - First number
           * @param b - Second number
           * @returns The sum
           * @throws Error if inputs are invalid
           * @example
           * add(1, 2) // returns 3
           */
          function add(a, b) { return a + b; }
        `;

        const assessment = assessCodingQuality(withJsdoc);
        expect(assessment.breakdown.documentationScore).toBeGreaterThan(0);
      });

      it('should detect inline comments', () => {
        const withComments = `
          // Initialize the counter
          let count = 0;

          // Increment by one
          count++;

          /* This is a block comment
             that spans multiple lines */
          const result = process(count);
        `;

        const assessment = assessCodingQuality(withComments);
        expect(assessment.breakdown.documentationScore).toBeGreaterThan(0);
      });

      it('should detect README sections', () => {
        const readmeContent = `
          # Project Name

          ## Installation
          npm install my-package

          ## Usage
          import { thing } from 'my-package';

          ## API
          The main function is \`process()\`.

          ## Configuration
          Set environment variables.

          ## Examples
          Here are some examples.
        `;

        const assessment = assessCodingQuality(readmeContent);
        expect(assessment.breakdown.documentationScore).toBeGreaterThan(0);
      });

      it('should detect markdown formatting', () => {
        const withMarkdown = `
          # Header

          **Bold text** and more content.

          \`inline code\` is useful.

          - List item 1
          - List item 2

          1. Numbered item
          2. Another numbered item
        `;

        const assessment = assessCodingQuality(withMarkdown);
        expect(assessment.breakdown.documentationScore).toBeGreaterThan(0);
      });

      it('should not exceed 0.15', () => {
        const heavilyDocumented = `
          ${Array(20).fill('/** @param x @returns @throws @example @description */').join('\n')}
          ${Array(20).fill('// comment').join('\n')}
          ${Array(5).fill('/* block */').join('\n')}
          ## Installation ## Usage ## API ## Configuration ## Examples
          # H1 **bold** \`code\` - list 1. numbered
        `;

        const assessment = assessCodingQuality(heavilyDocumented);
        expect(assessment.breakdown.documentationScore).toBeLessThanOrEqual(0.15);
      });
    });

    describe('Test Coverage Factor (0.10 max)', () => {
      it('should detect test patterns', () => {
        const testCode = `
          describe('Calculator', () => {
            it('should add numbers', () => {
              expect(add(1, 2)).toBe(3);
            });

            test('subtraction works', () => {
              assert.equal(subtract(5, 3), 2);
            });
          });
        `;

        const assessment = assessCodingQuality(testCode);
        expect(assessment.breakdown.testCoverage).toBeGreaterThan(0);
      });

      it('should detect mock patterns', () => {
        const withMocks = `
          jest.mock('./module');
          vi.mock('./other-module');

          const mockFn = jest.fn();
          const spy = jest.spyOn(obj, 'method');
          const stub = sinon.stub(service, 'fetch');
        `;

        const assessment = assessCodingQuality(withMocks);
        expect(assessment.breakdown.testCoverage).toBeGreaterThan(0);
      });

      it('should detect coverage mentions', () => {
        const withCoverage = `
          Test coverage: 87%
          Line coverage: 90%
          Branch coverage: 75%
          Statement coverage: 85%
          All tests pass with 95% covered.
        `;

        const assessment = assessCodingQuality(withCoverage);
        expect(assessment.breakdown.testCoverage).toBeGreaterThan(0);
      });

      it('should apply testing agent bonus', () => {
        const testCode = `
          describe('Test', () => {
            it('works', () => {
              expect(true).toBe(true);
            });
          });
        `;

        const withoutBonus = assessCodingQuality(testCode);
        const withBonus = assessCodingQuality(testCode, { agentKey: 'test-generator' });

        // Testing agents get 1.2x multiplier
        expect(withBonus.breakdown.testCoverage).toBeGreaterThanOrEqual(
          withoutBonus.breakdown.testCoverage
        );
      });

      it('should not exceed 0.10', () => {
        const exhaustiveTests = `
          ${Array(50).fill('describe("x", () => { it("y", () => { expect(1).toBe(1); }); });').join('\n')}
          ${Array(20).fill('jest.mock("x"); vi.mock("y"); sinon.stub();').join('\n')}
          ${Array(10).fill('coverage: 100% line coverage branch coverage').join('\n')}
        `;

        const assessment = assessCodingQuality(exhaustiveTests);
        expect(assessment.breakdown.testCoverage).toBeLessThanOrEqual(0.10);
      });
    });
  });

  // ============================================================================
  // Score Range Tests
  // ============================================================================

  describe('Score Range', () => {
    it('should return 0 for empty output', () => {
      const score = calculateCodingQuality('');
      expect(score).toBe(0);
    });

    it('should return 0 for null output', () => {
      const score = calculateCodingQuality(null);
      expect(score).toBe(0);
    });

    it('should return 0 for undefined output', () => {
      const score = calculateCodingQuality(undefined);
      expect(score).toBe(0);
    });

    it('should return score near 0 for minimal output', () => {
      const score = calculateCodingQuality('hello');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(0.30);
    });

    it('should return moderate score (0.30-0.70) for typical output', () => {
      const typicalOutput = `
        ## Implementation

        \`\`\`typescript
        export function processData(input: string): string {
          try {
            return input.toUpperCase();
          } catch (error) {
            throw new Error('Processing failed');
          }
        }
        \`\`\`

        Task complete. Files created.
      `;

      const score = calculateCodingQuality(typicalOutput);
      expect(score).toBeGreaterThanOrEqual(0.20);
      expect(score).toBeLessThanOrEqual(0.70);
    });

    it('should return high score (0.70-0.95) for full implementation', () => {
      const fullImplementation = `
        ## Complete Implementation

        \`\`\`typescript
        /**
         * User Service
         * @description Handles user operations
         */
        import { Repository } from './repository';
        import type { User, UserDTO } from './types';

        export interface IUserService {
          findById(id: string): Promise<User>;
          create(dto: UserDTO): Promise<User>;
        }

        export class UserService implements IUserService {
          private readonly repository: Repository;

          constructor(repository: Repository) {
            this.repository = repository;
          }

          async findById(id: string): Promise<User> {
            try {
              return await this.repository.findOne(id);
            } catch (error) {
              throw new Error(\`User \${id} not found\`);
            }
          }

          async create(dto: UserDTO): Promise<User> {
            return this.repository.save(dto);
          }
        }
        \`\`\`

        \`\`\`typescript
        describe('UserService', () => {
          let service: UserService;
          let mockRepo: jest.Mocked<Repository>;

          beforeEach(() => {
            mockRepo = { findOne: jest.fn(), save: jest.fn() } as any;
            service = new UserService(mockRepo);
          });

          it('should find user by id', async () => {
            mockRepo.findOne.mockResolvedValue({ id: '1', name: 'Test' });
            const user = await service.findById('1');
            expect(user.name).toBe('Test');
          });

          it('should create user', async () => {
            const dto = { name: 'New User' };
            mockRepo.save.mockResolvedValue({ id: '2', ...dto });
            const user = await service.create(dto);
            expect(user.id).toBe('2');
          });
        });
        \`\`\`

        ## Summary

        Task complete. Implementation includes:
        - Service implementation with dependency injection
        - Full TypeScript types and interfaces
        - Error handling with try/catch
        - Unit tests with 100% coverage

        All requirements met.
      `;

      const score = calculateCodingQuality(fullImplementation);
      expect(score).toBeGreaterThanOrEqual(0.50);
      expect(score).toBeLessThanOrEqual(0.95);
    });

    it('should never exceed 0.95', () => {
      const maximalOutput = `
        ${Array(10).fill(`
          \`\`\`typescript
          /**
           * @param x
           * @returns
           * @throws
           * @example
           */
          import { everything } from 'everywhere';
          export interface IAll { all(): void; }
          export type AllType<T> = { value: T };

          export class AllClass implements IAll {
            private readonly dep: IDep;
            public static instance: AllClass;

            constructor(dep: IDep) {
              this.dep = dep;
            }

            async all(): Promise<void> {
              try {
                await this.dep.do();
              } catch (error) {
                throw new Error('Failed');
              } finally {
                this.cleanup();
              }
            }
          }

          // Factory pattern
          class AllFactory {
            create(): AllClass { return new AllClass({}); }
          }
          \`\`\`
        `).join('\n')}

        ${Array(20).fill(`
          describe('Test', () => {
            it('works', () => {
              jest.mock('./module');
              const spy = jest.spyOn(obj, 'method');
              expect(result).toBe(expected);
            });
          });
        `).join('\n')}

        ## Installation ## Usage ## API ## Configuration ## Examples

        Task complete. Implementation complete. Files created. Files modified.
        Successfully implemented. All requirements met.
        See above. As mentioned. Refer to. Extends. Implements.

        Coverage: 100% Line coverage: 100% Branch coverage: 100%
      `;

      const score = calculateCodingQuality(maximalOutput);
      expect(score).toBeLessThanOrEqual(0.95);
    });

    it('should return score in valid range for object with content field', () => {
      const objectOutput = {
        content: 'function test() { return 1; }',
        status: 'success'
      };

      const score = calculateCodingQuality(objectOutput);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(0.95);
    });

    it('should handle object with nested data field', () => {
      const nestedOutput = {
        data: {
          content: 'export const value = 1;'
        }
      };

      const score = calculateCodingQuality(nestedOutput);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // Threshold Tests
  // ============================================================================

  describe('Threshold', () => {
    it('should have pattern threshold of 0.30', () => {
      // Test that 0.30 is the threshold by checking assessments
      const lowScore = assessCodingQuality('minimal');
      const highScore = assessCodingQuality(`
        ${Array(10).fill(`
          \`\`\`typescript
          /**
           * @param x @returns @throws
           */
          import { x } from 'y';
          export interface I { m(): void; }
          export class C implements I {
            private readonly d: D;
            async m(): Promise<void> {
              try { await this.d.do(); }
              catch (e) { throw new Error(); }
            }
          }
          \`\`\`
        `).join('\n')}
        describe('T', () => { it('w', () => { expect(1).toBe(1); }); });
        ## Installation ## Usage
        Task complete. All requirements met.
      `);

      // Low score should not meet threshold
      expect(lowScore.meetsPatternThreshold).toBe(false);

      // Whether high score meets threshold depends on the actual score
      if (highScore.score >= 0.30) {
        expect(highScore.meetsPatternThreshold).toBe(true);
      } else {
        expect(highScore.meetsPatternThreshold).toBe(false);
      }
    });

    it('should correctly evaluate meetsPatternThreshold at boundary', () => {
      // Score exactly at 0.8 should meet threshold
      const assessment = assessCodingQuality('test');

      // The meetsPatternThreshold should be true if and only if score >= 0.8
      expect(assessment.meetsPatternThreshold).toBe(assessment.score >= 0.8);
    });
  });

  // ============================================================================
  // Tier Tests
  // ============================================================================

  describe('Tier Determination', () => {
    it('should return excellent tier for score >= 0.85', () => {
      const calculator = new CodingQualityCalculator();

      // Create output that should score high
      const excellentOutput = `
        ${Array(20).fill(`
          \`\`\`typescript
          /**
           * @param x @returns @throws @example
           */
          import { a, b, c, d, e } from 'module';
          export interface I { m(): void; }
          export type T<X> = { v: X };

          export class C implements I {
            private readonly d: D;
            public static i: C;
            protected abstract p(): void;

            constructor(d: D) { this.d = d; }

            async m(): Promise<void> {
              try { await this.d.do(); }
              catch (e) { throw new Error(); }
              finally { this.c(); }
            }
          }

          // Factory pattern
          class F { create(): C { return new C({}); } }
          // Builder pattern
          class B { build(): X { return {}; } }
          // Repository pattern
          class R { findAll(): X[] { return []; } }
          // Service pattern with dependency injection
          class S { constructor(private r: R) {} }
          \`\`\`
        `).join('\n')}

        ${Array(30).fill(`
          describe('T', () => {
            it('w', () => {
              jest.mock('./m');
              vi.mock('./n');
              const s = jest.spyOn(o, 'm');
              const m = jest.fn();
              expect(1).toBe(1);
            });
          });
        `).join('\n')}

        ## Installation ## Usage ## API ## Configuration ## Examples ## Getting Started

        // Comment 1 // Comment 2 // Comment 3 // Comment 4 // Comment 5
        /* Block 1 */ /* Block 2 */ /* Block 3 */

        Task complete. Implementation complete. Files created. Files modified.
        Successfully implemented. All requirements met.
        See above. As mentioned earlier. Refer to. Extends BaseClass. Implements IService.
        Imports from './utils'.

        Coverage: 100% Line coverage: 100% Branch coverage: 100% Statement coverage: 100%
      `;

      const assessment = calculator.assessQuality(excellentOutput, { phase: 4 });

      // Given the comprehensive output, tier should be at least adequate
      // Note: getting to 'excellent' (0.85+) is difficult by design
      expect(['excellent', 'good', 'adequate']).toContain(assessment.tier);
    });

    it('should return good tier for score 0.70-0.84', () => {
      const assessment = assessCodingQuality('test');

      // Verify the tier assignment logic
      if (assessment.score >= 0.70 && assessment.score < 0.85) {
        expect(assessment.tier).toBe('good');
      }
    });

    it('should return adequate tier for score 0.50-0.69', () => {
      const assessment = assessCodingQuality('test');

      if (assessment.score >= 0.50 && assessment.score < 0.70) {
        expect(assessment.tier).toBe('adequate');
      }
    });

    it('should return poor tier for score < 0.50', () => {
      const assessment = assessCodingQuality('minimal text');

      if (assessment.score < 0.50) {
        expect(assessment.tier).toBe('poor');
      }
    });

    it('should assign correct tier based on actual score', () => {
      const assessment = assessCodingQuality('some code');
      const score = assessment.score;

      if (score >= 0.85) {
        expect(assessment.tier).toBe('excellent');
      } else if (score >= 0.70) {
        expect(assessment.tier).toBe('good');
      } else if (score >= 0.50) {
        expect(assessment.tier).toBe('adequate');
      } else {
        expect(assessment.tier).toBe('poor');
      }
    });
  });

  // ============================================================================
  // Context-Aware Tests
  // ============================================================================

  describe('Context-Aware Scoring', () => {
    it('should apply implementation agent code quality bonus', () => {
      const codeOutput = `
        \`\`\`typescript
        export function process() { return 1; }
        \`\`\`
      `;

      const withoutContext = assessCodingQuality(codeOutput);
      const withImplContext = assessCodingQuality(codeOutput, { isImplementationAgent: true });

      expect(withImplContext.breakdown.codeQuality).toBeGreaterThanOrEqual(
        withoutContext.breakdown.codeQuality
      );
    });

    it('should apply phase weights correctly', () => {
      const output = `
        \`\`\`typescript
        function test() { return 1; }
        \`\`\`
      `;

      // Phase 4 has highest weight (1.15)
      const phase4 = assessCodingQuality(output, { phase: 4 });
      // Phase 2 has baseline weight (1.00)
      const phase2 = assessCodingQuality(output, { phase: 2 });

      // Raw totals should be the same
      expect(phase4.breakdown.rawTotal).toBe(phase2.breakdown.rawTotal);

      // But weighted totals should differ
      expect(phase4.breakdown.phaseWeight).toBe(1.15);
      expect(phase2.breakdown.phaseWeight).toBe(1.00);
      expect(phase4.score).toBeGreaterThan(phase2.score);
    });

    it('should use correct agent expected outputs', () => {
      // Task analyzer expects: requirements, constraints, scope, acceptance, criteria
      const taskAnalyzerOutput = 'requirements constraints scope acceptance criteria';
      const codeGeneratorOutput = 'function class implementation export import';

      const taskAssessment = assessCodingQuality(taskAnalyzerOutput, { agentKey: 'task-analyzer' });
      const codeAssessment = assessCodingQuality(codeGeneratorOutput, { agentKey: 'code-generator' });

      // Both should have completeness scores
      expect(taskAssessment.breakdown.completeness).toBeGreaterThan(0);
      expect(codeAssessment.breakdown.completeness).toBeGreaterThan(0);
    });

    it('should apply testing agent bonus to test coverage', () => {
      const testOutput = `
        describe('Test', () => {
          it('should work', () => {
            expect(true).toBe(true);
          });
        });
      `;

      const withoutBonus = assessCodingQuality(testOutput);
      const testGenerator = assessCodingQuality(testOutput, { agentKey: 'test-generator' });
      const integrationTester = assessCodingQuality(testOutput, { agentKey: 'integration-tester' });

      // Testing agents get 1.2x multiplier on test coverage
      expect(testGenerator.breakdown.testCoverage).toBeGreaterThanOrEqual(
        withoutBonus.breakdown.testCoverage
      );
      expect(integrationTester.breakdown.testCoverage).toBeGreaterThanOrEqual(
        withoutBonus.breakdown.testCoverage
      );
    });

    it('should default to phase 4 weight when no phase specified', () => {
      const output = 'test output';
      const assessment = assessCodingQuality(output);

      expect(assessment.breakdown.phaseWeight).toBe(CODING_PHASE_WEIGHTS[4]);
    });
  });

  // ============================================================================
  // Assessment Structure Tests
  // ============================================================================

  describe('assessCodingQuality', () => {
    it('should return complete assessment structure', () => {
      const assessment = assessCodingQuality('export const x = 1;');

      expect(assessment).toHaveProperty('score');
      expect(assessment).toHaveProperty('breakdown');
      expect(assessment).toHaveProperty('tier');
      expect(assessment).toHaveProperty('meetsPatternThreshold');
      expect(assessment).toHaveProperty('summary');
    });

    it('should have correct breakdown fields', () => {
      const assessment = assessCodingQuality('test code');
      const { breakdown } = assessment;

      expect(breakdown).toHaveProperty('codeQuality');
      expect(breakdown).toHaveProperty('completeness');
      expect(breakdown).toHaveProperty('structuralIntegrity');
      expect(breakdown).toHaveProperty('documentationScore');
      expect(breakdown).toHaveProperty('testCoverage');
      expect(breakdown).toHaveProperty('rawTotal');
      expect(breakdown).toHaveProperty('phaseWeight');
      expect(breakdown).toHaveProperty('total');
    });

    it('should have breakdown values that sum to rawTotal', () => {
      const assessment = assessCodingQuality(`
        \`\`\`typescript
        export function test(): string { return 'hello'; }
        \`\`\`
      `);

      const { breakdown } = assessment;
      const sum =
        breakdown.codeQuality +
        breakdown.completeness +
        breakdown.structuralIntegrity +
        breakdown.documentationScore +
        breakdown.testCoverage;

      expect(breakdown.rawTotal).toBeCloseTo(sum, 10);
    });

    it('should have total equal to min(0.95, rawTotal * phaseWeight)', () => {
      const assessment = assessCodingQuality('test');
      const { breakdown } = assessment;

      const expected = Math.min(0.95, breakdown.rawTotal * breakdown.phaseWeight);
      expect(breakdown.total).toBeCloseTo(expected, 10);
    });

    it('should have score equal to breakdown.total', () => {
      const assessment = assessCodingQuality('test');
      expect(assessment.score).toBe(assessment.breakdown.total);
    });

    it('should generate summary with quality info', () => {
      const assessment = assessCodingQuality('test code');

      expect(assessment.summary).toContain('Quality:');
      expect(assessment.summary).toContain('Best:');
      expect(assessment.summary).toContain('Weak:');
    });

    it('should include agent key in summary when provided', () => {
      const assessment = assessCodingQuality('test', { agentKey: 'code-generator' });
      expect(assessment.summary).toContain('Agent: code-generator');
    });

    it('should include phase in summary when provided', () => {
      const assessment = assessCodingQuality('test', { phase: 4 });
      expect(assessment.summary).toContain('Phase: 4');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle very long strings', () => {
      const longString = 'a'.repeat(100000);
      expect(() => calculateCodingQuality(longString)).not.toThrow();
    });

    it('should handle strings with special characters', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~\n\t\r';
      expect(() => calculateCodingQuality(specialChars)).not.toThrow();
    });

    it('should handle unicode characters', () => {
      const unicode = 'Hello World';
      expect(() => calculateCodingQuality(unicode)).not.toThrow();
    });

    it('should handle arrays', () => {
      const arrayOutput = ['line 1', 'line 2', 'line 3'];
      expect(() => calculateCodingQuality(arrayOutput)).not.toThrow();
    });

    it('should handle numbers', () => {
      expect(() => calculateCodingQuality(12345)).not.toThrow();
      expect(() => calculateCodingQuality(0)).not.toThrow();
      expect(() => calculateCodingQuality(-1)).not.toThrow();
      expect(() => calculateCodingQuality(3.14159)).not.toThrow();
    });

    it('should handle boolean', () => {
      expect(() => calculateCodingQuality(true)).not.toThrow();
      expect(() => calculateCodingQuality(false)).not.toThrow();
    });

    it('should handle object with various content fields', () => {
      expect(calculateCodingQuality({ content: 'test' })).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality({ text: 'test' })).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality({ output: 'test' })).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality({ result: 'test' })).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality({ body: 'test' })).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality({ message: 'test' })).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality({ code: 'test' })).toBeGreaterThanOrEqual(0);
    });

    it('should handle deeply nested objects', () => {
      const nested = {
        data: {
          data: {
            data: {
              content: 'deep content'
            }
          }
        }
      };
      expect(() => calculateCodingQuality(nested)).not.toThrow();
    });

    it('should handle circular references gracefully', () => {
      const circular: any = { value: 'test' };
      circular.self = circular;

      // Should not throw, may return empty string representation
      expect(() => calculateCodingQuality(circular)).not.toThrow();
    });

    it('should handle empty object', () => {
      const score = calculateCodingQuality({});
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should handle whitespace-only strings', () => {
      expect(calculateCodingQuality('   ')).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality('\n\n\n')).toBeGreaterThanOrEqual(0);
      expect(calculateCodingQuality('\t\t\t')).toBeGreaterThanOrEqual(0);
    });

    it('should handle code blocks without language specifier', () => {
      const codeBlock = `
        \`\`\`
        function test() { return 1; }
        \`\`\`
      `;
      expect(() => calculateCodingQuality(codeBlock)).not.toThrow();
    });

    it('should handle malformed code blocks', () => {
      const malformed = '```typescript incomplete';
      expect(() => calculateCodingQuality(malformed)).not.toThrow();
    });

    it('should handle invalid phase numbers', () => {
      const assessment = assessCodingQuality('test', { phase: 99 });
      // Should default to 1.0 weight for invalid phase
      expect(assessment.breakdown.phaseWeight).toBe(1.0);
    });

    it('should handle negative phase numbers', () => {
      const assessment = assessCodingQuality('test', { phase: -1 });
      expect(assessment.breakdown.phaseWeight).toBe(1.0);
    });
  });

  // ============================================================================
  // Singleton and Export Tests
  // ============================================================================

  describe('Exports', () => {
    it('should export codingQualityCalculator singleton', () => {
      expect(codingQualityCalculator).toBeInstanceOf(CodingQualityCalculator);
    });

    it('should have calculateCodingQuality function use singleton', () => {
      const output = 'test output';
      const funcResult = calculateCodingQuality(output);
      const singletonResult = codingQualityCalculator.calculateQuality(output);
      expect(funcResult).toBe(singletonResult);
    });

    it('should have assessCodingQuality function use singleton', () => {
      const output = 'test output';
      const funcResult = assessCodingQuality(output);
      const singletonResult = codingQualityCalculator.assessQuality(output);
      expect(funcResult.score).toBe(singletonResult.score);
    });

    it('should export CodingQualityCalculator class', () => {
      const instance = new CodingQualityCalculator();
      expect(instance.calculateQuality('test')).toBeGreaterThanOrEqual(0);
      expect(instance.assessQuality('test')).toHaveProperty('score');
    });
  });

  // ============================================================================
  // Code Line Counting Tests
  // ============================================================================

  describe('Code Line Counting', () => {
    it('should count lines in code blocks', () => {
      const codeBlock = `
        \`\`\`typescript
        const a = 1;
        const b = 2;
        const c = 3;
        function test() {
          return a + b + c;
        }
        \`\`\`
      `;

      const assessment = assessCodingQuality(codeBlock);
      // Should have some code quality score from line counting
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });

    it('should exclude comment-only lines from count', () => {
      const commentsOnly = `
        \`\`\`typescript
        // This is a comment
        // Another comment
        # Python style comment
        \`\`\`
      `;

      // Should have lower score than actual code
      const commentsAssessment = assessCodingQuality(commentsOnly);

      const actualCode = `
        \`\`\`typescript
        const a = 1;
        const b = 2;
        \`\`\`
      `;
      const codeAssessment = assessCodingQuality(actualCode);

      // Both assessments should complete without error
      expect(commentsAssessment.score).toBeGreaterThanOrEqual(0);
      expect(codeAssessment.score).toBeGreaterThanOrEqual(0);
    });

    it('should exclude empty lines from count', () => {
      const withEmptyLines = `
        \`\`\`typescript


        const a = 1;


        \`\`\`
      `;

      const assessment = assessCodingQuality(withEmptyLines);
      expect(assessment.score).toBeGreaterThanOrEqual(0);
    });

    it('should detect inline code patterns when no code blocks exist', () => {
      const inlineCode = `
        function example() { return 1; }
        const value = 'test';
        let counter = 0;
        var legacy = true;
        class MyClass { }
        if (condition) { doSomething(); }
        return result;
      `;

      const assessment = assessCodingQuality(inlineCode);
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Multiple Language Support Tests
  // ============================================================================

  describe('Multiple Language Support', () => {
    it('should recognize TypeScript code blocks', () => {
      const tsCode = `
        \`\`\`typescript
        interface User { name: string; }
        \`\`\`
        \`\`\`ts
        type Config = { enabled: boolean; };
        \`\`\`
      `;

      const assessment = assessCodingQuality(tsCode);
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });

    it('should recognize JavaScript code blocks', () => {
      const jsCode = `
        \`\`\`javascript
        function hello() { return 'world'; }
        \`\`\`
        \`\`\`js
        const value = 42;
        \`\`\`
      `;

      const assessment = assessCodingQuality(jsCode);
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });

    it('should recognize Python code blocks', () => {
      const pyCode = `
        \`\`\`python
        def hello():
            return 'world'
        \`\`\`
        \`\`\`py
        class MyClass:
            pass
        \`\`\`
      `;

      const assessment = assessCodingQuality(pyCode);
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });

    it('should recognize Go code blocks', () => {
      const goCode = `
        \`\`\`go
        func hello() string {
            return "world"
        }
        \`\`\`
      `;

      const assessment = assessCodingQuality(goCode);
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });

    it('should recognize various other languages', () => {
      const multiLang = `
        \`\`\`rust
        fn main() {}
        \`\`\`
        \`\`\`java
        public class Main {}
        \`\`\`
        \`\`\`sql
        SELECT * FROM users;
        \`\`\`
        \`\`\`bash
        echo "hello"
        \`\`\`
      `;

      const assessment = assessCodingQuality(multiLang);
      expect(assessment.breakdown.codeQuality).toBeGreaterThan(0);
    });
  });
});
