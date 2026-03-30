/**
 * Compatibility Matrix
 * TASK-NFR-003 - Portability Validation Suite (NFR-5.3, NFR-5.4)
 *
 * Generates compatibility matrices for CI/CD:
 * - GitHub Actions matrix configuration
 * - Platform × Node.js version grid
 * - Expected test results documentation
 */

import { SUPPORTED_PLATFORMS, SUPPORTED_NODE_VERSIONS } from './platform-detector.js';

// ==================== Types ====================

/**
 * Platform test entry
 */
export interface PlatformTestEntry {
  /** Platform name */
  name: string;
  /** Operating system */
  os: string;
  /** Architecture */
  arch: string;
  /** Runtime tests to run */
  tests: ('native' | 'wasm' | 'javascript')[];
  /** Expected results per runtime */
  expectedResults: {
    native: 'pass' | 'skip' | 'fail';
    wasm: 'pass' | 'skip' | 'fail';
    javascript: 'pass' | 'skip' | 'fail';
  };
}

/**
 * Node.js version entry
 */
export interface NodeVersionEntry {
  /** Version string */
  version: string;
  /** LTS status */
  status: 'lts' | 'current' | 'maintenance' | 'eol';
  /** Testing priority */
  priority: 'high' | 'medium' | 'low';
  /** Special notes */
  notes?: string;
}

/**
 * GitHub Actions matrix configuration
 */
export interface GitHubActionsMatrix {
  /** OS runners */
  os: string[];
  /** Node.js versions */
  node: string[];
  /** Excluded combinations */
  exclude: { os: string; node: string }[];
  /** Additional test configurations */
  include: { os: string; node: string; flags?: string }[];
}

/**
 * Compatibility test suite
 */
export interface CompatibilityTestSuite {
  /** Platform configurations */
  platforms: PlatformTestEntry[];
  /** Node.js versions */
  nodeVersions: NodeVersionEntry[];
}

/**
 * Matrix entry result
 */
export interface MatrixEntryResult {
  /** OS runner */
  os: string;
  /** Node.js version */
  node: string;
  /** Architecture */
  arch: string;
  /** Native support */
  nativeSupported: boolean;
  /** WASM support */
  wasmSupported: boolean;
  /** Test command */
  testCommand: string;
}

// ==================== Compatibility Matrix ====================

/**
 * Compatibility matrix generator for NFR-5.3/5.4 validation
 *
 * Generates CI/CD matrix configurations for cross-platform testing.
 *
 * @example
 * ```typescript
 * const matrix = new CompatibilityMatrix();
 * const ghMatrix = matrix.generateGitHubActionsMatrix();
 *
 * console.log('OS:', ghMatrix.os);
 * console.log('Node:', ghMatrix.node);
 * ```
 */
export class CompatibilityMatrix {
  /**
   * Generate GitHub Actions matrix configuration
   */
  generateGitHubActionsMatrix(): GitHubActionsMatrix {
    return {
      os: ['ubuntu-22.04', 'ubuntu-24.04', 'macos-13', 'macos-14', 'windows-2022'],
      node: ['18', '20', '22'],
      exclude: [
        // No current exclusions - all combinations supported
      ],
      include: [
        // Primary native test configurations
        { os: 'ubuntu-22.04', node: '20', flags: '--native' },
        { os: 'macos-14', node: '20', flags: '--native' }, // ARM64
        { os: 'windows-2022', node: '20', flags: '--native' },
        // WASM fallback test
        { os: 'ubuntu-22.04', node: '20', flags: '--wasm' },
        // JavaScript fallback test
        { os: 'ubuntu-22.04', node: '20', flags: '--javascript' },
      ],
    };
  }

  /**
   * Generate complete compatibility test suite
   */
  generateTestSuite(): CompatibilityTestSuite {
    return {
      platforms: this.generatePlatformEntries(),
      nodeVersions: this.generateNodeVersionEntries(),
    };
  }

  /**
   * Generate platform test entries
   */
  private generatePlatformEntries(): PlatformTestEntry[] {
    return [
      {
        name: 'Linux x64 (Ubuntu)',
        os: 'linux',
        arch: 'x64',
        tests: ['native', 'wasm', 'javascript'],
        expectedResults: {
          native: 'pass',
          wasm: 'pass',
          javascript: 'pass',
        },
      },
      {
        name: 'Linux ARM64',
        os: 'linux',
        arch: 'arm64',
        tests: ['native', 'wasm', 'javascript'],
        expectedResults: {
          native: 'pass',
          wasm: 'pass',
          javascript: 'pass',
        },
      },
      {
        name: 'macOS x64 (Intel)',
        os: 'darwin',
        arch: 'x64',
        tests: ['native', 'wasm', 'javascript'],
        expectedResults: {
          native: 'pass',
          wasm: 'pass',
          javascript: 'pass',
        },
      },
      {
        name: 'macOS ARM64 (Apple Silicon)',
        os: 'darwin',
        arch: 'arm64',
        tests: ['native', 'wasm', 'javascript'],
        expectedResults: {
          native: 'pass',
          wasm: 'pass',
          javascript: 'pass',
        },
      },
      {
        name: 'Windows x64',
        os: 'win32',
        arch: 'x64',
        tests: ['native', 'wasm', 'javascript'],
        expectedResults: {
          native: 'pass',
          wasm: 'pass',
          javascript: 'pass',
        },
      },
      {
        name: 'Linux x86 (32-bit)',
        os: 'linux',
        arch: 'ia32',
        tests: ['wasm', 'javascript'],
        expectedResults: {
          native: 'skip', // No 32-bit native binaries
          wasm: 'pass',
          javascript: 'pass',
        },
      },
    ];
  }

  /**
   * Generate Node.js version entries
   */
  private generateNodeVersionEntries(): NodeVersionEntry[] {
    return [
      {
        version: '18.x',
        status: 'lts',
        priority: 'high',
        notes: 'LTS Hydrogen - maintenance until April 2025',
      },
      {
        version: '20.x',
        status: 'lts',
        priority: 'high',
        notes: 'LTS Iron - recommended for production',
      },
      {
        version: '22.x',
        status: 'current',
        priority: 'medium',
        notes: 'Current - LTS Jod from October 2024',
      },
    ];
  }

  /**
   * Generate full matrix entries (platform × node version)
   */
  generateFullMatrix(): MatrixEntryResult[] {
    const entries: MatrixEntryResult[] = [];
    const platforms = this.generatePlatformEntries();
    const nodeVersions = this.generateNodeVersionEntries();

    for (const platform of platforms) {
      for (const nodeVersion of nodeVersions) {
        const platformId = `${platform.os}-${platform.arch}`;
        entries.push({
          os: this.mapOsToRunner(platform.os, platform.arch),
          node: nodeVersion.version.replace('.x', ''),
          arch: platform.arch,
          nativeSupported: SUPPORTED_PLATFORMS.has(platformId),
          wasmSupported: true, // WASM supported on all modern platforms
          testCommand: this.generateTestCommand(platform, nodeVersion),
        });
      }
    }

    return entries;
  }

  /**
   * Map OS to GitHub Actions runner
   */
  private mapOsToRunner(os: string, arch: string): string {
    switch (os) {
      case 'linux':
        return arch === 'arm64' ? 'ubuntu-22.04-arm64' : 'ubuntu-22.04';
      case 'darwin':
        return arch === 'arm64' ? 'macos-14' : 'macos-13';
      case 'win32':
        return 'windows-2022';
      default:
        return 'ubuntu-22.04';
    }
  }

  /**
   * Generate test command for a matrix entry
   */
  private generateTestCommand(platform: PlatformTestEntry, nodeVersion: NodeVersionEntry): string {
    const flags = [];

    if (platform.expectedResults.native === 'pass') {
      flags.push('--native');
    }
    if (platform.expectedResults.wasm === 'pass') {
      flags.push('--wasm');
    }
    if (platform.expectedResults.javascript === 'pass') {
      flags.push('--javascript');
    }

    return `npm run portability-test -- ${flags.join(' ')}`;
  }

  /**
   * Generate YAML for GitHub Actions workflow
   */
  generateGitHubActionsYAML(): string {
    const matrix = this.generateGitHubActionsMatrix();

    return `# NFR-5 Portability Test Matrix
# Auto-generated by CompatibilityMatrix

name: Portability Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  portability-test:
    strategy:
      fail-fast: false
      matrix:
        os: ${JSON.stringify(matrix.os)}
        node: ${JSON.stringify(matrix.node)}
        ${matrix.exclude.length > 0 ? `exclude:\n${matrix.exclude.map(e => `          - os: ${e.os}\n            node: ${e.node}`).join('\n')}` : ''}
        ${matrix.include.length > 0 ? `include:\n${matrix.include.map(e => `          - os: ${e.os}\n            node: ${e.node}${e.flags ? `\n            flags: ${e.flags}` : ''}`).join('\n')}` : ''}

    runs-on: \${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run portability tests
        run: npm run portability-test -- \${{ matrix.flags || '' }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: portability-results-\${{ matrix.os }}-node\${{ matrix.node }}
          path: coverage/portability-report.json
`;
  }

  /**
   * Generate markdown compatibility table
   */
  generateMarkdownTable(): string {
    const platforms = this.generatePlatformEntries();
    const nodeVersions = this.generateNodeVersionEntries();

    let md = `# Compatibility Matrix\n\n`;
    md += `## Supported Platforms\n\n`;
    md += `| Platform | Native | WASM | JavaScript |\n`;
    md += `|----------|--------|------|------------|\n`;

    for (const platform of platforms) {
      const native = platform.expectedResults.native === 'pass' ? '✅' : '❌';
      const wasm = platform.expectedResults.wasm === 'pass' ? '✅' : '❌';
      const js = platform.expectedResults.javascript === 'pass' ? '✅' : '❌';
      md += `| ${platform.name} | ${native} | ${wasm} | ${js} |\n`;
    }

    md += `\n## Supported Node.js Versions\n\n`;
    md += `| Version | Status | Priority | Notes |\n`;
    md += `|---------|--------|----------|-------|\n`;

    for (const version of nodeVersions) {
      md += `| ${version.version} | ${version.status} | ${version.priority} | ${version.notes || '-'} |\n`;
    }

    return md;
  }

  /**
   * Check if a specific combination is supported
   */
  isSupported(os: string, arch: string, nodeVersion: number): boolean {
    const platform = `${os}-${arch}`;
    return (
      SUPPORTED_PLATFORMS.has(platform) &&
      SUPPORTED_NODE_VERSIONS.includes(nodeVersion)
    );
  }

  /**
   * Get recommendations for unsupported configurations
   */
  getRecommendations(os: string, arch: string, nodeVersion: number): string[] {
    const recommendations: string[] = [];
    const platform = `${os}-${arch}`;

    if (!SUPPORTED_PLATFORMS.has(platform)) {
      recommendations.push(
        `Platform ${platform} does not have native bindings. ` +
        `WASM or JavaScript fallback will be used automatically.`
      );
    }

    if (!SUPPORTED_NODE_VERSIONS.includes(nodeVersion)) {
      const latest = Math.max(...SUPPORTED_NODE_VERSIONS);
      recommendations.push(
        `Node.js ${nodeVersion} is not officially supported. ` +
        `Consider upgrading to Node.js ${latest} for best compatibility.`
      );
    }

    return recommendations;
  }
}

// ==================== Global Instance ====================

/**
 * Global compatibility matrix instance
 */
export const compatibilityMatrix = new CompatibilityMatrix();
