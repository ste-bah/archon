/**
 * Coding Quality Gate Zod Schemas
 *
 * Zod validation schemas for the L-Score quality gate system.
 * Provides runtime input validation per constitution TS-004.
 *
 * @module src/god-agent/core/pipeline/coding-quality-gate-schemas
 * @see docs/coding-pipeline/quality-gate-system.md
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS (TS-004 compliance)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for L-Score component values (0.0 - 1.0).
 */
export const LScoreValueSchema = z.number()
  .min(0, 'L-Score component must be >= 0')
  .max(1, 'L-Score component must be <= 1');

/**
 * Schema for validating L-Score breakdown input.
 */
export const LScoreBreakdownSchema = z.object({
  accuracy: LScoreValueSchema.describe('Code correctness and requirement alignment'),
  completeness: LScoreValueSchema.describe('Feature coverage and implementation depth'),
  maintainability: LScoreValueSchema.describe('Code quality, readability, and documentation'),
  security: LScoreValueSchema.describe('Security posture and vulnerability absence'),
  performance: LScoreValueSchema.describe('Efficiency and resource utilization'),
  testCoverage: LScoreValueSchema.describe('Test coverage and assertion quality'),
  composite: LScoreValueSchema.describe('Weighted average composite score'),
});

/**
 * Schema for validating gate validation context.
 */
export const GateValidationContextSchema = z.object({
  remediationAttempts: z.number().int().min(0).describe('Number of remediation attempts'),
  activeEmergency: z.object({
    id: z.string().describe('Unique event ID'),
    trigger: z.string().describe('Emergency trigger type'),
    timestamp: z.date().describe('Event timestamp'),
    context: z.record(z.unknown()).optional().describe('Additional context'),
  }).optional().describe('Active emergency event'),
  previousValidations: z.array(z.any()).optional().describe('Previous validation results'),
});

/**
 * Schema for validating gate ID.
 */
export const GateIdSchema = z.string()
  .min(1, 'Gate ID must not be empty')
  .describe('Gate identifier (e.g., GATE-01-UNDERSTANDING)');
