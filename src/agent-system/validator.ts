import * as fs from 'fs';
import * as path from 'path';
import { REQUIRED_FILES, AGENT_FILES, TOKEN_LIMITS, TOTAL_CONTROLLABLE_TOKEN_LIMIT } from './constants.js';
import { checkTokenBudget } from './token-counter.js';

export interface ValidationError {
  file: string;
  code: string;
  message: string;
}

export interface ValidationWarning {
  file: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  tokenBreakdown: Record<string, { estimate: number; limit: number; within: boolean }>;
  totalTokens: number;
}

/**
 * Validate an agent definition directory.
 *
 * Checks:
 * 1. Required files exist (agent.md)
 * 2. JSON files parse correctly (meta.json, memory-keys.json)
 * 3. Per-file token budgets within limits
 * 4. Total controllable tokens within 15,000 limit
 */
export function validateAgentDefinition(agentDir: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const tokenBreakdown: Record<string, { estimate: number; limit: number; within: boolean }> = {};
  let totalTokens = 0;

  // Check directory exists
  if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
    return {
      valid: false,
      errors: [{ file: agentDir, code: 'DIR_NOT_FOUND', message: `Directory does not exist: ${agentDir}` }],
      warnings: [],
      tokenBreakdown: {},
      totalTokens: 0,
    };
  }

  // Check required files
  for (const file of REQUIRED_FILES) {
    const filePath = path.join(agentDir, file);
    if (!fs.existsSync(filePath)) {
      errors.push({
        file,
        code: 'REQUIRED_FILE_MISSING',
        message: `Required file '${file}' not found. EC-DEF-005: Invalid agent definition.`,
      });
    }
  }

  // Validate each known file that exists
  for (const file of AGENT_FILES) {
    const filePath = path.join(agentDir, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');

    // Token budget check for markdown files
    if (file.endsWith('.md')) {
      const limit = TOKEN_LIMITS[file];
      if (limit) {
        const budget = checkTokenBudget(content, limit);
        tokenBreakdown[file] = { estimate: budget.estimate, limit, within: budget.within };
        totalTokens += budget.estimate;
        if (!budget.within) {
          warnings.push({
            file,
            code: 'TOKEN_BUDGET_EXCEEDED',
            message: `${file} exceeds token limit: ${budget.estimate} tokens (limit: ${limit}). EC-DEF-003: Will be truncated.`,
          });
        }
      }
    }

    // JSON validation
    if (file === 'meta.json') {
      try {
        const meta = JSON.parse(content);
        const metaErrors = validateMetaJson(meta);
        errors.push(...metaErrors.map(msg => ({ file, code: 'INVALID_META_JSON', message: msg })));
      } catch {
        errors.push({ file, code: 'JSON_PARSE_ERROR', message: `${file} is not valid JSON.` });
      }
    }

    if (file === 'memory-keys.json') {
      try {
        const memKeys = JSON.parse(content);
        const memErrors = validateMemoryKeysJson(memKeys);
        errors.push(...memErrors.map(msg => ({ file, code: 'INVALID_MEMORY_KEYS', message: msg })));
      } catch {
        errors.push({ file, code: 'JSON_PARSE_ERROR', message: `${file} is not valid JSON.` });
      }
    }
  }

  // Total controllable token check
  if (totalTokens > TOTAL_CONTROLLABLE_TOKEN_LIMIT) {
    warnings.push({
      file: '*',
      code: 'TOTAL_TOKEN_BUDGET_EXCEEDED',
      message: `Total controllable tokens (${totalTokens}) exceed limit (${TOTAL_CONTROLLABLE_TOKEN_LIMIT}). Context will be truncated at runtime.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    tokenBreakdown,
    totalTokens,
  };
}

function validateMetaJson(meta: unknown): string[] {
  const errors: string[] = [];
  if (typeof meta !== 'object' || meta === null) {
    return ['meta.json must be a JSON object.'];
  }
  const m = meta as Record<string, unknown>;

  if (typeof m.created !== 'string') errors.push("meta.json: 'created' must be an ISO 8601 string.");
  if (typeof m.last_used !== 'string') errors.push("meta.json: 'last_used' must be an ISO 8601 string.");
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || (m.version as number) < 1)
    errors.push("meta.json: 'version' must be a positive integer.");
  if (typeof m.author !== 'string' || !['user', 'auto'].includes(m.author as string))
    errors.push("meta.json: 'author' must be 'user' or 'auto'.");
  if (typeof m.invocation_count !== 'number' || !Number.isInteger(m.invocation_count) || (m.invocation_count as number) < 0)
    errors.push("meta.json: 'invocation_count' must be a non-negative integer.");

  return errors;
}

function validateMemoryKeysJson(memKeys: unknown): string[] {
  const errors: string[] = [];
  if (typeof memKeys !== 'object' || memKeys === null) {
    return ['memory-keys.json must be a JSON object.'];
  }
  const mk = memKeys as Record<string, unknown>;

  if (mk.recall_queries !== undefined) {
    if (!Array.isArray(mk.recall_queries)) {
      errors.push("memory-keys.json: 'recall_queries' must be an array of strings.");
    } else if (!mk.recall_queries.every((q: unknown) => typeof q === 'string')) {
      errors.push("memory-keys.json: each entry in 'recall_queries' must be a string.");
    }
  }

  if (mk.leann_queries !== undefined) {
    if (!Array.isArray(mk.leann_queries)) {
      errors.push("memory-keys.json: 'leann_queries' must be an array of strings.");
    } else if (!mk.leann_queries.every((q: unknown) => typeof q === 'string')) {
      errors.push("memory-keys.json: each entry in 'leann_queries' must be a string.");
    }
  }

  if (mk.tags !== undefined) {
    if (!Array.isArray(mk.tags)) {
      errors.push("memory-keys.json: 'tags' must be an array of strings.");
    } else if (!mk.tags.every((t: unknown) => typeof t === 'string')) {
      errors.push("memory-keys.json: each entry in 'tags' must be a string.");
    }
  }

  return errors;
}
