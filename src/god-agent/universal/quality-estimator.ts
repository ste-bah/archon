/**
 * Quality Estimator for God Agent Auto-Feedback
 *
 * Estimates interaction quality based on output characteristics
 * to enable automatic feedback without explicit user input.
 *
 * Part of PRD FR-11 (Sona Engine) implementation.
 */

import type { AgentMode } from './universal-agent.js';

/**
 * Interaction data used for quality estimation
 */
export interface QualityInteraction {
  id: string;
  mode: AgentMode;
  input: string;
  output: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Detailed quality assessment result
 */
export interface QualityAssessment {
  /** Overall quality score 0-1 */
  score: number;
  /** Individual factor scores */
  factors: {
    length: number;
    structure: number;
    codeContent: number;
    modeRelevance: number;
    /** TASK-FIX-008: Bonus for Task() result patterns */
    taskResultBonus: number;
  };
  /** Whether this meets auto-store threshold (feedback threshold) */
  meetsThreshold: boolean;
  /** Whether this qualifies for auto-pattern creation (RULE-035: >= 0.7) */
  qualifiesForPattern: boolean;
}

/**
 * Estimate quality of an interaction based on output characteristics.
 *
 * Quality factors:
 * - Length: Longer, more detailed responses score higher
 * - Code blocks: Technical content with code examples
 * - Structure: Lists, headers, organized content
 * - Mode relevance: Mode-specific quality indicators
 *
 * @param interaction - The interaction to assess
 * @param threshold - Auto-store threshold (default 0.5 per RULE-035)
 * @returns Quality score between 0 and 1
 */
export function estimateQuality(
  interaction: QualityInteraction,
  threshold: number = 0.5
): number {
  const assessment = assessQuality(interaction, threshold);
  return assessment.score;
}

/**
 * Perform detailed quality assessment with factor breakdown.
 *
 * @param interaction - The interaction to assess
 * @param threshold - Auto-store/feedback threshold (default 0.5 per RULE-035)
 * @returns Detailed quality assessment
 */
export function assessQuality(
  interaction: QualityInteraction,
  threshold: number = 0.5
): QualityAssessment {
  const output = interaction.output;
  const mode = interaction.mode;

  // Factor 1: Length scoring (0-0.25)
  let lengthScore = 0;
  if (output.length > 200) lengthScore += 0.05;
  if (output.length > 500) lengthScore += 0.05;
  if (output.length > 1000) lengthScore += 0.05;
  if (output.length > 2000) lengthScore += 0.05;
  if (output.length > 4000) lengthScore += 0.05;
  lengthScore = Math.min(lengthScore, 0.25);

  // Factor 2: Code content scoring (0-0.25)
  let codeScore = 0;
  const codeBlocks = (output.match(/```/g) || []).length / 2;
  if (codeBlocks >= 1) codeScore += 0.1;
  if (codeBlocks >= 2) codeScore += 0.05;
  if (codeBlocks >= 3) codeScore += 0.05;
  if (codeBlocks >= 5) codeScore += 0.05;
  codeScore = Math.min(codeScore, 0.25);

  // Factor 3: Structure scoring (0-0.25)
  let structureScore = 0;
  // Check for bullet lists
  if (output.includes('\n- ') || output.includes('\n* ')) structureScore += 0.05;
  // Check for numbered lists
  if (/\n\d+\.\s/.test(output)) structureScore += 0.05;
  // Check for headers
  if (output.includes('\n## ') || output.includes('\n### ')) structureScore += 0.05;
  // Check for paragraphs (multiple newlines)
  if ((output.match(/\n\n/g) || []).length >= 3) structureScore += 0.05;
  // Check for inline code
  if ((output.match(/`[^`]+`/g) || []).length >= 3) structureScore += 0.05;
  structureScore = Math.min(structureScore, 0.25);

  // Factor 4: Mode relevance scoring (0-0.25)
  let modeScore = 0.1; // Base score for any response

  switch (mode) {
    case 'code':
      // Code mode: prioritize code blocks and technical content
      if (codeBlocks >= 1) modeScore += 0.1;
      if (codeBlocks >= 2) modeScore += 0.05;
      // Check for function/class definitions
      if (/\b(function|class|const|let|var|def|async)\b/.test(output)) modeScore += 0.05;
      break;

    case 'research':
      // Research mode: prioritize length and structure
      if (output.length > 2000) modeScore += 0.1;
      if (structureScore >= 0.15) modeScore += 0.05;
      // Check for citations or references
      if (/\[\d+\]|source|reference|according to/i.test(output)) modeScore += 0.05;
      break;

    case 'write':
      // Write mode: prioritize length and coherent structure
      if (output.length > 1500) modeScore += 0.1;
      if ((output.match(/\n\n/g) || []).length >= 5) modeScore += 0.05;
      // Check for natural prose flow
      if (output.split('.').length >= 10) modeScore += 0.05;
      break;

    case 'general':
    default:
      // General mode: balanced scoring
      if (output.length > 300) modeScore += 0.05;
      if (structureScore >= 0.1 || codeScore >= 0.1) modeScore += 0.05;
      break;
  }
  modeScore = Math.min(modeScore, 0.25);

  // Factor 5: Task Result Pattern Bonus (0-0.35)
  // TASK-FIX-008: Detect well-structured Task() output patterns
  // Per RULE-033: Quality MUST be assessed on Task() RESULT, not prompt
  let taskResultBonus = 0;

  // Check for TASK COMPLETION SUMMARY format (primary indicator)
  if (/TASK COMPLETION SUMMARY/i.test(output) || /##\s*TASK COMPLETION/i.test(output)) {
    taskResultBonus += 0.15;
  }

  // Check for "What I Did" section (common in Task results)
  if (/\*\*What I Did\*\*|\bWhat I Did:/i.test(output)) {
    taskResultBonus += 0.05;
  }

  // Check for "Files Created/Modified" section
  if (/Files Created|Files Modified|Files Changed/i.test(output)) {
    taskResultBonus += 0.05;
  }

  // Check for "Next Agent Guidance" (handoff pattern)
  if (/Next Agent|Ready for.*stage|Handoff/i.test(output)) {
    taskResultBonus += 0.05;
  }

  // Check for quality indicators section
  if (/Quality Indicator|Quality Score|Code Quality/i.test(output)) {
    taskResultBonus += 0.05;
  }

  taskResultBonus = Math.min(taskResultBonus, 0.35);

  // Calculate total score with recalibrated weights
  // TASK-FIX-008: High-quality Task() output should score 0.6-0.8
  const totalScore = Math.min(
    lengthScore + codeScore + structureScore + modeScore + taskResultBonus,
    1.0
  );

  // RULE-035: Pattern threshold is 0.7 (not 0.8)
  const PATTERN_THRESHOLD = 0.7;

  return {
    score: totalScore,
    factors: {
      length: lengthScore,
      structure: structureScore,
      codeContent: codeScore,
      modeRelevance: modeScore,
      taskResultBonus,
    },
    meetsThreshold: totalScore >= threshold,
    qualifiesForPattern: totalScore >= PATTERN_THRESHOLD,
  };
}

/**
 * Determine verdict based on quality score.
 * Maps to ReasoningBank feedback verdict types.
 *
 * @param quality - Quality score 0-1
 * @returns Verdict string for feedback
 */
export function qualityToVerdict(quality: number): 'correct' | 'neutral' | 'incorrect' {
  if (quality >= 0.7) return 'correct';
  if (quality >= 0.4) return 'neutral';
  return 'incorrect';
}

/**
 * Calculate L-score (learning potential) from quality and novelty.
 * Used by SonaEngine for weight updates.
 *
 * @param quality - Quality score 0-1
 * @param novelty - Novelty score 0-1 (how different from existing patterns)
 * @returns L-score for learning weight calculation
 */
export function calculateLScore(quality: number, novelty: number = 0.5): number {
  // L-score combines quality with novelty
  // High quality + high novelty = high learning potential
  // High quality + low novelty = refinement of existing patterns
  // Low quality = minimal learning
  return quality * (0.7 + 0.3 * novelty);
}
