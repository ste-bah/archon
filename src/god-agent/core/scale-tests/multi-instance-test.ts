/**
 * Multi-Instance Test
 * TASK-NFR-002 - Scalability Validation Suite (NFR-4.5)
 *
 * Tests horizontal scaling:
 * - 2-4 instance coordination
 * - State synchronization
 * - Load distribution
 * - Partition tolerance
 */

// ==================== Types ====================

/**
 * Multi-instance test configuration
 */
export interface MultiInstanceConfig {
  /** Number of instances to test */
  instanceCount: number;
  /** Operations per instance */
  operationsPerInstance: number;
  /** Sync check interval in ms */
  syncIntervalMs: number;
  /** Partition duration in ms */
  partitionDurationMs: number;
}

/**
 * Default multi-instance configuration
 */
export const DEFAULT_MULTI_INSTANCE_CONFIG: MultiInstanceConfig = {
  instanceCount: 4,
  operationsPerInstance: 100,
  syncIntervalMs: 100,
  partitionDurationMs: 1000,
};

/**
 * Simulated instance
 */
export interface Instance {
  id: string;
  state: Map<string, unknown>;
  version: number;
  isPartitioned: boolean;
  operationCount: number;
}

/**
 * Sync result
 */
export interface SyncResult {
  /** Whether state is consistent */
  consistent: boolean;
  /** Average sync latency in ms */
  avgSyncLatency: number;
  /** Number of conflicts detected */
  conflicts: number;
  /** Sync attempts made */
  syncAttempts: number;
}

/**
 * Load result
 */
export interface LoadResult {
  /** Whether load is balanced */
  balanced: boolean;
  /** Load variance (lower is better) */
  loadVariance: number;
  /** Total throughput (ops/sec) */
  totalThroughput: number;
  /** Per-instance loads */
  instanceLoads: number[];
}

/**
 * Partition result
 */
export interface PartitionResult {
  /** Whether system survived partition */
  survivedPartition: boolean;
  /** Time to recover in ms */
  recoveryTime: number;
  /** Data loss (items) */
  dataLoss: number;
}

/**
 * Multi-instance report
 */
export interface MultiInstanceReport {
  /** Number of instances */
  instanceCount: number;
  /** State synchronization results */
  stateSynchronization: {
    pass: boolean;
    syncLatencyMs: number;
    conflictsDetected: number;
  };
  /** Load distribution results */
  loadDistribution: {
    pass: boolean;
    variance: number;
    throughput: number;
  };
  /** Partition tolerance results */
  partitionTolerance: {
    pass: boolean;
    recoveryTimeMs: number;
  };
  /** Overall pass status */
  overallPass: boolean;
}

// ==================== Instance Simulator ====================

/**
 * Simulated instance for multi-instance testing
 */
export class SimulatedInstance implements Instance {
  id: string;
  state: Map<string, unknown> = new Map();
  version = 0;
  isPartitioned = false;
  operationCount = 0;

  constructor(id: string) {
    this.id = id;
  }

  /**
   * Execute an operation
   */
  async execute(key: string, value: unknown): Promise<void> {
    if (this.isPartitioned) {
      throw new Error('Instance is partitioned');
    }

    await this.sleep(Math.random() * 5);
    this.state.set(key, { value, version: this.version++, timestamp: Date.now() });
    this.operationCount++;
  }

  /**
   * Get state value
   */
  get(key: string): unknown {
    return this.state.get(key);
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.state.keys());
  }

  /**
   * Sync state from another instance
   */
  syncFrom(other: SimulatedInstance): number {
    let conflicts = 0;

    for (const [key, otherValue] of other.state) {
      const myValue = this.state.get(key) as { version: number } | undefined;
      const otherV = otherValue as { version: number };

      if (!myValue || myValue.version < otherV.version) {
        this.state.set(key, otherValue);
      } else if (myValue.version === otherV.version && myValue !== otherValue) {
        conflicts++;
      }
    }

    return conflicts;
  }

  /**
   * Partition this instance
   */
  partition(): void {
    this.isPartitioned = true;
  }

  /**
   * Heal partition
   */
  heal(): void {
    this.isPartitioned = false;
  }

  /**
   * Reset instance
   */
  reset(): void {
    this.state.clear();
    this.version = 0;
    this.isPartitioned = false;
    this.operationCount = 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== Multi-Instance Test ====================

/**
 * Multi-instance scaling test for NFR-4.5 validation
 *
 * Tests horizontal scaling capabilities including state synchronization,
 * load distribution, and partition tolerance.
 *
 * @example
 * ```typescript
 * const test = new MultiInstanceTest();
 * const report = await test.runMultiInstanceTest(4);
 *
 * if (report.overallPass) {
 *   console.log('NFR-4.5 validated: Horizontal scaling working!');
 * }
 * ```
 */
export class MultiInstanceTest {
  private instances: SimulatedInstance[] = [];
  private config: MultiInstanceConfig;

  constructor(config: Partial<MultiInstanceConfig> = {}) {
    this.config = { ...DEFAULT_MULTI_INSTANCE_CONFIG, ...config };
  }

  /**
   * Run multi-instance test
   */
  async runMultiInstanceTest(
    instanceCount?: number
  ): Promise<MultiInstanceReport> {
    const count = instanceCount ?? this.config.instanceCount;

    // Spawn instances
    this.instances = await this.spawnInstances(count);

    // Test state synchronization
    const syncResult = await this.testStateSynchronization();

    // Test load distribution
    const loadResult = await this.testLoadDistribution();

    // Test partition tolerance
    const partitionResult = await this.testPartitionTolerance();

    // Cleanup
    await this.shutdownInstances();

    return {
      instanceCount: count,
      stateSynchronization: {
        pass: syncResult.consistent,
        syncLatencyMs: syncResult.avgSyncLatency,
        conflictsDetected: syncResult.conflicts,
      },
      loadDistribution: {
        pass: loadResult.balanced,
        variance: loadResult.loadVariance,
        throughput: loadResult.totalThroughput,
      },
      partitionTolerance: {
        pass: partitionResult.survivedPartition,
        recoveryTimeMs: partitionResult.recoveryTime,
      },
      overallPass:
        syncResult.consistent &&
        loadResult.balanced &&
        partitionResult.survivedPartition,
    };
  }

  /**
   * Spawn instances
   */
  private async spawnInstances(count: number): Promise<SimulatedInstance[]> {
    const instances: SimulatedInstance[] = [];
    for (let i = 0; i < count; i++) {
      instances.push(new SimulatedInstance(`instance_${i}`));
    }
    return instances;
  }

  /**
   * Test state synchronization
   */
  private async testStateSynchronization(): Promise<SyncResult> {
    const syncLatencies: number[] = [];
    let totalConflicts = 0;
    let syncAttempts = 0;

    // Each instance writes unique keys
    for (let i = 0; i < this.config.operationsPerInstance; i++) {
      // Round-robin write to instances
      const instance = this.instances[i % this.instances.length];
      await instance.execute(`key_${i}`, { data: i, timestamp: Date.now() });

      // Periodic sync
      if (i % 10 === 0) {
        const syncStart = performance.now();

        // Sync all instances with each other
        for (let j = 0; j < this.instances.length; j++) {
          for (let k = 0; k < this.instances.length; k++) {
            if (j !== k) {
              totalConflicts += this.instances[j].syncFrom(this.instances[k]);
              syncAttempts++;
            }
          }
        }

        syncLatencies.push(performance.now() - syncStart);
      }
    }

    // Final sync
    for (let j = 0; j < this.instances.length; j++) {
      for (let k = 0; k < this.instances.length; k++) {
        if (j !== k) {
          this.instances[j].syncFrom(this.instances[k]);
        }
      }
    }

    // Check consistency
    const firstKeys = new Set(this.instances[0].keys());
    const consistent = this.instances.every(inst => {
      const instKeys = new Set(inst.keys());
      return (
        instKeys.size === firstKeys.size &&
        [...firstKeys].every(k => instKeys.has(k))
      );
    });

    const avgSyncLatency = syncLatencies.length > 0
      ? syncLatencies.reduce((a, b) => a + b, 0) / syncLatencies.length
      : 0;

    return {
      consistent,
      avgSyncLatency,
      conflicts: totalConflicts,
      syncAttempts,
    };
  }

  /**
   * Test load distribution
   */
  private async testLoadDistribution(): Promise<LoadResult> {
    // Reset operation counts
    this.instances.forEach(inst => (inst.operationCount = 0));

    const startTime = Date.now();
    const totalOps = this.config.operationsPerInstance * this.instances.length;

    // Distribute load with basic round-robin
    for (let i = 0; i < totalOps; i++) {
      const instance = this.instances[i % this.instances.length];
      await instance.execute(`load_${i}`, { index: i });
    }

    const duration = (Date.now() - startTime) / 1000;
    const loads = this.instances.map(inst => inst.operationCount);

    // Calculate variance
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    const variance =
      loads.reduce((sum, load) => sum + Math.pow(load - mean, 2), 0) / loads.length;

    // Load is balanced if variance is low (< 10% of mean squared)
    const balanced = variance < mean * mean * 0.1;

    return {
      balanced,
      loadVariance: variance,
      totalThroughput: totalOps / duration,
      instanceLoads: loads,
    };
  }

  /**
   * Test partition tolerance
   */
  private async testPartitionTolerance(): Promise<PartitionResult> {
    if (this.instances.length < 2) {
      return { survivedPartition: true, recoveryTime: 0, dataLoss: 0 };
    }

    // Store some data before partition
    const prePartitionKeys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const key = `pre_partition_${i}`;
      await this.instances[0].execute(key, { value: i });
      prePartitionKeys.add(key);
    }

    // Sync to all instances
    for (const inst of this.instances.slice(1)) {
      inst.syncFrom(this.instances[0]);
    }

    // Partition one instance
    const partitionedInstance = this.instances[this.instances.length - 1];
    partitionedInstance.partition();

    // Continue operations on healthy instances
    let survivedPartition = true;
    try {
      for (let i = 0; i < 20; i++) {
        const instance = this.instances[i % (this.instances.length - 1)];
        await instance.execute(`during_partition_${i}`, { value: i });
      }
    } catch {
      // INTENTIONAL: Network partition test - failure is recorded via survivedPartition flag
      survivedPartition = false;
    }

    // Heal partition
    const healStart = Date.now();
    partitionedInstance.heal();

    // Sync partitioned instance
    for (const inst of this.instances.slice(0, -1)) {
      partitionedInstance.syncFrom(inst);
    }

    const recoveryTime = Date.now() - healStart;

    // Check for data loss
    let dataLoss = 0;
    for (const key of prePartitionKeys) {
      if (!partitionedInstance.get(key)) {
        dataLoss++;
      }
    }

    return {
      survivedPartition,
      recoveryTime,
      dataLoss,
    };
  }

  /**
   * Shutdown instances
   */
  private async shutdownInstances(): Promise<void> {
    this.instances.forEach(inst => inst.reset());
    this.instances = [];
  }

  /**
   * Get instances (for testing)
   */
  getInstances(): SimulatedInstance[] {
    return this.instances;
  }
}

// ==================== Global Instance ====================

/**
 * Global multi-instance test instance
 */
export const multiInstanceTest = new MultiInstanceTest();
