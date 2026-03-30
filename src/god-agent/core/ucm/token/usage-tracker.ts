/**
 * Usage Tracker (BDG-002)
 * Tracks token usage across agents and workflow phases
 *
 * Constitution Rules Applied:
 * - RULE-007: contextWindow = 100,000 tokens
 * - RULE-041: warningThreshold = 80%
 * - RULE-042: summarizationThreshold = 70%
 */

import { EventEmitter } from 'events';
import type { ITokenConfig } from '../types.js';
import { DEFAULT_UCM_CONFIG } from '../config.js';

export interface IUsageRecord {
  agent: string;
  phase: string;
  tokens: number;
  timestamp: number;
  operation: string;
}

export interface IAgentUsage {
  agent: string;
  totalTokens: number;
  recordCount: number;
  firstSeen: number;
  lastSeen: number;
  operations: Map<string, number>;
}

export interface IPhaseUsage {
  phase: string;
  totalTokens: number;
  agents: Set<string>;
  recordCount: number;
  startTime: number;
  lastUpdate: number;
}

export interface IUsageSnapshot {
  totalUsage: number;
  agentCount: number;
  phaseCount: number;
  recordCount: number;
  timestamp: number;
}

export interface IWarningEvent {
  type: 'warning' | 'critical';
  message: string;
  usage: number;
  threshold: number;
  percentUsed: number;
  phase?: string;
  agent?: string;
}

/**
 * Tracks token usage with warnings at configurable thresholds
 */
export class UsageTracker extends EventEmitter {
  private config: ITokenConfig;
  private records: IUsageRecord[];
  private agentUsage: Map<string, IAgentUsage>;
  private phaseUsage: Map<string, IPhaseUsage>;
  private warningEmitted: Set<string>;

  constructor(config: ITokenConfig = DEFAULT_UCM_CONFIG.tokenManagement.defaults) {
    super();
    this.config = config;
    this.records = [];
    this.agentUsage = new Map();
    this.phaseUsage = new Map();
    this.warningEmitted = new Set();
  }

  /**
   * Record token usage for an agent operation
   * @param agent - Agent identifier
   * @param phase - Workflow phase
   * @param tokens - Number of tokens used
   * @param operation - Operation description
   */
  recordUsage(agent: string, phase: string, tokens: number, operation: string = 'unknown'): void {
    const timestamp = Date.now();

    // Create usage record
    const record: IUsageRecord = {
      agent,
      phase,
      tokens,
      timestamp,
      operation
    };

    this.records.push(record);

    // Update agent usage
    this.updateAgentUsage(agent, tokens, timestamp, operation);

    // Update phase usage
    this.updatePhaseUsage(phase, agent, tokens, timestamp);

    // Check thresholds and emit warnings
    this.checkThresholds(phase);
  }

  /**
   * Update agent-specific usage tracking
   */
  private updateAgentUsage(
    agent: string,
    tokens: number,
    timestamp: number,
    operation: string
  ): void {
    let usage = this.agentUsage.get(agent);

    if (!usage) {
      usage = {
        agent,
        totalTokens: 0,
        recordCount: 0,
        firstSeen: timestamp,
        lastSeen: timestamp,
        operations: new Map()
      };
      this.agentUsage.set(agent, usage);
    }

    usage.totalTokens += tokens;
    usage.recordCount += 1;
    usage.lastSeen = timestamp;

    // Track per-operation usage
    const opTokens = usage.operations.get(operation) || 0;
    usage.operations.set(operation, opTokens + tokens);
  }

  /**
   * Update phase-specific usage tracking
   */
  private updatePhaseUsage(
    phase: string,
    agent: string,
    tokens: number,
    timestamp: number
  ): void {
    let usage = this.phaseUsage.get(phase);

    if (!usage) {
      usage = {
        phase,
        totalTokens: 0,
        agents: new Set(),
        recordCount: 0,
        startTime: timestamp,
        lastUpdate: timestamp
      };
      this.phaseUsage.set(phase, usage);
    }

    usage.totalTokens += tokens;
    usage.agents.add(agent);
    usage.recordCount += 1;
    usage.lastUpdate = timestamp;
  }

  /**
   * Check usage thresholds and emit warnings
   * RULE-041: warningThreshold = 80%
   */
  private checkThresholds(phase: string): void {
    const phaseUsage = this.phaseUsage.get(phase);
    if (!phaseUsage) return;

    const totalUsage = this.getTotalUsage();
    const contextWindow = this.config.contextWindow ?? 200000;
    const percentUsed = (totalUsage / contextWindow) * 100;

    // Warning threshold (80%)
    const warningThreshold = this.config.warningThreshold ?? 0.8;
    const warningKey = `warning-${phase}`;

    if (percentUsed >= warningThreshold && !this.warningEmitted.has(warningKey)) {
      this.warningEmitted.add(warningKey);

      const warningEvent: IWarningEvent = {
        type: 'warning',
        message: `Token usage reached ${percentUsed.toFixed(1)}% of context window`,
        usage: totalUsage,
        threshold: warningThreshold as number,
        percentUsed,
        phase
      };

      this.emit('usage-warning', warningEvent);
    }

    // Critical threshold (95%)
    const criticalThreshold = 95;
    const criticalKey = `critical-${phase}`;

    if (percentUsed >= criticalThreshold && !this.warningEmitted.has(criticalKey)) {
      this.warningEmitted.add(criticalKey);

      const criticalEvent: IWarningEvent = {
        type: 'critical',
        message: `Critical: Token usage at ${percentUsed.toFixed(1)}% of context window`,
        usage: totalUsage,
        threshold: criticalThreshold,
        percentUsed,
        phase
      };

      this.emit('usage-critical', criticalEvent);
    }
  }

  /**
   * Get usage statistics for a specific agent
   */
  getUsage(agent: string): IAgentUsage | undefined {
    return this.agentUsage.get(agent);
  }

  /**
   * Get usage statistics for a specific phase
   */
  getPhaseUsage(phase: string): IPhaseUsage | undefined {
    return this.phaseUsage.get(phase);
  }

  /**
   * Get total token usage across all agents and phases
   */
  getTotalUsage(): number {
    return this.records.reduce((sum, record) => sum + record.tokens, 0);
  }

  /**
   * Get usage snapshot at current time
   */
  getSnapshot(): IUsageSnapshot {
    return {
      totalUsage: this.getTotalUsage(),
      agentCount: this.agentUsage.size,
      phaseCount: this.phaseUsage.size,
      recordCount: this.records.length,
      timestamp: Date.now()
    };
  }

  /**
   * Get all agent usage statistics
   */
  getAllAgentUsage(): Map<string, IAgentUsage> {
    return new Map(this.agentUsage);
  }

  /**
   * Get all phase usage statistics
   */
  getAllPhaseUsage(): Map<string, IPhaseUsage> {
    return new Map(this.phaseUsage);
  }

  /**
   * Get usage records filtered by criteria
   */
  getRecords(filter?: {
    agent?: string;
    phase?: string;
    startTime?: number;
    endTime?: number;
  }): IUsageRecord[] {
    if (!filter) return [...this.records];

    return this.records.filter(record => {
      if (filter.agent && record.agent !== filter.agent) return false;
      if (filter.phase && record.phase !== filter.phase) return false;
      if (filter.startTime && record.timestamp < filter.startTime) return false;
      if (filter.endTime && record.timestamp > filter.endTime) return false;
      return true;
    });
  }

  /**
   * Get top agents by token usage
   */
  getTopAgents(limit: number = 10): IAgentUsage[] {
    return Array.from(this.agentUsage.values())
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, limit);
  }

  /**
   * Get phases sorted by token usage
   */
  getPhasesByUsage(): IPhaseUsage[] {
    const phases = Array.from(this.phaseUsage.values());
    return phases.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  /**
   * Reset usage tracking for a specific phase
   */
  resetPhase(phase: string): void {
    // Remove phase usage
    this.phaseUsage.delete(phase);

    // Remove records for this phase
    this.records = this.records.filter(r => r.phase !== phase);

    // Clear warnings for this phase
    this.warningEmitted.delete(`warning-${phase}`);
    this.warningEmitted.delete(`critical-${phase}`);

    // Recalculate agent usage
    this.recalculateAgentUsage();
  }

  /**
   * Recalculate agent usage from remaining records
   */
  private recalculateAgentUsage(): void {
    this.agentUsage.clear();

    for (const record of this.records) {
      this.updateAgentUsage(
        record.agent,
        record.tokens,
        record.timestamp,
        record.operation
      );
    }
  }

  /**
   * Reset all usage tracking
   */
  resetAll(): void {
    this.records = [];
    this.agentUsage.clear();
    this.phaseUsage.clear();
    this.warningEmitted.clear();
  }

  /**
   * Get all phase names
   */
  getPhaseNames(): string[] {
    return Array.from(this.phaseUsage.keys());
  }

  /**
   * Export usage data for analysis
   */
  exportData(): {
    records: IUsageRecord[];
    agentUsage: IAgentUsage[];
    phaseUsage: IPhaseUsage[];
    snapshot: IUsageSnapshot;
  } {
    return {
      records: [...this.records],
      agentUsage: Array.from(this.agentUsage.values()),
      phaseUsage: Array.from(this.phaseUsage.values()),
      snapshot: this.getSnapshot()
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ITokenConfig>): void {
    this.config = { ...this.config, ...config };

    // Re-check thresholds with new config
    const phaseNames = this.getPhaseNames();
    for (const phase of phaseNames) {
      this.warningEmitted.delete(`warning-${phase}`);
      this.warningEmitted.delete(`critical-${phase}`);
      this.checkThresholds(phase);
    }
  }
}
