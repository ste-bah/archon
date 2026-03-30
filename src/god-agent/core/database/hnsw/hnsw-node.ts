/**
 * HNSW Graph Node
 *
 * Implements: TASK-PERF-001 (Native HNSW backend)
 * Referenced by: HNSWIndex
 *
 * Represents a single node in the HNSW graph structure.
 * Each node has connections at multiple levels forming a navigable small world graph.
 */

/**
 * Node in the HNSW graph
 *
 * Each node stores:
 * - Unique identifier
 * - Reference to vector data (stored separately for memory efficiency)
 * - Maximum level in the hierarchy (0 = bottom level only)
 * - Connections at each level (neighbors)
 */
export class HNSWNode {
  /** Unique node identifier */
  readonly id: string;

  /** Maximum level this node appears at (0-indexed) */
  level: number;

  /** Neighbors at each level: level -> Set of neighbor IDs */
  readonly connections: Map<number, Set<string>>;

  /**
   * Create a new HNSW node
   *
   * @param id - Unique identifier for the node
   * @param level - Maximum level this node will appear at
   */
  constructor(id: string, level: number = 0) {
    this.id = id;
    this.level = level;
    this.connections = new Map();

    // Initialize connection sets for each level
    for (let l = 0; l <= level; l++) {
      this.connections.set(l, new Set());
    }
  }

  /**
   * Add a connection to a neighbor at a specific level
   *
   * @param level - The level at which to add the connection
   * @param neighborId - The ID of the neighbor node
   */
  addConnection(level: number, neighborId: string): void {
    if (level > this.level) {
      throw new Error(`Cannot add connection at level ${level} for node at max level ${this.level}`);
    }

    let neighbors = this.connections.get(level);
    if (!neighbors) {
      neighbors = new Set();
      this.connections.set(level, neighbors);
    }
    neighbors.add(neighborId);
  }

  /**
   * Remove a connection to a neighbor at a specific level
   *
   * @param level - The level at which to remove the connection
   * @param neighborId - The ID of the neighbor node
   * @returns true if the connection was removed, false if it didn't exist
   */
  removeConnection(level: number, neighborId: string): boolean {
    const neighbors = this.connections.get(level);
    if (!neighbors) {
      return false;
    }
    return neighbors.delete(neighborId);
  }

  /**
   * Get all neighbors at a specific level
   *
   * @param level - The level to get neighbors from
   * @returns Set of neighbor IDs (empty set if level doesn't exist)
   */
  getNeighbors(level: number): Set<string> {
    return this.connections.get(level) || new Set();
  }

  /**
   * Get the number of connections at a specific level
   *
   * @param level - The level to count connections at
   * @returns Number of connections
   */
  getConnectionCount(level: number): number {
    return this.connections.get(level)?.size || 0;
  }

  /**
   * Check if this node has a connection to another node at a level
   *
   * @param level - The level to check
   * @param neighborId - The ID of the potential neighbor
   * @returns true if connected
   */
  isConnected(level: number, neighborId: string): boolean {
    return this.connections.get(level)?.has(neighborId) || false;
  }

  /**
   * Get the total number of connections across all levels
   *
   * @returns Total connection count
   */
  getTotalConnections(): number {
    let total = 0;
    for (const neighbors of this.connections.values()) {
      total += neighbors.size;
    }
    return total;
  }

  /**
   * Clear all connections at a specific level
   *
   * @param level - The level to clear
   */
  clearLevel(level: number): void {
    const neighbors = this.connections.get(level);
    if (neighbors) {
      neighbors.clear();
    }
  }

  /**
   * Serialize the node for persistence
   *
   * @returns Serialized node data
   */
  serialize(): { id: string; level: number; connections: Array<[number, string[]]> } {
    const connections: Array<[number, string[]]> = [];
    for (const [level, neighbors] of this.connections.entries()) {
      connections.push([level, Array.from(neighbors)]);
    }
    return {
      id: this.id,
      level: this.level,
      connections
    };
  }

  /**
   * Deserialize a node from persistence data
   *
   * @param data - Serialized node data
   * @returns Reconstructed node
   */
  static deserialize(data: { id: string; level: number; connections: Array<[number, string[]]> }): HNSWNode {
    const node = new HNSWNode(data.id, data.level);
    for (const [level, neighbors] of data.connections) {
      const neighborSet = node.connections.get(level) || new Set();
      for (const neighborId of neighbors) {
        neighborSet.add(neighborId);
      }
      node.connections.set(level, neighborSet);
    }
    return node;
  }
}
