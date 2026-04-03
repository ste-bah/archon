/**
 * TASK-MKT-001: Type definition tests for MarketPipelineConfig
 * Gate 1: tests-written-first
 *
 * These tests validate that the pipeline types are correctly defined
 * and that IMarketAnalysisTaskPreparation supports both pipeline and non-pipeline modes.
 */
import { describe, it, expect } from 'vitest';
import type {
  MarketPipelineAgent,
  MarketPipelinePhase,
  MarketPipelineConfig,
  MarketDataSource,
  IMarketAnalysisTaskPreparation,
} from '../../src/god-agent/universal/universal-agent.js';

describe('MarketPipelineAgent', () => {
  it('should accept a valid agent definition', () => {
    const agent: MarketPipelineAgent = {
      key: 'data-fetcher',
      name: 'Data Fetcher',
      prompt: 'Fetch price data for AAPL',
      mcpTools: ['mcp__market-terminal__get_price'],
      memoryReads: [],
      memoryWrites: ['market/data/AAPL/price'],
    };
    expect(agent.key).toBe('data-fetcher');
    expect(agent.mcpTools).toHaveLength(1);
    expect(agent.memoryReads).toHaveLength(0);
    expect(agent.memoryWrites).toHaveLength(1);
  });
});

describe('MarketPipelinePhase', () => {
  it('should accept a parallel phase with multiple agents', () => {
    const phase: MarketPipelinePhase = {
      phase: 1,
      name: 'Data Collection',
      parallel: true,
      agents: [
        { key: 'data-fetcher', name: 'Data Fetcher', prompt: 'fetch', mcpTools: [], memoryReads: [], memoryWrites: ['market/data/AAPL/price'] },
        { key: 'fundamentals-fetcher', name: 'Fundamentals Fetcher', prompt: 'fetch', mcpTools: [], memoryReads: [], memoryWrites: ['market/data/AAPL/fundamentals'] },
      ],
    };
    expect(phase.parallel).toBe(true);
    expect(phase.agents).toHaveLength(2);
  });

  it('should accept a sequential phase with one agent', () => {
    const phase: MarketPipelinePhase = {
      phase: 3,
      name: 'Aggregation',
      parallel: false,
      agents: [
        { key: 'composite-scorer', name: 'Composite Scorer', prompt: 'score', mcpTools: [], memoryReads: ['market/analysis/AAPL/wyckoff'], memoryWrites: ['market/analysis/AAPL/composite'] },
      ],
    };
    expect(phase.parallel).toBe(false);
    expect(phase.agents).toHaveLength(1);
  });
});

describe('MarketPipelineConfig', () => {
  it('should define a full 4-phase pipeline', () => {
    const config: MarketPipelineConfig = {
      ticker: 'AAPL',
      dataSourcePriority: ['market-terminal', 'perplexity', 'websearch'],
      phases: [
        { phase: 1, name: 'Data Collection', parallel: true, agents: [
          { key: 'data-fetcher', name: 'Data Fetcher', prompt: 'p1', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'fundamentals-fetcher', name: 'Fundamentals', prompt: 'p2', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'news-macro-fetcher', name: 'News', prompt: 'p3', mcpTools: [], memoryReads: [], memoryWrites: [] },
        ]},
        { phase: 2, name: 'Analysis', parallel: true, agents: [
          { key: 'wyckoff-analyzer', name: 'Wyckoff', prompt: 'p4', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'elliott-wave-analyzer', name: 'Elliott', prompt: 'p5', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'ict-analyzer', name: 'ICT', prompt: 'p6', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'canslim-analyzer', name: 'CANSLIM', prompt: 'p7', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'williams-analyzer', name: 'Williams', prompt: 'p8', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'sentiment-analyzer', name: 'Sentiment', prompt: 'p9', mcpTools: [], memoryReads: [], memoryWrites: [] },
        ]},
        { phase: 3, name: 'Aggregation', parallel: false, agents: [
          { key: 'composite-scorer', name: 'Composite', prompt: 'p10', mcpTools: [], memoryReads: [], memoryWrites: [] },
        ]},
        { phase: 4, name: 'Output', parallel: false, agents: [
          { key: 'thesis-generator', name: 'Thesis', prompt: 'p11', mcpTools: [], memoryReads: [], memoryWrites: [] },
          { key: 'report-formatter', name: 'Report', prompt: 'p12', mcpTools: [], memoryReads: [], memoryWrites: [] },
        ]},
      ],
    };
    expect(config.ticker).toBe('AAPL');
    expect(config.phases).toHaveLength(4);
    expect(config.dataSourcePriority).toEqual(['market-terminal', 'perplexity', 'websearch']);

    // Phase agent counts
    expect(config.phases[0].agents).toHaveLength(3);
    expect(config.phases[1].agents).toHaveLength(6);
    expect(config.phases[2].agents).toHaveLength(1);
    expect(config.phases[3].agents).toHaveLength(2);

    // Total agents
    const totalAgents = config.phases.reduce((sum, p) => sum + p.agents.length, 0);
    expect(totalAgents).toBe(12);
  });

  it('should enforce data source priority order', () => {
    const config: MarketPipelineConfig = {
      ticker: 'META',
      dataSourcePriority: ['market-terminal', 'perplexity', 'websearch'],
      phases: [],
    };
    expect(config.dataSourcePriority[0]).toBe('market-terminal');
    expect(config.dataSourcePriority[1]).toBe('perplexity');
    expect(config.dataSourcePriority[2]).toBe('websearch');
  });
});

describe('IMarketAnalysisTaskPreparation', () => {
  it('should support isPipeline: false for scan/compare (backward compat)', () => {
    const prep: IMarketAnalysisTaskPreparation = {
      selectedAgent: 'researcher',
      agentType: 'analyst',
      agentCategory: 'core',
      builtPrompt: 'scan for bullish signals',
      userTask: 'scan bullish',
      descContext: null,
      memoryContext: null,
      trajectoryId: null,
      isPipeline: false,
      pipeline: undefined,
      subCommand: 'scan',
      signalFilter: 'bullish',
    };
    expect(prep.isPipeline).toBe(false);
    expect(prep.pipeline).toBeUndefined();
  });

  it('should support isPipeline: true with pipeline config for analyze', () => {
    const prep: IMarketAnalysisTaskPreparation = {
      selectedAgent: 'data-fetcher',
      agentType: 'data-collector',
      agentCategory: 'market-pipeline',
      builtPrompt: 'analyze META',
      userTask: 'analyze META',
      descContext: null,
      memoryContext: null,
      trajectoryId: 'trj_123',
      isPipeline: true,
      pipeline: {
        ticker: 'META',
        dataSourcePriority: ['market-terminal', 'perplexity', 'websearch'],
        phases: [],
      },
      subCommand: 'analyze',
      ticker: 'META',
    };
    expect(prep.isPipeline).toBe(true);
    expect(prep.pipeline).toBeDefined();
    expect(prep.pipeline!.ticker).toBe('META');
  });
});
