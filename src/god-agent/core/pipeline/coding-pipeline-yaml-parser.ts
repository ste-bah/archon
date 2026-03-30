/**
 * Coding Pipeline YAML Parser
 *
 * YAML parsing utilities for agent definition file frontmatter.
 * Handles arrays, nested objects, multiline values, and type coercion.
 *
 * @module src/god-agent/core/pipeline/coding-pipeline-yaml-parser
 * @see PRD Section 2.3 - Pipeline Configuration
 */

import { z } from 'zod';

// =============================================================================
// TYPES & SCHEMAS
// =============================================================================

export type YAMLParseResult = Record<string, unknown>;

export interface MultilineContext {
  lines: string[];
  startIndex: number;
}

/** Schema for validating parsed YAML values (TS-004) */
export const YAMLValueSchema = z.union([
  z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.unknown()),
]);

export const YAMLFrontmatterSchema = z.record(YAMLValueSchema);

// =============================================================================
// FRONTMATTER EXTRACTION
// =============================================================================

/**
 * Extract YAML frontmatter from markdown content
 * @returns Tuple of [frontmatterYAML, remainingContent] or null
 */
export function extractFrontmatter(content: string): [string, string] | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return [match[1], content.substring(match[0].length).trim()];
}

// =============================================================================
// VALUE PARSING
// =============================================================================

/**
 * Collect multiline value from YAML pipe syntax (|)
 */
export function collectMultilineValue(ctx: MultilineContext): string {
  const { lines, startIndex } = ctx;
  const valueLines: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^\s{4,}/)) valueLines.push(line.trim());
    else if (line.trim() === '') valueLines.push('');
    else break;
  }
  return valueLines.join('\n');
}

/** Parse single YAML value to appropriate type */
export function parseYAMLValue(value: string): unknown {
  if (!value) return undefined;
  if (value.startsWith('[') && value.endsWith(']')) {
    try { return JSON.parse(value.replace(/'/g, '"')); }
    catch { return []; }
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!isNaN(Number(value)) && value !== '') return Number(value);
  return value.replace(/^["']|["']$/g, '');
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse YAML frontmatter into key-value object
 * Handles: key:value, arrays, nested objects, multiline (|), quoted strings
 */
export function parseYAML(yaml: string): YAMLParseResult {
  const result: YAMLParseResult = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  let currentObject: Record<string, unknown> | null = null;
  let objectKey: string | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Array item continuation
    if (currentArray !== null && line.match(/^\s+-\s+(.+)$/)) {
      const m = line.match(/^\s+-\s+(.+)$/);
      if (m) currentArray.push(m[1].replace(/^["']|["']$/g, ''));
      continue;
    }

    // Nested object with pipe (multiline)
    if (currentObject && objectKey && line.match(/^\s+\w+:\s*\|$/)) {
      const m = line.match(/^\s+(\w+):\s*\|$/);
      if (m) currentObject[m[1]] = collectMultilineValue({ lines, startIndex: idx + 1 });
      continue;
    }

    // Nested object value
    if (currentObject && objectKey && line.match(/^\s+\w+:\s*.+$/)) {
      const m = line.match(/^\s+(\w+):\s*(.+)$/);
      if (m) currentObject[m[1]] = m[2].replace(/^["']|["']$/g, '');
      continue;
    }

    // End array
    if (currentArray !== null && !line.match(/^\s+-/)) {
      result[currentKey!] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    // End nested object
    if (currentObject && objectKey && !line.match(/^\s+\w+:/)) {
      result[objectKey] = currentObject;
      currentObject = null;
      objectKey = null;
    }

    // Key: value pair
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      currentKey = key;

      if (!value) {
        const next = idx + 1;
        if (next < lines.length && lines[next].match(/^\s+-/)) {
          currentArray = [];
          continue;
        }
        if (next < lines.length && lines[next].match(/^\s+\w+:/)) {
          currentObject = {};
          objectKey = key;
          continue;
        }
      }
      result[key] = parseYAMLValue(value);
    }
  }

  // Finalize pending
  if (currentArray && currentKey) result[currentKey] = currentArray;
  if (currentObject && objectKey) result[objectKey] = currentObject;

  return result;
}
