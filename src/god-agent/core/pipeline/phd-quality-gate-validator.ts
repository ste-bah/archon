/**
 * Quality Gate Validator
 * TASK-BRG-001 - Validates agent outputs against quality gates
 *
 * Provides validation of agent execution results against
 * defined quality criteria including citations, completeness,
 * and format requirements.
 */

import type { IAgentDefinition, IAgentResult } from '../orchestration/orchestration-types.js';

// ==================== Types ====================

/**
 * Individual quality check result
 */
export interface IQualityCheck {
  /** Check name/description */
  name: string;
  /** Whether check passed */
  passed: boolean;
  /** Failure reason (if not passed) */
  reason?: string;
  /** Extracted value (if applicable) */
  value?: string | number;
  /** Expected value (if applicable) */
  expected?: string | number;
}

/**
 * Complete quality gate validation result
 */
export interface IQualityValidationResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Individual check results */
  checks: IQualityCheck[];
  /** Summary score (0-1) */
  score: number;
  /** Timestamp of validation */
  validatedAt: number;
  /** Agent that was validated */
  agentName: string;
  /** Quality gate string that was parsed */
  qualityGate: string;
}

/**
 * Quality gate rule definition
 */
export interface IQualityRule {
  /** Pattern to match in quality gate string */
  pattern: RegExp;
  /** Validation function */
  validate: (output: string, match: RegExpMatchArray) => IQualityCheck;
}

// ==================== Default Quality Rules ====================

/**
 * Built-in quality validation rules
 */
export const DEFAULT_QUALITY_RULES: IQualityRule[] = [
  // Citation count check: "Must cite 15+ sources"
  {
    pattern: /Must cite (\d+)\+? (?:academic )?sources?/i,
    validate: (output: string, match: RegExpMatchArray): IQualityCheck => {
      const required = parseInt(match[1], 10);
      const citationPatterns = [
        /\[\d+\]/g,                           // [1], [2], etc.
        /\([A-Z][a-z]+,?\s*\d{4}\)/g,        // (Author, 2024)
        /[A-Z][a-z]+\s+et\s+al\.\s*\(\d{4}\)/g,  // Author et al. (2024)
        /https?:\/\/[^\s)]+/g,               // URLs
      ];

      let count = 0;
      for (const pattern of citationPatterns) {
        const matches = output.match(pattern);
        if (matches) count += matches.length;
      }

      // Deduplicate (rough estimate)
      const uniqueCount = Math.ceil(count * 0.7);

      return {
        name: 'Citation Count',
        passed: uniqueCount >= required,
        value: uniqueCount,
        expected: required,
        reason: uniqueCount < required
          ? `Found ${uniqueCount} citations, need ${required}`
          : undefined,
      };
    },
  },

  // Output requirement: "Must produce X"
  {
    pattern: /Must produce ([a-z_]+)/gi,
    validate: (output: string, match: RegExpMatchArray): IQualityCheck => {
      const required = match[1];
      const outputLower = output.toLowerCase();
      const requiredLower = required.toLowerCase().replace(/_/g, ' ');

      // Check for presence of the required output type
      const found = outputLower.includes(requiredLower) ||
                   outputLower.includes(required.replace(/_/g, '-'));

      return {
        name: `Output: ${required}`,
        passed: found,
        reason: !found ? `Missing required output: ${required}` : undefined,
      };
    },
  },

  // Minimum length check: "Minimum X words"
  {
    pattern: /Minimum (\d+) words?/i,
    validate: (output: string, match: RegExpMatchArray): IQualityCheck => {
      const required = parseInt(match[1], 10);
      const wordCount = output.split(/\s+/).filter(w => w.length > 0).length;

      return {
        name: 'Minimum Words',
        passed: wordCount >= required,
        value: wordCount,
        expected: required,
        reason: wordCount < required
          ? `Found ${wordCount} words, need ${required}`
          : undefined,
      };
    },
  },

  // Section check: "Must include X section"
  {
    pattern: /Must include ([a-z]+) section/gi,
    validate: (output: string, match: RegExpMatchArray): IQualityCheck => {
      const section = match[1];
      const sectionPatterns = [
        new RegExp(`^#{1,3}\\s*${section}`, 'mi'),  // Markdown header
        new RegExp(`<h[1-6]>${section}`, 'i'),       // HTML header
        new RegExp(`\\*\\*${section}\\*\\*`, 'i'),   // Bold text
        new RegExp(`^${section}:`, 'mi'),            // Label style
      ];

      const found = sectionPatterns.some(p => p.test(output));

      return {
        name: `Section: ${section}`,
        passed: found,
        reason: !found ? `Missing section: ${section}` : undefined,
      };
    },
  },

  // Format check: "Must follow X format"
  {
    pattern: /Must follow (APA|IEEE|academic|markdown) (?:format|style|standards)/i,
    validate: (output: string, match: RegExpMatchArray): IQualityCheck => {
      const format = match[1].toLowerCase();
      let passed = false;
      let reason: string | undefined;

      switch (format) {
        case 'apa':
          // Check for APA-style citations
          passed = /\([A-Z][a-z]+,?\s*\d{4}\)/.test(output) ||
                  /[A-Z][a-z]+\s+\(\d{4}\)/.test(output);
          reason = !passed ? 'No APA-style citations found' : undefined;
          break;
        case 'ieee':
          // Check for IEEE-style citations [1], [2]
          passed = /\[\d+\]/.test(output);
          reason = !passed ? 'No IEEE-style citations found' : undefined;
          break;
        case 'academic':
          // General academic writing checks
          passed = output.length > 500 &&
                  /abstract|introduction|conclusion|methodology/i.test(output);
          reason = !passed ? 'Does not appear to follow academic structure' : undefined;
          break;
        case 'markdown':
          // Check for markdown formatting
          passed = /^#{1,6}\s+/m.test(output) || /\*\*.*\*\*/.test(output);
          reason = !passed ? 'No markdown formatting detected' : undefined;
          break;
        default:
          passed = true;
      }

      return {
        name: `Format: ${format}`,
        passed,
        reason,
      };
    },
  },

  // Evidence check: "Must provide evidence"
  {
    pattern: /Must provide (?:evidence|evidence-based|supporting)/i,
    validate: (output: string, _match: RegExpMatchArray): IQualityCheck => {
      const evidenceIndicators = [
        /according to/i,
        /research shows/i,
        /studies indicate/i,
        /data suggests/i,
        /evidence demonstrates/i,
        /\(\d{4}\)/,  // Year citations
        /Figure \d+/i,
        /Table \d+/i,
      ];

      const found = evidenceIndicators.some(p => p.test(output));

      return {
        name: 'Evidence Present',
        passed: found,
        reason: !found ? 'No evidence indicators found' : undefined,
      };
    },
  },

  // Timeout check is handled separately
];

// ==================== Quality Gate Validator ====================

/**
 * Quality Gate Validator
 *
 * Parses quality gate strings and validates agent output against them.
 */
export class QualityGateValidator {
  private rules: IQualityRule[];

  constructor(customRules: IQualityRule[] = []) {
    this.rules = [...DEFAULT_QUALITY_RULES, ...customRules];
  }

  /**
   * Validate agent output against quality gate
   */
  validate(
    output: string,
    agent: IAgentDefinition,
    result?: IAgentResult
  ): IQualityValidationResult {
    const checks: IQualityCheck[] = [];
    const qualityGate = agent.qualityGate;

    // Parse and validate each rule
    for (const rule of this.rules) {
      const matches = qualityGate.matchAll(new RegExp(rule.pattern.source, 'gi'));
      for (const match of matches) {
        const check = rule.validate(output, match);
        checks.push(check);
      }
    }

    // Add timeout check if we have result timing
    if (result?.duration !== undefined) {
      const timeoutMatch = qualityGate.match(/within (\d+)s/i);
      if (timeoutMatch) {
        const timeoutMs = parseInt(timeoutMatch[1], 10) * 1000;
        checks.push({
          name: 'Timeout',
          passed: result.duration <= timeoutMs,
          value: result.duration,
          expected: timeoutMs,
          reason: result.duration > timeoutMs
            ? `Took ${result.duration}ms, limit was ${timeoutMs}ms`
            : undefined,
        });
      }
    }

    // Calculate score
    const passedCount = checks.filter(c => c.passed).length;
    const score = checks.length > 0 ? passedCount / checks.length : 1;

    return {
      passed: checks.every(c => c.passed),
      checks,
      score,
      validatedAt: Date.now(),
      agentName: agent.agentName,
      qualityGate,
    };
  }

  /**
   * Quick check if output passes quality gate
   */
  quickCheck(output: string, agent: IAgentDefinition): boolean {
    return this.validate(output, agent).passed;
  }

  /**
   * Get detailed failure report
   */
  getFailureReport(result: IQualityValidationResult): string {
    if (result.passed) {
      return `✓ All quality checks passed for ${result.agentName}`;
    }

    const failures = result.checks.filter(c => !c.passed);
    const lines = [
      `✗ Quality gate failed for ${result.agentName}`,
      `  Score: ${(result.score * 100).toFixed(1)}%`,
      `  Failed checks:`,
    ];

    for (const check of failures) {
      lines.push(`    - ${check.name}: ${check.reason}`);
      if (check.value !== undefined && check.expected !== undefined) {
        lines.push(`      (got: ${check.value}, expected: ${check.expected})`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Add custom validation rule
   */
  addRule(rule: IQualityRule): void {
    this.rules.push(rule);
  }

  /**
   * Parse quality gate string into individual requirements
   */
  parseQualityGate(qualityGate: string): string[] {
    return qualityGate
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
}

// ==================== Factory ====================

/**
 * Create a quality gate validator with PhD-specific rules
 */
export function createPhDQualityGateValidator(): QualityGateValidator {
  const phdRules: IQualityRule[] = [
    // Reproducibility check
    {
      pattern: /reproducibility confirmed/i,
      validate: (output: string): IQualityCheck => {
        const indicators = [
          /step[- ]by[- ]step/i,
          /replication/i,
          /reproduce/i,
          /methodology/i,
          /procedure/i,
        ];
        const found = indicators.some(p => p.test(output));
        return {
          name: 'Reproducibility',
          passed: found,
          reason: !found ? 'No reproducibility indicators found' : undefined,
        };
      },
    },

    // Methodology section
    {
      pattern: /methodology/i,
      validate: (output: string): IQualityCheck => {
        const found = /methodology|method|approach|procedure/i.test(output);
        return {
          name: 'Methodology',
          passed: found,
          reason: !found ? 'No methodology section detected' : undefined,
        };
      },
    },
  ];

  return new QualityGateValidator(phdRules);
}

// DEFAULT_QUALITY_RULES is already exported at declaration
