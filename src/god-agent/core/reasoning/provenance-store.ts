/**
 * ProvenanceStore
 * TASK-PRV-001 - Source Registration and Citation Graph
 *
 * Tracks derivation paths from sources to insights, enabling
 * "How did you know this?" queries with citation graph traversal.
 *
 * Performance targets:
 * - Source storage: <5ms
 * - Provenance creation: <15ms
 * - 5-hop traversal: <10ms
 * - 10-hop traversal: <20ms
 */

import type { VectorDB } from '../vector-db/vector-db.js';
import type {
  SourceID,
  ProvenanceID,
  ISourceInput,
  ISource,
  IProvenanceInput,
  IProvenance,
  IDerivationStep,
  ICitationPath,
  ITraversalOptions,
  ILScoreResult,
  ISerializedSource,
  ISerializedProvenance,
} from './provenance-types.js';
import { ProvenanceValidationError, LScoreRejectionError } from './provenance-types.js';
import {
  generateSourceID,
  generateProvenanceID,
  validateSourceInput,
  validateProvenanceInput,
  validateEmbedding,
  calculateLScore,
} from './provenance-utils.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('ProvenanceStore', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Configuration for ProvenanceStore
 */
export interface ProvenanceStoreConfig {
  /** Enable L-Score enforcement */
  enforceLScore?: boolean;
  /** Auto-persist changes */
  autoPersist?: boolean;
  /** Enable performance logging */
  trackPerformance?: boolean;
}

/**
 * ProvenanceStore - Source tracking and citation graph management
 */
export class ProvenanceStore {
  private sources: Map<SourceID, ISource> = new Map();
  private provenances: Map<ProvenanceID, IProvenance> = new Map();
  private vectorDB: VectorDB;
  private config: Required<ProvenanceStoreConfig>;
  private initialized: boolean = false;

  constructor(vectorDB: VectorDB, config: ProvenanceStoreConfig = {}) {
    this.vectorDB = vectorDB;
    this.config = {
      enforceLScore: config.enforceLScore ?? false, // Disabled until TASK-PRV-002
      autoPersist: config.autoPersist ?? false,
      trackPerformance: config.trackPerformance ?? false,
    };
  }

  /**
   * Initialize the ProvenanceStore
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  /**
   * Store a new source
   *
   * @param input - Source input data
   * @returns Generated SourceID
   * @throws ProvenanceValidationError if validation fails
   */
  async storeSource(input: ISourceInput): Promise<SourceID> {
    const startTime = performance.now();

    // 1. Validate input
    validateSourceInput(input);

    // 2. Validate embedding if provided
    if (input.embedding) {
      validateEmbedding(input.embedding, 'ProvenanceStore.storeSource()');
    }

    // 3. Generate SourceID
    const sourceId = generateSourceID();

    // 4. Create ISource object
    const source: ISource = {
      ...input,
      id: sourceId,
      createdAt: new Date(),
    };

    // 5. Store in memory map
    this.sources.set(sourceId, source);

    // 6. Insert embedding into VectorDB if provided
    if (input.embedding) {
      const vectorId = await this.vectorDB.insert(input.embedding);
      source.vectorId = vectorId;
    }

    // 7. Track performance
    if (this.config.trackPerformance) {
      const elapsed = performance.now() - startTime;
      if (elapsed > 5) {
        logger.warn('ProvenanceStore.storeSource() exceeds performance target', { elapsedMs: elapsed, targetMs: 5 });
      }
    }

    return sourceId;
  }

  /**
   * Create a provenance chain
   *
   * @param input - Provenance input data
   * @returns Generated ProvenanceID
   * @throws ProvenanceValidationError if validation fails
   * @throws LScoreRejectionError if L-Score below threshold (when enforcement enabled)
   */
  async createProvenance(input: IProvenanceInput): Promise<ProvenanceID> {
    const startTime = performance.now();

    // 1. Validate input
    validateProvenanceInput(input);

    // 2. Store all sources first
    const sourceIds: SourceID[] = [];
    for (const sourceInput of input.sources) {
      const sourceId = await this.storeSource(sourceInput);
      sourceIds.push(sourceId);
    }

    // 3. Update derivation step sourceIds to use generated IDs
    const derivationPath: IDerivationStep[] = input.derivationPath.map((step) => {
      // Map step sourceIds to actual stored source IDs
      const mappedSourceIds = step.sourceIds.map((_, srcIndex) => {
        return sourceIds[srcIndex % sourceIds.length];
      });

      return {
        ...step,
        sourceIds: mappedSourceIds,
      };
    });

    // 4. Validate all sourceIds in derivation steps exist
    for (const step of derivationPath) {
      for (const sourceId of step.sourceIds) {
        if (!this.sources.has(sourceId)) {
          throw new ProvenanceValidationError(
            `Derivation step references unknown source: ${sourceId}`
          );
        }
      }
    }

    // 5. Calculate L-Score (validation happens in TASK-PRV-002)
    if (this.config.enforceLScore) {
      const confidences = derivationPath.map(s => s.confidence);
      const relevances = input.sources.map(s => s.relevanceScore);
      const depth = derivationPath.length;

      const lScoreResult = calculateLScore(confidences, relevances, depth, input.domain);

      if (!lScoreResult.meetsThreshold) {
        throw new LScoreRejectionError(
          lScoreResult.score,
          lScoreResult.threshold,
          input.domain
        );
      }
    }

    // 6. Generate ProvenanceID
    const provenanceId = generateProvenanceID();

    // 7. Create IProvenance object
    const provenance: IProvenance = {
      id: provenanceId,
      sourceIds,
      derivationPath,
      parentProvenanceId: input.parentProvenanceId,
      domain: input.domain,
      depth: derivationPath.length,
      createdAt: new Date(),
    };

    // 8. Validate parent provenance exists if provided
    if (input.parentProvenanceId) {
      if (!this.provenances.has(input.parentProvenanceId)) {
        logger.warn('Parent provenance not found, treating as root', { parentProvenanceId: input.parentProvenanceId });
        provenance.parentProvenanceId = undefined;
      }
    }

    // 9. Store in memory map
    this.provenances.set(provenanceId, provenance);

    // 10. Track performance
    if (this.config.trackPerformance) {
      const elapsed = performance.now() - startTime;
      if (elapsed > 15) {
        logger.warn('ProvenanceStore.createProvenance() exceeds performance target', { elapsedMs: elapsed, targetMs: 15 });
      }
    }

    return provenanceId;
  }

  /**
   * Traverse citation graph from a provenance ID
   *
   * @param provenanceId - Starting provenance ID
   * @param options - Traversal options
   * @returns Citation path with sources and derivation steps
   */
  async traverseCitationGraph(
    provenanceId: ProvenanceID,
    options: ITraversalOptions = {}
  ): Promise<ICitationPath> {
    const startTime = performance.now();

    // 1. Retrieve provenance
    const provenance = this.provenances.get(provenanceId);
    if (!provenance) {
      throw new ProvenanceValidationError(`Provenance ${provenanceId} not found`);
    }

    // 2. Initialize result
    const citationPath: ICitationPath = {
      insightId: provenanceId,
      sources: [],
      derivationPath: [...provenance.derivationPath],
      lScore: 0, // Calculated in TASK-PRV-002
      depth: provenance.depth,
      ancestors: [],
      createdAt: provenance.createdAt,
    };

    // 3. Collect sources
    for (const sourceId of provenance.sourceIds) {
      const source = this.sources.get(sourceId);
      if (source) {
        citationPath.sources.push({
          id: sourceId,
          type: source.type,
          title: source.title,
          relevanceScore: source.relevanceScore,
          location: source.location,
          contribution: 0, // Calculated in L-Score
        });
      }
    }

    // 4. Follow parent chain if includeAncestors enabled
    const maxDepth = options.maxDepth ?? 10;
    const includeAncestors = options.includeAncestors ?? false;
    const visitedProvenances = new Set<ProvenanceID>();
    visitedProvenances.add(provenanceId);

    if (includeAncestors && provenance.parentProvenanceId) {
      let currentProvenanceId: ProvenanceID | undefined = provenance.parentProvenanceId;
      let currentDepth = 1;

      while (currentProvenanceId && currentDepth < maxDepth) {
        // Cycle detection
        if (visitedProvenances.has(currentProvenanceId)) {
          logger.warn('Cycle detected in provenance chain', { provenanceId: currentProvenanceId });
          break;
        }
        visitedProvenances.add(currentProvenanceId);

        const parentProvenance = this.provenances.get(currentProvenanceId);
        if (!parentProvenance) {
          logger.warn('Parent provenance not found, stopping traversal', { provenanceId: currentProvenanceId });
          break;
        }

        // Add to ancestors
        citationPath.ancestors.push(currentProvenanceId);

        // Add parent's sources (avoid duplicates)
        for (const sourceId of parentProvenance.sourceIds) {
          const source = this.sources.get(sourceId);
          if (source && !citationPath.sources.find(s => s.id === sourceId)) {
            citationPath.sources.push({
              id: sourceId,
              type: source.type,
              title: source.title,
              relevanceScore: source.relevanceScore,
              location: source.location,
              contribution: 0,
            });
          }
        }

        // Add parent's derivation steps
        citationPath.derivationPath.push(...parentProvenance.derivationPath);
        citationPath.depth += parentProvenance.depth;

        // Move to next parent
        currentProvenanceId = parentProvenance.parentProvenanceId;
        currentDepth++;
      }
    }

    // 5. Check performance target
    const elapsedMs = performance.now() - startTime;
    const targetMs = citationPath.depth <= 5 ? 10 : 20;

    if (this.config.trackPerformance && elapsedMs > targetMs) {
      logger.warn('Citation traversal exceeds performance target', { elapsedMs, targetMs });
    }

    return citationPath;
  }

  /**
   * Calculate L-Score for a provenance chain
   *
   * @param provenanceId - Provenance ID to calculate for
   * @returns L-Score calculation result
   */
  async calculateLScore(provenanceId: ProvenanceID): Promise<ILScoreResult> {
    const provenance = this.provenances.get(provenanceId);
    if (!provenance) {
      throw new ProvenanceValidationError(`Provenance ${provenanceId} not found`);
    }

    // Collect confidences from derivation steps
    const confidences = provenance.derivationPath.map(step => step.confidence);

    // Collect relevance scores from sources
    const relevances: number[] = [];
    for (const sourceId of provenance.sourceIds) {
      const source = this.sources.get(sourceId);
      if (source) {
        relevances.push(source.relevanceScore);
      }
    }

    return calculateLScore(confidences, relevances, provenance.depth, provenance.domain);
  }

  /**
   * Get a provenance by ID
   */
  getProvenance(id: ProvenanceID): IProvenance | undefined {
    return this.provenances.get(id);
  }

  /**
   * Get a source by ID
   */
  getSource(id: SourceID): ISource | undefined {
    return this.sources.get(id);
  }

  /**
   * Get all provenances
   */
  getAllProvenances(): IProvenance[] {
    return Array.from(this.provenances.values());
  }

  /**
   * Get all sources
   */
  getAllSources(): ISource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get provenances by domain
   */
  getProvenancesByDomain(domain: string): IProvenance[] {
    return Array.from(this.provenances.values()).filter(p => p.domain === domain);
  }

  /**
   * Find sources similar to an embedding
   *
   * @param embedding - Query embedding (VECTOR_DIM (1536D))
   * @param k - Number of results
   * @returns Similar sources with scores
   */
  async findSimilarSources(
    embedding: Float32Array,
    k: number = 5
  ): Promise<Array<{ source: ISource; similarity: number }>> {
    validateEmbedding(embedding, 'ProvenanceStore.findSimilarSources()');

    const results = await this.vectorDB.search(embedding, k);
    const sources: Array<{ source: ISource; similarity: number }> = [];

    // Find sources by vectorId
    for (const result of results) {
      for (const source of this.sources.values()) {
        if (source.vectorId === result.id) {
          sources.push({
            source,
            similarity: result.similarity,
          });
          break;
        }
      }
    }

    return sources;
  }

  /**
   * Get child provenances (provenances that have this as parent)
   */
  getChildProvenances(provenanceId: ProvenanceID): IProvenance[] {
    return Array.from(this.provenances.values()).filter(
      p => p.parentProvenanceId === provenanceId
    );
  }

  /**
   * Get statistics about the provenance store
   */
  getStats(): {
    sourceCount: number;
    provenanceCount: number;
    avgDepth: number;
    domainDistribution: Record<string, number>;
  } {
    const provenances = Array.from(this.provenances.values());
    const domains: Record<string, number> = {};

    let totalDepth = 0;
    for (const p of provenances) {
      totalDepth += p.depth;
      const domain = p.domain || 'default';
      domains[domain] = (domains[domain] || 0) + 1;
    }

    return {
      sourceCount: this.sources.size,
      provenanceCount: this.provenances.size,
      avgDepth: provenances.length > 0 ? totalDepth / provenances.length : 0,
      domainDistribution: domains,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.sources.clear();
    this.provenances.clear();
  }

  /**
   * Export to JSON for persistence
   */
  toJSON(): { sources: ISerializedSource[]; provenances: ISerializedProvenance[] } {
    const sources: ISerializedSource[] = Array.from(this.sources.values()).map(s => ({
      id: s.id,
      type: s.type,
      title: s.title,
      authors: s.authors,
      url: s.url,
      publishedDate: s.publishedDate?.toISOString(),
      location: s.location,
      relevanceScore: s.relevanceScore,
      vectorId: s.vectorId,
      metadata: s.metadata,
      createdAt: s.createdAt.toISOString(),
    }));

    const provenances: ISerializedProvenance[] = Array.from(this.provenances.values()).map(p => ({
      id: p.id,
      sourceIds: p.sourceIds,
      derivationPath: p.derivationPath,
      parentProvenanceId: p.parentProvenanceId,
      domain: p.domain,
      depth: p.depth,
      createdAt: p.createdAt.toISOString(),
    }));

    return { sources, provenances };
  }

  /**
   * Import from JSON
   */
  fromJSON(data: { sources: ISerializedSource[]; provenances: ISerializedProvenance[] }): void {
    this.clear();

    // Import sources
    for (const s of data.sources) {
      const source: ISource = {
        id: s.id,
        type: s.type,
        title: s.title,
        authors: s.authors,
        url: s.url,
        publishedDate: s.publishedDate ? new Date(s.publishedDate) : undefined,
        location: s.location,
        relevanceScore: s.relevanceScore,
        vectorId: s.vectorId,
        metadata: s.metadata,
        createdAt: new Date(s.createdAt),
      };
      this.sources.set(s.id, source);
    }

    // Import provenances
    for (const p of data.provenances) {
      const provenance: IProvenance = {
        id: p.id,
        sourceIds: p.sourceIds,
        derivationPath: p.derivationPath,
        parentProvenanceId: p.parentProvenanceId,
        domain: p.domain,
        depth: p.depth,
        createdAt: new Date(p.createdAt),
      };
      this.provenances.set(p.id, provenance);
    }
  }
}
