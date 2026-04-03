/**
 * TASK-MKT-002: Tests for buildMarketPipelineConfig()
 * Gate 1: tests-written-first
 */
import { describe, it, expect } from 'vitest';
import { buildMarketPipelineConfig } from '../../src/god-agent/universal/market-pipeline-builder.js';

describe('buildMarketPipelineConfig', () => {
  it('should return a config with 4 phases', () => {
    const config = buildMarketPipelineConfig('AAPL');
    expect(config.phases).toHaveLength(4);
  });

  it('should set the ticker', () => {
    const config = buildMarketPipelineConfig('META');
    expect(config.ticker).toBe('META');
  });

  it('should set data source priority in correct order', () => {
    const config = buildMarketPipelineConfig('AAPL');
    expect(config.dataSourcePriority[0]).toBe('market-terminal');
    expect(config.dataSourcePriority[1]).toBe('perplexity');
    expect(config.dataSourcePriority[2]).toBe('websearch');
  });

  describe('Phase 1: Data Collection', () => {
    it('should have 3 agents', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[0].agents).toHaveLength(3);
    });

    it('should be parallel', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[0].parallel).toBe(true);
    });

    it('should be phase 1', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[0].phase).toBe(1);
      expect(config.phases[0].name).toBe('Data Collection');
    });

    it('should include data-fetcher, fundamentals-fetcher, news-macro-fetcher', () => {
      const config = buildMarketPipelineConfig('AAPL');
      const keys = config.phases[0].agents.map(a => a.key);
      expect(keys).toContain('data-fetcher');
      expect(keys).toContain('fundamentals-fetcher');
      expect(keys).toContain('news-macro-fetcher');
    });

    it('should substitute ticker in prompts', () => {
      const config = buildMarketPipelineConfig('TSLA');
      for (const agent of config.phases[0].agents) {
        expect(agent.prompt).toContain('TSLA');
        expect(agent.prompt).not.toContain('{ticker}');
      }
    });

    it('should have non-empty memoryWrites for data fetchers', () => {
      const config = buildMarketPipelineConfig('AAPL');
      for (const agent of config.phases[0].agents) {
        expect(agent.memoryWrites.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Phase 2: Methodology Analysis', () => {
    it('should have 6 agents', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[1].agents).toHaveLength(6);
    });

    it('should be parallel', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[1].parallel).toBe(true);
    });

    it('should be phase 2', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[1].phase).toBe(2);
      expect(config.phases[1].name).toBe('Methodology Analysis');
    });

    it('should include all 6 analyzers', () => {
      const config = buildMarketPipelineConfig('AAPL');
      const keys = config.phases[1].agents.map(a => a.key);
      expect(keys).toContain('wyckoff-analyzer');
      expect(keys).toContain('elliott-wave-analyzer');
      expect(keys).toContain('ict-analyzer');
      expect(keys).toContain('canslim-analyzer');
      expect(keys).toContain('williams-analyzer');
      expect(keys).toContain('sentiment-analyzer');
    });

    it('should have non-empty memoryReads for analyzers', () => {
      const config = buildMarketPipelineConfig('AAPL');
      for (const agent of config.phases[1].agents) {
        expect(agent.memoryReads.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Phase 3: Aggregation', () => {
    it('should have 1 agent (composite-scorer)', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[2].agents).toHaveLength(1);
      expect(config.phases[2].agents[0].key).toBe('composite-scorer');
    });

    it('should be sequential', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[2].parallel).toBe(false);
    });

    it('should be phase 3', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[2].phase).toBe(3);
      expect(config.phases[2].name).toBe('Aggregation');
    });
  });

  describe('Phase 4: Output', () => {
    it('should have 2 agents (thesis-generator, report-formatter)', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[3].agents).toHaveLength(2);
      const keys = config.phases[3].agents.map(a => a.key);
      expect(keys).toContain('thesis-generator');
      expect(keys).toContain('report-formatter');
    });

    it('should be sequential', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[3].parallel).toBe(false);
    });

    it('should be phase 4', () => {
      const config = buildMarketPipelineConfig('AAPL');
      expect(config.phases[3].phase).toBe(4);
      expect(config.phases[3].name).toBe('Output');
    });
  });

  describe('Total agents', () => {
    it('should have 12 agents total across all phases', () => {
      const config = buildMarketPipelineConfig('AAPL');
      const total = config.phases.reduce((sum, p) => sum + p.agents.length, 0);
      expect(total).toBe(12);
    });

    it('should have unique agent keys', () => {
      const config = buildMarketPipelineConfig('AAPL');
      const keys = config.phases.flatMap(p => p.agents.map(a => a.key));
      expect(new Set(keys).size).toBe(12);
    });

    it('should have non-empty prompts for all agents', () => {
      const config = buildMarketPipelineConfig('AAPL');
      for (const phase of config.phases) {
        for (const agent of phase.agents) {
          expect(agent.prompt.length).toBeGreaterThan(50);
        }
      }
    });
  });
});
