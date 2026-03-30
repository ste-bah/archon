/**
 * Coding Pipeline Factory Functions
 *
 * Extracted factory and helper functions for the coding pipeline orchestrator.
 * Contains IntegratedValidator creation and helper methods.
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-factories
 * @see coding-pipeline-orchestrator.ts
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type { PipelineMemoryCoordinator } from './pipeline-memory-coordinator.js';
import type {
  IntegratedValidator,
  IIntegratedValidationResult,
} from './sherlock-quality-gate-integration.js';
import { createIntegratedValidator } from './sherlock-quality-gate-integration.js';
import type { SonaEngine } from '../learning/sona-engine.js';
import type { ReasoningBank } from '../reasoning/reasoning-bank.js';
import type { CodingPipelineAgent, CodingPipelinePhase } from './types.js';
import { CRITICAL_AGENTS } from './types.js';
import {
  PHASE_TO_NUMBER,
  validatePhaseWithSherlock,
  handleSherlockGuiltyVerdict,
  type ISherlockValidatorConfig,
} from './coding-pipeline-sherlock-validator.js';
import {
  storeMemory as storeMemoryFn,
  retrieveMemoryContext as retrieveMemoryContextFn,
} from './coding-memory-adapter.js';
import { ObservabilityBus } from '../observability/bus.js';
import type { IPhaseExecutionResult } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration for IntegratedValidator creation.
 */
export interface IIntegratedValidatorFactoryConfig {
  /** Memory coordinator for storage/retrieval */
  memoryCoordinator: PipelineMemoryCoordinator;
  /** Memory namespace for storage */
  memoryNamespace: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Enable learning integration */
  enableLearning?: boolean;
  /** SONA engine for learning (optional) */
  sonaEngine?: SonaEngine | null;
  /** ReasoningBank for learning (optional) */
  reasoningBank?: ReasoningBank | null;
  /** Logging function */
  log: (msg: string) => void;
}

/**
 * Dependencies for Sherlock validation wrapper.
 */
export interface ISherlockWrapperDependencies {
  /** IntegratedValidator instance */
  integratedValidator: IntegratedValidator | null;
  /** Memory coordinator for storage */
  memoryCoordinator: PipelineMemoryCoordinator;
  /** Memory namespace */
  memoryNamespace: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Logging function */
  log: (msg: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATED VALIDATOR FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an IntegratedValidator instance for Sherlock-Quality Gate integration.
 *
 * Per PRD Section 2.3: Connects forensic verdicts to learning system (RLM/LEANN).
 * This factory handles the complex configuration required for the IntegratedValidator.
 *
 * @param config - Factory configuration
 * @returns IntegratedValidator instance or null if creation fails
 */
export function createPipelineIntegratedValidator(
  config: IIntegratedValidatorFactoryConfig
): IntegratedValidator | null {
  try {
    const validator = createIntegratedValidator({
      memoryRetriever: {
        retrieve: async (key: string) => {
          const result = retrieveMemoryContextFn(
            config.memoryCoordinator,
            config.memoryNamespace,
            [key]
          );
          return result[key] ?? null;
        },
        store: async (key: string, value: unknown) => {
          storeMemoryFn(
            config.memoryCoordinator,
            config.memoryNamespace,
            key,
            value,
            config.log
          );
        },
      },
      verbose: config.verbose ?? false,
      autoTriggerSherlock: true,
      pipelineType: 'coding', // CRITICAL: NOT 'phd' - PhD uses PhDQualityGateValidator
      sonaEngine: config.sonaEngine ?? null,
      reasoningBank: config.reasoningBank ?? null,
      learningConfig: {
        enabled: config.enableLearning ?? true,
        patternThreshold: 0.75,
        routePrefix: 'coding/forensics/',
      },
    });
    config.log('IntegratedValidator initialized for Sherlock-Quality Gate integration');
    return validator;
  } catch (error) {
    config.log(`Warning: IntegratedValidator initialization failed: ${error}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHERLOCK VALIDATION WRAPPERS
// These add orchestrator-specific memory storage and observability emissions.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate phase completion with Sherlock-Quality Gate integration.
 *
 * Adds memory storage and observability emissions on top of the base
 * validatePhaseWithSherlock function from coding-pipeline-sherlock-validator.
 *
 * @param deps - Wrapper dependencies
 * @param phase - The phase that just completed
 * @param phaseResult - The execution result from the phase
 * @param retryCount - Number of times this phase has been retried
 * @returns Validation result with verdict and remediation actions
 */
export async function validatePhaseWithSherlockAndStore(
  deps: ISherlockWrapperDependencies,
  phase: CodingPipelinePhase,
  phaseResult: IPhaseExecutionResult,
  retryCount: number = 0
): Promise<IIntegratedValidationResult | null> {
  if (!deps.integratedValidator) {
    deps.log(`Sherlock validation skipped: IntegratedValidator not available`);
    return null;
  }

  const phaseNumber = PHASE_TO_NUMBER[phase];
  deps.log(`Running Sherlock-Quality Gate validation for phase ${phaseNumber} (${phase})`);

  // Delegate to extracted function
  const result = await validatePhaseWithSherlock(
    deps.integratedValidator,
    phase,
    phaseResult,
    retryCount,
    { verbose: deps.verbose }
  );

  // Store validation result in memory for audit trail
  if (result) {
    storeMemoryFn(
      deps.memoryCoordinator,
      deps.memoryNamespace,
      `forensics/phase-${phaseNumber}/validation`,
      {
        phase,
        phaseNumber,
        lScore: result.gateResult.lScore,
        canProceed: result.canProceed,
        verdict: result.sherlockResult?.verdict ?? 'N/A',
        remediations: result.remediations,
        timestamp: new Date().toISOString(),
      },
      deps.log
    );

    // Emit observability event
    ObservabilityBus.getInstance().emit({
      component: 'pipeline',
      operation: 'sherlock_validation',
      status: result.canProceed ? 'success' : 'error',
      metadata: {
        phase,
        phaseNumber,
        verdict: result.sherlockResult?.verdict,
        gateResult: result.gateResult.result,
        canProceed: result.canProceed,
        investigationTier: result.investigationTier,
      },
    });
  }

  return result;
}

/**
 * Handle Sherlock GUILTY verdict with remediation loop and memory storage.
 *
 * Adds memory storage on top of the base handleSherlockGuiltyVerdict function.
 *
 * @param deps - Wrapper dependencies
 * @param validationResult - The validation result from Sherlock
 * @param phase - The phase that failed validation
 * @returns Remediation actions to take
 */
export function handleSherlockGuiltyVerdictAndStore(
  deps: ISherlockWrapperDependencies,
  validationResult: IIntegratedValidationResult,
  phase: CodingPipelinePhase
): string[] {
  // Delegate to extracted function
  const remediations = handleSherlockGuiltyVerdict(
    validationResult,
    phase,
    { verbose: deps.verbose }
  );

  deps.log(
    `Phase ${phase} received GUILTY verdict. ` +
    `${remediations.length} remediation actions required.`
  );

  // Store remediation requirements in memory
  storeMemoryFn(
    deps.memoryCoordinator,
    deps.memoryNamespace,
    `forensics/${phase}/remediations`,
    {
      phase,
      remediations,
      verdict: validationResult.sherlockResult?.verdict,
      confidence: validationResult.sherlockResult?.confidence,
      timestamp: new Date().toISOString(),
    },
    deps.log
  );

  return remediations;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load agent markdown file if it exists.
 *
 * @param agentKey - Agent key to load
 * @param agentMdPath - Path to agent markdown files
 * @returns Markdown content or empty string
 */
export function loadAgentMarkdown(
  agentKey: CodingPipelineAgent,
  agentMdPath: string
): string {
  const mdPath = join(process.cwd(), agentMdPath, `${agentKey}.md`);

  if (existsSync(mdPath)) {
    try {
      return readFileSync(mdPath, 'utf-8');
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Check if agent is critical (halts pipeline on failure).
 *
 * @param agentKey - Agent key to check
 * @returns Whether agent is in CRITICAL_AGENTS list
 */
export function isCriticalAgent(agentKey: CodingPipelineAgent): boolean {
  return CRITICAL_AGENTS.includes(agentKey);
}
