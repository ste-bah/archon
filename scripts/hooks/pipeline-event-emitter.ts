/**
 * Pipeline Event Emitter for Claude Code Hooks
 *
 * Enables hooks to emit pipeline tracking events to the observability dashboard.
 * Detects PHD research and other pipeline contexts from agent prompts.
 *
 * @module scripts/hooks/pipeline-event-emitter
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SocketClient } from '../../src/god-agent/observability/socket-client.js';
import type { IActivityEvent } from '../../src/god-agent/observability/types.js';

// ==================== Constants ====================

const PIPELINE_STATE_FILE = '.agentdb/pipeline-state.json';
const PROJECT_ROOT = process.cwd();

// PHD Research pipeline phases and agent mapping
const PHD_PIPELINE_PHASES = [
  { phase: 'Phase 1: Foundation', agents: ['research-planner', 'step-back-analyzer', 'self-ask-decomposer', 'construct-definer'] },
  { phase: 'Phase 2: Literature', agents: ['literature-mapper', 'source-tier-classifier', 'systematic-reviewer', 'quality-assessor'] },
  { phase: 'Phase 3: Analysis', agents: ['methodology-scanner', 'bias-detector', 'contradiction-analyzer', 'gap-hunter'] },
  { phase: 'Phase 4: Synthesis', agents: ['thematic-synthesizer', 'theory-builder', 'model-architect', 'evidence-synthesizer'] },
  { phase: 'Phase 5: Framework', agents: ['hypothesis-generator', 'method-designer', 'validity-guardian', 'instrument-developer'] },
  { phase: 'Phase 6: Quality', agents: ['adversarial-reviewer', 'confidence-quantifier', 'risk-analyst', 'reproducibility-checker'] },
  { phase: 'Phase 7: Writing', agents: ['dissertation-architect', 'literature-review-writer', 'methodology-writer', 'synthesis-specialist'] },
];

// Flatten agent list for lookup
const PHD_AGENTS = PHD_PIPELINE_PHASES.flatMap(p => p.agents);

// ==================== Types ====================

export interface IPipelineState {
  pipelineId: string;
  name: string;
  taskType: string;
  startedAt: number;
  totalSteps: number;
  completedSteps: number;
  currentStepId?: string;
  currentStepName?: string;
  steps: string[];
  metadata?: Record<string, unknown>;
}

// ==================== Singleton Socket Client ====================

let socketClient: SocketClient | null = null;

/**
 * Get or create socket client singleton
 */
async function getSocketClient(): Promise<SocketClient> {
  if (!socketClient) {
    socketClient = new SocketClient({ verbose: false });
    await socketClient.connect();
  }
  return socketClient;
}

/**
 * Emit an event to the observability daemon
 */
async function emitEvent(event: Omit<IActivityEvent, 'id' | 'timestamp'>): Promise<void> {
  try {
    const client = await getSocketClient();
    const fullEvent: IActivityEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...event,
    };
    client.send(fullEvent);
  } catch (error) {
    // Non-blocking - silently fail if daemon not available
    console.debug('[PipelineEmitter] Emit failed:', (error as Error).message);
  }
}

// ==================== Pipeline Detection ====================

/**
 * Detect if prompt is part of a PHD research pipeline
 */
export function detectPhdPipeline(prompt: string): boolean {
  const promptLower = prompt.toLowerCase();

  // Check for explicit PHD research indicators
  if (promptLower.includes('phd') || promptLower.includes('dissertation') ||
      promptLower.includes('systematic review') || promptLower.includes('literature review')) {
    return true;
  }

  // Check for PHD agent types in prompt
  for (const agent of PHD_AGENTS) {
    if (promptLower.includes(agent.replace('-', ' ')) || promptLower.includes(agent)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect agent type from prompt for pipeline step tracking
 */
export function detectAgentFromPrompt(prompt: string): string | null {
  const promptLower = prompt.toLowerCase();

  for (const agent of PHD_AGENTS) {
    // Check both hyphenated and space-separated forms
    if (promptLower.includes(agent) || promptLower.includes(agent.replace(/-/g, ' '))) {
      return agent;
    }
  }

  return null;
}

/**
 * Get phase for an agent
 */
function getPhaseForAgent(agentType: string): string {
  for (const phase of PHD_PIPELINE_PHASES) {
    if (phase.agents.includes(agentType)) {
      return phase.phase;
    }
  }
  return 'Unknown Phase';
}

// ==================== Pipeline State Management ====================

/**
 * Read pipeline state from file
 */
export async function readPipelineState(): Promise<IPipelineState | null> {
  const statePath = path.join(PROJECT_ROOT, PIPELINE_STATE_FILE);

  try {
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content) as IPipelineState;
  } catch {
    return null;
  }
}

/**
 * Write pipeline state to file
 */
async function writePipelineState(state: IPipelineState): Promise<void> {
  const statePath = path.join(PROJECT_ROOT, PIPELINE_STATE_FILE);
  const stateDir = path.dirname(statePath);

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Delete pipeline state file
 */
async function deletePipelineState(): Promise<void> {
  const statePath = path.join(PROJECT_ROOT, PIPELINE_STATE_FILE);

  try {
    await fs.unlink(statePath);
  } catch {
    // File doesn't exist, that's fine
  }
}

// ==================== Pipeline Event Emission ====================

/**
 * Start tracking a new pipeline
 * Called when PHD research is detected and no pipeline is active
 */
export async function startPipeline(name: string, taskType: string, steps: string[]): Promise<string> {
  const pipelineId = `pipe_${name.replace(/\s+/g, '_')}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const state: IPipelineState = {
    pipelineId,
    name,
    taskType,
    startedAt: Date.now(),
    totalSteps: steps.length,
    completedSteps: 0,
    steps,
  };

  await writePipelineState(state);

  // Emit pipeline_started event
  await emitEvent({
    component: 'pipeline',
    operation: 'pipeline_started',
    status: 'running',
    metadata: {
      pipelineId,
      name,
      taskType,
      totalSteps: steps.length,
      steps,
    },
  });

  return pipelineId;
}

/**
 * Start a pipeline step
 * Called by pre-task hook when agent is detected
 */
export async function startStep(agentType: string): Promise<{ pipelineId: string; stepId: string } | null> {
  const state = await readPipelineState();

  if (!state) {
    return null;
  }

  const stepId = `step_${state.pipelineId}_${state.completedSteps}_${Math.random().toString(36).slice(2, 8)}`;
  const phase = getPhaseForAgent(agentType);

  // Update state
  state.currentStepId = stepId;
  state.currentStepName = agentType;
  await writePipelineState(state);

  // Emit step_started event
  await emitEvent({
    component: 'pipeline',
    operation: 'step_started',
    status: 'running',
    metadata: {
      pipelineId: state.pipelineId,
      stepId,
      stepName: agentType,
      stepIndex: state.completedSteps,
      agentType,
      phase,
      progress: (state.completedSteps / state.totalSteps) * 100,
    },
  });

  return { pipelineId: state.pipelineId, stepId };
}

/**
 * Complete a pipeline step
 * Called by post-task hook when agent completes
 */
export async function completeStep(stepId?: string): Promise<void> {
  const state = await readPipelineState();

  if (!state) {
    return;
  }

  const actualStepId = stepId || state.currentStepId;
  const stepName = state.currentStepName || 'unknown';

  // Update state
  state.completedSteps++;
  state.currentStepId = undefined;
  state.currentStepName = undefined;

  const progress = (state.completedSteps / state.totalSteps) * 100;

  await writePipelineState(state);

  // Emit step_completed event
  await emitEvent({
    component: 'pipeline',
    operation: 'step_completed',
    status: 'success',
    metadata: {
      pipelineId: state.pipelineId,
      stepId: actualStepId,
      stepName,
      progress,
      completedSteps: state.completedSteps,
      totalSteps: state.totalSteps,
    },
  });

  // Check if pipeline is complete
  if (state.completedSteps >= state.totalSteps) {
    await completePipeline(state.pipelineId);
  }
}

/**
 * Complete the pipeline
 */
export async function completePipeline(pipelineId?: string): Promise<void> {
  const state = await readPipelineState();

  if (!state) {
    return;
  }

  const actualPipelineId = pipelineId || state.pipelineId;
  const duration = Date.now() - state.startedAt;

  // Emit pipeline_completed event
  await emitEvent({
    component: 'pipeline',
    operation: 'pipeline_completed',
    status: 'success',
    durationMs: duration,
    metadata: {
      pipelineId: actualPipelineId,
      name: state.name,
      totalSteps: state.totalSteps,
      completedSteps: state.completedSteps,
      progress: 100,
      durationMs: duration,
    },
  });

  // Clean up state file
  await deletePipelineState();
}

/**
 * Fail a pipeline step
 */
export async function failStep(error: Error, stepId?: string): Promise<void> {
  const state = await readPipelineState();

  if (!state) {
    return;
  }

  const actualStepId = stepId || state.currentStepId;
  const stepName = state.currentStepName || 'unknown';

  // Emit step_failed event
  await emitEvent({
    component: 'pipeline',
    operation: 'step_failed',
    status: 'error',
    metadata: {
      pipelineId: state.pipelineId,
      stepId: actualStepId,
      stepName,
      error: error.message,
    },
  });
}

/**
 * Handle pre-task hook - detect and start pipeline/step
 */
export async function handlePreTask(prompt: string): Promise<void> {
  // Check for existing pipeline
  const existingState = await readPipelineState();

  if (!existingState) {
    // No pipeline running - check if this is PHD research
    if (detectPhdPipeline(prompt)) {
      // Start new pipeline
      await startPipeline(
        'PHD Research Pipeline',
        'research',
        PHD_AGENTS // Use all PHD agents as steps
      );
    } else {
      return; // Not a pipeline context
    }
  }

  // Detect agent type for step tracking
  const agentType = detectAgentFromPrompt(prompt);

  if (agentType) {
    await startStep(agentType);
  }
}

/**
 * Handle post-task hook - complete step
 */
export async function handlePostTask(): Promise<void> {
  const state = await readPipelineState();

  if (state && state.currentStepId) {
    await completeStep();
  }
}
