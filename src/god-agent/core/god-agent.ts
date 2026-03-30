/**
 * God Agent - Main Orchestrator
 *
 * The unified orchestrator that integrates all God Agent subsystems:
 * - Layer 1: Native Core (VectorDB, GraphDB)
 * - Layer 2: Reasoning (ReasoningBank, PatternMatcher, CausalMemory, ProvenanceStore, ShadowVectors)
 * - Layer 3: Memory (MemoryEngine, CompressionManager)
 * - Layer 4: Learning (SonaEngine)
 * - Layer 5: Orchestration (RelayRace, AttentionFactory, PhD Pipeline)
 * - Layer 6: Intelligent Routing (DAI-003 - integrated via UniversalAgent)
 *
 * Implements: PRD Section 8 - God Agent Architecture
 */

import { VectorDB, type VectorDBConfig, DistanceMetric } from './vector-db/index.js';
import { GraphDB, FallbackGraph, type GraphDBConfig } from './graph-db/index.js';
import {
  UnifiedSearch,
  type QuadFusionOptions,
  type QuadFusionResult,
  type SourceWeights,
} from './search/index.js';
import { MemoryClient } from './memory-server/index.js';
import { MemoryEngine, type MemoryEngineConfig } from './memory/index.js';
import {
  ReasoningBank,
  PatternMatcher,
  CausalMemory,
  ProvenanceStore,
  type ReasoningBankConfig,
} from './reasoning/index.js';
import { SonaEngine, createProductionSonaEngine, type SonaEngineConfig } from './learning/index.js';
import {
  RelayRaceOrchestrator,
  type RelayRaceConfig,
} from './orchestration/index.js';
// DAI-003: TinyDancer replaced by Intelligent Task Routing (integrated via UniversalAgent)
import type { IRoutingConfig } from './routing/index.js';
import {
  CompressionManager,
  type CompressionConfig,
} from './compression/index.js';
import {
  AttentionFactory,
  type AttentionConfig,
} from './attention/index.js';
import {
  PhdPipelineOrchestrator,
  type PhdPipelineConfig,
  PhDPipelineRunner,
  type IPhDPipelineRunnerOptions,
  type IRunResult,
} from './pipeline/index.js';
import { ClaudeTaskExecutor } from './executor/claude-task-executor.js';
import {
  MetricsCollector,
  Logger,
  DistributedTracer,
} from './observability/index.js';
import {
  RuntimeSelector,
  type RuntimeSelection,
} from './portability/index.js';
import {
  AgentExecutionService,
  createAgentExecutionService,
} from './services/index.js';
import { AgentRegistry, createAgentRegistry } from './agents/index.js';
// TODO: Fix ClaudeTaskExecutor types before re-enabling
// import { ClaudeTaskExecutor } from './executor/index.js';
import { EmbeddingProviderFactory } from './memory/embedding-provider.js';
import type {
  IAgentExecutionOptions,
  IAgentExecutionResult,
  IAgentChainStep,
  IAgentChainResult,
  IAgentFilter,
  IAgentInfo,
} from './types/index.js';
import type {
  IPipelineDefinition,
  IAgentDefinition,
} from './orchestration/orchestration-types.js';

// ==================== Types ====================

/**
 * God Agent configuration
 */
export interface GodAgentConfig {
  /** Vector database configuration */
  vectorDB?: Partial<VectorDBConfig>;
  /** Graph database configuration */
  graphDB?: Partial<GraphDBConfig>;
  /** Memory engine configuration */
  memory?: Partial<MemoryEngineConfig>;
  /** Reasoning subsystem configuration */
  reasoning?: Partial<ReasoningBankConfig>;
  /** Learning subsystem configuration */
  learning?: Partial<SonaEngineConfig>;
  /** Orchestration configuration */
  orchestration?: Partial<RelayRaceConfig>;
  /** Routing configuration */
  /** DAI-003: Intelligent routing configuration (integrated via UniversalAgent) */
  routing?: Partial<IRoutingConfig>;
  /** Compression configuration */
  compression?: Partial<CompressionConfig>;
  /** Attention configuration */
  attention?: Partial<AttentionConfig>;
  /** PhD pipeline configuration */
  pipeline?: Partial<PhdPipelineConfig>;
  /** Unified search configuration (TASK-SEARCH-006) */
  searchOptions?: Partial<QuadFusionOptions>;
  /** Enable observability */
  enableObservability?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * God Agent initialization result
 */
export interface GodAgentInitResult {
  /** Whether initialization succeeded */
  success: boolean;
  /** Runtime selection result */
  runtime: RuntimeSelection;
  /** Initialization time in ms */
  initTimeMs: number;
  /** Component status */
  components: {
    vectorDB: boolean;
    graphDB: boolean;
    memory: boolean;
    reasoning: boolean;
    learning: boolean;
    orchestration: boolean;
    routing: boolean;
    compression: boolean;
    attention: boolean;
    observability: boolean;
  };
  /** Any warnings during initialization */
  warnings: string[];
}

/**
 * God Agent status
 */
export interface GodAgentStatus {
  /** Whether God Agent is initialized */
  initialized: boolean;
  /** Current runtime type */
  runtime: 'native' | 'wasm' | 'javascript';
  /** Memory usage */
  memory: {
    vectorCount: number;
    graphNodeCount: number;
    cacheHitRate: number;
  };
  /** Component health */
  health: {
    vectorDB: 'healthy' | 'degraded' | 'down';
    graphDB: 'healthy' | 'degraded' | 'down';
    memory: 'healthy' | 'degraded' | 'down';
    reasoning: 'healthy' | 'degraded' | 'down';
    learning: 'healthy' | 'degraded' | 'down';
  };
  /** Uptime in ms */
  uptimeMs: number;
}

/**
 * Query options for God Agent
 */
export interface QueryOptions {
  /** Number of results to return */
  k?: number;
  /** Minimum similarity threshold */
  minSimilarity?: number;
  /** Include provenance information */
  includeProvenance?: boolean;
  /** Include causal context */
  includeCausal?: boolean;
  /** Apply attention mechanisms */
  applyAttention?: boolean;
  /** Timeout in ms */
  timeoutMs?: number;
}

/**
 * Query result from God Agent
 */
export interface QueryResult {
  /** Query ID */
  queryId: string;
  /** Retrieved patterns */
  patterns: Array<{
    id: string;
    content: unknown;
    similarity: number;
    confidence: number;
    provenance?: unknown;
    causalContext?: unknown;
  }>;
  /** Query latency in ms */
  latencyMs: number;
  /** Reasoning mode used */
  reasoningMode: string;
  /** Attention mechanism applied */
  attentionMechanism?: string;
}

/**
 * Store options for God Agent
 */
export interface StoreOptions {
  /** Namespace for storage */
  namespace?: string;
  /** Track provenance */
  trackProvenance?: boolean;
  /** Compress immediately */
  compress?: boolean;
  /** TTL in ms */
  ttlMs?: number;
}

/**
 * Store result from God Agent
 */
export interface StoreResult {
  /** Generated ID */
  id: string;
  /** Vector ID in VectorDB */
  vectorId: string;
  /** Graph node ID */
  graphNodeId: string;
  /** Storage timestamp */
  timestamp: number;
  /** Whether compressed */
  compressed: boolean;
}

// ==================== God Agent ====================

/**
 * God Agent - The main orchestrator for all subsystems
 *
 * @example
 * ```typescript
 * const agent = new GodAgent();
 * await agent.initialize();
 *
 * // Store knowledge
 * const result = await agent.store({
 *   content: 'Important pattern',
 *   embedding: new Float32Array(VECTOR_DIM) // 1536 dimensions
 * });
 *
 * // Query knowledge
 * const query = await agent.query(queryEmbedding, { k: 10 });
 * console.log(query.patterns);
 *
 * // Shutdown
 * await agent.shutdown();
 * ```
 */
export class GodAgent {
  private config: GodAgentConfig;
  private initialized = false;
  private startTime?: number;

  // Layer 1: Native Core
  private vectorDB?: VectorDB;
  private graphDB?: GraphDB;
  private fallbackGraph?: FallbackGraph;

  // TASK-SEARCH-006: Unified Search
  private memoryClient?: MemoryClient;
  private unifiedSearch?: UnifiedSearch;

  // Layer 2: Reasoning
  private reasoningBank?: ReasoningBank;
  private patternMatcher?: PatternMatcher;
  private causalMemory?: CausalMemory;
  private provenanceStore?: ProvenanceStore;

  // Layer 3: Memory
  private memoryEngine?: MemoryEngine;
  private compressionManager?: CompressionManager;

  // Layer 4: Learning
  private sonaEngine?: SonaEngine;

  // Layer 5: Orchestration
  private relayRace?: RelayRaceOrchestrator;
  // DAI-003: TinyDancer removed - routing now integrated via UniversalAgent
  private attentionFactory?: AttentionFactory;
  private phdPipeline?: PhdPipelineOrchestrator;
  private phdPipelineRunner?: PhDPipelineRunner;

  // Development Agent Execution (TASK-DEV-003)
  private agentExecutionService?: AgentExecutionService;
  private agentRegistry?: AgentRegistry;

  // Observability
  private metrics?: MetricsCollector;
  private logger?: Logger;
  private tracer?: DistributedTracer;

  // Platform
  private runtimeSelector: RuntimeSelector;
  private runtimeSelection?: RuntimeSelection;

  constructor(config: GodAgentConfig = {}) {
    this.config = config;
    this.runtimeSelector = new RuntimeSelector();
  }

  /**
   * Initialize all God Agent subsystems
   */
  async initialize(): Promise<GodAgentInitResult> {
    const initStart = performance.now();
    const warnings: string[] = [];
    const components = {
      vectorDB: false,
      graphDB: false,
      memory: false,
      reasoning: false,
      learning: false,
      orchestration: false,
      routing: false,
      compression: false,
      attention: false,
      observability: false,
    };

    try {
      // Select runtime
      this.runtimeSelection = await this.runtimeSelector.selectRuntime();
      if (this.runtimeSelection.warnings.length > 0) {
        warnings.push(...this.runtimeSelection.warnings);
      }

      this.log('Initializing God Agent...');
      this.log(`Runtime: ${this.runtimeSelection.type} (${this.runtimeSelection.performance})`);

      // Initialize observability first (if enabled)
      if (this.config.enableObservability !== false) {
        this.initializeObservability();
        components.observability = true;
      }

      // Layer 1: Native Core
      await this.initializeNativeCore();
      components.vectorDB = true;
      components.graphDB = true;

      // Layer 2: Reasoning
      await this.initializeReasoning();
      components.reasoning = true;

      // Layer 3: Memory
      await this.initializeMemory();
      components.memory = true;

      // Layer 4: Learning
      await this.initializeLearning();
      components.learning = true;

      // Layer 5: Orchestration
      await this.initializeOrchestration();
      components.orchestration = true;
      components.routing = true;
      components.compression = true;
      components.attention = true;

      // TASK-SEARCH-006: Initialize Unified Search
      await this.initializeUnifiedSearch();

      this.initialized = true;
      this.startTime = Date.now();

      const initTimeMs = performance.now() - initStart;
      this.log(`God Agent initialized in ${initTimeMs.toFixed(2)}ms`);

      return {
        success: true,
        runtime: this.runtimeSelection,
        initTimeMs,
        components,
        warnings,
      };
    } catch (error) {
      const initTimeMs = performance.now() - initStart;
      warnings.push(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);

      return {
        success: false,
        runtime: this.runtimeSelection!,
        initTimeMs,
        components,
        warnings,
      };
    }
  }

  /**
   * Initialize Layer 1: Native Core
   */
  private async initializeNativeCore(): Promise<void> {
    this.log('Initializing Layer 1: Native Core');

    // VectorDB
    this.vectorDB = new VectorDB({
      dimension: 1536,
      metric: DistanceMetric.COSINE,
      hnswM: 32,
      hnswEfConstruction: 200,
      hnswEfSearch: 50,
      ...this.config.vectorDB,
    });
    // Initialize VectorDB to ensure backend is available
    await this.vectorDB.initialize();

    // TASK-SEARCH-006: Create FallbackGraph separately for sharing with UnifiedSearch
    this.fallbackGraph = new FallbackGraph(
      this.config.graphDB?.dataDir ?? '.agentdb/graphs',
      this.config.graphDB?.lockTimeout ?? 5000,
      this.config.graphDB?.enablePersistence ?? true
    );

    // GraphDB - use shared FallbackGraph backend
    this.graphDB = new GraphDB(this.fallbackGraph, this.config.graphDB);
  }

  /**
   * Initialize Layer 2: Reasoning
   */
  private async initializeReasoning(): Promise<void> {
    this.log('Initializing Layer 2: Reasoning');

    // ProvenanceStore - initialize with simple config
    this.provenanceStore = new ProvenanceStore({
      ...this.config.reasoning,
    } as any);

    // PatternMatcher - requires vectorDB and memoryEngine (will be created in initializeMemory)
    // Temporarily create with placeholder, will reinitialize after memoryEngine exists
    this.patternMatcher = null as any;

    // CausalMemory - requires memoryEngine, will be created in initializeMemory
    this.causalMemory = null as any;

    // ReasoningBank - defer until all dependencies ready
    this.reasoningBank = null as any;
  }

  /**
   * Initialize Layer 3: Memory
   */
  private async initializeMemory(): Promise<void> {
    this.log('Initializing Layer 3: Memory');

    // CompressionManager
    this.compressionManager = new CompressionManager({
      ...this.config.compression,
    } as any);

    // MemoryEngine (integrates VectorDB, GraphDB, requires embeddingProvider)
    // Use real embedding provider from SPEC-EMB-001 (LocalEmbeddingProvider with all-mpnet-base-v2)
    const embeddingProvider = await EmbeddingProviderFactory.getProvider();

    this.memoryEngine = new MemoryEngine(
      this.vectorDB!,
      this.graphDB!,
      embeddingProvider,
      10000
    );

    // Now initialize PatternMatcher with memoryEngine
    this.patternMatcher = new PatternMatcher(this.vectorDB!, this.memoryEngine);
    // Initialize PatternMatcher (loads patterns from storage)
    await this.patternMatcher.initialize();

    // Initialize CausalMemory with memoryEngine (now that it exists)
    this.causalMemory = new CausalMemory(this.memoryEngine, {
      ...this.config.reasoning,
    } as any);
    // Initialize CausalMemory (loads graph from storage)
    await this.causalMemory.initialize();

    // Initialize ReasoningBank with all dependencies
    this.reasoningBank = new ReasoningBank({
      patternMatcher: this.patternMatcher,
      causalMemory: this.causalMemory,
      vectorDB: this.vectorDB!, // Required for contextual/causal reasoning
      provenanceStore: this.provenanceStore,
      ...this.config.reasoning,
    } as any);
  }

  /**
   * Initialize Layer 4: Learning
   */
  private async initializeLearning(): Promise<void> {
    this.log('Initializing Layer 4: Learning');

    // TASK-PERSIST-009: Check persistence requirement
    // Default to true in production, can be overridden for testing
    const requirePersistence = process.env.SONA_REQUIRE_PERSISTENCE !== 'false';

    // TASK-PERSIST-009: Use createProductionSonaEngine for persistence-enabled engine
    if (requirePersistence) {
      try {
        this.sonaEngine = createProductionSonaEngine({
          learningRate: 0.001,
          ...this.config.learning,
        });
        this.log('SonaEngine created with database persistence enabled');
      } catch (error) {
        // If database connection fails, fall back to in-memory with warning
        console.warn('[GodAgent] Failed to create SonaEngine with persistence:', error);
        console.warn('[GodAgent] Falling back to in-memory SonaEngine (learning data will NOT persist)');
        this.sonaEngine = new SonaEngine({
          learningRate: 0.001,
          ...this.config.learning,
        } as any);
      }
    } else {
      // Testing mode: use in-memory SonaEngine
      this.sonaEngine = new SonaEngine({
        learningRate: 0.001,
        ...this.config.learning,
      } as any);
      this.log('SonaEngine created in testing mode (SONA_REQUIRE_PERSISTENCE=false)');
    }

    // TASK-PERSIST-009: Verify persistence status after creation
    if (this.sonaEngine.isPersistenceEnabled()) {
      const dbStats = this.sonaEngine.getDatabaseStats();
      if (dbStats) {
        this.log(`SonaEngine persistence verified - DAOs initialized`);
        this.log(`  Trajectory metadata: ${JSON.stringify(dbStats.trajectoryMetadata)}`);
        this.log(`  Patterns: ${JSON.stringify(dbStats.patterns)}`);
        this.log(`  Feedback: ${JSON.stringify(dbStats.feedback)}`);
      }
    } else {
      console.warn('[GodAgent] WARNING: SonaEngine persistence is DISABLED - learning data will NOT be saved to database');
      console.warn('[GodAgent] Set SONA_REQUIRE_PERSISTENCE=true and ensure database connection for production use');
    }

    // Enable trajectory streaming to disk (SPEC-TRJ-001)
    // FIX: Added enabled: true to actually enable streaming
    await this.sonaEngine.enableStreaming({
      enabled: true,  // FIX: Was defaulting to false
      storageDir: '.agentdb/sona/trajectories',
      memoryWindowSize: 1000,
      batchWriteSize: 10,
      batchWriteIntervalMs: 5000,
      compressionEnabled: true,
    });

    // Load existing weights if available
    try {
      await this.sonaEngine.loadWeights('.agentdb/sona/sona_weights.bin');
      this.log('Loaded SoNA weights from disk');
    } catch {
      // INTENTIONAL: No existing SoNA weights - start fresh is valid for first run
      this.log('No existing SoNA weights found, starting fresh');
    }

    // Inject SonaEngine into ReasoningBank for feedback loop
    if (this.reasoningBank) {
      this.reasoningBank.setSonaEngine(this.sonaEngine);
      // Initialize ReasoningBank now that all dependencies are ready
      await this.reasoningBank.initialize();
    }
  }

  /**
   * Initialize Layer 5: Orchestration
   */
  private async initializeOrchestration(): Promise<void> {
    this.log('Initializing Layer 5: Orchestration');

    // AttentionFactory
    this.attentionFactory = new AttentionFactory({
      ...this.config.attention,
    } as any);

    // DAI-003: TinyDancer removed - intelligent routing integrated via UniversalAgent
    // The new routing system (TASK-012) will be initialized in UniversalAgent

    // RelayRace Orchestrator
    this.relayRace = new RelayRaceOrchestrator({
      ...this.config.orchestration,
    } as any);

    // PhD Pipeline
    this.phdPipeline = new PhdPipelineOrchestrator({
      relayRace: this.relayRace,
      attentionFactory: this.attentionFactory,
      memoryEngine: this.memoryEngine!,
      ...this.config.pipeline,
    });
  }

  /**
   * TASK-SEARCH-006: Initialize Unified Search
   * Integrates quad-fusion search across vector, graph, memory, and pattern sources
   */
  private async initializeUnifiedSearch(): Promise<void> {
    this.log('Initializing Unified Search');

    // Create MemoryClient for search integration
    this.memoryClient = new MemoryClient('.agentdb', {
      autoStart: false, // Don't auto-start daemon during search init
      verbose: this.config.verbose,
    });

    // Try to connect to memory server (graceful degradation if unavailable)
    try {
      await this.memoryClient.connect();
      this.log('MemoryClient connected for search');
    } catch {
      // INTENTIONAL: MemoryClient server not running - graceful degradation for search
      this.log('MemoryClient connection skipped (server not running)');
    }

    // Create UnifiedSearch with all components
    // Uses VectorDB backend, FallbackGraph, MemoryClient, and ReasoningBank
    this.unifiedSearch = new UnifiedSearch(
      this.vectorDB!.backend_ as any, // IHNSWBackend implements NativeHNSW interface
      this.fallbackGraph!,
      this.memoryClient,
      this.reasoningBank!,
      undefined, // GNNEnhancer - can be added later if needed
      this.config.searchOptions
    );

    this.log('UnifiedSearch initialized');
  }

  /**
   * Initialize observability components
   */
  private initializeObservability(): void {
    this.log('Initializing Observability');

    this.logger = new Logger({
      minLevel: (this.config.verbose ? 'debug' : 'info') as any,
    });

    this.metrics = new MetricsCollector();

    this.tracer = new DistributedTracer({
      samplingRate: 0.1,
    });
  }

  /**
   * Store knowledge in God Agent
   */
  async store(
    data: { content: unknown; embedding: Float32Array; metadata?: Record<string, unknown> },
    options: StoreOptions = {}
  ): Promise<StoreResult> {
    this.ensureInitialized();

    const span = this.tracer?.startTrace('god_agent.store');

    try {
      // Generate unique ID for this entry
      const id = `entry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      // Store embedding in VectorDB
      const vectorId = await this.vectorDB!.insert(data.embedding);

      // Track provenance if enabled
      if (
        options.trackProvenance !== false &&
        this.provenanceStore &&
        typeof (this.provenanceStore as any).track === 'function'
      ) {
        await (this.provenanceStore as any).track({
          operation: 'store',
          entityId: id,
          timestamp: Date.now(),
          metadata: data.metadata,
        });
      }

      // Record metric (optional)
      // Histogram recording would go here if metrics are configured

      return {
        id,
        vectorId,
        graphNodeId: '', // Graph integration optional
        timestamp: Date.now(),
        compressed: false,
      };
    } finally {
      span?.finish();
    }
  }

  /**
   * Query knowledge from God Agent
   */
  async query(
    embedding: Float32Array,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    this.ensureInitialized();

    const startTime = performance.now();
    const queryId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const span = this.tracer?.startTrace('god_agent.query');

    try {
      const k = options.k ?? 10;
      const minSimilarity = options.minSimilarity ?? 0.0;

      // Default reasoning mode
      let reasoningMode = 'pattern_match';

      // Query VectorDB directly for pattern matching
      const vectorResults = await this.vectorDB!.search(embedding, k);

      // Convert results to pattern format
      const patterns = vectorResults
        .filter(r => r.similarity >= minSimilarity)
        .map((r, idx) => ({
          id: `pattern_${idx}_${r.id}`,
          content: r.vector ? Array.from(r.vector) : [],
          similarity: r.similarity,
          confidence: r.similarity,
          provenance: undefined,
          causalContext: undefined,
        }));

      const latencyMs = performance.now() - startTime;

      return {
        queryId,
        patterns,
        latencyMs,
        reasoningMode,
        attentionMechanism: undefined,
      };
    } finally {
      span?.finish();
    }
  }

  /**
   * Learn from feedback
   */
  async learn(feedback: {
    queryId: string;
    patternId: string;
    verdict: 'positive' | 'negative' | 'neutral';
    score?: number;
  }): Promise<void> {
    this.ensureInitialized();

    // Record feedback if SonaEngine supports it
    if (this.sonaEngine && typeof (this.sonaEngine as any).recordFeedback === 'function') {
      await (this.sonaEngine as any).recordFeedback({
        queryId: feedback.queryId,
        patternId: feedback.patternId,
        verdict: feedback.verdict,
        score: feedback.score ?? (feedback.verdict === 'positive' ? 1 : feedback.verdict === 'negative' ? -1 : 0),
      });
    }
    // Feedback recorded successfully (or no-op if not supported)
  }


  // =========================================================================
  // TASK-SEARCH-006: Unified Search Methods
  // =========================================================================

  /**
   * Search across all sources using quad-fusion search
   *
   * @param query - Natural language search query
   * @param options - Optional search configuration overrides
   * @returns QuadFusionResult with ranked results from all sources
   * @throws Error if GodAgent not initialized
   */
  async search(
    query: string,
    options?: Partial<QuadFusionOptions>
  ): Promise<QuadFusionResult> {
    this.ensureInitialized();

    if (!this.unifiedSearch) {
      throw new Error('UnifiedSearch not initialized');
    }

    this.log(`Searching: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);

    const result = await this.unifiedSearch.search(query, undefined, options);

    this.log(`Search returned ${result.results.length} results in ${result.metadata.totalDurationMs.toFixed(1)}ms`);

    return result;
  }

  /**
   * Search with pre-computed embedding for vector similarity
   *
   * @param query - Natural language search query (for context)
   * @param embedding - Pre-computed 1536-dimensional embedding vector
   * @param options - Optional search configuration overrides
   * @returns QuadFusionResult with ranked results from all sources
   * @throws Error if GodAgent not initialized or embedding dimension invalid
   */
  async searchWithEmbedding(
    query: string,
    embedding: Float32Array,
    options?: Partial<QuadFusionOptions>
  ): Promise<QuadFusionResult> {
    this.ensureInitialized();

    if (!this.unifiedSearch) {
      throw new Error('UnifiedSearch not initialized');
    }

    // Validate embedding dimension (1536 for text-embedding-3-large)
    if (embedding.length !== 1536) {
      throw new Error(`Invalid embedding dimension: expected 1536, got ${embedding.length}`);
    }

    this.log(`Searching with embedding: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);

    const result = await this.unifiedSearch.search(query, embedding, options);

    this.log(`Embedding search returned ${result.results.length} results in ${result.metadata.totalDurationMs.toFixed(1)}ms`);

    return result;
  }

  /**
   * Update search source weights for result ranking
   *
   * @param weights - Partial weights to update (vector, graph, memory, pattern)
   */
  updateSearchWeights(weights: Partial<SourceWeights>): void {
    this.ensureInitialized();

    if (!this.unifiedSearch) {
      throw new Error('UnifiedSearch not initialized');
    }

    this.log(`Updating search weights: ${JSON.stringify(weights)}`);

    this.unifiedSearch.updateWeights(weights);
  }

  /**
   * Get current search configuration
   *
   * @returns Current QuadFusionOptions or undefined if not initialized
   */
  getSearchOptions(): QuadFusionOptions | undefined {
    if (!this.unifiedSearch) {
      return undefined;
    }

    return this.unifiedSearch.getOptions();
  }

  /**
   * Run PhD pipeline with real RelayRaceOrchestrator execution
   * Replaces the placeholder with actual agent orchestration
   */
  async runPipeline(task: {
    pipelineName: string;
    input: unknown;
    maxAgents?: number;
  }): Promise<{
    success: boolean;
    output: unknown;
    agentsUsed: number;
    completionRate: number;
    executionTimeMs: number;
  }> {
    this.ensureInitialized();

    const span = this.tracer?.startTrace('god_agent.run_pipeline');
    const startTime = Date.now();

    try {
      // Ensure AgentRegistry is initialized
      if (!this.agentRegistry) {
        throw new Error(
          'AgentRegistry not initialized. Call initializeAgentExecution() before using runPipeline().'
        );
      }

      // Build pipeline definition from task
      const pipelineDefinition = await this.buildPipelineDefinition(task);

      // Create executor with real CLI execution
      const executor = new ClaudeTaskExecutor(this.agentRegistry, {
        workingDirectory: process.cwd(),
        timeout: 120000,
        enableHooks: true,
        verbose: this.config.verbose,
        executionMode: 'live',
      });

      // Create orchestrator with RelayRace
      const orchestrator = new RelayRaceOrchestrator(executor, {
        verbose: this.config.verbose,
        namespace: 'god-agent/pipeline',
        agentTimeout: 120000,
        trackTrajectories: true,
      });

      // Set memory engine if available
      if (this.memoryEngine) {
        orchestrator.setMemoryEngine({
          store: async (key: string, content: string, opts?: { namespace?: string; metadata?: Record<string, unknown> }) => {
            await this.memoryEngine!.store(key, content, {
              namespace: opts?.namespace ?? 'god-agent/pipeline',
            });
          },
          retrieve: async (key: string, opts?: { namespace?: string }) => {
            return await this.memoryEngine!.retrieve(key, {
              namespace: opts?.namespace,
            });
          },
        });
      }

      // Set SonaEngine if available for trajectory tracking
      if (this.sonaEngine) {
        orchestrator.setSonaEngine({
          createTrajectory: (_route: string, _patterns: string[], _context: string[]) => {
            // Generate trajectory ID
            return `trj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          },
          provideFeedback: async (trajectoryId: string, quality: number, options?: Record<string, unknown>) => {
            // Record feedback if sonaEngine supports it
            if (typeof (this.sonaEngine as any).recordFeedback === 'function') {
              await (this.sonaEngine as any).recordFeedback({
                trajectoryId,
                quality,
                ...options,
              });
            }
          },
        });
      }

      // Execute pipeline
      const execution = await orchestrator.runPipeline(pipelineDefinition);

      // Calculate metrics from real execution
      const totalAgents = pipelineDefinition.agents.length;
      const completedAgents = Array.from(execution.agentResults.values())
        .filter(r => r.success).length;
      const executionTimeMs = Date.now() - startTime;

      // Build output from agent results
      const output: Record<string, unknown> = {};
      for (const [name, result] of execution.agentResults) {
        output[name] = {
          output: result.output,
          duration: result.duration,
          success: result.success,
        };
      }

      // Store pipeline results in memory for learning
      await this.storeKnowledgeIfAvailable({
        content: JSON.stringify({
          pipelineName: task.pipelineName,
          success: execution.status === 'completed',
          agentsUsed: completedAgents,
          completionRate: totalAgents > 0 ? completedAgents / totalAgents : 0,
        }),
        category: 'pipeline-result',
        domain: 'pipelines',
        tags: ['result', task.pipelineName],
      });

      span?.finish();

      return {
        success: execution.status === 'completed',
        output,
        agentsUsed: execution.agentResults.size,
        completionRate: totalAgents > 0 ? completedAgents / totalAgents : 0,
        executionTimeMs,
      };

    } catch (error) {
      span?.setError(error instanceof Error ? error : new Error(String(error)));
      span?.finish();

      const executionTimeMs = Date.now() - startTime;

      this.log('Pipeline execution failed:', error instanceof Error ? error.message : String(error));

      return {
        success: false,
        output: { error: error instanceof Error ? error.message : String(error) },
        agentsUsed: 0,
        completionRate: 0,
        executionTimeMs,
      };
    }
  }

  /**
   * Build pipeline definition from task
   * Creates a default pipeline with research → implementation → testing → review
   */
  private async buildPipelineDefinition(task: {
    pipelineName: string;
    input: unknown;
    maxAgents?: number;
  }): Promise<IPipelineDefinition> {
    const maxAgents = task.maxAgents ?? 5;

    // Default pipeline phases
    const defaultPipeline = [
      { type: 'researcher', phase: 'research', task: `Analyze requirements for: ${task.pipelineName}` },
      { type: 'coder', phase: 'implementation', task: `Implement solution for: ${task.pipelineName}` },
      { type: 'tester', phase: 'testing', task: `Test implementation of: ${task.pipelineName}` },
      { type: 'reviewer', phase: 'review', task: `Review implementation of: ${task.pipelineName}` },
    ];

    // Select agents based on maxAgents
    const selectedAgents = defaultPipeline.slice(0, maxAgents);
    const agents: IAgentDefinition[] = [];

    for (let i = 0; i < selectedAgents.length; i++) {
      const agentConfig = selectedAgents[i];
      agents.push({
        agentName: `${agentConfig.type}-${i + 1}`,
        position: `Agent #${i + 1}/${selectedAgents.length}`,
        phase: agentConfig.phase,
        previousKey: i > 0 ? `pipeline/${task.pipelineName}/agent-${i}` : null,
        outputKey: `pipeline/${task.pipelineName}/agent-${i + 1}`,
        task: agentConfig.task,
        qualityGate: 'Task completion verified',
        agentType: agentConfig.type,
      });
    }

    return {
      name: task.pipelineName,
      description: `Pipeline execution for ${task.pipelineName}`,
      agents,
      sequential: true,
    };
  }

  /**
   * Helper to store knowledge if InteractionStore is available
   */
  private async storeKnowledgeIfAvailable(data: {
    content: string;
    category: string;
    domain: string;
    tags: string[];
  }): Promise<void> {
    // Store in memory engine if available
    if (this.memoryEngine) {
      const key = `knowledge/${data.domain}/${data.category}/${Date.now()}`;
      await this.memoryEngine.store(key, data.content, {
        namespace: 'god-agent/knowledge',
      });
    }
  }

  /**
   * Get God Agent status
   */
  getStatus(): GodAgentStatus {
    return {
      initialized: this.initialized,
      runtime: this.runtimeSelection?.type ?? 'javascript',
      memory: {
        vectorCount: 0, // Use getVectorCount() for async count
        graphNodeCount: 0, // Use getGraphNodeCount() for async count
        cacheHitRate: 0, // LRUCache doesn't expose hitRate
      },
      health: {
        vectorDB: this.vectorDB ? 'healthy' : 'down',
        graphDB: this.graphDB ? 'healthy' : 'down',
        memory: this.memoryEngine ? 'healthy' : 'down',
        reasoning: this.reasoningBank ? 'healthy' : 'down',
        learning: this.sonaEngine ? 'healthy' : 'down',
      },
      uptimeMs: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Get metrics snapshot
   */
  getMetrics(): Record<string, unknown> {
    return this.metrics?.getSnapshot() ?? {};
  }

  // ==================== PhD Pipeline Runner ====================

  /**
   * Initialize the PhD Pipeline Runner
   * Wires AgentRegistry, ClaudeTaskExecutor, PhDPipelineBridge, and PhDLearningIntegration
   *
   * @param agentsBasePath - Path to agent definitions (default: '.claude/agents')
   * @param options - Additional runner options
   */
  async initializePhdPipeline(
    agentsBasePath = '.claude/agents',
    options: Partial<Omit<IPhDPipelineRunnerOptions, 'agentsBasePath'>> = {}
  ): Promise<void> {
    this.ensureInitialized();

    this.log('Initializing PhD Pipeline Runner...');

    // Create memory engine adapter for runner
    // Adapter: IMemoryEngine (simple) -> MemoryEngine (full)
    // IMemoryEngine: store(key, content, {namespace?}) / retrieve(key, {namespace?}) -> string | null
    // MemoryEngine:  store(key, value, {namespace}) / retrieve(key, {namespace?}) -> string | null
    const memoryEngineAdapter = this.memoryEngine
      ? {
        store: async (
          key: string,
          content: string,
          opts?: { namespace?: string; metadata?: Record<string, unknown> }
        ) => {
          await this.memoryEngine!.store(key, content, {
            namespace: opts?.namespace ?? 'phd-pipeline',
          });
        },
        retrieve: async (key: string, opts?: { namespace?: string }) => {
          const result = await this.memoryEngine!.retrieve(key, {
            namespace: opts?.namespace,
          });
          return result;
        },
      }
      : undefined;

    this.phdPipelineRunner = new PhDPipelineRunner({
      agentsBasePath,
      sonaEngine: this.sonaEngine,
      memoryEngine: memoryEngineAdapter,
      reasoningBank: this.reasoningBank,
      verbose: this.config.verbose,
      ...options,
    });

    await this.phdPipelineRunner.initialize();
    this.log('PhD Pipeline Runner initialized');
  }

  /**
   * Run PhD research pipeline
   * Executes the full 48-agent PhD research pipeline
   *
   * @param problemStatement - Research problem to investigate
   * @returns Pipeline execution result
   */
  async runPhdResearch(problemStatement: string): Promise<IRunResult> {
    if (!this.phdPipelineRunner) {
      throw new Error(
        'PhD Pipeline Runner not initialized. Call initializePhdPipeline() first.'
      );
    }

    this.log(`Starting PhD research: ${problemStatement.substring(0, 50)}...`);
    return this.phdPipelineRunner.run(problemStatement);
  }


  // ==================== Development Agent API (SPEC-DEV-001) ====================

  /**
   * Initialize the Agent Execution Service
   * Must be called before using runAgent, listAgents, etc.
   *
   * @param agentsBasePath - Base path to agent definitions (default: '.claude/agents')
   */
  async initializeAgentExecution(agentsBasePath = '.claude/agents'): Promise<void> {
    this.ensureInitialized();

    this.log('Initializing Agent Execution Service...');

    // Create agent registry (createAgentRegistry is async and already initializes)
    this.agentRegistry = await createAgentRegistry(agentsBasePath, {
      verbose: this.config.verbose ?? false,
    });

    this.log(`Loaded ${this.agentRegistry.size} agents from ${this.agentRegistry.getCategoryNames().length} categories`);

    // Create executor (ClaudeTaskExecutor requires AgentRegistry as first arg)
    const executor = new ClaudeTaskExecutor(this.agentRegistry, {
      verbose: this.config.verbose ?? false,
    });

    // Create memory engine adapter matching IMemoryEngine interface
    const memoryEngineAdapter = this.memoryEngine
      ? {
        store: async (
          key: string,
          content: string,
          opts?: { namespace?: string; metadata?: Record<string, unknown> }
        ) => {
          await this.memoryEngine!.store(key, content, {
            namespace: opts?.namespace ?? 'agents',
          });
        },
        retrieve: async (key: string, opts?: { namespace?: string }) => {
          const result = await this.memoryEngine!.retrieve(key, {
            namespace: opts?.namespace,
          });
          return result;
        },
      }
      : undefined;

    // Create service
    this.agentExecutionService = createAgentExecutionService(
      this.agentRegistry,
      executor,
      { verbose: this.config.verbose ?? false },
      this.sonaEngine,
      memoryEngineAdapter
    );

    this.log('Agent Execution Service initialized');
  }

  /**
   * Execute a single agent with a task
   *
   * @param agentKey - Agent key (e.g., 'coder', 'tester', 'reviewer')
   * @param task - Task description
   * @param options - Execution options
   * @returns Execution result
   *
   * @example
   * ```typescript
   * const result = await agent.runAgent('coder', 'Create a user authentication module', {
   *   namespace: 'project/auth',
   *   trackTrajectory: true
   * });
   * console.log(result.success ? result.output : `Error: ${result.error}`);
   * ```
   */
  async runAgent(
    agentKey: string,
    task: string,
    options?: IAgentExecutionOptions
  ): Promise<IAgentExecutionResult> {
    if (!this.agentExecutionService) {
      throw new Error(
        'Agent Execution Service not initialized. Call initializeAgentExecution() first.'
      );
    }

    this.log(`Running agent: ${agentKey}`);
    return this.agentExecutionService.executeAgent(agentKey, task, options);
  }

  /**
   * List available agents with optional filtering
   *
   * @param filter - Filter options (category, capability, priority, namePattern)
   * @returns Array of agent info
   *
   * @example
   * ```typescript
   * // All agents
   * const all = agent.listAgents();
   *
   * // Filter by category
   * const coreAgents = agent.listAgents({ category: 'core' });
   *
   * // Filter by capability
   * const testingAgents = agent.listAgents({ capability: 'unit_testing' });
   * ```
   */
  listAgents(filter?: IAgentFilter): IAgentInfo[] {
    if (!this.agentExecutionService) {
      throw new Error(
        'Agent Execution Service not initialized. Call initializeAgentExecution() first.'
      );
    }

    return this.agentExecutionService.listAgents(filter);
  }

  /**
   * Get detailed info about a specific agent
   *
   * @param agentKey - Agent key (e.g., 'coder', 'tester')
   * @returns Agent info or null if not found
   *
   * @example
   * ```typescript
   * const info = agent.getAgentInfo('coder');
   * console.log(info?.name, info?.description, info?.capabilities);
   * ```
   */
  getAgentInfo(agentKey: string): IAgentInfo | null {
    if (!this.agentExecutionService) {
      throw new Error(
        'Agent Execution Service not initialized. Call initializeAgentExecution() first.'
      );
    }

    return this.agentExecutionService.getAgentInfo(agentKey);
  }

  /**
   * Execute a chain of agents sequentially
   *
   * @param steps - Array of agent steps to execute
   * @param options - Chain-level options
   * @returns Chain execution result
   *
   * @example
   * ```typescript
   * const result = await agent.runAgentChain([
   *   { agent: 'planner', task: 'Plan implementation of user service' },
   *   { agent: 'coder', task: 'Implement based on plan' },
   *   { agent: 'tester', task: 'Write comprehensive tests' },
   *   { agent: 'reviewer', task: 'Review code quality and security' }
   * ], {
   *   namespace: 'project/user-service',
   *   trackTrajectory: true
   * });
   *
   * console.log(`Chain completed: ${result.steps.length} steps, ${result.duration}ms`);
   * ```
   */
  async runAgentChain(
    steps: IAgentChainStep[],
    options?: IAgentExecutionOptions
  ): Promise<IAgentChainResult> {
    if (!this.agentExecutionService) {
      throw new Error(
        'Agent Execution Service not initialized. Call initializeAgentExecution() first.'
      );
    }

    this.log(`Running agent chain with ${steps.length} steps`);
    return this.agentExecutionService.executeChain(steps, options);
  }

  /**
   * Get agent categories
   * @returns Array of category names
   */
  getAgentCategories(): string[] {
    if (!this.agentExecutionService) {
      throw new Error(
        'Agent Execution Service not initialized. Call initializeAgentExecution() first.'
      );
    }

    return this.agentExecutionService.getCategories();
  }

  /**
   * Get total agent count
   * @returns Number of loaded agents
   */
  getAgentCount(): number {
    if (!this.agentExecutionService) {
      throw new Error(
        'Agent Execution Service not initialized. Call initializeAgentExecution() first.'
      );
    }

    return this.agentExecutionService.getAgentCount();
  }

  /**
   * Get PhD Pipeline Runner instance
   */
  getPhdPipelineRunner(): PhDPipelineRunner | undefined {
    return this.phdPipelineRunner;
  }

  // ==================== Lifecycle ====================

  /**
   * Shutdown God Agent
   */
  async shutdown(): Promise<void> {
    this.log('Shutting down God Agent...');

    // TASK-GNN-009: Force training before shutdown
    // Ensures any pending feedback trajectories are trained
    const trainingTrigger = this.reasoningBank?.getTrainingTrigger();
    if (trainingTrigger) {
      try {
        this.log('Forcing final GNN training before shutdown...');
        const result = await trainingTrigger.forceTraining();
        if (result.triggered) {
          this.log(`Final training completed: ${result.epochResults?.length ?? 0} epochs, loss: ${result.finalLoss?.toFixed(6)}`);
        } else {
          this.log(`Final training skipped: ${result.reason}`);
        }
        // Clean up training trigger
        trainingTrigger.destroy();
      } catch (error) {
        console.error('[GodAgent] Failed to complete final training:', error);
      }
    }

    // Save SoNA weights before shutdown
    if (this.sonaEngine) {
      try {
        await this.sonaEngine.saveWeights('.agentdb/sona/sona_weights.bin');
        this.log('SoNA weights saved to disk');
      } catch (error) {
        console.error('[GodAgent] Failed to save SoNA weights:', error);
      }
    }

    // Flush metrics
    await this.metrics?.flush();

    // Close connections
    await this.memoryEngine?.close();

    // TASK-SEARCH-006: Disconnect MemoryClient
    if (this.memoryClient) {
      try {
        await this.memoryClient.disconnect();
        this.log('MemoryClient disconnected');
      } catch {
        // Ignore disconnect errors during shutdown
      }
    }

    this.initialized = false;
    this.log('God Agent shutdown complete');
  }

  /**
   * Ensure God Agent is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('God Agent not initialized. Call initialize() first.');
    }
  }

  /**
   * Conditional logging
   */
  private log(...args: unknown[]): void {
    if (this.config.verbose) {
      console.log('[GodAgent]', ...args);
    }
    this.logger?.info(args.join(' '));
  }

  // ==================== Component Accessors ====================

  /** Get VectorDB instance */
  getVectorDB(): VectorDB | undefined {
    return this.vectorDB;
  }

  /** Get GraphDB instance */
  getGraphDB(): GraphDB | undefined {
    return this.graphDB;
  }

  /** Get MemoryEngine instance */
  getMemoryEngine(): MemoryEngine | undefined {
    return this.memoryEngine;
  }

  /** Get ReasoningBank instance */
  getReasoningBank(): ReasoningBank | undefined {
    return this.reasoningBank;
  }

  /**
   * Get SonaEngine instance for learning integration
   */
  getSonaEngine(): SonaEngine | undefined {
    return this.sonaEngine;
  }

  /** Get PatternMatcher instance for pattern retrieval */
  getPatternMatcher(): PatternMatcher | undefined {
    return this.patternMatcher;
  }

  /**
   * @deprecated DAI-003: TinyDancer removed. Use UniversalAgent.task() for intelligent routing.
   * This method is preserved for API compatibility but returns undefined.
   */
  getTinyDancer(): undefined {
    return undefined;
  }

  /** Get AttentionFactory instance */
  getAttentionFactory(): AttentionFactory | undefined {
    return this.attentionFactory;
  }

  /** Get CompressionManager instance */
  getCompressionManager(): CompressionManager | undefined {
    return this.compressionManager;
  }

  /** Get PhdPipelineOrchestrator instance */
  getPhdPipeline(): PhdPipelineOrchestrator | undefined {
    return this.phdPipeline;
  }

  /** Get RelayRaceOrchestrator instance */
  getRelayRace(): RelayRaceOrchestrator | undefined {
    return this.relayRace;
  }
}

// ==================== Global Instance ====================

/**
 * Default God Agent instance
 */
export const godAgent = new GodAgent();
