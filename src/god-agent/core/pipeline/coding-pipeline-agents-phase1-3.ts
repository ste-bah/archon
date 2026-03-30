/**
 * DAI-002: Coding Pipeline Agent Mappings - Phases 1-3
 *
 * Phase 1: Understanding (6 agents + Sherlock #42)
 * Phase 2: Exploration (4 agents + Sherlock #43)
 * Phase 3: Architecture (5 agents + Sherlock #44)
 *
 * Total: 15 core agents + 3 Sherlock = 18 agents in this file.
 *
 * Extracted for constitution compliance (< 500 lines per file).
 *
 * @see command-task-bridge.ts
 * @see SPEC-001-architecture.md
 * @see constitution.xml
 */

import type { IAgentMapping as ICodingAgentMapping } from './types.js';

/**
 * Phase 1-3 agent mappings (18 agents total).
 *
 * Phase 1: Understanding (7 agents including Sherlock)
 * Phase 2: Exploration (5 agents including Sherlock)
 * Phase 3: Architecture (6 agents including Sherlock)
 */
export const CODING_PIPELINE_MAPPINGS_PHASE_1_3: ICodingAgentMapping[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: UNDERSTANDING (6 agents)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    phase: 'understanding',
    agentKey: 'task-analyzer',
    priority: 1,
    category: 'analysis',
    algorithm: 'ToT',         // Simple text analysis - CoT is faster than ReAct
    fallbackAlgorithm: 'Reflexion',
    dependsOn: undefined,
    memoryReads: ['coding/input/task', 'coding/context/project'],
    memoryWrites: ['coding/understanding/task-analysis', 'coding/understanding/parsed-intent'],
    xpReward: 50,
    parallelizable: false,
    critical: true,
    description: 'Parses and structures coding requests into actionable components. CRITICAL agent - pipeline entry point.',
  },
  {
    phase: 'understanding',
    agentKey: 'requirement-extractor',
    priority: 2,
    category: 'analysis',
    algorithm: 'ToT',         // Text extraction - CoT is faster than ReAct
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['task-analyzer'],
    memoryReads: ['coding/understanding/task-analysis'],
    memoryWrites: ['coding/understanding/requirements', 'coding/understanding/functional-requirements'],
    xpReward: 45,
    parallelizable: true,
    critical: false,
    description: 'Extracts functional and non-functional requirements from parsed task analysis.',
  },
  {
    phase: 'understanding',
    agentKey: 'requirement-prioritizer',
    priority: 3,
    category: 'analysis',
    algorithm: 'PoT',
    fallbackAlgorithm: 'ReAct',
    dependsOn: ['requirement-extractor'],
    memoryReads: ['coding/understanding/requirements'],
    memoryWrites: ['coding/understanding/prioritized-requirements'],
    xpReward: 40,
    parallelizable: false,
    critical: false,
    description: 'Applies MoSCoW prioritization to requirements, enabling focused delivery.',
  },
  {
    phase: 'understanding',
    agentKey: 'scope-definer',
    priority: 4,
    category: 'analysis',
    algorithm: 'ToT',
    fallbackAlgorithm: 'ReAct',
    dependsOn: ['requirement-prioritizer'],
    memoryReads: ['coding/understanding/prioritized-requirements'],
    memoryWrites: ['coding/understanding/scope', 'coding/understanding/boundaries'],
    xpReward: 45,
    parallelizable: false,
    critical: false,
    description: 'Defines clear boundaries, deliverables, and milestones for the coding task.',
  },
  {
    phase: 'understanding',
    agentKey: 'context-gatherer',
    priority: 5,
    category: 'analysis',
    algorithm: 'ReAct',
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['task-analyzer'],
    memoryReads: ['coding/understanding/task-analysis', 'coding/context/project'],
    memoryWrites: ['coding/understanding/context', 'coding/understanding/existing-code'],
    xpReward: 45,
    parallelizable: true,
    critical: false,
    description: 'Gathers codebase context via LEANN semantic search using ReAct reasoning.',
  },
  {
    phase: 'understanding',
    agentKey: 'feasibility-analyzer',
    priority: 6,
    category: 'analysis',
    algorithm: 'PoT',
    fallbackAlgorithm: 'ReAct',
    dependsOn: ['scope-definer', 'context-gatherer'],
    memoryReads: ['coding/understanding/scope', 'coding/understanding/context'],
    memoryWrites: ['coding/understanding/feasibility', 'coding/understanding/constraints'],
    xpReward: 50,
    parallelizable: false,
    critical: false,
    description: 'Assesses technical, resource, and timeline feasibility of proposed implementation.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: EXPLORATION (4 agents)
  // CRITICAL: First agent must depend on phase-1-reviewer (Sherlock gate)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    phase: 'exploration',
    agentKey: 'pattern-explorer',
    priority: 1,
    category: 'exploration',
    algorithm: 'LATS',
    fallbackAlgorithm: 'ToT',
    dependsOn: ['phase-1-reviewer'], // CRITICAL: Must pass Sherlock gate before Phase 2
    memoryReads: ['coding/understanding/requirements', 'coding/understanding/constraints'],
    memoryWrites: ['coding/exploration/patterns', 'coding/exploration/best-practices'],
    xpReward: 45,
    parallelizable: false,
    critical: false,
    description: 'Explores and documents existing code patterns that can guide implementation decisions.',
  },
  {
    phase: 'exploration',
    agentKey: 'technology-scout',
    priority: 2,
    category: 'exploration',
    algorithm: 'ReAct',
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['pattern-explorer'],
    memoryReads: ['coding/exploration/patterns', 'coding/understanding/requirements'],
    memoryWrites: ['coding/exploration/technologies', 'coding/exploration/recommendations'],
    xpReward: 40,
    parallelizable: true,
    critical: false,
    description: 'Evaluates technology options and external solutions that could address implementation needs.',
  },
  {
    phase: 'exploration',
    agentKey: 'research-planner',
    priority: 3,
    category: 'exploration',
    algorithm: 'ToT',
    fallbackAlgorithm: 'ReAct',
    dependsOn: ['pattern-explorer'],
    memoryReads: ['coding/exploration/patterns', 'coding/understanding/scope'],
    memoryWrites: ['coding/exploration/research-plan', 'coding/exploration/unknowns'],
    xpReward: 35,
    parallelizable: true,
    critical: false,
    description: 'Creates structured research plans to investigate implementation approaches and unknowns.',
  },
  {
    phase: 'exploration',
    agentKey: 'codebase-analyzer',
    priority: 4,
    category: 'exploration',
    algorithm: 'ReAct',
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['technology-scout', 'research-planner'],
    memoryReads: ['coding/exploration/technologies', 'coding/understanding/context'],
    memoryWrites: ['coding/exploration/codebase-analysis', 'coding/exploration/integration-points'],
    xpReward: 50,
    parallelizable: false,
    critical: false,
    description: 'Performs deep analysis of relevant code sections to understand implementation context.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: ARCHITECTURE (5 agents)
  // CRITICAL: First agent must depend on phase-2-reviewer (Sherlock gate)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    phase: 'architecture',
    agentKey: 'system-designer',
    priority: 1,
    category: 'design',
    algorithm: 'ToT',
    fallbackAlgorithm: 'LATS',
    dependsOn: ['phase-2-reviewer'], // CRITICAL: Must pass Sherlock gate before Phase 3
    memoryReads: ['coding/exploration/codebase-analysis', 'coding/understanding/requirements'],
    memoryWrites: ['coding/architecture/design', 'coding/architecture/structure'],
    xpReward: 60,
    parallelizable: false,
    critical: false,
    description: 'Designs high-level system architecture, module boundaries, and component relationships.',
  },
  {
    phase: 'architecture',
    agentKey: 'component-designer',
    priority: 2,
    category: 'design',
    algorithm: 'ToT',
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['system-designer'],
    memoryReads: ['coding/architecture/design'],
    memoryWrites: ['coding/architecture/components', 'coding/architecture/modules'],
    xpReward: 45,
    parallelizable: true,
    critical: false,
    description: 'Designs internal component structure, class hierarchies, and implementation details.',
  },
  {
    phase: 'architecture',
    agentKey: 'interface-designer',
    priority: 3,
    category: 'design',
    algorithm: 'ToT',
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['component-designer'],
    memoryReads: ['coding/architecture/components'],
    memoryWrites: ['coding/architecture/interfaces', 'coding/architecture/contracts'],
    xpReward: 50,
    parallelizable: true,
    critical: true,
    description: 'Designs API contracts, type definitions, and interface specifications.',
  },
  {
    phase: 'architecture',
    agentKey: 'data-architect',
    priority: 4,
    category: 'design',
    algorithm: 'ReAct',
    fallbackAlgorithm: 'PoT',
    dependsOn: ['component-designer'],
    memoryReads: ['coding/architecture/components', 'coding/architecture/interfaces'],
    memoryWrites: ['coding/architecture/data-models', 'coding/architecture/schemas'],
    xpReward: 45,
    parallelizable: true,
    critical: false,
    description: 'Designs data models, database schemas, and data persistence strategies.',
  },
  {
    phase: 'architecture',
    agentKey: 'integration-architect',
    priority: 5,
    category: 'design',
    algorithm: 'ToT',
    fallbackAlgorithm: 'Reflexion',
    dependsOn: ['interface-designer', 'data-architect'],
    memoryReads: ['coding/architecture/interfaces', 'coding/architecture/data-models'],
    memoryWrites: ['coding/architecture/integrations', 'coding/architecture/dependencies'],
    xpReward: 55,
    parallelizable: false,
    critical: false,
    description: 'Designs integration patterns, external API connections, and system interoperability.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHERLOCK FORENSIC REVIEW AGENTS (#42-44)
  // Phase 1-3 forensic reviewers - CRITICAL: Gates phase progression
  // ═══════════════════════════════════════════════════════════════════════════

  // #42 - Phase 1 Understanding Forensic Review
  {
    phase: 'understanding',
    agentKey: 'phase-1-reviewer',
    priority: 99,
    category: 'forensic-review',
    algorithm: 'Reflexion',
    fallbackAlgorithm: 'ToT',
    dependsOn: ['feasibility-analyzer'],
    memoryReads: [
      'coding/understanding/task-analysis',
      'coding/understanding/requirements',
      'coding/understanding/scope',
      'coding/understanding/context',
      'coding/understanding/feasibility',
    ],
    memoryWrites: ['coding/forensic/phase-1-verdict', 'coding/forensic/phase-1-evidence'],
    xpReward: 100,
    parallelizable: false,
    critical: true,
    description: 'Sherlock #42: Phase 1 Understanding forensic review. CRITICAL: Gates progression to Phase 2.',
  },

  // #43 - Phase 2 Exploration Forensic Review
  {
    phase: 'exploration',
    agentKey: 'phase-2-reviewer',
    priority: 99,
    category: 'forensic-review',
    algorithm: 'Reflexion',
    fallbackAlgorithm: 'ToT',
    dependsOn: ['codebase-analyzer'],
    memoryReads: [
      'coding/exploration/patterns',
      'coding/exploration/technologies',
      'coding/exploration/research-plan',
      'coding/exploration/codebase-analysis',
    ],
    memoryWrites: ['coding/forensic/phase-2-verdict', 'coding/forensic/phase-2-evidence'],
    xpReward: 100,
    parallelizable: false,
    critical: true,
    description: 'Sherlock #43: Phase 2 Exploration forensic review. CRITICAL: Gates progression to Phase 3.',
  },

  // #44 - Phase 3 Architecture Forensic Review
  {
    phase: 'architecture',
    agentKey: 'phase-3-reviewer',
    priority: 99,
    category: 'forensic-review',
    algorithm: 'Reflexion',
    fallbackAlgorithm: 'ToT',
    dependsOn: ['integration-architect'],
    memoryReads: [
      'coding/architecture/design',
      'coding/architecture/components',
      'coding/architecture/interfaces',
      'coding/architecture/data-models',
      'coding/architecture/integrations',
    ],
    memoryWrites: ['coding/forensic/phase-3-verdict', 'coding/forensic/phase-3-evidence'],
    xpReward: 100,
    parallelizable: false,
    critical: true,
    description: 'Sherlock #44: Phase 3 Architecture forensic review. CRITICAL: Gates progression to Phase 4.',
  },
];
