/**
 * Dependency Tracker
 * TASK-UCM-CTX-002
 *
 * Tracks agent dependencies for proper ordering and composition.
 * Uses directed graph to represent dependencies.
 * Provides topological ordering and circular dependency detection.
 */

import { BudgetExceededError } from '../errors.js';

/**
 * Dependency edge in graph
 */
interface IDependencyEdge {
  from: string;
  to: string;
  weight: number;
  reason?: string;
}

/**
 * Dependency node metadata
 */
interface IDependencyNode {
  agentId: string;
  dependencies: Set<string>;
  dependents: Set<string>;
  depth: number;
}

/**
 * Dependency Tracker
 * Manages agent dependency graph for context composition ordering
 */
export class DependencyTracker {
  private nodes: Map<string, IDependencyNode> = new Map();
  private edges: IDependencyEdge[] = [];

  /**
   * Add or update agent node
   * @param agentId - Agent to add
   */
  private ensureNode(agentId: string): IDependencyNode {
    if (!this.nodes.has(agentId)) {
      this.nodes.set(agentId, {
        agentId,
        dependencies: new Set(),
        dependents: new Set(),
        depth: 0,
      });
    }
    return this.nodes.get(agentId)!;
  }

  /**
   * Add dependency relationship
   * Creates edge: dependent -> dependency
   *
   * @param dependent - Agent that depends on another
   * @param dependency - Agent being depended on
   * @param weight - Dependency strength (default 1)
   * @param reason - Optional reason for dependency
   */
  public addDependency(
    dependent: string,
    dependency: string,
    weight: number = 1,
    reason?: string
  ): void {
    // Prevent self-dependency
    if (dependent === dependency) {
      throw new Error(`Agent cannot depend on itself: ${dependent}`);
    }

    const dependentNode = this.ensureNode(dependent);
    const dependencyNode = this.ensureNode(dependency);

    // Add edge
    dependentNode.dependencies.add(dependency);
    dependencyNode.dependents.add(dependent);

    this.edges.push({
      from: dependent,
      to: dependency,
      weight,
      reason,
    });

    // Check for cycles after adding
    if (this.hasCycle()) {
      // Rollback
      dependentNode.dependencies.delete(dependency);
      dependencyNode.dependents.delete(dependent);
      this.edges.pop();
      throw new Error(`Circular dependency detected: ${dependent} -> ${dependency}`);
    }

    // Update depths
    this.updateDepths();
  }

  /**
   * Remove dependency relationship
   * @param dependent - Dependent agent
   * @param dependency - Dependency agent
   */
  public removeDependency(dependent: string, dependency: string): void {
    const dependentNode = this.nodes.get(dependent);
    const dependencyNode = this.nodes.get(dependency);

    if (!dependentNode || !dependencyNode) return;

    dependentNode.dependencies.delete(dependency);
    dependencyNode.dependents.delete(dependent);

    // Remove edge
    this.edges = this.edges.filter(
      e => !(e.from === dependent && e.to === dependency)
    );

    this.updateDepths();
  }

  /**
   * Get direct dependencies for agent
   * @param agentId - Agent to query
   * @returns Set of agent IDs this agent depends on
   */
  public getDependencies(agentId: string): Set<string> {
    return new Set(this.nodes.get(agentId)?.dependencies ?? []);
  }

  /**
   * Get direct dependents for agent
   * @param agentId - Agent to query
   * @returns Set of agent IDs that depend on this agent
   */
  public getDependents(agentId: string): Set<string> {
    return new Set(this.nodes.get(agentId)?.dependents ?? []);
  }

  /**
   * Get all transitive dependencies (recursive)
   * @param agentId - Agent to query
   * @param visited - Track visited nodes to prevent cycles
   * @returns Set of all agents this agent transitively depends on
   */
  public getTransitiveDependencies(
    agentId: string,
    visited: Set<string> = new Set()
  ): Set<string> {
    if (visited.has(agentId)) return new Set();
    visited.add(agentId);

    const result = new Set<string>();
    const direct = this.getDependencies(agentId);

    for (const dep of direct) {
      result.add(dep);
      const transitive = this.getTransitiveDependencies(dep, visited);
      transitive.forEach(t => result.add(t));
    }

    return result;
  }

  /**
   * Get topological ordering of agents
   * Dependencies come before dependents
   *
   * @param agents - Optional subset of agents to order
   * @returns Ordered array (dependencies first)
   */
  public getTopologicalOrder(agents?: string[]): string[] {
    const agentSet = agents ? new Set(agents) : new Set(this.nodes.keys());
    const result: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (agentId: string): void => {
      if (!agentSet.has(agentId)) return;
      if (visited.has(agentId)) return;
      if (temp.has(agentId)) {
        throw new Error(`Circular dependency detected at ${agentId}`);
      }

      temp.add(agentId);

      // Visit dependencies first
      const deps = this.getDependencies(agentId);
      for (const dep of deps) {
        visit(dep);
      }

      temp.delete(agentId);
      visited.add(agentId);
      result.push(agentId);
    };

    for (const agentId of agentSet) {
      if (!visited.has(agentId)) {
        visit(agentId);
      }
    }

    return result;
  }

  /**
   * Detect if graph has cycles
   * @returns True if circular dependencies exist
   */
  public hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycleUtil = (agentId: string): boolean => {
      visited.add(agentId);
      recursionStack.add(agentId);

      const deps = this.getDependencies(agentId);
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (hasCycleUtil(dep)) return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(agentId);
      return false;
    };

    for (const agentId of this.nodes.keys()) {
      if (!visited.has(agentId)) {
        if (hasCycleUtil(agentId)) return true;
      }
    }

    return false;
  }

  /**
   * Update depth levels for all nodes
   * Depth = longest path from root nodes
   */
  private updateDepths(): void {
    // Reset depths
    for (const node of this.nodes.values()) {
      node.depth = 0;
    }

    // Calculate depths using topological order
    try {
      const order = this.getTopologicalOrder();
      for (const agentId of order) {
        const node = this.nodes.get(agentId)!;
        const deps = this.getDependencies(agentId);

        if (deps.size === 0) {
          node.depth = 0;
        } else {
          const maxDepth = Math.max(
            ...Array.from(deps).map(dep => this.nodes.get(dep)?.depth ?? 0)
          );
          node.depth = maxDepth + 1;
        }
      }
    } catch (error) {
      // Cycle detected, depths may be incorrect
      console.warn('Cannot update depths: circular dependency detected');
    }
  }

  /**
   * Get dependency depth for agent
   * @param agentId - Agent to query
   * @returns Depth level (0 = no dependencies)
   */
  public getDepth(agentId: string): number {
    return this.nodes.get(agentId)?.depth ?? 0;
  }

  /**
   * Get all edges in dependency graph
   * @returns Array of dependency edges
   */
  public getEdges(): readonly IDependencyEdge[] {
    return [...this.edges];
  }

  /**
   * Get dependency graph statistics
   * @returns Graph metrics
   */
  public getStats() {
    const depths = Array.from(this.nodes.values()).map(n => n.depth);

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      maxDepth: depths.length > 0 ? Math.max(...depths) : 0,
      avgDependencies: this.nodes.size > 0
        ? this.edges.length / this.nodes.size
        : 0,
      hasCycle: this.hasCycle(),
      rootNodes: Array.from(this.nodes.values())
        .filter(n => n.dependencies.size === 0)
        .map(n => n.agentId),
      leafNodes: Array.from(this.nodes.values())
        .filter(n => n.dependents.size === 0)
        .map(n => n.agentId),
    };
  }

  /**
   * Clear all dependencies
   */
  public clear(): void {
    this.nodes.clear();
    this.edges = [];
  }

  /**
   * Remove agent and all its dependencies
   * @param agentId - Agent to remove
   */
  public removeAgent(agentId: string): void {
    const node = this.nodes.get(agentId);
    if (!node) return;

    // Remove all edges involving this agent
    this.edges = this.edges.filter(
      e => e.from !== agentId && e.to !== agentId
    );

    // Update other nodes
    for (const dep of node.dependencies) {
      this.nodes.get(dep)?.dependents.delete(agentId);
    }
    for (const dependent of node.dependents) {
      this.nodes.get(dependent)?.dependencies.delete(agentId);
    }

    this.nodes.delete(agentId);
    this.updateDepths();
  }
}
