/**
 * UCM Tier Bridge
 *
 * Bridges between Hot/Warm/Cold memory tiers, managing data lifecycle
 * and retrieval across different storage layers.
 */

import { MemoryRetrievalError } from '../errors.js';

/**
 * Memory tier definitions
 */
export enum MemoryTier {
  /**
   * Hot tier: Current session, in-memory
   * - Fastest access
   * - Limited capacity
   * - Volatile (lost on restart)
   */
  HOT = 'hot',

  /**
   * Warm tier: Summarized, quick retrieval
   * - Medium access speed
   * - Larger capacity
   * - Persistent storage
   */
  WARM = 'warm',

  /**
   * Cold tier: Archived, DESC-indexed
   * - Slower access (semantic search)
   * - Unlimited capacity
   * - Long-term persistence
   */
  COLD = 'cold'
}

/**
 * Tier access statistics
 */
export interface ITierStats {
  tier: MemoryTier;
  hits: number;
  misses: number;
  promotions: number;
  demotions: number;
  evictions: number;
  sizeBytes: number;
  itemCount: number;
}

/**
 * Stored item with tier metadata
 */
interface ITierItem<T> {
  key: string;
  data: T;
  tier: MemoryTier;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  sizeBytes: number;
}

/**
 * Tier Bridge Implementation
 *
 * Manages data movement between memory tiers:
 * - Hot: In-memory Map for active context
 * - Warm: Persistent storage for recent data
 * - Cold: DESC-indexed archive for historical data
 */
export class TierBridge {
  // Hot tier: In-memory storage
  private hotStorage: Map<string, ITierItem<unknown>> = new Map();
  private hotCapacityBytes: number = 10 * 1024 * 1024; // 10MB
  private hotCurrentBytes: number = 0;

  // Tier statistics
  private stats: Map<MemoryTier, ITierStats> = new Map([
    [MemoryTier.HOT, { tier: MemoryTier.HOT, hits: 0, misses: 0, promotions: 0, demotions: 0, evictions: 0, sizeBytes: 0, itemCount: 0 }],
    [MemoryTier.WARM, { tier: MemoryTier.WARM, hits: 0, misses: 0, promotions: 0, demotions: 0, evictions: 0, sizeBytes: 0, itemCount: 0 }],
    [MemoryTier.COLD, { tier: MemoryTier.COLD, hits: 0, misses: 0, promotions: 0, demotions: 0, evictions: 0, sizeBytes: 0, itemCount: 0 }]
  ]);

  constructor(
    private readonly warmAdapter?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    },
    private readonly coldAdapter?: {
      search: (query: string, threshold: number) => Promise<Array<{ key: string; content: unknown; score: number }>>;
      index: (key: string, content: unknown) => Promise<void>;
    }
  ) {}

  /**
   * Retrieve data from appropriate tier
   *
   * @param key - Data key
   * @returns Data and tier it was found in
   */
  public async getFromTier<T>(key: string): Promise<{ data: T; tier: MemoryTier } | null> {
    // Try hot tier first
    const hotItem = this.hotStorage.get(key);
    if (hotItem) {
      this.recordAccess(MemoryTier.HOT, true);
      this.updateAccessMetadata(hotItem);
      return { data: hotItem.data as T, tier: MemoryTier.HOT };
    }
    this.recordAccess(MemoryTier.HOT, false);

    // Try warm tier
    if (this.warmAdapter) {
      try {
        const warmData = await this.warmAdapter.get(key);
        if (warmData !== null && warmData !== undefined) {
          this.recordAccess(MemoryTier.WARM, true);
          // Promote to hot on access
          await this.promoteToHot(key, warmData as T);
          return { data: warmData as T, tier: MemoryTier.WARM };
        }
      } catch (error) {
        // Continue to cold tier
      }
    }
    this.recordAccess(MemoryTier.WARM, false);

    // Try cold tier (semantic search)
    if (this.coldAdapter) {
      try {
        const results = await this.coldAdapter.search(key, 0.9);
        if (results.length > 0) {
          this.recordAccess(MemoryTier.COLD, true);
          const data = results[0].content as T;
          // Promote to warm on access
          await this.demoteToWarm(key, data);
          return { data, tier: MemoryTier.COLD };
        }
      } catch (error) {
        // Not found in any tier
      }
    }
    this.recordAccess(MemoryTier.COLD, false);

    return null;
  }

  /**
   * Promote data to hot tier
   *
   * @param key - Data key
   * @param data - Data to store
   */
  public async promoteToHot<T>(key: string, data: T): Promise<void> {
    const sizeBytes = this.estimateSize(data);

    // Evict if necessary
    while (this.hotCurrentBytes + sizeBytes > this.hotCapacityBytes && this.hotStorage.size > 0) {
      await this.evictFromHot();
    }

    const item: ITierItem<unknown> = {
      key,
      data,
      tier: MemoryTier.HOT,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      sizeBytes
    };

    this.hotStorage.set(key, item);
    this.hotCurrentBytes += sizeBytes;

    const stats = this.stats.get(MemoryTier.HOT)!;
    stats.promotions++;
    stats.sizeBytes = this.hotCurrentBytes;
    stats.itemCount = this.hotStorage.size;
  }

  /**
   * Demote data to warm tier
   *
   * @param key - Data key
   * @param data - Data to store
   */
  public async demoteToWarm<T>(key: string, data: T): Promise<void> {
    if (!this.warmAdapter) {
      throw new MemoryRetrievalError(key);
    }

    try {
      await this.warmAdapter.set(key, data);

      const stats = this.stats.get(MemoryTier.WARM)!;
      stats.demotions++;
      stats.itemCount++;
      stats.sizeBytes += this.estimateSize(data);
    } catch (error) {
      throw new MemoryRetrievalError(key, error as Error);
    }
  }

  /**
   * Archive data to cold tier
   *
   * @param key - Data key
   * @param data - Data to archive
   */
  public async archiveToCold<T>(key: string, data: T): Promise<void> {
    if (!this.coldAdapter) {
      throw new MemoryRetrievalError(key);
    }

    try {
      await this.coldAdapter.index(key, data);

      const stats = this.stats.get(MemoryTier.COLD)!;
      stats.itemCount++;
      stats.sizeBytes += this.estimateSize(data);
    } catch (error) {
      throw new MemoryRetrievalError(key, error as Error);
    }
  }

  /**
   * Get statistics for all tiers
   *
   * @returns Map of tier statistics
   */
  public getStats(): Map<MemoryTier, ITierStats> {
    return new Map(this.stats);
  }

  /**
   * Get statistics for specific tier
   *
   * @param tier - Memory tier
   * @returns Tier statistics
   */
  public getTierStats(tier: MemoryTier): ITierStats {
    return { ...this.stats.get(tier)! };
  }

  /**
   * Clear hot tier
   */
  public clearHot(): void {
    this.hotStorage.clear();
    this.hotCurrentBytes = 0;

    const stats = this.stats.get(MemoryTier.HOT)!;
    stats.sizeBytes = 0;
    stats.itemCount = 0;
  }

  /**
   * Evict least recently used item from hot tier
   */
  private async evictFromHot(): Promise<void> {
    let oldestItem: ITierItem<unknown> | null = null;
    let oldestKey: string | null = null;

    // Find LRU item
    for (const [key, item] of this.hotStorage.entries()) {
      if (!oldestItem || item.lastAccessed < oldestItem.lastAccessed) {
        oldestItem = item;
        oldestKey = key;
      }
    }

    if (oldestItem && oldestKey) {
      // Demote to warm tier
      if (this.warmAdapter) {
        await this.demoteToWarm(oldestKey, oldestItem.data);
      }

      this.hotStorage.delete(oldestKey);
      this.hotCurrentBytes -= oldestItem.sizeBytes;

      const stats = this.stats.get(MemoryTier.HOT)!;
      stats.evictions++;
      stats.sizeBytes = this.hotCurrentBytes;
      stats.itemCount = this.hotStorage.size;
    }
  }

  /**
   * Update access metadata for item
   */
  private updateAccessMetadata(item: ITierItem<unknown>): void {
    item.accessCount++;
    item.lastAccessed = Date.now();
  }

  /**
   * Record tier access
   */
  private recordAccess(tier: MemoryTier, hit: boolean): void {
    const stats = this.stats.get(tier)!;
    if (hit) {
      stats.hits++;
    } else {
      stats.misses++;
    }
  }

  /**
   * Estimate size of data in bytes
   */
  private estimateSize(data: unknown): number {
    const str = JSON.stringify(data);
    // UTF-16 encoding: 2 bytes per character
    return str.length * 2;
  }

  /**
   * Get hot tier hit rate
   */
  public getHitRate(tier: MemoryTier): number {
    const stats = this.stats.get(tier)!;
    const total = stats.hits + stats.misses;
    return total > 0 ? stats.hits / total : 0;
  }
}

/**
 * Create a new TierBridge instance
 */
export function createTierBridge(
  warmAdapter?: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  },
  coldAdapter?: {
    search: (query: string, threshold: number) => Promise<Array<{ key: string; content: unknown; score: number }>>;
    index: (key: string, content: unknown) => Promise<void>;
  }
): TierBridge {
  return new TierBridge(warmAdapter, coldAdapter);
}
