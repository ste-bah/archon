/**
 * Agent Category Scanner
 * TASK-AGT-002 - Discover agent category directories
 *
 * Scans .claude/agents/ for all category subdirectories
 * and counts agent files in each.
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import type { ICategoryInfo } from './agent-types.js';

// ==================== Category Scanner ====================

/**
 * AgentCategoryScanner
 *
 * Discovers all agent category directories under a base path.
 * Categories are subdirectories containing .md agent files.
 */
export class AgentCategoryScanner {
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose ?? true;
  }

  /**
   * Scan for all category directories
   *
   * @param basePath - Base path to scan (e.g., '.claude/agents')
   * @returns Array of category info, sorted by agent count (descending)
   */
  async scanCategories(basePath: string): Promise<ICategoryInfo[]> {
    const entries = await readdir(basePath, { withFileTypes: true });
    const directories = entries.filter(e => e.isDirectory());

    const categories: ICategoryInfo[] = [];

    for (const dir of directories) {
      // Skip hidden directories
      if (dir.name.startsWith('.')) continue;

      const categoryPath = join(basePath, dir.name);
      const agentCount = await this.countAgentFiles(categoryPath);

      // Only include directories with at least one .md file
      if (agentCount > 0) {
        categories.push({
          name: dir.name,
          path: categoryPath,
          agentCount,
        });
      }
    }

    // Sort by agent count descending
    categories.sort((a, b) => b.agentCount - a.agentCount);

    if (this.verbose) {
      console.log(
        `[CategoryScanner] Found ${categories.length} categories with ${
          categories.reduce((sum, c) => sum + c.agentCount, 0)
        } total agents`
      );
    }

    return categories;
  }

  /**
   * Count .md files in a directory
   */
  private async countAgentFiles(directoryPath: string): Promise<number> {
    try {
      const files = await readdir(directoryPath);
      return files.filter(f => f.endsWith('.md')).length;
    } catch {
      // INTENTIONAL: Directory read failure - return 0 agents for this category
      return 0;
    }
  }

  /**
   * Get category names only
   */
  async getCategoryNames(basePath: string): Promise<string[]> {
    const categories = await this.scanCategories(basePath);
    return categories.map(c => c.name);
  }

  /**
   * Check if a category exists
   */
  async hasCategory(basePath: string, categoryName: string): Promise<boolean> {
    const categories = await this.scanCategories(basePath);
    return categories.some(c => c.name === categoryName);
  }
}
