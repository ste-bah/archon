/**
 * God Agent Time Index Implementation (B+ Tree)
 *
 * Implements: TASK-EPISODE-002
 * Referenced by: EpisodeStore
 *
 * Provides efficient time-based indexing using B+ tree structure:
 * - O(log n) insert/remove operations
 * - O(log n + k) range queries
 * - Leaf node linking for fast sequential access
 * - Handles ongoing episodes (null endTime as infinity)
 */

import {
  BPlusNode,
  IndexStats,
  persistIndex,
  restoreIndex,
  getStats,
  findLeafNode as utilFindLeafNode,
  findKeyIndex as utilFindKeyIndex,
} from './time-index-utils.js';
import {
  rebalanceChild as utilRebalanceChild,
} from './time-index-balancing.js';

/**
 * TimeIndex - B+ tree implementation for temporal episode indexing
 *
 * Performance targets:
 * - Insert: <1ms p95
 * - Remove: <1ms p95
 * - Range query (10): <2ms p95
 * - Range query (100): <5ms p95
 * - Range query (1k): <20ms p95
 * - Nearest (k=10): <3ms p95
 * - Memory: <100KB for 100k episodes
 */
export class TimeIndex {
  private root: BPlusNode;
  private readonly order: number = 32; // Cache-friendly ~4KB nodes
  private height: number = 0;
  private size: number = 0;

  constructor(order: number = 32) {
    this.order = order;
    // Initialize with empty leaf node
    this.root = {
      isLeaf: true,
      keys: [],
      values: [],
    };
  }

  /**
   * Insert episode at timestamp
   *
   * @param timestamp - Episode timestamp (Unix ms)
   * @param episodeId - Episode UUID
   */
  insert(timestamp: number, episodeId: string): void {
    // Special case: root is full, need to split
    if (this.root.keys.length >= this.order - 1) {
      const newRoot: BPlusNode = {
        isLeaf: false,
        keys: [],
        children: [this.root],
      };
      this.splitChild(newRoot, 0);
      this.root = newRoot;
      this.height++;
    }

    this.insertNonFull(this.root, timestamp, episodeId);
    this.size++;
  }

  /**
   * Insert into a node that is not full
   */
  private insertNonFull(node: BPlusNode, timestamp: number, episodeId: string): void {
    let i = node.keys.length - 1;

    if (node.isLeaf) {
      // Find insertion position
      while (i >= 0 && timestamp < node.keys[i]) {
        i--;
      }
      i++;

      // Check if timestamp already exists
      if (i > 0 && node.keys[i - 1] === timestamp) {
        // Add to existing timestamp's episode list
        node.values![i - 1].push(episodeId);
      } else {
        // Insert new timestamp
        node.keys.splice(i, 0, timestamp);
        node.values!.splice(i, 0, [episodeId]);
      }
    } else {
      // Internal node: find child to descend
      while (i >= 0 && timestamp < node.keys[i]) {
        i--;
      }
      i++;

      // Check if child is full
      if (node.children![i].keys.length >= this.order - 1) {
        this.splitChild(node, i);
        if (timestamp > node.keys[i]) {
          i++;
        }
      }

      this.insertNonFull(node.children![i], timestamp, episodeId);
    }
  }

  /**
   * Split a full child node
   *
   * @param parent - Parent node
   * @param childIndex - Index of child to split
   */
  private splitChild(parent: BPlusNode, childIndex: number): void {
    const child = parent.children![childIndex];
    const mid = Math.floor(this.order / 2);

    const newChild: BPlusNode = {
      isLeaf: child.isLeaf,
      keys: child.keys.splice(mid),
      values: child.isLeaf ? child.values!.splice(mid) : undefined,
      children: !child.isLeaf ? child.children!.splice(mid) : undefined,
    };

    // For leaf nodes, keep copy of first key in parent and link siblings
    if (child.isLeaf) {
      const promotedKey = newChild.keys[0];
      parent.keys.splice(childIndex, 0, promotedKey);
      parent.children!.splice(childIndex + 1, 0, newChild);

      // Link leaf nodes
      newChild.next = child.next;
      newChild.prev = child;
      child.next = newChild;
      if (newChild.next) {
        newChild.next.prev = newChild;
      }
    } else {
      // For internal nodes, promote middle key
      const promotedKey = child.keys.pop()!;
      parent.keys.splice(childIndex, 0, promotedKey);
      parent.children!.splice(childIndex + 1, 0, newChild);
    }
  }

  /**
   * Remove episode at timestamp
   *
   * @param timestamp - Episode timestamp
   * @param episodeId - Episode UUID to remove
   * @returns True if episode was found and removed
   */
  remove(timestamp: number, episodeId: string): boolean {
    const removed = this.removeFromNode(this.root, timestamp, episodeId);

    if (removed) {
      this.size--;

      // If root is empty internal node, make its only child the new root
      if (!this.root.isLeaf && this.root.keys.length === 0) {
        this.root = this.root.children![0];
        this.height--;
      }
    }

    return removed;
  }

  /**
   * Remove episode from node (recursive)
   */
  private removeFromNode(node: BPlusNode, timestamp: number, episodeId: string): boolean {
    const idx = this.findKeyIndex(node, timestamp);

    if (node.isLeaf) {
      // Check if timestamp exists
      if (idx < node.keys.length && node.keys[idx] === timestamp) {
        const episodes = node.values![idx];
        const episodeIdx = episodes.indexOf(episodeId);

        if (episodeIdx !== -1) {
          episodes.splice(episodeIdx, 1);

          // If no more episodes at this timestamp, remove the key
          if (episodes.length === 0) {
            node.keys.splice(idx, 1);
            node.values!.splice(idx, 1);
          }

          return true;
        }
      }
      return false;
    } else {
      // Internal node: find child containing timestamp
      let childIdx = idx;
      if (childIdx < node.keys.length && timestamp >= node.keys[childIdx]) {
        childIdx++;
      }

      if (childIdx >= node.children!.length) {
        return false;
      }

      const child = node.children![childIdx];
      const removed = this.removeFromNode(child, timestamp, episodeId);

      // Handle underflow (node has fewer than min keys)
      if (removed && child.keys.length < Math.floor(this.order / 2)) {
        this.rebalanceChild(node, childIdx);
      }

      return removed;
    }
  }

  /**
   * Rebalance child node (delegates to balancing module)
   */
  private rebalanceChild(parent: BPlusNode, childIdx: number): void {
    utilRebalanceChild(parent, childIdx, this.order);
  }

  /**
   * Find index for key in node (binary search)
   */
  private findKeyIndex(node: BPlusNode, key: number): number {
    return utilFindKeyIndex(node, key);
  }

  /**
   * Query episodes in time range
   *
   * @param start - Start timestamp (inclusive)
   * @param end - End timestamp (inclusive, Infinity for ongoing episodes)
   * @returns Array of episode IDs in chronological order
   */
  queryRange(start: number, end: number): string[] {
    const results: string[] = [];
    const startLeaf = this.findLeafNode(this.root, start);

    if (!startLeaf) return results;

    // Scan leaves using linked list
    let current: BPlusNode | undefined = startLeaf;

    while (current) {
      for (let i = 0; i < current.keys.length; i++) {
        const timestamp = current.keys[i];

        // Stop if we've passed the end
        if (timestamp > end) {
          return results;
        }

        // Include episodes in range
        if (timestamp >= start && timestamp <= end) {
          results.push(...current.values![i]);
        }
      }

      // Move to next leaf
      current = current.next;

      // Stop if next leaf starts beyond range
      if (current && current.keys.length > 0 && current.keys[0] > end) {
        break;
      }
    }

    return results;
  }

  /**
   * Find leaf node that could contain timestamp
   */
  private findLeafNode(node: BPlusNode, timestamp: number): BPlusNode | undefined {
    return utilFindLeafNode(node, timestamp, this.findKeyIndex.bind(this));
  }

  /**
   * Get k nearest episodes to timestamp
   *
   * @param timestamp - Target timestamp
   * @param k - Number of nearest episodes
   * @returns Array of episode IDs, sorted by distance to timestamp
   */
  getNearest(timestamp: number, k: number): string[] {
    if (this.size === 0 || k <= 0) return [];

    // Find leaf containing or nearest to timestamp
    const leaf = this.findLeafNode(this.root, timestamp);
    if (!leaf || leaf.keys.length === 0) return [];

    // Use two-pointer approach to collect nearest episodes
    const results: Array<{ id: string; distance: number }> = [];
    let currentLeft: BPlusNode | undefined = leaf;
    let currentRight: BPlusNode | undefined = leaf;
    let leftIdx = this.findKeyIndex(leaf, timestamp) - 1; // Start left of timestamp
    let rightIdx = this.findKeyIndex(leaf, timestamp);    // Start at/right of timestamp

    // Expand search outward from timestamp
    while (results.length < k && (currentLeft || currentRight)) {
      let useLeft = false;
      let useRight = false;

      // Calculate distances
      const leftDistance = currentLeft && leftIdx >= 0 && leftIdx < currentLeft.keys.length
        ? Math.abs(currentLeft.keys[leftIdx] - timestamp)
        : Infinity;

      const rightDistance = currentRight && rightIdx >= 0 && rightIdx < currentRight.keys.length
        ? Math.abs(currentRight.keys[rightIdx] - timestamp)
        : Infinity;

      // Choose closer side (prefer left when equal distance)
      if (leftDistance <= rightDistance && leftDistance !== Infinity) {
        useLeft = true;
      } else if (rightDistance !== Infinity) {
        useRight = true;
      } else {
        break; // No more candidates
      }

      // Add episodes from chosen side
      if (useLeft && currentLeft) {
        for (const episodeId of currentLeft.values![leftIdx]) {
          if (results.length < k) {
            results.push({ id: episodeId, distance: leftDistance });
          }
        }
        leftIdx--;
        if (leftIdx < 0) {
          currentLeft = currentLeft.prev;
          if (currentLeft) {
            leftIdx = currentLeft.keys.length - 1;
          }
        }
      } else if (useRight && currentRight) {
        for (const episodeId of currentRight.values![rightIdx]) {
          if (results.length < k) {
            results.push({ id: episodeId, distance: rightDistance });
          }
        }
        rightIdx++;
        if (rightIdx >= currentRight.keys.length) {
          currentRight = currentRight.next;
          rightIdx = 0;
        }
      }
    }

    // Sort by distance and return top k
    return results
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
      .map(r => r.id);
  }

  /**
   * Rebalance tree (currently no-op, balancing happens during insert/remove)
   */
  rebalance(): void {
    // B+ tree is self-balancing during insert/remove operations
    // This method is a placeholder for future optimizations
  }

  /**
   * Persist index to disk
   *
   * @param path - File path for serialization
   */
  persist(path: string): void {
    persistIndex(path, this.order, this.height, this.size, this.root);
  }

  /**
   * Restore index from disk
   *
   * @param path - File path for deserialization
   */
  restore(path: string): void {
    const data = restoreIndex(path);
    this.height = data.height;
    this.size = data.size;
    this.root = data.root;
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return getStats(this.root, this.height, this.size, this.order);
  }

  /**
   * Get total number of episode references
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get tree height
   */
  getHeight(): number {
    return this.height;
  }

  /**
   * Clear all data from index
   */
  clear(): void {
    this.root = {
      isLeaf: true,
      keys: [],
      values: [],
    };
    this.height = 0;
    this.size = 0;
  }
}

export type { IndexStats } from './time-index-utils.js';
