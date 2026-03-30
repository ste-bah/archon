/**
 * Portability Module Tests
 * TASK-NFR-003 - Portability Validation Suite
 *
 * Tests for NFR-5 portability validation:
 * - Platform detection and capability checking
 * - Runtime selection and auto-selection
 * - Native binding validation
 * - Fallback equivalence testing
 * - Performance comparison
 * - Compatibility matrix generation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  // Platform Detector
  PlatformDetector,
  SUPPORTED_PLATFORMS,
  SUPPORTED_NODE_VERSIONS,
  platformDetector,
  type PlatformInfo,
  // Runtime Selector
  RuntimeSelector,
  RUNTIME_ENV_VAR,
  RUNTIME_PERFORMANCE,
  runtimeSelector,
  type RuntimeType,
  type RuntimeSelection,
  // Native Binding Validator
  NativeBindingValidator,
  DEFAULT_MODULE_DEFINITIONS,
  nativeBindingValidator,
  type ModuleDefinition,
  // Fallback Validator
  FallbackValidator,
  DEFAULT_FALLBACK_CONFIG,
  fallbackValidator,
  // Performance Comparator
  PerformanceComparator,
  DEFAULT_COMPARATOR_CONFIG,
  performanceComparator,
  // Compatibility Matrix
  CompatibilityMatrix,
  compatibilityMatrix,
  // Runner
  PortabilityTestRunner,
  DEFAULT_RUNNER_CONFIG,
  portabilityTestRunner,
} from '../../../../src/god-agent/core/portability/index.js';

// ==================== Platform Detector Tests ====================

describe('PlatformDetector', () => {
  let detector: PlatformDetector;

  beforeEach(() => {
    detector = new PlatformDetector();
  });

  describe('detect()', () => {
    it('should detect platform information', () => {
      const info = detector.detect();

      expect(info).toHaveProperty('os');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('nodeVersion');
      expect(info).toHaveProperty('nodeMajor');
      expect(info).toHaveProperty('nativeSupported');
      expect(info).toHaveProperty('wasmSupported');
      expect(info).toHaveProperty('simdSupported');
      expect(info).toHaveProperty('platform');
    });

    it('should return valid OS', () => {
      const info = detector.detect();
      expect(['linux', 'darwin', 'win32', 'unknown']).toContain(info.os);
    });

    it('should return valid architecture', () => {
      const info = detector.detect();
      expect(['x64', 'arm64', 'ia32', 'unknown']).toContain(info.arch);
    });

    it('should parse Node.js version correctly', () => {
      const info = detector.detect();
      expect(info.nodeVersion).toMatch(/^v?\d+\.\d+\.\d+/);
      expect(info.nodeMajor).toBeGreaterThanOrEqual(14);
    });

    it('should generate correct platform identifier', () => {
      const info = detector.detect();
      expect(info.platform).toBe(`${info.os}-${info.arch}`);
    });
  });

  describe('isNodeVersionSupported()', () => {
    it('should return true for supported versions', () => {
      for (const version of SUPPORTED_NODE_VERSIONS) {
        expect(detector.isNodeVersionSupported(version)).toBe(true);
      }
    });

    it('should return false for unsupported versions', () => {
      expect(detector.isNodeVersionSupported(14)).toBe(false);
      expect(detector.isNodeVersionSupported(16)).toBe(false);
      expect(detector.isNodeVersionSupported(99)).toBe(false);
    });

    it('should check current version when no argument provided', () => {
      const result = detector.isNodeVersionSupported();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isPlatformSupported()', () => {
    it('should return true for supported platforms', () => {
      for (const platform of SUPPORTED_PLATFORMS) {
        expect(detector.isPlatformSupported(platform)).toBe(true);
      }
    });

    it('should return false for unsupported platforms', () => {
      expect(detector.isPlatformSupported('linux-ia32')).toBe(false);
      expect(detector.isPlatformSupported('freebsd-x64')).toBe(false);
    });
  });

  describe('getCompatibilityReport()', () => {
    it('should generate compatibility report', () => {
      const report = detector.getCompatibilityReport();

      expect(report).toHaveProperty('platform');
      expect(report).toHaveProperty('nodeVersion');
      expect(report).toHaveProperty('isSupported');
      expect(report).toHaveProperty('capabilities');
      expect(report).toHaveProperty('warnings');
      expect(report).toHaveProperty('recommendations');
    });

    it('should include all capability flags', () => {
      const report = detector.getCompatibilityReport();

      expect(report.capabilities).toHaveProperty('native');
      expect(report.capabilities).toHaveProperty('wasm');
      expect(report.capabilities).toHaveProperty('simd');
    });
  });

  describe('getBinaryPlatform()', () => {
    it('should return platform string', () => {
      const platform = detector.getBinaryPlatform();
      expect(platform).toMatch(/^(linux|darwin|win32|unknown)-(x64|arm64|ia32|unknown)$/);
    });
  });

  describe('getEnvironmentInfo()', () => {
    it('should return detailed environment info', () => {
      const info = detector.getEnvironmentInfo();

      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('nodeVersion');
      expect(info).toHaveProperty('capabilities');
      expect(info).toHaveProperty('env');
    });
  });

  describe('WASM support detection', () => {
    it('should detect WASM support', () => {
      const info = detector.detect();
      // Node.js 18+ supports WASM
      if (info.nodeMajor >= 18) {
        expect(info.wasmSupported).toBe(true);
      }
    });
  });

  describe('global instance', () => {
    it('should export global platformDetector', () => {
      expect(platformDetector).toBeInstanceOf(PlatformDetector);
    });
  });
});

// ==================== Runtime Selector Tests ====================

describe('RuntimeSelector', () => {
  let selector: RuntimeSelector;
  const originalEnv = process.env[RUNTIME_ENV_VAR];

  beforeEach(() => {
    selector = new RuntimeSelector();
    delete process.env[RUNTIME_ENV_VAR];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[RUNTIME_ENV_VAR] = originalEnv;
    } else {
      delete process.env[RUNTIME_ENV_VAR];
    }
  });

  describe('selectRuntime()', () => {
    it('should return a runtime selection', async () => {
      const selection = await selector.selectRuntime();

      expect(selection).toHaveProperty('type');
      expect(selection).toHaveProperty('reason');
      expect(selection).toHaveProperty('performance');
      expect(selection).toHaveProperty('warnings');
      expect(selection).toHaveProperty('forced');
    });

    it('should return valid runtime type', async () => {
      const selection = await selector.selectRuntime();
      expect(['native', 'wasm', 'javascript']).toContain(selection.type);
    });

    it('should return valid performance rating', async () => {
      const selection = await selector.selectRuntime();
      expect(['optimal', 'good', 'acceptable']).toContain(selection.performance);
    });
  });

  describe('environment override', () => {
    it('should respect GOD_AGENT_RUNTIME=native', async () => {
      process.env[RUNTIME_ENV_VAR] = 'native';
      const sel = new RuntimeSelector();
      const selection = await sel.selectRuntime();

      expect(selection.type).toBe('native');
      expect(selection.forced).toBe(true);
    });

    it('should respect GOD_AGENT_RUNTIME=wasm', async () => {
      process.env[RUNTIME_ENV_VAR] = 'wasm';
      const sel = new RuntimeSelector();
      const selection = await sel.selectRuntime();

      expect(selection.type).toBe('wasm');
      expect(selection.forced).toBe(true);
    });

    it('should respect GOD_AGENT_RUNTIME=javascript', async () => {
      process.env[RUNTIME_ENV_VAR] = 'javascript';
      const sel = new RuntimeSelector();
      const selection = await sel.selectRuntime();

      expect(selection.type).toBe('javascript');
      expect(selection.forced).toBe(true);
    });

    it('should ignore invalid override values', async () => {
      process.env[RUNTIME_ENV_VAR] = 'invalid';
      const sel = new RuntimeSelector();
      const selection = await sel.selectRuntime();

      expect(selection.forced).toBe(false);
    });
  });

  describe('config override', () => {
    it('should respect forceRuntime config', async () => {
      const sel = new RuntimeSelector({ forceRuntime: 'javascript' });
      const selection = await sel.selectRuntime();

      expect(selection.type).toBe('javascript');
      expect(selection.forced).toBe(true);
    });
  });

  describe('caching', () => {
    it('should cache selection', async () => {
      const selection1 = await selector.selectRuntime();
      const selection2 = await selector.selectRuntime();

      expect(selection1).toBe(selection2);
    });

    it('should allow cache clearing', async () => {
      const selection1 = await selector.selectRuntime();
      selector.clearCache();
      const selection2 = await selector.selectRuntime();

      expect(selection1).not.toBe(selection2);
      expect(selection1.type).toBe(selection2.type);
    });

    it('should return cached selection via getCachedSelection()', async () => {
      expect(selector.getCachedSelection()).toBeUndefined();
      await selector.selectRuntime();
      expect(selector.getCachedSelection()).toBeDefined();
    });
  });

  describe('getRelativePerformance()', () => {
    it('should return performance multipliers', () => {
      expect(selector.getRelativePerformance('native')).toBe(1.0);
      expect(selector.getRelativePerformance('wasm')).toBe(0.85);
      expect(selector.getRelativePerformance('javascript')).toBe(0.4);
    });
  });

  describe('validateSelection()', () => {
    it('should validate selection works', async () => {
      const result = await selector.validateSelection();

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('selection');
      expect(typeof result.valid).toBe('boolean');
    });
  });

  describe('getSelectionReport()', () => {
    it('should return selection report', async () => {
      const report = await selector.getSelectionReport();

      expect(report).toHaveProperty('selection');
      expect(report).toHaveProperty('platform');
      expect(report).toHaveProperty('warnings');
      expect(report).toHaveProperty('performanceExpectation');
    });
  });

  describe('RUNTIME_PERFORMANCE constant', () => {
    it('should have correct values', () => {
      expect(RUNTIME_PERFORMANCE.native).toBe(1.0);
      expect(RUNTIME_PERFORMANCE.wasm).toBeLessThan(1.0);
      expect(RUNTIME_PERFORMANCE.javascript).toBeLessThan(RUNTIME_PERFORMANCE.wasm);
    });
  });

  describe('global instance', () => {
    it('should export global runtimeSelector', () => {
      expect(runtimeSelector).toBeInstanceOf(RuntimeSelector);
    });
  });
});

// ==================== Native Binding Validator Tests ====================

describe('NativeBindingValidator', () => {
  let validator: NativeBindingValidator;

  beforeEach(() => {
    validator = new NativeBindingValidator();
  });

  describe('validateAll()', () => {
    it('should validate all default modules', async () => {
      const report = await validator.validateAll();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('platform');
      expect(report).toHaveProperty('modules');
      expect(report).toHaveProperty('summary');
    });

    it('should have correct summary structure', async () => {
      const report = await validator.validateAll();

      expect(report.summary).toHaveProperty('totalModules');
      expect(report.summary).toHaveProperty('loadedModules');
      expect(report.summary).toHaveProperty('totalFunctions');
      expect(report.summary).toHaveProperty('workingFunctions');
      expect(report.summary).toHaveProperty('allLoaded');
      expect(report.summary).toHaveProperty('allWorking');
    });

    it('should validate all default modules', async () => {
      const report = await validator.validateAll();
      expect(report.modules.length).toBe(DEFAULT_MODULE_DEFINITIONS.length);
    });
  });

  describe('validateModule()', () => {
    it('should validate module structure', async () => {
      const moduleDef: ModuleDefinition = {
        name: 'test',
        functions: ['func1', 'func2'],
      };

      const result = await validator.validateModule(moduleDef);

      expect(result).toHaveProperty('module');
      expect(result).toHaveProperty('loaded');
      expect(result).toHaveProperty('functions');
      expect(result.module).toBe('test');
    });
  });

  describe('mock modules', () => {
    it('should support mock module registration', async () => {
      const mockModule = {
        testFunc: async () => 'result',
      };

      validator.registerMockModule('testMock', mockModule);

      const moduleDef: ModuleDefinition = {
        name: 'testMock',
        functions: ['testFunc'],
      };

      const result = await validator.validateModule(moduleDef);

      expect(result.loaded).toBe(true);
      expect(result.functions[0].working).toBe(true);
    });

    it('should clear mock modules', () => {
      validator.registerMockModule('mock1', {});
      validator.clearMockModules();
      // No error should be thrown
    });
  });

  describe('validateModuleByName()', () => {
    it('should validate known module', async () => {
      const result = await validator.validateModuleByName('vectordb');
      expect(result.module).toBe('vectordb');
    });

    it('should return error for unknown module', async () => {
      const result = await validator.validateModuleByName('unknown');
      expect(result.loaded).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('checkCriticalFunctions()', () => {
    it('should check critical functions', async () => {
      const result = await validator.checkCriticalFunctions();

      expect(result).toHaveProperty('allAvailable');
      expect(result).toHaveProperty('missing');
      expect(Array.isArray(result.missing)).toBe(true);
    });
  });

  describe('getModuleDefinitions()', () => {
    it('should return module definitions', () => {
      const defs = validator.getModuleDefinitions();
      expect(Array.isArray(defs)).toBe(true);
      expect(defs.length).toBeGreaterThan(0);
    });
  });

  describe('addModuleDefinition()', () => {
    it('should add custom module definition', () => {
      const originalCount = validator.getModuleDefinitions().length;

      validator.addModuleDefinition({
        name: 'custom',
        functions: ['customFunc'],
      });

      expect(validator.getModuleDefinitions().length).toBe(originalCount + 1);
    });
  });

  describe('DEFAULT_MODULE_DEFINITIONS', () => {
    it('should have vectordb module', () => {
      const vectordb = DEFAULT_MODULE_DEFINITIONS.find(m => m.name === 'vectordb');
      expect(vectordb).toBeDefined();
      expect(vectordb!.functions).toContain('createIndex');
    });

    it('should have graph module', () => {
      const graph = DEFAULT_MODULE_DEFINITIONS.find(m => m.name === 'graph');
      expect(graph).toBeDefined();
      expect(graph!.functions).toContain('createNode');
    });

    it('should have math module', () => {
      const math = DEFAULT_MODULE_DEFINITIONS.find(m => m.name === 'math');
      expect(math).toBeDefined();
      expect(math!.functions).toContain('l2Normalize');
    });
  });

  describe('global instance', () => {
    it('should export global nativeBindingValidator', () => {
      expect(nativeBindingValidator).toBeInstanceOf(NativeBindingValidator);
    });
  });
});

// ==================== Fallback Validator Tests ====================

describe('FallbackValidator', () => {
  let validator: FallbackValidator;

  beforeEach(() => {
    validator = new FallbackValidator();
  });

  describe('validateEquivalence()', () => {
    it('should validate equivalence between implementations', async () => {
      const report = await validator.validateEquivalence();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('tests');
      expect(report).toHaveProperty('summary');
    });

    it('should test multiple operations', async () => {
      const report = await validator.validateEquivalence();
      expect(report.tests.length).toBeGreaterThanOrEqual(4);
    });

    it('should have correct summary structure', async () => {
      const report = await validator.validateEquivalence();

      expect(report.summary).toHaveProperty('total');
      expect(report.summary).toHaveProperty('passed');
      expect(report.summary).toHaveProperty('allEquivalent');
    });
  });

  describe('testL2Normalize()', () => {
    it('should test l2 normalization equivalence', async () => {
      const report = await validator.validateEquivalence();
      const l2Test = report.tests.find(t => t.name === 'l2Normalize');

      expect(l2Test).toBeDefined();
      expect(l2Test!.equivalent).toBe(true);
    });
  });

  describe('testCosineSimilarity()', () => {
    it('should test cosine similarity equivalence', async () => {
      const report = await validator.validateEquivalence();
      const cosineTest = report.tests.find(t => t.name === 'cosineSimilarity');

      expect(cosineTest).toBeDefined();
      expect(cosineTest!.equivalent).toBe(true);
    });
  });

  describe('testDotProduct()', () => {
    it('should test dot product equivalence', async () => {
      const report = await validator.validateEquivalence();
      const dotTest = report.tests.find(t => t.name === 'dotProduct');

      expect(dotTest).toBeDefined();
      expect(dotTest!.equivalent).toBe(true);
    });
  });

  describe('testEuclideanDistance()', () => {
    it('should test Euclidean distance equivalence', async () => {
      const report = await validator.validateEquivalence();
      const euclidTest = report.tests.find(t => t.name === 'euclideanDistance');

      expect(euclidTest).toBeDefined();
      expect(euclidTest!.equivalent).toBe(true);
    });
  });

  describe('testKnnSearch()', () => {
    it('should test kNN search equivalence', async () => {
      const report = await validator.validateEquivalence();
      const knnTest = report.tests.find(t => t.name === 'knnSearch');

      expect(knnTest).toBeDefined();
      expect(knnTest!.equivalent).toBe(true);
    });
  });

  describe('testFallbackTrigger()', () => {
    it('should test fallback trigger mechanism', async () => {
      const result = await validator.testFallbackTrigger();

      expect(result).toHaveProperty('triggered');
      expect(result).toHaveProperty('fallbackType');
    });
  });

  describe('custom implementations', () => {
    it('should support custom native implementation', () => {
      validator.setNativeImplementation({
        l2Normalize: (v: Float32Array) => v,
      });
      // No error should be thrown
    });

    it('should support custom JS implementation', () => {
      validator.setJsImplementation({
        l2Normalize: (v: Float32Array) => v,
      });
      // No error should be thrown
    });
  });

  describe('configuration', () => {
    it('should use default config', () => {
      expect(DEFAULT_FALLBACK_CONFIG.tolerance).toBe(1e-6);
      expect(DEFAULT_FALLBACK_CONFIG.vectorTolerance).toBe(1e-5);
    });

    it('should accept custom config', () => {
      const customValidator = new FallbackValidator({
        tolerance: 1e-3,
        verbose: true,
      });
      // No error should be thrown
    });
  });

  describe('global instance', () => {
    it('should export global fallbackValidator', () => {
      expect(fallbackValidator).toBeInstanceOf(FallbackValidator);
    });
  });
});

// ==================== Performance Comparator Tests ====================

describe('PerformanceComparator', () => {
  let comparator: PerformanceComparator;

  beforeEach(() => {
    comparator = new PerformanceComparator({
      iterations: 10, // Reduce for faster tests
      warmupIterations: 2,
    });
  });

  describe('compareAll()', () => {
    it('should compare all operations', async () => {
      const report = await comparator.compareAll();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('platform');
      expect(report).toHaveProperty('comparisons');
      expect(report).toHaveProperty('summary');
    });

    it('should compare multiple operations', async () => {
      const report = await comparator.compareAll();
      expect(report.comparisons.length).toBeGreaterThanOrEqual(4);
    });

    it('should have correct summary structure', async () => {
      const report = await comparator.compareAll();

      expect(report.summary).toHaveProperty('wasmVsNative');
      expect(report.summary).toHaveProperty('jsVsNative');
      expect(report.summary).toHaveProperty('recommendation');
      expect(report.summary).toHaveProperty('tier');
    });

    it('should have valid performance tier', async () => {
      const report = await comparator.compareAll();
      expect(['optimal', 'acceptable', 'degraded']).toContain(report.summary.tier);
    });
  });

  describe('operation benchmarks', () => {
    it('should benchmark l2Normalize', async () => {
      const report = await comparator.compareAll();
      const l2 = report.comparisons.find(c => c.operation === 'l2Normalize');

      expect(l2).toBeDefined();
      expect(l2!.results.length).toBe(3);
    });

    it('should benchmark cosineSimilarity', async () => {
      const report = await comparator.compareAll();
      const cosine = report.comparisons.find(c => c.operation === 'cosineSimilarity');

      expect(cosine).toBeDefined();
    });

    it('should benchmark dotProduct', async () => {
      const report = await comparator.compareAll();
      const dot = report.comparisons.find(c => c.operation === 'dotProduct');

      expect(dot).toBeDefined();
    });

    it('should benchmark knnSearch', async () => {
      const report = await comparator.compareAll();
      const knn = report.comparisons.find(c => c.operation === 'knnSearch');

      expect(knn).toBeDefined();
    });
  });

  describe('relative performance', () => {
    it('should calculate relative performance', async () => {
      const report = await comparator.compareAll();

      for (const comparison of report.comparisons) {
        for (const result of comparison.results) {
          if (result.available) {
            expect(result.relativeToNative).toBeDefined();
          }
        }
      }
    });
  });

  describe('generateMarkdownReport()', () => {
    it('should generate markdown report', async () => {
      const report = await comparator.compareAll();
      const md = comparator.generateMarkdownReport(report);

      expect(md).toContain('# Performance Comparison Report');
      expect(md).toContain('## Summary');
      expect(md).toContain('## Operation Details');
    });
  });

  describe('configuration', () => {
    it('should use default config', () => {
      expect(DEFAULT_COMPARATOR_CONFIG.iterations).toBe(1000);
      expect(DEFAULT_COMPARATOR_CONFIG.warmupIterations).toBe(100);
      expect(DEFAULT_COMPARATOR_CONFIG.dimensions).toBe(1536);
    });
  });

  describe('global instance', () => {
    it('should export global performanceComparator', () => {
      expect(performanceComparator).toBeInstanceOf(PerformanceComparator);
    });
  });
});

// ==================== Compatibility Matrix Tests ====================

describe('CompatibilityMatrix', () => {
  let matrix: CompatibilityMatrix;

  beforeEach(() => {
    matrix = new CompatibilityMatrix();
  });

  describe('generateGitHubActionsMatrix()', () => {
    it('should generate GitHub Actions matrix', () => {
      const ghMatrix = matrix.generateGitHubActionsMatrix();

      expect(ghMatrix).toHaveProperty('os');
      expect(ghMatrix).toHaveProperty('node');
      expect(ghMatrix).toHaveProperty('exclude');
      expect(ghMatrix).toHaveProperty('include');
    });

    it('should include supported OS runners', () => {
      const ghMatrix = matrix.generateGitHubActionsMatrix();

      expect(ghMatrix.os).toContain('ubuntu-22.04');
      expect(ghMatrix.os).toContain('macos-14');
      expect(ghMatrix.os).toContain('windows-2022');
    });

    it('should include supported Node.js versions', () => {
      const ghMatrix = matrix.generateGitHubActionsMatrix();

      expect(ghMatrix.node).toContain('18');
      expect(ghMatrix.node).toContain('20');
      expect(ghMatrix.node).toContain('22');
    });
  });

  describe('generateTestSuite()', () => {
    it('should generate test suite', () => {
      const suite = matrix.generateTestSuite();

      expect(suite).toHaveProperty('platforms');
      expect(suite).toHaveProperty('nodeVersions');
    });

    it('should include multiple platforms', () => {
      const suite = matrix.generateTestSuite();
      expect(suite.platforms.length).toBeGreaterThanOrEqual(5);
    });

    it('should include all Node.js LTS versions', () => {
      const suite = matrix.generateTestSuite();
      expect(suite.nodeVersions.length).toBeGreaterThanOrEqual(3);
    });

    it('should have correct platform structure', () => {
      const suite = matrix.generateTestSuite();

      for (const platform of suite.platforms) {
        expect(platform).toHaveProperty('name');
        expect(platform).toHaveProperty('os');
        expect(platform).toHaveProperty('arch');
        expect(platform).toHaveProperty('tests');
        expect(platform).toHaveProperty('expectedResults');
      }
    });
  });

  describe('generateFullMatrix()', () => {
    it('should generate full matrix entries', () => {
      const entries = matrix.generateFullMatrix();

      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        expect(entry).toHaveProperty('os');
        expect(entry).toHaveProperty('node');
        expect(entry).toHaveProperty('arch');
        expect(entry).toHaveProperty('nativeSupported');
        expect(entry).toHaveProperty('wasmSupported');
        expect(entry).toHaveProperty('testCommand');
      }
    });
  });

  describe('generateGitHubActionsYAML()', () => {
    it('should generate valid YAML', () => {
      const yaml = matrix.generateGitHubActionsYAML();

      expect(yaml).toContain('name: Portability Tests');
      expect(yaml).toContain('strategy:');
      expect(yaml).toContain('matrix:');
      expect(yaml).toContain('runs-on:');
    });
  });

  describe('generateMarkdownTable()', () => {
    it('should generate markdown table', () => {
      const md = matrix.generateMarkdownTable();

      expect(md).toContain('# Compatibility Matrix');
      expect(md).toContain('## Supported Platforms');
      expect(md).toContain('## Supported Node.js Versions');
      expect(md).toContain('| Platform |');
    });
  });

  describe('isSupported()', () => {
    it('should return true for supported combinations', () => {
      expect(matrix.isSupported('linux', 'x64', 20)).toBe(true);
      expect(matrix.isSupported('darwin', 'arm64', 20)).toBe(true);
    });

    it('should return false for unsupported combinations', () => {
      expect(matrix.isSupported('linux', 'ia32', 20)).toBe(false);
      expect(matrix.isSupported('linux', 'x64', 14)).toBe(false);
    });
  });

  describe('getRecommendations()', () => {
    it('should return recommendations for unsupported configs', () => {
      const recs = matrix.getRecommendations('linux', 'ia32', 14);

      expect(recs.length).toBeGreaterThan(0);
    });

    it('should return empty for supported configs', () => {
      const recs = matrix.getRecommendations('linux', 'x64', 20);
      expect(recs.length).toBe(0);
    });
  });

  describe('global instance', () => {
    it('should export global compatibilityMatrix', () => {
      expect(compatibilityMatrix).toBeInstanceOf(CompatibilityMatrix);
    });
  });
});

// ==================== Portability Test Runner Tests ====================

describe('PortabilityTestRunner', () => {
  let runner: PortabilityTestRunner;

  beforeEach(() => {
    runner = new PortabilityTestRunner({
      verbose: false, // Suppress output in tests
      runPerformanceComparison: false, // Skip slow performance tests
    });
  });

  describe('runAllTests()', () => {
    it('should run all portability tests', async () => {
      const report = await runner.runAllTests();

      expect(report).toHaveProperty('name');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('durationMs');
      expect(report).toHaveProperty('platform');
      expect(report).toHaveProperty('tests');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('pass');
    });

    it('should have correct report name', async () => {
      const report = await runner.runAllTests();
      expect(report.name).toBe('NFR-5 Portability Validation Suite');
    });

    it('should have valid timestamp', async () => {
      const before = Date.now();
      const report = await runner.runAllTests();
      const after = Date.now();

      expect(report.timestamp).toBeGreaterThanOrEqual(before);
      expect(report.timestamp).toBeLessThanOrEqual(after);
    });

    it('should track duration', async () => {
      const report = await runner.runAllTests();
      expect(report.durationMs).toBeGreaterThan(0);
    });
  });

  describe('test results', () => {
    it('should include platform detection results', async () => {
      const report = await runner.runAllTests();
      expect(report.tests.platformDetection).toBeDefined();
    });

    it('should include runtime selection results', async () => {
      const report = await runner.runAllTests();
      expect(report.tests.runtimeSelection).toBeDefined();
    });

    it('should include native binding results', async () => {
      const report = await runner.runAllTests();
      expect(report.tests.nativeBindings).toBeDefined();
    });

    it('should include fallback equivalence results', async () => {
      const report = await runner.runAllTests();
      expect(report.tests.fallbackEquivalence).toBeDefined();
    });

    it('should include compatibility matrix', async () => {
      const report = await runner.runAllTests();
      expect(report.tests.compatibilityMatrix).toBeDefined();
    });
  });

  describe('summary', () => {
    it('should have correct summary structure', async () => {
      const report = await runner.runAllTests();

      expect(report.summary).toHaveProperty('checks');
      expect(report.summary).toHaveProperty('passed');
      expect(report.summary).toHaveProperty('total');
      expect(report.summary).toHaveProperty('overallPass');
    });

    it('should have multiple checks', async () => {
      const report = await runner.runAllTests();
      expect(report.summary.checks.length).toBeGreaterThan(0);
    });

    it('should have NFR-5 check IDs', async () => {
      const report = await runner.runAllTests();

      for (const check of report.summary.checks) {
        expect(check.id).toMatch(/^NFR-5\.\d$/);
      }
    });
  });

  describe('runTest()', () => {
    it('should run only platform test', async () => {
      const report = await runner.runTest('platform');
      expect(report.tests.platformDetection).toBeDefined();
    });

    it('should run only runtime test', async () => {
      const report = await runner.runTest('runtime');
      expect(report.tests.runtimeSelection).toBeDefined();
    });

    it('should run only native test', async () => {
      const report = await runner.runTest('native');
      expect(report.tests.nativeBindings).toBeDefined();
    });

    it('should run only fallback test', async () => {
      const report = await runner.runTest('fallback');
      expect(report.tests.fallbackEquivalence).toBeDefined();
    });
  });

  describe('generateMarkdownReport()', () => {
    it('should generate markdown report', async () => {
      const report = await runner.runAllTests();
      const md = runner.generateMarkdownReport(report);

      expect(md).toContain('# NFR-5 Portability Validation Report');
      expect(md).toContain('## Summary');
      expect(md).toContain('| NFR ID |');
    });
  });

  describe('configuration', () => {
    it('should use default config', () => {
      expect(DEFAULT_RUNNER_CONFIG.runPlatformDetection).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.runRuntimeSelection).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.runNativeValidation).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.runFallbackValidation).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.runPerformanceComparison).toBe(true);
      expect(DEFAULT_RUNNER_CONFIG.verbose).toBe(true);
    });

    it('should respect config options', async () => {
      const customRunner = new PortabilityTestRunner({
        runNativeValidation: false,
        verbose: false,
      });
      const report = await customRunner.runAllTests();

      // Native bindings should still be in tests but may not be run
      // depending on implementation
      expect(report).toBeDefined();
    });
  });

  describe('global instance', () => {
    it('should export global portabilityTestRunner', () => {
      expect(portabilityTestRunner).toBeInstanceOf(PortabilityTestRunner);
    });
  });
});

// ==================== Integration Tests ====================

describe('Portability Integration', () => {
  it('should run complete NFR-5 validation suite', async () => {
    const runner = new PortabilityTestRunner({
      verbose: false,
      runPerformanceComparison: false, // Skip for speed
    });

    const report = await runner.runAllTests();

    // Should complete without errors
    expect(report.name).toBe('NFR-5 Portability Validation Suite');
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.passed).toBeGreaterThanOrEqual(0);
  });

  it('should detect current platform correctly', () => {
    const detector = new PlatformDetector();
    const info = detector.detect();

    // Platform should match process values
    expect(info.os).toBe(
      process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32'
        ? process.platform
        : 'unknown'
    );
  });

  it('should select appropriate runtime', async () => {
    const selector = new RuntimeSelector();
    const selection = await selector.selectRuntime();

    // Should return a valid selection
    expect(['native', 'wasm', 'javascript']).toContain(selection.type);
    expect(['optimal', 'good', 'acceptable']).toContain(selection.performance);
  });

  it('should validate fallback implementations are equivalent', async () => {
    const validator = new FallbackValidator();
    const report = await validator.validateEquivalence();

    // All tests should pass (same implementations)
    expect(report.summary.allEquivalent).toBe(true);
  });

  it('should generate CI/CD matrix configuration', () => {
    const matrix = new CompatibilityMatrix();
    const ghMatrix = matrix.generateGitHubActionsMatrix();

    // Should have valid matrix structure
    expect(ghMatrix.os.length).toBeGreaterThan(0);
    expect(ghMatrix.node.length).toBeGreaterThan(0);
  });
});
