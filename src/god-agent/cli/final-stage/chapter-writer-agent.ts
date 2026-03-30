/**
 * ChapterWriterAgent - Synthesizes chapter content from mapped source summaries
 *
 * Implements SPEC-FUNC-001 Section 2.5 and GAP-C003 (Chapter Writer Synthesis Logic)
 *
 * Core Responsibilities:
 * - Build section structure from ChapterDefinition
 * - Synthesize content from mapped sources (not summarize)
 * - Preserve citations from sources
 * - Generate cross-references to other chapters
 * - Apply word count targets (70%-130% acceptable per QA-001)
 * - Detect and handle duplicate content (GAP-H001)
 *
 * Constitution Rules:
 * - DI-005: Word counts within 30% of target - enforce 70%-130% range
 * - DI-006: Source attribution - every paragraph must come from sources
 * - EX-003: Source isolation - only access mapped sources for this chapter
 * - QA-001: Deduplicate >50% similar content
 */

import type {
  ChapterDefinition,
  AgentOutputSummary,
  ChapterWriterInput,
  ChapterWriterOutput,
  CrossReference,
  CitationRef,
  QualityMetrics,
  SectionInfo,
  ChapterNumber,
  PhaseStatus
} from './types.js';
import type { StyleCharacteristics } from '../../universal/style-analyzer.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getStyleProfileManager } from '../../universal/style-profile.js';
import { StyleAnalyzer } from '../../universal/style-analyzer.js';
import { createComponentLogger, ConsoleLogHandler, LogLevel } from '../../core/observability/index.js';

const logger = createComponentLogger('ChapterWriterAgent', {
  minLevel: LogLevel.INFO,
  handlers: [new ConsoleLogHandler({ useStderr: true })]
});

/**
 * Supported phdresearch agent types for chapter writing
 * Maps to agents in .claude/agents/phdresearch/
 */
export type ChapterAgentType =
  | 'introduction-writer'
  | 'literature-review-writer'
  | 'theoretical-framework-analyst'
  | 'methodology-writer'
  | 'results-writer'
  | 'discussion-writer'
  | 'conclusion-writer'
  | 'apa-citation-specialist'
  | 'chapter-synthesizer';

/**
 * Dynamically select the appropriate phdresearch agent based on chapter title
 * Maps chapter content type to specialized writing agents
 *
 * @param chapterTitle - The title of the chapter being written
 * @returns The appropriate agent type for this chapter
 */
export function getAgentForChapter(chapterTitle: string): ChapterAgentType {
  const title = chapterTitle.toLowerCase();

  // Introduction variants
  if (title.includes('introduction') || title.includes('background') || title.includes('overview')) {
    return 'introduction-writer';
  }

  // Literature Review variants
  if (title.includes('literature') || title.includes('review') || title.includes('related work') || title.includes('prior work')) {
    return 'literature-review-writer';
  }

  // Theoretical Framework variants
  if (title.includes('theoretical') || title.includes('framework') || title.includes('conceptual') || title.includes('theory')) {
    return 'theoretical-framework-analyst';
  }

  // Methodology variants
  if (title.includes('method') || title.includes('approach') || title.includes('design') || title.includes('procedure')) {
    return 'methodology-writer';
  }

  // Results variants
  if (title.includes('result') || title.includes('finding') || title.includes('analysis') || title.includes('data')) {
    return 'results-writer';
  }

  // Discussion variants
  if (title.includes('discussion') || title.includes('interpretation') || title.includes('implication')) {
    return 'discussion-writer';
  }

  // Conclusion variants
  if (title.includes('conclusion') || title.includes('summary') || title.includes('future work') || title.includes('recommendation')) {
    return 'conclusion-writer';
  }

  // References/Bibliography variants
  if (title.includes('reference') || title.includes('bibliograph') || title.includes('citation') || title.includes('sources')) {
    return 'apa-citation-specialist';
  }

  // Fallback for any other chapter type
  return 'chapter-synthesizer';
}

/**
 * Chapter synthesis prompt for Claude Code Task tool
 * Contains all data needed to spawn a specialized chapter writing agent
 */
export interface ChapterSynthesisPrompt {
  /** Chapter number */
  chapterNumber: number;
  /** Chapter title */
  chapterTitle: string;
  /** Section details */
  sections: Array<{ id: string; title: string; wordTarget: number }>;
  /** Research content organized by section */
  researchContent: Record<string, string>;
  /** Style profile ID to apply */
  styleProfileId: string | null;
  /** Output file path */
  outputPath: string;
  /** Total word target */
  wordTarget: number;
  /** Agent type to spawn - dynamically selected based on chapter title */
  agentType: ChapterAgentType;
  /** Full prompt for the agent */
  prompt: string;
}

/**
 * Section content during synthesis
 */
interface SectionContent {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  citations: CitationRef[];
  crossReferences: CrossReference[];
}

/**
 * Paragraph with metadata for duplicate detection
 */
interface ParagraphMeta {
  text: string;
  sourceIndex: number;
  phase: number;
  wordCount: number;
  vector: number[];
  isDuplicate?: boolean;
  mergeTarget?: number;
}

/**
 * Word count enforcement result
 */
interface WordCountResult {
  content: string;
  status: 'success' | 'warning' | 'failed';
  action: string;
  wordCount: number;
  compliance: number;
}

/**
 * ChapterWriterAgent - Synthesizes chapter content from mapped sources
 *
 * @example
 * ```typescript
 * // Create with style profile for LLM-based synthesis (RECOMMENDED)
 * const writer = new ChapterWriterAgent('academic-papers-uk');
 * const output = await writer.writeChapter({
 *   chapter: chapterDefinition,
 *   sources: mappedSummaries,
 *   style: styleProfile,
 *   allChapters: allChapterDefinitions,
 *   tokenBudget: 15000
 * });
 *
 * // The writer now uses the chapter-synthesizer agent prompt
 * // to transform raw research into clean academic prose.
 * // Style profile ensures consistent UK English and academic register.
 * ```
 */
export class ChapterWriterAgent {
  /**
   * Style profile ID for consistent academic writing style
   */
  private styleProfileId?: string;

  /**
   * Research directory for output paths
   */
  private researchDir?: string;

  /**
   * Create ChapterWriterAgent
   *
   * @param styleProfileId - Optional style profile ID for consistent style application
   * @param researchDir - Optional research directory for output paths
   */
  constructor(styleProfileId?: string, researchDir?: string) {
    this.styleProfileId = styleProfileId;
    this.researchDir = researchDir;
  }

  /**
   * Stopwords to filter during tokenization
   */
  private static readonly STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'this', 'that',
    'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our',
    'which', 'who', 'what', 'where', 'when', 'how', 'why', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'can', 'just', 'now', 'then', 'also', 'into', 'over', 'after', 'before'
  ]);

  /**
   * Duplicate detection thresholds per Constitution QA-001
   */
  private static readonly THRESHOLDS = {
    DUPLICATE: 0.50,       // >50% similarity = duplicate
    NEAR_DUPLICATE: 0.80   // >80% similarity = merge
  };

  /**
   * Word count tolerance per DI-005
   */
  private static readonly WORD_COUNT_TOLERANCE = {
    WARNING_MIN: 0.80,     // 80% of target
    WARNING_MAX: 1.20,     // 120% of target
    FAILURE_MIN: 0.70,     // 70% of target
    FAILURE_MAX: 1.30      // 130% of target
  };

  /**
   * Generate synthesis prompts for Claude Code to spawn chapter-synthesizer agents
   *
   * This is the PREFERRED method - outputs prompts that Claude Code can use
   * to spawn the chapter-synthesizer agent for each chapter.
   *
   * @param input - Chapter writer input with chapter definition, sources, style
   * @returns Synthesis prompt for Claude Code Task tool
   */
  async generateSynthesisPrompt(input: ChapterWriterInput): Promise<ChapterSynthesisPrompt> {
    const { chapter, sources, style } = input;

    // Calculate word targets per section
    const wordsPerSection = Math.floor(chapter.wordTarget / chapter.sections.length);

    // Build research content organized by section
    const researchContent: Record<string, string> = {};
    const sections: Array<{ id: string; title: string; wordTarget: number }> = [];

    for (let i = 0; i < chapter.sections.length; i++) {
      const sectionId = chapter.sections[i];
      const sectionTitle = chapter.sectionTitles[i] || `Section ${sectionId}`;

      // Find relevant content from sources for this section
      const relevantContent = this.findRelevantContent(sources, sectionTitle, chapter);

      // Deduplicate
      const deduplicatedContent = this.deduplicateContent(relevantContent);

      // Sort by phase (later phases = more synthesized)
      const sorted = [...deduplicatedContent.paragraphs].sort((a, b) => b.phase - a.phase);
      researchContent[sectionId] = sorted.map(p => p.text).join('\n\n');

      sections.push({
        id: sectionId,
        title: sectionTitle,
        wordTarget: wordsPerSection
      });
    }

    // CRITICAL: Load style profile (this is NON-NEGOTIABLE)
    // First try to load from style profile ID, then from passed style, then defaults
    let styleReqs: string;
    if (this.styleProfileId) {
      // Load full style profile from AgentDB by ID
      styleReqs = await this.loadStyleProfile();
      logger.info('Using style profile', { styleProfileId: this.styleProfileId });
    } else if (style) {
      // Use passed style characteristics
      styleReqs = this.formatStyleRequirements(style);
      logger.info('Using passed style characteristics');
    } else {
      // Use defaults
      styleReqs = this.getDefaultStyleRequirements();
      logger.warn('No style profile - using UK English academic defaults');
    }

    // Get synthesis guidance from input if available
    const synthesisGuidance = input.synthesisGuidance;

    // Generate the full prompt for the agent
    const prompt = this.buildAgentPrompt(chapter, sections, researchContent, styleReqs, synthesisGuidance);

    const outputPath = this.researchDir
      ? join(this.researchDir, 'final', 'chapters', `chapter-${chapter.number}.md`)
      : `final/chapters/chapter-${chapter.number}.md`;

    // Dynamically select the appropriate agent based on chapter title
    const selectedAgent = getAgentForChapter(chapter.title);
    logger.info('Chapter mapped to agent', { chapterTitle: chapter.title, agent: selectedAgent });

    return {
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      sections,
      researchContent,
      styleProfileId: this.styleProfileId || null,
      outputPath,
      wordTarget: chapter.wordTarget,
      agentType: selectedAgent,
      prompt
    };
  }

  /**
   * Format style requirements for the agent prompt
   *
   * CRITICAL: This method uses StyleAnalyzer to generate comprehensive
   * style requirements. The style profile is NON-NEGOTIABLE.
   */
  private formatStyleRequirements(style: StyleCharacteristics): string {
    // Use StyleAnalyzer to generate comprehensive style prompt
    const analyzer = new StyleAnalyzer();
    const stylePrompt = analyzer.generateStylePrompt(style);

    const lines: string[] = [];
    lines.push('## MANDATORY STYLE REQUIREMENTS');
    lines.push('');
    lines.push('**CRITICAL: These style requirements are NON-NEGOTIABLE. Apply them to ALL output.**');
    lines.push('');
    lines.push(stylePrompt);
    lines.push('');

    // Add explicit language variant requirements
    if (style.regional?.languageVariant === 'en-GB') {
      lines.push('### UK English Spelling (REQUIRED)');
      lines.push('- Use -ise endings: organise, recognise, emphasise, synthesise, characterise');
      lines.push('- Use -our endings: behaviour, colour, favour, honour, labour');
      lines.push('- Use -re endings: centre, metre, theatre');
      lines.push('- Use "towards" not "toward", "got" not "gotten"');
      lines.push('- Use "whilst" alongside "while", "amongst" alongside "among"');
      lines.push('');
    }

    // Add academic register requirements
    lines.push('### Academic Register (REQUIRED)');
    lines.push('- Write in third person (avoid "I", "we", "you")');
    lines.push('- Use NO contractions (cannot NOT can\'t, do not NOT don\'t)');
    lines.push('- Use formal vocabulary throughout');
    lines.push('- Use hedging language where appropriate (suggests, indicates, may, appears)');
    lines.push('- Use passive voice where appropriate for objectivity');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Load and format complete style profile from AgentDB
   *
   * This loads the full style profile by ID and formats it
   * for inclusion in the synthesis prompt.
   */
  private async loadStyleProfile(): Promise<string> {
    if (!this.styleProfileId) {
      logger.warn('No style profile ID - using defaults');
      return this.getDefaultStyleRequirements();
    }

    try {
      const styleManager = getStyleProfileManager();
      const profile = styleManager.getProfile(this.styleProfileId);

      if (profile?.characteristics) {
        logger.info('Loaded style profile', { styleProfileId: this.styleProfileId });
        return this.formatStyleRequirements(profile.characteristics);
      }
    } catch (error) {
      logger.error('Failed to load style profile', error instanceof Error ? error : new Error(String(error)), { styleProfileId: this.styleProfileId });
    }

    logger.warn('Falling back to default style requirements');
    return this.getDefaultStyleRequirements();
  }

  /**
   * Get default UK English academic style requirements
   */
  private getDefaultStyleRequirements(): string {
    return `## MANDATORY STYLE REQUIREMENTS

**CRITICAL: These style requirements are NON-NEGOTIABLE. Apply them to ALL output.**

### UK English Spelling (REQUIRED)
- Use -ise endings: organise, recognise, emphasise, synthesise, characterise
- Use -our endings: behaviour, colour, favour, honour, labour
- Use -re endings: centre, metre, theatre
- Use "towards" not "toward", "got" not "gotten"

### Academic Register (REQUIRED)
- Write in third person (avoid "I", "we", "you")
- Use NO contractions (cannot NOT can't, do not NOT don't)
- Use formal vocabulary throughout
- Use hedging language where appropriate (suggests, indicates, may, appears)
- Use passive voice where appropriate for objectivity

### Citation Style: APA 7th Edition
- In-text: (Author, Year) or Author (Year)
- Integrate citations naturally into prose
- Do NOT dump multiple citations at end of sentences
`;
  }

  /**
   * Build the full prompt for the chapter-synthesizer agent
   */
  private buildAgentPrompt(
    chapter: ChapterDefinition,
    sections: Array<{ id: string; title: string; wordTarget: number }>,
    researchContent: Record<string, string>,
    styleReqs: string,
    synthesisGuidance?: string
  ): string {
    const lines: string[] = [];

    lines.push(`# Chapter ${chapter.number}: ${chapter.title}`);
    lines.push('');
    lines.push(`**Word Target**: ${chapter.wordTarget} words`);
    lines.push('');
    lines.push(styleReqs);

    // Include synthesis guidance if available (from 06-chapter-synthesizer.md)
    if (synthesisGuidance) {
      lines.push('## Synthesis Guidance');
      lines.push('');
      lines.push('**Use this guidance to inform your writing approach:**');
      lines.push('');
      lines.push(synthesisGuidance);
      lines.push('');
    }

    lines.push('## Sections to Write');
    lines.push('');

    for (const section of sections) {
      lines.push(`### ${section.id} ${section.title}`);
      lines.push(`**Target**: ${section.wordTarget} words`);
      lines.push('');
      lines.push('**Research Content** (transform to prose, do NOT copy):');
      lines.push('```');
      lines.push(researchContent[section.id] || '[No content found]');
      lines.push('```');
      lines.push('');
    }

    lines.push('## Instructions');
    lines.push('');
    lines.push('1. Transform the research content above into clean academic prose');
    lines.push('2. DO NOT copy research artifacts (Q1:, FLAG:, Confidence:, etc.)');
    lines.push('3. Integrate citations naturally (Author, Year) format');
    lines.push('4. Meet word count targets (±10%)');
    lines.push('5. Apply the style requirements exactly');
    lines.push('6. Write in third person with academic register');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Write a chapter from mapped source summaries (basic concatenation)
   *
   * NOTE: This is a FALLBACK method that does basic concatenation.
   * For proper academic prose, use generateSynthesisPrompt() and have
   * Claude Code spawn the chapter-synthesizer agent.
   *
   * @param input - Chapter writer input with chapter definition, sources, style
   * @returns Complete chapter output with content, citations, metrics
   */
  async writeChapter(input: ChapterWriterInput): Promise<ChapterWriterOutput> {
    const { chapter, sources, style, allChapters, tokenBudget: _tokenBudget } = input;
    const warnings: string[] = [];
    let tokensUsed = 0;

    logger.info('Basic concatenation (use generateSynthesisPrompt for LLM synthesis)', { chapterNumber: chapter.number });

    // Calculate word targets per section
    const wordsPerSection = Math.floor(chapter.wordTarget / chapter.sections.length);

    // Build section contents
    const sectionContents: SectionContent[] = [];
    for (let i = 0; i < chapter.sections.length; i++) {
      const sectionId = chapter.sections[i];
      const sectionTitle = chapter.sectionTitles[i] || `Section ${sectionId}`;

      // Find relevant content from sources for this section
      const relevantContent = this.findRelevantContent(sources, sectionTitle, chapter);

      // Detect and handle duplicates
      const deduplicatedContent = this.deduplicateContent(relevantContent);
      if (deduplicatedContent.duplicatesFound > 0) {
        warnings.push(
          `Section ${sectionId}: Detected ${deduplicatedContent.duplicatesFound} duplicate paragraphs`
        );
      }

      // Basic concatenation fallback
      const synthesized = this.synthesizeSection(
        sectionId,
        sectionTitle,
        deduplicatedContent.paragraphs,
        wordsPerSection,
        chapter,
        style
      );

      // Extract citations from synthesized content
      const citations = this.extractCitations(synthesized.content, sources);

      // Generate cross-references
      const crossRefs = this.generateCrossReferences(
        synthesized.content,
        chapter.number,
        sectionId,
        allChapters
      );

      sectionContents.push({
        id: sectionId,
        title: sectionTitle,
        content: synthesized.content,
        wordCount: synthesized.wordCount,
        citations,
        crossReferences: crossRefs
      });

      tokensUsed += synthesized.tokensUsed;
    }

    // Format complete chapter
    const formattedChapter = this.formatChapter(chapter, sectionContents);

    // Enforce word count limits per DI-005
    const wordCountResult = this.enforceWordCount(
      formattedChapter,
      chapter.wordTarget
    );

    if (wordCountResult.status === 'warning') {
      warnings.push(
        `Chapter ${chapter.number} word count ${wordCountResult.wordCount} is ` +
        `${Math.round(wordCountResult.compliance * 100)}% of target ${chapter.wordTarget}`
      );
    }

    // Collect all citations
    const allCitations = sectionContents.flatMap(s => s.citations);

    // Collect all cross-references
    const allCrossRefs = sectionContents.flatMap(s => s.crossReferences);

    // Build section info array
    const sections: SectionInfo[] = sectionContents.map(s => ({
      id: s.id,
      title: s.title,
      wordCount: s.wordCount
    }));

    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(
      wordCountResult.wordCount,
      chapter.wordTarget,
      allCitations,
      sources,
      style
    );

    // Determine generation status
    let generationStatus: PhaseStatus;
    if (wordCountResult.status === 'failed') {
      generationStatus = 'failed';
    } else if (wordCountResult.status === 'warning' || warnings.length > 0) {
      generationStatus = 'warning';
    } else {
      generationStatus = 'success';
    }

    return {
      chapterNumber: chapter.number as ChapterNumber,
      title: chapter.title,
      content: wordCountResult.content,
      wordCount: wordCountResult.wordCount,
      citations: this.deduplicateCitations(allCitations),
      crossReferences: allCrossRefs,
      sections,
      qualityMetrics,
      generationStatus,
      warnings,
      tokensUsed
    };
  }

  /**
   * Build the LLM prompt for chapter synthesis
   *
   * @param input - Chapter writer input
   * @returns Formatted prompt string
   */
  buildPrompt(input: ChapterWriterInput): string {
    const { chapter, sources, style, allChapters } = input;

    // Build source material section
    const sourceMaterial = sources
      .map((s, i) => {
        return `### Source ${i + 1}: ${s.fileName} (${s.agentName})\n` +
               `Topics: ${s.primaryTopics.join(', ')}\n` +
               `Key findings: ${s.keyFindings.join('; ')}\n` +
               `Summary: ${s.summary}\n`;
      })
      .join('\n---\n');

    // Build cross-reference context
    const crossRefContext = allChapters
      .filter(c => c.number !== chapter.number)
      .map(c => `- Chapter ${c.number}: ${c.title}`)
      .join('\n');

    // Build style rules
    const styleRules = this.buildStyleRules(style);

    return `
# Chapter Synthesis Task

You are synthesizing Chapter ${chapter.number}: ${chapter.title}

## Chapter Purpose
${chapter.purpose}

## Sections to Write
${chapter.sections.map((s, i) => `${s}. ${chapter.sectionTitles[i]}`).join('\n')}

## Word Target
${chapter.wordTarget} words (tolerance: 70%-130%)

## Research Questions Addressed
${chapter.questionsAddressed.join(', ')}

${styleRules}

## Valid Cross-Reference Targets
${crossRefContext}

## Source Materials (SYNTHESIZE, do NOT copy verbatim)
${sourceMaterial}

## Instructions

1. SYNTHESIZE content from sources into a unified narrative
2. PRESERVE all citations in format: (Author, Year)
3. Include cross-references to other chapters where relevant
4. If sources conflict, present both perspectives with citations
5. Do NOT duplicate content already covered in other sections
6. Maintain academic tone appropriate for PhD dissertation

Write the complete chapter now:
`;
  }

  /**
   * Generate cross-references to other chapters
   *
   * @param content - Section content to scan
   * @param chapterNumber - Current chapter number
   * @param sectionId - Current section identifier
   * @param allChapters - All chapter definitions
   * @returns Array of cross-references found
   */
  generateCrossReferences(
    content: string,
    chapterNumber: number,
    sectionId: string,
    allChapters: ChapterDefinition[]
  ): CrossReference[] {
    const refs: CrossReference[] = [];

    // Patterns to match cross-references
    const patterns = [
      // "Chapter N" or "chapter N"
      /[Cc]hapter\s+(\d+)/g,
      // "Section N.M"
      /[Ss]ection\s+(\d+\.\d+)/g,
      // "see Chapter N" or "discussed in Chapter N"
      /(?:see|discussed\s+in|mentioned\s+in|refer\s+to)\s+[Cc]hapter\s+(\d+)/gi,
      // "(see Chapter N)" parenthetical
      /\(see\s+[Cc]hapter\s+(\d+)\)/gi
    ];

    for (const pattern of patterns) {
      let match;
      const patternCopy = new RegExp(pattern.source, pattern.flags);

      while ((match = patternCopy.exec(content)) !== null) {
        const targetNumber = parseInt(match[1].split('.')[0], 10);

        // Skip self-references
        if (targetNumber === chapterNumber) continue;

        // Find target chapter
        const targetChapter = allChapters.find(c => c.number === targetNumber);
        if (!targetChapter) continue;

        // Extract section if present
        let targetSection: string | null = null;
        if (match[0].toLowerCase().includes('section')) {
          const sectionMatch = match[0].match(/\d+\.\d+/);
          if (sectionMatch) {
            targetSection = sectionMatch[0];
          }
        }

        // Generate markdown link
        const chapterSlug = this.slugify(targetChapter.title);
        const paddedNum = String(targetChapter.number).padStart(2, '0');

        let linkFormat: string;
        let linkText: string;

        if (targetSection) {
          const sectionAnchor = targetSection.replace('.', '-');
          linkFormat = `[See Section ${targetSection}](./ch${paddedNum}-${chapterSlug}.md#section-${sectionAnchor})`;
          linkText = `See Section ${targetSection}`;
        } else {
          linkFormat = `[See Chapter ${targetChapter.number}: ${targetChapter.title}](./ch${paddedNum}-${chapterSlug}.md)`;
          linkText = `See Chapter ${targetChapter.number}: ${targetChapter.title}`;
        }

        refs.push({
          sourceLocation: { chapter: chapterNumber, section: sectionId },
          targetChapter: targetNumber,
          targetSection,
          linkText,
          linkFormat
        });
      }
    }

    // Deduplicate by target
    const seen = new Set<string>();
    return refs.filter(ref => {
      const key = `${ref.targetChapter}:${ref.targetSection || 'chapter'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Extract citations from content using source information
   *
   * @param content - Content to extract citations from
   * @param sources - Source summaries for validation
   * @returns Array of citation references
   */
  extractCitations(content: string, sources: AgentOutputSummary[]): CitationRef[] {
    const citations: CitationRef[] = [];
    const seen = new Set<string>();

    // Patterns for citation extraction
    const patterns = {
      // APA Style: (Author, 2020), (Author & Co-Author, 2020), (Author et al., 2020)
      APA: /\(([A-Z][a-z]+(?:\s+(?:et\s+al\.))?(?:\s*[&,]\s*[A-Z][a-z]+)*)[,\s]+(\d{4})[a-z]?(?:,\s*pp?\.\s*\d+(?:\s*[-]\s*\d+)?)?\)/g,
      // MLA Style: (Author 42)
      MLA: /\(([A-Z][a-z]+)\s+(\d+(?:\s*[-]\s*\d+)?)\)/g,
      // Narrative citations: Author (2020) states...
      NARRATIVE: /([A-Z][a-z]+(?:\s+et\s+al\.)?)\s+\((\d{4})[a-z]?\)/g
    };

    // Extract APA citations
    let match;
    while ((match = patterns.APA.exec(content)) !== null) {
      const raw = match[0];
      if (!seen.has(raw)) {
        seen.add(raw);
        citations.push({
          raw,
          parsed: {
            authors: this.parseAuthors(match[1]),
            year: parseInt(match[2], 10),
            title: null
          }
        });
      }
    }

    // Extract MLA citations
    patterns.MLA.lastIndex = 0;
    while ((match = patterns.MLA.exec(content)) !== null) {
      const raw = match[0];
      if (!seen.has(raw)) {
        seen.add(raw);
        citations.push({
          raw,
          parsed: {
            authors: [match[1]],
            year: null,
            title: null
          }
        });
      }
    }

    // Extract narrative citations
    patterns.NARRATIVE.lastIndex = 0;
    while ((match = patterns.NARRATIVE.exec(content)) !== null) {
      const raw = match[0];
      if (!seen.has(raw)) {
        seen.add(raw);
        citations.push({
          raw,
          parsed: {
            authors: this.parseAuthors(match[1]),
            year: parseInt(match[2], 10),
            title: null
          }
        });
      }
    }

    // Also include citations from sources that appear in content
    for (const source of sources) {
      for (const citation of source.citations) {
        if (!seen.has(citation.raw) && content.includes(citation.raw)) {
          seen.add(citation.raw);
          citations.push(citation);
        }
      }
    }

    return citations;
  }

  /**
   * Calculate quality metrics for the chapter
   *
   * @param wordCount - Actual word count
   * @param targetWordCount - Target word count
   * @param citations - Extracted citations
   * @param sources - Used sources
   * @param style - Style characteristics (for violation counting)
   * @returns Quality metrics object
   */
  calculateQualityMetrics(
    wordCount: number,
    targetWordCount: number,
    citations: CitationRef[],
    sources: AgentOutputSummary[],
    _style: StyleCharacteristics | null
  ): QualityMetrics {
    // Word count compliance as ratio
    const wordCountCompliance = wordCount / targetWordCount;

    // Citation count
    const citationCount = citations.length;

    // Count unique sources used (sources with citations in content)
    const sourcesWithCitations = new Set<number>();
    for (const source of sources) {
      for (const citation of source.citations) {
        if (citations.some(c => c.raw === citation.raw)) {
          sourcesWithCitations.add(source.index);
        }
      }
    }
    const uniqueSourcesUsed = sourcesWithCitations.size || sources.length;

    // Style violations (placeholder - actual checking in StyleApplier)
    const styleViolations = 0;

    return {
      wordCountCompliance,
      citationCount,
      uniqueSourcesUsed,
      styleViolations
    };
  }

  // ============================================
  // Private: Content Finding and Synthesis
  // ============================================

  /**
   * Find relevant content from sources for a specific section
   */
  private findRelevantContent(
    sources: AgentOutputSummary[],
    sectionTitle: string,
    chapter: ChapterDefinition
  ): ParagraphMeta[] {
    const paragraphs: ParagraphMeta[] = [];
    const titleTokens = new Set(this.tokenize(sectionTitle));
    const chapterTokens = new Set([
      ...this.tokenize(chapter.title),
      ...this.tokenize(chapter.purpose),
      ...chapter.keywords.flatMap(k => this.tokenize(k))
    ]);

    for (const source of sources) {
      // Combine source content for extraction
      const sourceText = [
        source.summary,
        ...source.keyFindings,
        ...source.primaryTopics
      ].join('\n\n');

      // Split into paragraphs
      const rawParagraphs = sourceText.split(/\n\n+/);

      for (const para of rawParagraphs) {
        const trimmed = para.trim();
        if (trimmed.length < 50) continue; // Skip short fragments

        const paraTokens = this.tokenize(trimmed);
        const paraSet = new Set(paraTokens);

        // Calculate relevance score
        const titleOverlap = this.jaccardSimilarity(titleTokens, paraSet);
        const chapterOverlap = this.jaccardSimilarity(chapterTokens, paraSet);
        const relevance = titleOverlap * 0.6 + chapterOverlap * 0.4;

        // Include if above minimal relevance threshold
        if (relevance > 0.05 || paraTokens.length > 30) {
          paragraphs.push({
            text: trimmed,
            sourceIndex: source.index,
            phase: source.phase,
            wordCount: this.countWords(trimmed),
            vector: [] // Computed lazily during deduplication
          });
        }
      }
    }

    return paragraphs;
  }

  /**
   * Deduplicate content using TF-IDF vectorization and cosine similarity
   * Per GAP-H001 and Constitution QA-001
   */
  private deduplicateContent(
    paragraphs: ParagraphMeta[]
  ): { paragraphs: ParagraphMeta[]; duplicatesFound: number } {
    if (paragraphs.length <= 1) {
      return { paragraphs, duplicatesFound: 0 };
    }

    // Build IDF scores from all paragraphs
    const idfScores = this.buildIdfScores(paragraphs);

    // Vectorize all paragraphs
    for (const para of paragraphs) {
      para.vector = this.vectorizeParagraph(para.text, idfScores);
    }

    let duplicatesFound = 0;

    // Compare all pairs
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].isDuplicate) continue;

      for (let j = i + 1; j < paragraphs.length; j++) {
        if (paragraphs[j].isDuplicate) continue;
        if (paragraphs[i].sourceIndex === paragraphs[j].sourceIndex) continue;

        const similarity = this.cosineSimilarity(
          paragraphs[i].vector,
          paragraphs[j].vector
        );

        if (similarity > ChapterWriterAgent.THRESHOLDS.DUPLICATE) {
          duplicatesFound++;

          if (similarity > ChapterWriterAgent.THRESHOLDS.NEAR_DUPLICATE) {
            // Near-duplicate: merge into better version
            if (paragraphs[i].phase > paragraphs[j].phase) {
              paragraphs[j].isDuplicate = true;
              paragraphs[j].mergeTarget = i;
            } else if (paragraphs[j].phase > paragraphs[i].phase) {
              paragraphs[i].isDuplicate = true;
              paragraphs[i].mergeTarget = j;
            } else {
              // Same phase: keep longer version
              if (paragraphs[i].wordCount >= paragraphs[j].wordCount) {
                paragraphs[j].isDuplicate = true;
                paragraphs[j].mergeTarget = i;
              } else {
                paragraphs[i].isDuplicate = true;
                paragraphs[i].mergeTarget = j;
              }
            }
          } else {
            // Partial duplicate: flag the lower-priority one
            if (paragraphs[i].phase >= paragraphs[j].phase) {
              paragraphs[j].isDuplicate = true;
            } else {
              paragraphs[i].isDuplicate = true;
            }
          }
        }
      }
    }

    // Filter out duplicates
    const filtered = paragraphs.filter(p => !p.isDuplicate);

    return { paragraphs: filtered, duplicatesFound };
  }

  /**
   * Synthesize section content from paragraphs (basic concatenation fallback)
   *
   * NOTE: This is a FALLBACK method. For proper LLM-based synthesis,
   * use generateSynthesisPrompt() and have Claude Code spawn the
   * chapter-synthesizer agent.
   */
  private synthesizeSection(
    sectionId: string,
    sectionTitle: string,
    paragraphs: ParagraphMeta[],
    targetWords: number,
    _chapter: ChapterDefinition,
    style: StyleCharacteristics | null
  ): { content: string; wordCount: number; tokensUsed: number } {
    // Sort paragraphs by phase (later phases first, as they're more refined)
    const sorted = [...paragraphs].sort((a, b) => b.phase - a.phase);

    // Basic concatenation (NOT recommended - use generateSynthesisPrompt instead)
    let content = `## ${sectionId} ${sectionTitle}\n\n`;
    let currentWords = 0;
    let tokensUsed = 0;

    for (const para of sorted) {
      let text = para.text;
      if (style?.regional?.languageVariant === 'en-GB') {
        text = this.applyBritishSpelling(text);
      }
      if (currentWords + para.wordCount <= targetWords * 1.3) {
        content += text + '\n\n';
        currentWords += para.wordCount;
        tokensUsed += this.estimateTokens(text);
      }
    }

    return { content, wordCount: this.countWords(content), tokensUsed };
  }

  // NOTE: LLM synthesis removed - use generateSynthesisPrompt() and have
  // Claude Code spawn the chapter-synthesizer agent instead.

  // ============================================
  // Private: Word Count Enforcement
  // ============================================

  /**
   * Enforce word count limits per DI-005
   */
  private enforceWordCount(
    content: string,
    target: number
  ): WordCountResult {
    const wordCount = this.countWords(content);
    const compliance = wordCount / target;

    const { FAILURE_MIN, FAILURE_MAX, WARNING_MIN, WARNING_MAX } =
      ChapterWriterAgent.WORD_COUNT_TOLERANCE;

    // Check failure thresholds first
    if (compliance < FAILURE_MIN || compliance > FAILURE_MAX) {
      // Per Constitution DI-005: content outside 70%-130% MUST NOT be written
      // We still return the content for logging/debugging but mark as failed
      return {
        content,
        status: 'failed',
        action: compliance < FAILURE_MIN ? 'needs-expansion' : 'needs-condensation',
        wordCount,
        compliance
      };
    }

    // Check warning thresholds
    if (compliance < WARNING_MIN || compliance > WARNING_MAX) {
      return {
        content,
        status: 'warning',
        action: compliance < WARNING_MIN ? 'may-need-expansion' : 'may-need-condensation',
        wordCount,
        compliance
      };
    }

    return {
      content,
      status: 'success',
      action: 'none',
      wordCount,
      compliance
    };
  }

  // ============================================
  // Private: Text Processing Utilities
  // ============================================

  /**
   * Format complete chapter from sections
   */
  private formatChapter(
    chapter: ChapterDefinition,
    sections: SectionContent[]
  ): string {
    let content = `# Chapter ${chapter.number}: ${chapter.title}\n\n`;

    for (const section of sections) {
      content += section.content;
    }

    return content;
  }

  /**
   * Tokenize text into normalized words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !ChapterWriterAgent.STOPWORDS.has(w));
  }

  /**
   * Build IDF scores from paragraphs
   */
  private buildIdfScores(paragraphs: ParagraphMeta[]): Map<string, number> {
    const docFreq = new Map<string, number>();
    const N = paragraphs.length;

    for (const para of paragraphs) {
      const uniqueTerms = new Set(this.tokenize(para.text));
      for (const term of uniqueTerms) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    const idfScores = new Map<string, number>();
    for (const [term, count] of docFreq) {
      idfScores.set(term, Math.log(N / (count + 1)) + 1);
    }

    return idfScores;
  }

  /**
   * Vectorize paragraph using TF-IDF
   */
  private vectorizeParagraph(text: string, idfScores: Map<string, number>): number[] {
    const tokens = this.tokenize(text);
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    // Build TF-IDF vector
    const vocabulary = Array.from(idfScores.keys()).sort();
    const vector = new Array(vocabulary.length).fill(0);

    for (let i = 0; i < vocabulary.length; i++) {
      const term = vocabulary[i];
      if (termFreq.has(term)) {
        const tf = (termFreq.get(term) || 0) / tokens.length;
        const idf = idfScores.get(term) || 0;
        vector[i] = tf * idf;
      }
    }

    // L2 normalization
    return this.normalizeVector(vector);
  }

  /**
   * L2 normalize a vector
   */
  private normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vector;
    return vector.map(v => v / magnitude);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length || v1.length === 0) return 0;
    let dotProduct = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
    }
    return dotProduct; // Vectors are already normalized
  }

  /**
   * Jaccard similarity between two sets
   */
  private jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Estimate token count (rough: 1 token ~ 4 characters)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Slugify a title for URL/filename use
   */
  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }

  /**
   * Parse author string into array
   */
  private parseAuthors(authorString: string): string[] {
    // Handle "et al."
    if (authorString.toLowerCase().includes('et al')) {
      const mainAuthor = authorString.replace(/\s+et\s+al\.?/i, '').trim();
      return [mainAuthor];
    }

    // Split on & or ,
    return authorString
      .split(/\s*[&,]\s*/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
  }

  /**
   * Deduplicate citations by raw text
   */
  private deduplicateCitations(citations: CitationRef[]): CitationRef[] {
    const seen = new Set<string>();
    return citations.filter(c => {
      if (seen.has(c.raw)) return false;
      seen.add(c.raw);
      return true;
    });
  }

  /**
   * Apply basic British spelling transformations
   */
  private applyBritishSpelling(text: string): string {
    const replacements: [RegExp, string][] = [
      [/\borganiz(e|ed|er|ers|es|ing|ation|ations)\b/gi, 'organis$1'],
      [/\brecogniz(e|ed|er|ers|es|ing|ation|ations)\b/gi, 'recognis$1'],
      [/\bemphasiz(e|ed|er|ers|es|ing)\b/gi, 'emphasis$1'],
      [/\bcolor\b/gi, 'colour'],
      [/\bcolors\b/gi, 'colours'],
      [/\bbehavior\b/gi, 'behaviour'],
      [/\bbehaviors\b/gi, 'behaviours'],
      [/\bcenter\b/gi, 'centre'],
      [/\bcenters\b/gi, 'centres'],
      [/\btoward\b/gi, 'towards'],
      [/\bgotten\b/gi, 'got']
    ];

    let result = text;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Build style rules section for prompt
   */
  private buildStyleRules(style: StyleCharacteristics | null): string {
    if (!style) {
      return `## Style Guidelines
- Use academic tone appropriate for PhD dissertation
- Avoid contractions
- Use precise, formal language`;
    }

    const rules = ['## Style Guidelines'];

    // Check regional settings for language variant
    if (style.regional?.languageVariant === 'en-GB') {
      rules.push('- Use British English spellings (-ise, -our, -re endings)');
      rules.push('- Use "towards" not "toward", "got" not "gotten"');
    }

    // Use tone metrics for formality
    if (style.tone?.formalityScore !== undefined) {
      rules.push(`- Formality level: ${(style.tone.formalityScore * 100).toFixed(0)}% (academic tone, no contractions)`);
    }

    if (style.citationStyle) {
      rules.push(`- Citation style: ${style.citationStyle}`);
    }

    return rules.join('\n');
  }
}
