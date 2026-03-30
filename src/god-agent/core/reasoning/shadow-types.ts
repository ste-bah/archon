/**
 * Shadow Vector Type Definitions
 * TASK-SHA-001 - Contradiction Detection via Semantic Inversion
 *
 * Provides types for adversarial search using shadow vectors (v × -1)
 * to detect contradictions, counterarguments, and falsifications.
 *
 * Classification Matrix:
 * | Hypothesis Similarity | Shadow Similarity | Classification |
 * |----------------------|-------------------|----------------|
 * | > 0.7                | > 0.7             | AMBIGUOUS      |
 * | < Shadow             | > 0.7             | CONTESTED      |
 * | 0.5-0.7              | 0.5-0.7           | DEBATED        |
 * | < 0.3                | > 0.7             | FALSIFIED      |
 */

// ==================== Core Types ====================

/**
 * Document ID type for shadow vector results
 */
export type DocumentID = string;

/**
 * Search type for shadow vector queries
 */
export type ShadowSearchType = 'contradiction' | 'counterargument' | 'falsification';

/**
 * Classification verdict for claim validation
 */
export type ValidationVerdict = 'SUPPORTED' | 'REFUTED' | 'UNCERTAIN' | 'AMBIGUOUS' | 'CONTESTED' | 'DEBATED' | 'FALSIFIED';

/**
 * Evidence type classification
 */
export type EvidenceType = 'direct_refutation' | 'counterexample' | 'methodological_flaw' | 'alternative_explanation' | 'partial_contradiction';

// ==================== Search Options ====================

/**
 * Options for shadow vector search
 */
export interface IShadowSearchOptions {
  /** Type of contradiction search */
  type: ShadowSearchType;
  /** Minimum refutation strength threshold (default 0.7) */
  threshold?: number;
  /** Maximum number of results (default 10) */
  k?: number;
  /** Optional filters for narrowing results */
  filters?: IShadowFilters;
  /** Include hypothesis similarity in results */
  includeHypothesisSimilarity?: boolean;
  /** Apply L-Score validation to results */
  validateLScore?: boolean;
  /** Minimum L-Score for results (default 0.3) */
  minLScore?: number;
}

/**
 * Filters for shadow vector search
 */
export interface IShadowFilters {
  /** Filter by sentiment */
  sentiment?: 'negative' | 'positive' | 'neutral';
  /** Filter by evidence type */
  type?: EvidenceType;
  /** Filter by source domain */
  domain?: string;
  /** Filter by minimum confidence */
  minConfidence?: number;
  /** Filter by date range */
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

// ==================== Results ====================

/**
 * A contradiction found via shadow vector search
 */
export interface IContradiction {
  /** Document identifier */
  documentId: DocumentID;
  /** The contradicting claim text */
  claim: string;
  /** Refutation strength [0, 1] - how strongly this contradicts */
  refutationStrength: number;
  /** Type of evidence provided */
  evidenceType: EvidenceType;
  /** L-Score for provenance validation */
  lScore: number;
  /** Similarity to original hypothesis (optional) */
  hypothesisSimilarity?: number;
  /** Similarity to shadow vector */
  shadowSimilarity: number;
  /** Classification based on similarity matrix */
  classification: ValidationVerdict;
  /** Associated vector embedding */
  embedding?: Float32Array;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Supporting evidence for a claim
 */
export interface ISupportingEvidence {
  /** Document identifier */
  documentId: DocumentID;
  /** The supporting claim text */
  claim: string;
  /** Support strength [0, 1] */
  supportStrength: number;
  /** Similarity to hypothesis */
  hypothesisSimilarity: number;
  /** L-Score for provenance validation */
  lScore: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Comprehensive validation report for a claim
 */
export interface IValidationReport {
  /** The original claim being validated */
  claim: string;
  /** Original hypothesis embedding */
  hypothesisVector?: Float32Array;
  /** Supporting evidence found */
  support: ISupportingEvidence[];
  /** Contradicting evidence found */
  contradictions: IContradiction[];
  /** Overall credibility score [0, 1] */
  credibility: number;
  /** Final verdict based on evidence balance */
  verdict: ValidationVerdict;
  /** Confidence in the verdict [0, 1] */
  confidence: number;
  /** Analysis timestamp */
  timestamp: number;
  /** Additional analysis metadata */
  metadata?: {
    supportCount: number;
    contradictionCount: number;
    averageSupportStrength: number;
    averageRefutationStrength: number;
    strongestSupport?: ISupportingEvidence;
    strongestContradiction?: IContradiction;
  };
}

// ==================== Configuration ====================

/**
 * Configuration for ShadowVectorSearch
 */
export interface IShadowVectorConfig {
  /** Default threshold for contradiction detection (default 0.7) */
  defaultThreshold?: number;
  /** Default maximum results (default 10) */
  defaultK?: number;
  /** Enable L-Score validation by default (default true) */
  validateLScoreByDefault?: boolean;
  /** Default minimum L-Score (default 0.3) */
  defaultMinLScore?: number;
  /** Enable verbose logging (default false) */
  verbose?: boolean;
}

// ==================== Internal Types ====================

/**
 * Internal search result with both similarities
 */
export interface IShadowSearchResult {
  /** Document identifier */
  documentId: DocumentID;
  /** Document content/claim */
  content: string;
  /** Similarity to original hypothesis */
  hypothesisSimilarity: number;
  /** Similarity to shadow vector */
  shadowSimilarity: number;
  /** Document embedding */
  embedding?: Float32Array;
  /** Document metadata */
  metadata?: Record<string, unknown>;
}

// ==================== Error Types ====================

/**
 * Error thrown when shadow vector operations fail
 */
export class ShadowVectorError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_VECTOR' | 'SEARCH_FAILED' | 'VALIDATION_FAILED' | 'CONFIG_ERROR'
  ) {
    super(message);
    this.name = 'ShadowVectorError';
  }
}

// ==================== Utility Types ====================

/**
 * Classification thresholds
 */
export interface IClassificationThresholds {
  /** Threshold for high similarity (default 0.7) */
  high: number;
  /** Threshold for medium similarity (default 0.5) */
  medium: number;
  /** Threshold for low similarity (default 0.3) */
  low: number;
}

/**
 * Default classification thresholds
 */
export const DEFAULT_CLASSIFICATION_THRESHOLDS: IClassificationThresholds = {
  high: 0.7,
  medium: 0.5,
  low: 0.3,
};

/**
 * Default shadow vector configuration
 */
export const DEFAULT_SHADOW_CONFIG: Required<IShadowVectorConfig> = {
  defaultThreshold: 0.7,
  defaultK: 10,
  validateLScoreByDefault: true,
  defaultMinLScore: 0.3,
  verbose: false,
};
