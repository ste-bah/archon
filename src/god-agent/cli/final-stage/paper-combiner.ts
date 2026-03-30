/**
 * PaperCombiner - Combines chapters into final paper with ToC and metadata
 *
 * Implements SPEC-FUNC-001 Section 2.6 and SPEC-TECH-001 Section 2.5
 *
 * Addresses:
 * - GAP-H006: Table of Contents generation with anchor links
 * - GAP-H007: Appendices handling (inline < 5000 words, separate files otherwise)
 * - GAP-C007: Output directory structure (final/, chapters/, appendices/)
 *
 * Constitution Rules:
 * - FS-003: Chapter file naming convention ch{NN}-{slug}.md
 * - FS-004: Final paper naming final-paper.md
 * - QA-002: Validate all cross-references
 * - QA-004: Table of Contents required
 */

import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { accessSync, constants as fsConstants } from 'fs';
import * as path from 'path';
import type {
  ChapterWriterOutput,
  FinalPaper,
  PaperMetadata
} from './types.js';
import {
  generatePdf,
  type GeneratePdfOptions as PdfGenOptions,
  type GeneratePdfResult,
  type PaperInputForGeneration
} from '../../../pdf-generator/index.js';

const execFileAsync = promisify(execFile);

/**
 * Appendix definition structure
 */
interface AppendixDefinition {
  letter: string;
  title: string;
  source: string;
  content?: string;
  wordCount?: number;
}

/**
 * Cross-reference validation result
 */
interface CrossRefValidation {
  content: string;
  brokenLinks: string[];
  validLinks: number;
}

/**
 * Appendix handling result
 */
interface AppendixResult {
  mainContent: string;
  appendixFiles: string[];
  inlined: boolean;
}

/**
 * Options for PDF generation in writeOutputFiles
 */
export interface PdfGenerationOptions {
  /** Generate PDF alongside markdown output */
  generatePdf?: boolean;
  /** Authors for the PDF title page */
  authors?: Array<{
    name: string;
    affiliationIds?: number[];
    orcid?: string;
  }>;
  /** Affiliations for the PDF title page */
  affiliations?: Array<{
    id: number;
    name: string;
    department?: string;
  }>;
  /** Abstract text (extracted from Chapter 1 if not provided) */
  abstract?: string;
  /** Keywords for the abstract */
  keywords?: string[];
}

/**
 * PaperCombiner - Combines all chapter outputs into a final paper
 *
 * @example
 * ```typescript
 * const combiner = new PaperCombiner();
 * const paper = await combiner.combine(chapters, metadata);
 * await combiner.writeOutputFiles(paper, outputDir);
 * ```
 */
export class PaperCombiner {
  /**
   * Maximum appendix word count for inline inclusion (5000 words ~ 5 pages)
   */
  private static readonly INLINE_APPENDIX_THRESHOLD = 5000;

  /**
   * Maximum anchor length per spec
   */
  private static readonly MAX_ANCHOR_LENGTH = 50;

  /**
   * Default appendix structure per SPEC-FUNC-001 Section 2.6.5
   */
  private static readonly DEFAULT_APPENDICES: AppendixDefinition[] = [
    { letter: 'A', title: 'Terminology Glossary', source: '02-terminology.md' },
    { letter: 'B', title: 'Construct Definitions', source: '04-constructs.md' },
    { letter: 'C', title: 'Research Plan Details', source: '03-research-plan.md' },
    { letter: 'D', title: 'Pattern Catalog', source: '15-patterns.md' },
    { letter: 'E', title: 'Benchmark Specifications', source: '24-instruments.md' },
    { letter: 'F', title: 'Implementation Guidelines', source: 'generated' }
  ];

  /**
   * Combine chapters into a final paper
   *
   * @param chapters - Array of chapter outputs from ChapterWriterAgent
   * @param metadata - Paper metadata (title, slug, generatedDate)
   * @returns Complete FinalPaper object
   */
  async combine(
    chapters: ChapterWriterOutput[],
    metadata: PaperMetadata
  ): Promise<FinalPaper> {
    // Sort chapters by number
    const sortedChapters = [...chapters].sort(
      (a, b) => a.chapterNumber - b.chapterNumber
    );

    // Generate title page
    const titlePage = this.generateTitlePage(metadata, sortedChapters);

    // ToC is generated natively by pandoc via --toc flag (uses \tableofcontents
    // with tocloft formatting), so we only keep the markdown version for the .md file.
    const toc = this.generateTableOfContents(sortedChapters);

    // Build combined content — includes markdown ToC for the .md output.
    // For PDF, pandoc's --toc generates a native LaTeX \tableofcontents instead,
    // and the markdown title page + ToC are stripped before passing to pandoc.
    let combinedContent = titlePage;
    combinedContent += '\n\n';
    combinedContent += toc;
    combinedContent += '\n\n';

    // Add each chapter with page breaks, collecting references.
    // Store stripped content per chapter so individual files also omit
    // per-chapter references (avoiding split-brain with the combined paper).
    const allReferences = new Set<string>();
    const strippedChapters: ChapterWriterOutput[] = [];

    for (const chapter of sortedChapters) {
      const { strippedContent, references } = this.stripAndCollectReferences(chapter.content);
      // Page break before each chapter
      combinedContent += '\\newpage\n\n';
      combinedContent += strippedContent;
      combinedContent += '\n\n';
      for (const ref of references) {
        allReferences.add(ref);
      }
      // Clone chapter with stripped content for individual file output
      strippedChapters.push({ ...chapter, content: strippedContent });
    }

    // Append consolidated, deduplicated references section on new page
    if (allReferences.size > 0) {
      const sortedRefs = [...allReferences].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      combinedContent += '\\newpage\n\n';
      combinedContent += '# References\n\n';
      combinedContent += sortedRefs.join('\n\n');
      combinedContent += '\n';
    }

    // Validate and fix cross-references
    const validation = this.validateCrossReferences(combinedContent, strippedChapters);
    combinedContent = validation.content;

    return {
      title: metadata.title,
      toc,
      chapters: strippedChapters,
      combinedContent,
      metadata
    };
  }

  /**
   * Generate table of contents with anchor links
   * Implements GAP-H006 and GAP-C016 anchor generation
   *
   * @param chapters - Sorted array of chapter outputs
   * @returns Markdown table of contents string
   */
  generateTableOfContents(chapters: ChapterWriterOutput[]): string {
    let toc = '\\newpage\n\n# Table of Contents\n\n';

    for (const chapter of chapters) {
      // Chapter entry (top-level)
      const chapterAnchor = this.generateAnchor(chapter.title);
      toc += `${chapter.chapterNumber}. [${chapter.title}](#${chapterAnchor})\n`;

      // Section entries (indented with 4 spaces for proper markdown nesting)
      for (const section of chapter.sections) {
        const sectionAnchor = this.generateAnchor(section.title);
        toc += `    ${section.id}. [${section.title}](#${sectionAnchor})\n`;
      }

      // Blank line between chapters for visual separation in PDF
      toc += '\n';
    }

    return toc;
  }

  /**
   * Write output files to the final directory
   * Implements GAP-C007 output directory structure
   *
   * @param paper - Combined FinalPaper object
   * @param outputDir - Path to final/ output directory
   * @param pdfOptions - Optional PDF generation options
   */
  async writeOutputFiles(
    paper: FinalPaper,
    outputDir: string,
    pdfOptions?: PdfGenerationOptions
  ): Promise<void> {
    // Ensure directories exist
    const chaptersDir = path.join(outputDir, 'chapters');
    await fs.mkdir(chaptersDir, { recursive: true });

    // Write individual chapter files
    for (const chapter of paper.chapters) {
      const chapterSlug = this.slugify(chapter.title);
      const paddedNum = String(chapter.chapterNumber).padStart(2, '0');
      const fileName = `ch${paddedNum}-${chapterSlug}.md`;
      const filePath = path.join(chaptersDir, fileName);

      await fs.writeFile(filePath, chapter.content, 'utf-8');
    }

    // Write combined final paper
    const finalPaperPath = path.join(outputDir, 'final-paper.md');
    await fs.writeFile(finalPaperPath, paper.combinedContent, 'utf-8');

    // Write metadata.json
    const metadataPath = path.join(outputDir, 'metadata.json');
    const fullMetadata = this.buildFullMetadata(paper);
    await fs.writeFile(
      metadataPath,
      JSON.stringify(fullMetadata, null, 2),
      'utf-8'
    );

    // Generate PDF if requested — call pandoc directly on the final markdown
    // (bypasses the structured PaperInput pipeline which re-wraps content)
    if (pdfOptions?.generatePdf !== false) {
      try {
        const pdfOutputPath = path.join(outputDir, 'final-paper.pdf');
        const runningHead = this.abbreviateRunningHead(paper.metadata.title, 50);

        // Write temp markdown with YAML front matter for pandoc
        const yamlFrontMatter = [
          '---',
          `title: "${paper.title.replace(/"/g, '\\"')}"`,
          `running-head: "${runningHead.replace(/"/g, '\\"')}"`,
          'author:',
          ...(pdfOptions?.authors || [{ name: 'Steven Bahia' }]).map(
            a => `  - name: "${a.name}"`
          ),
          ...(pdfOptions?.affiliations || []).length > 0
            ? ['institute:', ...(pdfOptions!.affiliations!.map(a => `  - "${a.name}"`))]
            : [],
          'documentclass: article',
          'papersize: letter',
          'geometry: margin=1in',
          'fontsize: 12pt',
          'linestretch: 2',
          'indent: true',
          '---',
          '',
        ].join('\n');

        // Strip the markdown title page AND manual ToC from content — the LaTeX
        // template renders its own title page from YAML front matter, and pandoc's
        // --toc generates a native \tableofcontents.  We find the first chapter
        // \newpage (the one that precedes actual chapter content, not the ToC).
        let pdfContent = paper.combinedContent;
        // The chapters start after "Table of Contents" section.  Find the
        // \newpage that precedes the first chapter heading (# Chapter...).
        const tocHeadingIdx = pdfContent.indexOf('# Table of Contents');
        if (tocHeadingIdx !== -1) {
          // Find the \newpage after the ToC block (before first chapter)
          const afterToc = pdfContent.indexOf('\\newpage', tocHeadingIdx + 20);
          if (afterToc !== -1) {
            pdfContent = pdfContent.substring(afterToc);
          }
        } else {
          // No ToC heading — just strip title page (everything before first \newpage)
          const firstNewpage = pdfContent.indexOf('\\newpage');
          if (firstNewpage !== -1) {
            pdfContent = pdfContent.substring(firstNewpage);
          }
        }

        const tempMdPath = path.join(outputDir, '.temp-final-paper.md');
        await fs.writeFile(tempMdPath, yamlFrontMatter + pdfContent, 'utf-8');

        // Detect pandoc and xelatex paths
        const pandocPath = this.detectBinary(
          ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', '/usr/bin/pandoc', '/opt/anaconda3/bin/pandoc'],
          'pandoc'
        );
        const xelatexPath = this.detectBinary([
          `${process.env.HOME}/Library/TinyTeX/bin/universal-darwin/xelatex`,
          '/Library/TeX/texbin/xelatex',
          '/usr/local/bin/xelatex',
          '/usr/bin/xelatex',
        ], 'xelatex');

        const templatePath = path.resolve(
          path.dirname(new URL(import.meta.url).pathname),
          '../../../pdf-generator/templates/pandoc/apa7.tex'
        );

        const args = [
          tempMdPath,
          '-o', pdfOutputPath,
          `--pdf-engine=${xelatexPath}`,
          `--template=${templatePath}`,
          '--from=markdown',
          '--standalone',
          '--citeproc',
          '--toc',
          '--toc-depth=2',
          '-V', 'geometry:margin=0.75in',
          '-V', 'fontsize=11pt',
          '-V', 'linestretch=1.5',
          '-V', 'indent=true',
          '-V', `mainfont=Times New Roman`,
        ];

        const { stderr } = await execFileAsync(pandocPath, args, {
          timeout: 120_000,
          maxBuffer: 50 * 1024 * 1024,
        });

        // Clean up temp file
        await fs.unlink(tempMdPath).catch(() => {});

        // Check if PDF was created
        try {
          await fs.access(pdfOutputPath);
          console.log(`[PaperCombiner] PDF generated successfully: ${pdfOutputPath}`);
          if (stderr) {
            // Log warnings but don't fail
            const warnings = stderr.split('\n').filter(l => l.includes('[WARNING]'));
            warnings.slice(0, 5).forEach(w => console.warn(`[PDF Warning] ${w}`));
            if (warnings.length > 5) {
              console.warn(`[PDF Warning] ...and ${warnings.length - 5} more warnings`);
            }
          }
        } catch {
          console.warn(`[PaperCombiner] PDF was not created at ${pdfOutputPath}`);
          if (stderr) console.warn(`[PaperCombiner] pandoc stderr: ${stderr.slice(0, 500)}`);
        }
      } catch (pdfError) {
        const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
        console.warn(`[PaperCombiner] PDF generation error: ${errorMessage.slice(0, 500)}`);
        console.warn('[PaperCombiner] Markdown output was successful, continuing without PDF.');
      }
    }
  }

  /**
   * Transform FinalPaper to PaperInputForGeneration format for PDF generation
   *
   * @param paper - The combined FinalPaper object
   * @param options - PDF generation options
   * @returns PaperInputForGeneration compatible object
   */
  private transformToPaperInput(
    paper: FinalPaper,
    options?: PdfGenerationOptions
  ): PaperInputForGeneration {
    // Extract unique references from all chapters
    const references: string[] = [];
    const seenRefs = new Set<string>();
    for (const chapter of paper.chapters) {
      for (const citation of chapter.citations) {
        if (!seenRefs.has(citation.raw)) {
          seenRefs.add(citation.raw);
          references.push(citation.raw);
        }
      }
    }

    // Extract abstract from Chapter 1 first paragraph if not provided
    let abstract = options?.abstract;
    if (!abstract && paper.chapters.length > 0) {
      const firstChapter = paper.chapters.find(c => c.chapterNumber === 1);
      if (firstChapter) {
        abstract = this.extractAbstractFromContent(firstChapter.content);
      }
    }
    // Fallback abstract if still not available
    if (!abstract) {
      abstract = `This paper presents research on ${paper.title}. ` +
        `The study encompasses ${paper.chapters.length} chapters with ` +
        `${this.countUniqueCitations(paper.chapters)} unique citations.`;
    }

    // Use provided authors or default
    const authors = options?.authors || [
      { name: 'Steven Bahia', affiliationIds: [] }
    ];

    // Generate running head from title (max 50 chars, word-boundary truncation)
    const runningHead = this.abbreviateRunningHead(paper.metadata.title, 50);

    return {
      title: paper.title,
      runningHead,
      authors,
      affiliations: options?.affiliations,
      abstract,
      keywords: options?.keywords,
      body: paper.combinedContent,
      references: references.length > 0 ? references : undefined
    };
  }

  /**
   * Extract abstract text from chapter content
   * Looks for the first substantial paragraph after the title
   *
   * @param content - Chapter markdown content
   * @returns Extracted abstract text or undefined
   */
  private extractAbstractFromContent(content: string): string | undefined {
    const lines = content.split('\n');
    let foundHeading = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines before finding content
      if (!trimmed) {
        if (paragraphLines.length > 0) {
          // End of first paragraph
          break;
        }
        continue;
      }

      // Skip headings
      if (trimmed.startsWith('#')) {
        foundHeading = true;
        continue;
      }

      // Skip metadata lines (starting with **)
      if (trimmed.startsWith('**')) {
        continue;
      }

      // Collect paragraph text after first heading
      if (foundHeading) {
        paragraphLines.push(trimmed);
      }
    }

    const paragraph = paragraphLines.join(' ').trim();

    // Return if we have a reasonable abstract (at least 50 chars)
    if (paragraph.length >= 50) {
      // Limit to ~250 words (APA abstract limit)
      const words = paragraph.split(/\s+/);
      if (words.length > 250) {
        return words.slice(0, 250).join(' ') + '...';
      }
      return paragraph;
    }

    return undefined;
  }

  /**
   * Generate paper metadata from slug and chapters
   *
   * @param slug - Research slug identifier
   * @param chapters - Array of chapter outputs
   * @returns PaperMetadata object
   */
  generateMetadata(slug: string, chapters: ChapterWriterOutput[]): PaperMetadata {
    // Extract title from first chapter or use slug
    const title = chapters.length > 0
      ? this.inferTitleFromChapters(chapters)
      : this.formatSlugAsTitle(slug);

    return {
      title,
      slug,
      generatedDate: new Date().toISOString()
    };
  }

  /**
   * Handle appendices based on total word count
   * Implements GAP-H007
   *
   * @param referencesChapterContent - Content of final chapter (references)
   * @param appendices - Array of appendix definitions with content
   * @param outputDir - Path to output directory
   * @returns AppendixResult with main content and file list
   */
  async handleAppendices(
    referencesChapterContent: string,
    appendices: AppendixDefinition[],
    outputDir: string
  ): Promise<AppendixResult> {
    // Calculate total appendix words
    const totalWords = appendices.reduce(
      (sum, app) => sum + (app.wordCount || this.countWords(app.content || '')),
      0
    );

    let mainContent = referencesChapterContent;
    const appendixFiles: string[] = [];

    if (totalWords < PaperCombiner.INLINE_APPENDIX_THRESHOLD) {
      // Include inline in references chapter
      for (const appendix of appendices) {
        if (appendix.content) {
          mainContent += `\n\n## Appendix ${appendix.letter}: ${appendix.title}\n\n`;
          mainContent += appendix.content;
        }
      }

      return {
        mainContent,
        appendixFiles: [],
        inlined: true
      };
    }

    // Create separate appendix files
    const appendicesDir = path.join(outputDir, 'appendices');
    await fs.mkdir(appendicesDir, { recursive: true });

    for (const appendix of appendices) {
      if (appendix.content) {
        const slug = this.slugify(appendix.title);
        const fileName = `appendix-${appendix.letter.toLowerCase()}-${slug}.md`;
        const filePath = path.join(appendicesDir, fileName);

        // Write appendix file
        const appendixContent = `# Appendix ${appendix.letter}: ${appendix.title}\n\n${appendix.content}`;
        await fs.writeFile(filePath, appendixContent, 'utf-8');

        appendixFiles.push(fileName);

        // Add reference in main content
        mainContent += `\n\n## Appendix ${appendix.letter}: ${appendix.title}\n\n`;
        mainContent += `See [Appendix ${appendix.letter}](./appendices/${fileName})\n`;
      }
    }

    return {
      mainContent,
      appendixFiles,
      inlined: false
    };
  }

  // ============================================
  // Private: Title Page Generation
  // ============================================

  /**
   * Generate title page with metadata
   */
  private generateTitlePage(
    metadata: PaperMetadata,
    chapters: ChapterWriterOutput[]
  ): string {
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const totalCitations = this.countUniqueCitations(chapters);

    const formattedDate = new Date(metadata.generatedDate).toLocaleDateString(
      'en-GB',
      {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }
    );

    return `# ${metadata.title}

**Research Query**: ${metadata.slug}

**Generated**: ${formattedDate}

**Total Words**: ${totalWords.toLocaleString()}

**Total Citations**: ${totalCitations}

**Chapters**: ${chapters.length}`;
  }

  // ============================================
  // Private: Anchor Generation (GAP-C016)
  // ============================================

  /**
   * Generate markdown anchor from heading text
   * Per SPEC-FUNC-001 Section 2.6.4
   */
  private generateAnchor(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Spaces to dashes
      .replace(/-+/g, '-') // Collapse multiple dashes
      .replace(/^-|-$/g, '') // Trim leading/trailing dashes
      .substring(0, PaperCombiner.MAX_ANCHOR_LENGTH);
  }

  // ============================================
  // Private: Cross-Reference Validation (QA-002)
  // ============================================

  /**
   * Validate and fix cross-references in combined content
   */
  private validateCrossReferences(
    content: string,
    chapters: ChapterWriterOutput[]
  ): CrossRefValidation {
    let validated = content;
    const brokenLinks: string[] = [];
    let validLinks = 0;

    // Build set of valid anchors
    const validAnchors = new Set<string>();

    // Register the consolidated references heading anchor
    validAnchors.add(this.generateAnchor('References'));

    for (const chapter of chapters) {
      // Add chapter anchor
      const chapterAnchor = this.generateAnchor(chapter.title);
      validAnchors.add(chapterAnchor);

      // Add legacy format anchors for backward compatibility
      validAnchors.add(`chapter-${chapter.chapterNumber}`);

      // Add section anchors
      for (const section of chapter.sections) {
        const sectionAnchor = this.generateAnchor(section.title);
        validAnchors.add(sectionAnchor);

        // Add legacy format
        validAnchors.add(`section-${section.id.replace('.', '-')}`);
      }
    }

    // Find and validate all internal links
    const linkPattern = /\[([^\]]+)\]\(#([^)]+)\)/g;
    let match;

    // Use a copy for iteration to avoid issues with replacement
    const originalContent = content;
    const replacements: Array<{ original: string; replacement: string }> = [];

    while ((match = linkPattern.exec(originalContent)) !== null) {
      const [fullMatch, linkText, anchor] = match;

      if (validAnchors.has(anchor)) {
        validLinks++;
      } else {
        brokenLinks.push(anchor);
        // Mark broken link
        replacements.push({
          original: fullMatch,
          replacement: `${linkText} [broken link: ${anchor}]`
        });
      }
    }

    // Apply replacements
    for (const { original, replacement } of replacements) {
      validated = validated.replace(original, replacement);
    }

    return {
      content: validated,
      brokenLinks,
      validLinks
    };
  }

  // ============================================
  // Private: Metadata Building
  // ============================================

  /**
   * Build full metadata object for JSON output
   */
  private buildFullMetadata(paper: FinalPaper): Record<string, unknown> {
    const chapters = paper.chapters.map((c) => ({
      number: c.chapterNumber,
      title: c.title,
      words: c.wordCount,
      citations: c.citations.length,
      wordCountCompliance: c.qualityMetrics.wordCountCompliance
    }));

    return {
      execution: {
        timestamp: paper.metadata.generatedDate,
        phases: {
          paperCombination: {
            status: 'success',
            chaptersProcessed: paper.chapters.length
          }
        }
      },
      document: {
        title: paper.metadata.title,
        researchQuery: paper.metadata.slug,
        totalWords: paper.chapters.reduce((sum, c) => sum + c.wordCount, 0),
        totalCitations: this.countUniqueCitations(paper.chapters),
        chapters
      },
      quality: {
        crossReferencesValidated: true,
        tocGenerated: true
      }
    };
  }

  // ============================================
  // Private: Reference Consolidation
  // ============================================

  /**
   * Strip the references/bibliography section from chapter content and
   * return the individual reference entries.
   *
   * Recognises headings: `# References`, `## References`, `## Bibliography`,
   * `## Works Cited`, `## Sources` (case-insensitive).
   * Each reference entry is one or more consecutive non-blank lines
   * separated from other entries by blank lines.
   *
   * Note: Deduplication is exact-string; near-duplicates (DOI vs URL,
   * abbreviated journal names) may survive as separate entries.
   * Note: chapter.wordCount in FinalPaper reflects the original content
   * including the references section, not the stripped body word count.
   *
   * @param content - Markdown chapter content
   * @returns Stripped content and extracted reference strings
   */
  private stripAndCollectReferences(
    content: string
  ): { strippedContent: string; references: string[] } {
    // Normalise line endings to \n
    const normalised = content.replace(/\r\n/g, '\n');

    // Match common reference/bibliography headings (case-insensitive)
    const refHeadingPattern = /^#{1,2}\s+(References|Bibliography|Works Cited|Sources)\s*$/im;
    const match = refHeadingPattern.exec(normalised);

    if (!match) {
      return { strippedContent: content, references: [] };
    }

    const beforeRefs = normalised.slice(0, match.index).trimEnd();
    const afterHeading = normalised.slice(match.index + match[0].length);

    // Parse reference entries from everything after the heading.
    // Stop if we hit another markdown heading (# or ##).
    const lines = afterHeading.split('\n');
    const references: string[] = [];
    let currentEntry: string[] = [];
    let endIdx = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Any heading signals end of references section (no position guard)
      if (trimmed.startsWith('#')) {
        if (currentEntry.length > 0) {
          references.push(currentEntry.join('\n'));
          currentEntry = [];
        }
        endIdx = i;
        break;
      }

      if (trimmed === '') {
        // Blank line: flush current entry
        if (currentEntry.length > 0) {
          references.push(currentEntry.join('\n'));
          currentEntry = [];
        }
        continue;
      }

      // Preserve original line (keeps hanging-indent whitespace for APA)
      currentEntry.push(line);
    }

    // Flush last entry
    if (currentEntry.length > 0) {
      references.push(currentEntry.join('\n'));
    }

    // Trim each reference for dedup, but store the trimmed version
    const trimmedRefs = references.map(r => r.trim()).filter(r => r.length > 0);

    // If there was content after the references section (another heading),
    // re-attach it.
    const trailingContent = endIdx < lines.length
      ? '\n\n' + lines.slice(endIdx).join('\n').trimEnd()
      : '';

    const strippedContent = beforeRefs + trailingContent;

    return { strippedContent, references: trimmedRefs };
  }

  // ============================================
  // Private: Utility Methods
  // ============================================

  /**
   * Count unique citations across all chapters
   */
  private countUniqueCitations(chapters: ChapterWriterOutput[]): number {
    const seen = new Set<string>();

    for (const chapter of chapters) {
      for (const citation of chapter.citations) {
        seen.add(citation.raw);
      }
    }

    return seen.size;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter((w) => w.length > 0).length;
  }

  /**
   * Slugify a title for filename use
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
   * Infer paper title from chapters
   */
  private inferTitleFromChapters(chapters: ChapterWriterOutput[]): string {
    // Look for introduction chapter
    const intro = chapters.find((c) => c.chapterNumber === 1);
    if (intro) {
      // Try to extract title from chapter content first line
      const firstLine = intro.content.split('\n')[0];
      if (firstLine.startsWith('# ')) {
        const title = firstLine.replace(/^#\s*/, '').replace(/^Chapter\s*\d+:\s*/i, '');
        if (title.length > 10) {
          return title;
        }
      }
    }

    // Fallback: use first chapter title
    if (chapters.length > 0) {
      return chapters[0].title;
    }

    return 'Research Paper';
  }

  /**
   * Detect the first existing executable from a list of candidate paths.
   */
  private detectBinary(candidates: string[], fallback: string): string {
    for (const p of candidates) {
      try {
        accessSync(p, fsConstants.X_OK);
        return p;
      } catch { /* try next */ }
    }
    return fallback;
  }

  /**
   * Generate an abbreviated running head from a paper title.
   * Per APA 7th Edition Section 2.18: max 50 characters, ALL CAPS.
   * Strips subtitle after colon, removes leading articles, truncates at word boundary.
   */
  private abbreviateRunningHead(title: string, maxLength = 50): string {
    let text = title.toUpperCase().trim();

    if (text.length <= maxLength) return text;

    // Remove subtitle after colon
    const colonIdx = text.indexOf(':');
    if (colonIdx > 0) {
      const main = text.substring(0, colonIdx).trim();
      if (main.length <= maxLength) return main;
      text = main;
    }

    // Remove subtitle after question mark (for question-form titles)
    const qIdx = text.indexOf('?');
    if (qIdx > 0 && qIdx < text.length - 1) {
      const main = text.substring(0, qIdx + 1).trim();
      if (main.length <= maxLength) return main;
      text = main;
    }

    // Remove leading articles
    for (const article of ['THE ', 'A ', 'AN ']) {
      if (text.startsWith(article) && text.length > maxLength) {
        text = text.substring(article.length);
        if (text.length <= maxLength) return text;
        break;
      }
    }

    // Truncate at last word boundary within limit
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.5) {
      return truncated.substring(0, lastSpace).trim();
    }
    return truncated.trim();
  }

  /**
   * Format slug as readable title
   */
  private formatSlugAsTitle(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Get default appendix definitions
   */
  static getDefaultAppendices(): AppendixDefinition[] {
    return [...PaperCombiner.DEFAULT_APPENDICES];
  }
}
