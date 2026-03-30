/**
 * Shadow Vector Search
 * TASK-SHA-001 - Adversarial Contradiction Detection
 *
 * Implements semantic inversion search for finding contradictions:
 * - Shadow(v) = v × -1 inverts semantic meaning
 * - Property: cosine(v, x) = -cosine(Shadow(v), x)
 *
 * Use cases:
 * - Find counterarguments to hypotheses
 * - Detect conflicting evidence
 * - Validate claims against opposing viewpoints
 *
 * Target: 90% recall on opposing viewpoints
 */

import type {
  DocumentID,
  IShadowSearchOptions,
  IContradiction,
  ISupportingEvidence,
  IValidationReport,
  IShadowVectorConfig,
  IShadowSearchResult,
} from './shadow-types.js';
import {
  ShadowVectorError,
  DEFAULT_SHADOW_CONFIG,
  DEFAULT_CLASSIFICATION_THRESHOLDS,
} from './shadow-types.js';
import {
  createShadowVector,
  cosineSimilarity,
  isL2Normalized,
  normalizeL2,
  classifyDocument,
  determineEvidenceType,
  calculateCredibility,
  determineVerdict,
  calculateVerdictConfidence,
  calculateRefutationStrength,
  sortByRefutationStrength,
  filterByThreshold,
} from './shadow-utils.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const shadowLogger = createComponentLogger('ShadowVectorSearch', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

// ==================== Vector Store Interface ====================

/**
 * Interface for vector storage backend
 * Allows decoupling from specific VectorDB implementation
 */
export interface IVectorStore {
  /** Search for similar vectors */
  search(query: Float32Array, k: number): Promise<IVectorSearchResult[]>;
  /** Get vector by ID */
  getVector(id: string): Promise<Float32Array | null>;
}

/**
 * Vector search result from storage backend
 */
export interface IVectorSearchResult {
  id: string;
  similarity: number;
  vector?: Float32Array;
  metadata?: Record<string, unknown>;
}

// ==================== Mock Vector Store ====================

/**
 * Mock vector store for testing
 */
export class MockVectorStore implements IVectorStore {
  private vectors: Map<string, { vector: Float32Array; content: string; metadata?: Record<string, unknown> }> = new Map();

  addVector(id: string, vector: Float32Array, content: string, metadata?: Record<string, unknown>): void {
    this.vectors.set(id, { vector: normalizeL2(vector), content, metadata });
  }

  async search(query: Float32Array, k: number): Promise<IVectorSearchResult[]> {
    const normalizedQuery = normalizeL2(query);
    const results: IVectorSearchResult[] = [];

    for (const [id, data] of this.vectors) {
      const similarity = cosineSimilarity(normalizedQuery, data.vector);
      results.push({
        id,
        similarity,
        vector: data.vector,
        metadata: { content: data.content, ...data.metadata },
      });
    }

    // Sort by similarity (descending) and take top k
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  async getVector(id: string): Promise<Float32Array | null> {
    const data = this.vectors.get(id);
    return data?.vector || null;
  }

  getContent(id: string): string | null {
    return this.vectors.get(id)?.content || null;
  }

  clear(): void {
    this.vectors.clear();
  }
}

// ==================== Shadow Vector Search ====================

/**
 * Shadow Vector Search for contradiction detection
 *
 * Performs adversarial search by inverting query vectors to find
 * semantically opposing documents in the vector space.
 */
export class ShadowVectorSearch {
  private vectorStore: IVectorStore | null = null;
  private config: Required<IShadowVectorConfig>;

  constructor(config: IShadowVectorConfig = {}) {
    this.config = {
      ...DEFAULT_SHADOW_CONFIG,
      ...config,
    };
  }

  /**
   * Set the vector store for searches
   */
  setVectorStore(store: IVectorStore): void {
    this.vectorStore = store;
  }

  /**
   * Log message if verbose mode enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      shadowLogger.info(message);
    }
  }

  // ==================== Core Search Methods ====================

  /**
   * Find contradictions to a hypothesis vector
   *
   * Algorithm:
   * 1. Create shadow vector: Shadow(v) = v × -1
   * 2. Search vector store with shadow vector
   * 3. For each result, calculate both hypothesis and shadow similarities
   * 4. Classify and filter by refutation strength
   *
   * @param hypothesisVector - Query vector (1536-dim, L2-normalized)
   * @param options - Search options
   * @returns Array of contradictions sorted by refutation strength
   */
  async findContradictions(
    hypothesisVector: Float32Array,
    options: IShadowSearchOptions
  ): Promise<IContradiction[]> {
    if (!this.vectorStore) {
      throw new ShadowVectorError('Vector store not configured', 'CONFIG_ERROR');
    }

    // Validate input vector
    if (hypothesisVector.length !== 1536) {
      throw new ShadowVectorError(
        `Expected 1536-dim vector, got ${hypothesisVector.length}-dim`,
        'INVALID_VECTOR'
      );
    }

    // Ensure normalized
    const normalizedHypothesis = isL2Normalized(hypothesisVector)
      ? hypothesisVector
      : normalizeL2(hypothesisVector);

    // Create shadow vector
    const shadowVector = createShadowVector(normalizedHypothesis);

    this.log(`Searching for contradictions (type: ${options.type})`);

    // Apply options defaults
    const threshold = options.threshold ?? this.config.defaultThreshold;
    const k = options.k ?? this.config.defaultK;

    // Search with shadow vector to find potential contradictions
    const shadowResults = await this.vectorStore.search(shadowVector, k * 2);

    // Also search with hypothesis to get both similarities
    const hypothesisResults = await this.vectorStore.search(normalizedHypothesis, k * 2);

    // Create a map of hypothesis similarities
    const hypothesisSimilarities = new Map<string, number>();
    for (const result of hypothesisResults) {
      hypothesisSimilarities.set(result.id, result.similarity);
    }

    // Process shadow results
    const searchResults: IShadowSearchResult[] = shadowResults.map(result => ({
      documentId: result.id,
      content: (result.metadata?.content as string) || `Document ${result.id}`,
      hypothesisSimilarity: hypothesisSimilarities.get(result.id) ?? -cosineSimilarity(normalizedHypothesis, result.vector!),
      shadowSimilarity: result.similarity,
      embedding: result.vector,
      metadata: result.metadata,
    }));

    // Filter by threshold
    const filtered = filterByThreshold(searchResults, threshold);

    // Sort by refutation strength
    const sorted = sortByRefutationStrength(filtered);

    // Convert to contradictions
    const contradictions: IContradiction[] = sorted.slice(0, k).map(result => {
      const classification = classifyDocument(
        result.hypothesisSimilarity,
        result.shadowSimilarity,
        DEFAULT_CLASSIFICATION_THRESHOLDS
      );

      const refutationStrength = calculateRefutationStrength(
        result.hypothesisSimilarity,
        result.shadowSimilarity
      );

      const evidenceType = determineEvidenceType(classification, refutationStrength);

      return {
        documentId: result.documentId,
        claim: result.content,
        refutationStrength,
        evidenceType,
        lScore: (result.metadata?.lScore as number) ?? 0.5,
        hypothesisSimilarity: result.hypothesisSimilarity,
        shadowSimilarity: result.shadowSimilarity,
        classification,
        embedding: options.includeHypothesisSimilarity ? result.embedding : undefined,
        metadata: result.metadata,
      };
    });

    // Optionally filter by L-Score
    if (options.validateLScore ?? this.config.validateLScoreByDefault) {
      const minLScore = options.minLScore ?? this.config.defaultMinLScore;
      return contradictions.filter(c => c.lScore >= minLScore);
    }

    return contradictions;
  }

  /**
   * Find supporting evidence for a hypothesis
   *
   * @param hypothesisVector - Query vector (1536-dim, L2-normalized)
   * @param k - Maximum results
   * @returns Array of supporting evidence
   */
  async findSupport(
    hypothesisVector: Float32Array,
    k: number = 10
  ): Promise<ISupportingEvidence[]> {
    if (!this.vectorStore) {
      throw new ShadowVectorError('Vector store not configured', 'CONFIG_ERROR');
    }

    // Validate input vector
    if (hypothesisVector.length !== 1536) {
      throw new ShadowVectorError(
        `Expected 1536-dim vector, got ${hypothesisVector.length}-dim`,
        'INVALID_VECTOR'
      );
    }

    const normalizedHypothesis = isL2Normalized(hypothesisVector)
      ? hypothesisVector
      : normalizeL2(hypothesisVector);

    // Search for similar vectors (supporting evidence)
    const results = await this.vectorStore.search(normalizedHypothesis, k);

    // Filter to only supporting (high hypothesis similarity)
    return results
      .filter(result => result.similarity > this.config.defaultThreshold)
      .map(result => ({
        documentId: result.id,
        claim: (result.metadata?.content as string) || `Document ${result.id}`,
        supportStrength: result.similarity,
        hypothesisSimilarity: result.similarity,
        lScore: (result.metadata?.lScore as number) ?? 0.5,
        metadata: result.metadata,
      }));
  }

  /**
   * Validate a claim by finding both support and contradictions
   *
   * @param hypothesisVector - Query vector for the claim
   * @param claimText - Text description of the claim
   * @returns Comprehensive validation report
   */
  async validateClaim(
    hypothesisVector: Float32Array,
    claimText: string
  ): Promise<IValidationReport> {
    const startTime = Date.now();

    this.log(`Validating claim: "${claimText.substring(0, 50)}..."`);

    // Find both support and contradictions
    const [support, contradictions] = await Promise.all([
      this.findSupport(hypothesisVector, 10),
      this.findContradictions(hypothesisVector, {
        type: 'contradiction',
        threshold: this.config.defaultThreshold,
        k: 10,
      }),
    ]);

    // Calculate credibility
    const supportStrengths = support.map(s => s.supportStrength);
    const refutationStrengths = contradictions.map(c => c.refutationStrength);

    const credibility = calculateCredibility(supportStrengths, refutationStrengths);
    const verdict = determineVerdict(credibility, support.length, contradictions.length);
    const confidence = calculateVerdictConfidence(supportStrengths, refutationStrengths);

    // Find strongest evidence
    const strongestSupport = support.length > 0
      ? support.reduce((a, b) => a.supportStrength > b.supportStrength ? a : b)
      : undefined;

    const strongestContradiction = contradictions.length > 0
      ? contradictions.reduce((a, b) => a.refutationStrength > b.refutationStrength ? a : b)
      : undefined;

    // Calculate averages
    const averageSupportStrength = supportStrengths.length > 0
      ? supportStrengths.reduce((a, b) => a + b, 0) / supportStrengths.length
      : 0;

    const averageRefutationStrength = refutationStrengths.length > 0
      ? refutationStrengths.reduce((a, b) => a + b, 0) / refutationStrengths.length
      : 0;

    const report: IValidationReport = {
      claim: claimText,
      hypothesisVector,
      support,
      contradictions,
      credibility,
      verdict,
      confidence,
      timestamp: Date.now(),
      metadata: {
        supportCount: support.length,
        contradictionCount: contradictions.length,
        averageSupportStrength,
        averageRefutationStrength,
        strongestSupport,
        strongestContradiction,
      },
    };

    this.log(`Validation complete in ${Date.now() - startTime}ms: ${verdict} (credibility: ${credibility.toFixed(2)})`);

    return report;
  }

  // ==================== Batch Operations ====================

  /**
   * Find contradictions for multiple hypotheses
   *
   * @param hypotheses - Array of hypothesis vectors
   * @param options - Search options
   * @returns Array of contradiction arrays
   */
  async batchFindContradictions(
    hypotheses: Float32Array[],
    options: IShadowSearchOptions
  ): Promise<IContradiction[][]> {
    return Promise.all(
      hypotheses.map(h => this.findContradictions(h, options))
    );
  }

  /**
   * Validate multiple claims
   *
   * @param claims - Array of { vector, text } pairs
   * @returns Array of validation reports
   */
  async batchValidateClaims(
    claims: Array<{ vector: Float32Array; text: string }>
  ): Promise<IValidationReport[]> {
    return Promise.all(
      claims.map(claim => this.validateClaim(claim.vector, claim.text))
    );
  }

  // ==================== Configuration ====================

  /**
   * Get current configuration
   */
  getConfig(): Required<IShadowVectorConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IShadowVectorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
