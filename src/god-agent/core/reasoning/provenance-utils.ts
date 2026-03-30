/**
 * Provenance Utilities
 * TASK-PRV-001 - ID Generation and Validation
 *
 * Provides utility functions for source and provenance management.
 */

import { randomBytes } from 'crypto';
import type {
  SourceID,
  ProvenanceID,
  ISourceInput,
  IProvenanceInput,
  IDerivationStep,
  ILScoreResult,
  ILScoreThreshold,
  OperationType,
  SourceType,
} from './provenance-types.js';
import { ProvenanceValidationError } from './provenance-types.js';

// ==================== Constants ====================

/** Valid source types */
const VALID_SOURCE_TYPES: SourceType[] = [
  'document',
  'conversation',
  'experiment',
  'simulation',
  'external-api',
];

/** Valid operation types */
const VALID_OPERATION_TYPES: OperationType[] = [
  'extraction',
  'synthesis',
  'inference',
  'transformation',
];

/** Default L-Score threshold */
export const DEFAULT_LSCORE_THRESHOLD = 0.3;

/** Domain-specific L-Score thresholds */
export const DOMAIN_THRESHOLDS: ILScoreThreshold[] = [
  { domain: 'factual-retrieval', threshold: 0.40, falsePositiveRate: 0.021, falseNegativeRate: 0.083 },
  { domain: 'code-generation', threshold: 0.30, falsePositiveRate: 0.054, falseNegativeRate: 0.047 },
  { domain: 'research-synthesis', threshold: 0.25, falsePositiveRate: 0.092, falseNegativeRate: 0.018 },
  { domain: 'debugging', threshold: 0.35, falsePositiveRate: 0.038, falseNegativeRate: 0.061 },
];

// ==================== ID Generation ====================

/**
 * Generate a unique SourceID
 * Format: "src_{timestamp}_{random8hex}"
 */
export function generateSourceID(): SourceID {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `src_${timestamp}_${random}`;
}

/**
 * Generate a unique ProvenanceID
 * Format: "prov_{timestamp}_{random8hex}"
 */
export function generateProvenanceID(): ProvenanceID {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `prov_${timestamp}_${random}`;
}

/**
 * Validate SourceID format
 */
export function isValidSourceID(id: string): boolean {
  return /^src_\d+_[a-f0-9]{8}$/.test(id);
}

/**
 * Validate ProvenanceID format
 */
export function isValidProvenanceID(id: string): boolean {
  return /^prov_\d+_[a-f0-9]{8}$/.test(id);
}

// ==================== Input Validation ====================

/**
 * Validate source input
 * @throws ProvenanceValidationError if validation fails
 */
export function validateSourceInput(input: ISourceInput): void {
  // Validate type
  if (!input.type) {
    throw new ProvenanceValidationError('Source type required');
  }
  if (!VALID_SOURCE_TYPES.includes(input.type)) {
    throw new ProvenanceValidationError(`Invalid source type: ${input.type}`);
  }

  // Validate title
  if (!input.title || input.title.trim().length === 0) {
    throw new ProvenanceValidationError('Source title required');
  }

  // Validate relevanceScore
  if (input.relevanceScore === undefined || input.relevanceScore === null) {
    throw new ProvenanceValidationError('Source relevanceScore required');
  }
  if (input.relevanceScore < 0.0 || input.relevanceScore > 1.0) {
    throw new ProvenanceValidationError(
      `relevanceScore ${input.relevanceScore} out of range [0.0, 1.0]`
    );
  }
}

/**
 * Validate provenance input
 * @throws ProvenanceValidationError if validation fails
 */
export function validateProvenanceInput(input: IProvenanceInput): void {
  // Validate sources
  if (!input.sources || input.sources.length === 0) {
    throw new ProvenanceValidationError('Provenance requires at least 1 source');
  }

  // Validate each source
  for (const source of input.sources) {
    validateSourceInput(source);
  }

  // Validate derivationPath
  if (!input.derivationPath || input.derivationPath.length === 0) {
    throw new ProvenanceValidationError('Provenance requires at least 1 derivation step');
  }

  // Validate each derivation step
  for (const step of input.derivationPath) {
    validateDerivationStep(step);
  }
}

/**
 * Validate a derivation step
 * @throws ProvenanceValidationError if validation fails
 */
export function validateDerivationStep(step: IDerivationStep): void {
  // Validate description
  if (!step.description || step.description.trim().length === 0) {
    throw new ProvenanceValidationError('Derivation step description required');
  }

  // Validate sourceIds
  if (!step.sourceIds || step.sourceIds.length === 0) {
    throw new ProvenanceValidationError('Derivation step requires at least 1 sourceId');
  }

  // Validate operation
  if (!step.operation) {
    throw new ProvenanceValidationError('Derivation step operation required');
  }
  if (!VALID_OPERATION_TYPES.includes(step.operation)) {
    throw new ProvenanceValidationError(`Invalid operation type: ${step.operation}`);
  }

  // Validate confidence
  if (step.confidence === undefined || step.confidence === null) {
    throw new ProvenanceValidationError('Derivation step confidence required');
  }
  if (step.confidence < 0.0 || step.confidence > 1.0) {
    throw new ProvenanceValidationError(
      `Derivation step confidence ${step.confidence} out of range [0.0, 1.0]`
    );
  }
}

// ==================== L-Score Calculation ====================

/**
 * Calculate geometric mean of an array of numbers
 * GM = (∏ xᵢ)^(1/n)
 */
export function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;

  const product = values.reduce((acc, val) => acc * val, 1);
  return Math.pow(product, 1 / values.length);
}

/**
 * Calculate arithmetic mean of an array of numbers
 * AR = (Σ xᵢ) / n
 */
export function arithmeticMean(values: number[]): number {
  if (values.length === 0) return 0;

  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate depth factor (penalty for long chains)
 * DF = 1 + log₂(1 + depth)
 */
export function depthFactor(depth: number): number {
  return 1 + Math.log2(1 + depth);
}

/**
 * Calculate L-Score for a provenance chain
 *
 * Formula: L-Score = GM(confidences) × AR(relevances) / DF(depth)
 *
 * @param confidences - Array of derivation step confidences
 * @param relevances - Array of source relevance scores
 * @param depth - Number of derivation steps
 * @param domain - Optional domain for threshold lookup
 * @returns L-Score calculation result
 */
export function calculateLScore(
  confidences: number[],
  relevances: number[],
  depth: number,
  domain?: string
): ILScoreResult {
  if (confidences.length === 0) {
    throw new ProvenanceValidationError('Cannot calculate L-Score without confidences');
  }
  if (relevances.length === 0) {
    throw new ProvenanceValidationError('Cannot calculate L-Score without relevances');
  }

  // Calculate components
  const gm = geometricMean(confidences);
  const ar = arithmeticMean(relevances);
  const df = depthFactor(depth);

  // Calculate L-Score
  const score = (gm * ar) / df;

  // Get threshold for domain
  const threshold = getThresholdForDomain(domain);

  return {
    score,
    geometricMean: gm,
    arithmeticMean: ar,
    depthFactor: df,
    meetsThreshold: score >= threshold,
    threshold,
    domain,
  };
}

/**
 * Get L-Score threshold for a domain
 */
export function getThresholdForDomain(domain?: string): number {
  if (!domain) {
    return DEFAULT_LSCORE_THRESHOLD;
  }

  const config = DOMAIN_THRESHOLDS.find(t => t.domain === domain);
  return config?.threshold ?? DEFAULT_LSCORE_THRESHOLD;
}

/**
 * Validate if an L-Score meets the threshold for a domain
 */
export function validateLScore(lScore: number, domain?: string): boolean {
  const threshold = getThresholdForDomain(domain);
  return lScore >= threshold;
}

// ==================== Embedding Validation ====================

/**
 * Validate 1536-dim L2-normalized embedding
 * @throws ProvenanceValidationError if validation fails
 */
export function validateEmbedding(embedding: Float32Array, context: string): void {
  // Check dimensions
  if (embedding.length !== 1536) {
    throw new ProvenanceValidationError(
      `${context}: Expected 1536D embedding, got ${embedding.length}D`
    );
  }

  // Check L2 normalization (magnitude should be ~1.0)
  let sumSq = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumSq += embedding[i] * embedding[i];
  }
  const magnitude = Math.sqrt(sumSq);

  // Allow small tolerance for floating-point precision
  if (Math.abs(magnitude - 1.0) > 0.01 && magnitude > 0.01) {
    throw new ProvenanceValidationError(
      `${context}: Embedding not L2-normalized, magnitude = ${magnitude.toFixed(4)}`
    );
  }
}
