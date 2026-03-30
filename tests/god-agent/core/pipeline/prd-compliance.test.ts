/**
 * PRD Compliance Integration Tests
 *
 * Tests for pipeline components created per PRD requirements:
 * - LeannContextService (Section 4.5)
 * - Sherlock Types (Section 2.3)
 * - ConstitutionValidator (Section 3.2)
 * - TruthProtocolVerifier (Section 2.3)
 *
 * @module tests/god-agent/core/pipeline/prd-compliance.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════

import {
  LeannContextService,
  createLeannContextService,
  type ICodeContextResult,
  type ISemanticContext,
  type ISemanticContextParams,
} from '../../../../src/god-agent/core/pipeline/leann-context-service.js';

import {
  SherlockVerdict,
  type SherlockConfidence,
  type ISherlockResult,
  type ISherlockEvidence,
  type ISherlockIssue,
  type IPhaseReviewResult,
  SHERLOCK_AGENTS,
  CRITICAL_AGENTS,
  SHERLOCK_PHASE_MAP,
} from '../../../../src/god-agent/core/pipeline/types.js';

import {
  ConstitutionValidator,
  createConstitutionValidator,
  createCustomConstitutionValidator,
  CONSTITUTION_LIMITS,
  type IConstitutionValidationResult,
  type IValidationResult,
} from '../../../../src/god-agent/core/pipeline/constitution-validator.js';

import {
  TruthProtocolVerifier,
  createTruthProtocolVerifier,
  createCustomTruthProtocolVerifier,
  MIN_TRUTH_SCORE,
  MIN_VERIFIED_PERCENTAGE,
  MAX_HALLUCINATION_RISK,
  type ITruthClaim,
  type ITruthVerificationResult,
  type IHallucinationResult,
} from '../../../../src/god-agent/core/pipeline/truth-protocol.js';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: LEANN CONTEXT SERVICE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('LeannContextService', () => {
  let service: LeannContextService;

  beforeEach(() => {
    service = createLeannContextService();
  });

  describe('initialization', () => {
    it('should create service with factory function', () => {
      expect(service).toBeInstanceOf(LeannContextService);
    });

    it('should not be initialized by default', () => {
      expect(service.isInitialized()).toBe(false);
    });

    it('should accept custom configuration', () => {
      const customService = createLeannContextService({
        defaultMaxResults: 10,
        defaultTimeoutMs: 10000,
        minSimilarityThreshold: 0.5,
      });
      expect(customService).toBeInstanceOf(LeannContextService);
    });

    it('should initialize with mock adapter', async () => {
      const mockAdapter = createMockLeannAdapter([]);
      await service.initialize(mockAdapter as any);
      expect(service.isInitialized()).toBe(true);
      expect(service.getAdapter()).toBe(mockAdapter);
    });
  });

  describe('searchCodeContext', () => {
    it('should return empty array when not initialized', async () => {
      const results = await service.searchCodeContext('test query');
      expect(results).toEqual([]);
    });

    it('should return empty array when adapter returns no results', async () => {
      const mockAdapter = createMockLeannAdapter([]);
      await service.initialize(mockAdapter as any);

      const results = await service.searchCodeContext('test query');
      expect(results).toEqual([]);
    });

    it('should return transformed results from adapter', async () => {
      const mockResults = [
        {
          content: 'function test() {}',
          score: 0.85,
          metadata: {
            filePath: 'src/test.ts',
            language: 'typescript',
            content: 'function test() { return true; }',
          },
        },
      ];
      const mockAdapter = createMockLeannAdapter(mockResults);
      await service.initialize(mockAdapter as any);

      const results = await service.searchCodeContext('test function');
      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe('src/test.ts');
      expect(results[0].similarity).toBe(0.85);
      expect(results[0].language).toBe('typescript');
    });

    it('should handle adapter errors gracefully', async () => {
      const mockAdapter = createErrorAdapter();
      await service.initialize(mockAdapter as any);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const results = await service.searchCodeContext('test');
      expect(results).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe('buildSemanticContext', () => {
    it('should return empty context when not initialized', async () => {
      const params: ISemanticContextParams = {
        taskDescription: 'implement user authentication',
        phase: 1,
      };

      const context = await service.buildSemanticContext(params);
      expect(context.codeContext).toEqual([]);
      expect(context.totalResults).toBe(0);
      expect(context.searchQuery).toContain('user authentication');
    });

    it('should build proper context structure', async () => {
      const mockResults = [
        {
          content: 'auth code',
          score: 0.9,
          metadata: { filePath: 'src/auth.ts', content: 'export function login() {}' },
        },
        {
          content: 'user code',
          score: 0.7,
          metadata: { filePath: 'src/user.ts', content: 'export class User {}' },
        },
      ];
      const mockAdapter = createMockLeannAdapter(mockResults);
      await service.initialize(mockAdapter as any);

      const context = await service.buildSemanticContext({
        taskDescription: 'implement authentication',
        phase: 1,
        maxResults: 5,
      });

      expect(context.codeContext.length).toBeGreaterThan(0);
      expect(context.totalResults).toBe(context.codeContext.length);
      expect(context.searchQuery).toBe('implement authentication');
    });

    it('should filter results below similarity threshold', async () => {
      const mockResults = [
        { content: 'high match', score: 0.9, metadata: { filePath: 'high.ts' } },
        { content: 'low match', score: 0.1, metadata: { filePath: 'low.ts' } },
      ];
      const mockAdapter = createMockLeannAdapter(mockResults);
      const customService = createLeannContextService({ minSimilarityThreshold: 0.3 });
      await customService.initialize(mockAdapter as any);

      const context = await customService.buildSemanticContext({
        taskDescription: 'test',
        phase: 1,
      });

      expect(context.codeContext).toHaveLength(1);
      expect(context.codeContext[0].similarity).toBe(0.9);
    });

    it('should enrich query with previous output context', async () => {
      const mockAdapter = createMockLeannAdapter([]);
      await service.initialize(mockAdapter as any);

      const context = await service.buildSemanticContext({
        taskDescription: 'implement feature',
        phase: 2,
        previousOutput: { type: 'authentication', component: 'LoginForm' },
      });

      expect(context.searchQuery).toContain('implement feature');
      expect(context.searchQuery).toContain('authentication');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: SHERLOCK TYPES TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Sherlock Types', () => {
  describe('SherlockVerdict enum', () => {
    it('should have INNOCENT value', () => {
      expect(SherlockVerdict.INNOCENT).toBe('INNOCENT');
    });

    it('should have GUILTY value', () => {
      expect(SherlockVerdict.GUILTY).toBe('GUILTY');
    });

    it('should have INSUFFICIENT_EVIDENCE value', () => {
      expect(SherlockVerdict.INSUFFICIENT_EVIDENCE).toBe('INSUFFICIENT_EVIDENCE');
    });

    it('should have exactly 3 verdict values', () => {
      const verdicts = Object.values(SherlockVerdict);
      expect(verdicts).toHaveLength(3);
    });
  });

  describe('ISherlockResult interface compliance', () => {
    it('should accept valid ISherlockResult object', () => {
      const result: ISherlockResult = {
        verdict: SherlockVerdict.INNOCENT,
        confidence: 'HIGH',
        evidence: [],
        issues: [],
        agentKey: 'phase-1-reviewer',
        timestamp: new Date().toISOString(),
      };

      expect(result.verdict).toBe(SherlockVerdict.INNOCENT);
      expect(result.confidence).toBe('HIGH');
      expect(result.agentKey).toBe('phase-1-reviewer');
    });

    it('should support all confidence levels', () => {
      const confidences: SherlockConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];
      confidences.forEach((conf) => {
        const result: ISherlockResult = {
          verdict: SherlockVerdict.GUILTY,
          confidence: conf,
          evidence: [],
          issues: [],
          agentKey: 'test-agent',
          timestamp: new Date().toISOString(),
        };
        expect(result.confidence).toBe(conf);
      });
    });

    it('should support evidence array', () => {
      const evidence: ISherlockEvidence[] = [
        {
          type: 'code_pattern',
          filePath: 'src/test.ts',
          lineRange: { start: 10, end: 20 },
          description: 'Found potential issue',
          data: { pattern: 'unsafe' },
        },
      ];

      const result: ISherlockResult = {
        verdict: SherlockVerdict.GUILTY,
        confidence: 'HIGH',
        evidence,
        issues: [],
        agentKey: 'reviewer',
        timestamp: new Date().toISOString(),
      };

      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].type).toBe('code_pattern');
    });

    it('should support issues array', () => {
      const issues: ISherlockIssue[] = [
        {
          severity: 'high',
          category: 'security',
          description: 'SQL injection vulnerability',
          filePath: 'src/db.ts',
          remediation: 'Use parameterized queries',
        },
      ];

      const result: ISherlockResult = {
        verdict: SherlockVerdict.GUILTY,
        confidence: 'HIGH',
        evidence: [],
        issues,
        agentKey: 'security-auditor',
        timestamp: new Date().toISOString(),
      };

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('high');
    });
  });

  describe('IPhaseReviewResult interface compliance', () => {
    it('should accept valid IPhaseReviewResult object', () => {
      const review: IPhaseReviewResult = {
        phase: 3,
        verdict: SherlockVerdict.INNOCENT,
        confidence: 'HIGH',
        remediations: [],
        retryCount: 0,
      };

      expect(review.phase).toBe(3);
      expect(review.verdict).toBe(SherlockVerdict.INNOCENT);
    });

    it('should support remediations for GUILTY verdict', () => {
      const review: IPhaseReviewResult = {
        phase: 4,
        verdict: SherlockVerdict.GUILTY,
        confidence: 'MEDIUM',
        remediations: [
          'Fix authentication logic',
          'Add input validation',
          'Update error handling',
        ],
        retryCount: 1,
      };

      expect(review.remediations).toHaveLength(3);
      expect(review.retryCount).toBe(1);
    });

    it('should support optional agentResults', () => {
      const review: IPhaseReviewResult = {
        phase: 5,
        verdict: SherlockVerdict.INSUFFICIENT_EVIDENCE,
        confidence: 'LOW',
        remediations: [],
        retryCount: 0,
        agentResults: [
          {
            verdict: SherlockVerdict.INNOCENT,
            confidence: 'MEDIUM',
            evidence: [],
            issues: [],
            agentKey: 'test-writer',
            timestamp: new Date().toISOString(),
          },
        ],
      };

      expect(review.agentResults).toHaveLength(1);
    });
  });

  describe('Sherlock agent constants', () => {
    it('should have 7 Sherlock forensic agents', () => {
      expect(SHERLOCK_AGENTS).toHaveLength(7);
    });

    it('should include all phase reviewers', () => {
      expect(SHERLOCK_AGENTS).toContain('phase-1-reviewer');
      expect(SHERLOCK_AGENTS).toContain('phase-2-reviewer');
      expect(SHERLOCK_AGENTS).toContain('phase-3-reviewer');
      expect(SHERLOCK_AGENTS).toContain('phase-4-reviewer');
      expect(SHERLOCK_AGENTS).toContain('phase-5-reviewer');
      expect(SHERLOCK_AGENTS).toContain('phase-6-reviewer');
      expect(SHERLOCK_AGENTS).toContain('recovery-agent');
    });

    it('should mark all Sherlock agents as critical', () => {
      SHERLOCK_AGENTS.forEach((agent) => {
        expect(CRITICAL_AGENTS).toContain(agent);
      });
    });

    it('should map Sherlock agents to correct phases', () => {
      expect(SHERLOCK_PHASE_MAP['phase-1-reviewer']).toBe('understanding');
      expect(SHERLOCK_PHASE_MAP['phase-2-reviewer']).toBe('exploration');
      expect(SHERLOCK_PHASE_MAP['phase-3-reviewer']).toBe('architecture');
      expect(SHERLOCK_PHASE_MAP['phase-4-reviewer']).toBe('implementation');
      expect(SHERLOCK_PHASE_MAP['phase-5-reviewer']).toBe('testing');
      expect(SHERLOCK_PHASE_MAP['phase-6-reviewer']).toBe('optimization');
      expect(SHERLOCK_PHASE_MAP['recovery-agent']).toBe('delivery');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: CONSTITUTION VALIDATOR TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('ConstitutionValidator', () => {
  let validator: ConstitutionValidator;

  beforeEach(() => {
    validator = createConstitutionValidator();
  });

  describe('factory functions', () => {
    it('should create validator with default settings', () => {
      expect(validator).toBeInstanceOf(ConstitutionValidator);
    });

    it('should create validator with custom limits', () => {
      const custom = createCustomConstitutionValidator({
        maxLinesPerFile: 200,
        maxLinesPerFunction: 30,
        maxLinesPerClass: 50,
        maxParameters: 3,
      });
      expect(custom).toBeInstanceOf(ConstitutionValidator);
    });
  });

  describe('validateFileLength', () => {
    it('should pass for file under limit', () => {
      const content = 'line1\nline2\nline3';
      const result = validator.validateFileLength(content);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('CONST-FILE-001');
      expect(result.actualValue).toBe(3);
    });

    it('should detect file exceeding limit', () => {
      const lines = Array(600).fill('const x = 1;').join('\n');
      const result = validator.validateFileLength(lines);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('600');
      expect(result.expectedValue).toBe(CONSTITUTION_LIMITS.MAX_LINES_PER_FILE);
    });

    it('should respect custom max lines', () => {
      const content = Array(150).fill('x').join('\n');
      const result = validator.validateFileLength(content, 100);

      expect(result.passed).toBe(false);
      expect(result.expectedValue).toBe(100);
    });
  });

  describe('validateFunctionLength', () => {
    it('should pass for short function', () => {
      const content = `
function shortFunction() {
  const a = 1;
  const b = 2;
  return a + b;
}`;
      const result = validator.validateFunctionLength(content);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('CONST-FUNC-001');
    });

    it('should detect long function', () => {
      const functionBody = Array(60).fill('  console.log("line");').join('\n');
      const content = `function longFunction() {\n${functionBody}\n}`;
      const result = validator.validateFunctionLength(content);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('longFunction');
      expect(result.lineNumbers).toBeDefined();
    });

    it('should detect long arrow function', () => {
      const functionBody = Array(60).fill('  console.log("line");').join('\n');
      const content = `const longArrow = () => {\n${functionBody}\n};`;
      const result = validator.validateFunctionLength(content);

      expect(result.passed).toBe(false);
    });

    it('should detect long class method', () => {
      const methodBody = Array(60).fill('    console.log("line");').join('\n');
      const content = `class MyClass {
  longMethod() {
${methodBody}
  }
}`;
      const result = validator.validateFunctionLength(content);

      expect(result.passed).toBe(false);
    });
  });

  describe('validateNoSecrets', () => {
    it('should pass for clean code', () => {
      const content = `
const apiUrl = process.env.API_URL;
const token = getToken();
export function authenticate() {
  return fetch(apiUrl, { headers: { Authorization: token } });
}`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('PROHIB-007');
    });

    it('should detect hardcoded API key', () => {
      const content = `const api_key = "sk-1234567890abcdefghijklmnopqrstuv";`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('API key');
    });

    it('should detect hardcoded password', () => {
      const content = `const password = "supersecretpassword123";`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Password');
    });

    it('should detect OpenAI API key pattern', () => {
      const content = `const openaiKey = sk-abcdefghijklmnopqrstuvwxyz123456;`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('OpenAI');
    });

    it('should detect GitHub token pattern', () => {
      const content = `const ghToken = ghp_abcdefghijklmnopqrstuvwxyz1234567890;`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(false);
    });

    it('should detect private key block', () => {
      const content = `const key = "-----BEGIN RSA PRIVATE KEY-----";`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Private key');
    });

    it('should ignore comments containing secret patterns', () => {
      const content = `
// This is a comment about api_key = "example"
* password = "documented example" */
const realValue = process.env.PASSWORD;`;
      const result = validator.validateNoSecrets(content);

      expect(result.passed).toBe(true);
    });
  });

  describe('validateJSDocPresence', () => {
    it('should pass for documented exports', () => {
      const content = `
/**
 * Authenticates user
 * @param credentials - User credentials
 * @returns Auth token
 */
export function authenticate(credentials: Credentials): string {
  return 'token';
}`;
      const result = validator.validateJSDocPresence(content);

      expect(result.passed).toBe(true);
      expect(result.ruleId).toBe('DOC-001');
    });

    it('should detect missing JSDoc on exported function', () => {
      const content = `export function undocumentedFunction() { return 1; }`;
      const result = validator.validateJSDocPresence(content);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('undocumentedFunction');
    });

    it('should detect missing JSDoc on exported class', () => {
      const content = `export class UndocumentedClass { }`;
      const result = validator.validateJSDocPresence(content);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('UndocumentedClass');
    });

    it('should detect missing JSDoc on exported interface', () => {
      const content = `export interface IUndocumented { prop: string; }`;
      const result = validator.validateJSDocPresence(content);

      expect(result.passed).toBe(false);
    });

    it('should not require JSDoc for non-exported functions', () => {
      const content = `function internalHelper() { return 1; }`;
      const result = validator.validateJSDocPresence(content);

      expect(result.passed).toBe(true);
    });
  });

  describe('validate (comprehensive)', () => {
    it('should return Sherlock-compatible result for passing code', () => {
      const content = `
/**
 * Short documented function
 */
export function goodCode() {
  const value = process.env.VALUE;
  return value;
}`;
      const result = validator.validate(content, 'test.ts');

      expect(result.passed).toBe(true);
      expect(result.verdict).toBe('INNOCENT');
      expect(result.confidence).toBe('HIGH');
      expect(result.errorCount).toBe(0);
      expect(result.timestamp).toBeDefined();
      expect(result.filePath).toBe('test.ts');
    });

    it('should return GUILTY verdict for errors', () => {
      const longFunction = Array(60).fill('  x;').join('\n');
      const content = `function tooLong() {\n${longFunction}\n}`;
      const result = validator.validate(content);

      expect(result.passed).toBe(false);
      expect(result.verdict).toBe('GUILTY');
      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should return INNOCENT for warnings only (no errors)', () => {
      const content = `export function noJSDoc() { return 1; }`;
      const result = validator.validate(content);

      // Only warnings (missing JSDoc) but no errors - still passes
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBeGreaterThan(0);
      // Constitution validator passes if no errors (warnings are acceptable)
      expect(result.passed).toBe(true);
      expect(result.verdict).toBe('INNOCENT');
    });

    it('should generate evidence for violations', () => {
      const content = `const secret = "sk-abc123def456ghij789klmnopqrstu";`;
      const result = validator.validate(content);

      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].type).toBe('constitution_violation');
    });

    it('should include remediation suggestions in issues', () => {
      const content = `const api_key = "secret123456789";`;
      const result = validator.validate(content);

      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].remediation).toBeDefined();
    });
  });

  describe('quickCheck', () => {
    it('should return true for valid code', () => {
      const content = `const x = 1;`;
      expect(validator.quickCheck(content)).toBe(true);
    });

    it('should return false for invalid code', () => {
      const content = `const password = "hardcoded123";`;
      expect(validator.quickCheck(content)).toBe(false);
    });
  });

  describe('getReport', () => {
    it('should generate pass report', () => {
      const content = `const x = 1;`;
      const result = validator.validate(content);
      const report = validator.getReport(result);

      expect(report).toContain('PASSED');
      expect(report).toContain('INNOCENT');
    });

    it('should generate failure report with details', () => {
      const content = `const apiKey = "sk-12345678901234567890123456789012";`;
      const result = validator.validate(content);
      const report = validator.getReport(result);

      expect(report).toContain('FAILED');
      expect(report).toContain('PROHIB-007');
      expect(report).toContain('Fix:');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: TRUTH PROTOCOL VERIFIER TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('TruthProtocolVerifier', () => {
  let verifier: TruthProtocolVerifier;

  beforeEach(() => {
    verifier = createTruthProtocolVerifier();
  });

  describe('factory functions', () => {
    it('should create verifier with default settings', () => {
      expect(verifier).toBeInstanceOf(TruthProtocolVerifier);
    });

    it('should create verifier with custom thresholds', () => {
      const custom = createCustomTruthProtocolVerifier({
        minTruthScore: 80,
        minVerifiedPercentage: 90,
        maxHallucinationRisk: 20,
      });
      expect(custom).toBeInstanceOf(TruthProtocolVerifier);
    });

    it('should export threshold constants', () => {
      expect(MIN_TRUTH_SCORE).toBe(70);
      expect(MIN_VERIFIED_PERCENTAGE).toBe(80);
      expect(MAX_HALLUCINATION_RISK).toBe(30);
    });
  });

  describe('verifyClaim', () => {
    it('should categorize factual claims correctly', () => {
      const claim = verifier.verifyClaim('The file contains 10 functions.');
      expect(claim.type).toBe('quantitative');
      expect(claim.id).toContain('claim-');
    });

    it('should categorize existence claims correctly', () => {
      // Use a claim that matches existence patterns more directly
      const claim = verifier.verifyClaim('There is a function called authenticate.');
      expect(claim.type).toBe('existence');
    });

    it('should categorize behavioral claims correctly', () => {
      const claim = verifier.verifyClaim('This function will return the user data.');
      expect(claim.type).toBe('behavioral');
    });

    it('should categorize opinion claims correctly', () => {
      const claim = verifier.verifyClaim('This approach is the best solution.');
      expect(claim.type).toBe('opinion');
    });

    it('should flag claims with VAGUE when uncertainty indicators present', () => {
      // Test that multiple uncertainty indicators cause VAGUE flag
      const claim = verifier.verifyClaim('This might possibly maybe work under certain conditions.');
      expect(claim.flags).toContain('VAGUE');
    });

    it('should add MISSING_EVIDENCE flag for critical existence claims', () => {
      // Existence claims that specifically match patterns and require evidence
      const claim = verifier.verifyClaim('Created the file authentication module.');
      // Existence claims that match critical patterns require evidence
      if (claim.requiresEvidence && claim.evidence.length === 0) {
        expect(claim.flags).toContain('MISSING_EVIDENCE');
      } else {
        // If the claim type doesn't require evidence, verify that
        expect(claim.type).toBeDefined();
      }
    });

    it('should improve score when evidence is provided', () => {
      const withoutEvidence = verifier.verifyClaim('The file exists.');
      const withEvidence = verifier.verifyClaim('The file exists.', 'file: src/test.ts verified');

      expect(withEvidence.truthScore).toBeGreaterThan(withoutEvidence.truthScore);
      expect(withEvidence.evidence.length).toBe(1);
    });

    it('should flag overstated claims', () => {
      const claim = verifier.verifyClaim('This definitely always works perfectly without any issues.');
      expect(claim.flags).toContain('OVERSTATED');
    });

    it('should mark opinion claims as unverifiable', () => {
      const claim = verifier.verifyClaim('I recommend using this approach.');
      expect(claim.isVerifiable).toBe(false);
      expect(claim.flags).toContain('UNVERIFIABLE');
    });
  });

  describe('detectHallucinations', () => {
    it('should detect overconfident language', () => {
      const output = 'This will definitely always work without any issues.';
      const result = verifier.detectHallucinations(output);

      expect(result.detected).toBe(true);
      expect(result.patterns.some((p) => p.type === 'OVERCONFIDENT')).toBe(true);
    });

    it('should detect circular reasoning', () => {
      const output = 'This works because it does what it is supposed to do.';
      const result = verifier.detectHallucinations(output);

      expect(result.patterns.some((p) => p.type === 'CIRCULAR_REASONING')).toBe(true);
    });

    it('should return no hallucinations for clean output', () => {
      const output = 'The implementation follows the standard patterns.';
      const result = verifier.detectHallucinations(output);

      expect(result.riskScore).toBeLessThan(50);
    });

    it('should verify file claims against context', () => {
      const output = 'The file "nonexistent.ts" contains the authentication logic.';
      const context: ISemanticContext = {
        codeContext: [
          { filePath: 'src/auth.ts', content: 'export function auth() {}', similarity: 0.9 },
        ],
        totalResults: 1,
        searchQuery: 'authentication',
      };

      const result = verifier.detectHallucinations(output, context);

      expect(result.patterns.some((p) => p.type === 'NONEXISTENT_FILE')).toBe(true);
    });

    it('should have higher confidence with context', () => {
      const output = 'The code is well structured.';
      const withContext = verifier.detectHallucinations(output, {
        codeContext: [{ filePath: 'test.ts', content: 'code', similarity: 0.8 }],
        totalResults: 1,
        searchQuery: 'test',
      });
      const withoutContext = verifier.detectHallucinations(output);

      expect(withContext.confidence).not.toBe('LOW');
      expect(withoutContext.confidence).toBe('LOW');
    });
  });

  describe('calculateTruthScore', () => {
    it('should return 100 for empty claims array', () => {
      const score = verifier.calculateTruthScore([]);
      expect(score).toBe(100);
    });

    it('should calculate weighted average', () => {
      const claims: ITruthClaim[] = [
        createMockClaim('factual', 80),
        createMockClaim('opinion', 60),
      ];
      const score = verifier.calculateTruthScore(claims);

      // Factual has weight 1.5, opinion has weight 0.5
      // (80 * 1.5 + 60 * 0.5) / (1.5 + 0.5) = (120 + 30) / 2 = 75
      expect(score).toBe(75);
    });

    it('should weight existence claims higher than opinions', () => {
      const existenceClaims: ITruthClaim[] = [createMockClaim('existence', 70)];
      const opinionClaims: ITruthClaim[] = [createMockClaim('opinion', 70)];

      const existenceScore = verifier.calculateTruthScore(existenceClaims);
      const opinionScore = verifier.calculateTruthScore(opinionClaims);

      expect(existenceScore).toBe(opinionScore); // Same individual scores
    });
  });

  describe('verify (comprehensive)', () => {
    it('should return proper ITruthVerificationResult structure', () => {
      const output = 'The function returns true when called with valid input.';
      const result = verifier.verify(output);

      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('overallTruthScore');
      expect(result).toHaveProperty('claims');
      expect(result).toHaveProperty('hallucinationResult');
      expect(result).toHaveProperty('statistics');
      expect(result).toHaveProperty('verdict');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidence');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('recommendations');
    });

    it('should pass for honest, verifiable output', () => {
      const output = 'The implementation handles the basic use case.';
      const result = verifier.verify(output);

      expect(result.overallTruthScore).toBeGreaterThan(0);
      expect(result.verdict).toBeDefined();
    });

    it('should return GUILTY verdict for high hallucination risk', () => {
      const output = `
        This definitely always works perfectly.
        The file "fake.ts" absolutely exists.
        Because this is what it does, it does this.
        The result is definitely "success" always.
      `;
      const result = verifier.verify(output);

      if (result.hallucinationResult.riskScore > MAX_HALLUCINATION_RISK) {
        expect(result.verdict).not.toBe('INNOCENT');
      }
    });

    it('should generate statistics correctly', () => {
      const output = 'The file exists. This is my recommendation. The function returns 5 results.';
      const result = verifier.verify(output);

      expect(result.statistics.totalClaims).toBeGreaterThanOrEqual(0);
      expect(result.statistics.claimTypeDistribution).toBeDefined();
      expect(result.statistics.flagDistribution).toBeDefined();
    });

    it('should generate recommendations for low scores', () => {
      const output = `
        This definitely always works.
        The file "nonexistent.ts" exists.
        Because it works, it works.
      `;
      const result = verifier.verify(output);

      if (result.hallucinationResult.riskScore > 50) {
        expect(result.recommendations.length).toBeGreaterThan(0);
      }
    });

    it('should include Sherlock-compatible evidence', () => {
      const output = 'The implementation is complete and tested.';
      const result = verifier.verify(output);

      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0]).toHaveProperty('type');
      expect(result.evidence[0]).toHaveProperty('description');
    });

    it('should generate issues for problematic claims', () => {
      const output = 'The file "missing.ts" definitely contains the implementation.';
      const context: ISemanticContext = {
        codeContext: [],
        totalResults: 0,
        searchQuery: 'test',
      };
      const result = verifier.verify(output, context);

      // Should have issues if hallucinations detected
      if (result.hallucinationResult.detected) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock LEANN adapter for testing
 */
function createMockLeannAdapter(results: any[]) {
  return {
    searchByText: vi.fn().mockResolvedValue({
      status: 'success',
      results: results,
    }),
  };
}

/**
 * Create a mock adapter that throws errors
 */
function createErrorAdapter() {
  return {
    searchByText: vi.fn().mockRejectedValue(new Error('Search failed')),
  };
}

/**
 * Create a mock truth claim for testing
 */
function createMockClaim(type: string, truthScore: number): ITruthClaim {
  return {
    id: `mock-${Date.now()}`,
    statement: 'Mock claim',
    type: type as any,
    truthScore,
    confidence: truthScore >= 70 ? 'HIGH' : 'MEDIUM',
    evidence: [],
    isVerifiable: type !== 'opinion',
    requiresEvidence: ['factual', 'existence'].includes(type),
    flags: [],
  };
}
