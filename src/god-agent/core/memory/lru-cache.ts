/**
 * LRU Cache with O(1) operations using doubly-linked list + Map
 * Target: <50µs p95 latency for cache hits
 */

interface CacheNode<K, V> {
  key: K;
  value: V;
  prev: CacheNode<K, V> | null;
  next: CacheNode<K, V> | null;
  accessedAt: number;
}

export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, CacheNode<K, V>>;
  private head: CacheNode<K, V> | null = null;  // Most recently used
  private tail: CacheNode<K, V> | null = null;  // Least recently used
  private memoryPressureThreshold: number = 0.80;  // 80%
  private evictionBatchSize: number;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
    this.cache = new Map();
    this.evictionBatchSize = Math.floor(capacity / 2);  // 50%
  }

  get(key: K): V | null {
    if (!this.cache.has(key)) return null;
    const node = this.cache.get(key)!;
    node.accessedAt = Date.now();
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): void {
    this.checkMemoryPressure();

    if (this.cache.has(key)) {
      const node = this.cache.get(key)!;
      node.value = value;
      node.accessedAt = Date.now();
      this.moveToHead(node);
      return;
    }

    const newNode: CacheNode<K, V> = {
      key, value, prev: null, next: null, accessedAt: Date.now()
    };

    this.cache.set(key, newNode);
    this.addToHead(newNode);

    if (this.cache.size > this.capacity) {
      const removed = this.removeTail();
      if (removed) this.cache.delete(removed.key);
    }
  }

  delete(key: K): boolean {
    if (!this.cache.has(key)) return false;
    const node = this.cache.get(key)!;
    this.removeNode(node);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  size(): number {
    return this.cache.size;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats(): {
    size: number;
    capacity: number;
    utilizationPercent: number;
  } {
    return {
      size: this.cache.size,
      capacity: this.capacity,
      utilizationPercent: (this.cache.size / this.capacity) * 100
    };
  }

  // Private doubly-linked list methods
  private moveToHead(node: CacheNode<K, V>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private addToHead(node: CacheNode<K, V>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: CacheNode<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
  }

  private removeTail(): CacheNode<K, V> | null {
    const removed = this.tail;
    if (this.tail) this.removeNode(this.tail);
    return removed;
  }

  private checkMemoryPressure(): void {
    const memUsage = process.memoryUsage();
    const ratio = memUsage.heapUsed / memUsage.heapTotal;
    if (ratio > this.memoryPressureThreshold) {
      this.evictBatch(this.evictionBatchSize);
    }
  }

  private evictBatch(count: number): void {
    let evicted = 0;
    while (evicted < count && this.tail) {
      const removed = this.removeTail();
      if (removed) this.cache.delete(removed.key);
      evicted++;
    }
  }
}
