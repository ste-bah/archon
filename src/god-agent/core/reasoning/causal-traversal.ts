/**
 * CausalTraversal - BFS-based bidirectional traversal for causal reasoning
 * Supports forward inference (find effects) and backward analysis (find causes)
 * Performance: <15ms for 5-hop traversal
 */

import type {
  NodeID,
  CausalLink,
  CausalChain,
  TraversalOptions,
  InferenceResult,
  CauseFindingResult,
} from './causal-types.js';

/**
 * Internal graph structure for traversal
 */
interface GraphStructure {
  nodes: Map<NodeID, CausalNode>;
  links: Map<string, CausalLink>;
  forwardIndex: Map<NodeID, Set<string>>;
  backwardIndex: Map<NodeID, Set<string>>;
}

interface CausalNode {
  id: NodeID;
  label: string;
  type: string;
}

/**
 * Internal state for BFS traversal
 */
interface TraversalState {
  /** Nodes visited during traversal */
  visited: Set<NodeID>;
  /** Current frontier of nodes to explore */
  queue: Array<{ nodeId: NodeID; depth: number; chain: CausalLink[] }>;
  /** Discovered causal chains */
  chains: CausalChain[];
  /** Discovered end nodes (effects or causes) */
  endNodes: Set<NodeID>;
  /** Number of nodes explored */
  nodesExplored: number;
}

/**
 * High-performance bidirectional causal traversal engine
 */
export class CausalTraversal {
  /**
   * Traverse forward from start nodes to find effects
   * Uses BFS to explore causal chains in the forward direction
   *
   * @param graph - Graph structure to traverse
   * @param startNodes - Starting node IDs (causes)
   * @param options - Traversal options
   * @returns Inference result with predicted effects and chains
   */
  traverseForward(
    graph: GraphStructure,
    startNodes: NodeID[],
    options: TraversalOptions = {}
  ): InferenceResult {
    const startTime = performance.now();

    // Set defaults
    const maxDepth = options.maxDepth ?? 5;
    const minConfidence = options.minConfidence ?? 0.0;
    const stopOnCycle = options.stopOnCycle ?? true;
    const maxChains = options.maxChains ?? 100;
    const minChainConfidence = options.minChainConfidence ?? 0.0;

    // Validate start nodes
    const warnings: string[] = [];
    const validStartNodes = startNodes.filter((nodeId) => {
      if (!graph.nodes.has(nodeId)) {
        warnings.push(`Start node '${nodeId}' not found in graph`);
        return false;
      }
      return true;
    });

    if (validStartNodes.length === 0) {
      return {
        effects: [],
        chains: [],
        confidence: 0,
        warnings: [...warnings, 'No valid start nodes provided'],
        nodesExplored: 0,
        traversalTime: performance.now() - startTime,
      };
    }

    // Initialize traversal state
    const state: TraversalState = {
      visited: new Set(validStartNodes),
      queue: validStartNodes.map((nodeId) => ({
        nodeId,
        depth: 0,
        chain: [],
      })),
      chains: [],
      endNodes: new Set(),
      nodesExplored: 0,
    };

    // BFS traversal
    while (state.queue.length > 0 && state.chains.length < maxChains) {
      const current = state.queue.shift()!;
      state.nodesExplored++;

      // Stop at max depth
      if (current.depth >= maxDepth) {
        continue;
      }

      // Get outgoing links from current node
      const outgoingLinkIds = graph.forwardIndex.get(current.nodeId);
      if (!outgoingLinkIds || outgoingLinkIds.size === 0) {
        // Leaf node - end of chain
        if (current.chain.length > 0) {
          this.addChain(state, current.chain, validStartNodes, [current.nodeId]);
        }
        continue;
      }

      // Explore each outgoing link
      for (const linkId of outgoingLinkIds) {
        const link = graph.links.get(linkId);
        if (!link || link.confidence < minConfidence) {
          continue;
        }

        // Check for cycles if enabled
        if (stopOnCycle && this.wouldCreateCycle(current.chain, link)) {
          warnings.push(`Cycle detected at link ${link.id}, stopping traversal`);
          continue;
        }

        // Explore each effect
        for (const effectId of link.effects) {
          const newChain = [...current.chain, link];
          const chainConfidence = this.calculateChainConfidence(newChain);

          // Check chain confidence threshold
          if (chainConfidence < minChainConfidence) {
            continue;
          }

          // Add to end nodes
          state.endNodes.add(effectId);

          // Record chain if at max depth or leaf node
          const hasOutgoing = graph.forwardIndex.get(effectId)?.size ?? 0;
          if (current.depth + 1 >= maxDepth || hasOutgoing === 0) {
            this.addChain(state, newChain, validStartNodes, [effectId]);
          }

          // Continue traversal if not visited and below max depth
          if (!state.visited.has(effectId) && current.depth + 1 < maxDepth) {
            state.visited.add(effectId);
            state.queue.push({
              nodeId: effectId,
              depth: current.depth + 1,
              chain: newChain,
            });
          }
        }
      }
    }

    // Calculate overall confidence
    const confidence = state.chains.length > 0
      ? state.chains.reduce((sum, chain) => sum + chain.totalConfidence, 0) / state.chains.length
      : 0;

    return {
      effects: Array.from(state.endNodes),
      chains: state.chains,
      confidence,
      warnings,
      nodesExplored: state.nodesExplored,
      traversalTime: performance.now() - startTime,
    };
  }

  /**
   * Traverse backward from effect nodes to find causes
   * Uses BFS to explore causal chains in reverse
   *
   * @param graph - Graph structure to traverse
   * @param effectNodes - Starting effect node IDs
   * @param options - Traversal options
   * @returns Cause finding result with identified causes and chains
   */
  traverseBackward(
    graph: GraphStructure,
    effectNodes: NodeID[],
    options: TraversalOptions = {}
  ): CauseFindingResult {
    const startTime = performance.now();

    // Set defaults
    const maxDepth = options.maxDepth ?? 5;
    const minConfidence = options.minConfidence ?? 0.0;
    const stopOnCycle = options.stopOnCycle ?? true;
    const maxChains = options.maxChains ?? 100;
    const minChainConfidence = options.minChainConfidence ?? 0.0;

    // Validate effect nodes
    const warnings: string[] = [];
    const validEffectNodes = effectNodes.filter((nodeId) => {
      if (!graph.nodes.has(nodeId)) {
        warnings.push(`Effect node '${nodeId}' not found in graph`);
        return false;
      }
      return true;
    });

    if (validEffectNodes.length === 0) {
      return {
        causes: [],
        chains: [],
        confidence: 0,
        warnings: [...warnings, 'No valid effect nodes provided'],
        nodesExplored: 0,
        traversalTime: performance.now() - startTime,
      };
    }

    // Initialize traversal state
    const state: TraversalState = {
      visited: new Set(validEffectNodes),
      queue: validEffectNodes.map((nodeId) => ({
        nodeId,
        depth: 0,
        chain: [],
      })),
      chains: [],
      endNodes: new Set(),
      nodesExplored: 0,
    };

    // BFS traversal (backward)
    while (state.queue.length > 0 && state.chains.length < maxChains) {
      const current = state.queue.shift()!;
      state.nodesExplored++;

      // Stop at max depth
      if (current.depth >= maxDepth) {
        continue;
      }

      // Get incoming links to current node
      const incomingLinkIds = graph.backwardIndex.get(current.nodeId);
      if (!incomingLinkIds || incomingLinkIds.size === 0) {
        // Root cause - end of chain
        if (current.chain.length > 0) {
          this.addChain(state, current.chain, [current.nodeId], validEffectNodes);
        }
        continue;
      }

      // Explore each incoming link
      for (const linkId of incomingLinkIds) {
        const link = graph.links.get(linkId);
        if (!link || link.confidence < minConfidence) {
          continue;
        }

        // Check for cycles if enabled
        if (stopOnCycle && this.wouldCreateCycle(current.chain, link)) {
          warnings.push(`Cycle detected at link ${link.id}, stopping traversal`);
          continue;
        }

        // Explore each cause
        for (const causeId of link.causes) {
          const newChain = [...current.chain, link];
          const chainConfidence = this.calculateChainConfidence(newChain);

          // Check chain confidence threshold
          if (chainConfidence < minChainConfidence) {
            continue;
          }

          // Add to end nodes (causes)
          state.endNodes.add(causeId);

          // Record chain if at max depth or root node
          const hasIncoming = graph.backwardIndex.get(causeId)?.size ?? 0;
          if (current.depth + 1 >= maxDepth || hasIncoming === 0) {
            this.addChain(state, newChain, [causeId], validEffectNodes);
          }

          // Continue traversal if not visited and below max depth
          if (!state.visited.has(causeId) && current.depth + 1 < maxDepth) {
            state.visited.add(causeId);
            state.queue.push({
              nodeId: causeId,
              depth: current.depth + 1,
              chain: newChain,
            });
          }
        }
      }
    }

    // Calculate overall confidence
    const confidence = state.chains.length > 0
      ? state.chains.reduce((sum, chain) => sum + chain.totalConfidence, 0) / state.chains.length
      : 0;

    return {
      causes: Array.from(state.endNodes),
      chains: state.chains,
      confidence,
      warnings,
      nodesExplored: state.nodesExplored,
      traversalTime: performance.now() - startTime,
    };
  }

  /**
   * Calculate overall confidence of a causal chain
   * Uses product of individual link confidences
   *
   * @param chain - Array of causal links
   * @returns Combined confidence [0.0, 1.0]
   */
  calculateChainConfidence(chain: CausalLink[]): number {
    if (chain.length === 0) {
      return 1.0;
    }

    return chain.reduce((product, link) => product * link.confidence, 1.0);
  }

  /**
   * Build human-readable explanation of causal chain
   *
   * @param graph - Graph structure for node labels
   * @param chain - Causal chain to explain
   * @returns Explanation string
   */
  buildChainExplanation(graph: GraphStructure, chain: CausalChain): string {
    if (chain.path.length === 0) {
      return 'Empty chain';
    }

    const parts: string[] = [];

    for (let i = 0; i < chain.path.length; i++) {
      const link = chain.path[i];

      // Get cause labels
      const causeLabels = link.causes
        .map((id) => graph.nodes.get(id)?.label ?? id)
        .join(' + ');

      // Get effect labels
      const effectLabels = link.effects
        .map((id) => graph.nodes.get(id)?.label ?? id)
        .join(' + ');

      const confidence = (link.confidence * 100).toFixed(1);
      parts.push(`[${causeLabels}] → [${effectLabels}] (${confidence}%)`);
    }

    const totalConfidence = (chain.totalConfidence * 100).toFixed(1);
    return parts.join(' → ') + ` | Total confidence: ${totalConfidence}%`;
  }

  /**
   * Check if adding a link would create a cycle in the chain
   */
  private wouldCreateCycle(chain: CausalLink[], newLink: CausalLink): boolean {
    // Check if any effect of the new link appears as a cause earlier in the chain
    const seenNodes = new Set<NodeID>();

    for (const link of chain) {
      for (const causeId of link.causes) {
        seenNodes.add(causeId);
      }
    }

    for (const effectId of newLink.effects) {
      if (seenNodes.has(effectId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add a complete chain to the state
   */
  private addChain(
    state: TraversalState,
    path: CausalLink[],
    startNodes: NodeID[],
    endNodes: NodeID[]
  ): void {
    const chain: CausalChain = {
      path,
      totalConfidence: this.calculateChainConfidence(path),
      hopCount: path.length,
      explanation: '', // Will be filled by caller if needed
      startNodes,
      endNodes,
    };

    state.chains.push(chain);
  }
}
