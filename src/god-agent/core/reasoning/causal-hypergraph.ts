/**
 * CausalHypergraph - Core data structure for causal reasoning
 * Supports hyperedges with multiple causes and effects (A+B+C→D+E)
 * Maintains bidirectional indices for efficient traversal
 */

import { randomUUID } from 'crypto';
import type {
  NodeID,
  CausalNode,
  CausalLink,
  AddCausalLinkParams,
  SerializedCausalGraph,
  CausalGraphStats,
} from './causal-types.js';
import { CycleDetector } from './cycle-detector.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../observability/index.js';

const logger = createComponentLogger('CausalHypergraph', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler()]
});

/**
 * Hypergraph data structure for causal relationships
 * Supports multi-cause, multi-effect relationships with efficient indexing
 */
export class CausalHypergraph {
  /** All nodes in the graph */
  private nodes: Map<NodeID, CausalNode>;

  /** All causal links (hyperedges) */
  private links: Map<string, CausalLink>;

  /** Forward index: node → outgoing link IDs */
  private forwardIndex: Map<NodeID, Set<string>>;

  /** Backward index: node → incoming link IDs */
  private backwardIndex: Map<NodeID, Set<string>>;

  /** Cycle detector for preventing infinite loops */
  private cycleDetector: CycleDetector;

  constructor() {
    this.nodes = new Map();
    this.links = new Map();
    this.forwardIndex = new Map();
    this.backwardIndex = new Map();
    this.cycleDetector = new CycleDetector();
  }

  /**
   * Add a new node to the graph
   *
   * @param node - Causal node to add
   * @throws Error if node with same ID already exists
   */
  addNode(node: CausalNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with ID '${node.id}' already exists`);
    }

    const timestamp = Date.now();
    const nodeWithTimestamps: CausalNode = {
      ...node,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.nodes.set(node.id, nodeWithTimestamps);

    // Initialize indices for this node
    if (!this.forwardIndex.has(node.id)) {
      this.forwardIndex.set(node.id, new Set());
    }
    if (!this.backwardIndex.has(node.id)) {
      this.backwardIndex.set(node.id, new Set());
    }
  }

  /**
   * Add a causal link (hyperedge) to the graph
   * Validates that all cause and effect nodes exist
   * Checks for cycles before adding
   *
   * @param params - Link parameters
   * @returns The created causal link
   * @throws Error if nodes don't exist or cycle would be created
   */
  addCausalLink(params: AddCausalLinkParams): CausalLink {
    const startTime = performance.now();

    // Validate causes exist
    for (const causeId of params.causes) {
      if (!this.nodes.has(causeId)) {
        throw new Error(`Cause node '${causeId}' not found in graph`);
      }
    }

    // Validate effects exist
    for (const effectId of params.effects) {
      if (!this.nodes.has(effectId)) {
        throw new Error(`Effect node '${effectId}' not found in graph`);
      }
    }

    // Validate confidence and strength
    if (params.confidence < 0 || params.confidence > 1) {
      throw new Error(`Confidence must be in [0, 1], got ${params.confidence}`);
    }
    if (params.strength < 0 || params.strength > 1) {
      throw new Error(`Strength must be in [0, 1], got ${params.strength}`);
    }

    // Create temporary link for cycle detection
    const linkId = randomUUID();
    const tempLink: CausalLink = {
      id: linkId,
      causes: params.causes,
      effects: params.effects,
      confidence: params.confidence,
      strength: params.strength,
      metadata: params.metadata,
    };

    // Check for cycles
    const cycleCheck = this.cycleDetector.wouldCreateCycle(
      {
        nodes: this.nodes,
        links: this.links,
        forwardIndex: this.forwardIndex,
        backwardIndex: this.backwardIndex,
      },
      tempLink
    );

    if (cycleCheck.wouldCreateCycle) {
      const cyclePath = cycleCheck.cyclePath?.join(' → ') ?? 'unknown';
      throw new Error(
        `Adding this link would create a cycle: ${cyclePath}. ` +
        `Use cycle-free relationships or enable cycle tolerance.`
      );
    }

    // Create final link with timestamps
    const timestamp = Date.now();
    const link: CausalLink = {
      ...tempLink,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Add link to graph
    this.links.set(linkId, link);

    // Update forward index (causes → link)
    for (const causeId of link.causes) {
      const outgoing = this.forwardIndex.get(causeId) ?? new Set();
      outgoing.add(linkId);
      this.forwardIndex.set(causeId, outgoing);
    }

    // Update backward index (effects → link)
    for (const effectId of link.effects) {
      const incoming = this.backwardIndex.get(effectId) ?? new Set();
      incoming.add(linkId);
      this.backwardIndex.set(effectId, incoming);
    }

    // Verify performance requirement (<2ms)
    const elapsed = performance.now() - startTime;
    if (elapsed > 2) {
      logger.warn('Link addition exceeds performance requirement', { elapsedMs: elapsed, requirementMs: 2 });
    }

    return link;
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: NodeID): CausalNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get a link by ID
   */
  getLink(linkId: string): CausalLink | undefined {
    return this.links.get(linkId);
  }

  /**
   * Get all nodes in the graph
   */
  getNodes(): CausalNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all links in the graph
   */
  getLinks(): CausalLink[] {
    return Array.from(this.links.values());
  }

  /**
   * Get all outgoing links from a node
   */
  getOutgoingLinks(nodeId: NodeID): CausalLink[] {
    const linkIds = this.forwardIndex.get(nodeId);
    if (!linkIds) {
      return [];
    }

    return Array.from(linkIds)
      .map((id) => this.links.get(id))
      .filter((link): link is CausalLink => link !== undefined);
  }

  /**
   * Get all incoming links to a node
   */
  getIncomingLinks(nodeId: NodeID): CausalLink[] {
    const linkIds = this.backwardIndex.get(nodeId);
    if (!linkIds) {
      return [];
    }

    return Array.from(linkIds)
      .map((id) => this.links.get(id))
      .filter((link): link is CausalLink => link !== undefined);
  }

  /**
   * Update an existing node
   */
  updateNode(nodeId: NodeID, updates: Partial<Omit<CausalNode, 'id'>>): void {
    const existing = this.nodes.get(nodeId);
    if (!existing) {
      throw new Error(`Node '${nodeId}' not found`);
    }

    const updated: CausalNode = {
      ...existing,
      ...updates,
      id: nodeId, // Ensure ID doesn't change
      updatedAt: Date.now(),
    };

    this.nodes.set(nodeId, updated);
  }

  /**
   * Update an existing link
   */
  updateLink(linkId: string, updates: Partial<Omit<CausalLink, 'id' | 'causes' | 'effects'>>): void {
    const existing = this.links.get(linkId);
    if (!existing) {
      throw new Error(`Link '${linkId}' not found`);
    }

    // Validate updated confidence/strength if provided
    if (updates.confidence !== undefined && (updates.confidence < 0 || updates.confidence > 1)) {
      throw new Error(`Confidence must be in [0, 1], got ${updates.confidence}`);
    }
    if (updates.strength !== undefined && (updates.strength < 0 || updates.strength > 1)) {
      throw new Error(`Strength must be in [0, 1], got ${updates.strength}`);
    }

    const updated: CausalLink = {
      ...existing,
      ...updates,
      id: linkId,
      causes: existing.causes, // Cannot change structure
      effects: existing.effects,
      updatedAt: Date.now(),
    };

    this.links.set(linkId, updated);
  }

  /**
   * Remove a node and all connected links
   */
  removeNode(nodeId: NodeID): void {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node '${nodeId}' not found`);
    }

    // Remove all links involving this node
    const affectedLinks = new Set<string>();

    // Collect links from forward index
    const outgoing = this.forwardIndex.get(nodeId);
    if (outgoing) {
      outgoing.forEach((linkId) => affectedLinks.add(linkId));
    }

    // Collect links from backward index
    const incoming = this.backwardIndex.get(nodeId);
    if (incoming) {
      incoming.forEach((linkId) => affectedLinks.add(linkId));
    }

    // Remove all affected links
    for (const linkId of affectedLinks) {
      this.removeLink(linkId);
    }

    // Remove node
    this.nodes.delete(nodeId);
    this.forwardIndex.delete(nodeId);
    this.backwardIndex.delete(nodeId);
  }

  /**
   * Remove a link from the graph
   */
  removeLink(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) {
      throw new Error(`Link '${linkId}' not found`);
    }

    // Remove from forward index
    for (const causeId of link.causes) {
      const outgoing = this.forwardIndex.get(causeId);
      if (outgoing) {
        outgoing.delete(linkId);
      }
    }

    // Remove from backward index
    for (const effectId of link.effects) {
      const incoming = this.backwardIndex.get(effectId);
      if (incoming) {
        incoming.delete(linkId);
      }
    }

    // Remove link
    this.links.delete(linkId);
  }

  /**
   * Get statistics about the graph
   */
  getStats(): CausalGraphStats {
    const links = Array.from(this.links.values());
    const nodes = Array.from(this.nodes.values());

    const avgConfidence = links.length > 0
      ? links.reduce((sum, link) => sum + link.confidence, 0) / links.length
      : 0;

    const avgStrength = links.length > 0
      ? links.reduce((sum, link) => sum + link.strength, 0) / links.length
      : 0;

    const avgCausesPerLink = links.length > 0
      ? links.reduce((sum, link) => sum + link.causes.length, 0) / links.length
      : 0;

    const avgEffectsPerLink = links.length > 0
      ? links.reduce((sum, link) => sum + link.effects.length, 0) / links.length
      : 0;

    const nodesByType = nodes.reduce(
      (acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      nodeCount: this.nodes.size,
      linkCount: this.links.size,
      avgConfidence,
      avgStrength,
      conceptCount: nodesByType.concept || 0,
      actionCount: nodesByType.action || 0,
      stateCount: nodesByType.state || 0,
      avgCausesPerLink,
      avgEffectsPerLink,
    };
  }

  /**
   * Serialize graph to JSON for persistence
   */
  toJSON(): SerializedCausalGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      links: Array.from(this.links.values()),
      metadata: {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
  }

  /**
   * Deserialize graph from JSON
   */
  static fromJSON(data: SerializedCausalGraph): CausalHypergraph {
    const graph = new CausalHypergraph();

    // Add all nodes first
    for (const node of data.nodes) {
      graph.nodes.set(node.id, node);
      graph.forwardIndex.set(node.id, new Set());
      graph.backwardIndex.set(node.id, new Set());
    }

    // Add all links
    for (const link of data.links) {
      graph.links.set(link.id, link);

      // Update indices
      for (const causeId of link.causes) {
        const outgoing = graph.forwardIndex.get(causeId);
        if (outgoing) {
          outgoing.add(link.id);
        }
      }

      for (const effectId of link.effects) {
        const incoming = graph.backwardIndex.get(effectId);
        if (incoming) {
          incoming.add(link.id);
        }
      }
    }

    return graph;
  }

  /**
   * Clear all data from the graph
   */
  clear(): void {
    this.nodes.clear();
    this.links.clear();
    this.forwardIndex.clear();
    this.backwardIndex.clear();
    this.cycleDetector.clearCache();
  }

  /**
   * Get internal structure for traversal (used by CycleDetector and CausalTraversal)
   */
  getGraphStructure() {
    return {
      nodes: this.nodes,
      links: this.links,
      forwardIndex: this.forwardIndex,
      backwardIndex: this.backwardIndex,
    };
  }
}
