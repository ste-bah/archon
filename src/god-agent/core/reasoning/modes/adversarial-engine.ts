/**
 * Adversarial Reasoning Engine
 * SPEC-RSN-002 Section 2.5 - Adversarial Reasoning Mode
 *
 * Implements failure mode and security vulnerability detection using:
 * - Shadow Vector Search for contradiction/vulnerability detection
 * - Causal inference for attack scenario generation
 * - Pattern matching for failure patterns and countermeasures
 *
 * Performance target: <180ms including shadow search
 */

import type { VectorDB } from '../../vector-db/vector-db.js';
import type { CausalMemory } from '../causal-memory.js';
import type { PatternMatcher } from '../pattern-matcher.js';
import type { IReasoningRequest, ReasoningMode, IPatternMatch, IInferenceResult, IProvenanceInfo } from '../reasoning-types.js';
import type {
  AdversarialConfig,
  IAdversarialResult,
  Contradiction,
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';
import type {
  IShadowSearchOptions,
  IContradiction,
} from '../shadow-types.js';
import { ShadowVectorSearch } from '../shadow-vector-search.js';
import type { NodeID } from '../causal-types.js';
import { TaskType } from '../pattern-types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../../observability/index.js';

const logger = createComponentLogger('AdversarialEngine', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

// ==================== Adversarial-Specific Types ====================

/**
 * Target system information parsed from query
 */
interface TargetInfo {
  /** Type of target (code, system, design, etc.) */
  type: 'code' | 'system' | 'api' | 'design' | 'architecture';
  /** Description of the target */
  description: string;
  /** Embedding of target description */
  embedding: Float32Array;
  /** Context metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Failure pattern found in knowledge base
 */
interface FailurePattern {
  /** Pattern ID */
  id: string;
  /** Type of failure */
  type: string;
  /** Description of failure mode */
  description: string;
  /** Severity (0-1) */
  severity: number;
  /** Common causes */
  causes: string[];
  /** Pattern embedding */
  embedding?: Float32Array;
}

/**
 * Attack scenario generated from causal inference
 */
interface AttackScenario {
  /** Attack vector used */
  attackVector: string;
  /** Steps in the attack chain */
  attackChain: Array<{
    step: number;
    action: string;
    nodeId?: NodeID;
  }>;
  /** Potential impact */
  impact: string;
  /** Exploitability score (0-1) */
  exploitability: number;
  /** Severity of impact (0-1) */
  severity: number;
}

/**
 * Threat combining failure patterns and attack scenarios
 */
interface Threat {
  /** Unique threat ID */
  id: string;
  /** Threat type */
  type: 'failure' | 'vulnerability' | 'contradiction';
  /** Description */
  description: string;
  /** Severity (0-1) */
  severity: number;
  /** Exploitability (0-1) - only for vulnerabilities */
  exploitability?: number;
  /** Source (failure pattern, attack scenario, or contradiction) */
  source: FailurePattern | AttackScenario | IContradiction;
}

/**
 * Ranked threat with combined score
 */
interface RankedThreat extends Threat {
  /** Combined threat score (0-1) */
  threatScore: number;
  /** Ranking position */
  rank: number;
}

/**
 * Countermeasure for a threat
 */
interface Countermeasure {
  /** Threat ID this addresses */
  threatId: string;
  /** Countermeasure description */
  description: string;
  /** Effectiveness (0-1) */
  effectiveness: number;
  /** Implementation complexity (0-1, higher = more complex) */
  complexity: number;
}

// ==================== Engine Dependencies ====================

export interface AdversarialEngineDependencies {
  vectorDB: VectorDB;
  causalMemory: CausalMemory;
  patternMatcher: PatternMatcher;
}

// ==================== Adversarial Reasoning Engine ====================

/**
 * Adversarial Reasoning Engine
 *
 * Identifies security vulnerabilities, failure modes, and edge cases using
 * shadow vector search and causal inference.
 */
export class AdversarialEngine {
  private vectorDB: VectorDB;
  private causalMemory: CausalMemory;
  private patternMatcher: PatternMatcher;
  private shadowSearch: ShadowVectorSearch;

  constructor(deps: AdversarialEngineDependencies) {
    this.vectorDB = deps.vectorDB;
    this.causalMemory = deps.causalMemory;
    this.patternMatcher = deps.patternMatcher;

    // Initialize shadow vector search with VectorDB adapter
    this.shadowSearch = new ShadowVectorSearch({ verbose: false });
    this.shadowSearch.setVectorStore(this.createVectorStoreAdapter());
  }

  /**
   * Perform adversarial reasoning to identify vulnerabilities and failure modes
   *
   * Algorithm:
   * 1. Parse target system/code from query
   * 2. Retrieve failure patterns and security anti-patterns
   * 3. Use Shadow Vector Search for contradiction/vulnerability detection
   * 4. Generate attack scenarios using causal inference
   * 5. Rank by severity and exploitability
   * 6. Optionally add countermeasures
   *
   * @param request Reasoning request
   * @param config Adversarial configuration
   * @returns Adversarial result with ranked contradictions/vulnerabilities
   */
  async reason(
    request: IReasoningRequest,
    config: AdversarialConfig
  ): Promise<IAdversarialResult> {
    const startTime = Date.now();

    // 1. Parse target from query
    const target = this.parseTarget(request);

    // 2. Find failure patterns
    const taskTypes = this.inferTaskTypes(config.threatModel ?? 'adversarial');
    const failurePatterns = await this.findFailurePatterns(
      request.query,
      taskTypes
    );

    // 3. Shadow vector search for contradictions/vulnerabilities
    const shadowOptions: IShadowSearchOptions = {
      type: 'contradiction',
      threshold: config.severityThreshold ?? 0.3,
      k: config.maxContradictions ?? 10,
      includeHypothesisSimilarity: true,
    };

    const shadowContradictions = await this.shadowVectorSearch(
      request.query,
      shadowOptions
    );

    // 4. Generate attack scenarios
    const attackVectors = config.attackVectors ?? ['logical', 'empirical', 'semantic'];
    const attackScenarios = await this.generateAttackScenarios(
      target,
      attackVectors
    );

    // 5. Combine into threats and rank
    const threats = this.combineThreats(
      failurePatterns,
      shadowContradictions,
      attackScenarios
    );

    const rankedThreats = this.rankThreats(
      threats,
      config.severityThreshold ?? 0.3
    );

    // 6. Generate countermeasures if requested
    const countermeasures = config.includeCountermeasures !== false
      ? await this.generateCountermeasures(rankedThreats)
      : undefined;

    // 7. Convert to contradictions format
    const contradictions = this.toContradictions(rankedThreats, countermeasures);

    const elapsedTime = Date.now() - startTime;

    // Generate trajectory ID for tracking
    const trajectoryId = `traj_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Calculate overall confidence
    const confidence = this.calculateConfidence(rankedThreats);

    // Create provenance info
    const lScores = rankedThreats.map(t => t.threatScore);
    const combinedLScore = lScores.length > 0
      ? Math.pow(lScores.reduce((prod, score) => prod * score, 1), 1 / lScores.length)
      : 0;

    const provenanceInfo = {
      lScores,
      totalSources: rankedThreats.length,
      combinedLScore,
      sourceBreakdown: {
        patterns: failurePatterns.length,
        causal: attackScenarios.length,
        contextual: shadowContradictions.length,
      },
    };

    // Build result with all required IAdvancedReasoningResult fields
    return {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.ADVERSARIAL,
      answer: this.formatAdversarialReport(rankedThreats, target),
      reasoningSteps: this.generateReasoningSteps(rankedThreats, failurePatterns, attackScenarios),
      latencyMs: elapsedTime,
      confidence,

      // IReasoningResponse fields (from base interface)
      type: 'hybrid' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId,
      processingTimeMs: elapsedTime,
      provenanceInfo: provenanceInfo as IProvenanceInfo,

      // Mode-specific field
      contradictions,
    };
  }

  /**
   * Generate reasoning steps for adversarial analysis
   */
  private generateReasoningSteps(
    threats: RankedThreat[],
    failurePatterns: FailurePattern[],
    attackScenarios: AttackScenario[]
  ): string[] {
    return [
      `Analyzed ${failurePatterns.length} failure patterns from knowledge base`,
      `Generated ${attackScenarios.length} attack scenarios`,
      `Identified ${threats.length} potential threats`,
      `High severity threats: ${threats.filter(t => t.severity > 0.7).length}`,
      `Applied shadow vector search for contradiction detection`,
    ];
  }

  /**
   * Parse target system/code from query
   */
  private parseTarget(request: IReasoningRequest): TargetInfo {
    // For IReasoningRequest, query is a Float32Array (embedding)
    // We need to infer from metadata or use a generic description
    const taskTypeStr = request.taskType ? String(request.taskType) : 'system';
    let type: TargetInfo['type'] = 'system';

    if (taskTypeStr.includes('code') || taskTypeStr.includes('debugging')) {
      type = 'code';
    } else if (taskTypeStr.includes('api')) {
      type = 'api';
    } else if (taskTypeStr.includes('design')) {
      type = 'design';
    } else if (taskTypeStr.includes('architecture')) {
      type = 'architecture';
    }

    return {
      type,
      description: `${type} analysis for ${taskTypeStr}`,
      embedding: request.query,
      metadata: { taskType: request.taskType },
    };
  }

  /**
   * Infer task types based on threat model
   */
  private inferTaskTypes(threatModel: 'cooperative' | 'adversarial' | 'skeptical'): TaskType[] {
    // Map threat models to standard TaskTypes
    switch (threatModel) {
      case 'adversarial':
        return [TaskType.DEBUGGING, TaskType.TESTING, TaskType.ANALYSIS];
      case 'skeptical':
        return [TaskType.ANALYSIS, TaskType.DEBUGGING];
      case 'cooperative':
      default:
        return [TaskType.TESTING, TaskType.DEBUGGING];
    }
  }

  /**
   * Search for failure patterns and security anti-patterns
   */
  private async findFailurePatterns(
    embedding: Float32Array,
    taskTypes: TaskType[]
  ): Promise<FailurePattern[]> {
    const patterns: FailurePattern[] = [];

    // Search for patterns of each type
    for (const taskType of taskTypes) {
      try {
        const results = await this.patternMatcher.findPatterns({
          embedding,
          taskType,
          topK: 5,
          minConfidence: 0.3,
        });

        // Convert pattern results to failure patterns
        for (const result of results) {
          patterns.push({
            id: result.pattern.id,
            type: String(taskType),
            description: result.pattern.template,
            severity: this.inferSeverity(String(taskType), result.confidence),
            causes: this.extractCauses(result.pattern.template),
            embedding: result.pattern.embedding,
          });
        }
      } catch (error) {
        // Pattern type might not exist, continue
        logger.warn('Failed to find patterns', { taskType, error: String(error) });
      }
    }

    return patterns;
  }

  /**
   * Perform shadow vector search for contradictions
   * Shadow vector = original vector × -1 (semantic opposite)
   */
  private async shadowVectorSearch(
    embedding: Float32Array,
    options: IShadowSearchOptions
  ): Promise<IContradiction[]> {
    try {
      return await this.shadowSearch.findContradictions(embedding, options);
    } catch (error) {
      logger.warn('Shadow vector search failed', { error: String(error) });
      return [];
    }
  }

  /**
   * Generate attack scenarios using causal inference
   */
  private async generateAttackScenarios(
    target: TargetInfo,
    attackVectors: string[]
  ): Promise<AttackScenario[]> {
    const scenarios: AttackScenario[] = [];

    for (const vector of attackVectors) {
      try {
        // Create a hypothetical attack node
        const attackNodeId = `attack:${vector}:${Date.now()}` as NodeID;

        // Use causal inference to explore consequences
        const inference = await this.causalMemory.inferConsequences(
          [attackNodeId],
          5 // maxDepth parameter
        );

        if (inference.effects && inference.effects.length > 0) {
          scenarios.push({
            attackVector: vector,
            attackChain: inference.effects.map((nodeId, idx) => ({
              step: idx + 1,
              action: `${vector} attack step ${idx + 1}`,
              nodeId,
            })),
            impact: this.inferImpact(inference.effects),
            exploitability: this.calculateExploitability(vector, inference.confidence),
            severity: inference.confidence,
          });
        }
      } catch (error) {
        // Causal inference might fail for unknown attack vectors
        logger.warn('Failed to generate scenario', { vector, error: String(error) });

        // Create a basic scenario without causal inference
        scenarios.push({
          attackVector: vector,
          attackChain: [
            { step: 1, action: `Initial ${vector} attack` },
            { step: 2, action: `Exploit ${vector} vulnerability` },
          ],
          impact: `Potential ${vector} attack impact on ${target.type}`,
          exploitability: 0.5,
          severity: 0.5,
        });
      }
    }

    return scenarios;
  }

  /**
   * Combine failure patterns, contradictions, and attack scenarios into threats
   */
  private combineThreats(
    failurePatterns: FailurePattern[],
    contradictions: IContradiction[],
    attackScenarios: AttackScenario[]
  ): Threat[] {
    const threats: Threat[] = [];

    // Add failure patterns as threats
    for (const pattern of failurePatterns) {
      threats.push({
        id: `failure:${pattern.id}`,
        type: 'failure',
        description: pattern.description,
        severity: pattern.severity,
        source: pattern,
      });
    }

    // Add contradictions as threats
    for (const contradiction of contradictions) {
      threats.push({
        id: `contradiction:${contradiction.documentId}`,
        type: 'contradiction',
        description: contradiction.claim,
        severity: contradiction.refutationStrength,
        source: contradiction,
      });
    }

    // Add attack scenarios as vulnerability threats
    for (const scenario of attackScenarios) {
      threats.push({
        id: `vulnerability:${scenario.attackVector}`,
        type: 'vulnerability',
        description: `${scenario.attackVector} attack: ${scenario.impact}`,
        severity: scenario.severity,
        exploitability: scenario.exploitability,
        source: scenario,
      });
    }

    return threats;
  }

  /**
   * Rank threats by severity and exploitability
   */
  private rankThreats(
    threats: Threat[],
    severityThreshold: number
  ): RankedThreat[] {
    // Calculate threat scores
    const scored = threats.map(threat => {
      // Score = (severity * 0.6) + (exploitability * 0.4)
      const exploitability = threat.exploitability ?? 0.5;
      const threatScore = (threat.severity * 0.6) + (exploitability * 0.4);

      return {
        ...threat,
        threatScore,
        rank: 0, // Will be set after sorting
      };
    });

    // Filter by threshold
    const filtered = scored.filter(t => t.severity >= severityThreshold);

    // Sort by threat score (descending)
    filtered.sort((a, b) => b.threatScore - a.threatScore);

    // Assign ranks
    return filtered.map((threat, idx) => ({
      ...threat,
      rank: idx + 1,
    }));
  }

  /**
   * Generate countermeasures for identified threats
   */
  private async generateCountermeasures(
    threats: RankedThreat[]
  ): Promise<Countermeasure[]> {
    const countermeasures: Countermeasure[] = [];

    for (const threat of threats.slice(0, 5)) { // Top 5 threats only
      try {
        // Search for defensive patterns using TESTING taskType
        const defensivePatterns = await this.patternMatcher.findPatterns({
          query: `countermeasure for ${threat.description}`,
          taskType: TaskType.TESTING,
          topK: 1,
          minConfidence: 0.3,
        });

        if (defensivePatterns.length > 0) {
          const pattern = defensivePatterns[0];
          countermeasures.push({
            threatId: threat.id,
            description: pattern.pattern.template,
            effectiveness: pattern.confidence,
            complexity: this.inferComplexity(pattern.pattern.template),
          });
        }
      } catch (error) {
        // Defensive patterns might not exist
        logger.warn('Failed to find countermeasure', { threatId: threat.id, error: String(error) });
      }
    }

    return countermeasures;
  }

  /**
   * Convert ranked threats to Contradiction format
   */
  private toContradictions(
    rankedThreats: RankedThreat[],
    countermeasures?: Countermeasure[]
  ): Contradiction[] {
    return rankedThreats.map(threat => {
      const countermeasure = countermeasures?.find(c => c.threatId === threat.id);

      return {
        claimId: `target:system`,
        counterClaimId: threat.id,
        conflictType: threat.type === 'contradiction' ? 'semantic' : 'logical',
        strength: threat.threatScore,
        evidence: {
          supporting: [], // Target system (assumed valid initially)
          contradicting: [threat.description],
        },
        resolution: this.inferResolution(threat),
        countermeasure: countermeasure?.description,
      };
    });
  }

  /**
   * Format adversarial analysis report
   */
  private formatAdversarialReport(
    rankedThreats: RankedThreat[],
    target: TargetInfo
  ): string {
    if (rankedThreats.length === 0) {
      return `No significant threats identified for ${target.type}: ${target.description}`;
    }

    const lines = [
      `Adversarial Analysis Report for ${target.type}:`,
      '',
      `Total Threats Identified: ${rankedThreats.length}`,
      '',
      'Top Threats:',
    ];

    for (const threat of rankedThreats.slice(0, 5)) {
      lines.push(
        `${threat.rank}. [${threat.type.toUpperCase()}] ${threat.description}`,
        `   Severity: ${threat.severity.toFixed(2)} | Threat Score: ${threat.threatScore.toFixed(2)}`
      );
      if (threat.exploitability !== undefined) {
        lines.push(`   Exploitability: ${threat.exploitability.toFixed(2)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Calculate overall confidence
   */
  private calculateConfidence(rankedThreats: RankedThreat[]): number {
    if (rankedThreats.length === 0) {
      return 0.5; // Neutral confidence if no threats found
    }

    // Confidence based on top threat score
    const topThreatScore = rankedThreats[0].threatScore;
    return Math.max(0.3, Math.min(0.95, topThreatScore));
  }

  // ==================== Helper Methods ====================

  /**
   * Infer severity from task type and confidence
   */
  private inferSeverity(taskType: string, confidence: number): number {
    const baseSeverity = taskType.includes('attack') ? 0.8 : 0.5;
    return Math.min(0.95, baseSeverity * confidence);
  }

  /**
   * Extract causes from pattern description
   */
  private extractCauses(description: string): string[] {
    // Simple heuristic: look for common cause indicators
    const causes: string[] = [];
    if (description.includes('due to')) {
      causes.push('pattern-identified-cause');
    }
    return causes;
  }

  /**
   * Infer impact from causal path
   */
  private inferImpact(path: NodeID[]): string {
    return `Potential cascade affecting ${path.length} components`;
  }

  /**
   * Calculate exploitability
   */
  private calculateExploitability(vector: string, confidence: number): number {
    const vectorWeights: Record<string, number> = {
      logical: 0.6,
      empirical: 0.7,
      semantic: 0.5,
      ethical: 0.4,
    };

    const baseExploitability = vectorWeights[vector] ?? 0.5;
    return Math.min(0.95, baseExploitability * confidence);
  }

  /**
   * Infer complexity from description
   */
  private inferComplexity(description: string): number {
    // Simple heuristic: longer descriptions = more complex
    const wordCount = description.split(/\s+/).length;
    return Math.min(0.9, wordCount / 50);
  }

  /**
   * Infer resolution strategy
   */
  private inferResolution(threat: RankedThreat): Contradiction['resolution'] {
    if (threat.severity > 0.8) {
      return 'reject_claim'; // Critical threat - reject target design
    } else if (threat.severity > 0.5) {
      return 'conditional'; // Moderate threat - conditional approval
    } else {
      return 'reject_counter'; // Low threat - likely false positive
    }
  }

  /**
   * Create VectorDB adapter for ShadowVectorSearch
   */
  private createVectorStoreAdapter() {
    return {
      search: async (query: Float32Array, k: number) => {
        const results = await this.vectorDB.search(query, k);
        return results.map(r => ({
          id: r.id,
          similarity: r.similarity,
          vector: r.vector,
          metadata: {}, // SearchResult doesn't have metadata field
        }));
      },
      getVector: async (_id: string) => {
        // VectorDB doesn't have direct getVector, return null
        return null;
      },
    };
  }
}
