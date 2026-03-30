/**
 * Constitution Validator - Runtime validation of generated code against constitution.xml rules
 * @module src/god-agent/core/pipeline/constitution-validator
 * @see docs/god-agent-coding-pipeline/constitution.xml
 */

import { SherlockVerdict, type SherlockConfidence, type ISherlockEvidence, type ISherlockIssue } from './types.js';

/** Result from a single validation check */
export interface IValidationResult {
  passed: boolean;
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  message?: string;
  lineNumbers?: number[];
  actualValue?: number | string;
  expectedValue?: number | string;
}

/** Complete result from constitution validation */
export interface IConstitutionValidationResult {
  passed: boolean;
  validations: IValidationResult[];
  errorCount: number;
  warningCount: number;
  verdict: SherlockVerdict;
  confidence: SherlockConfidence;
  evidence: ISherlockEvidence[];
  issues: ISherlockIssue[];
  timestamp: string;
  filePath?: string;
}

/** File limits from constitution.xml coding_standards.file_limits */
export const CONSTITUTION_LIMITS = {
  MAX_LINES_PER_FILE: 500,
  MAX_LINES_PER_FUNCTION: 50,
  MAX_LINES_PER_CLASS: 100,
  MAX_PARAMETERS_PER_FUNCTION: 5,
  MAX_NESTING_DEPTH: 4,
  MAX_CYCLOMATIC_COMPLEXITY: 10,
} as const;

/** Secret patterns to detect (from PROHIB-007) */
const SECRET_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{10,1000}['"]/gi, description: 'API key' },
  { pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{1,1000}['"]/gi, description: 'Password/secret' },
  { pattern: /(?:token|auth[_-]?token|access[_-]?token)\s*[:=]\s*['"][^'"]{10,1000}['"]/gi, description: 'Token' },
  { pattern: /(?:private[_-]?key)\s*[:=]\s*['"][^'"]{1,1000}['"]/gi, description: 'Private key' },
  { pattern: /(?:aws[_-]?access|aws[_-]?secret)\s*[:=]\s*['"][A-Z0-9]{16,1000}['"]/gi, description: 'AWS creds' },
  { pattern: /sk-[a-zA-Z0-9]{32,128}/g, description: 'OpenAI key' },
  { pattern: /ghp_[a-zA-Z0-9]{36,50}/g, description: 'GitHub token' },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, description: 'Private key block' },
  { pattern: /mongodb\+srv:\/\/[^:]{1,100}:[^@]{1,100}@/gi, description: 'MongoDB creds' },
  { pattern: /postgres(?:ql)?:\/\/[^:]{1,100}:[^@]{1,100}@/gi, description: 'PostgreSQL creds' },
];

/** Remediation suggestions by rule ID */
const REMEDIATIONS: Record<string, string> = {
  'CONST-FILE-001': 'Split into smaller modules',
  'CONST-FUNC-001': 'Refactor into smaller functions',
  'CONST-CLASS-001': 'Split class using composition',
  'PROHIB-007': 'Move secrets to environment variables',
  'DOC-001': 'Add JSDoc comments with @param and @returns',
  'CONST-PARAM-001': 'Use an options object instead',
};

type Violation = { name: string; lineNumber: number; length?: number; paramCount?: number };

/**
 * Constitution Validator - Validates code against constitution.xml rules
 * @example
 * const validator = new ConstitutionValidator();
 * const result = validator.validate(codeContent);
 */
export class ConstitutionValidator {
  private readonly maxLinesPerFile: number;
  private readonly maxLinesPerFunction: number;
  private readonly maxLinesPerClass: number;
  private readonly maxParameters: number;

  constructor(options?: {
    maxLinesPerFile?: number;
    maxLinesPerFunction?: number;
    maxLinesPerClass?: number;
    maxParameters?: number;
  }) {
    this.maxLinesPerFile = options?.maxLinesPerFile ?? CONSTITUTION_LIMITS.MAX_LINES_PER_FILE;
    this.maxLinesPerFunction = options?.maxLinesPerFunction ?? CONSTITUTION_LIMITS.MAX_LINES_PER_FUNCTION;
    this.maxLinesPerClass = options?.maxLinesPerClass ?? CONSTITUTION_LIMITS.MAX_LINES_PER_CLASS;
    this.maxParameters = options?.maxParameters ?? CONSTITUTION_LIMITS.MAX_PARAMETERS_PER_FUNCTION;
  }

  /** Validate file length against constitution limit */
  validateFileLength(content: string, maxLines?: number): IValidationResult {
    const limit = maxLines ?? this.maxLinesPerFile;
    const lineCount = content.split('\n').length;
    const passed = lineCount <= limit;
    return {
      passed, ruleId: 'CONST-FILE-001', ruleName: 'File Length Limit', severity: 'error',
      message: passed ? undefined : `File exceeds max: ${lineCount} lines (limit: ${limit})`,
      actualValue: lineCount, expectedValue: limit,
    };
  }

  /** Validate function lengths against constitution limit */
  validateFunctionLength(content: string): IValidationResult {
    const violations = this.findBraceBlockViolations(content, [
      /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+)?\s*=>/,
      /^\s*(?:public|private|protected|static|async|\s)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
    ], this.maxLinesPerFunction);

    return this.createBlockViolationResult(violations, 'CONST-FUNC-001', 'Function Length Limit',
      this.maxLinesPerFunction, 'function');
  }

  /** Validate class lengths against constitution limit */
  validateClassLength(content: string): IValidationResult {
    const violations = this.findBraceBlockViolations(content,
      [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/], this.maxLinesPerClass);
    return this.createBlockViolationResult(violations, 'CONST-CLASS-001', 'Class Length Limit',
      this.maxLinesPerClass, 'class');
  }

  private findBraceBlockViolations(content: string, patterns: RegExp[], maxLines: number): Violation[] {
    const lines = content.split('\n');
    const violations: Violation[] = [];
    let current: { name: string; startLine: number; braceCount: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!current) {
        for (const pattern of patterns) {
          const match = line.match(pattern);
          if (match) {
            current = {
              name: match[1] || 'anonymous', startLine: i + 1,
              braceCount: (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length,
            };
            break;
          }
        }
      } else {
        current.braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (current.braceCount <= 0) {
          const length = i - current.startLine + 1;
          if (length > maxLines) {
            violations.push({ name: current.name, lineNumber: current.startLine, length });
          }
          current = null;
        }
      }
    }
    return violations;
  }

  private createBlockViolationResult(
    violations: Violation[], ruleId: string, ruleName: string, limit: number, type: string
  ): IValidationResult {
    const passed = violations.length === 0;
    return {
      passed, ruleId, ruleName, severity: 'error',
      message: passed ? undefined : `${violations.length} ${type}(s) exceed max (${limit} lines): ` +
        violations.map(v => `${v.name} (${v.length} lines at L${v.lineNumber})`).join(', '),
      lineNumbers: violations.map(v => v.lineNumber),
      actualValue: violations.length > 0 ? Math.max(...violations.map(v => v.length!)) : 0,
      expectedValue: limit,
    };
  }

  /** Validate that no hardcoded secrets are present */
  validateNoSecrets(content: string): IValidationResult {
    const violations: Array<{ pattern: string; lineNumber: number }> = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

      for (const { pattern, description } of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.exec(line)) {
          violations.push({ pattern: description, lineNumber: i + 1 });
        }
      }
    }

    const passed = violations.length === 0;
    return {
      passed, ruleId: 'PROHIB-007', ruleName: 'No Hardcoded Secrets', severity: 'error',
      message: passed ? undefined : `${violations.length} secret(s) detected: ` +
        violations.map(v => `${v.pattern} at L${v.lineNumber}`).join(', '),
      lineNumbers: violations.map(v => v.lineNumber),
    };
  }

  /** Validate JSDoc presence for exported functions and classes */
  validateJSDocPresence(content: string): IValidationResult {
    const lines = content.split('\n');
    const violations: Array<{ type: string; name: string; lineNumber: number }> = [];
    const patterns = [
      { pattern: /^\s*export\s+(?:async\s+)?function\s+(\w+)/, type: 'function' },
      { pattern: /^\s*export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: 'function' },
      { pattern: /^\s*export\s+(?:abstract\s+)?class\s+(\w+)/, type: 'class' },
      { pattern: /^\s*export\s+interface\s+(\w+)/, type: 'interface' },
      { pattern: /^\s*export\s+type\s+(\w+)/, type: 'type' },
    ];

    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, type } of patterns) {
        const match = lines[i].match(pattern);
        if (match && !this.hasJSDocAbove(lines, i)) {
          violations.push({ type, name: match[1], lineNumber: i + 1 });
        }
      }
    }

    const passed = violations.length === 0;
    return {
      passed, ruleId: 'DOC-001', ruleName: 'JSDoc Required for Exports', severity: 'warning',
      message: passed ? undefined : `${violations.length} export(s) missing JSDoc: ` +
        violations.map(v => `${v.type} ${v.name} at L${v.lineNumber}`).join(', '),
      lineNumbers: violations.map(v => v.lineNumber),
    };
  }

  private hasJSDocAbove(lines: string[], index: number): boolean {
    for (let i = index - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line === '') continue;
      if (line.endsWith('*/')) {
        for (let j = i; j >= 0; j--) {
          if (lines[j].trim().startsWith('/**')) return true;
          if (!lines[j].trim().startsWith('*') && !lines[j].trim().endsWith('*/')) return false;
        }
      }
      return false;
    }
    return false;
  }

  /** Validate function parameter count */
  validateParameterCount(content: string): IValidationResult {
    const violations: Violation[] = [];
    const pattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?)\s*\(([^)]*)\)/g;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const name = match[1] || match[2] || 'anonymous';
      const paramCount = match[3].trim() ? match[3].split(',').filter(p => p.trim()).length : 0;

      if (paramCount > this.maxParameters) {
        const lineNumber = (content.substring(0, match.index).match(/\n/g) || []).length + 1;
        violations.push({ name, lineNumber, paramCount });
      }
    }

    const passed = violations.length === 0;
    return {
      passed, ruleId: 'CONST-PARAM-001', ruleName: 'Function Parameter Limit', severity: 'warning',
      message: passed ? undefined : `${violations.length} function(s) exceed param limit (${this.maxParameters}): ` +
        violations.map(v => `${v.name} (${v.paramCount} params at L${v.lineNumber})`).join(', '),
      lineNumbers: violations.map(v => v.lineNumber),
      actualValue: violations.length > 0 ? Math.max(...violations.map(v => v.paramCount!)) : 0,
      expectedValue: this.maxParameters,
    };
  }

  /** Run all constitution validations */
  validate(content: string, filePath?: string): IConstitutionValidationResult {
    const validations: IValidationResult[] = [
      this.validateFileLength(content),
      this.validateFunctionLength(content),
      this.validateClassLength(content),
      this.validateNoSecrets(content),
      this.validateJSDocPresence(content),
      this.validateParameterCount(content),
    ];

    const errors = validations.filter(v => !v.passed && v.severity === 'error');
    const warnings = validations.filter(v => !v.passed && v.severity === 'warning');
    const passed = errors.length === 0;

    const evidence: ISherlockEvidence[] = validations.filter(v => !v.passed).map(v => ({
      type: 'constitution_violation', filePath,
      lineRange: v.lineNumbers?.length
        ? { start: Math.min(...v.lineNumbers), end: Math.max(...v.lineNumbers) }
        : undefined,
      description: v.message || `Rule ${v.ruleId} violated`,
      data: { ruleId: v.ruleId, ruleName: v.ruleName, actualValue: v.actualValue, expectedValue: v.expectedValue },
    }));

    const issues: ISherlockIssue[] = validations.filter(v => !v.passed).map(v => ({
      severity: v.severity === 'error' ? 'high' : 'medium',
      category: 'constitution',
      description: v.message || `Rule ${v.ruleId} violated`,
      filePath, remediation: REMEDIATIONS[v.ruleId] || 'Review constitution.xml',
    }));

    const verdict: SherlockVerdict = passed ? SherlockVerdict.INNOCENT
      : errors.length > 0 ? SherlockVerdict.GUILTY : SherlockVerdict.INSUFFICIENT_EVIDENCE;

    return {
      passed, validations, errorCount: errors.length, warningCount: warnings.length,
      verdict, confidence: validations.length >= 5 ? 'HIGH' : 'MEDIUM',
      evidence, issues, timestamp: new Date().toISOString(), filePath,
    };
  }

  /** Quick check if content passes all critical validations */
  quickCheck(content: string): boolean {
    return this.validate(content).passed;
  }

  /** Get a formatted report of validation results */
  getReport(result: IConstitutionValidationResult): string {
    if (result.passed) {
      return `CONSTITUTION VALIDATION PASSED\n  All ${result.validations.length} checks passed\n\n` +
        `Sherlock Verdict: ${result.verdict} (${result.confidence} confidence)`;
    }

    const failures = result.validations.filter(v => !v.passed);
    return `CONSTITUTION VALIDATION FAILED\n  Errors: ${result.errorCount}\n  Warnings: ${result.warningCount}\n\n` +
      `Violations:\n` + failures.map(v => {
        const icon = v.severity === 'error' ? '[ERROR]' : '[WARN]';
        return `  ${icon} ${v.ruleName} (${v.ruleId})\n         ${v.message}\n         Fix: ${REMEDIATIONS[v.ruleId]}`;
      }).join('\n') + `\n\nSherlock Verdict: ${result.verdict} (${result.confidence} confidence)`;
  }
}

/** Create a ConstitutionValidator with default settings */
export function createConstitutionValidator(): ConstitutionValidator {
  return new ConstitutionValidator();
}

/** Create a ConstitutionValidator with custom limits */
export function createCustomConstitutionValidator(options: {
  maxLinesPerFile?: number;
  maxLinesPerFunction?: number;
  maxLinesPerClass?: number;
  maxParameters?: number;
}): ConstitutionValidator {
  return new ConstitutionValidator(options);
}
