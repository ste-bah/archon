/**
 * God Agent VectorDB Backend Selector
 *
 * Implements: TASK-VDB-001 enhancement (Native HNSW backend selection)
 * Referenced by: VectorDB
 *
 * Automatically selects the best available HNSW backend:
 * 1. Native Rust backend (optimal performance)
 * 2. LEANN backend (efficient - 97% storage savings, pure TypeScript)
 * 3. JavaScript fallback (guaranteed availability)
 */

import { IHNSWBackend } from './hnsw-backend.js';
import { FallbackHNSW } from './fallback-hnsw.js';
import { LEANNBackend } from './leann-backend.js';
import { DistanceMetric } from './types.js';
import type { LEANNConfig } from './leann-types.js';

/**
 * Backend type identifier
 */
export type BackendType = 'native' | 'leann' | 'javascript';

/**
 * Performance tier for backend
 */
export type PerformanceTier = 'optimal' | 'efficient' | 'fallback';

/**
 * Backend selection result
 */
export interface BackendSelection {
  /** Type of backend selected */
  type: BackendType;
  /** Whether backend is available and loaded */
  available: boolean;
  /** Performance tier of backend */
  performance: PerformanceTier;
  /** Human-readable description */
  description: string;
}

/**
 * Backend selector configuration
 */
export interface BackendSelectorConfig {
  /** Force specific backend type (skip auto-detection) */
  forceBackend?: BackendType;
  /** Enable verbose logging */
  verbose?: boolean;
  /** LEANN configuration options (only used when backend is 'leann') */
  leannConfig?: Partial<LEANNConfig>;
}

/**
 * Backend Selector - Detects and loads optimal HNSW backend
 *
 * Priority order:
 * 1. Native Rust backend (optimal) - requires compiled bindings
 * 2. LEANN backend (efficient) - always available, 97% storage savings
 * 3. JavaScript fallback (fallback) - always available
 */
export class BackendSelector {
  /**
   * Detect if native Rust backend is available
   *
   * @returns true if native backend can be loaded
   */
  private static async detectNativeBackend(): Promise<boolean> {
    try {
      // Try to dynamically import native bindings
      // This will fail gracefully if native module is not compiled/available
      const native = await import('./native-hnsw.js');
      // Check both if the class exists AND if it's marked as available
      // Stub modules export NATIVE_AVAILABLE = false
      return typeof native.NativeHNSW !== 'undefined' && (native.NATIVE_AVAILABLE as boolean) === true;
    } catch (error) {
      // Native backend not available (expected in most environments)
      return false;
    }
  }

  /**
   * Detect if LEANN backend is available
   * LEANN is always available as it's pure TypeScript with no native dependencies
   *
   * @returns true (LEANN is always available)
   */
  private static async detectLEANNBackend(): Promise<boolean> {
    try {
      // LEANN is pure TypeScript, always available
      const leann = await import('./leann-backend.js');
      return typeof leann.LEANNBackend !== 'undefined';
    } catch (error) {
      // This should never happen, but handle gracefully
      return false;
    }
  }

  /**
   * Select the best available HNSW backend
   *
   * Priority order:
   * 1. Native Rust backend (if available) - optimal performance
   * 2. LEANN backend (always available) - efficient, 97% storage savings
   * 3. JavaScript fallback (always available) - guaranteed compatibility
   *
   * @param config - Backend selector configuration
   * @returns Backend selection information
   */
  static async selectBest(config: BackendSelectorConfig = {}): Promise<BackendSelection> {
    const { forceBackend, verbose = false } = config;

    // If backend is forced, skip detection
    if (forceBackend === 'javascript') {
      if (verbose) {
        console.log('[VectorDB] Backend forced to JavaScript fallback');
      }
      return {
        type: 'javascript',
        available: true,
        performance: 'fallback',
        description: 'JavaScript HNSW implementation (forced)',
      };
    }

    if (forceBackend === 'leann') {
      const hasLEANN = await this.detectLEANNBackend();
      if (!hasLEANN) {
        throw new Error('LEANN backend forced but not available. This should not happen as LEANN is pure TypeScript.');
      }
      if (verbose) {
        console.log('[VectorDB] Backend forced to LEANN (efficient mode, 97% storage savings)');
      }
      return {
        type: 'leann',
        available: true,
        performance: 'efficient',
        description: 'LEANN implementation with hub caching and graph pruning (forced)',
      };
    }

    if (forceBackend === 'native') {
      const hasNative = await this.detectNativeBackend();
      if (!hasNative) {
        throw new Error('Native backend forced but not available. Compile Rust bindings or use forceBackend: "leann" or "javascript"');
      }
      if (verbose) {
        console.log('[VectorDB] Backend forced to native Rust');
      }
      return {
        type: 'native',
        available: true,
        performance: 'optimal',
        description: 'Native Rust HNSW implementation (forced)',
      };
    }

    // Auto-detect best backend
    const hasNative = await this.detectNativeBackend();

    if (hasNative) {
      if (verbose) {
        console.log('[VectorDB] Native Rust backend detected - using optimal performance mode');
      }
      return {
        type: 'native',
        available: true,
        performance: 'optimal',
        description: 'Native Rust HNSW implementation (auto-detected)',
      };
    }

    // Check for LEANN (should always be available)
    const hasLEANN = await this.detectLEANNBackend();

    if (hasLEANN) {
      if (verbose) {
        console.log('[VectorDB] Native backend unavailable - using LEANN efficient mode (97% storage savings)');
      }
      return {
        type: 'leann',
        available: true,
        performance: 'efficient',
        description: 'LEANN implementation with hub caching and graph pruning (auto-detected)',
      };
    }

    // Fallback to JavaScript implementation
    if (verbose) {
      console.log('[VectorDB] Native and LEANN backends unavailable - using JavaScript fallback');
    }
    return {
      type: 'javascript',
      available: true,
      performance: 'fallback',
      description: 'JavaScript HNSW implementation (auto-detected)',
    };
  }

  /**
   * Load the selected HNSW backend implementation
   *
   * @param dimension - Vector dimension
   * @param metric - Distance metric to use
   * @param config - Backend selector configuration
   * @returns Initialized HNSW backend
   */
  static async loadBackend(
    dimension: number,
    metric: DistanceMetric,
    config: BackendSelectorConfig = {}
  ): Promise<{ backend: IHNSWBackend; selection: BackendSelection }> {
    const selection = await this.selectBest(config);

    let backend: IHNSWBackend;

    if (selection.type === 'native') {
      // Load native backend
      const { NativeHNSW } = await import('./native-hnsw.js');
      backend = new NativeHNSW(dimension, metric);
    } else if (selection.type === 'leann') {
      // Load LEANN backend with optional configuration
      backend = new LEANNBackend(dimension, metric, config.leannConfig);
    } else {
      // Load JavaScript fallback
      backend = new FallbackHNSW(dimension, metric);
    }

    return { backend, selection };
  }

  /**
   * Get information about all available backends
   *
   * @returns Array of backend availability information
   */
  static async getAvailableBackends(): Promise<BackendSelection[]> {
    const hasNative = await this.detectNativeBackend();
    const hasLEANN = await this.detectLEANNBackend();

    const backends: BackendSelection[] = [];

    // Add backends in priority order (highest first)
    if (hasNative) {
      backends.push({
        type: 'native',
        available: true,
        performance: 'optimal',
        description: 'Native Rust HNSW implementation',
      });
    }

    if (hasLEANN) {
      backends.push({
        type: 'leann',
        available: true,
        performance: 'efficient',
        description: 'LEANN implementation with hub caching and graph pruning (97% storage savings)',
      });
    }

    // JavaScript fallback is always available
    backends.push({
      type: 'javascript',
      available: true,
      performance: 'fallback',
      description: 'JavaScript HNSW implementation (always available)',
    });

    return backends;
  }

  /**
   * Get the recommended backend for a given use case
   *
   * @param useCase - The intended use case
   * @returns Recommended backend type
   */
  static getRecommendedBackend(useCase: 'speed' | 'storage' | 'compatibility'): BackendType {
    switch (useCase) {
      case 'speed':
        // Native is fastest, then LEANN, then JavaScript
        return 'native';
      case 'storage':
        // LEANN has 97% storage savings with hub caching
        return 'leann';
      case 'compatibility':
        // JavaScript works everywhere
        return 'javascript';
      default:
        return 'native';
    }
  }
}
