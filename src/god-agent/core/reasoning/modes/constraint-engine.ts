/**
 * Constraint-Based Reasoning Engine
 * RSN-002 Implementation - Constraint Satisfaction Problem (CSP) Solving
 *
 * Purpose: Solve problems with hard and soft constraints
 * using backtracking, local search, and hybrid strategies
 *
 * Features:
 * - Backtracking with constraint propagation
 * - Local search optimization
 * - Hybrid solver combining both approaches
 * - Hard vs soft constraint handling
 * - Weighted constraint optimization
 *
 * Dependencies:
 * - GraphDB: Variable domain retrieval (optional)
 * - PatternMatcher: Constraint inference (optional)
 *
 * Performance Target: <200ms latency
 */

import type { IReasoningRequest, ReasoningMode, IPatternMatch, IInferenceResult, IProvenanceInfo } from '../reasoning-types.js';
import type {
  ConstraintConfig,
  IConstraintResult,
  Constraint,
  ConstraintSolution
} from '../advanced-reasoning-types.js';
import { AdvancedReasoningMode } from '../advanced-reasoning-types.js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Dependencies for ConstraintEngine
 */
export interface ConstraintEngineDependencies {
  /** Graph database for domain queries (optional) */
  graphDB?: {
    getVariableDomain?(variable: string): Promise<unknown[]>;
  };

  /** Pattern matcher for constraint inference (optional) */
  patternMatcher?: {
    inferConstraints?(query: string): Promise<Constraint[]>;
  };
}

/**
 * Variable with its domain and current assignment
 */
interface Variable {
  name: string;
  domain: unknown[];
  value?: unknown;
  assigned: boolean;
}

/**
 * Solver state during search
 */
interface SolverState {
  variables: Map<string, Variable>;
  assignments: Map<string, unknown>;
  satisfiedHard: string[];
  satisfiedSoft: string[];
  violatedHard: string[];
  violatedSoft: string[];
  score: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default maximum iterations
 */
const DEFAULT_MAX_ITERATIONS = 1000;

/**
 * Default satisfaction threshold
 */
const DEFAULT_SATISFACTION_THRESHOLD = 0.8;

/**
 * Local search restart threshold
 */
const RESTART_THRESHOLD = 100;

// ============================================================================
// CONSTRAINT ENGINE
// ============================================================================

/**
 * Constraint-based reasoning engine
 *
 * Implements CSP solving with multiple strategies:
 * - Backtracking: Systematic search with constraint propagation
 * - Local Search: Hill climbing with random restarts
 * - Hybrid: Combines both for efficiency
 *
 * @example
 * ```typescript
 * const engine = new ConstraintEngine({});
 * const result = await engine.reason(
 *   { query: 'Schedule meetings without conflicts' },
 *   {
 *     hardConstraints: [
 *       { id: 'no-overlap', type: 'custom', variables: ['meeting1', 'meeting2'], ... }
 *     ],
 *     solverStrategy: 'hybrid'
 *   }
 * );
 * ```
 */
export class ConstraintEngine {
  private deps: ConstraintEngineDependencies;

  constructor(deps: ConstraintEngineDependencies) {
    this.deps = deps;
  }

  /**
   * Perform constraint-based reasoning
   *
   * @param request - The reasoning request containing the query
   * @param config - Constraint configuration
   * @returns Constraint result with solution
   */
  async reason(
    request: IReasoningRequest,
    config: ConstraintConfig
  ): Promise<IConstraintResult> {
    const startTime = Date.now();
    // Query embedding is Float32Array - get query text from metadata if available
    // Query embedding is Float32Array - constraint solving is config-driven
    void request.query; // acknowledge embedding exists

    // Apply defaults
    const effectiveConfig: Required<ConstraintConfig> = {
      hardConstraints: config.hardConstraints,
      softConstraints: config.softConstraints ?? [],
      constraintWeights: config.constraintWeights ?? [],
      satisfactionThreshold: config.satisfactionThreshold ?? DEFAULT_SATISFACTION_THRESHOLD,
      maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      solverStrategy: config.solverStrategy ?? 'hybrid',
      metadata: config.metadata ?? {}
    };

    // Normalize constraint weights
    if (effectiveConfig.constraintWeights.length !== effectiveConfig.softConstraints.length) {
      effectiveConfig.constraintWeights = effectiveConfig.softConstraints.map(() => 1);
    }

    // Extract variables from constraints
    const variables = this.extractVariables(
      effectiveConfig.hardConstraints,
      effectiveConfig.softConstraints
    );

    // Initialize variable domains
    await this.initializeDomains(variables);

    // Solve using selected strategy
    let solution: ConstraintSolution;

    switch (effectiveConfig.solverStrategy) {
      case 'backtracking':
        solution = await this.solveBacktracking(
          variables,
          effectiveConfig.hardConstraints,
          effectiveConfig.softConstraints,
          effectiveConfig.maxIterations
        );
        break;
      case 'local-search':
        solution = await this.solveLocalSearch(
          variables,
          effectiveConfig.hardConstraints,
          effectiveConfig.softConstraints,
          effectiveConfig.constraintWeights,
          effectiveConfig.maxIterations
        );
        break;
      case 'hybrid':
      default:
        solution = await this.solveHybrid(
          variables,
          effectiveConfig.hardConstraints,
          effectiveConfig.softConstraints,
          effectiveConfig.constraintWeights,
          effectiveConfig.maxIterations
        );
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(solution);

    const latencyMs = Date.now() - startTime;

    // Build result with all required IAdvancedReasoningResult fields
    const result: IConstraintResult = {
      // IAdvancedReasoningResult fields
      mode: AdvancedReasoningMode.CONSTRAINT_BASED,
      answer: this.formatAnswer(solution, effectiveConfig),
      reasoningSteps: this.generateReasoning(solution, effectiveConfig),
      latencyMs,
      confidence,

      // IReasoningResponse fields (from base interface)
      type: 'hybrid' as ReasoningMode,
      patterns: [] as IPatternMatch[],
      causalInferences: [] as IInferenceResult[],
      trajectoryId: `traj_${Date.now()}_constraint`,
      processingTimeMs: latencyMs,
      provenanceInfo: {
        lScores: [solution.consistency],
        totalSources: solution.satisfiedConstraints.length,
        combinedLScore: solution.consistency
      } as IProvenanceInfo,

      // Mode-specific field
      solution
    };

    return result;
  }

  // ==========================================================================
  // VARIABLE EXTRACTION & INITIALIZATION
  // ==========================================================================

  /**
   * Extract unique variables from constraints
   */
  private extractVariables(
    hardConstraints: Constraint[],
    softConstraints: Constraint[]
  ): Map<string, Variable> {
    const variables = new Map<string, Variable>();

    const allConstraints = [...hardConstraints, ...softConstraints];
    for (const constraint of allConstraints) {
      for (const varName of constraint.variables) {
        if (!variables.has(varName)) {
          variables.set(varName, {
            name: varName,
            domain: [],
            assigned: false
          });
        }
      }
    }

    return variables;
  }

  /**
   * Initialize domains for variables
   */
  private async initializeDomains(variables: Map<string, Variable>): Promise<void> {
    for (const [name, variable] of variables) {
      // Try to get domain from graph DB
      if (this.deps.graphDB?.getVariableDomain) {
        try {
          variable.domain = await this.deps.graphDB.getVariableDomain(name);
          if (variable.domain.length > 0) {
            continue;
          }
        } catch {
          // INTENTIONAL: Graph DB query failure - use default domain as fallback
        }
      }

      // Default domain based on variable name
      variable.domain = this.getDefaultDomain(name);
    }
  }

  /**
   * Get default domain for a variable
   */
  private getDefaultDomain(varName: string): unknown[] {
    const lowerName = varName.toLowerCase();

    // Boolean-like variables
    if (lowerName.includes('flag') || lowerName.includes('is_') || lowerName.includes('has_')) {
      return [true, false];
    }

    // Numeric-like variables
    if (lowerName.includes('count') || lowerName.includes('num') || lowerName.includes('size')) {
      return [0, 1, 2, 3, 4, 5, 10, 20, 50, 100];
    }

    // Time-like variables
    if (lowerName.includes('time') || lowerName.includes('hour') || lowerName.includes('slot')) {
      return Array.from({ length: 24 }, (_, i) => i);
    }

    // Day-like variables
    if (lowerName.includes('day')) {
      return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    }

    // Priority-like variables
    if (lowerName.includes('priority') || lowerName.includes('level')) {
      return ['low', 'medium', 'high', 'critical'];
    }

    // Default: small set of integers
    return [0, 1, 2, 3, 4];
  }

  // ==========================================================================
  // BACKTRACKING SOLVER
  // ==========================================================================

  /**
   * Solve using backtracking with constraint propagation
   */
  private async solveBacktracking(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[],
    softConstraints: Constraint[],
    maxIterations: number
  ): Promise<ConstraintSolution> {
    let iterations = 0;
    const variableList = Array.from(variables.values());

    const backtrack = (index: number): SolverState | null => {
      iterations++;
      if (iterations > maxIterations) {
        return null;
      }

      // All variables assigned
      if (index >= variableList.length) {
        return this.evaluateState(variables, hardConstraints, softConstraints);
      }

      const variable = variableList[index];

      // Try each value in domain
      for (const value of variable.domain) {
        variable.value = value;
        variable.assigned = true;

        // Check if assignment is consistent with hard constraints
        if (this.isConsistent(variables, hardConstraints)) {
          const result = backtrack(index + 1);
          if (result && result.violatedHard.length === 0) {
            return result;
          }
        }

        // Undo assignment
        variable.value = undefined;
        variable.assigned = false;
      }

      return null;
    };

    const result = backtrack(0);

    if (result) {
      return this.stateToSolution(result);
    }

    // Return best partial solution found
    return this.createPartialSolution(variables, hardConstraints, softConstraints);
  }

  /**
   * Check if current assignments are consistent
   */
  private isConsistent(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[]
  ): boolean {
    const assignments = this.getAssignments(variables);

    for (const constraint of hardConstraints) {
      // Only check if all variables are assigned
      const allAssigned = constraint.variables.every(v => assignments.has(v));
      if (allAssigned) {
        try {
          if (!constraint.predicate(assignments)) {
            return false;
          }
        } catch {
          // INTENTIONAL: Predicate error means constraint violated - fail safe
          return false;
        }
      }
    }

    return true;
  }

  // ==========================================================================
  // LOCAL SEARCH SOLVER
  // ==========================================================================

  /**
   * Solve using local search with random restarts
   */
  private async solveLocalSearch(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[],
    softConstraints: Constraint[],
    weights: number[],
    maxIterations: number
  ): Promise<ConstraintSolution> {
    let bestState: SolverState | null = null;
    let bestScore = -Infinity;
    let iterationsWithoutImprovement = 0;

    // Random initial assignment
    this.randomAssignment(variables);

    for (let i = 0; i < maxIterations; i++) {
      // Evaluate current state
      const state = this.evaluateState(variables, hardConstraints, softConstraints, weights);

      // Update best if improved
      if (state.score > bestScore) {
        bestState = state;
        bestScore = state.score;
        iterationsWithoutImprovement = 0;
      } else {
        iterationsWithoutImprovement++;
      }

      // Random restart if stuck
      if (iterationsWithoutImprovement > RESTART_THRESHOLD) {
        this.randomAssignment(variables);
        iterationsWithoutImprovement = 0;
        continue;
      }

      // Local move: flip one variable
      const improved = this.localMove(
        variables,
        hardConstraints,
        softConstraints,
        weights,
        bestScore
      );

      if (!improved) {
        // Random perturbation
        this.randomPerturbation(variables);
      }
    }

    if (bestState) {
      // Restore best state
      for (const [name, value] of bestState.assignments) {
        const variable = variables.get(name);
        if (variable) {
          variable.value = value;
          variable.assigned = true;
        }
      }
      return this.stateToSolution(bestState);
    }

    return this.createPartialSolution(variables, hardConstraints, softConstraints);
  }

  /**
   * Make random assignment to all variables
   */
  private randomAssignment(variables: Map<string, Variable>): void {
    for (const variable of variables.values()) {
      if (variable.domain.length > 0) {
        const randomIndex = Math.floor(Math.random() * variable.domain.length);
        variable.value = variable.domain[randomIndex];
        variable.assigned = true;
      }
    }
  }

  /**
   * Attempt a local move to improve score
   */
  private localMove(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[],
    softConstraints: Constraint[],
    weights: number[],
    currentBest: number
  ): boolean {
    const variableList = Array.from(variables.values());

    // Try flipping each variable
    for (const variable of variableList) {
      const originalValue = variable.value;

      for (const newValue of variable.domain) {
        if (newValue === originalValue) continue;

        variable.value = newValue;
        const state = this.evaluateState(variables, hardConstraints, softConstraints, weights);

        if (state.score > currentBest) {
          return true; // Keep improvement
        }
      }

      // Restore original value
      variable.value = originalValue;
    }

    return false;
  }

  /**
   * Random perturbation of one variable
   */
  private randomPerturbation(variables: Map<string, Variable>): void {
    const variableList = Array.from(variables.values());
    if (variableList.length === 0) return;

    const randomVar = variableList[Math.floor(Math.random() * variableList.length)];
    if (randomVar.domain.length > 1) {
      let newValue: unknown;
      do {
        newValue = randomVar.domain[Math.floor(Math.random() * randomVar.domain.length)];
      } while (newValue === randomVar.value && randomVar.domain.length > 1);

      randomVar.value = newValue;
    }
  }

  // ==========================================================================
  // HYBRID SOLVER
  // ==========================================================================

  /**
   * Solve using hybrid approach
   */
  private async solveHybrid(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[],
    softConstraints: Constraint[],
    weights: number[],
    maxIterations: number
  ): Promise<ConstraintSolution> {
    // Phase 1: Try backtracking for hard constraints (limited iterations)
    const backtrackIterations = Math.floor(maxIterations * 0.3);
    const backtrackSolution = await this.solveBacktracking(
      this.cloneVariables(variables),
      hardConstraints,
      [],
      backtrackIterations
    );

    // If backtracking found complete solution for hard constraints
    if (backtrackSolution.isComplete) {
      // Phase 2: Use local search to optimize soft constraints
      const localSearchVariables = new Map(variables);
      for (const [name, value] of backtrackSolution.variables) {
        const variable = localSearchVariables.get(name);
        if (variable) {
          variable.value = value;
          variable.assigned = true;
        }
      }

      return this.solveLocalSearch(
        localSearchVariables,
        hardConstraints,
        softConstraints,
        weights,
        maxIterations - backtrackIterations
      );
    }

    // Backtracking failed, use local search for everything
    return this.solveLocalSearch(
      variables,
      hardConstraints,
      softConstraints,
      weights,
      maxIterations
    );
  }

  /**
   * Clone variables map
   */
  private cloneVariables(variables: Map<string, Variable>): Map<string, Variable> {
    const cloned = new Map<string, Variable>();
    for (const [name, variable] of variables) {
      cloned.set(name, {
        name: variable.name,
        domain: [...variable.domain],
        value: variable.value,
        assigned: variable.assigned
      });
    }
    return cloned;
  }

  // ==========================================================================
  // STATE EVALUATION
  // ==========================================================================

  /**
   * Evaluate current state against constraints
   */
  private evaluateState(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[],
    softConstraints: Constraint[],
    weights?: number[]
  ): SolverState {
    const assignments = this.getAssignments(variables);
    const satisfiedHard: string[] = [];
    const violatedHard: string[] = [];
    const satisfiedSoft: string[] = [];
    const violatedSoft: string[] = [];

    // Check hard constraints
    for (const constraint of hardConstraints) {
      const satisfied = this.checkConstraint(constraint, assignments);
      if (satisfied) {
        satisfiedHard.push(constraint.id);
      } else {
        violatedHard.push(constraint.id);
      }
    }

    // Check soft constraints
    let softScore = 0;
    for (let i = 0; i < softConstraints.length; i++) {
      const constraint = softConstraints[i];
      const weight = weights?.[i] ?? 1;
      const satisfied = this.checkConstraint(constraint, assignments);

      if (satisfied) {
        satisfiedSoft.push(constraint.id);
        softScore += weight;
      } else {
        violatedSoft.push(constraint.id);
      }
    }

    // Calculate overall score
    // Hard constraints are much more important
    const hardScore = violatedHard.length === 0 ? 100 : -violatedHard.length * 10;
    const totalScore = hardScore + softScore;

    return {
      variables,
      assignments,
      satisfiedHard,
      satisfiedSoft,
      violatedHard,
      violatedSoft,
      score: totalScore
    };
  }

  /**
   * Get current variable assignments
   */
  private getAssignments(variables: Map<string, Variable>): Map<string, unknown> {
    const assignments = new Map<string, unknown>();
    for (const [name, variable] of variables) {
      if (variable.assigned && variable.value !== undefined) {
        assignments.set(name, variable.value);
      }
    }
    return assignments;
  }

  /**
   * Check if a constraint is satisfied
   */
  private checkConstraint(
    constraint: Constraint,
    assignments: Map<string, unknown>
  ): boolean {
    // Check if all variables are assigned
    const allAssigned = constraint.variables.every(v => assignments.has(v));
    if (!allAssigned) {
      return true; // Not yet falsifiable
    }

    try {
      return constraint.predicate(assignments);
    } catch {
      // INTENTIONAL: Predicate execution error - treat as constraint violation
      return false;
    }
  }

  /**
   * Convert solver state to solution
   */
  private stateToSolution(state: SolverState): ConstraintSolution {
    return {
      variables: state.assignments,
      satisfiedConstraints: [...state.satisfiedHard, ...state.satisfiedSoft],
      violatedConstraints: [...state.violatedHard, ...state.violatedSoft],
      consistency: this.calculateConsistency(state),
      isComplete: state.violatedHard.length === 0
    };
  }

  /**
   * Create partial solution when no complete solution found
   */
  private createPartialSolution(
    variables: Map<string, Variable>,
    hardConstraints: Constraint[],
    softConstraints: Constraint[]
  ): ConstraintSolution {
    const state = this.evaluateState(variables, hardConstraints, softConstraints);
    return this.stateToSolution(state);
  }

  /**
   * Calculate consistency score
   */
  private calculateConsistency(state: SolverState): number {
    const totalConstraints =
      state.satisfiedHard.length +
      state.violatedHard.length +
      state.satisfiedSoft.length +
      state.violatedSoft.length;

    if (totalConstraints === 0) {
      return 1;
    }

    const satisfied = state.satisfiedHard.length + state.satisfiedSoft.length;
    return satisfied / totalConstraints;
  }

  // ==========================================================================
  // OUTPUT FORMATTING
  // ==========================================================================

  /**
   * Calculate overall confidence
   */
  private calculateConfidence(solution: ConstraintSolution): number {
    // Base confidence from solution completeness
    let confidence = solution.isComplete ? 0.8 : 0.4;

    // Adjust by consistency
    confidence *= solution.consistency;

    // Base boost for constraint solving
    confidence = Math.min(confidence + 0.05, 1);

    return confidence;
  }

  /**
   * Format answer from solution
   */
  private formatAnswer(
    solution: ConstraintSolution,
    config: Required<ConstraintConfig>
  ): string {
    const lines: string[] = [
      `Constraint Satisfaction ${solution.isComplete ? 'Complete' : 'Partial'} Solution:`,
      '',
      `Strategy: ${config.solverStrategy}`,
      `Consistency: ${(solution.consistency * 100).toFixed(1)}%`,
      ''
    ];

    // Variable assignments
    lines.push('Variable Assignments:');
    for (const [name, value] of solution.variables) {
      lines.push(`  ${name} = ${JSON.stringify(value)}`);
    }
    lines.push('');

    // Constraint status
    lines.push(`Satisfied Constraints: ${solution.satisfiedConstraints.length}`);
    if (solution.violatedConstraints.length > 0) {
      lines.push(`Violated Constraints: ${solution.violatedConstraints.length}`);
      lines.push(`  ${solution.violatedConstraints.slice(0, 5).join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate reasoning explanation
   */
  private generateReasoning(
    solution: ConstraintSolution,
    config: Required<ConstraintConfig>
  ): string[] {
    return [
      `Applied ${config.solverStrategy} solver strategy`,
      `Hard constraints: ${config.hardConstraints.length}`,
      `Soft constraints: ${config.softConstraints.length}`,
      `Variables solved: ${solution.variables.size}`,
      `Satisfaction rate: ${(solution.consistency * 100).toFixed(1)}%`,
      `Solution status: ${solution.isComplete ? 'Complete' : 'Partial'}`
    ];
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a configured ConstraintEngine instance
 */
export function createConstraintEngine(
  deps: ConstraintEngineDependencies
): ConstraintEngine {
  return new ConstraintEngine(deps);
}

// ============================================================================
// EXPORTS
// ============================================================================

// ConstraintEngineDependencies is already exported at declaration
