/**
 * Agent Definition Loader
 * TASK-AGT-001 - Parse YAML frontmatter and markdown from agent files
 *
 * Loads agent definitions from .claude/agents/ markdown files.
 * Extracts YAML frontmatter and full prompt content.
 */

import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import yaml from 'js-yaml';
import type {
  IAgentFrontmatter,
  IAgentHooks,
  ILoadedAgentDefinition,
  IAgentLoaderOptions,
} from './agent-types.js';
import {
  DEFAULT_LOADER_OPTIONS,
  createDefaultFrontmatter,
} from './agent-types.js';

// ==================== YAML Parser ====================

/**
 * Extract essential fields using regex when full YAML parsing fails
 * This handles files with TypeScript-style syntax in later sections
 */
function extractEssentialFields(yamlContent: string): IAgentFrontmatter {
  const result: Record<string, unknown> = {};

  // Extract name
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) result.name = nameMatch[1].trim();

  // Extract description (handles multi-line)
  const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
  if (descMatch) result.description = descMatch[1].trim();

  // Extract capabilities array
  const capMatch = yamlContent.match(/^capabilities:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (capMatch) {
    const caps = capMatch[1].match(/^\s+-\s*(.+)$/gm);
    if (caps) {
      result.capabilities = caps.map(c => c.replace(/^\s+-\s*/, '').trim());
    }
  }

  // Extract other simple fields
  const colorMatch = yamlContent.match(/^color:\s*(.+)$/m);
  if (colorMatch) result.color = colorMatch[1].trim().replace(/^["']|["']$/g, '');

  const typeMatch = yamlContent.match(/^type:\s*(.+)$/m);
  if (typeMatch) result.type = typeMatch[1].trim();

  const categoryMatch = yamlContent.match(/^category:\s*(.+)$/m);
  if (categoryMatch) result.category = categoryMatch[1].trim();

  const priorityMatch = yamlContent.match(/^priority:\s*(.+)$/m);
  if (priorityMatch) result.priority = priorityMatch[1].trim();

  return result as unknown as IAgentFrontmatter;
}

/**
 * Parse YAML frontmatter using js-yaml library
 * Falls back to regex extraction for files with TypeScript-style syntax
 */
function parseYaml(yamlContent: string): IAgentFrontmatter {
  try {
    const parsed = yaml.load(yamlContent) as Record<string, unknown>;
    return parsed as unknown as IAgentFrontmatter;
  } catch (error) {
    // Fallback: extract essential fields with regex
    console.warn('[AgentLoader] YAML parse error, using fallback extraction');
    return extractEssentialFields(yamlContent);
  }
}

// ==================== Frontmatter Parser ====================

/**
 * Parse result from frontmatter extraction
 */
interface IFrontmatterResult {
  frontmatter: IAgentFrontmatter | null;
  body: string;
}

/**
 * Extract YAML frontmatter from markdown content
 *
 * Frontmatter is delimited by --- at start and end:
 * ```
 * ---
 * name: agent-name
 * description: Agent description
 * ---
 *
 * # Agent Content
 * ...
 * ```
 */
function parseFrontmatter(content: string): IFrontmatterResult {
  // Match frontmatter between --- delimiters
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  try {
    const frontmatter = parseYaml(yamlContent);
    return { frontmatter, body };
  } catch (error) {
    console.warn('[AgentLoader] Failed to parse YAML frontmatter:', error);
    return { frontmatter: null, body: content };
  }
}

// ==================== Agent Definition Loader ====================

/**
 * AgentDefinitionLoader
 *
 * Loads agent definitions from markdown files with YAML frontmatter.
 * Extracts:
 * - name, type, description, capabilities from frontmatter
 * - hooks.pre and hooks.post for execution
 * - Full markdown body as prompt content
 */
export class AgentDefinitionLoader {
  private options: Required<IAgentLoaderOptions>;

  constructor(options: IAgentLoaderOptions) {
    this.options = {
      ...DEFAULT_LOADER_OPTIONS,
      ...options,
    };
  }

  /**
   * Load all agent definitions from a category directory
   *
   * @param categoryPath - Absolute path to category directory
   * @param category - Category name (directory name)
   * @returns Array of loaded agent definitions
   */
  async loadAll(categoryPath: string, category: string): Promise<ILoadedAgentDefinition[]> {
    const files = await readdir(categoryPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    const definitions: ILoadedAgentDefinition[] = [];

    for (const file of mdFiles) {
      const filePath = join(categoryPath, file);
      const def = await this.loadOne(filePath, category);
      if (def) {
        definitions.push(def);
      }
    }

    if (this.options.verbose) {
      console.log(`[AgentLoader] Loaded ${definitions.length} agents from ${category}`);
    }

    return definitions;
  }

  /**
   * Load a single agent definition from a markdown file
   *
   * @param filePath - Absolute path to .md file
   * @param category - Category name
   * @returns Loaded definition or null if parsing failed
   */
  async loadOne(filePath: string, category: string): Promise<ILoadedAgentDefinition | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      // Handle missing frontmatter
      if (!frontmatter) {
        if (this.options.requireFrontmatter) {
          if (this.options.verbose) {
            console.warn(`[AgentLoader] No frontmatter in ${filePath}, skipping`);
          }
          return null;
        }
      }

      const key = basename(filePath, '.md');

      // Validate hooks if enabled
      if (this.options.validateHooks && frontmatter?.hooks) {
        this.validateHooks(frontmatter.hooks, key);
      }

      return {
        key,
        category,
        frontmatter: frontmatter || createDefaultFrontmatter(key),
        promptContent: body.trim(),
        filePath,
        loadedAt: Date.now(),
      };
    } catch (error) {
      if (this.options.verbose) {
        console.error(`[AgentLoader] Error loading ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Validate hook syntax for common issues
   */
  private validateHooks(hooks: IAgentHooks, agentKey: string): void {
    if (hooks.pre) {
      // Check for common memory commands
      if (!hooks.pre.includes('memorygraph') && !hooks.pre.includes('echo')) {
        if (this.options.verbose) {
          console.warn(
            `[AgentLoader] ${agentKey}: pre-hook may be missing memory commands`
          );
        }
      }
    }

    if (hooks.post) {
      // Check for memory store commands
      if (!hooks.post.includes('memory') && !hooks.post.includes('store')) {
        if (this.options.verbose) {
          console.warn(
            `[AgentLoader] ${agentKey}: post-hook may be missing memory store command`
          );
        }
      }
    }
  }

  /**
   * Get loader options
   */
  getOptions(): Required<IAgentLoaderOptions> {
    return { ...this.options };
  }
}

// ==================== Exports ====================

export { parseFrontmatter, parseYaml };
