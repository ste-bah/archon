/**
 * Native HNSW Stub
 *
 * This module provides a stub for native Rust HNSW bindings.
 * When actual native bindings are compiled, they will replace this.
 */

import { IHNSWBackend } from './hnsw-backend.js';
import { DistanceMetric, SearchResult, VectorID } from './types.js';

/**
 * Flag indicating if native HNSW is actually available
 * Stub exports false, real implementation exports true
 */
export const NATIVE_AVAILABLE = false;

/**
 * Native HNSW implementation (stub - throws error as native not available)
 */
export class NativeHNSW implements IHNSWBackend {
  constructor(
    _dimension: number,
    _metric: DistanceMetric
  ) {
    throw new Error('Native HNSW bindings not available. Use BackendSelector to auto-detect available backends.');
  }

  insert(_id: VectorID, _vector: Float32Array): void {
    throw new Error('Native HNSW not available');
  }

  search(_query: Float32Array, _k: number, _includeVectors?: boolean): SearchResult[] {
    throw new Error('Native HNSW not available');
  }

  getVector(_id: VectorID): Float32Array | undefined {
    throw new Error('Native HNSW not available');
  }

  delete(_id: VectorID): boolean {
    throw new Error('Native HNSW not available');
  }

  count(): number {
    throw new Error('Native HNSW not available');
  }

  save(_path: string): Promise<void> {
    throw new Error('Native HNSW not available');
  }

  load(_path: string): Promise<boolean> {
    throw new Error('Native HNSW not available');
  }

  clear(): void {
    throw new Error('Native HNSW not available');
  }
}
