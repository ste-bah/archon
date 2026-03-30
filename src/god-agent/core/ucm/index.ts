/**
 * Universal Context Management (UCM) System
 * Main Module Entry Point
 *
 * Provides token management, context composition, DESC episodic memory,
 * compaction recovery, and workflow adaptation for Claude Code/God Agent.
 *
 * @module ucm
 */

// ============================================================================
// Core Types & Configuration
// ============================================================================

export * from './types.js';
export * from './errors.js';
export {
  loadConfig,
  loadAndValidateConfig,
  loadConfigWithEnv,
  validateConfig,
  getEnvOverrides,
  DEFAULT_UCM_CONFIG,
  DEFAULT_TOKEN_DEFAULTS,
  DEFAULT_SUMMARIZATION_CONFIG,
  DEFAULT_PROGRESSIVE_CONFIG,
  DEFAULT_CHUNKING_CONFIG,
  DEFAULT_BREAK_PATTERNS,
  PROTECTED_PATTERNS
} from './config.js';

// ============================================================================
// Token Estimation Services
// ============================================================================

export {
  WordCounter,
  ContentClassifier,
  TokenEstimationService,
  TokenBudgetManager,
  UsageTracker,
  SummarizationTrigger
} from './token/index.js';

// ============================================================================
// Workflow Adapters
// ============================================================================

export {
  AdapterRegistry,
  adapterRegistry,
  PhdPipelineAdapter,
  CodeReviewAdapter,
  GeneralTaskAdapter
} from './adapters/index.js';

// ============================================================================
// DESC (Dual Embedding Symmetric Chunking)
// ============================================================================

export {
  SymmetricChunker,
  DualEmbeddingStore,
  EpisodeRetriever,
  EmbeddingProxy
} from './desc/index.js';

// ============================================================================
// Recovery Services
// ============================================================================

export {
  CompactionDetector,
  MemoryReconstructor,
  TierBridge
} from './recovery/index.js';

// ============================================================================
// Context Composition
// ============================================================================

export {
  RollingWindow,
  DependencyTracker,
  PinningManager,
  ContextCompositionEngine
} from './context/index.js';

// ============================================================================
// Daemon Services
// ============================================================================

export {
  ContextService,
  DescService,
  RecoveryService,
  HealthService,
  DaemonServer
} from './daemon/index.js';

// ============================================================================
// Convenience Factory Functions
// ============================================================================

import { loadConfigWithEnv } from './config.js';
import { TokenEstimationService } from './token/index.js';
import { adapterRegistry } from './adapters/index.js';
import { SymmetricChunker, DualEmbeddingStore, EpisodeRetriever, EmbeddingProxy } from './desc/index.js';
import { CompactionDetector, MemoryReconstructor, TierBridge } from './recovery/index.js';
import { ContextCompositionEngine } from './context/index.js';
import { DaemonServer } from './daemon/index.js';
import type { IUniversalContextConfig, ITaskContext } from './types.js';

/**
 * Create a fully configured UCM instance
 */
export function createUCM(configOverrides?: Partial<IUniversalContextConfig>): UCMInstance {
  const config = loadConfigWithEnv(configOverrides);

  // Initialize components
  const tokenEstimator = new TokenEstimationService();
  const chunker = new SymmetricChunker(config.desc.chunkConfig);
  const embeddingProxy = new EmbeddingProxy({
    baseUrl: config.embedding.httpEndpoint.replace('/embed', ''),
    timeout: config.embedding.timeout
  });
  const episodeStore = new DualEmbeddingStore();
  const episodeRetriever = new EpisodeRetriever(episodeStore);
  const compactionDetector = new CompactionDetector();
  const tierBridge = new TierBridge();
  const contextEngine = new ContextCompositionEngine('general', config.tokenManagement.defaults.contextWindow);

  return {
    config,
    tokenEstimator,
    chunker,
    embeddingProxy,
    episodeStore,
    episodeRetriever,
    compactionDetector,
    tierBridge,
    contextEngine,
    adapterRegistry,

    /**
     * Detect workflow from task context
     */
    detectWorkflow(context: ITaskContext) {
      return adapterRegistry.detectAdapter(context);
    },

    /**
     * Estimate tokens for text
     */
    estimateTokens(text: string) {
      return tokenEstimator.estimate(text);
    },

    /**
     * Check for compaction
     */
    checkCompaction(message: string) {
      return compactionDetector.detectCompaction(message);
    }
  };
}

/**
 * UCM instance interface
 */
export interface UCMInstance {
  config: IUniversalContextConfig;
  tokenEstimator: TokenEstimationService;
  chunker: SymmetricChunker;
  embeddingProxy: EmbeddingProxy;
  episodeStore: DualEmbeddingStore;
  episodeRetriever: EpisodeRetriever;
  compactionDetector: CompactionDetector;
  tierBridge: TierBridge;
  contextEngine: ContextCompositionEngine;
  adapterRegistry: typeof adapterRegistry;
  detectWorkflow(context: ITaskContext): ReturnType<typeof adapterRegistry.detectAdapter>;
  estimateTokens(text: string): ReturnType<TokenEstimationService['estimate']>;
  checkCompaction(message: string): boolean;
}

/**
 * Start the UCM daemon server
 */
export async function startDaemon(configOverrides?: Partial<IUniversalContextConfig>): Promise<DaemonServer> {
  const config = loadConfigWithEnv(configOverrides);
  const daemon = new DaemonServer(config);
  await daemon.start();
  return daemon;
}

// ============================================================================
// Version & Metadata
// ============================================================================

export const UCM_VERSION = '1.0.0';
export const UCM_SPEC_ID = 'UCM-001';
