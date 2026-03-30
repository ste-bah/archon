/**
 * Orchestration Utilities
 * TASK-ORC-001 - Relay Race Protocol Utilities
 *
 * Provides utility functions for pipeline validation,
 * ID generation, and prompt building.
 */

import { randomBytes } from 'crypto';
import type {
  IPipelineDefinition,
  IAgentDefinition,
} from './orchestration-types.js';
import { PipelineValidationError } from './orchestration-types.js';

// ==================== Constants ====================

/** Default namespace for memory operations */
export const DEFAULT_NAMESPACE = 'pipeline';

/** Default agent timeout (5 minutes) */
export const DEFAULT_AGENT_TIMEOUT = 300000;

/** Maximum agents in a pipeline */
export const MAX_PIPELINE_AGENTS = 100;

// ==================== ID Generation ====================

/**
 * Generate a unique pipeline execution ID
 * Format: "pipeline-{timestamp}-{random8hex}"
 */
export function generatePipelineID(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `pipeline-${timestamp}-${random}`;
}

/**
 * Validate pipeline ID format
 */
export function isValidPipelineID(id: string): boolean {
  return /^pipeline-\d+-[a-f0-9]{8}$/.test(id);
}

// ==================== Pipeline Validation ====================

/**
 * Validate a pipeline definition
 * @throws PipelineValidationError if validation fails
 */
export function validatePipelineDefinition(pipeline: IPipelineDefinition): void {
  // 1. Validate pipeline name
  if (!pipeline.name || typeof pipeline.name !== 'string') {
    throw new PipelineValidationError('Pipeline name required');
  }
  if (pipeline.name.trim().length === 0) {
    throw new PipelineValidationError('Pipeline name cannot be empty');
  }

  // 2. Validate agents array
  if (!pipeline.agents || !Array.isArray(pipeline.agents)) {
    throw new PipelineValidationError('Pipeline agents must be an array');
  }
  if (pipeline.agents.length === 0) {
    throw new PipelineValidationError('Pipeline must have at least 1 agent');
  }
  if (pipeline.agents.length > MAX_PIPELINE_AGENTS) {
    throw new PipelineValidationError(
      `Pipeline cannot exceed ${MAX_PIPELINE_AGENTS} agents`
    );
  }

  // 3. Validate sequential flag (default true)
  const isSequential = pipeline.sequential !== false;

  // 4. Track output keys for uniqueness validation
  const outputKeys = new Set<string>();

  // 5. Validate each agent definition
  for (let i = 0; i < pipeline.agents.length; i++) {
    const agent = pipeline.agents[i];
    validateAgentDefinition(agent, i, isSequential, outputKeys);

    // Track output key
    outputKeys.add(agent.outputKey);
  }

  // 6. Validate memory key chain for sequential pipelines
  if (isSequential) {
    validateMemoryKeyChain(pipeline.agents);
  }
}

/**
 * Validate a single agent definition
 */
export function validateAgentDefinition(
  agent: IAgentDefinition,
  index: number,
  isSequential: boolean,
  existingOutputKeys: Set<string>
): void {
  const position = `Agent ${index}`;

  // Required fields
  if (!agent.agentName || typeof agent.agentName !== 'string') {
    throw new PipelineValidationError(`${position} missing agentName`);
  }
  if (!agent.position || typeof agent.position !== 'string') {
    throw new PipelineValidationError(`${position} missing position`);
  }
  if (!agent.phase || typeof agent.phase !== 'string') {
    throw new PipelineValidationError(`${position} missing phase`);
  }
  if (!agent.outputKey || typeof agent.outputKey !== 'string') {
    throw new PipelineValidationError(`${position} missing outputKey`);
  }
  if (!agent.task || typeof agent.task !== 'string') {
    throw new PipelineValidationError(`${position} missing task`);
  }
  if (!agent.qualityGate || typeof agent.qualityGate !== 'string') {
    throw new PipelineValidationError(`${position} missing qualityGate`);
  }

  // Output key uniqueness
  if (existingOutputKeys.has(agent.outputKey)) {
    throw new PipelineValidationError(
      `${position} (${agent.agentName}) has duplicate outputKey: ${agent.outputKey}`
    );
  }

  // Sequential pipeline rules (99.9% rule)
  if (isSequential) {
    // First agent should not require previousKey (but can have it)
    if (index === 0 && agent.previousKey) {
      // Warning only - first agent might inherit from prior pipeline
      console.warn(
        `First agent ${agent.agentName} has previousKey, but no previous agent exists in this pipeline`
      );
    }

    // Subsequent agents MUST have previousKey
    if (index > 0 && !agent.previousKey) {
      throw new PipelineValidationError(
        `${agent.agentName} (${agent.position}) missing previousKey. ` +
        `Sequential pipelines require explicit memory key passing. ` +
        `Set previousKey to the output key of the previous agent.`
      );
    }
  }
}

/**
 * Validate memory key chain forms a proper sequence
 */
export function validateMemoryKeyChain(agents: IAgentDefinition[]): void {
  for (let i = 1; i < agents.length; i++) {
    const currentAgent = agents[i];
    const previousAgent = agents[i - 1];

    // Check if previousKey matches previous agent's outputKey
    if (currentAgent.previousKey !== previousAgent.outputKey) {
      console.warn(
        `Memory key chain mismatch: Agent ${currentAgent.agentName} expects previousKey "${currentAgent.previousKey}" ` +
        `but previous agent ${previousAgent.agentName} outputs to "${previousAgent.outputKey}"`
      );
    }
  }
}

// ==================== Prompt Building ====================

/**
 * Build the prompt for an agent with memory key injection
 */
export function buildAgentPrompt(
  agent: IAgentDefinition,
  previousContext: string | null,
  pipelineName?: string
): string {
  const lines: string[] = [];

  // Header with agent identity
  lines.push(`## Agent Identity`);
  lines.push(`You are **${agent.agentName}** (${agent.position}) in the **${agent.phase}** phase.`);
  if (pipelineName) {
    lines.push(`Pipeline: ${pipelineName}`);
  }
  lines.push('');

  // Previous agent context (memory key injection)
  if (agent.previousKey && previousContext) {
    lines.push(`## Previous Agent Output`);
    lines.push(`**Retrieved from memory key:** \`${agent.previousKey}\``);
    lines.push('');
    lines.push('```');
    lines.push(previousContext);
    lines.push('```');
    lines.push('');
  } else if (agent.previousKey && !previousContext) {
    lines.push(`## Previous Agent Output`);
    lines.push(`**Expected from memory key:** \`${agent.previousKey}\``);
    lines.push('*Note: Previous output was not found or is empty.*');
    lines.push('');
  }

  // Task description
  lines.push(`## Your Task`);
  lines.push(agent.task);
  lines.push('');

  // Quality gate
  lines.push(`## Quality Gate`);
  lines.push(`Your output must meet this requirement:`);
  lines.push(`> ${agent.qualityGate}`);
  lines.push('');

  // Output storage instructions
  lines.push(`## Output Storage`);
  lines.push(`When you complete this task, your output MUST be stored at memory key:`);
  lines.push(`\`${agent.outputKey}\``);
  lines.push('');
  lines.push(`The next agent in the pipeline will retrieve your output from this key.`);
  lines.push('');

  return lines.join('\n');
}

// ==================== Position Formatting ====================

/**
 * Format agent position string
 * @param index - Zero-based agent index
 * @param total - Total agents in pipeline
 * @returns Position string (e.g., "Agent #5/48")
 */
export function formatAgentPosition(index: number, total: number): string {
  return `Agent #${index + 1}/${total}`;
}

/**
 * Parse agent position string
 * @param position - Position string (e.g., "Agent #5/48")
 * @returns { index, total } or null if invalid
 */
export function parseAgentPosition(position: string): { index: number; total: number } | null {
  const match = position.match(/^Agent #(\d+)\/(\d+)$/);
  if (!match) return null;
  return {
    index: parseInt(match[1], 10) - 1,
    total: parseInt(match[2], 10),
  };
}

// ==================== Quality Gate Helpers ====================

/**
 * Simple quality gate validation
 * Returns true if output appears to meet the gate requirement
 */
export function validateQualityGate(output: string, qualityGate: string): boolean {
  // Empty output always fails
  if (!output || output.trim().length === 0) {
    return false;
  }

  // Check for common quality gate patterns
  const lowerGate = qualityGate.toLowerCase();
  const lowerOutput = output.toLowerCase();

  // "Must cite X+ sources" pattern
  const citeMatch = lowerGate.match(/must cite (\d+)\+ sources/);
  if (citeMatch) {
    const requiredCitations = parseInt(citeMatch[1], 10);
    // Count citation-like patterns [1], [2], etc.
    const citationCount = (output.match(/\[\d+\]/g) || []).length;
    return citationCount >= requiredCitations;
  }

  // "Must include X" pattern
  if (lowerGate.includes('must include')) {
    const includeMatch = lowerGate.match(/must include\s+"([^"]+)"/);
    if (includeMatch) {
      return lowerOutput.includes(includeMatch[1].toLowerCase());
    }
  }

  // "Minimum X words" pattern
  const wordMatch = lowerGate.match(/minimum (\d+) words/);
  if (wordMatch) {
    const requiredWords = parseInt(wordMatch[1], 10);
    const wordCount = output.split(/\s+/).length;
    return wordCount >= requiredWords;
  }

  // "Must produce" pattern - just check non-empty
  if (lowerGate.includes('must produce')) {
    return output.trim().length > 0;
  }

  // Default: non-empty output passes
  return output.trim().length > 0;
}

// ==================== Serialization ====================

/**
 * Serialize Map to array for JSON
 */
export function serializeMap<K, V>(map: Map<K, V>): Array<{ key: K; value: V }> {
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

/**
 * Deserialize array to Map
 */
export function deserializeMap<K, V>(arr: Array<{ key: K; value: V }>): Map<K, V> {
  return new Map(arr.map(({ key, value }) => [key, value]));
}
