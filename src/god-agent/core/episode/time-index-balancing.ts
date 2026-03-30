/**
 * God Agent Time Index B+ Tree Balancing Operations
 *
 * Implements: TASK-EPISODE-002
 * Referenced by: TimeIndex
 *
 * Provides B+ tree node balancing operations.
 * Split from time-index.ts to comply with 500-line limit.
 */

import { BPlusNode } from './time-index-utils.js';

/**
 * Borrow key from left sibling
 */
export function borrowFromLeft(parent: BPlusNode, childIdx: number): void {
  const child = parent.children![childIdx];
  const leftSibling = parent.children![childIdx - 1];

  if (child.isLeaf) {
    // Move last key/value from left sibling to child
    const borrowedKey = leftSibling.keys.pop()!;
    const borrowedValue = leftSibling.values!.pop()!;
    child.keys.unshift(borrowedKey);
    child.values!.unshift(borrowedValue);
    parent.keys[childIdx - 1] = child.keys[0];
  } else {
    // Move parent key down and left sibling's last key to parent
    child.keys.unshift(parent.keys[childIdx - 1]);
    parent.keys[childIdx - 1] = leftSibling.keys.pop()!;
    child.children!.unshift(leftSibling.children!.pop()!);
  }
}

/**
 * Borrow key from right sibling
 */
export function borrowFromRight(parent: BPlusNode, childIdx: number): void {
  const child = parent.children![childIdx];
  const rightSibling = parent.children![childIdx + 1];

  if (child.isLeaf) {
    // Move first key/value from right sibling to child
    const borrowedKey = rightSibling.keys.shift()!;
    const borrowedValue = rightSibling.values!.shift()!;
    child.keys.push(borrowedKey);
    child.values!.push(borrowedValue);
    parent.keys[childIdx] = rightSibling.keys[0];
  } else {
    // Move parent key down and right sibling's first key to parent
    child.keys.push(parent.keys[childIdx]);
    parent.keys[childIdx] = rightSibling.keys.shift()!;
    child.children!.push(rightSibling.children!.shift()!);
  }
}

/**
 * Merge with left sibling
 */
export function mergeWithLeft(parent: BPlusNode, childIdx: number): void {
  const child = parent.children![childIdx];
  const leftSibling = parent.children![childIdx - 1];

  if (child.isLeaf) {
    // Merge leaf nodes
    leftSibling.keys.push(...child.keys);
    leftSibling.values!.push(...child.values!);
    leftSibling.next = child.next;
    if (child.next) {
      child.next.prev = leftSibling;
    }
  } else {
    // Merge internal nodes
    leftSibling.keys.push(parent.keys[childIdx - 1], ...child.keys);
    leftSibling.children!.push(...child.children!);
  }

  // Remove separator key and child from parent
  parent.keys.splice(childIdx - 1, 1);
  parent.children!.splice(childIdx, 1);
}

/**
 * Merge with right sibling
 */
export function mergeWithRight(parent: BPlusNode, childIdx: number): void {
  const child = parent.children![childIdx];
  const rightSibling = parent.children![childIdx + 1];

  if (child.isLeaf) {
    // Merge leaf nodes
    child.keys.push(...rightSibling.keys);
    child.values!.push(...rightSibling.values!);
    child.next = rightSibling.next;
    if (rightSibling.next) {
      rightSibling.next.prev = child;
    }
  } else {
    // Merge internal nodes
    child.keys.push(parent.keys[childIdx], ...rightSibling.keys);
    child.children!.push(...rightSibling.children!);
  }

  // Remove separator key and right child from parent
  parent.keys.splice(childIdx, 1);
  parent.children!.splice(childIdx + 1, 1);
}

/**
 * Rebalance child node (merge or borrow from siblings)
 */
export function rebalanceChild(
  parent: BPlusNode,
  childIdx: number,
  order: number
): void {
  const minKeys = Math.floor(order / 2);

  // Try to borrow from left sibling
  if (childIdx > 0) {
    const leftSibling = parent.children![childIdx - 1];
    if (leftSibling.keys.length > minKeys) {
      borrowFromLeft(parent, childIdx);
      return;
    }
  }

  // Try to borrow from right sibling
  if (childIdx < parent.children!.length - 1) {
    const rightSibling = parent.children![childIdx + 1];
    if (rightSibling.keys.length > minKeys) {
      borrowFromRight(parent, childIdx);
      return;
    }
  }

  // Merge with sibling
  if (childIdx > 0) {
    mergeWithLeft(parent, childIdx);
  } else if (childIdx < parent.children!.length - 1) {
    mergeWithRight(parent, childIdx);
  }
}
