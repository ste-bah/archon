/**
 * UCM Configuration
 * Universal Context Management System Configuration Schema and Loader
 *
 * CONSTITUTION: Configuration values per RULE-001 to RULE-075
 */

import type {
  IUniversalContextConfig,
  IChunkingConfig,
  ITokenDefaults,
  ISummarizationConfig,
  IProgressiveConfig,
  BreakPattern
} from './types.js';
import { InvalidConfigError, MissingConfigError } from './errors.js';

// ============================================================================
// Default Break Patterns for Symmetric Chunking
// ============================================================================

export const DEFAULT_BREAK_PATTERNS: BreakPattern[] = [
  { priority: 1,  pattern: /^## /m,           name: 'h2_header' },
  { priority: 2,  pattern: /^### /m,          name: 'h3_header' },
  { priority: 3,  pattern: /\n\n/,            name: 'paragraph' },
  { priority: 4,  pattern: /\n- /,            name: 'list_item' },
  { priority: 5,  pattern: /\n\d+\. /,        name: 'numbered_list' },
  { priority: 6,  pattern: /\n> /,            name: 'blockquote' },
  { priority: 7,  pattern: /\n---\n/,         name: 'horizontal_rule' },
  { priority: 8,  pattern: /\. /,             name: 'sentence' },
  { priority: 9,  pattern: /; /,              name: 'semicolon' },
  { priority: 10, pattern: /, /,              name: 'comma' },
  { priority: 11, pattern: / /,               name: 'word' },
  { priority: 12, pattern: /./,               name: 'character' }
];

export const PROTECTED_PATTERNS: RegExp[] = [
  /Task\([^)]*\)/gs,
  /```[\s\S]*?```/g,
  /\|[^\n]+\|(\n\|[^\n]+\|)+/g,
  /\*\*[^*]+\*\*:/g
];

// ============================================================================
// Default Configuration Values
// ============================================================================

export const DEFAULT_CHUNKING_CONFIG: IChunkingConfig = {
  maxChars: 2000,
  minChars: 200,  // Implements REQ-CHUNK-002: Minimum chunk size to prevent tiny chunks
  overlap: 300,
  maxChunks: 2000,  // Increased from 25 to handle books/large documents
  breakPatterns: DEFAULT_BREAK_PATTERNS,
  protectedPatterns: PROTECTED_PATTERNS
};

export const DEFAULT_TOKEN_DEFAULTS: ITokenDefaults = {
  contextWindow: 100000,
  tokensPerWord: 1.3,
  summarizationThreshold: 0.7,
  warningThreshold: 0.8
};

/**
 * Summarization budget allocation per RULE-043
 */
export const DEFAULT_SUMMARIZATION_CONFIG: ISummarizationConfig = {
  maxTokens: 200,
  citationsBudget: 0.40,      // 40%
  keyFindingsBudget: 0.30,    // 30%
  methodologyBudget: 0.15,    // 15%
  resultsBudget: 0.15,        // 15%
  preserveStructure: true
};

/**
 * Progressive writing config per RULE-008
 */
export const DEFAULT_PROGRESSIVE_CONFIG: IProgressiveConfig = {
  maxOutputTokens: 15000,
  chunkOverlap: 500,
  continuationMarker: '[CONTINUE]'
};

/**
 * Default Universal Context Configuration
 */
export const DEFAULT_UCM_CONFIG: IUniversalContextConfig = {
  daemon: {
    socketPath: '/tmp/godagent-ucm.sock',
    autoStart: true,
    healthCheckInterval: 30000,
    startupTimeout: 3000
  },

  desc: {
    enabled: true,
    threshold: 0.80,
    maxEpisodes: 2,
    injectOnTask: true,
    chunkConfig: DEFAULT_CHUNKING_CONFIG
  },

  recovery: {
    enabled: true,
    autoRecover: true,
    descFallback: true,
    descFallbackThreshold: 0.85
  },

  embedding: {
    mode: 'http-proxy',
    httpEndpoint: 'http://127.0.0.1:8000/embed',
    model: 'gte-Qwen2-1.5B-instruct',
    dimension: 1536,
    batchSize: 64,
    timeout: 30000
  },

  workflow: {
    autoDetect: true,
    default: 'general',
    adapters: ['phd-pipeline', 'code-review', 'general']
  },

  tokenManagement: {
    defaults: DEFAULT_TOKEN_DEFAULTS,
    summarization: DEFAULT_SUMMARIZATION_CONFIG,
    progressiveWriting: DEFAULT_PROGRESSIVE_CONFIG
  }
};

// ============================================================================
// Configuration Loader
// ============================================================================

/**
 * Load UCM configuration with defaults
 */
export function loadConfig(
  overrides?: Partial<IUniversalContextConfig>
): IUniversalContextConfig {
  if (!overrides) {
    return { ...DEFAULT_UCM_CONFIG };
  }

  return deepMerge(
    DEFAULT_UCM_CONFIG as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>
  ) as unknown as IUniversalContextConfig;
}

/**
 * Validate configuration
 */
export function validateConfig(config: IUniversalContextConfig): void {
  // Validate daemon config
  if (!config.daemon.socketPath) {
    throw new MissingConfigError('daemon.socketPath');
  }
  if (config.daemon.startupTimeout < 0) {
    throw new InvalidConfigError(
      'daemon.startupTimeout',
      config.daemon.startupTimeout,
      'positive number'
    );
  }

  // Validate DESC config
  if (config.desc.threshold < 0 || config.desc.threshold > 1) {
    throw new InvalidConfigError(
      'desc.threshold',
      config.desc.threshold,
      'number between 0 and 1'
    );
  }
  if (config.desc.maxEpisodes < 1) {
    throw new InvalidConfigError(
      'desc.maxEpisodes',
      config.desc.maxEpisodes,
      'positive integer'
    );
  }

  // Validate embedding config
  if (config.embedding.mode !== 'http-proxy') {
    throw new InvalidConfigError(
      'embedding.mode',
      config.embedding.mode,
      'http-proxy'
    );
  }
  if (!config.embedding.httpEndpoint) {
    throw new MissingConfigError('embedding.httpEndpoint');
  }
  if (config.embedding.dimension < 1) {
    throw new InvalidConfigError(
      'embedding.dimension',
      config.embedding.dimension,
      'positive integer'
    );
  }

  // Validate token management
  if (config.tokenManagement.defaults.tokensPerWord < 1) {
    throw new InvalidConfigError(
      'tokenManagement.defaults.tokensPerWord',
      config.tokenManagement.defaults.tokensPerWord,
      'number >= 1'
    );
  }

  // Validate summarization budget allocation
  const sumBudget = config.tokenManagement.summarization;
  const totalBudget =
    sumBudget.citationsBudget +
    sumBudget.keyFindingsBudget +
    sumBudget.methodologyBudget +
    sumBudget.resultsBudget;

  if (Math.abs(totalBudget - 1.0) > 0.001) {
    throw new InvalidConfigError(
      'tokenManagement.summarization budget allocation',
      totalBudget,
      'sum to 1.0 (100%)'
    );
  }
}

/**
 * Load and validate configuration
 */
export function loadAndValidateConfig(
  overrides?: Partial<IUniversalContextConfig>
): IUniversalContextConfig {
  const config = loadConfig(overrides);
  validateConfig(config);
  return config;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Get environment-based configuration overrides
 */
export function getEnvOverrides(): Partial<IUniversalContextConfig> {
  const overrides: Partial<IUniversalContextConfig> = {};

  // Daemon socket path
  if (process.env.UCM_SOCKET_PATH) {
    overrides.daemon = {
      ...DEFAULT_UCM_CONFIG.daemon,
      socketPath: process.env.UCM_SOCKET_PATH
    };
  }

  // Embedding endpoint
  if (process.env.UCM_EMBEDDING_ENDPOINT) {
    overrides.embedding = {
      ...DEFAULT_UCM_CONFIG.embedding,
      httpEndpoint: process.env.UCM_EMBEDDING_ENDPOINT
    };
  }

  // DESC threshold
  if (process.env.UCM_DESC_THRESHOLD) {
    const threshold = parseFloat(process.env.UCM_DESC_THRESHOLD);
    if (!isNaN(threshold)) {
      overrides.desc = {
        ...DEFAULT_UCM_CONFIG.desc,
        threshold
      };
    }
  }

  // Disable DESC
  if (process.env.UCM_DESC_DISABLED === 'true') {
    overrides.desc = {
      ...DEFAULT_UCM_CONFIG.desc,
      enabled: false
    };
  }

  // Disable recovery
  if (process.env.UCM_RECOVERY_DISABLED === 'true') {
    overrides.recovery = {
      ...DEFAULT_UCM_CONFIG.recovery,
      enabled: false
    };
  }

  return overrides;
}

/**
 * Load configuration with environment overrides
 */
export function loadConfigWithEnv(
  overrides?: Partial<IUniversalContextConfig>
): IUniversalContextConfig {
  const envOverrides = getEnvOverrides();
  const mergedOverrides = deepMerge(envOverrides, overrides ?? {});
  return loadAndValidateConfig(mergedOverrides);
}
