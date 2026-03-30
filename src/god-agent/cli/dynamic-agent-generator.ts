/**
 * DynamicAgentGenerator - Generates Phase 6 agents dynamically from chapter structure
 * Implements REQ-PIPE-040, REQ-PIPE-041, REQ-PIPE-043, REQ-PIPE-044, REQ-PIPE-045
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { ChapterStructureLoader, ChapterDefinition, ChapterStructure } from './chapter-structure-loader.js';
import { StyleAnalyzer, StyleCharacteristics } from '../universal/style-analyzer.js';
import type { AgentDetails } from './cli-types.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../core/observability/index.js';

const logger = createComponentLogger('DynamicAgentGenerator', {
  minLevel: LogLevel.WARN,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

// Default style prompt when no profile is available
const DEFAULT_STYLE_PROMPT = `Regional Language Settings:
- Use American English spelling conventions
- Examples: color, organization, analyze, center, behavior
- Use APA citation style
- Formality: Academic, formal tone`;

// Pipeline constants
const PHASE_5_END_INDEX = 30;  // methodology-writer is last Phase 5 agent
const QA_AGENTS_COUNT = 9;     // Phase 7 has 9 QA agents

/**
 * Extended agent details with chapter context
 */
export interface DynamicAgentDetails extends AgentDetails {
  chapterContext?: ChapterDefinition;
}

/**
 * DynamicAgentGenerator class
 */
export class DynamicAgentGenerator {
  private readonly loader: ChapterStructureLoader;
  private readonly analyzer: StyleAnalyzer;
  private readonly agentsDir: string;

  constructor(basePath: string = process.cwd()) {
    this.loader = new ChapterStructureLoader(basePath);
    this.analyzer = new StyleAnalyzer();
    this.agentsDir = path.join(basePath, '.claude/agents/phdresearch');
  }

  /**
   * Generate all Phase 6 agents dynamically from chapter structure
   * [REQ-PIPE-040, REQ-PIPE-041, REQ-PIPE-043, REQ-PIPE-045]
   *
   * @param structure - Locked chapter structure from dissertation-architect
   * @param styleCharacteristics - Style characteristics for prompt injection (optional)
   * @param slug - Research session slug
   * @returns Array of dynamically generated Phase 6 agents
   */
  async generatePhase6Agents(
    structure: ChapterStructure,
    styleCharacteristics: StyleCharacteristics | null,
    slug: string
  ): Promise<DynamicAgentDetails[]> {
    const agents: DynamicAgentDetails[] = [];
    const baseIndex = PHASE_5_END_INDEX + 1; // 31

    // Generate one agent per chapter
    // [REQ-PIPE-045] Handles 3-12+ chapters (no arbitrary limits)
    for (let i = 0; i < structure.chapters.length; i++) {
      const chapter = structure.chapters[i];
      const agentIndex = baseIndex + i;

      // [REQ-PIPE-044] Check if writer agent exists
      const exists = await this.loader.writerAgentExists(chapter.writerAgent);
      if (!exists) {
        logger.warn('Unknown writer agent; using generic writer template', { writerAgent: chapter.writerAgent });
      }

      const prompt = await this.buildWriterPrompt(chapter, styleCharacteristics, slug, exists);

      agents.push({
        index: agentIndex,
        key: `chapter-${chapter.number}-${chapter.writerAgent}`,
        name: `${chapter.title} Writer`,
        phase: 6,
        phaseName: 'Writing',
        prompt,
        chapterContext: chapter,
        dependencies: i === 0 ? ['phase-5-complete'] : [`chapter-${chapter.number - 1}`],
        timeout: 1800,
        critical: true,
        expectedOutputs: [chapter.outputFile]
      });
    }

    // Add abstract-writer as final Phase 6 agent
    const abstractIndex = baseIndex + structure.chapters.length;
    const abstractPrompt = await this.buildAbstractPrompt(styleCharacteristics, slug);

    agents.push({
      index: abstractIndex,
      key: 'abstract-writer',
      name: 'Abstract Writer',
      phase: 6,
      phaseName: 'Writing',
      prompt: abstractPrompt,
      dependencies: [`chapter-${structure.chapters.length}`],
      timeout: 600,
      critical: true,
      expectedOutputs: ['chapters/ch00-abstract.md']
    });

    return agents;
  }

  /**
   * Build writer prompt with chapter context and style injection
   * [REQ-PIPE-010, REQ-PIPE-043]
   */
  private async buildWriterPrompt(
    chapter: ChapterDefinition,
    styleCharacteristics: StyleCharacteristics | null,
    slug: string,
    agentExists: boolean
  ): Promise<string> {
    // Load base agent description
    let basePrompt = '';
    if (agentExists) {
      const agentPath = path.join(this.agentsDir, `${chapter.writerAgent}.md`);
      const content = await fs.readFile(agentPath, 'utf-8');
      // Extract content after frontmatter
      const match = content.match(/^---[\s\S]*?---\s*([\s\S]*)/);
      basePrompt = match ? match[1].trim() : content;
    } else {
      basePrompt = 'You are a specialized academic writer. Write content that is scholarly, well-referenced, and follows academic conventions.';
    }

    // [REQ-PIPE-043] Add chapter context
    const chapterContext = `
## CHAPTER SPECIFICATION (from locked structure)
- **Chapter Number**: ${chapter.number}
- **Title**: ${chapter.title}
- **Target Words**: ${chapter.targetWords.toLocaleString()}
- **Sections**: ${chapter.sections.length > 0 ? chapter.sections.join(', ') : 'Not specified'}
- **Output File**: docs/research/${slug}/${chapter.outputFile}

You MUST follow the chapter structure exactly as specified above.`;

    // Build complete prompt
    let prompt = `${basePrompt}\n\n${chapterContext}`;

    // Add style injection for Phase 6
    // [REQ-PIPE-016] Uses StyleAnalyzer.generateStylePrompt() - same as PhDPipelineBridge
    if (styleCharacteristics) {
      const stylePrompt = this.analyzer.generateStylePrompt(styleCharacteristics);
      prompt += `\n\n## STYLE GUIDELINES\n${stylePrompt}`;
    } else {
      prompt += `\n\n## STYLE GUIDELINES\n${DEFAULT_STYLE_PROMPT}`;
    }

    return prompt;
  }

  /**
   * Build abstract writer prompt
   */
  private async buildAbstractPrompt(
    styleCharacteristics: StyleCharacteristics | null,
    slug: string
  ): Promise<string> {
    const agentPath = path.join(this.agentsDir, 'abstract-writer.md');
    let basePrompt = '';

    try {
      const content = await fs.readFile(agentPath, 'utf-8');
      const match = content.match(/^---[\s\S]*?---\s*([\s\S]*)/);
      basePrompt = match ? match[1].trim() : content;
    } catch {
      // INTENTIONAL: Agent file may not exist - use default prompt as fallback
      basePrompt = 'You are an abstract writer for academic publications. Write a concise, comprehensive abstract that summarizes the research.';
    }

    let prompt = `${basePrompt}\n\n## OUTPUT\n- Output File: docs/research/${slug}/chapters/ch00-abstract.md`;

    // [REQ-PIPE-016] Uses StyleAnalyzer.generateStylePrompt() - same as PhDPipelineBridge
    if (styleCharacteristics) {
      const stylePrompt = this.analyzer.generateStylePrompt(styleCharacteristics);
      prompt += `\n\n## STYLE GUIDELINES\n${stylePrompt}`;
    } else {
      prompt += `\n\n## STYLE GUIDELINES\n${DEFAULT_STYLE_PROMPT}`;
    }

    return prompt;
  }

  /**
   * Check if current agent index is entering Phase 6
   * [REQ-PIPE-042]
   */
  isEnteringPhase6(currentIndex: number, previousIndex: number): boolean {
    return previousIndex <= PHASE_5_END_INDEX && currentIndex > PHASE_5_END_INDEX;
  }

  /**
   * Check if current agent index is in Phase 6
   */
  isInPhase6(currentIndex: number, totalChapters: number): boolean {
    const phase6End = PHASE_5_END_INDEX + totalChapters + 1; // +1 for abstract
    return currentIndex > PHASE_5_END_INDEX && currentIndex <= phase6End;
  }

  /**
   * Check if current agent index is in Phase 7 (QA)
   */
  isInPhase7(currentIndex: number, totalChapters: number): boolean {
    const phase6End = PHASE_5_END_INDEX + totalChapters + 1;
    return currentIndex > phase6End;
  }

  /**
   * Get Phase 6 agent index range
   */
  getPhase6Range(totalChapters: number): { start: number; end: number } {
    return {
      start: PHASE_5_END_INDEX + 1,
      end: PHASE_5_END_INDEX + totalChapters + 1 // +1 for abstract
    };
  }

  /**
   * Calculate total pipeline agent count
   * Formula: 31 (Phases 1-5) + N (chapters) + 1 (abstract) + 9 (Phase 7)
   * [REQ-PIPE-041]
   */
  getTotalAgentCount(totalChapters: number): number {
    return PHASE_5_END_INDEX + 1 + totalChapters + 1 + QA_AGENTS_COUNT;
  }

  /**
   * Get Phase 5 end index constant
   */
  getPhase5EndIndex(): number {
    return PHASE_5_END_INDEX;
  }

  /**
   * Get QA agents count constant
   */
  getQAAgentsCount(): number {
    return QA_AGENTS_COUNT;
  }
}
