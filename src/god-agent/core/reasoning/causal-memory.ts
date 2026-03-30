/**
 * CausalMemory - Main interface for hypergraph-based causal reasoning
 * Integrates hypergraph, traversal, and cycle detection for complete causal inference
 */

import type { MemoryEngine } from '../memory/index.js';
import type {
  NodeID,
  CausalNode,
  CausalLink,
  AddCausalLinkParams,
  InferenceResult,
  CauseFindingResult,
  CausalGraphStats,
  TraversalOptions,
} from './causal-types.js';
import { CausalHypergraph } from './causal-hypergraph.js';
import { CausalTraversal } from './causal-traversal.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('CausalMemory', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Configuration for CausalMemory
 */
export interface CausalMemoryConfig {
  /** Key for persisting graph in MemoryEngine */
  storageKey?: string;
  /** Auto-save after operations */
  autoSave?: boolean;
  /** Enable performance tracking */
  trackPerformance?: boolean;
}

/**
 * Main causal reasoning engine with persistence
 * Provides high-level API for causal inference and analysis
 */
export class CausalMemory {
  private graph: CausalHypergraph;
  private traversal: CausalTraversal;
  private memoryEngine: MemoryEngine;
  private config: Required<CausalMemoryConfig>;
  private initialized: boolean = false;

  constructor(memoryEngine: MemoryEngine, config: CausalMemoryConfig = {}) {
    this.memoryEngine = memoryEngine;
    this.graph = new CausalHypergraph();
    this.traversal = new CausalTraversal();

    this.config = {
      storageKey: config.storageKey ?? 'causal-graph',
      autoSave: config.autoSave ?? true,
      trackPerformance: config.trackPerformance ?? false,
    };
  }

  /**
   * Initialize CausalMemory by loading persisted graph
   * Must be called before using the instance
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Try to load existing graph from memory
      const stored = await this.memoryEngine.retrieve(this.config.storageKey);

      if (stored) {
        const serialized = JSON.parse(stored);
        this.graph = CausalHypergraph.fromJSON(serialized);
        logger.info('Loaded causal graph', { nodes: this.graph.getNodes().length, links: this.graph.getLinks().length });
      } else {
        logger.info('No existing causal graph found, starting fresh');
      }
    } catch (error) {
      logger.warn('Failed to load causal graph, starting fresh', { error: String(error) });
      this.graph.clear();
    }

    this.initialized = true;
  }

  /**
   * Ensure initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CausalMemory not initialized. Call initialize() first.');
    }
  }

  /**
   * Add a new node to the causal graph
   *
   * @param node - Causal node to add
   */
  async addNode(node: CausalNode): Promise<void> {
    this.ensureInitialized();

    this.graph.addNode(node);

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Add a causal link (hyperedge) to the graph
   * Validates nodes exist and checks for cycles
   *
   * @param params - Link parameters
   * @returns The created causal link
   * @throws Error if validation fails or cycle detected
   */
  async addCausalLink(params: AddCausalLinkParams): Promise<CausalLink> {
    this.ensureInitialized();

    const startTime = performance.now();

    const link = this.graph.addCausalLink(params);

    if (this.config.trackPerformance) {
      const elapsed = performance.now() - startTime;
      logger.debug('Added causal link', { elapsedMs: elapsed });
    }

    if (this.config.autoSave) {
      await this.persist();
    }

    return link;
  }

  /**
   * Infer consequences (effects) from given conditions (causes)
   * Uses forward traversal through the causal graph
   *
   * @param conditions - Array of cause node IDs
   * @param maxDepth - Maximum traversal depth (default: 5)
   * @param options - Additional traversal options
   * @returns Inference result with predicted effects and causal chains
   */
  async inferConsequences(
    conditions: NodeID[],
    maxDepth: number = 5,
    options: Omit<TraversalOptions, 'maxDepth' | 'direction'> = {}
  ): Promise<InferenceResult> {
    this.ensureInitialized();

    const traversalOptions: TraversalOptions = {
      ...options,
      maxDepth,
      direction: 'forward',
    };

    const result = this.traversal.traverseForward(
      this.graph.getGraphStructure(),
      conditions,
      traversalOptions
    );

    // Add explanations to chains
    for (const chain of result.chains) {
      chain.explanation = this.traversal.buildChainExplanation(
        this.graph.getGraphStructure(),
        chain
      );
    }

    if (this.config.trackPerformance && result.traversalTime) {
      logger.debug('Forward traversal completed', {
        traversalTimeMs: result.traversalTime,
        nodesExplored: result.nodesExplored,
        chainsFound: result.chains.length
      });
    }

    return result;
  }

  /**
   * Find possible causes for a given effect
   * Uses backward traversal through the causal graph
   *
   * @param effect - Effect node ID
   * @param maxDepth - Maximum traversal depth (default: 5)
   * @param options - Additional traversal options
   * @returns Cause finding result with identified causes and causal chains
   */
  async findCauses(
    effect: NodeID,
    maxDepth: number = 5,
    options: Omit<TraversalOptions, 'maxDepth' | 'direction'> = {}
  ): Promise<CauseFindingResult> {
    this.ensureInitialized();

    const traversalOptions: TraversalOptions = {
      ...options,
      maxDepth,
      direction: 'backward',
    };

    const result = this.traversal.traverseBackward(
      this.graph.getGraphStructure(),
      [effect],
      traversalOptions
    );

    // Add explanations to chains
    for (const chain of result.chains) {
      chain.explanation = this.traversal.buildChainExplanation(
        this.graph.getGraphStructure(),
        chain
      );
    }

    if (this.config.trackPerformance && result.traversalTime) {
      logger.debug('Backward traversal completed', {
        traversalTimeMs: result.traversalTime,
        nodesExplored: result.nodesExplored,
        chainsFound: result.chains.length
      });
    }

    return result;
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: NodeID): CausalNode | undefined {
    this.ensureInitialized();
    return this.graph.getNode(nodeId);
  }

  /**
   * Get a link by ID
   */
  getLink(linkId: string): CausalLink | undefined {
    this.ensureInitialized();
    return this.graph.getLink(linkId);
  }

  /**
   * Get all nodes in the graph
   */
  getNodes(): CausalNode[] {
    this.ensureInitialized();
    return this.graph.getNodes();
  }

  /**
   * Get all links in the graph
   */
  getLinks(): CausalLink[] {
    this.ensureInitialized();
    return this.graph.getLinks();
  }

  /**
   * Get nodes by type
   */
  getNodesByType(type: 'concept' | 'action' | 'state'): CausalNode[] {
    this.ensureInitialized();
    return this.graph.getNodes().filter((node) => node.type === type);
  }

  /**
   * Get outgoing links from a node
   */
  getOutgoingLinks(nodeId: NodeID): CausalLink[] {
    this.ensureInitialized();
    return this.graph.getOutgoingLinks(nodeId);
  }

  /**
   * Get incoming links to a node
   */
  getIncomingLinks(nodeId: NodeID): CausalLink[] {
    this.ensureInitialized();
    return this.graph.getIncomingLinks(nodeId);
  }

  /**
   * Update an existing node
   */
  async updateNode(nodeId: NodeID, updates: Partial<Omit<CausalNode, 'id'>>): Promise<void> {
    this.ensureInitialized();

    this.graph.updateNode(nodeId, updates);

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Update an existing link
   */
  async updateLink(
    linkId: string,
    updates: Partial<Omit<CausalLink, 'id' | 'causes' | 'effects'>>
  ): Promise<void> {
    this.ensureInitialized();

    this.graph.updateLink(linkId, updates);

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Remove a node and all connected links
   */
  async removeNode(nodeId: NodeID): Promise<void> {
    this.ensureInitialized();

    this.graph.removeNode(nodeId);

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Remove a link
   */
  async removeLink(linkId: string): Promise<void> {
    this.ensureInitialized();

    this.graph.removeLink(linkId);

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Get statistics about the causal graph
   */
  getStats(): CausalGraphStats {
    this.ensureInitialized();
    return this.graph.getStats();
  }

  /**
   * Search for nodes by label (case-insensitive partial match)
   */
  searchNodes(query: string): CausalNode[] {
    this.ensureInitialized();

    const lowerQuery = query.toLowerCase();
    return this.graph.getNodes().filter((node) =>
      node.label.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Find all nodes that are root causes (no incoming links)
   */
  getRootCauses(): CausalNode[] {
    this.ensureInitialized();

    return this.graph.getNodes().filter((node) => {
      const incoming = this.graph.getIncomingLinks(node.id);
      return incoming.length === 0;
    });
  }

  /**
   * Find all nodes that are terminal effects (no outgoing links)
   */
  getTerminalEffects(): CausalNode[] {
    this.ensureInitialized();

    return this.graph.getNodes().filter((node) => {
      const outgoing = this.graph.getOutgoingLinks(node.id);
      return outgoing.length === 0;
    });
  }

  /**
   * Persist the causal graph to memory
   */
  async persist(): Promise<void> {
    this.ensureInitialized();

    const serialized = this.graph.toJSON();
    const value = JSON.stringify(serialized);

    // Use store with namespace for causal graph
    // Pass sentinel unit-vector to skip auto-embed of potentially large serialized graph.
    // Causal graph is retrieved by exact key, not semantic search.
    const sentinel = new Float32Array(1536);
    sentinel[0] = 1.0;
    await this.memoryEngine.store(
      this.config.storageKey,
      value,
      { namespace: 'research', embedding: sentinel }
    );
  }

  /**
   * Clear all data from the causal graph
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    this.graph.clear();

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Export the graph as JSON
   */
  export(): string {
    this.ensureInitialized();
    return JSON.stringify(this.graph.toJSON(), null, 2);
  }

  /**
   * Import a graph from JSON
   */
  async import(jsonData: string): Promise<void> {
    this.ensureInitialized();

    const data = JSON.parse(jsonData);
    this.graph = CausalHypergraph.fromJSON(data);

    if (this.config.autoSave) {
      await this.persist();
    }
  }

  /**
   * Get the underlying hypergraph (for advanced use)
   */
  getHypergraph(): CausalHypergraph {
    this.ensureInitialized();
    return this.graph;
  }

  /**
   * Validate graph integrity
   * Checks for orphaned links, invalid references, etc.
   */
  validateIntegrity(): { valid: boolean; errors: string[] } {
    this.ensureInitialized();

    const errors: string[] = [];
    const nodeIds = new Set(this.graph.getNodes().map((n) => n.id));

    for (const link of this.graph.getLinks()) {
      // Check all causes exist
      for (const causeId of link.causes) {
        if (!nodeIds.has(causeId)) {
          errors.push(`Link ${link.id} references non-existent cause: ${causeId}`);
        }
      }

      // Check all effects exist
      for (const effectId of link.effects) {
        if (!nodeIds.has(effectId)) {
          errors.push(`Link ${link.id} references non-existent effect: ${effectId}`);
        }
      }

      // Validate confidence and strength
      if (link.confidence < 0 || link.confidence > 1) {
        errors.push(`Link ${link.id} has invalid confidence: ${link.confidence}`);
      }
      if (link.strength < 0 || link.strength > 1) {
        errors.push(`Link ${link.id} has invalid strength: ${link.strength}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
