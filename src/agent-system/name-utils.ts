import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_NAME_MAX_LENGTH,
  AGENT_NAME_MIN_LENGTH,
  AGENT_NAME_PATTERN,
  RESERVED_NAMES,
} from './constants.js';

/**
 * Sanitize a user-provided agent name to lowercase-hyphenated format.
 * EC-DEF-001: "SEC Filing Analyzer" -> "sec-filing-analyzer"
 *
 * @throws Error if result is empty, too short, or reserved
 */
export function sanitizeAgentName(raw: string): string {
  if (!raw || !raw.trim()) {
    throw new Error('Agent name cannot be empty.');
  }

  let name = raw
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')       // spaces and underscores -> hyphens
    .replace(/[^a-z0-9-]/g, '')    // strip non-alphanumeric-hyphen
    .replace(/^[0-9-]+/, '')       // strip leading digits and hyphens (pattern requires ^[a-z])
    .replace(/-+/g, '-')           // collapse consecutive hyphens
    .replace(/^-+/, '')            // strip leading hyphens
    .replace(/-+$/, '');           // strip trailing hyphens

  if (name.length > AGENT_NAME_MAX_LENGTH) {
    name = name.substring(0, AGENT_NAME_MAX_LENGTH).replace(/-+$/, '');
  }

  if (name.length < AGENT_NAME_MIN_LENGTH) {
    throw new Error(
      `Agent name '${raw}' is too short after sanitization (result: '${name}'). ` +
      `Minimum length: ${AGENT_NAME_MIN_LENGTH} characters.`,
    );
  }

  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Agent name '${raw}' is invalid after sanitization (result: '${name}'). ` +
      `Must match pattern: ${AGENT_NAME_PATTERN}`,
    );
  }

  if (RESERVED_NAMES.has(name)) {
    throw new Error(
      `Agent name '${name}' is reserved. Choose a different name.`,
    );
  }

  return name;
}

/**
 * Check if an agent directory already exists.
 * @precondition name must be sanitized via sanitizeAgentName (no path traversal chars)
 */
export function agentExists(name: string, basePath: string): boolean {
  if (name.includes('/') || name.includes('..') || name.includes('\\')) {
    throw new Error(`Invalid agent name for path lookup: '${name}' contains path separators.`);
  }
  return fs.existsSync(path.join(basePath, name));
}
