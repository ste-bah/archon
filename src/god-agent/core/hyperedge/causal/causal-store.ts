/**
 * Causal Chain Store
 * TASK-HYPEREDGE-001
 *
 * Stores and analyzes causal chains with cycle detection
 * Constitution: HYPER-05 - detect loops via DFS before creation
 */

import { randomUUID } from 'crypto';
import type { NodeID } from '../../graph-db/types.js';
import type { GraphDB } from '../../graph-db/graph-db.js';
import type {
  CausalNode,
  CausalChain,
  CausalEdge,
  CausalLoop,
  RootCauseResult,
} from '../hyperedge-types.js';
import { LoopDetector, validateNoCycles } from './loop-detector.js';
import { logger, METRICS } from '../../observability/index.js';

/**
 * Configuration for causal store
 */
export interface CausalStoreConfig {
  /** Graph DB for storage */
  graphDB: GraphDB;
  /** Enable observability events (default: true) */
  emitEvents?: boolean;
  /** Maximum depth for root cause analysis (default: 10) */
  maxDepth?: number;
}

/**
 * Causal Chain Store
 *
 * Constitution compliance:
 * - HYPER-05: DFS loop detection before creation
 */
export class CausalStore {
  private readonly graphDB: GraphDB;
  private readonly emitEvents: boolean;
  private readonly maxDepth: number;
  private readonly chainCache: Map<string, CausalChain>;
  private readonly loopDetector: LoopDetector;

  constructor(config: CausalStoreConfig) {
    this.graphDB = config.graphDB;
    this.emitEvents = config.emitEvents ?? true;
    this.maxDepth = config.maxDepth ?? 10;
    this.chainCache = new Map();
    this.loopDetector = new LoopDetector();

    logger.info('CausalStore initialized', {
      maxDepth: this.maxDepth,
      emitEvents: this.emitEvents,
    });
  }

  /**
   * Create a causal chain
   *
   * @param nodes - Causal nodes
   * @returns Created causal chain
   *
   * Constitution: HYPER-05 - validate no cycles before creation
   */
  public async createChain(nodes: CausalNode[]): Promise<CausalChain> {
    const startTime = Date.now();
    const chainId = randomUUID();

    try {
      // Validate inputs
      this.validateNodes(nodes);

      // Constitution: HYPER-05 - detect loops via DFS
      const validation = validateNoCycles(nodes, chainId);

      if (!validation.valid) {
        throw new Error(
          `Causal chain contains ${validation.cycles.length} cycle(s). ` +
          `Cycles detected at nodes: ${validation.cycles.map(c => c.nodes.join(',')).join('; ')}`
        );
      }

      // Build edges from node relationships
      const edges = this.buildEdges(nodes);

      // Create chain object
      const chain: CausalChain = {
        id: chainId,
        nodes,
        edges,
        timestamp: Date.now(),
        validated: true,
      };

      // Store nodes and edges in graph DB (optional for testing)
      try {
        for (const node of nodes) {
          await this.graphDB.createNode({
            type: 'causal-node',
            properties: {
              event: node.event,
              timestamp: node.timestamp,
            },
          });
        }

        for (const edge of edges) {
          await this.graphDB.createEdge({
            source: edge.from,
            target: edge.to,
            type: 'causal-edge',
            metadata: {
              strength: edge.strength,
            },
          });
        }
      } catch (error) {
        // Log but don't fail on graph DB errors
        logger.warn('Failed to store causal chain in GraphDB', {
          chainId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Cache for fast retrieval
      this.chainCache.set(chainId, chain);

      const executionTime = Date.now() - startTime;

      // Observability
      if (this.emitEvents) {
        METRICS.causalStoreChainCreated.inc({ nodeCount: nodes.length.toString() });
        METRICS.causalStoreCreateLatency.observe(executionTime);
      }

      logger.debug('Causal chain created', {
        chainId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        executionTime,
      });

      return chain;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      logger.error('Failed to create causal chain', {
        nodeCount: nodes.length,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      });

      // RULE-070: Re-throw with chain creation context
      throw new Error(
        `Failed to create causal chain with ${nodes.length} nodes: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Find root cause of an effect
   *
   * @param effectId - Effect node ID
   * @param maxDepth - Maximum traversal depth (optional)
   * @returns Root cause result
   */
  public async findRootCause(
    effectId: NodeID,
    maxDepth?: number
  ): Promise<RootCauseResult> {
    const startTime = Date.now();
    const depth = maxDepth ?? this.maxDepth;

    try {
      // Find chain containing this effect
      const chain = this.findChainWithNode(effectId);

      if (!chain) {
        throw new Error(`No causal chain found containing node ${effectId}`);
      }

      // Get effect node
      const effectNode = chain.nodes.find((n) => n.id === effectId);
      if (!effectNode) {
        throw new Error(`Node ${effectId} not found in chain`);
      }

      // Traverse backward to find root
      const path: NodeID[] = [effectId];
      let currentNode = effectNode;
      let currentDepth = 0;

      while (currentNode.causes.length > 0 && currentDepth < depth) {
        // Select primary cause (first one, or strongest if we had strength data)
        const primaryCause = currentNode.causes[0];
        path.push(primaryCause);

        // Find cause node
        const causeNode = chain.nodes.find((n) => n.id === primaryCause);
        if (!causeNode) {
          break; // Cause not in this chain
        }

        currentNode = causeNode;
        currentDepth++;
      }

      // Calculate confidence based on path length and certainty
      const confidence = this.calculateRootCauseConfidence(currentDepth, depth);

      const result: RootCauseResult = {
        rootNode: currentNode,
        confidence,
        path: path.reverse(), // Root to effect order
        depth: currentDepth,
      };

      const executionTime = Date.now() - startTime;

      // Observability
      if (this.emitEvents) {
        METRICS.causalStoreRootCauseLatency.observe(executionTime);
      }

      logger.debug('Root cause analysis completed', {
        effectId,
        rootId: currentNode.id,
        depth: currentDepth,
        confidence,
        executionTime,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      logger.error('Root cause analysis failed', {
        effectId,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      });

      // RULE-070: Re-throw with root cause analysis context
      throw new Error(
        `Root cause analysis failed for effect "${effectId}" (maxDepth: ${maxDepth ?? this.maxDepth}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Detect loops in a causal chain
   *
   * @param chainId - Chain ID
   * @returns Detected loops
   *
   * Constitution: HYPER-05 - DFS-based loop detection
   */
  public async detectLoops(chainId: string): Promise<CausalLoop[]> {
    const startTime = Date.now();

    try {
      const chain = this.chainCache.get(chainId);

      if (!chain) {
        throw new Error(`Causal chain ${chainId} not found`);
      }

      // Use loop detector
      const loops = this.loopDetector.detectLoops(chain.nodes, chainId);

      const executionTime = Date.now() - startTime;

      // Observability
      if (this.emitEvents) {
        METRICS.causalStoreLoopsDetected.inc({ count: loops.length.toString() });
        METRICS.causalStoreLoopDetectionLatency.observe(executionTime);
      }

      logger.debug('Loop detection completed', {
        chainId,
        loopsFound: loops.length,
        executionTime,
      });

      return loops;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      logger.error('Loop detection failed', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      });

      // RULE-070: Re-throw with loop detection context
      throw new Error(
        `Loop detection failed for chain "${chainId}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Get causal chain by ID
   */
  public getChainById(chainId: string): CausalChain | undefined {
    return this.chainCache.get(chainId);
  }

  /**
   * Find chain containing a specific node
   */
  private findChainWithNode(nodeId: NodeID): CausalChain | undefined {
    for (const chain of this.chainCache.values()) {
      if (chain.nodes.some((n) => n.id === nodeId)) {
        return chain;
      }
    }
    return undefined;
  }

  /**
   * Build causal edges from node relationships
   */
  private buildEdges(nodes: CausalNode[]): CausalEdge[] {
    const edges: CausalEdge[] = [];

    for (const node of nodes) {
      for (const effectId of node.effects) {
        edges.push({
          from: node.id,
          to: effectId,
          strength: 1.0, // Default strength; could be configurable
        });
      }
    }

    return edges;
  }

  /**
   * Calculate root cause confidence
   * Higher confidence for shorter paths and complete traversals
   */
  private calculateRootCauseConfidence(actualDepth: number, maxDepth: number): number {
    // Base confidence from reaching a root (no causes)
    let confidence = 0.8;

    // Penalty for reaching max depth without finding root
    if (actualDepth >= maxDepth) {
      confidence *= 0.7; // Uncertain if we hit depth limit
    }

    // Bonus for short paths (clearer causation)
    if (actualDepth <= 2) {
      confidence *= 1.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Validate causal nodes
   */
  private validateNodes(nodes: CausalNode[]): void {
    if (!nodes || nodes.length === 0) {
      throw new Error('At least one causal node is required');
    }

    const nodeIds = new Set<NodeID>();

    for (const node of nodes) {
      if (!node.id) {
        throw new Error('Causal node ID is required');
      }

      if (nodeIds.has(node.id)) {
        throw new Error(`Duplicate node ID: ${node.id}`);
      }

      nodeIds.add(node.id);

      if (!node.event || node.event.trim().length === 0) {
        throw new Error(`Causal node ${node.id} has empty event`);
      }

      if (!node.timestamp || node.timestamp <= 0) {
        throw new Error(`Causal node ${node.id} has invalid timestamp`);
      }
    }

    // Validate that referenced nodes exist
    for (const node of nodes) {
      for (const causeId of node.causes) {
        if (!nodeIds.has(causeId)) {
          throw new Error(
            `Node ${node.id} references non-existent cause: ${causeId}`
          );
        }
      }

      for (const effectId of node.effects) {
        if (!nodeIds.has(effectId)) {
          throw new Error(
            `Node ${node.id} references non-existent effect: ${effectId}`
          );
        }
      }
    }
  }

  /**
   * Clear cache (for testing/maintenance)
   */
  public clearCache(): void {
    this.chainCache.clear();
    logger.debug('Causal chain cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; chains: number } {
    return {
      size: this.chainCache.size,
      chains: this.chainCache.size,
    };
  }
}
