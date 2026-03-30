/**
 * Decomposition Reasoning Engine
 * RSN-002 Implementation - Problem Breakdown Mode
 *
 * Purpose: Break complex problems into manageable subproblems by TaskType
 *
 * Features:
 * - Hierarchical decomposition (top-down by abstraction)
 * - Sequential decomposition (by execution order)
 * - Parallel decomposition (independent subproblems)
 * - Adaptive strategy selection based on query complexity
 * - Topological sort for dependency resolution
 * - Solution aggregation from sub-results
 *
 * Dependencies:
 * - PatternMatcher: TaskType classification
 * - GraphDB: Optional dependency analysis
 *
 * Performance Target: <120ms latency
 */

import type { IReasoningRequest, ReasoningMode, IPatternMatch, IInferenceResult, IProvenanceInfo } from '../reasoning-types.js';
import type {
  DecompositionConfig,
  IDecompositionResult,
  Subproblem,
  DecompositionPlan
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';
import { TaskType } from '../pattern-types.js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Dependencies for DecompositionEngine
 */
export interface DecompositionEngineDependencies {
  /** Pattern matcher for TaskType classification */
  patternMatcher?: {
    classifyTaskType?(query: string): Promise<TaskType>;
    getPatternsByTaskType?(taskType: TaskType): Promise<unknown[]>;
  };

  /** Graph database for dependency analysis (optional) */
  graphDB?: {
    findRelatedNodes?(nodeId: string): Promise<unknown[]>;
  };
}

/**
 * Internal representation of parsed query segment
 */
interface QuerySegment {
  /** Segment text */
  text: string;
  /** Identified task type */
  taskType: TaskType;
  /** Estimated complexity */
  complexity: number;
  /** Keywords found */
  keywords: string[];
  /** Position in original query */
  position: number;
}

/**
 * Dependency edge between subproblems
 */
interface DependencyEdge {
  /** Source subproblem ID */
  from: string;
  /** Target subproblem ID */
  to: string;
  /** Dependency type */
  type: 'requires' | 'enhances' | 'validates';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Task type keywords for classification
 */
const TASK_TYPE_KEYWORDS: Record<TaskType, string[]> = {
  [TaskType.CODING]: [
    'implement', 'code', 'write', 'create', 'build', 'develop',
    'function', 'class', 'module', 'component', 'api', 'endpoint'
  ],
  [TaskType.DEBUGGING]: [
    'debug', 'fix', 'error', 'bug', 'issue', 'problem', 'crash',
    'exception', 'failure', 'broken', 'wrong', 'incorrect'
  ],
  [TaskType.ANALYSIS]: [
    'analyze', 'examine', 'investigate', 'study', 'review', 'assess',
    'evaluate', 'understand', 'explore', 'research', 'inspect'
  ],
  [TaskType.REFACTORING]: [
    'refactor', 'improve', 'clean', 'restructure', 'reorganize',
    'simplify', 'optimize', 'modernize', 'update', 'migrate'
  ],
  [TaskType.TESTING]: [
    'test', 'verify', 'validate', 'check', 'assert', 'expect',
    'unit test', 'integration', 'e2e', 'coverage', 'mock'
  ],
  [TaskType.DOCUMENTATION]: [
    'document', 'doc', 'readme', 'comment', 'explain', 'describe',
    'jsdoc', 'api doc', 'guide', 'tutorial', 'specification'
  ],
  [TaskType.PLANNING]: [
    'plan', 'design', 'architect', 'strategy', 'roadmap', 'outline',
    'scope', 'estimate', 'requirements', 'specification'
  ],
  [TaskType.OPTIMIZATION]: [
    'optimize', 'performance', 'speed', 'memory', 'efficient',
    'cache', 'bundle', 'minify', 'compress', 'lazy load'
  ]
};

/**
 * Conjunctions that indicate problem segments
 */
const SEGMENTATION_MARKERS = [
  'and then', 'then', 'after that', 'afterwards', 'next',
  'and', 'also', 'additionally', 'furthermore', 'moreover',
  'first', 'second', 'third', 'finally', 'lastly',
  'before', 'after', 'while', 'during', 'until'
];

// ============================================================================
// DECOMPOSITION ENGINE
// ============================================================================

/**
 * Decomposition reasoning engine
 *
 * Breaks down complex problems into manageable subproblems with:
 * - Strategy-based decomposition (hierarchical, sequential, parallel, adaptive)
 * - Dependency analysis and topological sorting
 * - Parallelization opportunities identification
 * - Solution aggregation
 *
 * @example
 * ```typescript
 * const engine = new DecompositionEngine({ patternMatcher });
 * const result = await engine.reason(
 *   { query: 'Build a REST API with auth, database, and tests' },
 *   { decompositionStrategy: 'adaptive', maxSubproblems: 10 }
 * );
 * // result.plan contains subproblems, executionOrder, parallelizationGroups
 * ```
 */
export class DecompositionEngine {
  constructor(_deps: DecompositionEngineDependencies) {
    // Dependencies reserved for future use
  }

  /**
   * Perform decomposition reasoning on a query
   *
   * @param request - The reasoning request containing the query
   * @param config - Decomposition configuration
   * @returns Decomposition result with execution plan
   */
  async reason(
    request: IReasoningRequest,
    config: DecompositionConfig
  ): Promise<IDecompositionResult> {
    const startTime = Date.now();
    // Query embedding is Float32Array - get query text from metadata if available
    const queryText = (request.metadata?.queryText as string) || 'decomposition query';

    // Apply defaults
    const effectiveConfig: Required<DecompositionConfig> = {
      decompositionStrategy: config.decompositionStrategy,
      maxSubproblems: config.maxSubproblems ?? 10,
      maxDepth: config.maxDepth ?? 3,
      aggregationMethod: config.aggregationMethod ?? 'weighted',
      minComplexity: config.minComplexity ?? 0.3,
      metadata: config.metadata ?? {}
    };

    // Analyze query complexity
    const queryComplexity = this.analyzeComplexity(queryText);

    // Select strategy if adaptive
    const strategy = effectiveConfig.decompositionStrategy === 'adaptive'
      ? this.selectBestStrategy(queryText, queryComplexity)
      : effectiveConfig.decompositionStrategy;

    // Identify subproblems based on strategy
    const subproblems = await this.identifySubproblems(
      queryText,
      strategy,
      effectiveConfig.maxSubproblems,
      effectiveConfig.minComplexity
    );

    // Analyze dependencies between subproblems
    const dependencies = this.analyzeDependencies(subproblems);

    // Determine execution order (topological sort)
    const executionOrder = this.determineExecutionOrder(subproblems, dependencies);

    // Identify parallelization groups
    const parallelizationGroups = this.identifyParallelGroups(
      subproblems,
      dependencies
    );

    // Calculate total complexity
    const totalComplexity = subproblems.reduce(
      (sum, sp) => sum + sp.estimatedComplexity,
      0
    ) / Math.max(subproblems.length, 1);

    // Build decomposition plan
    const plan: DecompositionPlan = {
      subproblems,
      executionOrder,
      parallelizationGroups,
      totalComplexity
    };

    const latencyMs = Date.now() - startTime;

    // Build result with all required IAdvancedReasoningResult fields
    const result: IDecompositionResult = {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.DECOMPOSITION,
      answer: this.formatPlanSummary(plan),
      reasoningSteps: this.generateReasoning(plan, strategy),
      latencyMs,
      confidence: this.calculatePlanConfidence(plan, queryComplexity),

      // IReasoningResponse fields (from base interface)
      type: 'hybrid' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: `traj_${Date.now()}_decomposition`,
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: subproblems.map(sp => 1 - sp.estimatedComplexity),
        totalSources: subproblems.length,
        combinedLScore: subproblems.length > 0
          ? subproblems.reduce((s, sp) => s + (1 - sp.estimatedComplexity), 0) / subproblems.length
          : 0.5
      } as IProvenanceInfo,

      // Mode-specific field
      plan
    };

    return result;
  }

  // ==========================================================================
  // COMPLEXITY ANALYSIS
  // ==========================================================================

  /**
   * Analyze the complexity of a query
   *
   * Factors:
   * - Query length
   * - Number of distinct concepts (nouns/verbs)
   * - Presence of conjunctions (and, or, then)
   * - Nested clauses
   *
   * @param query - Query to analyze
   * @returns Normalized complexity score [0, 1]
   */
  private analyzeComplexity(query: string): number {
    const scores: number[] = [];

    // 1. Length factor (normalized to 0-1, maxing out at ~500 chars)
    const lengthScore = Math.min(query.length / 500, 1);
    scores.push(lengthScore);

    // 2. Word count factor
    const words = query.split(/\s+/).filter(w => w.length > 0);
    const wordCountScore = Math.min(words.length / 100, 1);
    scores.push(wordCountScore);

    // 3. Conjunction count (indicates multiple concerns)
    const conjunctionCount = this.countConjunctions(query);
    const conjunctionScore = Math.min(conjunctionCount / 10, 1);
    scores.push(conjunctionScore * 1.5); // Weight conjunctions higher

    // 4. Task type diversity
    const taskTypes = this.identifyTaskTypes(query);
    const diversityScore = Math.min(taskTypes.size / Object.keys(TaskType).length, 1);
    scores.push(diversityScore * 1.5); // Weight diversity higher

    // 5. Nested clause detection (commas, parentheses, semicolons)
    const nestingIndicators = (query.match(/[,;()]/g) || []).length;
    const nestingScore = Math.min(nestingIndicators / 15, 1);
    scores.push(nestingScore);

    // 6. Question indicators (multiple questions = higher complexity)
    const questionCount = (query.match(/\?/g) || []).length;
    const questionScore = Math.min(questionCount / 5, 1);
    scores.push(questionScore);

    // Calculate weighted average
    const totalWeight = scores.length + 1; // +1 for the extra weights
    const weightedSum = scores.reduce((sum, s) => sum + s, 0);
    const complexity = weightedSum / totalWeight;

    return Math.min(Math.max(complexity, 0), 1);
  }

  /**
   * Count conjunctions in query
   */
  private countConjunctions(query: string): number {
    const lowerQuery = query.toLowerCase();
    let count = 0;

    for (const marker of SEGMENTATION_MARKERS) {
      const regex = new RegExp(`\\b${marker}\\b`, 'gi');
      const matches = lowerQuery.match(regex);
      if (matches) {
        count += matches.length;
      }
    }

    return count;
  }

  /**
   * Identify task types present in query
   */
  private identifyTaskTypes(query: string): Set<TaskType> {
    const lowerQuery = query.toLowerCase();
    const types = new Set<TaskType>();

    for (const [taskType, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerQuery.includes(keyword)) {
          types.add(taskType as TaskType);
          break;
        }
      }
    }

    return types;
  }

  // ==========================================================================
  // STRATEGY SELECTION
  // ==========================================================================

  /**
   * Select best decomposition strategy based on query characteristics
   *
   * @param query - The query to analyze
   * @param complexity - Pre-calculated complexity score
   * @returns Selected strategy
   */
  private selectBestStrategy(
    query: string,
    complexity: number
  ): 'hierarchical' | 'sequential' | 'parallel' {
    const lowerQuery = query.toLowerCase();

    // Check for sequential indicators
    const hasSequentialMarkers = SEGMENTATION_MARKERS
      .slice(0, 10) // 'then', 'after', 'next', etc.
      .some(m => lowerQuery.includes(m));

    // Check for parallel indicators
    const hasParallelMarkers = [
      'and', 'also', 'additionally', 'as well as', 'together with'
    ].some(m => lowerQuery.includes(m));

    // Check for hierarchical indicators
    const hasHierarchicalMarkers = [
      'system', 'architecture', 'structure', 'organize', 'layer',
      'component', 'module', 'service', 'breakdown'
    ].some(m => lowerQuery.includes(m));

    // Score each strategy
    const scores = {
      sequential: hasSequentialMarkers ? 0.8 : 0.3,
      parallel: hasParallelMarkers ? 0.7 : 0.2,
      hierarchical: hasHierarchicalMarkers ? 0.9 : 0.4
    };

    // Adjust based on complexity
    if (complexity > 0.7) {
      scores.hierarchical += 0.2; // Complex queries benefit from hierarchy
    } else if (complexity < 0.3) {
      scores.sequential += 0.2; // Simple queries can be sequential
    }

    // Select highest scoring strategy
    const maxScore = Math.max(...Object.values(scores));
    for (const [strategy, score] of Object.entries(scores)) {
      if (score === maxScore) {
        return strategy as 'hierarchical' | 'sequential' | 'parallel';
      }
    }

    return 'hierarchical'; // Default
  }

  // ==========================================================================
  // SUBPROBLEM IDENTIFICATION
  // ==========================================================================

  /**
   * Identify subproblems from query using specified strategy
   *
   * @param query - Query to decompose
   * @param strategy - Decomposition strategy
   * @param maxSubproblems - Maximum number of subproblems
   * @param minComplexity - Minimum complexity to be a subproblem
   * @returns Array of identified subproblems
   */
  private async identifySubproblems(
    query: string,
    strategy: 'hierarchical' | 'sequential' | 'parallel',
    maxSubproblems: number,
    minComplexity: number
  ): Promise<Subproblem[]> {
    // Parse query into segments
    const segments = this.parseQuerySegments(query);

    // Apply strategy-specific decomposition
    let subproblems: Subproblem[];

    switch (strategy) {
      case 'hierarchical':
        subproblems = this.decomposeHierarchical(segments, maxSubproblems);
        break;
      case 'sequential':
        subproblems = this.decomposeSequential(segments, maxSubproblems);
        break;
      case 'parallel':
        subproblems = this.decomposeParallel(segments, maxSubproblems);
        break;
      default:
        subproblems = this.decomposeHierarchical(segments, maxSubproblems);
    }

    // Filter out low-complexity subproblems (unless we'd have too few)
    const filtered = subproblems.filter(sp => sp.estimatedComplexity >= minComplexity);
    if (filtered.length >= 2) {
      return filtered.slice(0, maxSubproblems);
    }

    return subproblems.slice(0, maxSubproblems);
  }

  /**
   * Parse query into segments for decomposition
   */
  private parseQuerySegments(query: string): QuerySegment[] {
    const segments: QuerySegment[] = [];

    // Split by segmentation markers
    let parts = [query];
    for (const marker of SEGMENTATION_MARKERS) {
      const newParts: string[] = [];
      for (const part of parts) {
        const regex = new RegExp(`\\s*${marker}\\s*`, 'gi');
        const splitParts = part.split(regex).filter(p => p.trim().length > 0);
        newParts.push(...splitParts);
      }
      parts = newParts;
    }

    // If no splits, try sentence splitting
    if (parts.length === 1) {
      parts = query.split(/[.;]/).filter(p => p.trim().length > 10);
      if (parts.length === 0) {
        parts = [query];
      }
    }

    // Analyze each part
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i].trim();
      if (text.length < 5) continue;

      const taskType = this.classifyTaskType(text);
      const complexity = this.analyzeSegmentComplexity(text);
      const keywords = this.extractKeywords(text);

      segments.push({
        text,
        taskType,
        complexity,
        keywords,
        position: i
      });
    }

    return segments;
  }

  /**
   * Classify task type for a text segment
   */
  private classifyTaskType(text: string): TaskType {
    const lowerText = text.toLowerCase();
    let bestType = TaskType.ANALYSIS; // Default
    let bestScore = 0;

    for (const [taskType, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestType = taskType as TaskType;
      }
    }

    return bestType;
  }

  /**
   * Analyze complexity of a single segment
   */
  private analyzeSegmentComplexity(text: string): number {
    const words = text.split(/\s+/).length;
    const hasConditions = /if|when|unless|while/.test(text.toLowerCase());
    const hasMultipleConcepts = (text.match(/,/g) || []).length > 1;

    let complexity = Math.min(words / 30, 0.6);
    if (hasConditions) complexity += 0.2;
    if (hasMultipleConcepts) complexity += 0.2;

    return Math.min(complexity, 1);
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const lowerText = text.toLowerCase();
    const keywords: string[] = [];

    // Check all task type keywords
    for (const taskKeywords of Object.values(TASK_TYPE_KEYWORDS)) {
      for (const keyword of taskKeywords) {
        if (lowerText.includes(keyword)) {
          keywords.push(keyword);
        }
      }
    }

    return [...new Set(keywords)];
  }

  // ==========================================================================
  // DECOMPOSITION STRATEGIES
  // ==========================================================================

  /**
   * Hierarchical decomposition: top-down by abstraction levels
   */
  private decomposeHierarchical(
    segments: QuerySegment[],
    maxSubproblems: number
  ): Subproblem[] {
    const subproblems: Subproblem[] = [];

    // Group segments by task type (abstraction levels)
    const groupedByType = new Map<TaskType, QuerySegment[]>();
    for (const segment of segments) {
      const existing = groupedByType.get(segment.taskType) || [];
      existing.push(segment);
      groupedByType.set(segment.taskType, existing);
    }

    // Create subproblems from groups with hierarchy
    // Order: PLANNING -> ANALYSIS -> CODING -> TESTING -> DOCUMENTATION
    const hierarchyOrder: TaskType[] = [
      TaskType.PLANNING,
      TaskType.ANALYSIS,
      TaskType.CODING,
      TaskType.DEBUGGING,
      TaskType.REFACTORING,
      TaskType.OPTIMIZATION,
      TaskType.TESTING,
      TaskType.DOCUMENTATION
    ];

    let id = 1;
    const dependencies: string[] = [];

    for (const taskType of hierarchyOrder) {
      const typeSegments = groupedByType.get(taskType) || [];
      if (typeSegments.length === 0) continue;

      // Combine segments of same type
      const combinedText = typeSegments.map(s => s.text).join('; ');
      const avgComplexity = typeSegments.reduce((s, seg) => s + seg.complexity, 0) / typeSegments.length;

      const subproblem: Subproblem = {
        id: `sp-${id}`,
        description: this.formatSubproblemDescription(taskType, combinedText),
        dependencies: [...dependencies], // Depends on all previous
        estimatedComplexity: avgComplexity,
        taskType
      };

      subproblems.push(subproblem);
      dependencies.push(subproblem.id);
      id++;

      if (subproblems.length >= maxSubproblems) break;
    }

    // If we didn't get enough from types, split by individual segments
    if (subproblems.length < 2 && segments.length > 0) {
      return this.decomposeSequential(segments, maxSubproblems);
    }

    return subproblems;
  }

  /**
   * Sequential decomposition: by execution order
   */
  private decomposeSequential(
    segments: QuerySegment[],
    maxSubproblems: number
  ): Subproblem[] {
    const subproblems: Subproblem[] = [];
    const dependencies: string[] = [];

    // Sort segments by position (maintain original order)
    const sorted = [...segments].sort((a, b) => a.position - b.position);

    for (let i = 0; i < Math.min(sorted.length, maxSubproblems); i++) {
      const segment = sorted[i];
      const subproblem: Subproblem = {
        id: `sp-${i + 1}`,
        description: this.formatSubproblemDescription(segment.taskType, segment.text),
        dependencies: [...dependencies], // Each depends on previous
        estimatedComplexity: segment.complexity,
        taskType: segment.taskType
      };

      subproblems.push(subproblem);
      dependencies.push(subproblem.id);
    }

    return subproblems;
  }

  /**
   * Parallel decomposition: independent subproblems
   */
  private decomposeParallel(
    segments: QuerySegment[],
    maxSubproblems: number
  ): Subproblem[] {
    const subproblems: Subproblem[] = [];

    for (let i = 0; i < Math.min(segments.length, maxSubproblems); i++) {
      const segment = segments[i];

      // No dependencies - all can run in parallel
      const subproblem: Subproblem = {
        id: `sp-${i + 1}`,
        description: this.formatSubproblemDescription(segment.taskType, segment.text),
        dependencies: [], // No dependencies
        estimatedComplexity: segment.complexity,
        taskType: segment.taskType
      };

      subproblems.push(subproblem);
    }

    return subproblems;
  }

  /**
   * Format subproblem description
   */
  private formatSubproblemDescription(taskType: TaskType, text: string): string {
    const taskLabels: Record<TaskType, string> = {
      [TaskType.CODING]: 'Implement',
      [TaskType.DEBUGGING]: 'Debug',
      [TaskType.ANALYSIS]: 'Analyze',
      [TaskType.REFACTORING]: 'Refactor',
      [TaskType.TESTING]: 'Test',
      [TaskType.DOCUMENTATION]: 'Document',
      [TaskType.PLANNING]: 'Plan',
      [TaskType.OPTIMIZATION]: 'Optimize'
    };

    const label = taskLabels[taskType] || 'Handle';
    const truncated = text.length > 100 ? text.substring(0, 97) + '...' : text;

    return `[${label}] ${truncated}`;
  }

  // ==========================================================================
  // DEPENDENCY ANALYSIS
  // ==========================================================================

  /**
   * Analyze dependencies between subproblems
   */
  private analyzeDependencies(subproblems: Subproblem[]): DependencyEdge[] {
    const edges: DependencyEdge[] = [];

    // Add explicit dependencies from subproblem definitions
    for (const sp of subproblems) {
      for (const depId of sp.dependencies) {
        edges.push({
          from: depId,
          to: sp.id,
          type: 'requires'
        });
      }
    }

    // Analyze implicit dependencies by task type ordering
    const typeOrder: Record<TaskType, number> = {
      [TaskType.PLANNING]: 1,
      [TaskType.ANALYSIS]: 2,
      [TaskType.CODING]: 3,
      [TaskType.DEBUGGING]: 4,
      [TaskType.REFACTORING]: 5,
      [TaskType.OPTIMIZATION]: 6,
      [TaskType.TESTING]: 7,
      [TaskType.DOCUMENTATION]: 8
    };

    // Find implicit dependencies based on task type order
    for (let i = 0; i < subproblems.length; i++) {
      for (let j = i + 1; j < subproblems.length; j++) {
        const sp1 = subproblems[i];
        const sp2 = subproblems[j];

        // If sp1's task type should come before sp2's, add edge
        if (typeOrder[sp1.taskType] < typeOrder[sp2.taskType]) {
          // Check if edge doesn't already exist
          const exists = edges.some(e => e.from === sp1.id && e.to === sp2.id);
          if (!exists) {
            edges.push({
              from: sp1.id,
              to: sp2.id,
              type: 'enhances'
            });
          }
        }
      }
    }

    return edges;
  }

  // ==========================================================================
  // EXECUTION ORDERING
  // ==========================================================================

  /**
   * Determine execution order using topological sort
   */
  private determineExecutionOrder(
    subproblems: Subproblem[],
    dependencies: DependencyEdge[]
  ): string[] {
    // Build adjacency list
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize
    for (const sp of subproblems) {
      graph.set(sp.id, []);
      inDegree.set(sp.id, 0);
    }

    // Build graph
    for (const edge of dependencies) {
      const neighbors = graph.get(edge.from) || [];
      neighbors.push(edge.to);
      graph.set(edge.from, neighbors);

      const degree = inDegree.get(edge.to) || 0;
      inDegree.set(edge.to, degree + 1);
    }

    // Kahn's algorithm for topological sort
    const queue: string[] = [];
    const result: string[] = [];

    // Find all nodes with no incoming edges
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const neighbors = graph.get(current) || [];
      for (const neighbor of neighbors) {
        const degree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, degree);
        if (degree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If result doesn't include all nodes, there's a cycle
    // Fall back to original order
    if (result.length !== subproblems.length) {
      return subproblems.map(sp => sp.id);
    }

    return result;
  }

  // ==========================================================================
  // PARALLELIZATION
  // ==========================================================================

  /**
   * Identify groups of subproblems that can run in parallel
   */
  private identifyParallelGroups(
    subproblems: Subproblem[],
    dependencies: DependencyEdge[]
  ): string[][] {
    // Build dependency sets
    const dependsOn = new Map<string, Set<string>>();
    for (const sp of subproblems) {
      dependsOn.set(sp.id, new Set(sp.dependencies));
    }

    // Add transitive dependencies from edges
    for (const edge of dependencies) {
      const deps = dependsOn.get(edge.to) || new Set();
      deps.add(edge.from);
      dependsOn.set(edge.to, deps);
    }

    // Group by dependency level (parallel groups)
    const groups: string[][] = [];
    const completed = new Set<string>();

    while (completed.size < subproblems.length) {
      const currentGroup: string[] = [];

      for (const sp of subproblems) {
        if (completed.has(sp.id)) continue;

        const deps = dependsOn.get(sp.id) || new Set();
        const allDepsCompleted = [...deps].every(d => completed.has(d));

        if (allDepsCompleted) {
          currentGroup.push(sp.id);
        }
      }

      if (currentGroup.length === 0) {
        // Prevent infinite loop - add remaining
        for (const sp of subproblems) {
          if (!completed.has(sp.id)) {
            currentGroup.push(sp.id);
          }
        }
      }

      groups.push(currentGroup);
      for (const id of currentGroup) {
        completed.add(id);
      }
    }

    return groups;
  }

  // ==========================================================================
  // OUTPUT FORMATTING
  // ==========================================================================

  /**
   * Format plan summary for answer field
   */
  private formatPlanSummary(plan: DecompositionPlan): string {
    const lines: string[] = [
      `Decomposition Plan: ${plan.subproblems.length} subproblems identified`,
      `Total Complexity: ${(plan.totalComplexity * 100).toFixed(1)}%`,
      '',
      'Subproblems:'
    ];

    for (const sp of plan.subproblems) {
      const deps = sp.dependencies.length > 0
        ? ` (depends on: ${sp.dependencies.join(', ')})`
        : ' (no dependencies)';
      lines.push(`  ${sp.id}: ${sp.description}${deps}`);
    }

    lines.push('');
    lines.push(`Execution Order: ${plan.executionOrder.join(' → ')}`);
    lines.push(`Parallel Groups: ${plan.parallelizationGroups.length}`);

    for (let i = 0; i < plan.parallelizationGroups.length; i++) {
      const group = plan.parallelizationGroups[i];
      lines.push(`  Stage ${i + 1}: [${group.join(', ')}]`);
    }

    return lines.join('\n');
  }

  /**
   * Calculate confidence in the decomposition plan
   */
  private calculatePlanConfidence(
    plan: DecompositionPlan,
    queryComplexity: number
  ): number {
    const factors: number[] = [];

    // 1. Number of subproblems (2-8 is optimal)
    const subproblemCount = plan.subproblems.length;
    if (subproblemCount >= 2 && subproblemCount <= 8) {
      factors.push(0.9);
    } else if (subproblemCount === 1 || subproblemCount > 12) {
      factors.push(0.5);
    } else {
      factors.push(0.7);
    }

    // 2. Parallelization opportunities
    const parallelRatio = plan.parallelizationGroups.filter(g => g.length > 1).length /
      Math.max(plan.parallelizationGroups.length, 1);
    factors.push(0.7 + parallelRatio * 0.3);

    // 3. Complexity reduction (subproblems should be simpler than whole)
    const avgSubComplexity = plan.totalComplexity;
    if (avgSubComplexity < queryComplexity) {
      factors.push(0.9); // Good decomposition reduces complexity
    } else {
      factors.push(0.6);
    }

    // 4. Task type coverage (diverse is good)
    const taskTypes = new Set(plan.subproblems.map(sp => sp.taskType));
    const diversityScore = Math.min(taskTypes.size / 4, 1);
    factors.push(0.6 + diversityScore * 0.4);

    // Average all factors
    const confidence = factors.reduce((s, f) => s + f, 0) / factors.length;
    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Generate reasoning explanation
   */
  private generateReasoning(
    plan: DecompositionPlan,
    strategy: string
  ): string[] {
    return [
      `Applied ${strategy} decomposition strategy`,
      `Total complexity: ${(plan.totalComplexity * 100).toFixed(1)}%`,
      `Identified ${plan.subproblems.length} distinct subproblems`,
      `Task types covered: ${[...new Set(plan.subproblems.map(s => s.taskType))].join(', ')}`,
      `Created ${plan.parallelizationGroups.length} execution stages`,
      `Parallelization opportunities: ${plan.parallelizationGroups.filter(g => g.length > 1).length} stages with multiple items`
    ];
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a configured DecompositionEngine instance
 */
export function createDecompositionEngine(
  deps: DecompositionEngineDependencies
): DecompositionEngine {
  return new DecompositionEngine(deps);
}

// ============================================================================
// EXPORTS
// ============================================================================

// DecompositionEngineDependencies is already exported at declaration
