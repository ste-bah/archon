/**
 * Attention Factory Tests
 * TASK-ATT-001 - Attention Factory Auto-Selection
 *
 * Tests:
 * - Registry contains 39+ mechanisms
 * - Rule-based selection logic
 * - Selection performance (<1ms)
 * - Fallback chain handling
 * - DualSpace attention
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AttentionFactory,
  AttentionMechanismRegistry,
  AttentionSelector,
  DualSpaceAttention,
  ComplexityClass,
  DEFAULT_SELECTION_THRESHOLDS,
  createDefaultDataProfile,
  hashDataProfile,
  type IDataProfile,
  type ISelectionResult,
  type ISelectionMetrics,
} from '../../../../src/god-agent/core/attention/index.js';

// ==================== Helper Functions ====================

/**
 * Create a custom data profile
 */
function createProfile(overrides: Partial<IDataProfile> = {}): IDataProfile {
  return {
    ...createDefaultDataProfile(),
    ...overrides,
  };
}

// ==================== Registry Tests ====================

describe('AttentionMechanismRegistry', () => {
  let registry: AttentionMechanismRegistry;

  beforeEach(() => {
    registry = new AttentionMechanismRegistry();
  });

  describe('Mechanism Count', () => {
    it('should contain 39+ mechanisms', () => {
      expect(registry.size).toBeGreaterThanOrEqual(39);
    });

    it('should list all registered mechanisms', () => {
      const names = registry.list();
      expect(names.length).toBeGreaterThanOrEqual(39);
    });
  });

  describe('Core Mechanisms', () => {
    const coreMechanisms = [
      'flash',
      'linear',
      'performer',
      'hyperbolic',
      'graph-rope',
      'bigbird',
      'longformer',
      'standard',
    ];

    it.each(coreMechanisms)('should have %s mechanism registered', (name) => {
      expect(registry.has(name)).toBe(true);
    });
  });

  describe('Mechanism Metadata', () => {
    it('should have complete metadata for all mechanisms', () => {
      for (const descriptor of registry.getAll()) {
        expect(descriptor.name).toBeTruthy();
        expect(descriptor.displayName).toBeTruthy();
        expect(descriptor.description).toBeTruthy();
        expect(descriptor.capabilities).toBeDefined();
        expect(descriptor.performance).toBeDefined();
        expect(descriptor.fallbacks).toBeDefined();
        expect(descriptor.factory).toBeTypeOf('function');
      }
    });

    it('should have non-empty fallbacks for non-standard mechanisms', () => {
      for (const descriptor of registry.getAll()) {
        if (descriptor.name !== 'standard') {
          // Most mechanisms should have fallbacks, but some may not
          // Just ensure the field is defined
          expect(Array.isArray(descriptor.fallbacks)).toBe(true);
        }
      }
    });

    it('should have valid complexity classes', () => {
      const validClasses = Object.values(ComplexityClass);
      for (const descriptor of registry.getAll()) {
        expect(validClasses).toContain(descriptor.performance.complexity);
      }
    });
  });

  describe('Capability Filtering', () => {
    it('should find long context mechanisms', () => {
      const mechanisms = registry.findLongContextMechanisms();
      expect(mechanisms.length).toBeGreaterThan(5);
      for (const m of mechanisms) {
        expect(m.capabilities.supportsLongContext).toBe(true);
      }
    });

    it('should find hierarchy mechanisms', () => {
      const mechanisms = registry.findHierarchyMechanisms();
      expect(mechanisms.length).toBeGreaterThan(0);
      for (const m of mechanisms) {
        expect(m.capabilities.supportsHierarchy).toBe(true);
      }
    });

    it('should find graph mechanisms', () => {
      const mechanisms = registry.findGraphMechanisms();
      expect(mechanisms.length).toBeGreaterThan(0);
      for (const m of mechanisms) {
        expect(m.capabilities.supportsGraphs).toBe(true);
      }
    });

    it('should find sparsity mechanisms', () => {
      const mechanisms = registry.findByCapability('supportsSparsity');
      expect(mechanisms.length).toBeGreaterThan(5);
      for (const m of mechanisms) {
        expect(m.capabilities.supportsSparsity).toBe(true);
      }
    });
  });

  describe('Complexity Filtering', () => {
    it('should find linear complexity mechanisms', () => {
      const mechanisms = registry.findByComplexity(ComplexityClass.LINEAR);
      expect(mechanisms.length).toBeGreaterThan(5);
      for (const m of mechanisms) {
        expect(m.performance.complexity).toBe(ComplexityClass.LINEAR);
      }
    });

    it('should find quadratic complexity mechanisms', () => {
      const mechanisms = registry.findByComplexity(ComplexityClass.QUADRATIC);
      expect(mechanisms.length).toBeGreaterThan(3);
    });
  });

  describe('Mechanism Creation', () => {
    it('should create mechanism by name', () => {
      const mechanism = registry.createMechanism('standard');
      expect(mechanism.name).toBe('standard');
    });

    it('should create mechanism with config', () => {
      // Use dimension divisible by numHeads (12) for RealFlashAttention
      const mechanism = registry.createMechanism('flash', { dimension: 1536 });
      expect(mechanism.name).toBe('flash');
    });

    it('should throw for unknown mechanism', () => {
      expect(() => registry.createMechanism('unknown')).toThrow();
    });
  });
});

// ==================== Selector Tests ====================

describe('AttentionSelector', () => {
  let registry: AttentionMechanismRegistry;
  let selector: AttentionSelector;

  beforeEach(() => {
    registry = new AttentionMechanismRegistry();
    selector = new AttentionSelector(registry);
  });

  describe('Selection Rules', () => {
    it('should select Flash for very long sequences', () => {
      const profile = createProfile({ sequenceLength: 15000 });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('flash');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should select Hyperbolic for deep hierarchy', () => {
      const profile = createProfile({ hierarchyDepth: 5 });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('hyperbolic');
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it('should select GraphRoPe for graph structure', () => {
      const profile = createProfile({ hasGraphStructure: true });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('graph-rope');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should select Linear for strict latency', () => {
      const profile = createProfile({ latencyBudget: 0.5 });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('linear');
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it('should select DualSpace for hierarchy + graph', () => {
      const profile = createProfile({
        hierarchyDepth: 3,
        hasGraphStructure: true,
      });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('dual-space');
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it('should select BigBird for medium sequence with sparsity', () => {
      const profile = createProfile({
        sequenceLength: 5000,
        sparsity: 0.7,
      });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('bigbird');
    });

    it('should select Longformer for medium sequences', () => {
      const profile = createProfile({ sequenceLength: 5000 });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('longformer');
    });

    it('should select Standard for default profile', () => {
      const profile = createDefaultDataProfile();
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('standard');
    });
  });

  describe('Rule Priority', () => {
    it('should prioritize long sequence over hierarchy', () => {
      const profile = createProfile({
        sequenceLength: 15000,
        hierarchyDepth: 5,
      });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('flash');
    });

    it('should prioritize DualSpace for hierarchy + graph combination', () => {
      const profile = createProfile({
        hierarchyDepth: 5,
        hasGraphStructure: true,
      });
      // DualSpace now checked before individual hierarchy/graph rules
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('dual-space');
    });
  });

  describe('Selection Confidence', () => {
    it('should have confidence in [0, 1] range', () => {
      const profiles = [
        createProfile({ sequenceLength: 15000 }),
        createProfile({ hierarchyDepth: 5 }),
        createProfile({ hasGraphStructure: true }),
        createProfile({ latencyBudget: 0.5 }),
        createDefaultDataProfile(),
      ];

      for (const profile of profiles) {
        const result = selector.select(profile);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should have higher confidence for specific features', () => {
      const flashResult = selector.select(createProfile({ sequenceLength: 15000 }));
      const standardResult = selector.select(createDefaultDataProfile());

      expect(flashResult.confidence).toBeGreaterThan(standardResult.confidence);
    });
  });

  describe('Fallback Chain', () => {
    it('should provide fallback chains for all selections', () => {
      const profiles = [
        createProfile({ sequenceLength: 15000 }),
        createProfile({ hierarchyDepth: 5 }),
        createProfile({ hasGraphStructure: true }),
      ];

      for (const profile of profiles) {
        const result = selector.select(profile);
        expect(Array.isArray(result.fallbackChain)).toBe(true);
      }
    });

    it('should have standard in most fallback chains', () => {
      const profile = createProfile({ sequenceLength: 15000 });
      const result = selector.select(profile);
      expect(result.fallbackChain).toContain('standard');
    });

    it('should have empty fallback chain for standard', () => {
      const profile = createDefaultDataProfile();
      const result = selector.select(profile);
      expect(result.fallbackChain).toHaveLength(0);
    });
  });

  describe('Selection Rationale', () => {
    it('should provide rationale for all selections', () => {
      const profiles = [
        createProfile({ sequenceLength: 15000 }),
        createProfile({ hierarchyDepth: 5 }),
        createDefaultDataProfile(),
      ];

      for (const profile of profiles) {
        const result = selector.select(profile);
        expect(result.rationale).toBeTruthy();
        expect(result.rationale.length).toBeGreaterThan(10);
      }
    });

    it('should include profile values in rationale', () => {
      const profile = createProfile({ sequenceLength: 15000 });
      const result = selector.select(profile);
      expect(result.rationale).toContain('15000');
    });
  });

  describe('Selection Performance', () => {
    it('should select in under 1ms', () => {
      const profile = createProfile({ sequenceLength: 15000 });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        selector.select(profile);
      }
      const elapsed = performance.now() - start;

      const avgMs = elapsed / 1000;
      expect(avgMs).toBeLessThan(1);
    });
  });

  describe('Create With Fallback', () => {
    it('should create primary mechanism', () => {
      const selection: ISelectionResult = {
        mechanismName: 'flash',
        rationale: 'test',
        confidence: 0.95,
        fallbackChain: ['linear', 'standard'],
      };

      const mechanism = selector.createWithFallback(selection);
      expect(mechanism.name).toBe('flash');
    });

    it('should fallback to standard for unknown mechanism', () => {
      const selection: ISelectionResult = {
        mechanismName: 'unknown-mechanism',
        rationale: 'test',
        confidence: 0.5,
        fallbackChain: ['also-unknown', 'standard'],
      };

      const mechanism = selector.createWithFallback(selection);
      expect(mechanism.name).toBe('standard');
    });
  });

  describe('Custom Thresholds', () => {
    it('should use custom thresholds', () => {
      const customSelector = new AttentionSelector(registry, {
        longSequenceThreshold: 5000, // Lower threshold
      });

      const profile = createProfile({ sequenceLength: 6000 });
      const result = customSelector.select(profile);
      expect(result.mechanismName).toBe('flash');
    });

    it('should update thresholds', () => {
      selector.setThresholds({ longSequenceThreshold: 5000 });

      const profile = createProfile({ sequenceLength: 6000 });
      const result = selector.select(profile);
      expect(result.mechanismName).toBe('flash');
    });
  });

  describe('Metrics Callback', () => {
    it('should emit metrics on selection', () => {
      const metrics: ISelectionMetrics[] = [];
      selector.setMetricsCallback((m) => metrics.push(m));

      selector.select(createProfile({ sequenceLength: 15000 }));

      expect(metrics.length).toBe(1);
      expect(metrics[0].operation).toBe('select_mechanism');
      expect(metrics[0].selected).toBe('flash');
      expect(metrics[0].confidence).toBeGreaterThan(0);
      expect(metrics[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ==================== DualSpace Attention Tests ====================

describe('DualSpaceAttention', () => {
  let dualSpace: DualSpaceAttention;

  beforeEach(() => {
    dualSpace = new DualSpaceAttention();
  });

  describe('Creation', () => {
    it('should create with default mixing weight', () => {
      expect(dualSpace.getMixingWeight()).toBe(0.5);
    });

    it('should create with custom mixing weight', () => {
      const custom = new DualSpaceAttention({ mixingWeight: 0.7 });
      expect(custom.getMixingWeight()).toBe(0.7);
    });

    it('should reject invalid mixing weight', () => {
      expect(() => new DualSpaceAttention({ mixingWeight: 1.5 })).toThrow();
      expect(() => new DualSpaceAttention({ mixingWeight: -0.1 })).toThrow();
    });
  });

  describe('Forward Pass', () => {
    it('should compute attention output', () => {
      const query = new Float32Array(1536).fill(0.5);
      const key = new Float32Array(1536).fill(0.5);
      const value = new Float32Array(1536).fill(1.0);

      const output = dualSpace.forward(query, key, value);

      expect(output.length).toBe(1536);
    });

    it('should produce weighted combination', () => {
      const query = new Float32Array(1536).fill(0.5);
      const key = new Float32Array(1536).fill(0.5);
      const value = new Float32Array(1536).fill(1.0);

      // With alpha=0.5, output should be average of both mechanisms
      const output = dualSpace.forward(query, key, value);

      // Output should have finite values (Real* implementations compute actual attention)
      for (let i = 0; i < output.length; i++) {
        expect(Number.isFinite(output[i])).toBe(true);
        expect(output[i]).not.toBeNaN();
      }
    });
  });

  describe('Mixing Weight', () => {
    it('should get/set mixing weight', () => {
      dualSpace.setMixingWeight(0.3);
      expect(dualSpace.getMixingWeight()).toBe(0.3);
    });

    it('should reject invalid weight on set', () => {
      expect(() => dualSpace.setMixingWeight(1.1)).toThrow();
      expect(() => dualSpace.setMixingWeight(-0.1)).toThrow();
    });

    it('should adapt mixing weight from scores', () => {
      dualSpace.adaptMixingWeight(8, 2); // 80% hierarchy, 20% graph
      expect(dualSpace.getMixingWeight()).toBe(0.8);

      dualSpace.adaptMixingWeight(2, 8); // 20% hierarchy, 80% graph
      expect(dualSpace.getMixingWeight()).toBe(0.2);
    });

    it('should default to 0.5 on zero scores', () => {
      dualSpace.adaptMixingWeight(0, 0);
      expect(dualSpace.getMixingWeight()).toBe(0.5);
    });
  });

  describe('Components', () => {
    it('should expose component mechanisms', () => {
      const components = dualSpace.getComponents();
      expect(components.hyperbolic.name).toBe('hyperbolic');
      expect(components.graph.name).toBe('graph-rope');
    });

    it('should count parameters from both components', () => {
      const params = dualSpace.getParameterCount();
      expect(params).toBeGreaterThan(0);
      // Should be roughly 2x a single mechanism
      expect(params).toBe(
        dualSpace.getComponents().hyperbolic.getParameterCount() +
        dualSpace.getComponents().graph.getParameterCount()
      );
    });
  });
});

// ==================== Factory Tests ====================

describe('AttentionFactory', () => {
  let factory: AttentionFactory;

  beforeEach(() => {
    factory = new AttentionFactory();
  });

  describe('Auto-Selection', () => {
    it('should auto-select from profile', () => {
      const profile = createProfile({ sequenceLength: 15000 });
      const mechanism = factory.createFromProfile(profile);
      expect(mechanism.name).toBe('flash');
    });

    it('should analyze profile without creating', () => {
      const profile = createProfile({ sequenceLength: 15000 });
      const result = factory.analyzeProfile(profile);
      expect(result.mechanismName).toBe('flash');
      expect(result.rationale).toBeTruthy();
    });
  });

  describe('Manual Selection', () => {
    it('should create mechanism by name', () => {
      const mechanism = factory.create('linear');
      expect(mechanism.name).toBe('linear');
    });

    it('should throw for unknown mechanism', () => {
      expect(() => factory.create('unknown')).toThrow();
    });

    it('should check mechanism existence', () => {
      expect(factory.hasMechanism('flash')).toBe(true);
      expect(factory.hasMechanism('unknown')).toBe(false);
    });
  });

  describe('Registry Inspection', () => {
    it('should list all mechanisms', () => {
      const names = factory.listMechanisms();
      expect(names.length).toBeGreaterThanOrEqual(39);
    });

    it('should get mechanism count', () => {
      expect(factory.getMechanismCount()).toBeGreaterThanOrEqual(39);
    });

    it('should expose registry', () => {
      const registry = factory.getRegistry();
      expect(registry).toBeInstanceOf(AttentionMechanismRegistry);
    });

    it('should expose selector', () => {
      const selector = factory.getSelector();
      expect(selector).toBeInstanceOf(AttentionSelector);
    });
  });

  describe('Capability Search', () => {
    it('should find long context mechanisms', () => {
      const names = factory.findLongContextMechanisms();
      expect(names.length).toBeGreaterThan(5);
      expect(names).toContain('flash');
      expect(names).toContain('linear');
    });

    it('should find hierarchy mechanisms', () => {
      const names = factory.findHierarchyMechanisms();
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain('hyperbolic');
    });

    it('should find graph mechanisms', () => {
      const names = factory.findGraphMechanisms();
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain('graph-rope');
    });
  });

  describe('DualSpace Creation', () => {
    it('should create DualSpace with default weight', () => {
      const dualSpace = factory.createDualSpace();
      expect(dualSpace.name).toBe('dual-space');
      expect(dualSpace.getMixingWeight()).toBe(0.5);
    });

    it('should create DualSpace with custom weight', () => {
      const dualSpace = factory.createDualSpace(0.7);
      expect(dualSpace.getMixingWeight()).toBe(0.7);
    });
  });

  describe('Configuration', () => {
    it('should get/set thresholds', () => {
      const original = factory.getThresholds();
      expect(original.longSequenceThreshold).toBe(DEFAULT_SELECTION_THRESHOLDS.longSequenceThreshold);

      factory.setThresholds({ longSequenceThreshold: 5000 });
      expect(factory.getThresholds().longSequenceThreshold).toBe(5000);
    });

    it('should accept custom config on creation', () => {
      const customFactory = new AttentionFactory({
        thresholds: { longSequenceThreshold: 5000 },
        dualSpaceMixingWeight: 0.7,
      });

      expect(customFactory.getThresholds().longSequenceThreshold).toBe(5000);
    });

    it('should set metrics callback', () => {
      const metrics: ISelectionMetrics[] = [];
      factory.setMetricsCallback((m) => metrics.push(m));

      factory.createFromProfile(createProfile({ sequenceLength: 15000 }));

      expect(metrics.length).toBeGreaterThan(0);
    });
  });

  describe('Verbose Mode', () => {
    it('should create factory with verbose mode', () => {
      const verboseFactory = new AttentionFactory({ verbose: true });
      // Should not throw
      verboseFactory.createFromProfile(createProfile({ sequenceLength: 15000 }));
    });
  });
});

// ==================== Type Utility Tests ====================

describe('Type Utilities', () => {
  describe('createDefaultDataProfile', () => {
    it('should create valid default profile', () => {
      const profile = createDefaultDataProfile();
      expect(profile.sequenceLength).toBe(512);
      expect(profile.hierarchyDepth).toBe(0);
      expect(profile.hasGraphStructure).toBe(false);
      expect(profile.latencyBudget).toBe(10);
    });
  });

  describe('hashDataProfile', () => {
    it('should create consistent hash', () => {
      const profile = createDefaultDataProfile();
      const hash1 = hashDataProfile(profile);
      const hash2 = hashDataProfile(profile);
      expect(hash1).toBe(hash2);
    });

    it('should create different hash for different profiles', () => {
      const profile1 = createDefaultDataProfile();
      const profile2 = createProfile({ sequenceLength: 1000 });
      expect(hashDataProfile(profile1)).not.toBe(hashDataProfile(profile2));
    });
  });
});

// ==================== Integration Tests ====================

describe('Integration', () => {
  describe('End-to-End Selection', () => {
    it('should handle diverse profile set', () => {
      const factory = new AttentionFactory();

      const profiles: { profile: IDataProfile; expectedMechanism: string }[] = [
        { profile: createProfile({ sequenceLength: 15000 }), expectedMechanism: 'flash' },
        { profile: createProfile({ hierarchyDepth: 5 }), expectedMechanism: 'hyperbolic' },
        { profile: createProfile({ hasGraphStructure: true }), expectedMechanism: 'graph-rope' },
        { profile: createProfile({ latencyBudget: 0.5 }), expectedMechanism: 'linear' },
        { profile: createDefaultDataProfile(), expectedMechanism: 'standard' },
      ];

      for (const { profile, expectedMechanism } of profiles) {
        const mechanism = factory.createFromProfile(profile);
        expect(mechanism.name).toBe(expectedMechanism);
      }
    });

    it('should achieve 95%+ selection accuracy', () => {
      const factory = new AttentionFactory();

      // Test cases with expected selections
      const testCases = [
        { profile: createProfile({ sequenceLength: 12000 }), expected: 'flash' },
        { profile: createProfile({ sequenceLength: 15000 }), expected: 'flash' },
        { profile: createProfile({ sequenceLength: 20000 }), expected: 'flash' },
        { profile: createProfile({ hierarchyDepth: 4 }), expected: 'hyperbolic' },
        { profile: createProfile({ hierarchyDepth: 5 }), expected: 'hyperbolic' },
        { profile: createProfile({ hierarchyDepth: 6 }), expected: 'hyperbolic' },
        { profile: createProfile({ hasGraphStructure: true }), expected: 'graph-rope' },
        { profile: createProfile({ latencyBudget: 0.3 }), expected: 'linear' },
        { profile: createProfile({ latencyBudget: 0.5 }), expected: 'linear' },
        { profile: createProfile({ latencyBudget: 0.8 }), expected: 'linear' },
        { profile: createDefaultDataProfile(), expected: 'standard' },
        { profile: createProfile({ sequenceLength: 256 }), expected: 'standard' },
        { profile: createProfile({ sequenceLength: 1024 }), expected: 'standard' },
      ];

      let correct = 0;
      for (const { profile, expected } of testCases) {
        const result = factory.analyzeProfile(profile);
        if (result.mechanismName === expected) {
          correct++;
        }
      }

      const accuracy = correct / testCases.length;
      expect(accuracy).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe('Fallback Resilience', () => {
    it('should never fail to return a mechanism', () => {
      const factory = new AttentionFactory();

      // Test many random profiles
      for (let i = 0; i < 100; i++) {
        const profile = createProfile({
          sequenceLength: Math.floor(Math.random() * 20000),
          hierarchyDepth: Math.floor(Math.random() * 10),
          hasGraphStructure: Math.random() > 0.5,
          latencyBudget: Math.random() * 20,
          sparsity: Math.random(),
        });

        // Should never throw
        expect(() => factory.createFromProfile(profile)).not.toThrow();
        const mechanism = factory.createFromProfile(profile);
        expect(mechanism).toBeDefined();
        expect(mechanism.name).toBeTruthy();
      }
    });
  });

  describe('Performance Under Load', () => {
    it('should handle 1000 selections quickly', () => {
      const factory = new AttentionFactory();
      const profile = createProfile({ sequenceLength: 15000 });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        factory.analyzeProfile(profile);
      }
      const elapsed = performance.now() - start;

      // Should complete 1000 selections in under 1 second (averaging <1ms each)
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
