/**
 * Shadow Vector Utilities
 * TASK-SHA-001 - Contradiction Detection Helpers
 *
 * Provides utility functions for:
 * - Vector inversion (shadow creation)
 * - Similarity calculations
 * - Classification logic
 * - Credibility scoring
 */

import type {
  ValidationVerdict,
  EvidenceType,
  IClassificationThresholds,
  IShadowSearchResult,
} from './shadow-types.js';
import { DEFAULT_CLASSIFICATION_THRESHOLDS } from './shadow-types.js';

// ==================== Vector Operations ====================

/**
 * Create a shadow vector by inverting all components
 * Shadow(v) = v × -1
 *
 * Property: cosine(v, x) = -cosine(Shadow(v), x)
 *
 * @param vector - Original vector (1536-dim VECTOR_DIM, L2-normalized)
 * @returns Inverted shadow vector
 */
export function createShadowVector(vector: Float32Array): Float32Array {
  const shadow = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    shadow[i] = -vector[i];
  }
  return shadow;
}

/**
 * Calculate cosine similarity between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity [-1, 1]
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Verify a vector is L2-normalized
 *
 * @param vector - Vector to check
 * @param tolerance - Acceptable deviation from 1.0 (default 0.001)
 * @returns True if normalized
 */
export function isL2Normalized(vector: Float32Array, tolerance: number = 0.001): boolean {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);
  return Math.abs(norm - 1.0) <= tolerance;
}

/**
 * L2-normalize a vector
 *
 * @param vector - Vector to normalize
 * @returns L2-normalized vector
 */
export function normalizeL2(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);

  if (norm === 0) {
    return new Float32Array(vector.length); // Return zero vector
  }

  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }
  return normalized;
}

// ==================== Classification Logic ====================

/**
 * Classify a document based on hypothesis and shadow similarities
 *
 * Classification Matrix:
 * | Hypothesis Similarity | Shadow Similarity | Classification |
 * |----------------------|-------------------|----------------|
 * | > 0.7                | > 0.7             | AMBIGUOUS      |
 * | < Shadow             | > 0.7             | CONTESTED      |
 * | 0.5-0.7              | 0.5-0.7           | DEBATED        |
 * | < 0.3                | > 0.7             | FALSIFIED      |
 * | > 0.7                | < 0.3             | SUPPORTED      |
 * | otherwise            |                   | UNCERTAIN      |
 *
 * @param hypothesisSimilarity - Similarity to original hypothesis
 * @param shadowSimilarity - Similarity to shadow vector
 * @param thresholds - Classification thresholds
 * @returns Classification verdict
 */
export function classifyDocument(
  hypothesisSimilarity: number,
  shadowSimilarity: number,
  thresholds: IClassificationThresholds = DEFAULT_CLASSIFICATION_THRESHOLDS
): ValidationVerdict {
  const { high, medium, low } = thresholds;

  // Both high: Document is ambiguous (supports both sides)
  if (hypothesisSimilarity > high && shadowSimilarity > high) {
    return 'AMBIGUOUS';
  }

  // Strong support for contradiction
  if (hypothesisSimilarity < low && shadowSimilarity > high) {
    return 'FALSIFIED';
  }

  // Shadow stronger than hypothesis with high shadow
  if (shadowSimilarity > hypothesisSimilarity && shadowSimilarity > high) {
    return 'CONTESTED';
  }

  // Both in medium range: debated topic
  if (
    hypothesisSimilarity >= medium &&
    hypothesisSimilarity <= high &&
    shadowSimilarity >= medium &&
    shadowSimilarity <= high
  ) {
    return 'DEBATED';
  }

  // Strong support for hypothesis
  if (hypothesisSimilarity > high && shadowSimilarity < low) {
    return 'SUPPORTED';
  }

  // Moderate support
  if (hypothesisSimilarity > medium && shadowSimilarity < medium) {
    return 'SUPPORTED';
  }

  // Moderate contradiction
  if (shadowSimilarity > medium && hypothesisSimilarity < medium) {
    return 'REFUTED';
  }

  // Default: uncertain
  return 'UNCERTAIN';
}

/**
 * Determine evidence type based on classification and strength
 *
 * @param classification - Document classification
 * @param refutationStrength - Strength of refutation
 * @returns Evidence type
 */
export function determineEvidenceType(
  classification: ValidationVerdict,
  refutationStrength: number
): EvidenceType {
  if (classification === 'FALSIFIED' && refutationStrength > 0.85) {
    return 'direct_refutation';
  }

  if (classification === 'CONTESTED') {
    return refutationStrength > 0.75 ? 'counterexample' : 'alternative_explanation';
  }

  if (classification === 'DEBATED') {
    return 'partial_contradiction';
  }

  if (refutationStrength > 0.8) {
    return 'direct_refutation';
  }

  if (refutationStrength > 0.6) {
    return 'counterexample';
  }

  return 'partial_contradiction';
}

// ==================== Credibility Scoring ====================

/**
 * Calculate credibility score based on support vs contradiction balance
 *
 * Formula:
 * credibility = (supportSum - contradictionSum) / (supportSum + contradictionSum + epsilon)
 * Normalized to [0, 1] range
 *
 * @param supportStrengths - Array of support strengths
 * @param refutationStrengths - Array of refutation strengths
 * @returns Credibility score [0, 1]
 */
export function calculateCredibility(
  supportStrengths: number[],
  refutationStrengths: number[]
): number {
  const epsilon = 0.001; // Prevent division by zero

  const supportSum = supportStrengths.reduce((sum, s) => sum + s, 0);
  const refutationSum = refutationStrengths.reduce((sum, r) => sum + r, 0);

  // No evidence at all
  if (supportSum === 0 && refutationSum === 0) {
    return 0.5; // Neutral
  }

  // Calculate raw balance [-1, 1]
  const rawBalance = (supportSum - refutationSum) / (supportSum + refutationSum + epsilon);

  // Normalize to [0, 1]
  return (rawBalance + 1) / 2;
}

/**
 * Determine final verdict based on credibility and evidence
 *
 * @param credibility - Credibility score [0, 1]
 * @param supportCount - Number of supporting evidence
 * @param contradictionCount - Number of contradicting evidence
 * @returns Final verdict
 */
export function determineVerdict(
  credibility: number,
  supportCount: number,
  contradictionCount: number
): ValidationVerdict {
  // No evidence
  if (supportCount === 0 && contradictionCount === 0) {
    return 'UNCERTAIN';
  }

  // Strong support
  if (credibility >= 0.7 && contradictionCount === 0) {
    return 'SUPPORTED';
  }

  // Strong contradiction
  if (credibility <= 0.3 && supportCount === 0) {
    return 'REFUTED';
  }

  // Mixed evidence with strong contradiction
  if (credibility < 0.3) {
    return contradictionCount > supportCount ? 'CONTESTED' : 'REFUTED';
  }

  // Mixed evidence with strong support
  if (credibility > 0.7) {
    return 'SUPPORTED';
  }

  // Balanced evidence
  if (credibility >= 0.4 && credibility <= 0.6) {
    return 'DEBATED';
  }

  // Leaning toward support
  if (credibility > 0.5) {
    return 'SUPPORTED';
  }

  // Leaning toward contradiction
  return 'CONTESTED';
}

/**
 * Calculate confidence in the verdict
 *
 * Higher confidence when:
 * - More evidence available
 * - Evidence is consistent (one-sided)
 * - Individual evidence strengths are high
 *
 * @param supportStrengths - Support evidence strengths
 * @param refutationStrengths - Refutation evidence strengths
 * @returns Confidence score [0, 1]
 */
export function calculateVerdictConfidence(
  supportStrengths: number[],
  refutationStrengths: number[]
): number {
  const totalEvidence = supportStrengths.length + refutationStrengths.length;

  // No evidence = low confidence
  if (totalEvidence === 0) {
    return 0.1;
  }

  // Calculate average strength
  const allStrengths = [...supportStrengths, ...refutationStrengths];
  const avgStrength = allStrengths.reduce((sum, s) => sum + s, 0) / allStrengths.length;

  // Calculate consistency (how one-sided the evidence is)
  const supportSum = supportStrengths.reduce((sum, s) => sum + s, 0);
  const refutationSum = refutationStrengths.reduce((sum, r) => sum + r, 0);
  const total = supportSum + refutationSum;
  const consistency = total > 0 ? Math.abs(supportSum - refutationSum) / total : 0;

  // Evidence quantity factor (more evidence = higher confidence, diminishing returns)
  const quantityFactor = Math.min(1, Math.sqrt(totalEvidence / 10));

  // Combine factors
  const confidence = (avgStrength * 0.4) + (consistency * 0.3) + (quantityFactor * 0.3);

  return Math.min(1, Math.max(0, confidence));
}

// ==================== Result Processing ====================

/**
 * Calculate refutation strength from similarity scores
 *
 * Refutation strength is high when:
 * - Shadow similarity is high
 * - Hypothesis similarity is low
 *
 * @param hypothesisSimilarity - Similarity to hypothesis
 * @param shadowSimilarity - Similarity to shadow vector
 * @returns Refutation strength [0, 1]
 */
export function calculateRefutationStrength(
  hypothesisSimilarity: number,
  shadowSimilarity: number
): number {
  // Base refutation is the shadow similarity
  const baseRefutation = Math.max(0, shadowSimilarity);

  // Boost refutation when hypothesis similarity is low
  const hypothesisPenalty = Math.max(0, 1 - hypothesisSimilarity);

  // Combined score with weighting
  const refutation = (baseRefutation * 0.7) + (hypothesisPenalty * 0.3);

  return Math.min(1, Math.max(0, refutation));
}

/**
 * Sort search results by refutation strength
 *
 * @param results - Search results to sort
 * @returns Sorted results (highest refutation first)
 */
export function sortByRefutationStrength(results: IShadowSearchResult[]): IShadowSearchResult[] {
  return [...results].sort((a, b) => {
    const strengthA = calculateRefutationStrength(a.hypothesisSimilarity, a.shadowSimilarity);
    const strengthB = calculateRefutationStrength(b.hypothesisSimilarity, b.shadowSimilarity);
    return strengthB - strengthA;
  });
}

/**
 * Filter results by threshold
 *
 * @param results - Search results to filter
 * @param threshold - Minimum refutation strength
 * @returns Filtered results
 */
export function filterByThreshold(
  results: IShadowSearchResult[],
  threshold: number
): IShadowSearchResult[] {
  return results.filter(result => {
    const strength = calculateRefutationStrength(result.hypothesisSimilarity, result.shadowSimilarity);
    return strength >= threshold;
  });
}
