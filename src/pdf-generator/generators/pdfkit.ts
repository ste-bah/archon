/**
 * PDFKit PDF Generator
 *
 * Pure JavaScript PDF generator using PDFKit library.
 * Fallback generator that requires no external dependencies.
 * Produces APA 7th Edition compliant PDFs.
 *
 * @module pdf-generator/generators/pdfkit
 */

import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { BaseGenerator } from './base-generator.js';
import type {
  GeneratorResult,
  FormattedPaper,
  PdfOptions,
  FormattedSection,
  FormattedAppendix,
} from '../types.js';
import { APA_CONFIG, APA_HEADING_STYLES } from '../constants.js';
import {
  PDFKIT_BUILTIN_FONTS,
  getPdfKitFont,
  getHeadingFont,
} from '../templates/pdfkit/fonts.js';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * PDFKit document type extension for proper typing.
 */
type PdfKitDocument = InstanceType<typeof PDFDocument>;

/**
 * Content segment type for mixed text/code rendering.
 */
interface ContentSegment {
  type: 'text' | 'code';
  content: string;
  language?: string; // Optional language hint from ```lang
}

/**
 * Page dimensions and positioning constants.
 */
const PAGE_CONSTANTS = {
  /** Letter size width in points (8.5 inches) */
  pageWidth: 612,
  /** Letter size height in points (11 inches) */
  pageHeight: 792,
  /** 1 inch margin in points */
  margin: 72,
  /** 0.5 inch indent in points */
  indent: 36,
  /** Header position from top */
  headerY: 36,
  /** Content area width */
  contentWidth: 468, // 612 - 72 - 72
  /** Double line spacing in points (12pt * 2) */
  lineGap: 12,
} as const;

/**
 * Code block styling constants.
 */
const CODE_BLOCK_STYLE = {
  /** Font size for code (slightly smaller than body) */
  fontSize: 10,
  /** Padding inside code block background */
  padding: 8,
  /** Light gray background color */
  backgroundColor: '#f5f5f5',
  /** Border color for code blocks */
  borderColor: '#e0e0e0',
  /** Line height multiplier for code */
  lineHeightMultiplier: 1.4,
} as const;

/**
 * Code line processing configuration.
 * Controls how individual code lines are preprocessed before rendering.
 */
const CODE_LINE_CONFIG = {
  /** Max characters before truncation (452pt / 6pt per char) */
  maxChars: 75,
  /** Convert tabs to this many spaces */
  tabSpaces: 4,
  /** Box-drawing characters for ASCII diagrams */
  asciiChars: '─│┌┐└┘├┤┬┴┼╔╗╚╝║═╭╮╯╰┃━┏┓┗┛┣┫┳┻╋',
} as const;

/**
 * Regex pattern to match fenced code blocks.
 * Captures: optional language, code content
 */
const CODE_BLOCK_REGEX = /```(\w*)\n?([\s\S]*?)```/g;

// =============================================================================
// CONTENT PARSING HELPERS
// =============================================================================

/**
 * Parse content string into segments of text and code blocks.
 *
 * @param content - Raw content string that may contain code blocks
 * @returns Array of content segments
 */
function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  // Reset regex state
  CODE_BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    // Add text before this code block
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        segments.push({ type: 'text', content: textBefore });
      }
    }

    // Add the code block
    const language = match[1] || undefined;
    const codeContent = match[2];
    if (codeContent.trim()) {
      segments.push({
        type: 'code',
        content: codeContent.replace(/^\n+|\n+$/g, ''), // Trim leading/trailing newlines
        language
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < content.length) {
    const textAfter = content.slice(lastIndex).trim();
    if (textAfter) {
      segments.push({ type: 'text', content: textAfter });
    }
  }

  // If no code blocks found, return original content as single text segment
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content.trim() });
  }

  return segments;
}

/**
 * Detect if a line contains ASCII diagram characters.
 * ASCII diagrams should not be truncated to preserve alignment.
 *
 * @param line - Code line to check
 * @returns True if line contains box-drawing characters
 */
function isAsciiDiagramLine(line: string): boolean {
  for (const char of CODE_LINE_CONFIG.asciiChars) {
    if (line.includes(char)) {
      return true;
    }
  }
  return false;
}

/**
 * Preprocess a code line for rendering.
 * - Converts tabs to spaces
 * - Truncates long lines (unless ASCII diagram)
 *
 * @param line - Raw code line
 * @param maxChars - Maximum characters before truncation
 * @returns Processed line ready for rendering
 */
function preprocessCodeLine(line: string, maxChars: number): string {
  // Convert tabs to spaces
  let processed = line.replace(/\t/g, ' '.repeat(CODE_LINE_CONFIG.tabSpaces));

  // Don't truncate ASCII diagrams - they need exact alignment
  if (isAsciiDiagramLine(processed)) {
    return processed;
  }

  // Truncate long lines with ellipsis
  if (processed.length > maxChars) {
    return processed.substring(0, maxChars - 3) + '...';
  }

  return processed;
}

// =============================================================================
// PDFKIT GENERATOR CLASS
// =============================================================================

/**
 * PDFKit-based PDF generator for APA 7th Edition papers.
 * Pure JavaScript implementation with no external dependencies.
 */
export class PdfKitGenerator extends BaseGenerator {
  readonly type = 'pdfkit' as const;

  constructor() {
    super();
    // Always available - pure JavaScript, no external dependencies
    this._available = true;
  }

  // ===========================================================================
  // AVAILABILITY CHECK
  // ===========================================================================

  /**
   * Check if PDFKit is available.
   * Always returns true since PDFKit is a pure JS dependency.
   *
   * @returns Always true
   */
  async checkAvailability(): Promise<boolean> {
    this._available = true;
    this.log('info', 'PDFKit generator is always available (pure JavaScript)');
    return true;
  }

  // ===========================================================================
  // MAIN GENERATION METHOD
  // ===========================================================================

  /**
   * Generate a PDF from a formatted paper using PDFKit.
   *
   * @param paper - The formatted paper to convert
   * @param options - Generation options
   * @returns Generation result
   */
  async generate(paper: FormattedPaper, options: PdfOptions): Promise<GeneratorResult> {
    const startTime = Date.now();
    const warnings: string[] = [];

    return new Promise((resolve) => {
      try {
        // Validate inputs
        this.validatePaper(paper);
        this.validateOptions(options);

        this.reportProgress('Initializing PDFKit', 0);
        this.log('debug', 'Creating PDF document');

        // Create PDF document with APA settings
        const doc = new PDFDocument({
          size: 'LETTER',
          margins: {
            top: PAGE_CONSTANTS.margin,
            bottom: PAGE_CONSTANTS.margin,
            left: PAGE_CONSTANTS.margin,
            right: PAGE_CONSTANTS.margin,
          },
          info: {
            Title: paper.titlePage.title,
            Author: paper.titlePage.authors.map((a) => a.name).join(', '),
            Subject: 'APA 7th Edition Formatted Paper',
            Creator: 'ClaudeFlow PDF Generator (PDFKit)',
          },
          autoFirstPage: false,
        });

        // Pipe to output file
        const stream = createWriteStream(options.outputPath);
        doc.pipe(stream);

        // Track page numbers
        let pageNumber = 0;

        // Handle page additions for running head
        doc.on('pageAdded', () => {
          pageNumber++;
          if (pageNumber > 1) {
            // Add running head to all pages after title page
            this.addRunningHead(doc, paper.titlePage.runningHead, pageNumber);
          }
        });

        // === TITLE PAGE ===
        this.reportProgress('Rendering title page', 10);
        doc.addPage();
        pageNumber = 1;
        this.renderTitlePage(doc, paper, pageNumber);

        // === ABSTRACT ===
        if (paper.abstract) {
          this.reportProgress('Rendering abstract', 25);
          doc.addPage();
          this.renderAbstract(doc, paper.abstract);
        }

        // === BODY ===
        this.reportProgress('Rendering body content', 40);
        doc.addPage();
        // Add title at start of body (centered, bold)
        this.renderBodyTitle(doc, paper.titlePage.title);
        this.renderBody(doc, paper.body);

        // === REFERENCES ===
        if (paper.references && paper.references.entries.length > 0) {
          this.reportProgress('Rendering references', 70);
          doc.addPage();
          this.renderReferences(doc, paper.references);
        }

        // === APPENDICES ===
        if (paper.appendices && paper.appendices.length > 0) {
          this.reportProgress('Rendering appendices', 85);
          this.renderAppendices(doc, paper.appendices);
        }

        // Finalize document
        this.reportProgress('Finalizing PDF', 95);
        doc.end();

        // Handle completion
        stream.on('finish', () => {
          this.reportProgress('Complete', 100);
          this.log('info', `PDF generated successfully: ${options.outputPath}`);
          resolve(this.createSuccessResult(options.outputPath, Date.now() - startTime, warnings));
        });

        stream.on('error', (error) => {
          this.log('error', 'Stream error during PDF generation', error);
          resolve(this.createErrorResult(error as Error, warnings));
        });
      } catch (error) {
        this.log('error', 'Error during PDF generation', error);
        resolve(this.createErrorResult(error as Error, warnings));
      }
    });
  }

  // ===========================================================================
  // RUNNING HEAD
  // ===========================================================================

  /**
   * Add running head to page.
   * Per APA 7th: Running head (ALL CAPS) flush left, page number flush right.
   *
   * @param doc - PDFKit document
   * @param runningHead - Running head text
   * @param pageNumber - Current page number
   */
  private addRunningHead(doc: PdfKitDocument, runningHead: string, pageNumber: number): void {
    const head = runningHead.substring(0, 50).toUpperCase();

    // Save current position
    const savedY = doc.y;

    // Running head - left aligned
    doc
      .font(PDFKIT_BUILTIN_FONTS.timesRoman)
      .fontSize(12)
      .text(head, PAGE_CONSTANTS.margin, PAGE_CONSTANTS.headerY, {
        continued: false,
      });

    // Page number - right aligned
    doc.text(String(pageNumber), PAGE_CONSTANTS.margin, PAGE_CONSTANTS.headerY, {
      align: 'right',
      width: PAGE_CONSTANTS.contentWidth,
    });

    // Restore position to content area
    doc.y = savedY > PAGE_CONSTANTS.margin ? savedY : PAGE_CONSTANTS.margin + 36;
  }

  // ===========================================================================
  // TITLE PAGE
  // ===========================================================================

  /**
   * Render the title page following APA 7th Edition guidelines.
   *
   * @param doc - PDFKit document
   * @param paper - Formatted paper
   * @param pageNumber - Current page number (always 1 for title page)
   */
  private renderTitlePage(doc: PdfKitDocument, paper: FormattedPaper, pageNumber: number): void {
    // Running head on title page
    this.addRunningHead(doc, paper.titlePage.runningHead, pageNumber);

    // Move to upper third of page (approximately 3-4 lines from top of content area)
    doc.y = PAGE_CONSTANTS.margin + 144; // About 2 inches from top

    // Title - centered, bold
    doc
      .font(PDFKIT_BUILTIN_FONTS.timesBold)
      .fontSize(12)
      .text(paper.titlePage.title, PAGE_CONSTANTS.margin, doc.y, {
        align: 'center',
        width: PAGE_CONSTANTS.contentWidth,
        lineGap: PAGE_CONSTANTS.lineGap,
      });

    // One double-spaced blank line after title
    doc.moveDown(2);

    // Authors - centered
    doc.font(PDFKIT_BUILTIN_FONTS.timesRoman);
    paper.titlePage.authors.forEach((author, index) => {
      doc.text(author.name, PAGE_CONSTANTS.margin, doc.y, {
        align: 'center',
        width: PAGE_CONSTANTS.contentWidth,
      });

      // Affiliation follows author
      if (author.affiliation) {
        doc.text(author.affiliation, PAGE_CONSTANTS.margin, doc.y, {
          align: 'center',
          width: PAGE_CONSTANTS.contentWidth,
        });
      }

      // Add spacing between authors
      if (index < paper.titlePage.authors.length - 1) {
        doc.moveDown(0.5);
      }
    });

    // Author Note (for professional papers)
    if (paper.titlePage.authorNote) {
      // Move to lower portion of page
      doc.y = Math.max(doc.y + 72, PAGE_CONSTANTS.pageHeight * 0.6);

      // "Author Note" heading - centered, bold
      doc
        .font(PDFKIT_BUILTIN_FONTS.timesBold)
        .text('Author Note', PAGE_CONSTANTS.margin, doc.y, {
          align: 'center',
          width: PAGE_CONSTANTS.contentWidth,
        });

      doc.moveDown();

      // Author note content - indented paragraphs
      doc.font(PDFKIT_BUILTIN_FONTS.timesRoman).text(paper.titlePage.authorNote, PAGE_CONSTANTS.margin, doc.y, {
        align: 'left',
        width: PAGE_CONSTANTS.contentWidth,
        indent: PAGE_CONSTANTS.indent,
        lineGap: PAGE_CONSTANTS.lineGap,
      });
    }
  }

  // ===========================================================================
  // ABSTRACT
  // ===========================================================================

  /**
   * Render the abstract page following APA 7th Edition guidelines.
   *
   * @param doc - PDFKit document
   * @param abstract - Formatted abstract
   */
  private renderAbstract(doc: PdfKitDocument, abstract: FormattedPaper['abstract']): void {
    if (!abstract) return;

    // Set position after running head
    doc.y = PAGE_CONSTANTS.margin + 48;

    // "Abstract" heading - centered, bold
    doc
      .font(PDFKIT_BUILTIN_FONTS.timesBold)
      .fontSize(12)
      .text('Abstract', PAGE_CONSTANTS.margin, doc.y, {
        align: 'center',
        width: PAGE_CONSTANTS.contentWidth,
      });

    doc.moveDown();

    // Abstract content - no indent, single paragraph
    doc.font(PDFKIT_BUILTIN_FONTS.timesRoman).text(abstract.content, PAGE_CONSTANTS.margin, doc.y, {
      align: 'left',
      width: PAGE_CONSTANTS.contentWidth,
      indent: 0, // No first line indent per APA
      lineGap: PAGE_CONSTANTS.lineGap,
    });

    // Keywords (if present)
    if (abstract.keywords && abstract.keywords.length > 0) {
      doc.moveDown();

      // "Keywords:" label - italic, indented
      doc.font(PDFKIT_BUILTIN_FONTS.timesItalic).text('Keywords: ', PAGE_CONSTANTS.margin + PAGE_CONSTANTS.indent, doc.y, {
        continued: true,
      });

      // Keywords list - regular font
      doc.font(PDFKIT_BUILTIN_FONTS.timesRoman).text(abstract.keywords.join(', '));
    }
  }

  // ===========================================================================
  // BODY CONTENT
  // ===========================================================================

  /**
   * Render the paper title at the start of body (per APA 7th Edition).
   *
   * @param doc - PDFKit document
   * @param title - Paper title
   */
  private renderBodyTitle(doc: PdfKitDocument, title: string): void {
    doc.y = PAGE_CONSTANTS.margin + 48;

    // Title repeated at start of body - centered, bold
    doc
      .font(PDFKIT_BUILTIN_FONTS.timesBold)
      .fontSize(12)
      .text(title, PAGE_CONSTANTS.margin, doc.y, {
        align: 'center',
        width: PAGE_CONSTANTS.contentWidth,
      });

    doc.moveDown();
  }

  /**
   * Render the body content with sections.
   *
   * @param doc - PDFKit document
   * @param body - Formatted body content
   */
  private renderBody(doc: PdfKitDocument, body: FormattedPaper['body']): void {
    // Render sections
    for (const section of body.sections) {
      this.renderSection(doc, section);
    }

    // Render any remaining content (with code block support)
    if (body.content && body.content.trim()) {
      this.renderMixedContent(doc, body.content, { indent: true });
    }
  }

  // ===========================================================================
  // CODE BLOCK RENDERING
  // ===========================================================================

  /**
   * Render mixed content that may contain code blocks.
   * Parses content into text and code segments and renders each appropriately.
   *
   * @param doc - PDFKit document
   * @param content - Content string potentially containing code blocks
   * @param options - Rendering options
   */
  private renderMixedContent(
    doc: PdfKitDocument,
    content: string,
    options: { indent?: boolean; continued?: boolean } = {}
  ): void {
    const segments = parseContentSegments(content);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (segment.type === 'code') {
        this.renderCodeBlock(doc, segment.content, segment.language);
      } else {
        this.renderTextContent(doc, segment.content, {
          indent: options.indent,
          continued: options.continued && isLast,
        });
      }
    }
  }

  /**
   * Render a code block with monospace font and optional background.
   *
   * @param doc - PDFKit document
   * @param code - Code content to render
   * @param language - Optional language hint for syntax highlighting (future use)
   */
  private renderCodeBlock(doc: PdfKitDocument, code: string, _language?: string): void {
    // Check for page break before rendering code block
    const estimatedHeight = this.estimateCodeBlockHeight(doc, code);
    if (doc.y + estimatedHeight > PAGE_CONSTANTS.pageHeight - PAGE_CONSTANTS.margin) {
      doc.addPage();
    }

    const startY = doc.y;
    const padding = CODE_BLOCK_STYLE.padding;
    const codeX = PAGE_CONSTANTS.margin + padding;
    const codeWidth = PAGE_CONSTANTS.contentWidth - padding * 2;

    // Save current position to draw background after measuring text
    const savedY = doc.y;

    // Measure text height by temporarily rendering (invisible)
    doc.font(PDFKIT_BUILTIN_FONTS.courier).fontSize(CODE_BLOCK_STYLE.fontSize);

    // Calculate height by measuring each line
    const lines = code.split('\n');
    const lineHeight = CODE_BLOCK_STYLE.fontSize * CODE_BLOCK_STYLE.lineHeightMultiplier;
    const textHeight = lines.length * lineHeight;
    const blockHeight = textHeight + padding * 2;

    // Draw background rectangle
    doc
      .rect(PAGE_CONSTANTS.margin, savedY, PAGE_CONSTANTS.contentWidth, blockHeight)
      .fill(CODE_BLOCK_STYLE.backgroundColor);

    // Draw subtle border
    doc
      .rect(PAGE_CONSTANTS.margin, savedY, PAGE_CONSTANTS.contentWidth, blockHeight)
      .stroke(CODE_BLOCK_STYLE.borderColor);

    // Reset position and render code text
    doc.y = savedY + padding;
    doc.fillColor('black'); // Reset fill color after background

    // Render code line by line to preserve exact whitespace and alignment
    for (const line of lines) {
      // Check for page break mid-code-block
      if (doc.y + lineHeight > PAGE_CONSTANTS.pageHeight - PAGE_CONSTANTS.margin) {
        doc.addPage();
        doc.y = PAGE_CONSTANTS.margin;
      }

      // Preprocess: tabs to spaces, truncate long lines (except ASCII diagrams)
      const processedLine = preprocessCodeLine(line, CODE_LINE_CONFIG.maxChars);

      // Use text() with specific options to preserve whitespace
      // Render each line without indent, preserving all spaces
      // NOTE: lineBreak is a valid PDFKit runtime option but not in TypeScript types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc.font(PDFKIT_BUILTIN_FONTS.courier).fontSize(CODE_BLOCK_STYLE.fontSize) as any).text(
        processedLine || ' ', // Empty lines need at least a space to maintain height
        codeX,
        doc.y,
        {
          width: codeWidth,
          lineBreak: false, // CRITICAL: Disable PDFKit auto line-wrap
          lineGap: lineHeight - CODE_BLOCK_STYLE.fontSize,
          continued: false,
        }
      );
    }

    // Move past the code block with some spacing
    doc.y = savedY + blockHeight;
    doc.moveDown(0.5);
  }

  /**
   * Estimate the height of a code block for page break detection.
   *
   * @param doc - PDFKit document
   * @param code - Code content
   * @returns Estimated height in points
   */
  private estimateCodeBlockHeight(_doc: PdfKitDocument, code: string): number {
    const lines = code.split('\n');
    const lineHeight = CODE_BLOCK_STYLE.fontSize * CODE_BLOCK_STYLE.lineHeightMultiplier;
    return lines.length * lineHeight + CODE_BLOCK_STYLE.padding * 2;
  }

  /**
   * Render regular text content with standard APA formatting.
   *
   * @param doc - PDFKit document
   * @param text - Text content to render
   * @param options - Rendering options
   */
  private renderTextContent(
    doc: PdfKitDocument,
    text: string,
    options: { indent?: boolean; continued?: boolean } = {}
  ): void {
    const textOptions: {
      align?: 'left' | 'center' | 'right' | 'justify';
      width?: number;
      lineGap?: number;
      indent?: number;
      continued?: boolean;
    } = {
      align: 'left',
      width: PAGE_CONSTANTS.contentWidth,
      lineGap: PAGE_CONSTANTS.lineGap,
    };

    if (options.indent) {
      textOptions.indent = PAGE_CONSTANTS.indent;
    }

    if (options.continued) {
      textOptions.continued = true;
    }

    doc.font(PDFKIT_BUILTIN_FONTS.timesRoman).fontSize(12).text(text, PAGE_CONSTANTS.margin, doc.y, textOptions);
  }

  /**
   * Render a section with appropriate APA heading level.
   *
   * @param doc - PDFKit document
   * @param section - Formatted section
   */
  private renderSection(doc: PdfKitDocument, section: FormattedSection): void {
    // Check for page break if near bottom
    if (doc.y > PAGE_CONSTANTS.pageHeight - PAGE_CONSTANTS.margin - 72) {
      doc.addPage();
    }

    const headingFont = getHeadingFont(section.level);

    // Apply heading based on APA level
    switch (section.level) {
      case 1:
        // Level 1: Centered, Bold, Title Case
        doc.moveDown();
        doc
          .font(headingFont.font)
          .fontSize(headingFont.size)
          .text(section.title, PAGE_CONSTANTS.margin, doc.y, {
            align: 'center',
            width: PAGE_CONSTANTS.contentWidth,
          });
        doc.moveDown();
        break;

      case 2:
        // Level 2: Flush Left, Bold, Title Case
        doc.moveDown();
        doc
          .font(headingFont.font)
          .fontSize(headingFont.size)
          .text(section.title, PAGE_CONSTANTS.margin, doc.y, {
            align: 'left',
            width: PAGE_CONSTANTS.contentWidth,
          });
        doc.moveDown();
        break;

      case 3:
        // Level 3: Flush Left, Bold Italic, Title Case
        doc.moveDown();
        doc
          .font(headingFont.font)
          .fontSize(headingFont.size)
          .text(section.title, PAGE_CONSTANTS.margin, doc.y, {
            align: 'left',
            width: PAGE_CONSTANTS.contentWidth,
          });
        doc.moveDown();
        break;

      case 4:
        // Level 4: Indented, Bold, Title Case, Ending With Period. Text inline.
        doc.moveDown();
        doc
          .font(headingFont.font)
          .fontSize(headingFont.size)
          .text(`${section.title}. `, PAGE_CONSTANTS.margin + PAGE_CONSTANTS.indent, doc.y, {
            continued: true,
          });
        // Continue with content on same line
        doc.font(PDFKIT_BUILTIN_FONTS.timesRoman);
        break;

      case 5:
        // Level 5: Indented, Bold Italic, Title Case, Ending With Period. Text inline.
        doc.moveDown();
        doc
          .font(headingFont.font)
          .fontSize(headingFont.size)
          .text(`${section.title}. `, PAGE_CONSTANTS.margin + PAGE_CONSTANTS.indent, doc.y, {
            continued: true,
          });
        // Continue with content on same line
        doc.font(PDFKIT_BUILTIN_FONTS.timesRoman);
        break;
    }

    // Section content (with code block support)
    if (section.content && section.content.trim()) {
      // For levels 1-3, add paragraph indent
      // For levels 4-5, content continues inline (already set continued: true)
      const useIndent = section.level <= 3;
      const continueInline = section.level >= 4;

      // Use mixed content rendering to handle code blocks
      this.renderMixedContent(doc, section.content, {
        indent: useIndent,
        continued: continueInline,
      });
    }

    // Render subsections
    if (section.subsections) {
      for (const subsection of section.subsections) {
        this.renderSection(doc, subsection);
      }
    }
  }

  // ===========================================================================
  // REFERENCES
  // ===========================================================================

  /**
   * Render the references section following APA 7th Edition guidelines.
   *
   * @param doc - PDFKit document
   * @param refs - Formatted references
   */
  private renderReferences(doc: PdfKitDocument, refs: FormattedPaper['references']): void {
    if (!refs) return;

    doc.y = PAGE_CONSTANTS.margin + 48;

    // "References" heading - centered, bold
    doc
      .font(PDFKIT_BUILTIN_FONTS.timesBold)
      .fontSize(12)
      .text('References', PAGE_CONSTANTS.margin, doc.y, {
        align: 'center',
        width: PAGE_CONSTANTS.contentWidth,
      });

    doc.moveDown();

    // Reference entries with hanging indent
    doc.font(PDFKIT_BUILTIN_FONTS.timesRoman);

    for (const entry of refs.entries) {
      // Check for page break
      if (doc.y > PAGE_CONSTANTS.pageHeight - PAGE_CONSTANTS.margin - 48) {
        doc.addPage();
      }

      // Hanging indent: first line at margin, subsequent lines indented
      doc.text(entry, PAGE_CONSTANTS.margin, doc.y, {
        align: 'left',
        width: PAGE_CONSTANTS.contentWidth,
        indent: 0,
        lineGap: PAGE_CONSTANTS.lineGap,
        // PDFKit doesn't have native hanging indent, so we use negative indent trick
        // or handle it manually by splitting lines
      });

      // Manual hanging indent implementation
      // Re-render with proper hanging indent
      const savedY = doc.y;
      doc.y = savedY - doc.currentLineHeight() * 2;

      // Clear and re-render with proper formatting
      doc.text(entry, PAGE_CONSTANTS.margin, doc.y, {
        align: 'left',
        width: PAGE_CONSTANTS.contentWidth,
        indent: -PAGE_CONSTANTS.indent, // Negative indent creates hanging effect when combined with left padding
        paragraphGap: 0,
        lineGap: PAGE_CONSTANTS.lineGap,
      });

      doc.moveDown(0.5);
    }
  }

  // ===========================================================================
  // APPENDICES
  // ===========================================================================

  /**
   * Render appendices following APA 7th Edition guidelines.
   *
   * @param doc - PDFKit document
   * @param appendices - Array of formatted appendices
   */
  private renderAppendices(doc: PdfKitDocument, appendices: FormattedAppendix[]): void {
    for (const appendix of appendices) {
      doc.addPage();
      doc.y = PAGE_CONSTANTS.margin + 48;

      // Appendix label - centered, bold
      const label = appendices.length === 1 ? 'Appendix' : `Appendix ${appendix.label}`;

      doc
        .font(PDFKIT_BUILTIN_FONTS.timesBold)
        .fontSize(12)
        .text(label, PAGE_CONSTANTS.margin, doc.y, {
          align: 'center',
          width: PAGE_CONSTANTS.contentWidth,
        });

      // Appendix title - centered, bold
      if (appendix.title) {
        doc.text(appendix.title, PAGE_CONSTANTS.margin, doc.y, {
          align: 'center',
          width: PAGE_CONSTANTS.contentWidth,
        });
      }

      doc.moveDown();

      // Appendix content
      doc.font(PDFKIT_BUILTIN_FONTS.timesRoman).text(appendix.content, PAGE_CONSTANTS.margin, doc.y, {
        align: 'left',
        width: PAGE_CONSTANTS.contentWidth,
        indent: PAGE_CONSTANTS.indent,
        lineGap: PAGE_CONSTANTS.lineGap,
      });
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new PDFKit generator instance.
 *
 * @returns New PDFKit generator
 */
export function createPdfKitGenerator(): PdfKitGenerator {
  return new PdfKitGenerator();
}

export default PdfKitGenerator;
