/**
 * Platform Detector
 * TASK-NFR-003 - Portability Validation Suite (NFR-5)
 *
 * Detects platform capabilities:
 * - OS and architecture detection
 * - Node.js version checking
 * - WASM and SIMD support
 * - Native binding availability
 */

// WebAssembly global type declaration
declare const WebAssembly: any;

// ==================== Types ====================

/**
 * Supported operating systems
 */
export type SupportedOS = 'linux' | 'darwin' | 'win32';

/**
 * Supported architectures
 */
export type SupportedArch = 'x64' | 'arm64';

/**
 * Platform information structure
 */
export interface PlatformInfo {
  /** Operating system */
  os: SupportedOS | 'unknown';
  /** CPU architecture */
  arch: SupportedArch | 'ia32' | 'unknown';
  /** Full Node.js version string */
  nodeVersion: string;
  /** Node.js major version number */
  nodeMajor: number;
  /** Whether native bindings are supported for this platform */
  nativeSupported: boolean;
  /** Whether WebAssembly is available */
  wasmSupported: boolean;
  /** Whether WASM SIMD is available */
  simdSupported: boolean;
  /** Platform identifier (e.g., "linux-x64") */
  platform: string;
}

/**
 * Compatibility report structure
 */
export interface CompatibilityReport {
  /** Platform identifier */
  platform: string;
  /** Node.js version */
  nodeVersion: string;
  /** Whether platform is fully supported */
  isSupported: boolean;
  /** Available capabilities */
  capabilities: {
    native: boolean;
    wasm: boolean;
    simd: boolean;
  };
  /** Compatibility warnings */
  warnings: string[];
  /** Performance recommendations */
  recommendations: string[];
}

// ==================== Constants ====================

/**
 * Supported platform matrix (platform identifier → true)
 */
export const SUPPORTED_PLATFORMS = new Set([
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]);

/**
 * Supported Node.js major versions
 */
export const SUPPORTED_NODE_VERSIONS = [18, 20, 22];

// ==================== Platform Detector ====================

/**
 * Platform detector for NFR-5 portability validation
 *
 * Detects the current platform, capabilities, and generates
 * compatibility reports for runtime selection.
 *
 * @example
 * ```typescript
 * const detector = new PlatformDetector();
 * const info = detector.detect();
 *
 * console.log(`Platform: ${info.platform}`);
 * console.log(`Native supported: ${info.nativeSupported}`);
 * ```
 */
export class PlatformDetector {
  /**
   * Detect current platform information
   */
  detect(): PlatformInfo {
    const os = this.getOS();
    const arch = this.getArch();
    const nodeVersion = process.version;
    const nodeMajor = this.parseNodeMajor(nodeVersion);

    const platform = `${os}-${arch}`;
    const nativeSupported = SUPPORTED_PLATFORMS.has(platform);
    const wasmSupported = this.checkWasmSupport();
    const simdSupported = this.checkSimdSupport();

    return {
      os,
      arch,
      nodeVersion,
      nodeMajor,
      nativeSupported,
      wasmSupported,
      simdSupported,
      platform,
    };
  }

  /**
   * Get operating system
   */
  private getOS(): PlatformInfo['os'] {
    const platform = process.platform;
    if (platform === 'linux' || platform === 'darwin' || platform === 'win32') {
      return platform;
    }
    return 'unknown';
  }

  /**
   * Get CPU architecture
   */
  private getArch(): PlatformInfo['arch'] {
    const arch = process.arch;
    if (arch === 'x64' || arch === 'arm64' || arch === 'ia32') {
      return arch;
    }
    return 'unknown';
  }

  /**
   * Parse Node.js major version number
   */
  private parseNodeMajor(version: string): number {
    const match = version.match(/^v?(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Check WebAssembly support
   */
  private checkWasmSupport(): boolean {
    try {
      // Check if WebAssembly is available
      if (typeof WebAssembly === 'undefined') {
        return false;
      }

      // Try to compile a minimal WASM module
      const wasmCode = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // WASM magic number (\0asm)
        0x01, 0x00, 0x00, 0x00, // Version 1
      ]);

      new WebAssembly.Module(wasmCode);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check WASM SIMD support (for optimized vector operations)
   */
  private checkSimdSupport(): boolean {
    try {
      // WASM SIMD detection - try to compile a module using v128 type
      // This is a minimal module that uses SIMD:
      // (module (func (result v128) i32.const 0 v128.load)))
      const simdTest = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic
        0x01, 0x00, 0x00, 0x00, // version
        0x01, 0x05, 0x01, 0x60, // type section: 1 type, func, no params
        0x00, 0x01, 0x7b, // result: v128
        0x03, 0x02, 0x01, 0x00, // function section: 1 function, type 0
        0x0a, 0x0a, 0x01, // code section: 1 function
        0x08, 0x00, 0x41, 0x00, // local count 0, i32.const 0
        0xfd, 0x00, 0x02, 0x00, // v128.load align=2 offset=0
        0x0b, // end
      ]);

      new WebAssembly.Module(simdTest);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Node.js version is supported
   */
  isNodeVersionSupported(major?: number): boolean {
    const version = major ?? this.detect().nodeMajor;
    return SUPPORTED_NODE_VERSIONS.includes(version);
  }

  /**
   * Check if platform is fully supported
   */
  isPlatformSupported(platform?: string): boolean {
    const p = platform ?? this.detect().platform;
    return SUPPORTED_PLATFORMS.has(p);
  }

  /**
   * Get comprehensive compatibility report
   */
  getCompatibilityReport(): CompatibilityReport {
    const info = this.detect();

    return {
      platform: info.platform,
      nodeVersion: info.nodeVersion,
      isSupported: info.nativeSupported && this.isNodeVersionSupported(info.nodeMajor),
      capabilities: {
        native: info.nativeSupported,
        wasm: info.wasmSupported,
        simd: info.simdSupported,
      },
      warnings: this.getWarnings(info),
      recommendations: this.getRecommendations(info),
    };
  }

  /**
   * Generate warnings for current platform
   */
  private getWarnings(info: PlatformInfo): string[] {
    const warnings: string[] = [];

    if (!info.nativeSupported) {
      warnings.push(`Native bindings not available for ${info.platform}`);
    }

    if (!this.isNodeVersionSupported(info.nodeMajor)) {
      warnings.push(`Node.js ${info.nodeMajor} is not officially supported (use 18, 20, or 22)`);
    }

    if (!info.wasmSupported) {
      warnings.push('WebAssembly not available - JavaScript fallback only');
    }

    if (info.arch === 'ia32') {
      warnings.push('32-bit architecture detected - limited support');
    }

    return warnings;
  }

  /**
   * Generate performance recommendations
   */
  private getRecommendations(info: PlatformInfo): string[] {
    const recs: string[] = [];

    if (!info.nativeSupported && info.wasmSupported) {
      recs.push('Using WASM runtime - performance may be ~15% slower than native');
    }

    if (!info.nativeSupported && !info.wasmSupported) {
      recs.push('Using JavaScript fallback - performance may be ~60-75% slower');
    }

    if (!info.simdSupported && info.wasmSupported) {
      recs.push('SIMD not available - consider upgrading Node.js for better WASM performance');
    }

    if (info.nodeMajor < 18) {
      recs.push('Upgrade to Node.js 18+ for best performance and compatibility');
    }

    if (info.nodeMajor === 18 && info.wasmSupported && !info.simdSupported) {
      recs.push('Node.js 20+ has better WASM SIMD support');
    }

    return recs;
  }

  /**
   * Get platform string for binary selection
   */
  getBinaryPlatform(): string {
    const info = this.detect();
    return `${info.os}-${info.arch}`;
  }

  /**
   * Get detailed environment info for debugging
   */
  getEnvironmentInfo(): Record<string, unknown> {
    const info = this.detect();

    return {
      platform: info.platform,
      nodeVersion: info.nodeVersion,
      nodeMajor: info.nodeMajor,
      arch: process.arch,
      endianness: this.getEndianness(),
      v8Version: process.versions.v8,
      moduleVersion: process.versions.modules,
      capabilities: {
        native: info.nativeSupported,
        wasm: info.wasmSupported,
        simd: info.simdSupported,
      },
      env: {
        GOD_AGENT_RUNTIME: process.env.GOD_AGENT_RUNTIME,
        NODE_ENV: process.env.NODE_ENV,
      },
    };
  }

  /**
   * Get system endianness
   */
  private getEndianness(): 'LE' | 'BE' {
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setInt16(0, 256, true);
    return new Int16Array(buffer)[0] === 256 ? 'LE' : 'BE';
  }
}

// ==================== Global Instance ====================

/**
 * Global platform detector instance
 */
export const platformDetector = new PlatformDetector();
