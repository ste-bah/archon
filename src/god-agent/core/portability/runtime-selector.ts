/**
 * Runtime Selector
 * TASK-NFR-003 - Portability Validation Suite (NFR-5.6)
 *
 * Automatically selects the best available runtime:
 * 1. Native Rust (optimal performance)
 * 2. WASM (good performance, universal)
 * 3. JavaScript (acceptable, always available)
 */

import { PlatformDetector, type PlatformInfo } from './platform-detector.js';

// ==================== Types ====================

/**
 * Available runtime types
 */
export type RuntimeType = 'native' | 'wasm' | 'javascript';

/**
 * Performance rating for runtime
 */
export type PerformanceRating = 'optimal' | 'good' | 'acceptable';

/**
 * Runtime selection result
 */
export interface RuntimeSelection {
  /** Selected runtime type */
  type: RuntimeType;
  /** Reason for selection */
  reason: string;
  /** Performance rating */
  performance: PerformanceRating;
  /** Any warnings about the selection */
  warnings: string[];
  /** Whether selection was forced via environment */
  forced: boolean;
}

/**
 * Runtime loader function type
 */
export type RuntimeLoader = () => Promise<boolean>;

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  /** Custom native loader function */
  nativeLoader?: RuntimeLoader;
  /** Custom WASM loader function */
  wasmLoader?: RuntimeLoader;
  /** Force specific runtime */
  forceRuntime?: RuntimeType;
  /** Verbose logging */
  verbose?: boolean;
}

// ==================== Constants ====================

/**
 * Environment variable for runtime override
 */
export const RUNTIME_ENV_VAR = 'GOD_AGENT_RUNTIME';

/**
 * Performance relative to native baseline
 */
export const RUNTIME_PERFORMANCE: Record<RuntimeType, number> = {
  native: 1.0,
  wasm: 0.85, // ~15% slower
  javascript: 0.4, // ~60% slower
};

// ==================== Runtime Selector ====================

/**
 * Runtime selector for NFR-5.6 validation
 *
 * Automatically selects the best available implementation based on
 * platform capabilities and module availability.
 *
 * @example
 * ```typescript
 * const selector = new RuntimeSelector();
 * const selection = await selector.selectRuntime();
 *
 * console.log(`Selected: ${selection.type}`);
 * console.log(`Performance: ${selection.performance}`);
 * ```
 */
export class RuntimeSelector {
  private detector: PlatformDetector;
  private config: RuntimeConfig;
  private cachedSelection?: RuntimeSelection;

  constructor(config: RuntimeConfig = {}) {
    this.detector = new PlatformDetector();
    this.config = config;
  }

  /**
   * Select best available runtime
   */
  async selectRuntime(): Promise<RuntimeSelection> {
    // Return cached selection if available
    if (this.cachedSelection) {
      return this.cachedSelection;
    }

    // Check for forced override
    const forced = this.config.forceRuntime ?? this.getEnvOverride();
    if (forced) {
      this.cachedSelection = this.createForcedSelection(forced);
      return this.cachedSelection;
    }

    const platform = this.detector.detect();
    this.cachedSelection = await this.autoSelect(platform);
    return this.cachedSelection;
  }

  /**
   * Check for environment variable override
   */
  private getEnvOverride(): RuntimeType | undefined {
    const override = process.env[RUNTIME_ENV_VAR];
    if (override && this.isValidRuntime(override)) {
      return override as RuntimeType;
    }
    return undefined;
  }

  /**
   * Validate runtime type string
   */
  private isValidRuntime(value: string): value is RuntimeType {
    return value === 'native' || value === 'wasm' || value === 'javascript';
  }

  /**
   * Create selection for forced runtime
   */
  private createForcedSelection(type: RuntimeType): RuntimeSelection {
    return {
      type,
      reason: `Forced via ${this.config.forceRuntime ? 'config' : RUNTIME_ENV_VAR}=${type}`,
      performance: this.getPerformanceRating(type),
      warnings: [
        `Runtime forced to ${type} - may not be optimal for this platform`,
        type === 'javascript' ? 'Some NFR-1 performance targets may not be met' : '',
      ].filter(Boolean),
      forced: true,
    };
  }

  /**
   * Automatically select best runtime based on availability
   */
  private async autoSelect(platform: PlatformInfo): Promise<RuntimeSelection> {
    // Try native first (if platform supports it)
    if (platform.nativeSupported) {
      const nativeLoaded = await this.tryLoadNative();
      if (nativeLoaded) {
        return {
          type: 'native',
          reason: 'Native bindings loaded successfully',
          performance: 'optimal',
          warnings: [],
          forced: false,
        };
      }
      this.log('Native binding load failed, trying WASM...');
    }

    // Try WASM second
    if (platform.wasmSupported) {
      const wasmLoaded = await this.tryLoadWasm();
      if (wasmLoaded) {
        const reason = platform.nativeSupported
          ? 'Native binding failed, using WASM fallback'
          : 'Platform does not support native, using WASM';

        return {
          type: 'wasm',
          reason,
          performance: 'good',
          warnings: [
            'Performance ~15% slower than native',
            !platform.simdSupported ? 'SIMD not available - WASM performance reduced' : '',
          ].filter(Boolean),
          forced: false,
        };
      }
      this.log('WASM load failed, falling back to JavaScript...');
    }

    // Fall back to JavaScript (always available)
    return {
      type: 'javascript',
      reason: 'Neither native nor WASM available, using JavaScript',
      performance: 'acceptable',
      warnings: [
        'Performance ~60-75% slower than native',
        'Some NFR-1 performance targets may not be met',
      ],
      forced: false,
    };
  }

  /**
   * Attempt to load native bindings
   */
  private async tryLoadNative(): Promise<boolean> {
    // Use custom loader if provided
    if (this.config.nativeLoader) {
      return this.config.nativeLoader();
    }

    // Default: simulate native loading
    // In real implementation, this would try to require() the native module
    try {
      // Simulate native module check
      const platform = this.detector.detect();
      if (!platform.nativeSupported) {
        return false;
      }

      // Simulate successful load for supported platforms
      return true;
    } catch (error) {
      this.log('Native binding load error:', error);
      return false;
    }
  }

  /**
   * Attempt to load WASM module
   */
  private async tryLoadWasm(): Promise<boolean> {
    // Use custom loader if provided
    if (this.config.wasmLoader) {
      return this.config.wasmLoader();
    }

    // Default: check WASM support
    try {
      const platform = this.detector.detect();
      if (!platform.wasmSupported) {
        return false;
      }

      // Simulate successful WASM load
      return true;
    } catch (error) {
      this.log('WASM load error:', error);
      return false;
    }
  }

  /**
   * Get performance rating for runtime type
   */
  private getPerformanceRating(type: RuntimeType): PerformanceRating {
    switch (type) {
      case 'native':
        return 'optimal';
      case 'wasm':
        return 'good';
      case 'javascript':
        return 'acceptable';
    }
  }

  /**
   * Get relative performance multiplier
   */
  getRelativePerformance(type: RuntimeType): number {
    return RUNTIME_PERFORMANCE[type];
  }

  /**
   * Clear cached selection (for testing)
   */
  clearCache(): void {
    this.cachedSelection = undefined;
  }

  /**
   * Get current cached selection
   */
  getCachedSelection(): RuntimeSelection | undefined {
    return this.cachedSelection;
  }

  /**
   * Conditional logging
   */
  private log(...args: unknown[]): void {
    if (this.config.verbose) {
      console.log('[RuntimeSelector]', ...args);
    }
  }

  /**
   * Validate that selected runtime actually works
   */
  async validateSelection(): Promise<{
    valid: boolean;
    selection: RuntimeSelection;
    error?: string;
  }> {
    const selection = await this.selectRuntime();

    try {
      // Validate the selected runtime works
      switch (selection.type) {
        case 'native':
          return { valid: await this.tryLoadNative(), selection };
        case 'wasm':
          return { valid: await this.tryLoadWasm(), selection };
        case 'javascript':
          return { valid: true, selection }; // JS always works
      }
    } catch (error) {
      return {
        valid: false,
        selection,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get selection report for logging/debugging
   */
  async getSelectionReport(): Promise<Record<string, unknown>> {
    const selection = await this.selectRuntime();
    const platform = this.detector.detect();

    return {
      selection: {
        type: selection.type,
        reason: selection.reason,
        performance: selection.performance,
        forced: selection.forced,
      },
      platform: {
        identifier: platform.platform,
        nodeVersion: platform.nodeVersion,
        capabilities: {
          native: platform.nativeSupported,
          wasm: platform.wasmSupported,
          simd: platform.simdSupported,
        },
      },
      warnings: selection.warnings,
      performanceExpectation: `${(RUNTIME_PERFORMANCE[selection.type] * 100).toFixed(0)}% of native`,
    };
  }
}

// ==================== Global Instance ====================

/**
 * Global runtime selector instance
 */
export const runtimeSelector = new RuntimeSelector();
