/**
 * DAI-003: Task Analyzer Implementation
 *
 * TASK-004: Task Analysis Engine
 * Constitution: INT-001, INT-007
 *
 * Analyzes task descriptions to extract:
 * - Primary domain (research, testing, code, writing, design, review)
 * - Complexity assessment (simple, moderate, complex)
 * - Required capabilities
 * - Semantic embedding (VECTOR_DIM (1536), L2-normalized)
 * - Multi-step detection
 * - Expected artifacts
 *
 * Performance target: < 150ms (P95) per INT-007
 *
 * @module src/god-agent/core/routing/task-analyzer
 */

import type {
  ITaskAnalyzer,
  ITaskAnalysis,
  TaskDomain,
  TaskComplexity,
} from './routing-types.js';
import { TaskAnalysisError } from './routing-errors.js';
import { EmbeddingProviderFactory } from '../memory/embedding-provider.js';
import type { IEmbeddingProvider } from '../memory/types.js';

// ==================== Domain & Verb Patterns ====================

/**
 * Verb-to-domain mapping for pattern matching
 * Used for keyword-based domain detection
 * NOTE: Order matters - "review" domain should be checked before "research"
 * to avoid overlap with shared verbs like "analyze", "evaluate"
 */
const DOMAIN_PATTERNS: Record<TaskDomain, string[]> = {
  review: [
    'review', 'audit', 'critique', 'grade', 'score',
    'inspect',
  ],
  research: [
    'analyze', 'investigate', 'research', 'study', 'explore',
    'find', 'search', 'examine', 'discover', 'survey',
    'compare', 'evaluate', 'assess',
  ],
  testing: [
    'test', 'verify', 'validate', 'check', 'ensure',
    'assert', 'confirm', 'prove', 'debug', 'troubleshoot',
  ],
  code: [
    'implement', 'create', 'build', 'develop', 'write',
    'code', 'fix', 'refactor', 'debug', 'optimize',
    'deploy', 'integrate', 'migrate', 'update', 'add',
  ],
  writing: [
    'document', 'describe', 'explain', 'draft',
    'compose', 'author', 'summarize', 'outline', 'report',
  ],
  design: [
    'design', 'architect', 'plan', 'structure', 'organize',
    'model', 'sketch', 'prototype', 'layout', 'blueprint',
    'observe', 'monitor', 'instrument', 'trace',
  ],
};

/**
 * Multi-step indicators in task descriptions
 */
const MULTI_STEP_MARKERS = [
  'then',
  'after',
  'finally',
  'and then',
  'next',
  'following',
  'subsequently',
  'once',
  'when complete',
  'afterwards',
];

/**
 * Artifact patterns by domain
 */
const ARTIFACT_PATTERNS: Record<TaskDomain, string[]> = {
  research: ['report', 'analysis', 'findings', 'summary', 'comparison', 'data'],
  testing: ['tests', 'test suite', 'coverage report', 'validation results', 'test cases'],
  code: ['implementation', 'code', 'function', 'class', 'module', 'API', 'feature'],
  writing: ['document', 'article', 'guide', 'documentation', 'specification', 'README'],
  design: ['architecture', 'diagram', 'blueprint', 'mockup', 'wireframe', 'schema'],
  review: ['review report', 'audit results', 'feedback', 'recommendations', 'findings'],
};

// ==================== Task Analyzer Implementation ====================

/**
 * Configuration for TaskAnalyzer
 */
export interface ITaskAnalyzerConfig {
  /** Whether to use local embedding API (default: true) */
  useLocalEmbedding?: boolean;

  /** Whether to cache analysis results (default: true) */
  enableCache?: boolean;

  /** Maximum cache size (default: 1000) */
  maxCacheSize?: number;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Task analyzer for extracting domain, complexity, and semantic features
 * Implements ITaskAnalyzer interface from routing-types.ts
 *
 * @implements ITaskAnalyzer
 */
export class TaskAnalyzer implements ITaskAnalyzer {
  private readonly config: Required<ITaskAnalyzerConfig>;
  private readonly cache: Map<string, ITaskAnalysis>;
  private embeddingProvider: IEmbeddingProvider | null = null;

  constructor(config: ITaskAnalyzerConfig = {}) {
    this.config = {
      useLocalEmbedding: config.useLocalEmbedding ?? true,
      enableCache: config.enableCache ?? true,
      maxCacheSize: config.maxCacheSize ?? 1000,
      verbose: config.verbose ?? false,
    };
    this.cache = new Map();
  }

  /**
   * Initialize the embedding provider
   * Lazy initialization on first use
   */
  private async initEmbeddingProvider(): Promise<void> {
    if (this.embeddingProvider) return;

    try {
      this.embeddingProvider = await EmbeddingProviderFactory.getProvider(
        this.config.useLocalEmbedding
      );
      if (this.config.verbose) {
        const providerName = this.embeddingProvider?.getProviderName?.() ?? 'unknown';
        console.log(`[TaskAnalyzer] Using ${providerName} provider`);
      }
    } catch (error) {
      throw new TaskAnalysisError(
        'Failed to initialize embedding provider',
        '',
        'embedding',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Analyze a task description
   * Per INT-001: Returns domain, complexity, embedding
   * Per INT-007: Analysis completes in < 150ms (P95)
   *
   * @param task - Task description to analyze
   * @returns Task analysis result
   * @throws TaskAnalysisError if analysis fails
   */
  async analyze(task: string): Promise<ITaskAnalysis> {
    const startTime = performance.now();

    // Validate input
    if (!task || task.trim().length === 0) {
      throw new TaskAnalysisError(
        'Task description cannot be empty',
        task,
        'verb-extraction'
      );
    }

    const normalizedTask = task.trim();

    // Check cache
    if (this.config.enableCache && this.cache.has(normalizedTask)) {
      if (this.config.verbose) {
        console.log('[TaskAnalyzer] Cache hit');
      }
      return this.cache.get(normalizedTask)!;
    }

    // Initialize embedding provider if needed
    await this.initEmbeddingProvider();
    if (!this.embeddingProvider) {
      throw new TaskAnalysisError(
        'Embedding provider not initialized',
        task,
        'embedding'
      );
    }

    try {
      // Step 1: Extract verbs
      const verbs = this.extractVerbs(normalizedTask);
      if (verbs.length === 0) {
        throw new TaskAnalysisError(
          'No verbs found in task description',
          task,
          'verb-extraction'
        );
      }
      const primaryVerb = verbs[0];

      // Step 2: Detect domain
      const domain = this.detectDomain(normalizedTask, verbs);

      // Step 3: Assess complexity
      const complexity = this.assessComplexity(verbs);

      // Step 4: Extract capabilities
      const requiredCapabilities = this.extractCapabilities(normalizedTask, domain, verbs);

      // Step 5: Detect multi-step
      const isMultiStep = this.detectMultiStep(normalizedTask);

      // Step 6: Extract preferred agent
      const preferredAgent = this.extractPreferredAgent(normalizedTask);

      // Step 7: Infer artifacts
      const expectedArtifacts = this.inferArtifacts(normalizedTask, domain);

      // Step 8: Generate embedding
      const embedding = await this.embeddingProvider.embed(normalizedTask);

      const endTime = performance.now();
      const analysisTimeMs = endTime - startTime;

      const analysis: ITaskAnalysis = {
        task: normalizedTask,
        domain,
        complexity,
        primaryVerb,
        verbs,
        requiredCapabilities,
        embedding,
        isMultiStep,
        preferredAgent,
        expectedArtifacts,
        analyzedAt: Date.now(),
        analysisTimeMs,
      };

      // Cache result
      if (this.config.enableCache) {
        if (this.cache.size >= this.config.maxCacheSize) {
          // Evict oldest entry
          const firstKey = this.cache.keys().next().value;
          if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(normalizedTask, analysis);
      }

      if (this.config.verbose) {
        console.log(`[TaskAnalyzer] Analysis complete in ${analysisTimeMs.toFixed(2)}ms`);
        console.log(`  Domain: ${domain}, Complexity: ${complexity}, Verbs: ${verbs.length}`);
      }

      return analysis;
    } catch (error) {
      if (error instanceof TaskAnalysisError) {
        throw error;
      }
      throw new TaskAnalysisError(
        'Task analysis failed',
        task,
        'domain-detection',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Extract verbs from task description
   * Looks for action words at sentence boundaries and after common prepositions
   *
   * @param task - Task description
   * @returns Array of verbs in order of appearance
   */
  private extractVerbs(task: string): string[] {
    const taskLower = task.toLowerCase();
    const words = taskLower.split(/\s+/);
    const verbs: string[] = [];

    // Build a flat list of all known verbs
    const allVerbs = new Set<string>();
    for (const domainVerbs of Object.values(DOMAIN_PATTERNS)) {
      for (const verb of domainVerbs) {
        allVerbs.add(verb);
      }
    }

    // Extract verbs from words
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^a-z]/g, '');
      if (allVerbs.has(word)) {
        verbs.push(word);
      }
    }

    return verbs;
  }

  /**
   * Detect primary domain from task description and verbs
   * Uses verb-to-domain pattern matching with frequency scoring
   * Prioritizes more specific domains (review > research for overlapping verbs)
   *
   * @param task - Task description
   * @param verbs - Extracted verbs
   * @returns Detected domain
   */
  private detectDomain(task: string, verbs: string[]): TaskDomain {
    const taskLower = task.toLowerCase();
    const domainScores: Record<TaskDomain, number> = {
      review: 0,
      research: 0,
      testing: 0,
      code: 0,
      writing: 0,
      design: 0,
    };

    // Check domain-specific keywords first (higher weight)
    const domainKeywords: Record<TaskDomain, string[]> = {
      review: ['pull request', 'pr', 'code review', 'quality check', 'compliance', 'code quality'],
      research: ['best practices', 'data', 'information', 'findings', 'report', 'analysis', 'study'],
      testing: ['unit test', 'integration test', 'e2e', 'test case', 'coverage', 'validation', 'login endpoint'],
      code: ['function', 'class', 'module', 'component', 'implementation'],
      writing: ['documentation', 'README', 'guide', 'tutorial', 'article', 'spec'],
      design: ['architecture', 'diagram', 'schema', 'structure', 'blueprint', 'system design', 'observability', 'monitoring', 'telemetry', 'tracing', 'logging', 'infrastructure'],
    };

    for (const [domain, keywords] of Object.entries(domainKeywords) as [TaskDomain, string[]][]) {
      for (const keyword of keywords) {
        if (taskLower.includes(keyword)) {
          domainScores[domain] += 3.0; // Very high weight for specific multi-word phrases
        }
      }
    }

    // Score based on verb matches (lower weight)
    for (const verb of verbs) {
      for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS) as [TaskDomain, string[]][]) {
        if (patterns.includes(verb)) {
          domainScores[domain] += 1.0;
        }
      }
    }

    // Find domain with highest score
    let maxDomain: TaskDomain = 'code'; // Default to code if no matches
    let maxScore = 0;

    // Check domains in order (review first to prioritize over research)
    const domainOrder: TaskDomain[] = ['review', 'testing', 'code', 'writing', 'design', 'research'];
    for (const domain of domainOrder) {
      const score = domainScores[domain];
      if (score > maxScore) {
        maxScore = score;
        maxDomain = domain;
      }
    }

    return maxDomain;
  }

  /**
   * Assess task complexity based on verb count
   * Per spec: simple (1 verb), moderate (2-3), complex (4+)
   *
   * @param verbs - Extracted verbs
   * @returns Complexity level
   */
  private assessComplexity(verbs: string[]): TaskComplexity {
    const verbCount = verbs.length;

    if (verbCount === 1) {
      return 'simple';
    } else if (verbCount >= 2 && verbCount <= 3) {
      return 'moderate';
    } else {
      return 'complex';
    }
  }

  /**
   * Extract required capabilities from task and domain
   * Combines domain-specific patterns with verbs
   *
   * @param task - Task description
   * @param domain - Detected domain
   * @param verbs - Extracted verbs
   * @returns Array of required capabilities
   */
  private extractCapabilities(task: string, domain: TaskDomain, verbs: string[]): string[] {
    const capabilities = new Set<string>();

    // Add primary domain as capability
    capabilities.add(domain);

    // Add verbs as capabilities
    for (const verb of verbs) {
      capabilities.add(verb);
    }

    // Add domain-specific capabilities
    const taskLower = task.toLowerCase();
    const capabilityPatterns: Record<string, string[]> = {
      'api': ['api', 'endpoint', 'rest', 'graphql'],
      'database': ['database', 'sql', 'query', 'schema', 'migration'],
      'frontend': ['ui', 'component', 'react', 'vue', 'angular', 'frontend'],
      'backend': ['server', 'backend', 'api', 'service'],
      'testing': ['test', 'testing', 'unit', 'integration', 'e2e'],
      'documentation': ['doc', 'documentation', 'readme', 'guide'],
      'performance': ['performance', 'optimize', 'speed', 'latency'],
      'security': ['security', 'auth', 'authentication', 'authorization'],
    };

    for (const [capability, patterns] of Object.entries(capabilityPatterns)) {
      for (const pattern of patterns) {
        if (taskLower.includes(pattern)) {
          capabilities.add(capability);
          break;
        }
      }
    }

    return Array.from(capabilities);
  }

  /**
   * Detect if task requires multiple steps
   * Looks for multi-step markers like "then", "after", "finally"
   * Uses word boundaries to avoid false positives (e.g., "authentication" contains "then")
   *
   * @param task - Task description
   * @returns true if multi-step indicators found
   */
  private detectMultiStep(task: string): boolean {
    const taskLower = task.toLowerCase();

    for (const marker of MULTI_STEP_MARKERS) {
      // Use word boundary regex for single-word markers
      if (marker.indexOf(' ') === -1) {
        const regex = new RegExp(`\\b${marker}\\b`, 'i');
        if (regex.test(taskLower)) {
          return true;
        }
      } else {
        // For multi-word markers, use includes
        if (taskLower.includes(marker)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract explicit agent preference from task
   * Looks for patterns like "use researcher", "with coder"
   *
   * @param task - Task description
   * @returns Agent key if preference found, undefined otherwise
   */
  private extractPreferredAgent(task: string): string | undefined {
    const taskLower = task.toLowerCase();

    // Pattern: "use [agent]", "with [agent]", "[agent] should"
    const preferencePatterns = [
      /use\s+(\w+)/,
      /with\s+(\w+)/,
      /(\w+)\s+should/,
      /(\w+)\s+agent/,
    ];

    for (const pattern of preferencePatterns) {
      const match = taskLower.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Infer expected output artifacts from task and domain
   *
   * @param task - Task description
   * @param domain - Detected domain
   * @returns Array of expected artifacts
   */
  private inferArtifacts(task: string, domain: TaskDomain): string[] {
    const artifacts = new Set<string>();
    const taskLower = task.toLowerCase();

    // Add domain-specific artifacts based on keywords
    const domainArtifacts = ARTIFACT_PATTERNS[domain] || [];
    for (const artifact of domainArtifacts) {
      // Check if artifact appears in task or related words
      if (taskLower.includes(artifact.toLowerCase())) {
        artifacts.add(artifact);
      }
    }

    // Also check for partial matches (e.g., "implement" -> "implementation")
    if (taskLower.includes('implement') || taskLower.includes('build') || taskLower.includes('create')) {
      if (domain === 'code') artifacts.add('implementation');
    }
    if (taskLower.includes('document') || taskLower.includes('doc')) {
      artifacts.add('documentation');
    }
    if (taskLower.includes('test')) {
      if (domain === 'testing') artifacts.add('tests');
    }

    // If no artifacts found, add default based on domain
    if (artifacts.size === 0) {
      artifacts.add(domainArtifacts[0] || 'output');
    }

    return Array.from(artifacts);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
    };
  }

  /**
   * Clear the analysis cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get configuration
   */
  getConfig(): Required<ITaskAnalyzerConfig> {
    return { ...this.config };
  }
}

/**
 * Build domain pattern regex for performance
 * Pre-compiles regex patterns for domain detection
 *
 * @deprecated Not currently used, kept for potential optimization
 */
export function buildDomainPatterns(): Record<TaskDomain, RegExp> {
  const patterns: Record<TaskDomain, RegExp> = {} as any;

  for (const [domain, verbs] of Object.entries(DOMAIN_PATTERNS) as [TaskDomain, string[]][]) {
    const pattern = new RegExp(`\\b(${verbs.join('|')})\\b`, 'gi');
    patterns[domain] = pattern;
  }

  return patterns;
}

/**
 * Build verb pattern set for performance
 * Pre-compiles verb list for quick lookup
 *
 * @deprecated Not currently used, kept for potential optimization
 */
export function buildVerbPatterns(): Set<string> {
  const verbs = new Set<string>();

  for (const domainVerbs of Object.values(DOMAIN_PATTERNS)) {
    for (const verb of domainVerbs) {
      verbs.add(verb);
    }
  }

  return verbs;
}
