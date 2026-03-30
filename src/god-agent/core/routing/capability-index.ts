/**
 * DAI-003: Capability Index Implementation
 *
 * TASK-005: Capability Index
 * Constitution: RULE-DAI-003-004, INT-002
 *
 * Indexes agent capabilities for fast semantic search and domain matching.
 * Integrates with AgentRegistry for real-time synchronization.
 * Uses VectorDB for embedding-based capability search.
 *
 * Performance target: < 10s rebuild for 200 agents
 *
 * @module src/god-agent/core/routing/capability-index
 */

import type {
  ICapabilityIndex,
  IAgentCapability,
  ICapabilityMatch,
  TaskDomain,
} from './routing-types.js';
import { CapabilityIndexError, IndexSyncError } from './routing-errors.js';
import type { ILoadedAgentDefinition } from '../agents/index.js';
import { AgentRegistry } from '../agents/index.js';
import { VectorDB, DistanceMetric } from '../vector-db/index.js';
import { EmbeddingProviderFactory } from '../memory/embedding-provider.js';
import type { IEmbeddingProvider } from '../memory/types.js';
import { CapabilityIndexCache, ICachedEmbeddings } from './capability-cache.js';

// ==================== Configuration ====================

/**
 * Configuration for CapabilityIndex
 */
export interface ICapabilityIndexConfig {
  /** Path to agents directory (default: .claude/agents) */
  agentsPath?: string;

  /** Whether to use local embedding API (default: true) */
  useLocalEmbedding?: boolean;

  /** Freshness threshold in milliseconds (default: 24h) */
  freshnessThreshold?: number;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;

  /** Batch size for embedding requests (default: 10) */
  embeddingBatchSize?: number;

  /** Delay between batches in ms (default: 50) */
  embeddingBatchDelayMs?: number;
}

/**
 * Capability entry stored in index
 */
interface ICapabilityEntry {
  /** Agent capability definition */
  capability: IAgentCapability;

  /** Keywords for keyword-based matching */
  keywords: Set<string>;

  /** Domains for domain-based filtering */
  domains: Set<TaskDomain>;
}

// ==================== Capability Index Implementation ====================

/**
 * Capability index for semantic agent search
 * Indexes agent capabilities using vector embeddings and domain mapping
 *
 * @implements ICapabilityIndex
 */
export class CapabilityIndex implements ICapabilityIndex {
  private readonly config: Required<ICapabilityIndexConfig>;
  private readonly agentRegistry: AgentRegistry;
  private readonly vectorDB: VectorDB;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private readonly cache: CapabilityIndexCache;

  // Index state
  private capabilities: Map<string, ICapabilityEntry> = new Map();
  private lastSyncTime: number = 0;
  private initialized: boolean = false;

  constructor(config: ICapabilityIndexConfig = {}) {
    this.config = {
      agentsPath: config.agentsPath ?? '.claude/agents',
      useLocalEmbedding: config.useLocalEmbedding ?? true,
      freshnessThreshold: config.freshnessThreshold ?? 24 * 60 * 60 * 1000, // 24h
      verbose: config.verbose ?? false,
      embeddingBatchSize: config.embeddingBatchSize ?? 10,
      embeddingBatchDelayMs: config.embeddingBatchDelayMs ?? 50,
    };

    // Create agent registry
    this.agentRegistry = new AgentRegistry({
      basePath: this.config.agentsPath,
      verbose: this.config.verbose,
    });

    // Create vector DB for capability embeddings
    this.vectorDB = new VectorDB({
      dimension: 1536,
      hnswEfConstruction: 200,
      hnswM: 16,
      metric: DistanceMetric.COSINE,
    });

    // REQ-CAPIDX-001: Initialize cache for hash-based caching
    this.cache = new CapabilityIndexCache(process.cwd(), this.config.agentsPath);

    // Listen for registry events
    this.setupRegistryListeners();
  }

  /**
   * Setup listeners for agent registry events
   */
  private setupRegistryListeners(): void {
    // Note: AgentRegistry doesn't emit events in current implementation
    // This is a placeholder for future event-driven updates
    // For now, we rely on periodic freshness checks
  }

  /**
   * Initialize the capability provider
   */
  private async initEmbeddingProvider(): Promise<void> {
    if (this.embeddingProvider) return;

    try {
      this.embeddingProvider = await EmbeddingProviderFactory.getProvider(
        this.config.useLocalEmbedding
      );
      if (this.config.verbose) {
        const providerName = this.embeddingProvider?.getProviderName?.() ?? 'unknown';
        console.log(`[CapabilityIndex] Using ${providerName} provider`);
      }
    } catch (error) {
      throw new CapabilityIndexError(
        'Failed to initialize embedding provider',
        'initialize',
        0,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Initialize the index with agents from registry
   * Per RULE-DAI-003-004: Sync with AgentRegistry
   * Per INT-002: Store agent embeddings
   * REQ-CAPIDX-003: Check cache before rebuilding
   *
   * @throws CapabilityIndexError if initialization fails
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      if (this.config.verbose) {
        console.log('[CapabilityIndex] Already initialized, skipping');
      }
      return;
    }

    const startTime = performance.now();

    try {
      // Initialize embedding provider
      await this.initEmbeddingProvider();

      // Initialize agent registry
      if (!this.agentRegistry.isInitialized) {
        await this.agentRegistry.initialize(this.config.agentsPath);
      }

      // REQ-CAPIDX-003: Check if cache is valid before rebuilding
      const isCacheValid = await this.cache.isValid();

      if (isCacheValid) {
        // REQ-CAPIDX-007: Log cache HIT
        const cacheLoadStart = performance.now();
        const cachedData = await this.cache.load();

        if (cachedData) {
          // Load cached embeddings into index
          await this.loadFromCache(cachedData);

          const cacheLoadDuration = performance.now() - cacheLoadStart;
          console.log(
            `[CapabilityIndex] Cache HIT - loaded ${this.capabilities.size} agents in ${cacheLoadDuration.toFixed(2)}ms`
          );
        } else {
          // Cache load failed, rebuild
          console.log('[CapabilityIndex] Cache load failed despite validation, rebuilding');
          await this.rebuildAndCache();
        }
      } else {
        // REQ-CAPIDX-007: Log cache MISS
        console.log('[CapabilityIndex] Cache MISS - hash mismatch, rebuilding');
        await this.rebuildAndCache();
      }

      this.initialized = true;

      const duration = performance.now() - startTime;
      if (this.config.verbose) {
        console.log(
          `[CapabilityIndex] Initialized with ${this.capabilities.size} agents in ${duration.toFixed(2)}ms`
        );
      }
    } catch (error) {
      throw new CapabilityIndexError(
        'Failed to initialize capability index',
        'initialize',
        this.capabilities.size,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Rebuild the index from scratch
   * Loads all agents from registry and re-indexes using batched embedding requests
   *
   * Performance target: < 10s for 200 agents
   *
   * @throws CapabilityIndexError if rebuild fails
   */
  async rebuild(): Promise<void> {
    const startTime = performance.now();

    try {
      // Clear existing index
      this.capabilities.clear();
      await this.vectorDB.clear();

      // Get all agents from registry
      const agents = this.agentRegistry.getAll();
      const batchSize = this.config.embeddingBatchSize;
      const batchDelay = this.config.embeddingBatchDelayMs;

      if (this.config.verbose) {
        console.log(`[CapabilityIndex] Rebuilding index for ${agents.length} agents (batch size: ${batchSize})`);
      }

      // Process agents in batches to avoid rate limiting
      for (let i = 0; i < agents.length; i += batchSize) {
        const batch = agents.slice(i, i + batchSize);

        // Index batch
        await this.indexAgentBatch(batch);

        // Delay between batches to avoid overwhelming the embedding service
        if (i + batchSize < agents.length && batchDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
      }

      this.lastSyncTime = Date.now();

      const duration = performance.now() - startTime;
      if (this.config.verbose) {
        console.log(
          `[CapabilityIndex] Rebuild complete: ${this.capabilities.size} agents indexed in ${duration.toFixed(2)}ms`
        );
      }

      // Check performance target
      if (duration > 10000) {
        console.warn(
          `[CapabilityIndex] Rebuild exceeded 10s target: ${duration.toFixed(2)}ms`
        );
      }
    } catch (error) {
      throw new CapabilityIndexError(
        'Failed to rebuild capability index',
        'rebuild',
        this.capabilities.size,
        undefined,
        error as Error
      );
    }
  }

  /**
   * REQ-CAPIDX-003: Rebuild index and save to cache
   * REQ-CAPIDX-004: Atomic cache write
   *
   * @throws CapabilityIndexError if rebuild or cache save fails
   */
  private async rebuildAndCache(): Promise<void> {
    // Rebuild index
    await this.rebuild();

    // REQ-CAPIDX-002: Prepare cached embeddings data structure
    const cachedData: ICachedEmbeddings = {
      version: '1.0.0',
      generatedAt: Date.now(),
      embeddingDimension: 1536,
      agentCount: this.capabilities.size,
      entries: {},
    };

    // Convert capabilities to cached format
    for (const [agentKey, entry] of this.capabilities.entries()) {
      cachedData.entries[agentKey] = {
        agentKey: entry.capability.agentKey,
        name: entry.capability.name,
        description: entry.capability.description,
        domains: [...entry.capability.domains], // Convert readonly array to mutable
        keywords: [...entry.capability.keywords], // Convert readonly array to mutable
        embedding: Array.from(entry.capability.embedding),
        successRate: entry.capability.successRate,
        taskCount: entry.capability.taskCount,
        indexedAt: entry.capability.indexedAt,
      };
    }

    // REQ-CAPIDX-001: Compute content hash
    const hash = await this.cache.computeContentHash();

    // REQ-CAPIDX-004: Save to cache atomically
    await this.cache.save(cachedData, hash);
  }

  /**
   * REQ-CAPIDX-003: Load cached embeddings into index
   * REQ-CAPIDX-005: Validate cached data
   *
   * @param cachedData - Cached embeddings data
   * @throws Error if cached data is invalid
   */
  private async loadFromCache(cachedData: ICachedEmbeddings): Promise<void> {
    // Clear existing index
    this.capabilities.clear();
    await this.vectorDB.clear();

    // Load each cached entry
    for (const [agentKey, entry] of Object.entries(cachedData.entries)) {
      // Convert array back to Float32Array
      const embedding = new Float32Array(entry.embedding);

      // Create capability definition
      const capability: IAgentCapability = {
        agentKey: entry.agentKey,
        name: entry.name,
        description: entry.description,
        domains: entry.domains,
        keywords: entry.keywords,
        tools: [], // Not stored in cache
        embedding,
        successRate: entry.successRate,
        taskCount: entry.taskCount,
        indexedAt: entry.indexedAt,
      };

      // Store in index
      this.capabilities.set(agentKey, {
        capability,
        keywords: new Set(entry.keywords),
        domains: new Set(entry.domains),
      });

      // Add to vector DB
      await this.vectorDB.insertWithId(agentKey, embedding);
    }

    // Cache hit with valid hash means agents haven't changed, so mark as fresh now
    this.lastSyncTime = Date.now();
  }

  /**
   * Index a batch of agents using batched embedding requests
   * Reduces API calls by embedding multiple texts in a single request
   *
   * @param agents - Array of agents to index
   */
  private async indexAgentBatch(agents: ILoadedAgentDefinition[]): Promise<void> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not initialized');
    }

    // Extract capability texts for all agents
    const capabilityTexts = agents.map(agent => this.extractCapabilityText(agent));

    // Generate embeddings in batch
    let embeddings: Float32Array[];
    try {
      if (this.embeddingProvider.embedBatch) {
        embeddings = await this.embeddingProvider.embedBatch(capabilityTexts);
      } else {
        // Fallback to sequential if embedBatch not available
        embeddings = await Promise.all(
          capabilityTexts.map(text => this.embeddingProvider!.embed(text))
        );
      }
    } catch (error) {
      // If batch fails, fall back to individual indexing
      if (this.config.verbose) {
        console.warn(`[CapabilityIndex] Batch embedding failed, falling back to individual: ${error}`);
      }
      for (const agent of agents) {
        try {
          await this.indexAgent(agent);
        } catch (err) {
          if (this.config.verbose) {
            console.warn(`[CapabilityIndex] Failed to index agent ${agent.key}: ${err}`);
          }
        }
      }
      return;
    }

    // Process each agent with its embedding
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      let embedding = embeddings[i];

      try {
        // Validate embedding exists and is not zero
        if (!embedding || embedding.length === 0) {
          if (this.config.verbose) {
            console.warn(`[CapabilityIndex] Missing embedding for ${agent.key}, retrying individually`);
          }
          try {
            embedding = await this.embeddingProvider!.embed(capabilityTexts[i]);
          } catch {
            if (this.config.verbose) {
              console.warn(`[CapabilityIndex] Retry failed for ${agent.key}, skipping`);
            }
            continue;
          }
        }

        // Validate embedding - check for zero vectors
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        if (norm < 0.001) {
          // Zero or near-zero vector - try individual embedding
          if (this.config.verbose) {
            console.warn(`[CapabilityIndex] Zero vector for ${agent.key}, retrying individually`);
          }
          try {
            embedding = await this.embeddingProvider!.embed(capabilityTexts[i]);
          } catch {
            if (this.config.verbose) {
              console.warn(`[CapabilityIndex] Retry failed for ${agent.key}, skipping`);
            }
            continue;
          }
        }

        // Normalize if not already normalized
        const finalNorm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        if (Math.abs(finalNorm - 1.0) > 0.001 && finalNorm > 0) {
          for (let j = 0; j < embedding.length; j++) {
            embedding[j] /= finalNorm;
          }
        }

        // Extract keywords, domains, and tools
        const keywords = this.extractKeywords(capabilityTexts[i]);
        const domains = this.extractDomains(agent);
        const tools: string[] = [];

        // Create capability definition
        const capability: IAgentCapability = {
          agentKey: agent.key,
          name: agent.frontmatter.name || agent.key,
          description: agent.frontmatter.description || '',
          domains,
          keywords,
          tools,
          embedding,
          successRate: 0.5,
          taskCount: 0,
          indexedAt: Date.now(),
        };

        // Store in index
        this.capabilities.set(agent.key, {
          capability,
          keywords: new Set(keywords),
          domains: new Set(domains),
        });

        // Add to vector DB
        await this.vectorDB.insertWithId(agent.key, embedding);
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[CapabilityIndex] Failed to index agent ${agent.key}: ${error}`);
        }
      }
    }
  }

  /**
   * Index a single agent
   *
   * @param agent - Agent definition to index
   * @throws Error if indexing fails
   */
  private async indexAgent(agent: ILoadedAgentDefinition): Promise<void> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not initialized');
    }

    // Extract capability text
    const capabilityText = this.extractCapabilityText(agent);

    // Generate embedding
    const embedding = await this.embeddingProvider.embed(capabilityText);

    // Extract keywords, domains, and tools
    const keywords = this.extractKeywords(capabilityText);
    const domains = this.extractDomains(agent);
    const tools: string[] = []; // Tools not available in frontmatter, use empty array

    // Create capability definition
    const capability: IAgentCapability = {
      agentKey: agent.key,
      name: agent.frontmatter.name || agent.key,
      description: agent.frontmatter.description || '',
      domains,
      keywords,
      tools,
      embedding,
      successRate: 0.5, // Default, will be updated by learning
      taskCount: 0,
      indexedAt: Date.now(),
    };

    // Store in index
    this.capabilities.set(agent.key, {
      capability,
      keywords: new Set(keywords),
      domains: new Set(domains),
    });

    // Add to vector DB
    await this.vectorDB.insertWithId(agent.key, embedding);
  }

  /**
   * Extract capability text from agent definition
   * Combines name, description, and capabilities
   *
   * @param agent - Agent definition
   * @returns Combined capability text
   */
  private extractCapabilityText(agent: ILoadedAgentDefinition): string {
    const parts: string[] = [];

    // Add name
    if (agent.frontmatter.name) {
      parts.push(agent.frontmatter.name);
    }

    // Add description
    if (agent.frontmatter.description) {
      parts.push(agent.frontmatter.description);
    }

    // Add capabilities
    if (agent.frontmatter.capabilities && agent.frontmatter.capabilities.length > 0) {
      parts.push(agent.frontmatter.capabilities.join(' '));
    }

    // Add triggers (if available)
    if (agent.frontmatter.triggers && agent.frontmatter.triggers.length > 0) {
      parts.push(agent.frontmatter.triggers.join(' '));
    }

    return parts.join(' ');
  }

  /**
   * Extract keywords from capability text
   * Uses simple whitespace tokenization and lowercasing
   *
   * @param text - Capability text
   * @returns Array of keywords
   */
  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 3); // Filter short words

    // Remove duplicates and return
    return Array.from(new Set(words));
  }

  /**
   * Extract domains from agent definition
   * Maps agent capabilities to task domains
   *
   * @param agent - Agent definition
   * @returns Array of task domains
   */
  private extractDomains(agent: ILoadedAgentDefinition): TaskDomain[] {
    const domains = new Set<TaskDomain>();
    const textLower = this.extractCapabilityText(agent).toLowerCase();

    // Domain keyword mapping
    // TASK-WRITING-001: Expanded writing domain keywords for better routing
    const domainKeywords: Record<TaskDomain, string[]> = {
      research: ['research', 'analyze', 'investigate', 'study', 'explore', 'find'],
      testing: ['test', 'verify', 'validate', 'check', 'qa', 'quality'],
      code: ['code', 'implement', 'build', 'develop', 'program', 'debug'],
      writing: [
        // Core writing verbs
        'write', 'document', 'author', 'compose', 'draft',
        // Creative writing
        'poem', 'poetry', 'story', 'fiction', 'creative', 'narrative',
        'prose', 'verse', 'metaphor', 'fantasy', 'humor', 'funny',
        'whimsical', 'artistic', 'lyrical', 'rhyme', 'ballad', 'sonnet',
        'satire', 'parody', 'limerick', 'haiku',
        // Academic writing
        'academic', 'formal', 'dissertation', 'thesis', 'scholarly',
        'research', 'paper', 'peer-reviewed', 'citation', 'journal',
        'abstract', 'methodology', 'hypothesis', 'literature',
        // Professional writing
        'business', 'report', 'proposal', 'executive', 'corporate',
        'professional', 'memo', 'presentation', 'briefing', 'strategy',
        // Casual writing
        'blog', 'social', 'informal', 'casual', 'conversational',
        'friendly', 'approachable', 'newsletter', 'email', 'chatty',
        // Technical writing
        'documentation', 'guide', 'manual', 'tutorial', 'specification',
        'readme', 'howto', 'setup', 'installation', 'configuration',
        'troubleshooting', 'api', 'sdk', 'reference',
      ],
      design: ['design', 'architect', 'plan', 'structure', 'model', 'observability', 'monitoring', 'telemetry', 'infrastructure'],
      review: ['review', 'audit', 'inspect', 'evaluate', 'grade'],
    };

    // Check for domain keywords
    for (const [domain, keywords] of Object.entries(domainKeywords) as [TaskDomain, string[]][]) {
      for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
          domains.add(domain);
          break;
        }
      }
    }

    // Default to code if no domains found
    if (domains.size === 0) {
      domains.add('code');
    }

    return Array.from(domains);
  }

  /**
   * Add an agent to the index
   * Called when registry fires agentAdded event
   *
   * @param agentKey - Agent key to add
   */
  private addAgent(agentKey: string): void {
    const agent = this.agentRegistry.getByKey(agentKey);
    if (!agent) {
      if (this.config.verbose) {
        console.warn(`[CapabilityIndex] Agent ${agentKey} not found in registry`);
      }
      return;
    }

    this.indexAgent(agent).catch(error => {
      if (this.config.verbose) {
        console.warn(`[CapabilityIndex] Failed to add agent ${agentKey}: ${error}`);
      }
    });
  }

  /**
   * Remove an agent from the index
   * Called when registry fires agentRemoved event
   *
   * @param agentKey - Agent key to remove
   */
  private async removeAgent(agentKey: string): Promise<void> {
    this.capabilities.delete(agentKey);
    await this.vectorDB.delete(agentKey);
  }

  /**
   * Search for matching agents by embedding
   * Returns top N matches ranked by cosine similarity
   *
   * @param embedding - Task embedding vector (VECTOR_DIM (1536), L2-normalized)
   * @param limit - Maximum number of results to return
   * @returns Array of capability matches sorted by combined score
   */
  async search(embedding: Float32Array, limit: number = 10): Promise<ICapabilityMatch[]> {
    // Verify freshness
    this.verifyFreshness();

    try {
      // Search vector DB
      const searchResults = await this.vectorDB.search(embedding, limit);

      // Map to capability matches
      const matches: ICapabilityMatch[] = [];

      for (const result of searchResults) {
        const entry = this.capabilities.get(result.id);
        if (!entry) {
          if (this.config.verbose) {
            console.warn(`[CapabilityIndex] Agent ${result.id} in VectorDB but not in index`);
          }
          continue;
        }

        const match: ICapabilityMatch = {
          agentKey: entry.capability.agentKey,
          name: entry.capability.name,
          similarityScore: result.similarity, // Cosine similarity
          keywordScore: 0, // Will be computed by routing engine
          domainMatch: false, // Will be set by routing engine
          combinedScore: result.similarity, // Default to similarity score
          capability: entry.capability,
        };

        matches.push(match);
      }

      return matches;
    } catch (error) {
      throw new CapabilityIndexError(
        'Search operation failed',
        'search',
        this.capabilities.size,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Search for matching agents by domain
   * Returns agents that handle the specified domain
   *
   * @param domain - Task domain to match
   * @param limit - Maximum number of results to return
   * @returns Array of capability matches for the domain
   */
  searchByDomain(domain: TaskDomain, limit: number = 10): ICapabilityMatch[] {
    // Verify freshness
    this.verifyFreshness();

    const matches: ICapabilityMatch[] = [];

    for (const [agentKey, entry] of this.capabilities) {
      if (entry.domains.has(domain)) {
        const match: ICapabilityMatch = {
          agentKey: entry.capability.agentKey,
          name: entry.capability.name,
          similarityScore: 0, // Not applicable for domain search
          keywordScore: 0,
          domainMatch: true,
          combinedScore: entry.capability.successRate, // Rank by success rate
          capability: entry.capability,
        };

        matches.push(match);
      }
    }

    // Sort by success rate (descending)
    matches.sort((a, b) => b.capability.successRate - a.capability.successRate);

    // Return top N
    return matches.slice(0, limit);
  }

  /**
   * Get last synchronization timestamp
   *
   * @returns Timestamp of last sync (milliseconds since epoch)
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /**
   * Get total indexed agent count
   *
   * @returns Number of agents in index
   */
  getAgentCount(): number {
    return this.capabilities.size;
  }

  /**
   * Verify index freshness
   * Throws if index is stale (> 24h since last sync)
   *
   * @throws IndexSyncError if index is stale
   */
  private verifyFreshness(): void {
    const timeSinceSync = Date.now() - this.lastSyncTime;
    if (timeSinceSync > this.config.freshnessThreshold) {
      throw new IndexSyncError(
        `Index is stale: ${(timeSinceSync / 1000 / 60 / 60).toFixed(1)}h since last sync`,
        'freshness-check',
        this.lastSyncTime
      );
    }
  }

  /**
   * Get capability by agent key
   *
   * @param agentKey - Agent key
   * @returns Capability entry or undefined
   */
  getCapability(agentKey: string): IAgentCapability | undefined {
    return this.capabilities.get(agentKey)?.capability;
  }

  /**
   * Get index statistics
   */
  getStats(): {
    agentCount: number;
    lastSyncTime: number;
    timeSinceSync: number;
    isStale: boolean;
    domains: Record<TaskDomain, number>;
  } {
    const domainCounts: Record<TaskDomain, number> = {
      research: 0,
      testing: 0,
      code: 0,
      writing: 0,
      design: 0,
      review: 0,
    };

    for (const entry of this.capabilities.values()) {
      for (const domain of entry.domains) {
        domainCounts[domain]++;
      }
    }

    const timeSinceSync = Date.now() - this.lastSyncTime;

    return {
      agentCount: this.capabilities.size,
      lastSyncTime: this.lastSyncTime,
      timeSinceSync,
      isStale: timeSinceSync > this.config.freshnessThreshold,
      domains: domainCounts,
    };
  }
}
