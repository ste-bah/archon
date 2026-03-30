/**
 * Truth Protocol Type Definitions
 *
 * Interfaces, types, and constants for the Truth Protocol Verifier.
 *
 * @module src/god-agent/core/pipeline/truth-protocol-types
 * @see docs/god-agent-coding-pipeline/PRD-god-agent-coding-pipeline.md Section 2.3
 */

import type {
  SherlockVerdict,
  SherlockConfidence,
  ISherlockEvidence,
  ISherlockIssue,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════
// CLAIM TYPES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Types of claims that can be made in agent output
 */
export type ClaimType =
  | 'factual'       // Assertion about facts (file exists, function returns X)
  | 'existence'     // Claims something exists (a file, a function, a variable)
  | 'behavioral'    // Claims about behavior (this does X, this handles Y)
  | 'quantitative'  // Numeric claims (N files, X% coverage)
  | 'capability'    // Claims about what something can do
  | 'temporal'      // Claims about time/sequence (before X, after Y)
  | 'causal'        // Claims about cause-effect (X causes Y)
  | 'comparative'   // Claims comparing things (X is faster than Y)
  | 'opinion'       // Subjective claims (best approach, recommended)
  | 'unknown';      // Cannot determine claim type

/**
 * Confidence level for a claim assessment
 */
export type ClaimConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/**
 * Flags that can be applied to claims indicating issues
 */
export type ClaimFlag =
  | 'UNVERIFIABLE'       // Cannot be verified
  | 'MISSING_EVIDENCE'   // Critical claim without evidence
  | 'HALLUCINATION'      // Likely hallucination detected
  | 'VAGUE'              // Too vague to assess
  | 'CONTRADICTORY'      // Contradicts other claims
  | 'UNSUPPORTED'        // No supporting context found
  | 'STALE'              // May be outdated information
  | 'ASSUMPTION'         // Based on assumptions
  | 'OVERSTATED';        // Claim is likely overstated/exaggerated

/**
 * Types of evidence that can support a claim
 */
export type EvidenceType =
  | 'file_exists'        // File system verification
  | 'code_reference'     // Reference to actual code
  | 'semantic_match'     // Semantic similarity match
  | 'test_result'        // Test execution result
  | 'documentation'      // Documentation reference
  | 'context_provided'   // From provided context
  | 'external_source'    // External reference
  | 'self_referential';  // Agent's own previous output

/**
 * Types of hallucination patterns
 */
export type HallucinationPatternType =
  | 'NONEXISTENT_FILE'        // Claims file exists but it doesn't
  | 'NONEXISTENT_FUNCTION'    // Claims function exists but it doesn't
  | 'INVENTED_API'            // Invents API that doesn't exist
  | 'FABRICATED_OUTPUT'       // Fabricates execution output
  | 'FALSE_CAPABILITY'        // Claims capability that doesn't exist
  | 'PHANTOM_DEPENDENCY'      // References non-existent dependency
  | 'CONTRADICTS_CONTEXT'     // Directly contradicts provided context
  | 'IMPOSSIBLE_CLAIM'        // Logically impossible claim
  | 'OVERCONFIDENT'           // Overly confident about uncertain claims
  | 'KNOWLEDGE_CUTOFF'        // Claims about things after knowledge cutoff
  | 'CIRCULAR_REASONING';     // Supports claim with itself

// ═════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Evidence supporting a claim
 */
export interface IClaimEvidence {
  /** Type of evidence */
  type: EvidenceType;
  /** Source of the evidence */
  source: string;
  /** Evidence content/value */
  content: string;
  /** Strength of this evidence (0-1) */
  strength: number;
}

/**
 * A single claim extracted from agent output
 */
export interface ITruthClaim {
  /** Unique identifier for this claim */
  id: string;
  /** The claim text */
  statement: string;
  /** Type of claim */
  type: ClaimType;
  /** Truth score (0-100), higher is more verifiable/truthful */
  truthScore: number;
  /** Confidence level in the assessment */
  confidence: ClaimConfidence;
  /** Supporting evidence for this claim */
  evidence: IClaimEvidence[];
  /** Whether this claim is verifiable */
  isVerifiable: boolean;
  /** Whether this claim requires evidence (critical claim) */
  requiresEvidence: boolean;
  /** Flags for potential issues */
  flags: ClaimFlag[];
  /** Source location in the original output */
  sourceLocation?: { start: number; end: number };
}

/**
 * A detected hallucination pattern
 */
export interface IHallucinationPattern {
  /** Pattern type */
  type: HallucinationPatternType;
  /** Description of the pattern */
  description: string;
  /** Evidence of the pattern */
  evidence: string;
  /** Severity of this pattern */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Affected claim IDs */
  affectedClaims: string[];
}

/**
 * Result from hallucination detection
 */
export interface IHallucinationResult {
  /** Whether hallucinations were detected */
  detected: boolean;
  /** Overall hallucination risk score (0-100), higher = more risk */
  riskScore: number;
  /** Specific hallucination patterns found */
  patterns: IHallucinationPattern[];
  /** Claims identified as likely hallucinations */
  suspectedClaims: string[];
  /** Confidence in the detection */
  confidence: ClaimConfidence;
}

/**
 * Statistics about truth verification
 */
export interface ITruthStatistics {
  /** Total claims analyzed */
  totalClaims: number;
  /** Claims that passed verification */
  verifiedClaims: number;
  /** Claims flagged as potentially false */
  flaggedClaims: number;
  /** Claims that could not be verified */
  unverifiableClaims: number;
  /** Claims with sufficient evidence */
  evidencedClaims: number;
  /** Average truth score across claims */
  averageTruthScore: number;
  /** Distribution of claim types */
  claimTypeDistribution: Record<ClaimType, number>;
  /** Distribution of flags */
  flagDistribution: Record<ClaimFlag, number>;
}

/**
 * Complete result from truth verification
 */
export interface ITruthVerificationResult {
  /** Whether the verification passed (overall truthfulness acceptable) */
  passed: boolean;
  /** Overall truth score (0-100) */
  overallTruthScore: number;
  /** Individual claim assessments */
  claims: ITruthClaim[];
  /** Hallucination detection results */
  hallucinationResult: IHallucinationResult;
  /** Summary statistics */
  statistics: ITruthStatistics;
  /** Sherlock-compatible verdict */
  verdict: SherlockVerdict;
  /** Confidence in the verdict */
  confidence: SherlockConfidence;
  /** Evidence collected */
  evidence: ISherlockEvidence[];
  /** Issues found */
  issues: ISherlockIssue[];
  /** Timestamp of verification */
  timestamp: string;
  /** Recommendations for improvement */
  recommendations: string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

/** Minimum truth score to pass verification */
export const MIN_TRUTH_SCORE = 70;

/** Minimum percentage of claims that must be verified */
export const MIN_VERIFIED_PERCENTAGE = 80;

/** Maximum allowed hallucination risk score */
export const MAX_HALLUCINATION_RISK = 30;

/** Patterns indicating existence claims */
export const EXISTENCE_PATTERNS: RegExp[] = [
  /(?:file|function|class|method|variable|module|package)\s+['"`]?(\w+)['"`]?\s+(?:exists?|is\s+(?:present|available|defined))/gi,
  /(?:there\s+is|we\s+have|contains?)\s+(?:a|an|the)\s+(\w+)/gi,
  /created?\s+(?:the\s+)?(?:file|function|class|method)\s+['"`]?(\w+)['"`]?/gi,
  /(?:implemented?|added?|wrote)\s+(?:the\s+)?(\w+)/gi,
];

/** Patterns indicating behavioral claims */
export const BEHAVIORAL_PATTERNS: RegExp[] = [
  /(?:this|it|the\s+\w+)\s+(?:will|does|can|should|would)\s+(\w+)/gi,
  /(?:handles?|processes?|returns?|throws?|validates?)\s+/gi,
  /(?:when|if|after|before)\s+.{1,500}?\s+(?:then|it will|this will)/gi,
];

/** Patterns indicating quantitative claims */
export const QUANTITATIVE_PATTERNS: RegExp[] = [
  /(\d+(?:\.\d+)?)\s*(?:%|percent|files?|functions?|lines?|tests?)/gi,
  /(?:all|every|no|none|most|some|few|many)\s+(\w+)/gi,
  /(?:increased?|decreased?|improved?)\s+(?:by\s+)?(\d+)/gi,
];

/** Patterns that may indicate hallucination */
export const HALLUCINATION_INDICATORS: Array<{
  pattern: RegExp;
  type: HallucinationPatternType;
}> = [
  { pattern: /(?:the\s+)?file\s+['"`]([^'"`]+)['"`]\s+(?:contains?|has|includes?)/gi, type: 'NONEXISTENT_FILE' },
  { pattern: /(?:call|invoke|use)\s+(?:the\s+)?['"`]?(\w+)['"`]?\s*\(/gi, type: 'NONEXISTENT_FUNCTION' },
  { pattern: /(?:the\s+)?api\s+(?:endpoint\s+)?['"`]([^'"`]+)['"`]/gi, type: 'INVENTED_API' },
  { pattern: /output(?:s|ted)?\s*(?:is|was|:)\s*['"`]([^'"`]+)['"`]/gi, type: 'FABRICATED_OUTPUT' },
  { pattern: /(?:definitely|certainly|absolutely|always|never)\s+/gi, type: 'OVERCONFIDENT' },
  { pattern: /(?:because|since)\s+(?:it|this)\s+(?:is|was|does)/gi, type: 'CIRCULAR_REASONING' },
];

/** Words indicating low confidence or uncertainty */
export const UNCERTAINTY_INDICATORS = [
  'might', 'maybe', 'perhaps', 'possibly', 'could', 'should',
  'probably', 'likely', 'unlikely', 'uncertain', 'unclear',
  'appears', 'seems', 'suggests', 'indicates', 'implies',
] as const;

/** Words indicating high confidence (may be overconfident) */
export const OVERCONFIDENCE_INDICATORS = [
  'definitely', 'certainly', 'absolutely', 'always', 'never',
  'guaranteed', 'impossible', 'must', 'obviously', 'clearly',
  'undoubtedly', 'unquestionably', 'perfect', 'flawless',
] as const;

/** Base truth scores by claim type */
export const BASE_TRUTH_SCORES: Record<ClaimType, number> = {
  factual: 60,
  existence: 50,
  behavioral: 55,
  quantitative: 50,
  capability: 60,
  temporal: 65,
  causal: 55,
  comparative: 60,
  opinion: 80,
  unknown: 40,
};

/** Claim type weights for scoring */
export const CLAIM_TYPE_WEIGHTS: Record<ClaimType, number> = {
  factual: 1.5,
  existence: 1.4,
  behavioral: 1.2,
  quantitative: 1.3,
  capability: 1.1,
  temporal: 1.0,
  causal: 1.2,
  comparative: 1.0,
  opinion: 0.5,
  unknown: 0.3,
};

/** Severity scores for hallucination patterns */
export const SEVERITY_SCORES: Record<string, number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
};

/** Severity mapping for hallucination types */
export const HALLUCINATION_SEVERITY: Record<
  HallucinationPatternType,
  'critical' | 'high' | 'medium' | 'low'
> = {
  NONEXISTENT_FILE: 'critical',
  NONEXISTENT_FUNCTION: 'critical',
  INVENTED_API: 'high',
  FABRICATED_OUTPUT: 'critical',
  FALSE_CAPABILITY: 'high',
  PHANTOM_DEPENDENCY: 'high',
  CONTRADICTS_CONTEXT: 'high',
  IMPOSSIBLE_CLAIM: 'critical',
  OVERCONFIDENT: 'medium',
  KNOWLEDGE_CUTOFF: 'medium',
  CIRCULAR_REASONING: 'low',
};

/** Descriptions for hallucination types */
export const HALLUCINATION_DESCRIPTIONS: Record<HallucinationPatternType, string> = {
  NONEXISTENT_FILE: 'Claims a file exists that cannot be verified',
  NONEXISTENT_FUNCTION: 'References a function that may not exist',
  INVENTED_API: 'Describes an API endpoint that may not be real',
  FABRICATED_OUTPUT: 'Presents output that may be fabricated',
  FALSE_CAPABILITY: 'Claims a capability that may not exist',
  PHANTOM_DEPENDENCY: 'References a dependency that may not exist',
  CONTRADICTS_CONTEXT: 'Statement contradicts provided context',
  IMPOSSIBLE_CLAIM: 'Makes a logically impossible claim',
  OVERCONFIDENT: 'Uses overly confident language without basis',
  KNOWLEDGE_CUTOFF: 'May reference information beyond knowledge cutoff',
  CIRCULAR_REASONING: 'Uses circular reasoning to support claim',
};

/** Remediation suggestions for hallucination types */
export const HALLUCINATION_REMEDIATIONS: Record<HallucinationPatternType, string> = {
  NONEXISTENT_FILE: 'Verify file existence before referencing',
  NONEXISTENT_FUNCTION: 'Check function signatures in actual codebase',
  INVENTED_API: 'Reference only documented API endpoints',
  FABRICATED_OUTPUT: 'Include actual execution output or clearly mark as expected',
  FALSE_CAPABILITY: 'Verify capabilities against documentation',
  PHANTOM_DEPENDENCY: 'Check package.json or dependency list',
  CONTRADICTS_CONTEXT: 'Reconcile statement with provided context',
  IMPOSSIBLE_CLAIM: 'Review logical consistency of claim',
  OVERCONFIDENT: 'Use hedging language for uncertain claims',
  KNOWLEDGE_CUTOFF: 'Verify information currency',
  CIRCULAR_REASONING: 'Provide independent supporting evidence',
};
