/**
 * Universal Self-Learning God Agent
 *
 * A unified interface that makes the God Agent do EVERYTHING:
 * - Coding with pattern learning
 * - Research with knowledge accumulation
 * - Writing with style adaptation
 * - Self-learning from every interaction
 *
 * Every operation automatically:
 * 1. Stores successful patterns
 * 2. Learns from feedback (explicit or implicit)
 * 3. Improves retrieval weights over time
 * 4. Builds domain knowledge continuously
 */

import { GodAgent } from '../core/god-agent.js';
import type { QueryResult } from '../core/god-agent.js';
import { InteractionStore } from './interaction-store.js';
import type { ISonaConfig } from '../core/learning/sona-types.js';
import { TrajectoryBridge, type FeedbackResult } from './trajectory-bridge.js';
import { estimateQuality, assessQuality, type QualityInteraction } from './quality-estimator.js';
import { StyleProfileManager, type StoredStyleProfile, type StyleProfileMetadata } from './style-profile.js';
import type { StyleCharacteristics } from './style-analyzer.js';
import {
  ClaudeCodeExecutor,
  type ICodeExecutionRequest
} from '../core/executor/index.js';
import { EmbeddingProviderFactory } from '../core/memory/embedding-provider.js';
import type { IEmbeddingProvider } from '../core/memory/types.js';
import { AnthropicWritingGenerator, type IWritingGenerator } from '../core/writing/index.js';
import { HybridSearchProvider, type IWebSearchProvider } from '../core/search/index.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const universalLogger = createComponentLogger('UniversalAgent', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

// DESC: Episode injection for prior solutions (RULE-010: default window size 3)
import { UCMDaemonClient, getUCMClient } from '../cli/ucm-daemon-client.js';

// DAEMON-003: Core daemon client for EpisodeStore/GraphDB IPC
import { CoreDaemonClient, getCoreDaemonClient } from '../cli/core-daemon-client.js';

// DAI-001: Dynamic Agent Integration
import {
  AgentRegistry,
  AgentSelector,
  TaskExecutor,
  type IAgentSelectionResult,
  type ITaskExecutionResult,
  type IStructuredTask,
} from '../core/agents/index.js';

// DAI-002: Multi-Agent Sequential Pipeline Orchestration
import {
  PipelineExecutor,
  createPipelineExecutor,
  createLeannContextService,
  LeannContextService,
  type IPipelineDefinition,
  type IPipelineExecutorConfig,
  type DAI002PipelineResult,
  type DAI002PipelineOptions,
} from '../core/pipeline/index.js';

// LEANN: Semantic search adapter for context service initialization
import { createLEANNAdapter } from '../core/search/adapters/leann-adapter.js';

// LEANN: DualCodeEmbeddingProvider for optimized code search (NLP + Code fusion)
import {
  createDualCodeEmbeddingProvider,
  createLEANNEmbedder,
  type DualCodeEmbeddingProvider
} from '../core/search/dual-code-embedding.js';

// TASK-PIPELINE-FIX: Import CommandTaskBridge for sophisticated task complexity analysis
// Replaces weak regex-based isPipelineTask() with scoring-based analysis
import {
  CommandTaskBridge,
  DEFAULT_PIPELINE_THRESHOLD,
  type IComplexityAnalysis,
} from '../core/pipeline/command-task-bridge.js';

// DAI-003: Intelligent Task Routing
import {
  TaskAnalyzer,
  CapabilityIndex,
  RoutingEngine,
  PipelineGenerator,
  RoutingLearner,
  ConfirmationHandler,
  FailureClassifier,
  type IRoutingResult,
  type IGeneratedPipeline,
  type IRoutingFeedback,
} from '../core/routing/index.js';

// MEM-001: Multi-Process Memory System
import {
  MemoryClient,
  getMemoryClient,
  type IStoreKnowledgeParams,
} from '../core/memory-server/index.js';

// TASK-HOOK-006: Hook Executor for pre/post Tool Use hooks
// CONSTITUTION COMPLIANCE: RULE-033 (DESC context injection), RULE-035 (quality threshold 0.5), RULE-036 (quality scores)
import {
  getHookExecutor,
  type IHookContext,
  type IPostToolUseContext,
  type IHookChainResult,
} from '../core/hooks/index.js';

// TASK-PREP-003: Coding Pipeline DAG generation imports
// Implements [REQ-PREP-003]: Dynamic import from command-task-bridge.ts
import {
  CODING_PIPELINE_MAPPINGS,
  getAgentsForPhase,
  buildPipelineDAG,
} from '../core/pipeline/command-task-bridge.js';

import {
  PHASE_ORDER,
  CHECKPOINT_PHASES,
  CODING_MEMORY_NAMESPACE,
  type CodingPipelinePhase,
  type IPipelineExecutionConfig,
  type IPipelineExecutionResult,
  type IAgentMapping,
} from '../core/pipeline/types.js';

import {
  CodingPipelineOrchestrator,
  createOrchestrator,
  type IOrchestratorDependencies,
  type IOrchestratorConfig,
  type IStepExecutor,
} from '../core/pipeline/coding-pipeline-orchestrator.js';

// ClaudeCodeStepExecutor removed - coding pipeline uses CLI-based execution like PhD pipeline

// TASK-CHUNK-003: Knowledge chunking for OpenAI token limit compliance
// CONSTITUTION COMPLIANCE: RULE-064 (symmetric chunking), RULE-008 (SQLite persistence)
import {
  KnowledgeChunker,
  type ChunkingResult,
  type KnowledgeChunk,
} from './knowledge-chunker.js';

/**
 * Extended pattern type that includes metadata (runtime extension to QueryResult.patterns)
 * The base QueryResult.patterns type doesn't include metadata, but the GodAgent.store()
 * method stores metadata and it's returned in query results at runtime.
 * TASK-CHUNK-004: Used for chunk retrieval and reconstruction
 */
type PatternWithMetadata = {
  id: string;
  content: unknown;
  similarity: number;
  confidence: number;
  provenance?: unknown;
  causalContext?: unknown;
  metadata?: Record<string, unknown>;
};

// ==================== Types ====================

export type AgentMode = 'code' | 'research' | 'write' | 'market-analysis' | 'general';

export interface UniversalConfig {
  /** Enable automatic learning from all interactions */
  autoLearn?: boolean;
  /** Minimum quality threshold for auto-storing patterns (default: 0.5 per RULE-035) */
  autoStoreThreshold?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Default mode */
  defaultMode?: AgentMode;
  /** Learning rate for weight updates */
  learningRate?: number;
  /** Enable web search for research mode */
  enableWebSearch?: boolean;
  /** Enable persistent storage (default: true) */
  enablePersistence?: boolean;
  /** Storage directory (default: .agentdb/universal) */
  storageDir?: string;
  /** Enable DESC episode injection for prior solutions (default: true) */
  enableDESC?: boolean;
  /** DESC similarity threshold for episode matching (default: 0.80) */
  descThreshold?: number;
  /** DESC maximum episodes to inject (default: 3 per RULE-010) */
  descMaxEpisodes?: number;
  /** Enable Core Daemon for EpisodeStore/GraphDB IPC (default: true) */
  enableCoreDaemon?: boolean;
}

export interface Interaction {
  id: string;
  /** Trajectory ID for feedback tracking (links to SonaEngine) */
  trajectoryId?: string;
  mode: AgentMode;
  input: string;
  output: string;
  embedding?: Float32Array;
  timestamp: number;
  /** Patterns used from ReasoningBank during this interaction */
  patternsUsed?: string[];
  feedback?: {
    rating: number;  // 0-1
    useful: boolean;
    notes?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEntry {
  id: string;
  content: string;
  type: 'pattern' | 'fact' | 'procedure' | 'example' | 'insight';
  domain: string;
  tags: string[];
  quality: number;
  usageCount: number;
  lastUsed: number;
  createdAt: number;
  /** Optional source URL for web-sourced knowledge */
  source?: string;
}

export interface ResearchResult {
  query: string;
  findings: Array<{
    content: string;
    source: string;
    relevance: number;
    confidence: number;
  }>;
  synthesis: string;
  knowledgeStored: number;
  /** Trajectory ID for feedback (FR-11) */
  trajectoryId?: string;
}

export interface CodeResult {
  task: string;
  code: string;
  language: string;
  patterns_used: string[];
  explanation: string;
  learned: boolean;
  /** Trajectory ID for feedback (FR-11) */
  trajectoryId?: string;
}

export interface WriteResult {
  topic: string;
  content: string;
  style: string;
  sources: string[];
  wordCount: number;
  /** Trajectory ID for feedback (FR-11) */
  trajectoryId?: string;
}

/**
 * Options for ask() method
 */
export interface AskOptions {
  mode?: AgentMode;
  context?: string;
  learnFrom?: boolean;
  /** Return full result object instead of just output string */
  returnResult?: boolean;
  /**
   * TASK-LEARN-006: Execute Task() and capture result for quality assessment
   * When true, runs Task() execution and assesses quality on the RESULT (RULE-033)
   * When false, returns the prompt for manual execution (legacy behavior)
   * Default: false (backward compatible - TASK-LEARN-007 will enable by default)
   */
  executeTask?: boolean;
  /**
   * TASK-LEARN-006: Custom Task execution function
   * If provided, used to execute the Task() call
   * If not provided, a stub implementation returns the prompt (for TASK-LEARN-007)
   */
  taskExecutionFn?: (agentType: string, prompt: string, options?: { timeout?: number }) => Promise<string>;
}

/**
 * Extended result from ask() when returnResult is true
 */
export interface AskResult {
  /** The generated output */
  output: string;
  /** Trajectory ID for feedback submission */
  trajectoryId?: string;
  /** Pattern IDs used from knowledge base */
  patternsUsed: string[];
  /** Auto-estimated quality score */
  qualityScore: number;
  /** Whether auto-feedback was submitted */
  autoFeedbackSubmitted: boolean;
  /** DAI-001: Selected agent key */
  selectedAgent?: string;
  /** DAI-001: Selected agent category */
  selectedAgentCategory?: string;
  /** DAI-001: Task type detected */
  taskType?: string;
  /** DAI-001: Built prompt for Task() execution */
  agentPrompt?: string;
  /** Interaction ID for reference */
  interactionId: string;
  /** DESC: Number of prior solution episodes injected (RULE-010) */
  descEpisodesInjected?: number;
  /**
   * TASK-LEARN-006: Whether Task() was executed and result captured (RULE-033)
   * true = quality assessed on Task() result
   * false = quality assessed on prompt (legacy, unreliable)
   */
  taskExecuted?: boolean;
  /**
   * TASK-LEARN-006: Content type that was assessed (RULE-036 compliance)
   * 'result' = Task() execution result (reliable)
   * 'prompt' = Agent prompt (unreliable, legacy)
   */
  assessedContentType?: 'result' | 'prompt';
}

/**
 * TASK-GODCODE-001: Code task preparation result for two-phase execution
 *
 * Implements [REQ-GODCODE-001]: CLI does NOT attempt task execution
 * Implements [REQ-GODCODE-002]: CLI returns builtPrompt in JSON
 * Implements [REQ-GODCODE-003]: CLI returns agentType for Task()
 *
 * Phase 1: CLI calls prepareCodeTask() -> returns this interface
 * Phase 2: Skill executes Task() with builtPrompt and agentType
 */
export interface ICodeTaskPreparation {
  /** Agent key from registry (DAI-001) */
  selectedAgent: string;
  /** Agent type for Task() subagent_type parameter */
  agentType: string;
  /** Agent category (e.g., "development", "analysis") */
  agentCategory: string;
  /** Full prompt with DESC injection for Task() execution */
  builtPrompt: string;
  /** Original user input task */
  userTask: string;
  /** Injected DESC episodes context (RULE-010) */
  descContext: string | null;
  /** Retrieved memory context from InteractionStore */
  memoryContext: string | null;
  /** Trajectory ID for learning feedback (FR-11) */
  trajectoryId: string | null;
  /** Whether this is a multi-agent pipeline task */
  isPipeline: boolean;
  /**
   * Pipeline definition if isPipeline is true
   * TASK-PREP-003: Extended with full DAG configuration
   */
  pipeline?: {
    /** Phase names for backward compatibility */
    steps: string[];
    /** Agent keys for backward compatibility */
    agents: string[];
    /**
     * Full pipeline configuration with DAG, phases, and agent mappings
     * Implements [REQ-PREP-003]: Dynamic 40-agent DAG generation
     */
    config?: IPipelineExecutionConfig;
  };
  /** Detected or specified programming language */
  language?: string;
  /**
   * TASK-PREP-003: Whether pipeline was triggered by hook context
   * Implements [REQ-PREP-002]: Hook context detection at coding/context/task
   */
  triggeredByHook?: boolean;
}

/**
 * TASK-GODWRITE-001: Write task preparation result for two-phase execution
 *
 * Implements [REQ-GODWRITE-001]: CLI does NOT attempt task execution
 * Implements [REQ-GODWRITE-002]: CLI returns builtPrompt in JSON
 * Implements [REQ-GODWRITE-003]: CLI returns agentType for Task()
 *
 * Phase 1: CLI calls prepareWriteTask() -> returns this interface
 * Phase 2: Skill executes Task() with builtPrompt and agentType
 */
export interface IWriteTaskPreparation {
  // ========== Core Fields (same as ICodeTaskPreparation) ==========

  /** Agent key from registry (DAI-001) */
  selectedAgent: string;

  /** Agent type for Task() subagent_type parameter */
  agentType: string;

  /** Agent category (e.g., "documentation", "writing") */
  agentCategory: string;

  /** Full prompt with DESC injection for Task() execution */
  builtPrompt: string;

  /** Original user input topic */
  userTask: string;

  /** Injected DESC episodes context (RULE-010) */
  descContext: string | null;

  /** Retrieved memory context from InteractionStore */
  memoryContext: string | null;

  /** Trajectory ID for learning feedback (FR-11) */
  trajectoryId: string | null;

  /** Whether this is a multi-agent pipeline task */
  isPipeline: boolean;

  /** Pipeline definition if isPipeline is true */
  pipeline?: { steps: string[]; agents: string[] };

  // ========== Writing-Specific Fields ==========

  /** Writing style (academic, professional, casual, technical) */
  style: 'academic' | 'professional' | 'casual' | 'technical';

  /** Document format (essay, report, article, paper) */
  format: 'essay' | 'report' | 'article' | 'paper';

  /** Content length (short, medium, long, comprehensive) */
  length: 'short' | 'medium' | 'long' | 'comprehensive';

  /** Style profile ID if using learned style (optional) */
  styleProfileId?: string;

  /** Whether a style profile was applied */
  styleProfileApplied: boolean;
}

/**
 * TASK-GOD-002: Market analysis task preparation result for two-phase execution
 *
 * Implements [REQ-MA-001]: CLI does NOT attempt task execution
 * Implements [REQ-MA-002]: CLI returns builtPrompt in JSON
 * Implements [REQ-MA-003]: CLI returns agentType for Task()
 *
 * Phase 1: CLI calls prepareMarketAnalysisTask() -> returns this interface
 * Phase 2: Skill executes Task() with builtPrompt and agentType
 */
export interface IMarketAnalysisTaskPreparation {
  /** Agent key from registry (DAI-001) */
  selectedAgent: string;

  /** Agent type for Task() subagent_type parameter */
  agentType: string;

  /** Agent category (e.g., "analysis", "market") */
  agentCategory: string;

  /** Full prompt with DESC injection for Task() execution */
  builtPrompt: string;

  /** Original user input task */
  userTask: string;

  /** Injected DESC episodes context (RULE-010) */
  descContext: string | null;

  /** Retrieved memory context from InteractionStore */
  memoryContext: string | null;

  /** Trajectory ID for learning feedback (FR-11) */
  trajectoryId: string | null;

  /** Whether this is a multi-agent pipeline task (always false for market-analysis) */
  isPipeline: false;

  /** Pipeline definition (undefined for market-analysis) */
  pipeline?: undefined;

  // ========== Market-Analysis-Specific Fields ==========

  /** The sub-command: analyze, scan, or compare */
  subCommand: 'analyze' | 'scan' | 'compare';

  /** Primary ticker symbol */
  ticker?: string;

  /** Comparison ticker symbol (for compare sub-command) */
  compareTicker?: string;

  /** Analysis methodology filter (e.g., wyckoff, elliott, ict, canslim) */
  methodology?: string;

  /** Signal filter (e.g., bullish, bearish, neutral) */
  signalFilter?: string;
}

/**
 * TASK-LEARN-007: Task execution result from default executor
 * Captures execution metadata for quality assessment and learning
 *
 * Per RULE-024: Quality on RESULT (supports Task execution to get result)
 */
export interface TaskExecutionResult {
  /** The task execution output */
  result: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Task type detected from agent selection */
  taskType: string;
  /** Agent key that executed the task */
  agentId: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Unified learning statistics combining all subsystems
 */
export interface UnifiedLearningStats {
  // Existing fields
  totalInteractions: number;
  knowledgeEntries: number;
  domainExpertise: Record<string, number>;
  topPatterns: Array<{ id: string; uses: number }>;

  // NEW from SonaEngine
  sonaMetrics?: {
    totalTrajectories: number;
    totalRoutes: number;
    averageQualityByRoute: Record<string, number>;
    improvementPercentage: Record<string, number>;
    currentDrift: number;
  };

  // NEW computed
  learningEffectiveness?: {
    baselineQuality: number;      // First 20 trajectories avg
    learnedQuality: number;       // Last 20 trajectories avg
    improvementPct: number;       // G3 requirement: 10-30%
    sampleSize: number;           // Number of trajectories used
  };

  // Persistence stats
  persistenceStats?: {
    highQualityCount: number;
    oldestInteraction: number | null;
    newestInteraction: number | null;
    lastSaved: string;
  };
}

// ==================== DAI-003: Task Routing Types ====================

/**
 * Options for task() method (DAI-003)
 */
export interface ITaskOptions {
  /** Explicit agent override (bypass routing) */
  agent?: string;
  /** Skip confirmation flow even for low confidence */
  skipConfirmation?: boolean;
}

/**
 * Result from task() method (DAI-003)
 */
export interface ITaskResult {
  /** Task execution result */
  result: string;
  /** Routing decision metadata */
  routing: IRoutingResult;
  /** Generated pipeline if multi-step task */
  pipeline?: IGeneratedPipeline;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Agent that was used */
  agentUsed: string;
}

// ==================== Universal Agent ====================

// Persistence path for LEANN vector index
const LEANN_PERSISTENCE_PATH = './vector_db_leann';

export class UniversalAgent {
  private agent: GodAgent;
  private config: Required<UniversalConfig>;
  private interactionStore!: InteractionStore;
  private initialized = false;

  // Learning state
  private successfulPatterns: Map<string, number> = new Map(); // pattern -> success count
  private domainExpertise: Map<string, number> = new Map();    // domain -> knowledge count

  // Trajectory bridge for auto-feedback (FR-11)
  private trajectoryBridge?: TrajectoryBridge;

  // Style profile manager for learned writing styles
  private styleProfileManager?: StyleProfileManager;

  // Code executor for production-ready code (SPEC-EXE-001)
  private codeExecutor: ClaudeCodeExecutor;

  // Embedding provider for semantic embeddings (SPEC-EMB-002)
  private embeddingProvider!: IEmbeddingProvider;

  // Writing generator for LLM-based content creation (SPEC-WRT-001)
  // Null when ANTHROPIC_API_KEY not set (graceful degradation)
  private writingGenerator: IWritingGenerator | null = null;

  // Web search provider for research operations (SPEC-WEB-001)
  private webSearchProvider!: IWebSearchProvider;

  // DAI-001: Dynamic Agent Integration
  private agentRegistry!: AgentRegistry;
  private agentSelector!: AgentSelector;
  private taskExecutor!: TaskExecutor;

  // DAI-002: Multi-Agent Sequential Pipeline Orchestration
  private pipelineExecutor!: PipelineExecutor;

  // LEANN context service for semantic search (persistence-enabled)
  private leannContextService?: LeannContextService;

  // DAI-003: Intelligent Task Routing
  private taskAnalyzer!: TaskAnalyzer;
  private capabilityIndex!: CapabilityIndex;
  private routingEngine!: RoutingEngine;
  private pipelineGenerator!: PipelineGenerator;
  private routingLearner!: RoutingLearner;
  private confirmationHandler!: ConfirmationHandler;
  private failureClassifier!: FailureClassifier;

  // MEM-001: Multi-Process Memory Client
  private memoryClient!: MemoryClient;

  // DESC: UCM Daemon client for episode injection (RULE-010)
  private ucmClient!: UCMDaemonClient;

  // DAEMON-003: Core Daemon client for EpisodeStore/GraphDB IPC
  private coreDaemonClient!: CoreDaemonClient;

  // TASK-CHUNK-003: Knowledge chunker for OpenAI token limit compliance
  // CONSTITUTION: RULE-064 (symmetric chunking)
  private knowledgeChunker!: KnowledgeChunker;

  constructor(config: UniversalConfig = {}) {
    const storageDir = config.storageDir ?? '.agentdb/universal';
    const enablePersistence = config.enablePersistence ?? true;

    // RULE-035: Feedback threshold MUST be 0.5
    this.config = {
      autoLearn: config.autoLearn ?? true,
      autoStoreThreshold: config.autoStoreThreshold ?? 0.5,
      verbose: config.verbose ?? false,
      defaultMode: config.defaultMode ?? 'general',
      learningRate: config.learningRate ?? 0.01,
      enableWebSearch: config.enableWebSearch ?? true,
      enablePersistence,
      storageDir,
      // DESC: Episode injection settings (RULE-010: default window size 3)
      enableDESC: config.enableDESC ?? true,
      descThreshold: config.descThreshold ?? 0.80,
      descMaxEpisodes: config.descMaxEpisodes ?? 3,
      // DAEMON-003: Core daemon for EpisodeStore/GraphDB IPC (default: enabled)
      // TASK-DAEMON-002: Core daemon RPC now implemented
      enableCoreDaemon: config.enableCoreDaemon ?? true,
    };

    // Configure GodAgent with persistence enabled
    this.agent = new GodAgent({
      enableObservability: true,
      verbose: this.config.verbose,
      // Layer 1: VectorDB persistence
      vectorDB: {
        persistencePath: `${storageDir}/vectors.bin`,
        autoSave: enablePersistence,
      },
      // Layer 1: GraphDB persistence
      graphDB: {
        dataDir: `${storageDir}/graphs`,
        enablePersistence,
      },
      // Layer 4: Learning persistence
      learning: {
        checkpointsDir: `${storageDir}/checkpoints`,
      } as Partial<ISonaConfig>,
    });

    // Initialize ClaudeCodeExecutor (SPEC-EXE-001)
    this.codeExecutor = new ClaudeCodeExecutor({ verbose: this.config.verbose });
  }

  // ==================== Initialization ====================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log('Initializing Universal Self-Learning Agent...');

    // Ensure storage directory exists
    if (this.config.enablePersistence) {
      await this.ensureStorageDir();
    }

    const result = await this.agent.initialize();

    if (!result.success) {
      throw new Error(`Failed to initialize: ${result.warnings.join(', ')}`);
    }

    // Initialize interaction store with LRU caching
    // RULE-035: highQualityThreshold is pattern threshold (0.7), NOT feedback threshold
    this.interactionStore = new InteractionStore({
      storageDir: this.config.storageDir,
      maxInteractions: 1000,
      highQualityThreshold: 0.7,  // Pattern threshold per RULE-035
      rollingWindowDays: 7,
      persistCount: 100,
    });

    // Only load persisted interactions if persistence is enabled
    if (this.config.enablePersistence) {
      await this.interactionStore.load();
    }

    // Load persisted state
    if (this.config.enablePersistence) {
      await this.loadPersistedState();
    }

    // TASK-CHUNK-003: Initialize knowledge chunker for OpenAI token limit compliance
    // CONSTITUTION: RULE-064 (symmetric chunking), RULE-008 (SQLite persistence)
    this.knowledgeChunker = new KnowledgeChunker();
    this.log('KnowledgeChunker initialized - Chunking enabled');

    // Initialize TrajectoryBridge for auto-feedback (FR-11)
    const reasoningBank = this.agent.getReasoningBank();
    const sonaEngine = this.agent.getSonaEngine();
    if (reasoningBank && sonaEngine) {
      this.trajectoryBridge = new TrajectoryBridge(reasoningBank, sonaEngine);
      this.log('TrajectoryBridge initialized - Auto-feedback enabled');
    } else {
      this.log('Warning: ReasoningBank or SonaEngine not available - Auto-feedback disabled');
    }

    // Initialize StyleProfileManager for learned writing styles
    if (this.config.enablePersistence) {
      this.styleProfileManager = new StyleProfileManager(process.cwd());
      this.log('StyleProfileManager initialized - Style learning enabled');
    }

    // Initialize embedding provider (SPEC-EMB-002)
    this.embeddingProvider = await EmbeddingProviderFactory.getProvider();
    this.log(`Embedding provider: ${this.embeddingProvider.getProviderName?.() ?? 'unknown'}`);

    // Initialize writing generator (SPEC-WRT-001)
    this.writingGenerator = this.createWritingGenerator();
    this.log('Writing generator initialized - LLM-based content generation enabled');

    // Initialize web search provider (SPEC-WEB-001)
    this.webSearchProvider = new HybridSearchProvider({ verbose: this.config.verbose });
    this.log(`Web search provider: ${this.webSearchProvider.getAvailableSources().join(', ')}`);

    // DAI-001: Initialize dynamic agent system
    this.agentRegistry = new AgentRegistry({ basePath: '.claude/agents', verbose: this.config.verbose });
    await this.agentRegistry.initialize('.claude/agents');
    this.agentSelector = new AgentSelector(this.agentRegistry, { verbose: this.config.verbose });
    this.taskExecutor = new TaskExecutor({ verbose: this.config.verbose });
    this.log(`DAI-001: AgentRegistry initialized with ${this.agentRegistry.size} agents`);

    // DAI-002: Initialize multi-agent sequential pipeline executor
    // Note: reuses reasoningBank from TrajectoryBridge initialization above

    // Initialize LEANN semantic search for infinite context retrieval
    // PRD: Use DualCodeEmbeddingProvider for optimized code search (NLP + Code fusion)
    let leannContextService: ReturnType<typeof createLeannContextService> | undefined;
    let dualEmbeddingProvider: DualCodeEmbeddingProvider | undefined;
    try {
      leannContextService = createLeannContextService({
        defaultMaxResults: 10,
        minSimilarityThreshold: 0.5,
      });

      // Create DualCodeEmbeddingProvider for smart code/NLP embedding fusion
      // 40% NLP weight (understand query intent) + 60% code weight (understand structure)
      dualEmbeddingProvider = createDualCodeEmbeddingProvider({
        dimension: this.embeddingProvider.getDimensions?.() ?? 1536,
        nlpWeight: 0.4,
        codeWeight: 0.6,
        cacheEnabled: true,
        cacheMaxSize: 1000,
        provider: 'local', // Uses gte-Qwen2 underneath
      });

      // Create LEANN-compatible embedder using dual provider
      const embeddingDimension = dualEmbeddingProvider.getDimensions();
      const leannEmbedder = createLEANNEmbedder(dualEmbeddingProvider);

      // Track embedding failures to prevent silent corruption
      let embeddingFailures = 0;
      let embeddingAttempts = 0;
      const MAX_FAILURE_RATE = 0.3; // 30% failure rate threshold

      const leannAdapter = createLEANNAdapter(
        // Wrap with error handling and failure tracking
        async (text: string) => {
          embeddingAttempts++;
          try {
            const result = await leannEmbedder(text);
            return result;
          } catch (error) {
            embeddingFailures++;
            const failureRate = embeddingFailures / embeddingAttempts;

            // If failure rate exceeds threshold, propagate error to prevent index corruption
            if (failureRate > MAX_FAILURE_RATE && embeddingAttempts > 10) {
              console.error(`[LEANN] Embedding failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold, propagating error`);
              throw error;
            }

            // Below threshold: log error but allow graceful degradation with zero vector
            console.error(`[LEANN] DualCodeEmbedding failed (${embeddingFailures}/${embeddingAttempts} = ${(failureRate * 100).toFixed(1)}%): ${error}`);
            return new Float32Array(embeddingDimension);
          }
        },
        embeddingDimension
      );
      await leannContextService.initialize(leannAdapter);
      this.log(`LEANN: DualCodeEmbedding initialized (${embeddingDimension}D, 40% NLP + 60% Code fusion)`);

      // Store as class member for persistence during shutdown
      this.leannContextService = leannContextService;

      // Load persisted vectors if available
      try {
        const loaded = await leannContextService.load(LEANN_PERSISTENCE_PATH);
        if (loaded) {
          const vectorCount = leannContextService.getVectorCount();
          this.log(`LEANN: Loaded ${vectorCount} vectors from ${LEANN_PERSISTENCE_PATH}`);
        } else {
          this.log('LEANN: No persisted vectors found, starting fresh');
        }
      } catch (error) {
        this.log(`LEANN: Failed to load persisted vectors (non-fatal): ${error}`);
      }
    } catch (error) {
      this.log(`LEANN: Initialization failed (non-fatal): ${error}`);
      leannContextService = undefined;
      dualEmbeddingProvider = undefined;
    }

    this.pipelineExecutor = createPipelineExecutor(
      {
        agentRegistry: this.agentRegistry,
        agentSelector: this.agentSelector,
        interactionStore: this.interactionStore,
        reasoningBank: reasoningBank ?? undefined,
        leannContextService,
      },
      {
        verbose: this.config.verbose,
        enableLearning: true,
      }
    );
    this.log('DAI-002: PipelineExecutor initialized - Sequential multi-agent pipelines enabled');
    this.log('LEANN: Semantic context service ready for infinite context retrieval');

    // DAI-003: Initialize intelligent task routing system (AFTER agentRegistry)
    this.taskAnalyzer = new TaskAnalyzer({
      useLocalEmbedding: true,
      verbose: this.config.verbose,
    });

    this.capabilityIndex = new CapabilityIndex({
      agentsPath: '.claude/agents',
      useLocalEmbedding: true,
      freshnessThreshold: 24 * 60 * 60 * 1000, // 24h
      verbose: this.config.verbose,
    });
    await this.capabilityIndex.initialize();

    this.failureClassifier = new FailureClassifier();

    this.routingEngine = new RoutingEngine({
      capabilityIndex: this.capabilityIndex,
      verbose: this.config.verbose,
    });

    this.pipelineGenerator = new PipelineGenerator({
      routingEngine: this.routingEngine,
      verbose: this.config.verbose,
    });

    this.routingLearner = new RoutingLearner({
      reasoningBank: reasoningBank,
      failureClassifier: this.failureClassifier,
      verbose: this.config.verbose,
    });

    this.confirmationHandler = new ConfirmationHandler({
      verbose: this.config.verbose,
    });

    this.log('DAI-003: Routing system initialized - Intelligent task routing enabled');

    // MEM-001: Initialize memory client for multi-process memory access
    // Daemons are started externally via scripts/god-agent-start.sh (no auto-start)
    try {
      this.memoryClient = getMemoryClient(
        this.config.storageDir.replace('/universal', ''),
        { verbose: this.config.verbose, autoStart: false }
      );
      await this.memoryClient.connect();
      this.log('MEM-001: Memory client connected to daemon');
    } catch (error) {
      // Non-fatal: memory client is optional enhancement
      this.log(`MEM-001: Memory client initialization failed: ${error}`);
    }

    // DAEMON-003: Initialize Core Daemon client for EpisodeStore/GraphDB IPC
    if (this.config.enableCoreDaemon !== false) {
      try {
        this.coreDaemonClient = getCoreDaemonClient();
        const isHealthy = await this.coreDaemonClient.isHealthy();
        if (isHealthy) {
          this.log('DAEMON-003: Core daemon client connected');
        } else {
          this.log('DAEMON-003: Core daemon not healthy, will auto-start on first use');
        }
      } catch (error) {
        // Non-fatal: core daemon is optional enhancement
        this.log(`DAEMON-003: Core daemon client init failed: ${error}`);
        this.coreDaemonClient = getCoreDaemonClient();
      }
    }

    // DESC: Initialize UCM client for episode injection (RULE-010)
    if (this.config.enableDESC) {
      try {
        this.ucmClient = getUCMClient();
        const isHealthy = await this.ucmClient.isHealthy();
        if (isHealthy) {
          this.log(`DESC: UCM client initialized (threshold: ${this.config.descThreshold}, maxEpisodes: ${this.config.descMaxEpisodes})`);
        } else {
          this.log('DESC: UCM daemon not healthy, episode injection will attempt auto-start on first use');
        }
      } catch (error) {
        // Non-fatal: DESC is optional enhancement
        this.log(`DESC: UCM client initialization failed: ${error}`);
        this.ucmClient = getUCMClient(); // Still assign for potential later use
      }
    } else {
      this.log('DESC: Episode injection disabled');
    }

    this.log(`Runtime: ${result.runtime.type}`);
    this.log(`Persistence: ${this.config.enablePersistence ? 'enabled' : 'disabled'}`);
    this.log(`Storage: ${this.config.storageDir}`);
    this.log('Universal Agent ready - Learning enabled');

    this.initialized = true;
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    const dirs = [
      this.config.storageDir,
      `${this.config.storageDir}/graphs`,
      `${this.config.storageDir}/weights`,
      `${this.config.storageDir}/checkpoints`,
    ];
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true }).catch(() => {});
    }
  }

  /**
   * Load persisted state from disk
   */
  private async loadPersistedState(): Promise<void> {
    const { readFile } = await import('fs/promises');
    const statePath = `${this.config.storageDir}/agent-state.json`;

    try {
      const data = await readFile(statePath, 'utf-8');
      const state = JSON.parse(data);

      // Restore local state
      this.successfulPatterns = new Map(Object.entries(state.successfulPatterns || {}));
      this.domainExpertise = new Map(Object.entries(state.domainExpertise || {}));

      // Note: Interactions now loaded via InteractionStore
      const storeStats = this.interactionStore.getStats();
      this.log(`Loaded state: ${this.successfulPatterns.size} patterns, ${this.domainExpertise.size} domains`);
      this.log(`Loaded: ${storeStats.totalInteractions} interactions, ${storeStats.knowledgeCount} knowledge entries`);
    } catch {
      // INTENTIONAL: No previous state found is expected on first run - starting fresh is valid
      this.log('No previous state found - starting fresh');
    }
  }

  /**
   * Save state to disk
   */
  private async savePersistedState(): Promise<void> {
    if (!this.config.enablePersistence) return;

    // Save interaction store
    await this.interactionStore.save();

    const { writeFile } = await import('fs/promises');
    const statePath = `${this.config.storageDir}/agent-state.json`;

    const storeStats = this.interactionStore.getStats();
    const state = {
      successfulPatterns: Object.fromEntries(this.successfulPatterns),
      domainExpertise: Object.fromEntries(this.domainExpertise),
      sessionKnowledgeCount: storeStats.knowledgeCount,
      interactionsCount: storeStats.totalInteractions,
      lastSaved: new Date().toISOString(),
    };

    await writeFile(statePath, JSON.stringify(state, null, 2));
    this.log(`State saved: ${this.successfulPatterns.size} patterns, ${this.domainExpertise.size} domains`);
  }

  /**
   * Create writing generator with Anthropic API (SPEC-WRT-001)
   * Returns null if ANTHROPIC_API_KEY not set (graceful degradation)
   */
  private createWritingGenerator(): IWritingGenerator | null {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.log('Warning: ANTHROPIC_API_KEY not set - writing generation will be unavailable');
      return null;
    }
    return new AnthropicWritingGenerator(
      process.env.ANTHROPIC_API_KEY,
      this.styleProfileManager
    );
  }

  // ==================== DAI-001: Dynamic Agent Execution ====================

  /**
   * Execute task using dynamically selected agent (DAI-001)
   *
   * This method:
   * 1. Analyzes the task to determine best agent
   * 2. Builds prompt using TaskExecutor
   * 3. Returns the selection and prompt (for Task() execution)
   *
   * NOTE: Actual Task() execution is done by the caller (Claude Code CLI)
   * This method provides the selection + prompt building layer.
   */
  async selectAgentForTask(task: string): Promise<{
    selection: IAgentSelectionResult;
    prompt: string;
    context?: string;
  }> {
    await this.ensureInitialized();

    // Select best agent for task
    const selection = this.agentSelector.selectAgent(task);

    this.log(`DAI-001: Selected agent '${selection.selected.key}' for task`);
    this.log(`  Category: ${selection.selected.category}`);
    this.log(`  Task type: ${selection.analysis.taskType}`);
    this.log(`  Score: ${selection.candidates[0]?.score.toFixed(2)}`);

    // Gather memory context from InteractionStore
    const relevantKnowledge = this.interactionStore.getKnowledgeByDomain(
      `project/${selection.analysis.taskType}`
    );
    const context = relevantKnowledge.length > 0
      ? relevantKnowledge
          .slice(0, 5)
          .map(k => `- ${k.content.substring(0, 200)}`)
          .join('\n')
      : undefined;

    // Build the prompt
    const prompt = this.taskExecutor.buildPrompt(
      selection.selected,
      task,
      context
    );

    return {
      selection,
      prompt,
      context,
    };
  }

  /**
   * Get AgentRegistry for external access (DAI-001)
   */
  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  /**
   * Get AgentSelector for external access (DAI-001)
   */
  getAgentSelector(): AgentSelector {
    return this.agentSelector;
  }

  /**
   * Get TaskExecutor for external access (DAI-001)
   */
  getTaskExecutor(): TaskExecutor {
    return this.taskExecutor;
  }

  /**
   * Get PipelineExecutor for external access (DAI-002)
   */
  getPipelineExecutor(): PipelineExecutor {
    return this.pipelineExecutor;
  }

  /**
   * Get MemoryClient for multi-process memory access (MEM-001)
   */
  getMemoryClient(): MemoryClient {
    return this.memoryClient;
  }

  // ==================== TASK-LEARN-007: Default Task Execution ====================

  /**
   * Default Task execution function for ask() method
   *
   * TASK-LEARN-007: Implements the default execution path when executeTask=true
   * but no custom taskExecutionFn is provided.
   *
   * TASK-HOOK-006: Wires HookExecutor for pre/post Tool Use hooks
   * CONSTITUTION COMPLIANCE:
   * - RULE-033: DESC context MUST be injected into every Task-style tool call (via preToolUseHooks)
   * - RULE-035: All agent results MUST be assessed for quality with 0.5 threshold
   * - RULE-036: Task hook outputs MUST include quality assessment scores
   *
   * Uses TaskExecutor.execute() which wraps the Task() abstraction with:
   * - Prompt building from agent definition
   * - Error handling with AgentExecutionError
   * - Observability events (agent_started, agent_completed, agent_failed)
   * - Duration tracking
   * - Pre/post hook execution (TASK-HOOK-006)
   *
   * Per RULE-024: Quality on RESULT (supports Task execution to get result)
   *
   * @param agentSelection - The result from selectAgentForTask()
   * @param taskExecutionFn - Optional custom execution function
   * @param options - Optional execution options including trajectoryId
   * @returns TaskExecutionResult with result, success status, and duration
   */
  private async executeTaskDefault(
    agentSelection: {
      selection: IAgentSelectionResult;
      prompt: string;
      context?: string;
    },
    taskExecutionFn?: (agentType: string, prompt: string, options?: { timeout?: number }) => Promise<string>,
    options?: {
      /** Trajectory ID for quality tracking (RULE-036) */
      trajectoryId?: string;
    }
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const agent = agentSelection.selection.selected;
    const taskType = agentSelection.selection.analysis.taskType || 'unknown';
    const agentType = agent.frontmatter?.type ?? agent.category;
    const toolName = 'Task'; // All Task-style operations use this tool name

    // TASK-HOOK-006: Generate session ID for hook tracking
    const sessionId = this.generateId();
    const trajectoryId = options?.trajectoryId;

    // TASK-HOOK-006: Get the hook executor singleton
    const hookExecutor = getHookExecutor();

    // TASK-HOOK-006: Build pre-tool-use hook context
    // RULE-033: DESC context injection happens here via auto-injection hook
    const preHookContext: IHookContext = {
      toolName,
      toolInput: {
        agentType,
        prompt: agentSelection.prompt,
        context: agentSelection.context,
        taskType,
        agentKey: agent.key,
      },
      sessionId,
      trajectoryId,
      timestamp: Date.now(),
      metadata: {
        source: 'UniversalAgent.executeTaskDefault',
        agentCategory: agent.category,
      },
    };

    // TASK-HOOK-006: Execute preToolUse hooks BEFORE task execution
    // This triggers DESC context injection (RULE-033) and other pre-execution hooks
    let preHookResult: IHookChainResult | undefined;
    let modifiedInput = agentSelection.prompt;
    try {
      preHookResult = await hookExecutor.executePreToolUseHooks(preHookContext);

      // Log hook execution for observability
      this.log(`TASK-HOOK-006: preToolUseHooks executed`, {
        hooksExecuted: preHookResult.results.length,
        allSucceeded: preHookResult.allSucceeded,
        chainStopped: preHookResult.chainStopped,
        durationMs: preHookResult.totalDurationMs,
        trajectoryId,
      });

      // Check if a hook stopped execution (e.g., validation failure)
      if (preHookResult.chainStopped) {
        const stoppedBy = preHookResult.stoppedByHook ?? 'unknown';
        const stopReason = preHookResult.results.find(r => r.hookId === stoppedBy)?.result?.stopReason ?? 'Hook stopped execution';
        this.log(`TASK-HOOK-006: Execution stopped by hook '${stoppedBy}': ${stopReason}`);

        return {
          result: `Task execution blocked by hook: ${stopReason}`,
          success: false,
          taskType,
          agentId: agent.key,
          durationMs: Date.now() - startTime,
          error: `Hook '${stoppedBy}' blocked execution: ${stopReason}`,
        };
      }

      // Apply any modified input from hooks (e.g., DESC context injection)
      if (preHookResult.finalInput !== undefined && typeof preHookResult.finalInput === 'object') {
        const finalInput = preHookResult.finalInput as { prompt?: string };
        if (finalInput.prompt) {
          modifiedInput = finalInput.prompt;
          this.log(`TASK-HOOK-006: Hook modified prompt (DESC injection applied)`);
        }
      }
    } catch (hookError) {
      // Hooks should not crash main execution - log and continue
      this.log(`TASK-HOOK-006: preToolUseHooks error (continuing): ${hookError}`);
    }

    try {
      let result: string;
      let executionSuccess = true;

      if (taskExecutionFn) {
        // Use custom execution function if provided
        result = await taskExecutionFn(
          agentType,
          modifiedInput,
          { timeout: 120000 }
        );
      } else {
        // Implements [REQ-EXEC-001]: No external API calls - output structured task for Claude Code
        // Implements [REQ-EXEC-002]: Return Task for Claude Code Execution
        // Implements [REQ-EXEC-003]: Integrate with Claude Code Task Tool
        const executionResult = await this.taskExecutor.execute(
          agent,
          modifiedInput,
          async (_agentType: string, prompt: string, options?: { timeout?: number }) => {
            // Implements [REQ-EXEC-002]: Build structured task for Claude Code
            const structuredTask: IStructuredTask = this.taskExecutor.buildStructuredTask(
              agent,
              prompt,
              { timeout: options?.timeout, trajectoryId }
            );

            // Implements [REQ-EXEC-003]: Output task as JSON for Claude Code Task tool
            // The markers allow Claude Code to parse the task specification
            // Only output markers when verbose=true (not in --json mode) to avoid corrupting JSON output
            if (this.config.verbose) {
              console.log('\n================================================================================');
              console.log('CLAUDE_CODE_TASK_START');
              console.log('================================================================================');
              console.log(JSON.stringify(structuredTask, null, 2));
              console.log('================================================================================');
              console.log('CLAUDE_CODE_TASK_END');
              console.log('================================================================================\n');
            }

            this.log(`TASK-EXEC-001: Structured task output for Claude Code execution`, {
              taskId: structuredTask.taskId,
              agentType: structuredTask.agentType,
              agentKey: structuredTask.agentKey,
              promptLength: prompt.length,
            });

            // Implements [REQ-EXEC-005]: Return prompt for learning integration
            // The actual result will come from Claude Code executing the task
            return `[TASK_QUEUED:${structuredTask.taskId}] Execute via Claude Code Task tool with subagent_type="${structuredTask.agentType}"`;
          },
          { context: agentSelection.context }
        );
        result = executionResult.output;
      }

      const durationMs = Date.now() - startTime;

      // TASK-HOOK-006: Calculate quality score for the result
      // RULE-035: Quality threshold is 0.5
      // RULE-036: Quality scores MUST be logged with trajectoryId
      const qualityInteraction: QualityInteraction = {
        id: sessionId,
        mode: taskType as AgentMode,
        input: agentSelection.prompt,
        output: result,
        timestamp: Date.now(),
      };
      const qualityAssessment = assessQuality(qualityInteraction, this.config.autoStoreThreshold);
      const qualityScore = qualityAssessment.score;

      // RULE-036: Log quality score with trajectoryId
      this.log(`TASK-HOOK-006: Quality assessment`, {
        qualityScore: qualityScore.toFixed(3),
        meetsThreshold: qualityAssessment.meetsThreshold,
        threshold: this.config.autoStoreThreshold,
        trajectoryId,
        sessionId,
      });

      // TASK-HOOK-006: Build post-tool-use hook context
      const postHookContext: IPostToolUseContext = {
        toolName,
        toolInput: preHookContext.toolInput,
        toolOutput: {
          result,
          success: executionSuccess,
          qualityScore,
          meetsThreshold: qualityAssessment.meetsThreshold,
        },
        sessionId,
        trajectoryId,
        timestamp: Date.now(),
        executionDurationMs: durationMs,
        executionSuccess,
        metadata: {
          source: 'UniversalAgent.executeTaskDefault',
          agentCategory: agent.category,
          qualityScore,
          qualityMeetsThreshold: qualityAssessment.meetsThreshold,
        },
      };

      // TASK-HOOK-006: Execute postToolUse hooks AFTER task execution
      // This triggers quality assessment and result capture hooks
      try {
        const postHookResult = await hookExecutor.executePostToolUseHooks(postHookContext);

        // Log hook execution for observability (RULE-036 compliance)
        this.log(`TASK-HOOK-006: postToolUseHooks executed`, {
          hooksExecuted: postHookResult.results.length,
          allSucceeded: postHookResult.allSucceeded,
          durationMs: postHookResult.totalDurationMs,
          trajectoryId,
          qualityScore: qualityScore.toFixed(3),
        });
      } catch (hookError) {
        // Hooks should not crash main execution - log and continue
        this.log(`TASK-HOOK-006: postToolUseHooks error (continuing): ${hookError}`);
      }

      return {
        result,
        success: true,
        taskType,
        agentId: agent.key,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;
      this.log(`TASK-LEARN-007: Task execution failed: ${errorMessage}`);

      // TASK-HOOK-006: Execute postToolUse hooks even on failure
      // This ensures quality assessment hooks can record failures
      try {
        const postHookContext: IPostToolUseContext = {
          toolName,
          toolInput: preHookContext.toolInput,
          toolOutput: {
            result: errorMessage,
            success: false,
            error: errorMessage,
            qualityScore: 0, // Failed tasks get 0 quality
          },
          sessionId,
          trajectoryId,
          timestamp: Date.now(),
          executionDurationMs: durationMs,
          executionSuccess: false,
          metadata: {
            source: 'UniversalAgent.executeTaskDefault',
            agentCategory: agent.category,
            error: errorMessage,
            qualityScore: 0,
          },
        };

        const postHookResult = await hookExecutor.executePostToolUseHooks(postHookContext);

        this.log(`TASK-HOOK-006: postToolUseHooks executed (failure path)`, {
          hooksExecuted: postHookResult.results.length,
          trajectoryId,
          qualityScore: 0,
        });
      } catch (hookError) {
        this.log(`TASK-HOOK-006: postToolUseHooks error on failure path: ${hookError}`);
      }

      return {
        result: errorMessage,
        success: false,
        taskType,
        agentId: agent.key,
        durationMs,
        error: errorMessage,
      };
    }
  }

  // ==================== DAI-002: Pipeline Execution ====================

  /**
   * Execute a multi-agent sequential pipeline (DAI-002)
   *
   * Pipelines are executed strictly sequentially with memory coordination
   * between steps via InteractionStore. Each step waits for the previous
   * step to complete before starting.
   *
   * RULE-004: Sequential execution (no Promise.all)
   * RULE-005: Memory coordination via InteractionStore
   * RULE-006: DAI-001 AgentSelector integration
   * RULE-007: Forward-looking prompts with workflow context
   *
   * @param pipeline - Pipeline definition with agents, steps, and config
   * @param options - Optional execution options (stepExecutor, overrides)
   * @returns Pipeline execution result with step results and quality metrics
   *
   * @example
   * ```typescript
   * const pipeline: IPipelineDefinition = {
   *   name: 'API Feature Pipeline',
   *   sequential: true,
   *   agents: [
   *     {
   *       agentKey: 'backend-dev',
   *       task: 'Implement the API endpoints',
   *       outputDomain: 'project/api',
   *       outputTags: ['endpoints', 'schema'],
   *     },
   *     {
   *       agentKey: 'tester',
   *       task: 'Write integration tests',
   *       inputDomain: 'project/api',
   *       inputTags: ['endpoints'],
   *       outputDomain: 'project/tests',
   *       outputTags: ['integration', 'api'],
   *     },
   *   ],
   * };
   *
   * const result = await agent.runPipeline(pipeline);
   * console.log(`Pipeline ${result.success ? 'succeeded' : 'failed'}`);
   * console.log(`Overall quality: ${result.overallQuality}`);
   * ```
   */
  async runPipeline(
    pipeline: IPipelineDefinition,
    options: DAI002PipelineOptions = {}
  ): Promise<DAI002PipelineResult> {
    await this.ensureInitialized();

    this.log(`DAI-002: Starting pipeline '${pipeline.name}' with ${pipeline.agents.length} steps`);

    try {
      const result = await this.pipelineExecutor.execute(pipeline, options);

      if (result.status === 'completed') {
        this.log(`DAI-002: Pipeline '${pipeline.name}' completed successfully`);
        this.log(`  - Steps: ${result.steps.length}/${pipeline.agents.length}`);
        this.log(`  - Overall quality: ${result.overallQuality.toFixed(2)}`);
        this.log(`  - Duration: ${result.totalDuration}ms`);
      } else {
        this.log(`DAI-002: Pipeline '${pipeline.name}' failed at step ${result.steps.length}`);
        if (result.error) {
          this.log(`  - Error: ${result.error.message}`);
        }
      }

      return result;
    } catch (error) {
      this.log(`DAI-002: Pipeline '${pipeline.name}' threw error: ${(error as Error).message}`);
      throw error;
    }
  }

  // ==================== DAI-003: Intelligent Task Routing ====================

  /**
   * Execute task with intelligent routing (DAI-003)
   *
   * This method:
   * 1. Analyzes the task to determine domain, complexity, and requirements
   * 2. Routes to best agent automatically (or uses explicit override)
   * 3. Detects multi-step tasks and generates pipelines
   * 4. Handles low-confidence decisions with confirmation flow
   * 5. Executes via TaskExecutor or PipelineExecutor
   * 6. Submits feedback to RoutingLearner for continuous improvement
   *
   * @param description - Natural language task description
   * @param options - Optional settings (explicit agent, skip confirmation)
   * @returns Task result with routing metadata and execution info
   *
   * @example
   * ```typescript
   * // Automatic routing
   * const result = await agent.task('Write unit tests for the authentication module');
   * console.log(`Routed to: ${result.routing.selectedAgent}`);
   * console.log(`Confidence: ${result.routing.confidence}`);
   *
   * // Explicit agent override
   * const result = await agent.task('Implement feature X', { agent: 'backend-dev' });
   *
   * // Multi-step task (generates pipeline)
   * const result = await agent.task('Research API design, then implement endpoints, then write tests');
   * console.log(`Pipeline: ${result.pipeline?.stages.length} stages`);
   * ```
   */
  async task(description: string, options: ITaskOptions = {}): Promise<ITaskResult> {
    await this.ensureInitialized();

    const startTime = Date.now();
    let routing: IRoutingResult;
    let pipeline: IGeneratedPipeline | undefined;
    let agentUsed: string;
    let result: string;

    // DESC: Inject prior solutions before processing (RULE-010: window size 3)
    const descResult = await this.injectDESCEpisodes(description, { command: 'god-task', mode: 'general' });
    const augmentedDescription = descResult.augmentedPrompt;

    // Step 1: Check for explicit agent override FIRST (skip analysis if provided)
    if (options.agent) {
      this.log(`DAI-003 task(): Using explicit agent override: ${options.agent}`);

      // Validate the agent exists early (fail fast)
      const agentDef = this.agentRegistry.getByKey(options.agent);
      if (!agentDef) {
        throw new Error(`Agent '${options.agent}' not found in registry`);
      }

      // Create a bypass routing result
      routing = {
        selectedAgent: options.agent,
        selectedAgentName: agentDef.frontmatter.name || options.agent,
        confidence: 1.0,
        usedPreference: true,
        coldStartPhase: 'learned',
        isColdStart: false,
        factors: [{
          name: 'explicit_override',
          weight: 1.0,
          score: 1.0,
          description: 'User explicitly specified agent',
        }],
        explanation: `Using explicitly specified agent: ${options.agent}`,
        alternatives: [],
        requiresConfirmation: false,
        confirmationLevel: 'auto',
        routedAt: Date.now(),
        routingTimeMs: 0,
        routingId: this.generateId(),
      };
      agentUsed = options.agent;
    } else {
      // Step 2: Analyze the task (only when routing is needed, use augmented description)
      this.log(`DAI-003 task(): Analyzing task...`);
      const analysis = await this.taskAnalyzer.analyze(augmentedDescription);

      // Step 3: Route via RoutingEngine
      this.log(`DAI-003 task(): Routing via RoutingEngine...`);
      routing = await this.routingEngine.route(analysis);
      agentUsed = routing.selectedAgent;

      this.log(`DAI-003 task(): Routed to '${agentUsed}' (confidence: ${routing.confidence.toFixed(2)})`);
      if (routing.isColdStart) {
        this.log(`  ${routing.coldStartIndicator}`);
      }

      // Step 4: Check if multi-step task (pipeline generation)
      if (analysis.isMultiStep) {
        this.log(`DAI-003 task(): Multi-step task detected, generating pipeline...`);
        try {
          pipeline = await this.pipelineGenerator.generate(description);
          this.log(`DAI-003 task(): Pipeline generated with ${pipeline.stages.length} stages`);
        } catch (error) {
          this.log(`Warning: Pipeline generation failed: ${error}. Falling back to single-step execution.`);
          pipeline = undefined;
        }
      }
    }

    // Step 5: Handle low-confidence confirmation (unless skipped)
    if (!options.skipConfirmation && routing.requiresConfirmation) {
      this.log(`DAI-003 task(): Low confidence (${routing.confidence.toFixed(2)}), requesting confirmation...`);

      try {
        const confirmation = await this.confirmationHandler.requestConfirmation(routing);

        // Check if user selected a different agent
        if (confirmation.selectedKey !== routing.selectedAgent && !confirmation.wasCancelled) {
          this.log(`DAI-003 task(): User overrode to agent: ${confirmation.selectedKey}`);
          agentUsed = confirmation.selectedKey;

          // Update routing result to reflect override
          routing = {
            ...routing,
            selectedAgent: confirmation.selectedKey,
            selectedAgentName: confirmation.selectedKey,
            usedPreference: true,
          };
        } else if (confirmation.wasCancelled) {
          throw new Error('Task cancelled by user during confirmation');
        }
      } catch (error) {
        this.log(`Warning: Confirmation failed: ${error}. Proceeding with original routing.`);
      }
    }

    // Step 6: Execute the task
    let executionSuccess = true;
    let executionError: string | undefined;

    try {
      if (pipeline) {
        // Execute via PipelineExecutor for multi-step tasks
        this.log(`DAI-003 task(): Executing pipeline with ${pipeline.stages.length} stages...`);
        
        // Convert IGeneratedPipeline to IPipelineDefinition
        const pipelineDefinition: IPipelineDefinition = {
          name: `DAI-003: ${description.substring(0, 50)}`,
          description: description,
          sequential: true,
          agents: pipeline.stages.map((stage, index) => ({
            agentKey: stage.agentKey,
            task: stage.taskSegment,
            outputDomain: stage.outputDomain,
            outputTags: ['dai-003', stage.agentKey],
            timeout: 60000,
          })),
        };
        
        const pipelineResult = await this.pipelineExecutor.execute(pipelineDefinition);

        if (pipelineResult.status === 'failed') {
          executionSuccess = false;
          executionError = pipelineResult.error?.message;
          result = `Pipeline execution failed: ${pipelineResult.error?.message ?? 'Unknown error'}`;
        } else {
          result = `Pipeline completed successfully. ${pipelineResult.steps.length}/${pipeline.stages.length} stages completed.`;
        }
      } else {
        // Execute via TaskExecutor for single-step tasks
        this.log(`DAI-003 task(): Executing task with agent '${agentUsed}'...`);

        // Get agent from registry
        const agent = this.agentRegistry.getByKey(agentUsed);
        if (!agent) {
          throw new Error(`Agent '${agentUsed}' not found in registry`);
        }

        // Implements [REQ-EXEC-001]: No external API calls - output structured task for Claude Code
        // Implements [REQ-EXEC-002]: Return Task for Claude Code Execution
        // Implements [REQ-EXEC-003]: Integrate with Claude Code Task Tool
        // Per RULE-033: Quality MUST be assessed on Task() RESULT, not prompt
        // TaskExecutor.execute() emits agent_started, agent_completed, agent_failed events
        const taskTrajectoryId = `traj-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const executionResult = await this.taskExecutor.execute(
          agent,
          description,
          async (_agentType: string, prompt: string, options?: { timeout?: number }) => {
            // Implements [REQ-EXEC-002]: Build structured task for Claude Code
            const structuredTask: IStructuredTask = this.taskExecutor.buildStructuredTask(
              agent,
              prompt,
              { timeout: options?.timeout, trajectoryId: taskTrajectoryId }
            );

            // Implements [REQ-EXEC-003]: Output task as JSON for Claude Code Task tool
            // Only output markers when verbose=true (not in --json mode) to avoid corrupting JSON output
            if (this.config.verbose) {
              console.log('\n================================================================================');
              console.log('CLAUDE_CODE_TASK_START');
              console.log('================================================================================');
              console.log(JSON.stringify(structuredTask, null, 2));
              console.log('================================================================================');
              console.log('CLAUDE_CODE_TASK_END');
              console.log('================================================================================\n');
            }

            this.log(`DAI-003 task(): Structured task output for Claude Code`, {
              taskId: structuredTask.taskId,
              agentType: structuredTask.agentType,
              agentKey: structuredTask.agentKey,
            });

            // Implements [REQ-EXEC-005]: Return message for learning integration
            return `[TASK_QUEUED:${structuredTask.taskId}] Execute via Claude Code Task tool with subagent_type="${structuredTask.agentType}"`;
          }
        );
        result = executionResult.output;
      }
    } catch (error) {
      executionSuccess = false;
      executionError = error instanceof Error ? error.message : String(error);
      result = `Task execution failed: ${executionError}`;
      this.log(`DAI-003 task(): Execution failed: ${executionError}`);
    }

    const executionTimeMs = Date.now() - startTime;

    // Step 7: Submit feedback to RoutingLearner
    try {
      const feedback: IRoutingFeedback = {
        routingId: routing.routingId,
        task: description,
        selectedAgent: routing.selectedAgent,
        success: executionSuccess,
        executionTimeMs,
        userOverrideAgent: options.agent || (routing.usedPreference ? agentUsed : undefined),
        errorMessage: executionError,
        userAbandoned: false,
        completedStages: pipeline ? pipeline.stages.length : undefined,
        totalStages: pipeline ? pipeline.stages.length : undefined,
        feedbackAt: Date.now(),
      };

      await this.routingLearner.processFeedback(feedback);
      this.log(`DAI-003 task(): Feedback submitted to RoutingLearner`);
    } catch (error) {
      this.log(`Warning: Failed to submit routing feedback: ${error}`);
    }

    // DESC: Store episode for future learning (non-blocking, only if successful)
    if (executionSuccess) {
      this.storeDESCEpisode(description, result, {
        command: 'god-task',
        mode: 'general',
        quality: 0.8, // Tasks that complete successfully get a good quality score
      }).catch(err => this.log(`DESC: Background storage error: ${err}`));
    }

    return {
      result,
      routing,
      pipeline,
      executionTimeMs,
      agentUsed,
    };
  }

  // ==================== Main Interface ====================

  /**
   * Universal ask - routes to appropriate mode and learns
   *
   * Overloaded signatures:
   * - ask(input): Promise<string> - Simple output (backward compatible)
   * - ask(input, { returnResult: true }): Promise<AskResult> - Full result with trajectoryId
   */
  async ask(input: string, options?: AskOptions & { returnResult?: false }): Promise<string>;
  async ask(input: string, options: AskOptions & { returnResult: true }): Promise<AskResult>;
  async ask(input: string, options: AskOptions = {}): Promise<string | AskResult> {
    await this.ensureInitialized();

    const interactionId = this.generateId();

    // DESC: Inject prior solutions before processing (RULE-010: window size 3)
    const descResult = await this.injectDESCEpisodes(input, { command: 'god-ask', mode: options.mode });
    const augmentedInput = descResult.augmentedPrompt;

    // DAI-001: Dynamic agent selection (use augmented input for better context)
    const agentSelection = await this.selectAgentForTask(augmentedInput);
    const mode = options.mode ?? (agentSelection.selection.analysis.taskType as AgentMode);

    this.log(`[${mode.toUpperCase()}] Processing: ${input.slice(0, 50)}...`);
    this.log(`DAI-001: Selected agent '${agentSelection.selection.selected.key}' (${agentSelection.selection.selected.category})`);

    // Get embedding for trajectory creation (use original input for embedding consistency)
    const embedding = await this.embed(input);

    // Create trajectory if bridge available (FR-11)
    let trajectoryId: string | undefined;
    let patternsUsed: string[] = [];

    if (this.trajectoryBridge) {
      try {
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          input, mode, embedding
        );
        trajectoryId = trajectory.trajectoryId;
        patternsUsed = trajectory.patterns.map(p => p.patternId);
        this.log(`Trajectory created: ${trajectoryId} (${patternsUsed.length} patterns)`);
      } catch (error) {
        this.log(`Warning: Trajectory creation failed: ${error}`);
      }
    }

    // TASK-FIX-001: Determine output based on executeTask option (RULE-033)
    // BREAKING CHANGE: executeTask now defaults to TRUE (was false)
    // When executeTask=true (or undefined), execute Task() and assess quality on the RESULT
    // When executeTask=false (explicit), return prompt for manual execution (legacy)
    let output: string;
    let taskExecuted = false;
    let assessedContentType: 'result' | 'prompt' = 'prompt';

    if (options.executeTask !== false && options.taskExecutionFn) {
      // RULE-033: Execute Task() and capture result for quality assessment
      try {
        const agentType = agentSelection.selection.selected.frontmatter?.type
          ?? agentSelection.selection.selected.category;

        this.log(`TASK-LEARN-006: Executing Task() with agent '${agentType}'...`);
        output = await options.taskExecutionFn(
          agentType,
          agentSelection.prompt,
          { timeout: 120000 }
        );
        taskExecuted = true;
        assessedContentType = 'result';

        // RULE-036: Log what we're assessing
        this.log(`TASK-LEARN-006: Quality will be assessed on Task() RESULT`, {
          assessedContent: 'result',
          resultLength: output.length,
          hasCodeBlocks: output.includes('```'),
          hasTaskSummary: output.includes('TASK COMPLETION SUMMARY'),
        });
      } catch (error) {
        // Fallback to prompt on execution failure
        this.log(`TASK-LEARN-006: Task execution failed, falling back to prompt: ${error}`);
        output = agentSelection.prompt;
        assessedContentType = 'prompt';
      }
    } else if (options.executeTask !== false) {
      // TASK-FIX-001: Default path - executeTask=true or undefined (new default)
      // Use the default task executor implementation with ObservabilityBus events
      try {
        this.log(`TASK-LEARN-007: Using default task executor...`);
        // TASK-HOOK-006: Pass trajectoryId for hook quality tracking (RULE-036)
        const executionResult = await this.executeTaskDefault(agentSelection, undefined, { trajectoryId });

        if (executionResult.success) {
          output = executionResult.result;
          taskExecuted = true;
          assessedContentType = 'result';

          // RULE-036: Log what we're assessing
          this.log(`TASK-LEARN-007: Quality will be assessed on Task() RESULT`, {
            assessedContent: 'result',
            resultLength: output.length,
            durationMs: executionResult.durationMs,
            agentId: executionResult.agentId,
            taskType: executionResult.taskType,
          });
        } else {
          // Execution failed, fallback to prompt
          this.log(`TASK-LEARN-007: Default execution failed: ${executionResult.error}`);
          output = agentSelection.prompt;
          assessedContentType = 'prompt';
        }
      } catch (error) {
        // Unexpected error, fallback to prompt
        this.log(`TASK-LEARN-007: Unexpected error in default executor: ${error}`);
        output = agentSelection.prompt;
        assessedContentType = 'prompt';
      }
    } else {
      // TASK-FIX-001: Legacy path - ONLY reached when executeTask=false (explicit)
      // Return prompt for manual Task() execution
      // NOTE: Quality assessment on prompts is UNRELIABLE (prompts score ~0.30)
      output = agentSelection.prompt;
      assessedContentType = 'prompt';

      // RULE-036: Log warning about unreliable assessment
      this.log(`TASK-FIX-001: executeTask=false - Quality assessed on PROMPT (unreliable). Remove executeTask=false for accurate assessment.`);
    }

    // Record interaction with trajectory info
    const interaction: Interaction = {
      id: interactionId,
      trajectoryId,
      mode,
      input,
      output,
      embedding,
      patternsUsed,
      timestamp: Date.now(),
      metadata: {
        context: options.context,
        // TASK-LEARN-006: Track assessment metadata
        taskExecuted,
        assessedContentType,
      }
    };
    this.interactionStore.add(interaction);

    // Estimate quality for auto-feedback
    const qualityInteraction: QualityInteraction = {
      id: interactionId,
      mode,
      input,
      output,
      timestamp: interaction.timestamp,
    };
    const qualityAssessment = assessQuality(qualityInteraction, this.config.autoStoreThreshold);
    const qualityScore = qualityAssessment.score;

    // RULE-036: Log quality assessment details
    this.log(`TASK-LEARN-006: Quality assessment complete`, {
      score: qualityScore.toFixed(3),
      threshold: this.config.autoStoreThreshold,
      meetsThreshold: qualityAssessment.meetsThreshold,
      assessedOn: assessedContentType,
      willTriggerLearning: qualityAssessment.meetsThreshold && this.config.autoLearn,
    });

    // Auto-feedback if bridge available and quality meets threshold (FR-11)
    let autoFeedbackSubmitted = false;
    if (this.config.autoLearn && this.trajectoryBridge && trajectoryId && qualityAssessment.meetsThreshold) {
      try {
        const feedbackResult = await this.trajectoryBridge.submitFeedback(
          trajectoryId,
          qualityScore,
          { implicit: true }
        );
        autoFeedbackSubmitted = true;
        this.log(`Auto-feedback submitted: quality=${qualityScore.toFixed(2)}, patternCreated=${feedbackResult.patternCreated}`);
      } catch (error) {
        this.log(`Warning: Auto-feedback failed: ${error}`);
      }
    }

    // Legacy auto-learn if enabled
    if (this.config.autoLearn && options.learnFrom !== false) {
      await this.learnFromInteraction(interaction);
    }

    // DESC: Store episode for future learning (non-blocking)
    this.storeDESCEpisode(input, output, {
      command: 'god-ask',
      mode,
      quality: qualityScore,
    }).catch(err => this.log(`DESC: Background storage error: ${err}`));

    // Return based on options
    if (options.returnResult) {
      return {
        output,
        trajectoryId,
        patternsUsed,
        qualityScore,
        autoFeedbackSubmitted,
        interactionId,
        // DAI-001 fields
        selectedAgent: agentSelection.selection.selected.key,
        selectedAgentCategory: agentSelection.selection.selected.category,
        taskType: agentSelection.selection.analysis.taskType,
        agentPrompt: agentSelection.prompt,
        // DESC fields
        descEpisodesInjected: descResult.episodesUsed,
        // TASK-LEARN-006 fields (RULE-033, RULE-036)
        taskExecuted,
        assessedContentType,
      };
    }

    return output;
  }

  // ==================== Mode-Specific Processing ====================

  /**
   * TASK-GODCODE-001: Prepare code task for two-phase execution
   *
   * Implements [REQ-GODCODE-001]: CLI does NOT attempt task execution
   * Implements [REQ-GODCODE-002]: CLI returns builtPrompt in JSON
   * Implements [REQ-GODCODE-003]: CLI returns agentType for Task()
   * Implements [REQ-GODCODE-004]: Agent selection via AgentSelector (DAI-001)
   * Implements [REQ-GODCODE-005]: DESC episode injection (RULE-010)
   *
   * This method performs Phase 1 preparation:
   * 1. Injects DESC episodes for prior solutions (RULE-010: window size 3)
   * 2. Selects optimal agent via AgentSelector (DAI-001)
   * 3. Builds full prompt via TaskExecutor.buildPrompt()
   * 4. Creates trajectory for learning feedback (FR-11)
   * 5. Returns ICodeTaskPreparation (NO execution)
   *
   * Phase 2 execution happens in the /god-code skill via Task() tool.
   *
   * CONSTITUTION COMPLIANCE:
   * - RULE-001: All code references REQ-GODCODE-*
   * - RULE-003: Comments reference requirements
   * - RULE-010: DESC window size 3
   * - RULE-019: Real implementation, no scaffolding
   * - RULE-069: Proper try/catch for async operations
   *
   * @param task - The code task to prepare
   * @param options - Optional configuration (language, context)
   * @returns ICodeTaskPreparation with builtPrompt for Task() execution
   */
  async prepareCodeTask(task: string, options: {
    language?: string;
    context?: string;
    /** TASK-PREP-003: Start phase for partial execution (0-6) */
    startPhase?: number;
    /** TASK-PREP-003: End phase for partial execution (0-6) */
    endPhase?: number;
  } = {}): Promise<ICodeTaskPreparation> {
    // Implements [REQ-GODCODE-006]: Ensure initialized before processing
    await this.ensureInitialized();

    // ═══════════════════════════════════════════════════════════════════════════
    // TASK-PREP-003: Check for hook context at coding/context/task
    // Implements [REQ-PREP-002]: Hook context detection
    // ═══════════════════════════════════════════════════════════════════════════
    let triggeredByHook = false;
    try {
      const hookContext = await this.memoryClient?.getKnowledgeByDomain('coding/context', 1);
      if (hookContext && hookContext.length > 0) {
        triggeredByHook = true;
        this.log(`TASK-PREP-003: Hook context detected at coding/context`);
      }
    } catch {
      // No hook context found, continue with normal flow
      this.log(`TASK-PREP-003: No hook context found, using standard pipeline detection`);
    }

    // Implements [REQ-GODCODE-005]: DESC episode injection (RULE-010: window size 3)
    let descContext: string | null = null;
    let augmentedTask = task;
    try {
      const descResult = await this.injectDESCEpisodes(task, { command: 'god-code', mode: 'code' });
      augmentedTask = descResult.augmentedPrompt;
      if (descResult.episodesUsed > 0) {
        // Extract just the DESC portion (difference between augmented and original)
        descContext = augmentedTask.length > task.length
          ? augmentedTask.substring(0, augmentedTask.length - task.length).trim()
          : null;
        this.log(`TASK-GODCODE-001: DESC injected ${descResult.episodesUsed} episodes`);
      }
    } catch (error) {
      // Implements [REQ-GODCODE-007]: Graceful DESC failure handling
      this.log(`TASK-GODCODE-001: DESC injection failed (continuing): ${error}`);
    }

    // Implements [REQ-GODCODE-004]: Agent selection via AgentSelector (DAI-001)
    const agentSelection = await this.selectAgentForTask(augmentedTask);
    const agent = agentSelection.selection.selected;
    this.log(`TASK-GODCODE-001: Selected agent '${agent.key}' (${agent.category})`);

    // Implements [REQ-GODCODE-003]: Extract agentType for Task() subagent_type
    const agentType = agent.frontmatter?.type ?? agent.category;

    // Implements [REQ-GODCODE-008]: Create trajectory for learning feedback (FR-11)
    let trajectoryId: string | null = null;
    if (this.trajectoryBridge) {
      try {
        const embedding = await this.embed(task);
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          task, 'code', embedding
        );
        trajectoryId = trajectory.trajectoryId;
        this.log(`TASK-GODCODE-001: Trajectory created: ${trajectoryId}`);
      } catch (error) {
        // Implements [REQ-GODCODE-007]: Graceful trajectory failure handling
        this.log(`TASK-GODCODE-001: Trajectory creation failed (continuing): ${error}`);
      }
    }

    // Implements [REQ-GODCODE-002]: Build full prompt via TaskExecutor.buildPrompt()
    const builtPrompt = this.taskExecutor.buildPrompt(
      agent,
      augmentedTask,
      agentSelection.context
    );

    // Check if this is a pipeline task (multi-agent)
    const isPipeline = triggeredByHook || this.isPipelineTask(task);

    // ═══════════════════════════════════════════════════════════════════════════
    // TASK-PREP-003: Dynamic 40-agent DAG generation
    // Implements [REQ-PREP-003]: Replace hardcoded pipeline with full DAG
    // ═══════════════════════════════════════════════════════════════════════════
    let pipeline: { steps: string[]; agents: string[]; config?: IPipelineExecutionConfig } | undefined;
    if (isPipeline) {
      // Determine active phases based on startPhase and endPhase options
      const startIdx = options.startPhase ?? 0;
      const endIdx = options.endPhase ?? (PHASE_ORDER.length - 1);
      const activePhases = PHASE_ORDER.slice(startIdx, endIdx + 1);

      // Build agentsByPhase map for active phases
      const agentsByPhase = new Map<CodingPipelinePhase, IAgentMapping[]>();
      for (const phase of activePhases) {
        agentsByPhase.set(phase, getAgentsForPhase(phase));
      }

      // Collect all agent keys and steps for backward compatibility
      const allAgentKeys: string[] = [];
      for (const phase of activePhases) {
        const phaseAgents = agentsByPhase.get(phase) ?? [];
        for (const agentMapping of phaseAgents) {
          allAgentKeys.push(agentMapping.agentKey);
        }
      }

      // Build full DAG using buildPipelineDAG()
      const dag = buildPipelineDAG();

      // Build complete pipeline configuration
      const pipelineConfig: IPipelineExecutionConfig = {
        phases: activePhases,
        agentsByPhase,
        dag,
        memoryNamespace: CODING_MEMORY_NAMESPACE,
        checkpoints: CHECKPOINT_PHASES.filter(cp => activePhases.includes(cp)),
        startPhase: startIdx,
        endPhase: endIdx,
        taskText: task,
      };

      // Create pipeline object with backward compatibility
      pipeline = {
        steps: activePhases,
        agents: allAgentKeys,
        config: pipelineConfig,
      };

      this.log(`TASK-PREP-003: Built pipeline with ${allAgentKeys.length} agents across ${activePhases.length} phases`);

      // Store pipeline config in memory for orchestrator
      if (this.memoryClient) {
        try {
          await this.memoryClient.storeKnowledge({
            content: JSON.stringify({
              phases: activePhases,
              agentCount: allAgentKeys.length,
              checkpoints: pipelineConfig.checkpoints,
              startPhase: startIdx,
              endPhase: endIdx,
              triggeredByHook,
              timestamp: new Date().toISOString(),
              source: 'prepareCodeTask',
              task: 'TASK-PREP-003',
            }),
            category: 'pipeline-config',
            domain: 'coding/pipeline',
            tags: ['pipeline', 'config', 'coding'],
          });
          this.log(`TASK-PREP-003: Stored pipeline config at coding/pipeline`);
        } catch (error) {
          this.log(`TASK-PREP-003: Failed to store pipeline config: ${error}`);
        }
      }
    }

    // Implements [REQ-GODCODE-001]: Return preparation result (NO execution)
    return {
      selectedAgent: agent.key,
      agentType,
      agentCategory: agent.category,
      builtPrompt,
      userTask: task,
      descContext,
      memoryContext: agentSelection.context ?? null,
      trajectoryId,
      isPipeline,
      pipeline,
      language: options.language,
      triggeredByHook,
    };
  }

  /**
   * Execute the coding pipeline via CodingPipelineOrchestrator.
   *
   * Wires all dependencies (agentRegistry, sonaEngine, reasoningBank, etc.)
   * and delegates to the orchestrator for 7-phase execution with:
   * - Trajectory persistence (PRD Section 5.1)
   * - Sherlock forensic reviews (PRD Section 2.3)
   * - Embedding-backed pattern matching (PRD Section 8.1)
   *
   * @param pipelineConfig - Configuration from prepareCodeTask()
   * @param stepExecutor - Optional step executor for agent execution
   * @returns Pipeline execution result with XP, phases, and success status
   */
  async executePipeline(
    pipelineConfig: IPipelineExecutionConfig,
    stepExecutor?: IStepExecutor
  ): Promise<IPipelineExecutionResult> {
    await this.ensureInitialized();

    // Step executor should be provided externally if internal execution is needed
    // For CLI-based execution (like PhD pipeline), this method shouldn't be used
    if (!stepExecutor) {
      throw new Error(
        'executePipeline() requires a stepExecutor. ' +
        'For CLI-based execution, use coding-pipeline-cli.ts instead.'
      );
    }
    const resolvedExecutor = stepExecutor;

    const deps: IOrchestratorDependencies = {
      agentRegistry: this.agentRegistry,
      agentSelector: this.agentSelector,
      interactionStore: this.interactionStore,
      reasoningBank: this.agent.getReasoningBank() ?? undefined,
      sonaEngine: this.agent.getSonaEngine() ?? undefined,
      leannContextService: this.leannContextService ?? undefined,
      embeddingProvider: this.embeddingProvider ?? undefined,
      patternMatcher: this.agent.getPatternMatcher() ?? undefined,
    };

    const orchestrator = createOrchestrator(deps, {
      verbose: true,
      enableLearning: true,
      stepExecutor: resolvedExecutor,
    });

    return orchestrator.execute(pipelineConfig);
  }

  /**
   * TASK-GODWRITE-001: Prepare write task for two-phase execution
   *
   * Implements [REQ-GODWRITE-001]: CLI does NOT attempt task execution
   * Implements [REQ-GODWRITE-002]: CLI returns builtPrompt in JSON
   * Implements [REQ-GODWRITE-003]: CLI returns agentType for Task()
   * Implements [REQ-GODWRITE-004]: Agent selection via AgentSelector (DAI-001)
   * Implements [REQ-GODWRITE-005]: DESC episode injection (RULE-010)
   *
   * This method performs Phase 1 preparation:
   * 1. Injects DESC episodes for prior solutions (RULE-010: window size 3)
   * 2. Selects optimal agent via AgentSelector (DAI-001)
   * 3. Builds full prompt via TaskExecutor.buildPrompt()
   * 4. Creates trajectory for learning feedback (FR-11)
   * 5. Applies style profile if available (REQ-GODWRITE-009)
   * 6. Returns IWriteTaskPreparation (NO execution)
   *
   * Phase 2 execution happens in the /god-write skill via Task() tool.
   *
   * CONSTITUTION COMPLIANCE:
   * - RULE-001: All code references REQ-GODWRITE-*
   * - RULE-003: Comments reference requirements
   * - RULE-010: DESC window size 3
   * - RULE-019: Real implementation, no scaffolding
   * - RULE-069: Proper try/catch for async operations
   * - RULE-070: Errors logged with context before re-throwing
   *
   * @param topic - The writing topic
   * @param options - Writing options (style, format, length, styleProfileId)
   * @returns IWriteTaskPreparation with builtPrompt for Task() execution
   */
  async prepareWriteTask(topic: string, options: {
    style?: 'academic' | 'professional' | 'casual' | 'technical';
    format?: 'essay' | 'report' | 'article' | 'paper';
    length?: 'short' | 'medium' | 'long' | 'comprehensive';
    styleProfileId?: string;
  } = {}): Promise<IWriteTaskPreparation> {
    // Implements [REQ-GODWRITE-006]: Ensure initialized before processing
    await this.ensureInitialized();

    // Set defaults for writing options
    const style = options.style ?? 'professional';
    const format = options.format ?? 'article';
    const length = options.length ?? 'medium';

    // Implements [REQ-GODWRITE-005]: DESC episode injection (RULE-010: window size 3)
    let descContext: string | null = null;
    let augmentedTopic = topic;
    try {
      const descResult = await this.injectDESCEpisodes(topic, { command: 'god-write', mode: 'write' });
      augmentedTopic = descResult.augmentedPrompt;
      if (descResult.episodesUsed > 0) {
        // Extract just the DESC portion (difference between augmented and original)
        descContext = augmentedTopic.length > topic.length
          ? augmentedTopic.substring(0, augmentedTopic.length - topic.length).trim()
          : null;
        this.log(`TASK-GODWRITE-001: DESC injected ${descResult.episodesUsed} episodes`);
      }
    } catch (error) {
      // Implements [REQ-GODWRITE-007]: Graceful DESC failure handling
      // RULE-070: Log error with context before continuing
      this.log(`TASK-GODWRITE-001: DESC injection failed (continuing): ${error}`);
    }

    // Implements [REQ-GODWRITE-004]: Agent selection via AgentSelector (DAI-001)
    const agentSelection = await this.selectAgentForTask(augmentedTopic);
    const agent = agentSelection.selection.selected;
    this.log(`TASK-GODWRITE-001: Selected agent '${agent.key}' (${agent.category})`);

    // Implements [REQ-GODWRITE-003]: Extract agentType for Task() subagent_type
    const agentType = agent.frontmatter?.type ?? agent.category;

    // Implements [REQ-GODWRITE-008]: Create trajectory for learning feedback (FR-11)
    let trajectoryId: string | null = null;
    if (this.trajectoryBridge) {
      try {
        const embedding = await this.embed(topic);
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          topic, 'write', embedding
        );
        trajectoryId = trajectory.trajectoryId;
        this.log(`TASK-GODWRITE-001: Trajectory created: ${trajectoryId}`);
      } catch (error) {
        // Implements [REQ-GODWRITE-007]: Graceful trajectory failure handling
        // RULE-070: Log error with context before continuing
        this.log(`TASK-GODWRITE-001: Trajectory creation failed (continuing): ${error}`);
      }
    }

    // Implements [REQ-GODWRITE-009]: Style profile integration
    let stylePrompt: string | null = null;
    let styleProfileApplied = false;
    if (this.styleProfileManager) {
      try {
        if (options.styleProfileId) {
          // Use specific style profile
          stylePrompt = this.styleProfileManager.generateStylePrompt(options.styleProfileId);
          styleProfileApplied = !!stylePrompt;
          if (styleProfileApplied) {
            this.log(`TASK-GODWRITE-001: Style profile '${options.styleProfileId}' applied`);
          }
        } else {
          // Try active style profile
          stylePrompt = this.styleProfileManager.generateStylePrompt();
          styleProfileApplied = !!stylePrompt;
          if (styleProfileApplied) {
            this.log(`TASK-GODWRITE-001: Active style profile applied`);
          }
        }
      } catch (error) {
        // RULE-070: Log error with context before continuing
        this.log(`TASK-GODWRITE-001: Style profile application failed (continuing): ${error}`);
      }
    }

    // Build writing instructions with style, format, and length
    const writingInstructions = this.buildWritingInstructions(style, format, length, stylePrompt);

    // Implements [REQ-GODWRITE-002]: Build full prompt via TaskExecutor.buildPrompt()
    const builtPrompt = this.taskExecutor.buildPrompt(
      agent,
      `${writingInstructions}\n\n## Topic\n${augmentedTopic}`,
      agentSelection.context
    );

    // Implements [REQ-GODWRITE-010]: Check if pipeline task (multi-chapter, complex docs)
    const isPipeline = this.isPipelineWritingTask(topic, format);
    let pipeline: { steps: string[]; agents: string[] } | undefined;
    if (isPipeline) {
      pipeline = {
        steps: ['research', 'outline', 'draft', 'review'],
        agents: [agent.key],
      };
      this.log(`TASK-GODWRITE-001: Pipeline task detected, ${pipeline.steps.length} steps defined`);
    }

    // Implements [REQ-GODWRITE-001]: Return preparation result (NO execution)
    return {
      selectedAgent: agent.key,
      agentType,
      agentCategory: agent.category,
      builtPrompt,
      userTask: topic,
      descContext,
      memoryContext: agentSelection.context ?? null,
      trajectoryId,
      isPipeline,
      pipeline,
      style,
      format,
      length,
      styleProfileId: options.styleProfileId,
      styleProfileApplied,
    };
  }

  /**
   * Build writing instructions with style, format, and length guidance
   * Used by prepareWriteTask() to construct the prompt
   *
   * @param style - Writing style (academic, professional, casual, technical)
   * @param format - Document format (essay, report, article, paper)
   * @param length - Content length (short, medium, long, comprehensive)
   * @param stylePrompt - Optional style profile prompt
   * @returns Formatted writing instructions string
   */
  private buildWritingInstructions(
    style: 'academic' | 'professional' | 'casual' | 'technical',
    format: 'essay' | 'report' | 'article' | 'paper',
    length: 'short' | 'medium' | 'long' | 'comprehensive',
    stylePrompt: string | null
  ): string {
    const lengthGuide: Record<string, string> = {
      short: '500-800 words',
      medium: '1000-2000 words',
      long: '2500-4000 words',
      comprehensive: '5000+ words with sections',
    };

    const styleGuide: Record<string, string> = {
      academic: 'formal tone, citations where appropriate, objective analysis',
      professional: 'clear and concise, business-appropriate, actionable insights',
      casual: 'conversational tone, engaging, accessible language',
      technical: 'precise terminology, detailed explanations, code examples where relevant',
    };

    const formatGuide: Record<string, string> = {
      essay: 'introduction, body paragraphs with clear thesis, conclusion',
      report: 'executive summary, findings, analysis, recommendations',
      article: 'headline, lead paragraph, supporting sections, conclusion',
      paper: 'abstract, introduction, methodology, results, discussion, conclusion',
    };

    let instructions = `## Writing Instructions

**Style**: ${style} - ${styleGuide[style]}
**Format**: ${format} - ${formatGuide[format]}
**Length**: ${length} - ${lengthGuide[length]}`;

    if (stylePrompt) {
      instructions += `\n\n## Style Profile\n${stylePrompt}`;
    }

    return instructions;
  }

  /**
   * Check if a writing task requires multi-agent pipeline execution
   * Used for complex documents like dissertations, multi-chapter works
   *
   * @param topic - The writing topic
   * @param format - The document format
   * @returns true if task benefits from pipeline execution
   */
  private isPipelineWritingTask(topic: string, format: string): boolean {
    // Complex document formats that benefit from pipeline
    const complexFormats = ['paper', 'report'];
    if (complexFormats.includes(format)) {
      // Check for complexity indicators in topic
      const complexityIndicators = [
        /dissertation/i,
        /thesis/i,
        /multi.chapter/i,
        /comprehensive.*research/i,
        /full.*analysis/i,
        /in.depth.*study/i,
        /complete.*guide/i,
      ];
      if (complexityIndicators.some(pattern => pattern.test(topic))) {
        return true;
      }
    }

    // Long-form content indicators
    const longFormIndicators = [
      /book/i,
      /manuscript/i,
      /whitepaper/i,
      /research.*paper/i,
    ];
    return longFormIndicators.some(pattern => pattern.test(topic));
  }

  /**
   * TASK-GOD-002: Prepare a market analysis task for two-phase execution.
   *
   * Implements [REQ-MA-001]: CLI does NOT attempt task execution
   * Implements [REQ-MA-002]: Returns builtPrompt for Task() execution
   * Implements [REQ-MA-003]: Returns agentType for Task() subagent_type
   * Implements [REQ-MA-005]: DESC episode injection (RULE-010)
   *
   * This method performs Phase 1 preparation:
   * 1. Injects DESC episodes for prior solutions (RULE-010: window size 3)
   * 2. Selects optimal agent via AgentSelector (DAI-001)
   * 3. Builds full prompt via TaskExecutor.buildPrompt()
   * 4. Creates trajectory for learning feedback (FR-11)
   * 5. Returns IMarketAnalysisTaskPreparation (NO execution)
   *
   * Phase 2 execution happens in the /god-market-analysis skill via Task() tool.
   *
   * @param task - The market analysis task description
   * @param options - Market analysis options (subCommand, ticker, etc.)
   * @returns IMarketAnalysisTaskPreparation with builtPrompt for Task() execution
   */
  async prepareMarketAnalysisTask(task: string, options: {
    subCommand: 'analyze' | 'scan' | 'compare';
    ticker?: string;
    compareTicker?: string;
    methodology?: string;
    signalFilter?: string;
  }): Promise<IMarketAnalysisTaskPreparation> {
    // Implements [REQ-MA-006]: Ensure initialized before processing
    await this.ensureInitialized();

    // Implements [REQ-MA-005]: DESC episode injection (RULE-010: window size 3)
    let descContext: string | null = null;
    let augmentedTask = task;
    try {
      const descResult = await this.injectDESCEpisodes(task, { command: 'god-market-analysis', mode: 'market-analysis' });
      augmentedTask = descResult.augmentedPrompt;
      if (descResult.episodesUsed > 0) {
        // Extract just the DESC portion (difference between augmented and original)
        descContext = augmentedTask.length > task.length
          ? augmentedTask.substring(0, augmentedTask.length - task.length).trim()
          : null;
        this.log(`TASK-GOD-002: DESC injected ${descResult.episodesUsed} episodes`);
      }
    } catch (error) {
      // Implements [REQ-MA-007]: Graceful DESC failure handling
      // RULE-070: Log error with context before continuing
      this.log(`TASK-GOD-002: DESC injection failed (continuing): ${error}`);
    }

    // Implements [REQ-MA-004]: Agent selection via AgentSelector (DAI-001)
    const agentSelection = await this.selectAgentForTask(augmentedTask);
    const agent = agentSelection.selection.selected;
    this.log(`TASK-GOD-002: Selected agent '${agent.key}' (${agent.category})`);

    // Implements [REQ-MA-003]: Extract agentType for Task() subagent_type
    const agentType = agent.frontmatter?.type ?? agent.category;

    // Implements [REQ-MA-008]: Create trajectory for learning feedback (FR-11)
    let trajectoryId: string | null = null;
    if (this.trajectoryBridge) {
      try {
        const embedding = await this.embed(task);
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          task, 'market-analysis', embedding
        );
        trajectoryId = trajectory.trajectoryId;
        this.log(`TASK-GOD-002: Trajectory created: ${trajectoryId}`);
      } catch (error) {
        // Implements [REQ-MA-007]: Graceful trajectory failure handling
        // RULE-070: Log error with context before continuing
        this.log(`TASK-GOD-002: Trajectory creation failed (continuing): ${error}`);
      }
    }

    // Build market analysis instructions with sub-command context
    const maInstructions = this.buildMarketAnalysisInstructions(
      options.subCommand,
      options.ticker,
      options.compareTicker,
      options.methodology,
      options.signalFilter
    );

    // Build the full task text combining instructions with the augmented task
    const fullTaskText = this.buildMarketAnalysisTaskText(
      maInstructions,
      augmentedTask,
      options.subCommand
    );

    // Implements [REQ-MA-002]: Build full prompt via TaskExecutor.buildPrompt()
    const builtPrompt = this.taskExecutor.buildPrompt(
      agent,
      fullTaskText,
      agentSelection.context
    );

    // Implements [REQ-MA-001]: Return preparation result (NO execution)
    return {
      selectedAgent: agent.key,
      agentType,
      agentCategory: agent.category,
      builtPrompt,
      userTask: task,
      descContext,
      memoryContext: agentSelection.context ?? null,
      trajectoryId,
      isPipeline: false as const,
      pipeline: undefined,
      subCommand: options.subCommand,
      ticker: options.ticker,
      compareTicker: options.compareTicker,
      methodology: options.methodology,
      signalFilter: options.signalFilter,
    };
  }

  /**
   * Build market analysis instructions based on sub-command and options.
   * Used by prepareMarketAnalysisTask() to construct the prompt.
   *
   * @param subCommand - The analysis sub-command (analyze, scan, compare)
   * @param ticker - Primary ticker symbol
   * @param compareTicker - Comparison ticker symbol (for compare)
   * @param methodology - Analysis methodology filter
   * @param signalFilter - Signal direction filter
   * @returns Formatted market analysis instructions string
   */
  private buildMarketAnalysisInstructions(
    subCommand: 'analyze' | 'scan' | 'compare',
    ticker?: string,
    compareTicker?: string,
    methodology?: string,
    signalFilter?: string
  ): string {
    const methodologyGuide: Record<string, string> = {
      wyckoff: 'Wyckoff Method - accumulation/distribution phases, spring/upthrust patterns, volume analysis',
      elliott: 'Elliott Wave Theory - impulse/corrective wave counts, Fibonacci retracements, wave degree analysis',
      ict: 'ICT Smart Money Concepts - order blocks, fair value gaps, liquidity pools, market structure shifts',
      canslim: 'CAN SLIM - current earnings, annual earnings, new products, supply/demand, leader/laggard, institutional sponsorship, market direction',
      larry_williams: 'Larry Williams - COT data analysis, seasonal patterns, sentiment indicators, commercial positioning',
    };

    const subCommandGuide: Record<string, string> = {
      analyze: 'Perform comprehensive technical and fundamental analysis on the specified ticker',
      scan: 'Scan the market for opportunities matching the specified criteria',
      compare: 'Compare two tickers across technical, fundamental, and momentum metrics',
    };

    let instructions = `## Market Analysis Instructions

**Mode**: ${subCommand} - ${subCommandGuide[subCommand]}`;

    if (ticker) {
      instructions += `\n**Primary Ticker**: ${ticker.toUpperCase()}`;
    }
    if (compareTicker) {
      instructions += `\n**Comparison Ticker**: ${compareTicker.toUpperCase()}`;
    }
    if (methodology && methodologyGuide[methodology]) {
      instructions += `\n**Methodology**: ${methodologyGuide[methodology]}`;
    } else if (methodology) {
      instructions += `\n**Methodology**: ${methodology}`;
    }
    if (signalFilter) {
      instructions += `\n**Signal Filter**: ${signalFilter} signals only`;
    }

    // Add sub-command specific guidance
    switch (subCommand) {
      case 'analyze':
        instructions += `\n\n### Analysis Requirements
- Technical analysis: price action, support/resistance, trend analysis
- Volume analysis: volume profile, accumulation/distribution
- Momentum indicators: RSI, MACD, Stochastic
- Key levels: support, resistance, pivot points
- Risk assessment: volatility, correlation, position sizing guidance`;
        break;

      case 'scan':
        instructions += `\n\n### Scan Requirements
- Screen for tickers matching the specified criteria
- Rank results by signal strength and confidence
- Include entry/exit levels for top candidates
- Provide risk/reward ratios for each opportunity`;
        break;

      case 'compare':
        instructions += `\n\n### Comparison Requirements
- Side-by-side technical analysis of both tickers
- Relative strength comparison
- Correlation analysis
- Fundamental metrics comparison (P/E, revenue growth, margins)
- Recommendation on which ticker presents better risk/reward`;
        break;
    }

    return instructions;
  }

  /**
   * Build the full task text combining market analysis instructions with the augmented task.
   * Used by prepareMarketAnalysisTask() to create the prompt body.
   *
   * @param instructions - The formatted market analysis instructions
   * @param augmentedTask - The DESC-augmented task text
   * @param subCommand - The analysis sub-command
   * @returns Combined task text for prompt building
   */
  private buildMarketAnalysisTaskText(
    instructions: string,
    augmentedTask: string,
    subCommand: 'analyze' | 'scan' | 'compare'
  ): string {
    return `${instructions}\n\n## Task Context\n${augmentedTask}\n\n## Output Format
Provide structured analysis output with:
1. Executive summary (2-3 sentences)
2. Detailed ${subCommand} results
3. Key findings and actionable insights
4. Risk warnings and caveats
5. Confidence level (low/medium/high) with reasoning`;
  }

  /**
   * Check if a task requires multi-agent pipeline execution
   * Uses sophisticated CommandTaskBridge complexity analysis with scoring system:
   * - Phase keywords: +0.15 each (implement, test, design, etc.)
   * - Document keywords: +0.2 each (api, database, authentication, etc.)
   * - Multi-step patterns: +0.25 (create...and...test, build...with...validation)
   * - Connector words: +0.1 each (and, with, including, then)
   * - Action verbs (>=2): +(verbCount-1) * 0.1
   * - Word count >15: +0.1
   *
   * TASK-PIPELINE-FIX: Replaces weak regex patterns that missed complex tasks
   * like "REST API with Auth" and "snake game with scoreboard"
   *
   * @param task - The task description
   * @returns true if complexity score >= DEFAULT_PIPELINE_THRESHOLD (0.6)
   */
  private isPipelineTask(task: string): boolean {
    // TASK-PIPELINE-FIX: Use sophisticated CommandTaskBridge analysis
    // instead of weak regex patterns that miss complex tasks
    const bridge = new CommandTaskBridge();
    const analysis = bridge.analyzeTaskComplexity(task);
    const isPipeline = analysis.score >= DEFAULT_PIPELINE_THRESHOLD;

    if (isPipeline) {
      this.log(`Pipeline triggered: score=${analysis.score.toFixed(2)}, threshold=${DEFAULT_PIPELINE_THRESHOLD}, reason: ${analysis.reasoning}`);
    } else {
      this.log(`Single agent: score=${analysis.score.toFixed(2)} < threshold=${DEFAULT_PIPELINE_THRESHOLD}`);
    }

    return isPipeline;
  }

  /**
   * Code mode - write code with pattern learning
   */
  async code(task: string, options: {
    language?: string;
    context?: string;
    examples?: string[];
  } = {}): Promise<CodeResult> {
    await this.ensureInitialized();

    // DESC: Inject prior solutions before processing (RULE-010: window size 3)
    const descResult = await this.injectDESCEpisodes(task, { command: 'god-code', mode: 'code' });
    const augmentedTask = descResult.augmentedPrompt;

    // DAI-001: Dynamic agent selection for code tasks (use augmented task)
    const agentSelection = await this.selectAgentForTask(augmentedTask);
    this.log(`DAI-001 code(): Selected agent '${agentSelection.selection.selected.key}' (${agentSelection.selection.selected.category})`);

    // Create trajectory for learning (FR-11)
    let trajectoryId: string | undefined;
    if (this.trajectoryBridge) {
      try {
        const embedding = await this.embed(task);
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          task, 'code', embedding
        );
        trajectoryId = trajectory.trajectoryId;
      } catch (error) {
        this.log(`Warning: Trajectory creation failed in code(): ${error}`);
      }
    }

    // Find relevant code patterns
    const patterns = await this.retrieveRelevant(task, 'code');

    // TASK-FIX-003: Execute via TaskExecutor with ObservabilityBus events
    // Per RULE-033: Quality MUST be assessed on Task() RESULT, not prompt
    // TASK-HOOK-006: Pass trajectoryId for hook quality tracking (RULE-036)
    const executionResult = await this.executeTaskDefault(agentSelection, undefined, { trajectoryId });
    const code = executionResult.success ? executionResult.result : agentSelection.prompt;
    if (!executionResult.success) {
      this.log(`TASK-FIX-003 code(): Execution failed, using prompt as fallback`);
    }

    // Store successful code patterns in InteractionStore
    await this.storeKnowledge({
      content: code,
      type: 'pattern',
      domain: options.language ?? 'typescript',
      tags: ['generated', 'code-pattern', ...this.extractTags(task)],
    });

    // Learn this pattern if it's new and useful
    const patternId = await this.maybeStorePattern({
      content: code,
      type: 'pattern',
      domain: options.language ?? 'code',
      tags: this.extractTags(task),
    });

    // Auto-feedback if trajectory exists (FR-11)
    if (this.config.autoLearn && this.trajectoryBridge && trajectoryId) {
      const quality = estimateQuality({
        id: trajectoryId,
        mode: 'code',
        input: task,
        output: code,
        timestamp: Date.now(),
      });
      if (quality >= this.config.autoStoreThreshold) {
        try {
          await this.trajectoryBridge.submitFeedback(trajectoryId, quality, { implicit: true });
          this.log(`Code auto-feedback: quality=${quality.toFixed(2)}`);
        } catch (error) {
          this.log(`Warning: Code auto-feedback failed: ${error}`);
        }
      }
    }

    // DESC: Store episode for future learning (non-blocking)
    const codeQuality = estimateQuality({
      id: trajectoryId ?? this.generateId(),
      mode: 'code',
      input: task,
      output: code,
      timestamp: Date.now(),
    });
    this.storeDESCEpisode(task, code, {
      command: 'god-code',
      mode: 'code',
      quality: codeQuality,
    }).catch(err => this.log(`DESC: Background storage error: ${err}`));

    return {
      task,
      code,
      language: options.language ?? 'typescript',
      patterns_used: patterns.map(p => p.id),
      explanation: `Generated code for: ${task}`,
      learned: !!patternId,
      trajectoryId,
    };
  }

  /**
   * Research mode - gather and synthesize knowledge
   * Automatically searches the web if knowledge base is insufficient
   */
  async research(query: string, options: {
    depth?: 'quick' | 'standard' | 'deep';
    sources?: string[];
    enableWebSearch?: boolean;
    /** Use a specific learned style profile for synthesis */
    styleProfileId?: string;
    /** Use the currently active style profile (default: true if one is set) */
    useActiveStyleProfile?: boolean;
  } = {}): Promise<ResearchResult> {
    await this.ensureInitialized();

    // DESC: Inject prior solutions before processing (RULE-010: window size 3)
    const descResult = await this.injectDESCEpisodes(query, { command: 'god-research', mode: 'research' });
    const augmentedQuery = descResult.augmentedPrompt;

    // DAI-001: Dynamic agent selection for research tasks (use augmented query)
    const agentSelection = await this.selectAgentForTask(augmentedQuery);
    this.log(`DAI-001 research(): Selected agent '${agentSelection.selection.selected.key}' (${agentSelection.selection.selected.category})`);

    const depth = options.depth ?? 'standard';
    const enableWebSearch = options.enableWebSearch ?? this.config.enableWebSearch;
    this.log(`Researching: ${query} (depth: ${depth}, webSearch: ${enableWebSearch})`);

    // Get style prompt from learned profile if available
    let _stylePrompt: string | null = null;
    if (this.styleProfileManager) {
      if (options.styleProfileId) {
        _stylePrompt = this.styleProfileManager.generateStylePrompt(options.styleProfileId);
      } else if (options.useActiveStyleProfile !== false) {
        _stylePrompt = this.styleProfileManager.generateStylePrompt();
      }
    }

    // Create trajectory for learning (FR-11)
    let trajectoryId: string | undefined;
    if (this.trajectoryBridge) {
      try {
        const embedding = await this.embed(query);
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          query, 'research', embedding
        );
        trajectoryId = trajectory.trajectoryId;
      } catch (error) {
        this.log(`Warning: Trajectory creation failed in research(): ${error}`);
      }
    }

    // Get existing knowledge
    const existing = await this.retrieveRelevant(query, 'research');

    // Check if we have sufficient knowledge
    const hasGoodKnowledge = existing.length >= 3 && existing[0]?.similarity > 0.7;

    let findings: Array<{
      content: string;
      source: string;
      relevance: number;
      confidence: number;
    }> = [];

    // If knowledge base is insufficient and web search is enabled, search the web
    if (!hasGoodKnowledge && enableWebSearch) {
      this.log('Knowledge base insufficient - performing web search...');
      const webResults = await this.performWebSearch(query, depth);

      // Store web results in knowledge base for future use
      for (const result of webResults) {
        await this.storeKnowledge({
          content: result.content,
          type: 'fact',
          domain: 'research',
          tags: [...this.extractTags(query), 'web-search'],
          source: result.source,
        });
      }

      findings = webResults.map(r => ({
        content: r.content,
        source: r.source,
        relevance: r.relevance,
        confidence: r.confidence,
      }));

      this.log(`Web search returned ${webResults.length} results, stored in knowledge base`);
    } else {
      // Use existing knowledge
      findings = existing.map(k => ({
        content: String(k.content),
        source: 'knowledge_base',
        relevance: k.similarity,
        confidence: k.confidence,
      }));
    }

    // TASK-FIX-004: Execute via TaskExecutor with ObservabilityBus events
    // Per RULE-033: Quality MUST be assessed on Task() RESULT, not prompt
    // TASK-HOOK-006: Pass trajectoryId for hook quality tracking (RULE-036)
    const executionResult = await this.executeTaskDefault(agentSelection, undefined, { trajectoryId });
    const synthesis = executionResult.success ? executionResult.result : agentSelection.prompt;
    if (!executionResult.success) {
      this.log(`TASK-FIX-004 research(): Execution failed, using prompt as fallback`);
    }

    // Auto-feedback if trajectory exists (FR-11)
    let researchQuality = 0.7;
    if (this.config.autoLearn && this.trajectoryBridge && trajectoryId) {
      researchQuality = estimateQuality({
        id: trajectoryId,
        mode: 'research',
        input: query,
        output: synthesis,
        timestamp: Date.now(),
      });
      if (researchQuality >= this.config.autoStoreThreshold) {
        try {
          await this.trajectoryBridge.submitFeedback(trajectoryId, researchQuality, { implicit: true });
          this.log(`Research auto-feedback: quality=${researchQuality.toFixed(2)}`);
        } catch (error) {
          this.log(`Warning: Research auto-feedback failed: ${error}`);
        }
      }
    }

    // DESC: Store episode for future learning (non-blocking)
    this.storeDESCEpisode(query, synthesis, {
      command: 'god-research',
      mode: 'research',
      quality: researchQuality,
    }).catch(err => this.log(`DESC: Background storage error: ${err}`));

    return {
      query,
      findings,
      synthesis,
      knowledgeStored: findings.length,
      trajectoryId,
    };
  }

  /**
   * Perform web search using available search tools
   * SPEC-WEB-001: Hybrid search provider (WebSearch + Perplexity MCP)
   */
  private async performWebSearch(query: string, depth: 'quick' | 'standard' | 'deep'): Promise<Array<{
    content: string;
    source: string;
    relevance: number;
    confidence: number;
  }>> {
    if (!this.config.enableWebSearch) {
      this.log('Web search disabled in config');
      return [{
        content: `Web search is disabled. Enable it in config or manually add knowledge using /god-learn.`,
        source: 'system',
        relevance: 0,
        confidence: 0,
      }];
    }

    try {
      // Map 'standard' to 'medium' for the provider
      const providerDepth = depth === 'standard' ? 'medium' : depth;

      this.log(`Performing web search: "${query}" (depth: ${providerDepth})`);

      // Delegate to web search provider
      const results = await this.webSearchProvider.search(query, {
        depth: providerDepth,
        maxResults: 10,
      });

      // Store search results in InteractionStore for learning
      if (this.config.autoLearn && results.length > 0) {
        await this.storeKnowledge({
          content: JSON.stringify({
            query,
            depth: providerDepth,
            resultCount: results.length,
            timestamp: Date.now(),
          }),
          type: 'fact',
          domain: 'research/searches',
          tags: ['web-search', providerDepth, 'auto-stored'],
        });
      }

      // Transform ISearchResult to expected format
      return results.map(result => ({
        content: result.content,
        source: result.source,
        relevance: result.relevance,
        confidence: result.relevance, // Use relevance as confidence
      }));
    } catch (error) {
      this.log(`Web search failed: ${error}`, true);
      return [{
        content: `Web search failed: ${error}. Query: "${query}". Please try again or manually add knowledge using /god-learn.`,
        source: 'error',
        relevance: 0,
        confidence: 0,
      }];
    }
  }

  /**
   * Write mode - generate documents with style learning
   *
   * @param topic - The topic to write about
   * @param options - Writing options including style profile
   * @param options.styleProfileId - ID of a learned style profile to use
   * @param options.useActiveStyleProfile - Use the currently active style profile
   */
  async write(topic: string, options: {
    style?: 'academic' | 'professional' | 'casual' | 'technical';
    length?: 'short' | 'medium' | 'long' | 'comprehensive';
    format?: 'essay' | 'report' | 'article' | 'paper';
    /** Use a specific learned style profile by ID */
    styleProfileId?: string;
    /** Use the currently active style profile (default: true if one is set) */
    useActiveStyleProfile?: boolean;
  } = {}): Promise<WriteResult> {
    await this.ensureInitialized();

    // DESC: Inject prior solutions before processing (RULE-010: window size 3)
    const descResult = await this.injectDESCEpisodes(topic, { command: 'god-write', mode: 'write' });
    const augmentedTopic = descResult.augmentedPrompt;

    // DAI-001: Dynamic agent selection for write tasks (use augmented topic)
    const agentSelection = await this.selectAgentForTask(augmentedTopic);
    this.log(`DAI-001 write(): Selected agent '${agentSelection.selection.selected.key}' (${agentSelection.selection.selected.category})`);

    const style = options.style ?? 'professional';
    const length = options.length ?? 'medium';
    const format = options.format ?? 'article';

    // Get style prompt from learned profile if available
    let _stylePrompt: string | null = null;
    if (this.styleProfileManager) {
      if (options.styleProfileId) {
        _stylePrompt = this.styleProfileManager.generateStylePrompt(options.styleProfileId);
      } else if (options.useActiveStyleProfile !== false) {
        // Default to active profile if one is set
        _stylePrompt = this.styleProfileManager.generateStylePrompt();
      }
    }

    // Create trajectory for learning (FR-11)
    let trajectoryId: string | undefined;
    if (this.trajectoryBridge) {
      try {
        const embedding = await this.embed(topic);
        const trajectory = await this.trajectoryBridge.createTrajectoryFromInteraction(
          topic, 'write', embedding
        );
        trajectoryId = trajectory.trajectoryId;
      } catch (error) {
        this.log(`Warning: Trajectory creation failed in write(): ${error}`);
      }
    }

    // Get relevant knowledge
    const knowledge = await this.retrieveRelevant(topic, 'write');

    // TASK-FIX-005: Execute via TaskExecutor with ObservabilityBus events
    // Per RULE-033: Quality MUST be assessed on Task() RESULT, not prompt
    // TASK-HOOK-006: Pass trajectoryId for hook quality tracking (RULE-036)
    const executionResult = await this.executeTaskDefault(agentSelection, undefined, { trajectoryId });
    const content = executionResult.success ? executionResult.result : agentSelection.prompt;
    if (!executionResult.success) {
      this.log(`TASK-FIX-005 write(): Execution failed, using prompt as fallback`);
    }

    // Store successful writing patterns
    await this.maybeStorePattern({
      content: `${format} on ${topic}`,
      type: 'example',
      domain: 'writing',
      tags: [style, format, ...this.extractTags(topic)],
    });

    // Auto-feedback if trajectory exists (FR-11)
    let writeQuality = 0.7;
    if (this.config.autoLearn && this.trajectoryBridge && trajectoryId) {
      writeQuality = estimateQuality({
        id: trajectoryId,
        mode: 'write',
        input: topic,
        output: content,
        timestamp: Date.now(),
      });
      if (writeQuality >= this.config.autoStoreThreshold) {
        try {
          await this.trajectoryBridge.submitFeedback(trajectoryId, writeQuality, { implicit: true });
          this.log(`Write auto-feedback: quality=${writeQuality.toFixed(2)}`);
        } catch (error) {
          this.log(`Warning: Write auto-feedback failed: ${error}`);
        }
      }
    }

    // DESC: Store episode for future learning (non-blocking)
    this.storeDESCEpisode(topic, content, {
      command: 'god-write',
      mode: 'write',
      quality: writeQuality,
    }).catch(err => this.log(`DESC: Background storage error: ${err}`));

    return {
      topic,
      content,
      style,
      sources: knowledge.map(k => k.id),
      wordCount: content.split(/\s+/).length,
      trajectoryId,
    };
  }

  /**
   * Write a paper by combining research and writing with learned style
   *
   * This method:
   * 1. Performs research on the topic
   * 2. Synthesizes findings
   * 3. Generates a paper with the learned style profile
   *
   * @param topic - The paper topic
   * @param options - Options for research and writing
   */
  async writePaper(topic: string, options: {
    /** Research depth */
    depth?: 'quick' | 'standard' | 'deep';
    /** Paper format */
    format?: 'essay' | 'report' | 'article' | 'paper';
    /** Paper length */
    length?: 'short' | 'medium' | 'long' | 'comprehensive';
    /** Specific style profile ID to use */
    styleProfileId?: string;
    /** Enable web search for research */
    enableWebSearch?: boolean;
  } = {}): Promise<{
    topic: string;
    research: ResearchResult;
    paper: WriteResult;
    styleApplied: boolean;
  }> {
    await this.ensureInitialized();

    this.log(`Writing paper on: ${topic}`);

    // Check if we have an active style profile
    const activeProfile = this.getActiveStyleProfile();
    const styleProfileId = options.styleProfileId || activeProfile?.metadata.id;
    const styleApplied = !!styleProfileId;

    if (styleApplied) {
      this.log(`Using style profile: ${styleProfileId}`);
    }

    // Step 1: Research the topic
    const research = await this.research(topic, {
      depth: options.depth ?? 'deep',
      enableWebSearch: options.enableWebSearch ?? true,
      styleProfileId,
    });

    this.log(`Research complete: ${research.findings.length} findings`);

    // Step 2: Write the paper with findings and style
    const paper = await this.write(topic, {
      style: 'academic',
      format: options.format ?? 'paper',
      length: options.length ?? 'comprehensive',
      styleProfileId,
    });

    this.log(`Paper complete: ${paper.wordCount} words`);

    return {
      topic,
      research,
      paper,
      styleApplied,
    };
  }

  // ==================== Learning System ====================

  /**
   * Explicit feedback - improves future results via SonaEngine
   *
   * Can accept either an interactionId (looks up trajectoryId) or
   * a trajectoryId directly (with isTrajectoryId: true).
   *
   * @param id - Interaction ID or Trajectory ID
   * @param rating - Quality rating 0-1
   * @param options - Additional options
   * @returns FeedbackResult with weight updates and pattern creation info
   */
  async feedback(
    id: string,
    rating: number,
    options: {
      useful?: boolean;
      notes?: string;
      /** Set true if id is a trajectoryId instead of interactionId */
      isTrajectoryId?: boolean;
    } = {}
  ): Promise<FeedbackResult> {
    let trajectoryId: string | undefined;
    let interaction: Interaction | undefined;

    if (options.isTrajectoryId) {
      // Direct trajectory ID provided
      trajectoryId = id;
    } else {
      // Look up interaction by ID
      interaction = this.interactionStore.get(id);
      if (!interaction) {
        this.log(`Warning: Interaction ${id} not found`);
        return { weightUpdates: 0, patternCreated: false };
      }
      trajectoryId = interaction.trajectoryId;
    }

    const feedbackData = {
      rating,
      useful: options.useful ?? rating > 0.5,
      notes: options.notes,
    };

    // Update feedback in store if we have an interaction
    if (interaction) {
      this.interactionStore.updateFeedback(id, feedbackData);
    }

    // Submit to SonaEngine via TrajectoryBridge (FR-11)
    let feedbackResult: FeedbackResult = { weightUpdates: 0, patternCreated: false };
    if (this.trajectoryBridge && trajectoryId) {
      try {
        feedbackResult = await this.trajectoryBridge.submitFeedback(
          trajectoryId,
          rating,
          { notes: options.notes }
        );
        this.log(`SonaEngine feedback: trajectory=${trajectoryId}, rating=${rating.toFixed(2)}, patternCreated=${feedbackResult.patternCreated}`);
      } catch (error) {
        this.log(`Warning: SonaEngine feedback failed: ${error}`);
      }
    }

    // Legacy learning from this feedback
    if (interaction) {
      if (rating > this.config.autoStoreThreshold) {
        await this.reinforcePattern(interaction);
      } else if (rating < 0.3) {
        await this.weakenPattern(interaction);
      }
    }

    this.log(`Feedback recorded: ${rating} for ${id}`);
    return feedbackResult;
  }

  /**
   * Learn from successful interaction
   */
  private async learnFromInteraction(interaction: Interaction): Promise<void> {
    // Auto-detect quality based on interaction characteristics
    const implicitQuality = this.assessQuality(interaction);

    if (implicitQuality > this.config.autoStoreThreshold) {
      await this.storeKnowledge({
        content: `${interaction.input} -> ${interaction.output}`,
        type: 'pattern',
        domain: interaction.mode,
        tags: this.extractTags(interaction.input),
      });

      this.log(`Auto-learned from interaction: ${interaction.id}`);
    }
  }

  /**
   * Reinforce a successful pattern
   */
  private async reinforcePattern(interaction: Interaction): Promise<void> {
    const embedding = interaction.embedding ?? await this.embed(interaction.input);

    // Query to find the pattern that was used
    const results = await this.agent.query(embedding, { k: 1 });

    if (results.patterns.length > 0) {
      await this.agent.learn({
        queryId: results.queryId,
        patternId: results.patterns[0].id,
        verdict: 'positive',
        score: interaction.feedback?.rating ?? 0.9,
      });

      // Track success
      const key = results.patterns[0].id;
      this.successfulPatterns.set(key, (this.successfulPatterns.get(key) ?? 0) + 1);
    }
  }

  /**
   * Weaken an unsuccessful pattern
   */
  private async weakenPattern(interaction: Interaction): Promise<void> {
    const embedding = interaction.embedding ?? await this.embed(interaction.input);

    const results = await this.agent.query(embedding, { k: 1 });

    if (results.patterns.length > 0) {
      await this.agent.learn({
        queryId: results.queryId,
        patternId: results.patterns[0].id,
        verdict: 'negative',
        score: interaction.feedback?.rating ?? 0.1,
      });
    }
  }

  // ==================== Knowledge Management ====================

  /**
   * Store knowledge for future use with automatic chunking
   * Implements: REQ-CHUNK-001 (chunking), REQ-CHUNK-006 (token limit validation)
   * CONSTITUTION: RULE-064 (symmetric chunking), RULE-046 (atomic writes)
   */
  async storeKnowledge(entry: Omit<KnowledgeEntry, 'id' | 'quality' | 'usageCount' | 'lastUsed' | 'createdAt'>): Promise<string> {
    const id = this.generateId();
    const now = Date.now();

    // TASK-CHUNK-003: Chunk content for OpenAI token limit compliance
    // Detects content type for accurate token estimation (REQ-CHUNK-009)
    const contentType = this.knowledgeChunker.detectContentType(entry.content);
    const chunkingResult: ChunkingResult = await this.knowledgeChunker.chunkForStorage(
      entry.content,
      id,
      { domain: entry.domain, type: entry.type, tags: entry.tags },
      { contentType }
    );

    // REQ-CHUNK-006: Warn about very large content
    if (chunkingResult.totalTokensEstimate > 100000) {
      this.log(`WARNING: Large content (${chunkingResult.totalTokensEstimate} tokens) may have reduced retrieval quality`);
    }

    // Log chunking info
    if (chunkingResult.wasChunked) {
      this.log(`TASK-CHUNK-003: Chunked content into ${chunkingResult.chunks.length} chunks (${chunkingResult.totalTokensEstimate} estimated tokens)`);
    }

    const knowledge: KnowledgeEntry = {
      ...entry,
      id,
      quality: 0.5, // Initial quality
      usageCount: 0,
      lastUsed: now,
      createdAt: now,
    };

    // Store each chunk separately with its own embedding for semantic search
    // This enables retrieval of relevant chunks without loading entire document
    for (const chunk of chunkingResult.chunks) {
      const chunkEmbedding = await this.embed(chunk.text);

      await this.agent.store({
        content: {
          ...knowledge,
          // Store chunk text instead of full content for the embedding match
          chunkText: chunk.text,
          chunkIndex: chunk.metadata.chunkIndex,
          totalChunks: chunk.metadata.totalChunks,
          startOffset: chunk.metadata.startOffset,
          endOffset: chunk.metadata.endOffset,
          isChunked: chunkingResult.wasChunked,
        },
        embedding: chunkEmbedding,
        metadata: {
          type: entry.type,
          domain: entry.domain,
          tags: entry.tags,
          chunkIndex: chunk.metadata.chunkIndex,
          totalChunks: chunk.metadata.totalChunks,
          parentId: id,
          estimatedTokens: chunk.metadata.estimatedTokens,
        }
      }, {
        trackProvenance: true,
        namespace: `knowledge.${entry.domain}`,
      });
    }

    // Store parent entry in interaction store for quick metadata access
    this.interactionStore.addKnowledge(knowledge);

    // Track domain expertise
    const domainCount = (this.domainExpertise.get(entry.domain) ?? 0) + 1;
    this.domainExpertise.set(entry.domain, domainCount);

    this.log(`Stored knowledge: ${id} (${entry.domain}/${entry.type}) - ${chunkingResult.chunks.length} chunk(s)`);
    return id;
  }

  /**
   * Retrieve relevant knowledge
   */
  private async retrieveRelevant(
    query: string,
    _mode: AgentMode,
    k: number = 10
  ): Promise<Array<QueryResult['patterns'][0] & { content: unknown }>> {
    const embedding = await this.embed(query);

    const results = await this.agent.query(embedding, {
      k,
      minSimilarity: 0.3,
      includeProvenance: true,
    });

    // Update usage stats for retrieved patterns
    for (const pattern of results.patterns) {
      await this.updateUsageStats(pattern.id);
    }

    return results.patterns;
  }

  // ==================== TASK-CHUNK-010: Backward Compatibility Layer ====================

  /**
   * Check if a knowledge entry is chunked
   * Implements: TASK-CHUNK-010 (backward compatibility)
   * CONSTITUTION: RULE-064 (symmetric chunking)
   *
   * Detects chunked entries by checking:
   * 1. is_chunked flag (primary indicator)
   * 2. chunk_count > 1 (fallback indicator)
   * 3. totalChunks metadata field (legacy entries)
   *
   * @param entry - The entry content object from vector store
   * @returns True if entry is chunked, false for legacy single-content entries
   */
  isChunkedEntry(entry: Record<string, unknown>): boolean {
    // Primary: check is_chunked flag (set during storeKnowledge)
    if (entry.isChunked === true || entry.is_chunked === true) {
      return true;
    }

    // Fallback: check chunk_count from metadata
    const chunkCount = entry.chunk_count ?? entry.chunkCount ?? entry.totalChunks;
    if (typeof chunkCount === 'number' && chunkCount > 1) {
      return true;
    }

    // Legacy entries without chunking metadata are not chunked
    return false;
  }

  /**
   * Retrieve knowledge by ID with backward compatibility for chunked/non-chunked entries
   * Implements: TASK-CHUNK-010 (backward compatible retrieval)
   * CONSTITUTION: RULE-064 (symmetric chunking), REQ-CHUNK-010
   *
   * Logic:
   * - For non-chunked entries: return content directly (legacy behavior)
   * - For chunked entries: reconstruct from chunks using KnowledgeChunker.reconstructContent()
   *
   * @param id - The knowledge entry ID (parentId for chunked entries)
   * @returns Full knowledge entry with reconstructed content, or null if not found
   */
  async retrieveKnowledge(id: string): Promise<KnowledgeEntry | null> {
    // First, try to get entry from interaction store (quick metadata lookup)
    const allKnowledge = this.interactionStore.getKnowledge();
    const cachedEntry = allKnowledge.find(k => k.id === id);
    if (cachedEntry) {
      this.log(`TASK-CHUNK-010: Retrieved from cache: ${id}`);
      return cachedEntry;
    }

    // Query vector store for chunks/entries with this ID
    // Use a dummy embedding since we're looking up by ID, not similarity
    const dummyEmbedding = new Float32Array(384); // Default embedding dimension
    const results = await this.agent.query(dummyEmbedding, {
      k: 100, // Get enough results to find all chunks
      minSimilarity: 0,
      includeProvenance: true,
    });

    // Filter results to find entries matching this ID or parentId
    // Cast to PatternWithMetadata to access runtime metadata field
    const matchingEntries = (results.patterns as PatternWithMetadata[]).filter(p => {
      const content = p.content as Record<string, unknown>;
      return content.id === id || p.metadata?.parentId === id;
    });

    if (matchingEntries.length === 0) {
      this.log(`TASK-CHUNK-010: Knowledge not found: ${id}`);
      return null;
    }

    // Get the first entry to check if chunked
    const firstEntry = matchingEntries[0];
    const entryContent = firstEntry.content as Record<string, unknown>;

    // Check if this is a chunked entry
    if (!this.isChunkedEntry(entryContent)) {
      // Legacy non-chunked entry: return content directly
      this.log(`TASK-CHUNK-010: Retrieved non-chunked entry: ${id}`);
      return this.contentToKnowledgeEntry(entryContent);
    }

    // Chunked entry: reconstruct from all chunks
    this.log(`TASK-CHUNK-010: Reconstructing chunked entry: ${id}`);
    return this.reconstructChunkedKnowledge(id, matchingEntries);
  }

  /**
   * Reconstruct full content from chunked knowledge entries
   * Implements: REQ-CHUNK-010 (backward compatible retrieval)
   *
   * @param parentId - The parent knowledge entry ID
   * @param chunks - Array of chunk entries from vector store
   * @returns Reconstructed KnowledgeEntry with full content
   */
  private async reconstructChunkedKnowledge(
    parentId: string,
    chunks: PatternWithMetadata[]
  ): Promise<KnowledgeEntry | null> {
    // Sort chunks by index
    const sortedChunks = chunks.sort((a, b) => {
      const aContent = a.content as Record<string, unknown>;
      const bContent = b.content as Record<string, unknown>;
      const aIndex = (aContent.chunkIndex ?? a.metadata?.chunkIndex ?? 0) as number;
      const bIndex = (bContent.chunkIndex ?? b.metadata?.chunkIndex ?? 0) as number;
      return aIndex - bIndex;
    });

    // Validate chunk sequence
    const expectedTotal = (sortedChunks[0].content as Record<string, unknown>).totalChunks ??
                         sortedChunks[0].metadata?.totalChunks;

    if (typeof expectedTotal !== 'number') {
      this.log(`TASK-CHUNK-010: WARNING - Missing totalChunks for ${parentId}, using chunk count`);
    }

    // Convert to KnowledgeChunk format for reconstructContent()
    const knowledgeChunks: KnowledgeChunk[] = sortedChunks.map((chunk, idx) => {
      const content = chunk.content as Record<string, unknown>;
      const metadata = chunk.metadata as Record<string, unknown>;

      return {
        text: (content.chunkText ?? content.content ?? '') as string,
        metadata: {
          parentId,
          chunkIndex: (content.chunkIndex ?? metadata?.chunkIndex ?? idx) as number,
          totalChunks: (content.totalChunks ?? metadata?.totalChunks ?? sortedChunks.length) as number,
          startOffset: (content.startOffset ?? metadata?.startOffset ?? 0) as number,
          endOffset: (content.endOffset ?? metadata?.endOffset ?? 0) as number,
          domain: (content.domain ?? metadata?.domain ?? 'unknown') as string,
          type: (content.type ?? metadata?.type ?? 'unknown') as string,
          tags: (content.tags ?? metadata?.tags ?? []) as string[],
          estimatedTokens: (metadata?.estimatedTokens ?? 0) as number,
        }
      };
    });

    // Validate we can reconstruct
    if (!this.knowledgeChunker.canReconstruct(knowledgeChunks)) {
      this.log(`TASK-CHUNK-010: ERROR - Cannot reconstruct chunks for ${parentId}, missing chunks`);
      // Fall back to returning first chunk's content
      const firstContent = sortedChunks[0].content as Record<string, unknown>;
      return this.contentToKnowledgeEntry({
        ...firstContent,
        content: firstContent.chunkText ?? firstContent.content,
      });
    }

    // Reconstruct full content using KnowledgeChunker
    const reconstructedContent = this.knowledgeChunker.reconstructContent(knowledgeChunks);

    // Build KnowledgeEntry from first chunk's metadata + reconstructed content
    const firstContent = sortedChunks[0].content as Record<string, unknown>;
    const firstMetadata = sortedChunks[0].metadata as Record<string, unknown>;

    this.log(`TASK-CHUNK-010: Reconstructed ${knowledgeChunks.length} chunks (${reconstructedContent.length} chars) for ${parentId}`);

    return {
      id: parentId,
      content: reconstructedContent,
      type: (firstContent.type ?? firstMetadata?.type ?? 'pattern') as KnowledgeEntry['type'],
      domain: (firstContent.domain ?? firstMetadata?.domain ?? 'unknown') as string,
      tags: (firstContent.tags ?? firstMetadata?.tags ?? []) as string[],
      quality: (firstContent.quality ?? 0.5) as number,
      usageCount: (firstContent.usageCount ?? 0) as number,
      lastUsed: (firstContent.lastUsed ?? Date.now()) as number,
      createdAt: (firstContent.createdAt ?? Date.now()) as number,
      source: firstContent.source as string | undefined,
    };
  }

  /**
   * Convert raw content object to KnowledgeEntry
   * Helper for backward compatibility with legacy non-chunked entries
   *
   * @param content - Raw content object from vector store
   * @returns KnowledgeEntry
   */
  private contentToKnowledgeEntry(content: Record<string, unknown>): KnowledgeEntry {
    return {
      id: content.id as string,
      content: (content.content ?? content.chunkText ?? '') as string,
      type: (content.type ?? 'pattern') as KnowledgeEntry['type'],
      domain: (content.domain ?? 'unknown') as string,
      tags: (content.tags ?? []) as string[],
      quality: (content.quality ?? 0.5) as number,
      usageCount: (content.usageCount ?? 0) as number,
      lastUsed: (content.lastUsed ?? Date.now()) as number,
      createdAt: (content.createdAt ?? Date.now()) as number,
      source: content.source as string | undefined,
    };
  }

  // ==================== TASK-CHUNK-004: Chunk Retrieval & Reconstruction ====================

  /**
   * Get all chunks for a knowledge entry by parentId
   * Implements: TASK-CHUNK-004 (chunk retrieval)
   * CONSTITUTION: RULE-064 (symmetric chunking), REQ-CHUNK-010 (backward compatibility)
   *
   * @param knowledgeId - The parent knowledge entry ID
   * @returns Array of KnowledgeChunk objects sorted by chunkIndex, empty array if not found
   */
  async getKnowledgeChunks(knowledgeId: string): Promise<KnowledgeChunk[]> {
    await this.ensureInitialized();

    this.log(`TASK-CHUNK-004: Retrieving chunks for knowledge ID: ${knowledgeId}`);

    // Query vector store for all entries with this parentId
    // Use a dummy embedding since we're looking up by ID, not similarity
    const dummyEmbedding = new Float32Array(384); // Default embedding dimension
    const results = await this.agent.query(dummyEmbedding, {
      k: 100, // Get enough results to find all chunks
      minSimilarity: 0,
      includeProvenance: true,
    });

    // Filter results to find chunks matching this parentId
    // Cast to PatternWithMetadata to access runtime metadata field
    const patternsWithMeta = results.patterns as PatternWithMetadata[];
    const matchingChunks: PatternWithMetadata[] = patternsWithMeta.filter(p => {
      const content = p.content as Record<string, unknown>;
      return p.metadata?.parentId === knowledgeId || content.id === knowledgeId;
    });

    if (matchingChunks.length === 0) {
      this.log(`TASK-CHUNK-004: No chunks found for knowledge ID: ${knowledgeId}`);
      return [];
    }

    // Convert to KnowledgeChunk format and sort by chunkIndex
    const knowledgeChunks: KnowledgeChunk[] = matchingChunks.map((chunk) => {
      const content = chunk.content as Record<string, unknown>;
      const metadata = chunk.metadata ?? {};

      return {
        text: (content.chunkText ?? content.content ?? '') as string,
        metadata: {
          parentId: knowledgeId,
          chunkIndex: (content.chunkIndex ?? metadata?.chunkIndex ?? 0) as number,
          totalChunks: (content.totalChunks ?? metadata?.totalChunks ?? matchingChunks.length) as number,
          startOffset: (content.startOffset ?? metadata?.startOffset ?? 0) as number,
          endOffset: (content.endOffset ?? metadata?.endOffset ?? 0) as number,
          domain: (content.domain ?? metadata?.domain ?? 'unknown') as string,
          type: (content.type ?? metadata?.type ?? 'unknown') as string,
          tags: (content.tags ?? metadata?.tags ?? []) as string[],
          estimatedTokens: (metadata?.estimatedTokens ?? 0) as number,
        }
      };
    });

    // Sort by chunkIndex to ensure correct order
    knowledgeChunks.sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);

    this.log(`TASK-CHUNK-004: Retrieved ${knowledgeChunks.length} chunks for ${knowledgeId}`);
    return knowledgeChunks;
  }

  /**
   * Reconstruct full content from knowledge chunks
   * Implements: TASK-CHUNK-004 (content reconstruction)
   * CONSTITUTION: RULE-064 (symmetric chunking), REQ-CHUNK-010 (backward compatibility)
   *
   * @param knowledgeId - The parent knowledge entry ID
   * @returns Reconstructed full content string, or empty string if not found
   * @throws Error if chunks are incomplete or cannot be reconstructed
   */
  async reconstructKnowledge(knowledgeId: string): Promise<string> {
    await this.ensureInitialized();

    this.log(`TASK-CHUNK-004: Reconstructing knowledge ID: ${knowledgeId}`);

    // Get all chunks for this knowledge entry
    const chunks = await this.getKnowledgeChunks(knowledgeId);

    if (chunks.length === 0) {
      this.log(`TASK-CHUNK-004: No chunks found for reconstruction: ${knowledgeId}`);
      return '';
    }

    // For single chunk, return directly without reconstruction overhead
    if (chunks.length === 1) {
      this.log(`TASK-CHUNK-004: Single chunk, returning directly: ${knowledgeId}`);
      return chunks[0].text;
    }

    // Validate chunk sequence can be reconstructed
    if (!this.knowledgeChunker.canReconstruct(chunks)) {
      const missing = this.findMissingChunkIndices(chunks);
      throw new Error(`TASK-CHUNK-004: Cannot reconstruct ${knowledgeId} - missing chunks at indices: ${missing.join(', ')}`);
    }

    // Use KnowledgeChunker to reconstruct content
    const reconstructedContent = this.knowledgeChunker.reconstructContent(chunks);

    this.log(`TASK-CHUNK-004: Reconstructed ${chunks.length} chunks into ${reconstructedContent.length} characters for ${knowledgeId}`);
    return reconstructedContent;
  }

  /**
   * Query knowledge base with automatic chunk handling
   * Implements: TASK-CHUNK-004 (chunked query results)
   * CONSTITUTION: RULE-064 (symmetric chunking), REQ-CHUNK-010 (backward compatibility)
   *
   * Returns deduplicated results where chunked entries are consolidated by parentId.
   * Each result includes the reconstructed content for chunked entries.
   *
   * @param query - Search query text
   * @param options - Query options (k, minSimilarity, domain filter)
   * @returns Array of KnowledgeEntry objects with reconstructed content
   */
  async queryKnowledge(
    query: string,
    options: { k?: number; minSimilarity?: number; domain?: string } = {}
  ): Promise<KnowledgeEntry[]> {
    await this.ensureInitialized();

    const { k = 10, minSimilarity = 0.3, domain } = options;

    this.log(`TASK-CHUNK-004: Querying knowledge with: "${query.substring(0, 50)}..."`);

    // Generate embedding for query
    const embedding = await this.embed(query);

    // Query vector store for matching chunks/entries
    const results = await this.agent.query(embedding, {
      k: k * 3, // Fetch extra to account for chunk deduplication
      minSimilarity,
      includeProvenance: true,
    });

    // Filter by domain if specified
    // Cast to PatternWithMetadata to access runtime metadata field
    let patterns = results.patterns as PatternWithMetadata[];
    if (domain) {
      patterns = patterns.filter(p => {
        const content = p.content as Record<string, unknown>;
        return content.domain === domain || p.metadata?.domain === domain;
      });
    }

    // Group by parentId to deduplicate chunked entries
    const parentIdMap = new Map<string, {
      patterns: PatternWithMetadata[];
      maxSimilarity: number;
    }>();

    for (const pattern of patterns) {
      const content = pattern.content as Record<string, unknown>;
      const parentId = (pattern.metadata?.parentId ?? content.id) as string;

      const existing = parentIdMap.get(parentId);
      if (existing) {
        existing.patterns.push(pattern);
        existing.maxSimilarity = Math.max(existing.maxSimilarity, pattern.similarity);
      } else {
        parentIdMap.set(parentId, {
          patterns: [pattern],
          maxSimilarity: pattern.similarity,
        });
      }
    }

    // Sort by max similarity
    const sortedEntries = Array.from(parentIdMap.entries())
      .sort((a, b) => b[1].maxSimilarity - a[1].maxSimilarity)
      .slice(0, k);

    // Reconstruct chunked entries and return KnowledgeEntry objects
    const knowledgeEntries: KnowledgeEntry[] = [];

    for (const [parentId, { patterns: entryPatterns }] of sortedEntries) {
      const firstPattern = entryPatterns[0];
      const content = firstPattern.content as Record<string, unknown>;

      // Check if this is a chunked entry
      if (this.isChunkedEntry(content)) {
        // Reconstruct full content from all chunks
        try {
          const reconstructed = await this.reconstructKnowledge(parentId);
          knowledgeEntries.push({
            id: parentId,
            content: reconstructed,
            type: (content.type ?? 'pattern') as KnowledgeEntry['type'],
            domain: (content.domain ?? 'unknown') as string,
            tags: (content.tags ?? []) as string[],
            quality: (content.quality ?? 0.5) as number,
            usageCount: (content.usageCount ?? 0) as number,
            lastUsed: (content.lastUsed ?? Date.now()) as number,
            createdAt: (content.createdAt ?? Date.now()) as number,
            source: content.source as string | undefined,
          });
        } catch (error) {
          // Fall back to returning the matched chunk's text on reconstruction failure
          this.log(`TASK-CHUNK-004: Reconstruction failed for ${parentId}, using chunk text: ${error}`);
          knowledgeEntries.push(this.contentToKnowledgeEntry(content));
        }
      } else {
        // Non-chunked entry, return directly
        knowledgeEntries.push(this.contentToKnowledgeEntry(content));
      }
    }

    this.log(`TASK-CHUNK-004: Query returned ${knowledgeEntries.length} knowledge entries (from ${patterns.length} raw results)`);
    return knowledgeEntries;
  }

  /**
   * Find missing chunk indices for error reporting
   * Helper for TASK-CHUNK-004
   */
  private findMissingChunkIndices(chunks: KnowledgeChunk[]): number[] {
    if (chunks.length === 0) return [];

    const expectedTotal = chunks[0].metadata.totalChunks;
    const presentIndices = new Set(chunks.map(c => c.metadata.chunkIndex));
    const missing: number[] = [];

    for (let i = 0; i < expectedTotal; i++) {
      if (!presentIndices.has(i)) {
        missing.push(i);
      }
    }

    return missing;
  }

  /**
   * Maybe store a pattern if it's high quality
   */
  private async maybeStorePattern(entry: Omit<KnowledgeEntry, 'id' | 'quality' | 'usageCount' | 'lastUsed' | 'createdAt'>): Promise<string | null> {
    // Check if similar pattern already exists
    const embedding = await this.embed(entry.content);
    const existing = await this.agent.query(embedding, { k: 1, minSimilarity: 0.9 });

    if (existing.patterns.length > 0) {
      // Update existing rather than duplicate
      await this.updateUsageStats(existing.patterns[0].id);
      return null;
    }

    return this.storeKnowledge(entry);
  }

  private async updateUsageStats(patternId: string): Promise<void> {
    // In a full implementation, this would update the pattern's usage count
    // For now, just track locally
    this.log(`Pattern accessed: ${patternId}`);
  }

  // ==================== Helper Methods ====================

  // ==================== DESC Episode Injection ====================

  /**
   * Inject prior solutions from DESC episodic memory (RULE-010)
   * Uses default window size of 3 episodes for general agent work
   *
   * @param prompt - The original prompt to augment
   * @param context - Additional context for logging/metadata
   * @returns Augmented prompt with prior solutions or original on error
   */
  private async injectDESCEpisodes(
    prompt: string,
    context?: { command?: string; mode?: AgentMode }
  ): Promise<{ augmentedPrompt: string; episodesUsed: number; episodeIds: string[] }> {
    // Skip if DESC is disabled or client not initialized
    if (!this.config.enableDESC || !this.ucmClient) {
      return { augmentedPrompt: prompt, episodesUsed: 0, episodeIds: [] };
    }

    try {
      const result = await this.ucmClient.injectSolutions(prompt, {
        threshold: this.config.descThreshold,
        maxEpisodes: this.config.descMaxEpisodes, // RULE-010: default 3
        agentType: context?.mode ?? 'general',
        metadata: {
          source: 'universal-agent',
          command: context?.command ?? 'unknown',
          timestamp: Date.now(),
        },
      });

      if (result.episodesUsed > 0) {
        this.log(`DESC: Injected ${result.episodesUsed} prior solutions for ${context?.command ?? 'task'}`);
      }

      return result;
    } catch (error) {
      // Graceful fallback - don't block execution if DESC fails
      this.log(`DESC: Episode injection failed, using original prompt: ${error}`);
      return { augmentedPrompt: prompt, episodesUsed: 0, episodeIds: [] };
    }
  }

  /**
   * Store a completed episode for future DESC retrieval
   *
   * @param queryText - The original query/prompt
   * @param answerText - The generated response/result
   * @param context - Additional context for metadata
   */
  private async storeDESCEpisode(
    queryText: string,
    answerText: string,
    context?: { command?: string; mode?: AgentMode; quality?: number }
  ): Promise<void> {
    // Skip if DESC is disabled or client not initialized
    if (!this.config.enableDESC || !this.ucmClient) {
      return;
    }

    // Only store high-quality episodes (above threshold)
    const quality = context?.quality ?? 0.7;
    if (quality < this.config.autoStoreThreshold) {
      this.log(`DESC: Skipping episode storage (quality ${quality.toFixed(2)} < threshold ${this.config.autoStoreThreshold})`);
      return;
    }

    try {
      const result = await this.ucmClient.storeEpisode(queryText, answerText, {
        source: 'universal-agent',
        command: context?.command ?? 'unknown',
        mode: context?.mode ?? 'general',
        quality,
        timestamp: Date.now(),
      });

      if (result.success) {
        this.log(`DESC: Stored episode ${result.episodeId} for future learning`);
      }
    } catch (error) {
      // Non-fatal: don't block on storage failures
      this.log(`DESC: Episode storage failed: ${error}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _detectMode(input: string): AgentMode {
    const lower = input.toLowerCase();

    if (lower.match(/\b(code|function|implement|debug|fix|program|script|api)\b/)) {
      return 'code';
    }
    if (lower.match(/\b(research|find|investigate|analyze|study|explore|learn about)\b/)) {
      return 'research';
    }
    if (lower.match(/\b(write|draft|compose|create|essay|article|document|report|paper)\b/)) {
      return 'write';
    }

    return 'general';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _generateCode(
    task: string,
    patterns: QueryResult['patterns'],
    options: { language?: string; context?: string; examples?: string[] }
  ): Promise<string> {
    const patternContext = this.buildPatternContext(patterns);

    const examplesContext = options.examples?.length
      ? `\n\n## Examples:\n${options.examples.map((ex, i) => `### Example ${i + 1}:\n${ex}`).join('\n\n')}`
      : '';

    const prompt = `## Code Generation Task

**Language**: ${options.language ?? 'typescript'}

**Task**: ${task}

${patternContext}
${options.context ? `\n## Additional Context:\n${options.context}` : ''}
${examplesContext}

## Requirements:
1. Generate clean, production-ready code
2. Follow best practices for ${options.language ?? 'typescript'}
3. Include necessary imports
4. Add JSDoc/docstring comments for public APIs
5. Handle edge cases appropriately

## Output Format:
Return ONLY the code, wrapped in appropriate markdown code blocks.
`;

    // Use the coder agent via CLI (now that SPEC-EXE-001 is implemented)
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const args = ['--print', '--output-format', 'json'];

      // System prompt for coder behavior
      const systemPrompt = `You are a code generation expert. Generate clean, well-documented, production-ready code.
Focus on: correctness, readability, best practices, proper error handling.
Return ONLY code in markdown code blocks.`;

      args.push('--system-prompt', systemPrompt);
      args.push(prompt);

      // Set timeout for CLI execution (10 seconds)
      const timeout = setTimeout(async () => {
        this.log('Warning: Claude CLI execution timed out (10s)');
        child.kill();
        resolve(await this.generateFallbackCode(task, patterns, options));
      }, 10000);

      const child = spawn('claude', args, { cwd: process.cwd() });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', async (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout);
            const response = parsed.result || parsed.output || stdout;
            const extractedCode = this.extractCodeFromResponse(response);
            resolve(extractedCode);
          } catch {
            // INTENTIONAL: JSON parsing failure is expected for non-JSON CLI output - fallback to raw extraction
            const extractedCode = this.extractCodeFromResponse(stdout);
            resolve(extractedCode);
          }
        } else {
          // Fallback to placeholder if CLI fails
          this.log(`Warning: Claude CLI execution failed (code ${code}): ${stderr}`);
          resolve(await this.generateFallbackCode(task, patterns, options));
        }
      });

      child.on('error', async (err) => {
        // Fallback if CLI not found or error occurred
        clearTimeout(timeout);
        this.log(`Warning: Claude CLI not available: ${err.message}`);
        resolve(await this.generateFallbackCode(task, patterns, options));
      });
    });
  }

  /**
   * Build context from ReasoningBank patterns
   */
  private buildPatternContext(patterns: QueryResult['patterns']): string {
    if (patterns.length === 0) {
      return '## No existing patterns found - creating new solution.';
    }

    const relevantPatterns = patterns.slice(0, 5);
    return `## Relevant Patterns (${patterns.length} found):\n${
      relevantPatterns.map((p, i) => {
        const contentStr = String(p.content).slice(0, 500);
        return `### Pattern ${i + 1} (relevance: ${(p.similarity * 100).toFixed(0)}%):\n${contentStr}`;
      }).join('\n\n')
    }`;
  }

  /**
   * Extract code from markdown code blocks in response
   */
  private extractCodeFromResponse(response: string): string {
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
    const matches = [...response.matchAll(codeBlockRegex)];

    if (matches.length > 0) {
      return matches.map(m => m[1].trim()).join('\n\n');
    }

    // No code blocks found, return trimmed response
    return response.trim();
  }

  /**
   * Generate fallback code when CLI is not available
   * Uses ClaudeCodeExecutor for production-ready code with InteractionStore for learning
   * RULE-CLI-001-002: No fallbacks - let errors propagate
   */
  private async generateFallbackCode(
    task: string,
    patterns: QueryResult['patterns'],
    options: { language?: string; context?: string; examples?: string[] }
  ): Promise<string> {
    const language = options.language ?? 'typescript';

    // Build context from patterns, examples, and InteractionStore
    const contextParts: string[] = [];

    if (options.context) {
      contextParts.push(options.context);
    }

    // Add ReasoningBank patterns
    if (patterns.length > 0) {
      const patternContext = patterns
        .slice(0, 3)
        .map((p, i) => `Pattern ${i + 1}: ${String(p.content).slice(0, 300)}`)
        .join('\n\n');
      contextParts.push(`Relevant patterns from ReasoningBank:\n${patternContext}`);
    }

    // Retrieve relevant context from InteractionStore
    const relevantContext = await this.getRelevantContext(task);
    if (relevantContext) {
      contextParts.push(relevantContext);
    }

    // Add user-provided examples
    if (options.examples && options.examples.length > 0) {
      const examplesContext = options.examples
        .map((ex, i) => `Example ${i + 1}:\n${ex}`)
        .join('\n\n');
      contextParts.push(`Examples:\n${examplesContext}`);
    }

    const request: ICodeExecutionRequest = {
      task,
      language,
      context: contextParts.join('\n\n') || undefined,
      constraints: ['production-ready', 'well-documented', 'type-safe'],
      maxTokens: 2048
    };

    // RULE-CLI-001-002: Let errors propagate (no try/catch fallback)
    const result = await this.codeExecutor.execute(request);

    // Store the generated code for learning if quality is high
    if (this.interactionStore && result.qualityScore >= 0.7) {
      const embedding = await this.embed(task);
      const interaction: Interaction = {
        id: this.generateId(),
        mode: 'code',
        input: task,
        output: result.code,
        embedding,
        timestamp: Date.now(),
        feedback: {
          rating: result.qualityScore,
          useful: true,
          notes: `Generated via ${result.metadata.source}, model: ${result.metadata.model}`
        },
        metadata: {
          language,
          source: result.metadata.source,
          model: result.metadata.model,
          tokensUsed: result.metadata.tokensUsed,
          latencyMs: result.metadata.latencyMs,
        }
      };
      this.interactionStore.add(interaction);
      this.log(`Stored high-quality code in InteractionStore: quality=${result.qualityScore.toFixed(2)}`);
    }

    this.log(`Generated code via ${result.metadata.source}: quality=${result.qualityScore.toFixed(2)}`);

    return result.code;
  }

  /**
   * Get relevant context from InteractionStore for code generation
   */
  private async getRelevantContext(prompt: string): Promise<string> {
    if (!this.interactionStore) {
      return '';
    }

    try {
      // Search for similar code interactions in InteractionStore
      const stats = this.interactionStore.getStats();
      if (stats.totalInteractions === 0) {
        return '';
      }

      // Get all interactions and find code mode ones
      const allInteractions = this.interactionStore.getHighQuality();
      const codeInteractions = allInteractions.filter(i => i.mode === 'code');

      if (codeInteractions.length === 0) {
        return '';
      }

      // Simple similarity: find interactions with matching keywords
      const promptWords = new Set(prompt.toLowerCase().split(/\W+/).filter(w => w.length > 3));

      const similar = codeInteractions
        .map(interaction => {
          const inputWords = new Set(interaction.input.toLowerCase().split(/\W+/));
          const matchCount = [...promptWords].filter(word => inputWords.has(word)).length;
          return { interaction, matchCount };
        })
        .filter(item => item.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount)
        .slice(0, 3);

      if (similar.length === 0) {
        return '';
      }

      const contextLines = similar.map((item, idx) => {
        const { interaction } = item;
        return `Previous Example ${idx + 1}:\nTask: ${interaction.input}\nCode:\n${interaction.output.slice(0, 400)}${interaction.output.length > 400 ? '...' : ''}`;
      });

      return `Similar code from memory (InteractionStore):\n\n${contextLines.join('\n\n')}`;
    } catch (error) {
      this.log(`Error retrieving context from InteractionStore: ${error}`);
      return '';
    }
  }


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _generateWriting(
    topic: string,
    knowledge: QueryResult['patterns'],
    options: { style: string; length: string; format: string; stylePrompt?: string | null }
  ): Promise<string> {
    try {
      // Check if writing generator is available (graceful degradation)
      if (!this.writingGenerator) {
        this.log('Writing generator unavailable (ANTHROPIC_API_KEY not set)', true);
        return `# ${topic}\n\nWriting generation requires ANTHROPIC_API_KEY environment variable to be set.`;
      }

      // Gather context from InteractionStore
      const context = await this.gatherWritingContext(topic, knowledge);

      // Estimate word count from length option
      const maxLength = this.estimateWordCount(options.length);

      // Generate with LLM
      const result = await this.writingGenerator.generate({
        title: topic,
        description: `Generate content in ${options.style} style with ${options.length} length`,
        style: options.style !== 'default' ? options.style : undefined,
        context,
        maxLength,
        format: options.format === 'markdown' ? 'markdown' : 'plain',
      });

      // Provide feedback to ReasoningBank for learning
      const reasoningBank = this.agent.getReasoningBank();
      if (reasoningBank) {
        await reasoningBank.provideFeedback({
          trajectoryId: `writing-${Date.now()}`,
          quality: result.qualityScore,
          verdict: result.qualityScore > 0.7 ? 'correct' : 'neutral',
          reasoning: `Generated ${result.wordCount} words for "${topic}" (quality: ${result.qualityScore.toFixed(2)})`,
        });
      }

      this.log(
        `Generated ${result.wordCount} words (quality: ${result.qualityScore.toFixed(2)}, model: ${result.metadata.model})`,
        true
      );

      return result.content;
    } catch (error) {
      this.log(`Writing generation failed: ${error}`, true);
      // Fallback to ensure non-breaking behavior
      return `# ${topic}\n\nError: Failed to generate content. ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Gather context from InteractionStore for writing generation (SPEC-WRT-001)
   */
  private async gatherWritingContext(
    topic: string,
    knowledge: QueryResult['patterns']
  ): Promise<string> {
    const contextParts: string[] = [];

    // Include knowledge from query
    if (knowledge.length > 0) {
      contextParts.push(`Relevant knowledge entries: ${knowledge.length}`);
      const topKnowledge = knowledge.slice(0, 3);
      for (const pattern of topKnowledge) {
        const content = typeof pattern.content === 'string' ? pattern.content : JSON.stringify(pattern.content);
        contextParts.push(`- ${content.substring(0, 200)}`);
      }
    }

    // Query InteractionStore for relevant knowledge
    const allKnowledge = this.interactionStore.getKnowledgeByDomain('*');
    const relevantKnowledge = allKnowledge.filter((k) => {
      const content = k.content.toLowerCase();
      const topicLower = topic.toLowerCase();
      return (
        content.includes(topicLower) ||
        topicLower.split(' ').some((word) => word.length > 4 && content.includes(word))
      );
    });

    if (relevantKnowledge.length > 0) {
      contextParts.push(`\nAdditional context from InteractionStore:`);
      const topRelevant = relevantKnowledge.slice(0, 3);
      for (const k of topRelevant) {
        contextParts.push(`[${k.type}]: ${k.content.substring(0, 300)}`);
      }
    }

    return contextParts.length > 0 ? contextParts.join('\n') : '';
  }

  /**
   * Estimate word count from length string
   */
  private estimateWordCount(length: string): number {
    const lengthMap: Record<string, number> = {
      short: 500,
      medium: 1500,
      long: 3000,
    };
    return lengthMap[length] ?? 1500;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _synthesize(findings: ResearchResult['findings'], query: string, stylePrompt?: string | null): string {
    if (findings.length === 0) {
      return `No existing knowledge found for: ${query}. Consider adding research to the knowledge base.`;
    }

    // Build synthesis with style guidance if available
    let synthesis = `Based on ${findings.length} knowledge entries:\n\n`;

    if (stylePrompt) {
      synthesis += `[Style Profile Applied]\n${stylePrompt}\n\n`;
    }

    synthesis += findings.map(f => `- ${f.content.slice(0, 100)}... (relevance: ${(f.relevance * 100).toFixed(0)}%)`).join('\n');

    return synthesis;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _processCode(input: string, _knowledge: QueryResult['patterns'], context?: string): Promise<string> {
    const result = await this.code(input, { context });
    return result.code;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _processResearch(input: string, _knowledge: QueryResult['patterns']): Promise<string> {
    const result = await this.research(input);
    return result.synthesis;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _processWrite(input: string, _knowledge: QueryResult['patterns'], _context?: string): Promise<string> {
    const result = await this.write(input);
    return result.content;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _processGeneral(input: string, knowledge: QueryResult['patterns']): Promise<string> {
    if (knowledge.length > 0) {
      return `Found ${knowledge.length} relevant entries:\n\n` +
        knowledge.slice(0, 5).map(k => `- ${String(k.content).slice(0, 200)}...`).join('\n');
    }
    return `No relevant knowledge found for: ${input}`;
  }

  private assessQuality(interaction: Interaction): number {
    // Heuristic quality assessment
    let quality = 0.5;

    // Longer, detailed outputs tend to be higher quality
    if (interaction.output.length > 500) quality += 0.1;
    if (interaction.output.length > 1000) quality += 0.1;

    // Structured output (code, lists) tends to be useful
    if (interaction.output.includes('```')) quality += 0.1;
    if (interaction.output.includes('\n-')) quality += 0.05;

    return Math.min(quality, 1.0);
  }

  private extractTags(text: string): string[] {
    // Extract meaningful tags from text
    const words = text.toLowerCase().split(/\W+/);
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'after', 'before', 'when', 'whenever', 'where', 'wherever', 'whether', 'which', 'while', 'who', 'whoever', 'whom', 'whose', 'why', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'this', 'that', 'these', 'those', 'am']);

    return words
      .filter(w => w.length > 3 && !stopWords.has(w))
      .slice(0, 10);
  }

  private async embed(text: string): Promise<Float32Array> {
    // Use real embedding provider from SPEC-EMB-001 (LocalEmbeddingProvider with all-mpnet-base-v2)
    // Provider already handles caching, normalization, error handling
    return this.embeddingProvider.embed(text);
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private log(...args: unknown[]): void {
    if (this.config.verbose) {
      universalLogger.debug(args.map(a => String(a)).join(' '));
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ==================== Style Profile Management ====================

  /**
   * Learn a writing style from text samples
   *
   * @param name - Name for the style profile
   * @param textSamples - Array of text samples to learn from
   * @param options - Additional options
   * @returns The created style profile
   */
  async learnStyle(
    name: string,
    textSamples: string[],
    options: {
      description?: string;
      tags?: string[];
      setAsActive?: boolean;
    } = {}
  ): Promise<StoredStyleProfile | null> {
    await this.ensureInitialized();

    if (!this.styleProfileManager) {
      this.log('Warning: StyleProfileManager not available');
      return null;
    }

    try {
      const profile = await this.styleProfileManager.createProfile(name, textSamples, {
        description: options.description,
        sourceType: 'text',
        tags: options.tags,
      });

      if (options.setAsActive) {
        await this.styleProfileManager.setActiveProfile(profile.metadata.id);
        this.log(`Style profile "${name}" created and set as active`);
      } else {
        this.log(`Style profile "${name}" created`);
      }

      return profile;
    } catch (error) {
      this.log(`Error creating style profile: ${error}`);
      return null;
    }
  }

  /**
   * List all available style profiles
   */
  listStyleProfiles(): StyleProfileMetadata[] {
    if (!this.styleProfileManager) {
      return [];
    }
    return this.styleProfileManager.listProfiles();
  }

  /**
   * Set the active style profile
   */
  async setActiveStyleProfile(profileId: string | null): Promise<boolean> {
    if (!this.styleProfileManager) {
      this.log('Warning: StyleProfileManager not available');
      return false;
    }

    try {
      await this.styleProfileManager.setActiveProfile(profileId);
      this.log(`Active style profile set to: ${profileId ?? 'none'}`);
      return true;
    } catch (error) {
      this.log(`Error setting active style profile: ${error}`);
      return false;
    }
  }

  /**
   * Get the active style profile
   */
  getActiveStyleProfile(): StoredStyleProfile | undefined {
    return this.styleProfileManager?.getActiveProfile();
  }

  /**
   * Get style characteristics for a profile
   */
  getStyleCharacteristics(profileId?: string): StyleCharacteristics | null {
    if (!this.styleProfileManager) {
      return null;
    }
    return this.styleProfileManager.getStyleCharacteristics(profileId);
  }

  /**
   * Get style profile statistics
   */
  getStyleStats(): { totalProfiles: number; activeProfile: string | null; totalSourceDocuments: number } {
    if (!this.styleProfileManager) {
      return { totalProfiles: 0, activeProfile: null, totalSourceDocuments: 0 };
    }
    return this.styleProfileManager.getStats();
  }

  /**
   * Get the StyleProfileManager instance for direct access
   */
  getStyleProfileManager(): StyleProfileManager | undefined {
    return this.styleProfileManager;
  }

  // ==================== Stats & Status ====================

  /**
   * Get comprehensive learning statistics
   */
  getStats(): UnifiedLearningStats {
    const storeStats = this.interactionStore.getStats();

    // Get top patterns (sorted by usage)
    const patternArray = Array.from(this.successfulPatterns.entries())
      .map(([id, count]) => ({ id, uses: count }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 10);

    const stats: UnifiedLearningStats = {
      totalInteractions: storeStats.totalInteractions,
      knowledgeEntries: storeStats.knowledgeCount,
      domainExpertise: Object.fromEntries(this.domainExpertise),
      topPatterns: patternArray,
      persistenceStats: {
        highQualityCount: storeStats.highQualityCount,
        oldestInteraction: storeStats.oldestInteraction,
        newestInteraction: storeStats.newestInteraction,
        lastSaved: new Date().toISOString(),
      },
    };

    // Add SonaEngine metrics if available
    try {
      const sonaEngine = this.agent.getSonaEngine?.();
      if (sonaEngine) {
        const sonaStats = sonaEngine.getStats();
        const metrics = sonaEngine.getMetrics();

        stats.sonaMetrics = {
          totalTrajectories: metrics.totalTrajectories,
          totalRoutes: sonaStats.routeCount,
          averageQualityByRoute: metrics.averageQualityByRoute || {},
          improvementPercentage: metrics.improvementPercentage || {},
          currentDrift: metrics.currentDrift || 0,
        };

        // Calculate learning effectiveness
        stats.learningEffectiveness = this.calculateLearningEffectiveness(sonaEngine);
      }
    } catch (error) {
      // SonaEngine not available or error - continue without
      this.log(`SonaEngine metrics unavailable: ${error}`);
    }

    return stats;
  }

  /**
   * Calculate learning effectiveness (G3 requirement: 10-30% improvement)
   */
  private calculateLearningEffectiveness(sonaEngine: unknown): UnifiedLearningStats['learningEffectiveness'] {
    try {
      // Cast to access methods (SonaEngine type might not be exported)
      const engine = sonaEngine as {
        listTrajectories: (route?: string) => Array<{ quality?: number; timestamp: number }>;
      };

      // Get all trajectories with quality scores, sorted by timestamp
      const allTrajectories = engine.listTrajectories()
        .filter(t => t.quality !== undefined)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (allTrajectories.length < 20) {
        return undefined; // Not enough data yet
      }

      const qualities = allTrajectories.map(t => t.quality!);
      const sampleSize = Math.min(20, Math.floor(qualities.length / 2));

      // First N trajectories (baseline)
      const baseline = qualities.slice(0, sampleSize);
      const baselineAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length;

      // Last N trajectories (learned)
      const learned = qualities.slice(-sampleSize);
      const learnedAvg = learned.reduce((a, b) => a + b, 0) / learned.length;

      // Calculate improvement
      const improvementPct = baselineAvg > 0
        ? ((learnedAvg - baselineAvg) / baselineAvg) * 100
        : 0;

      return {
        baselineQuality: Math.round(baselineAvg * 1000) / 1000,
        learnedQuality: Math.round(learnedAvg * 1000) / 1000,
        improvementPct: Math.round(improvementPct * 10) / 10,
        sampleSize: sampleSize * 2,
      };
    } catch {
      // INTENTIONAL: Learning metrics calculation is optional - undefined signals unavailable metrics
      return undefined;
    }
  }

  /**
   * Get underlying God Agent status
   */
  getStatus() {
    return this.agent.getStatus();
  }

  /**
   * Shutdown - saves all state before closing
   */
  async shutdown(): Promise<void> {
    this.log('Shutting down Universal Agent...');

    // Save persisted state before shutdown
    if (this.config.enablePersistence) {
      await this.savePersistedState();
    }

    // Save LEANN vectors before shutdown (only if we have vectors to avoid overwriting pipeline index)
    if (this.leannContextService) {
      const vectorCount = this.leannContextService.getVectorCount();
      if (vectorCount > 0) {
        try {
          await this.leannContextService.save(LEANN_PERSISTENCE_PATH);
          this.log(`LEANN: Saved ${vectorCount} vectors to ${LEANN_PERSISTENCE_PATH}`);
        } catch (error) {
          this.log(`LEANN: Failed to save vectors: ${error}`);
        }
      } else {
        this.log('LEANN: Skipping save — 0 vectors (avoiding overwrite of pipeline index)');
      }
    }

    // MEM-001: Disconnect memory client (daemon keeps running for other processes)
    if (this.memoryClient?.isConnected()) {
      await this.memoryClient.disconnect();
      this.log('MEM-001: Memory client disconnected (daemon persists)');
    }

    await this.agent.shutdown();
    this.initialized = false;
    this.log('Universal Agent shutdown complete - state persisted');
  }

  /**
   * Get coding pipeline orchestrator with all dependencies wired
   * Used by coding-pipeline-cli.ts for stateful session management
   *
   * @returns Configured CodingPipelineOrchestrator instance
   */
  async getCodingOrchestrator(configOverride?: Partial<IOrchestratorConfig>): Promise<CodingPipelineOrchestrator> {
    await this.ensureInitialized();

    const deps: IOrchestratorDependencies = {
      agentRegistry: this.agentRegistry,
      agentSelector: this.agentSelector,
      interactionStore: this.interactionStore,
      reasoningBank: this.agent.getReasoningBank() ?? undefined,
      sonaEngine: this.agent.getSonaEngine() ?? undefined,
      leannContextService: this.leannContextService ?? undefined,
      embeddingProvider: this.embeddingProvider ?? undefined,
      patternMatcher: this.agent.getPatternMatcher() ?? undefined,
    };

    return createOrchestrator(deps, {
      verbose: true,
      enableLearning: true,
      ...configOverride,
    });
  }

  /**
   * Force save current state (call periodically for safety)
   */
  async saveState(): Promise<void> {
    await this.savePersistedState();
  }
}

// ==================== Singleton Export ====================

export const universalAgent = new UniversalAgent();
