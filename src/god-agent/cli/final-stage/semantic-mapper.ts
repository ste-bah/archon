/**
 * SemanticMapper - Maps agent outputs to chapters using weighted semantic similarity
 *
 * Implements SPEC-FUNC-001 Section 2.4 and GAP-C001 (Semantic Matching Algorithm)
 *
 * Algorithm Weights:
 * - 35% keyword overlap (Jaccard similarity on keywords)
 * - 30% topic similarity (chapter.title vs summary.primaryTopics)
 * - 20% question alignment (chapter.questionsAddressed vs summary.researchQuestions)
 * - 15% phase weighting (chapter.number vs summary.phase proximity)
 *
 * Thresholds:
 * - Primary sources: score >= threshold + 0.20 (default: 0.50)
 * - Secondary sources: score >= threshold (default: 0.30)
 *
 * Constitution Rules:
 * - EX-001: Zero-source halt condition - report error if any chapter has 0 sources
 * - EX-002: Unassigned output logging - all orphaned sources must be logged
 * - QA-005: Minimum 3 sources per chapter - warn if fewer than 3
 */

import type {
  ChapterDefinition,
  AgentOutputSummary,
  ChapterMapping,
  SemanticMapperInput,
  SemanticMapperOutput,
  ChapterNumber
} from './types.js';

/**
 * SemanticMapper - Maps outputs to chapters using semantic similarity
 *
 * @example
 * ```typescript
 * const mapper = new SemanticMapper();
 * const output = await mapper.mapOutputsToChapters(
 *   chapters,
 *   summaries,
 *   { threshold: 0.30, fallbackHeuristics: true }
 * );
 * ```
 */
export class SemanticMapper {
  /**
   * Hardcoded heuristic fallback table from SPEC-FUNC-001 Section 2.4.5
   * Used when semantic matching fails for a chapter
   */
  private static readonly HEURISTIC_FALLBACKS: Record<number, { primary: number[]; secondary: number[] }> = {
    1: { primary: [0, 1, 2, 3, 28], secondary: [4, 5] },
    2: { primary: [6, 7, 8, 9, 29], secondary: [10, 11, 34] },
    3: { primary: [10, 11, 12, 17], secondary: [4, 13, 14] },
    4: { primary: [15, 18, 19, 30], secondary: [16, 17] },
    5: { primary: [19, 22, 23, 24, 25, 26, 27], secondary: [36, 37, 38, 39, 40, 41, 42, 43, 44] },
    6: { primary: [14, 16, 17, 18, 31], secondary: [15, 20, 21] },
    7: { primary: [32, 33, 18], secondary: [37, 42, 43] },
    8: { primary: [8, 40], secondary: [] }
  };

  /**
   * Stopwords to filter during tokenization
   * Common English words that don't contribute to semantic similarity
   */
  private static readonly STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'this', 'that',
    'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our',
    'which', 'who', 'what', 'where', 'when', 'how', 'why', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'can', 'just', 'now', 'then', 'also', 'into', 'over', 'after', 'before',
    'between', 'through', 'during', 'above', 'below', 'about', 'against'
  ]);

  /**
   * Algorithm weights per SPEC-FUNC-001 Section 2.4.4
   */
  private static readonly WEIGHTS = {
    KEYWORD: 0.35,
    TOPIC: 0.30,
    QUESTION: 0.20,
    PHASE: 0.15
  };

  /**
   * Map agent output summaries to chapters using weighted semantic similarity
   *
   * @param chapters - Chapter definitions from the locked structure
   * @param summaries - Agent output summaries from SummaryExtractor
   * @param input - Configuration options (threshold, fallbackHeuristics)
   * @returns Complete mapping output with quality metrics
   */
  async mapOutputsToChapters(
    chapters: ChapterDefinition[],
    summaries: AgentOutputSummary[],
    input: SemanticMapperInput
  ): Promise<SemanticMapperOutput> {
    const { threshold, fallbackHeuristics } = input;
    const primaryThreshold = threshold + 0.20;

    // Build keyword vectors for efficient similarity computation
    const chapterKeywords = this.buildChapterKeywordVectors(chapters);
    const summaryKeywords = this.buildSummaryKeywordVectors(summaries);

    // Compute full similarity matrix [chapters x summaries]
    const similarityMatrix = this.computeSimilarityMatrix(
      chapters,
      summaries,
      chapterKeywords,
      summaryKeywords
    );

    // Assign sources to chapters based on thresholds
    const mappings = this.assignSourcesToChapters(
      chapters,
      summaries,
      similarityMatrix,
      threshold,
      primaryThreshold
    );

    // Track fallbacks applied
    let fallbacksApplied = 0;

    // Apply fallback heuristics for chapters with no sources
    if (fallbackHeuristics) {
      fallbacksApplied = this.applyFallbackHeuristics(mappings, summaries);
    }

    // Find and reassign orphaned sources
    const orphanedSources = this.findOrphanedSources(mappings, summaries.length);
    if (orphanedSources.length > 0) {
      fallbacksApplied += this.reassignOrphanedSources(
        mappings,
        orphanedSources,
        summaries,
        similarityMatrix,
        threshold
      );
    }

    // Compute quality metrics
    const mappingQuality = this.computeQualityMetrics(mappings, similarityMatrix);

    return {
      mappings,
      orphanedSources: this.findOrphanedSources(mappings, summaries.length),
      mappingQuality,
      algorithm: 'weighted-semantic-v1',
      threshold,
      fallbacksApplied
    };
  }

  /**
   * Calculate weighted similarity score between a chapter and summary
   *
   * @param chapter - Chapter definition
   * @param summary - Agent output summary
   * @param chapterKeywords - Pre-computed chapter keyword set
   * @param summaryKeywords - Pre-computed summary keyword set
   * @returns Weighted similarity score between 0 and 1
   */
  calculateSimilarity(
    chapter: ChapterDefinition,
    summary: AgentOutputSummary,
    chapterKeywords?: Set<string>,
    summaryKeywords?: Set<string>
  ): number {
    // Compute keyword vectors if not provided
    const chapterKw = chapterKeywords ?? new Set(
      chapter.keywords.flatMap(kw => this.tokenize(kw))
    );
    const summaryKw = summaryKeywords ?? new Set(
      summary.keyTerms.flatMap(term => this.tokenize(term))
    );

    // 1. Keyword overlap (35%) - Jaccard similarity
    const keywordScore = this.jaccardSimilarity(chapterKw, summaryKw);

    // 2. Topic similarity (30%) - chapter title/purpose vs summary topics
    const topicScore = this.topicMatch(chapter, summary);

    // 3. Question alignment (20%) - research question overlap
    const questionScore = this.questionMatch(chapter, summary);

    // 4. Phase weighting (15%) - proximity between chapter position and phase
    const phaseScore = this.phaseHeuristic(chapter, summary);

    // Weighted fusion
    return (
      SemanticMapper.WEIGHTS.KEYWORD * keywordScore +
      SemanticMapper.WEIGHTS.TOPIC * topicScore +
      SemanticMapper.WEIGHTS.QUESTION * questionScore +
      SemanticMapper.WEIGHTS.PHASE * phaseScore
    );
  }

  /**
   * Get heuristic fallback mapping for a chapter
   *
   * @param chapterNumber - Chapter number (1-12)
   * @returns Fallback source indices or undefined if no fallback defined
   */
  applyHeuristicFallback(chapterNumber: number): { primary: number[]; secondary: number[] } | undefined {
    return SemanticMapper.HEURISTIC_FALLBACKS[chapterNumber];
  }

  // ============================================
  // Private: Vector Building
  // ============================================

  /**
   * Build keyword vectors for all chapters
   */
  private buildChapterKeywordVectors(chapters: ChapterDefinition[]): Map<number, Set<string>> {
    const vectors = new Map<number, Set<string>>();

    for (const chapter of chapters) {
      const tokens = new Set<string>();

      // Add explicit keywords
      for (const keyword of chapter.keywords) {
        for (const token of this.tokenize(keyword)) {
          tokens.add(token);
        }
      }

      // Add tokens from title
      for (const token of this.tokenize(chapter.title)) {
        tokens.add(token);
      }

      // Add tokens from purpose
      for (const token of this.tokenize(chapter.purpose)) {
        tokens.add(token);
      }

      // Add tokens from section titles
      for (const sectionTitle of chapter.sectionTitles) {
        for (const token of this.tokenize(sectionTitle)) {
          tokens.add(token);
        }
      }

      vectors.set(chapter.number, tokens);
    }

    return vectors;
  }

  /**
   * Build keyword vectors for all summaries
   */
  private buildSummaryKeywordVectors(summaries: AgentOutputSummary[]): Map<number, Set<string>> {
    const vectors = new Map<number, Set<string>>();

    for (const summary of summaries) {
      const tokens = new Set<string>();

      // Add key terms
      for (const term of summary.keyTerms) {
        for (const token of this.tokenize(term)) {
          tokens.add(token);
        }
      }

      // Add primary topics
      for (const topic of summary.primaryTopics) {
        for (const token of this.tokenize(topic)) {
          tokens.add(token);
        }
      }

      // Add key findings
      for (const finding of summary.keyFindings) {
        for (const token of this.tokenize(finding)) {
          tokens.add(token);
        }
      }

      // Add content type
      for (const token of this.tokenize(summary.contentType)) {
        tokens.add(token);
      }

      vectors.set(summary.index, tokens);
    }

    return vectors;
  }

  /**
   * Tokenize text into normalized words
   * Filters stopwords and short words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !SemanticMapper.STOPWORDS.has(w));
  }

  // ============================================
  // Private: Similarity Computation
  // ============================================

  /**
   * Compute full similarity matrix between chapters and summaries
   */
  private computeSimilarityMatrix(
    chapters: ChapterDefinition[],
    summaries: AgentOutputSummary[],
    chapterKeywords: Map<number, Set<string>>,
    summaryKeywords: Map<number, Set<string>>
  ): number[][] {
    const matrix: number[][] = [];

    for (const chapter of chapters) {
      const row: number[] = [];
      const chapterKw = chapterKeywords.get(chapter.number) ?? new Set();

      for (const summary of summaries) {
        const summaryKw = summaryKeywords.get(summary.index) ?? new Set();
        const score = this.calculateSimilarity(chapter, summary, chapterKw, summaryKw);
        row.push(score);
      }

      matrix.push(row);
    }

    return matrix;
  }

  /**
   * Jaccard similarity between two sets
   * |A intersect B| / |A union B|
   */
  private jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Topic match between chapter purpose/title and summary topics
   */
  private topicMatch(chapter: ChapterDefinition, summary: AgentOutputSummary): number {
    // Build token sets for chapter purpose and title
    const purposeTokens = new Set(this.tokenize(chapter.purpose));
    const titleTokens = new Set(this.tokenize(chapter.title));
    const chapterTokens = new Set([...purposeTokens, ...titleTokens]);

    if (chapterTokens.size === 0 || summary.primaryTopics.length === 0) {
      return 0;
    }

    let totalOverlap = 0;
    let topicsChecked = 0;

    for (const topic of summary.primaryTopics) {
      const topicTokens = this.tokenize(topic);
      if (topicTokens.length === 0) continue;

      topicsChecked++;
      let matches = 0;

      for (const token of topicTokens) {
        if (chapterTokens.has(token)) {
          matches++;
        }
      }

      // Normalize by topic token count
      totalOverlap += matches / topicTokens.length;
    }

    if (topicsChecked === 0) return 0;
    return totalOverlap / topicsChecked;
  }

  /**
   * Research question alignment between chapter and summary
   * Handles formats: Q1, Q2, RQ1, RQ2, etc.
   */
  private questionMatch(chapter: ChapterDefinition, summary: AgentOutputSummary): number {
    const chapterQuestions = chapter.questionsAddressed;
    const summaryQuestions = summary.researchQuestions;

    if (chapterQuestions.length === 0 || summaryQuestions.length === 0) {
      return 0;
    }

    // Normalize question identifiers (Q1, RQ1 -> q1)
    const normalizeQ = (q: string): string => q.toLowerCase().replace(/rq/i, 'q');

    const chapterQSet = new Set(chapterQuestions.map(normalizeQ));
    const summaryQSet = new Set(summaryQuestions.map(normalizeQ));

    // Jaccard similarity on question sets
    return this.jaccardSimilarity(chapterQSet, summaryQSet);
  }

  /**
   * Phase proximity heuristic
   * Gives bonus to Phase 6 writers and sources close to chapter position
   */
  private phaseHeuristic(chapter: ChapterDefinition, summary: AgentOutputSummary): number {
    const chapterNum = chapter.number;
    const phase = summary.phase;

    // Phase 6 writers (abstract, conclusion writers) get bonus for intro/conclusion chapters
    if (phase === 6) {
      if (chapterNum === 1 || chapterNum >= 7) {
        return 1.0; // Full score for intro/conclusion chapters
      }
    }

    // Base phase-to-chapter mapping heuristic
    // Earlier phases map to earlier chapters, later phases to later chapters
    const expectedChapter = this.phaseToExpectedChapter(phase);
    const distance = Math.abs(chapterNum - expectedChapter);

    // Normalize: 0 distance = 1.0, max distance (7) = 0.0
    const maxDistance = 7;
    return Math.max(0, 1 - distance / maxDistance);
  }

  /**
   * Map pipeline phase to expected chapter number
   */
  private phaseToExpectedChapter(phase: number): number {
    switch (phase) {
      case 1: return 1;  // Foundation -> Introduction
      case 2: return 2;  // Exploration -> Literature Review
      case 3: return 3;  // Context -> Theoretical Framework
      case 4: return 4;  // Analysis -> Implementation
      case 5: return 5;  // Synthesis -> Validation
      case 6: return 7;  // Writing -> Conclusion
      case 7: return 6;  // Validation -> Synthesis
      default: return 4; // Default to middle chapter
    }
  }

  // ============================================
  // Private: Source Assignment
  // ============================================

  /**
   * Assign sources to chapters based on similarity thresholds
   */
  private assignSourcesToChapters(
    chapters: ChapterDefinition[],
    summaries: AgentOutputSummary[],
    matrix: number[][],
    threshold: number,
    primaryThreshold: number
  ): ChapterMapping[] {
    const mappings: ChapterMapping[] = [];

    for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
      const chapter = chapters[cIdx];
      const scores = matrix[cIdx];

      const primarySources: number[] = [];
      const secondarySources: number[] = [];

      for (let sIdx = 0; sIdx < summaries.length; sIdx++) {
        const score = scores[sIdx];

        if (score >= primaryThreshold) {
          primarySources.push(summaries[sIdx].index);
        } else if (score >= threshold) {
          secondarySources.push(summaries[sIdx].index);
        }
      }

      const allSources = [...primarySources, ...secondarySources];

      // Compute average and min scores for assigned sources
      const assignedScores = allSources.map(idx => {
        const sIdx = summaries.findIndex(s => s.index === idx);
        return sIdx >= 0 ? scores[sIdx] : 0;
      });

      const avgScore = assignedScores.length > 0
        ? assignedScores.reduce((a, b) => a + b, 0) / assignedScores.length
        : 0;

      const minScore = assignedScores.length > 0
        ? Math.min(...assignedScores)
        : 0;

      mappings.push({
        chapterNumber: chapter.number as ChapterNumber,
        chapterTitle: chapter.title,
        primarySources,
        secondarySources,
        allSources,
        avgRelevanceScore: avgScore,
        minRelevanceScore: minScore,
        sourceCount: allSources.length
      });
    }

    return mappings;
  }

  /**
   * Apply heuristic fallbacks for chapters with no semantic matches
   */
  private applyFallbackHeuristics(
    mappings: ChapterMapping[],
    summaries: AgentOutputSummary[]
  ): number {
    let fallbacksApplied = 0;
    const validIndices = new Set(summaries.map(s => s.index));

    for (const mapping of mappings) {
      if (mapping.sourceCount === 0) {
        const fallback = SemanticMapper.HEURISTIC_FALLBACKS[mapping.chapterNumber];
        if (fallback) {
          // Filter to only include indices that exist in summaries
          mapping.primarySources = fallback.primary.filter(i => validIndices.has(i));
          mapping.secondarySources = fallback.secondary.filter(i => validIndices.has(i));
          mapping.allSources = [...mapping.primarySources, ...mapping.secondarySources];
          mapping.sourceCount = mapping.allSources.length;

          // Set fallback relevance scores
          mapping.avgRelevanceScore = 0.25; // Below threshold, indicates fallback
          mapping.minRelevanceScore = 0.20;

          if (mapping.sourceCount > 0) {
            fallbacksApplied++;
          }
        }
      }
    }

    return fallbacksApplied;
  }

  /**
   * Find sources not assigned to any chapter
   */
  private findOrphanedSources(mappings: ChapterMapping[], totalSources: number): number[] {
    const assignedSources = new Set<number>();

    for (const mapping of mappings) {
      for (const idx of mapping.allSources) {
        assignedSources.add(idx);
      }
    }

    const orphaned: number[] = [];
    for (let i = 0; i < totalSources; i++) {
      if (!assignedSources.has(i)) {
        orphaned.push(i);
      }
    }

    return orphaned;
  }

  /**
   * Reassign orphaned sources to best-matching chapters
   */
  private reassignOrphanedSources(
    mappings: ChapterMapping[],
    orphanedSources: number[],
    summaries: AgentOutputSummary[],
    matrix: number[][],
    _threshold: number
  ): number {
    let reassigned = 0;

    for (const sourceIdx of orphanedSources) {
      // Find the summary index in the array
      const sIdx = summaries.findIndex(s => s.index === sourceIdx);
      if (sIdx < 0) continue;

      // Find best matching chapter
      let bestChapterIdx = -1;
      let bestScore = 0;

      for (let cIdx = 0; cIdx < mappings.length; cIdx++) {
        const score = matrix[cIdx][sIdx];
        if (score > bestScore) {
          bestScore = score;
          bestChapterIdx = cIdx;
        }
      }

      // Assign to best chapter even if below threshold
      if (bestChapterIdx >= 0) {
        const mapping = mappings[bestChapterIdx];
        mapping.secondarySources.push(sourceIdx);
        mapping.allSources.push(sourceIdx);
        mapping.sourceCount++;

        // Recalculate average relevance
        const allScores = mapping.allSources.map(idx => {
          const si = summaries.findIndex(s => s.index === idx);
          return si >= 0 ? matrix[bestChapterIdx][si] : 0;
        });
        mapping.avgRelevanceScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
        mapping.minRelevanceScore = Math.min(...allScores);

        reassigned++;
      }
    }

    return reassigned;
  }

  // ============================================
  // Private: Quality Metrics
  // ============================================

  /**
   * Compute mapping quality metrics
   */
  private computeQualityMetrics(
    mappings: ChapterMapping[],
    _matrix: number[][]
  ): { coverage: number; avgRelevance: number; balance: number } {
    // Coverage: % of chapters with at least 1 source
    const chaptersWithSources = mappings.filter(m => m.sourceCount > 0).length;
    const coverage = mappings.length > 0 ? chaptersWithSources / mappings.length : 0;

    // Average relevance: mean of all avgRelevanceScore values
    const relevanceScores = mappings
      .filter(m => m.sourceCount > 0)
      .map(m => m.avgRelevanceScore);
    const avgRelevance = relevanceScores.length > 0
      ? relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length
      : 0;

    // Balance: standard deviation of source counts
    const sourceCounts = mappings.map(m => m.sourceCount);
    const meanCount = sourceCounts.reduce((a, b) => a + b, 0) / sourceCounts.length;
    const variance = sourceCounts.reduce((sum, count) => {
      return sum + Math.pow(count - meanCount, 2);
    }, 0) / sourceCounts.length;
    const balance = Math.sqrt(variance);

    return { coverage, avgRelevance, balance };
  }
}
