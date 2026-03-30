/**
 * ChapterStructureLoader - Loads locked chapter structure for dynamic Phase 6
 * Implements REQ-PIPE-041, REQ-PIPE-042, REQ-PIPE-043
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Chapter definition from locked structure
 */
export interface ChapterDefinition {
  number: number;
  title: string;
  writerAgent: string;
  targetWords: number;
  sections: string[];
  outputFile: string;
}

/**
 * Complete chapter structure from dissertation-architect
 */
export interface ChapterStructure {
  locked: boolean;
  generatedAt: string;
  totalChapters: number;
  estimatedTotalWords: number;
  chapters: ChapterDefinition[];
  writerMapping: Record<string, string>;
}

/**
 * Error when chapter structure file is not found
 */
export class ChapterStructureNotFoundError extends Error {
  public readonly path: string;

  constructor(structurePath: string) {
    super(`Chapter structure not found at ${structurePath}; dissertation-architect (Agent #6) must complete first`);
    this.name = 'ChapterStructureNotFoundError';
    this.path = structurePath;
  }
}

/**
 * Error when chapter structure is not locked
 */
export class ChapterStructureNotLockedError extends Error {
  constructor() {
    super('Chapter structure not locked; dissertation-architect must finalize the structure before Phase 6 can begin');
    this.name = 'ChapterStructureNotLockedError';
  }
}

/**
 * ChapterStructureLoader class
 * [REQ-PIPE-041, REQ-PIPE-042]
 */
export class ChapterStructureLoader {
  private readonly agentsDir: string;

  constructor(basePath: string = process.cwd()) {
    this.agentsDir = path.join(basePath, '.claude/agents/phdresearch');
  }

  /**
   * Possible file patterns for chapter structure (in priority order)
   * - Primary: 05-dissertation-architect.md (current pipeline naming: {index}-{agent-key}.md)
   * - Legacy: 05-chapter-structure.md (backward compatibility)
   */
  private static readonly STRUCTURE_FILE_PATTERNS = [
    '05-dissertation-architect.md',  // Current pipeline naming convention
    '05-chapter-structure.md',       // Legacy/manual naming convention
  ];

  /**
   * Load and parse the locked chapter structure for a research session
   * [REQ-PIPE-041, REQ-PIPE-042]
   *
   * @param slug - Research session slug (folder name)
   * @returns Parsed and validated chapter structure
   */
  async loadChapterStructure(slug: string): Promise<ChapterStructure> {
    const researchDir = path.join(process.cwd(), 'docs/research', slug);

    // Try each pattern in priority order
    let structurePath: string | null = null;
    for (const pattern of ChapterStructureLoader.STRUCTURE_FILE_PATTERNS) {
      const candidatePath = path.join(researchDir, pattern);
      try {
        await fs.access(candidatePath);
        structurePath = candidatePath;
        break;
      } catch {
        // Try next pattern
        continue;
      }
    }

    if (!structurePath) {
      const triedPaths = ChapterStructureLoader.STRUCTURE_FILE_PATTERNS.map(p => path.join(researchDir, p)).join(', ');
      throw new ChapterStructureNotFoundError(triedPaths);
    }

    // Read and parse
    const content = await fs.readFile(structurePath, 'utf-8');
    const structure = this.parseStructure(content);

    // Validate locked
    if (!structure.locked) {
      throw new ChapterStructureNotLockedError();
    }

    // Validate has chapters
    if (!structure.chapters || structure.chapters.length === 0) {
      throw new Error('No chapters defined in structure; dissertation-architect must define at least one chapter');
    }

    // Validate each chapter
    for (let i = 0; i < structure.chapters.length; i++) {
      this.validateChapter(structure.chapters[i], i);
    }

    return structure;
  }

  /**
   * Parse chapter structure from markdown file
   * Supports both JSON code blocks (preferred) and markdown-only format (fallback)
   */
  private parseStructure(content: string): ChapterStructure {
    // First, try JSON code block (preferred format)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return this.normalizeStructure(parsed);
      } catch {
        // JSON parse failed, fall through to markdown parsing
      }
    }

    // Try to find raw JSON object with "locked" field
    const objectMatch = content.match(/\{[\s\S]*"locked"[\s\S]*"chapters"[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return this.normalizeStructure(parsed);
      } catch {
        // JSON parse failed, fall through to markdown parsing
      }
    }

    // Fallback: Parse from markdown format
    return this.parseFromMarkdown(content);
  }

  /**
   * Normalize field names across different JSON schema versions
   * Handles: assignedAgent -> writerAgent, wordTarget -> targetWords, etc.
   */
  private normalizeStructure(raw: Record<string, unknown>): ChapterStructure {
    const chapters = (raw.chapters as Record<string, unknown>[]) || [];

    const normalizedChapters: ChapterDefinition[] = chapters.map((ch, idx) => ({
      number: (ch.number as number) || idx + 1,
      title: (ch.title as string) || `Chapter ${idx + 1}`,
      // Handle both field names: writerAgent (new) and assignedAgent (legacy)
      writerAgent: (ch.writerAgent as string) || (ch.assignedAgent as string) || 'chapter-synthesizer',
      // Handle both field names: targetWords (new) and wordTarget (legacy)
      targetWords: (ch.targetWords as number) || (ch.wordTarget as number) || 5000,
      sections: (ch.sections as string[]) || [],
      outputFile: (ch.outputFile as string) || `chapter-${String((ch.number as number) || idx + 1).padStart(2, '0')}.md`,
    }));

    // Build writer mapping
    const writerMapping: Record<string, string> = {};
    for (const chapter of normalizedChapters) {
      writerMapping[chapter.outputFile] = chapter.writerAgent;
    }

    return {
      locked: raw.locked as boolean,
      generatedAt: (raw.generatedAt as string) || (raw.dateLocked as string) || new Date().toISOString().split('T')[0],
      totalChapters: (raw.totalChapters as number) || normalizedChapters.length,
      estimatedTotalWords: normalizedChapters.reduce((sum, c) => sum + c.targetWords, 0),
      chapters: normalizedChapters,
      writerMapping: (raw.writerMapping as Record<string, string>) || writerMapping,
    };
  }

  /**
   * Parse chapter structure from markdown headings when no JSON is available
   * This is a fallback for legacy or manually-created structure files
   */
  private parseFromMarkdown(content: string): ChapterStructure {
    // Check for LOCKED status
    const lockedMatch = content.match(/\*\*Status\*\*:\s*(LOCKED|✅)/i);
    const locked = !!lockedMatch;

    // Extract total chapters
    const totalMatch = content.match(/\*\*Total Chapters\*\*:\s*(\d+)/i);
    const totalChapters = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    // Extract date locked
    const dateMatch = content.match(/\*\*Date Locked\*\*:\s*([\d-]+)/);
    const dateLocked = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

    // Parse chapters from ### Chapter N: Title format
    const chapterRegex = /###\s*Chapter\s*(\d+):\s*([^\n]+)\n([\s\S]*?)(?=###\s*Chapter|\n##\s|$)/gi;
    const chapters: ChapterDefinition[] = [];
    let match;

    while ((match = chapterRegex.exec(content)) !== null) {
      const number = parseInt(match[1], 10);
      const title = match[2].trim();
      const chapterContent = match[3];

      // Extract purpose
      const purposeMatch = chapterContent.match(/\*\*Purpose\*\*:\s*([^\n]+)/);
      const purpose = purposeMatch ? purposeMatch[1].trim() : '';

      // Extract sections from Content Outline
      const sections: string[] = [];
      const sectionRegex = /-\s*Section\s*([\d.]+):\s*([^\n]+)/g;
      let sectionMatch;
      while ((sectionMatch = sectionRegex.exec(chapterContent)) !== null) {
        sections.push(`${sectionMatch[1]} ${sectionMatch[2].trim()}`);
      }

      // Extract word target
      const wordMatch = chapterContent.match(/\*\*Word Count Target\*\*:\s*([\d,]+)/i);
      const targetWords = wordMatch ? parseInt(wordMatch[1].replace(/,/g, ''), 10) : 5000;

      // Infer writer agent from chapter type
      const writerAgent = this.inferWriterAgent(number, title);

      chapters.push({
        number,
        title,
        writerAgent,
        targetWords,
        sections,
        outputFile: `chapter-${String(number).padStart(2, '0')}.md`,
      });
    }

    // Build writer mapping
    const writerMapping: Record<string, string> = {};
    for (const chapter of chapters) {
      writerMapping[chapter.outputFile] = chapter.writerAgent;
    }

    return {
      locked,
      generatedAt: dateLocked,
      totalChapters: totalChapters || chapters.length,
      estimatedTotalWords: chapters.reduce((sum, c) => sum + c.targetWords, 0),
      chapters,
      writerMapping,
    };
  }

  /**
   * Infer writer agent from chapter number and title
   */
  private inferWriterAgent(number: number, title: string): string {
    const titleLower = title.toLowerCase();

    if (number === 1 || titleLower.includes('introduction')) {
      return 'introduction-writer';
    }
    if (titleLower.includes('literature') || titleLower.includes('review')) {
      return 'literature-review-writer';
    }
    if (titleLower.includes('theoretical') || titleLower.includes('framework')) {
      return 'theoretical-framework-analyst';
    }
    if (titleLower.includes('methodology') || titleLower.includes('method')) {
      return 'methodology-writer';
    }
    if (titleLower.includes('result') || titleLower.includes('finding')) {
      return 'results-writer';
    }
    if (titleLower.includes('discussion')) {
      return 'discussion-writer';
    }
    if (titleLower.includes('conclusion')) {
      return 'conclusion-writer';
    }
    if (titleLower.includes('pattern') || titleLower.includes('implementation')) {
      return 'pattern-analyst';
    }
    if (titleLower.includes('analysis') || titleLower.includes('case')) {
      return 'evidence-synthesizer';
    }

    // Default: use chapter-synthesizer for unrecognized chapters
    return 'chapter-synthesizer';
  }

  /**
   * Validate a chapter definition has required fields
   * [REQ-PIPE-043]
   */
  private validateChapter(chapter: ChapterDefinition, index: number): void {
    const required: (keyof ChapterDefinition)[] = ['number', 'title', 'writerAgent', 'outputFile'];

    for (const field of required) {
      if (!(field in chapter) || !chapter[field]) {
        throw new Error(`Invalid chapter definition at index ${index}: missing required field '${field}'`);
      }
    }

    // Set defaults
    if (!chapter.targetWords) {
      chapter.targetWords = 5000;
    }
    if (!chapter.sections) {
      chapter.sections = [];
    }
  }

  /**
   * Check if a writer agent exists in the agents directory
   * [REQ-PIPE-044]
   */
  async writerAgentExists(agentKey: string): Promise<boolean> {
    const agentPath = path.join(this.agentsDir, `${agentKey}.md`);
    try {
      await fs.access(agentPath);
      return true;
    } catch {
      // INTENTIONAL: File access failure means agent doesn't exist - false is correct response
      return false;
    }
  }

  /**
   * Get the path to an agent definition file
   */
  getAgentPath(agentKey: string): string {
    return path.join(this.agentsDir, `${agentKey}.md`);
  }
}
