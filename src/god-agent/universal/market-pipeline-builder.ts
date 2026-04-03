/**
 * Market Pipeline Builder (TASK-MKT-002)
 *
 * Reads market-pipeline agent .md files, extracts prompt templates,
 * memory keys, and MCP tools, then builds a MarketPipelineConfig
 * with 4 phases and 12 agents for orchestrated market analysis.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  MarketPipelineAgent,
  MarketPipelinePhase,
  MarketPipelineConfig,
} from './universal-agent.js';

// Resolve pipeline agent directory relative to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const PIPELINE_DIR = join(PROJECT_ROOT, '.claude', 'agents', 'market-pipeline');

/** Pipeline phase definitions: which agents belong to which phase */
const PHASE_DEFINITIONS: Array<{
  phase: 1 | 2 | 3 | 4;
  name: string;
  parallel: boolean;
  agentKeys: string[];
}> = [
  {
    phase: 1,
    name: 'Data Collection',
    parallel: true,
    agentKeys: ['data-fetcher', 'fundamentals-fetcher', 'news-macro-fetcher'],
  },
  {
    phase: 2,
    name: 'Methodology Analysis',
    parallel: true,
    agentKeys: [
      'wyckoff-analyzer',
      'elliott-wave-analyzer',
      'ict-analyzer',
      'canslim-analyzer',
      'williams-analyzer',
      'sentiment-analyzer',
    ],
  },
  {
    phase: 3,
    name: 'Aggregation',
    parallel: false,
    agentKeys: ['composite-scorer'],
  },
  {
    phase: 4,
    name: 'Output',
    parallel: false,
    agentKeys: ['thesis-generator', 'report-formatter'],
  },
];

/**
 * Read an agent .md file and return its raw content.
 * Returns null if the file cannot be read.
 */
function readAgentFile(agentKey: string): string | null {
  try {
    return readFileSync(join(PIPELINE_DIR, `${agentKey}.md`), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Extract the agent display name from the first markdown heading.
 * Falls back to the agent key with hyphens replaced by spaces and title-cased.
 */
function extractName(content: string, agentKey: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return agentKey
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Extract the prompt template section from the agent .md file.
 *
 * The agent files have "## Prompt Template" followed by a fenced block
 * that contains nested ## headings and even nested ``` blocks.
 * Strategy: find "## Prompt Template", then scan forward line-by-line
 * to find the outermost opening/closing fence pair.
 */
function extractPromptTemplate(content: string): string {
  const sectionStart = content.indexOf('## Prompt Template');
  if (sectionStart === -1) {
    // Fallback: use the Role section (skip frontmatter)
    const bodyStart = content.indexOf('---', 3);
    const body = bodyStart !== -1 ? content.slice(bodyStart + 3) : content;
    const roleSectionMatch = body.match(
      /## Role\s*\n([\s\S]*?)(?=\n## )/
    );
    return roleSectionMatch ? roleSectionMatch[1].trim() : '';
  }

  // Get everything after "## Prompt Template"
  const afterHeading = content.slice(sectionStart + '## Prompt Template'.length);
  const lines = afterHeading.split('\n');

  let insideFence = false;
  let fenceStartLine = -1;
  let fenceEndLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      if (!insideFence) {
        // Opening fence
        insideFence = true;
        fenceStartLine = i;
      } else {
        // Could be a closing fence or a nested opening fence.
        // We track the outermost pair: find the LAST ``` that could
        // close the outermost block. We use a simple heuristic:
        // a line that is exactly ``` (no language tag) after the opening.
        fenceEndLine = i;
      }
    }
  }

  if (fenceStartLine === -1 || fenceEndLine === -1) return '';

  // Extract lines between opening and closing fences
  const promptLines = lines.slice(fenceStartLine + 1, fenceEndLine);
  return promptLines.join('\n').trim();
}

/**
 * Extract MCP tool names from the "## MCP Tools" section.
 * Looks for backtick-wrapped tool calls.
 */
function extractMcpTools(content: string): string[] {
  const toolSection = content.match(/## MCP Tools\s*\n([\s\S]*?)(?=\n## )/);
  if (!toolSection) return [];

  const tools: string[] = [];
  const toolPattern = /`(mcp__[a-z_-]+__[a-z_]+)/g;
  let match;
  while ((match = toolPattern.exec(toolSection[1])) !== null) {
    if (!tools.includes(match[1])) {
      tools.push(match[1]);
    }
  }
  return tools;
}

/**
 * Extract memory read keys from the "## Memory Reads" section.
 * Looks for quoted key patterns like "market/data/{ticker}/price".
 */
function extractMemoryKeys(content: string, section: 'Memory Reads' | 'Memory Writes'): string[] {
  const sectionMatch = content.match(
    new RegExp(`## ${section}\\s*\\n([\\s\\S]*?)(?=\\n## )`)
  );
  if (!sectionMatch) return [];

  const keys: string[] = [];
  const keyPattern = /"(market\/[a-z_/{}]+)"/g;
  let match;
  while ((match = keyPattern.exec(sectionMatch[1])) !== null) {
    if (!keys.includes(match[1])) {
      keys.push(match[1]);
    }
  }
  return keys;
}

/**
 * Build a MarketPipelineAgent from an agent .md file.
 */
function buildAgent(agentKey: string, ticker: string): MarketPipelineAgent | null {
  const content = readAgentFile(agentKey);
  if (!content) return null;

  const name = extractName(content, agentKey);
  const promptTemplate = extractPromptTemplate(content);
  const mcpTools = extractMcpTools(content);
  const memoryReads = extractMemoryKeys(content, 'Memory Reads');
  const memoryWrites = extractMemoryKeys(content, 'Memory Writes');

  // Warn if prompt template is empty -- file exists but has no extractable prompt
  if (!promptTemplate) {
    console.error(`[MarketPipeline] Warning: Agent '${agentKey}' has no extractable Prompt Template or Role section`);
  }

  // Substitute {ticker} with actual ticker
  const prompt = promptTemplate.replace(/\{ticker\}/g, ticker);
  const resolvedReads = memoryReads.map(k => k.replace(/\{ticker\}/g, ticker));
  const resolvedWrites = memoryWrites.map(k => k.replace(/\{ticker\}/g, ticker));

  return {
    key: agentKey,
    name,
    prompt,
    mcpTools,
    memoryReads: resolvedReads,
    memoryWrites: resolvedWrites,
  };
}

/**
 * Build the full MarketPipelineConfig for a given ticker.
 *
 * Reads all 12 agent .md files from .claude/agents/market-pipeline/,
 * extracts prompt templates, memory keys, and MCP tools,
 * and assembles them into 4 phases.
 *
 * @param ticker - The ticker symbol to analyze (e.g., "AAPL")
 * @returns MarketPipelineConfig with all phases and agents
 */
export function buildMarketPipelineConfig(ticker: string): MarketPipelineConfig {
  // Normalize ticker to uppercase for consistent memory keys and MCP calls
  ticker = ticker.toUpperCase();

  const phases: MarketPipelinePhase[] = PHASE_DEFINITIONS.map(phaseDef => {
    const agents: MarketPipelineAgent[] = [];

    for (const agentKey of phaseDef.agentKeys) {
      const agent = buildAgent(agentKey, ticker);
      if (agent) {
        agents.push(agent);
      } else {
        // Log warning but continue -- graceful degradation
        console.error(`[MarketPipeline] Warning: Could not load agent '${agentKey}', skipping`);
      }
    }

    return {
      phase: phaseDef.phase,
      name: phaseDef.name,
      parallel: phaseDef.parallel,
      agents,
    };
  });

  // Validate: at least one agent loaded total, otherwise the config is hollow
  const totalAgents = phases.reduce((sum, p) => sum + p.agents.length, 0);
  if (totalAgents === 0) {
    throw new Error(
      `[MarketPipeline] No agents loaded from ${PIPELINE_DIR}. ` +
      'Ensure .claude/agents/market-pipeline/ contains valid agent .md files.'
    );
  }

  return {
    ticker,
    phases,
    dataSourcePriority: ['market-terminal', 'perplexity', 'websearch'],
  };
}
