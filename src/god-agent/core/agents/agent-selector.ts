/**
 * Agent Selector
 * TASK-002: DAI-001 Core Layer
 *
 * Selects appropriate agent(s) for a given task based on
 * keywords, capabilities, and priority ranking.
 *
 * Per constitution.md:
 * - RULE-004: MUST query AgentRegistry, NOT hardcode agents
 * - RULE-003: MUST throw AgentSelectionError with full context on no match
 */

import type { ILoadedAgentDefinition } from './agent-types.js';
import type { AgentRegistry } from './agent-registry.js';
import { AgentSelectionError } from './agent-errors.js';

// ==================== Types ====================

/**
 * Task analysis result
 */
export interface ITaskAnalysis {
  /** Extracted keywords from task */
  keywords: string[];
  /** Detected task type */
  taskType: 'design' | 'code' | 'research' | 'write' | 'ask' | 'general';
  /** Required capabilities for task */
  requiredCapabilities: string[];
  /** Preferred agent categories */
  preferredCategories: string[];
}

/**
 * Scored agent for ranking
 */
export interface IScoredAgent {
  /** The agent definition */
  agent: ILoadedAgentDefinition;
  /** Relevance score (0-1) */
  score: number;
  /** Reasons for the score */
  matchReasons: string[];
}

/**
 * Selection result
 */
export interface IAgentSelectionResult {
  /** Selected agent */
  selected: ILoadedAgentDefinition;
  /** All candidates with scores */
  candidates: IScoredAgent[];
  /** Analysis that led to selection */
  analysis: ITaskAnalysis;
}

// ==================== Constants ====================

/**
 * Task type detection patterns
 */
const TASK_TYPE_PATTERNS: Record<
  ITaskAnalysis['taskType'],
  RegExp[]
> = {
  design: [
    // Systems architecture patterns - should be checked FIRST
    /\b(?:design|architect)\b.*\b(?:system|agent|service|platform|infrastructure)\b/i,
    /\b(?:system|agent|service|platform)\b.*\b(?:design|architect)\b/i,
    /\b(?:observability|monitoring|telemetry|tracing|logging)\b.*\b(?:system|design|architecture)\b/i,
    /\b(?:architecture|blueprint|diagram|schema)\b/i,
    /\bdesign\b.*\b(?:pattern|principles?|scalab|microservices?)\b/i,
  ],
  code: [
    /\b(?:implement|code|write|create|build|develop|refactor|fix|debug)\b/i,
    /\b(?:function|class|method|api|endpoint|component|module)\b/i,
    /\b(?:typescript|javascript|python|java|rust|go)\b/i,
  ],
  research: [
    /\b(?:research|analyze|investigate|study|explore|examine|review)\b/i,
    /\b(?:literature|papers?|articles?|sources?|data|evidence)\b/i,
    /\b(?:findings?|insights?|conclusions?|synthesis)\b/i,
    // Book/document knowledge retrieval patterns (added for TASK-ROUTING-001)
    /\b(?:what|how|why|when|where|who|which).*\b(?:book|document|chapter|paper|article)\b/i,
    /\b(?:book|document|paper|article).*\b(?:says?|states?|describes?|explains?|mentions?)\b/i,
    /\b(?:according to|from the|in the)\b.*\b(?:book|document|chapter|paper|article)\b/i,
    /\b(?:governance|framework|model|theory|concept).*\b(?:book|document)\b/i,
  ],
  write: [
    /\b(?:write|draft|compose|author|document|describe)\b/i,
    /\b(?:paper|article|report|documentation|readme|guide)\b/i,
    /\b(?:section|chapter|abstract|introduction|conclusion)\b/i,
    // Exclude systems design from write - those go to code
    // Note: "design" without system/agent context falls through to write
  ],
  ask: [
    /\b(?:what|how|why|when|where|who|which|explain|tell)\b/i,
    /\?$/,
  ],
  general: [], // Fallback
};

/**
 * Capability mapping for task types
 */
const TASK_TYPE_CAPABILITIES: Record<ITaskAnalysis['taskType'], string[]> = {
  design: ['architecture', 'design', 'system', 'observability', 'monitoring', 'telemetry', 'infrastructure', 'scalability', 'patterns'],
  code: ['code', 'implementation', 'development', 'programming', 'engineering'],
  research: ['research', 'analysis', 'synthesis', 'investigation', 'review', 'knowledge', 'retrieval'],
  write: ['writing', 'documentation', 'content', 'authoring'],
  ask: ['answer', 'explain', 'knowledge', 'general'],
  general: ['architecture', 'system'],
};

/**
 * Category preferences for task types
 * Note: Order matters - first categories get priority
 */
const TASK_TYPE_CATEGORIES: Record<ITaskAnalysis['taskType'], string[]> = {
  design: ['architecture', 'core', 'systeminspect', 'sprinkle'],  // Architecture first for design tasks
  code: ['core', 'logicalcode', 'frontendvisualsimplementation', 'sprinkle', 'systeminspect'],
  research: ['core', 'business-research', 'phdresearch', 'sprinkle'],  // core has researcher.md
  write: ['writing', 'sprinkle', 'phdresearch'],  // Writing agents first for write tasks
  ask: ['core', 'sprinkle'],  // Put core first - researcher.md is there
  general: ['architecture', 'core', 'sprinkle'],
};

/**
 * Priority order for ranking
 */
const PRIORITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ==================== Agent Selector ====================

/**
 * AgentSelector
 *
 * Analyzes tasks and selects appropriate agents from AgentRegistry.
 * NO hardcoded agent lists - all selection based on registry queries.
 */
export class AgentSelector {
  private registry: AgentRegistry;
  private verbose: boolean;

  constructor(registry: AgentRegistry, options?: { verbose?: boolean }) {
    this.registry = registry;
    this.verbose = options?.verbose ?? false;
  }

  /**
   * Analyze task to extract selection criteria
   */
  analyzeTask(task: string): ITaskAnalysis {
    const keywords = this.extractKeywords(task);
    const taskType = this.detectTaskType(task);
    const requiredCapabilities = TASK_TYPE_CAPABILITIES[taskType];
    const preferredCategories = TASK_TYPE_CATEGORIES[taskType];

    const analysis: ITaskAnalysis = {
      keywords,
      taskType,
      requiredCapabilities,
      preferredCategories,
    };

    if (this.verbose) {
      console.log(`[AgentSelector] Task analysis:`, JSON.stringify(analysis, null, 2));
    }

    return analysis;
  }

  /**
   * Select best agent for task
   * @throws AgentSelectionError if no suitable agent found
   */
  selectAgent(task: string): IAgentSelectionResult {
    const analysis = this.analyzeTask(task);
    const candidates = this.scoreAgents(analysis);

    if (candidates.length === 0) {
      throw new AgentSelectionError(
        task,
        this.registry.getAll().map(a => a.key),
        {
          taskType: analysis.taskType,
          requiredCapabilities: analysis.requiredCapabilities,
        }
      );
    }

    // Sort by score (descending), then priority, then alphabetically
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const aPriority = PRIORITY_ORDER[a.agent.frontmatter.priority ?? 'medium'];
      const bPriority = PRIORITY_ORDER[b.agent.frontmatter.priority ?? 'medium'];
      if (bPriority !== aPriority) return bPriority - aPriority;

      return a.agent.key.localeCompare(b.agent.key);
    });

    const selected = candidates[0].agent;

    if (this.verbose) {
      console.log(
        `[AgentSelector] Selected agent: ${selected.key} ` +
        `(score: ${candidates[0].score.toFixed(2)}, ` +
        `reasons: ${candidates[0].matchReasons.join(', ')})`
      );
    }

    return {
      selected,
      candidates,
      analysis,
    };
  }

  /**
   * Select multiple agents for complex task (e.g., research pipeline)
   */
  selectAgents(task: string, count: number): IAgentSelectionResult[] {
    const results: IAgentSelectionResult[] = [];
    const analysis = this.analyzeTask(task);
    const candidates = this.scoreAgents(analysis);

    // Sort candidates
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aPriority = PRIORITY_ORDER[a.agent.frontmatter.priority ?? 'medium'];
      const bPriority = PRIORITY_ORDER[b.agent.frontmatter.priority ?? 'medium'];
      if (bPriority !== aPriority) return bPriority - aPriority;
      return a.agent.key.localeCompare(b.agent.key);
    });

    // Take top N unique agents
    const selectedKeys = new Set<string>();
    for (const candidate of candidates) {
      if (selectedKeys.size >= count) break;
      if (!selectedKeys.has(candidate.agent.key)) {
        selectedKeys.add(candidate.agent.key);
        results.push({
          selected: candidate.agent,
          candidates: [candidate],
          analysis,
        });
      }
    }

    if (results.length === 0) {
      throw new AgentSelectionError(
        task,
        this.registry.getAll().map(a => a.key),
        {
          taskType: analysis.taskType,
          requiredCapabilities: analysis.requiredCapabilities,
        }
      );
    }

    return results;
  }

  /**
   * Score all agents against task analysis
   */
  private scoreAgents(analysis: ITaskAnalysis): IScoredAgent[] {
    const scored: IScoredAgent[] = [];

    for (const agent of this.registry.getAll()) {
      const { score, reasons } = this.calculateRelevance(agent, analysis);

      // Only include agents with non-zero relevance
      if (score > 0) {
        scored.push({
          agent,
          score,
          matchReasons: reasons,
        });
      }
    }

    return scored;
  }

  /**
   * Calculate relevance score for agent given task analysis
   */
  private calculateRelevance(
    agent: ILoadedAgentDefinition,
    analysis: ITaskAnalysis
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 1. Keyword matching (0-0.3)
    const keywordScore = this.calculateKeywordScore(agent, analysis.keywords);
    if (keywordScore > 0) {
      score += keywordScore * 0.3;
      reasons.push(`keyword-match: ${(keywordScore * 100).toFixed(0)}%`);
    }

    // 2. Capability matching (0-0.3)
    const capabilityScore = this.calculateCapabilityScore(agent, analysis.requiredCapabilities);
    if (capabilityScore > 0) {
      score += capabilityScore * 0.3;
      reasons.push(`capability-match: ${(capabilityScore * 100).toFixed(0)}%`);
    }

    // 3. Category preference (0-0.3 based on position - earlier = higher)
    const categoryIndex = analysis.preferredCategories.indexOf(agent.category);
    if (categoryIndex >= 0) {
      // Position 0 = 0.3, Position 1 = 0.25, Position 2 = 0.2, etc.
      const categoryScore = Math.max(0.1, 0.3 - categoryIndex * 0.05);
      score += categoryScore;
      reasons.push(`preferred-category[${categoryIndex}]: ${agent.category}`);
    }

    // 4. Priority bonus (0-0.1)
    const priority = agent.frontmatter.priority ?? 'medium';
    const priorityBonus = (PRIORITY_ORDER[priority] / 4) * 0.1;
    if (priorityBonus > 0) {
      score += priorityBonus;
      reasons.push(`priority: ${priority}`);
    }

    // 5. Trigger phrase matching (0-0.1)
    const triggerScore = this.calculateTriggerScore(agent, analysis.keywords);
    if (triggerScore > 0) {
      score += triggerScore * 0.1;
      reasons.push(`trigger-match: ${(triggerScore * 100).toFixed(0)}%`);
    }

    return { score, reasons };
  }

  /**
   * Calculate keyword match score
   */
  private calculateKeywordScore(
    agent: ILoadedAgentDefinition,
    keywords: string[]
  ): number {
    if (keywords.length === 0) return 0;

    // Handle capabilities that may be string or array
    const capabilities = agent.frontmatter.capabilities;
    const capabilityList: string[] = Array.isArray(capabilities)
      ? capabilities
      : typeof capabilities === 'string'
        ? [capabilities]
        : [];

    const agentText = [
      agent.key,
      agent.frontmatter.name,
      agent.frontmatter.description,
      ...capabilityList,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let matches = 0;
    for (const keyword of keywords) {
      if (agentText.includes(keyword.toLowerCase())) {
        matches++;
      }
    }

    return matches / keywords.length;
  }

  /**
   * Calculate capability match score
   */
  private calculateCapabilityScore(
    agent: ILoadedAgentDefinition,
    requiredCapabilities: string[]
  ): number {
    if (requiredCapabilities.length === 0) return 0;

    // Handle capabilities that may be string or array
    const capabilities = agent.frontmatter.capabilities;
    const agentCapabilities: string[] = Array.isArray(capabilities)
      ? capabilities
      : typeof capabilities === 'string'
        ? [capabilities]
        : [];

    if (agentCapabilities.length === 0) return 0;

    const agentCapLower = agentCapabilities.map(c => c.toLowerCase());

    let matches = 0;
    for (const required of requiredCapabilities) {
      const requiredLower = required.toLowerCase();
      if (agentCapLower.some(c => c.includes(requiredLower) || requiredLower.includes(c))) {
        matches++;
      }
    }

    return matches / requiredCapabilities.length;
  }

  /**
   * Calculate trigger phrase match score
   */
  private calculateTriggerScore(
    agent: ILoadedAgentDefinition,
    keywords: string[]
  ): number {
    // Handle triggers that may be string or array
    const rawTriggers = agent.frontmatter.triggers;
    const triggers: string[] = Array.isArray(rawTriggers)
      ? rawTriggers
      : typeof rawTriggers === 'string'
        ? [rawTriggers]
        : [];
    if (triggers.length === 0 || keywords.length === 0) return 0;

    const triggerText = triggers.join(' ').toLowerCase();

    let matches = 0;
    for (const keyword of keywords) {
      if (triggerText.includes(keyword.toLowerCase())) {
        matches++;
      }
    }

    return matches / keywords.length;
  }

  /**
   * Extract keywords from task string
   */
  private extractKeywords(task: string): string[] {
    // Remove punctuation except hyphens in words
    const cleaned = task.replace(/[^\w\s-]/g, ' ');

    // Split into words
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);

    // Filter out common stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
      'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
      'our', 'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why',
      'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
      'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once',
    ]);

    const keywords = words
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Deduplicate
    return Array.from(new Set(keywords));
  }

  /**
   * Detect task type from task string
   */
  private detectTaskType(task: string): ITaskAnalysis['taskType'] {
    // Check patterns in order of specificity:
    // 1. design (architecture, system design - most specific)
    // 2. research (specific domain keywords)
    // 3. write (content creation keywords)
    // 4. code (implementation keywords - most generic action verbs)
    // 5. ask (questions - has ? check)
    const types: ITaskAnalysis['taskType'][] = ['design', 'research', 'write', 'code', 'ask'];

    for (const type of types) {
      const patterns = TASK_TYPE_PATTERNS[type];
      for (const pattern of patterns) {
        if (pattern.test(task)) {
          return type;
        }
      }
    }

    return 'general';
  }
}
